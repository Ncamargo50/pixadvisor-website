/**
 * KrigingEngine - Ordinary Kriging interpolation for precision agriculture
 *
 * Provides variogram modeling, fitting, Ordinary Kriging interpolation,
 * cross-validation, and chart rendering. Designed to complement the
 * IDW method in InterpolationEngine (interpolation.js) with output
 * formats that are fully compatible with the existing rendering pipeline.
 */
class KrigingEngine {

    // ================================================================
    // Variogram Models
    // ================================================================

    /**
     * Linear variogram model.
     * gamma(h) = nugget + (sill - nugget) * min(h / range, 1)
     */
    static variogramLinear(h, nugget, sill, range) {
        if (h <= 0) return nugget;
        const ratio = Math.min(h / range, 1);
        return nugget + (sill - nugget) * ratio;
    }

    /**
     * Power variogram model.
     * gamma(h) = nugget + scale * h^exponent
     * where scale = (sill - nugget) / range^exponent
     */
    static variogramPower(h, nugget, sill, range, exponent = 1.5) {
        if (h <= 0) return nugget;
        const scale = (sill - nugget) / Math.pow(range, exponent);
        return nugget + scale * Math.pow(h, exponent);
    }

    /**
     * Gaussian variogram model.
     * gamma(h) = nugget + (sill - nugget) * (1 - exp(-3 * h^2 / range^2))
     */
    static variogramGaussian(h, nugget, sill, range) {
        if (h <= 0) return nugget;
        return nugget + (sill - nugget) * (1 - Math.exp(-3 * (h * h) / (range * range)));
    }

    /**
     * Spherical variogram model.
     * gamma(h) = nugget + (sill - nugget) * (1.5*(h/range) - 0.5*(h/range)^3)  for h <= range
     * gamma(h) = sill  for h > range
     */
    static variogramSpherical(h, nugget, sill, range) {
        if (h <= 0) return nugget;
        if (h >= range) return sill;
        const ratio = h / range;
        return nugget + (sill - nugget) * (1.5 * ratio - 0.5 * ratio * ratio * ratio);
    }

    /**
     * Exponential variogram model.
     * gamma(h) = nugget + (sill - nugget) * (1 - exp(-3 * h / range))
     */
    static variogramExponential(h, nugget, sill, range) {
        if (h <= 0) return nugget;
        return nugget + (sill - nugget) * (1 - Math.exp(-3 * h / range));
    }

    /**
     * Hole-effect variogram model.
     * gamma(h) = nugget + (sill - nugget) * (1 - sin(pi*h/range) / (pi*h/range))
     */
    static variogramHoleEffect(h, nugget, sill, range) {
        if (h <= 0) return nugget;
        const x = Math.PI * h / range;
        return nugget + (sill - nugget) * (1 - Math.sin(x) / x);
    }

    // ================================================================
    // Helpers
    // ================================================================

    /**
     * Haversine distance between two lat/lng points in metres.
     */
    static _haversineDistance(lat1, lng1, lat2, lng2) {
        const R = 6371000; // Earth radius in metres
        const toRad = Math.PI / 180;
        const dLat = (lat2 - lat1) * toRad;
        const dLng = (lng2 - lng1) * toRad;
        const a =
            Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) *
            Math.sin(dLng / 2) * Math.sin(dLng / 2);
        return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }

    /**
     * Evaluate a variogram model by name.
     */
    static _evaluateModel(modelType, h, nugget, sill, range, exponent) {
        switch (modelType) {
            case 'linear':      return KrigingEngine.variogramLinear(h, nugget, sill, range);
            case 'power':       return KrigingEngine.variogramPower(h, nugget, sill, range, exponent);
            case 'gaussian':    return KrigingEngine.variogramGaussian(h, nugget, sill, range);
            case 'spherical':   return KrigingEngine.variogramSpherical(h, nugget, sill, range);
            case 'exponential': return KrigingEngine.variogramExponential(h, nugget, sill, range);
            case 'hole-effect': return KrigingEngine.variogramHoleEffect(h, nugget, sill, range);
            default:            return KrigingEngine.variogramSpherical(h, nugget, sill, range);
        }
    }

    // ================================================================
    // Empirical Variogram
    // ================================================================

    /**
     * Compute the empirical (experimental) variogram from sample points.
     *
     * @param {Array<{lat:number, lng:number, value:number}>} points
     * @param {Object} options
     * @param {number} options.numLags - Number of lag bins (default 15)
     * @param {number} options.maxLagFraction - Fraction of max distance to use (default 0.5)
     * @returns {{lags:number[], semivariance:number[], pairs:number[], maxDistance:number}}
     */
    static computeEmpiricalVariogram(points, options = {}) {
        const numLags = options.numLags || 15;
        const maxLagFraction = options.maxLagFraction || 0.5;

        const n = points.length;
        if (n < 2) {
            return { lags: [], semivariance: [], pairs: [], maxDistance: 0 };
        }

        // Compute all pairwise distances and squared differences
        const pairDistances = [];
        const pairSemivar = [];
        let maxDistance = 0;

        for (let i = 0; i < n; i++) {
            for (let j = i + 1; j < n; j++) {
                const d = KrigingEngine._haversineDistance(
                    points[i].lat, points[i].lng,
                    points[j].lat, points[j].lng
                );
                const sv = 0.5 * Math.pow(points[i].value - points[j].value, 2);
                pairDistances.push(d);
                pairSemivar.push(sv);
                if (d > maxDistance) maxDistance = d;
            }
        }

        // Determine lag width
        const maxLag = maxDistance * maxLagFraction;
        const lagWidth = maxLag / numLags;

        // Bin pairs into lags
        const lags = [];
        const semivariance = [];
        const pairs = [];

        for (let k = 0; k < numLags; k++) {
            const lagMin = k * lagWidth;
            const lagMax = (k + 1) * lagWidth;
            const lagCenter = (lagMin + lagMax) / 2;

            let sum = 0;
            let count = 0;

            for (let p = 0; p < pairDistances.length; p++) {
                if (pairDistances[p] >= lagMin && pairDistances[p] < lagMax) {
                    sum += pairSemivar[p];
                    count++;
                }
            }

            lags.push(lagCenter);
            semivariance.push(count > 0 ? sum / count : 0);
            pairs.push(count);
        }

        return { lags, semivariance, pairs, maxDistance };
    }

    // ================================================================
    // Variogram Model Fitting
    // ================================================================

    /**
     * Fit a variogram model to empirical data using weighted least squares
     * with grid search and refinement.
     *
     * @param {{lags:number[], semivariance:number[], pairs:number[]}} empirical
     * @param {string} modelType - One of the 6 supported models
     * @returns {{nugget:number, sill:number, range:number, exponent:number, model:string, rmse:number}}
     */
    static fitVariogramModel(empirical, modelType = 'spherical') {
        const { lags, semivariance, pairs } = empirical;

        // Filter out bins with no pairs
        const validIdx = [];
        for (let i = 0; i < lags.length; i++) {
            if (pairs[i] > 0) validIdx.push(i);
        }
        if (validIdx.length === 0) {
            return { nugget: 0, sill: 1, range: 1, exponent: 1.5, model: modelType, rmse: Infinity };
        }

        const vLags = validIdx.map(i => lags[i]);
        const vSemi = validIdx.map(i => semivariance[i]);
        const vPairs = validIdx.map(i => pairs[i]);

        const maxSemivariance = Math.max(...vSemi);
        const maxLag = Math.max(...vLags);

        if (maxSemivariance === 0 || maxLag === 0) {
            return { nugget: 0, sill: 0, range: maxLag || 1, exponent: 1.5, model: modelType, rmse: 0 };
        }

        // Weighted RMSE calculation
        const calcRMSE = (nugget, sill, range, exponent) => {
            let sumWeightedSq = 0;
            let sumWeights = 0;
            for (let i = 0; i < vLags.length; i++) {
                const predicted = KrigingEngine._evaluateModel(modelType, vLags[i], nugget, sill, range, exponent);
                const residual = vSemi[i] - predicted;
                const w = vPairs[i]; // weight by number of pairs
                sumWeightedSq += w * residual * residual;
                sumWeights += w;
            }
            return sumWeights > 0 ? Math.sqrt(sumWeightedSq / sumWeights) : Infinity;
        };

        // Grid search
        const nuggetFractions = [0, 0.1, 0.2];
        const sillFractions = [0.5, 0.75, 1.0, 1.25];
        const rangeFractions = [0.25, 0.5, 0.75, 1.0];
        const exponents = modelType === 'power' ? [0.5, 1.0, 1.5, 2.0] : [1.5];

        let bestRMSE = Infinity;
        let bestParams = { nugget: 0, sill: maxSemivariance, range: maxLag, exponent: 1.5 };

        for (const nf of nuggetFractions) {
            for (const sf of sillFractions) {
                for (const rf of rangeFractions) {
                    for (const exp of exponents) {
                        const nugget = nf * maxSemivariance;
                        const sill = sf * maxSemivariance;
                        const range = rf * maxLag;

                        // Sill must be greater than nugget
                        if (sill <= nugget) continue;
                        if (range <= 0) continue;

                        const rmse = calcRMSE(nugget, sill, range, exp);
                        if (rmse < bestRMSE) {
                            bestRMSE = rmse;
                            bestParams = { nugget, sill, range, exponent: exp };
                        }
                    }
                }
            }
        }

        // Refinement: search around best parameters with finer grid
        const refineSteps = 5;
        const refineNuggets = [];
        const refineSills = [];
        const refineRanges = [];
        const refineExponents = [];

        for (let i = -2; i <= 2; i++) {
            refineNuggets.push(Math.max(0, bestParams.nugget + i * maxSemivariance * 0.05));
            refineSills.push(Math.max(0.01, bestParams.sill + i * maxSemivariance * 0.1));
            refineRanges.push(Math.max(0.01, bestParams.range + i * maxLag * 0.1));
            if (modelType === 'power') {
                refineExponents.push(Math.max(0.1, bestParams.exponent + i * 0.2));
            }
        }
        if (modelType !== 'power') {
            refineExponents.push(bestParams.exponent);
        }

        for (const nugget of refineNuggets) {
            for (const sill of refineSills) {
                for (const range of refineRanges) {
                    for (const exp of refineExponents) {
                        if (sill <= nugget) continue;
                        if (range <= 0) continue;

                        const rmse = calcRMSE(nugget, sill, range, exp);
                        if (rmse < bestRMSE) {
                            bestRMSE = rmse;
                            bestParams = { nugget, sill, range, exponent: exp };
                        }
                    }
                }
            }
        }

        return {
            nugget: bestParams.nugget,
            sill: bestParams.sill,
            range: bestParams.range,
            exponent: bestParams.exponent,
            model: modelType,
            rmse: bestRMSE
        };
    }

    // ================================================================
    // Auto-fit All Models
    // ================================================================

    /**
     * Fit all 6 variogram models and return them sorted by RMSE (best first).
     *
     * @param {{lags:number[], semivariance:number[], pairs:number[]}} empirical
     * @returns {Array<{model:string, params:{nugget:number, sill:number, range:number}, rmse:number}>}
     */
    static autoFitAllModels(empirical) {
        const modelTypes = ['linear', 'power', 'gaussian', 'spherical', 'exponential', 'hole-effect'];
        const results = [];

        for (const modelType of modelTypes) {
            const fit = KrigingEngine.fitVariogramModel(empirical, modelType);
            results.push({
                model: modelType,
                params: {
                    nugget: fit.nugget,
                    sill: fit.sill,
                    range: fit.range,
                    exponent: fit.exponent
                },
                rmse: fit.rmse
            });
        }

        // Sort by RMSE ascending
        results.sort((a, b) => a.rmse - b.rmse);
        return results;
    }

    // ================================================================
    // Linear System Solver
    // ================================================================

    /**
     * Solve Ax = b using Gaussian elimination with partial pivoting.
     *
     * @param {number[][]} A - Square matrix (will be modified in-place)
     * @param {number[]} b - Right-hand side vector (will be modified in-place)
     * @returns {number[]|null} Solution vector, or null if system is singular
     */
    static _solveLinearSystem(A, b) {
        const n = b.length;

        // Build augmented matrix
        const aug = [];
        for (let i = 0; i < n; i++) {
            aug[i] = new Array(n + 1);
            for (let j = 0; j < n; j++) {
                aug[i][j] = A[i][j];
            }
            aug[i][n] = b[i];
        }

        // Forward elimination with partial pivoting
        for (let col = 0; col < n; col++) {
            // Find pivot
            let maxVal = Math.abs(aug[col][col]);
            let maxRow = col;
            for (let row = col + 1; row < n; row++) {
                if (Math.abs(aug[row][col]) > maxVal) {
                    maxVal = Math.abs(aug[row][col]);
                    maxRow = row;
                }
            }

            // Check for singular matrix
            if (maxVal < 1e-12) {
                return null;
            }

            // Swap rows
            if (maxRow !== col) {
                const tmp = aug[col];
                aug[col] = aug[maxRow];
                aug[maxRow] = tmp;
            }

            // Eliminate below
            for (let row = col + 1; row < n; row++) {
                const factor = aug[row][col] / aug[col][col];
                for (let j = col; j <= n; j++) {
                    aug[row][j] -= factor * aug[col][j];
                }
            }
        }

        // Back substitution
        const x = new Array(n);
        for (let i = n - 1; i >= 0; i--) {
            if (Math.abs(aug[i][i]) < 1e-12) {
                return null;
            }
            x[i] = aug[i][n];
            for (let j = i + 1; j < n; j++) {
                x[i] -= aug[i][j] * x[j];
            }
            x[i] /= aug[i][i];
        }

        return x;
    }

    // ================================================================
    // Ordinary Kriging Interpolation
    // ================================================================

    /**
     * Perform Ordinary Kriging interpolation over a grid.
     *
     * Output format matches InterpolationEngine.interpolateIDW() so existing
     * rendering code works with both methods.
     *
     * @param {Array<{lat:number, lng:number, value:number}>} points
     * @param {{minLat:number, maxLat:number, minLng:number, maxLng:number}} bounds
     * @param {{model:string, nugget:number, sill:number, range:number, exponent?:number}} variogramParams
     * @param {Object} options
     * @param {number} options.resolution - Grid resolution (default 80)
     * @param {number} options.maxPoints - Max nearest neighbours for local kriging (default 20)
     * @returns {{grid:number[][], bounds:Object, resolution:number, stats:Object, method:string, variogramParams:Object}}
     */
    static interpolateKriging(points, bounds, variogramParams, options = {}) {
        const resolution = options.resolution || 80;
        const maxPoints = options.maxPoints || 20;

        const { model, nugget, sill, range } = variogramParams;
        const exponent = variogramParams.exponent || 1.5;

        const latStep = (bounds.maxLat - bounds.minLat) / resolution;
        const lngStep = (bounds.maxLng - bounds.minLng) / resolution;

        const grid = [];
        let min = Infinity;
        let max = -Infinity;
        let sum = 0;
        let sumSq = 0;
        let count = 0;

        // Pre-check: need at least 2 points for kriging
        if (points.length < 2) {
            // Fallback: fill grid with the single value or zero
            const fillValue = points.length === 1 ? points[0].value : 0;
            for (let i = 0; i < resolution; i++) {
                grid[i] = new Array(resolution).fill(fillValue);
            }
            return {
                grid,
                bounds,
                resolution,
                stats: { min: fillValue, max: fillValue, mean: fillValue, variance: 0 },
                method: 'kriging',
                variogramParams
            };
        }

        for (let i = 0; i < resolution; i++) {
            grid[i] = new Array(resolution);
            const cellLat = bounds.minLat + (i + 0.5) * latStep;

            for (let j = 0; j < resolution; j++) {
                const cellLng = bounds.minLng + (j + 0.5) * lngStep;

                // Find distances to all points
                const dists = [];
                for (let p = 0; p < points.length; p++) {
                    const d = KrigingEngine._haversineDistance(cellLat, cellLng, points[p].lat, points[p].lng);
                    dists.push({ index: p, distance: d });
                }

                // Sort by distance and take nearest maxPoints
                dists.sort((a, b) => a.distance - b.distance);
                const nearest = dists.slice(0, Math.min(maxPoints, points.length));

                // Check for coincident point (distance ~ 0)
                if (nearest[0].distance < 0.01) {
                    grid[i][j] = points[nearest[0].index].value;
                } else {
                    // Build kriging system
                    const result = KrigingEngine._solveKrigingSystem(
                        points, nearest, cellLat, cellLng,
                        model, nugget, sill, range, exponent
                    );
                    grid[i][j] = result;
                }

                const v = grid[i][j];
                if (v < min) min = v;
                if (v > max) max = v;
                sum += v;
                sumSq += v * v;
                count++;
            }
        }

        const mean = sum / count;
        const variance = (sumSq / count) - (mean * mean);

        return {
            grid,
            bounds,
            resolution,
            stats: { min, max, mean, variance },
            method: 'kriging',
            variogramParams
        };
    }

    /**
     * Build and solve the Ordinary Kriging system for a single estimation point.
     *
     * The kriging matrix is (n+1) x (n+1) to include the Lagrange multiplier
     * for the unbiasedness constraint.
     *
     * @returns {number} Estimated value at the target location
     */
    static _solveKrigingSystem(points, nearest, targetLat, targetLng, model, nugget, sill, range, exponent) {
        const n = nearest.length;

        // Build the (n+1) x (n+1) kriging matrix
        const K = [];
        for (let i = 0; i <= n; i++) {
            K[i] = new Array(n + 1);
        }

        // Fill variogram values between sample points
        for (let i = 0; i < n; i++) {
            for (let j = 0; j < n; j++) {
                if (i === j) {
                    K[i][j] = 0; // gamma(0) = 0 for semivariance matrix
                } else {
                    const d = KrigingEngine._haversineDistance(
                        points[nearest[i].index].lat, points[nearest[i].index].lng,
                        points[nearest[j].index].lat, points[nearest[j].index].lng
                    );
                    K[i][j] = KrigingEngine._evaluateModel(model, d, nugget, sill, range, exponent);
                }
            }
            // Lagrange multiplier row/column
            K[i][n] = 1;
            K[n][i] = 1;
        }
        K[n][n] = 0;

        // Build right-hand side: variogram values between sample points and target
        const b = new Array(n + 1);
        for (let i = 0; i < n; i++) {
            b[i] = KrigingEngine._evaluateModel(model, nearest[i].distance, nugget, sill, range, exponent);
        }
        b[n] = 1; // Lagrange constraint

        // Solve the system
        const weights = KrigingEngine._solveLinearSystem(K, b);

        // If system is singular, fall back to IDW
        if (!weights) {
            return KrigingEngine._idwFallback(points, nearest, targetLat, targetLng);
        }

        // Check for unreasonable weights (NaN or very large)
        let hasInvalid = false;
        for (let i = 0; i < n; i++) {
            if (!isFinite(weights[i])) {
                hasInvalid = true;
                break;
            }
        }
        if (hasInvalid) {
            return KrigingEngine._idwFallback(points, nearest, targetLat, targetLng);
        }

        // Compute estimate
        let estimate = 0;
        for (let i = 0; i < n; i++) {
            estimate += weights[i] * points[nearest[i].index].value;
        }

        return estimate;
    }

    /**
     * IDW fallback when the kriging system cannot be solved.
     */
    static _idwFallback(points, nearest, targetLat, targetLng) {
        let sumW = 0;
        let sumWV = 0;
        const power = 2;

        for (const nb of nearest) {
            const d = nb.distance;
            if (d < 0.01) return points[nb.index].value;
            const w = 1 / Math.pow(d, power);
            sumW += w;
            sumWV += w * points[nb.index].value;
        }

        return sumW > 0 ? sumWV / sumW : 0;
    }

    // ================================================================
    // Cross-Validation (Leave-One-Out)
    // ================================================================

    /**
     * Perform leave-one-out cross-validation.
     *
     * @param {Array<{lat:number, lng:number, value:number}>} points
     * @param {string} method - 'idw' or 'kriging'
     * @param {Object} options
     * @param {Object} options.variogramParams - Required for kriging method
     * @param {number} options.power - IDW power parameter (default 2)
     * @param {number} options.maxPoints - Max neighbours for kriging (default 20)
     * @returns {{rmse:number, mae:number, r2:number, meanError:number, maxError:number, residuals:Array}}
     */
    static crossValidate(points, method = 'kriging', options = {}) {
        const residuals = [];
        const n = points.length;

        if (n < 3) {
            return { rmse: 0, mae: 0, r2: 0, meanError: 0, maxError: 0, residuals: [] };
        }

        for (let i = 0; i < n; i++) {
            // Build subset excluding point i
            const subset = [];
            for (let j = 0; j < n; j++) {
                if (j !== i) subset.push(points[j]);
            }

            const target = points[i];
            let predicted;

            if (method === 'kriging' && options.variogramParams) {
                const { model, nugget, sill, range } = options.variogramParams;
                const exponent = options.variogramParams.exponent || 1.5;
                const maxPoints = options.maxPoints || 20;

                // Find nearest points to target
                const dists = [];
                for (let p = 0; p < subset.length; p++) {
                    const d = KrigingEngine._haversineDistance(target.lat, target.lng, subset[p].lat, subset[p].lng);
                    dists.push({ index: p, distance: d });
                }
                dists.sort((a, b) => a.distance - b.distance);
                const nearest = dists.slice(0, Math.min(maxPoints, subset.length));

                predicted = KrigingEngine._solveKrigingSystem(
                    subset, nearest, target.lat, target.lng,
                    model, nugget, sill, range, exponent
                );
            } else {
                // IDW
                const power = options.power || 2;
                let sumW = 0;
                let sumWV = 0;
                for (const pt of subset) {
                    const d = KrigingEngine._haversineDistance(target.lat, target.lng, pt.lat, pt.lng);
                    if (d < 0.01) { sumW = 1; sumWV = pt.value; break; }
                    const w = 1 / Math.pow(d, power);
                    sumW += w;
                    sumWV += w * pt.value;
                }
                predicted = sumW > 0 ? sumWV / sumW : 0;
            }

            residuals.push({
                actual: target.value,
                predicted,
                error: target.value - predicted,
                lat: target.lat,
                lng: target.lng
            });
        }

        // Compute summary statistics
        let sumError = 0;
        let sumErrorSq = 0;
        let sumAbsError = 0;
        let maxError = 0;
        let sumActual = 0;
        let sumActualSq = 0;
        let sumPredActual = 0;

        for (const r of residuals) {
            sumError += r.error;
            sumErrorSq += r.error * r.error;
            sumAbsError += Math.abs(r.error);
            if (Math.abs(r.error) > maxError) maxError = Math.abs(r.error);
            sumActual += r.actual;
            sumActualSq += r.actual * r.actual;
        }

        const meanActual = sumActual / n;
        let ssTot = 0;
        for (const r of residuals) {
            ssTot += (r.actual - meanActual) * (r.actual - meanActual);
        }

        const rmse = Math.sqrt(sumErrorSq / n);
        const mae = sumAbsError / n;
        const r2 = ssTot > 0 ? 1 - (sumErrorSq / ssTot) : 0;
        const meanError = sumError / n;

        return { rmse, mae, r2, meanError, maxError, residuals };
    }

    // ================================================================
    // Variogram Chart Rendering
    // ================================================================

    /**
     * Render a variogram chart on a canvas element.
     *
     * @param {HTMLCanvasElement} canvas
     * @param {{lags:number[], semivariance:number[], pairs:number[]}} empirical
     * @param {Array<{model:string, params:Object, rmse:number}>} fittedModels
     * @param {string} activeModel - Name of the active model to highlight
     */
    static renderVariogramChart(canvas, empirical, fittedModels, activeModel) {
        const ctx = canvas.getContext('2d');
        const W = canvas.width;
        const H = canvas.height;

        // Theme colours
        const bgColor = '#1a2a40';
        const textColor = '#ffffff';
        const gridColor = 'rgba(255,255,255,0.1)';
        const pointColor = '#4fc3f7';
        const modelColors = {
            'linear': '#ff7043',
            'power': '#ab47bc',
            'gaussian': '#66bb6a',
            'spherical': '#42a5f5',
            'exponential': '#ffa726',
            'hole-effect': '#ef5350'
        };

        // Chart margins
        const margin = { top: 30, right: 20, bottom: 50, left: 60 };
        const chartW = W - margin.left - margin.right;
        const chartH = H - margin.top - margin.bottom;

        // Clear background
        ctx.fillStyle = bgColor;
        ctx.fillRect(0, 0, W, H);

        // Determine data ranges
        const { lags, semivariance, pairs } = empirical;
        if (lags.length === 0) return;

        const maxLag = Math.max(...lags) * 1.1;
        let maxSV = Math.max(...semivariance) * 1.3;

        // Also consider fitted model values
        for (const fm of fittedModels) {
            const testVal = KrigingEngine._evaluateModel(
                fm.model, maxLag, fm.params.nugget, fm.params.sill, fm.params.range, fm.params.exponent || 1.5
            );
            if (testVal > maxSV) maxSV = testVal * 1.1;
        }

        if (maxSV === 0) maxSV = 1;

        // Coordinate transforms
        const toX = (lag) => margin.left + (lag / maxLag) * chartW;
        const toY = (sv) => margin.top + chartH - (sv / maxSV) * chartH;

        // Draw grid lines
        ctx.strokeStyle = gridColor;
        ctx.lineWidth = 1;

        const numGridX = 5;
        const numGridY = 5;

        ctx.font = '11px Arial, sans-serif';
        ctx.fillStyle = textColor;
        ctx.textAlign = 'center';

        for (let i = 0; i <= numGridX; i++) {
            const lagVal = (i / numGridX) * maxLag;
            const x = toX(lagVal);
            ctx.beginPath();
            ctx.moveTo(x, margin.top);
            ctx.lineTo(x, margin.top + chartH);
            ctx.stroke();
            ctx.fillText(lagVal.toFixed(0), x, margin.top + chartH + 18);
        }

        ctx.textAlign = 'right';
        for (let i = 0; i <= numGridY; i++) {
            const svVal = (i / numGridY) * maxSV;
            const y = toY(svVal);
            ctx.beginPath();
            ctx.moveTo(margin.left, y);
            ctx.lineTo(margin.left + chartW, y);
            ctx.stroke();
            ctx.fillText(svVal.toFixed(2), margin.left - 8, y + 4);
        }

        // Axes
        ctx.strokeStyle = 'rgba(255,255,255,0.4)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(margin.left, margin.top);
        ctx.lineTo(margin.left, margin.top + chartH);
        ctx.lineTo(margin.left + chartW, margin.top + chartH);
        ctx.stroke();

        // Axis labels
        ctx.fillStyle = textColor;
        ctx.font = '12px Arial, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('Lag Distance (m)', margin.left + chartW / 2, H - 5);

        ctx.save();
        ctx.translate(14, margin.top + chartH / 2);
        ctx.rotate(-Math.PI / 2);
        ctx.fillText('Semivariance', 0, 0);
        ctx.restore();

        // Draw fitted model curves
        for (const fm of fittedModels) {
            const color = modelColors[fm.model] || '#ffffff';
            const isActive = fm.model === activeModel;
            ctx.strokeStyle = color;
            ctx.lineWidth = isActive ? 3 : 1.5;
            ctx.globalAlpha = isActive ? 1 : 0.6;

            ctx.beginPath();
            const steps = 100;
            for (let s = 0; s <= steps; s++) {
                const lag = (s / steps) * maxLag;
                const sv = KrigingEngine._evaluateModel(
                    fm.model, lag, fm.params.nugget, fm.params.sill, fm.params.range, fm.params.exponent || 1.5
                );
                const x = toX(lag);
                const y = toY(sv);
                if (s === 0) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
            }
            ctx.stroke();
            ctx.globalAlpha = 1;
        }

        // Draw empirical points (size proportional to pair count)
        const maxPairs = Math.max(...pairs, 1);
        for (let i = 0; i < lags.length; i++) {
            if (pairs[i] === 0) continue;
            const x = toX(lags[i]);
            const y = toY(semivariance[i]);
            const radius = 3 + (pairs[i] / maxPairs) * 8;

            ctx.fillStyle = pointColor;
            ctx.globalAlpha = 0.8;
            ctx.beginPath();
            ctx.arc(x, y, radius, 0, Math.PI * 2);
            ctx.fill();

            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 1;
            ctx.stroke();
        }
        ctx.globalAlpha = 1;

        // Legend
        const legendX = margin.left + chartW - 160;
        let legendY = margin.top + 10;
        ctx.font = '10px Arial, sans-serif';

        for (const fm of fittedModels) {
            const color = modelColors[fm.model] || '#ffffff';
            const isActive = fm.model === activeModel;

            ctx.fillStyle = color;
            ctx.fillRect(legendX, legendY - 4, 14, 3);
            if (isActive) {
                ctx.strokeStyle = '#ffffff';
                ctx.lineWidth = 1;
                ctx.strokeRect(legendX - 1, legendY - 5, 16, 5);
            }

            ctx.fillStyle = textColor;
            ctx.textAlign = 'left';
            ctx.fillText(`${fm.model} (RMSE: ${fm.rmse.toFixed(3)})`, legendX + 20, legendY);
            legendY += 16;
        }
    }

    // ================================================================
    // Validation Scatter Plot
    // ================================================================

    /**
     * Render a predicted-vs-actual scatter plot on a canvas element.
     *
     * @param {HTMLCanvasElement} canvas
     * @param {Array<{actual:number, predicted:number, error:number, lat:number, lng:number}>} residuals
     */
    static renderValidationChart(canvas, residuals) {
        const ctx = canvas.getContext('2d');
        const W = canvas.width;
        const H = canvas.height;

        // Theme colours
        const bgColor = '#1a2a40';
        const textColor = '#ffffff';
        const gridColor = 'rgba(255,255,255,0.1)';
        const lineColor = 'rgba(255,255,255,0.5)';

        const margin = { top: 30, right: 20, bottom: 50, left: 60 };
        const chartW = W - margin.left - margin.right;
        const chartH = H - margin.top - margin.bottom;

        // Clear
        ctx.fillStyle = bgColor;
        ctx.fillRect(0, 0, W, H);

        if (residuals.length === 0) return;

        // Determine range (use same scale for both axes)
        const allValues = [];
        for (const r of residuals) {
            allValues.push(r.actual, r.predicted);
        }
        let minVal = Math.min(...allValues);
        let maxVal = Math.max(...allValues);
        const padding = (maxVal - minVal) * 0.1 || 1;
        minVal -= padding;
        maxVal += padding;

        const toX = (v) => margin.left + ((v - minVal) / (maxVal - minVal)) * chartW;
        const toY = (v) => margin.top + chartH - ((v - minVal) / (maxVal - minVal)) * chartH;

        // Grid lines
        ctx.strokeStyle = gridColor;
        ctx.lineWidth = 1;
        ctx.font = '11px Arial, sans-serif';
        ctx.fillStyle = textColor;

        const numGrid = 5;
        for (let i = 0; i <= numGrid; i++) {
            const v = minVal + (i / numGrid) * (maxVal - minVal);
            const x = toX(v);
            const y = toY(v);

            ctx.beginPath();
            ctx.moveTo(x, margin.top);
            ctx.lineTo(x, margin.top + chartH);
            ctx.stroke();

            ctx.beginPath();
            ctx.moveTo(margin.left, y);
            ctx.lineTo(margin.left + chartW, y);
            ctx.stroke();

            ctx.textAlign = 'center';
            ctx.fillText(v.toFixed(1), x, margin.top + chartH + 18);
            ctx.textAlign = 'right';
            ctx.fillText(v.toFixed(1), margin.left - 8, y + 4);
        }

        // Axes
        ctx.strokeStyle = 'rgba(255,255,255,0.4)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(margin.left, margin.top);
        ctx.lineTo(margin.left, margin.top + chartH);
        ctx.lineTo(margin.left + chartW, margin.top + chartH);
        ctx.stroke();

        // 1:1 line
        ctx.strokeStyle = lineColor;
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 4]);
        ctx.beginPath();
        ctx.moveTo(toX(minVal), toY(minVal));
        ctx.lineTo(toX(maxVal), toY(maxVal));
        ctx.stroke();
        ctx.setLineDash([]);

        // Compute max absolute error for colouring
        let maxAbsError = 0;
        for (const r of residuals) {
            if (Math.abs(r.error) > maxAbsError) maxAbsError = Math.abs(r.error);
        }
        if (maxAbsError === 0) maxAbsError = 1;

        // Draw scatter points coloured by error magnitude
        for (const r of residuals) {
            const x = toX(r.actual);
            const y = toY(r.predicted);
            const errorNorm = Math.abs(r.error) / maxAbsError; // 0 to 1

            // Green (low error) -> Yellow -> Red (high error)
            const red = Math.round(255 * Math.min(errorNorm * 2, 1));
            const green = Math.round(255 * Math.min((1 - errorNorm) * 2, 1));
            ctx.fillStyle = `rgb(${red},${green},60)`;

            ctx.beginPath();
            ctx.arc(x, y, 5, 0, Math.PI * 2);
            ctx.fill();

            ctx.strokeStyle = 'rgba(255,255,255,0.4)';
            ctx.lineWidth = 0.5;
            ctx.stroke();
        }

        // Axis labels
        ctx.fillStyle = textColor;
        ctx.font = '12px Arial, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('Actual', margin.left + chartW / 2, H - 5);

        ctx.save();
        ctx.translate(14, margin.top + chartH / 2);
        ctx.rotate(-Math.PI / 2);
        ctx.fillText('Predicted', 0, 0);
        ctx.restore();

        // Compute R2 and RMSE
        let sumErrorSq = 0;
        let sumActual = 0;
        for (const r of residuals) {
            sumErrorSq += r.error * r.error;
            sumActual += r.actual;
        }
        const meanActual = sumActual / residuals.length;
        let ssTot = 0;
        for (const r of residuals) {
            ssTot += (r.actual - meanActual) * (r.actual - meanActual);
        }
        const r2 = ssTot > 0 ? (1 - sumErrorSq / ssTot) : 0;
        const rmse = Math.sqrt(sumErrorSq / residuals.length);

        // Display stats in upper-left corner
        ctx.fillStyle = 'rgba(26,42,64,0.85)';
        ctx.fillRect(margin.left + 10, margin.top + 10, 150, 45);
        ctx.strokeStyle = 'rgba(255,255,255,0.2)';
        ctx.lineWidth = 1;
        ctx.strokeRect(margin.left + 10, margin.top + 10, 150, 45);

        ctx.fillStyle = textColor;
        ctx.font = '12px Arial, sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText(`R\u00B2 = ${r2.toFixed(4)}`, margin.left + 20, margin.top + 30);
        ctx.fillText(`RMSE = ${rmse.toFixed(4)}`, margin.left + 20, margin.top + 48);
    }
}

// Make class globally accessible
window.KrigingEngine = KrigingEngine;
