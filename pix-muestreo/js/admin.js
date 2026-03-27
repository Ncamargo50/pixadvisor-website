// Admin Panel module for PIX Muestreo
class PixAdmin {
  constructor() {
    this.currentSection = 'dashboard';
    this.editingUserId = null;
  }

  // Render the full admin view
  async renderAdminView() {
    const container = document.getElementById('adminContent');
    if (!container) return;

    // Sub-navigation
    const sections = [
      { id: 'dashboard', label: 'Dashboard', icon: 'M4 6h16M4 12h16M4 18h7' },
      { id: 'users', label: 'Usuarios', icon: 'M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z' },
      { id: 'system', label: 'Sistema', icon: 'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z' }
    ];

    container.innerHTML = `
      <div class="admin-tabs">
        ${sections.map(s => `
          <button class="admin-tab ${s.id === this.currentSection ? 'active' : ''}" onclick="pixAdmin.switchSection('${s.id}')">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:18px;height:18px"><path d="${s.icon}" stroke-linecap="round" stroke-linejoin="round"/></svg>
            ${s.label}
          </button>
        `).join('')}
      </div>
      <div id="adminSectionContent"></div>`;

    await this.switchSection(this.currentSection);
  }

  async switchSection(section) {
    this.currentSection = section;
    document.querySelectorAll('.admin-tab').forEach(t => t.classList.toggle('active', t.textContent.trim().toLowerCase().includes(section.substring(0, 4))));

    const content = document.getElementById('adminSectionContent');
    if (!content) return;

    switch (section) {
      case 'dashboard': await this.renderDashboard(content); break;
      case 'users': await this.renderUserList(content); break;
      case 'system': await this.renderSystem(content); break;
    }
  }

  // Dashboard with stats
  async renderDashboard(container) {
    const [samples, users, orders, projects] = await Promise.all([
      pixDB.count('samples'),
      pixDB.count('users'),
      pixDB.getAll('serviceOrders'),
      pixDB.count('projects')
    ]);

    const activeOrders = orders.filter(o => o.status === 'pendiente' || o.status === 'en_progreso').length;
    const completedOrders = orders.filter(o => o.status === 'completada').length;

    container.innerHTML = `
      <div class="sync-stats" style="margin-bottom:16px">
        <div class="sync-stat-card">
          <div class="sync-stat-value">${samples}</div>
          <div class="sync-stat-label">Muestras</div>
        </div>
        <div class="sync-stat-card">
          <div class="sync-stat-value">${users}</div>
          <div class="sync-stat-label">Usuarios</div>
        </div>
        <div class="sync-stat-card">
          <div class="sync-stat-value">${activeOrders}</div>
          <div class="sync-stat-label">Ordenes Activas</div>
        </div>
        <div class="sync-stat-card">
          <div class="sync-stat-value">${completedOrders}</div>
          <div class="sync-stat-label">Completadas</div>
        </div>
      </div>
      <div class="card" style="margin-bottom:12px">
        <div class="card-title" style="margin-bottom:8px">Proyectos</div>
        <div style="font-size:14px;color:var(--text-muted)">${projects} proyectos registrados</div>
      </div>
      ${orders.length > 0 ? `
      <div class="card">
        <div class="card-title" style="margin-bottom:8px">Ordenes Recientes</div>
        ${orders.slice(0, 5).map(o => {
          const statusLabels = { pendiente: 'Pendiente', en_progreso: 'En Progreso', completada: 'Completada', cancelada: 'Cancelada' };
          const date = o.createdAt ? new Date(o.createdAt).toLocaleDateString('es') : '';
          return `<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid rgba(255,255,255,0.04)">
            <span style="font-size:13px">${o.clientName || 'Sin cliente'} — ${o.serviceType}</span>
            <span class="card-badge badge-${o.status === 'en_progreso' ? 'active' : o.status === 'completada' ? 'complete' : 'pending'}" style="font-size:10px">${statusLabels[o.status]}</span>
          </div>`;
        }).join('')}
      </div>` : ''}`;
  }

  // User list
  async renderUserList(container) {
    const users = await pixAuth.getAllUsers();

    container.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
        <div class="settings-group-title">Usuarios (${users.length})</div>
        <button class="action-btn primary" onclick="pixAdmin.showUserForm()" style="width:auto;padding:8px 16px;font-size:13px">+ Nuevo</button>
      </div>
      ${users.map(u => `
        <div class="card user-card" style="margin-bottom:8px;opacity:${u.active ? '1' : '0.5'}">
          <div class="card-header">
            <div>
              <div class="card-title">${u.name}</div>
              <div style="font-size:12px;color:var(--text-muted)">${u.email}</div>
            </div>
            <div style="display:flex;gap:6px;align-items:center">
              <span class="card-badge ${pixAuth.getRoleBadgeClass(u.role)}">${pixAuth.getRoleLabel(u.role)}</span>
              ${u.id !== 'admin-default' ? `
                <button class="fab-btn secondary" style="width:28px;height:28px" onclick="pixAdmin.showUserForm('${u.id}')" title="Editar">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px"><path d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>
                </button>
                <button class="fab-btn secondary" style="width:28px;height:28px" onclick="pixAdmin.toggleUser('${u.id}')" title="${u.active ? 'Desactivar' : 'Activar'}">
                  <svg viewBox="0 0 24 24" fill="none" stroke="${u.active ? 'var(--danger)' : 'var(--success)'}" stroke-width="2" style="width:14px;height:14px">
                    ${u.active ? '<path d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636"/>' : '<path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/>'}
                  </svg>
                </button>` : '<span style="font-size:10px;color:var(--text-muted)">Default</span>'}
            </div>
          </div>
        </div>
      `).join('')}`;
  }

  // Show user create/edit form in modal
  async showUserForm(userId) {
    this.editingUserId = userId || null;
    const modal = document.getElementById('userModal');
    if (!modal) return;

    document.getElementById('userModalTitle').textContent = userId ? 'Editar Usuario' : 'Nuevo Usuario';
    document.getElementById('userName').value = '';
    document.getElementById('userEmail').value = '';
    document.getElementById('userPassword').value = '';
    document.getElementById('userRole').value = 'tecnico';
    document.getElementById('userPasswordGroup').style.display = '';

    if (userId) {
      const user = await pixDB.get('users', userId);
      if (user) {
        document.getElementById('userName').value = user.name;
        document.getElementById('userEmail').value = user.email;
        document.getElementById('userRole').value = user.role;
        document.getElementById('userPassword').placeholder = 'Dejar vacio para no cambiar';
      }
    }

    modal.classList.add('active');
  }

  closeUserModal() {
    const modal = document.getElementById('userModal');
    if (modal) modal.classList.remove('active');
    this.editingUserId = null;
  }

  async saveUser() {
    const name = document.getElementById('userName').value.trim();
    const email = document.getElementById('userEmail').value.trim();
    const password = document.getElementById('userPassword').value;
    const role = document.getElementById('userRole').value;

    if (!name || !email) {
      app.toast('Nombre y email son requeridos', 'warning');
      return;
    }

    if (this.editingUserId) {
      const updates = { name, email, role };
      if (password) updates.password = password;
      await pixAuth.updateUser(this.editingUserId, updates);
      app.toast('Usuario actualizado', 'success');
    } else {
      if (!password) {
        app.toast('La contrasena es requerida', 'warning');
        return;
      }
      await pixAuth.createUser({ name, email, password, role });
      app.toast('Usuario creado', 'success');
    }

    this.closeUserModal();
    await this.renderUserList(document.getElementById('adminSectionContent'));
  }

  async toggleUser(userId) {
    await pixAuth.toggleUserActive(userId);
    await this.renderUserList(document.getElementById('adminSectionContent'));
  }

  // System settings
  async renderSystem(container) {
    const collectorName = await pixDB.getSetting('collectorName') || '';
    const driveClientId = await pixDB.getSetting('driveClientId') || '';
    const gpsMinAcc = await pixDB.getSetting('gps_minAccuracy') || '10';
    const gpsAvgSamples = await pixDB.getSetting('gps_avgSamples') || '10';
    const gpsKalman = await pixDB.getSetting('gps_kalmanEnabled') || 'true';
    const detRadius = await pixDB.getSetting('gps_detectionRadius') || '15';

    container.innerHTML = `
      <div class="settings-group">
        <div class="settings-group-title">Nombre del Colector</div>
        <div class="setting-item">
          <input type="text" id="collectorName" class="form-input" value="${collectorName}" placeholder="Tu nombre">
          <button class="action-btn primary" onclick="app.saveCollectorName()" style="margin-top:8px">Guardar</button>
        </div>
      </div>

      <div class="settings-group">
        <div class="settings-group-title">Google Drive</div>
        <div class="setting-item">
          <label class="form-label">OAuth Client ID</label>
          <input type="text" id="driveClientId" class="form-input" value="${driveClientId}" placeholder="Client ID de Google">
          <button class="action-btn primary" onclick="app.connectDrive()" style="margin-top:8px">Conectar Google Drive</button>
        </div>
      </div>

      <div class="settings-group">
        <div class="settings-group-title">Precision GPS</div>
        <div class="setting-item">
          <label class="form-label">Precision minima</label>
          <select id="gpsMinAccuracy" class="form-input" onchange="app.saveGPSSetting('minAccuracy',this.value)">
            <option value="3" ${gpsMinAcc === '3' ? 'selected' : ''}>3m (Alta)</option>
            <option value="5" ${gpsMinAcc === '5' ? 'selected' : ''}>5m</option>
            <option value="10" ${gpsMinAcc === '10' ? 'selected' : ''}>10m (Normal)</option>
            <option value="20" ${gpsMinAcc === '20' ? 'selected' : ''}>20m (Baja)</option>
          </select>
        </div>
        <div class="setting-item">
          <label class="form-label">Lecturas promedio</label>
          <select id="gpsAvgSamples" class="form-input" onchange="app.saveGPSSetting('avgSamples',this.value)">
            <option value="5" ${gpsAvgSamples === '5' ? 'selected' : ''}>5 lecturas</option>
            <option value="10" ${gpsAvgSamples === '10' ? 'selected' : ''}>10 lecturas</option>
            <option value="20" ${gpsAvgSamples === '20' ? 'selected' : ''}>20 lecturas</option>
            <option value="30" ${gpsAvgSamples === '30' ? 'selected' : ''}>30 lecturas</option>
          </select>
        </div>
        <div class="setting-item">
          <label class="form-label">Filtro Kalman</label>
          <select id="gpsKalmanEnabled" class="form-input" onchange="app.saveGPSSetting('kalmanEnabled',this.value)">
            <option value="true" ${gpsKalman === 'true' ? 'selected' : ''}>Habilitado</option>
            <option value="false" ${gpsKalman !== 'true' ? 'selected' : ''}>Deshabilitado</option>
          </select>
        </div>
      </div>

      <div class="settings-group">
        <div class="settings-group-title">Mapa Offline</div>
        <div class="setting-item">
          <div id="tileCacheStats" style="font-size:13px;color:var(--text-muted);margin-bottom:8px">—</div>
          <button class="action-btn primary" onclick="app.downloadTilesOffline()">Descargar Mapa del Campo Actual</button>
          <button class="action-btn secondary" style="margin-top:8px;border-color:var(--danger);color:var(--danger)" onclick="app.clearTileCache()">Limpiar Cache de Tiles</button>
        </div>
      </div>

      <div class="settings-group">
        <div class="settings-group-title">Datos</div>
        <div class="setting-item">
          <button class="action-btn primary" onclick="app.exportLocalBackup()">Exportar Backup Completo</button>
          <button class="action-btn secondary" style="margin-top:8px" onclick="app.importLocalFile()">Importar Datos</button>
        </div>
      </div>

      <div style="text-align:center;padding:24px 0;color:var(--text-muted);font-size:12px">
        <img src="icons/icon-192.png" alt="PIX" style="width:40px;height:40px;border-radius:12px;margin-bottom:8px;display:block;margin:0 auto 8px">
        PIX Muestreo v3.0.0<br>
        Pixadvisor — Agricultura de Precision
      </div>`;

    // Update tile cache stats
    if (typeof app !== 'undefined' && app.updateTileCacheStats) {
      app.updateTileCacheStats();
    }
  }
}

// Singleton
const pixAdmin = new PixAdmin();
