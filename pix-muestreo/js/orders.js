// Service Orders module for PIX Muestreo
class PixOrders {
  constructor() {
    this.currentFilter = 'todas';
    this.currentOrder = null;
  }

  // Load and render orders list
  async loadOrders(filterStatus) {
    this.currentFilter = filterStatus || 'todas';
    let orders;

    // Always get ALL local orders first (avoids ID mismatch issues)
    const allOrders = await pixDB.getAll('serviceOrders');

    if (pixAuth.isAdmin()) {
      orders = allOrders;
    } else {
      // Filter by technicianId OR by matching technician name (handles ID mismatch on fresh installs)
      const userId = pixAuth.getUserId();
      const userName = (pixAuth.getUserName() || '').toLowerCase();
      orders = allOrders.filter(o =>
        o.technicianId === userId ||
        (userName && o.notes && o.notes.toLowerCase().includes(userName)) ||
        (o.createdBy === 'cloud') // Cloud-imported orders always visible to logged-in tech
      );
    }

    // ALWAYS pull from cloud when opening Orders view (non-blocking for existing orders)
    if (pixCloud.isEnabled() && navigator.onLine) {
      try {
        await app._pullCloudOrders();
        // Reload after pull to include any new orders
        const refreshed = await pixDB.getAll('serviceOrders');
        const userId = pixAuth.getUserId();
        const userName = (pixAuth.getUserName() || '').toLowerCase();
        orders = pixAuth.isAdmin() ? refreshed : refreshed.filter(o =>
          o.technicianId === userId ||
          (userName && o.notes && o.notes.toLowerCase().includes(userName)) ||
          (o.createdBy === 'cloud')
        );
      } catch (e) { console.warn('[Orders] Cloud pull on load:', e.message); }
    }

    // Apply filter
    if (this.currentFilter !== 'todas') {
      orders = orders.filter(o => o.status === this.currentFilter);
    }

    // Sort by priority then date
    const priorityOrder = { alta: 0, media: 1, baja: 2 };
    orders.sort((a, b) => (priorityOrder[a.priority] || 1) - (priorityOrder[b.priority] || 1)
      || new Date(b.createdAt) - new Date(a.createdAt));

    this.renderOrdersList(orders);
  }

  renderOrdersList(orders) {
    const container = document.getElementById('ordersList');
    if (!container) return;

    if (orders.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <svg viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" stroke-width="1.5" style="width:48px;height:48px;margin-bottom:12px">
            <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"/>
          </svg>
          <p>No hay ordenes de servicio</p>
        </div>`;
      return;
    }

    container.innerHTML = orders.map(o => this.renderOrderCard(o)).join('');
  }

  renderOrderCard(order) {
    const statusLabels = {
      pendiente: 'Pendiente', en_progreso: 'En Progreso',
      completada: 'Completada', cancelada: 'Cancelada'
    };
    const statusClasses = {
      pendiente: 'badge-pending', en_progreso: 'badge-active',
      completada: 'badge-complete', cancelada: 'badge-cancelled'
    };
    const typeLabels = {
      muestreo_suelo: 'Muestreo de Suelo', muestreo_foliar: 'Muestreo Foliar',
      mapeo_dron: 'Mapeo con Dron', consultoria: 'Consultoria'
    };
    const priorityColors = { alta: 'var(--danger)', media: 'var(--warning)', baja: 'var(--success)' };
    const dueDate = order.dueDate ? new Date(order.dueDate).toLocaleDateString('es') : '—';

    // All user-controlled values flow through escH. typeLabels/statusLabels/
    // statusClasses/priorityColors are driven by order.serviceType/order.status/
    // order.priority — attacker-controlled — so we escape every interpolation.
    const priorityColor = priorityColors[order.priority] || 'var(--text-muted)';
    const statusClass = statusClasses[order.status] || '';
    const typeLabel = typeLabels[order.serviceType] || order.serviceType;
    const statusLabel = statusLabels[order.status] || order.status;
    const orderIdNum = Number(order.id) || 0;  // numeric coerce → safe in onclick
    return `
      <div class="card order-card" style="border-left:3px solid ${escH(priorityColor)}"
           onclick="pixOrders.showOrderDetail(${orderIdNum})">
        <div class="card-header">
          <div>
            <div class="card-title">${escH(typeLabel)}</div>
            <div style="font-size:12px;color:var(--text-muted);margin-top:2px">
              ${escH(order.clientName || 'Sin cliente')} &middot; Vence: ${escH(dueDate)}
            </div>
          </div>
          <span class="card-badge ${escH(statusClass)}">${escH(statusLabel)}</span>
        </div>
        ${order.notes ? `<div style="font-size:12px;color:var(--text-muted);margin-top:8px;line-height:1.4">${escH((order.notes || '').substring(0, 80))}${(order.notes || '').length > 80 ? '...' : ''}</div>` : ''}
      </div>`;
  }

  // Show create order modal
  async showCreateOrderModal(editOrderId) {
    const modal = document.getElementById('orderModal');
    if (!modal) return;

    // Populate project selector (values + text both escaped to prevent XSS
    // via crafted project names or IDs).
    const projects = await pixDB.getAll('projects');
    const projectSelect = document.getElementById('orderProject');
    projectSelect.innerHTML = '<option value="">Seleccionar proyecto...</option>' +
      projects.map(p => `<option value="${escH(String(p.id))}">${escH(p.name || '')}</option>`).join('');

    // Populate technician selector
    const technicians = await pixAuth.getTechnicians();
    const allUsers = await pixAuth.getAllUsers();
    const techUsers = allUsers.filter(u => u.role === 'tecnico' || u.role === 'admin');
    const techSelect = document.getElementById('orderTechnician');
    techSelect.innerHTML = '<option value="">Seleccionar tecnico...</option>' +
      techUsers.map(u => `<option value="${escH(String(u.id))}">${escH(u.name || '')} (${escH(u.role || '')})</option>`).join('');

    // Reset or populate form
    if (editOrderId) {
      const order = await pixDB.get('serviceOrders', editOrderId);
      if (order) {
        this.currentOrder = order;
        projectSelect.value = order.projectId || '';
        await this.onProjectChange(order.projectId);
        document.getElementById('orderField').value = order.fieldId || '';
        document.getElementById('orderClient').value = order.clientName || '';
        techSelect.value = order.technicianId || '';
        document.getElementById('orderType').value = order.serviceType || 'muestreo_suelo';
        document.getElementById('orderPriority').value = order.priority || 'media';
        document.getElementById('orderDueDate').value = order.dueDate || '';
        document.getElementById('orderNotes').value = order.notes || '';
        document.getElementById('orderModalTitle').textContent = 'Editar Orden';
      }
    } else {
      this.currentOrder = null;
      document.getElementById('orderField').innerHTML = '<option value="">Seleccionar campo...</option>';
      document.getElementById('orderClient').value = '';
      document.getElementById('orderType').value = 'muestreo_suelo';
      document.getElementById('orderPriority').value = 'media';
      document.getElementById('orderDueDate').value = '';
      document.getElementById('orderNotes').value = '';
      document.getElementById('orderModalTitle').textContent = 'Nueva Orden de Servicio';
    }

    modal.classList.add('active');
  }

  // When project changes, load its fields
  async onProjectChange(projectId) {
    const fieldSelect = document.getElementById('orderField');
    fieldSelect.innerHTML = '<option value="">Seleccionar campo...</option>';
    if (!projectId) return;
    const fields = await pixDB.getAllByIndex('fields', 'projectId', Number(projectId));
    fieldSelect.innerHTML += fields.map(f =>
      `<option value="${escH(String(f.id))}">${escH(f.name || '')}</option>`
    ).join('');
  }

  closeOrderModal() {
    const modal = document.getElementById('orderModal');
    if (modal) modal.classList.remove('active');
    this.currentOrder = null;
  }

  // Save order
  async saveOrder() {
    const projectId = Number(document.getElementById('orderProject').value) || null;
    const fieldId = Number(document.getElementById('orderField').value) || null;
    const clientName = document.getElementById('orderClient').value.trim();
    const technicianId = document.getElementById('orderTechnician').value || null;
    const serviceType = document.getElementById('orderType').value;
    const priority = document.getElementById('orderPriority').value;
    const dueDate = document.getElementById('orderDueDate').value || null;
    const notes = document.getElementById('orderNotes').value.trim();

    if (!serviceType) {
      app.toast('Selecciona un tipo de servicio', 'warning');
      return;
    }

    const orderData = {
      projectId, fieldId, clientName, technicianId,
      serviceType, priority, notes, dueDate,
      createdBy: pixAuth.getUserId()
    };

    if (this.currentOrder) {
      orderData.id = this.currentOrder.id;
      orderData.status = this.currentOrder.status;
      orderData.createdAt = this.currentOrder.createdAt;
      await pixDB.put('serviceOrders', orderData);
      app.toast('Orden actualizada', 'success');
    } else {
      orderData.status = 'pendiente';
      await pixDB.add('serviceOrders', orderData);
      app.toast('Orden creada', 'success');
    }

    this.closeOrderModal();
    this.loadOrders(this.currentFilter);
  }

  // Show order detail
  async showOrderDetail(orderId) {
    const order = await pixDB.get('serviceOrders', orderId);
    if (!order) return;
    this.currentOrder = order;

    const statusLabels = {
      pendiente: 'Pendiente', en_progreso: 'En Progreso',
      completada: 'Completada', cancelada: 'Cancelada'
    };
    const typeLabels = {
      muestreo_suelo: 'Muestreo de Suelo', muestreo_foliar: 'Muestreo Foliar',
      mapeo_dron: 'Mapeo con Dron', consultoria: 'Consultoria'
    };

    // Get related data
    let fieldName = '—', projectName = '—', techName = '—';
    let sampleCount = 0, totalPoints = 0;

    if (order.projectId) {
      const proj = await pixDB.get('projects', order.projectId);
      if (proj) projectName = proj.name;
    }
    if (order.fieldId) {
      const field = await pixDB.get('fields', order.fieldId);
      if (field) fieldName = field.name;
      const points = await pixDB.getAllByIndex('points', 'fieldId', order.fieldId);
      totalPoints = points.length;
      const samples = await pixDB.getAllByIndex('samples', 'fieldId', order.fieldId);
      sampleCount = samples.length;
    }
    if (order.technicianId) {
      const tech = await pixDB.get('users', order.technicianId);
      if (tech) techName = tech.name;
    }

    const progress = totalPoints > 0 ? Math.round((sampleCount / totalPoints) * 100) : 0;
    const dueDate = order.dueDate ? new Date(order.dueDate).toLocaleDateString('es') : '—';
    const createdDate = order.createdAt ? new Date(order.createdAt).toLocaleDateString('es') : '—';

    const container = document.getElementById('ordersList');
    // Escape every interpolated value — client/project/field/tech names come
    // from the database but could contain HTML from cloud sync or CSV import.
    // Status/priority are enum-valued but attacker-controllable via malformed
    // cloud rows, so they flow through escH too.
    const typeLabel = typeLabels[order.serviceType] || order.serviceType;
    const statusLabel = statusLabels[order.status] || order.status;
    const statusCssKey = order.status === 'en_progreso' ? 'active'
                       : order.status === 'completada' ? 'complete'
                       : 'pending';
    container.innerHTML = `
      <div style="margin-bottom:12px">
        <button class="action-btn secondary" onclick="pixOrders.backToList()" style="width:auto;padding:8px 16px;font-size:13px">
          &larr; Volver a lista
        </button>
      </div>
      <div class="card" style="margin-bottom:12px">
        <div class="card-header">
          <div class="card-title">${escH(typeLabel)}</div>
          <span class="card-badge badge-${escH(statusCssKey)}">${escH(statusLabel)}</span>
        </div>
        <div class="order-detail-grid">
          <div class="order-detail-item"><span class="order-detail-label">Cliente</span><span>${escH(order.clientName || '—')}</span></div>
          <div class="order-detail-item"><span class="order-detail-label">Proyecto</span><span>${escH(projectName)}</span></div>
          <div class="order-detail-item"><span class="order-detail-label">Campo</span><span>${escH(fieldName)}</span></div>
          <div class="order-detail-item"><span class="order-detail-label">Tecnico</span><span>${escH(techName)}</span></div>
          <div class="order-detail-item"><span class="order-detail-label">Prioridad</span><span style="text-transform:capitalize">${escH(order.priority || '—')}</span></div>
          <div class="order-detail-item"><span class="order-detail-label">Vence</span><span>${escH(dueDate)}</span></div>
          <div class="order-detail-item"><span class="order-detail-label">Creada</span><span>${escH(createdDate)}</span></div>
        </div>
        ${order.notes ? `<div style="margin-top:12px;padding-top:12px;border-top:1px solid rgba(255,255,255,0.06);font-size:13px;color:var(--text-muted);line-height:1.5">${escH(order.notes)}</div>` : ''}
      </div>
      ${totalPoints > 0 ? `
      <div class="card" style="margin-bottom:12px">
        <div class="card-title" style="margin-bottom:8px">Progreso de Muestreo</div>
        <div class="progress-bar"><div class="progress-fill" style="width:${progress}%"></div></div>
        <div style="display:flex;justify-content:space-between;font-size:12px;color:var(--text-muted);margin-top:6px">
          <span>${sampleCount} / ${totalPoints} muestras</span>
          <span>${progress}%</span>
        </div>
      </div>` : ''}
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        ${order.status === 'pendiente' ? `<button class="action-btn primary" onclick="pixOrders.updateOrderStatus(${order.id},'en_progreso')" style="flex:1">Iniciar Trabajo</button>` : ''}
        ${order.status === 'en_progreso' ? `<button class="action-btn primary" onclick="pixOrders.updateOrderStatus(${order.id},'completada')" style="flex:1">Completar</button>` : ''}
        ${order.status !== 'cancelada' && order.status !== 'completada' ? `<button class="action-btn secondary" onclick="pixOrders.updateOrderStatus(${order.id},'cancelada')" style="flex:1;max-width:120px">Cancelar</button>` : ''}
        ${pixAuth.isAdmin() ? `<button class="action-btn secondary" onclick="pixOrders.showCreateOrderModal(${order.id})" style="flex:1;max-width:120px">Editar</button>` : ''}
      </div>`;
  }

  // Update order status
  async updateOrderStatus(orderId, newStatus) {
    const order = await pixDB.get('serviceOrders', orderId);
    if (!order) return;
    order.status = newStatus;
    order.updatedAt = new Date().toISOString();
    if (newStatus === 'completada') order.completedAt = new Date().toISOString();
    await pixDB.put('serviceOrders', order);
    // Sync status change to cloud (non-blocking)
    if (pixCloud.isEnabled() && order.cloudOrderId) {
      pixCloud.updateOrderStatus(order.cloudOrderId, newStatus).catch(e =>
        console.warn('[Orders] Cloud status update failed:', e.message));
    }
    app.toast(`Orden ${newStatus === 'en_progreso' ? 'iniciada' : newStatus === 'completada' ? 'completada' : 'cancelada'}`, 'success');
    this.showOrderDetail(orderId);
  }

  backToList() {
    this.currentOrder = null;
    this.loadOrders(this.currentFilter);
  }

  // Filter orders by status pill click
  setFilter(status) {
    this.currentFilter = status;
    document.querySelectorAll('.order-filter-pill').forEach(p => p.classList.remove('active'));
    const pill = document.querySelector(`.order-filter-pill[data-status="${status}"]`);
    if (pill) pill.classList.add('active');
    this.loadOrders(status);
  }
}

// Singleton
const pixOrders = new PixOrders();
