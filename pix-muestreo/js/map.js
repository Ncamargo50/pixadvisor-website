// Map Module for PIX Muestreo - Leaflet based
class PixMap {
  constructor() {
    this.map = null;
    this.userMarker = null;
    this.accuracyCircle = null;
    this.pointMarkers = [];
    this.fieldLayers = [];
    this.trackLine = null;
    this.navigationLine = null;
    this.selectedPoint = null;
  }

  // Initialize map
  init(containerId) {
    this.map = L.map(containerId, {
      zoomControl: false,
      attributionControl: false
    }).setView([-17.78, -63.18], 13); // Default: Santa Cruz, Bolivia

    // Satellite layer (Google)
    const satellite = L.tileLayer('https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}', {
      maxZoom: 22,
      attribution: 'Google Satellite'
    });

    // Hybrid (satellite + labels)
    const hybrid = L.tileLayer('https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}', {
      maxZoom: 22,
      attribution: 'Google Hybrid'
    });

    // Street map (OSM)
    const streets = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: 'OpenStreetMap'
    });

    // Default to hybrid
    hybrid.addTo(this.map);

    // Layer control
    L.control.layers({
      'Satélite': satellite,
      'Híbrido': hybrid,
      'Calles': streets
    }, null, { position: 'topleft' }).addTo(this.map);

    // Zoom control
    L.control.zoom({ position: 'topleft' }).addTo(this.map);

    // Scale
    L.control.scale({ metric: true, imperial: false }).addTo(this.map);

    return this.map;
  }

  // Update user position marker
  updateUserPosition(lat, lng, accuracy) {
    if (!this.map) return;

    if (!this.userMarker) {
      const userIcon = L.divIcon({
        className: 'user-marker',
        html: `<div class="user-marker-dot"></div><div class="user-marker-pulse"></div>`,
        iconSize: [24, 24],
        iconAnchor: [12, 12]
      });
      this.userMarker = L.marker([lat, lng], { icon: userIcon, zIndex: 1000 }).addTo(this.map);
      this.accuracyCircle = L.circle([lat, lng], {
        radius: accuracy,
        color: '#00BFA5',
        fillColor: '#00BFA5',
        fillOpacity: 0.1,
        weight: 1
      }).addTo(this.map);
    } else {
      this.userMarker.setLatLng([lat, lng]);
      this.accuracyCircle.setLatLng([lat, lng]).setRadius(accuracy);
    }
  }

  // Center map on user
  centerOnUser() {
    if (this.userMarker) {
      this.map.setView(this.userMarker.getLatLng(), 17);
    }
  }

  // Add field boundary (polygon)
  addFieldBoundary(geojson, name, color = '#00BFA5') {
    const layer = L.geoJSON(geojson, {
      style: {
        color: color,
        weight: 2,
        fillColor: color,
        fillOpacity: 0.1,
        dashArray: '5, 5'
      }
    }).addTo(this.map);

    if (name) {
      layer.bindTooltip(name, { permanent: true, direction: 'center', className: 'field-label' });
    }

    this.fieldLayers.push(layer);
    return layer;
  }

  // Zone class to color mapping for zonas de manejo
  // Baja=red, Media-Baja=orange, Media=yellow, Media-Alta=lightgreen, Alta=green
  _getZonaColor(clase) {
    if (!clase) return '#00BFA5'; // default teal
    const c = clase.toLowerCase().trim();
    if (c === 'baja' || c === 'low') return '#F44336';           // red
    if (c === 'media-baja' || c === 'media baja' || c === 'medium-low') return '#FF9800'; // orange
    if (c === 'media' || c === 'medium') return '#FFEB3B';       // yellow
    if (c === 'media-alta' || c === 'media alta' || c === 'medium-high') return '#8BC34A'; // lightgreen
    if (c === 'alta' || c === 'high') return '#4CAF50';          // green
    // If class contains partial matches
    if (c.includes('baja') && c.includes('media')) return '#FF9800';
    if (c.includes('alta') && c.includes('media')) return '#8BC34A';
    if (c.includes('baja')) return '#F44336';
    if (c.includes('alta')) return '#4CAF50';
    if (c.includes('media')) return '#FFEB3B';
    return '#00BFA5'; // default
  }

  // Add colored zonas de manejo (from project JSON import)
  // Zones are visually prominent: thick borders, high fill opacity, permanent labels
  addZonasColored(zonasFc, zonasMetadata) {
    if (!zonasFc || !zonasFc.features) return;

    zonasFc.features.forEach((feature, idx) => {
      const meta = (zonasMetadata && zonasMetadata[idx]) || {};
      const color = this._getZonaColor(meta.clase);
      const zoneName = meta.name || `Zona ${idx + 1}`;

      const layer = L.geoJSON(feature, {
        style: {
          color: color,
          weight: 3,
          fillColor: color,
          fillOpacity: 0.35,
          dashArray: null
        }
      }).addTo(this.map);

      // Permanent tooltip so zones are always visible on the map
      const label = meta.clase ? `${zoneName} (${meta.clase})` : zoneName;
      layer.bindTooltip(label, {
        permanent: true,
        direction: 'center',
        className: 'field-label'
      });

      this.fieldLayers.push(layer);
    });
  }

  // Add sample points with type-based colors (principal/submuestra)
  // Red=principal(pending), Yellow=submuestra(pending), Green=collected
  addTypedSamplePoints(points, onPointClick) {
    this.clearPoints();

    points.forEach(point => {
      // A9 FIX: Skip points with invalid coordinates
      if (!isFinite(point.lat) || !isFinite(point.lng)) return;

      const tipo = point.tipo || (point.properties && point.properties.tipo) || 'principal';
      const status = point.status || 'pending';

      // Color logic: green if collected, otherwise red for principal, yellow for submuestra
      let color;
      if (status === 'collected') {
        color = '#4CAF50'; // green
      } else if (tipo === 'submuestra') {
        color = '#FFEB3B'; // yellow
      } else {
        color = '#F44336'; // red for principal
      }

      const labelText = point.name || point.id;
      // Shorter label for map display
      const shortLabel = labelText.length > 8 ? labelText.slice(-6) : labelText;

      const icon = L.divIcon({
        className: 'sample-point-marker',
        html: `<div class="point-dot" style="background:${color};border-color:${color}">
          <span class="point-label">${shortLabel}</span>
        </div>`,
        iconSize: [32, 32],
        iconAnchor: [16, 16]
      });

      const marker = L.marker([point.lat, point.lng], { icon }).addTo(this.map);

      // Rich popup with point info
      const zonaStr = point.zona ? `Zona ${point.zona}` : '';
      const tipoStr = tipo === 'principal' ? 'Principal' : 'Submuestra';
      marker.bindPopup(
        `<b>${labelText}</b><br>${tipoStr} ${zonaStr}<br>` +
        `<small>${point.lat.toFixed(6)}, ${point.lng.toFixed(6)}</small>`
      );

      marker.on('click', () => {
        this.selectedPoint = point;
        if (onPointClick) onPointClick(point);
      });

      marker.pointData = point;
      this.pointMarkers.push(marker);
    });
  }

  // Add sample points
  addSamplePoints(points, onPointClick) {
    this.clearPoints();

    points.forEach(point => {
      // A9 FIX: Skip points with invalid coordinates
      if (!isFinite(point.lat) || !isFinite(point.lng)) return;

      const status = point.status || 'pending'; // pending, collected, skipped
      const colors = {
        pending: '#FF9800',
        collected: '#4CAF50',
        skipped: '#F44336',
        current: '#00BFA5'
      };
      const color = colors[status] || colors.pending;

      const icon = L.divIcon({
        className: 'sample-point-marker',
        html: `<div class="point-dot" style="background:${color};border-color:${color}">
          <span class="point-label">${point.name || point.id}</span>
        </div>`,
        iconSize: [32, 32],
        iconAnchor: [16, 16]
      });

      const marker = L.marker([point.lat, point.lng], { icon }).addTo(this.map);

      marker.on('click', () => {
        this.selectedPoint = point;
        if (onPointClick) onPointClick(point);
      });

      marker.pointData = point;
      this.pointMarkers.push(marker);
    });
  }

  // Update point status
  updatePointStatus(pointId, status) {
    const marker = this.pointMarkers.find(m => m.pointData.id === pointId);
    if (!marker) return;

    const colors = { pending: '#FF9800', collected: '#4CAF50', skipped: '#F44336', current: '#00BFA5' };
    const color = colors[status] || colors.pending;
    const point = marker.pointData;
    point.status = status;

    marker.setIcon(L.divIcon({
      className: 'sample-point-marker',
      html: `<div class="point-dot" style="background:${color};border-color:${color}">
        <span class="point-label">${point.name || point.id}</span>
      </div>`,
      iconSize: [32, 32],
      iconAnchor: [16, 16]
    }));
  }

  // Draw navigation line from user to target
  drawNavigationLine(fromLat, fromLng, toLat, toLng) {
    if (this.navigationLine) {
      this.map.removeLayer(this.navigationLine);
    }
    this.navigationLine = L.polyline([
      [fromLat, fromLng], [toLat, toLng]
    ], {
      color: '#00BFA5',
      weight: 3,
      dashArray: '10, 10',
      opacity: 0.8
    }).addTo(this.map);
  }

  // Clear navigation line
  clearNavigationLine() {
    if (this.navigationLine) {
      this.map.removeLayer(this.navigationLine);
      this.navigationLine = null;
    }
  }

  // Draw GPS track
  drawTrack(positions) {
    if (this.trackLine) this.map.removeLayer(this.trackLine);
    if (!positions || positions.length < 2) return;

    const coords = positions.map(p => [p.lat, p.lng]);
    this.trackLine = L.polyline(coords, {
      color: '#1565C0',
      weight: 3,
      opacity: 0.7
    }).addTo(this.map);
  }

  // Add track point
  addTrackPoint(lat, lng) {
    if (!this.trackLine) {
      this.trackLine = L.polyline([[lat, lng]], {
        color: '#1565C0',
        weight: 3,
        opacity: 0.7
      }).addTo(this.map);
    } else {
      this.trackLine.addLatLng([lat, lng]);
    }
  }

  // Fit map to field content ONLY (never includes GPS userMarker)
  fitBounds() {
    if (!this.map) return;
    try {
      // Only use field layers + sample points — exclude GPS marker
      const layers = [...this.pointMarkers, ...this.fieldLayers];
      if (layers.length === 0) return;

      const group = L.featureGroup(layers);
      const bounds = group.getBounds();
      if (bounds.isValid()) {
        // Use maxZoom 19 to prevent zooming too close on small areas
        this.map.fitBounds(bounds.pad(0.12), { maxZoom: 19, animate: false });
        // Flag: map is focused on field, don't auto-pan to GPS
        this._fieldFocused = true;
      }
    } catch (e) {
      console.warn('fitBounds error:', e.message);
    }
  }

  // Clear all points — with popup/reference cleanup
  clearPoints() {
    this.pointMarkers.forEach(m => {
      if (m.closePopup) m.closePopup();
      if (m.unbindPopup) m.unbindPopup();
      if (m.unbindTooltip) m.unbindTooltip();
      this.map.removeLayer(m);
    });
    this.pointMarkers = [];
  }

  // Clear all layers
  clearAll() {
    this.clearPoints();
    this.fieldLayers.forEach(l => this.map.removeLayer(l));
    this.fieldLayers = [];
    if (this.trackLine) { this.map.removeLayer(this.trackLine); this.trackLine = null; }
    this.clearNavigationLine();
  }

  // Destroy map
  destroy() {
    if (this.map) {
      this.map.remove();
      this.map = null;
    }
  }

  // --- Offline Tile Pre-loader ---

  // Helper: convert lat/lng to tile coordinates at a given zoom
  _tileCoords(lat, lng, zoom) {
    const n = Math.pow(2, zoom);
    const x = Math.floor((lng + 180) / 360 * n);
    const latRad = lat * Math.PI / 180;
    const y = Math.floor((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * n);
    return { x, y };
  }

  // Estimate tile count for bounds across zoom levels (both hybrid + satellite)
  estimateTileCount(bounds, minZoom = 13, maxZoom = 18) {
    const north = bounds.north ?? bounds.getNorth();
    const south = bounds.south ?? bounds.getSouth();
    const east = bounds.east ?? bounds.getEast();
    const west = bounds.west ?? bounds.getWest();

    let tileCount = 0;
    for (let z = minZoom; z <= maxZoom; z++) {
      const min = this._tileCoords(north, west, z);
      const max = this._tileCoords(south, east, z);
      const xCount = Math.abs(max.x - min.x) + 1;
      const yCount = Math.abs(max.y - min.y) + 1;
      tileCount += xCount * yCount;
    }

    // Double for both hybrid + satellite layers
    tileCount *= 2;
    const estimatedSizeMB = parseFloat((tileCount * 15 / 1024).toFixed(1));
    return { tileCount, estimatedSizeMB };
  }

  // M4 FIX: Max tile cache limit
  MAX_CACHED_TILES = 34000; // ~500MB at ~15KB/tile

  // Pre-load tiles for a given bounds area
  async preloadTiles(bounds, minZoom = 13, maxZoom = 18, onProgress = null) {
    const north = bounds.north ?? bounds.getNorth();
    const south = bounds.south ?? bounds.getSouth();
    const east = bounds.east ?? bounds.getEast();
    const west = bounds.west ?? bounds.getWest();

    const tileUrls = [];
    const urlTemplates = [
      'https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}',  // hybrid
      'https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}'   // satellite
    ];

    for (let z = minZoom; z <= maxZoom; z++) {
      const min = this._tileCoords(north, west, z);
      const max = this._tileCoords(south, east, z);
      const xStart = Math.min(min.x, max.x);
      const xEnd = Math.max(min.x, max.x);
      const yStart = Math.min(min.y, max.y);
      const yEnd = Math.max(min.y, max.y);

      for (let x = xStart; x <= xEnd; x++) {
        for (let y = yStart; y <= yEnd; y++) {
          urlTemplates.forEach(tpl => {
            const url = tpl.replace('{x}', x).replace('{y}', y).replace('{z}', z);
            tileUrls.push({ url, zoom: z });
          });
        }
      }
    }

    const total = tileUrls.length;
    let downloaded = 0;
    let failed = 0;
    const BATCH_SIZE = 6;
    const cache = await caches.open('pix-tiles-v1');

    // M4 FIX: Check current cache size and enforce limit
    const currentKeys = await cache.keys();
    if (currentKeys.length + total > this.MAX_CACHED_TILES) {
      console.warn(`[Map] Tile cache limit: ${currentKeys.length} existing + ${total} new > ${this.MAX_CACHED_TILES} max`);
    }

    for (let i = 0; i < tileUrls.length; i += BATCH_SIZE) {
      const batch = tileUrls.slice(i, i + BATCH_SIZE);
      const results = await Promise.allSettled(batch.map(async (tile) => {
        // Skip if already cached
        const existing = await cache.match(tile.url);
        if (existing) return;
        const response = await fetch(tile.url);
        if (response.ok) {
          await cache.put(tile.url, response);
        } else {
          throw new Error('fetch failed');
        }
      }));

      // M5 FIX: Only count actual downloads, not skipped cached tiles
      results.forEach(r => {
        if (r.status === 'rejected') failed++;
        else downloaded++;
      });

      if (onProgress) {
        const currentZoom = batch[0].zoom;
        onProgress(Math.min(downloaded, total), total, currentZoom);
      }
    }

    // Calculate cache size estimate
    const keys = await cache.keys();
    const cacheSizeMB = parseFloat((keys.length * 15 / 1024).toFixed(1));

    return { downloaded: downloaded - failed, failed, total, cacheSizeMB };
  }

  // Convenience: pre-load tiles for current field area with padding
  async preloadFieldArea(paddingPercent = 20) {
    let bounds = null;

    // Try field boundary layers first
    if (this.fieldLayers.length > 0) {
      const group = L.featureGroup(this.fieldLayers);
      bounds = group.getBounds();
    } else if (this.map) {
      bounds = this.map.getBounds();
    }

    if (!bounds) return null;

    // Add padding
    const pad = paddingPercent / 100;
    bounds = bounds.pad(pad);

    const estimate = this.estimateTileCount(bounds);
    const result = await this.preloadTiles(bounds);
    return result;
  }

  // Get tile cache statistics
  async getCacheStats() {
    try {
      const cache = await caches.open('pix-tiles-v1');
      const keys = await cache.keys();
      const tileCount = keys.length;
      const estimatedSizeMB = parseFloat((tileCount * 15 / 1024).toFixed(1));
      return { tileCount, estimatedSizeMB };
    } catch (e) {
      return { tileCount: 0, estimatedSizeMB: 0 };
    }
  }

  // Clear all cached tiles
  async clearTileCache() {
    await caches.delete('pix-tiles-v1');
    return true;
  }
}

const pixMap = new PixMap();
