// PIX Admin - Professional IDW Interpolation, Management Zones & Prescription Engine
// DataFarm-level maps with smooth rendering, zone labels, and high-res output

class InterpolationEngine {

  // ==================== PROFESSIONAL COLOR PALETTES ====================
  static PALETTES = {
    // DataFarm-style fertility: Red(low) → Orange → Yellow → LightGreen → DarkGreen(high)
    fertility: [
      [0.00, [200, 30, 30]],    // Deep red — very low
      [0.15, [220, 70, 40]],    // Red-orange
      [0.30, [245, 140, 60]],   // Orange
      [0.45, [255, 200, 50]],   // Yellow
      [0.60, [220, 230, 60]],   // Yellow-green
      [0.75, [120, 190, 60]],   // Light green
      [0.90, [40, 150, 40]],    // Green
      [1.00, [15, 100, 30]]     // Dark green — very high
    ],
    // Reversed fertility: DarkGreen(low) → Red(high) — for Al, acidity
    fertility_r: [
      [0.00, [15, 100, 30]],
      [0.15, [40, 150, 40]],
      [0.30, [120, 190, 60]],
      [0.45, [220, 230, 60]],
      [0.60, [255, 200, 50]],
      [0.75, [245, 140, 60]],
      [0.90, [220, 70, 40]],
      [1.00, [200, 30, 30]]
    ],
    // Prescription: light green(low dose) → yellow → orange → red(high dose)
    prescription: [
      [0.00, [180, 220, 160]],
      [0.25, [240, 240, 100]],
      [0.50, [250, 190, 60]],
      [0.75, [230, 120, 50]],
      [1.00, [200, 40, 40]]
    ],
    // Management zones: distinct colors
    zones: [
      [220, 40, 40],   // Zone 1 — Red (low potential)
      [245, 140, 50],   // Zone 2 — Orange
      [250, 210, 50],   // Zone 3 — Yellow
      [130, 200, 70],   // Zone 4 — Light green
      [30, 140, 50],    // Zone 5 — Dark green (high potential)
      [30, 100, 140],   // Zone 6 — Teal
      [80, 60, 150]     // Zone 7 — Purple
    ]
  };

  // Nutrient-specific palette selection
  static _getPaletteForNutrient(nutrient) {
    const reversed = ['Al', 'H_Al']; // Higher = worse
    return reversed.includes(nutrient) ? 'fertility_r' : 'fertility';
  }

  // Interpolate between palette stops
  static _samplePalette(t, paletteName = 'fertility') {
    const palette = this.PALETTES[paletteName] || this.PALETTES.fertility;
    t = Math.max(0, Math.min(1, t));
    for (let i = 0; i < palette.length - 1; i++) {
      const [t0, c0] = palette[i];
      const [t1, c1] = palette[i + 1];
      if (t >= t0 && t <= t1) {
        const f = (t - t0) / (t1 - t0);
        return [
          Math.round(c0[0] + f * (c1[0] - c0[0])),
          Math.round(c0[1] + f * (c1[1] - c0[1])),
          Math.round(c0[2] + f * (c1[2] - c0[2]))
        ];
      }
    }
    const last = palette[palette.length - 1][1];
    return [...last];
  }

  // Legacy compat
  static _continuousColor(t, scale = 'fertility') {
    const rgb = this._samplePalette(t, scale);
    return `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
  }

  // ==================== IDW INTERPOLATION ====================

  static interpolateIDW(points, bounds, options = {}) {
    const resolution = options.resolution || 80;
    const power = options.power || 2;
    const smoothPasses = options.smooth !== undefined ? options.smooth : 2;

    if (!points || points.length === 0) return null;

    // Expand points with subsamples for smoother interpolation (DataFarm methodology)
    // Each sample may carry a `subsamples` array of nearby sub-points that contribute
    // with reduced weight, creating fluid transitions between sampling zones
    let allPoints = [];
    for (const pt of points) {
      allPoints.push({ lat: pt.lat, lng: pt.lng, value: pt.value, weight: pt.weight || 1.0 });
      if (pt.subsamples && Array.isArray(pt.subsamples)) {
        for (const sub of pt.subsamples) {
          allPoints.push({
            lat: sub.lat, lng: sub.lng, value: sub.value !== undefined ? sub.value : pt.value,
            weight: sub.weight !== undefined ? sub.weight : 0.4
          });
        }
      }
    }

    // If samples have no explicit subsamples, auto-generate virtual subsamples
    // around each point for smoother interpolation (DataFarm-style fluid maps)
    if (options.autoSubsamples !== false && allPoints.length === points.length && allPoints.length >= 3) {
      const extraPts = [];
      const spreadM = options.subsampleSpread || 50; // ~50m spread
      const spreadDegLat = spreadM / 111320; // meters to degrees latitude
      const avgLat = allPoints.reduce((s, p) => s + p.lat, 0) / allPoints.length;
      const spreadDegLng = spreadM / (111320 * Math.cos(avgLat * Math.PI / 180)); // corrected for longitude
      const subWeight = 0.35;
      for (const pt of allPoints) {
        // 4 virtual sub-points at cardinal directions
        extraPts.push({ lat: pt.lat + spreadDegLat, lng: pt.lng, value: pt.value, weight: subWeight });
        extraPts.push({ lat: pt.lat - spreadDegLat, lng: pt.lng, value: pt.value, weight: subWeight });
        extraPts.push({ lat: pt.lat, lng: pt.lng + spreadDegLng, value: pt.value, weight: subWeight });
        extraPts.push({ lat: pt.lat, lng: pt.lng - spreadDegLng, value: pt.value, weight: subWeight });
      }
      allPoints = allPoints.concat(extraPts);
    }

    if (allPoints.length === 1) {
      const grid = Array(resolution).fill(null).map(() => Array(resolution).fill(allPoints[0].value));
      return { grid, bounds, resolution, stats: { min: allPoints[0].value, max: allPoints[0].value, mean: allPoints[0].value, points: 1 } };
    }

    const latStep = (bounds.maxLat - bounds.minLat) / resolution;
    const lngStep = (bounds.maxLng - bounds.minLng) / resolution;
    let grid = [];
    let min = Infinity, max = -Infinity, sum = 0, count = 0;

    for (let i = 0; i < resolution; i++) {
      grid[i] = [];
      const cellLat = bounds.minLat + (i + 0.5) * latStep;
      for (let j = 0; j < resolution; j++) {
        const cellLng = bounds.minLng + (j + 0.5) * lngStep;
        let num = 0, den = 0, exact = false;
        for (const pt of allPoints) {
          const dist = this._haversine(cellLat, cellLng, pt.lat, pt.lng);
          if (dist < 0.1) { grid[i][j] = pt.value; exact = true; break; }
          const w = (pt.weight || 1.0) / Math.pow(dist, power);
          num += w * pt.value;
          den += w;
        }
        if (!exact) grid[i][j] = den > 0 ? num / den : 0;
        const v = grid[i][j];
        if (v < min) min = v;
        if (v > max) max = v;
        sum += v; count++;
      }
    }

    // Gaussian smooth passes for professional appearance
    for (let p = 0; p < smoothPasses; p++) {
      grid = this._gaussianSmooth(grid, resolution);
    }

    // Recalculate stats after smoothing
    min = Infinity; max = -Infinity; sum = 0; count = 0;
    for (let i = 0; i < resolution; i++) {
      for (let j = 0; j < resolution; j++) {
        const v = grid[i][j];
        if (v < min) min = v;
        if (v > max) max = v;
        sum += v; count++;
      }
    }

    return {
      grid, bounds, resolution, latStep, lngStep,
      stats: {
        min: Math.round(min * 100) / 100,
        max: Math.round(max * 100) / 100,
        mean: Math.round((sum / count) * 100) / 100,
        points: points.length
      }
    };
  }

  /**
   * Async IDW interpolation using a Web Worker to avoid blocking the main thread.
   * @param {Array} points - Array of {lat, lng, value, weight?}
   * @param {Object} bounds - {minLat, maxLat, minLng, maxLng}
   * @param {Object} options - {resolution, power, smooth}
   * @returns {Promise<{type: string, grid: number[][], stats: {min: number, max: number, mean: number}}>}
   */
  static async interpolateIDWAsync(points, bounds, options = {}) {
    return new Promise((resolve, reject) => {
      const worker = new Worker('js/workers/interpolation-worker.js');
      worker.onmessage = (e) => {
        worker.terminate();
        resolve(e.data);
      };
      worker.onerror = (e) => {
        worker.terminate();
        reject(e);
      };
      worker.postMessage({ type: 'idw', points, bounds, options });
    });
  }

  // 3x3 Gaussian kernel smooth
  static _gaussianSmooth(grid, resolution) {
    const kernel = [
      [1, 2, 1],
      [2, 4, 2],
      [1, 2, 1]
    ];
    const kSum = 16;
    const out = Array(resolution).fill(null).map(() => Array(resolution).fill(0));
    for (let i = 0; i < resolution; i++) {
      for (let j = 0; j < resolution; j++) {
        let val = 0, wt = 0;
        for (let di = -1; di <= 1; di++) {
          for (let dj = -1; dj <= 1; dj++) {
            const ni = i + di, nj = j + dj;
            if (ni >= 0 && ni < resolution && nj >= 0 && nj < resolution) {
              const k = kernel[di + 1][dj + 1];
              val += grid[ni][nj] * k;
              wt += k;
            }
          }
        }
        out[i][j] = val / wt;
      }
    }
    return out;
  }

  // ==================== HIGH-RES CANVAS RENDERING ====================

  // Bilinear interpolation for smooth upscaling
  static _bilinearSample(grid, r, fi, fj) {
    const i0 = Math.floor(fi), j0 = Math.floor(fj);
    const i1 = Math.min(i0 + 1, r - 1), j1 = Math.min(j0 + 1, r - 1);
    const di = fi - i0, dj = fj - j0;
    return grid[i0][j0] * (1 - di) * (1 - dj) +
           grid[i1][j0] * di * (1 - dj) +
           grid[i0][j1] * (1 - di) * dj +
           grid[i1][j1] * di * dj;
  }

  // Render grid to HIGH-RES canvas with bilinear upscaling
  static renderGridToCanvas(gridResult, options = {}) {
    const { grid, resolution, stats } = gridResult;
    const opacity = options.opacity || 0.75;
    const cropId = options.cropId;
    const nutrient = options.nutrient;
    const paletteName = this._getPaletteForNutrient(nutrient);

    // Get agronomic ranges for discrete classification
    const ranges = cropId && nutrient && CROPS_DB[cropId]?.soil?.[nutrient]
      ? CROPS_DB[cropId].soil[nutrient] : null;

    // Upscale: render at 4x resolution for smooth appearance
    const scale = options.renderScale || 4;
    const canvasSize = resolution * scale;
    const canvas = document.createElement('canvas');
    canvas.width = canvasSize;
    canvas.height = canvasSize;
    const ctx = canvas.getContext('2d');
    const imgData = ctx.createImageData(canvasSize, canvasSize);
    const data = imgData.data;
    const alpha = Math.round(opacity * 255);

    for (let cy = 0; cy < canvasSize; cy++) {
      // Map canvas Y back to grid row (inverted: top of canvas = max lat = last row)
      const fi = (resolution - 1) - (cy / canvasSize) * (resolution - 1);
      for (let cx = 0; cx < canvasSize; cx++) {
        const fj = (cx / canvasSize) * (resolution - 1);
        const val = this._bilinearSample(grid, resolution, fi, fj);

        let rgb;
        if (ranges) {
          // Discrete classification by agronomic ranges
          rgb = this._classifyToRGB(val, ranges);
        } else {
          // Continuous color
          const t = stats.max > stats.min ? (val - stats.min) / (stats.max - stats.min) : 0.5;
          rgb = this._samplePalette(t, paletteName);
        }

        const idx = (cy * canvasSize + cx) * 4;
        data[idx] = rgb[0];
        data[idx + 1] = rgb[1];
        data[idx + 2] = rgb[2];
        data[idx + 3] = alpha;
      }
    }

    ctx.putImageData(imgData, 0, 0);
    return canvas;
  }

  // Classify value to RGB using agronomic ranges
  static _classifyToRGB(value, ranges) {
    const classColors = {
      mb: [200, 30, 30],    // Muy bajo — red
      b:  [245, 140, 60],   // Bajo — orange
      m:  [255, 210, 50],   // Medio — yellow
      a:  [100, 190, 60],   // Alto — light green
      ma: [25, 120, 40],    // Muy alto — dark green
      // Extras
      nulo: [100, 190, 60],
      bajo: [255, 210, 50],
      medio: [245, 140, 60],
      alto: [200, 30, 30],
      muyAlto: [150, 20, 20]
    };
    for (const [cls, [min, max]] of Object.entries(ranges)) {
      if (value >= min && value < max) {
        return classColors[cls] || [128, 128, 128];
      }
    }
    return [128, 128, 128];
  }

  // Legacy wrapper
  static getColor(value, colorScale = 'nutrient', ranges = null) {
    if (colorScale === 'nutrient' && ranges) {
      const rgb = this._classifyToRGB(value, ranges);
      return `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
    }
    const t = Math.max(0, Math.min(1, value));
    return this._continuousColor(t, colorScale);
  }

  // ==================== MANAGEMENT ZONES ====================

  // Generate management zones from interpolated nutrient grid (k-means style)
  static generateManagementZones(gridResult, numZones = 5) {
    const { grid, resolution, bounds } = gridResult;
    const flatValues = [];
    for (let i = 0; i < resolution; i++)
      for (let j = 0; j < resolution; j++)
        flatValues.push(grid[i][j]);

    flatValues.sort((a, b) => a - b);
    // Quantile-based zone breaks (robust, like DataFarm)
    const breaks = [flatValues[0]];
    for (let z = 1; z < numZones; z++) {
      const idx = Math.round((z / numZones) * (flatValues.length - 1));
      breaks.push(flatValues[idx]);
    }
    breaks.push(flatValues[flatValues.length - 1] + 0.001);

    // Classify each cell
    const zoneGrid = Array(resolution).fill(null).map(() => Array(resolution).fill(0));
    const zoneStats = Array(numZones).fill(null).map((_, z) => ({
      zone: z + 1,
      sum: 0, count: 0, sumLat: 0, sumLng: 0, min: Infinity, max: -Infinity
    }));

    const latStep = (bounds.maxLat - bounds.minLat) / resolution;
    const lngStep = (bounds.maxLng - bounds.minLng) / resolution;

    for (let i = 0; i < resolution; i++) {
      for (let j = 0; j < resolution; j++) {
        const val = grid[i][j];
        let z = numZones - 1;
        for (let k = 0; k < numZones; k++) {
          if (val >= breaks[k] && val < breaks[k + 1]) { z = k; break; }
        }
        zoneGrid[i][j] = z;
        const zs = zoneStats[z];
        zs.sum += val;
        zs.count++;
        zs.sumLat += bounds.minLat + (i + 0.5) * latStep;
        zs.sumLng += bounds.minLng + (j + 0.5) * lngStep;
        if (val < zs.min) zs.min = val;
        if (val > zs.max) zs.max = val;
      }
    }

    // Calculate zone centroids and means
    const zones = zoneStats.map(zs => ({
      zone: zs.zone,
      mean: zs.count > 0 ? Math.round((zs.sum / zs.count) * 100) / 100 : 0,
      min: Math.round(zs.min * 100) / 100,
      max: Math.round(zs.max * 100) / 100,
      centroidLat: zs.count > 0 ? zs.sumLat / zs.count : 0,
      centroidLng: zs.count > 0 ? zs.sumLng / zs.count : 0,
      cellCount: zs.count,
      areaPct: 0,
      color: this.PALETTES.zones[zs.zone - 1] || [128, 128, 128]
    }));

    const totalCells = resolution * resolution;
    zones.forEach(z => { z.areaPct = Math.round((z.cellCount / totalCells) * 100); });

    return { zoneGrid, zones, breaks, numZones, bounds, resolution };
  }

  // Render management zones to canvas
  static renderZonesToCanvas(zoneResult, options = {}) {
    const { zoneGrid, zones, numZones, resolution } = zoneResult;
    const scale = options.renderScale || 4;
    const canvasSize = resolution * scale;
    const opacity = options.opacity || 0.70;

    const canvas = document.createElement('canvas');
    canvas.width = canvasSize;
    canvas.height = canvasSize;
    const ctx = canvas.getContext('2d');
    const imgData = ctx.createImageData(canvasSize, canvasSize);
    const data = imgData.data;
    const alpha = Math.round(opacity * 255);

    for (let cy = 0; cy < canvasSize; cy++) {
      const gi = Math.min(resolution - 1, Math.floor(((canvasSize - 1 - cy) / canvasSize) * resolution));
      for (let cx = 0; cx < canvasSize; cx++) {
        const gj = Math.min(resolution - 1, Math.floor((cx / canvasSize) * resolution));
        const z = zoneGrid[gi][gj];
        const rgb = zones[z]?.color || [128, 128, 128];
        const idx = (cy * canvasSize + cx) * 4;
        data[idx] = rgb[0]; data[idx + 1] = rgb[1]; data[idx + 2] = rgb[2]; data[idx + 3] = alpha;
      }
    }

    ctx.putImageData(imgData, 0, 0);
    return canvas;
  }

  // ==================== ZONE LABELS ON MAP ====================

  // Add professional zone labels (DataFarm style) to Leaflet map
  static addZoneLabels(map, gridResult, options = {}) {
    const { grid, resolution, bounds, stats } = gridResult;
    const nutrient = options.nutrient || '';
    const unit = options.unit || '';
    const numLabels = options.numLabels || 8;
    const isPrescription = options.isPrescription || false;

    // Cluster grid cells into regions and find centroids for labels
    const labels = this._findLabelPositions(grid, resolution, bounds, numLabels, isPrescription);
    const markers = [];

    for (const lb of labels) {
      const displayVal = isPrescription
        ? Math.round(lb.value)
        : (Math.abs(lb.value) >= 10 ? Math.round(lb.value * 10) / 10 : Math.round(lb.value * 100) / 100);

      const labelText = isPrescription
        ? `${displayVal} kg/ha`
        : `${displayVal}${unit ? ' ' + unit : ''}`;

      const icon = L.divIcon({
        className: 'map-zone-label',
        html: `<span>${labelText}</span>`,
        iconSize: [0, 0],
        iconAnchor: [0, 0]
      });

      const marker = L.marker([lb.lat, lb.lng], { icon, interactive: false }).addTo(map);
      markers.push(marker);
    }

    return markers;
  }

  // Find optimal label positions by dividing grid into sub-regions
  static _findLabelPositions(grid, resolution, bounds, numLabels, isPrescription) {
    const latStep = (bounds.maxLat - bounds.minLat) / resolution;
    const lngStep = (bounds.maxLng - bounds.minLng) / resolution;

    // Divide into a sqrt(numLabels) x sqrt(numLabels) super-grid
    const divisions = Math.max(2, Math.ceil(Math.sqrt(numLabels * 1.5)));
    const blockRows = Math.ceil(resolution / divisions);
    const blockCols = Math.ceil(resolution / divisions);
    const labels = [];

    for (let bi = 0; bi < divisions; bi++) {
      for (let bj = 0; bj < divisions; bj++) {
        const i0 = bi * blockRows, i1 = Math.min(i0 + blockRows, resolution);
        const j0 = bj * blockCols, j1 = Math.min(j0 + blockCols, resolution);

        let sum = 0, cnt = 0;
        for (let i = i0; i < i1; i++) {
          for (let j = j0; j < j1; j++) {
            const v = isPrescription ? (grid[i][j].dose !== undefined ? grid[i][j].dose : grid[i][j]) : grid[i][j];
            sum += v; cnt++;
          }
        }
        if (cnt === 0) continue;
        const mean = sum / cnt;

        // Centroid of this block
        const midI = (i0 + i1) / 2;
        const midJ = (j0 + j1) / 2;
        const lat = bounds.minLat + (midI + 0.5) * latStep;
        const lng = bounds.minLng + (midJ + 0.5) * lngStep;

        labels.push({ lat, lng, value: mean });
      }
    }

    // Deduplicate labels that are too close and have similar values
    const filtered = [];
    const minDist = ((bounds.maxLat - bounds.minLat) + (bounds.maxLng - bounds.minLng)) / (divisions * 1.2);
    for (const lb of labels) {
      const tooClose = filtered.some(f => {
        const d = Math.sqrt(Math.pow(f.lat - lb.lat, 2) + Math.pow(f.lng - lb.lng, 2));
        return d < minDist * 0.6;
      });
      if (!tooClose) filtered.push(lb);
    }

    return filtered.slice(0, numLabels);
  }

  // ==================== FIELD BOUNDARY (PERÍMETRO) ====================

  // Parse KML file to GeoJSON polygon
  static parseKML(kmlText) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(kmlText, 'text/xml');
    const placemarks = doc.querySelectorAll('Placemark');
    const features = [];

    for (const pm of placemarks) {
      const name = pm.querySelector('name')?.textContent || '';
      // Try Polygon first, then LineString
      const coordsEl = pm.querySelector('Polygon coordinates, LinearRing coordinates, LineString coordinates');
      if (!coordsEl) continue;

      const coordText = coordsEl.textContent.trim();
      const coords = coordText.split(/\s+/).map(c => {
        const [lng, lat, alt] = c.split(',').map(Number);
        return [lng, lat];
      }).filter(c => !isNaN(c[0]) && !isNaN(c[1]));

      if (coords.length < 3) continue;
      // Ensure closed ring
      if (coords[0][0] !== coords[coords.length-1][0] || coords[0][1] !== coords[coords.length-1][1]) {
        coords.push([...coords[0]]);
      }

      features.push({
        type: 'Feature',
        properties: { name },
        geometry: { type: 'Polygon', coordinates: [coords] }
      });
    }

    return { type: 'FeatureCollection', features };
  }

  // Parse uploaded file (KML, GeoJSON, KMZ)
  static async parseFieldBoundary(file) {
    const ext = file.name.split('.').pop().toLowerCase();
    const text = await file.text();

    if (ext === 'geojson' || ext === 'json') {
      const gj = JSON.parse(text);
      // Normalize: could be Feature, FeatureCollection, or bare Geometry
      if (gj.type === 'FeatureCollection') return gj;
      if (gj.type === 'Feature') return { type: 'FeatureCollection', features: [gj] };
      if (gj.type === 'Polygon' || gj.type === 'MultiPolygon') {
        return { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: gj }] };
      }
      throw new Error('GeoJSON no contiene polígonos válidos');
    }

    if (ext === 'kml') {
      return this.parseKML(text);
    }

    if (ext === 'kmz') {
      // KMZ is a ZIP containing doc.kml
      if (typeof JSZip === 'undefined') {
        throw new Error('Para KMZ se necesita la librería JSZip. Use KML o GeoJSON.');
      }
      const zip = await JSZip.loadAsync(file);
      const kmlFile = zip.file(/\.kml$/i)[0];
      if (!kmlFile) throw new Error('No se encontró archivo KML dentro del KMZ');
      const kmlText = await kmlFile.async('string');
      return this.parseKML(kmlText);
    }

    throw new Error(`Formato "${ext}" no soportado. Use .kml, .geojson o .json`);
  }

  // Extract first polygon coordinates as [[lng,lat], ...] from GeoJSON FeatureCollection
  static getPolygonCoords(geojson) {
    for (const f of (geojson.features || [])) {
      if (f.geometry?.type === 'Polygon') return f.geometry.coordinates[0];
      if (f.geometry?.type === 'MultiPolygon') return f.geometry.coordinates[0][0];
    }
    return null;
  }

  // Calculate polygon area in hectares (Shoelace formula on projected coords)
  static polygonAreaHa(coords) {
    if (!coords || coords.length < 3) return 0;
    // Project to meters using equirectangular approximation
    const midLat = coords.reduce((s, c) => s + c[1], 0) / coords.length;
    const mPerDegLat = 111320;
    const mPerDegLng = 111320 * Math.cos(midLat * Math.PI / 180);
    let area = 0;
    for (let i = 0; i < coords.length; i++) {
      const j = (i + 1) % coords.length;
      const x0 = coords[i][0] * mPerDegLng, y0 = coords[i][1] * mPerDegLat;
      const x1 = coords[j][0] * mPerDegLng, y1 = coords[j][1] * mPerDegLat;
      area += x0 * y1 - x1 * y0;
    }
    return Math.abs(area / 2) / 10000; // m² → ha
  }

  // Point-in-polygon test (ray casting)
  static _pointInPolygon(lng, lat, polygon) {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const [xi, yi] = polygon[i], [xj, yj] = polygon[j];
      if (((yi > lat) !== (yj > lat)) && (lng < (xj - xi) * (lat - yi) / (yj - yi) + xi)) {
        inside = !inside;
      }
    }
    return inside;
  }

  // Create a polygon mask for a grid: true = inside polygon, false = outside
  static createPolygonMask(bounds, resolution, polygon) {
    if (!polygon || polygon.length < 3) return null;
    const latStep = (bounds.maxLat - bounds.minLat) / resolution;
    const lngStep = (bounds.maxLng - bounds.minLng) / resolution;
    const mask = Array(resolution).fill(null).map(() => Array(resolution).fill(false));

    for (let i = 0; i < resolution; i++) {
      const lat = bounds.minLat + (i + 0.5) * latStep;
      for (let j = 0; j < resolution; j++) {
        const lng = bounds.minLng + (j + 0.5) * lngStep;
        mask[i][j] = this._pointInPolygon(lng, lat, polygon);
      }
    }
    return mask;
  }

  // Apply polygon mask to a rendered canvas (make pixels outside polygon transparent)
  static applyPolygonClip(canvas, bounds, polygon) {
    if (!polygon || polygon.length < 3) return canvas;
    const w = canvas.width, h = canvas.height;
    const ctx = canvas.getContext('2d');
    const imgData = ctx.getImageData(0, 0, w, h);
    const data = imgData.data;

    for (let cy = 0; cy < h; cy++) {
      const lat = bounds.maxLat - ((cy / h) * (bounds.maxLat - bounds.minLat));
      for (let cx = 0; cx < w; cx++) {
        const lng = bounds.minLng + ((cx / w) * (bounds.maxLng - bounds.minLng));
        if (!this._pointInPolygon(lng, lat, polygon)) {
          const idx = (cy * w + cx) * 4;
          data[idx + 3] = 0; // Make transparent
        }
      }
    }

    ctx.putImageData(imgData, 0, 0);
    return canvas;
  }

  // Add field boundary polygon to Leaflet map
  static addBoundaryToMap(map, geojson, options = {}) {
    const layer = L.geoJSON(geojson, {
      style: {
        color: options.color || '#ffffff',
        weight: options.weight || 3,
        fillOpacity: 0,
        opacity: 0.9,
        dashArray: options.dashed ? '8, 6' : null
      }
    }).addTo(map);
    return layer;
  }

  // ==================== PRESCRIPTION MAP ====================

  /**
   * Generate prescription map with DataFarm-style dose calculation.
   * Uses yield-adjusted extraction, response curves, and dose safety limits.
   *
   * @param {Object} gridResult - Interpolated nutrient grid from IDW/Kriging
   * @param {string} nutrient - Soil nutrient key (P, K, Ca, Mg, S)
   * @param {string} cropId - Crop identifier
   * @param {number} yieldTarget - Target yield in crop units
   * @param {string} fertSource - Fertilizer source key
   * @param {Object} [options] - Optional overrides
   * @param {number} [options.minDose=0] - Minimum dose (kg/ha)
   * @param {number} [options.maxDose] - Maximum dose cap (kg/ha)
   * @param {string} [options.managementType='normal'] - 'corrective'|'normal'|'maintenance'
   */
  static generatePrescription(gridResult, nutrient, cropId, yieldTarget, fertSource, options = {}) {
    const crop = CROPS_DB[cropId];
    if (!crop || !gridResult) return null;

    const { grid, resolution, bounds, latStep, lngStep } = gridResult;
    const prescGrid = [];
    let totalDose = 0, minDose = Infinity, maxDose = -Infinity, cellCount = 0;
    const warnings = [];

    const nutrientToFert = { 'P': 'P2O5', 'K': 'K2O', 'Ca': 'Ca', 'Mg': 'Mg', 'S': 'S' };
    const fertKey = nutrientToFert[nutrient] || nutrient;

    // Yield-adjusted extraction (uses yieldProfile system)
    const yieldProfile = typeof InterpretationEngine !== 'undefined' && InterpretationEngine.getYieldProfile
      ? InterpretationEngine.getYieldProfile(crop, yieldTarget)
      : { extractionMult: 1.0, efficiencyMult: 1.0 };

    const baseExtraction = crop.extraction[fertKey] || 0;
    const adjustedExtraction = baseExtraction * yieldProfile.extractionMult * yieldTarget;
    const baseEfficiency = crop.efficiency[fertKey] || 0.50;
    const efficiency = Math.max(0.10, Math.min(0.95, baseEfficiency * yieldProfile.efficiencyMult));

    // Management type multiplier (DataFarm methodology)
    //   corrective: build soil fertility → higher doses
    //   normal: standard replacement + correction
    //   maintenance: replace export only → lower doses
    const managementType = options.managementType || 'normal';
    const mgmtMultiplier = { corrective: 1.3, normal: 1.0, maintenance: 0.7 }[managementType] || 1.0;

    // Supply factor response curve (DataFarm-style: soil class → proportion supplied by soil)
    const supplyFactors = { mb: 0.0, b: 0.15, m: 0.40, a: 0.70, ma: 1.0 };

    // Dose safety limits
    const userMinDose = options.minDose || 0;
    // Max dose per nutrient (agronomic safety): prevents over-application
    const safetyMaxDoses = {
      N: 200, P2O5: 250, K2O: 200, Ca: 3000, Mg: 500, S: 80,
      B: 5, Cu: 6, Fe: 20, Mn: 15, Zn: 10
    };
    const userMaxDose = options.maxDose || safetyMaxDoses[fertKey] || 500;

    for (let i = 0; i < resolution; i++) {
      prescGrid[i] = [];
      for (let j = 0; j < resolution; j++) {
        const soilValue = grid[i][j];
        const cls = InterpretationEngine.classifySoil(nutrient, soilValue, cropId);

        // Calculate dose using response curve
        const supplyFactor = supplyFactors[cls.class] !== undefined ? supplyFactors[cls.class] : 0.3;
        const soilSupply = adjustedExtraction * supplyFactor;
        const netNeed = Math.max(0, adjustedExtraction - soilSupply);

        // Apply management type and efficiency
        let dose = (netNeed / efficiency) * mgmtMultiplier;

        // Clamp to safety limits
        dose = Math.max(userMinDose, Math.min(userMaxDose, dose));

        prescGrid[i][j] = {
          soilValue,
          soilClass: cls.class,
          dose: Math.round(dose * 10) / 10,
          netNeed: Math.round(netNeed * 10) / 10
        };
        totalDose += dose;
        if (dose < minDose) minDose = dose;
        if (dose > maxDose) maxDose = dose;
        cellCount++;
      }
    }

    // Warn if doses hit safety cap
    if (maxDose >= userMaxDose * 0.99) {
      warnings.push(`Dosis máxima alcanzó el límite de seguridad (${userMaxDose} kg/ha ${fertKey}). Verificar con agrónomo.`);
    }

    const source = FERTILIZER_SOURCES[fertSource];
    const sourceContent = source ? (source[fertKey] || 0) : 0;
    const meanDose = cellCount > 0 ? totalDose / cellCount : 0;

    return {
      grid: prescGrid, bounds, resolution, nutrient, fertKey, cropId, yieldTarget,
      managementType,
      yieldProfile: yieldProfile.label || 'Default',
      warnings,
      stats: {
        minDose: Math.round(minDose * 10) / 10,
        maxDose: Math.round(maxDose * 10) / 10,
        meanDose: Math.round(meanDose * 10) / 10,
        totalDose: Math.round(meanDose),
        extractionPerTon: Math.round(baseExtraction * yieldProfile.extractionMult * 1000) / 1000,
        efficiency: Math.round(efficiency * 100)
      },
      source: source ? {
        name: source.name, content: sourceContent,
        meanProductKgHa: sourceContent > 0 ? Math.round((meanDose / sourceContent) * 100) : 0
      } : null
    };
  }

  // Render prescription to HIGH-RES canvas
  static renderPrescriptionToCanvas(prescResult, options = {}) {
    const { grid, resolution, stats } = prescResult;
    const scale = options.renderScale || 4;
    const canvasSize = resolution * scale;
    const opacity = options.opacity || 0.75;

    // Extract dose grid for bilinear
    const doseGrid = grid.map(row => row.map(c => c.dose));

    const canvas = document.createElement('canvas');
    canvas.width = canvasSize;
    canvas.height = canvasSize;
    const ctx = canvas.getContext('2d');
    const imgData = ctx.createImageData(canvasSize, canvasSize);
    const data = imgData.data;
    const alpha = Math.round(opacity * 255);

    for (let cy = 0; cy < canvasSize; cy++) {
      const fi = (resolution - 1) - (cy / canvasSize) * (resolution - 1);
      for (let cx = 0; cx < canvasSize; cx++) {
        const fj = (cx / canvasSize) * (resolution - 1);
        const dose = this._bilinearSample(doseGrid, resolution, fi, fj);
        const t = stats.maxDose > stats.minDose ? (dose - stats.minDose) / (stats.maxDose - stats.minDose) : 0.5;
        const rgb = this._samplePalette(t, 'prescription');
        const idx = (cy * canvasSize + cx) * 4;
        data[idx] = rgb[0]; data[idx + 1] = rgb[1]; data[idx + 2] = rgb[2];
        data[idx + 3] = dose > 0 ? alpha : Math.round(0.15 * 255);
      }
    }
    ctx.putImageData(imgData, 0, 0);
    return canvas;
  }

  // ==================== LEAFLET INTEGRATION ====================

  static addToLeafletMap(map, gridResult, options = {}) {
    let canvas = options.isPrescription
      ? this.renderPrescriptionToCanvas(gridResult, options)
      : options.isZones
        ? this.renderZonesToCanvas(gridResult, options)
        : this.renderGridToCanvas(gridResult, options);

    // Apply polygon clipping if boundary provided
    if (options.polygon) {
      canvas = this.applyPolygonClip(canvas, gridResult.bounds, options.polygon);
    }

    const bounds = gridResult.bounds;
    const imageBounds = [[bounds.minLat, bounds.minLng], [bounds.maxLat, bounds.maxLng]];
    const imageUrl = canvas.toDataURL('image/png');
    const overlay = L.imageOverlay(imageUrl, imageBounds, {
      opacity: options.layerOpacity || 0.85,
      interactive: false
    });
    overlay.addTo(map);
    return overlay;
  }

  // Create professional legend element
  static createLegend(nutrient, cropId, stats, options = {}) {
    const ranges = cropId && CROPS_DB[cropId]?.soil?.[nutrient]
      ? CROPS_DB[cropId].soil[nutrient] : null;
    const info = NUTRIENT_INFO[nutrient] || { label: nutrient, unit: '' };
    const div = document.createElement('div');
    div.className = 'map-legend pro';

    div.innerHTML = `<div class="legend-title">${info.label} (${info.unit})</div>`;

    if (ranges) {
      const classRGB = {
        mb: [200,30,30], b: [245,140,60], m: [255,210,50],
        a: [100,190,60], ma: [25,120,40],
        nulo: [100,190,60], bajo: [255,210,50], medio: [245,140,60],
        alto: [200,30,30], muyAlto: [150,20,20]
      };
      for (const [cls, [min, max]] of Object.entries(ranges)) {
        const rgb = classRGB[cls] || [128,128,128];
        const label = CLASS_LABELS[cls] || cls;
        const rangeText = max >= 999 ? `> ${min}` : `${min} – ${max}`;
        div.innerHTML += `<div class="legend-item">
          <span class="legend-color" style="background:rgb(${rgb.join(',')})"></span>
          <span class="legend-label">${label}:</span> <span class="legend-range">${rangeText}</span>
        </div>`;
      }
    } else {
      // Gradient bar for continuous scale
      const palName = this._getPaletteForNutrient(nutrient);
      let gradStops = '';
      for (let t = 0; t <= 1; t += 0.1) {
        const rgb = this._samplePalette(t, palName);
        gradStops += `,rgb(${rgb.join(',')}) ${Math.round(t*100)}%`;
      }
      div.innerHTML += `<div class="legend-gradient" style="background:linear-gradient(to right${gradStops});height:16px;border-radius:4px;margin:8px 0"></div>`;
      div.innerHTML += `<div class="legend-gradient-labels"><span>${stats?.min ?? ''}</span><span>${stats?.mean ?? ''}</span><span>${stats?.max ?? ''}</span></div>`;
    }

    if (stats) {
      div.innerHTML += `<div class="legend-stats">Min: ${stats.min} | Media: ${stats.mean} | Max: ${stats.max} | Puntos: ${stats.points}</div>`;
    }
    return div;
  }

  // Create prescription legend
  static createPrescLegend(prescResult, numZones = 5) {
    const { stats, fertKey, source } = prescResult;
    const div = document.createElement('div');
    div.className = 'map-legend pro';
    div.innerHTML = `<div class="legend-title">Prescripción ${fertKey} (kg/ha)</div>`;

    const range = stats.maxDose - stats.minDose;
    for (let z = 0; z < numZones; z++) {
      const t0 = z / numZones, t1 = (z + 1) / numZones;
      const minD = Math.round(stats.minDose + t0 * range);
      const maxD = Math.round(stats.minDose + t1 * range);
      const rgb = this._samplePalette((t0 + t1) / 2, 'prescription');
      div.innerHTML += `<div class="legend-item">
        <span class="legend-color" style="background:rgb(${rgb.join(',')})"></span>
        <span class="legend-range">${minD} – ${maxD} kg/ha</span>
      </div>`;
    }

    if (source) {
      div.innerHTML += `<div class="legend-stats">${source.name}: media ${source.meanProductKgHa} kg/ha producto</div>`;
    }
    return div;
  }

  // ==================== SAMPLE POINT MARKERS ====================

  static addSampleMarkers(map, points, nutrient, options = {}) {
    const markers = [];
    const ranges = options.cropId && CROPS_DB[options.cropId]?.soil?.[nutrient]
      ? CROPS_DB[options.cropId].soil[nutrient] : null;

    // Use marker clustering for large point sets (500+) to maintain performance
    const useCluster = points.length >= 500 && typeof L.markerClusterGroup === 'function';
    const clusterGroup = useCluster ? L.markerClusterGroup({
      maxClusterRadius: 40,
      showCoverageOnHover: false,
      zoomToBoundsOnClick: true,
      disableClusteringAtZoom: 16
    }) : null;

    for (const p of points) {
      let fillColor = '#fff';
      if (ranges) {
        const rgb = this._classifyToRGB(p.value, ranges);
        fillColor = `rgb(${rgb.join(',')})`;
      }

      const marker = L.circleMarker([p.lat, p.lng], {
        radius: 7,
        fillColor,
        color: '#222',
        weight: 2.5,
        fillOpacity: 0.95
      }).bindPopup(`
        <div style="text-align:center;font-weight:bold;font-size:14px">${p.value}</div>
        <div style="text-align:center;font-size:11px;color:#666">${nutrient} — Punto ${p.name || ''}</div>
      `);

      if (useCluster) {
        clusterGroup.addLayer(marker);
      } else {
        marker.addTo(map);
      }
      markers.push(marker);
    }

    if (useCluster) {
      clusterGroup.addTo(map);
      // Attach cluster group reference so callers can remove it via map.removeLayer()
      markers._clusterGroup = clusterGroup;
    }

    return markers;
  }

  // ==================== EXPORT ====================

  static prescriptionToGeoJSON(prescResult) {
    const { grid, bounds, resolution, fertKey, source, stats } = prescResult;
    const latStep = (bounds.maxLat - bounds.minLat) / resolution;
    const lngStep = (bounds.maxLng - bounds.minLng) / resolution;
    const features = [];

    for (let i = 0; i < resolution; i++) {
      for (let j = 0; j < resolution; j++) {
        const cell = grid[i][j];
        if (cell.dose <= 0) continue;
        const lat0 = bounds.minLat + i * latStep, lat1 = lat0 + latStep;
        const lng0 = bounds.minLng + j * lngStep, lng1 = lng0 + lngStep;
        features.push({
          type: 'Feature',
          properties: {
            nutrient: fertKey, dose_kg_ha: cell.dose, soil_value: cell.soilValue,
            soil_class: cell.soilClass, product: source?.name || '',
            product_kg_ha: source?.content > 0 ? Math.round((cell.dose / source.content) * 100) : 0
          },
          geometry: { type: 'Polygon', coordinates: [[[lng0,lat0],[lng1,lat0],[lng1,lat1],[lng0,lat1],[lng0,lat0]]] }
        });
      }
    }
    return {
      type: 'FeatureCollection',
      properties: { nutrient: fertKey, crop: prescResult.cropId, yieldTarget: prescResult.yieldTarget, meanDose: stats.meanDose, source: source?.name || '', generated: new Date().toISOString() },
      features
    };
  }

  static prescriptionToZones(prescResult, numZones = 5) {
    const { grid, resolution, stats } = prescResult;
    const doseRange = stats.maxDose - stats.minDose;
    if (doseRange <= 0) numZones = 1;
    const zoneStep = doseRange / numZones;
    const zones = Array(numZones).fill(null).map((_, i) => ({
      zone: i + 1,
      minDose: Math.round((stats.minDose + i * zoneStep) * 10) / 10,
      maxDose: Math.round((stats.minDose + (i + 1) * zoneStep) * 10) / 10,
      meanDose: 0, cellCount: 0, areaPct: 0
    }));
    let totalCells = 0;
    for (let i = 0; i < resolution; i++) {
      for (let j = 0; j < resolution; j++) {
        const dose = grid[i][j].dose;
        let zoneIdx = Math.floor((dose - stats.minDose) / zoneStep);
        if (zoneIdx >= numZones) zoneIdx = numZones - 1;
        if (zoneIdx < 0) zoneIdx = 0;
        zones[zoneIdx].meanDose += dose;
        zones[zoneIdx].cellCount++;
        totalCells++;
      }
    }
    zones.forEach(z => {
      z.meanDose = z.cellCount > 0 ? Math.round((z.meanDose / z.cellCount) * 10) / 10 : 0;
      z.areaPct = Math.round((z.cellCount / totalCells) * 100);
    });
    return zones;
  }

  // ==================== SHAPEFILE EXPORT (VRT for farm equipment) ====================

  /**
   * Generate a binary Shapefile (.shp/.shx/.dbf/.prj) ZIP for prescription maps.
   * Compatible with John Deere GreenStar, Case IH AFS, New Holland IntelliView, generic ISOBUS.
   *
   * @param {Object} prescResult - Prescription result from generatePrescription()
   * @param {Array} polygon - Field boundary polygon
   * @param {Object} [options] - Export options
   * @param {string} [options.crs='wgs84'] - 'wgs84' or 'utm' (auto-detect UTM zone from centroid)
   */
  static prescriptionToSHP(prescResult, polygon, options = {}) {
    const { grid, bounds, resolution, fertKey, source, stats } = prescResult;
    const latStep = (bounds.maxLat - bounds.minLat) / resolution;
    const lngStep = (bounds.maxLng - bounds.minLng) / resolution;

    // Collect zone polygons with dose values
    const zones = [];
    for (let i = 0; i < resolution; i++) {
      for (let j = 0; j < resolution; j++) {
        const cell = grid[i][j];
        if (cell.dose <= 0) continue;
        const lat0 = bounds.minLat + i * latStep, lat1 = lat0 + latStep;
        const lng0 = bounds.minLng + j * lngStep, lng1 = lng0 + lngStep;

        // Check if center is inside polygon
        if (polygon && polygon.length >= 3) {
          const cx = (lng0 + lng1) / 2, cy = (lat0 + lat1) / 2;
          if (!this._pointInPolygon(cx, cy, polygon)) continue;
        }

        zones.push({
          coords: [[lng0,lat0],[lng1,lat0],[lng1,lat1],[lng0,lat1],[lng0,lat0]],
          dose: Math.round(cell.dose * 10) / 10,
          product_kg: source?.content > 0 ? Math.round((cell.dose / source.content) * 100) : 0,
          zone: cell.soilClass || 0
        });
      }
    }

    if (zones.length === 0) return null;

    // === Build binary shapefile components ===

    // 1. .prj - Projection (WGS84 geographic or UTM)
    const useCrs = options.crs || 'wgs84';
    let prj;

    if (useCrs === 'utm') {
      // Auto-detect UTM zone from field centroid
      const centLng = (bounds.minLng + bounds.maxLng) / 2;
      const centLat = (bounds.minLat + bounds.maxLat) / 2;
      const utmZone = Math.floor((centLng + 180) / 6) + 1;
      const hemisphere = centLat >= 0 ? 'N' : 'S';
      const epsg = centLat >= 0 ? 32600 + utmZone : 32700 + utmZone;
      const falseNorthing = centLat >= 0 ? 0 : 10000000;

      prj = `PROJCS["WGS 84 / UTM zone ${utmZone}${hemisphere}",GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",SPHEROID["WGS_1984",6378137.0,298.257223563]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]],PROJECTION["Transverse_Mercator"],PARAMETER["False_Easting",500000.0],PARAMETER["False_Northing",${falseNorthing}.0],PARAMETER["Central_Meridian",${(utmZone - 1) * 6 - 180 + 3}.0],PARAMETER["Scale_Factor",0.9996],PARAMETER["Latitude_Of_Origin",0.0],UNIT["Meter",1.0]]`;

      // Convert coordinates to UTM
      const toUTM = (lng, lat) => {
        // Simplified UTM conversion (accurate to ~1m for small fields)
        const d2r = Math.PI / 180;
        const a = 6378137.0; // WGS84 semi-major axis
        const f = 1 / 298.257223563;
        const e = Math.sqrt(2 * f - f * f);
        const e2 = e * e / (1 - e * e);
        const centralMeridian = (utmZone - 1) * 6 - 180 + 3;

        const phi = lat * d2r;
        const lambda = (lng - centralMeridian) * d2r;
        const N = a / Math.sqrt(1 - e * e * Math.sin(phi) * Math.sin(phi));
        const T = Math.tan(phi) * Math.tan(phi);
        const C = e2 * Math.cos(phi) * Math.cos(phi);
        const A = Math.cos(phi) * lambda;
        const M = a * ((1 - e*e/4 - 3*e*e*e*e/64) * phi - (3*e*e/8 + 3*e*e*e*e/32) * Math.sin(2*phi) + (15*e*e*e*e/256) * Math.sin(4*phi));

        const easting = 500000 + 0.9996 * N * (A + (1-T+C)*A*A*A/6 + (5-18*T+T*T)*A*A*A*A*A/120);
        const northing = falseNorthing + 0.9996 * (M + N * Math.tan(phi) * (A*A/2 + (5-T+9*C+4*C*C)*A*A*A*A/24));
        return [easting, northing];
      };

      // Convert all zone coordinates to UTM
      for (const z of zones) {
        z.coords = z.coords.map(([lng, lat]) => toUTM(lng, lat));
      }
    } else {
      prj = 'GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",SPHEROID["WGS_1984",6378137.0,298.257223563]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]]';
    }

    // 2. .dbf - dBASE III fields: DOSE (N,10,1), PRODUCT (N,10,0), ZONE (N,5,0)
    const dbfFields = [
      { name: 'DOSE', type: 'N', size: 10, decimal: 1 },
      { name: 'PRODUCT', type: 'N', size: 10, decimal: 0 },
      { name: 'ZONE', type: 'N', size: 5, decimal: 0 }
    ];
    const recordSize = 1 + dbfFields.reduce((s, f) => s + f.size, 0); // 1 for deletion flag
    const headerSize = 32 + dbfFields.length * 32 + 1;
    const dbfSize = headerSize + zones.length * recordSize + 1;
    const dbf = new ArrayBuffer(dbfSize);
    const dbfView = new DataView(dbf);
    const dbfBytes = new Uint8Array(dbf);

    // DBF header
    dbfView.setUint8(0, 3); // version
    const now = new Date();
    dbfView.setUint8(1, now.getFullYear() - 1900);
    dbfView.setUint8(2, now.getMonth() + 1);
    dbfView.setUint8(3, now.getDate());
    dbfView.setUint32(4, zones.length, true);
    dbfView.setUint16(8, headerSize, true);
    dbfView.setUint16(10, recordSize, true);

    // Field descriptors
    let fOff = 32;
    for (const f of dbfFields) {
      for (let c = 0; c < 11; c++) dbfBytes[fOff + c] = c < f.name.length ? f.name.charCodeAt(c) : 0;
      dbfBytes[fOff + 11] = f.type.charCodeAt(0);
      dbfView.setUint8(fOff + 16, f.size);
      dbfView.setUint8(fOff + 17, f.decimal);
      fOff += 32;
    }
    dbfBytes[fOff] = 0x0D; // header terminator

    // DBF records
    let rOff = headerSize;
    for (const z of zones) {
      dbfBytes[rOff] = 0x20; // valid record
      const vals = [z.dose.toFixed(1), String(z.product_kg), String(z.zone)];
      let vOff = rOff + 1;
      for (let fi = 0; fi < dbfFields.length; fi++) {
        const str = vals[fi].padStart(dbfFields[fi].size, ' ');
        for (let c = 0; c < dbfFields[fi].size; c++) {
          dbfBytes[vOff + c] = c < str.length ? str.charCodeAt(c) : 0x20;
        }
        vOff += dbfFields[fi].size;
      }
      rOff += recordSize;
    }
    dbfBytes[rOff] = 0x1A; // EOF

    // 3. .shp + .shx — Polygon type (5)
    const numRings = 1;
    const ptsPerZone = 5; // closed polygon
    const recordContentLen = (4 + 4*8 + 4 + 4 + 4*numRings + 8*2*ptsPerZone) / 2; // in 16-bit words (Float64=8 bytes per coord)
    const shpRecordLen = recordContentLen + 4; // +4 for record header

    const shpFileLen = 50 + zones.length * (shpRecordLen + 4); // 50 = 100-byte header / 2
    const shxFileLen = 50 + zones.length * 4; // 8 bytes per index entry / 2

    const shp = new ArrayBuffer(shpFileLen * 2);
    const shpView = new DataView(shp);
    const shx = new ArrayBuffer(shxFileLen * 2);
    const shxView = new DataView(shx);

    // Compute actual bounding box from zone coordinates
    let bbMinX = Infinity, bbMinY = Infinity, bbMaxX = -Infinity, bbMaxY = -Infinity;
    for (const z of zones) {
      for (const [x, y] of z.coords) {
        if (x < bbMinX) bbMinX = x;
        if (y < bbMinY) bbMinY = y;
        if (x > bbMaxX) bbMaxX = x;
        if (y > bbMaxY) bbMaxY = y;
      }
    }

    // SHP/SHX headers
    const writeShpHeader = (view, fileLen) => {
      view.setInt32(0, 9994); // file code (big-endian)
      view.setInt32(24, fileLen); // file length in 16-bit words (big-endian)
      view.setInt32(28, 1000, true); // version
      view.setInt32(32, 5, true); // shape type: Polygon
      // Bounding box (adapts to CRS: WGS84 or UTM)
      view.setFloat64(36, bbMinX, true);
      view.setFloat64(44, bbMinY, true);
      view.setFloat64(52, bbMaxX, true);
      view.setFloat64(60, bbMaxY, true);
    };
    writeShpHeader(shpView, shpFileLen);
    writeShpHeader(shxView, shxFileLen);

    let shpOff = 100;
    let shxOff = 100;
    zones.forEach((z, idx) => {
      // SHX index record (big-endian)
      shxView.setInt32(shxOff, shpOff / 2); // offset
      shxView.setInt32(shxOff + 4, recordContentLen); // content length
      shxOff += 8;

      // SHP record header (big-endian)
      shpView.setInt32(shpOff, idx + 1); // record number (1-based)
      shpView.setInt32(shpOff + 4, recordContentLen); // content length
      shpOff += 8;

      // SHP record content (little-endian)
      shpView.setInt32(shpOff, 5, true); // shape type: Polygon
      const coords = z.coords;
      const xs = coords.map(c => c[0]), ys = coords.map(c => c[1]);
      shpView.setFloat64(shpOff + 4, Math.min(...xs), true);
      shpView.setFloat64(shpOff + 12, Math.min(...ys), true);
      shpView.setFloat64(shpOff + 20, Math.max(...xs), true);
      shpView.setFloat64(shpOff + 28, Math.max(...ys), true);
      shpView.setInt32(shpOff + 36, 1, true); // numParts
      shpView.setInt32(shpOff + 40, ptsPerZone, true); // numPoints
      shpView.setInt32(shpOff + 44, 0, true); // parts[0] = 0

      let ptOff = shpOff + 48;
      for (const c of coords) {
        shpView.setFloat64(ptOff, c[0], true); // x (lng)
        shpView.setFloat64(ptOff + 8, c[1], true); // y (lat)
        ptOff += 16;
      }
      shpOff = ptOff;
    });

    // 4. Create ZIP file manually (minimal ZIP spec for 4 files)
    return this._createZip({
      [`prescripcion_${fertKey}.shp`]: new Uint8Array(shp),
      [`prescripcion_${fertKey}.shx`]: new Uint8Array(shx),
      [`prescripcion_${fertKey}.dbf`]: new Uint8Array(dbf),
      [`prescripcion_${fertKey}.prj`]: new TextEncoder().encode(prj)
    });
  }

  // Minimal ZIP file creator (no compression, just store)
  static _createZip(files) {
    const entries = Object.entries(files);
    let centralDirSize = 0;
    let localOffset = 0;
    const localHeaders = [];
    const centralHeaders = [];

    for (const [name, data] of entries) {
      const nameBytes = new TextEncoder().encode(name);
      const localHeader = new Uint8Array(30 + nameBytes.length);
      const lView = new DataView(localHeader.buffer);
      lView.setUint32(0, 0x04034B50, true); // local file header sig
      lView.setUint16(4, 20, true); // version needed
      lView.setUint16(8, 0, true); // compression: store
      lView.setUint16(12, 0, true); // mod time
      lView.setUint16(14, 0, true); // mod date
      lView.setUint32(18, this._crc32(data), true); // CRC32
      lView.setUint32(22, data.length, true); // compressed size
      lView.setUint32(26, data.length, true); // uncompressed size
      lView.setUint16(30 - 4, nameBytes.length, true); // fix: offset 26 is uncompressed
      // Redo offsets properly
      const lh = new ArrayBuffer(30 + nameBytes.length);
      const lhv = new DataView(lh);
      const lhb = new Uint8Array(lh);
      lhv.setUint32(0, 0x04034B50, true);
      lhv.setUint16(4, 20, true);
      lhv.setUint16(8, 0, true);
      lhv.setUint32(14, this._crc32(data), true);
      lhv.setUint32(18, data.length, true);
      lhv.setUint32(22, data.length, true);
      lhv.setUint16(26, nameBytes.length, true);
      lhv.setUint16(28, 0, true);
      lhb.set(nameBytes, 30);

      const ch = new ArrayBuffer(46 + nameBytes.length);
      const chv = new DataView(ch);
      const chb = new Uint8Array(ch);
      chv.setUint32(0, 0x02014B50, true);
      chv.setUint16(4, 20, true);
      chv.setUint16(6, 20, true);
      chv.setUint16(10, 0, true);
      chv.setUint32(16, this._crc32(data), true);
      chv.setUint32(20, data.length, true);
      chv.setUint32(24, data.length, true);
      chv.setUint16(28, nameBytes.length, true);
      chv.setUint32(42, localOffset, true);
      chb.set(nameBytes, 46);

      localHeaders.push({ header: new Uint8Array(lh), data });
      centralHeaders.push(new Uint8Array(ch));
      localOffset += 30 + nameBytes.length + data.length;
      centralDirSize += 46 + nameBytes.length;
    }

    // End of central directory
    const eocd = new ArrayBuffer(22);
    const eocdv = new DataView(eocd);
    eocdv.setUint32(0, 0x06054B50, true);
    eocdv.setUint16(8, entries.length, true);
    eocdv.setUint16(10, entries.length, true);
    eocdv.setUint32(12, centralDirSize, true);
    eocdv.setUint32(16, localOffset, true);

    // Assemble
    const totalSize = localOffset + centralDirSize + 22;
    const result = new Uint8Array(totalSize);
    let off = 0;
    for (const { header, data } of localHeaders) {
      result.set(header, off); off += header.length;
      result.set(data, off); off += data.length;
    }
    for (const ch of centralHeaders) {
      result.set(ch, off); off += ch.length;
    }
    result.set(new Uint8Array(eocd), off);

    return result;
  }

  static _crc32(data) {
    let crc = 0xFFFFFFFF;
    if (!InterpolationEngine._crcTable) {
      InterpolationEngine._crcTable = new Uint32Array(256);
      for (let i = 0; i < 256; i++) {
        let c = i;
        for (let j = 0; j < 8; j++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
        InterpolationEngine._crcTable[i] = c;
      }
    }
    for (let i = 0; i < data.length; i++) {
      crc = InterpolationEngine._crcTable[(crc ^ data[i]) & 0xFF] ^ (crc >>> 8);
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }

  // ==================== PROFESSIONAL PDF MAP EXPORT ====================

  // Generate a professional vertical PDF for a single nutrient map
  // Matches the reference format: logo, coordinate grid, compass rose, legend, area table, scale bar
  static generateNutrientMapPDF(options) {
    const { canvas, gridResult, polygon, nutrient, cropId, stats, clientData, logoImg } = options;
    const info = typeof NUTRIENT_INFO !== 'undefined' ? (NUTRIENT_INFO[nutrient] || { label: nutrient, unit: '' }) : { label: nutrient, unit: '' };

    // A4 vertical proportions: 595 x 842 pts → we use 1190 x 1684 px (2x)
    const W = 1190, H = 1684;
    const pdf = document.createElement('canvas');
    pdf.width = W; pdf.height = H;
    const ctx = pdf.getContext('2d');

    // White background
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, W, H);

    // === HEADER BAR ===
    const headerH = 100;
    ctx.fillStyle = '#1a3a2a';
    ctx.fillRect(0, 0, W, headerH);

    // Title
    ctx.font = 'bold 36px Inter, Arial, sans-serif';
    ctx.fillStyle = '#FFFFFF';
    ctx.textAlign = 'left';
    ctx.fillText(`Mapa de ${info.label}`, 40, 50);

    // Subtitle
    ctx.font = '22px Inter, Arial, sans-serif';
    ctx.fillStyle = '#a8d5a0';
    const propName = clientData?.propiedad || clientData?.nombre || '';
    const loteName = clientData?.lote || '';
    ctx.fillText(`${propName}${loteName ? ' — ' + loteName : ''}`, 40, 82);

    // Logo (right side)
    if (logoImg && logoImg.complete) {
      const lh = 60, lw = logoImg.width * (lh / logoImg.height);
      ctx.drawImage(logoImg, W - lw - 30, 20, lw, lh);
    }

    // === CLIENT INFO BAR ===
    const infoY = headerH + 10;
    ctx.font = '18px Inter, Arial, sans-serif';
    ctx.fillStyle = '#333';
    ctx.textAlign = 'left';
    const infoItems = [
      clientData?.nombre ? `Cliente: ${clientData.nombre}` : null,
      clientData?.ubicacion ? `Ubicación: ${clientData.ubicacion}` : null,
      `Fecha: ${new Date().toLocaleDateString('es-ES')}`,
      cropId ? `Cultivo: ${cropId}` : null
    ].filter(Boolean);
    ctx.fillText(infoItems.join('  |  '), 40, infoY + 24);

    // === MAP AREA with coordinate grid ===
    const mapX = 60, mapY = infoY + 50;
    const mapW = W - 120, mapH = Math.round(mapW * 0.75);

    // Coordinate grid border
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 2;
    ctx.strokeRect(mapX, mapY, mapW, mapH);

    // Draw coordinate tick marks and labels
    const b = gridResult.bounds;
    ctx.font = '12px monospace';
    ctx.fillStyle = '#555';

    // Lat ticks (left side)
    for (let t = 0; t <= 4; t++) {
      const y = mapY + (t / 4) * mapH;
      const lat = b.maxLat - (t / 4) * (b.maxLat - b.minLat);
      ctx.textAlign = 'right';
      ctx.fillText(lat.toFixed(5) + '°', mapX - 6, y + 4);
      ctx.beginPath(); ctx.moveTo(mapX, y); ctx.lineTo(mapX + 8, y); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(mapX + mapW - 8, y); ctx.lineTo(mapX + mapW, y); ctx.stroke();
    }
    // Lng ticks (bottom)
    for (let t = 0; t <= 4; t++) {
      const x = mapX + (t / 4) * mapW;
      const lng = b.minLng + (t / 4) * (b.maxLng - b.minLng);
      ctx.textAlign = 'center';
      ctx.fillText(lng.toFixed(5) + '°', x, mapY + mapH + 18);
      ctx.beginPath(); ctx.moveTo(x, mapY + mapH - 8); ctx.lineTo(x, mapY + mapH); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x, mapY); ctx.lineTo(x, mapY + 8); ctx.stroke();
    }

    // Draw interpolated map image
    ctx.save();
    ctx.beginPath();
    ctx.rect(mapX + 1, mapY + 1, mapW - 2, mapH - 2);
    ctx.clip();
    ctx.drawImage(canvas, mapX + 1, mapY + 1, mapW - 2, mapH - 2);
    ctx.restore();

    // Draw field boundary on map
    if (polygon && polygon.length > 2) {
      ctx.beginPath();
      polygon.forEach((c, i) => {
        const px = mapX + ((c[0] - b.minLng) / (b.maxLng - b.minLng)) * mapW;
        const py = mapY + ((b.maxLat - c[1]) / (b.maxLat - b.minLat)) * mapH;
        i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
      });
      ctx.closePath();
      ctx.strokeStyle = '#000000';
      ctx.lineWidth = 2.5;
      ctx.stroke();
    }

    // === COMPASS ROSE (top-right of map) ===
    const compassX = mapX + mapW - 50, compassY = mapY + 50;
    ctx.save();
    ctx.translate(compassX, compassY);
    // North arrow
    ctx.beginPath(); ctx.moveTo(0, -25); ctx.lineTo(-8, 5); ctx.lineTo(0, -5); ctx.lineTo(8, 5); ctx.closePath();
    ctx.fillStyle = '#333'; ctx.fill();
    ctx.font = 'bold 14px Arial';
    ctx.fillStyle = '#333'; ctx.textAlign = 'center';
    ctx.fillText('N', 0, -30);
    ctx.restore();

    // === SCALE BAR ===
    const scaleY = mapY + mapH + 35;
    const centerLat = (b.minLat + b.maxLat) / 2;
    const mapWidthM = this._haversine(centerLat, b.minLng, centerLat, b.maxLng);
    let scaleM = 100;
    if (mapWidthM > 5000) scaleM = 1000;
    else if (mapWidthM > 2000) scaleM = 500;
    else if (mapWidthM > 1000) scaleM = 200;
    const scalePx = (scaleM / mapWidthM) * mapW;

    ctx.fillStyle = '#333';
    ctx.fillRect(mapX, scaleY, scalePx, 6);
    ctx.fillStyle = '#fff';
    ctx.fillRect(mapX, scaleY, scalePx / 2, 6);
    ctx.strokeStyle = '#333'; ctx.lineWidth = 1;
    ctx.strokeRect(mapX, scaleY, scalePx, 6);

    ctx.font = '13px Inter, Arial, sans-serif';
    ctx.fillStyle = '#333'; ctx.textAlign = 'left';
    ctx.fillText('0', mapX, scaleY + 20);
    ctx.textAlign = 'center';
    ctx.fillText(`${scaleM / 2}m`, mapX + scalePx / 2, scaleY + 20);
    ctx.textAlign = 'right';
    ctx.fillText(`${scaleM}m`, mapX + scalePx, scaleY + 20);

    // === COLOR LEGEND ===
    const legendY = scaleY + 45;
    const palName = this._getPaletteForNutrient(nutrient);

    ctx.font = 'bold 20px Inter, Arial, sans-serif';
    ctx.fillStyle = '#333'; ctx.textAlign = 'left';
    ctx.fillText(`${info.label} (${info.unit || ''})`, mapX, legendY);

    // Gradient bar
    const gx = mapX, gy = legendY + 12, gw = mapW, gh = 22;
    const grad = ctx.createLinearGradient(gx, 0, gx + gw, 0);
    for (let t = 0; t <= 1; t += 0.05) {
      const rgb = this._samplePalette(t, palName);
      grad.addColorStop(t, `rgb(${rgb.join(',')})`);
    }
    ctx.fillStyle = grad;
    ctx.fillRect(gx, gy, gw, gh);
    ctx.strokeStyle = '#333'; ctx.lineWidth = 1;
    ctx.strokeRect(gx, gy, gw, gh);

    // Legend labels
    ctx.font = '14px Inter, Arial, sans-serif';
    ctx.fillStyle = '#333';
    ctx.textAlign = 'left';
    ctx.fillText(`${stats.min.toFixed(1)}`, gx, gy + gh + 18);
    ctx.textAlign = 'center';
    ctx.fillText(`${stats.mean.toFixed(1)}`, gx + gw / 2, gy + gh + 18);
    ctx.textAlign = 'right';
    ctx.fillText(`${stats.max.toFixed(1)}`, gx + gw, gy + gh + 18);

    // === SUFFICIENCY STATUS ===
    const statusY = legendY + 65;
    let statusText = '';
    let statusColor = '#333';
    if (typeof CROPS_DB !== 'undefined' && CROPS_DB[cropId]) {
      const ranges = CROPS_DB[cropId].soil?.[nutrient];
      if (ranges) {
        const mean = stats.mean;
        // Reversed nutrients (Al, H_Al): higher values are worse — uses nulo/bajo/medio/alto/muyAlto keys
        const isReversed = !!ranges.nulo;
        if (isReversed) {
          // For Al-type: nulo=good, bajo=ok, medio=concern, alto/muyAlto=problem
          const okMax = ranges.nulo ? ranges.nulo[1] : 0;
          const lowMax = ranges.bajo ? ranges.bajo[1] : 0;
          const medMax = ranges.medio ? ranges.medio[1] : 0;
          if (mean <= okMax) {
            statusText = 'Estado del lote: ADECUADO — Niveles no tóxicos';
            statusColor = '#16a34a';
          } else if (mean <= lowMax) {
            statusText = 'Estado del lote: ACEPTABLE — Monitorear niveles';
            statusColor = '#f59e0b';
          } else if (mean <= medMax) {
            statusText = 'Estado del lote: ELEVADO — Corrección recomendada';
            statusColor = '#ef4444';
          } else {
            statusText = 'Estado del lote: TÓXICO — Se requiere corrección urgente';
            statusColor = '#dc2626';
          }
        } else {
          // Normal nutrients: mb/b/m/a/ma — higher is better
          const lowMax = ranges.mb ? ranges.mb[1] : 0;
          const medMax = ranges.b ? ranges.b[1] : 0;
          const adequateMax = ranges.m ? ranges.m[1] : 0;
          if (mean < lowMax) {
            statusText = 'Estado del lote: MUY DEFICIENTE — Se requiere corrección urgente';
            statusColor = '#dc2626';
          } else if (mean < medMax) {
            statusText = 'Estado del lote: DEFICIENTE — Fertilización correctiva recomendada';
            statusColor = '#ef4444';
          } else if (mean < adequateMax) {
            statusText = 'Estado del lote: MEDIO — Fertilización de mantenimiento recomendada';
            statusColor = '#f59e0b';
          } else {
            statusText = 'Estado del lote: ADECUADO — Niveles óptimos para el cultivo';
            statusColor = '#16a34a';
          }
        }
      }
    }
    if (statusText) {
      ctx.font = 'bold 18px Inter, Arial, sans-serif';
      ctx.fillStyle = statusColor;
      ctx.textAlign = 'left';
      ctx.fillText(statusText, mapX, statusY);
    }

    // === AREA / STATS TABLE ===
    const tableY = statusY + 35;
    const cols = [mapX, mapX + mapW * 0.25, mapX + mapW * 0.5, mapX + mapW * 0.75];

    // Table header
    ctx.fillStyle = '#e8f5e9';
    ctx.fillRect(mapX, tableY, mapW, 32);
    ctx.strokeStyle = '#999'; ctx.lineWidth = 1;
    ctx.strokeRect(mapX, tableY, mapW, 32);

    ctx.font = 'bold 15px Inter, Arial, sans-serif';
    ctx.fillStyle = '#1a3a2a'; ctx.textAlign = 'center';
    ['Parámetro', 'Mínimo', 'Media', 'Máximo'].forEach((h, i) => {
      ctx.fillText(h, cols[i] + mapW * 0.125, tableY + 22);
    });

    // Table row
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(mapX, tableY + 32, mapW, 28);
    ctx.strokeRect(mapX, tableY + 32, mapW, 28);
    ctx.font = '14px Inter, Arial, sans-serif';
    ctx.fillStyle = '#333';
    [info.label, stats.min.toFixed(1), stats.mean.toFixed(1), stats.max.toFixed(1)].forEach((v, i) => {
      ctx.fillText(v, cols[i] + mapW * 0.125, tableY + 52);
    });

    // Area row if polygon
    if (polygon && polygon.length >= 3) {
      const area = this.polygonAreaHa(polygon);
      ctx.fillStyle = '#f0f4f0';
      ctx.fillRect(mapX, tableY + 60, mapW, 28);
      ctx.strokeRect(mapX, tableY + 60, mapW, 28);
      ctx.fillStyle = '#333';
      ctx.textAlign = 'center';
      ctx.fillText('Área del lote', cols[0] + mapW * 0.125, tableY + 80);
      ctx.fillText(`${area.toFixed(1)} ha`, cols[1] + mapW * 0.125, tableY + 80);
      ctx.fillText(`${stats.points} pts`, cols[2] + mapW * 0.125, tableY + 80);
      ctx.fillText(`Resolución ${gridResult.resolution}²`, cols[3] + mapW * 0.125, tableY + 80);
    }

    // === FOOTER ===
    const footerY = H - 60;
    ctx.fillStyle = '#1a3a2a';
    ctx.fillRect(0, footerY, W, 60);

    // Logo in footer right
    if (logoImg && logoImg.complete) {
      const flh = 36, flw = logoImg.width * (flh / logoImg.height);
      ctx.drawImage(logoImg, W - flw - 30, footerY + 12, flw, flh);
    }
    ctx.font = '14px Inter, Arial, sans-serif';
    ctx.fillStyle = '#a8d5a0'; ctx.textAlign = 'left';
    ctx.fillText('Pixadvisor — Agricultura de Precisión', 40, footerY + 25);
    ctx.fillText('pixadvisor.network', 40, footerY + 45);
    ctx.font = '12px Inter, Arial, sans-serif';
    ctx.fillStyle = '#78a87a'; ctx.textAlign = 'right';
    ctx.fillText(`Generado: ${new Date().toLocaleString('es-ES')}`, W - 200, footerY + 45);

    return pdf;
  }

  // Generate a professional relationship map PDF
  static generateRelationshipMapPDF(options) {
    const { canvas, gridResult, polygon, relId, relLabel, optRange, stats, clientData, logoImg } = options;

    // Reuse nutrient PDF generator with relationship-specific overrides
    const fakeNutrient = relId;
    const pdfCanvas = this.generateNutrientMapPDF({
      canvas, gridResult, polygon,
      nutrient: fakeNutrient, cropId: null, stats, clientData, logoImg
    });

    // Override the legend to show relationship colors (green=optimal, red=below, blue=above)
    const ctx = pdfCanvas.getContext('2d');
    const W = pdfCanvas.width;
    const mapX = 60, mapW = W - 120;

    // Find where the legend was drawn and overlay relationship legend
    // The legend area starts after scale bar
    const b = gridResult.bounds;
    const mapH = Math.round(mapW * 0.75);
    const mapY = 160; // approximate
    const scaleY = mapY + mapH + 35;
    const legendY = scaleY + 45;
    const gx = mapX, gy = legendY + 12, gw = mapW, gh = 22;

    // Clear and redraw legend title
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(gx - 5, legendY - 25, gw + 10, 70);

    ctx.font = 'bold 20px Inter, Arial, sans-serif';
    ctx.fillStyle = '#333'; ctx.textAlign = 'left';
    ctx.fillText(`${relLabel} — Rango Óptimo: ${optRange.optMin}–${optRange.optMax}`, mapX, legendY);

    // 3-zone gradient
    const grad = ctx.createLinearGradient(gx, 0, gx + gw, 0);
    grad.addColorStop(0, 'rgb(230,80,30)');
    grad.addColorStop(0.35, 'rgb(40,170,55)');
    grad.addColorStop(0.65, 'rgb(40,170,55)');
    grad.addColorStop(1, 'rgb(80,60,200)');
    ctx.fillStyle = grad;
    ctx.fillRect(gx, gy, gw, gh);
    ctx.strokeStyle = '#333'; ctx.lineWidth = 1;
    ctx.strokeRect(gx, gy, gw, gh);

    ctx.font = '14px Inter, Arial, sans-serif';
    ctx.fillStyle = '#dc2626'; ctx.textAlign = 'left';
    ctx.fillText(`Bajo: <${optRange.optMin}`, gx, gy + gh + 18);
    ctx.fillStyle = '#16a34a'; ctx.textAlign = 'center';
    ctx.fillText(`Óptimo: ${optRange.optMin}–${optRange.optMax}`, gx + gw / 2, gy + gh + 18);
    ctx.fillStyle = '#2563eb'; ctx.textAlign = 'right';
    ctx.fillText(`Alto: >${optRange.optMax}`, gx + gw, gy + gh + 18);

    return pdfCanvas;
  }

  // ==================== HELPERS ====================

  static _haversine(lat1, lng1, lat2, lng2) {
    const R = 6371000;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180) * Math.cos(lat2*Math.PI/180) * Math.sin(dLng/2)**2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  }

  static getBounds(pointsOrGeoJSON) {
    let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
    const proc = (lat, lng) => { if(lat<minLat)minLat=lat; if(lat>maxLat)maxLat=lat; if(lng<minLng)minLng=lng; if(lng>maxLng)maxLng=lng; };
    if (Array.isArray(pointsOrGeoJSON)) {
      for (const p of pointsOrGeoJSON) proc(p.lat, p.lng);
    } else if (pointsOrGeoJSON?.features) {
      for (const f of pointsOrGeoJSON.features) {
        if (f.geometry.type === 'Point') proc(f.geometry.coordinates[1], f.geometry.coordinates[0]);
        else if (f.geometry.type === 'Polygon') for (const ring of f.geometry.coordinates) for (const [lng, lat] of ring) proc(lat, lng);
      }
    }
    const latPad = (maxLat-minLat)*0.1||0.001, lngPad = (maxLng-minLng)*0.1||0.001;
    return { minLat: minLat-latPad, maxLat: maxLat+latPad, minLng: minLng-lngPad, maxLng: maxLng+lngPad };
  }

  // ==================== ISO-XML EXPORT (ISOBUS ISO 11783 TaskData) ====================

  /**
   * Generate ISO 11783 TaskData XML for prescription maps.
   * Compatible with ISOBUS-capable equipment (John Deere, CLAAS, Fendt, Amazone, etc.).
   *
   * @param {Array<{dose: number, zone: number|string, coords: Array<[number,number]>, product_kg: number}>} zones
   *   Zone objects. Each `coords` entry is [lng, lat] forming a closed polygon ring.
   * @param {Object} [metadata] - Additional metadata
   * @param {string} [metadata.nutrient='N'] - Nutrient identifier (e.g. 'N', 'P2O5', 'K2O')
   * @param {string} [metadata.cropId] - Crop identifier
   * @param {string} [metadata.unit='kg/ha'] - Application rate unit
   * @param {string} [metadata.taskName] - Custom task name
   * @param {string} [metadata.fieldName] - Field/lot name
   * @param {string} [metadata.clientName] - Customer/farm name
   * @returns {string} Valid ISO 11783 TaskData XML string
   */
  static exportISOXML(zones, metadata = {}) {
    if (!zones || zones.length === 0) return null;

    const nutrient = metadata.nutrient || 'N';
    const unit = metadata.unit || 'kg/ha';
    const cropId = metadata.cropId || '';
    const taskName = metadata.taskName || 'Prescripcion VRT';
    const fieldName = metadata.fieldName || 'Campo';
    const clientName = metadata.clientName || 'Pixadvisor';
    const now = new Date();
    const dateStr = now.toISOString().split('T')[0]; // YYYY-MM-DD

    // XML-safe string escaping
    const esc = (s) => String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');

    // Compute dose statistics for DDI value range
    const doses = zones.map(z => z.dose);
    const minDose = Math.min(...doses);
    const maxDose = Math.max(...doses);

    // DDI (Data Dictionary Identifier) for application rate
    // DDI 0006 = Setpoint Volume Per Area Application Rate (ml/m²)
    // DDI 0001 = Setpoint Mass Per Area Application Rate (mg/m²)
    // We use DDI 0001 for kg/ha → convert: 1 kg/ha = 100 mg/m²
    const ddi = '0001';
    const doseToISOValue = (doseKgHa) => Math.round(doseKgHa * 100); // kg/ha → mg/m²

    let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
    xml += '<ISO11783_TaskData VersionMajor="4" VersionMinor="0" ManagementSoftwareManufacturer="Pixadvisor" ';
    xml += 'ManagementSoftwareVersion="1.0" DataTransferOrigin="1">\n\n';

    // Customer (CTR)
    xml += `  <CTR A="CTR-1" B="${esc(clientName)}"/>\n\n`;

    // Farm (FRM)
    xml += `  <FRM A="FRM-1" B="${esc(clientName)}" I="CTR-1"/>\n\n`;

    // Partfield / Field (PFD)
    xml += `  <PFD A="PFD-1" C="${esc(fieldName)}" F="FRM-1">\n`;

    // Field boundary polygon (PLN) — use convex hull of all zone coords
    const allCoords = [];
    for (const z of zones) {
      for (const c of z.coords) {
        allCoords.push(c);
      }
    }
    if (allCoords.length > 0) {
      // Compute bounding polygon from all zone coordinates (convex hull approximation via bbox)
      let bMinLng = Infinity, bMinLat = Infinity, bMaxLng = -Infinity, bMaxLat = -Infinity;
      for (const [lng, lat] of allCoords) {
        if (lng < bMinLng) bMinLng = lng;
        if (lat < bMinLat) bMinLat = lat;
        if (lng > bMaxLng) bMaxLng = lng;
        if (lat > bMaxLat) bMaxLat = lat;
      }
      xml += '    <PLN A="1" B="1">\n';
      xml += '      <LSG A="1">\n';
      xml += `        <PNT A="2" C="${bMinLat.toFixed(9)}" D="${bMinLng.toFixed(9)}"/>\n`;
      xml += `        <PNT A="2" C="${bMinLat.toFixed(9)}" D="${bMaxLng.toFixed(9)}"/>\n`;
      xml += `        <PNT A="2" C="${bMaxLat.toFixed(9)}" D="${bMaxLng.toFixed(9)}"/>\n`;
      xml += `        <PNT A="2" C="${bMaxLat.toFixed(9)}" D="${bMinLng.toFixed(9)}"/>\n`;
      xml += `        <PNT A="2" C="${bMinLat.toFixed(9)}" D="${bMinLng.toFixed(9)}"/>\n`;
      xml += '      </LSG>\n';
      xml += '    </PLN>\n';
    }
    xml += '  </PFD>\n\n';

    // Product (PDT) — the fertilizer/nutrient product
    xml += `  <PDT A="PDT-1" B="${esc(nutrient)} - Pixadvisor"/>\n\n`;

    // Value Presentation (VPN) — defines how the DDI value is displayed
    xml += `  <VPN A="VPN-1" B="0" C="0.01" D="0" E="${esc(unit)}"/>\n\n`;

    // Crop Type (CTP) — optional, if crop specified
    if (cropId) {
      xml += `  <CTP A="CTP-1" B="${esc(cropId)}"/>\n\n`;
    }

    // Device (DVC) — generic VRT controller placeholder
    xml += '  <DVC A="DVC-1" B="VRT Controller" D="FF000000000001" F="0000000000000000">\n';
    xml += `    <DET A="DET-1" B="Seccion 1" C="1" D="0" E="DVC-1"/>\n`;
    xml += `    <DPD A="0" B="${ddi}" C="3" D="DET-1" E="VPN-1"/>\n`;
    xml += '  </DVC>\n\n';

    // Task (TSK) with Treatment Zones
    xml += `  <TSK A="TSK-1" B="${esc(taskName)}" C="CTR-1" D="FRM-1" E="PFD-1" F="0" `;
    xml += `G="1" H="1" J="${dateStr}">\n`;

    // Connection — link task to device
    xml += '    <CNN A="DVC-1" B="DET-1" C="1"/>\n\n';

    // Grid (GRD) type 2 = treatment zones
    xml += '    <GRD A="GRD-1" B="2"/>\n\n';

    // Treatment Zones (TZN) — one per prescription zone
    for (let i = 0; i < zones.length; i++) {
      const z = zones[i];
      const isoRate = doseToISOValue(z.dose);
      const zoneLabel = z.zone !== undefined ? z.zone : (i + 1);

      xml += `    <TZN A="${i}" B="Zona ${zoneLabel} - ${z.dose} ${unit}">\n`;

      // Polygon boundary for this zone
      xml += '      <PLN A="1" B="1">\n';
      xml += '        <LSG A="1">\n';
      for (const [lng, lat] of z.coords) {
        xml += `          <PNT A="2" C="${lat.toFixed(9)}" D="${lng.toFixed(9)}"/>\n`;
      }
      // Close the ring if not already closed
      if (z.coords.length > 0) {
        const first = z.coords[0];
        const last = z.coords[z.coords.length - 1];
        if (first[0] !== last[0] || first[1] !== last[1]) {
          xml += `          <PNT A="2" C="${first[1].toFixed(9)}" D="${first[0].toFixed(9)}"/>\n`;
        }
      }
      xml += '        </LSG>\n';
      xml += '      </PLN>\n';

      // Process Data Variable (PDV) — application rate for this zone
      xml += `      <PDV A="${ddi}" B="${isoRate}" E="PDT-1"/>\n`;

      xml += '    </TZN>\n';
    }

    xml += '  </TSK>\n\n';
    xml += '</ISO11783_TaskData>';

    return xml;
  }

  /**
   * Generate ISO-XML from a prescription result (output of generatePrescription + prescriptionToSHP zones).
   * Convenience wrapper that extracts zones from a prescription grid.
   *
   * @param {Object} prescResult - Result from generatePrescription()
   * @param {Array} polygon - Field boundary polygon [[lat,lng], ...]
   * @param {Object} [metadata] - Passed to exportISOXML
   * @returns {string} ISO-XML string
   */
  static prescriptionToISOXML(prescResult, polygon, metadata = {}) {
    if (!prescResult) return null;

    const { grid, bounds, resolution, fertKey, source, stats } = prescResult;
    const latStep = (bounds.maxLat - bounds.minLat) / resolution;
    const lngStep = (bounds.maxLng - bounds.minLng) / resolution;

    const zones = [];
    for (let i = 0; i < resolution; i++) {
      for (let j = 0; j < resolution; j++) {
        const cell = grid[i][j];
        if (cell.dose <= 0) continue;

        const lat0 = bounds.minLat + i * latStep, lat1 = lat0 + latStep;
        const lng0 = bounds.minLng + j * lngStep, lng1 = lng0 + lngStep;

        // Check if center is inside polygon
        if (polygon && polygon.length >= 3) {
          const cx = (lng0 + lng1) / 2, cy = (lat0 + lat1) / 2;
          if (!this._pointInPolygon(cx, cy, polygon)) continue;
        }

        zones.push({
          coords: [[lng0,lat0],[lng1,lat0],[lng1,lat1],[lng0,lat1],[lng0,lat0]],
          dose: Math.round(cell.dose * 10) / 10,
          product_kg: source?.content > 0 ? Math.round((cell.dose / source.content) * 100) : 0,
          zone: cell.soilClass || 0
        });
      }
    }

    if (zones.length === 0) return null;

    // Merge metadata with prescription info
    const isoMeta = {
      nutrient: fertKey || metadata.nutrient || 'N',
      ...metadata
    };

    return this.exportISOXML(zones, isoMeta);
  }

  /**
   * Download ISO-XML as TASKDATA.XML file (standard ISOBUS filename).
   * Creates and triggers a browser download of the TaskData XML.
   *
   * @param {Array} zones - Zone array for exportISOXML
   * @param {Object} [metadata] - Metadata for exportISOXML
   * @param {string} [filename='TASKDATA.XML'] - Download filename
   */
  static downloadISOXML(zones, metadata = {}, filename = 'TASKDATA.XML') {
    const xml = this.exportISOXML(zones, metadata);
    if (!xml) {
      console.warn('InterpolationEngine.downloadISOXML: No zones to export');
      return false;
    }

    const blob = new Blob([xml], { type: 'application/xml; charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();

    // Cleanup
    setTimeout(() => {
      URL.revokeObjectURL(url);
      document.body.removeChild(a);
    }, 200);

    return true;
  }

  /**
   * Download ISO-XML as a ZIP file containing TASKDATA/TASKDATA.XML
   * (standard ISOBUS directory structure expected by most terminals).
   *
   * @param {Array} zones - Zone array for exportISOXML
   * @param {Object} [metadata] - Metadata for exportISOXML
   * @param {string} [zipName='TASKDATA.zip'] - Download filename
   */
  static downloadISOXMLZip(zones, metadata = {}, zipName = 'TASKDATA.zip') {
    const xml = this.exportISOXML(zones, metadata);
    if (!xml) {
      console.warn('InterpolationEngine.downloadISOXMLZip: No zones to export');
      return false;
    }

    // Use the existing _createZip helper to package as TASKDATA/TASKDATA.XML
    const xmlBytes = new TextEncoder().encode(xml);
    const zipData = this._createZip({
      'TASKDATA/TASKDATA.XML': xmlBytes
    });

    const blob = new Blob([zipData], { type: 'application/zip' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = zipName;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();

    setTimeout(() => {
      URL.revokeObjectURL(url);
      document.body.removeChild(a);
    }, 200);

    return true;
  }
}
