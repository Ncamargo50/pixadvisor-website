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
     * Anisotropy is applied when options.anisotropyRatio > 1 or when class-
     * level defaults have been set via KrigingEngine.setAnisotropy().
     * options always take precedence over class-level defaults.
     *
     * @param {Array<{lat:number, lng:number, value:number}>} points
     * @param {{minLat:number, maxLat:number, minLng:number, maxLng:number}} bounds
     * @param {{model:string, nugget:number, sill:number, range:number, exponent?:number}} variogramParams
     * @param {Object} options
     * @param {number} options.resolution       - Grid resolution (default 80)
     * @param {number} options.maxPoints        - Max nearest neighbours (default 20)
     * @param {number} [options.anisotropyAngle] - Major-axis angle in RADIANS (overrides class default)
     * @param {number} [options.anisotropyRatio] - Anisotropy ratio >= 1 (overrides class default)
     * @returns {{grid:number[][], bounds:Object, resolution:number, stats:Object, method:string, variogramParams:Object}}
     */
    static interpolateKriging(points, bounds, variogramParams, options = {}) {
        const resolution = options.resolution || 80;
        const maxPoints = options.maxPoints || 20;

        // Resolve anisotropy: explicit options > class defaults > isotropic
        const classAniso = KrigingEngine.getAnisotropy();
        const anisotropyAngle = options.anisotropyAngle !== undefined
            ? options.anisotropyAngle
            : classAniso.angleRad;
        const anisotropyRatio = options.anisotropyRatio !== undefined
            ? options.anisotropyRatio
            : classAniso.ratio;

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
                    // Build kriging system (with optional anisotropy)
                    const result = KrigingEngine._solveKrigingSystem(
                        points, nearest, cellLat, cellLng,
                        model, nugget, sill, range, exponent,
                        anisotropyAngle, anisotropyRatio
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

        // Report IDW fallback statistics
        const fallbackCount = KrigingEngine._fallbackCount || 0;
        const totalCells = resolution * resolution;
        const fallbackPct = totalCells > 0 ? ((fallbackCount / totalCells) * 100).toFixed(1) : 0;
        if (fallbackCount > 0) {
            console.warn(`KrigingEngine: ${fallbackCount}/${totalCells} celdas (${fallbackPct}%) usaron IDW fallback por matrices singulares.`);
        }
        // Reset counter for next interpolation
        KrigingEngine._fallbackCount = 0;

        return {
            grid,
            bounds,
            resolution,
            stats: { min, max, mean, variance, idwFallbackCount: fallbackCount, idwFallbackPct: parseFloat(fallbackPct) },
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
     * When anisotropyRatio > 1, distances are computed in the
     * anisotropically-transformed space before variogram evaluation.
     *
     * @param {number} [anisotropyAngle=0] - Major-axis angle in radians
     * @param {number} [anisotropyRatio=1] - Anisotropy ratio >= 1
     * @returns {number} Estimated value at the target location
     */
    static _solveKrigingSystem(
        points, nearest, targetLat, targetLng,
        model, nugget, sill, range, exponent,
        anisotropyAngle = 0, anisotropyRatio = 1
    ) {
        const n = nearest.length;
        const useAnisotropy = anisotropyRatio > 1;

        // Build the (n+1) x (n+1) kriging matrix
        const K = [];
        for (let i = 0; i <= n; i++) {
            K[i] = new Array(n + 1);
        }

        // Fill variogram values between sample points
        // Tikhonov regularization (ridge) to prevent singular matrices
        const epsilon = nugget * 0.001 || 1e-6;
        for (let i = 0; i < n; i++) {
            for (let j = 0; j < n; j++) {
                if (i === j) {
                    K[i][j] = epsilon; // regularized diagonal (prevents singularity)
                } else {
                    const d = useAnisotropy
                        ? KrigingEngine._anisotropicDistance(
                            points[nearest[i].index].lat, points[nearest[i].index].lng,
                            points[nearest[j].index].lat, points[nearest[j].index].lng,
                            anisotropyAngle, anisotropyRatio
                          )
                        : KrigingEngine._haversineDistance(
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
            // When anisotropic, recompute distance from sample[i] to target
            const d = useAnisotropy
                ? KrigingEngine._anisotropicDistance(
                    points[nearest[i].index].lat, points[nearest[i].index].lng,
                    targetLat, targetLng,
                    anisotropyAngle, anisotropyRatio
                  )
                : nearest[i].distance;
            b[i] = KrigingEngine._evaluateModel(model, d, nugget, sill, range, exponent);
        }
        b[n] = 1; // Lagrange constraint

        // Solve the system
        const weights = KrigingEngine._solveLinearSystem(K, b);

        // If system is singular, fall back to IDW with warning
        if (!weights) {
            KrigingEngine._fallbackCount = (KrigingEngine._fallbackCount || 0) + 1;
            if (KrigingEngine._fallbackCount <= 3) {
                console.warn(`KrigingEngine: matriz singular en (${targetLat.toFixed(5)}, ${targetLng.toFixed(5)}), usando IDW fallback (ocurrencia #${KrigingEngine._fallbackCount})`);
            }
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
            KrigingEngine._fallbackCount = (KrigingEngine._fallbackCount || 0) + 1;
            if (KrigingEngine._fallbackCount <= 3) {
                console.warn(`KrigingEngine: pesos inválidos en (${targetLat.toFixed(5)}, ${targetLng.toFixed(5)}), usando IDW fallback`);
            }
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
     * @param {Object} options.variogramParams    - Required for kriging method
     * @param {number} options.power              - IDW power parameter (default 2)
     * @param {number} options.maxPoints          - Max neighbours for kriging (default 20)
     * @param {number} [options.anisotropyAngle]  - Anisotropy angle in radians
     * @param {number} [options.anisotropyRatio]  - Anisotropy ratio >= 1
     * @returns {{rmse:number, mae:number, r2:number, meanError:number, maxError:number, residuals:Array}}
     */
    static crossValidate(points, method = 'kriging', options = {}) {
        const residuals = [];
        const n = points.length;

        if (n < 3) {
            return { rmse: 0, mae: 0, r2: 0, meanError: 0, maxError: 0, residuals: [] };
        }

        // Resolve anisotropy for cross-validation
        const classAniso = KrigingEngine.getAnisotropy();
        const anisotropyAngle = options.anisotropyAngle !== undefined
            ? options.anisotropyAngle : classAniso.angleRad;
        const anisotropyRatio = options.anisotropyRatio !== undefined
            ? options.anisotropyRatio : classAniso.ratio;

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
                    model, nugget, sill, range, exponent,
                    anisotropyAngle, anisotropyRatio
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
    // S4.1 - Kriging Variance / Uncertainty Maps
    // ================================================================

    /**
     * Convert a variogram semivariance value to a covariance value.
     * C(h) = C(0) - γ(h)  where C(0) = sill - nugget (partial sill).
     *
     * For ordinary kriging the "sill covariance" is defined as the partial
     * sill (sill - nugget), which equals C(h) when h = 0.
     *
     * @param {number} gamma  - Semivariance value γ(h)
     * @param {number} sill   - Model sill parameter
     * @param {number} nugget - Model nugget parameter
     * @returns {number} Covariance C(h)
     */
    static _semivarianceToCovariance(gamma, sill, nugget) {
        // C(0) = sill - nugget  (partial sill / a priori variance)
        const C0 = sill - nugget;
        return C0 - gamma;
    }

    /**
     * Build and solve the Ordinary Kriging system, returning both the
     * estimated value AND the kriging variance.
     *
     * Kriging variance:
     *   σ²(x₀) = C(0) - Σᵢ λᵢ·C(xᵢ, x₀) - μ
     *
     * where μ is the Lagrange multiplier (last element of the weights vector).
     *
     * @param {Array<{lat,lng,value}>} points    - All sample points
     * @param {Array<{index,distance}>} nearest  - Pre-sorted nearest neighbours
     * @param {number} targetLat
     * @param {number} targetLng
     * @param {string} model
     * @param {number} nugget
     * @param {number} sill
     * @param {number} range
     * @param {number} exponent
     * @param {number} [anisotropyAngle=0]   - Anisotropy rotation angle (radians)
     * @param {number} [anisotropyRatio=1]   - Anisotropy ratio (major/minor axis)
     * @returns {{value:number, variance:number, weights:number[], lagrange:number}}
     */
    static _solveKrigingSystemWithVariance(
        points, nearest, targetLat, targetLng,
        model, nugget, sill, range, exponent,
        anisotropyAngle = 0, anisotropyRatio = 1
    ) {
        const n = nearest.length;
        const C0 = sill - nugget; // a priori covariance / partial sill

        // Build (n+1) x (n+1) covariance matrix using C(h) = C0 - γ(h)
        const K = [];
        for (let i = 0; i <= n; i++) {
            K[i] = new Array(n + 1).fill(0);
        }

        const epsilon = nugget * 0.001 || 1e-6;

        for (let i = 0; i < n; i++) {
            for (let j = 0; j < n; j++) {
                if (i === j) {
                    // C(0) on diagonal with Tikhonov regularisation
                    K[i][j] = C0 + epsilon;
                } else {
                    const d = anisotropyRatio !== 1
                        ? KrigingEngine._anisotropicDistance(
                            points[nearest[i].index].lat, points[nearest[i].index].lng,
                            points[nearest[j].index].lat, points[nearest[j].index].lng,
                            anisotropyAngle, anisotropyRatio
                          )
                        : KrigingEngine._haversineDistance(
                            points[nearest[i].index].lat, points[nearest[i].index].lng,
                            points[nearest[j].index].lat, points[nearest[j].index].lng
                          );
                    const gamma = KrigingEngine._evaluateModel(model, d, nugget, sill, range, exponent);
                    K[i][j] = KrigingEngine._semivarianceToCovariance(gamma, sill, nugget);
                }
            }
            K[i][n] = 1;
            K[n][i] = 1;
        }
        K[n][n] = 0;

        // Right-hand side: covariances between each sample point and the target
        const b = new Array(n + 1);
        for (let i = 0; i < n; i++) {
            const d = anisotropyRatio !== 1
                ? KrigingEngine._anisotropicDistance(
                    points[nearest[i].index].lat, points[nearest[i].index].lng,
                    targetLat, targetLng,
                    anisotropyAngle, anisotropyRatio
                  )
                : nearest[i].distance;
            const gamma = KrigingEngine._evaluateModel(model, d, nugget, sill, range, exponent);
            b[i] = KrigingEngine._semivarianceToCovariance(gamma, sill, nugget);
        }
        b[n] = 1;

        const solution = KrigingEngine._solveLinearSystem(K, b);

        if (!solution) return null; // caller handles fallback

        // Validate weights
        for (let i = 0; i <= n; i++) {
            if (!isFinite(solution[i])) return null;
        }

        // Kriging estimate
        let estimate = 0;
        for (let i = 0; i < n; i++) {
            estimate += solution[i] * points[nearest[i].index].value;
        }

        const lagrange = solution[n]; // μ (Lagrange multiplier)

        // Kriging variance: σ²(x₀) = C(0) - Σᵢ λᵢ·C(xᵢ,x₀) - μ
        let variance = C0;
        for (let i = 0; i < n; i++) {
            variance -= solution[i] * b[i];
        }
        variance -= lagrange;

        // Numerical guard: variance must be non-negative
        if (variance < 0) variance = 0;

        return { value: estimate, variance, weights: solution.slice(0, n), lagrange };
    }

    /**
     * Predict the kriging estimate AND kriging variance at a single location.
     *
     * @param {Array<{lat,lng,value}>} points
     * @param {{model,nugget,sill,range,exponent?}} variogramParams
     * @param {number} lat
     * @param {number} lng
     * @param {Object} [options]
     * @param {number} [options.maxPoints=20]
     * @param {number} [options.anisotropyAngle=0]  - Radians
     * @param {number} [options.anisotropyRatio=1]
     * @returns {{value:number, variance:number, stdDev:number}|null}
     */
    static predictWithVariance(points, variogramParams, lat, lng, options = {}) {
        const maxPoints = options.maxPoints || 20;
        const anisotropyAngle = options.anisotropyAngle || 0;
        const anisotropyRatio = options.anisotropyRatio || 1;

        const { model, nugget, sill, range } = variogramParams;
        const exponent = variogramParams.exponent || 1.5;

        if (points.length < 2) return null;

        // Find and sort nearest neighbours
        const dists = points.map((pt, idx) => ({
            index: idx,
            distance: KrigingEngine._haversineDistance(lat, lng, pt.lat, pt.lng)
        }));
        dists.sort((a, b) => a.distance - b.distance);
        const nearest = dists.slice(0, Math.min(maxPoints, points.length));

        // Exact coincidence
        if (nearest[0].distance < 0.01) {
            return {
                value: points[nearest[0].index].value,
                variance: 0,
                stdDev: 0
            };
        }

        const result = KrigingEngine._solveKrigingSystemWithVariance(
            points, nearest, lat, lng,
            model, nugget, sill, range, exponent,
            anisotropyAngle, anisotropyRatio
        );

        if (!result) {
            // IDW fallback - variance is undefined in this case, report NaN
            const value = KrigingEngine._idwFallback(points, nearest, lat, lng);
            return { value, variance: NaN, stdDev: NaN };
        }

        return {
            value: result.value,
            variance: result.variance,
            stdDev: Math.sqrt(result.variance)
        };
    }

    /**
     * Interpolate a full grid returning BOTH the predicted value and kriging
     * variance at every cell.  Suitable for rendering uncertainty / confidence
     * maps alongside the regular prediction map.
     *
     * @param {Array<{lat,lng,value}>} points
     * @param {{minLat,maxLat,minLng,maxLng}} bounds
     * @param {{model,nugget,sill,range,exponent?}} variogramParams
     * @param {Object} [options]
     * @param {number} [options.resolution=80]
     * @param {number} [options.maxPoints=20]
     * @param {number} [options.anisotropyAngle=0]
     * @param {number} [options.anisotropyRatio=1]
     * @returns {{
     *   valueGrid: number[][],
     *   varianceGrid: number[][],
     *   stdDevGrid: number[][],
     *   bounds: Object,
     *   resolution: number,
     *   stats: {
     *     value: {min,max,mean,variance},
     *     krigingVariance: {min,max,mean}
     *   },
     *   method: string,
     *   variogramParams: Object
     * }}
     */
    static interpolateWithUncertainty(points, bounds, variogramParams, options = {}) {
        const resolution = options.resolution || 80;
        const maxPoints = options.maxPoints || 20;
        const anisotropyAngle = options.anisotropyAngle || 0;
        const anisotropyRatio = options.anisotropyRatio || 1;

        const { model, nugget, sill, range } = variogramParams;
        const exponent = variogramParams.exponent || 1.5;
        const C0 = sill - nugget;

        const latStep = (bounds.maxLat - bounds.minLat) / resolution;
        const lngStep = (bounds.maxLng - bounds.minLng) / resolution;

        const valueGrid = [];
        const varianceGrid = [];
        const stdDevGrid = [];

        // Stats accumulators
        let vMin = Infinity, vMax = -Infinity, vSum = 0, vSumSq = 0;
        let sigMin = Infinity, sigMax = -Infinity, sigSum = 0;
        let count = 0;

        // Fallback: too few points
        if (points.length < 2) {
            const fillValue = points.length === 1 ? points[0].value : 0;
            for (let i = 0; i < resolution; i++) {
                valueGrid[i] = new Array(resolution).fill(fillValue);
                varianceGrid[i] = new Array(resolution).fill(C0);
                stdDevGrid[i] = new Array(resolution).fill(Math.sqrt(C0));
            }
            return {
                valueGrid, varianceGrid, stdDevGrid,
                bounds, resolution,
                stats: {
                    value: { min: fillValue, max: fillValue, mean: fillValue, variance: 0 },
                    krigingVariance: { min: C0, max: C0, mean: C0 }
                },
                method: 'kriging-uncertainty',
                variogramParams
            };
        }

        for (let i = 0; i < resolution; i++) {
            valueGrid[i] = new Array(resolution);
            varianceGrid[i] = new Array(resolution);
            stdDevGrid[i] = new Array(resolution);

            const cellLat = bounds.minLat + (i + 0.5) * latStep;

            for (let j = 0; j < resolution; j++) {
                const cellLng = bounds.minLng + (j + 0.5) * lngStep;

                // Find nearest neighbours
                const dists = points.map((pt, idx) => ({
                    index: idx,
                    distance: KrigingEngine._haversineDistance(cellLat, cellLng, pt.lat, pt.lng)
                }));
                dists.sort((a, b) => a.distance - b.distance);
                const nearest = dists.slice(0, Math.min(maxPoints, points.length));

                let cellValue, cellVariance;

                if (nearest[0].distance < 0.01) {
                    // Exact hit
                    cellValue = points[nearest[0].index].value;
                    cellVariance = 0;
                } else {
                    const result = KrigingEngine._solveKrigingSystemWithVariance(
                        points, nearest, cellLat, cellLng,
                        model, nugget, sill, range, exponent,
                        anisotropyAngle, anisotropyRatio
                    );

                    if (result) {
                        cellValue = result.value;
                        cellVariance = result.variance;
                    } else {
                        // IDW fallback, maximum uncertainty
                        cellValue = KrigingEngine._idwFallback(points, nearest, cellLat, cellLng);
                        cellVariance = C0;
                    }
                }

                valueGrid[i][j] = cellValue;
                varianceGrid[i][j] = cellVariance;
                stdDevGrid[i][j] = Math.sqrt(cellVariance);

                if (cellValue < vMin) vMin = cellValue;
                if (cellValue > vMax) vMax = cellValue;
                vSum += cellValue;
                vSumSq += cellValue * cellValue;

                if (cellVariance < sigMin) sigMin = cellVariance;
                if (cellVariance > sigMax) sigMax = cellVariance;
                sigSum += cellVariance;

                count++;
            }
        }

        const vMean = vSum / count;
        const vVariance = (vSumSq / count) - (vMean * vMean);
        const sigMean = sigSum / count;

        return {
            valueGrid,
            varianceGrid,
            stdDevGrid,
            bounds,
            resolution,
            stats: {
                value: { min: vMin, max: vMax, mean: vMean, variance: vVariance },
                krigingVariance: { min: sigMin, max: sigMax, mean: sigMean }
            },
            method: 'kriging-uncertainty',
            variogramParams
        };
    }

    // ================================================================
    // S4.2 - Anisotropic Kriging
    // ================================================================

    /**
     * Transform geographic coordinates into an anisotropically-corrected
     * metric space.  The Haversine approximation is applied first to convert
     * lat/lng offsets to metres, then the rotation + scaling is applied.
     *
     * Transformation (geometric anisotropy):
     *   x' =  Δeast·cos(θ) + Δnorth·sin(θ)
     *   y' = (-Δeast·sin(θ) + Δnorth·cos(θ)) / ratio
     *
     * @param {number} lat1  - Reference point latitude
     * @param {number} lng1  - Reference point longitude
     * @param {number} lat2  - Target point latitude
     * @param {number} lng2  - Target point longitude
     * @param {number} angle - Anisotropy major-axis azimuth in RADIANS (measured from North, clockwise)
     * @param {number} ratio - Anisotropy ratio (range_major / range_minor >= 1)
     * @returns {{x:number, y:number}} Transformed coordinates in metres
     */
    static _transformCoordsAnisotropic(lat1, lng1, lat2, lng2, angle, ratio) {
        const toRad = Math.PI / 180;
        const R = 6371000;

        // Approximate metric offsets (valid for small areas)
        const meanLat = (lat1 + lat2) / 2 * toRad;
        const dNorth = (lat2 - lat1) * toRad * R;          // metres northward
        const dEast  = (lng2 - lng1) * toRad * R * Math.cos(meanLat); // metres eastward

        // Rotate so the major axis aligns with x'
        const cosA = Math.cos(angle);
        const sinA = Math.sin(angle);
        const xPrime =  dEast * cosA + dNorth * sinA;
        const yPrime = (-dEast * sinA + dNorth * cosA) / ratio;

        return { x: xPrime, y: yPrime };
    }

    /**
     * Compute the anisotropically-corrected distance between two points.
     *
     * @param {number} lat1
     * @param {number} lng1
     * @param {number} lat2
     * @param {number} lng2
     * @param {number} angle - Anisotropy angle in radians
     * @param {number} ratio - Anisotropy ratio
     * @returns {number} Effective distance in metres
     */
    static _anisotropicDistance(lat1, lng1, lat2, lng2, angle, ratio) {
        if (ratio === 1 && angle === 0) {
            return KrigingEngine._haversineDistance(lat1, lng1, lat2, lng2);
        }
        const { x, y } = KrigingEngine._transformCoordsAnisotropic(lat1, lng1, lat2, lng2, angle, ratio);
        return Math.sqrt(x * x + y * y);
    }

    /**
     * Compute a directional (azimuthal) experimental variogram.
     *
     * Only pairs whose azimuth falls within [directionDeg ± tolerance] are
     * included.  Azimuths are folded to [0°, 180°) so the variogram is
     * always symmetric.
     *
     * @param {Array<{lat,lng,value}>} points
     * @param {number} directionDeg  - Azimuth of the direction to analyse (0-180°)
     * @param {number} tolerance     - Half-width of the angular tolerance in degrees (default 22.5°)
     * @param {Object} [options]
     * @param {number} [options.numLags=12]
     * @param {number} [options.maxLagFraction=0.5]
     * @returns {{lags:number[], semivariance:number[], pairs:number[], maxDistance:number, direction:number}}
     */
    static computeDirectionalVariogram(points, directionDeg, tolerance = 22.5, options = {}) {
        const numLags = options.numLags || 12;
        const maxLagFraction = options.maxLagFraction || 0.5;
        const toRad = Math.PI / 180;
        const R = 6371000;

        const n = points.length;
        if (n < 2) {
            return { lags: [], semivariance: [], pairs: [], maxDistance: 0, direction: directionDeg };
        }

        const pairDistances = [];
        const pairSemivar = [];
        let maxDistance = 0;

        for (let i = 0; i < n; i++) {
            for (let j = i + 1; j < n; j++) {
                const meanLat = (points[i].lat + points[j].lat) / 2 * toRad;
                const dNorth = (points[j].lat - points[i].lat) * toRad * R;
                const dEast  = (points[j].lng - points[i].lng) * toRad * R * Math.cos(meanLat);

                // Azimuth in degrees [0, 360)
                let azimuth = Math.atan2(dEast, dNorth) / toRad;
                if (azimuth < 0) azimuth += 360;

                // Fold to [0, 180) - variograms are symmetric
                if (azimuth >= 180) azimuth -= 180;

                // Check angular tolerance (also handle wrap around 0°/180°)
                let angularDiff = Math.abs(azimuth - directionDeg);
                if (angularDiff > 90) angularDiff = 180 - angularDiff;

                if (angularDiff > tolerance) continue;

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

        if (pairDistances.length === 0) {
            return { lags: [], semivariance: [], pairs: [], maxDistance: 0, direction: directionDeg };
        }

        const maxLag = maxDistance * maxLagFraction;
        const lagWidth = maxLag / numLags;

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

        return { lags, semivariance, pairs, maxDistance, direction: directionDeg };
    }

    /**
     * Detect anisotropy by computing experimental variograms in 4 directions
     * (0°, 45°, 90°, 135°) and fitting a spherical model to each.
     *
     * The direction with the LARGEST fitted range is taken as the major axis.
     * The anisotropy ratio is range_max / range_min.
     *
     * @param {Array<{lat,lng,value}>} points
     * @param {Object} [options]
     * @param {number} [options.tolerance=22.5]   - Angular tolerance per direction (degrees)
     * @param {number} [options.numLags=12]
     * @param {number} [options.maxLagFraction=0.5]
     * @param {string} [options.model='spherical'] - Variogram model to use for fitting
     * @returns {{
     *   angle: number,         - Major-axis azimuth in RADIANS (for use with setAnisotropy)
     *   angleDeg: number,      - Major-axis azimuth in DEGREES
     *   ratio: number,         - range_max / range_min
     *   directions: Array<{direction:number, range:number, nugget:number, sill:number, rmse:number}>
     * }}
     */
    static detectAnisotropy(points, options = {}) {
        const tolerance = options.tolerance || 22.5;
        const model = options.model || 'spherical';
        const numLags = options.numLags || 12;
        const maxLagFraction = options.maxLagFraction || 0.5;

        const directions = [0, 45, 90, 135];
        const dirResults = [];

        for (const dir of directions) {
            const empirical = KrigingEngine.computeDirectionalVariogram(
                points, dir, tolerance, { numLags, maxLagFraction }
            );

            // Need at least 2 populated lags to fit
            const populatedLags = empirical.pairs.filter(p => p > 0).length;
            if (populatedLags < 2) {
                dirResults.push({ direction: dir, range: 0, nugget: 0, sill: 0, rmse: Infinity });
                continue;
            }

            const fit = KrigingEngine.fitVariogramModel(empirical, model);
            dirResults.push({
                direction: dir,
                range: fit.range,
                nugget: fit.nugget,
                sill: fit.sill,
                rmse: fit.rmse
            });
        }

        // Find direction with max and min range (exclude zero-range fits)
        const validResults = dirResults.filter(r => r.range > 0 && isFinite(r.rmse));

        if (validResults.length < 2) {
            // Cannot determine anisotropy - return isotropic defaults
            return {
                angle: 0,
                angleDeg: 0,
                ratio: 1,
                directions: dirResults
            };
        }

        let maxRange = -Infinity, minRange = Infinity;
        let majorDir = 0;

        for (const r of validResults) {
            if (r.range > maxRange) { maxRange = r.range; majorDir = r.direction; }
            if (r.range < minRange) { minRange = r.range; }
        }

        // Prevent division by zero
        const ratio = minRange > 0 ? maxRange / minRange : 1;

        // Convert azimuth (from North, clockwise, degrees) to math angle (radians)
        // The coordinate transform uses angle measured from North
        const angleRad = majorDir * (Math.PI / 180);

        return {
            angle: angleRad,
            angleDeg: majorDir,
            ratio: Math.max(1, ratio),
            directions: dirResults
        };
    }

    /**
     * Set anisotropy parameters on the class-level defaults.
     * These will be used by interpolateKriging when no explicit
     * anisotropy options are supplied.
     *
     * Call with ratio=1 (or no arguments) to restore isotropic behaviour.
     *
     * @param {number} [angle=0]  - Major-axis azimuth in DEGREES (0 = North)
     * @param {number} [ratio=1]  - Anisotropy ratio (>= 1)
     */
    static setAnisotropy(angle = 0, ratio = 1) {
        KrigingEngine._anisotropyAngleDeg = angle;
        KrigingEngine._anisotropyAngleRad = angle * (Math.PI / 180);
        KrigingEngine._anisotropyRatio = Math.max(1, ratio);
    }

    /**
     * Return the currently configured anisotropy parameters.
     *
     * @returns {{angleDeg:number, angleRad:number, ratio:number}}
     */
    static getAnisotropy() {
        return {
            angleDeg: KrigingEngine._anisotropyAngleDeg || 0,
            angleRad: KrigingEngine._anisotropyAngleRad || 0,
            ratio:    KrigingEngine._anisotropyRatio    || 1
        };
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

    // ================================================================
    // S4.3 - Sequential Gaussian Simulation (SGS)
    // ================================================================

    /**
     * Box-Muller transform: generate one standard-normal variate N(0,1).
     * Uses two independent U(0,1) draws; avoids u1 === 0 to prevent log(0).
     * @returns {number}
     */
    static _boxMuller() {
        let u1 = 0;
        while (u1 === 0) u1 = Math.random();
        const u2 = Math.random();
        return Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
    }

    /**
     * Probit function — inverse standard-normal CDF via Rational approximation
     * by Peter Acklam.  Maximum absolute error < 1.15e-9 over (0,1).
     *
     * @param {number} p - Probability in (0,1)
     * @returns {number} Standard-normal quantile
     */
    static _probit(p) {
        if (p <= 0) return -8;
        if (p >= 1) return  8;

        const a = [-3.969683028665376e+01,  2.209460984245205e+02,
                   -2.759285104469687e+02,  1.383577518672690e+02,
                   -3.066479806614716e+01,  2.506628277459239e+00];
        const b = [-5.447609879822406e+01,  1.615858368580409e+02,
                   -1.556989798598866e+02,  6.680131188771972e+01,
                   -1.328068155288572e+01];
        const c = [-7.784894002430293e-03, -3.223964580411365e-01,
                   -2.400758277161838e+00, -2.549732539343734e+00,
                    4.374664141464968e+00,  2.938163982698783e+00];
        const d = [ 7.784695709041462e-03,  3.224671290700398e-01,
                    2.445134137142996e+00,  3.754408661907416e+00];

        const pLow  = 0.02425;
        const pHigh = 1 - pLow;

        let q, r;
        if (p < pLow) {
            q = Math.sqrt(-2 * Math.log(p));
            return (((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) /
                    ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1);
        } else if (p <= pHigh) {
            q = p - 0.5;
            r = q * q;
            return (((((a[0]*r+a[1])*r+a[2])*r+a[3])*r+a[4])*r+a[5])*q /
                   (((((b[0]*r+b[1])*r+b[2])*r+b[3])*r+b[4])*r+1);
        } else {
            q = Math.sqrt(-2 * Math.log(1 - p));
            return -(((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) /
                     ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1);
        }
    }

    /**
     * Normal Score Transform (NST): map raw sample values to standard-normal
     * quantiles using a rank-based (Gaussian anamorphosis) approach.
     *
     * Each value receives the standard-normal quantile that corresponds to its
     * empirical cumulative probability  p = (rank - 0.5) / n  (Blom plotting
     * position), which avoids the +/-infinity singularities at p = 0 and p = 1.
     *
     * @param {number[]} values - Raw sample values (arbitrary distribution)
     * @returns {{
     *   normalScores:   number[], // transformed scores, same order as input
     *   sortedOriginal: number[], // original values sorted ascending
     *   sortedNormal:   number[]  // corresponding normal quantiles ascending
     * }}
     */
    static normalScoreTransform(values) {
        const n = values.length;
        if (n === 0) {
            return { normalScores: [], sortedOriginal: [], sortedNormal: [] };
        }

        // Sort indices by ascending value
        const idx = Array.from({ length: n }, (_, i) => i);
        idx.sort((a, b) => values[a] - values[b]);

        const sortedOriginal = new Array(n);
        const sortedNormal   = new Array(n);

        for (let rank = 0; rank < n; rank++) {
            const p = (rank + 0.5) / n;               // Blom plotting position
            sortedOriginal[rank] = values[idx[rank]];
            sortedNormal[rank]   = KrigingEngine._probit(p);
        }

        // Reverse-map: original array position -> normal score
        const normalScores = new Array(n);
        for (let rank = 0; rank < n; rank++) {
            normalScores[idx[rank]] = sortedNormal[rank];
        }

        return { normalScores, sortedOriginal, sortedNormal };
    }

    /**
     * Back-transform simulated normal-score values to the original distribution
     * by linear interpolation through the empirical CDF table built by
     * normalScoreTransform().
     *
     * Values outside the observed range are clamped to min/max of the original
     * data (conservative tail behaviour - no extrapolation).
     *
     * @param {number[]} normalValues   - Values in normal-score space
     * @param {number[]} sortedOriginal - Original values sorted ascending (from NST)
     * @param {number[]} sortedNormal   - Corresponding normal quantiles ascending (from NST)
     * @returns {number[]} Back-transformed values in original units
     */
    static backTransform(normalValues, sortedOriginal, sortedNormal) {
        const n = sortedNormal.length;
        if (n === 0) return normalValues.map(() => 0);
        if (n === 1) return normalValues.map(() => sortedOriginal[0]);

        return normalValues.map(ns => {
            // Clamp to table bounds
            if (ns <= sortedNormal[0])     return sortedOriginal[0];
            if (ns >= sortedNormal[n - 1]) return sortedOriginal[n - 1];

            // Binary search for the interpolation interval
            let lo = 0;
            let hi = n - 1;
            while (hi - lo > 1) {
                const mid = (lo + hi) >> 1;
                if (sortedNormal[mid] <= ns) lo = mid; else hi = mid;
            }

            const t = (ns - sortedNormal[lo]) / (sortedNormal[hi] - sortedNormal[lo]);
            return sortedOriginal[lo] + t * (sortedOriginal[hi] - sortedOriginal[lo]);
        });
    }

    /**
     * Solve a Simple Kriging (SK) system at a single target location.
     *
     * SK differs from Ordinary Kriging in two ways:
     *   - The stationary mean is assumed known (= 0 in normal-score space).
     *   - There is NO Lagrange multiplier row, so the system is n x n, not (n+1) x (n+1).
     *
     * The covariance formulation is used (C(h) = sill - gamma(h)) so that the
     * kriging variance is directly available as:
     *   sigma^2_SK = C(0) - c0^T * w
     *
     * @param {Array<{lat,lng,value}>} condData  - Conditioning data in NS space
     * @param {Array<{index,distance}>} nearest  - Nearest neighbours (sorted by distance)
     * @param {number} targetLat
     * @param {number} targetLng
     * @param {string} model
     * @param {number} nugget
     * @param {number} sill
     * @param {number} range
     * @param {number} exponent
     * @returns {{estimate:number, variance:number}}
     */
    static _solveSimpleKrigingSystem(condData, nearest, targetLat, targetLng,
                                      model, nugget, sill, range, exponent) {
        const n = nearest.length;

        if (n === 0) {
            // No conditioning data available - sample from the prior N(0, sill)
            return { estimate: 0, variance: sill };
        }

        // Covariance function C(h) = sill - gamma(h)
        const covFn = (h) =>
            sill - KrigingEngine._evaluateModel(model, h, nugget, sill, range, exponent);

        // Build n x n covariance matrix between conditioning points
        const epsilon = 1e-6; // small jitter to prevent singularity
        const C = [];
        for (let i = 0; i < n; i++) {
            C[i] = new Array(n);
            for (let j = 0; j < n; j++) {
                if (i === j) {
                    C[i][j] = covFn(0) + epsilon;  // C(0) = sill + jitter
                } else {
                    const d = KrigingEngine._haversineDistance(
                        condData[nearest[i].index].lat, condData[nearest[i].index].lng,
                        condData[nearest[j].index].lat, condData[nearest[j].index].lng
                    );
                    C[i][j] = covFn(d);
                }
            }
        }

        // Right-hand side: covariance between each conditioning point and the target
        const c0 = new Array(n);
        for (let i = 0; i < n; i++) {
            c0[i] = covFn(nearest[i].distance);
        }

        // Solve C * w = c0
        const weights = KrigingEngine._solveLinearSystem(C, c0.slice());

        if (!weights) {
            return { estimate: 0, variance: sill };   // fallback to prior on singularity
        }

        // Validate: reject non-finite weights
        for (let i = 0; i < n; i++) {
            if (!isFinite(weights[i])) {
                return { estimate: 0, variance: sill };
            }
        }

        // SK estimate: Z*(x0) = sum_i w_i * z_i  (mean = 0 in NS space)
        let estimate = 0;
        for (let i = 0; i < n; i++) {
            estimate += weights[i] * condData[nearest[i].index].value;
        }

        // SK variance: sigma^2_SK = C(0) - c0^T * w  (clamped to >= 0)
        let dot = 0;
        for (let i = 0; i < n; i++) dot += c0[i] * weights[i];
        const variance = Math.max(0, covFn(0) - dot);

        return { estimate, variance };
    }

    /**
     * Sequential Gaussian Simulation (SGS).
     *
     * Produces an ensemble of equally probable realisations that all honour:
     *   - the input conditioning data (sample values at sample locations), and
     *   - the variogram model (spatial continuity structure).
     *
     * Algorithm for each realisation:
     *   1. Normal-score transform all conditioning data to N(0,1) space.
     *   2. Generate a random path visiting every grid node exactly once.
     *   3. At each node, perform Simple Kriging using the original samples
     *      PLUS all nodes already simulated in this pass.
     *   4. Draw a simulated value from N(SK estimate, SK variance).
     *   5. Add the drawn value to the conditioning set and advance.
     *   6. Back-transform the completed realisation to original units.
     *
     * @param {Array<{lat:number,lng:number,value:number}>} points - Sample data
     * @param {{minLat:number,maxLat:number,minLng:number,maxLng:number}} bounds - Grid extent
     * @param {{model:string,nugget:number,sill:number,range:number,exponent?:number}} variogramParams
     * @param {Object} [options]
     * @param {number} [options.resolution=40]    - Grid cells per side
     * @param {number} [options.nSimulations=50]  - Number of realisations to generate
     * @param {number} [options.maxCondPoints=20] - Max neighbours used for SK at each node
     * @returns {{
     *   simulations: number[][][],
     *   bounds: Object,
     *   resolution: number,
     *   nSimulations: number,
     *   method: string,
     *   variogramParams: Object,
     *   nstInfo: {sortedOriginal: number[], sortedNormal: number[]}
     * }}
     */
    static simulateSGS(points, bounds, variogramParams, options = {}) {
        const resolution    = options.resolution    || 40;
        const nSimulations  = options.nSimulations  || 50;
        const maxCondPoints = options.maxCondPoints || 20;

        const { model, nugget, sill, range } = variogramParams;
        const exponent = variogramParams.exponent || 1.5;

        // ------------------------------------------------------------------
        // 1. Normal-score transform conditioning data
        // ------------------------------------------------------------------
        const rawValues = points.map(p => p.value);
        const { normalScores, sortedOriginal, sortedNormal } =
            KrigingEngine.normalScoreTransform(rawValues);

        const condDataNS = points.map((p, i) => ({
            lat:   p.lat,
            lng:   p.lng,
            value: normalScores[i]
        }));

        // ------------------------------------------------------------------
        // 2. Pre-compute grid cell centre coordinates (lat/lng)
        // ------------------------------------------------------------------
        const latStep = (bounds.maxLat - bounds.minLat) / resolution;
        const lngStep = (bounds.maxLng - bounds.minLng) / resolution;
        const nCells  = resolution * resolution;

        const cellLats = new Float64Array(nCells);
        const cellLngs = new Float64Array(nCells);

        for (let i = 0; i < resolution; i++) {
            for (let j = 0; j < resolution; j++) {
                const k = i * resolution + j;
                cellLats[k] = bounds.minLat + (i + 0.5) * latStep;
                cellLngs[k] = bounds.minLng + (j + 0.5) * lngStep;
            }
        }

        // ------------------------------------------------------------------
        // 3. Run nSimulations realisations
        // ------------------------------------------------------------------
        const simulations = [];

        for (let sim = 0; sim < nSimulations; sim++) {

            // 3a. Fisher-Yates random path through all grid nodes
            const path = Array.from({ length: nCells }, (_, k) => k);
            for (let k = nCells - 1; k > 0; k--) {
                const r = Math.floor(Math.random() * (k + 1));
                const tmp = path[k]; path[k] = path[r]; path[r] = tmp;
            }

            // Working conditioning set: starts as the original samples in NS
            // space; simulated nodes are appended during the walk.
            const workingCond = condDataNS.map(p => ({ lat: p.lat, lng: p.lng, value: p.value }));

            // Flat array of NS values for this realisation
            const simGridNS = new Float64Array(nCells);

            // 3b. Walk the random path
            for (let step = 0; step < nCells; step++) {
                const cellIdx = path[step];
                const cellLat = cellLats[cellIdx];
                const cellLng = cellLngs[cellIdx];

                const nCond = workingCond.length;

                // Compute distances from this node to all current conditioning points
                const dists = [];
                for (let p = 0; p < nCond; p++) {
                    const d = KrigingEngine._haversineDistance(
                        cellLat, cellLng,
                        workingCond[p].lat, workingCond[p].lng
                    );
                    dists.push({ index: p, distance: d });
                }
                dists.sort((a, b) => a.distance - b.distance);
                const nearest = dists.slice(0, Math.min(maxCondPoints, nCond));

                // 3c. Check for a coincident conditioning point (d ~= 0)
                if (nearest.length > 0 && nearest[0].distance < 0.01) {
                    simGridNS[cellIdx] = workingCond[nearest[0].index].value;
                } else {
                    // 3c. Simple kriging: estimate + kriging variance
                    const { estimate, variance } = KrigingEngine._solveSimpleKrigingSystem(
                        workingCond, nearest, cellLat, cellLng,
                        model, nugget, sill, range, exponent
                    );

                    // 3d. Draw from N(estimate, variance) using Box-Muller
                    const stddev = Math.sqrt(variance);
                    simGridNS[cellIdx] = estimate + stddev * KrigingEngine._boxMuller();
                }

                // 3e. Add simulated node to the conditioning set
                workingCond.push({ lat: cellLat, lng: cellLng, value: simGridNS[cellIdx] });
            }

            // Back-transform this realisation from NS space to original units
            const nsArr   = Array.from(simGridNS);
            const origArr = KrigingEngine.backTransform(nsArr, sortedOriginal, sortedNormal);

            // Reshape flat array to 2-D grid [row][col]
            const grid2D = [];
            for (let i = 0; i < resolution; i++) {
                grid2D[i] = origArr.slice(i * resolution, (i + 1) * resolution);
            }

            simulations.push(grid2D);
        }

        return {
            simulations,
            bounds,
            resolution,
            nSimulations,
            method: 'sgs',
            variogramParams,
            nstInfo: { sortedOriginal, sortedNormal }
        };
    }

    /**
     * E-type estimate: arithmetic mean of all simulations at each grid node.
     *
     * The E-type map is the expected value of the simulated random function.
     * Unlike a single kriged map it preserves short-range variability that
     * would otherwise be smoothed out by the kriging interpolator.
     *
     * @param {number[][][]} simulations - Output array from simulateSGS()
     * @returns {{grid: number[][], stats: Object}}
     */
    static eType(simulations) {
        if (!simulations || simulations.length === 0) {
            return { grid: [], stats: {} };
        }

        const nSim = simulations.length;
        const rows = simulations[0].length;
        const cols = rows > 0 ? simulations[0][0].length : 0;

        let min = Infinity, max = -Infinity, sum = 0, sumSq = 0;
        const count = rows * cols;

        const grid = [];
        for (let i = 0; i < rows; i++) {
            grid[i] = new Array(cols);
            for (let j = 0; j < cols; j++) {
                let cellSum = 0;
                for (let s = 0; s < nSim; s++) cellSum += simulations[s][i][j];
                const mean = cellSum / nSim;
                grid[i][j] = mean;

                if (mean < min) min = mean;
                if (mean > max) max = mean;
                sum   += mean;
                sumSq += mean * mean;
            }
        }

        const mean     = count > 0 ? sum / count : 0;
        const variance = count > 0 ? (sumSq / count) - (mean * mean) : 0;

        return {
            grid,
            stats: { min, max, mean, variance, nSimulations: nSim }
        };
    }

    /**
     * Probability map: P(Z > threshold) at each grid node.
     *
     * Each cell value is the proportion of simulations that exceed the given
     * threshold, giving an exceedance probability map directly usable for
     * precision-agriculture decision rules (e.g. "apply fertiliser where
     * P(N > 50 kg/ha) > 0.7").
     *
     * @param {number[][][]} simulations - Output array from simulateSGS()
     * @param {number} threshold         - Exceedance threshold in original units
     * @returns {{grid: number[][], threshold: number, stats: Object}}
     *   Each grid cell is in [0,1]: fraction of realisations exceeding threshold.
     */
    static probabilityMap(simulations, threshold) {
        if (!simulations || simulations.length === 0) {
            return { grid: [], threshold, stats: {} };
        }

        const nSim = simulations.length;
        const rows = simulations[0].length;
        const cols = rows > 0 ? simulations[0][0].length : 0;

        let minP = Infinity, maxP = -Infinity, sumP = 0;
        const count = rows * cols;

        const grid = [];
        for (let i = 0; i < rows; i++) {
            grid[i] = new Array(cols);
            for (let j = 0; j < cols; j++) {
                let exceed = 0;
                for (let s = 0; s < nSim; s++) {
                    if (simulations[s][i][j] > threshold) exceed++;
                }
                const prob = exceed / nSim;
                grid[i][j] = prob;

                if (prob < minP) minP = prob;
                if (prob > maxP) maxP = prob;
                sumP += prob;
            }
        }

        const meanP = count > 0 ? sumP / count : 0;

        return {
            grid,
            threshold,
            stats: {
                minProbability:  minP  === Infinity  ? 0 : minP,
                maxProbability:  maxP  === -Infinity ? 0 : maxP,
                meanProbability: meanP,
                nSimulations:    nSim
            }
        };
    }

    /**
     * Confidence interval: lower and upper quantile bounds at each grid node.
     *
     * For alpha = 0.10 (default) returns the 5th and 95th percentile of the
     * simulation ensemble, forming a 90% prediction interval at every node.
     * The median (50th percentile) is also returned.
     *
     * @param {number[][][]} simulations - Output array from simulateSGS()
     * @param {number} [alpha=0.10]      - Significance level (two-tailed)
     * @returns {{
     *   lowerGrid:  number[][],
     *   upperGrid:  number[][],
     *   medianGrid: number[][],
     *   alpha: number,
     *   stats: Object
     * }}
     */
    static confidenceInterval(simulations, alpha = 0.10) {
        if (!simulations || simulations.length === 0) {
            return { lowerGrid: [], upperGrid: [], medianGrid: [], alpha, stats: {} };
        }

        const nSim = simulations.length;
        const rows = simulations[0].length;
        const cols = rows > 0 ? simulations[0][0].length : 0;

        const qLo  = alpha / 2;      // e.g. 0.05
        const qHi  = 1 - alpha / 2;  // e.g. 0.95
        const qMed = 0.5;

        const lowerGrid  = [];
        const upperGrid  = [];
        const medianGrid = [];

        let sumWidth = 0;
        const count = rows * cols;

        for (let i = 0; i < rows; i++) {
            lowerGrid[i]  = new Array(cols);
            upperGrid[i]  = new Array(cols);
            medianGrid[i] = new Array(cols);

            for (let j = 0; j < cols; j++) {
                // Collect values from all realisations at this node, then sort
                const vals = new Array(nSim);
                for (let s = 0; s < nSim; s++) vals[s] = simulations[s][i][j];
                vals.sort((a, b) => a - b);

                lowerGrid[i][j]  = KrigingEngine._quantileFromSorted(vals, qLo);
                upperGrid[i][j]  = KrigingEngine._quantileFromSorted(vals, qHi);
                medianGrid[i][j] = KrigingEngine._quantileFromSorted(vals, qMed);

                sumWidth += upperGrid[i][j] - lowerGrid[i][j];
            }
        }

        const meanWidth = count > 0 ? sumWidth / count : 0;

        return {
            lowerGrid,
            upperGrid,
            medianGrid,
            alpha,
            stats: {
                meanIntervalWidth: meanWidth,
                lowerQuantile:     qLo,
                upperQuantile:     qHi,
                nSimulations:      nSim
            }
        };
    }

    /**
     * Compute a quantile value from a sorted (ascending) array using linear
     * interpolation between adjacent ranks.
     *
     * @param {number[]} sortedVals - Values sorted in ascending order
     * @param {number}   q          - Target quantile in [0,1]
     * @returns {number}
     */
    static _quantileFromSorted(sortedVals, q) {
        const n = sortedVals.length;
        if (n === 0) return 0;
        if (n === 1) return sortedVals[0];

        const pos = q * (n - 1);
        const lo  = Math.floor(pos);
        const hi  = Math.ceil(pos);

        if (lo === hi) return sortedVals[lo];

        const t = pos - lo;
        return sortedVals[lo] * (1 - t) + sortedVals[hi] * t;
    }
}

// Make class globally accessible
window.KrigingEngine = KrigingEngine;
