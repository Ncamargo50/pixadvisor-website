/**
 * Web Worker for IDW (Inverse Distance Weighting) interpolation computation.
 * Offloads heavy grid computation from the main thread.
 *
 * Expects messages with:
 *   { type: 'idw', points: [{lat, lng, value, weight?}], bounds: {minLat, maxLat, minLng, maxLng}, options: {resolution, power, smooth} }
 *
 * Posts back:
 *   { type: 'idw-result', grid: number[][], stats: {min, max, mean} }
 */
self.addEventListener('message', function(e) {
  const { type, points, bounds, options } = e.data;

  if (type === 'idw') {
    const resolution = options.resolution || 100;
    const power = options.power || 2;
    const latStep = (bounds.maxLat - bounds.minLat) / resolution;
    const lngStep = (bounds.maxLng - bounds.minLng) / resolution;

    const grid = [];
    let min = Infinity, max = -Infinity, sum = 0, count = 0;

    for (let r = 0; r < resolution; r++) {
      grid[r] = new Float64Array(resolution);
      const lat = bounds.minLat + (r + 0.5) * latStep;

      for (let c = 0; c < resolution; c++) {
        const lng = bounds.minLng + (c + 0.5) * lngStep;

        let weightSum = 0, valueSum = 0;
        for (const pt of points) {
          const dLat = (pt.lat - lat) * 111320;
          const dLng = (pt.lng - lng) * 111320 * Math.cos(lat * Math.PI / 180);
          let dist = Math.sqrt(dLat * dLat + dLng * dLng);
          if (dist < 0.1) dist = 0.1;

          const w = (pt.weight || 1) / Math.pow(dist, power);
          weightSum += w;
          valueSum += w * pt.value;
        }

        const val = weightSum > 0 ? valueSum / weightSum : 0;
        grid[r][c] = val;
        if (val < min) min = val;
        if (val > max) max = val;
        sum += val;
        count++;
      }
    }

    self.postMessage({
      type: 'idw-result',
      grid: grid.map(row => Array.from(row)),
      stats: { min, max, mean: sum / count }
    });
  }
});
