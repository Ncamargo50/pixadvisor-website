/**
 * ZonesEngine - Professional Management Zones Engine for Precision Agriculture
 *
 * Primary methodology: Satellite imagery + topography (Score Compuesto Ponderado)
 * Fallback: K-Means clustering on soil data layers
 *
 * Provides:
 * - Satellite-based zone generation (NDVI/NDRE/EVI + DEM derivatives)
 * - Synthetic satellite data simulation for demo/testing
 * - K-Means clustering (Lloyd's algorithm with k-means++ init)
 * - Multi-variable zone delineation with crop-specific index profiles
 * - Temporal stability analysis, TWI, D8 flow direction/accumulation
 * - Water flow lines, zone statistics, GeoJSON/CSV export, Leaflet rendering
 * - Morphological smoothing (majority filter + close operation + area filter)
 * - Gaussian blur for DataFarm-quality rendering
 *
 * Designed to work alongside InterpolationEngine (IDW), KrigingEngine,
 * and CROPS_DB within the PIX Admin platform.
 */
class ZonesEngine {

  // ==================== CROP-SPECIFIC INDEX PROFILES ====================

  /**
   * Recommended vegetation indices per phenological stage for each crop.
   * Used by generateManagementZones when variables = 'auto'.
   * @type {Object.<string, Object.<string, string[]>>}
   */
  static CROP_PROFILES = {
    cana: {
      vegetativo: ['NDVI', 'EVI'],
      macollaje: ['EVI', 'GNDVI'],
      elongacion: ['NDVI', 'NDRE'],
      maduracion: ['NDRE', 'SAVI']
    },
    soja: {
      emergencia: ['SAVI', 'MSAVI'],
      vegetativo: ['NDVI', 'EVI'],
      R3_R4: ['NDRE', 'NDVI'],
      R5_R6: ['NDVI', 'NDRE']
    },
    maiz: {
      emergencia: ['SAVI'],
      V6_V8: ['NDVI', 'NDRE'],
      V12_VT: ['EVI', 'NDVI'],
      llenado: ['NDRE']
    },
    sorgo: {
      vegetativo: ['NDVI', 'EVI'],
      panoja: ['NDRE'],
      llenado: ['NDVI']
    },
    girasol: {
      vegetativo: ['NDVI'],
      R1_R4: ['NDRE', 'EVI'],
      llenado: ['NDVI']
    },
    tomate: {
      transplante: ['SAVI'],
      vegetativo: ['NDVI', 'EVI'],
      fructificacion: ['NDRE']
    },
    papa: {
      emergencia: ['SAVI'],
      vegetativo: ['NDVI', 'EVI'],
      tuberizacion: ['NDRE']
    }
  };

  // ==================== SCORE COMPUESTO WEIGHTS ====================

  /**
   * Default layer weights for the Score Compuesto Ponderado methodology.
   * All weights must sum to 1.0.
   */
  static COMPOSITE_WEIGHTS = {
    ndvi_median:    0.25,  // Long-term vigor
    ndre_median:    0.15,  // Chlorophyll / nitrogen status
    ndvi_stability: 0.15,  // Temporal consistency (1 - normalized std dev)
    twi:            0.10,  // Topographic Wetness Index (moisture)
    flow_inv:       0.10,  // Inverse flow accumulation (drainage)
    slope_inv:      0.10,  // Inverse slope (tillage ease)
    rel_elevation:  0.05,  // Relative elevation within field
    drain_distance: 0.10   // Distance to nearest drainage line
  };

  /**
   * Zone class labels by number of zones.
   */
  static ZONE_LABELS = {
    2: ['Baja', 'Alta'],
    3: ['Baja', 'Media', 'Alta'],
    4: ['Baja', 'Media-Baja', 'Media-Alta', 'Alta'],
    5: ['Baja', 'Media-Baja', 'Media', 'Media-Alta', 'Alta'],
    6: ['Muy Baja', 'Baja', 'Media-Baja', 'Media-Alta', 'Alta', 'Muy Alta'],
    7: ['Muy Baja', 'Baja', 'Media-Baja', 'Media', 'Media-Alta', 'Alta', 'Muy Alta']
  };

  // ==================== PRIMARY PIPELINE: SATELLITE + TOPOGRAPHY ====================

  /**
   * Generate management zones from satellite imagery and topography data.
   * This is the primary (recommended) pipeline using the Score Compuesto Ponderado.
   *
   * @param {Object} config - Configuration object
   * @param {Object} config.satelliteData - Satellite index grids from GEE or simulateSatelliteData()
   * @param {number[][][]} config.satelliteData.ndviCampaigns - NDVI grids per campaign/year
   * @param {number[][][]} config.satelliteData.ndreCampaigns - NDRE grids per campaign/year
   * @param {number[][][]} config.satelliteData.eviCampaigns  - EVI grids per campaign/year
   * @param {number[][]}   config.satelliteData.dem           - DEM grid (elevation in meters)
   * @param {number}       config.satelliteData.cellSize      - Cell size in meters
   * @param {{ minLat: number, maxLat: number, minLng: number, maxLng: number }} config.bounds
   * @param {Array<[number,number]>} config.boundary - Polygon boundary [[lat,lng], ...]
   * @param {number} config.areaHa - Field area in hectares
   * @param {number} [config.numZones] - Override auto zone count
   * @param {Object} [config.weights] - Override COMPOSITE_WEIGHTS
   * @param {number} [config.minZoneAreaHa=0.5] - Minimum zone area to keep (filter slivers)
   * @returns {{
   *   zoneGrid: number[][],
   *   scoreGrid: number[][],
   *   stats: Array<Object>,
   *   numZones: number,
   *   geojson: Object,
   *   csv: string,
   *   derivedLayers: Object,
   *   metadata: Object
   * }}
   */
  static generateFromSatellite(config) {
    const {
      satelliteData,
      bounds,
      boundary,
      areaHa,
      weights: customWeights = null,
      minZoneAreaHa = 0.5
    } = config;

    const w = customWeights || this.COMPOSITE_WEIGHTS;

    // --- Determine zone count ---
    // User can set numZones directly (2-7) or let it auto-calculate from area
    let numZones = config.numZones;
    if (!numZones) {
      numZones = this._zoneCountByArea(areaHa);
    }
    numZones = Math.max(2, Math.min(numZones, 7));

    const { ndviCampaigns, ndreCampaigns, eviCampaigns, dem, cellSize } = satelliteData;
    const rows = dem.length;
    const cols = dem[0].length;

    console.log(`ZonesEngine: generateFromSatellite — ${rows}x${cols} grid, ${areaHa.toFixed(1)} ha, ${numZones} zones`);

    // --- Step 1: Compute multitemporal medians ---
    const ndviMedian = this._pixelMedian(ndviCampaigns);
    const ndreMedian = this._pixelMedian(ndreCampaigns);
    const eviMedian  = this._pixelMedian(eviCampaigns);

    // --- Step 2: NDVI temporal stability (1 - normalized std dev) ---
    const ndviStability = this._pixelStability(ndviCampaigns);

    // --- Step 3: DEM-derived layers ---
    const slopeGrid = this._calculateSlope(dem, cellSize);
    const flowDirGrid = this.flowDirectionD8(dem);
    const flowAccGrid = this.flowAccumulation(flowDirGrid);
    const twiResult = this.calculateTWI(dem, cellSize);
    const twiGrid = twiResult.twiGrid;

    // Relative elevation (0-1 within field)
    const relElevation = this._normalizeGrid(dem);

    // Inverse flow accumulation (high flow = low score for drainage)
    const flowInv = this._invertAndNormalize(flowAccGrid);

    // Inverse slope (flat = high score for tillage)
    const slopeInv = this._invertAndNormalize(slopeGrid);

    // Drain distance: distance from each pixel to nearest high-accumulation cell
    const drainThreshold = this._percentileValue(flowAccGrid, 90);
    const drainDist = this._distanceToHighAccum(flowAccGrid, drainThreshold);
    const drainDistNorm = this._normalizeGrid(drainDist);
    // Invert: closer to drain = better drainage = higher score
    const drainDistInv = this._invertNormalized(drainDistNorm);

    // --- Step 4: Normalize all layers to 0-1 ---
    const ndviNorm     = this._normalizeGrid(ndviMedian);
    const ndreNorm     = this._normalizeGrid(ndreMedian);
    const ndviStabNorm = this._normalizeGrid(ndviStability);
    const twiNorm      = this._normalizeGrid(twiGrid);

    // --- Step 5: Compute Score Compuesto Ponderado ---
    const scoreGrid = Array.from({ length: rows }, () => new Float64Array(cols));

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        scoreGrid[r][c] =
          w.ndvi_median    * ndviNorm[r][c] +
          w.ndre_median    * ndreNorm[r][c] +
          w.ndvi_stability * ndviStabNorm[r][c] +
          w.twi            * twiNorm[r][c] +
          w.flow_inv       * flowInv[r][c] +
          w.slope_inv      * slopeInv[r][c] +
          w.rel_elevation  * relElevation[r][c] +
          w.drain_distance * drainDistInv[r][c];
      }
    }

    // --- Step 6: Classify zones ---
    // Two methods (DataFarm methodology):
    //   usePercentiles=true  (default): equal-area zones via percentile cuts
    //   usePercentiles=false: equal-interval zones via direct value thresholds
    const usePercentiles = config.usePercentiles !== false; // default true

    const flatScores = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        flatScores.push(scoreGrid[r][c]);
      }
    }
    flatScores.sort((a, b) => a - b);

    let cuts;
    if (usePercentiles) {
      cuts = this._percentileCuts(flatScores, numZones);
    } else {
      // Direct classification: equal-interval breaks based on value range
      cuts = this._equalIntervalCuts(flatScores, numZones);
    }

    const zoneGrid = Array.from({ length: rows }, () => new Array(cols).fill(0));
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const val = scoreGrid[r][c];
        let zone = 0;
        for (let z = 0; z < cuts.length; z++) {
          if (val > cuts[z]) zone = z + 1;
        }
        zoneGrid[r][c] = zone;
      }
    }

    // --- Step 7: Smooth zones (improved morphological approach) ---
    let smoothed = this._smoothZoneGrid(zoneGrid, 5, 7);

    // Morphological close (dilate then erode) to fill small gaps
    smoothed = this._morphologicalClose(smoothed, numZones);

    // Area filter: merge zones smaller than minZoneAreaHa into largest neighbor
    const pixelAreaHa = areaHa / (rows * cols);
    smoothed = this._areaFilterZones(smoothed, numZones, minZoneAreaHa, pixelAreaHa);

    // --- Step 8: Compute zone statistics ---
    const labels = this.ZONE_LABELS[numZones] || this.ZONE_LABELS[4];
    const zoneStats = this._computeSatelliteZoneStats(
      smoothed, numZones, labels, areaHa,
      ndviMedian, ndreMedian, twiGrid, dem, slopeGrid, scoreGrid
    );

    // --- Step 9: Generate exports ---
    const geojson = this.zonesToGeoJSON(smoothed, bounds, numZones, zoneStats);
    // Enrich GeoJSON features with satellite attributes
    for (const feat of geojson.features) {
      const z = feat.properties.zone - 1;
      if (zoneStats[z]) {
        feat.properties.zona = zoneStats[z].zona;
        feat.properties.clase = zoneStats[z].clase;
        feat.properties.area_ha = zoneStats[z].area_ha;
        feat.properties.porcentaje = zoneStats[z].porcentaje;
        feat.properties.ndvi_prom = zoneStats[z].ndvi_prom;
        feat.properties.ndre_prom = zoneStats[z].ndre_prom;
        feat.properties.twi_prom = zoneStats[z].twi_prom;
        feat.properties.elevacion_prom = zoneStats[z].elevacion_prom;
        feat.properties.pendiente_prom = zoneStats[z].pendiente_prom;
        feat.properties.score_prom = zoneStats[z].score_prom;
      }
    }

    const csv = this._satelliteStatsToCSV(zoneStats);

    return {
      zoneGrid: smoothed,
      scoreGrid,
      stats: zoneStats,
      numZones,
      geojson,
      csv,
      derivedLayers: {
        ndviMedian, ndreMedian, eviMedian,
        ndviStability,
        slopeGrid, flowAccGrid, twiGrid,
        relElevation, flowInv, slopeInv, drainDistInv,
        flowDirGrid
      },
      metadata: {
        method: 'satellite_composite',
        areaHa,
        numZones,
        weights: { ...w },
        gridSize: [rows, cols],
        cellSizeM: cellSize,
        campaignCount: ndviCampaigns.length,
        timestamp: new Date().toISOString()
      }
    };
  }

  // ==================== ZONE COUNT BY AREA ====================

  /**
   * Determine number of management zones based on field area.
   * @param {number} areaHa - Field area in hectares
   * @returns {number} Recommended zone count
   */
  static _zoneCountByArea(areaHa) {
    if (areaHa < 10) return 2;
    if (areaHa < 30) return 3;
    if (areaHa < 100) return 4;
    return 5;
  }

  // ==================== PIXEL-LEVEL TEMPORAL OPERATIONS ====================

  /**
   * Compute pixel-wise median across multiple campaign grids.
   * @param {number[][][]} campaignGrids - Array of 2D grids
   * @returns {number[][]} Median grid
   */
  static _pixelMedian(campaignGrids) {
    const n = campaignGrids.length;
    const rows = campaignGrids[0].length;
    const cols = campaignGrids[0][0].length;
    const result = Array.from({ length: rows }, () => new Float64Array(cols));

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const vals = [];
        for (let t = 0; t < n; t++) {
          vals.push(campaignGrids[t][r][c]);
        }
        vals.sort((a, b) => a - b);
        if (n % 2 === 1) {
          result[r][c] = vals[Math.floor(n / 2)];
        } else {
          result[r][c] = (vals[n / 2 - 1] + vals[n / 2]) / 2;
        }
      }
    }
    return result;
  }

  /**
   * Compute pixel-wise temporal stability: 1 - normalized_std_dev.
   * Higher values = more temporally stable pixels.
   * @param {number[][][]} campaignGrids - Array of 2D grids
   * @returns {number[][]} Stability grid (0-1)
   */
  static _pixelStability(campaignGrids) {
    const n = campaignGrids.length;
    const rows = campaignGrids[0].length;
    const cols = campaignGrids[0][0].length;
    const stdGrid = Array.from({ length: rows }, () => new Float64Array(cols));

    let maxStd = 0;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        let sum = 0;
        for (let t = 0; t < n; t++) sum += campaignGrids[t][r][c];
        const mean = sum / n;
        let sumSq = 0;
        for (let t = 0; t < n; t++) {
          const d = campaignGrids[t][r][c] - mean;
          sumSq += d * d;
        }
        const std = Math.sqrt(sumSq / n);
        stdGrid[r][c] = std;
        if (std > maxStd) maxStd = std;
      }
    }

    // Normalize and invert: stability = 1 - (std / maxStd)
    const result = Array.from({ length: rows }, () => new Float64Array(cols));
    const denom = maxStd > 0 ? maxStd : 1;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        result[r][c] = 1 - (stdGrid[r][c] / denom);
      }
    }
    return result;
  }

  // ==================== GRID NORMALIZATION UTILITIES ====================

  /**
   * Normalize a 2D grid to 0-1 range (min-max scaling).
   * @param {number[][]} grid
   * @returns {number[][]}
   */
  static _normalizeGrid(grid) {
    const rows = grid.length;
    const cols = grid[0].length;
    let min = Infinity, max = -Infinity;

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const v = grid[r][c];
        if (v < min) min = v;
        if (v > max) max = v;
      }
    }

    const range = max - min || 1;
    const result = Array.from({ length: rows }, () => new Float64Array(cols));
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        result[r][c] = (grid[r][c] - min) / range;
      }
    }
    return result;
  }

  /**
   * Invert and normalize a grid: higher original values get lower scores.
   * @param {number[][]} grid
   * @returns {number[][]}
   */
  static _invertAndNormalize(grid) {
    const norm = this._normalizeGrid(grid);
    const rows = norm.length;
    const cols = norm[0].length;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        norm[r][c] = 1 - norm[r][c];
      }
    }
    return norm;
  }

  /**
   * Invert an already normalized (0-1) grid.
   * @param {number[][]} grid
   * @returns {number[][]}
   */
  static _invertNormalized(grid) {
    const rows = grid.length;
    const cols = grid[0].length;
    const result = Array.from({ length: rows }, () => new Float64Array(cols));
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        result[r][c] = 1 - grid[r][c];
      }
    }
    return result;
  }

  // ==================== PERCENTILE UTILITIES ====================

  /**
   * Compute percentile cuts for zone classification.
   * For N zones, returns N-1 cut points at equally spaced percentiles.
   * @param {number[]} sortedValues - Pre-sorted array of values
   * @param {number} numZones
   * @returns {number[]} Cut point values
   */
  static _percentileCuts(sortedValues, numZones) {
    const n = sortedValues.length;
    const cuts = [];
    for (let z = 1; z < numZones; z++) {
      const p = z / numZones; // e.g. for 4 zones: 0.25, 0.50, 0.75
      const idx = Math.max(0, Math.min(Math.floor(p * n), n - 1));
      cuts.push(sortedValues[idx]);
    }
    return cuts;
  }

  /**
   * Compute equal-interval cuts for direct zone classification (DataFarm method).
   * Divides value range into equal-width intervals instead of equal-area percentiles.
   * @param {number[]} sortedValues - Pre-sorted array of values
   * @param {number} numZones
   * @returns {number[]} Cut point values
   */
  static _equalIntervalCuts(sortedValues, numZones) {
    if (sortedValues.length === 0) return [];
    const minVal = sortedValues[0];
    const maxVal = sortedValues[sortedValues.length - 1];
    const range = maxVal - minVal;
    if (range <= 0) return new Array(numZones - 1).fill(minVal);

    const cuts = [];
    for (let z = 1; z < numZones; z++) {
      cuts.push(minVal + (z / numZones) * range);
    }
    return cuts;
  }

  /**
   * Get the value at a given percentile from a 2D grid.
   * @param {number[][]} grid
   * @param {number} percentile - 0 to 100
   * @returns {number}
   */
  static _percentileValue(grid, percentile) {
    const flat = [];
    for (let r = 0; r < grid.length; r++) {
      for (let c = 0; c < grid[0].length; c++) {
        flat.push(grid[r][c]);
      }
    }
    flat.sort((a, b) => a - b);
    const idx = Math.max(0, Math.min(Math.floor(percentile / 100 * flat.length), flat.length - 1));
    return flat[idx];
  }

  // ==================== DISTANCE TO DRAINAGE ====================

  /**
   * Compute Euclidean distance from each pixel to the nearest high-accumulation cell.
   * Uses a BFS (breadth-first search) from all drainage cells simultaneously.
   * @param {number[][]} flowAccGrid
   * @param {number} threshold - Accumulation threshold for drainage cells
   * @returns {number[][]} Distance grid (in pixel units)
   */
  static _distanceToHighAccum(flowAccGrid, threshold) {
    const rows = flowAccGrid.length;
    const cols = flowAccGrid[0].length;
    const dist = Array.from({ length: rows }, () => new Float64Array(cols).fill(Infinity));
    const queue = [];

    // Initialize: drainage cells have distance 0
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (flowAccGrid[r][c] >= threshold) {
          dist[r][c] = 0;
          queue.push([r, c]);
        }
      }
    }

    // BFS wavefront expansion
    const dr = [-1, -1, -1, 0, 0, 1, 1, 1];
    const dc = [-1, 0, 1, -1, 1, -1, 0, 1];
    const dd = [Math.SQRT2, 1, Math.SQRT2, 1, 1, Math.SQRT2, 1, Math.SQRT2];

    let head = 0;
    while (head < queue.length) {
      const [cr, cc] = queue[head++];
      const curDist = dist[cr][cc];

      for (let d = 0; d < 8; d++) {
        const nr = cr + dr[d];
        const nc = cc + dc[d];
        if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;

        const newDist = curDist + dd[d];
        if (newDist < dist[nr][nc]) {
          dist[nr][nc] = newDist;
          queue.push([nr, nc]);
        }
      }
    }

    return dist;
  }

  // ==================== MORPHOLOGICAL OPERATIONS ====================

  /**
   * Morphological close operation (dilate then erode) on a zone grid.
   * Fills small gaps and holes within zones.
   * @param {number[][]} grid - Zone grid
   * @param {number} numZones
   * @returns {number[][]}
   */
  static _morphologicalClose(grid, numZones) {
    const rows = grid.length;
    const cols = grid[0].length;
    const kernelR = 1; // 3x3 kernel

    // Dilate: each pixel takes the zone that is most common in its neighborhood,
    // biased toward the current pixel's zone value
    let dilated = grid.map(row => [...row]);
    for (let r = kernelR; r < rows - kernelR; r++) {
      for (let c = kernelR; c < cols - kernelR; c++) {
        const freq = new Array(numZones).fill(0);
        for (let dr = -kernelR; dr <= kernelR; dr++) {
          for (let dc = -kernelR; dc <= kernelR; dc++) {
            freq[grid[r + dr][c + dc]]++;
          }
        }
        // Bias: give current zone a boost
        freq[grid[r][c]] += 2;
        let bestZ = grid[r][c], bestCount = 0;
        for (let z = 0; z < numZones; z++) {
          if (freq[z] > bestCount) { bestCount = freq[z]; bestZ = z; }
        }
        dilated[r][c] = bestZ;
      }
    }

    // Erode: same operation on the dilated result
    const eroded = dilated.map(row => [...row]);
    for (let r = kernelR; r < rows - kernelR; r++) {
      for (let c = kernelR; c < cols - kernelR; c++) {
        const freq = new Array(numZones).fill(0);
        for (let dr = -kernelR; dr <= kernelR; dr++) {
          for (let dc = -kernelR; dc <= kernelR; dc++) {
            freq[dilated[r + dr][c + dc]]++;
          }
        }
        freq[dilated[r][c]] += 2;
        let bestZ = dilated[r][c], bestCount = 0;
        for (let z = 0; z < numZones; z++) {
          if (freq[z] > bestCount) { bestCount = freq[z]; bestZ = z; }
        }
        eroded[r][c] = bestZ;
      }
    }

    return eroded;
  }

  /**
   * Filter out zones smaller than a minimum area by merging them into
   * their largest neighboring zone.
   * @param {number[][]} grid - Zone grid
   * @param {number} numZones
   * @param {number} minAreaHa - Minimum area in hectares
   * @param {number} pixelAreaHa - Area per pixel in hectares
   * @returns {number[][]}
   */
  static _areaFilterZones(grid, numZones, minAreaHa, pixelAreaHa) {
    const rows = grid.length;
    const cols = grid[0].length;
    const minPixels = Math.ceil(minAreaHa / pixelAreaHa);
    let result = grid.map(row => [...row]);

    // Connected component labeling for each zone to find small patches
    const visited = Array.from({ length: rows }, () => new Array(cols).fill(false));
    const dr = [-1, 0, 1, 0];
    const dc = [0, 1, 0, -1];

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (visited[r][c]) continue;
        visited[r][c] = true;

        const zone = result[r][c];
        // BFS to find connected component
        const component = [[r, c]];
        const neighborZoneCounts = {};
        let head = 0;

        while (head < component.length) {
          const [cr, cc] = component[head++];
          for (let d = 0; d < 4; d++) {
            const nr = cr + dr[d];
            const nc = cc + dc[d];
            if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
            if (result[nr][nc] === zone && !visited[nr][nc]) {
              visited[nr][nc] = true;
              component.push([nr, nc]);
            } else if (result[nr][nc] !== zone) {
              const nz = result[nr][nc];
              neighborZoneCounts[nz] = (neighborZoneCounts[nz] || 0) + 1;
            }
          }
        }

        // If component is too small, merge into largest neighbor
        if (component.length < minPixels && Object.keys(neighborZoneCounts).length > 0) {
          let bestNeighbor = zone;
          let bestCount = 0;
          for (const [nz, count] of Object.entries(neighborZoneCounts)) {
            if (count > bestCount) {
              bestCount = count;
              bestNeighbor = Number(nz);
            }
          }
          for (const [pr, pc] of component) {
            result[pr][pc] = bestNeighbor;
          }
        }
      }
    }

    return result;
  }

  // ==================== SATELLITE ZONE STATISTICS ====================

  /**
   * Compute zone statistics with satellite-specific attributes.
   * @param {number[][]} zoneGrid
   * @param {number} numZones
   * @param {string[]} labels - Zone class labels
   * @param {number} areaHa - Total field area
   * @param {number[][]} ndviGrid - NDVI median grid
   * @param {number[][]} ndreGrid - NDRE median grid
   * @param {number[][]} twiGrid
   * @param {number[][]} demGrid
   * @param {number[][]} slopeGrid
   * @param {number[][]} scoreGrid
   * @returns {Array<Object>}
   */
  static _computeSatelliteZoneStats(zoneGrid, numZones, labels, areaHa,
    ndviGrid, ndreGrid, twiGrid, demGrid, slopeGrid, scoreGrid) {
    const rows = zoneGrid.length;
    const cols = zoneGrid[0].length;
    const totalPixels = rows * cols;

    const stats = [];

    for (let z = 0; z < numZones; z++) {
      let count = 0;
      let sumNDVI = 0, sumNDRE = 0, sumTWI = 0, sumElev = 0, sumSlope = 0, sumScore = 0;

      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          if (zoneGrid[r][c] !== z) continue;
          count++;
          sumNDVI  += ndviGrid[r][c];
          sumNDRE  += ndreGrid[r][c];
          sumTWI   += twiGrid[r][c];
          sumElev  += demGrid[r][c];
          sumSlope += slopeGrid[r][c];
          sumScore += scoreGrid[r][c];
        }
      }

      const n = count || 1;
      const zoneAreaHa = (count / totalPixels) * areaHa;
      const pct = (count / totalPixels) * 100;

      stats.push({
        zona: z + 1,
        clase: labels[z] || `Zona ${z + 1}`,
        area_ha: Math.round(zoneAreaHa * 100) / 100,
        porcentaje: Math.round(pct * 100) / 100,
        ndvi_prom: Math.round((sumNDVI / n) * 1000) / 1000,
        ndre_prom: Math.round((sumNDRE / n) * 1000) / 1000,
        twi_prom: Math.round((sumTWI / n) * 100) / 100,
        elevacion_prom: Math.round((sumElev / n) * 100) / 100,
        pendiente_prom: Math.round((sumSlope / n) * 10000) / 10000,
        score_prom: Math.round((sumScore / n) * 1000) / 1000,
        // Backwards compatibility
        zone: z + 1,
        pixelCount: count,
        mean: Math.round((sumScore / n) * 1000) / 1000,
        potential: labels[z] || `Zona ${z + 1}`
      });
    }

    return stats;
  }

  /**
   * Export satellite zone stats as CSV.
   * @param {Array<Object>} stats
   * @returns {string}
   */
  static _satelliteStatsToCSV(stats) {
    const headers = ['Zona', 'Clase', 'Area_ha', 'Porcentaje', 'NDVI_prom', 'NDRE_prom',
      'TWI_prom', 'Elevacion_prom', 'Pendiente_prom', 'Score_prom'];
    const rows = [headers.join(',')];
    for (const s of stats) {
      rows.push([
        s.zona, s.clase, s.area_ha, s.porcentaje, s.ndvi_prom, s.ndre_prom,
        s.twi_prom, s.elevacion_prom, s.pendiente_prom, s.score_prom
      ].join(','));
    }
    return rows.join('\n');
  }

  // ==================== SIMULATED SATELLITE DATA ====================

  /**
   * Generate realistic synthetic satellite data for demo/simulation.
   * Creates multi-year NDVI/NDRE/EVI grids with spatial patterns that mimic
   * real agricultural fields in Paraguay (gentle topography, NE-SW gradients).
   *
   * @param {{ minLat: number, maxLat: number, minLng: number, maxLng: number }} bounds
   * @param {Array<[number,number]>} boundary - Field boundary coordinates
   * @param {number} areaHa - Field area in hectares
   * @param {Object} [config={}]
   * @param {number} [config.resolution=200] - Grid resolution (rows/cols)
   * @param {number} [config.years=4] - Number of campaign years to simulate
   * @param {number} [config.baseElevation=150] - Base elevation in meters
   * @param {number} [config.elevRange=15] - Elevation range in meters
   * @param {number} [config.cellSize=10] - Cell size in meters
   * @param {number} [config.seed=42] - Pseudo-random seed for reproducibility
   * @returns {{
   *   ndviCampaigns: number[][][],
   *   ndreCampaigns: number[][][],
   *   eviCampaigns: number[][][],
   *   dem: number[][],
   *   cellSize: number
   * }}
   */
  static simulateSatelliteData(bounds, boundary, areaHa, config = {}) {
    const resolution = config.resolution || 200;
    const years = config.years || 4;
    const baseElev = config.baseElevation || 150;
    const elevRange = config.elevRange || 15;
    const cellSize = config.cellSize || 10;
    const seed = config.seed || 42;

    const rows = resolution;
    const cols = resolution;

    // --- Seeded PRNG (simple LCG for reproducibility) ---
    let _seed = seed;
    const rand = () => {
      _seed = (_seed * 1664525 + 1013904223) & 0x7fffffff;
      return _seed / 0x7fffffff;
    };

    // --- Perlin-like smooth noise using octave value noise ---
    // Generate a random value grid and interpolate for smooth spatial patterns
    const _makeNoiseGrid = (freqX, freqY, amplitude) => {
      // Base random values at coarse grid points
      const nX = Math.ceil(freqX) + 2;
      const nY = Math.ceil(freqY) + 2;
      const base = Array.from({ length: nY }, () =>
        Array.from({ length: nX }, () => rand() * 2 - 1)
      );

      // Smooth interpolation function (cubic hermite / smoothstep)
      const smoothstep = (t) => t * t * (3 - 2 * t);

      const result = Array.from({ length: rows }, () => new Float64Array(cols));
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const fx = (c / cols) * freqX;
          const fy = (r / rows) * freqY;
          const ix = Math.floor(fx);
          const iy = Math.floor(fy);
          const tx = smoothstep(fx - ix);
          const ty = smoothstep(fy - iy);

          // Bilinear interpolation of base noise
          const v00 = base[iy % nY][ix % nX];
          const v10 = base[iy % nY][(ix + 1) % nX];
          const v01 = base[(iy + 1) % nY][ix % nX];
          const v11 = base[(iy + 1) % nY][(ix + 1) % nX];

          const top = v00 * (1 - tx) + v10 * tx;
          const bot = v01 * (1 - tx) + v11 * tx;
          result[r][c] = (top * (1 - ty) + bot * ty) * amplitude;
        }
      }
      return result;
    };

    // Multi-octave noise for natural-looking patterns
    const _fractalNoise = (octaves, baseFreq, persistence) => {
      const result = Array.from({ length: rows }, () => new Float64Array(cols));
      let amp = 1;
      let freq = baseFreq;
      let totalAmp = 0;

      for (let o = 0; o < octaves; o++) {
        const noise = _makeNoiseGrid(freq, freq, amp);
        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < cols; c++) {
            result[r][c] += noise[r][c];
          }
        }
        totalAmp += amp;
        amp *= persistence;
        freq *= 2;
      }

      // Normalize to -1..1
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          result[r][c] /= totalAmp;
        }
      }
      return result;
    };

    // --- Generate DEM (gentle rolling topography, 100-200m) ---
    const demNoise = _fractalNoise(4, 2, 0.5);
    // Add a gentle NE-SW gradient (common in real fields)
    const dem = Array.from({ length: rows }, () => new Float64Array(cols));
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        // NE-SW gradient: higher in NE corner
        const gradientNESW = ((cols - c) / cols * 0.4 + r / rows * 0.6);
        dem[r][c] = baseElev + gradientNESW * elevRange * 0.5 + demNoise[r][c] * elevRange * 0.5;
      }
    }

    // --- Base spatial pattern for vegetation (correlated with topography) ---
    // Lower elevation areas tend to have more moisture = higher NDVI
    const basePattern = _fractalNoise(3, 3, 0.6);

    // --- Generate campaign grids ---
    const ndviCampaigns = [];
    const ndreCampaigns = [];
    const eviCampaigns = [];

    for (let y = 0; y < years; y++) {
      // Per-year variation: slight shift in overall vigor
      const yearBias = (rand() - 0.5) * 0.08; // +/- 4% year variation
      const yearNoise = _fractalNoise(2, 4, 0.5); // Yearly-specific spatial noise

      const ndviGrid = Array.from({ length: rows }, () => new Float64Array(cols));
      const ndreGrid = Array.from({ length: rows }, () => new Float64Array(cols));
      const eviGrid  = Array.from({ length: rows }, () => new Float64Array(cols));

      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          // Base NDVI: combine topographic influence + spatial pattern + year noise
          const topoInfluence = 1 - this._normalizeGridValue(dem[r][c], baseElev, baseElev + elevRange);
          const spatialPattern = basePattern[r][c] * 0.15;
          const yearVariation = yearNoise[r][c] * 0.06 + yearBias;

          // Random patches of lower values (simulate pest/disease/compaction spots)
          let patchEffect = 0;
          if (rand() < 0.003) {
            patchEffect = -0.1 * rand();
          }

          // NDVI: typical range 0.3 - 0.85 for crops
          const baseNDVI = 0.55 + topoInfluence * 0.15 + spatialPattern + yearVariation + patchEffect;
          ndviGrid[r][c] = Math.max(0.2, Math.min(0.9, baseNDVI));

          // NDRE: correlated with NDVI but lower magnitude (0.15 - 0.50)
          ndreGrid[r][c] = Math.max(0.1, Math.min(0.55, ndviGrid[r][c] * 0.55 + (rand() - 0.5) * 0.03));

          // EVI: similar to NDVI but slightly dampened (0.2 - 0.7)
          eviGrid[r][c] = Math.max(0.15, Math.min(0.75, ndviGrid[r][c] * 0.85 + (rand() - 0.5) * 0.02));
        }
      }

      ndviCampaigns.push(ndviGrid);
      ndreCampaigns.push(ndreGrid);
      eviCampaigns.push(eviGrid);
    }

    return {
      ndviCampaigns,
      ndreCampaigns,
      eviCampaigns,
      dem,
      cellSize
    };
  }

  /**
   * Helper: normalize a single value given known min/max to 0-1 range.
   * @param {number} val
   * @param {number} min
   * @param {number} max
   * @returns {number}
   */
  static _normalizeGridValue(val, min, max) {
    const range = max - min || 1;
    return Math.max(0, Math.min(1, (val - min) / range));
  }

  // ==================== K-MEANS CLUSTERING ====================

  /**
   * Squared Euclidean distance between two vectors.
   * @param {number[]} a - First vector
   * @param {number[]} b - Second vector
   * @returns {number}
   */
  static _distSq(a, b) {
    let s = 0;
    for (let i = 0; i < a.length; i++) {
      const d = a[i] - b[i];
      s += d * d;
    }
    return s;
  }

  /**
   * K-Means++ centroid initialization.
   * Selects initial centroids with probability proportional to squared distance
   * from the nearest existing centroid, ensuring well-separated starting points.
   * @param {number[][]} data - Array of feature vectors
   * @param {number} k - Number of clusters
   * @returns {number[][]} Initial centroids
   */
  // Mulberry32 seeded PRNG for reproducible results
  static _seededRandom(seed = 42) {
    let t = seed + 0x6D2B79F5;
    return function() {
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  static _kMeansPPInit(data, k, rng) {
    const n = data.length;
    const dim = data[0].length;
    const centroids = [];

    // First centroid: seeded random
    const firstIdx = Math.floor(rng() * n);
    centroids.push([...data[firstIdx]]);

    // Distance from each point to nearest centroid
    const dists = new Float64Array(n).fill(Infinity);

    for (let c = 1; c < k; c++) {
      // Update distances with last added centroid
      const last = centroids[c - 1];
      let totalDist = 0;
      for (let i = 0; i < n; i++) {
        const d = this._distSq(data[i], last);
        if (d < dists[i]) dists[i] = d;
        totalDist += dists[i];
      }

      // Weighted random selection (seeded)
      let threshold = rng() * totalDist;
      let selected = 0;
      for (let i = 0; i < n; i++) {
        threshold -= dists[i];
        if (threshold <= 0) { selected = i; break; }
      }
      centroids.push([...data[selected]]);
    }

    return centroids;
  }

  /**
   * K-Means clustering using Lloyd's algorithm with k-means++ initialization.
   *
   * @param {number[][]} data - Array of feature vectors (each vector is number[])
   * @param {number} k - Number of clusters (2-7 recommended)
   * @param {number} [maxIterations=100] - Maximum iterations before stopping
   * @returns {{ assignments: number[], centroids: number[][], iterations: number, wcss: number }}
   *   - assignments: cluster index for each data point
   *   - centroids: final centroid positions
   *   - iterations: number of iterations executed
   *   - wcss: within-cluster sum of squares (inertia)
   */
  static kMeans(data, k, maxIterations = 100) {
    const n = data.length;
    const dim = data[0].length;

    if (k >= n) {
      // Degenerate case: more clusters than points
      const assignments = data.map((_, i) => Math.min(i, k - 1));
      return { assignments, centroids: data.slice(0, k).map(d => [...d]), iterations: 0, wcss: 0 };
    }

    // Initialize centroids with k-means++ (seeded for reproducibility)
    const rng = this._seededRandom(42);
    let centroids = this._kMeansPPInit(data, k, rng);
    let assignments = new Array(n).fill(0);
    let iterations = 0;
    let changed = true;

    while (changed && iterations < maxIterations) {
      changed = false;
      iterations++;

      // Assignment step: assign each point to nearest centroid
      for (let i = 0; i < n; i++) {
        let minDist = Infinity;
        let best = 0;
        for (let c = 0; c < k; c++) {
          const d = this._distSq(data[i], centroids[c]);
          if (d < minDist) { minDist = d; best = c; }
        }
        if (assignments[i] !== best) {
          assignments[i] = best;
          changed = true;
        }
      }

      // Update step: recalculate centroids
      const sums = Array.from({ length: k }, () => new Float64Array(dim));
      const counts = new Float64Array(k);

      for (let i = 0; i < n; i++) {
        const c = assignments[i];
        counts[c]++;
        for (let d = 0; d < dim; d++) {
          sums[c][d] += data[i][d];
        }
      }

      for (let c = 0; c < k; c++) {
        if (counts[c] > 0) {
          centroids[c] = Array.from(sums[c], v => v / counts[c]);
        } else {
          // Reinitialize empty cluster: assign to point farthest from its centroid
          let maxDist = -1, maxIdx = 0;
          for (let i = 0; i < n; i++) {
            const d = this._distSq(data[i], centroids[assignments[i]]);
            if (d > maxDist) { maxDist = d; maxIdx = i; }
          }
          centroids[c] = [...data[maxIdx]];
        }
      }
    }

    // Compute WCSS (within-cluster sum of squares)
    let wcss = 0;
    for (let i = 0; i < n; i++) {
      wcss += this._distSq(data[i], centroids[assignments[i]]);
    }

    return { assignments, centroids, iterations, wcss };
  }

  /**
   * Fuzzy C-Means clustering with membership matrix.
   * Produces soft zone boundaries with gradual transitions.
   *
   * @param {number[][]} data - Feature vectors
   * @param {number} c - Number of clusters
   * @param {number} [m=2] - Fuzziness exponent (>1, typically 2)
   * @param {number} [maxIter=100] - Maximum iterations
   * @param {number} [epsilon=1e-5] - Convergence threshold
   * @returns {{ assignments: number[], centroids: number[][], membership: number[][], fpi: number, nce: number, iterations: number }}
   */
  static fuzzyCMeans(data, c, m = 2, maxIter = 100, epsilon = 1e-5) {
    const n = data.length;
    const dim = data[0].length;
    const rng = this._seededRandom(42);

    // Initialize membership matrix randomly, then normalize rows to sum=1
    let U = Array.from({ length: n }, () => {
      const row = Array.from({ length: c }, () => rng());
      const sum = row.reduce((s, v) => s + v, 0);
      return row.map(v => v / sum);
    });

    let centroids = Array.from({ length: c }, () => new Float64Array(dim));
    let iterations = 0;

    for (let iter = 0; iter < maxIter; iter++) {
      iterations++;

      // Update centroids: v_j = Σ(u_ij^m * x_i) / Σ(u_ij^m)
      for (let j = 0; j < c; j++) {
        const num = new Float64Array(dim);
        let den = 0;
        for (let i = 0; i < n; i++) {
          const w = Math.pow(U[i][j], m);
          den += w;
          for (let d = 0; d < dim; d++) num[d] += w * data[i][d];
        }
        centroids[j] = den > 0 ? Array.from(num, v => v / den) : centroids[j];
      }

      // Update membership: u_ij = 1 / Σ_k (d_ij/d_ik)^(2/(m-1))
      let maxDelta = 0;
      const newU = Array.from({ length: n }, () => new Array(c).fill(0));
      const exp = 2 / (m - 1);

      for (let i = 0; i < n; i++) {
        const dists = centroids.map(cen => {
          const d = this._distSq(data[i], cen);
          return d < 1e-12 ? 1e-12 : d;
        });

        for (let j = 0; j < c; j++) {
          let sum = 0;
          for (let k = 0; k < c; k++) {
            sum += Math.pow(dists[j] / dists[k], exp);
          }
          newU[i][j] = 1 / sum;
          const delta = Math.abs(newU[i][j] - U[i][j]);
          if (delta > maxDelta) maxDelta = delta;
        }
      }

      U = newU;
      if (maxDelta < epsilon) break;
    }

    // Hard assignments from membership
    const assignments = U.map(row => row.indexOf(Math.max(...row)));

    // FPI (Fuzziness Performance Index): 1 - (1/n) * Σ Σ u_ij^2
    // Lower = crisper partitions (optimal k minimizes FPI)
    let sumSqU = 0;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < c; j++) sumSqU += U[i][j] * U[i][j];
    }
    const fpi = 1 - (sumSqU / n);

    // NCE (Normalized Classification Entropy): -(1/n) * Σ Σ u_ij * ln(u_ij)
    // Lower = less uncertainty (optimal k minimizes NCE)
    let entropy = 0;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < c; j++) {
        if (U[i][j] > 0) entropy -= U[i][j] * Math.log(U[i][j]);
      }
    }
    const nce = entropy / n;

    return { assignments, centroids, membership: U, fpi, nce, iterations };
  }

  /**
   * Silhouette score for cluster quality validation.
   * Range [-1, 1]: higher = better separated clusters.
   *
   * @param {number[][]} data - Feature vectors
   * @param {number[]} assignments - Cluster assignment per point
   * @returns {{ mean: number, perPoint: number[] }}
   */
  static silhouetteScore(data, assignments) {
    const n = data.length;
    const k = Math.max(...assignments) + 1;
    const scores = new Float64Array(n);

    for (let i = 0; i < n; i++) {
      const ci = assignments[i];

      // a(i) = mean distance to same-cluster points
      let aSum = 0, aCount = 0;
      for (let j = 0; j < n; j++) {
        if (j !== i && assignments[j] === ci) {
          aSum += Math.sqrt(this._distSq(data[i], data[j]));
          aCount++;
        }
      }
      const a = aCount > 0 ? aSum / aCount : 0;

      // b(i) = min over other clusters of mean distance
      let b = Infinity;
      for (let c = 0; c < k; c++) {
        if (c === ci) continue;
        let bSum = 0, bCount = 0;
        for (let j = 0; j < n; j++) {
          if (assignments[j] === c) {
            bSum += Math.sqrt(this._distSq(data[i], data[j]));
            bCount++;
          }
        }
        if (bCount > 0) {
          const avg = bSum / bCount;
          if (avg < b) b = avg;
        }
      }

      scores[i] = Math.max(a, b) > 0 ? (b - a) / Math.max(a, b) : 0;
    }

    const mean = scores.reduce((s, v) => s + v, 0) / n;
    return { mean, perPoint: Array.from(scores) };
  }

  // ==================== MULTI-VARIABLE CLUSTERING ====================

  /**
   * Z-score normalize a flat array of values.
   * @param {number[]} values
   * @returns {{ normalized: number[], mean: number, std: number }}
   */
  static _zNormalize(values) {
    const n = values.length;
    let sum = 0, sumSq = 0;
    for (let i = 0; i < n; i++) {
      sum += values[i];
      sumSq += values[i] * values[i];
    }
    const mean = sum / n;
    const variance = sumSq / n - mean * mean;
    const std = Math.sqrt(Math.max(variance, 1e-12));
    const normalized = values.map(v => (v - mean) / std);
    return { normalized, mean, std };
  }

  /**
   * Multi-variable clustering for management zone delineation.
   *
   * Takes multiple raster layers (e.g. interpolated soil nutrients, NDVI, elevation),
   * normalizes them, optionally weights them, stacks into feature vectors, and
   * clusters using K-Means.
   *
   * @param {Array<{ name: string, grid: number[][] }>} layers - Raster layers to combine
   * @param {number} k - Number of zones (2-7)
   * @param {number[]|null} [weights=null] - Optional weight per layer (same length as layers)
   * @returns {{
   *   zoneGrid: number[][],
   *   stats: Object,
   *   centroids: number[][],
   *   iterations: number,
   *   wcss: number,
   *   layerStats: Array<{ name: string, mean: number, std: number }>
   * }}
   */
  static multiVariableCluster(layers, k, weights = null) {
    if (!layers || layers.length === 0) {
      throw new Error('ZonesEngine: at least one layer is required');
    }

    const rows = layers[0].grid.length;
    const cols = layers[0].grid[0].length;
    const numLayers = layers.length;

    // Flatten and normalize each layer
    const normalizedFlat = [];
    const layerStats = [];
    for (let l = 0; l < numLayers; l++) {
      const flat = [];
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          flat.push(layers[l].grid[r][c]);
        }
      }
      const { normalized, mean, std } = this._zNormalize(flat);
      normalizedFlat.push(normalized);
      layerStats.push({ name: layers[l].name, mean, std });
    }

    // Apply weights
    const w = weights || new Array(numLayers).fill(1);
    for (let l = 0; l < numLayers; l++) {
      if (w[l] !== 1) {
        for (let i = 0; i < normalizedFlat[l].length; i++) {
          normalizedFlat[l][i] *= w[l];
        }
      }
    }

    // Stack into feature vectors
    const totalPixels = rows * cols;
    const featureVectors = new Array(totalPixels);
    for (let i = 0; i < totalPixels; i++) {
      const vec = new Array(numLayers);
      for (let l = 0; l < numLayers; l++) {
        vec[l] = normalizedFlat[l][i];
      }
      featureVectors[i] = vec;
    }

    // Run K-Means
    const result = this.kMeans(featureVectors, k);

    // Reshape assignments back to grid
    const zoneGrid = [];
    let idx = 0;
    for (let r = 0; r < rows; r++) {
      const row = new Array(cols);
      for (let c = 0; c < cols; c++) {
        row[c] = result.assignments[idx++];
      }
      zoneGrid.push(row);
    }

    return {
      zoneGrid,
      stats: null, // Computed separately via zoneStatistics
      centroids: result.centroids,
      iterations: result.iterations,
      wcss: result.wcss,
      layerStats
    };
  }

  // ==================== TEMPORAL STABILITY ANALYSIS ====================

  /**
   * Temporal stability analysis across multiple campaigns.
   *
   * Evaluates pixel-level consistency across at least 3 campaign grids to
   * determine stable vs. variable zones. Stable zones receive consistent
   * management; unstable zones require adaptive strategies.
   *
   * @param {number[][][]} campaignGrids - Array of 2D grids, one per campaign/year
   * @param {number} [minCampaigns=3] - Minimum campaigns required
   * @returns {{
   *   meanGrid: number[][],
   *   stdGrid: number[][],
   *   cvGrid: number[][],
   *   stabilityGrid: number[][],
   *   classification: string[][]
   * }}
   */
  static temporalStability(campaignGrids, minCampaigns = 3) {
    if (!campaignGrids || campaignGrids.length < minCampaigns) {
      throw new Error(`ZonesEngine: temporal stability requires at least ${minCampaigns} campaigns, got ${campaignGrids ? campaignGrids.length : 0}`);
    }

    const numCampaigns = campaignGrids.length;
    const rows = campaignGrids[0].length;
    const cols = campaignGrids[0][0].length;

    const meanGrid = Array.from({ length: rows }, () => new Array(cols).fill(0));
    const stdGrid = Array.from({ length: rows }, () => new Array(cols).fill(0));
    const cvGrid = Array.from({ length: rows }, () => new Array(cols).fill(0));
    const stabilityGrid = Array.from({ length: rows }, () => new Array(cols).fill(0));
    const classification = Array.from({ length: rows }, () => new Array(cols).fill(''));

    // Find max CV for normalization
    let maxCV = 0;

    // First pass: compute mean, stdDev, CV
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        let sum = 0;
        for (let t = 0; t < numCampaigns; t++) {
          sum += campaignGrids[t][r][c];
        }
        const mean = sum / numCampaigns;

        let sumSqDiff = 0;
        for (let t = 0; t < numCampaigns; t++) {
          const diff = campaignGrids[t][r][c] - mean;
          sumSqDiff += diff * diff;
        }
        const std = numCampaigns > 1 ? Math.sqrt(sumSqDiff / (numCampaigns - 1)) : 0;
        const cv = mean !== 0 ? (std / Math.abs(mean)) * 100 : 0;

        meanGrid[r][c] = mean;
        stdGrid[r][c] = std;
        cvGrid[r][c] = cv;

        if (cv > maxCV) maxCV = cv;
      }
    }

    // Second pass: stability coefficient and classification
    if (maxCV === 0) maxCV = 1; // Avoid division by zero

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const cv = cvGrid[r][c];
        stabilityGrid[r][c] = 1 - (cv / maxCV);

        if (cv < 15) {
          classification[r][c] = 'estable';
        } else if (cv < 30) {
          classification[r][c] = 'moderado';
        } else {
          classification[r][c] = 'inestable';
        }
      }
    }

    return { meanGrid, stdGrid, cvGrid, stabilityGrid, classification };
  }

  // ==================== TOPOGRAPHIC WETNESS INDEX (TWI) ====================

  /**
   * Calculate slope using Horn's method (3x3 kernel).
   * @param {number[][]} demGrid - Digital Elevation Model grid
   * @param {number} cellSize - Cell size in meters
   * @returns {number[][]} Slope grid in radians
   */
  static _calculateSlope(demGrid, cellSize) {
    const rows = demGrid.length;
    const cols = demGrid[0].length;
    const slopeGrid = Array.from({ length: rows }, () => new Array(cols).fill(0));

    for (let r = 1; r < rows - 1; r++) {
      for (let c = 1; c < cols - 1; c++) {
        // Horn's method weights
        const z1 = demGrid[r - 1][c - 1];
        const z2 = demGrid[r - 1][c];
        const z3 = demGrid[r - 1][c + 1];
        const z4 = demGrid[r][c - 1];
        const z6 = demGrid[r][c + 1];
        const z7 = demGrid[r + 1][c - 1];
        const z8 = demGrid[r + 1][c];
        const z9 = demGrid[r + 1][c + 1];

        const dzdx = ((z3 + 2 * z6 + z9) - (z1 + 2 * z4 + z7)) / (8 * cellSize);
        const dzdy = ((z7 + 2 * z8 + z9) - (z1 + 2 * z2 + z3)) / (8 * cellSize);

        slopeGrid[r][c] = Math.atan(Math.sqrt(dzdx * dzdx + dzdy * dzdy));
      }
    }

    // Copy edge values from nearest interior cells
    for (let r = 0; r < rows; r++) {
      slopeGrid[r][0] = slopeGrid[r][Math.min(1, cols - 1)];
      slopeGrid[r][cols - 1] = slopeGrid[r][Math.max(cols - 2, 0)];
    }
    for (let c = 0; c < cols; c++) {
      slopeGrid[0][c] = slopeGrid[Math.min(1, rows - 1)][c];
      slopeGrid[rows - 1][c] = slopeGrid[Math.max(rows - 2, 0)][c];
    }

    return slopeGrid;
  }

  /**
   * D8 flow direction algorithm.
   * For each cell, determines the steepest downslope neighbor among 8 directions.
   *
   * Direction encoding (powers of 2):
   *   32  64  128
   *   16   x    1
   *    8   4    2
   *
   * @param {number[][]} demGrid - Digital Elevation Model grid
   * @returns {number[][]} Flow direction grid with D8 encoded values
   */
  static flowDirectionD8(demGrid) {
    const rows = demGrid.length;
    const cols = demGrid[0].length;
    const flowDir = Array.from({ length: rows }, () => new Array(cols).fill(0));

    // D8 neighbor offsets: E, SE, S, SW, W, NW, N, NE
    const dr = [0, 1, 1, 1, 0, -1, -1, -1];
    const dc = [1, 1, 0, -1, -1, -1, 0, 1];
    const dirCodes = [1, 2, 4, 8, 16, 32, 64, 128];
    const dist = [1, Math.SQRT2, 1, Math.SQRT2, 1, Math.SQRT2, 1, Math.SQRT2];

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        let maxSlope = 0;
        let bestDir = 0;
        const elev = demGrid[r][c];

        for (let d = 0; d < 8; d++) {
          const nr = r + dr[d];
          const nc = c + dc[d];
          if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;

          const drop = (elev - demGrid[nr][nc]) / dist[d];
          if (drop > maxSlope) {
            maxSlope = drop;
            bestDir = dirCodes[d];
          }
        }

        flowDir[r][c] = bestDir;
      }
    }

    return flowDir;
  }

  /**
   * Flow accumulation from a D8 flow direction grid.
   * Counts the number of upstream cells draining through each cell.
   *
   * @param {number[][]} flowDirGrid - D8 flow direction grid
   * @returns {number[][]} Flow accumulation grid (upstream cell count)
   */
  static flowAccumulation(flowDirGrid) {
    const rows = flowDirGrid.length;
    const cols = flowDirGrid[0].length;
    const accum = Array.from({ length: rows }, () => new Array(cols).fill(1));
    const visited = Array.from({ length: rows }, () => new Array(cols).fill(false));

    // Direction code to row/col offset mapping
    const dirToOffset = {
      1:   [0, 1],   // E
      2:   [1, 1],   // SE
      4:   [1, 0],   // S
      8:   [1, -1],  // SW
      16:  [0, -1],  // W
      32:  [-1, -1], // NW
      64:  [-1, 0],  // N
      128: [-1, 1]   // NE
    };

    /**
     * Recursive accumulation with iterative stack to avoid call stack overflow.
     * @param {number} startR - Starting row
     * @param {number} startC - Starting column
     */
    const accumulate = (startR, startC) => {
      if (visited[startR][startC]) return accum[startR][startC];

      const stack = [[startR, startC]];
      const order = [];

      // Topological ordering via DFS
      while (stack.length > 0) {
        const [r, c] = stack[stack.length - 1];

        if (visited[r][c]) {
          stack.pop();
          continue;
        }

        // Check if all upstream neighbors have been visited
        let allUpstreamVisited = true;
        const dirCode = flowDirGrid[r][c];

        // Find cells that flow INTO [r, c]
        const dr = [0, 1, 1, 1, 0, -1, -1, -1];
        const dc = [1, 1, 0, -1, -1, -1, 0, 1];
        const dirCodes = [1, 2, 4, 8, 16, 32, 64, 128];
        // Opposite directions: a cell at offset d flows to us if its direction is opposite
        const oppositeDirs = [16, 32, 64, 128, 1, 2, 4, 8];

        for (let d = 0; d < 8; d++) {
          const nr = r + dr[d];
          const nc = c + dc[d];
          if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;

          if (flowDirGrid[nr][nc] === oppositeDirs[d] && !visited[nr][nc]) {
            allUpstreamVisited = false;
            stack.push([nr, nc]);
          }
        }

        if (allUpstreamVisited) {
          // Accumulate from upstream
          accum[r][c] = 1; // Self
          for (let d = 0; d < 8; d++) {
            const nr = r + dr[d];
            const nc = c + dc[d];
            if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;

            if (flowDirGrid[nr][nc] === oppositeDirs[d]) {
              accum[r][c] += accum[nr][nc];
            }
          }
          visited[r][c] = true;
          stack.pop();
        }
      }

      return accum[startR][startC];
    };

    // Process all cells
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (!visited[r][c]) {
          accumulate(r, c);
        }
      }
    }

    return accum;
  }

  /**
   * Calculate Topographic Wetness Index (TWI) from a DEM.
   *
   * TWI = ln(flowAccumulation * cellSize / tan(slope))
   *
   * Higher TWI indicates areas prone to water accumulation (valleys, depressions).
   * Lower TWI indicates ridges and steep slopes.
   *
   * @param {number[][]} demGrid - 2D array of elevation values (planialtimetria)
   * @param {number} cellSize - Cell size in meters
   * @returns {{
   *   twiGrid: number[][],
   *   slopeGrid: number[][],
   *   flowGrid: number[][],
   *   classification: string[][]
   * }}
   */
  static calculateTWI(demGrid, cellSize) {
    const rows = demGrid.length;
    const cols = demGrid[0].length;

    // Calculate slope
    const slopeGrid = this._calculateSlope(demGrid, cellSize);

    // Calculate flow direction and accumulation
    const flowDirGrid = this.flowDirectionD8(demGrid);
    const flowGrid = this.flowAccumulation(flowDirGrid);

    // Calculate TWI
    const twiGrid = Array.from({ length: rows }, () => new Array(cols).fill(0));
    const classification = Array.from({ length: rows }, () => new Array(cols).fill(''));

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        // Prevent division by zero and log of zero
        const tanSlope = Math.max(Math.tan(slopeGrid[r][c]), 0.001);
        const specificArea = flowGrid[r][c] * cellSize;
        twiGrid[r][c] = Math.log(specificArea / tanSlope);

        // Classify
        const twi = twiGrid[r][c];
        if (twi < 5) {
          classification[r][c] = 'cresta';
        } else if (twi < 8) {
          classification[r][c] = 'ladera';
        } else if (twi < 11) {
          classification[r][c] = 'planicie';
        } else {
          classification[r][c] = 'bajo/acumulacion';
        }
      }
    }

    return { twiGrid, slopeGrid, flowGrid, classification };
  }

  // ==================== WATER FLOW LINES ====================

  /**
   * Generate water flow lines by tracing downstream paths from high-accumulation cells.
   *
   * Starting from cells where flow accumulation exceeds the given threshold,
   * traces downstream following D8 flow directions. Useful for identifying
   * natural drainage patterns and potential waterlogging areas.
   *
   * @param {number[][]} demGrid - DEM grid (used for coordinate mapping)
   * @param {number[][]} flowDirGrid - D8 flow direction grid
   * @param {number[][]} flowAccGrid - Flow accumulation grid
   * @param {number} threshold - Minimum accumulation to start a flow line
   * @param {{ minLat: number, maxLat: number, minLng: number, maxLng: number }} [bounds] - Geographic bounds
   * @returns {Array<Array<{ lat: number, lng: number }>>} Array of polylines
   */
  static generateFlowLines(demGrid, flowDirGrid, flowAccGrid, threshold, bounds) {
    const rows = demGrid.length;
    const cols = demGrid[0].length;
    const lines = [];

    // Direction code to row/col offset
    const dirToOffset = {
      1:   [0, 1],
      2:   [1, 1],
      4:   [1, 0],
      8:   [1, -1],
      16:  [0, -1],
      32:  [-1, -1],
      64:  [-1, 0],
      128: [-1, 1]
    };

    // Track visited cells to avoid duplicate lines
    const onLine = Array.from({ length: rows }, () => new Array(cols).fill(false));

    // Find starting cells (high accumulation, not yet on a line)
    const starts = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (flowAccGrid[r][c] >= threshold) {
          starts.push([r, c, flowAccGrid[r][c]]);
        }
      }
    }

    // Sort by accumulation descending so major channels are traced first
    starts.sort((a, b) => b[2] - a[2]);

    const latStep = bounds ? (bounds.maxLat - bounds.minLat) / rows : 1 / rows;
    const lngStep = bounds ? (bounds.maxLng - bounds.minLng) / cols : 1 / cols;
    const baseLat = bounds ? bounds.maxLat : 1;
    const baseLng = bounds ? bounds.minLng : 0;

    for (const [startR, startC] of starts) {
      if (onLine[startR][startC]) continue;

      const line = [];
      let r = startR;
      let c = startC;
      const maxSteps = rows * cols; // Safety limit
      let steps = 0;

      while (steps < maxSteps) {
        const lat = baseLat - r * latStep;
        const lng = baseLng + c * lngStep;
        line.push({ lat, lng });
        onLine[r][c] = true;

        const dir = flowDirGrid[r][c];
        if (dir === 0) break; // No outflow (pit)

        const offset = dirToOffset[dir];
        if (!offset) break;

        const nr = r + offset[0];
        const nc = c + offset[1];

        if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) break;
        if (onLine[nr][nc]) {
          // Connect to existing line and stop
          line.push({ lat: baseLat - nr * latStep, lng: baseLng + nc * lngStep });
          break;
        }

        r = nr;
        c = nc;
        steps++;
      }

      if (line.length >= 2) {
        lines.push(line);
      }
    }

    return lines;
  }

  // ==================== ZONE STATISTICS ====================

  /**
   * Calculate comprehensive statistics for each management zone.
   *
   * @param {number[][]} grid - Value grid (e.g. interpolated nutrient)
   * @param {number[][]} zoneGrid - Zone assignment grid (integer labels 0..numZones-1)
   * @param {number} numZones - Total number of zones
   * @returns {Array<{
   *   zone: number,
   *   pixelCount: number,
   *   mean: number,
   *   stdDev: number,
   *   min: number,
   *   max: number,
   *   cv: number,
   *   p25: number,
   *   p50: number,
   *   p75: number,
   *   potential: string
   * }>}
   */
  static zoneStatistics(grid, zoneGrid, numZones) {
    const rows = grid.length;
    const cols = grid[0].length;

    // Collect values per zone
    const zoneValues = Array.from({ length: numZones }, () => []);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const z = zoneGrid[r][c];
        if (z >= 0 && z < numZones) {
          zoneValues[z].push(grid[r][c]);
        }
      }
    }

    // Compute stats
    const stats = [];
    const means = [];

    for (let z = 0; z < numZones; z++) {
      const vals = zoneValues[z];
      if (vals.length === 0) {
        stats.push({
          zone: z + 1,
          pixelCount: 0,
          mean: 0, stdDev: 0, min: 0, max: 0, cv: 0,
          p25: 0, p50: 0, p75: 0, potential: 'N/A'
        });
        means.push(0);
        continue;
      }

      vals.sort((a, b) => a - b);
      const n = vals.length;

      let sum = 0;
      for (let i = 0; i < n; i++) sum += vals[i];
      const mean = sum / n;

      let sumSqDiff = 0;
      for (let i = 0; i < n; i++) {
        const d = vals[i] - mean;
        sumSqDiff += d * d;
      }
      const stdDev = Math.sqrt(sumSqDiff / n);
      const cv = mean !== 0 ? (stdDev / Math.abs(mean)) * 100 : 0;

      // Percentiles (nearest rank)
      const percentile = (p) => {
        const idx = Math.max(0, Math.ceil(p / 100 * n) - 1);
        return vals[idx];
      };

      stats.push({
        zone: z + 1,
        pixelCount: n,
        mean: Math.round(mean * 1000) / 1000,
        stdDev: Math.round(stdDev * 1000) / 1000,
        min: Math.round(vals[0] * 1000) / 1000,
        max: Math.round(vals[n - 1] * 1000) / 1000,
        cv: Math.round(cv * 100) / 100,
        p25: Math.round(percentile(25) * 1000) / 1000,
        p50: Math.round(percentile(50) * 1000) / 1000,
        p75: Math.round(percentile(75) * 1000) / 1000,
        potential: '' // Set below
      });

      means.push(mean);
    }

    // Classify potential based on mean ranking
    const sortedMeans = means.map((m, i) => ({ mean: m, idx: i }))
      .filter(e => stats[e.idx].pixelCount > 0)
      .sort((a, b) => a.mean - b.mean);

    const totalActive = sortedMeans.length;
    for (let rank = 0; rank < totalActive; rank++) {
      const fraction = rank / Math.max(totalActive - 1, 1);
      const zIdx = sortedMeans[rank].idx;
      if (fraction < 0.33) {
        stats[zIdx].potential = 'Bajo';
      } else if (fraction < 0.67) {
        stats[zIdx].potential = 'Medio';
      } else {
        stats[zIdx].potential = 'Alto';
      }
    }

    return stats;
  }

  // ==================== ZONE ORDERING ====================

  /**
   * Reorder zone labels so that Zone 1 has the lowest mean value
   * and Zone N has the highest. Ensures consistent color mapping
   * where red represents low-potential zones and green represents high.
   *
   * @param {number[][]} zoneGrid - Original zone assignment grid (0-indexed)
   * @param {number[][]} valueGrid - Value grid used to compute means
   * @param {number} numZones - Total number of zones
   * @returns {number[][]} Reordered zone grid (0-indexed)
   */
  static orderZonesByMean(zoneGrid, valueGrid, numZones) {
    const rows = zoneGrid.length;
    const cols = zoneGrid[0].length;

    // Compute mean per zone
    const sums = new Float64Array(numZones);
    const counts = new Float64Array(numZones);

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const z = zoneGrid[r][c];
        if (z >= 0 && z < numZones) {
          sums[z] += valueGrid[r][c];
          counts[z]++;
        }
      }
    }

    // Create mapping: sorted zone index -> original zone index
    const zoneMeans = [];
    for (let z = 0; z < numZones; z++) {
      zoneMeans.push({ zone: z, mean: counts[z] > 0 ? sums[z] / counts[z] : 0 });
    }
    zoneMeans.sort((a, b) => a.mean - b.mean);

    // Build reverse mapping: original zone -> new label
    const mapping = new Array(numZones);
    for (let newLabel = 0; newLabel < numZones; newLabel++) {
      mapping[zoneMeans[newLabel].zone] = newLabel;
    }

    // Apply mapping
    const reordered = Array.from({ length: rows }, () => new Array(cols));
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        reordered[r][c] = mapping[zoneGrid[r][c]];
      }
    }

    return reordered;
  }

  // ==================== EXPORT UTILITIES ====================

  /**
   * Convert raster zone grid to GeoJSON FeatureCollection.
   *
   * Each zone becomes a polygon Feature with properties including zone number,
   * pixel area, mean value, and productivity potential.
   *
   * @param {number[][]} zoneGrid - Zone assignment grid (0-indexed)
   * @param {{ minLat: number, maxLat: number, minLng: number, maxLng: number }} bounds
   * @param {number} numZones - Total number of zones
   * @param {Array<Object>|null} [stats=null] - Zone statistics (from zoneStatistics)
   * @returns {Object} GeoJSON FeatureCollection
   */
  static zonesToGeoJSON(zoneGrid, bounds, numZones, stats = null) {
    const rows = zoneGrid.length;
    const cols = zoneGrid[0].length;
    const latStep = (bounds.maxLat - bounds.minLat) / rows;
    const lngStep = (bounds.maxLng - bounds.minLng) / cols;

    const features = [];

    for (let z = 0; z < numZones; z++) {
      // Collect all cells belonging to this zone
      const mask = Array.from({ length: rows }, () => new Uint8Array(cols));
      let cellCount = 0;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          if (zoneGrid[r][c] === z) {
            mask[r][c] = 1;
            cellCount++;
          }
        }
      }

      if (cellCount === 0) continue;

      // Grid-cell outline: collect all boundary edges between zone/non-zone cells
      // Each edge is stored as a segment [x1,y1]->[x2,y2] in grid coords
      const edges = [];
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          if (!mask[r][c]) continue;
          // Top edge: if row above is out or different zone
          if (r === 0 || !mask[r - 1][c]) edges.push([[c, r], [c + 1, r]]);
          // Bottom edge
          if (r === rows - 1 || !mask[r + 1][c]) edges.push([[c + 1, r + 1], [c, r + 1]]);
          // Left edge
          if (c === 0 || !mask[r][c - 1]) edges.push([[c, r + 1], [c, r]]);
          // Right edge
          if (c === cols - 1 || !mask[r][c + 1]) edges.push([[c + 1, r], [c + 1, r + 1]]);
        }
      }

      if (edges.length < 3) continue;

      // Chain edges into a ring (follow connected edges)
      const edgeMap = new Map();
      for (const [from, to] of edges) {
        const key = `${from[0]},${from[1]}`;
        edgeMap.set(key, to);
      }

      const ring = [];
      const start = edges[0][0];
      let current = start;
      let safety = edges.length + 1;
      do {
        const key = `${current[0]},${current[1]}`;
        // Convert grid coords to geographic coords
        ring.push([
          bounds.minLng + current[0] * lngStep,
          bounds.maxLat - current[1] * latStep
        ]);
        const next = edgeMap.get(key);
        if (!next) break;
        edgeMap.delete(key);
        current = next;
      } while ((current[0] !== start[0] || current[1] !== start[1]) && --safety > 0);

      // Close the ring
      ring.push(ring[0]);

      const properties = {
        zone: z + 1,
        pixelCount: cellCount,
        areaFraction: Math.round((cellCount / (rows * cols)) * 10000) / 100
      };

      if (stats && stats[z]) {
        properties.mean = stats[z].mean;
        properties.stdDev = stats[z].stdDev;
        properties.min = stats[z].min;
        properties.max = stats[z].max;
        properties.cv = stats[z].cv;
        properties.potential = stats[z].potential;
      }

      features.push({
        type: 'Feature',
        properties,
        geometry: {
          type: 'Polygon',
          coordinates: [ring]
        }
      });
    }

    return {
      type: 'FeatureCollection',
      features
    };
  }

  /**
   * Simple convex hull using Graham scan.
   * @param {number[][]} points - Array of [x, y] coordinates
   * @returns {number[][]} Convex hull points in CCW order
   */
  static _convexHull(points) {
    if (points.length < 3) return [...points];

    // Find lowest-rightmost point
    let pivot = 0;
    for (let i = 1; i < points.length; i++) {
      if (points[i][1] < points[pivot][1] ||
          (points[i][1] === points[pivot][1] && points[i][0] > points[pivot][0])) {
        pivot = i;
      }
    }

    const pivotPt = points[pivot];

    // Sort by polar angle from pivot
    const sorted = points
      .filter((_, i) => i !== pivot)
      .map(p => ({
        point: p,
        angle: Math.atan2(p[1] - pivotPt[1], p[0] - pivotPt[0])
      }))
      .sort((a, b) => a.angle - b.angle || this._distSq(pivotPt, a.point) - this._distSq(pivotPt, b.point))
      .map(e => e.point);

    const hull = [pivotPt];

    for (const p of sorted) {
      while (hull.length >= 2) {
        const a = hull[hull.length - 2];
        const b = hull[hull.length - 1];
        const cross = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
        if (cross <= 0) {
          hull.pop();
        } else {
          break;
        }
      }
      hull.push(p);
    }

    return hull;
  }

  /**
   * Export zone statistics as a CSV string.
   *
   * @param {Array<Object>} stats - Zone statistics array (from zoneStatistics)
   * @returns {string} CSV formatted string with headers
   */
  static zonesToCSV(stats) {
    const headers = ['Zona', 'Pixeles', 'Media', 'DesvEst', 'Min', 'Max', 'CV%', 'P25', 'P50', 'P75', 'Potencial'];
    const rows = [headers.join(',')];

    for (const s of stats) {
      rows.push([
        s.zone,
        s.pixelCount,
        s.mean,
        s.stdDev,
        s.min,
        s.max,
        s.cv,
        s.p25,
        s.p50,
        s.p75,
        s.potential
      ].join(','));
    }

    return rows.join('\n');
  }

  // ==================== LEAFLET MAP RENDERING ====================

  /**
   * Smooth a zone grid using majority filter (morphological mode filter).
   * Each cell adopts the most common zone value in its NxN neighbourhood.
   * This removes jagged/pixelated zone boundaries.
   * @param {Array<Array<number>>} grid - Original zone grid
   * @param {number} passes - Number of smoothing passes (default 5)
   * @param {number} kernelSize - Neighbourhood size (default 7, must be odd)
   * @returns {Array<Array<number>>} Smoothed zone grid
   */
  static _smoothZoneGrid(grid, passes = 5, kernelSize = 7) {
    const rows = grid.length;
    const cols = grid[0].length;
    const half = Math.floor(kernelSize / 2);
    let current = grid.map(row => [...row]);

    for (let p = 0; p < passes; p++) {
      const next = current.map(row => [...row]);
      for (let r = half; r < rows - half; r++) {
        for (let c = half; c < cols - half; c++) {
          // Count zone frequencies in neighbourhood
          const freq = {};
          for (let dr = -half; dr <= half; dr++) {
            for (let dc = -half; dc <= half; dc++) {
              const z = current[r + dr][c + dc];
              freq[z] = (freq[z] || 0) + 1;
            }
          }
          // Pick majority
          let maxCount = 0, majority = current[r][c];
          for (const [z, count] of Object.entries(freq)) {
            if (count > maxCount) { maxCount = count; majority = Number(z); }
          }
          next[r][c] = majority;
        }
      }
      current = next;
    }
    return current;
  }

  /**
   * Apply a Gaussian blur to canvas image data for smooth zone transitions.
   * Uses a separable 2-pass approach (horizontal then vertical) for performance.
   * @param {ImageData} imgData - Canvas image data to blur in-place
   * @param {number} width - Canvas width
   * @param {number} height - Canvas height
   * @param {number} radius - Blur radius in pixels (default 2)
   */
  static _gaussianBlur(imgData, width, height, radius = 2) {
    const data = imgData.data;
    const sigma = radius / 2;
    const kernelSize = radius * 2 + 1;

    // Build 1D Gaussian kernel
    const kernel = new Float64Array(kernelSize);
    let kernelSum = 0;
    for (let i = 0; i < kernelSize; i++) {
      const x = i - radius;
      kernel[i] = Math.exp(-(x * x) / (2 * sigma * sigma));
      kernelSum += kernel[i];
    }
    // Normalize kernel
    for (let i = 0; i < kernelSize; i++) kernel[i] /= kernelSum;

    // Temporary buffer for intermediate pass
    const temp = new Uint8ClampedArray(data.length);

    // Horizontal pass
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let r = 0, g = 0, b = 0, a = 0;
        for (let k = 0; k < kernelSize; k++) {
          const sx = Math.max(0, Math.min(width - 1, x + k - radius));
          const idx = (y * width + sx) * 4;
          const w = kernel[k];
          r += data[idx] * w;
          g += data[idx + 1] * w;
          b += data[idx + 2] * w;
          a += data[idx + 3] * w;
        }
        const idx = (y * width + x) * 4;
        temp[idx]     = Math.round(r);
        temp[idx + 1] = Math.round(g);
        temp[idx + 2] = Math.round(b);
        temp[idx + 3] = Math.round(a);
      }
    }

    // Vertical pass
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let r = 0, g = 0, b = 0, a = 0;
        for (let k = 0; k < kernelSize; k++) {
          const sy = Math.max(0, Math.min(height - 1, y + k - radius));
          const idx = (sy * width + x) * 4;
          const w = kernel[k];
          r += temp[idx] * w;
          g += temp[idx + 1] * w;
          b += temp[idx + 2] * w;
          a += temp[idx + 3] * w;
        }
        const idx = (y * width + x) * 4;
        data[idx]     = Math.round(r);
        data[idx + 1] = Math.round(g);
        data[idx + 2] = Math.round(b);
        data[idx + 3] = Math.round(a);
      }
    }
  }

  /**
   * Render continuous score grid on a Leaflet map with smooth DataFarm-quality
   * color gradient. Uses bilinear interpolation on the continuous score values
   * with histogram stretch for maximum contrast.
   *
   * Color ramp: dark red (low) → orange → yellow → green (high).
   *
   * @param {L.Map} map - Leaflet map instance
   * @param {number[][]} scoreGrid - Continuous score grid (0-1 values)
   * @param {L.LatLngBounds} bounds - Geographic bounds
   * @param {Object} [options={}]
   * @param {number} [options.opacity=0.7] - Pixel alpha (0-255 scale internally)
   * @param {number} [options.upscale=6] - Canvas upscale factor
   * @param {number} [options.blurRadius=3] - Gaussian blur radius
   * @param {Array<[number,number]>|null} [options.clipPolygon=null] - [[lng,lat],...] to clip
   * @returns {{ overlay: L.ImageOverlay }}
   */
  static renderScoreToMap(map, scoreGrid, bounds, options = {}) {
    const alpha = Math.round((options.opacity !== undefined ? options.opacity : 0.7) * 255);
    const upscale = options.upscale || 6;
    const blurRadius = options.blurRadius !== undefined ? options.blurRadius : 3;
    const clipCoords = options.clipPolygon || null;

    const rows = scoreGrid.length;
    const cols = scoreGrid[0].length;

    // Histogram stretch (P2 – P98)
    const flat = [];
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++) flat.push(scoreGrid[r][c]);
    flat.sort((a, b) => a - b);
    const lo = flat[Math.floor(flat.length * 0.02)];
    const hi = flat[Math.floor(flat.length * 0.98)];
    const range = hi - lo || 1;

    // Color ramp (DataFarm style)
    const stops = [
      [0.00, 150, 0, 0],
      [0.12, 200, 30, 10],
      [0.25, 230, 90, 15],
      [0.38, 240, 150, 20],
      [0.50, 230, 200, 40],
      [0.62, 180, 210, 50],
      [0.75, 100, 180, 40],
      [0.88, 40, 150, 30],
      [1.00, 15, 100, 15]
    ];
    const colorAt = (v) => {
      v = Math.max(0, Math.min(1, (v - lo) / range));
      for (let i = 0; i < stops.length - 1; i++) {
        if (v <= stops[i + 1][0]) {
          const t = (v - stops[i][0]) / (stops[i + 1][0] - stops[i][0]);
          return [
            Math.round(stops[i][1] + t * (stops[i + 1][1] - stops[i][1])),
            Math.round(stops[i][2] + t * (stops[i + 1][2] - stops[i][2])),
            Math.round(stops[i][3] + t * (stops[i + 1][3] - stops[i][3]))
          ];
        }
      }
      return [stops[stops.length - 1][1], stops[stops.length - 1][2], stops[stops.length - 1][3]];
    };

    const canvasW = cols * upscale, canvasH = rows * upscale;
    const canvas = document.createElement('canvas');
    canvas.width = canvasW;
    canvas.height = canvasH;
    const ctx = canvas.getContext('2d');
    const imgData = ctx.createImageData(canvasW, canvasH);
    const data = imgData.data;

    // Clip polygon to pixel coords
    const south = bounds.getSouth(), north = bounds.getNorth();
    const west = bounds.getWest(), east = bounds.getEast();
    let polyPx = null;
    if (clipCoords) {
      polyPx = clipCoords.map(c => [
        ((c[0] - west) / (east - west)) * canvasW,
        ((north - c[1]) / (north - south)) * canvasH
      ]);
    }
    const pip = (px, py) => {
      if (!polyPx) return true;
      let inside = false;
      for (let i = 0, j = polyPx.length - 1; i < polyPx.length; j = i++) {
        const xi = polyPx[i][0], yi = polyPx[i][1];
        const xj = polyPx[j][0], yj = polyPx[j][1];
        if (((yi > py) !== (yj > py)) && (px < (xj - xi) * (py - yi) / (yj - yi) + xi))
          inside = !inside;
      }
      return inside;
    };

    const bilinear = (grid, fi, fj) => {
      const i0 = Math.max(0, Math.floor(fi)), j0 = Math.max(0, Math.floor(fj));
      const i1 = Math.min(i0 + 1, rows - 1), j1 = Math.min(j0 + 1, cols - 1);
      const di = fi - i0, dj = fj - j0;
      return grid[i0][j0] * (1 - di) * (1 - dj) + grid[i1][j0] * di * (1 - dj) +
             grid[i0][j1] * (1 - di) * dj + grid[i1][j1] * di * dj;
    };

    for (let cy = 0; cy < canvasH; cy++) {
      const fi = (cy / canvasH) * (rows - 1);
      for (let cx = 0; cx < canvasW; cx++) {
        const fj = (cx / canvasW) * (cols - 1);
        const idx = (cy * canvasW + cx) * 4;
        if (!pip(cx, cy)) { data[idx + 3] = 0; continue; }
        const col = colorAt(bilinear(scoreGrid, fi, fj));
        data[idx] = col[0]; data[idx + 1] = col[1]; data[idx + 2] = col[2]; data[idx + 3] = alpha;
      }
    }
    ctx.putImageData(imgData, 0, 0);

    if (blurRadius > 0) {
      const bd = ctx.getImageData(0, 0, canvasW, canvasH);
      this._gaussianBlur(bd, canvasW, canvasH, blurRadius);
      ctx.putImageData(bd, 0, 0);
    }

    const overlay = L.imageOverlay(canvas.toDataURL(), bounds, { opacity: 1 }).addTo(map);
    return { overlay };
  }

  /**
   * Render management zones on a Leaflet map as a canvas overlay.
   *
   * Creates a colored canvas overlay using zone palette colors from
   * InterpolationEngine.PALETTES.zones, with bilinear upscaling, Gaussian blur
   * for smooth transitions, quadratic bezier zone boundary lines,
   * optional zone labels at each zone's centroid, and an interactive legend.
   *
   * @param {L.Map} map - Leaflet map instance
   * @param {number[][]} zoneGrid - Zone assignment grid (0-indexed)
   * @param {L.LatLngBounds} bounds - Geographic bounds for the overlay
   * @param {number} numZones - Number of zones
   * @param {Object} [options={}] - Rendering options
   * @param {number} [options.opacity=0.65] - Overlay opacity (0-1)
   * @param {boolean} [options.showLabels=true] - Show zone number labels
   * @param {L.Polygon|null} [options.clipPolygon=null] - Polygon to clip rendering
   * @param {Array<Object>|null} [options.stats=null] - Zone statistics for legend
   * @param {number} [options.renderScale=10] - Upscale factor (default 10)
   * @param {number} [options.smoothPasses=5] - Zone grid smoothing passes
   * @param {number} [options.blurRadius=2] - Gaussian blur radius in pixels
   * @returns {{ overlay: L.ImageOverlay, legend: L.Control, labels: L.LayerGroup }}
   */
  static renderZonesToMap(map, zoneGrid, bounds, numZones, options = {}) {
    const opacity = options.opacity !== undefined ? options.opacity : 0.65;
    const showLabels = options.showLabels !== undefined ? options.showLabels : true;
    const clipPolygon = options.clipPolygon || null;
    const stats = options.stats || null;
    const smoothPasses = options.smoothPasses !== undefined ? options.smoothPasses : 5;
    const blurRadius = options.blurRadius !== undefined ? options.blurRadius : 2;

    const rows = zoneGrid.length;
    const cols = zoneGrid[0].length;

    // Step 1: Smooth zone grid to remove jagged boundaries (7x7 kernel, 5 passes)
    const smoothGrid = smoothPasses > 0
      ? this._smoothZoneGrid(zoneGrid, smoothPasses, 7)
      : zoneGrid;

    // Get zone colors from InterpolationEngine palette
    const colors = InterpolationEngine.PALETTES.zones;

    // Step 2: Build per-channel grids for bilinear color interpolation
    // Each zone maps to an RGB color. We create 3 grids (R, G, B) with float
    // values so bilinear sampling blends colours smoothly at zone boundaries.
    const rGrid = [], gGrid = [], bGrid = [];
    for (let r = 0; r < rows; r++) {
      const rr = [], gg = [], bb = [];
      for (let c = 0; c < cols; c++) {
        const z = smoothGrid[r][c];
        const col = colors[z % colors.length];
        rr.push(col[0]);
        gg.push(col[1]);
        bb.push(col[2]);
      }
      rGrid.push(rr);
      gGrid.push(gg);
      bGrid.push(bb);
    }

    // Step 3: Render to high-res canvas with bilinear upscaling (DataFarm quality)
    const upscale = options.renderScale || 10;
    const canvasW = cols * upscale;
    const canvasH = rows * upscale;
    const canvas = document.createElement('canvas');
    canvas.width = canvasW;
    canvas.height = canvasH;
    const ctx = canvas.getContext('2d');
    const imgData = ctx.createImageData(canvasW, canvasH);
    const data = imgData.data;
    const alpha = Math.round(opacity * 255);

    // Bilinear sample helper (inline for performance)
    const bilinear = (grid, fi, fj) => {
      const i0 = Math.max(0, Math.floor(fi));
      const j0 = Math.max(0, Math.floor(fj));
      const i1 = Math.min(i0 + 1, rows - 1);
      const j1 = Math.min(j0 + 1, cols - 1);
      const di = fi - i0, dj = fj - j0;
      return grid[i0][j0] * (1 - di) * (1 - dj) +
             grid[i1][j0] * di * (1 - dj) +
             grid[i0][j1] * (1 - di) * dj +
             grid[i1][j1] * di * dj;
    };

    // Build polygon mask for clipping (point-in-polygon on pixel coords)
    let polyPixels = null;
    let polyBounds = null;
    if (clipPolygon) {
      polyBounds = {
        minLat: bounds.getSouth(),
        maxLat: bounds.getNorth(),
        minLng: bounds.getWest(),
        maxLng: bounds.getEast()
      };
      const latlngs = clipPolygon.getLatLngs
        ? (clipPolygon.getLatLngs()[0] || clipPolygon.getLatLngs())
        : clipPolygon;
      polyPixels = latlngs.map(ll => {
        const lat = ll.lat !== undefined ? ll.lat : ll[1];
        const lng = ll.lng !== undefined ? ll.lng : ll[0];
        return [
          ((lng - polyBounds.minLng) / (polyBounds.maxLng - polyBounds.minLng)) * canvasW,
          ((polyBounds.maxLat - lat) / (polyBounds.maxLat - polyBounds.minLat)) * canvasH
        ];
      });
    }

    // Fast pixel-level point-in-polygon (ray casting)
    const pipTest = (px, py, poly) => {
      let inside = false;
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const xi = poly[i][0], yi = poly[i][1];
        const xj = poly[j][0], yj = poly[j][1];
        if (((yi > py) !== (yj > py)) && (px < (xj - xi) * (py - yi) / (yj - yi) + xi)) {
          inside = !inside;
        }
      }
      return inside;
    };

    // Render pixel by pixel with bilinear color blending
    for (let cy = 0; cy < canvasH; cy++) {
      const fi = (cy / canvasH) * (rows - 1);
      for (let cx = 0; cx < canvasW; cx++) {
        const fj = (cx / canvasW) * (cols - 1);
        const idx = (cy * canvasW + cx) * 4;

        // Clip to polygon
        if (polyPixels && !pipTest(cx, cy, polyPixels)) {
          data[idx + 3] = 0; // transparent outside
          continue;
        }

        data[idx]     = Math.round(Math.max(0, Math.min(255, bilinear(rGrid, fi, fj))));
        data[idx + 1] = Math.round(Math.max(0, Math.min(255, bilinear(gGrid, fi, fj))));
        data[idx + 2] = Math.round(Math.max(0, Math.min(255, bilinear(bGrid, fi, fj))));
        data[idx + 3] = alpha;
      }
    }

    ctx.putImageData(imgData, 0, 0);

    // Step 3b: Apply Gaussian blur for truly smooth transitions
    if (blurRadius > 0) {
      const blurData = ctx.getImageData(0, 0, canvasW, canvasH);
      this._gaussianBlur(blurData, canvasW, canvasH, blurRadius);
      ctx.putImageData(blurData, 0, 0);
    }

    // Step 4: Draw smooth zone boundary lines using quadratic bezier curves
    const lineCanvas = document.createElement('canvas');
    lineCanvas.width = canvasW;
    lineCanvas.height = canvasH;
    const lineCtx = lineCanvas.getContext('2d');
    lineCtx.strokeStyle = 'rgba(255,255,255,0.6)';
    lineCtx.lineWidth = 1.5;
    lineCtx.lineJoin = 'round';
    lineCtx.lineCap = 'round';

    const cellW = canvasW / cols;
    const cellH = canvasH / rows;

    // Collect boundary segments, then draw them as smooth bezier paths
    // Group boundary points per zone-pair for smooth curve rendering
    const boundaryEdges = []; // { x1, y1, x2, y2 }

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const z = smoothGrid[r][c];
        // Right neighbor
        if (c < cols - 1 && smoothGrid[r][c + 1] !== z) {
          const x = (c + 1) * cellW;
          boundaryEdges.push({ x1: x, y1: r * cellH, x2: x, y2: (r + 1) * cellH });
        }
        // Bottom neighbor
        if (r < rows - 1 && smoothGrid[r + 1][c] !== z) {
          const y = (r + 1) * cellH;
          boundaryEdges.push({ x1: c * cellW, y1: y, x2: (c + 1) * cellW, y2: y });
        }
      }
    }

    // Chain connected edges into polylines for smoother rendering
    const chains = this._chainBoundaryEdges(boundaryEdges);

    for (const chain of chains) {
      if (chain.length < 2) continue;

      lineCtx.beginPath();

      if (chain.length === 2) {
        // Simple line
        lineCtx.moveTo(chain[0][0], chain[0][1]);
        lineCtx.lineTo(chain[1][0], chain[1][1]);
      } else {
        // Smooth curve using quadratic bezier through midpoints
        lineCtx.moveTo(chain[0][0], chain[0][1]);

        for (let i = 0; i < chain.length - 1; i++) {
          const curr = chain[i];
          const next = chain[i + 1];

          if (i < chain.length - 2) {
            // Control point is the current vertex, endpoint is midpoint to next
            const midX = (curr[0] + next[0]) / 2;
            const midY = (curr[1] + next[1]) / 2;

            if (i === 0) {
              // First segment: line to first midpoint
              lineCtx.lineTo(midX, midY);
            } else {
              lineCtx.quadraticCurveTo(curr[0], curr[1], midX, midY);
            }
          } else {
            // Last segment
            lineCtx.quadraticCurveTo(curr[0], curr[1], next[0], next[1]);
          }
        }
      }
      lineCtx.stroke();
    }

    // Composite boundary lines onto main canvas
    ctx.drawImage(lineCanvas, 0, 0);

    // Create image overlay
    const overlay = L.imageOverlay(canvas.toDataURL('image/png'), bounds, { opacity: 1.0 });
    overlay.addTo(map);

    // Zone labels at centroids
    const labelGroup = L.layerGroup();
    if (showLabels) {
      for (let z = 0; z < numZones; z++) {
        // Find centroid of zone
        let sumR = 0, sumC = 0, count = 0;
        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < cols; c++) {
            if (zoneGrid[r][c] === z) {
              sumR += r;
              sumC += c;
              count++;
            }
          }
        }

        if (count === 0) continue;

        const centR = sumR / count;
        const centC = sumC / count;
        const latStep = (bounds.getNorth() - bounds.getSouth()) / rows;
        const lngStep = (bounds.getEast() - bounds.getWest()) / cols;
        const lat = bounds.getNorth() - centR * latStep;
        const lng = bounds.getWest() + centC * lngStep;

        const labelText = `Z${z + 1}`;
        const icon = L.divIcon({
          className: 'zone-label',
          html: `<div style="
            background: rgba(255,255,255,0.85);
            border: 2px solid rgba(0,0,0,0.5);
            border-radius: 50%;
            width: 32px; height: 32px;
            display: flex; align-items: center; justify-content: center;
            font-weight: bold; font-size: 13px; color: #333;
            box-shadow: 0 1px 4px rgba(0,0,0,0.3);
          ">${labelText}</div>`,
          iconSize: [32, 32],
          iconAnchor: [16, 16]
        });
        L.marker([lat, lng], { icon, interactive: false }).addTo(labelGroup);
      }
      labelGroup.addTo(map);
    }

    // Legend control
    const legend = L.control({ position: 'bottomright' });
    legend.onAdd = function () {
      const div = L.DomUtil.create('div', 'info legend zones-legend');
      div.style.cssText = 'background:white; padding:10px 14px; border-radius:8px; box-shadow:0 2px 8px rgba(0,0,0,0.2); font-size:12px; line-height:1.6;';

      let html = '<div style="font-weight:bold; margin-bottom:6px; font-size:13px;">Zonas de Manejo</div>';
      for (let z = 0; z < numZones; z++) {
        const color = colors[z % colors.length];
        const potential = stats && stats[z] ? ` — ${stats[z].potential || stats[z].clase || ''}` : '';
        const meanStr = stats && stats[z] ? ` (${stats[z].score_prom !== undefined ? 'score=' + stats[z].score_prom : '\u03bc=' + stats[z].mean})` : '';
        html += `<div style="display:flex; align-items:center; margin:2px 0;">
          <span style="display:inline-block; width:16px; height:16px; border-radius:3px; margin-right:8px;
            background:rgb(${color[0]},${color[1]},${color[2]}); border:1px solid rgba(0,0,0,0.15);"></span>
          Zona ${z + 1}${meanStr}${potential}
        </div>`;
      }
      div.innerHTML = html;
      return div;
    };
    legend.addTo(map);

    return { overlay, legend, labels: labelGroup };
  }

  /**
   * Chain connected boundary edge segments into polylines for smooth curve rendering.
   * @param {Array<{x1:number, y1:number, x2:number, y2:number}>} edges
   * @returns {Array<Array<[number,number]>>} Array of polyline point arrays
   */
  static _chainBoundaryEdges(edges) {
    if (edges.length === 0) return [];

    // Build adjacency: endpoint -> list of edge indices
    const key = (x, y) => `${Math.round(x * 10)},${Math.round(y * 10)}`;
    const adj = {};
    const used = new Array(edges.length).fill(false);

    for (let i = 0; i < edges.length; i++) {
      const e = edges[i];
      const k1 = key(e.x1, e.y1);
      const k2 = key(e.x2, e.y2);
      if (!adj[k1]) adj[k1] = [];
      if (!adj[k2]) adj[k2] = [];
      adj[k1].push(i);
      adj[k2].push(i);
    }

    const chains = [];

    for (let start = 0; start < edges.length; start++) {
      if (used[start]) continue;
      used[start] = true;

      const e = edges[start];
      const chain = [[e.x1, e.y1], [e.x2, e.y2]];

      // Extend chain forward
      let extending = true;
      while (extending) {
        extending = false;
        const tail = chain[chain.length - 1];
        const k = key(tail[0], tail[1]);
        const neighbors = adj[k] || [];
        for (const ni of neighbors) {
          if (used[ni]) continue;
          used[ni] = true;
          const ne = edges[ni];
          const k1 = key(ne.x1, ne.y1);
          if (k1 === k) {
            chain.push([ne.x2, ne.y2]);
          } else {
            chain.push([ne.x1, ne.y1]);
          }
          extending = true;
          break;
        }
      }

      // Extend chain backward
      extending = true;
      while (extending) {
        extending = false;
        const head = chain[0];
        const k = key(head[0], head[1]);
        const neighbors = adj[k] || [];
        for (const ni of neighbors) {
          if (used[ni]) continue;
          used[ni] = true;
          const ne = edges[ni];
          const k1 = key(ne.x1, ne.y1);
          if (k1 === k) {
            chain.unshift([ne.x2, ne.y2]);
          } else {
            chain.unshift([ne.x1, ne.y1]);
          }
          extending = true;
          break;
        }
      }

      // Only keep chains with at least 2 points
      if (chain.length >= 2) {
        chains.push(chain);
      }
    }

    return chains;
  }

  // ==================== COMBINED ZONE GENERATION ====================

  /**
   * Full management zone generation pipeline.
   *
   * If satellite data is available (config.satelliteData), uses the satellite-based
   * Score Compuesto Ponderado pipeline (generateFromSatellite). Otherwise falls back
   * to soil-based K-Means clustering.
   *
   * @param {Object} config - Configuration object
   * @param {Array<{ lat: number, lng: number, soilData: Object }>} config.samples - Soil sample points
   * @param {Array<[number,number]>} config.boundary - Polygon boundary coordinates
   * @param {{ minLat: number, maxLat: number, minLng: number, maxLng: number }} config.bounds - Geographic bounds
   * @param {string[]|'auto'} config.variables - Variable names to use, or 'auto' for crop-based selection
   * @param {string} [config.cropId] - Crop identifier (required when variables='auto')
   * @param {number} config.numZones - Number of management zones (2-7)
   * @param {'idw'|'kriging'} [config.method='idw'] - Interpolation method
   * @param {number} [config.resolution=80] - Grid resolution
   * @param {number[][][]|null} [config.campaignData=null] - Historical campaign grids for temporal stability
   * @param {number[][]|null} [config.demData=null] - DEM grid for TWI calculation
   * @param {number} [config.demCellSize=10] - DEM cell size in meters
   * @param {number[]|null} [config.weights=null] - Per-variable weights
   * @param {Object|null} [config.satelliteData=null] - Satellite data for primary pipeline
   * @param {number} [config.areaHa] - Field area in hectares (needed for satellite pipeline)
   * @returns {{
   *   zoneGrid: number[][],
   *   stats: Array<Object>,
   *   layers: Array<{ name: string, grid: number[][] }>,
   *   numZones: number,
   *   geojson: Object,
   *   csv: string,
   *   temporalStability: Object|null,
   *   twi: Object|null,
   *   metadata: Object
   * }}
   */
  static generateManagementZones(config) {
    // --- Primary path: satellite-based pipeline ---
    if (config.satelliteData) {
      console.log('ZonesEngine: Using satellite-based Score Compuesto Ponderado pipeline (recommended).');
      return this.generateFromSatellite(config);
    }

    // --- Fallback: soil data K-Means clustering ---
    console.warn(
      'ZonesEngine: WARNING - No satellite data provided. Falling back to soil-based K-Means clustering. ' +
      'This approach is less reliable than satellite + topography. Provide satelliteData for best results.'
    );

    const {
      samples,
      boundary,
      bounds,
      numZones,
      method = 'idw',
      resolution = 200,
      campaignData = null,
      demData = null,
      demCellSize = 10,
      weights = null
    } = config;

    let { variables, cropId } = config;

    // Validate inputs
    if (!samples || samples.length === 0) {
      throw new Error('ZonesEngine: samples array is required');
    }
    if (numZones < 2 || numZones > 7) {
      throw new Error('ZonesEngine: numZones must be between 2 and 7');
    }

    // Resolve 'auto' variables from crop profile
    if (variables === 'auto') {
      if (!cropId || !this.CROP_PROFILES[cropId]) {
        throw new Error(`ZonesEngine: valid cropId required when variables='auto'. Available: ${Object.keys(this.CROP_PROFILES).join(', ')}`);
      }
      const profile = this.CROP_PROFILES[cropId];
      const allIndices = new Set();
      for (const stage of Object.values(profile)) {
        for (const idx of stage) allIndices.add(idx);
      }
      variables = Array.from(allIndices);
    }

    // ---- Step 1: Interpolate each variable ----
    const layers = [];

    for (const varName of variables) {
      // Extract points for this variable from soil data
      const points = [];
      for (const s of samples) {
        const value = s.soilData ? s.soilData[varName] : undefined;
        if (value !== undefined && value !== null && !isNaN(value)) {
          points.push({ lat: s.lat, lng: s.lng, value: Number(value) });
        }
      }

      if (points.length < 2) {
        console.warn(`ZonesEngine: skipping variable '${varName}' — insufficient data points (${points.length})`);
        continue;
      }

      let result;
      if (method === 'kriging' && typeof KrigingEngine !== 'undefined') {
        // Use Kriging interpolation
        const variogram = KrigingEngine.fitVariogram(
          points.map(p => p.value),
          points.map(p => p.lat),
          points.map(p => p.lng),
          'spherical'
        );
        result = KrigingEngine.interpolateGrid(variogram, bounds, resolution);
      } else {
        // Use IDW interpolation (default)
        result = InterpolationEngine.interpolateIDW(points, bounds, { resolution });
      }

      if (result && result.grid) {
        layers.push({ name: varName, grid: result.grid });
      }
    }

    if (layers.length === 0) {
      throw new Error('ZonesEngine: no valid layers could be interpolated from the provided data');
    }

    // ---- Step 2: Optional temporal stability layer ----
    let temporalResult = null;
    if (campaignData && campaignData.length >= 3) {
      temporalResult = this.temporalStability(campaignData);
      // Resample stability grid to match resolution if needed
      const stabGrid = this._resampleGrid(temporalResult.stabilityGrid, layers[0].grid.length, layers[0].grid[0].length);
      layers.push({ name: 'temporal_stability', grid: stabGrid });
    }

    // ---- Step 3: Optional TWI layer ----
    let twiResult = null;
    if (demData) {
      twiResult = this.calculateTWI(demData, demCellSize);
      const twiGrid = this._resampleGrid(twiResult.twiGrid, layers[0].grid.length, layers[0].grid[0].length);
      layers.push({ name: 'TWI', grid: twiGrid });
    }

    // ---- Step 4: Multi-variable clustering ----
    const clusterResult = this.multiVariableCluster(layers, numZones, weights);

    // ---- Step 5: Order zones by mean (using first layer as reference) ----
    const orderedGrid = this.orderZonesByMean(clusterResult.zoneGrid, layers[0].grid, numZones);

    // ---- Step 5b: Smooth zone boundaries (improved majority filter) ----
    let smoothedGrid = this._smoothZoneGrid(orderedGrid, 5, 7);

    // Morphological close to fill gaps
    smoothedGrid = this._morphologicalClose(smoothedGrid, numZones);

    // ---- Step 6: Calculate statistics (use smoothed grid for accurate area) ----
    const stats = this.zoneStatistics(layers[0].grid, smoothedGrid, numZones);

    // ---- Step 7: Generate exports ----
    const geojson = this.zonesToGeoJSON(smoothedGrid, bounds, numZones, stats);
    const csv = this.zonesToCSV(stats);

    return {
      zoneGrid: smoothedGrid,
      zoneGridRaw: orderedGrid,
      stats,
      layers,
      numZones,
      geojson,
      csv,
      temporalStability: temporalResult,
      twi: twiResult,
      metadata: {
        variables: layers.map(l => l.name),
        method: 'soil_kmeans_fallback',
        resolution,
        cropId: cropId || null,
        iterations: clusterResult.iterations,
        wcss: Math.round(clusterResult.wcss * 1000) / 1000,
        timestamp: new Date().toISOString()
      }
    };
  }

  // ==================== INTERNAL UTILITIES ====================

  /**
   * Resample a 2D grid to a target size using bilinear interpolation.
   *
   * @param {number[][]} grid - Source grid
   * @param {number} targetRows - Target number of rows
   * @param {number} targetCols - Target number of columns
   * @returns {number[][]} Resampled grid
   */
  static _resampleGrid(grid, targetRows, targetCols) {
    const srcRows = grid.length;
    const srcCols = grid[0].length;

    if (srcRows === targetRows && srcCols === targetCols) return grid;

    const result = Array.from({ length: targetRows }, () => new Array(targetCols));

    for (let r = 0; r < targetRows; r++) {
      for (let c = 0; c < targetCols; c++) {
        // Map target coords back to source
        const srcR = (r / targetRows) * srcRows;
        const srcC = (c / targetCols) * srcCols;

        const r0 = Math.floor(srcR);
        const c0 = Math.floor(srcC);
        const r1 = Math.min(r0 + 1, srcRows - 1);
        const c1 = Math.min(c0 + 1, srcCols - 1);

        const dr = srcR - r0;
        const dc = srcC - c0;

        // Bilinear interpolation
        result[r][c] =
          grid[r0][c0] * (1 - dr) * (1 - dc) +
          grid[r0][c1] * (1 - dr) * dc +
          grid[r1][c0] * dr * (1 - dc) +
          grid[r1][c1] * dr * dc;
      }
    }

    return result;
  }

  /**
   * Determine optimal number of zones using the elbow method.
   *
   * Runs K-Means for k=2..maxK, computes WCSS for each, and finds the
   * "elbow" point where adding more clusters yields diminishing returns.
   *
   * @param {Array<{ name: string, grid: number[][] }>} layers - Raster layers
   * @param {number} [maxK=7] - Maximum number of clusters to test
   * @returns {{ optimalK: number, wcssValues: number[] }}
   */
  static findOptimalZones(layers, maxK = 7) {
    const rows = layers[0].grid.length;
    const cols = layers[0].grid[0].length;
    const numLayers = layers.length;

    // Prepare normalized feature vectors once
    const normalizedFlat = [];
    for (let l = 0; l < numLayers; l++) {
      const flat = [];
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          flat.push(layers[l].grid[r][c]);
        }
      }
      normalizedFlat.push(this._zNormalize(flat).normalized);
    }

    const totalPixels = rows * cols;
    // Subsample for performance if grid is large
    const maxSamples = 5000;
    let featureVectors;

    if (totalPixels > maxSamples) {
      const step = Math.ceil(totalPixels / maxSamples);
      featureVectors = [];
      for (let i = 0; i < totalPixels; i += step) {
        const vec = new Array(numLayers);
        for (let l = 0; l < numLayers; l++) vec[l] = normalizedFlat[l][i];
        featureVectors.push(vec);
      }
    } else {
      featureVectors = new Array(totalPixels);
      for (let i = 0; i < totalPixels; i++) {
        const vec = new Array(numLayers);
        for (let l = 0; l < numLayers; l++) vec[l] = normalizedFlat[l][i];
        featureVectors[i] = vec;
      }
    }

    // Run K-Means for each k
    const wcssValues = [];
    for (let k = 2; k <= maxK; k++) {
      const result = this.kMeans(featureVectors, k, 50);
      wcssValues.push(result.wcss);
    }

    // Find elbow using maximum curvature
    let optimalK = 2;
    let maxCurvature = 0;

    for (let i = 1; i < wcssValues.length - 1; i++) {
      const curvature = wcssValues[i - 1] - 2 * wcssValues[i] + wcssValues[i + 1];
      if (curvature > maxCurvature) {
        maxCurvature = curvature;
        optimalK = i + 2; // k starts at 2
      }
    }

    return { optimalK, wcssValues };
  }

  /**
   * Generate a prescription map from management zones and crop-specific dosage rules.
   *
   * Uses zone statistics and crop requirements from CROPS_DB to calculate
   * variable-rate application doses per zone.
   *
   * @param {number[][]} zoneGrid - Zone assignment grid (0-indexed)
   * @param {Array<Object>} stats - Zone statistics
   * @param {string} cropId - Crop identifier from CROPS_DB
   * @param {string} nutrient - Nutrient variable name (e.g. 'P', 'K', 'N')
   * @param {number} numZones - Number of zones
   * @returns {{ prescriptionGrid: number[][], dosesPerZone: number[], totalDose: number, unit: string }}
   */
  /**
   * Generate a prescription map from management zones with DataFarm-style dose calculation.
   * Uses crop extraction rates, yield profiles, soil classification, and response curves.
   *
   * @param {number[][]} zoneGrid - Zone assignment grid (0-indexed)
   * @param {Array<Object>} stats - Zone statistics (with .mean property)
   * @param {string} cropId - Crop identifier from CROPS_DB
   * @param {string} nutrient - Soil nutrient (e.g. 'P', 'K', 'Ca', 'Mg', 'S')
   * @param {number} numZones - Number of zones
   * @param {Object} [options] - Additional options
   * @param {number} [options.yieldTarget] - Yield target (defaults to crop.defaultYield)
   * @param {string} [options.managementType='normal'] - 'corrective'|'normal'|'maintenance'
   * @returns {{ prescriptionGrid, dosesPerZone, totalDose, unit, warnings }}
   */
  static zonesToPrescription(zoneGrid, stats, cropId, nutrient, numZones, options = {}) {
    const rows = zoneGrid.length;
    const cols = zoneGrid[0].length;
    const warnings = [];

    // Look up crop requirements from CROPS_DB
    const cropDef = typeof CROPS_DB !== 'undefined' ? CROPS_DB[cropId] : null;
    const unit = 'kg/ha';

    // Nutrient key mapping (soil key → fertilizer key)
    const nutrientToFert = { 'P': 'P2O5', 'K': 'K2O' };
    const fertKey = nutrientToFert[nutrient] || nutrient;

    // Yield-adjusted extraction
    const yieldTarget = options.yieldTarget || (cropDef ? cropDef.defaultYield : 1);
    let extractionMult = 1.0, efficiencyMult = 1.0;
    if (cropDef && typeof InterpretationEngine !== 'undefined' && InterpretationEngine.getYieldProfile) {
      const profile = InterpretationEngine.getYieldProfile(cropDef, yieldTarget);
      extractionMult = profile.extractionMult;
      efficiencyMult = profile.efficiencyMult;
    }

    const baseExtraction = cropDef ? (cropDef.extraction[fertKey] || 0) : 0;
    const totalExtraction = baseExtraction * extractionMult * yieldTarget;
    const baseEfficiency = cropDef ? (cropDef.efficiency[fertKey] || 0.50) : 0.50;
    const efficiency = Math.max(0.10, Math.min(0.95, baseEfficiency * efficiencyMult));

    // Management type multiplier (DataFarm methodology)
    const mgmtType = options.managementType || 'normal';
    const mgmtMult = { corrective: 1.3, normal: 1.0, maintenance: 0.7 }[mgmtType] || 1.0;

    // Supply factors by soil classification
    const supplyFactors = { mb: 0.0, b: 0.15, m: 0.40, a: 0.70, ma: 1.0 };

    // Dose safety limits
    const safetyMax = { N: 200, P2O5: 250, K2O: 200, Ca: 3000, Mg: 500, S: 80 }[fertKey] || 500;

    // Calculate dose per zone using soil class response curve
    const dosesPerZone = new Array(numZones).fill(0);
    let totalDose = 0;
    let totalPixels = 0;

    for (let z = 0; z < numZones; z++) {
      const zoneStat = stats[z];
      if (!zoneStat || (zoneStat.pixelCount || 0) === 0) continue;

      if (cropDef && totalExtraction > 0) {
        // Classify zone mean value to get supply factor
        const cls = typeof InterpretationEngine !== 'undefined'
          ? InterpretationEngine.classifySoil(nutrient, zoneStat.mean || 0, cropId)
          : { class: 'm' };

        const supplyFactor = supplyFactors[cls.class] !== undefined ? supplyFactors[cls.class] : 0.3;
        const soilSupply = totalExtraction * supplyFactor;
        const netNeed = Math.max(0, totalExtraction - soilSupply);
        let dose = (netNeed / efficiency) * mgmtMult;
        dose = Math.max(0, Math.min(safetyMax, dose));
        dosesPerZone[z] = Math.round(dose * 10) / 10;
      } else {
        // Fallback: inverse ranking (low zone = high dose, scaled 0-100)
        const rank = z / Math.max(numZones - 1, 1);
        dosesPerZone[z] = Math.round((1 - rank) * 100) / 100;
      }

      totalDose += dosesPerZone[z] * (zoneStat.pixelCount || 1);
      totalPixels += (zoneStat.pixelCount || 1);
    }

    // Warn if any zone hits safety cap
    if (dosesPerZone.some(d => d >= safetyMax * 0.99)) {
      warnings.push(`Dosis alcanzó límite de seguridad (${safetyMax} kg/ha ${fertKey}). Verificar con agrónomo.`);
    }

    // Build prescription grid
    const prescriptionGrid = Array.from({ length: rows }, () => new Array(cols));
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        prescriptionGrid[r][c] = dosesPerZone[zoneGrid[r][c]];
      }
    }

    return {
      prescriptionGrid,
      dosesPerZone,
      totalDose: totalPixels > 0 ? Math.round(totalDose / totalPixels * 100) / 100 : 0,
      unit,
      managementType: mgmtType,
      yieldTarget,
      warnings
    };
  }

  /**
   * Validate zone configuration before running generation.
   *
   * @param {Object} config - Same config object as generateManagementZones
   * @returns {{ valid: boolean, errors: string[], warnings: string[] }}
   */
  static validateConfig(config) {
    const errors = [];
    const warnings = [];

    // Satellite-based pipeline validation
    if (config.satelliteData) {
      const sd = config.satelliteData;
      if (!sd.ndviCampaigns || sd.ndviCampaigns.length < 3) {
        errors.push('Se requieren al menos 3 campanas de NDVI para el pipeline satelital');
      }
      if (!sd.ndreCampaigns || sd.ndreCampaigns.length < 3) {
        errors.push('Se requieren al menos 3 campanas de NDRE para el pipeline satelital');
      }
      if (!sd.dem) {
        errors.push('Se requiere DEM para el pipeline satelital');
      }
      if (!config.bounds) {
        errors.push('Se requieren limites geograficos (bounds)');
      }
      if (!config.areaHa) {
        warnings.push('areaHa no proporcionado — se estimara automaticamente');
      }
      return { valid: errors.length === 0, errors, warnings };
    }

    // Soil-based pipeline validation
    if (!config.samples || config.samples.length === 0) {
      errors.push('Se requieren muestras de suelo (samples) o datos satelitales (satelliteData)');
    } else if (config.samples.length < 3) {
      warnings.push(`Solo ${config.samples.length} muestras — se recomienda un minimo de 10 para resultados confiables`);
    } else if (config.samples.length < 10) {
      warnings.push(`${config.samples.length} muestras disponibles — resultados pueden ser limitados`);
    }

    if (!config.bounds) {
      errors.push('Se requieren limites geograficos (bounds)');
    }

    if (config.numZones !== undefined && (config.numZones < 2 || config.numZones > 7)) {
      errors.push('numZones debe estar entre 2 y 7');
    }

    if (config.variables === 'auto' && !config.cropId) {
      errors.push('Se requiere cropId cuando variables es "auto"');
    }

    if (config.variables === 'auto' && config.cropId && !this.CROP_PROFILES[config.cropId]) {
      errors.push(`Cultivo "${config.cropId}" no tiene perfil de indices definido`);
    }

    if (config.campaignData && config.campaignData.length > 0 && config.campaignData.length < 3) {
      warnings.push(`Solo ${config.campaignData.length} campanas — se requieren minimo 3 para analisis temporal`);
    }

    if (config.method === 'kriging' && typeof KrigingEngine === 'undefined') {
      warnings.push('KrigingEngine no disponible — se usara IDW como fallback');
    }

    warnings.push('Se recomienda usar datos satelitales (satelliteData) en lugar de muestras de suelo para mejor precision');

    return { valid: errors.length === 0, errors, warnings };
  }

  // ==================== S4.4 — cLHS (CONDITIONED LATIN HYPERCUBE SAMPLING) ====================

  /**
   * Conditioned Latin Hypercube Sampling (cLHS).
   *
   * Selects a spatially and statistically representative subset of points such that
   * the marginal distributions of all variables and their correlation structure match
   * the full population as closely as possible.
   *
   * Algorithm (Minasny & McBratney 2006):
   *   1. Randomly draw nSamples points as initial sample.
   *   2. Repeatedly try swapping one sample point with one non-sample point.
   *   3. Accept swaps that decrease the objective function.
   *   4. Objective = marginal criterion + correlation criterion.
   *
   * Marginal criterion:
   *   For each variable, partition the population into nSamples equal-frequency
   *   quantile classes.  For each class, count how many sample points fall in it.
   *   The ideal count is exactly 1.  Penalty = sum over all classes of |count - 1|.
   *
   * Correlation criterion:
   *   Frobenius norm of (R_sample − R_population), where R is the Pearson
   *   correlation matrix of the attribute columns.
   *
   * @param {Array<{lat: number, lng: number, [attr: string]: number}>} points
   *   Full population of points.  Every point must share the same set of numeric
   *   attributes beyond lat/lng (e.g. ndvi, elevation, clay).
   * @param {number} nSamples - Number of points to select.
   * @param {number} [maxIterations=10000] - Simulated-annealing-free iteration budget.
   * @returns {{
   *   samples: Array<{lat: number, lng: number, [attr: string]: number}>,
   *   indices: number[],
   *   finalObjective: number,
   *   iterations: number
   * }}
   */
  static cLHS(points, nSamples, maxIterations = 10000) {
    const n = points.length;
    if (nSamples >= n) {
      return { samples: [...points], indices: points.map((_, i) => i), finalObjective: 0, iterations: 0 };
    }
    if (nSamples < 1) throw new Error('cLHS: nSamples must be >= 1');

    // --- Extract attribute names (exclude spatial coords) ---
    const attrs = Object.keys(points[0]).filter(k => k !== 'lat' && k !== 'lng');
    const nAttr = attrs.length;
    if (nAttr === 0) throw new Error('cLHS: points must have at least one numeric attribute');

    // --- Build attribute matrix [n × nAttr] ---
    // attrMatrix[i][j] = value of attr j for point i
    const attrMatrix = points.map(p => attrs.map(a => p[a]));

    // --- Pre-compute population quantile class boundaries ---
    // For each variable, sort the population values and define nSamples equal-frequency bins.
    // classOf[j][i] = which bin (0..nSamples-1) population point i falls in for attr j.
    const classOf = [];
    for (let j = 0; j < nAttr; j++) {
      const sorted = attrMatrix.map((row, idx) => ({ v: row[j], idx }))
                               .sort((a, b) => a.v - b.v);
      const binAssign = new Int32Array(n);
      sorted.forEach(({ idx }, rank) => {
        binAssign[idx] = Math.min(Math.floor(rank * nSamples / n), nSamples - 1);
      });
      classOf.push(binAssign);
    }

    // --- Pre-compute population correlation matrix ---
    const popCorr = this._correlationMatrix(attrMatrix, nAttr);

    // --- Helper: compute objective for a given sample index set ---
    // sampleSet: Set<number> of indices
    const computeObjective = (sampleSet) => {
      const sampleIdxArr = [...sampleSet];
      const m = sampleIdxArr.length;

      // Marginal criterion
      let marginal = 0;
      for (let j = 0; j < nAttr; j++) {
        const binCount = new Int32Array(nSamples);
        for (const i of sampleIdxArr) {
          binCount[classOf[j][i]]++;
        }
        for (let b = 0; b < nSamples; b++) {
          marginal += Math.abs(binCount[b] - 1);
        }
      }

      // Correlation criterion — Frobenius norm of (R_sample - R_pop)
      const sampMatrix = sampleIdxArr.map(i => attrMatrix[i]);
      const sampCorr = this._correlationMatrix(sampMatrix, nAttr);
      let corrObj = 0;
      for (let a = 0; a < nAttr; a++) {
        for (let b = 0; b < nAttr; b++) {
          const diff = sampCorr[a][b] - popCorr[a][b];
          corrObj += diff * diff;
        }
      }
      corrObj = Math.sqrt(corrObj); // Frobenius norm

      return marginal + corrObj;
    };

    // --- Initialize: random sample without replacement ---
    const rng = this._seededRandom(12345);
    const allIndices = Array.from({ length: n }, (_, i) => i);
    // Fisher-Yates partial shuffle for initial sample
    for (let i = 0; i < nSamples; i++) {
      const j = i + Math.floor(rng() * (n - i));
      [allIndices[i], allIndices[j]] = [allIndices[j], allIndices[i]];
    }

    const sampleSet = new Set(allIndices.slice(0, nSamples));
    const nonSampleSet = new Set(allIndices.slice(nSamples));

    let currentObj = computeObjective(sampleSet);
    let iters = 0;

    // --- Iterative improvement ---
    const sampleArr = [...sampleSet];    // maintained in sync with sampleSet
    const nonSampleArr = [...nonSampleSet];

    for (let iter = 0; iter < maxIterations; iter++) {
      iters = iter + 1;

      // Pick one random sample point and one random non-sample point
      const si = Math.floor(rng() * sampleArr.length);
      const ni = Math.floor(rng() * nonSampleArr.length);
      const swapOut = sampleArr[si];
      const swapIn  = nonSampleArr[ni];

      // Apply swap tentatively
      sampleSet.delete(swapOut);
      sampleSet.add(swapIn);

      const newObj = computeObjective(sampleSet);

      if (newObj < currentObj) {
        // Accept swap: update arrays
        currentObj = newObj;
        sampleArr[si] = swapIn;
        nonSampleArr[ni] = swapOut;
      } else {
        // Reject swap: revert the set
        sampleSet.delete(swapIn);
        sampleSet.add(swapOut);
      }

      if (currentObj === 0) break; // Perfect solution found
    }

    const finalIndices = [...sampleSet];
    return {
      samples: finalIndices.map(i => points[i]),
      indices: finalIndices,
      finalObjective: currentObj,
      iterations: iters
    };
  }

  /**
   * Compute Pearson correlation matrix for a data matrix (rows=observations, cols=variables).
   * Returns an nAttr × nAttr matrix of correlation coefficients.
   * @param {number[][]} matrix
   * @param {number} nAttr
   * @returns {number[][]}
   * @private
   */
  static _correlationMatrix(matrix, nAttr) {
    const n = matrix.length;
    const corr = Array.from({ length: nAttr }, () => new Float64Array(nAttr));

    if (n < 2) {
      // Can't compute correlation; return identity
      for (let i = 0; i < nAttr; i++) corr[i][i] = 1;
      return corr;
    }

    // Compute means
    const means = new Float64Array(nAttr);
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < nAttr; j++) {
        means[j] += matrix[i][j];
      }
    }
    for (let j = 0; j < nAttr; j++) means[j] /= n;

    // Compute standard deviations (population std)
    const stds = new Float64Array(nAttr);
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < nAttr; j++) {
        const d = matrix[i][j] - means[j];
        stds[j] += d * d;
      }
    }
    for (let j = 0; j < nAttr; j++) stds[j] = Math.sqrt(stds[j] / n);

    // Compute correlations
    for (let a = 0; a < nAttr; a++) {
      corr[a][a] = 1;
      for (let b = a + 1; b < nAttr; b++) {
        if (stds[a] === 0 || stds[b] === 0) {
          corr[a][b] = 0;
          corr[b][a] = 0;
          continue;
        }
        let cov = 0;
        for (let i = 0; i < n; i++) {
          cov += (matrix[i][a] - means[a]) * (matrix[i][b] - means[b]);
        }
        cov /= n;
        const r = cov / (stds[a] * stds[b]);
        corr[a][b] = r;
        corr[b][a] = r;
      }
    }

    return corr;
  }

  // ==================== S4.5 — ADAPTIVE PCA MULTI-TEMPORAL ====================

  /**
   * Adaptive PCA for multi-temporal campaign data.
   *
   * Builds a joint feature matrix across all campaigns, standardizes it,
   * and extracts principal components (PCs) using the power iteration method.
   * Returns all PCs that together explain ≥80 % of total variance, along with
   * their loadings — ready to use as clustering input features.
   *
   * @param {Array<{points: Array<{lat: number, lng: number, values: Object}>}>} campaigns
   *   Each campaign is an object with a `points` array.  Every point must expose a
   *   `values` object whose keys are nutrient/index names.  All campaigns must
   *   reference the same spatial points in the same order.
   * @returns {{
   *   scores: number[][],          // [nPoints × nComponents] — PC scores per point
   *   loadings: number[][],        // [nComponents × nFeatures] — eigenvector loadings
   *   explainedVariance: number[], // Fraction of total variance explained by each PC
   *   cumulativeVariance: number[],// Cumulative explained variance
   *   featureNames: string[],      // Column labels: "<nutrient>_campaign<i>"
   *   nComponents: number          // Number of PCs retained (explain ≥80 % variance)
   * }}
   */
  static adaptivePCA(campaigns) {
    if (!campaigns || campaigns.length === 0) throw new Error('adaptivePCA: campaigns array is empty');

    const nCampaigns = campaigns.length;
    const nPoints = campaigns[0].points.length;

    // Collect the union of nutrient keys across all campaigns
    const nutrientSet = new Set();
    for (const campaign of campaigns) {
      for (const pt of campaign.points) {
        Object.keys(pt.values).forEach(k => nutrientSet.add(k));
      }
    }
    const nutrients = [...nutrientSet].sort();
    const nNutrients = nutrients.length;

    // Build feature names: "<nutrient>_campaign0", "<nutrient>_campaign1", ...
    const featureNames = [];
    for (let c = 0; c < nCampaigns; c++) {
      for (const nut of nutrients) {
        featureNames.push(`${nut}_campaign${c}`);
      }
    }
    const nFeatures = featureNames.length; // nNutrients × nCampaigns

    // --- Build raw data matrix [nPoints × nFeatures] ---
    // Missing values are filled with column mean (computed in the standardization step)
    const X = Array.from({ length: nPoints }, () => new Float64Array(nFeatures));
    const missing = Array.from({ length: nPoints }, () => new Uint8Array(nFeatures)); // 1 = missing

    for (let c = 0; c < nCampaigns; c++) {
      const pts = campaigns[c].points;
      for (let i = 0; i < nPoints; i++) {
        const vals = pts[i] ? pts[i].values : {};
        for (let ni = 0; ni < nNutrients; ni++) {
          const colIdx = c * nNutrients + ni;
          const v = vals[nutrients[ni]];
          if (v === undefined || v === null || isNaN(v)) {
            missing[i][colIdx] = 1;
          } else {
            X[i][colIdx] = v;
          }
        }
      }
    }

    // --- Standardize columns (z-scores): subtract mean, divide by std ---
    // Missing cells use the column mean (treated as 0 after centering)
    const colMeans = new Float64Array(nFeatures);
    const colStds  = new Float64Array(nFeatures);

    for (let f = 0; f < nFeatures; f++) {
      let sum = 0, count = 0;
      for (let i = 0; i < nPoints; i++) {
        if (!missing[i][f]) { sum += X[i][f]; count++; }
      }
      colMeans[f] = count > 0 ? sum / count : 0;
    }

    for (let f = 0; f < nFeatures; f++) {
      let ss = 0, count = 0;
      for (let i = 0; i < nPoints; i++) {
        if (!missing[i][f]) {
          const d = X[i][f] - colMeans[f];
          ss += d * d;
          count++;
        }
      }
      colStds[f] = count > 1 ? Math.sqrt(ss / (count - 1)) : 1;
      if (colStds[f] === 0) colStds[f] = 1; // Constant column — avoid divide-by-zero
    }

    // Apply standardization (missing → 0 after centering)
    for (let i = 0; i < nPoints; i++) {
      for (let f = 0; f < nFeatures; f++) {
        X[i][f] = missing[i][f] ? 0 : (X[i][f] - colMeans[f]) / colStds[f];
      }
    }

    // --- Compute covariance matrix C [nFeatures × nFeatures] ---
    // C = (X^T × X) / (nPoints - 1)
    const C = Array.from({ length: nFeatures }, () => new Float64Array(nFeatures));
    const denom = Math.max(nPoints - 1, 1);
    for (let i = 0; i < nPoints; i++) {
      for (let a = 0; a < nFeatures; a++) {
        for (let b = a; b < nFeatures; b++) {
          C[a][b] += X[i][a] * X[i][b];
        }
      }
    }
    for (let a = 0; a < nFeatures; a++) {
      for (let b = a; b < nFeatures; b++) {
        C[a][b] /= denom;
        C[b][a] = C[a][b];
      }
    }

    // --- Power iteration to extract top-k eigenvectors ---
    // We extract eigenvectors one by one using deflation (Gram-Schmidt).
    // Stop when cumulative explained variance reaches ≥80 % or all features exhausted.
    const totalVariance = (() => {
      let s = 0;
      for (let f = 0; f < nFeatures; f++) s += C[f][f]; // trace = sum of eigenvalues
      return s > 0 ? s : 1;
    })();

    const maxComponents = Math.min(nFeatures, nPoints);
    const eigenvalues  = [];
    const eigenvectors = []; // each is Float64Array(nFeatures)

    // Deflated copy of C for successive extractions
    const Cd = C.map(row => Float64Array.from(row));

    const powerIteration = (mat, maxIter = 500, tol = 1e-9) => {
      // Initialize vector with small random values for stability
      const rng = this._seededRandom(eigenvalues.length + 1);
      const v = new Float64Array(nFeatures);
      for (let f = 0; f < nFeatures; f++) v[f] = rng() - 0.5;
      this._vecNormalize(v);

      let eigenval = 0;
      for (let iter = 0; iter < maxIter; iter++) {
        // w = mat · v
        const w = new Float64Array(nFeatures);
        for (let a = 0; a < nFeatures; a++) {
          for (let b = 0; b < nFeatures; b++) {
            w[a] += mat[a][b] * v[b];
          }
        }
        const newEigenval = this._vecDot(v, w);
        this._vecNormalize(w);

        // Convergence check
        let diff = 0;
        for (let f = 0; f < nFeatures; f++) diff += (w[f] - v[f]) ** 2;
        for (let f = 0; f < nFeatures; f++) v[f] = w[f];

        if (Math.abs(newEigenval - eigenval) < tol && iter > 5) { eigenval = newEigenval; break; }
        eigenval = newEigenval;
      }
      return { eigenval: Math.max(eigenval, 0), eigenvec: v };
    };

    let cumVariance = 0;
    for (let comp = 0; comp < maxComponents; comp++) {
      const { eigenval, eigenvec } = powerIteration(Cd);
      if (eigenval <= 0) break;

      eigenvalues.push(eigenval);
      eigenvectors.push(eigenvec);
      cumVariance += eigenval / totalVariance;

      // Deflate: Cd ← Cd - eigenval * (v ⊗ v)
      for (let a = 0; a < nFeatures; a++) {
        for (let b = 0; b < nFeatures; b++) {
          Cd[a][b] -= eigenval * eigenvec[a] * eigenvec[b];
        }
      }

      if (cumVariance >= 0.80) break;
    }

    const nComponents = eigenvectors.length;
    const explainedVariance = eigenvalues.map(ev => ev / totalVariance);
    const cumulativeVariance = [];
    let runSum = 0;
    for (const ev of explainedVariance) { runSum += ev; cumulativeVariance.push(runSum); }

    // --- Project data onto PCs: scores = X × V ---
    // scores[i][comp] = projection of point i onto component comp
    const scores = Array.from({ length: nPoints }, () => new Float64Array(nComponents));
    for (let i = 0; i < nPoints; i++) {
      for (let comp = 0; comp < nComponents; comp++) {
        let dot = 0;
        for (let f = 0; f < nFeatures; f++) dot += X[i][f] * eigenvectors[comp][f];
        scores[i][comp] = dot;
      }
    }

    // Convert to plain arrays for JSON-friendliness
    return {
      scores:             scores.map(row => Array.from(row)),
      loadings:           eigenvectors.map(ev => Array.from(ev)),
      explainedVariance,
      cumulativeVariance,
      featureNames,
      nComponents
    };
  }

  /** Normalize a Float64Array in-place to unit length. @private */
  static _vecNormalize(v) {
    let norm = 0;
    for (let i = 0; i < v.length; i++) norm += v[i] * v[i];
    norm = Math.sqrt(norm);
    if (norm === 0) return;
    for (let i = 0; i < v.length; i++) v[i] /= norm;
  }

  /** Dot product of two Float64Arrays. @private */
  static _vecDot(a, b) {
    let s = 0;
    for (let i = 0; i < a.length; i++) s += a[i] * b[i];
    return s;
  }

  // ==================== S4.6 — SPATIALLY CONSTRAINED K-MEANS ====================

  /**
   * Spatially Constrained K-Means clustering.
   *
   * Produces spatially contiguous management zones by penalizing cluster assignments
   * that differ from the majority label among a point's spatial neighbors.  Neighbors
   * are determined by a k-nearest-neighbor graph (k=8) built from geographic coordinates.
   *
   * Modified objective (per point i, cluster c):
   *   cost(i, c) = (1 - alpha) * attribute_distance(i, centroid_c)
   *              + alpha       * spatial_penalty(i, c)
   *
   * Spatial penalty for point i assigned to cluster c:
   *   fraction of i's neighbors that are NOT in cluster c.
   *
   * This replaces isolated mis-clustered pixels with the dominant local cluster,
   * producing geographically compact, contiguous zones.
   *
   * @param {Array<{lat: number, lng: number, [attr: string]: number|number[]}>} points
   *   Points with geographic coordinates and numeric attributes.
   *   If a point has a `features` property (number[]) it is used directly as the
   *   attribute vector; otherwise all numeric keys except lat/lng are used.
   * @param {number} k - Number of clusters (management zones).
   * @param {number} [alpha=0.5] - Balance between attribute homogeneity (0) and
   *   spatial contiguity (1).  0.3–0.6 recommended for most applications.
   * @returns {{
   *   assignments: number[],   // Cluster index for each point
   *   centroids: number[][],   // Final attribute centroids
   *   iterations: number,
   *   wcss: number,            // Within-cluster sum of squares (attribute only)
   *   spatialPenalty: number   // Final spatial penalty term (sum)
   * }}
   */
  static spatiallyConstrainedKMeans(points, k, alpha = 0.5) {
    const n = points.length;
    if (n < k) throw new Error('spatiallyConstrainedKMeans: fewer points than clusters');

    // --- Build attribute feature vectors ---
    // If point has a `features` array, use it; else collect all numeric non-spatial keys.
    const attrKeys = points[0].features
      ? null
      : Object.keys(points[0]).filter(key => key !== 'lat' && key !== 'lng' && typeof points[0][key] === 'number');

    const getFeature = (pt) => pt.features ? pt.features : attrKeys.map(k => pt[k]);
    const data = points.map(pt => getFeature(pt));
    const dim = data[0].length;

    // --- Build spatial k-NN adjacency graph (k=8 nearest neighbors by Haversine) ---
    const KNN = 8;
    // neighbors[i] = array of up to KNN point indices closest to point i (geographically)
    const neighbors = this._buildKNNGraph(points, KNN);

    // --- Initialize centroids with k-means++ ---
    const rng = this._seededRandom(99);
    let centroids = this._kMeansPPInit(data, k, rng);
    let assignments = new Int32Array(n).fill(0);
    let iterations = 0;
    const maxIter = 200;

    // --- Main loop ---
    let changed = true;
    while (changed && iterations < maxIter) {
      changed = false;
      iterations++;

      // ---- Assignment step ----
      for (let i = 0; i < n; i++) {
        let bestCluster = assignments[i];
        let bestCost = Infinity;

        for (let c = 0; c < k; c++) {
          // Attribute distance (squared Euclidean, normalized by dim for scale independence)
          let attrDist = 0;
          for (let d = 0; d < dim; d++) {
            const diff = data[i][d] - centroids[c][d];
            attrDist += diff * diff;
          }
          attrDist /= (dim || 1);

          // Spatial penalty: fraction of neighbors NOT in cluster c
          const nbrs = neighbors[i];
          let diffNeighbors = 0;
          for (const ni of nbrs) {
            if (assignments[ni] !== c) diffNeighbors++;
          }
          const spatialPen = nbrs.length > 0 ? diffNeighbors / nbrs.length : 0;

          const cost = (1 - alpha) * attrDist + alpha * spatialPen;
          if (cost < bestCost) {
            bestCost = cost;
            bestCluster = c;
          }
        }

        if (assignments[i] !== bestCluster) {
          assignments[i] = bestCluster;
          changed = true;
        }
      }

      // ---- Update step: recompute centroids ----
      const sums   = Array.from({ length: k }, () => new Float64Array(dim));
      const counts = new Int32Array(k);

      for (let i = 0; i < n; i++) {
        const c = assignments[i];
        counts[c]++;
        for (let d = 0; d < dim; d++) sums[c][d] += data[i][d];
      }

      for (let c = 0; c < k; c++) {
        if (counts[c] > 0) {
          centroids[c] = Array.from(sums[c], v => v / counts[c]);
        } else {
          // Reinitialize empty cluster to the farthest point from its current centroid
          let maxD = -1, maxIdx = 0;
          for (let i = 0; i < n; i++) {
            const d = this._distSq(data[i], centroids[assignments[i]]);
            if (d > maxD) { maxD = d; maxIdx = i; }
          }
          centroids[c] = [...data[maxIdx]];
        }
      }
    }

    // --- Compute final metrics ---
    let wcss = 0;
    let totalSpatialPenalty = 0;

    for (let i = 0; i < n; i++) {
      wcss += this._distSq(data[i], centroids[assignments[i]]);
      const nbrs = neighbors[i];
      let diffNbrs = 0;
      for (const ni of nbrs) {
        if (assignments[ni] !== assignments[i]) diffNbrs++;
      }
      totalSpatialPenalty += nbrs.length > 0 ? diffNbrs / nbrs.length : 0;
    }

    return {
      assignments: Array.from(assignments),
      centroids,
      iterations,
      wcss,
      spatialPenalty: totalSpatialPenalty
    };
  }

  /**
   * Build a k-nearest-neighbor graph from geographic point coordinates.
   * Uses squared Euclidean distance on (lat, lng) — suitable for small fields
   * where the flat-earth approximation is accurate.
   *
   * @param {Array<{lat: number, lng: number}>} points
   * @param {number} knn - Number of neighbors per point
   * @returns {number[][]} neighbors[i] = array of knn nearest point indices
   * @private
   */
  static _buildKNNGraph(points, knn) {
    const n = points.length;
    const neighbors = [];

    for (let i = 0; i < n; i++) {
      // Compute squared Euclidean distance from point i to all others
      const dists = [];
      for (let j = 0; j < n; j++) {
        if (j === i) continue;
        const dlat = points[j].lat - points[i].lat;
        const dlng = points[j].lng - points[i].lng;
        dists.push({ j, d2: dlat * dlat + dlng * dlng });
      }
      // Partial sort to get the knn nearest (full sort is fine for field-scale point counts)
      dists.sort((a, b) => a.d2 - b.d2);
      neighbors.push(dists.slice(0, knn).map(e => e.j));
    }

    return neighbors;
  }
}
