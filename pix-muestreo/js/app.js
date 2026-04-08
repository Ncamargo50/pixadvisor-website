// PIX Muestreo - Main Application
class PixApp {
  constructor() {
    this.currentView = 'projects';
    this.currentProject = null;
    this.currentField = null;
    this.currentPoint = null;
    this.isNavigating = false;
    this.collectForm = {};
    this.isOnline = navigator.onLine;
  }

  async init() {
    // DB already initialized in boot flow (DOMContentLoaded)

    // PWA Install - use global prompt captured before login
    if (deferredInstallPrompt) {
      this.deferredInstallPrompt = deferredInstallPrompt;
      this.showInstallBanner();
    }
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      this.deferredInstallPrompt = e;
      deferredInstallPrompt = e;
      this.showInstallBanner();
    });

    // Online/offline detection
    window.addEventListener('online', () => { this.isOnline = true; this.updateConnectionStatus(); });
    window.addEventListener('offline', () => { this.isOnline = false; this.updateConnectionStatus(); });

    // Init navigation
    this.initNavigation();
    this.updateConnectionStatus();

    // Load saved settings
    const collector = await pixDB.getSetting('collectorName');
    if (collector) document.getElementById('collectorName').value = collector;

    const clientId = await pixDB.getSetting('driveClientId');
    if (clientId) {
      document.getElementById('driveClientId').value = clientId;
      try {
        await driveSync.init(clientId);
        // C3 FIX: Use driveSync.isAuthenticated() which restores from sessionStorage
        if (driveSync.isAuthenticated()) {
          console.log('[App] Drive token restored from session');
        }
      } catch (e) { console.log('Drive init deferred'); }
    }

    // Load projects
    this.loadProjects();

    // Load GPS settings
    this.loadGPSSettings();

    // Show map view by default
    this.showView('map');

    // Init GPS
    try {
      gpsNav.startWatch(pos => {
        if (pos) {
          pixMap.updateUserPosition(pos.lat, pos.lng, pos.accuracy);
          if (gpsNav.isTracking) {
            pixMap.addTrackPoint(pos.lat, pos.lng);
          }
          this.updateNavPanel();
          this.updateAccuracyDisplay(pos.accuracy);

          // Auto-detect point
          if (this.currentField) {
            this.autoDetectPoint();
          }
        }
      });
    } catch (e) {
      this.toast('GPS no disponible', 'warning');
    }

    // Drive auth callback
    document.addEventListener('drive-authenticated', () => {
      this.toast('Google Drive conectado', 'success');
      this.updateConnectionStatus();
    });

    // Listen for background sync messages from service worker
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener('message', event => {
        if (event.data && event.data.type === 'sync-samples') {
          this.syncToDrive();
        }
      });
    }

    console.log('PIX Muestreo initialized');
  }

  // Navigation between views
  initNavigation() {
    document.querySelectorAll('.nav-item').forEach(btn => {
      btn.addEventListener('click', () => {
        const view = btn.dataset.view;
        this.showView(view);
      });
    });
  }

  showView(viewName) {
    this.currentView = viewName;
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.getElementById(`view-${viewName}`).classList.add('active');
    document.querySelectorAll('.nav-item').forEach(n => {
      n.classList.toggle('active', n.dataset.view === viewName);
    });

    // Init map when showing map view
    if (viewName === 'map' && !pixMap.map) {
      setTimeout(() => {
        pixMap.init('map');
        if (gpsNav.currentPosition) {
          pixMap.updateUserPosition(
            gpsNav.currentPosition.lat,
            gpsNav.currentPosition.lng,
            gpsNav.currentPosition.accuracy
          );
          pixMap.map.setView([gpsNav.currentPosition.lat, gpsNav.currentPosition.lng], 15);
        }
        // Load current field data
        if (this.currentField) {
          this.loadFieldOnMap(this.currentField);
        }
      }, 100);
    }

    if (viewName === 'sync') this.updateSyncStats();
    if (viewName === 'projects') this.loadProjects();
    if (viewName === 'settings') this.updateTileCacheStats();
    if (viewName === 'orders') pixOrders.loadOrders();
    if (viewName === 'admin') pixAdmin.renderAdminView();
  }

  // Apply role-based permissions to UI
  applyRolePermissions() {
    const role = pixAuth.getUserRole();
    const name = pixAuth.getUserName();

    // Show user info in header
    const userPill = document.getElementById('userPill');
    const userName = document.getElementById('currentUserName');
    if (userPill) userPill.style.display = 'flex';
    if (userName) userName.textContent = name;

    const navOrders = document.getElementById('navOrders');
    const navSync = document.getElementById('navSync');
    const navSettings = document.getElementById('navSettings');
    const navAdmin = document.getElementById('navAdmin');
    const btnCreateOrder = document.getElementById('btnCreateOrder');

    if (role === 'admin') {
      // Admin: show all + admin tab, hide settings tab
      if (navOrders) navOrders.classList.remove('nav-hidden');
      if (navSync) navSync.classList.remove('nav-hidden');
      if (navSettings) navSettings.classList.add('nav-hidden');
      if (navAdmin) navAdmin.classList.remove('nav-hidden');
      if (btnCreateOrder) btnCreateOrder.style.display = '';
    } else if (role === 'tecnico') {
      // Tecnico: orders + sync + settings, no admin
      if (navOrders) navOrders.classList.remove('nav-hidden');
      if (navSync) navSync.classList.remove('nav-hidden');
      if (navSettings) navSettings.classList.remove('nav-hidden');
      if (navAdmin) navAdmin.classList.add('nav-hidden');
      if (btnCreateOrder) btnCreateOrder.style.display = 'none';
    } else {
      // Cliente: only map, projects, sync (read-only)
      if (navOrders) navOrders.classList.add('nav-hidden');
      if (navSync) navSync.classList.remove('nav-hidden');
      if (navSettings) navSettings.classList.add('nav-hidden');
      if (navAdmin) navAdmin.classList.add('nav-hidden');
      if (btnCreateOrder) btnCreateOrder.style.display = 'none';
    }
  }

  // Connection status
  updateConnectionStatus() {
    const dot = document.getElementById('connectionDot');
    const label = document.getElementById('connectionLabel');
    if (this.isOnline) {
      dot.className = 'status-dot online';
      label.textContent = 'Online';
    } else {
      dot.className = 'status-dot offline';
      label.textContent = 'Offline';
    }
  }

  // ===== PROJECTS =====
  async loadProjects() {
    let projects = await pixDB.getAll('projects');
    // Filter by role: admin sees all, tecnico sees own + assigned via orders
    if (pixAuth.currentUser && pixAuth.isTecnico()) {
      const userId = pixAuth.getUserId();
      const myOrders = await pixDB.getAllByIndex('serviceOrders', 'technicianId', userId);
      const orderProjectIds = new Set(myOrders.map(o => o.projectId).filter(Boolean));
      projects = projects.filter(p => p.userId === userId || orderProjectIds.has(p.id));
    }
    const container = document.getElementById('projectsList');

    if (projects.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"/>
          </svg>
          <h3>Sin proyectos</h3>
          <p>Importá mapas desde Google Drive o creá un proyecto manual</p>
          <button class="action-btn primary" onclick="app.showImportModal()">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>
            Importar desde Drive
          </button>
        </div>`;
      return;
    }

    let html = '';
    for (const proj of projects) {
      const fields = await pixDB.getAllByIndex('fields', 'projectId', proj.id);
      let totalPoints = 0, collectedPoints = 0;
      for (const f of fields) {
        const points = await pixDB.getAllByIndex('points', 'fieldId', f.id);
        totalPoints += points.length;
        collectedPoints += points.filter(p => p.status === 'collected').length;
      }
      const pct = totalPoints > 0 ? Math.round(collectedPoints / totalPoints * 100) : 0;
      const badge = pct === 100 ? 'complete' : pct > 0 ? 'active' : 'pending';

      html += `
        <div class="card" onclick="app.openProject(${proj.id})">
          <div class="card-header">
            <div>
              <div class="card-title">${proj.name}</div>
              <div class="card-subtitle">${proj.client || ''}</div>
            </div>
            <span class="card-badge badge-${badge}">${pct}%</span>
          </div>
          <div class="card-stats">
            <span class="stat">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/></svg>
              <strong>${fields.length}</strong> campos
            </span>
            <span class="stat">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/></svg>
              <strong>${collectedPoints}/${totalPoints}</strong> puntos
            </span>
          </div>
          <div class="progress-bar"><div class="progress-fill" style="width:${pct}%"></div></div>
        </div>`;
    }
    container.innerHTML = html;
  }

  async openProject(projectId) {
    this.currentProject = await pixDB.get('projects', projectId);
    const fields = await pixDB.getAllByIndex('fields', 'projectId', projectId);

    const container = document.getElementById('projectsList');
    let html = `
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px;">
        <button class="fab-btn secondary" onclick="app.loadProjects()" style="width:36px;height:36px;">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 18l-6-6 6-6"/></svg>
        </button>
        <div>
          <div class="card-title">${this.currentProject.name}</div>
          <div class="card-subtitle">${fields.length} campos</div>
        </div>
      </div>`;

    for (const field of fields) {
      const points = await pixDB.getAllByIndex('points', 'fieldId', field.id);
      const collected = points.filter(p => p.status === 'collected').length;
      const pct = points.length > 0 ? Math.round(collected / points.length * 100) : 0;

      html += `
        <div class="card" onclick="app.openField(${field.id})">
          <div class="card-header">
            <div>
              <div class="card-title">${field.name}</div>
              <div class="card-subtitle">${field.area ? field.area.toFixed(1) + ' ha' : ''}</div>
            </div>
            <span class="card-badge badge-${pct === 100 ? 'complete' : pct > 0 ? 'active' : 'pending'}">${collected}/${points.length}</span>
          </div>
          <div class="progress-bar"><div class="progress-fill" style="width:${pct}%"></div></div>
        </div>`;
    }

    container.innerHTML = html;
  }

  async openField(fieldId) {
    this.currentField = await pixDB.get('fields', fieldId);
    this.loadFieldOnMap(this.currentField);
    this.showView('map');
  }

  async loadFieldOnMap(field) {
    if (!pixMap.map) return;
    pixMap.clearAll();

    // Check if field has zonas metadata (from project JSON import)
    if (field.boundary && field.zonasMetadata && field.zonasMetadata.length > 0) {
      // Draw each zone polygon with color based on its class
      pixMap.addZonasColored(field.boundary, field.zonasMetadata);
    } else if (field.boundary) {
      // Standard field boundary
      pixMap.addFieldBoundary(field.boundary, field.name);
    }

    // Load points
    const points = await pixDB.getAllByIndex('points', 'fieldId', field.id);
    if (points.length > 0) {
      // Check if points have tipo info (from project JSON) for color coding
      const hasTypes = points.some(p => p.tipo || (p.properties && p.properties.tipo));
      if (hasTypes) {
        pixMap.addTypedSamplePoints(points, point => this.onPointClick(point));
      } else {
        pixMap.addSamplePoints(points, point => this.onPointClick(point));
      }
      pixMap.fitBounds();
    }

    // Update header
    const areaStr = field.area ? ` (${field.area.toFixed(1)} ha)` : '';
    document.getElementById('currentFieldName').textContent = field.name + areaStr;
    document.getElementById('navPanel').style.display = 'block';
  }

  // ===== POINT INTERACTION =====
  onPointClick(point) {
    this.currentPoint = point;

    if (point.status === 'collected') {
      this.toast(`Punto ${point.name} ya recolectado`, 'warning');
      return;
    }

    // Start navigation to point
    gpsNav.setTarget(point.lat, point.lng, point.name);
    document.getElementById('navTargetName').textContent = `Punto ${point.name}`;
    pixMap.updatePointStatus(point.id, 'current');
    this.isNavigating = true;
  }

  updateNavPanel() {
    if (!gpsNav.targetPoint || !gpsNav.currentPosition) return;

    const dist = gpsNav.distanceTo(
      gpsNav.currentPosition.lat, gpsNav.currentPosition.lng,
      gpsNav.targetPoint.lat, gpsNav.targetPoint.lng
    );
    const bearing = gpsNav.bearingTo(
      gpsNav.currentPosition.lat, gpsNav.currentPosition.lng,
      gpsNav.targetPoint.lat, gpsNav.targetPoint.lng
    );

    document.getElementById('navDistance').innerHTML =
      dist < 1000 ? `${Math.round(dist)}<small>m</small>` : `${(dist/1000).toFixed(1)}<small>km</small>`;
    document.getElementById('navDirection').textContent =
      `Dirección: ${gpsNav.compassDirection(bearing)} (${Math.round(bearing)}°)`;

    // Draw nav line
    pixMap.drawNavigationLine(
      gpsNav.currentPosition.lat, gpsNav.currentPosition.lng,
      gpsNav.targetPoint.lat, gpsNav.targetPoint.lng
    );

    // Auto-open collect form when close
    if (dist < 10 && this.isNavigating) {
      if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
      this.toast('¡Llegaste al punto!', 'success');
    }
  }

  updateAccuracyDisplay(accuracy) {
    const el = document.getElementById('navAccuracy');
    const rounded = Math.round(accuracy);
    el.textContent = `Precisión GPS: ±${rounded}m`;
    el.className = 'nav-accuracy ' + (rounded <= 5 ? 'good' : rounded <= 15 ? 'medium' : 'poor');

    // Update quality bar
    const quality = gpsNav.getGPSQuality();
    const fill = document.getElementById('gpsQualityFill');
    if (fill) {
      fill.style.width = quality + '%';
      fill.className = 'gps-quality-fill ' + (quality >= 75 ? 'good' : quality >= 40 ? 'medium' : 'poor');
    }

    // Update status row
    const statusRow = document.getElementById('gpsStatusRow');
    const statusDot = document.getElementById('gpsStatusDot');
    const statusText = document.getElementById('gpsStatusText');
    if (statusRow) {
      statusRow.style.display = 'flex';
      if (gpsNav.isWarmedUp && gpsNav.isStabilized) {
        statusDot.className = 'gps-status-dot ready';
        statusText.textContent = `Listo | HDOP ~${gpsNav.getEstimatedHDOP() || '?'} | ${gpsNav.isStabilized ? 'Estable' : 'Mov.'}`;
      } else if (gpsNav.isWarmedUp) {
        statusDot.className = 'gps-status-dot warming';
        statusText.textContent = 'GPS listo, estabilizando posición...';
      } else {
        statusDot.className = 'gps-status-dot warming';
        statusText.textContent = 'GPS calentando, esperá mejor señal...';
      }
    }
  }

  // M8 FIX: Debounced auto-detect (runs max once per 3 seconds)
  _autoDetectThrottle = 0;
  async autoDetectPoint() {
    if (!gpsNav.currentPosition || this.isNavigating) return;
    const now = Date.now();
    if (now - this._autoDetectThrottle < 3000) return;
    this._autoDetectThrottle = now;

    const pos = gpsNav.currentPosition;
    const points = await pixDB.getAllByIndex('points', 'fieldId', this.currentField.id);
    const pending = points.filter(p => p.status === 'pending');

    for (const pt of pending) {
      const dist = gpsNav.distanceTo(pos.lat, pos.lng, pt.lat, pt.lng);
      const detectionRadius = this._gpsSettings?.detectionRadius || 15;

      if (dist < detectionRadius && pos.accuracy < detectionRadius * 2) {
        // Auto-select this point for collection
        this.currentPoint = pt;
        gpsNav.setTarget(pt.lat, pt.lng, pt.name);
        document.getElementById('navTargetName').textContent = `Punto ${pt.name}`;
        pixMap.updatePointStatus(pt.id, 'current');

        try { if (navigator.vibrate) navigator.vibrate([100, 50, 100]); } catch (_) {}
        this.toast(`Punto ${pt.name} detectado (${Math.round(dist)}m)`, 'success');
        break;
      }
    }
  }

  // Auto-detect field from GPS position (DataFarm auto-populate feature)
  // Checks all fields in current project to find which one contains the GPS position
  async autoDetectField() {
    if (!this.currentProject || !gpsNav.currentPosition) return null;

    const pos = gpsNav.currentPosition;
    const fields = await pixDB.getAllByIndex('fields', 'projectId', this.currentProject.id);

    for (const field of fields) {
      if (!field.boundary) continue;

      // C5 FIX: Handle both Polygon and MultiPolygon geometries
      const features = field.boundary.features || [field.boundary];
      for (const feature of features) {
        const geom = feature.geometry;
        if (!geom) continue;

        // Get all outer rings (MultiPolygon has multiple, Polygon has one)
        const outerRings = geom.type === 'MultiPolygon'
          ? geom.coordinates.map(poly => poly[0])
          : geom.type === 'Polygon' ? [geom.coordinates[0]] : [];

        for (const coords of outerRings) {
          if (!coords || coords.length < 3) continue;

          // Point-in-polygon ray casting
          let inside = false;
          const x = pos.lng, y = pos.lat;
          for (let i = 0, j = coords.length - 1; i < coords.length; j = i++) {
            const xi = coords[i][0], yi = coords[i][1];
            const xj = coords[j][0], yj = coords[j][1];
            if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) {
              inside = !inside;
            }
          }

          if (inside) return field;
        }
      }
    }
    return null;
  }

  // ===== GPS SETTINGS =====
  async saveGPSSetting(key, value) {
    await pixDB.setSetting('gps_' + key, value);
    this.toast(`GPS: ${key} = ${value}`, 'info');
  }

  async loadGPSSettings() {
    const minAcc = await pixDB.getSetting('gps_minAccuracy');
    if (minAcc) document.getElementById('gpsMinAccuracy').value = minAcc;
    const avgSamples = await pixDB.getSetting('gps_avgSamples');
    if (avgSamples) document.getElementById('gpsAvgSamples').value = avgSamples;
    const kalman = await pixDB.getSetting('gps_kalmanEnabled');
    if (kalman !== null && kalman !== undefined) document.getElementById('gpsKalmanEnabled').value = kalman;
    const detRadius = await pixDB.getSetting('gps_detectionRadius');

    // Store settings for quick access
    this._gpsSettings = {
      minAccuracy: parseFloat(minAcc) || 5,
      avgSamples: parseInt(avgSamples) || 10,
      kalmanEnabled: kalman !== '0',
      detectionRadius: parseFloat(detRadius) || 15
    };
  }

  // ===== OFFLINE TILE DOWNLOAD =====
  async downloadTilesOffline() {
    if (!pixMap.map) {
      this.toast('Abrí el mapa primero', 'warning');
      return;
    }

    // Get bounds from field layers or current map view
    let bounds;
    if (pixMap.fieldLayers.length > 0) {
      const group = L.featureGroup(pixMap.fieldLayers);
      bounds = group.getBounds().pad(0.2); // 20% padding
    } else {
      bounds = pixMap.map.getBounds().pad(0.1);
    }

    if (!bounds || !bounds.isValid()) {
      this.toast('Sin área para descargar', 'warning');
      return;
    }

    // Check if preloadTiles exists
    if (typeof pixMap.preloadTiles !== 'function') {
      this.toast('Módulo de tiles offline no disponible', 'error');
      return;
    }

    // Estimate
    const estimate = pixMap.estimateTileCount(bounds, 13, 18);
    const progressEl = document.getElementById('tileDownloadProgress');
    const fillEl = document.getElementById('tileProgressFill');
    const textEl = document.getElementById('tileProgressText');

    this.toast(`Descargando ~${estimate.tileCount} tiles (~${estimate.estimatedSizeMB.toFixed(1)} MB)...`, 'info');

    if (progressEl) progressEl.style.display = 'block';

    try {
      const result = await pixMap.preloadTiles(bounds, 13, 18, (downloaded, total, zoom) => {
        const pct = Math.round((downloaded / total) * 100);
        if (fillEl) fillEl.style.width = pct + '%';
        if (textEl) textEl.textContent = `Zoom ${zoom}: ${downloaded}/${total} tiles (${pct}%)`;
      });
      this.toast(`Mapa offline listo: ${result.downloaded} tiles (${result.cacheSizeMB || '?'} MB)`, 'success');
    } catch (e) {
      this.toast('Error descargando tiles: ' + e.message, 'error');
    } finally {
      if (progressEl) progressEl.style.display = 'none';
    }
    this.updateTileCacheStats();
  }

  async clearTileCache() {
    if (typeof pixMap.clearTileCache === 'function') {
      await pixMap.clearTileCache();
      this.toast('Cache de tiles eliminado', 'info');
      this.updateTileCacheStats();
    }
  }

  async updateTileCacheStats() {
    const el = document.getElementById('tileCacheStats');
    if (!el) return;
    if (typeof pixMap.getCacheStats === 'function') {
      try {
        const stats = await pixMap.getCacheStats();
        el.textContent = `Cache: ${stats.tileCount} tiles (~${stats.estimatedSizeMB.toFixed(1)} MB)`;
      } catch (e) {
        el.textContent = 'Cache: no disponible';
      }
    }
  }

  // ===== COLLECT SAMPLE =====
  async openCollectForm() {
    if (!this.currentPoint) {
      this.toast('Seleccioná un punto en el mapa', 'warning');
      return;
    }

    // A2 FIX: Warn if GPS is not active or accuracy is poor
    if (!gpsNav.currentPosition) {
      this.toast('Sin señal GPS. Coordenadas serán del punto teórico.', 'warning');
    } else if (gpsNav.currentPosition.accuracy > 30) {
      this.toast(`GPS baja precisión (±${Math.round(gpsNav.currentPosition.accuracy)}m)`, 'warning');
    }

    document.getElementById('collectPointName').textContent = `Punto ${this.currentPoint.name}`;
    document.getElementById('collectCoords').textContent =
      `${this.currentPoint.lat.toFixed(6)}, ${this.currentPoint.lng.toFixed(6)}`;

    // Reset form
    document.getElementById('barcodeValue').textContent = 'Sin escanear';
    document.getElementById('barcodeDisplay').classList.remove('scanned');
    const ibraDetailsEl = document.getElementById('ibraDetails');
    if (ibraDetailsEl) ibraDetailsEl.style.display = 'none';
    document.getElementById('sampleNotes').value = '';
    document.getElementById('photoPreviewImg').style.display = 'none';
    document.getElementById('photoPlaceholder').style.display = 'flex';
    this.collectForm = { barcode: null, photo: null, parsedIBRA: null };

    // Set default collector
    const collector = await pixDB.getSetting('collectorName');
    if (collector) document.getElementById('collectorField').value = collector;

    // Auto-adjust depth based on previous samples (DataFarm feature)
    this.autoAdjustDepth();

    // Show modal
    document.getElementById('collectModal').classList.add('active');
  }

  closeCollectForm() {
    document.getElementById('collectModal').classList.remove('active');
  }

  // Scan barcode - with IBRA Megalab QR parsing
  async scanBarcode() {
    document.getElementById('scannerOverlay').classList.add('active');
    try {
      await barcodeScanner.init('scannerViewfinder', (code) => {
        // Parse the scanned code (detect IBRA Megalab format)
        const parsed = BarcodeScanner.parseIBRA(code);
        this.collectForm.barcode = code;
        this.collectForm.parsedIBRA = parsed;

        // Update barcode display
        const barcodeValue = document.getElementById('barcodeValue');
        const barcodeDisplay = document.getElementById('barcodeDisplay');
        barcodeDisplay.classList.add('scanned');

        if (parsed.isIBRA && parsed.sampleId) {
          // Show IBRA parsed info
          barcodeValue.innerHTML = `
            <span class="ibra-badge">IBRA</span> ${parsed.sampleId}
          `;

          // Show details below the barcode display
          const detailsEl = document.getElementById('ibraDetails');
          const summary = BarcodeScanner.formatIBRADisplay(parsed);
          if (summary && detailsEl) {
            detailsEl.textContent = summary;
            detailsEl.style.display = 'block';
          }

          // Auto-fill depth if IBRA QR provides it
          if (parsed.depth) {
            const depthNorm = parsed.depth.replace(/\s/g, '');
            const depthBtn = document.querySelector(`.depth-chip[data-depth="${depthNorm}"]`);
            if (depthBtn) {
              this.selectDepth(depthBtn, depthNorm);
            }
          }

          // Auto-fill sample type if IBRA QR provides it
          if (parsed.sampleType) {
            const typeMap = {
              'quimico': 'quimico', 'quimica': 'quimico', 'chemical': 'quimico',
              'fertilidade': 'fertilidad', 'fertilidad': 'fertilidad',
              'fisico': 'fisico', 'fisica': 'fisico', 'physical': 'fisico',
              'micro': 'microbiologico', 'microbiologico': 'microbiologico',
              'nematodo': 'nematodos', 'nematodos': 'nematodos', 'nematoide': 'nematodos',
              'carbono': 'carbono', 'carbon': 'carbono',
              'completo': 'completo', 'complete': 'completo'
            };
            const mapped = typeMap[parsed.sampleType.toLowerCase()] || null;
            if (mapped) {
              document.getElementById('sampleType').value = mapped;
            }
          }

          this.toast(`IBRA Megalab: ${parsed.sampleId}`, 'success');
        } else {
          // Generic barcode/QR
          barcodeValue.textContent = code;
          const detailsEl = document.getElementById('ibraDetails');
          if (detailsEl) detailsEl.style.display = 'none';
          this.toast(`Código: ${code}`, 'success');
        }

        this.closeScannerOverlay();
      });
    } catch (e) {
      this.toast('Error al iniciar cámara', 'error');
      this.closeScannerOverlay();
    }
  }

  async closeScannerOverlay() {
    await barcodeScanner.stop();
    document.getElementById('scannerOverlay').classList.remove('active');
  }

  // Take photo
  async takePhoto() {
    try {
      const photo = await BarcodeScanner.takePhoto();
      this.collectForm.photo = photo;
      const img = document.getElementById('photoPreviewImg');
      img.src = photo;
      img.style.display = 'block';
      document.getElementById('photoPlaceholder').style.display = 'none';
    } catch (e) {
      console.error('Photo error:', e);
    }
  }

  // Select depth
  selectDepth(btn, depth) {
    document.querySelectorAll('.depth-chip').forEach(c => c.classList.remove('active'));
    btn.classList.add('active');
    this.collectForm.depth = depth;
  }

  // Save sample
  async saveSample() {
    // C1: Guard against null currentPoint/currentField
    if (!this.currentPoint || !this.currentField) {
      this.toast('No hay punto seleccionado', 'error');
      return;
    }
    // Duplicate prevention: check if point already collected
    if (this.currentPoint.status === 'collected') {
      this.toast('Este punto ya fue recolectado', 'warning');
      return;
    }

    const depth = this.collectForm.depth || document.querySelector('.depth-chip.active')?.dataset.depth || '0-20';
    const sampleType = document.getElementById('sampleType').value;
    const collector = document.getElementById('collectorField').value;
    const notes = document.getElementById('sampleNotes').value;

    // A7 FIX: Validate sampleType has a real value
    if (!sampleType || sampleType === '' || sampleType === 'none') {
      this.toast('Seleccioná el tipo de análisis', 'warning');
      return;
    }

    // A8 FIX: Validate collector name
    if (!collector || collector.trim() === '') {
      this.toast('Ingresá el nombre del colector', 'warning');
      document.getElementById('collectorField').focus();
      return;
    }

    // Save collector name
    await pixDB.setSetting('collectorName', collector.trim());

    // Build IBRA metadata if available
    const ibraData = this.collectForm.parsedIBRA || null;

    // A1 FIX: GPS averaging with cancel support + timeout guard
    let gpsLat = gpsNav.currentPosition?.lat || this.currentPoint.lat;
    let gpsLng = gpsNav.currentPosition?.lng || this.currentPoint.lng;
    let gpsAcc = gpsNav.currentPosition?.accuracy || null;
    let gpsMethod = 'single';

    if (gpsNav.currentPosition && typeof gpsNav.averagePosition === 'function') {
      try {
        const avgSamples = parseInt(await pixDB.getSetting('gps_avgSamples') || '10');
        this.toast(`Promediando ${avgSamples} lecturas GPS...`, 'info');

        // Wrap averaging with a max 15-second timeout to prevent UI freeze
        const avgPromise = gpsNav.averagePosition(avgSamples, 1500, (taken, total, acc) => {
          const el = document.getElementById('collectCoords');
          if (el) el.textContent = `GPS: ${taken}/${total} lecturas (+-${acc.toFixed(1)}m)`;
        });
        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error('GPS averaging timeout')), 15000)
        );

        const avg = await Promise.race([avgPromise, timeoutPromise]);
        gpsLat = avg.lat;
        gpsLng = avg.lng;
        gpsAcc = avg.accuracy;
        gpsMethod = `averaged_${avg.samples || avg.samplesUsed || '?'}pts`;
      } catch (e) {
        console.warn('GPS averaging failed, using single reading:', e.message);
        this.toast('GPS: usando lectura simple', 'warning');
      }
    }

    const sample = {
      pointId: this.currentPoint.id,
      fieldId: this.currentField.id,
      pointName: this.currentPoint.name,
      lat: gpsLat,
      lng: gpsLng,
      accuracy: gpsAcc,
      gpsMethod: gpsMethod,
      depth: depth,
      sampleType: sampleType,
      barcode: this.collectForm.barcode,
      ibraSampleId: ibraData?.sampleId || null,
      ibraLabOrder: ibraData?.labOrder || null,
      ibraSource: ibraData?.source || null,
      ibraRaw: ibraData?.raw || null,
      collector: collector,
      userId: pixAuth.getUserId(),
      notes: notes,
      photo: this.collectForm.photo,
      collectedAt: new Date().toISOString(),
      synced: 0
    };

    try {
      await pixDB.add('samples', sample);

      // Update point status
      this.currentPoint.status = 'collected';
      await pixDB.put('points', this.currentPoint);
      pixMap.updatePointStatus(this.currentPoint.id, 'collected');
    } catch (e) {
      console.error('Error saving sample:', e);
      this.toast('Error guardando muestra: ' + e.message, 'error');
      return;
    }

    this.closeCollectForm();
    this.toast(`Muestra guardada: ${this.currentPoint.name}`, 'success');

    // Navigate to next pending point
    const points = await pixDB.getAllByIndex('points', 'fieldId', this.currentField.id);
    const nextPending = points.find(p => p.status === 'pending');
    if (nextPending) {
      this.onPointClick(nextPending);
    } else {
      gpsNav.clearTarget();
      pixMap.clearNavigationLine();
      this.isNavigating = false;
      this.toast('¡Todos los puntos recolectados!', 'success');
    }
  }

  // ===== IMPORT FROM DRIVE =====
  async showImportModal() {
    if (!driveSync.isAuthenticated()) {
      const clientId = await pixDB.getSetting('driveClientId');
      if (!clientId) {
        this.toast('Configurá Google Drive en Ajustes primero', 'warning');
        this.showView('settings');
        return;
      }
      try {
        await driveSync.init(clientId);
        await driveSync.authenticate();
        // Wait for auth callback
        return;
      } catch (e) {
        this.toast('Error de autenticación', 'error');
        return;
      }
    }

    document.getElementById('importModal').classList.add('active');
    document.getElementById('importFileList').innerHTML = '<p style="text-align:center;color:var(--text-muted)">Cargando archivos...</p>';

    try {
      const files = await driveSync.listImportableFiles();
      if (files.length === 0) {
        document.getElementById('importFileList').innerHTML = `
          <div class="empty-state" style="padding:24px">
            <p>No hay archivos en la carpeta "PIX Muestreo" de Drive.<br>
            Subí archivos GeoJSON, KML o CSV con tus mapas y puntos.</p>
          </div>`;
        return;
      }

      let html = '';
      for (const f of files) {
        const ext = f.name.split('.').pop().toUpperCase();
        html += `
          <div class="file-list-item" onclick="app.importFile('${f.id}', '${f.name}')">
            <div class="file-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6"/></svg>
            </div>
            <div class="file-info">
              <div class="file-name">${f.name}</div>
              <div class="file-meta">${ext} · ${new Date(f.modifiedTime).toLocaleDateString()}</div>
            </div>
          </div>`;
      }
      document.getElementById('importFileList').innerHTML = html;
    } catch (e) {
      document.getElementById('importFileList').innerHTML = `<p style="color:var(--danger);text-align:center">${e.message}</p>`;
    }
  }

  closeImportModal() {
    document.getElementById('importModal').classList.remove('active');
  }

  async importFile(fileId, fileName) {
    this.toast('Importando ' + fileName + '...', '');
    try {
      const geojson = await driveSync.importGeoFile(fileId, fileName);
      await this.processGeoJSON(geojson, fileName);
      this.closeImportModal();
      this.loadProjects();
      this.toast('Importado: ' + fileName, 'success');
    } catch (e) {
      this.toast('Error: ' + e.message, 'error');
    }
  }

  // Import from local file (supports GeoJSON, KML, CSV, and Project JSON)
  async importLocalFile() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.geojson,.json,.kml,.csv';

    input.onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;

      const text = await file.text();

      try {
        // Check if this is a PIX project JSON file (has project + lotes structure)
        if (file.name.endsWith('.json')) {
          const parsed = JSON.parse(text);
          if (parsed.project && parsed.lotes && Array.isArray(parsed.lotes)) {
            await this.importProjectJSON(parsed);
            this.loadProjects();
            this.toast(`Proyecto importado: ${parsed.project.name} (${parsed.lotes.length} lotes)`, 'success');
            return;
          }
          // Not a project JSON, fall through to GeoJSON processing
          await this.processGeoJSON(parsed, file.name);
          this.loadProjects();
          this.toast('Importado: ' + file.name, 'success');
          return;
        }

        let geojson;
        if (file.name.endsWith('.kml')) {
          geojson = driveSync._parseKML(text);
        } else if (file.name.endsWith('.csv')) {
          geojson = driveSync._parseCSV(text);
        } else {
          geojson = JSON.parse(text);
        }

        await this.processGeoJSON(geojson, file.name);
        this.loadProjects();
        this.toast('Importado: ' + file.name, 'success');
      } catch (err) {
        this.toast('Error al importar: ' + err.message, 'error');
      }
    };
    input.click();
  }

  // ===== IMPORT PROJECT JSON =====
  // Imports a consolidated project JSON (from convert_project.py)
  // Creates a project with all lotes as fields, each with zonas and puntos
  async importProjectJSON(data) {
    const proj = data.project;

    // Create the project entry
    const projectId = await pixDB.add('projects', {
      name: proj.name,
      client: proj.client || '',
      source: 'proyecto_hacienda.json',
      totalLotes: proj.totalLotes,
      totalPoints: proj.totalPoints,
      importDate: proj.date || new Date().toISOString().slice(0, 10)
    });

    let totalPointsImported = 0;

    // Create a field for each lote
    for (const lote of data.lotes) {
      // Store zonas as the field boundary (FeatureCollection of zone polygons)
      const boundary = (lote.zonas && lote.zonas.features && lote.zonas.features.length > 0)
        ? lote.zonas
        : null;

      const fieldId = await pixDB.add('fields', {
        projectId: projectId,
        name: lote.name || lote.id,
        loteId: lote.id,
        area: lote.area_ha || null,
        boundary: boundary,
        // Store zone metadata for color-coding
        zonasMetadata: this._extractZonasMetadata(lote.zonas)
      });

      // Create points for this lote
      if (lote.puntos && Array.isArray(lote.puntos)) {
        for (const punto of lote.puntos) {
          await pixDB.add('points', {
            fieldId: fieldId,
            name: punto.id || punto.name || '',
            lat: punto.lat,
            lng: punto.lng,
            zona: punto.zona,
            tipo: punto.tipo || 'principal',
            status: (punto.status === 'pendiente' || punto.status === 'pending') ? 'pending' : punto.status,
            properties: {
              zona: punto.zona,
              tipo: punto.tipo
            }
          });
          totalPointsImported++;
        }
      }
    }

    console.log(`[PIX] Proyecto importado: ${proj.name}, ${data.lotes.length} lotes, ${totalPointsImported} puntos`);
  }

  // Extract zone class info from zonas features for color coding
  _extractZonasMetadata(zonas) {
    if (!zonas || !zonas.features) return [];
    return zonas.features.map((f, idx) => {
      const props = f.properties || {};
      // Try common property names for zone class
      const clase = props.clase || props.class || props.Clase || props.CLASS
        || props.categoria || props.zona || props.Zona || '';
      return {
        index: idx,
        clase: clase,
        name: props.name || props.Name || props.nombre || `Zona ${idx + 1}`,
        properties: props
      };
    });
  }

  // Process imported GeoJSON into projects/fields/points
  async processGeoJSON(geojson, sourceName) {
    const projectName = sourceName.replace(/\.\w+$/, '').replace(/[_-]/g, ' ');

    // Create project
    const projectId = await pixDB.add('projects', {
      name: projectName,
      client: '',
      source: sourceName
    });

    // Separate polygons (fields) and points
    const polygons = [];
    const points = [];

    const features = geojson.features || (geojson.type === 'Feature' ? [geojson] : []);

    features.forEach(f => {
      if (!f.geometry || !f.geometry.coordinates) return;
      if (f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon') {
        polygons.push(f);
      } else if (f.geometry.type === 'Point') {
        // Validate coordinates exist and are valid numbers
        const c = f.geometry.coordinates;
        if (!c || c.length < 2 || !isFinite(c[0]) || !isFinite(c[1])) return;
        points.push(f);
      }
    });

    // M14 FIX: Track assigned points to prevent duplicates across polygons
    const assignedPointIndices = new Set();

    // If we have polygons, create fields from them (with DB error handling)
    if (polygons.length > 0) {
      for (let i = 0; i < polygons.length; i++) {
        const poly = polygons[i];
        const fieldName = poly.properties?.name || poly.properties?.Name || `Campo ${i + 1}`;
        const area = this.calculateArea(poly.geometry);

        try {
          const fieldId = await pixDB.add('fields', {
            projectId,
            name: fieldName,
            area: area,
            boundary: { type: 'FeatureCollection', features: [poly] }
          });

          // Assign points: if only 1 polygon use all, otherwise do point-in-polygon
          let fieldPoints;
          if (polygons.length === 1) {
            fieldPoints = points.map((p, idx) => ({ ...p, _idx: idx }));
          } else {
            fieldPoints = points
              .map((p, idx) => ({ ...p, _idx: idx }))
              .filter(p => !assignedPointIndices.has(p._idx) &&
                this.pointInPolygon(p.geometry.coordinates, poly.geometry));
          }

          for (let j = 0; j < fieldPoints.length; j++) {
            const pt = fieldPoints[j];
            assignedPointIndices.add(pt._idx);
            await pixDB.add('points', {
              fieldId,
              name: pt.properties?.name || pt.properties?.Name || pt.properties?.id || `P${j + 1}`,
              lat: pt.geometry.coordinates[1],
              lng: pt.geometry.coordinates[0],
              status: 'pending',
              properties: pt.properties
            });
          }
        } catch (e) {
          console.error(`Error importing field ${fieldName}:`, e);
        }
      }
    } else if (points.length > 0) {
      // No polygons, create a single field from points
      try {
        const fieldId = await pixDB.add('fields', {
          projectId,
          name: projectName,
          area: null,
          boundary: null
        });

        for (let j = 0; j < points.length; j++) {
          const pt = points[j];
          await pixDB.add('points', {
            fieldId,
            name: pt.properties?.name || pt.properties?.Name || pt.properties?.id || `P${j + 1}`,
            lat: pt.geometry.coordinates[1],
            lng: pt.geometry.coordinates[0],
            status: 'pending',
            properties: pt.properties
          });
        }
      } catch (e) {
        console.error('Error importing points:', e);
      }
    }
  }

  // M9 FIX: Calculate polygon area — handles MultiPolygon + holes correctly
  calculateArea(geometry) {
    // Get all polygon rings (MultiPolygon may have multiple polygons)
    const polygonRings = geometry.type === 'MultiPolygon'
      ? geometry.coordinates.map(poly => poly) // each poly = [outerRing, ...holes]
      : [geometry.coordinates]; // single polygon = [outerRing, ...holes]

    let totalArea = 0;

    for (const rings of polygonRings) {
      const outerRing = rings[0];
      if (!outerRing || outerRing.length < 3) continue;

      // Calculate outer ring area
      totalArea += this._ringArea(outerRing);

      // Subtract hole areas
      for (let h = 1; h < rings.length; h++) {
        if (rings[h] && rings[h].length >= 3) {
          totalArea -= this._ringArea(rings[h]);
        }
      }
    }

    return Math.abs(totalArea);
  }

  // Helper: Shoelace area of a coordinate ring in hectares
  _ringArea(coords) {
    if (!coords || coords.length < 3) return 0;
    const latMid = coords.reduce((s, c) => s + c[1], 0) / coords.length;
    const mPerDegLat = 111320;
    const mPerDegLng = 111320 * Math.cos(latMid * Math.PI / 180);

    let area = 0;
    for (let i = 0; i < coords.length - 1; i++) {
      const x1 = coords[i][0] * mPerDegLng, y1 = coords[i][1] * mPerDegLat;
      const x2 = coords[i + 1][0] * mPerDegLng, y2 = coords[i + 1][1] * mPerDegLat;
      area += x1 * y2 - x2 * y1;
    }
    return Math.abs(area / 2) / 10000; // m² → hectares
  }

  // Point in polygon test — handles MultiPolygon
  pointInPolygon(point, polygon) {
    const [x, y] = point;
    // Get all outer rings to test against
    const outerRings = polygon.type === 'MultiPolygon'
      ? polygon.coordinates.map(poly => poly[0])
      : [polygon.coordinates[0]];

    for (const coords of outerRings) {
      if (!coords || coords.length < 3) continue;
      let inside = false;
      for (let i = 0, j = coords.length - 1; i < coords.length; j = i++) {
        const [xi, yi] = coords[i];
        const [xj, yj] = coords[j];
        if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) {
          inside = !inside;
        }
      }
      if (inside) return true;
    }
    return false;
  }

  // ===== SYNC =====
  async updateSyncStats() {
    const allSamples = await pixDB.getAll('samples');
    const unsynced = allSamples.filter(s => s.synced === 0);
    const synced = allSamples.filter(s => s.synced === 1);

    document.getElementById('syncPending').textContent = unsynced.length;
    document.getElementById('syncCompleted').textContent = synced.length;
    document.getElementById('syncTotal').textContent = allSamples.length;

    const projects = await pixDB.getAll('projects');
    document.getElementById('syncProjects').textContent = projects.length;
  }

  async syncToDrive() {
    if (!driveSync.isAuthenticated()) {
      this.toast('Conectá Google Drive primero', 'warning');
      return;
    }

    const btn = document.getElementById('syncBtn');
    btn.disabled = true;
    btn.innerHTML = '<svg class="spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 11-6.219-8.56"/></svg> Sincronizando...';

    this.addSyncLog('Iniciando sincronización...');

    try {
      const result = await driveSync.syncAll((done, total) => {
        const pct = Math.round((done / total) * 100);
        btn.innerHTML = `<svg class="spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 11-6.219-8.56"/></svg> ${done}/${total} (${pct}%)`;
      });
      this.addSyncLog(`✓ ${result.synced} muestras sincronizadas a Drive`);
      this.toast(`${result.synced} muestras sincronizadas`, 'success');
    } catch (e) {
      this.addSyncLog(`✗ Error: ${e.message}`);
      this.toast('Error al sincronizar', 'error');
    }

    btn.disabled = false;
    btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 11-6.219-8.56"/><path d="M21 3v9h-9"/></svg> Sincronizar con Drive';
    this.updateSyncStats();
  }

  // Export all data as JSON (offline backup)
  async exportLocalBackup() {
    // B5 FIX: Include serviceOrders in backup
    const data = {
      app: 'PIX Muestreo',
      exportDate: new Date().toISOString(),
      projects: await pixDB.getAll('projects'),
      fields: await pixDB.getAll('fields'),
      points: await pixDB.getAll('points'),
      samples: await pixDB.getAll('samples'),
      tracks: await pixDB.getAll('tracks'),
      serviceOrders: await pixDB.getAll('serviceOrders'),
      users: await pixDB.getAll('users')
    };

    // Remove photos from backup (too large)
    data.samples.forEach(s => { if (s.photo) s.photo = '(foto omitida)'; });

    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `pix_muestreo_backup_${new Date().toISOString().slice(0,10)}.json`;
    a.click();
    URL.revokeObjectURL(url);

    this.toast('Backup descargado', 'success');
  }

  addSyncLog(message) {
    const log = document.getElementById('syncLog');
    // B8 FIX: Use 24h format for consistent time display across locales
    const now = new Date();
    const time = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
    log.innerHTML += `<div class="sync-log-entry"><span class="time">${time}</span>${message}</div>`;
    log.scrollTop = log.scrollHeight;
  }

  // ===== SETTINGS =====
  async saveDriveClientId() {
    const id = document.getElementById('driveClientId').value.trim();
    if (!id) return;
    await pixDB.setSetting('driveClientId', id);
    try {
      await driveSync.init(id);
      this.toast('Client ID guardado', 'success');
    } catch (e) {
      this.toast('Error: ' + e.message, 'error');
    }
  }

  async connectDrive() {
    const clientId = document.getElementById('driveClientId').value.trim();
    if (!clientId) {
      this.toast('Ingresá el Client ID primero', 'warning');
      return;
    }
    await pixDB.setSetting('driveClientId', clientId);
    try {
      await driveSync.init(clientId);
      await driveSync.authenticate();
    } catch (e) {
      this.toast('Error: ' + e.message, 'error');
    }
  }

  async saveCollectorName() {
    const name = document.getElementById('collectorName').value.trim();
    if (name) {
      await pixDB.setSetting('collectorName', name);
      this.toast('Nombre guardado', 'success');
    }
  }

  // Track toggle
  toggleTracking() {
    const btn = document.getElementById('trackBtn');
    if (gpsNav.isTracking) {
      const positions = gpsNav.stopTracking();
      if (this.currentField && positions.length > 0) {
        pixDB.add('tracks', {
          fieldId: this.currentField.id,
          positions: positions,
          startTime: positions[0]?.timestamp,
          endTime: positions[positions.length - 1]?.timestamp
        });
      }
      btn.classList.remove('active');
      this.toast('Recorrido guardado', 'success');
    } else {
      gpsNav.startTracking();
      btn.classList.add('active');
      this.toast('Grabando recorrido GPS', '');
    }
  }

  // ===== CONTORNAR TALHÃO (DataFarm feature: field perimeter mapping via GPS) =====

  // Start GPS boundary tracing: walk around field perimeter recording positions
  startBoundaryTrace() {
    if (this._boundaryTracing) {
      this.stopBoundaryTrace();
      return;
    }

    if (!gpsNav.currentPosition) {
      this.toast('Esperá señal GPS antes de iniciar', 'warning');
      return;
    }

    this._boundaryTracing = true;
    this._boundaryPositions = [];
    this._boundaryPolyline = null;

    // Start GPS tracking
    gpsNav.startTracking();

    // Record positions at regular intervals (every 3 seconds)
    this._boundaryInterval = setInterval(() => {
      if (!gpsNav.currentPosition) return;

      const pos = gpsNav.currentPosition;
      // Only add if accuracy is reasonable and moved > 2m from last point
      if (pos.accuracy > 20) return;

      const last = this._boundaryPositions[this._boundaryPositions.length - 1];
      if (last) {
        const dist = gpsNav.distanceTo(pos.lat, pos.lng, last.lat, last.lng);
        if (dist < 2) return; // didn't move enough
      }

      this._boundaryPositions.push({ lat: pos.lat, lng: pos.lng, accuracy: pos.accuracy });

      // Draw polyline on map
      if (this._boundaryPolyline) {
        pixMap.map.removeLayer(this._boundaryPolyline);
      }
      const latlngs = this._boundaryPositions.map(p => [p.lat, p.lng]);
      this._boundaryPolyline = L.polyline(latlngs, {
        color: '#7FD633', weight: 3, dashArray: '8,6', opacity: 0.9
      }).addTo(pixMap.map);

      // Show point count
      const btn = document.getElementById('boundaryBtn');
      if (btn) btn.textContent = `Trazando (${this._boundaryPositions.length} pts)`;
    }, 3000);

    const btn = document.getElementById('boundaryBtn');
    if (btn) {
      btn.classList.add('active');
      btn.textContent = 'Trazando...';
    }
    this.toast('Caminá alrededor del lote. Trazando perímetro...', 'success');
  }

  // Stop boundary tracing and save as field boundary GeoJSON
  async stopBoundaryTrace() {
    if (!this._boundaryTracing) return;

    clearInterval(this._boundaryInterval);
    this._boundaryTracing = false;
    gpsNav.stopTracking();

    const positions = this._boundaryPositions || [];
    if (positions.length < 4) {
      this.toast('Necesitás al menos 4 puntos para un perímetro', 'warning');
      this._cleanupBoundaryTrace();
      return;
    }

    // Close the polygon (first point = last point)
    const coords = positions.map(p => [p.lng, p.lat]);
    coords.push(coords[0]); // close ring

    // Create GeoJSON polygon
    const geojson = {
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        geometry: { type: 'Polygon', coordinates: [coords] },
        properties: {
          name: this.currentField?.name || 'Campo',
          tracedAt: new Date().toISOString(),
          pointCount: positions.length,
          method: 'GPS boundary trace'
        }
      }]
    };

    // C4 FIX: Correct Shoelace formula — convert ALL coords to meters first
    const centerLat = positions.reduce((s, p) => s + p.lat, 0) / positions.length;
    const mPerDegLat = 111320;
    const mPerDegLng = 111320 * Math.cos(centerLat * Math.PI / 180);

    // Convert to local metric coordinates
    const mCoords = positions.map(p => ({
      x: p.lng * mPerDegLng,
      y: p.lat * mPerDegLat
    }));

    // Shoelace formula on metric coords
    let area = 0;
    for (let i = 0; i < mCoords.length; i++) {
      const j = (i + 1) % mCoords.length;
      area += mCoords[i].x * mCoords[j].y;
      area -= mCoords[j].x * mCoords[i].y;
    }
    area = Math.abs(area / 2) / 10000; // m² → hectares

    // Save to field in DB
    if (this.currentField) {
      this.currentField.boundary = geojson;
      this.currentField.area = Math.round(area * 100) / 100;
      await pixDB.put('fields', this.currentField);

      // Reload field on map
      this.loadFieldOnMap(this.currentField);
      this.toast(`Perímetro guardado: ${positions.length} puntos, ${area.toFixed(1)} ha`, 'success');
    }

    this._cleanupBoundaryTrace();
  }

  _cleanupBoundaryTrace() {
    if (this._boundaryPolyline && pixMap.map) {
      pixMap.map.removeLayer(this._boundaryPolyline);
    }
    this._boundaryPositions = [];
    this._boundaryPolyline = null;
    const btn = document.getElementById('boundaryBtn');
    if (btn) {
      btn.classList.remove('active');
      btn.textContent = 'Contornar';
    }
  }

  // ===== AUTO-DEPTH ADJUSTMENT (DataFarm feature) =====
  // Automatically sets depth based on last collected sample or field plan
  async autoAdjustDepth() {
    if (!this.currentField || !this.currentPoint) return;

    // Check if there are previous samples for this field to determine depth pattern
    const samples = await pixDB.getAllByIndex('samples', 'fieldId', this.currentField.id);

    // If same point has been sampled at 0-20, suggest 20-40 next
    const pointSamples = samples.filter(s => s.pointId === this.currentPoint.id);
    const usedDepths = pointSamples.map(s => s.depth);

    const depthSequence = ['0-20', '20-40', '40-60', '60-80', '80-100'];
    let suggestedDepth = '0-20'; // default

    // Find first depth not yet sampled at this point
    for (const d of depthSequence) {
      if (!usedDepths.includes(d)) {
        suggestedDepth = d;
        break;
      }
    }

    // If all depths taken, use most common depth from other points in field
    if (usedDepths.length >= depthSequence.length && samples.length > 0) {
      const depthCounts = {};
      for (const s of samples) {
        depthCounts[s.depth] = (depthCounts[s.depth] || 0) + 1;
      }
      suggestedDepth = Object.entries(depthCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || '0-20';
    }

    // Apply auto-depth
    const depthBtn = document.querySelector(`.depth-chip[data-depth="${suggestedDepth}"]`);
    if (depthBtn) {
      this.selectDepth(depthBtn, suggestedDepth);
    }

    return suggestedDepth;
  }

  // Center map
  centerMap() {
    pixMap.centerOnUser();
  }

  // Navigate to next pending
  async nextPoint() {
    if (!this.currentField) return;
    const points = await pixDB.getAllByIndex('points', 'fieldId', this.currentField.id);
    const pending = points.filter(p => p.status === 'pending');

    if (pending.length === 0) {
      this.toast('Todos los puntos recolectados', 'success');
      return;
    }

    // Find nearest pending
    const nearest = gpsNav.findNearest(pending);
    if (nearest) {
      this.onPointClick(nearest);
      this.toast(`Navegando a ${nearest.name}`, '');
    }
  }

  // Delete project
  // A11 FIX: Also delete service orders + tracks associated with the project
  async deleteProject(projectId) {
    if (!confirm('¿Eliminar este proyecto y todos sus datos?')) return;

    const fields = await pixDB.getAllByIndex('fields', 'projectId', projectId);
    for (const f of fields) {
      const points = await pixDB.getAllByIndex('points', 'fieldId', f.id);
      for (const p of points) await pixDB.delete('points', p.id);
      const samples = await pixDB.getAllByIndex('samples', 'fieldId', f.id);
      for (const s of samples) await pixDB.delete('samples', s.id);
      const tracks = await pixDB.getAllByIndex('tracks', 'fieldId', f.id);
      for (const t of tracks) await pixDB.delete('tracks', t.id);
      await pixDB.delete('fields', f.id);
    }
    // Delete service orders for this project
    const orders = await pixDB.getAllByIndex('serviceOrders', 'projectId', projectId);
    for (const o of orders) await pixDB.delete('serviceOrders', o.id);

    await pixDB.delete('projects', projectId);
    this.loadProjects();
    this.toast('Proyecto eliminado', '');
  }

  // Toast notification
  toast(message, type = '') {
    const existing = document.querySelector('.toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    document.body.appendChild(toast);

    requestAnimationFrame(() => toast.classList.add('show'));
    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  }

  showInstallBanner() {
    let banner = document.getElementById('installBanner');
    if (!banner) {
      banner = document.createElement('div');
      banner.id = 'installBanner';
      banner.style.cssText = 'position:fixed;bottom:70px;left:16px;right:16px;background:linear-gradient(135deg,#7FD633,#0d9488);color:#0F1B2D;padding:16px 20px;border-radius:16px;display:flex;align-items:center;gap:12px;z-index:9999;box-shadow:0 8px 32px rgba(0,0,0,0.4);font-family:Inter,sans-serif;';
      banner.innerHTML = `
        <div style="flex:1">
          <div style="font-weight:700;font-size:15px;">Instalar PIX Muestreo</div>
          <div style="font-size:12px;opacity:0.8;margin-top:2px;">Acceso directo + funciona sin internet</div>
        </div>
        <button onclick="app.installApp()" style="background:#0F1B2D;color:#7FD633;border:none;padding:10px 20px;border-radius:10px;font-weight:600;font-size:14px;cursor:pointer;">Instalar</button>
        <button onclick="app.hideInstallBanner()" style="background:none;border:none;color:#0F1B2D;font-size:20px;cursor:pointer;padding:4px;">&times;</button>
      `;
      document.body.appendChild(banner);
    }
    banner.style.display = 'flex';
  }

  hideInstallBanner() {
    const banner = document.getElementById('installBanner');
    if (banner) banner.style.display = 'none';
  }

  async installApp() {
    if (this.deferredInstallPrompt) {
      this.deferredInstallPrompt.prompt();
      const result = await this.deferredInstallPrompt.userChoice;
      if (result.outcome === 'accepted') {
        this.toast('Instalando PIX Muestreo...', 'success');
      }
      this.deferredInstallPrompt = null;
      this.hideInstallBanner();
    }
  }
}

// Global install prompt reference
let deferredInstallPrompt = null;
let appIsInstalled = false;

// Check if running inside APK (WebViewAssetLoader) or installed as PWA
if (window.location.origin.includes('appassets.androidplatform.net') ||
    window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone) {
  appIsInstalled = true;
}

// Register SW with forced update on every load
if ('serviceWorker' in navigator) {
  const base = location.pathname.replace(/\/[^/]*$/, '/');
  const swPath = base + 'sw.js';
  const swScope = base;
  navigator.serviceWorker.register(swPath, { scope: swScope })
    .then(reg => {
      console.log('SW registered:', reg.scope);
      reg.update();
      reg.addEventListener('updatefound', () => {
        const nw = reg.installing;
        if (nw) nw.addEventListener('statechange', () => {
          if (nw.state === 'activated') location.reload();
        });
      });
    })
    .catch(e => console.log('SW error:', e));
  navigator.serviceWorker.addEventListener('controllerchange', () => location.reload());
}

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredInstallPrompt = e;
  // Show auto-install button if install overlay is visible
  const autoBtn = document.getElementById('autoInstallBtn');
  if (autoBtn) autoBtn.style.display = 'block';
});

window.addEventListener('appinstalled', () => {
  appIsInstalled = true;
  deferredInstallPrompt = null;
  const autoBtn = document.getElementById('autoInstallBtn');
  if (autoBtn) autoBtn.style.display = 'none';
  // Auto-continue to app after install
  showApp();
});

// Init app
const app = new PixApp();
document.addEventListener('DOMContentLoaded', async () => {
  // Init DB first (needed for auth)
  await pixDB.init();
  await pixDB.migrateToV3();

  // Try restore session
  const restored = await pixAuth.init();
  if (!restored) {
    document.getElementById('loginOverlay').style.display = 'flex';
    return;
  }

  // Already authenticated
  if (appIsInstalled) {
    showApp();
  } else {
    const skippedInstall = sessionStorage.getItem('pix_muestreo_skip_install');
    if (skippedInstall) {
      showApp();
    } else {
      showInstallScreen();
    }
  }
});

function showInstallScreen() {
  document.getElementById('loginOverlay').style.display = 'none';
  document.getElementById('installOverlay').style.display = 'flex';
  // If beforeinstallprompt already fired, show the auto button
  if (deferredInstallPrompt) {
    const autoBtn = document.getElementById('autoInstallBtn');
    if (autoBtn) autoBtn.style.display = 'block';
  }
}

function showApp() {
  document.getElementById('loginOverlay').style.display = 'none';
  document.getElementById('installOverlay').style.display = 'none';
  app.init();
  app.applyRolePermissions();

  // Background user sync from API (primary) or Drive (fallback) — non-blocking
  setTimeout(async () => {
    try {
      const result = await pixAuth.syncUsersFromAPI();
      if (result.synced > 0) {
        app.toast(`Usuarios sincronizados (${result.source}): ${result.created || 0} nuevos, ${result.updated || 0} actualizados`, 'info');
      }
    } catch (e) {
      console.warn('[App] Background user sync skipped:', e.message);
    }
  }, 2000);

  // Periodic sync every 60 seconds (keeps credentials fresh)
  setInterval(async () => {
    try { await pixAuth.syncUsersFromAPI(); } catch (_) {}
  }, 60000);
}

function skipInstall() {
  sessionStorage.setItem('pix_muestreo_skip_install', 'true');
  showApp();
}

// Auto-install using beforeinstallprompt
async function pixInstall() {
  if (deferredInstallPrompt) {
    deferredInstallPrompt.prompt();
    const result = await deferredInstallPrompt.userChoice;
    if (result.outcome === 'accepted') {
      const autoBtn = document.getElementById('autoInstallBtn');
      if (autoBtn) autoBtn.textContent = '✓ Instalando...';
    }
    deferredInstallPrompt = null;
  }
}

// Login handler (multi-user)
async function pixAuthLogin() {
  const email = document.getElementById('loginEmail').value;
  const pass = document.getElementById('loginPass').value;

  if (!email || !pass) {
    document.getElementById('loginError').style.display = 'block';
    return;
  }

  const user = await pixAuth.login(email, pass);
  if (user) {
    document.getElementById('loginError').style.display = 'none';
    if (appIsInstalled) {
      showApp();
    } else {
      showInstallScreen();
    }
  } else {
    document.getElementById('loginError').style.display = 'block';
  }
}
