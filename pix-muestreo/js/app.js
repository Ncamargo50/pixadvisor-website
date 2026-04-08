// PIX Muestreo - Main Application

// XSS protection — escape user-supplied strings before innerHTML insertion
function escH(str) {
  if (str == null) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

// Field-friendly modal system — large touch targets, readable in sunlight
const pixModal = {
  // Promise-based input modal (replaces prompt())
  input(title, fields = [{ name: 'value', label: '', placeholder: '', type: 'text' }]) {
    return new Promise(resolve => {
      const id = 'pixModalInput';
      let existing = document.getElementById(id);
      if (existing) existing.remove();

      const fieldsHTML = fields.map(f => `
        <label style="display:block;margin-bottom:12px;">
          <span style="font-size:14px;color:var(--text-muted);display:block;margin-bottom:4px">${escH(f.label)}</span>
          <input name="${escH(f.name)}" type="${f.type || 'text'}" placeholder="${escH(f.placeholder || '')}"
            style="width:100%;padding:14px 16px;font-size:18px;border-radius:12px;border:2px solid rgba(127,214,51,0.3);background:var(--dark-3);color:var(--text);outline:none;box-sizing:border-box"
            ${f.required ? 'required' : ''}>
        </label>`).join('');

      const el = document.createElement('div');
      el.id = id;
      el.className = 'modal-overlay active';
      el.innerHTML = `<div class="modal-sheet" style="padding:24px">
        <h3 style="margin:0 0 16px;font-size:20px;color:var(--text)">${escH(title)}</h3>
        <form id="pixModalForm">${fieldsHTML}
          <div style="display:flex;gap:12px;margin-top:20px">
            <button type="button" class="action-btn secondary" style="flex:1;padding:16px;font-size:16px;border-radius:12px" id="pixModalCancel">Cancelar</button>
            <button type="submit" class="action-btn primary" style="flex:1;padding:16px;font-size:16px;border-radius:12px">Aceptar</button>
          </div>
        </form>
      </div>`;
      document.body.appendChild(el);

      const form = document.getElementById('pixModalForm');
      const firstInput = form.querySelector('input');
      if (firstInput) setTimeout(() => firstInput.focus(), 100);

      document.getElementById('pixModalCancel').onclick = () => { el.remove(); resolve(null); };
      form.onsubmit = (e) => {
        e.preventDefault();
        const result = {};
        fields.forEach(f => { result[f.name] = form.querySelector(`[name="${f.name}"]`).value; });
        el.remove();
        resolve(fields.length === 1 ? result[fields[0].name] : result);
      };
    });
  },

  // Promise-based confirm modal (replaces confirm())
  confirm(title, message, { confirmText = 'Eliminar', confirmColor = 'var(--danger)', cancelText = 'Cancelar' } = {}) {
    return new Promise(resolve => {
      const id = 'pixModalConfirm';
      let existing = document.getElementById(id);
      if (existing) existing.remove();

      const el = document.createElement('div');
      el.id = id;
      el.className = 'modal-overlay active';
      el.innerHTML = `<div class="modal-sheet" style="padding:24px;text-align:center">
        <h3 style="margin:0 0 12px;font-size:20px;color:var(--text)">${escH(title)}</h3>
        <p style="margin:0 0 24px;font-size:16px;color:var(--text-muted)">${escH(message)}</p>
        <div style="display:flex;gap:12px">
          <button class="action-btn secondary" style="flex:1;padding:16px;font-size:16px;border-radius:12px" id="pixConfirmNo">${escH(cancelText)}</button>
          <button class="action-btn" style="flex:1;padding:16px;font-size:16px;border-radius:12px;background:${confirmColor};color:#fff;border:none" id="pixConfirmYes">${escH(confirmText)}</button>
        </div>
      </div>`;
      document.body.appendChild(el);

      document.getElementById('pixConfirmNo').onclick = () => { el.remove(); resolve(false); };
      document.getElementById('pixConfirmYes').onclick = () => { el.remove(); resolve(true); };
    });
  }
};

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

    // Init GPS with optimized real-time tracking
    try {
      gpsNav.startWatch(pos => {
        if (pos) {
          pixMap.updateUserPosition(pos.lat, pos.lng, pos.accuracy);
          this.updateNavPanel();
          this.updateAccuracyDisplay(pos.accuracy);
          this.updateSpeedDisplay();

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

    // Init map when showing map view (debounce to prevent double init)
    if (viewName === 'map') {
      if (this._mapInitTimer) clearTimeout(this._mapInitTimer);
      this._mapInitTimer = setTimeout(() => {
        this._mapInitTimer = null;
        if (!pixMap.map) {
          pixMap.init('map');
          if (this.currentField) {
            this.loadFieldOnMap(this.currentField);
          } else if (gpsNav.currentPosition) {
            pixMap.updateUserPosition(
              gpsNav.currentPosition.lat,
              gpsNav.currentPosition.lng,
              gpsNav.currentPosition.accuracy
            );
            pixMap.map.setView([gpsNav.currentPosition.lat, gpsNav.currentPosition.lng], 15);
          }
        } else {
          pixMap.map.invalidateSize();
          if (this.currentField && pixMap.fieldLayers.length > 0) {
            pixMap.fitBounds();
          }
        }
      }, 100);
    }

    if (viewName === 'sync') this.updateSyncStats();
    if (viewName === 'projects') this.loadProjects();
    if (viewName === 'settings') { this.updateTileCacheStats(); this.loadIbraSettings(); }
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
            <div style="flex:1;min-width:0;">
              <div class="card-title">${escH(proj.name)}</div>
              <div class="card-subtitle">${escH(proj.client)}</div>
            </div>
            <span class="card-badge badge-${badge}">${pct}%</span>
            <button class="icon-btn-delete" onclick="event.stopPropagation();app.deleteProject(${proj.id})" title="Eliminar proyecto">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
            </button>
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

  // ===== MANUAL CREATE PROJECT / FIELD =====
  async showCreateProjectModal() {
    const result = await pixModal.input('Nuevo Proyecto', [
      { name: 'name', label: 'Nombre del proyecto', placeholder: 'Ej: Hacienda San Juan', required: true },
      { name: 'client', label: 'Cliente (opcional)', placeholder: 'Ej: Juan Perez' }
    ]);
    if (!result || !result.name || !result.name.trim()) return;
    this._doCreateProject(result.name.trim(), (result.client || '').trim());
  }

  async _doCreateProject(name, client) {
    try {
      const projectId = await pixDB.add('projects', {
        name,
        client,
        source: 'manual',
        importDate: new Date().toISOString().slice(0, 10)
      });
      this.toast(`Proyecto "${name}" creado`, 'success');
      this.loadProjects();
      // Open it immediately to add fields
      this.openProject(projectId);
    } catch (e) {
      this.toast('Error: ' + e.message, 'error');
    }
  }

  async createField(projectId) {
    const result = await pixModal.input('Nuevo Campo', [
      { name: 'name', label: 'Nombre del campo', placeholder: 'Ej: Lote 5', required: true },
      { name: 'area', label: 'Area en hectareas (opcional)', placeholder: 'Ej: 45.2', type: 'number' }
    ]);
    if (!result || !result.name || !result.name.trim()) return;
    const name = result.name;
    const area = result.area ? parseFloat(result.area) : null;

    try {
      const fieldId = await pixDB.add('fields', {
        projectId,
        name: name.trim(),
        area: (area && !isNaN(area)) ? area : null,
        boundary: null
      });
      this.toast(`Campo "${name.trim()}" creado`, 'success');

      // Refresh the project view
      if (this.currentProject && this.currentProject.id === projectId) {
        this.openProject(projectId);
      }
    } catch (e) {
      this.toast('Error: ' + e.message, 'error');
    }
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
        <div style="flex:1;min-width:0;">
          <div class="card-title">${escH(this.currentProject.name)}</div>
          <div class="card-subtitle">${fields.length} campos</div>
        </div>
        <button class="fab-btn primary" onclick="app.createField(${this.currentProject.id})" style="width:36px;height:36px;" title="Agregar campo">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:18px;height:18px"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        </button>
        <button class="icon-btn-delete" onclick="app.deleteProject(${this.currentProject.id})" title="Eliminar proyecto">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
        </button>
      </div>`;

    for (const field of fields) {
      const points = await pixDB.getAllByIndex('points', 'fieldId', field.id);
      const collected = points.filter(p => p.status === 'collected').length;
      const pct = points.length > 0 ? Math.round(collected / points.length * 100) : 0;

      html += `
        <div class="card" onclick="app.openField(${field.id})">
          <div class="card-header">
            <div style="flex:1;min-width:0;">
              <div class="card-title">${escH(field.name)}</div>
              <div class="card-subtitle">${field.area ? field.area.toFixed(1) + ' ha' : ''}</div>
            </div>
            <span class="card-badge badge-${pct === 100 ? 'complete' : pct > 0 ? 'active' : 'pending'}">${collected}/${points.length}</span>
            <button class="icon-btn-delete" onclick="event.stopPropagation();app.deleteField(${field.id})" title="Eliminar campo">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
            </button>
          </div>
          <div class="progress-bar"><div class="progress-fill" style="width:${pct}%"></div></div>
        </div>`;
    }

    container.innerHTML = html;
  }

  async openField(fieldId) {
    this.currentField = await pixDB.get('fields', fieldId);
    // Show map view FIRST so the map container exists
    this.showView('map');
    // Wait for map to initialize, then load field
    const waitForMap = () => {
      if (pixMap.map) {
        this.loadFieldOnMap(this.currentField);
      } else {
        setTimeout(waitForMap, 150);
      }
    };
    setTimeout(waitForMap, 200);
  }

  async loadFieldOnMap(field) {
    if (!pixMap.map) return;
    pixMap.clearAll();

    // Check if field has zonas metadata (from project JSON import)
    if (field.boundary && field.zonasMetadata && field.zonasMetadata.length > 0) {
      pixMap.addZonasColored(field.boundary, field.zonasMetadata);
    } else if (field.boundary) {
      pixMap.addFieldBoundary(field.boundary, field.name);
    }

    // Load points
    const points = await pixDB.getAllByIndex('points', 'fieldId', field.id);
    if (points.length > 0) {
      const hasTypes = points.some(p => p.tipo || (p.properties && p.properties.tipo));
      if (hasTypes) {
        pixMap.addTypedSamplePoints(points, point => this.onPointClick(point));
      } else {
        pixMap.addSamplePoints(points, point => this.onPointClick(point));
      }
    }

    // Fit bounds with retry — WebView may need extra time to render
    pixMap.fitBounds();
    setTimeout(() => {
      pixMap.map.invalidateSize();
      pixMap.fitBounds();
    }, 500);
    setTimeout(() => pixMap.fitBounds(), 1500);

    // Update header
    const areaStr = field.area ? ` (${field.area.toFixed(1)} ha)` : '';
    document.getElementById('currentFieldName').textContent = field.name + areaStr;
    document.getElementById('navPanel').style.display = 'block';

    // Auto-prefetch tiles for field area (background, non-blocking)
    this._prefetchFieldTiles(field);

    // Auto-start GPS tracking when entering a field
    this._ensureTracking();

    // Auto-navigate to first pending point
    setTimeout(() => this.nextPoint(), 800);
  }

  // Pre-fetch satellite tiles for field area at useful zoom levels
  async _prefetchFieldTiles(field) {
    if (!pixMap.map || !field.boundary) return;
    try {
      const layers = pixMap.fieldLayers;
      if (layers.length === 0) return;
      const group = L.featureGroup(layers);
      const bounds = group.getBounds();
      if (!bounds.isValid()) return;

      const padded = bounds.pad(0.3); // 30% padding around field
      // Only pre-fetch zoom 15-18 (most useful for field navigation)
      const estimate = pixMap.estimateTileCount(padded, 15, 18);
      if (estimate.tileCount > 500) return; // Don't auto-fetch huge areas

      console.log(`[Map] Auto-prefetch: ~${estimate.tileCount} tiles (~${estimate.estimatedSizeMB}MB)`);
      await pixMap.preloadTiles(padded, 15, 18);
    } catch (e) {
      console.warn('[Map] Tile prefetch skipped:', e.message);
    }
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

    // Show speed while navigating
    const speedEl = document.getElementById('navSpeed');
    if (speedEl) {
      if (gpsNav.isMoving) {
        speedEl.textContent = `${gpsNav.getSpeedKmh()} km/h`;
        speedEl.style.display = '';
      } else {
        speedEl.textContent = 'Parado';
        speedEl.style.display = '';
      }
    }

    // Auto-alert when arriving at point (vibration + beep + toast)
    if (dist < 10 && this.isNavigating && !this._arrivedNotified) {
      this._arrivedNotified = true;
      // Strong vibration pattern
      if (navigator.vibrate) navigator.vibrate([300, 100, 300, 100, 300]);
      // Audible beep using Web Audio API
      this._playArrivalBeep();
      this.toast('Llegaste al punto!', 'success');
      // Reset flag when navigating to next point
      setTimeout(() => { this._arrivedNotified = false; }, 5000);
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

    // Detect if this is a principal or submuestra
    const isSubmuestra = this._detectPointType(this.currentPoint) === 'submuestra';
    const zona = this._detectZone(this.currentPoint);

    document.getElementById('collectPointName').textContent = isSubmuestra
      ? `Submuestra ${this.currentPoint.name} (Zona ${zona})`
      : `Punto Principal ${this.currentPoint.name} (Zona ${zona})`;
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

    // SIMPLE vs COMPLETE form: hide fields for submuestras
    const qrGroup = document.getElementById('barcodeDisplay')?.closest('.form-group');
    const typeGroup = document.getElementById('sampleType')?.closest('.form-group');
    const photoGroup = document.getElementById('photoPreviewImg')?.closest('.form-group');
    const collectorGroup = document.getElementById('collectorField')?.closest('.form-group');
    const saveBtn = document.querySelector('#collectModal .sync-btn');

    if (isSubmuestra) {
      // SIMPLE form: hide QR, type, photo, collector
      if (qrGroup) qrGroup.style.display = 'none';
      if (typeGroup) typeGroup.style.display = 'none';
      if (photoGroup) photoGroup.style.display = 'none';
      if (collectorGroup) collectorGroup.style.display = 'none';
      if (saveBtn) saveBtn.textContent = 'Confirmar submuestra';
    } else {
      // COMPLETE form: show everything
      if (qrGroup) qrGroup.style.display = '';
      if (typeGroup) typeGroup.style.display = '';
      if (photoGroup) photoGroup.style.display = '';
      if (collectorGroup) collectorGroup.style.display = '';
      if (saveBtn) saveBtn.textContent = 'Guardar Muestra';
    }

    // Set default collector
    const collector = await pixDB.getSetting('collectorName');
    if (collector) document.getElementById('collectorField').value = collector;

    // Auto-adjust depth
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
    // Block save button during GPS averaging to prevent duplicates
    const saveBtn = document.querySelector('#collectModal .sync-btn');
    if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Guardando...'; }

    const isSubmuestra = this._detectPointType(this.currentPoint) === 'submuestra';
    const depth = this.collectForm.depth || document.querySelector('.depth-chip.active')?.dataset.depth || '0-20';
    const sampleType = document.getElementById('sampleType').value;
    const collector = document.getElementById('collectorField').value || await pixDB.getSetting('collectorName') || '';
    const notes = document.getElementById('sampleNotes').value;

    // Validations only for principal points (subs inherit from principal)
    if (!isSubmuestra) {
      if (!sampleType || sampleType === '' || sampleType === 'none') {
        this.toast('Seleccioná el tipo de análisis', 'warning');
        return;
      }
      if (!collector || collector.trim() === '') {
        this.toast('Ingresá el nombre del colector', 'warning');
        document.getElementById('collectorField').focus();
        return;
      }
      // Save collector name for subs to inherit
      await pixDB.setSetting('collectorName', collector.trim());
      // Save sampleType for subs to inherit
      await pixDB.setSetting('lastSampleType', sampleType);
    }

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

    // For submuestras: inherit sampleType and collector from last principal
    const effectiveType = isSubmuestra ? (await pixDB.getSetting('lastSampleType') || sampleType) : sampleType;
    const effectiveCollector = isSubmuestra ? (await pixDB.getSetting('collectorName') || collector) : collector;

    const sample = {
      pointId: this.currentPoint.id,
      fieldId: this.currentField.id,
      pointName: this.currentPoint.name,
      pointType: isSubmuestra ? 'submuestra' : 'principal',
      zona: this._detectZone(this.currentPoint),
      lat: gpsLat,
      lng: gpsLng,
      accuracy: gpsAcc,
      gpsMethod: gpsMethod,
      depth: depth,
      sampleType: effectiveType,
      barcode: this.collectForm.barcode,
      ibraSampleId: ibraData?.sampleId || null,
      ibraLabOrder: ibraData?.labOrder || null,
      ibraSource: ibraData?.source || null,
      ibraRaw: ibraData?.raw || null,
      collector: effectiveCollector,
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
      if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Guardar Muestra'; }
      return;
    }

    // Haptic feedback — confirms save in noisy field environments
    if (navigator.vibrate) navigator.vibrate([100, 50, 100]);

    this.closeCollectForm();
    this.toast(`${isSubmuestra ? 'Submuestra' : 'Muestra'} guardada: ${escH(this.currentPoint.name)}`, 'success');

    // Check if current zone is complete → show QR modal
    const currentZone = this._detectZone(this.currentPoint);
    const zoneComplete = await this._checkZoneComplete(currentZone);

    if (zoneComplete) {
      // Zone done! Show QR IBRA modal
      this._openZoneCompleteModal(currentZone);
    } else {
      // Navigate to next point in same zone (principal first, then subs in order)
      this.nextPoint();
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
          <div class="file-list-item" data-fid="${escH(f.id)}" data-fname="${escH(f.name)}" onclick="app.importFile(this.dataset.fid, this.dataset.fname)">
            <div class="file-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6"/></svg>
            </div>
            <div class="file-info">
              <div class="file-name">${escH(f.name)}</div>
              <div class="file-meta">${ext} · ${new Date(f.modifiedTime).toLocaleDateString()}</div>
            </div>
          </div>`;
      }
      document.getElementById('importFileList').innerHTML = html;
    } catch (e) {
      document.getElementById('importFileList').innerHTML = `<p style="color:var(--danger);text-align:center">${escH(e.message)}</p>`;
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
            // Auto-open first field on map
            await this._autoOpenFirstField();
            return;
          }
          // Not a project JSON, fall through to GeoJSON processing
          await this.processGeoJSON(parsed, file.name);
          this.loadProjects();
          this.toast('Importado: ' + file.name, 'success');
          await this._autoOpenFirstField();
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
        await this._autoOpenFirstField();
      } catch (err) {
        this.toast('Error al importar: ' + err.message, 'error');
      }
    };
    input.click();
  }

  // ===== RECEIVE FILE FROM ANDROID INTENT (WhatsApp, file manager, etc.) =====
  // Called by native Android via evaluateJavascript when user opens a .json/.geojson
  // from WhatsApp, email, file manager, or any app that shares files.
  async receiveFileFromIntent(filename, content) {
    console.log('[App] receiveFileFromIntent:', filename, '(' + content.length + ' chars)');
    this.toast('Abriendo mapa: ' + filename + '...', '');

    try {
      const parsed = JSON.parse(content);

      // Check if this is a PIX project JSON (has project + lotes structure)
      if (parsed.project && parsed.lotes && Array.isArray(parsed.lotes)) {
        await this.importProjectJSON(parsed);
        this.loadProjects();
        this.toast(`Proyecto importado: ${parsed.project.name} (${parsed.lotes.length} lotes)`, 'success');
        this.showView('map');
        await this._autoOpenFirstField();
        return;
      }

      // Check if it's a PIX backup JSON (has app + projects + fields + points)
      if (parsed.app === 'PIX Muestreo' && parsed.projects) {
        await this._restoreBackup(parsed);
        this.loadProjects();
        this.toast('Backup restaurado: ' + (parsed.projects.length || 0) + ' proyectos', 'success');
        this.showView('map');
        await this._autoOpenFirstField();
        return;
      }

      // Standard GeoJSON (FeatureCollection, Feature, or geometry)
      if (parsed.type === 'FeatureCollection' || parsed.type === 'Feature'
          || parsed.type === 'Polygon' || parsed.type === 'MultiPolygon' || parsed.type === 'Point') {
        await this.processGeoJSON(parsed, filename);
        this.loadProjects();
        this.toast('Mapa importado: ' + filename, 'success');
        this.showView('map');
        await this._autoOpenFirstField();
        return;
      }

      // Unknown JSON structure
      this.toast('Archivo JSON no reconocido. Use GeoJSON o proyecto PIX.', 'error');

    } catch (err) {
      console.error('[App] receiveFileFromIntent error:', err);
      this.toast('Error al abrir archivo: ' + err.message, 'error');
    }
  }

  // Restore a full PIX Muestreo backup (from exportLocalBackup)
  async _restoreBackup(data) {
    // Import projects
    if (data.projects) {
      for (const p of data.projects) {
        const existing = await pixDB.get('projects', p.id);
        if (!existing) await pixDB.add('projects', p);
      }
    }
    // Import fields
    if (data.fields) {
      for (const f of data.fields) {
        const existing = await pixDB.get('fields', f.id);
        if (!existing) await pixDB.add('fields', f);
      }
    }
    // Import points
    if (data.points) {
      for (const pt of data.points) {
        const existing = await pixDB.get('points', pt.id);
        if (!existing) await pixDB.add('points', pt);
      }
    }
    // Import samples
    if (data.samples) {
      for (const s of data.samples) {
        const existing = await pixDB.get('samples', s.id);
        if (!existing) await pixDB.add('samples', s);
      }
    }
    // Import tracks
    if (data.tracks) {
      for (const t of data.tracks) {
        const existing = await pixDB.get('tracks', t.id);
        if (!existing) await pixDB.add('tracks', t);
      }
    }
  }

  // After import: auto-open the most recent field on the map
  async _autoOpenFirstField() {
    try {
      const projects = await pixDB.getAll('projects');
      if (projects.length === 0) return;
      // Get latest project (highest id)
      const latest = projects.reduce((a, b) => (a.id > b.id ? a : b));
      const fields = await pixDB.getAllByIndex('fields', 'projectId', latest.id);
      if (fields.length > 0) {
        this.currentProject = latest;
        await this.openField(fields[0].id);
      }
    } catch (e) {
      console.warn('[App] Auto-open field failed:', e.message);
    }
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

    // Normalize bare geometries into FeatureCollection
    if (geojson.type === 'Polygon' || geojson.type === 'MultiPolygon' || geojson.type === 'Point' || geojson.type === 'LineString') {
      geojson = { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: geojson, properties: {} }] };
    } else if (geojson.type === 'Feature') {
      geojson = { type: 'FeatureCollection', features: [geojson] };
    } else if (geojson.type === 'GeometryCollection' && geojson.geometries) {
      geojson = { type: 'FeatureCollection', features: geojson.geometries.map(g => ({ type: 'Feature', geometry: g, properties: {} })) };
    }

    // Duplicate detection — check if project with same name+source already exists
    const existingProjects = await pixDB.getAll('projects');
    const duplicate = existingProjects.find(p => p.name === projectName && p.source === sourceName);
    if (duplicate) {
      const replace = await pixModal.confirm('Proyecto duplicado',
        `"${projectName}" ya existe. ¿Desea reemplazarlo?`,
        { confirmText: 'Reemplazar', confirmColor: '#FF9800' });
      if (!replace) return;
      // Delete old project before re-importing
      await this.deleteProjectSilent(duplicate.id);
    }

    // Create project
    const projectId = await pixDB.add('projects', {
      name: projectName,
      client: '',
      source: sourceName
    });

    // Separate polygons (fields) and points
    const polygons = [];
    const points = [];

    const features = geojson.features || [];

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
    const data = {
      app: 'PIX Muestreo',
      exportDate: new Date().toISOString(),
      projects: await pixDB.getAll('projects'),
      fields: await pixDB.getAll('fields'),
      points: await pixDB.getAll('points'),
      // Clone samples to avoid mutating live IndexedDB references
      samples: (await pixDB.getAll('samples')).map(s => ({...s, photo: s.photo ? '(foto omitida)' : null})),
      tracks: await pixDB.getAll('tracks'),
      serviceOrders: await pixDB.getAll('serviceOrders')
      // Users excluded from backup for security (emails, credentials)
    };

    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `pix_muestreo_backup_${new Date().toISOString().slice(0,10)}.json`;
    a.click();
    URL.revokeObjectURL(url);

    this.toast('Backup descargado', 'success');
  }

  // ===== IBRA SETTINGS =====
  async saveIbraSetting(key, value) {
    await pixDB.setSetting('ibra_' + key, value);
  }

  async loadIbraSettings() {
    const defaults = {
      solicitante: 'PIXADVISOR AGRICULTURA DE PRECISAO',
      responsavel: 'NILTON LUIZ CAMARGO',
      telefone: '43 999819554',
      cnpj: '41.196.481/0001-30',
      endereco: 'RUA ELIEZER MARTINS BANDEIRA 44',
      municipio: 'IBIPORA',
      uf: 'PR',
      cep: '86200536',
      email: 'nilton.camargo@pixadvisor.network, gis.agronomico@gmail.com'
    };
    const ibra = {};
    for (const [k, def] of Object.entries(defaults)) {
      ibra[k] = (await pixDB.getSetting('ibra_' + k)) || def;
      const el = document.getElementById('ibra' + k.charAt(0).toUpperCase() + k.slice(1));
      if (el) el.value = ibra[k];
    }
    return ibra;
  }

  // ===== FIELD REPORT — FICHA DE ENVIO IBRA =====
  async generateFieldReport() {
    if (!this.currentField && !this.currentProject) {
      this.toast('Abrí un proyecto primero', 'warning');
      return;
    }

    // Load all data
    const ibra = await this.loadIbraSettings();
    const project = this.currentProject || (await pixDB.getAll('projects'))[0];
    if (!project) { this.toast('Sin proyecto para reportar', 'warning'); return; }

    const fields = await pixDB.getAllByIndex('fields', 'projectId', project.id);
    const allSamples = await pixDB.getAll('samples');
    const collector = await pixDB.getSetting('collectorName') || '';
    const today = new Date().toISOString().slice(0, 10);

    // Build zones data for each field
    let zonesHTML = '';
    let detailHTML = '';
    let totalMuestras = 0;
    let totalPuntos = 0;

    for (const field of fields) {
      const points = await pixDB.getAllByIndex('points', 'fieldId', field.id);
      const fieldSamples = allSamples.filter(s => s.fieldId === field.id);

      // Group by zone
      const zones = {};
      for (const p of points) {
        const z = this._detectZone(p);
        if (!zones[z]) zones[z] = { principal: null, subs: [], samples: [] };
        if (this._detectPointType(p) === 'principal') zones[z].principal = p;
        else zones[z].subs.push(p);
      }

      // Match samples to zones
      for (const s of fieldSamples) {
        const z = s.zona || 1;
        if (zones[z]) zones[z].samples.push(s);
      }

      const sortedZones = Object.keys(zones).sort((a, b) => a - b);

      // Summary table
      zonesHTML += `
        <tr style="background:#e8f5e9"><td colspan="7" style="font-weight:700;padding:8px">
          ${escH(field.name)} — ${field.area ? field.area.toFixed(1) + ' ha' : ''}
        </td></tr>`;

      for (const zk of sortedZones) {
        const z = zones[zk];
        const clase = z.principal?.properties?.clase || field.zonasMetadata?.[zk - 1]?.clase || '';
        const qr = z.samples.find(s => s.zoneBarcode)?.zoneIbraSampleId || z.samples.find(s => s.zoneBarcode)?.zoneBarcode || '—';
        const depth = z.samples[0]?.depth || '0-20';
        const tipo = z.samples[0]?.sampleType || '—';
        const nPts = 1 + z.subs.length;
        totalMuestras++;
        totalPuntos += nPts;

        zonesHTML += `
          <tr>
            <td style="text-align:center;font-weight:600">${zk}</td>
            <td style="font-family:monospace;font-size:11px">${qr}</td>
            <td style="text-align:center"><span style="padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600;color:#fff;background:${clase==='Alta'?'#4CAF50':clase==='Media'?'#FFC107':clase==='Baja'?'#F44336':'#607D8B'}">${clase || '—'}</span></td>
            <td style="text-align:center">${nPts}</td>
            <td style="text-align:center">${depth} cm</td>
            <td>${tipo}</td>
            <td style="text-align:center">${z.samples.length > 0 ? 'OK' : 'Pendiente'}</td>
          </tr>`;

        // Detail table
        detailHTML += `
          <div style="margin-bottom:20px">
            <h3 style="margin:0 0 6px;font-size:14px;color:#333;border-bottom:2px solid ${clase==='Alta'?'#4CAF50':clase==='Media'?'#FFC107':'#F44336'}; padding-bottom:4px">
              ${escH(field.name)} — Zona ${zk} (${escH(clase)}) — QR: ${escH(qr)}
            </h3>
            <table style="width:100%;border-collapse:collapse;font-size:11px">
              <tr style="background:#f5f5f5">
                <th style="padding:4px 6px;text-align:left;border:1px solid #ddd">Punto</th>
                <th style="padding:4px 6px;text-align:left;border:1px solid #ddd">Tipo</th>
                <th style="padding:4px 6px;text-align:right;border:1px solid #ddd">Latitud</th>
                <th style="padding:4px 6px;text-align:right;border:1px solid #ddd">Longitud</th>
                <th style="padding:4px 6px;text-align:center;border:1px solid #ddd">Prof.</th>
                <th style="padding:4px 6px;text-align:center;border:1px solid #ddd">Precision</th>
                <th style="padding:4px 6px;text-align:center;border:1px solid #ddd">Hora</th>
              </tr>`;

        // Principal first, then subs sorted
        const allZonePoints = [z.principal, ...z.subs.sort((a, b) => this._getSubOrder(a) - this._getSubOrder(b))].filter(Boolean);
        for (const p of allZonePoints) {
          const s = fieldSamples.find(s => s.pointId === p.id);
          const isPrin = this._detectPointType(p) === 'principal';
          const hora = s?.collectedAt ? new Date(s.collectedAt).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' }) : '—';
          const acc = s?.accuracy ? s.accuracy.toFixed(1) + 'm' : '—';
          const lat = s?.lat || p.lat;
          const lng = s?.lng || p.lng;

          detailHTML += `
              <tr style="${isPrin ? 'background:#fff3e0;font-weight:600' : ''}">
                <td style="padding:3px 6px;border:1px solid #ddd">${p.name || p.id}</td>
                <td style="padding:3px 6px;border:1px solid #ddd">${isPrin ? 'Principal' : 'Sub'}</td>
                <td style="padding:3px 6px;border:1px solid #ddd;text-align:right;font-family:monospace">${lat.toFixed(6)}</td>
                <td style="padding:3px 6px;border:1px solid #ddd;text-align:right;font-family:monospace">${lng.toFixed(6)}</td>
                <td style="padding:3px 6px;border:1px solid #ddd;text-align:center">${s?.depth || '0-20'}</td>
                <td style="padding:3px 6px;border:1px solid #ddd;text-align:center">${acc}</td>
                <td style="padding:3px 6px;border:1px solid #ddd;text-align:center">${hora}</td>
              </tr>`;
        }
        detailHTML += '</table></div>';
      }
    }

    // Build full HTML report
    const html = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<title>Reporte de Campo — ${project.name}</title>
<style>
  @page { size: A4; margin: 15mm; }
  body { font-family: Arial, Helvetica, sans-serif; font-size: 13px; color: #333; margin: 0; padding: 20px; }
  .header { display: flex; justify-content: space-between; align-items: center; border-bottom: 3px solid #4CAF50; padding-bottom: 12px; margin-bottom: 16px; }
  .header h1 { font-size: 18px; margin: 0; color: #2E7D32; }
  .header .logo { font-size: 22px; font-weight: 800; color: #F44336; }
  .section { margin-bottom: 16px; }
  .section-title { font-size: 13px; font-weight: 700; color: #fff; background: #4CAF50; padding: 6px 12px; margin-bottom: 0; }
  .section-title.ibra { background: #F44336; }
  .info-grid { display: grid; grid-template-columns: 140px 1fr; gap: 0; border: 1px solid #ddd; }
  .info-grid .label { background: #f5f5f5; padding: 5px 10px; font-weight: 600; font-size: 11px; border-bottom: 1px solid #ddd; border-right: 1px solid #ddd; }
  .info-grid .value { padding: 5px 10px; font-size: 12px; border-bottom: 1px solid #ddd; }
  table { width: 100%; border-collapse: collapse; }
  th { background: #e8f5e9; padding: 6px 8px; text-align: left; font-size: 11px; border: 1px solid #ddd; }
  td { padding: 5px 8px; border: 1px solid #ddd; font-size: 12px; }
  .page-break { page-break-before: always; }
  .footer { margin-top: 24px; text-align: center; font-size: 10px; color: #999; border-top: 1px solid #eee; padding-top: 8px; }
  @media print { .no-print { display: none; } body { padding: 0; } }
</style>
</head>
<body>

<!-- PRINT BUTTON -->
<div class="no-print" style="text-align:center;margin-bottom:16px">
  <button onclick="window.print()" style="padding:12px 32px;background:#4CAF50;color:#fff;border:none;border-radius:8px;font-size:15px;font-weight:600;cursor:pointer">
    Imprimir / Guardar como PDF
  </button>
</div>

<!-- PAGE 1: FICHA DE ENVIO -->
<div class="header">
  <div>
    <div class="logo">IBRA <span style="font-size:11px;color:#666;font-weight:400">megalab</span></div>
    <div style="font-size:10px;color:#888">FICHA PARA ENVIO DE AMOSTRAS</div>
  </div>
  <div style="text-align:right">
    <h1>PIX Muestreo</h1>
    <div style="font-size:10px;color:#888">Pixadvisor Agricultura de Precision</div>
  </div>
</div>

<div class="section">
  <div class="section-title ibra">1. SOLICITANTE (Cadastro IBRA)</div>
  <div class="info-grid">
    <div class="label">Solicitante</div><div class="value">${ibra.solicitante}</div>
    <div class="label">Responsavel</div><div class="value">${ibra.responsavel}</div>
    <div class="label">Telefone</div><div class="value">${ibra.telefone}</div>
    <div class="label">CPF/CNPJ</div><div class="value">${ibra.cnpj}</div>
    <div class="label">Endereco</div><div class="value">${ibra.endereco}</div>
    <div class="label">Municipio/UF</div><div class="value">${ibra.municipio} - ${ibra.uf} | CEP: ${ibra.cep}</div>
    <div class="label">E-mail laudos</div><div class="value">${ibra.email}</div>
  </div>
</div>

<div class="section">
  <div class="section-title">2. CLIENTE / PROPRIEDADE</div>
  <div class="info-grid">
    <div class="label">Cliente</div><div class="value" style="font-weight:700;font-size:14px">${project.client || '—'}</div>
    <div class="label">Hacienda</div><div class="value" style="font-weight:700;font-size:14px">${project.name}</div>
    <div class="label">Campo/Lote</div><div class="value">${fields.map(f => f.name + (f.area ? ' (' + f.area.toFixed(1) + ' ha)' : '')).join(', ')}</div>
    <div class="label">Fecha colecta</div><div class="value">${today}</div>
    <div class="label">Tecnico</div><div class="value">${collector}</div>
    <div class="label">Total puntos GPS</div><div class="value">${totalPuntos} puntos georreferenciados</div>
  </div>
</div>

<div class="section">
  <div class="section-title">3. AMOSTRAS POR ZONA DE MANEJO</div>
  <table>
    <tr>
      <th style="text-align:center;width:40px">Zona</th>
      <th>QR IBRA</th>
      <th style="text-align:center;width:70px">Clase</th>
      <th style="text-align:center;width:50px">Puntos</th>
      <th style="text-align:center;width:70px">Prof.</th>
      <th>Analisis</th>
      <th style="text-align:center;width:60px">Estado</th>
    </tr>
    ${zonesHTML}
  </table>
  <div style="margin-top:8px;font-size:11px;color:#666">
    <strong>Total:</strong> ${totalMuestras} muestras compuestas | ${totalPuntos} puntos GPS | ${fields.length} campo(s)
  </div>
</div>

<div style="margin-top:16px;padding:10px;background:#FFF3E0;border:1px solid #FFB74D;border-radius:6px;font-size:11px">
  <strong>Obs:</strong> Cada muestra compuesta es la mezcla de 1 punto principal + submuestras de la misma zona de manejo.
  Los codigos QR de las bolsas IBRA vinculan los datos de campo con los resultados de laboratorio.
</div>

<!-- PAGE 2: DETALLE -->
<div class="page-break"></div>
<div class="header">
  <div><h1 style="font-size:16px;color:#333">Detalle de Puntos por Zona</h1></div>
  <div style="text-align:right;font-size:11px;color:#888">${project.name} — ${today}</div>
</div>

${detailHTML}

<div class="footer">
  Generado por PIX Muestreo v3.4.3 — Pixadvisor Agricultura de Precision — pixadvisor.network — ${new Date().toLocaleString('es')}
</div>

</body></html>`;

    // Open in new window for print
    const win = window.open('', '_blank', 'width=800,height=1000');
    if (win) {
      win.document.write(html);
      win.document.close();
      this.toast('Reporte generado — usá Imprimir para PDF', 'success');
    } else {
      // Fallback: download as HTML
      const blob = new Blob([html], { type: 'text/html' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `reporte_ibra_${project.name.replace(/\s/g, '_')}_${today}.html`;
      a.click();
      URL.revokeObjectURL(url);
      this.toast('Reporte descargado como HTML', 'success');
    }
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
      this.toast('Espera señal GPS antes de iniciar', 'warning');
      return;
    }

    // If no field selected, auto-create one for boundary tracing
    if (!this.currentField) {
      const fieldName = await pixModal.input('Nombre del campo a georreferenciar', [
        { name: 'value', label: 'Nombre', placeholder: 'Ej: Lote Norte', required: true }
      ]);
      if (!fieldName || !fieldName.trim()) return;
      try {
        // Create or reuse project
        let projectId;
        if (this.currentProject) {
          projectId = this.currentProject.id;
        } else {
          projectId = await pixDB.add('projects', {
            name: fieldName.trim(),
            client: '',
            source: 'gps-boundary',
            importDate: new Date().toISOString().slice(0, 10)
          });
          this.currentProject = await pixDB.get('projects', projectId);
        }
        // Create field
        const fieldId = await pixDB.add('fields', {
          projectId,
          name: fieldName.trim(),
          area: null,
          boundary: null
        });
        this.currentField = await pixDB.get('fields', fieldId);
        document.getElementById('currentFieldName').textContent = fieldName.trim();
        document.getElementById('navPanel').style.display = 'block';
        this.toast(`Campo "${fieldName.trim()}" creado`, 'success');
      } catch (e) {
        this.toast('Error al crear campo: ' + e.message, 'error');
        return;
      }
    }

    this._boundaryTracing = true;
    this._boundaryPositions = [];
    this._boundaryPolyline = null;
    this._boundaryPolygonPreview = null;

    // Enable map follow
    pixMap.enableFollow();

    // Start GPS tracking
    gpsNav.startTracking();

    // Record positions at regular intervals (every 2 seconds for better resolution)
    this._boundaryNoSignalTicks = 0;
    this._boundaryInterval = setInterval(() => {
      if (!gpsNav.currentPosition) {
        this._boundaryNoSignalTicks++;
        if (this._boundaryNoSignalTicks >= 5) {
          this.toast('Sin senal GPS — espera o acercate a cielo abierto', 'warning');
          this._boundaryNoSignalTicks = 0;
        }
        return;
      }

      const pos = gpsNav.currentPosition;
      // Warn if accuracy is poor but don't silently skip
      if (pos.accuracy > 20) {
        this._boundaryNoSignalTicks++;
        if (this._boundaryNoSignalTicks >= 5) {
          this.toast(`GPS impreciso (${pos.accuracy.toFixed(0)}m) — sin grabar puntos`, 'warning');
          this._boundaryNoSignalTicks = 0;
        }
        return;
      }
      this._boundaryNoSignalTicks = 0;

      const last = this._boundaryPositions[this._boundaryPositions.length - 1];
      if (last) {
        const dist = gpsNav.distanceTo(pos.lat, pos.lng, last.lat, last.lng);
        if (dist < 2) return; // didn't move enough
      }

      this._boundaryPositions.push({ lat: pos.lat, lng: pos.lng, accuracy: pos.accuracy });

      // Draw CLOSED polygon preview on map (not just polyline)
      this._updateBoundaryPreview();

      // Update stop bar counter
      const countEl = document.getElementById('boundaryPtCount');
      if (countEl) countEl.textContent = this._boundaryPositions.length;
    }, 2000);

    // Show prominent stop bar at bottom of map
    this._showBoundaryStopBar();

    // Highlight the boundary button
    const btn = document.getElementById('boundaryBtn');
    if (btn) btn.classList.add('active');

    this.toast('Camina alrededor del lote. El area se dibuja en tiempo real.', 'success');
  }

  // Update the closed polygon preview while tracing
  _updateBoundaryPreview() {
    if (!pixMap.map) return;
    const positions = this._boundaryPositions;
    if (positions.length < 2) return;

    // Remove old layers
    if (this._boundaryPolyline) pixMap.map.removeLayer(this._boundaryPolyline);
    if (this._boundaryPolygonPreview) pixMap.map.removeLayer(this._boundaryPolygonPreview);

    const latlngs = positions.map(p => [p.lat, p.lng]);

    // Draw walked path (solid green line)
    this._boundaryPolyline = L.polyline(latlngs, {
      color: '#7FD633', weight: 3, opacity: 0.9
    }).addTo(pixMap.map);

    // Draw closing line + polygon fill (dashed line from last to first point)
    if (positions.length >= 3) {
      this._boundaryPolygonPreview = L.polygon(latlngs, {
        color: '#7FD633', weight: 2, dashArray: '6,6', opacity: 0.5,
        fillColor: '#7FD633', fillOpacity: 0.08
      }).addTo(pixMap.map);
    }
  }

  // Show a prominent bar at bottom of map during boundary tracing
  _showBoundaryStopBar() {
    // Remove if already exists
    const existing = document.getElementById('boundaryStopBar');
    if (existing) existing.remove();

    const bar = document.createElement('div');
    bar.id = 'boundaryStopBar';
    bar.style.cssText = 'position:fixed;bottom:60px;left:0;right:0;z-index:9999;padding:12px 16px;background:linear-gradient(135deg,rgba(127,214,51,0.95),rgba(13,148,136,0.95));display:flex;align-items:center;justify-content:space-between;gap:12px;backdrop-filter:blur(8px);box-shadow:0 -4px 20px rgba(0,0,0,0.4);';
    bar.innerHTML = `
      <div style="color:white">
        <div style="font-size:14px;font-weight:700">Trazando perimetro GPS</div>
        <div style="font-size:12px;opacity:0.85"><span id="boundaryPtCount">${this._boundaryPositions.length}</span> puntos registrados</div>
      </div>
      <button onclick="app.stopBoundaryTrace()" style="padding:10px 20px;border-radius:10px;border:2px solid white;background:rgba(255,255,255,0.15);color:white;font-size:14px;font-weight:700;cursor:pointer;white-space:nowrap">
        CERRAR Y GUARDAR
      </button>
    `;
    document.body.appendChild(bar);
  }

  // Stop boundary tracing and save as field boundary GeoJSON
  async stopBoundaryTrace() {
    if (!this._boundaryTracing) return;

    clearInterval(this._boundaryInterval);
    this._boundaryTracing = false;
    gpsNav.stopTracking();

    const positions = this._boundaryPositions || [];
    if (positions.length < 4) {
      this.toast('Necesitas al menos 4 puntos para cerrar un area. Camina mas.', 'warning');
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
      try {
        this.currentField.boundary = geojson;
        this.currentField.area = Math.round(area * 100) / 100;
        await pixDB.put('fields', this.currentField);

        // Reload field on map
        this.loadFieldOnMap(this.currentField);
        this.toast(`Area guardada: ${positions.length} puntos, ${area.toFixed(2)} ha`, 'success');
        if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
      } catch (err) {
        console.error('[Boundary] Save error:', err);
        this.toast('Error al guardar el area: ' + err.message, 'error');
      }
    } else {
      this.toast('Error: no hay campo seleccionado. El area no se guardo.', 'error');
    }

    this._cleanupBoundaryTrace();
  }

  _cleanupBoundaryTrace() {
    if (this._boundaryPolyline && pixMap.map) {
      pixMap.map.removeLayer(this._boundaryPolyline);
    }
    if (this._boundaryPolygonPreview && pixMap.map) {
      pixMap.map.removeLayer(this._boundaryPolygonPreview);
    }
    this._boundaryPositions = [];
    this._boundaryPolyline = null;
    this._boundaryPolygonPreview = null;

    // Remove stop bar
    const bar = document.getElementById('boundaryStopBar');
    if (bar) bar.remove();

    // Restore boundary button
    const btn = document.getElementById('boundaryBtn');
    if (btn) {
      btn.classList.remove('active');
      btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="3,6 9,3 15,6 21,3 21,18 15,21 9,18 3,21"/></svg>';
    }
  }

  // ===== ZONE COMPLETION WORKFLOW =====

  // Check if all points in a zone are collected
  async _checkZoneComplete(zona) {
    const points = await pixDB.getAllByIndex('points', 'fieldId', this.currentField.id);
    const zonePoints = points.filter(p => this._detectZone(p) == zona);
    return zonePoints.length > 0 && zonePoints.every(p => p.status === 'collected');
  }

  // Show zone complete modal with QR IBRA scan
  async _openZoneCompleteModal(zona) {
    const points = await pixDB.getAllByIndex('points', 'fieldId', this.currentField.id);
    const zonePoints = points.filter(p => this._detectZone(p) == zona);
    const subs = zonePoints.filter(p => this._detectPointType(p) === 'submuestra');
    const principal = zonePoints.find(p => this._detectPointType(p) === 'principal');

    // Get zone metadata for class name
    const clase = principal?.properties?.clase || this.currentField?.zonasMetadata?.[zona - 1]?.clase || '';
    const colorMap = { 'Alta': '#4CAF50', 'Media': '#FFEB3B', 'Baja': '#F44336' };
    const color = colorMap[clase] || '#00BFA5';

    // Update modal content
    const badge = document.getElementById('zoneCompleteBadge');
    badge.textContent = `Zona ${zona} (${clase || 'Completa'})`;
    badge.style.background = color;
    badge.style.color = clase === 'Media' ? '#333' : '#fff';

    document.getElementById('zoneCompleteTitle').textContent = `Zona ${zona} completa!`;
    document.getElementById('zoneCompleteSubtitle').textContent =
      `${subs.length} submuestras + 1 principal recolectadas`;

    // Reset QR display
    document.getElementById('zoneBarcodeValue').textContent = 'Sin escanear';
    const detailsEl = document.getElementById('zoneIbraDetails');
    if (detailsEl) detailsEl.style.display = 'none';
    this._zoneCompleteData = { zona, zonePoints };

    // Check if all zones are done
    const allPoints = await pixDB.getAllByIndex('points', 'fieldId', this.currentField.id);
    const allDone = allPoints.every(p => p.status === 'collected');
    const nextBtn = document.querySelector('#zoneCompleteModal .sync-btn');
    if (allDone && nextBtn) {
      nextBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:18px;height:18px"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><path d="M22 4L12 14.01l-3-3"/></svg> Campo Completo!';
    }

    gpsNav.clearTarget();
    pixMap.clearNavigationLine();
    this.isNavigating = false;

    document.getElementById('zoneCompleteModal').classList.add('active');
    if (navigator.vibrate) navigator.vibrate([200, 100, 200, 100, 200]);
  }

  // Scan QR IBRA for zone bag
  async scanZoneBarcode() {
    document.getElementById('scannerOverlay').classList.add('active');
    try {
      await barcodeScanner.init('scannerViewfinder', async (code) => {
        const parsed = BarcodeScanner.parseIBRA(code);
        const display = document.getElementById('zoneBarcodeValue');
        const details = document.getElementById('zoneIbraDetails');

        if (parsed.isIBRA && parsed.sampleId) {
          display.innerHTML = `<span class="ibra-badge">IBRA</span> ${parsed.sampleId}`;
          if (details) {
            details.textContent = BarcodeScanner.formatIBRADisplay(parsed);
            details.style.display = 'block';
          }
        } else {
          display.textContent = code;
          if (details) details.style.display = 'none';
        }

        // Associate QR with all samples in this zone
        if (this._zoneCompleteData) {
          const { zona, zonePoints } = this._zoneCompleteData;
          const samples = await pixDB.getAll('samples');
          const zoneSamples = samples.filter(s =>
            s.fieldId === this.currentField.id && this._zonePointIds(zonePoints).includes(s.pointId)
          );
          for (const s of zoneSamples) {
            s.zoneBarcode = code;
            s.zoneIbraSampleId = parsed.sampleId || null;
            s.zoneIbraRaw = parsed.raw || code;
            await pixDB.put('samples', s);
          }
          this.toast(`QR IBRA asociado a ${zoneSamples.length} muestras de Zona ${zona}`, 'success');
        }

        this.closeScannerOverlay();
      });
    } catch (e) {
      this.toast('Error al iniciar cámara', 'error');
      this.closeScannerOverlay();
    }
  }

  _zonePointIds(zonePoints) {
    return zonePoints.map(p => p.id);
  }

  // Navigate to next zone after completing current one
  async nextZone() {
    document.getElementById('zoneCompleteModal').classList.remove('active');

    const points = await pixDB.getAllByIndex('points', 'fieldId', this.currentField.id);
    const allDone = points.every(p => p.status === 'collected');

    if (allDone) {
      // Stop tracking when all done
      if (gpsNav.isTracking) this.toggleTracking();
      this.toast('CAMPO COMPLETO! Todas las zonas muestreadas', 'success');
      gpsNav.clearTarget();
      pixMap.clearNavigationLine();
      this.isNavigating = false;
    } else {
      // Navigate to next zone's principal
      this.nextPoint();
    }
  }

  // ===== AUTO GPS TRACKING =====
  // Automatically start tracking when first point is collected
  _ensureTracking() {
    if (!gpsNav.isTracking && this.currentField) {
      gpsNav.startTracking();
      pixMap.startLiveTrack(); // Start real-time track drawing on map
      const btn = document.getElementById('trackBtn');
      if (btn) btn.classList.add('active');
      console.log('[App] Auto-tracking started for field:', this.currentField.name);
    }
  }

  // Speed display in nav panel
  updateSpeedDisplay() {
    const speedEl = document.getElementById('navSpeed');
    if (!speedEl) return;
    if (gpsNav.speed > 0.5) {
      speedEl.textContent = `${gpsNav.getSpeedKmh()} km/h`;
      speedEl.style.color = '#00BFA5';
    } else {
      speedEl.textContent = '';
    }
  }

  // Re-center map on user and re-enable follow
  recenterOnUser() {
    pixMap.centerOnUser();
    this.toast('Siguiendo posición GPS', 'info');
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

  // User menu (logout, user info)
  showUserMenu() {
    const user = pixAuth.currentUser;
    if (!user) return;

    // Remove existing menu
    const existing = document.getElementById('userMenuPopup');
    if (existing) { existing.remove(); return; }

    const popup = document.createElement('div');
    popup.id = 'userMenuPopup';
    popup.style.cssText = 'position:fixed;top:56px;right:8px;z-index:99999;background:#1a2744;border:1px solid rgba(127,214,51,0.2);border-radius:14px;padding:16px;min-width:220px;box-shadow:0 8px 32px rgba(0,0,0,0.5);font-family:Inter,sans-serif;';
    popup.innerHTML = `
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;padding-bottom:12px;border-bottom:1px solid rgba(255,255,255,0.08)">
        <div style="width:40px;height:40px;border-radius:50%;background:linear-gradient(135deg,#7FD633,#0d9488);display:flex;align-items:center;justify-content:center;color:white;font-weight:700;font-size:16px">${(user.name || 'U')[0].toUpperCase()}</div>
        <div>
          <div style="color:white;font-size:14px;font-weight:600">${user.name}</div>
          <div style="color:#94a3b8;font-size:11px">${user.email || ''}</div>
          <div style="color:#7FD633;font-size:10px;font-weight:600;text-transform:uppercase">${pixAuth.getRoleLabel(user.role)}</div>
        </div>
      </div>
      <button onclick="pixAuth.logout()" style="width:100%;padding:12px;border-radius:10px;border:1px solid rgba(239,68,68,0.3);background:rgba(239,68,68,0.1);color:#ef4444;font-size:14px;font-weight:600;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:8px;font-family:Inter,sans-serif">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:18px;height:18px"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9"/></svg>
        Cerrar Sesion
      </button>
    `;

    // Close when clicking outside
    const closeHandler = (e) => {
      if (!popup.contains(e.target) && !document.getElementById('userPill').contains(e.target)) {
        popup.remove();
        document.removeEventListener('click', closeHandler);
      }
    };
    setTimeout(() => document.addEventListener('click', closeHandler), 100);

    document.body.appendChild(popup);
  }

  // Navigate to next pending
  // ===== ZONE-AWARE NAVIGATION =====
  // Guides: principal first → subs in order → zone QR → next zone

  // Detect point type from various nomenclatures
  _detectPointType(point) {
    const tipo = point.tipo || (point.properties && point.properties.tipo) || '';
    const name = (point.name || point.id || '').toLowerCase();

    // Explicit tipo field
    if (tipo === 'principal' || tipo === 'main' || tipo === 'ppal') return 'principal';
    if (tipo === 'submuestra' || tipo === 'sub' || tipo === 'subsample') return 'submuestra';

    // Name patterns: P1, P2, P3 (no dash/sub suffix) = principal
    // P1-S1, P1-S2, P1_S1, P1.S1, P1-Sub1, P1_sub1 = submuestra
    if (/^p\d+$/i.test(name)) return 'principal';
    if (/^p\d+[-_.](s|sub)\d+/i.test(name)) return 'submuestra';

    // DataFarm: "A1", "A2" = principal; "A1-1", "A1-2" = submuestra
    if (/^a\d+$/i.test(name)) return 'principal';
    if (/^a\d+[-_.]\d+/i.test(name)) return 'submuestra';

    // IBRA: "001", "002" = principal; "001-A", "001-B" = submuestra
    if (/^\d{2,4}$/.test(name)) return 'principal';
    if (/^\d{2,4}[-_.][a-z]/i.test(name)) return 'submuestra';

    // Generic: names with "-S", "-Sub", "_sub" = submuestra
    if (/[-_](s|sub|sm|submuestra|subsample)/i.test(name)) return 'submuestra';

    // Default: if point has a parent field, it's a submuestra
    if (point.parent || (point.properties && point.properties.parent)) return 'submuestra';

    return 'principal';
  }

  // Detect zone number from various nomenclatures
  _detectZone(point) {
    // Explicit zona field
    if (point.zona) return point.zona;
    if (point.properties && point.properties.zona) return point.properties.zona;

    const name = (point.name || point.id || '');

    // P1-S3 → zone 1, P2-S5 → zone 2
    const pMatch = name.match(/^P(\d+)/i);
    if (pMatch) return parseInt(pMatch[1]);

    // A1-3 → zone 1, A2-5 → zone 2
    const aMatch = name.match(/^A(\d+)/i);
    if (aMatch) return parseInt(aMatch[1]);

    // Zona property in point.properties
    if (point.properties) {
      const z = point.properties.zone || point.properties.Zone || point.properties.ambiente || point.properties.Ambiente;
      if (z) return parseInt(z) || z;
    }

    return 1; // default zone 1
  }

  // Get subsample order number for sorting
  _getSubOrder(point) {
    const name = (point.name || point.id || '');
    // P1-S3 → 3, P2-S10 → 10
    const sMatch = name.match(/[-_.][sS](?:ub)?(\d+)/);
    if (sMatch) return parseInt(sMatch[1]);
    // A1-3 → 3
    const aMatch = name.match(/[-_.](\d+)$/);
    if (aMatch) return parseInt(aMatch[1]);
    return 999;
  }

  // Zone-aware next point navigation
  async nextPoint() {
    if (!this.currentField) return;
    const points = await pixDB.getAllByIndex('points', 'fieldId', this.currentField.id);

    if (points.every(p => p.status === 'collected')) {
      this.toast('Todos los puntos recolectados!', 'success');
      return;
    }

    // Group points by zone
    const zones = {};
    for (const p of points) {
      const z = this._detectZone(p);
      if (!zones[z]) zones[z] = [];
      zones[z].push(p);
    }

    // Sort zone keys numerically
    const sortedZoneKeys = Object.keys(zones).sort((a, b) => parseInt(a) - parseInt(b));

    for (const zKey of sortedZoneKeys) {
      const zonePoints = zones[zKey];
      const pending = zonePoints.filter(p => p.status !== 'collected');

      if (pending.length === 0) continue; // Zone complete, try next

      // Find principal first
      const principal = pending.find(p => this._detectPointType(p) === 'principal');
      if (principal) {
        this.onPointClick(principal);
        this.toast(`Zona ${zKey}: navegando a punto principal ${principal.name}`, 'success');
        return;
      }

      // Principal done, find next submuestra in order
      const subs = pending
        .filter(p => this._detectPointType(p) === 'submuestra')
        .sort((a, b) => this._getSubOrder(a) - this._getSubOrder(b));

      if (subs.length > 0) {
        this.onPointClick(subs[0]);
        const totalSubs = zonePoints.filter(p => this._detectPointType(p) === 'submuestra').length;
        const doneSubs = totalSubs - subs.length;
        this.toast(`Zona ${zKey}: submuestra ${doneSubs + 1}/${totalSubs} → ${subs[0].name}`, '');
        return;
      }
    }

    this.toast('Todos los puntos recolectados!', 'success');
  }

  // Delete project
  // A11 FIX: Also delete service orders + tracks associated with the project
  // Silent delete (no confirm) — used by duplicate replacement
  async deleteProjectSilent(projectId) {
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
    const orders = await pixDB.getAllByIndex('serviceOrders', 'projectId', projectId);
    for (const o of orders) await pixDB.delete('serviceOrders', o.id);
    await pixDB.delete('projects', projectId);
  }

  async deleteProject(projectId) {
    const ok = await pixModal.confirm('Eliminar Proyecto', '¿Eliminar este proyecto y todos sus datos? Esta accion no se puede deshacer.');
    if (!ok) return;

    await this.deleteProjectSilent(projectId);
    this.currentProject = null;
    this.currentField = null;
    pixMap && pixMap.clearAll && pixMap.clearAll();
    this.loadProjects();
    this.toast('Proyecto eliminado', '');
  }

  // Delete a single field and all its data (points, samples, tracks)
  async deleteField(fieldId) {
    const field = await pixDB.get('fields', fieldId);
    const fieldName = field ? field.name : 'Campo';
    const ok = await pixModal.confirm('Eliminar Campo', `¿Eliminar "${fieldName}" y todos sus puntos?`);
    if (!ok) return;

    try {
      // Delete all points of this field
      const points = await pixDB.getAllByIndex('points', 'fieldId', fieldId);
      for (const p of points) await pixDB.delete('points', p.id);
      // Delete all samples of this field
      const samples = await pixDB.getAllByIndex('samples', 'fieldId', fieldId);
      for (const s of samples) await pixDB.delete('samples', s.id);
      // Delete all tracks of this field
      const tracks = await pixDB.getAllByIndex('tracks', 'fieldId', fieldId);
      for (const t of tracks) await pixDB.delete('tracks', t.id);
      // Delete the field itself
      await pixDB.delete('fields', fieldId);

      // If this was the current field on the map, clear it
      if (this.currentField && this.currentField.id === fieldId) {
        this.currentField = null;
        pixMap && pixMap.clearAll && pixMap.clearAll();
        document.getElementById('navPanel').style.display = 'none';
      }

      // Refresh the project view
      if (this.currentProject) {
        this.openProject(this.currentProject.id);
      } else {
        this.loadProjects();
      }
      this.toast(`"${fieldName}" eliminado`, '');
    } catch (e) {
      this.toast('Error al eliminar: ' + e.message, 'error');
    }
  }

  // Toast notification
  // Audible beep when arriving at sampling point (Web Audio API)
  _playArrivalBeep() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      // Two-tone beep: 880Hz then 1320Hz (attention-grabbing)
      const playTone = (freq, startTime, duration) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.frequency.value = freq;
        osc.type = 'sine';
        gain.gain.value = 0.3;
        gain.gain.exponentialRampToValueAtTime(0.01, startTime + duration);
        osc.start(startTime);
        osc.stop(startTime + duration);
      };
      playTone(880, ctx.currentTime, 0.15);
      playTone(1320, ctx.currentTime + 0.2, 0.15);
      playTone(880, ctx.currentTime + 0.4, 0.15);
      // Close context after beeps
      setTimeout(() => ctx.close(), 1000);
    } catch (e) {
      console.warn('[Audio] Beep failed:', e.message);
    }
  }

  toast(message, type = '', duration = null) {
    const existing = document.querySelector('.toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;

    // Errors stay longer; success/info auto-dismiss
    const ms = duration || (type === 'error' ? 8000 : type === 'warning' ? 5000 : 3000);

    // Errors get a close button
    if (type === 'error' && !duration) {
      toast.innerHTML = `<span style="flex:1">${escH(message)}</span><button onclick="this.parentElement.remove()" style="background:none;border:none;color:inherit;font-size:18px;padding:0 0 0 12px;cursor:pointer">&times;</button>`;
      toast.style.display = 'flex';
      toast.style.alignItems = 'center';
    }

    document.body.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('show'));
    this._toastTimer = setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => toast.remove(), 300);
    }, ms);
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
  const loginBtn = document.getElementById('loginBtn');
  const loginError = document.getElementById('loginError');

  if (!email || !pass) {
    loginError.textContent = 'Ingrese email y contrasena';
    loginError.style.display = 'block';
    return;
  }

  // Show loading state
  if (loginBtn) {
    loginBtn.disabled = true;
    loginBtn.textContent = 'Verificando...';
  }

  try {
    const user = await pixAuth.login(email, pass);
    if (user) {
      loginError.style.display = 'none';
      if (appIsInstalled) {
        showApp();
      } else {
        showInstallScreen();
      }
    } else {
      loginError.textContent = 'Credenciales incorrectas. Verifique email y contrasena.';
      loginError.style.display = 'block';
    }
  } catch (err) {
    console.error('[Login] Error:', err);
    loginError.textContent = 'Error de conexion. Intente nuevamente.';
    loginError.style.display = 'block';
  } finally {
    if (loginBtn) {
      loginBtn.disabled = false;
      loginBtn.textContent = 'Ingresar';
    }
  }
}
