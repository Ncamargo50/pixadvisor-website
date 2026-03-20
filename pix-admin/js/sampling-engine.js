// PIX Admin - Professional Sampling Points Engine for Precision Agriculture
// Zone-based sampling with centroid-first strategy, adaptive subsampling, and export

class SamplingEngine {

  // ==================== GEOMETRY UTILITIES ====================

  /**
   * Ray-casting point-in-polygon test
   * @param {number} lat
   * @param {number} lng
   * @param {Array<[number,number]>} polygon - [[lng,lat],...]
   * @returns {boolean}
   */
  static pointInPolygon(lat, lng, polygon) {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const xi = polygon[i][1], yi = polygon[i][0];
      const xj = polygon[j][1], yj = polygon[j][0];
      const intersect = ((yi > lng) !== (yj > lng)) &&
        (lat < (xj - xi) * (lng - yi) / (yj - yi) + xi);
      if (intersect) inside = !inside;
    }
    return inside;
  }

  static _haversine(lat1, lng1, lat2, lng2) {
    const R = 6371000;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  static _metersToDegLat(meters) { return meters / 111320; }

  static _metersToDegLng(meters, lat) {
    return meters / (111320 * Math.cos(lat * Math.PI / 180));
  }

  static _respectsEdgeBuffer(lat, lng, polygon, bufferMeters) {
    if (bufferMeters <= 0) return true;
    for (let i = 0; i < polygon.length; i++) {
      const j = (i + 1) % polygon.length;
      const dist = this._pointToSegmentDist(
        lat, lng, polygon[i][1], polygon[i][0], polygon[j][1], polygon[j][0]
      );
      if (dist < bufferMeters) return false;
    }
    return true;
  }

  static _pointToSegmentDist(pLat, pLng, aLat, aLng, bLat, bLng) {
    const dx = bLng - aLng;
    const dy = bLat - aLat;
    if (dx === 0 && dy === 0) return this._haversine(pLat, pLng, aLat, aLng);
    let t = ((pLng - aLng) * dx + (pLat - aLat) * dy) / (dx * dx + dy * dy);
    t = Math.max(0, Math.min(1, t));
    return this._haversine(pLat, pLng, aLat + t * dy, aLng + t * dx);
  }

  static _seededRandom(seed) {
    let s = seed | 0;
    return function () {
      s = (s + 0x6D2B79F5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ==================== ZONE INTERIOR DETECTION ====================

  /**
   * Classify each cell of a zone as interior or edge.
   * A cell is INTERIOR only if ALL 8 neighbours belong to the same zone.
   * Returns only interior cells — used to ensure points/subsamples
   * are NEVER placed at zone edges.
   */
  static _getZoneInteriorCells(zoneIdx, zoneGrid, bounds, polygon = null) {
    const b = this._normalizeBounds(bounds);
    const rows = zoneGrid.length;
    const cols = (zoneGrid[0] || []).length;
    const latStep = (b.maxLat - b.minLat) / rows;
    const lngStep = (b.maxLng - b.minLng) / cols;
    const interior = [];

    for (let i = 0; i < rows; i++) {
      for (let j = 0; j < cols; j++) {
        if (zoneGrid[i][j] !== zoneIdx) continue;
        let isEdge = false;
        for (let di = -1; di <= 1 && !isEdge; di++) {
          for (let dj = -1; dj <= 1 && !isEdge; dj++) {
            if (di === 0 && dj === 0) continue;
            const ni = i + di, nj = j + dj;
            if (ni < 0 || ni >= rows || nj < 0 || nj >= cols ||
                zoneGrid[ni][nj] !== zoneIdx) {
              isEdge = true;
            }
          }
        }
        if (!isEdge) {
          const lat = b.minLat + (i + 0.5) * latStep;
          const lng = b.minLng + (j + 0.5) * lngStep;
          // If polygon provided, only include cells inside the field boundary
          if (polygon && !this.pointInPolygon(lat, lng, polygon)) continue;
          interior.push({ lat, lng });
        }
      }
    }
    return interior;
  }

  /**
   * Check if a point is inside a zone's interior (away from zone edges).
   */
  static _isInsideZoneInterior(lat, lng, interiorCells, cellSizeM) {
    const threshold = cellSizeM * 1.5;
    for (const cell of interiorCells) {
      if (this._haversine(lat, lng, cell.lat, cell.lng) < threshold) {
        return true;
      }
    }
    return false;
  }

  /**
   * Compute the centroid of a zone from the zoneGrid, validated to be
   * inside the polygon. If centroid falls outside, snaps to nearest interior cell.
   * Returns { lat, lng } or null if zone is empty.
   */
  static _computeZoneCentroid(zoneIdx, zoneGrid, bounds, polygon) {
    const b = this._normalizeBounds(bounds);
    const rows = zoneGrid.length;
    const cols = (zoneGrid[0] || []).length;
    const latStep = (b.maxLat - b.minLat) / rows;
    const lngStep = (b.maxLng - b.minLng) / cols;

    let sumLat = 0, sumLng = 0;
    const cells = [];

    for (let i = 0; i < rows; i++) {
      for (let j = 0; j < cols; j++) {
        if (zoneGrid[i][j] !== zoneIdx) continue;
        const lat = b.minLat + (i + 0.5) * latStep;
        const lng = b.minLng + (j + 0.5) * lngStep;
        if (this.pointInPolygon(lat, lng, polygon)) {
          cells.push({ lat, lng });
          sumLat += lat;
          sumLng += lng;
        }
      }
    }

    if (cells.length === 0) return null;

    let cLat = sumLat / cells.length;
    let cLng = sumLng / cells.length;

    // Validate centroid is inside polygon
    if (!this.pointInPolygon(cLat, cLng, polygon)) {
      let minDist = Infinity;
      for (const cell of cells) {
        const d = this._haversine(cLat, cLng, cell.lat, cell.lng);
        if (d < minDist) { minDist = d; cLat = cell.lat; cLng = cell.lng; }
      }
    }

    // Additionally validate centroid is inside zone interior (not on edge)
    const interiorCells = this._getZoneInteriorCells(zoneIdx, zoneGrid, bounds);
    if (interiorCells.length > 0) {
      const cellSizeM = this._haversine(b.minLat, b.minLng, b.minLat + latStep, b.minLng);
      if (!this._isInsideZoneInterior(cLat, cLng, interiorCells, cellSizeM)) {
        // Snap centroid to nearest interior cell
        let minDist = Infinity;
        for (const cell of interiorCells) {
          const d = this._haversine(cLat, cLng, cell.lat, cell.lng);
          if (d < minDist) { minDist = d; cLat = cell.lat; cLng = cell.lng; }
        }
      }
    }

    return {
      lat: Math.round(cLat * 1e7) / 1e7,
      lng: Math.round(cLng * 1e7) / 1e7,
      cellCount: cells.length,
      interiorCount: interiorCells.length
    };
  }

  /**
   * Estimate zone area in hectares from cell count and total field area.
   */
  static _estimateZoneArea(zoneCellCount, totalCells, areaHa) {
    return (zoneCellCount / Math.max(totalCells, 1)) * areaHa;
  }

  // ==================== DENSITY RULES (GIS Skill Standard) ====================

  static get MAX_SUBSAMPLES() { return 10; }

  /**
   * Determine number of main points and subsamples per zone based on area.
   * GIS Skill standard:
   *   < 3 ha  → 1 principal + 5 submuestras
   *   3-10 ha → 1 principal + 7 submuestras
   *   10-20 ha → 1 principal + 10 submuestras
   *   > 20 ha → 2 principales + 8 submuestras c/u
   */
  static _densityByZoneArea(zoneAreaHa) {
    if (zoneAreaHa < 3)  return { mainPoints: 1, subsPerMain: 5 };
    if (zoneAreaHa < 10) return { mainPoints: 1, subsPerMain: 7 };
    if (zoneAreaHa < 20) return { mainPoints: 1, subsPerMain: 10 };
    return { mainPoints: 2, subsPerMain: 8 };
  }

  /**
   * Adaptive subsample radius based on zone area.
   * Larger zones need wider subsample spread to represent the ambiente well.
   */
  static _adaptiveRadius(zoneAreaHa) {
    if (zoneAreaHa < 3)  return 10;  // 10m radius for small zones
    if (zoneAreaHa < 10) return 15;  // 15m
    if (zoneAreaHa < 20) return 25;  // 25m
    if (zoneAreaHa < 50) return 35;  // 35m
    return 50;                        // 50m for large zones
  }

  // ==================== ZIGZAG SUBSAMPLE DISTRIBUTION ====================

  /**
   * Distribute subsamples across the ENTIRE zone interior in a zigzag pattern.
   * Subsamples must be:
   *  - FAR from the main point (not clustered around it)
   *  - Distributed to REPRESENT the zone well (cover spatial extent)
   *  - NEVER at zone edges or field boundary
   *  - In zigzag walk pattern (alternating left-right as you traverse the zone)
   *
   * Algorithm:
   *  1. Compute bounding box of interior cells
   *  2. Define zigzag walk lines across the zone
   *  3. Place subsamples at evenly spaced positions along zigzag path
   *  4. Validate each point is inside polygon, away from edges, and far from main point
   *
   * @param {Object} mainPoint - { lat, lng } of the principal point
   * @param {Array} interiorCells - Array of { lat, lng } interior cells
   * @param {number} numSubs - Number of subsamples to place
   * @param {Array} polygon - Field boundary [[lng,lat],...]
   * @param {number} edgeBuffer - Min distance from field boundary (m)
   * @param {number} minDistFromMain - Min distance from main point (m)
   * @returns {Array<{lat,lng,subId}>}
   */
  static _zigzagFromInterior(mainPoint, interiorCells, numSubs, polygon, edgeBuffer, minDistFromMain) {
    if (interiorCells.length === 0) return [];

    // Step 1: Compute bounding box of interior cells
    let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
    for (const c of interiorCells) {
      if (c.lat < minLat) minLat = c.lat;
      if (c.lat > maxLat) maxLat = c.lat;
      if (c.lng < minLng) minLng = c.lng;
      if (c.lng > maxLng) maxLng = c.lng;
    }

    // Step 2: Check proximity to interior cells
    const isNearInterior = (lat, lng) => {
      // Check if any interior cell is within ~1.5 cell widths
      for (const c of interiorCells) {
        if (Math.abs(c.lat - lat) < (maxLat - minLat) / 30 &&
            Math.abs(c.lng - lng) < (maxLng - minLng) / 30) return true;
      }
      return false;
    };

    // Step 3: Generate zigzag walk path across the zone
    const numRows = Math.max(3, Math.ceil(Math.sqrt(numSubs * 1.5)));
    const latStep = (maxLat - minLat) / (numRows + 1);
    const zigzagPath = [];

    for (let r = 1; r <= numRows; r++) {
      const lat = minLat + r * latStep;
      const cols = 8; // sample points per row
      const lngStep = (maxLng - minLng) / (cols + 1);
      const goRight = (r % 2 === 1);
      for (let c = 1; c <= cols; c++) {
        const ci = goRight ? c : (cols + 1 - c);
        const lng = minLng + ci * lngStep;
        zigzagPath.push({ lat, lng });
      }
    }

    // Step 4: Filter and score candidates
    const candidates = [];
    for (const pt of zigzagPath) {
      // Must be near interior cells (inside the zone)
      if (!isNearInterior(pt.lat, pt.lng)) continue;
      // Must be inside polygon
      if (!this.pointInPolygon(pt.lat, pt.lng, polygon)) continue;
      // Must respect edge buffer
      if (edgeBuffer > 0 && !this._respectsEdgeBuffer(pt.lat, pt.lng, polygon, edgeBuffer)) continue;
      // Must be far from main point
      const distMain = this._haversine(pt.lat, pt.lng, mainPoint.lat, mainPoint.lng);
      if (distMain < minDistFromMain) continue;

      candidates.push({ lat: pt.lat, lng: pt.lng, distMain });
    }

    // Step 5: Select well-distributed subsamples using greedy farthest-point
    // Start by picking the candidate farthest from main point
    if (candidates.length === 0) return [];

    const selected = [];
    candidates.sort((a, b) => b.distMain - a.distMain);
    selected.push(candidates[0]);
    const used = new Set([0]);

    while (selected.length < numSubs && selected.length < candidates.length) {
      let bestIdx = -1, bestMinDist = -1;
      for (let i = 0; i < candidates.length; i++) {
        if (used.has(i)) continue;
        // Find min distance to any already selected point
        let minD = Infinity;
        for (const sel of selected) {
          const d = this._haversine(candidates[i].lat, candidates[i].lng, sel.lat, sel.lng);
          if (d < minD) minD = d;
        }
        if (minD > bestMinDist) {
          bestMinDist = minD;
          bestIdx = i;
        }
      }
      if (bestIdx < 0) break;
      selected.push(candidates[bestIdx]);
      used.add(bestIdx);
    }

    return selected.map((pt, i) => ({
      lat: Math.round(pt.lat * 1e7) / 1e7,
      lng: Math.round(pt.lng * 1e7) / 1e7,
      subId: i + 1
    }));
  }

  // ==================== NAMING CONVENTION ====================

  /**
   * Generate point ID following GIS skill standard: PREFIX-Z{zone}-P{n} / PREFIX-Z{zone}-S{n}
   * @param {string} prefix - Project prefix (default 'PIX')
   * @param {number} zone - Zone number (1-based)
   * @param {number} pointNum - Point number within zone
   * @param {boolean} isMain - true for principal, false for subsample
   */
  static _makePointId(prefix, zone, pointNum, isMain = true) {
    const type = isMain ? 'P' : 'S';
    return `${prefix}-Z${zone}-${type}${pointNum}`;
  }

  // ==================== PRIMARY METHOD: ZONE-BASED SAMPLING ====================

  /**
   * Generate sampling points from management zones following precision agriculture rules:
   *
   * 1. ONE main point at the CENTER (centroid) of each zone - ALWAYS
   * 2. For zones > 20 ha: TWO main points (centroid + farthest interior point)
   * 3. Subsamples distributed around main point(s) to represent the ambiente
   * 4. Subsamples NEVER placed at zone edges - only zone interior
   * 5. Maximum 10 subsamples per main point
   * 6. Subsample count and radius adapt to zone area
   *
   * @param {Object} config
   * @param {number[][]} config.zoneGrid - Zone assignment grid (0-based indices)
   * @param {Object} config.bounds - { minLat, maxLat, minLng, maxLng }
   * @param {number} config.numZones - Number of zones
   * @param {Array<[number,number]>} config.polygon - Field boundary [[lng,lat],...]
   * @param {number} config.areaHa - Total field area in hectares
   * @param {string} [config.prefix='PIX'] - Point ID prefix
   * @param {string} [config.pattern='radial'] - Subsample pattern
   * @param {number} [config.edgeBuffer=20] - Min distance from field boundary (m)
   * @returns {{ points: Array, compositePoints: Array, report: Object }}
   */
  static generateFromZones(config) {
    const {
      zoneGrid,
      bounds,
      numZones,
      polygon,
      areaHa,
      prefix = 'PIX',
      pattern = 'radial',
      edgeBuffer = 20
    } = config;

    const b = this._normalizeBounds(bounds);
    const rows = zoneGrid.length;
    const cols = (zoneGrid[0] || []).length;
    const totalCells = rows * cols;
    const cellSizeM = this._haversine(b.minLat, b.minLng, b.minLat + (b.maxLat - b.minLat) / rows, b.minLng);

    const allPoints = [];
    const allComposite = [];

    for (let z = 0; z < numZones; z++) {
      // Step 1: Compute zone centroid (validated to interior)
      const centroid = this._computeZoneCentroid(z, zoneGrid, bounds, polygon);
      if (!centroid) continue;

      // Step 2: Estimate zone area → determine density rules
      const zoneAreaHa = this._estimateZoneArea(centroid.cellCount, totalCells, areaHa);
      const density = this._densityByZoneArea(zoneAreaHa);
      const subsRadius = this._adaptiveRadius(zoneAreaHa);

      // Step 3: Get zone interior cells for validation (filtered by polygon)
      const interiorCells = this._getZoneInteriorCells(z, zoneGrid, bounds, polygon);

      // Step 4: Place main point(s)
      const mainPoints = [];

      // First main point: ALWAYS at centroid
      const mainPt1 = {
        lat: centroid.lat,
        lng: centroid.lng,
        id: this._makePointId(prefix, z + 1, 1, true),
        zone: z + 1,
        type: 'centroid',
        isMain: true,
        isCentroid: true,
        zoneAreaHa: Math.round(zoneAreaHa * 100) / 100
      };
      mainPoints.push(mainPt1);

      // Second main point if zone > 20 ha: farthest interior point from centroid
      // Must be far enough from field boundary to accommodate subsamples
      if (density.mainPoints >= 2 && interiorCells.length > 0) {
        let farthest = null;
        let maxDist = 0;
        const minBoundaryDist = subsRadius + edgeBuffer; // room for subs
        for (const cell of interiorCells) {
          // Must be inside polygon and far enough from boundary for subsamples
          if (!this.pointInPolygon(cell.lat, cell.lng, polygon)) continue;
          if (!this._respectsEdgeBuffer(cell.lat, cell.lng, polygon, minBoundaryDist)) continue;
          const d = this._haversine(centroid.lat, centroid.lng, cell.lat, cell.lng);
          if (d > maxDist) {
            maxDist = d;
            farthest = cell;
          }
        }
        if (farthest && maxDist > 50) {
          const mainPt2 = {
            lat: Math.round(farthest.lat * 1e7) / 1e7,
            lng: Math.round(farthest.lng * 1e7) / 1e7,
            id: this._makePointId(prefix, z + 1, 2, true),
            zone: z + 1,
            type: 'centroid-secondary',
            isMain: true,
            isCentroid: false,
            zoneAreaHa: Math.round(zoneAreaHa * 100) / 100
          };
          mainPoints.push(mainPt2);
        }
      }

      // Step 5: Generate subsamples distributed in ZIGZAG across the zone
      // Subsamples must be FAR from the main point and cover the zone well
      const minDistFromMain = Math.max(subsRadius * 2, 40); // at least 40m from main
      let subCounter = 0;

      for (const mpt of mainPoints) {
        // Use zigzag distribution across zone interior
        const subs = this._zigzagFromInterior(
          mpt, interiorCells, density.subsPerMain,
          polygon, edgeBuffer, minDistFromMain
        );

        // Re-label subsamples with proper nomenclature
        const labeledSubs = subs.map((s, i) => ({
          ...s,
          subId: i + 1,
          id: this._makePointId(prefix, z + 1, subCounter + i + 1, false),
          parentId: mpt.id
        }));
        subCounter += labeledSubs.length;

        mpt._compositePoints = labeledSubs;
        allComposite.push(...labeledSubs);
      }

      allPoints.push(...mainPoints);
    }

    // Generate coverage report
    const report = this.coverageReport(allPoints, polygon, areaHa);

    return { points: allPoints, compositePoints: allComposite, report };
  }

  // ==================== LEGACY SAMPLING METHODS ====================

  /**
   * Regular grid sampling within polygon boundary
   */
  static gridSampling(bounds, polygon, density, options = {}) {
    const b = this._normalizeBounds(bounds);
    const edgeBuffer = options.edgeBuffer ?? 20;
    const spacingM = Math.sqrt(10000 / density);
    const dLat = this._metersToDegLat(spacingM);
    const midLat = (b.minLat + b.maxLat) / 2;
    const dLng = this._metersToDegLng(spacingM, midLat);

    const points = [];
    let id = 1;

    for (let lat = b.minLat + dLat / 2; lat <= b.maxLat; lat += dLat) {
      for (let lng = b.minLng + dLng / 2; lng <= b.maxLng; lng += dLng) {
        if (!this.pointInPolygon(lat, lng, polygon)) continue;
        if (!this._respectsEdgeBuffer(lat, lng, polygon, edgeBuffer)) continue;
        points.push({
          lat: Math.round(lat * 1e7) / 1e7,
          lng: Math.round(lng * 1e7) / 1e7,
          id: `G${String(id).padStart(3, '0')}`,
          type: 'grid'
        });
        id++;
      }
    }
    return points;
  }

  /**
   * Stratified sampling: centroid first, then spread points within zone interior.
   */
  static stratifiedSampling(zoneGrid, bounds, numZones, polygon, config = {}) {
    const pointsPerZone = config.pointsPerZone || 5;
    const minPoints = config.minPointsPerZone ?? 3;
    const edgeBuffer = config.edgeBuffer ?? 20;
    const b = this._normalizeBounds(bounds);
    const rows = zoneGrid.length;
    const cols = (zoneGrid[0] || []).length;
    const latStep = (b.maxLat - b.minLat) / rows;
    const lngStep = (b.maxLng - b.minLng) / cols;
    const cellSizeM = this._haversine(b.minLat, b.minLng, b.minLat + latStep, b.minLng);

    const points = [];
    let globalId = 1;

    for (let z = 0; z < numZones; z++) {
      // Compute centroid validated to zone interior
      const centroid = this._computeZoneCentroid(z, zoneGrid, bounds, polygon);
      if (!centroid) continue;

      // Place centroid as first point
      points.push({
        lat: centroid.lat,
        lng: centroid.lng,
        id: `S${String(globalId).padStart(3, '0')}`,
        zone: z + 1,
        type: 'stratified',
        isCentroid: true
      });
      globalId++;

      // Additional points from zone INTERIOR only (never edges)
      const targetCount = Math.max(minPoints, pointsPerZone) - 1;
      if (targetCount > 0) {
        const interiorCells = this._getZoneInteriorCells(z, zoneGrid, bounds);
        // Filter interior cells that also respect polygon edge buffer
        const validCells = interiorCells.filter(cell => {
          if (edgeBuffer > 0 && !this._respectsEdgeBuffer(cell.lat, cell.lng, polygon, edgeBuffer)) return false;
          if (this._haversine(cell.lat, cell.lng, centroid.lat, centroid.lng) < 30) return false;
          return true;
        });

        const step = Math.max(1, Math.floor(validCells.length / targetCount));
        let count = 0;
        for (let c = 0; c < validCells.length && count < targetCount; c += step) {
          points.push({
            lat: Math.round(validCells[c].lat * 1e7) / 1e7,
            lng: Math.round(validCells[c].lng * 1e7) / 1e7,
            id: `S${String(globalId).padStart(3, '0')}`,
            zone: z + 1,
            type: 'stratified',
            isCentroid: false
          });
          globalId++;
          count++;
        }
      }
    }
    return points;
  }

  /**
   * Zone centroid sampling: one point per zone at its centroid.
   */
  static centroidSampling(zoneGrid, bounds, numZones, polygon) {
    const points = [];
    for (let z = 0; z < numZones; z++) {
      const centroid = this._computeZoneCentroid(z, zoneGrid, bounds, polygon);
      if (!centroid) continue;
      points.push({
        lat: centroid.lat,
        lng: centroid.lng,
        id: `C${String(z + 1).padStart(3, '0')}`,
        zone: z + 1,
        type: 'centroid',
        isCentroid: true
      });
    }
    return points;
  }

  /**
   * Random sampling: centroid first, then random interior points.
   */
  static randomSampling(zoneGrid, bounds, numZones, polygon, config = {}) {
    const pointsPerZone = config.pointsPerZone || 3;
    const edgeBuffer = config.edgeBuffer ?? 20;
    const rng = config.seed != null ? this._seededRandom(config.seed) : Math.random;

    const points = [];
    let globalId = 1;

    for (let z = 0; z < numZones; z++) {
      // First point: ALWAYS centroid
      const centroid = this._computeZoneCentroid(z, zoneGrid, bounds, polygon);
      if (!centroid) continue;

      points.push({
        lat: centroid.lat,
        lng: centroid.lng,
        id: `R${String(globalId).padStart(3, '0')}`,
        zone: z + 1,
        type: 'random',
        isCentroid: true
      });
      globalId++;

      // Remaining points: random from zone interior
      if (pointsPerZone > 1) {
        const interiorCells = this._getZoneInteriorCells(z, zoneGrid, bounds);
        const candidates = interiorCells.filter(cell =>
          this._respectsEdgeBuffer(cell.lat, cell.lng, polygon, edgeBuffer) &&
          this._haversine(cell.lat, cell.lng, centroid.lat, centroid.lng) > 30
        );

        // Fisher-Yates shuffle
        const shuffled = [...candidates];
        for (let i = shuffled.length - 1; i > 0; i--) {
          const j = Math.floor(rng() * (i + 1));
          [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }

        const selected = shuffled.slice(0, pointsPerZone - 1);
        for (const pt of selected) {
          points.push({
            lat: Math.round(pt.lat * 1e7) / 1e7,
            lng: Math.round(pt.lng * 1e7) / 1e7,
            id: `R${String(globalId).padStart(3, '0')}`,
            zone: z + 1,
            type: 'random',
            isCentroid: false
          });
          globalId++;
        }
      }
    }
    return points;
  }

  // ==================== COMPOSITE / SUBSAMPLING ====================

  /**
   * Generate sub-sampling pattern around a center point for composite samples.
   *
   * RULES:
   *  1. Main point is always at the centroid (passed as centerLat/Lng)
   *  2. Subsamples distributed to REPRESENT the zone well
   *  3. Subsamples NEVER at zone edges — validated via zoneCtx
   *  4. Maximum 10 subsamples per point
   *  5. Radius adapts to zone area (via caller)
   */
  static compositePattern(centerLat, centerLng, pattern = 'radial', radius = 15, zoneCtx = null, numSubs = null) {
    const maxSubs = Math.min(numSubs || this.MAX_SUBSAMPLES, this.MAX_SUBSAMPLES);
    const dLat = this._metersToDegLat(radius);
    const dLng = this._metersToDegLng(radius, centerLat);
    let offsets = [];

    switch (pattern) {
      case 'zigzag':
        offsets.push(
          [-dLat * 0.3, -dLng * 0.8],
          [dLat * 0.5, -dLng * 0.5],
          [-dLat * 0.4, -dLng * 0.15],
          [dLat * 0.3, dLng * 0.15],
          [-dLat * 0.5, dLng * 0.5],
          [dLat * 0.4, dLng * 0.8],
          [-dLat * 0.6, dLng * 0.3],
          [dLat * 0.6, -dLng * 0.3],
          [-dLat * 0.2, dLng * 0.6],
          [dLat * 0.2, -dLng * 0.6]
        );
        break;

      case 'cross':
        offsets.push(
          [dLat * 0.4, 0], [-dLat * 0.4, 0],
          [0, dLng * 0.4], [0, -dLng * 0.4],
          [dLat * 0.8, 0], [-dLat * 0.8, 0],
          [0, dLng * 0.8], [0, -dLng * 0.8],
          [dLat * 0.55, dLng * 0.55], [-dLat * 0.55, -dLng * 0.55]
        );
        break;

      case 'diamond':
        offsets.push(
          [dLat * 0.4, 0], [0, dLng * 0.4],
          [-dLat * 0.4, 0], [0, -dLng * 0.4],
          [dLat * 0.8, 0], [0, dLng * 0.8],
          [-dLat * 0.8, 0], [0, -dLng * 0.8],
          [dLat * 0.55, dLng * 0.55], [-dLat * 0.55, -dLng * 0.55]
        );
        break;

      case 'circle':
        for (let k = 0; k < Math.min(maxSubs, 10); k++) {
          const angle = (k / Math.min(maxSubs, 10)) * 2 * Math.PI;
          const r = (k % 2 === 0) ? 0.7 : 1.0;
          offsets.push([dLat * r * Math.sin(angle), dLng * r * Math.cos(angle)]);
        }
        break;

      case 'radial':
      default: {
        // Best pattern for zone representation: 2 concentric rings
        const innerCount = Math.min(Math.ceil(maxSubs * 0.4), 4);
        const outerCount = Math.min(maxSubs - innerCount, 6);

        // Inner ring at 35% radius
        for (let k = 0; k < innerCount; k++) {
          const angle = (k / innerCount) * 2 * Math.PI + Math.PI / innerCount;
          offsets.push([dLat * 0.35 * Math.sin(angle), dLng * 0.35 * Math.cos(angle)]);
        }
        // Outer ring at 75% radius
        for (let k = 0; k < outerCount; k++) {
          const angle = (k / outerCount) * 2 * Math.PI;
          offsets.push([dLat * 0.75 * Math.sin(angle), dLng * 0.75 * Math.cos(angle)]);
        }
        break;
      }
    }

    // Cap at max subsamples
    offsets = offsets.slice(0, maxSubs);

    // Generate candidate points
    const candidates = offsets.map((off, idx) => ({
      lat: Math.round((centerLat + off[0]) * 1e7) / 1e7,
      lng: Math.round((centerLng + off[1]) * 1e7) / 1e7,
      subId: idx + 1
    }));

    // Validate: remove subsamples outside polygon or too close to field boundary.
    // Note: subsamples are placed at small radius (10-50m) from the centroid which
    // is already validated to be in the zone interior, so we only need to check:
    // 1) Inside the field polygon
    // 2) Respects edge buffer from field boundary
    // We do NOT re-check zone interior because the subsample radius is much smaller
    // than cell size — all points within 50m of a zone-interior centroid are still
    // well within the zone.
    if (zoneCtx) {
      const validated = [];
      for (const pt of candidates) {
        if (zoneCtx.polygon && !this.pointInPolygon(pt.lat, pt.lng, zoneCtx.polygon)) continue;
        if (zoneCtx.polygon && zoneCtx.edgeBuffer > 0 &&
            !this._respectsEdgeBuffer(pt.lat, pt.lng, zoneCtx.polygon, zoneCtx.edgeBuffer)) continue;
        validated.push(pt);
      }
      return validated.map((pt, i) => ({ ...pt, subId: i + 1 }));
    }

    return candidates;
  }

  // ==================== EXPORT FUNCTIONS ====================

  static toGPX(points, name = 'PIX Muestreo') {
    const wpts = points.map(p =>
      `  <wpt lat="${p.lat}" lon="${p.lng}">\n` +
      `    <name>${p.id}</name>\n` +
      `    <desc>Zona: ${p.zone || '-'} | Tipo: ${p.type || '-'}</desc>\n` +
      `  </wpt>`
    ).join('\n');

    return `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<gpx version="1.1" creator="PIX Admin">\n` +
      `  <metadata><name>${name}</name></metadata>\n` +
      `${wpts}\n` +
      `</gpx>`;
  }

  static toKML(points, name = 'PIX Muestreo') {
    const zoneColors = ['ff0000ff', 'ff00aaff', 'ff00ffff', 'ff00ff80', 'ff00ff00', 'ffff8800', 'ffff0000'];
    const styles = zoneColors.map((color, i) =>
      `  <Style id="zone${i + 1}">\n` +
      `    <IconStyle><color>${color}</color><scale>0.8</scale>\n` +
      `      <Icon><href>http://maps.google.com/mapfiles/kml/paddle/wht-blank.png</href></Icon>\n` +
      `    </IconStyle>\n` +
      `  </Style>`
    ).join('\n');

    const placemarks = points.map(p =>
      `  <Placemark>\n` +
      `    <name>${p.id}</name>\n` +
      `    <description>Zona: ${p.zone || '-'} | Tipo: ${p.type || '-'}</description>\n` +
      `    <styleUrl>#zone${p.zone || 1}</styleUrl>\n` +
      `    <Point><coordinates>${p.lng},${p.lat},0</coordinates></Point>\n` +
      `  </Placemark>`
    ).join('\n');

    return `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<kml xmlns="http://www.opengis.net/kml/2.2">\n` +
      `<Document>\n` +
      `  <name>${name}</name>\n` +
      `${styles}\n` +
      `${placemarks}\n` +
      `</Document>\n` +
      `</kml>`;
  }

  static toGeoJSON(points, name = 'PIX Muestreo') {
    const features = points.map(p => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
      properties: {
        id: p.id,
        zone: p.zone || null,
        type: p.type || null,
        role: p.isCentroid ? 'principal' : 'complementario',
        subsamples: p._compositePoints ? p._compositePoints.length : 0,
        zoneAreaHa: p.zoneAreaHa || null
      }
    }));

    return JSON.stringify({ type: 'FeatureCollection', name, features }, null, 2);
  }

  static toCSV(points) {
    const header = 'id,lat,lng,zone,type,role,subsamples,zoneAreaHa';
    const rows = points.map(p => {
      const role = p.isCentroid ? 'principal' : 'complementario';
      const numSubs = p._compositePoints ? p._compositePoints.length : 0;
      return `${p.id},${p.lat},${p.lng},${p.zone || ''},${p.type || ''},${role},${numSubs},${p.zoneAreaHa || ''}`;
    });
    return [header, ...rows].join('\n');
  }

  // ==================== DOWNLOAD HELPER ====================

  static downloadFile(content, filename, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // ==================== MAP RENDERING ====================

  static renderPointsToMap(map, points, options = {}) {
    const showLabels = options.showLabels !== false;
    const showComposite = options.showComposite || false;
    const iconSize = options.iconSize || 10;
    const zoneColors = options.zoneColors || [
      '#DC2828', '#F58C32', '#FAD232', '#82C846', '#1E8C32', '#1E648C', '#503C96'
    ];

    // Use marker clustering for large point sets (500+) to maintain performance.
    // When clustering is active, labels (permanent tooltips) are suppressed because
    // they create visual noise on clustered views and hurt rendering performance.
    const useCluster = points.length >= 500 && typeof L.markerClusterGroup === 'function';
    let layerGroup;

    if (useCluster) {
      layerGroup = L.markerClusterGroup({
        maxClusterRadius: 40,
        showCoverageOnHover: false,
        zoomToBoundsOnClick: true,
        disableClusteringAtZoom: 16
      });
    } else {
      layerGroup = L.layerGroup();
    }

    for (const pt of points) {
      const color = pt.zone ? (zoneColors[(pt.zone - 1) % zoneColors.length]) : '#2196F3';
      const isCentroid = pt.isCentroid === true;

      const markerRadius = isCentroid ? (iconSize / 2 + 3) : (iconSize / 2);
      const markerWeight = isCentroid ? 3 : 2;

      const marker = L.circleMarker([pt.lat, pt.lng], {
        radius: markerRadius,
        color: isCentroid ? '#fff' : '#ddd',
        weight: markerWeight,
        fillColor: color,
        fillOpacity: isCentroid ? 0.95 : 0.7
      });

      const roleLabel = isCentroid ? 'Principal (centro)' : 'Complementario';
      const popupContent =
        `<div style="font-family:sans-serif;font-size:13px;">` +
        `<strong>${pt.id}</strong> — ${roleLabel}<br>` +
        `${pt.zone ? `Zona: ${pt.zone}<br>` : ''}` +
        `${pt.zoneAreaHa ? `Área zona: ${pt.zoneAreaHa} ha<br>` : ''}` +
        `Lat: ${pt.lat}<br>Lng: ${pt.lng}` +
        `${pt._compositePoints ? `<br>Submuestras: ${pt._compositePoints.length}` : ''}` +
        `</div>`;
      marker.bindPopup(popupContent);

      // Skip permanent labels when clustering — too many tooltips kill performance
      if (showLabels && !useCluster) {
        marker.bindTooltip(pt.id, {
          permanent: true,
          direction: 'top',
          offset: [0, -8],
          className: 'pix-sampling-label'
        });
      }

      layerGroup.addLayer(marker);

      if (showComposite && pt._compositePoints) {
        for (const sub of pt._compositePoints) {
          const line = L.polyline([[pt.lat, pt.lng], [sub.lat, sub.lng]], {
            color: color, weight: 1, opacity: 0.4, dashArray: '3,5'
          });
          layerGroup.addLayer(line);

          const subMarker = L.circleMarker([sub.lat, sub.lng], {
            radius: 3, color, weight: 1, fillColor: color, fillOpacity: 0.5
          });
          subMarker.bindPopup(
            `<div style="font-family:sans-serif;font-size:12px;">` +
            `${sub.id || ('Sub ' + sub.subId)} de ${pt.id}<br>` +
            `Lat: ${sub.lat} | Lng: ${sub.lng}</div>`
          );
          layerGroup.addLayer(subMarker);
        }
      }
    }

    layerGroup.addTo(map);
    return layerGroup;
  }

  // ==================== ANALYSIS & VALIDATION ====================

  static calculateDensity(areaHa, numPoints) {
    const pointsPerHa = numPoints / areaHa;
    const haPerPoint = areaHa / numPoints;
    const gridSpacing_m = Math.sqrt(10000 / pointsPerHa);
    return {
      pointsPerHa: Math.round(pointsPerHa * 1000) / 1000,
      haPerPoint: Math.round(haPerPoint * 100) / 100,
      gridSpacing_m: Math.round(gridSpacing_m * 10) / 10
    };
  }

  static distanceMatrix(points) {
    const n = points.length;
    const matrix = Array(n).fill(null).map(() => Array(n).fill(0));
    let minDist = Infinity, maxDist = 0, totalDist = 0, pairCount = 0;

    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const d = this._haversine(points[i].lat, points[i].lng, points[j].lat, points[j].lng);
        matrix[i][j] = d;
        matrix[j][i] = d;
        if (d < minDist) minDist = d;
        if (d > maxDist) maxDist = d;
        totalDist += d;
        pairCount++;
      }
    }

    return {
      matrix,
      minDist: pairCount > 0 ? Math.round(minDist * 10) / 10 : 0,
      maxDist: pairCount > 0 ? Math.round(maxDist * 10) / 10 : 0,
      meanDist: pairCount > 0 ? Math.round((totalDist / pairCount) * 10) / 10 : 0
    };
  }

  static coverageReport(points, polygon, areaHa) {
    const n = points.length;
    const density = this.calculateDensity(areaHa, n);
    const warnings = [];

    let distStats = { minDist: 0, maxDist: 0, meanDist: 0 };
    if (n > 1 && n <= 500) {
      const dm = this.distanceMatrix(points);
      distStats = { minDist: dm.minDist, maxDist: dm.maxDist, meanDist: dm.meanDist };
    }

    const zones = new Set(points.filter(p => p.zone).map(p => p.zone));
    const zonesRepresented = zones.size;

    let score = 100;

    if (density.pointsPerHa < 0.2) {
      score -= 30;
      warnings.push('Densidad muy baja: menos de 0.2 puntos/ha');
    } else if (density.pointsPerHa < 0.5) {
      score -= 15;
      warnings.push('Densidad baja: menos de 0.5 puntos/ha');
    }

    if (distStats.minDist > 0 && distStats.minDist < 20) {
      score -= 15;
      warnings.push(`Puntos muy cercanos: distancia mínima ${distStats.minDist}m`);
    }

    if (distStats.meanDist > 0 && distStats.maxDist > distStats.meanDist * 3) {
      score -= 10;
      warnings.push('Distribución espacial irregular');
    }

    if (n < 5) {
      score -= 20;
      warnings.push('Menos de 5 puntos de muestreo');
    }

    // Verify centroid rule: each zone must have a centroid point
    const zonesWithCentroid = new Set(points.filter(p => p.isCentroid).map(p => p.zone));
    const zonesWithout = [...zones].filter(z => !zonesWithCentroid.has(z));
    if (zonesWithout.length > 0) {
      score -= 20;
      warnings.push(`Zonas sin punto principal en centro: ${zonesWithout.join(', ')}`);
    }

    const pointsWithSubs = points.filter(p => p._compositePoints && p._compositePoints.length > 0);
    const subsampleCounts = pointsWithSubs.map(p => p._compositePoints.length);
    const maxSubsUsed = subsampleCounts.length > 0 ? Math.max(...subsampleCounts) : 0;

    if (maxSubsUsed > 10) {
      score -= 10;
      warnings.push(`Exceso de submuestras: ${maxSubsUsed} (máximo: 10)`);
    }

    score = Math.max(0, Math.min(100, score));

    return {
      numPoints: n,
      numCentroids: points.filter(p => p.isCentroid).length,
      totalSubsamples: subsampleCounts.reduce((a, b) => a + b, 0),
      maxSubsamplesPerPoint: maxSubsUsed,
      areaHa: Math.round(areaHa * 100) / 100,
      density,
      distances: distStats,
      zonesRepresented,
      score,
      rating: score >= 80 ? 'Excelente' : score >= 60 ? 'Bueno' : score >= 40 ? 'Regular' : 'Insuficiente',
      warnings
    };
  }

  // ==================== MAIN ENTRY POINT ====================

  /**
   * Generate a complete sampling plan. Delegates to generateFromZones() when
   * zoneGrid is available (recommended). Falls back to legacy methods otherwise.
   */
  static generateSamplingPlan(config) {
    // Preferred path: zone-based with full rules
    if (config.zoneGrid && config.areaHa && config.method !== 'grid') {
      return this.generateFromZones({
        zoneGrid: config.zoneGrid,
        bounds: config.bounds,
        numZones: config.numZones || 3,
        polygon: config.polygon,
        areaHa: config.areaHa,
        prefix: config.prefix || 'PIX',
        pattern: config.compositePattern || 'radial',
        edgeBuffer: config.edgeBuffer || 20
      });
    }

    // Legacy path
    const {
      method = 'centroid',
      polygon,
      bounds,
      areaHa,
      density = 0.5,
      zoneGrid,
      numZones = 3,
      pointsPerZone = 5,
      edgeBuffer = 20,
      compositePattern: compPattern = null,
      compositeRadius = 15,
      maxSubsamples = 10
    } = config;

    let points = [];

    switch (method) {
      case 'grid':
        points = this.gridSampling(bounds, polygon, density, { edgeBuffer });
        break;
      case 'stratified':
        points = this.stratifiedSampling(zoneGrid, bounds, numZones, polygon, {
          pointsPerZone, minPointsPerZone: 3, edgeBuffer
        });
        break;
      case 'centroid':
        points = this.centroidSampling(zoneGrid, bounds, numZones, polygon);
        break;
      case 'random':
        points = this.randomSampling(zoneGrid, bounds, numZones, polygon, {
          pointsPerZone, edgeBuffer, seed: config.seed || null
        });
        break;
      default:
        console.warn(`SamplingEngine: unknown method "${method}", defaulting to centroid`);
        points = this.centroidSampling(zoneGrid, bounds, numZones, polygon);
    }

    // Apply composite patterns with zone-aware validation
    let compositePoints = [];
    if (compPattern && zoneGrid) {
      const b = this._normalizeBounds(bounds);
      const resolution = zoneGrid.length;
      const latStepM = this._haversine(b.minLat, b.minLng, b.maxLat, b.minLng) / resolution;

      for (const pt of points) {
        const zoneIdx = pt.zone != null ? pt.zone - 1 : null;
        let zoneCtx = null;
        if (zoneIdx != null) {
          const interiorCells = this._getZoneInteriorCells(zoneIdx, zoneGrid, bounds);
          zoneCtx = { interiorCells, cellSizeM: latStepM, polygon, edgeBuffer };
        }
        const subs = this.compositePattern(
          pt.lat, pt.lng, compPattern, compositeRadius,
          zoneCtx, Math.min(maxSubsamples, this.MAX_SUBSAMPLES)
        );
        pt._compositePoints = subs;
        compositePoints.push(...subs.map(s => ({ ...s, parentId: pt.id })));
      }
    } else if (compPattern) {
      for (const pt of points) {
        const zoneCtx = polygon ? { polygon, edgeBuffer, interiorCells: null } : null;
        const subs = this.compositePattern(
          pt.lat, pt.lng, compPattern, compositeRadius,
          zoneCtx, Math.min(maxSubsamples, this.MAX_SUBSAMPLES)
        );
        pt._compositePoints = subs;
        compositePoints.push(...subs.map(s => ({ ...s, parentId: pt.id })));
      }
    }

    const report = this.coverageReport(points, polygon, areaHa);
    return { points, compositePoints, report };
  }

  // ==================== INTERNAL HELPERS ====================

  static _normalizeBounds(bounds) {
    if (bounds.getSouthWest) {
      const sw = bounds.getSouthWest();
      const ne = bounds.getNorthEast();
      return { minLat: sw.lat, maxLat: ne.lat, minLng: sw.lng, maxLng: ne.lng };
    }
    return {
      minLat: bounds.minLat, maxLat: bounds.maxLat,
      minLng: bounds.minLng, maxLng: bounds.maxLng
    };
  }
}
