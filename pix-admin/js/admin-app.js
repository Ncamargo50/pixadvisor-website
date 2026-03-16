// PIX Admin - Main Application Controller
class PixAdmin {
  constructor() {
    this.currentView = 'dashboard';
    this.cropId = 'cana';
    this.yieldTarget = 100;
    this.soilData = {};
    this.leafData = {};
    this.samples = [];
    this.lastReport = null;
    this.maps = {};
    this.overlays = {};
    // Client data for report
    this.clientData = {
      nombre: '', propiedad: '', ubicacion: '', lote: '',
      area: '', responsable: '', laboratorio: '', nMuestra: ''
    };
    // Field boundary (perímetro del lote)
    this.fieldBoundary = null;    // GeoJSON FeatureCollection
    this.fieldPolygon = null;     // [[lng,lat],...] polygon coords
    this.fieldAreaHa = 0;
    this._boundaryLayers = {};    // Leaflet layers per map
    // Lab methodology settings
    this.pMethod = 'mehlich1'; // 'mehlich1', 'mehlich3', 'resina'
    this.phMethod = 'agua';    // 'agua' (H₂O) or 'cacl2' (CaCl₂)
    this.unitSystem = {
      cations: 'mmolc/dm³',
      mo: 'g/dm³',
      texture: '%',
      extractable: 'mg/dm³'
    };
  }

  init() {
    this.buildCropSelector();
    this.buildSoilForm();
    this.buildLeafForm();
    this.buildPrescSourceSelector();
    this.setCrop(this.cropId);
    this.updateDashboard();
    console.log('PIX Admin initialized');
  }

  // ===== NAVIGATION =====
  showView(viewName) {
    this.currentView = viewName;
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.getElementById(`view-${viewName}`).classList.add('active');
    document.querySelectorAll('.nav-link').forEach(n => {
      n.classList.toggle('active', n.dataset.view === viewName);
    });

    const titles = {
      'dashboard': ['Dashboard', 'Resumen general'],
      'soil': ['Análisis de Suelo', 'Interpretación de resultados de laboratorio'],
      'leaf': ['Análisis Foliar', 'Interpretación de tejido vegetal'],
      'interpretation': ['Reporte Completo', 'Interpretación + recomendaciones + enmiendas'],
      'gis-dashboard': ['GIS Dashboard', 'Mapas profesionales de fertilidad, zonas y prescripción'],
      'nutrient-maps': ['Mapas de Nutrientes', 'Interpolación IDW geoespacial'],
      'prescription': ['Prescripción VRT', 'Mapas de tasa variable'],
      'samples': ['Muestras / Lab', 'Gestión de muestras y resultados']
    };
    const [t, s] = titles[viewName] || [viewName, ''];
    document.getElementById('headerTitle').textContent = t;
    document.getElementById('headerSubtitle').textContent = s;

    if (viewName === 'gis-dashboard' && !this.maps.gis) {
      setTimeout(() => this.initGISMap(), 100);
    }
    if (viewName === 'nutrient-maps' && !this.maps.nutrient) {
      setTimeout(() => this.initNutrientMap(), 100);
    }
    if (viewName === 'prescription' && !this.maps.prescription) {
      setTimeout(() => this.initPrescMap(), 100);
    }
    if (viewName === 'samples') this.renderSamplesTable();
    if (viewName === 'interpretation') this.generateFullReport();
  }

  // ===== CROP SELECTOR =====
  buildCropSelector() {
    const sel = document.getElementById('globalCrop');
    const list = InterpretationEngine.getCropList();
    sel.innerHTML = list.map(c => `<option value="${c.id}">${c.name}</option>`).join('');

    // Dashboard crop list
    const dash = document.getElementById('cropListDashboard');
    if (dash) {
      dash.innerHTML = list.map(c =>
        `<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border);font-size:13px">
          <span>${c.name}</span><span style="color:var(--text-dim);font-style:italic;font-size:11px">${c.scientific}</span>
        </div>`
      ).join('');
    }
  }

  setCrop(cropId) {
    this.cropId = cropId;
    const crop = CROPS_DB[cropId];
    if (!crop) return;
    this.yieldTarget = crop.defaultYield;
    document.getElementById('globalCrop').value = cropId;
    document.getElementById('prescYield').value = crop.defaultYield;

    // Update dashboard stats
    document.getElementById('statCrop').textContent = crop.name;
    document.getElementById('statYield').textContent = `${crop.defaultYield} ${crop.yieldUnit}`;
  }

  updateDashboard() {
    document.getElementById('statSamples').textContent = this.samples.length;
    const alerts = this.lastReport?.soilInterpretation?.alerts?.length || 0;
    document.getElementById('statAlerts').textContent = alerts;
  }

  // ===== SOIL FORM =====
  buildSoilForm() {
    this.rebuildSoilInputs();

    // Build method/unit selector panel
    const panel = document.getElementById('soilMethodPanel');
    if (panel) {
      panel.innerHTML = `
        <div class="method-selectors">
          <div class="method-group">
            <label class="form-label">Método Laboratorio</label>
            <select id="selPMethod" onchange="admin.setPMethod(this.value)">
              <option value="mehlich1">Mehlich 1 (doble ácido)</option>
              <option value="mehlich3">Mehlich 3 (universal)</option>
              <option value="resina">Resina / IAC (São Paulo)</option>
            </select>
          </div>
          <div class="method-group">
            <label class="form-label">Método pH</label>
            <select id="selPhMethod" onchange="admin.setPhMethod(this.value)">
              <option value="agua">pH en Agua (H₂O)</option>
              <option value="cacl2">pH en CaCl₂</option>
            </select>
          </div>
          <div class="method-group">
            <label class="form-label">Unidad Cationes</label>
            <select id="selCationUnit" onchange="admin.setUnit('cations',this.value)">
              <option value="mmolc/dm³">mmolc/dm³</option>
              <option value="cmolc/dm³">cmolc/dm³</option>
              <option value="meq/100g">meq/100g</option>
            </select>
          </div>
          <div class="method-group">
            <label class="form-label">Unidad MO</label>
            <select id="selMOUnit" onchange="admin.setUnit('mo',this.value)">
              <option value="g/dm³">g/dm³</option>
              <option value="g/kg">g/kg</option>
              <option value="dag/kg">dag/kg (%)</option>
            </select>
          </div>
          <div class="method-group">
            <label class="form-label">Unidad Textura</label>
            <select id="selTextureUnit" onchange="admin.setUnit('texture',this.value)">
              <option value="%">%</option>
              <option value="g/kg">g/kg</option>
            </select>
          </div>
        </div>`;
    }
  }

  rebuildSoilInputs() {
    const cu = this.unitSystem.cations;
    const mu = UNIT_SYSTEMS.mo[this.unitSystem.mo]?.label || 'g/dm³';
    const tu = UNIT_SYSTEMS.texture[this.unitSystem.texture]?.label || '%';
    const eu = UNIT_SYSTEMS.extractable[this.unitSystem.extractable]?.label || 'mg/dm³';
    const cul = UNIT_SYSTEMS.cations[cu]?.label || cu;

    const pMethodLabel = P_METHODS[this.pMethod]?.name || 'Mehlich 1';
    const mt = (this.pMethod !== 'mehlich1') ? `<span class="method-tag">${pMethodLabel}</span>` : '';
    const mtp = `<span class="method-tag">${pMethodLabel}</span>`;

    const macros = [
      ['pH_H2O', `pH ${this.phMethod === 'cacl2' ? '(CaCl₂) <span class="method-tag">CaCl₂</span>' : '(H₂O)'}`, ''],
      ['MO', `Mat. Orgánica${mt}`, mu],
      ['P', `Fósforo (P) ${mtp}`, eu],
      ['K', `Potasio (K⁺)${mt}`, cul],
      ['Ca', `Calcio (Ca²⁺)${mt}`, cul],
      ['Mg', `Magnesio (Mg²⁺)${mt}`, cul],
      ['Al', 'Aluminio (Al³⁺)', cul],
      ['H_Al', 'H+Al', cul],
      ['SB', 'Suma bases', cul],
      ['CTC', 'CTC', cul],
      ['V', `V%${mt}`, '%'],
      ['S', `Azufre (S)${mt}`, eu]
    ];
    const micros = [
      ['B', `Boro (B)${mt}`, eu], ['Cu', `Cobre (Cu)${mt}`, eu],
      ['Fe', `Hierro (Fe)${mt}`, eu], ['Mn', `Manganeso (Mn)${mt}`, eu],
      ['Zn', `Zinc (Zn)${mt}`, eu]
    ];
    const texture = [
      ['sand', 'Arena', tu], ['silt', 'Limo', tu], ['clay', 'Arcilla', tu]
    ];

    // Save current values
    const saved = {};
    const fields = ['pH_H2O','MO','P','K','Ca','Mg','Al','H_Al','SB','CTC','V','S','B','Cu','Fe','Mn','Zn','sand','silt','clay'];
    for (const f of fields) {
      const el = document.getElementById(`soil_${f}`);
      if (el && el.value !== '') saved[f] = el.value;
    }

    const render = (items) => items.map(([id, label, unit]) =>
      `<div class="lab-input-item">
        <label>${label} <span class="unit">${unit}</span></label>
        <input type="number" step="any" id="soil_${id}" placeholder="—">
      </div>`
    ).join('');

    document.getElementById('soilMacroInputs').innerHTML = render(macros);
    document.getElementById('soilMicroInputs').innerHTML = render(micros);
    document.getElementById('soilTextureInputs').innerHTML = render(texture);

    // Restore values
    for (const [k, v] of Object.entries(saved)) {
      const el = document.getElementById(`soil_${k}`);
      if (el) el.value = v;
    }
  }

  syncDropdowns() {
    const map = {
      selPMethod: this.pMethod,
      selPhMethod: this.phMethod,
      selCationUnit: this.unitSystem.cations,
      selMOUnit: this.unitSystem.mo,
      selTextureUnit: this.unitSystem.texture
    };
    for (const [id, val] of Object.entries(map)) {
      const el = document.getElementById(id);
      if (el) el.value = val;
    }
  }

  setPMethod(method) {
    this.pMethod = method;
    if (method === 'resina') this.phMethod = 'cacl2';
    this.rebuildSoilInputs();
    this.syncDropdowns();
  }

  setPhMethod(method) {
    this.phMethod = method;
    this.rebuildSoilInputs();
    this.syncDropdowns();
  }

  setUnit(group, unit) {
    this.unitSystem[group] = unit;
    this.rebuildSoilInputs();
    this.syncDropdowns();
  }

  getSoilFormData() {
    const data = {};
    const fields = ['pH_H2O','MO','P','K','Ca','Mg','Al','H_Al','SB','CTC','V','S','B','Cu','Fe','Mn','Zn','sand','silt','clay'];
    for (const f of fields) {
      const el = document.getElementById(`soil_${f}`);
      if (el && el.value !== '') data[f] = parseFloat(el.value);
    }
    return data;
  }

  clearSoilForm() {
    document.querySelectorAll('[id^="soil_"]').forEach(el => { if (el.tagName === 'INPUT') el.value = ''; });
    document.getElementById('soilResults').innerHTML = '';
  }

  loadDemoSoil() {
    const demo = { pH_H2O:5.2, MO:22, P:8, K:1.8, Ca:15, Mg:5, Al:3, H_Al:42, S:6, B:0.3, Cu:0.6, Fe:25, Mn:8, Zn:0.9, sand:45, silt:15, clay:40 };
    for (const [k,v] of Object.entries(demo)) {
      const el = document.getElementById(`soil_${k}`);
      if (el) el.value = v;
    }
  }

  // ===== LEAF FORM =====
  buildLeafForm() {
    const nutrients = [
      ['N', 'Nitrógeno (N)', 'g/kg'], ['P', 'Fósforo (P)', 'g/kg'],
      ['K', 'Potasio (K)', 'g/kg'], ['Ca', 'Calcio (Ca)', 'g/kg'],
      ['Mg', 'Magnesio (Mg)', 'g/kg'], ['S', 'Azufre (S)', 'g/kg'],
      ['B', 'Boro (B)', 'mg/kg'], ['Cu', 'Cobre (Cu)', 'mg/kg'],
      ['Fe', 'Hierro (Fe)', 'mg/kg'], ['Mn', 'Manganeso (Mn)', 'mg/kg'],
      ['Zn', 'Zinc (Zn)', 'mg/kg']
    ];
    document.getElementById('leafInputs').innerHTML = nutrients.map(([id, label, unit]) =>
      `<div class="lab-input-item">
        <label>${label} <span class="unit">${unit}</span></label>
        <input type="number" step="any" id="leaf_${id}" placeholder="—">
      </div>`
    ).join('');
  }

  getLeafFormData() {
    const data = {};
    for (const n of ['N','P','K','Ca','Mg','S','B','Cu','Fe','Mn','Zn']) {
      const el = document.getElementById(`leaf_${n}`);
      if (el && el.value !== '') data[n] = parseFloat(el.value);
    }
    return data;
  }

  loadDemoLeaf() {
    const crop = CROPS_DB[this.cropId];
    if (!crop || !crop.leaf) return;
    // Fill with values in the "adequate" range
    for (const [n, ranges] of Object.entries(crop.leaf)) {
      const adRange = ranges.ad;
      if (adRange) {
        const mid = (adRange[0] + adRange[1]) / 2;
        const el = document.getElementById(`leaf_${n}`);
        if (el) el.value = Math.round(mid * 10) / 10;
      }
    }
    // Make one nutrient deficient for demo
    const pEl = document.getElementById('leaf_P');
    if (pEl) pEl.value = crop.leaf.P?.def?.[1] || 1.0;
  }

  // ===== INTERPRETATION =====
  interpretSoil() {
    this.soilData = this.getSoilFormData();
    if (Object.keys(this.soilData).length === 0) return;

    const options = { pMethod: this.pMethod, phMethod: this.phMethod, unitSystem: this.unitSystem };
    const result = InterpretationEngine.interpretSoil(this.soilData, this.cropId, options);
    // For relationships and fert, use normalized data
    const normalizedData = InterpretationEngine.normalizeLabData(this.soilData, this.unitSystem);
    const relationships = InterpretationEngine.analyzeRelationships(normalizedData, this.cropId);
    const liming = InterpretationEngine.calculateLiming(normalizedData, this.cropId);
    const gypsum = InterpretationEngine.calculateGypsum(normalizedData, this.cropId);
    const fert = InterpretationEngine.calculateFertilization(normalizedData, this.cropId, this.yieldTarget);
    const products = InterpretationEngine.calculateProducts(fert);

    this.lastReport = { soilInterpretation: result, relationships, liming, gypsum, fertilization: fert, products };
    this.updateDashboard();

    let html = '';

    // Alerts
    if (result.alerts.length > 0) {
      html += '<div class="report-section"><div class="report-title"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>Alertas</div>';
      for (const a of result.alerts) {
        html += `<div class="alert alert-${a.type}">${a.msg}</div>`;
      }
      html += '</div>';
    }

    // Method info
    const pMethodName = P_METHODS[this.pMethod]?.name || this.pMethod;
    const phMethodName = this.phMethod === 'cacl2' ? 'CaCl₂' : 'H₂O';
    html += `<div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:12px;font-size:12px;color:var(--text-muted)">
      <span>Método Lab: <strong style="color:var(--teal)">${pMethodName}</strong></span>
      <span>pH: <strong style="color:var(--teal)">${phMethodName}</strong></span>
      <span>Cationes: <strong>${this.unitSystem.cations}</strong></span>
      <span>MO: <strong>${this.unitSystem.mo}</strong></span>
      <span>Textura: <strong>${this.unitSystem.texture}</strong></span>
    </div>`;

    // Nutrients table
    html += '<div class="card"><div class="card-title" style="margin-bottom:16px">Interpretación de Nutrientes</div>';
    html += '<table class="data-table"><thead><tr><th>Parámetro</th><th>Valor</th><th>Unidad</th><th>Clasificación</th></tr></thead><tbody>';
    for (const [key, n] of Object.entries(result.nutrients)) {
      const dispVal = (n.displayValue !== undefined ? n.displayValue : n.value);
      const valStr = typeof dispVal === 'number' ? dispVal.toFixed(n.decimals || 1) : dispVal;
      const methodTag = n.methodLabel ? ` <span class="method-tag">${n.methodLabel}</span>` : '';
      html += `<tr><td>${n.label}${methodTag}</td><td class="cell-value">${valStr}</td><td style="color:var(--text-muted)">${n.unit}</td>
        <td><span class="badge badge-${n.class}">${n.label_class || CLASS_LABELS[n.class] || n.class}</span></td></tr>`;
    }
    html += '</tbody></table></div>';

    // Texture
    if (result.calculated.texture) {
      html += `<div class="card"><div class="card-title">Textura</div>
        <div style="font-size:24px;font-weight:700;color:var(--teal);margin-top:8px">${result.calculated.texture.class}</div>
        <div style="color:var(--text-muted);margin-top:4px">Grupo textural: ${result.calculated.texture.group}</div></div>`;
    }

    // Relationships
    if (relationships.length > 0) {
      html += '<div class="card"><div class="card-title" style="margin-bottom:16px">Relaciones entre Nutrientes</div><div class="grid-2">';
      for (const r of relationships) {
        html += `<div class="rel-card">
          <div class="rel-value" style="color:${r.color}">${r.value.toFixed(1)}</div>
          <div class="rel-info">
            <div class="rel-name">${r.name}</div>
            <div class="rel-range">Óptimo: ${r.optMin || '—'}–${r.optMax || '—'}</div>
            <div class="rel-diagnostic" style="color:${r.color}">${r.diagnostic}</div>
          </div>
        </div>`;
      }
      html += '</div></div>';
    }

    // Liming
    if (liming) {
      const limingClass = liming.needed ? 'warning' : 'success';
      html += `<div class="card"><div class="card-title" style="margin-bottom:12px">Encalado</div>
        <div class="alert alert-${limingClass}">${liming.msg}</div>`;
      if (liming.needed) {
        html += `<div class="grid-3" style="margin-top:12px">
          <div class="stat-card"><div class="stat-value">${liming.dose_t_ha}</div><div class="stat-label">t/ha ${liming.source}</div></div>
          <div class="stat-card"><div class="stat-value">${liming.currentV.toFixed(0)}% → ${liming.targetV}%</div><div class="stat-label">V% actual → meta</div></div>
          <div class="stat-card"><div class="stat-value">${liming.CTC.toFixed(0)}</div><div class="stat-label">CTC (mmolc/dm³)</div></div>
        </div>`;
      }
      html += '</div>';
    }

    // Fertilization
    html += '<div class="card"><div class="card-title" style="margin-bottom:16px">Recomendación de Fertilización</div>';
    html += `<div style="margin-bottom:12px;color:var(--text-muted);font-size:13px">Cultivo: <strong>${fert.crop}</strong> | Meta: <strong>${fert.yieldTarget} ${fert.yieldUnit}</strong></div>`;
    html += '<table class="data-table"><thead><tr><th>Nutriente</th><th>Extracción</th><th>Suelo</th><th>Nec. Neta</th><th>Efic.</th><th>Dosis kg/ha</th></tr></thead><tbody>';
    for (const n of fert.nutrients.filter(x => !x.isMicro)) {
      html += `<tr><td>${n.label}</td><td>${n.extraction}</td><td><span class="badge badge-${n.soilClass}">${n.soilLevel}</span></td>
        <td>${n.netNeed}</td><td>${n.efficiency}%</td><td class="cell-value" style="color:var(--teal)">${n.doseKgHa}</td></tr>`;
    }
    html += '</tbody></table>';

    // Micros
    const micros = fert.nutrients.filter(x => x.isMicro);
    if (micros.length > 0) {
      html += '<div style="margin-top:16px"><div class="form-label">Micronutrientes (kg/ha)</div><div class="grid-4">';
      for (const m of micros) {
        html += `<div class="stat-card"><div class="stat-value" style="font-size:20px">${m.doseKgHa}</div><div class="stat-label">${m.label} <span class="badge badge-${m.soilClass}" style="margin-left:4px">${m.soilLevel}</span></div></div>`;
      }
      html += '</div></div>';
    }
    html += '</div>';

    // Products
    if (products.length > 0) {
      html += '<div class="card"><div class="card-title" style="margin-bottom:16px">Productos Recomendados</div>';
      html += '<table class="data-table"><thead><tr><th>Nutriente</th><th>Producto</th><th>Concentración</th><th>Dosis nutriente</th><th>Producto kg/ha</th></tr></thead><tbody>';
      for (const p of products) {
        html += `<tr><td>${p.label}</td><td>${p.source}</td><td>${p.nutrientContent}%</td>
          <td>${p.nutrientDose} kg/ha</td><td class="cell-value" style="color:var(--teal)">${p.productKgHa} kg/ha</td></tr>`;
      }
      html += '</tbody></table></div>';
    }

    document.getElementById('soilResults').innerHTML = html;
  }

  interpretLeaf() {
    this.leafData = this.getLeafFormData();
    if (Object.keys(this.leafData).length === 0) return;

    const result = InterpretationEngine.interpretLeaf(this.leafData, this.cropId);
    let html = '';

    if (result.alerts.length > 0) {
      html += '<div class="report-section">';
      for (const a of result.alerts) {
        html += `<div class="alert alert-${a.type}">${a.msg}</div>`;
      }
      html += '</div>';
    }

    html += '<div class="card"><div class="card-title" style="margin-bottom:16px">Interpretación Foliar</div>';
    html += '<table class="data-table"><thead><tr><th>Nutriente</th><th>Valor</th><th>Unidad</th><th>Clasificación</th></tr></thead><tbody>';
    for (const [key, n] of Object.entries(result.nutrients)) {
      html += `<tr><td>${n.label}</td><td class="cell-value">${n.value}</td><td style="color:var(--text-muted)">${n.unit}</td>
        <td><span class="badge badge-${n.class}">${CLASS_LABELS[n.class] || n.class}</span></td></tr>`;
    }
    html += '</tbody></table></div>';

    // DRIS Analysis
    const dris = InterpretationEngine.calculateDRIS(this.leafData, this.cropId);
    if (!dris.error && dris.order.length > 0) {
      html += '<div class="card"><div class="card-title" style="margin-bottom:16px">Diagnóstico DRIS</div>';
      html += `<div style="display:flex;gap:16px;margin-bottom:12px;font-size:13px">
        <span>IBN: <strong style="color:${dris.balanced ? 'var(--teal)' : '#f97316'}">${dris.ibn}</strong></span>
        <span>IBNm: <strong style="color:${dris.balanced ? 'var(--teal)' : '#f97316'}">${dris.ibnm}</strong></span>
        <span>Estado: <strong style="color:${dris.balanced ? 'var(--teal)' : '#f97316'}">${dris.balanced ? 'Equilibrado' : 'Desbalanceado'}</strong></span>
      </div>`;

      // Order of limitation chart
      html += '<div class="dris-chart">';
      const maxAbs = Math.max(...dris.order.map(d => Math.abs(d.index)), 1);
      for (const d of dris.order) {
        const pct = Math.abs(d.index) / maxAbs * 100;
        const isNeg = d.index < 0;
        const color = d.status === 'deficiente' ? '#ef4444' : d.status === 'limitante' ? '#f97316'
          : d.status === 'excesivo' ? '#3b82f6' : d.status === 'consumo lujoso' ? '#60a5fa' : '#22c55e';
        html += `<div class="dris-bar-row">
          <span class="dris-nutrient">${d.nutrient}</span>
          <div class="dris-bar-container">
            <div class="dris-bar ${isNeg ? 'negative' : 'positive'}" style="width:${pct}%;background:${color}"></div>
          </div>
          <span class="dris-index" style="color:${color}">${d.index > 0 ? '+' : ''}${d.index}</span>
          <span class="dris-status" style="color:${color}">${d.status}</span>
        </div>`;
      }
      html += '</div>';

      // Limitation order summary
      const limiting = dris.order.filter(d => d.index < -5);
      if (limiting.length > 0) {
        html += `<div class="alert alert-warning" style="margin-top:12px">Orden de limitación: <strong>${limiting.map(d => d.nutrient).join(' > ')}</strong></div>`;
      }
      html += '</div>';
    }

    // Cross diagnosis if soil data exists
    if (Object.keys(this.soilData).length > 0) {
      const soilInterp = InterpretationEngine.interpretSoil(this.soilData, this.cropId, { pMethod: this.pMethod, phMethod: this.phMethod, unitSystem: this.unitSystem });
      const cross = InterpretationEngine.crossDiagnosis(soilInterp, result);
      if (cross.length > 0) {
        html += '<div class="card"><div class="card-title" style="margin-bottom:16px">Diagnóstico Cruzado Suelo × Hoja</div>';
        for (const d of cross) {
          const type = d.type.includes('low') ? 'danger' : d.type.includes('ok') ? 'success' : 'warning';
          html += `<div class="alert alert-${type}">${d.msg}</div>`;
        }
        html += '</div>';
      }
    }

    document.getElementById('leafResults').innerHTML = html;
  }

  // ===== SAMPLES MANAGEMENT =====
  addSoilToSamples() {
    const data = this.getSoilFormData();
    if (Object.keys(data).length === 0) return;
    const id = document.getElementById('soilSampleId').value || `Muestra ${this.samples.length + 1}`;
    this.samples.push({
      id: this.samples.length + 1,
      name: id,
      depth: document.getElementById('soilDepth').value,
      lat: null, lng: null,
      soilData: { ...data },
      cropId: this.cropId
    });
    this.updateDashboard();
    this.toast(`Muestra "${id}" agregada (${this.samples.length} total)`);
  }

  loadDemoSamples() {
    // 12 geo-referenced soil samples from a sugar cane field (~120 ha)
    // Centered near Bella Vista, Itapúa, Paraguay
    const base = { lat: -27.035, lng: -55.545 };
    const demoPoints = [
      { name:'P1', dlat:0.000, dlng:0.000,  pH_H2O:5.2, MO:22, P:8,  K:1.8, Ca:15, Mg:5, S:6,  B:0.30, Cu:0.60, Fe:25, Mn:8,  Zn:0.9, Al:3, H_Al:28, V:42, clay:35, sand:40, silt:25 },
      { name:'P2', dlat:0.003, dlng:0.002,  pH_H2O:5.8, MO:28, P:15, K:2.5, Ca:22, Mg:8, S:12, B:0.50, Cu:0.80, Fe:18, Mn:12, Zn:1.5, Al:1, H_Al:20, V:58, clay:42, sand:32, silt:26 },
      { name:'P3', dlat:0.006, dlng:0.001,  pH_H2O:4.8, MO:18, P:5,  K:1.2, Ca:10, Mg:3, S:4,  B:0.20, Cu:0.40, Fe:35, Mn:6,  Zn:0.5, Al:8, H_Al:38, V:28, clay:28, sand:48, silt:24 },
      { name:'P4', dlat:0.001, dlng:0.005,  pH_H2O:6.2, MO:32, P:22, K:3.0, Ca:30, Mg:10, S:15, B:0.65, Cu:1.0, Fe:15, Mn:15, Zn:2.0, Al:0, H_Al:15, V:68, clay:50, sand:25, silt:25 },
      { name:'P5', dlat:0.004, dlng:0.004,  pH_H2O:5.5, MO:25, P:12, K:2.0, Ca:18, Mg:6, S:8,  B:0.40, Cu:0.70, Fe:22, Mn:10, Zn:1.2, Al:2, H_Al:24, V:50, clay:38, sand:36, silt:26 },
      { name:'P6', dlat:0.007, dlng:0.003,  pH_H2O:5.0, MO:20, P:6,  K:1.5, Ca:12, Mg:4, S:5,  B:0.25, Cu:0.50, Fe:30, Mn:7,  Zn:0.7, Al:5, H_Al:32, V:35, clay:30, sand:45, silt:25 },
      { name:'P7', dlat:0.002, dlng:0.007,  pH_H2O:6.0, MO:30, P:18, K:2.8, Ca:25, Mg:9, S:14, B:0.55, Cu:0.90, Fe:16, Mn:14, Zn:1.8, Al:0, H_Al:18, V:62, clay:45, sand:28, silt:27 },
      { name:'P8', dlat:0.005, dlng:0.006,  pH_H2O:5.3, MO:24, P:10, K:1.6, Ca:14, Mg:5, S:7,  B:0.35, Cu:0.55, Fe:28, Mn:9,  Zn:1.0, Al:3, H_Al:26, V:45, clay:33, sand:42, silt:25 },
      { name:'P9', dlat:0.008, dlng:0.005,  pH_H2O:4.5, MO:16, P:4,  K:1.0, Ca:8,  Mg:2, S:3,  B:0.15, Cu:0.30, Fe:40, Mn:5,  Zn:0.4, Al:12, H_Al:45, V:20, clay:22, sand:55, silt:23 },
      { name:'P10', dlat:0.003, dlng:0.008, pH_H2O:5.7, MO:26, P:14, K:2.2, Ca:20, Mg:7, S:10, B:0.45, Cu:0.75, Fe:20, Mn:11, Zn:1.3, Al:1, H_Al:22, V:55, clay:40, sand:34, silt:26 },
      { name:'P11', dlat:0.006, dlng:0.007, pH_H2O:6.5, MO:35, P:25, K:3.5, Ca:35, Mg:12, S:18, B:0.70, Cu:1.2, Fe:12, Mn:18, Zn:2.5, Al:0, H_Al:12, V:75, clay:55, sand:20, silt:25 },
      { name:'P12', dlat:0.009, dlng:0.002, pH_H2O:4.9, MO:19, P:7,  K:1.3, Ca:11, Mg:3, S:5,  B:0.22, Cu:0.45, Fe:32, Mn:6,  Zn:0.6, Al:6, H_Al:35, V:30, clay:25, sand:50, silt:25 }
    ];

    this.samples = demoPoints.map((p, i) => ({
      id: i + 1,
      name: p.name,
      lat: base.lat + p.dlat,
      lng: base.lng + p.dlng,
      depth: '0-20 cm',
      soilData: {
        pH_H2O: p.pH_H2O, MO: p.MO, P: p.P, K: p.K, Ca: p.Ca, Mg: p.Mg,
        S: p.S, B: p.B, Cu: p.Cu, Fe: p.Fe, Mn: p.Mn, Zn: p.Zn,
        Al: p.Al, H_Al: p.H_Al, V: p.V, clay: p.clay, sand: p.sand, silt: p.silt
      },
      cropId: this.cropId
    }));

    this.updateDashboard();
    if (this.currentView === 'samples') this.renderSamplesTable();
    this._updateGISSamplesBadge();
    this.toast(`12 muestras demo cargadas con coordenadas GPS`);
  }

  // ===== FIELD BOUNDARY HELPERS =====
  // NOTE: importFieldBoundary() and loadDemoBoundary() are defined in the GIS Dashboard section below.
  // They delegate to _setFieldBoundary() which syncs all boundary properties.

  _showBoundaryOnMaps() {
    // Add boundary outline to all initialized maps
    for (const [key, map] of Object.entries(this.maps)) {
      if (!map) continue;
      if (this._boundaryLayers[key]) {
        map.removeLayer(this._boundaryLayers[key]);
      }
      this._boundaryLayers[key] = InterpolationEngine.addBoundaryToMap(map, this.fieldBoundary, {
        color: '#ffffff', weight: 3
      });
    }
  }

  _updateBoundaryStatus() {
    const el = document.getElementById('boundaryStatus');
    if (!el) return;
    if (this.fieldPolygon) {
      el.innerHTML = `<span style="color:var(--success)">&#x2713;</span> ${Math.round(this.fieldAreaHa * 10) / 10} ha · ${this.fieldPolygon.length} vértices`;
      el.className = 'boundary-status active';
    } else {
      el.innerHTML = 'Sin perímetro';
      el.className = 'boundary-status';
    }
  }

  importSamplesJSON() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        const data = JSON.parse(await file.text());
        if (data.samples) {
          // PIX Muestreo backup format
          for (const s of data.samples) {
            this.samples.push({
              id: this.samples.length + 1,
              name: s.pointName || `P${this.samples.length + 1}`,
              lat: s.lat, lng: s.lng,
              depth: s.depth,
              barcode: s.barcode,
              soilData: s.labResults || {},
              cropId: this.cropId
            });
          }
          this.toast(`${data.samples.length} muestras importadas`);
        } else if (data.lotes) {
          // Project JSON format
          let count = 0;
          for (const lote of data.lotes) {
            if (lote.puntos) {
              for (const p of lote.puntos) {
                this.samples.push({
                  id: this.samples.length + 1,
                  name: p.id || p.name,
                  lat: p.lat, lng: p.lng,
                  lote: lote.name || lote.id,
                  soilData: {},
                  cropId: this.cropId
                });
                count++;
              }
            }
          }
          this.toast(`${count} puntos importados de ${data.lotes.length} lotes`);
        }
        this.updateDashboard();
        if (this.currentView === 'samples') this.renderSamplesTable();
      } catch (err) {
        this.toast('Error: ' + err.message, 'danger');
      }
    };
    input.click();
  }

  // ===== IBRA LAB FILE IMPORTER (CSV / Excel) =====
  // Column mapping: IBRA Portuguese headers → internal field names
  static LAB_COLUMN_MAP = {
    // --- Sample identification ---
    'amostra': '_sampleId', 'nº amostra': '_sampleId', 'n° amostra': '_sampleId', 'no amostra': '_sampleId',
    'muestra': '_sampleId', 'id': '_sampleId', 'ponto': '_sampleId', 'punto': '_sampleId',
    'cod. barras': '_barcode', 'codigo barras': '_barcode', 'barcode': '_barcode',
    'proprietario': '_owner', 'propietario': '_owner', 'cliente': '_owner',
    'propriedade': '_property', 'propiedad': '_property', 'fazenda': '_property', 'hacienda': '_property',
    'talhao': '_lote', 'talhão': '_lote', 'lote': '_lote', 'gleba': '_lote',
    'profundidade': '_depth', 'profundidad': '_depth', 'prof.': '_depth', 'prof': '_depth',
    'latitude': '_lat', 'lat': '_lat', 'longitud': '_lng', 'longitude': '_lng', 'lng': '_lng', 'lon': '_lng',
    // --- pH ---
    'ph h2o': 'pH_H2O', 'ph (h2o)': 'pH_H2O', 'ph agua': 'pH_H2O', 'ph_h2o': 'pH_H2O', 'ph': 'pH_H2O',
    'ph cacl2': 'pH_CaCl2', 'ph (cacl2)': 'pH_CaCl2', 'ph_cacl2': 'pH_CaCl2',
    // --- Matéria Orgânica ---
    'm.o.': 'MO', 'mo': 'MO', 'materia organica': 'MO', 'matéria orgânica': 'MO',
    'c.o.': 'CO', 'carbono organico': 'CO',
    // --- Fósforo ---
    'p (mehlich)': 'P', 'p mehlich': 'P', 'p mehlich-1': 'P', 'p (mehlich-1)': 'P',
    'p (resina)': 'P', 'p resina': 'P', 'p res': 'P',
    'p': 'P', 'fosforo': 'P', 'fósforo': 'P',
    'p rem': 'P_rem', 'p remanescente': 'P_rem', 'p-rem': 'P_rem',
    // --- Macros (cátions) ---
    'k': 'K', 'potassio': 'K', 'potásio': 'K', 'potasio': 'K', 'k+': 'K',
    'ca': 'Ca', 'calcio': 'Ca', 'cálcio': 'Ca', 'ca2+': 'Ca', 'ca++': 'Ca',
    'mg': 'Mg', 'magnesio': 'Mg', 'magnésio': 'Mg', 'mg2+': 'Mg', 'mg++': 'Mg',
    'al': 'Al', 'aluminio': 'Al', 'alumínio': 'Al', 'al3+': 'Al', 'al+++': 'Al',
    's': 'S', 'enxofre': 'S', 'azufre': 'S', 's-so4': 'S', 'so4': 'S',
    // --- Acidez e CTC ---
    'h+al': 'H_Al', 'h_al': 'H_Al', 'h + al': 'H_Al', 'acidez potencial': 'H_Al', 'ac. potencial': 'H_Al',
    'sb': 'SB', 'soma de bases': 'SB', 'soma bases': 'SB', 's.b.': 'SB', 'sum bases': 'SB',
    'ctc': 'CTC', 'ctc ph7': 'CTC', 'ctc (ph7)': 'CTC', 'ctc ph 7': 'CTC', 't': 'CTC',
    'ctc efetiva': 'CTC_ef', 'ctc ef': 'CTC_ef', 'ctc efe': 'CTC_ef',
    'v%': 'V', 'v (%)': 'V', 'v': 'V', 'saturacao bases': 'V', 'saturação bases': 'V', 'sat. bases': 'V',
    'm%': 'm_Al', 'm (%)': 'm_Al', 'sat. al': 'm_Al', 'saturação al': 'm_Al',
    // --- Micronutrientes ---
    'b': 'B', 'boro': 'B',
    'cu': 'Cu', 'cobre': 'Cu',
    'fe': 'Fe', 'ferro': 'Fe', 'hierro': 'Fe',
    'mn': 'Mn', 'manganes': 'Mn', 'manganês': 'Mn', 'manganeso': 'Mn',
    'zn': 'Zn', 'zinco': 'Zn', 'zinc': 'Zn',
    'na': 'Na', 'sodio': 'Na', 'sódio': 'Na',
    // --- Textura / Granulometria ---
    'argila': 'clay', 'arcilla': 'clay', 'clay': 'clay',
    'areia': 'sand', 'arena': 'sand', 'sand': 'sand',
    'silte': 'silt', 'limo': 'silt', 'silt': 'silt',
    'areia grossa': 'sand_coarse', 'areia fina': 'sand_fine',
    // --- Extras ---
    'ce': 'CE', 'condutividade': 'CE', 'conductividad': 'CE',
  };

  importLabFile() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.csv,.txt,.xlsx,.xls';
    input.onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        const ext = file.name.split('.').pop().toLowerCase();
        let rows;

        if (ext === 'csv' || ext === 'txt') {
          rows = this._parseCSV(await file.text());
        } else if (ext === 'xlsx' || ext === 'xls') {
          rows = await this._parseExcel(file);
        } else {
          this.toast('Formato no soportado. Use CSV o Excel (.xlsx)', 'warning');
          return;
        }

        if (!rows || rows.length < 2) {
          this.toast('Archivo vacío o sin datos', 'warning');
          return;
        }

        const result = this._processLabRows(rows);

        if (result.count === 0) {
          this.toast('No se encontraron datos de análisis de suelo en el archivo', 'warning');
          return;
        }

        // Show import summary modal
        this._showLabImportSummary(result);

      } catch (err) {
        console.error('Lab import error:', err);
        this.toast('Error al importar: ' + err.message, 'danger');
      }
    };
    input.click();
  }

  _parseCSV(text) {
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
    if (lines.length < 2) return [];

    // Detect delimiter: semicolon (common in BR/PY labs), comma, or tab
    const firstLine = lines[0];
    let delim = ',';
    if (firstLine.split(';').length > firstLine.split(',').length) delim = ';';
    else if (firstLine.split('\t').length > firstLine.split(',').length) delim = '\t';

    return lines.map(line => {
      // Handle quoted fields
      const result = [];
      let current = '';
      let inQuotes = false;
      for (const char of line) {
        if (char === '"') { inQuotes = !inQuotes; continue; }
        if (char === delim && !inQuotes) { result.push(current.trim()); current = ''; continue; }
        current += char;
      }
      result.push(current.trim());
      return result;
    });
  }

  async _parseExcel(file) {
    if (typeof XLSX === 'undefined') {
      this.toast('Librería Excel no cargada. Recargue la página.', 'danger');
      return [];
    }
    const data = await file.arrayBuffer();
    const workbook = XLSX.read(data, { type: 'array' });

    // Use first sheet
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];

    // Convert to array of arrays
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

    // Find header row (first row with at least 3 non-empty cells that look like lab headers)
    let headerIdx = 0;
    for (let i = 0; i < Math.min(rows.length, 10); i++) {
      const row = rows[i].map(c => String(c).toLowerCase().trim());
      const matches = row.filter(c => this._matchLabColumn(c) !== null);
      if (matches.length >= 3) { headerIdx = i; break; }
    }

    // Return from header row onwards
    return rows.slice(headerIdx).map(r => r.map(c => String(c).trim()));
  }

  _matchLabColumn(headerText) {
    const h = headerText.toLowerCase().trim()
      .replace(/[()]/g, m => m) // keep parens
      .replace(/\s+/g, ' ')
      .replace(/[²³]/g, '');

    // Direct match
    if (PixAdmin.LAB_COLUMN_MAP[h]) return PixAdmin.LAB_COLUMN_MAP[h];

    // Try without accents
    const noAccent = h.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    if (PixAdmin.LAB_COLUMN_MAP[noAccent]) return PixAdmin.LAB_COLUMN_MAP[noAccent];

    // Try partial match for common patterns
    for (const [pattern, field] of Object.entries(PixAdmin.LAB_COLUMN_MAP)) {
      if (h.includes(pattern) && pattern.length >= 2) return field;
    }

    return null;
  }

  _processLabRows(rows) {
    const headers = rows[0];
    const columnMap = {}; // index → field name
    const unmapped = [];

    headers.forEach((h, idx) => {
      const field = this._matchLabColumn(h);
      if (field) {
        columnMap[idx] = field;
      } else if (h && h.length > 0) {
        unmapped.push(h);
      }
    });

    const mappedFields = Object.values(columnMap).filter(f => !f.startsWith('_'));
    const samples = [];

    for (let i = 1; i < rows.length; i++) {
      const cells = rows[i];
      if (!cells || cells.every(c => !c || c === '')) continue;

      const soilData = {};
      const meta = {};
      let hasAnyValue = false;

      for (const [idxStr, field] of Object.entries(columnMap)) {
        const idx = parseInt(idxStr);
        const rawVal = cells[idx];
        if (rawVal === undefined || rawVal === '' || rawVal === null) continue;

        if (field.startsWith('_')) {
          // Metadata field
          meta[field] = String(rawVal).trim();
        } else {
          // Numeric soil value — handle BR/PY decimal format (comma as decimal separator)
          const cleaned = String(rawVal).replace(/\s/g, '').replace(',', '.');
          const num = parseFloat(cleaned);
          if (!isNaN(num)) {
            soilData[field] = num;
            hasAnyValue = true;
          }
        }
      }

      if (hasAnyValue) {
        samples.push({ soilData, meta });
      }
    }

    return {
      count: samples.length,
      samples,
      mappedFields,
      unmapped,
      headers: headers.filter(h => h),
      columnMap
    };
  }

  _showLabImportSummary(result) {
    const { samples, mappedFields, unmapped, count } = result;

    // If only 1 sample, auto-fill the soil form directly
    if (count === 1) {
      this._applyLabDataToForm(samples[0].soilData, samples[0].meta);
      return;
    }

    // Multiple samples: show selection dialog
    const sampleList = samples.map((s, i) => {
      const name = s.meta._sampleId || `Muestra ${i + 1}`;
      const params = Object.keys(s.soilData).length;
      const ph = s.soilData.pH_H2O || s.soilData.pH_CaCl2;
      const preview = [
        ph ? `pH ${ph}` : null,
        s.soilData.P ? `P ${s.soilData.P}` : null,
        s.soilData.K ? `K ${s.soilData.K}` : null,
        s.soilData.V ? `V% ${s.soilData.V}` : null
      ].filter(Boolean).join(' | ');
      return { idx: i, name, params, preview, ...s };
    });

    // Build modal HTML
    const modalHtml = `
      <div class="lab-import-modal" id="labImportModal" style="position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.7);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px">
        <div style="background:var(--dark-2);border:1px solid var(--border);border-radius:14px;width:100%;max-width:700px;max-height:80vh;overflow:hidden;display:flex;flex-direction:column">
          <div style="padding:20px 24px;border-bottom:1px solid var(--border);flex-shrink:0">
            <h3 style="margin:0;font-size:18px;color:var(--text)">Importar Resultados de Laboratorio</h3>
            <p style="margin:6px 0 0;font-size:13px;color:var(--text-muted)">
              ${count} muestras detectadas — ${mappedFields.length} parámetros mapeados
              ${unmapped.length > 0 ? `<br><small style="color:var(--text-dim)">Columnas no reconocidas: ${unmapped.slice(0, 5).join(', ')}${unmapped.length > 5 ? '...' : ''}</small>` : ''}
            </p>
          </div>
          <div style="overflow-y:auto;flex:1;padding:16px 24px">
            <div style="display:flex;gap:8px;margin-bottom:12px">
              <button class="btn btn-sm btn-primary" onclick="admin._importAllLabSamples()">Importar Todas (${count})</button>
              <button class="btn btn-sm btn-secondary" onclick="admin._importSelectedLabSample()">Cargar Seleccionada al Formulario</button>
            </div>
            <table class="data-table" style="font-size:12px">
              <thead><tr><th style="width:30px"></th><th>Muestra</th><th>Params</th><th>Vista Previa</th></tr></thead>
              <tbody>
                ${sampleList.map(s => `
                  <tr onclick="document.querySelectorAll('#labImportModal tr').forEach(r=>r.style.background='');this.style.background='rgba(127,214,51,0.1)';admin._selectedLabIdx=${s.idx}" style="cursor:pointer">
                    <td><input type="radio" name="labSample" value="${s.idx}" ${s.idx === 0 ? 'checked' : ''}></td>
                    <td><strong>${s.name}</strong>${s.meta._lote ? `<br><small style="color:var(--text-dim)">${s.meta._lote}</small>` : ''}</td>
                    <td><span class="badge badge-a">${s.params}</span></td>
                    <td style="font-size:11px;color:var(--text-muted)">${s.preview}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
          <div style="padding:14px 24px;border-top:1px solid var(--border);display:flex;justify-content:flex-end;gap:8px;flex-shrink:0">
            <button class="btn btn-sm btn-secondary" onclick="document.getElementById('labImportModal').remove()">Cerrar</button>
          </div>
        </div>
      </div>`;

    document.body.insertAdjacentHTML('beforeend', modalHtml);
    this._labImportResult = result;
    this._selectedLabIdx = 0;
  }

  _importAllLabSamples() {
    const result = this._labImportResult;
    if (!result) return;

    for (const s of result.samples) {
      const name = s.meta._sampleId || `Lab ${this.samples.length + 1}`;
      this.samples.push({
        id: this.samples.length + 1,
        name,
        lat: parseFloat(s.meta._lat) || null,
        lng: parseFloat(s.meta._lng) || null,
        depth: s.meta._depth || '0-20 cm',
        lote: s.meta._lote || '',
        barcode: s.meta._barcode || '',
        soilData: s.soilData,
        cropId: this.cropId
      });
    }

    // Also load first sample into soilData for report
    this.soilData = { ...result.samples[0].soilData };

    // Fill form with first sample
    this._fillSoilFormFromData(result.samples[0].soilData);

    // Fill client data from metadata if available
    const meta0 = result.samples[0].meta;
    if (meta0._owner && !this.clientData.nombre) this.clientData.nombre = meta0._owner;
    if (meta0._property && !this.clientData.propiedad) this.clientData.propiedad = meta0._property;
    if (meta0._lote && !this.clientData.lote) this.clientData.lote = meta0._lote;

    document.getElementById('labImportModal')?.remove();
    this.updateDashboard();
    this._updateGISSamplesBadge();
    if (this.currentView === 'samples') this.renderSamplesTable();
    this.toast(`${result.count} muestras importadas + formulario autocompletado`);
  }

  _importSelectedLabSample() {
    const result = this._labImportResult;
    if (!result) return;
    const idx = this._selectedLabIdx || 0;
    const sample = result.samples[idx];
    if (!sample) return;

    this._applyLabDataToForm(sample.soilData, sample.meta);
    document.getElementById('labImportModal')?.remove();
  }

  _applyLabDataToForm(soilData, meta = {}) {
    // Store in soilData for report
    this.soilData = { ...soilData };

    // Fill the soil analysis form inputs
    this._fillSoilFormFromData(soilData);

    // Fill sample ID
    if (meta._sampleId) {
      const el = document.getElementById('soilSampleId');
      if (el) el.value = meta._sampleId;
    }

    // Fill client data from lab metadata
    if (meta._owner && !this.clientData.nombre) {
      this.clientData.nombre = meta._owner;
      const el = document.getElementById('client_nombre');
      if (el) el.value = meta._owner;
    }
    if (meta._property && !this.clientData.propiedad) {
      this.clientData.propiedad = meta._property;
      const el = document.getElementById('client_propiedad');
      if (el) el.value = meta._property;
    }
    if (meta._lote && !this.clientData.lote) {
      this.clientData.lote = meta._lote;
      const el = document.getElementById('client_lote');
      if (el) el.value = meta._lote;
    }
    if (meta._sampleId && !this.clientData.nMuestra) {
      this.clientData.nMuestra = meta._sampleId;
      const el = document.getElementById('client_nMuestra');
      if (el) el.value = meta._sampleId;
    }

    // If on interpretation view, also auto-fill client inputs
    this.clientData.laboratorio = this.clientData.laboratorio || 'IBRA megalab';
    const labEl = document.getElementById('client_laboratorio');
    if (labEl && !labEl.value) labEl.value = 'IBRA megalab';

    // Navigate to soil view to show filled data
    if (this.currentView !== 'soil') this.showView('soil');

    const paramCount = Object.keys(soilData).length;
    this.toast(`${paramCount} parámetros autocompletados desde archivo de laboratorio`);
  }

  _fillSoilFormFromData(soilData) {
    for (const [k, v] of Object.entries(soilData)) {
      const el = document.getElementById(`soil_${k}`);
      if (el) el.value = v;
    }
  }

  importLabCSV() {
    // Legacy redirect — now uses unified importLabFile
    this.importLabFile();
  }

  renderSamplesTable() {
    const container = document.getElementById('samplesTable');
    if (this.samples.length === 0) {
      container.innerHTML = '<div class="empty-state"><h3>Sin muestras</h3><p>Importá datos desde PIX Muestreo o cargá resultados de laboratorio</p></div>';
      return;
    }

    let html = '<table class="data-table"><thead><tr><th>#</th><th>Nombre</th><th>Lat</th><th>Lng</th><th>Prof.</th><th>Datos Lab</th><th>Acciones</th></tr></thead><tbody>';
    for (const s of this.samples) {
      const hasLab = Object.keys(s.soilData || {}).length;
      html += `<tr>
        <td>${s.id}</td>
        <td><strong>${s.name}</strong>${s.lote ? `<br><small style="color:var(--text-dim)">${s.lote}</small>` : ''}</td>
        <td style="font-family:monospace;font-size:12px">${s.lat?.toFixed(5) || '—'}</td>
        <td style="font-family:monospace;font-size:12px">${s.lng?.toFixed(5) || '—'}</td>
        <td>${s.depth || '—'}</td>
        <td>${hasLab ? `<span class="badge badge-a">${hasLab} params</span>` : '<span class="badge badge-b">Sin datos</span>'}</td>
        <td><button class="btn btn-sm btn-secondary" onclick="admin.loadSampleToForm(${s.id})">Cargar</button></td>
      </tr>`;
    }
    html += '</tbody></table>';
    container.innerHTML = html;
  }

  loadSampleToForm(sampleId) {
    const sample = this.samples.find(s => s.id === sampleId);
    if (!sample || !sample.soilData) return;

    for (const [k, v] of Object.entries(sample.soilData)) {
      const el = document.getElementById(`soil_${k}`);
      if (el) el.value = v;
    }
    document.getElementById('soilSampleId').value = sample.name;
    this.showView('soil');
    this.toast(`Muestra "${sample.name}" cargada`);
  }

  // ===== MAPS =====
  initNutrientMap() {
    if (this.maps.nutrient) return;
    const container = document.getElementById('nutrientMap');
    if (!container || container.offsetHeight === 0) return;

    this.maps.nutrient = L.map('nutrientMap').setView([-17.78, -63.18], 12);
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      attribution: 'Esri', maxZoom: 19
    }).addTo(this.maps.nutrient);
  }

  initPrescMap() {
    if (this.maps.prescription) return;
    const container = document.getElementById('prescMap');
    if (!container || container.offsetHeight === 0) return;

    this.maps.prescription = L.map('prescMap').setView([-17.78, -63.18], 12);
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      attribution: 'Esri', maxZoom: 19
    }).addTo(this.maps.prescription);
  }

  // Clear all map layers
  _clearMapLayers(mapKey) {
    const map = this.maps[mapKey];
    if (!map) return;
    if (this.overlays[mapKey]) { map.removeLayer(this.overlays[mapKey]); this.overlays[mapKey] = null; }
    if (this[`_${mapKey}Markers`]) { this[`_${mapKey}Markers`].forEach(m => map.removeLayer(m)); this[`_${mapKey}Markers`] = []; }
    if (this[`_${mapKey}Labels`]) { this[`_${mapKey}Labels`].forEach(m => map.removeLayer(m)); this[`_${mapKey}Labels`] = []; }
  }

  updateNutrientMap() {
    // Called when nutrient dropdown changes on the nutrient-maps view
    // Only regenerate if we already have a map with data
    if (this.maps.nutrient && this.samples.length >= 2) {
      this.generateNutrientMap();
    }
  }

  generateNutrientMap() {
    if (!this.maps.nutrient) this.initNutrientMap();
    const nutrient = document.getElementById('mapNutrient').value;
    const resolution = parseInt(document.getElementById('mapResolution').value);
    const power = parseInt(document.getElementById('mapPower').value);
    const showLabels = document.getElementById('mapShowLabels')?.checked !== false;
    const info = NUTRIENT_INFO[nutrient] || { label: nutrient, unit: '' };

    const points = this.samples
      .filter(s => s.lat && s.lng && s.soilData && s.soilData[nutrient] !== undefined)
      .map(s => ({ lat: s.lat, lng: s.lng, value: s.soilData[nutrient], name: s.name }));

    if (points.length < 2) {
      this.toast('Se necesitan al menos 2 puntos con coordenadas y datos de ' + nutrient, 'warning');
      return;
    }

    const bounds = InterpolationEngine.getBounds(points);
    const gridResult = InterpolationEngine.interpolateIDW(points, bounds, { resolution, power, smooth: 2 });

    // Clear old layers
    this._clearMapLayers('nutrient');

    // Add pro overlay (high-res with bilinear interpolation + polygon clip)
    this.overlays.nutrient = InterpolationEngine.addToLeafletMap(this.maps.nutrient, gridResult, {
      cropId: this.cropId, nutrient, opacity: 0.75, layerOpacity: 0.85,
      polygon: this.fieldPolygon
    });

    // Add boundary outline
    if (this.fieldBoundary) this._showBoundaryOnMaps();

    // Add sample point markers (pro style)
    this._nutrientMarkers = InterpolationEngine.addSampleMarkers(
      this.maps.nutrient, points, nutrient, { cropId: this.cropId }
    );

    // Add zone value labels (DataFarm style)
    if (showLabels) {
      this._nutrientLabels = InterpolationEngine.addZoneLabels(
        this.maps.nutrient, gridResult, { nutrient, unit: info.unit, numLabels: 10 }
      );
    }

    // Fit bounds
    this.maps.nutrient.fitBounds([[bounds.minLat, bounds.minLng], [bounds.maxLat, bounds.maxLng]]);

    // Pro legend
    const legendEl = document.getElementById('mapLegend');
    legendEl.innerHTML = '';
    legendEl.appendChild(InterpolationEngine.createLegend(nutrient, this.cropId, gridResult.stats));

    // Stats card
    const { stats } = gridResult;
    document.getElementById('mapStats').innerHTML = `
      <div class="card"><div class="card-title">Estadísticas — ${info.label}</div>
      <div class="grid-3" style="margin-top:12px">
        <div class="stat-card"><div class="stat-value" style="font-size:20px;color:var(--danger)">${stats.min}</div><div class="stat-label">Mínimo</div></div>
        <div class="stat-card"><div class="stat-value" style="font-size:20px;color:var(--warning)">${stats.mean}</div><div class="stat-label">Media</div></div>
        <div class="stat-card"><div class="stat-value" style="font-size:20px;color:var(--success)">${stats.max}</div><div class="stat-label">Máximo</div></div>
      </div>
      <div style="margin-top:12px;font-size:12px;color:var(--text-muted)">
        ${points.length} puntos · Resolución ${resolution}×${resolution} · IDW p=${power} · Suavizado Gaussiano
      </div></div>`;

    // Store for report
    this._lastNutrientGrid = gridResult;
    this._lastNutrientName = nutrient;
    this.toast(`Mapa PRO de ${info.label} generado (${points.length} puntos, ${resolution}² celdas)`);
  }

  // ===== PRESCRIPTION =====
  buildPrescSourceSelector() {
    const sel = document.getElementById('prescSource');
    const sources = Object.entries(FERTILIZER_SOURCES)
      .filter(([k, v]) => !v.type && v.N !== undefined)
      .map(([k, v]) => `<option value="${k}">${v.name}</option>`);
    sel.innerHTML = sources.join('');
  }

  generatePrescription() {
    if (!this.maps.prescription) this.initPrescMap();
    const nutrient = document.getElementById('prescNutrient').value;
    const yieldTarget = parseFloat(document.getElementById('prescYield').value) || CROPS_DB[this.cropId]?.defaultYield;
    const source = document.getElementById('prescSource').value;

    const points = this.samples
      .filter(s => s.lat && s.lng && s.soilData && s.soilData[nutrient] !== undefined)
      .map(s => ({ lat: s.lat, lng: s.lng, value: s.soilData[nutrient], name: s.name }));

    if (points.length < 2) {
      this.toast('Se necesitan al menos 2 puntos con coordenadas y datos', 'warning');
      return;
    }

    const bounds = InterpolationEngine.getBounds(points);
    const gridResult = InterpolationEngine.interpolateIDW(points, bounds, { resolution: 80, power: 2, smooth: 2 });
    const prescResult = InterpolationEngine.generatePrescription(gridResult, nutrient, this.cropId, yieldTarget, source);

    // Clear old layers
    this._clearMapLayers('prescription');

    // Add pro prescription overlay (high-res + polygon clip)
    this.overlays.prescription = InterpolationEngine.addToLeafletMap(this.maps.prescription, prescResult, {
      isPrescription: true, opacity: 0.75, layerOpacity: 0.85,
      polygon: this.fieldPolygon
    });

    // Add boundary outline
    if (this.fieldBoundary) this._showBoundaryOnMaps();

    // Add dose labels (DataFarm style — kg/ha values on map)
    const doseGrid = prescResult.grid.map(row => row.map(c => c.dose));
    const labelGrid = { grid: doseGrid, resolution: prescResult.resolution, bounds: prescResult.bounds, stats: prescResult.stats };
    this._prescriptionLabels = InterpolationEngine.addZoneLabels(
      this.maps.prescription, labelGrid, { nutrient: prescResult.fertKey, unit: 'kg/ha', numLabels: 10, isPrescription: true }
    );

    this.maps.prescription.fitBounds([[bounds.minLat, bounds.minLng], [bounds.maxLat, bounds.maxLng]]);

    // Zones summary
    const zones = InterpolationEngine.prescriptionToZones(prescResult, 5);
    this._lastPrescription = prescResult;

    // Pro legend
    const legendEl = document.getElementById('prescLegend');
    if (legendEl) {
      legendEl.innerHTML = '';
      legendEl.appendChild(InterpolationEngine.createPrescLegend(prescResult, 5));
    }

    let html = '<div class="card"><div class="card-title" style="margin-bottom:12px">Zonas de Prescripción</div>';
    html += `<div class="grid-3" style="margin-bottom:16px">
      <div class="stat-card"><div class="stat-value" style="font-size:20px;color:var(--success)">${prescResult.stats.minDose}</div><div class="stat-label">Dosis mín (kg/ha)</div></div>
      <div class="stat-card"><div class="stat-value" style="font-size:20px;color:var(--warning)">${prescResult.stats.meanDose}</div><div class="stat-label">Dosis media</div></div>
      <div class="stat-card"><div class="stat-value" style="font-size:20px;color:var(--danger)">${prescResult.stats.maxDose}</div><div class="stat-label">Dosis máx</div></div>
    </div>`;

    html += '<table class="data-table"><thead><tr><th>Zona</th><th>Rango dosis</th><th>Media</th><th>% Área</th></tr></thead><tbody>';
    for (const z of zones) {
      const t = (z.zone - 1) / 4;
      const color = InterpolationEngine._continuousColor(t, 'prescription');
      html += `<tr><td><span class="zone-color" style="background:${color}"></span> Zona ${z.zone}</td>
        <td>${z.minDose} – ${z.maxDose} kg/ha</td><td class="cell-value">${z.meanDose}</td><td>${z.areaPct}%</td></tr>`;
    }
    html += '</tbody></table>';

    if (prescResult.source) {
      html += `<div style="margin-top:12px;padding:12px;background:var(--dark-3);border-radius:8px;font-size:13px">
        <strong>${prescResult.source.name}</strong> (${prescResult.source.content}% ${prescResult.fertKey}):
        Dosis media = <strong>${prescResult.source.meanProductKgHa} kg/ha</strong> de producto
      </div>`;
    }
    html += '</div>';
    document.getElementById('prescZones').innerHTML = html;

    this.toast(`Mapa PRO de prescripción ${prescResult.fertKey} generado`);
  }

  exportPrescription() {
    if (!this._lastPrescription) {
      this.toast('Generá un mapa de prescripción primero', 'warning');
      return;
    }
    const geojson = InterpolationEngine.prescriptionToGeoJSON(this._lastPrescription);
    const blob = new Blob([JSON.stringify(geojson, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `prescripcion_${this._lastPrescription.fertKey}_${new Date().toISOString().slice(0,10)}.geojson`;
    a.click();
    URL.revokeObjectURL(url);
    this.toast('GeoJSON de prescripción exportado');
  }

  // ===== GIS DASHBOARD =====

  initGISMap() {
    if (this.maps.gis) return;
    const container = document.getElementById('gisMap');
    if (!container || container.offsetHeight === 0) return;

    this.maps.gis = L.map('gisMap').setView([-27.035, -55.545], 13);
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      attribution: 'Esri', maxZoom: 19
    }).addTo(this.maps.gis);

    // Populate VRT source selector
    const vrtSel = document.getElementById('gisVrtSource');
    if (vrtSel) {
      const sources = Object.entries(FERTILIZER_SOURCES)
        .filter(([k, v]) => !v.type && v.N !== undefined)
        .map(([k, v]) => `<option value="${k}">${v.name}</option>`);
      vrtSel.innerHTML = sources.join('');
    }
  }

  switchGISTab(tabName) {
    document.querySelectorAll('.gis-tab').forEach(t => t.classList.toggle('active', t.dataset.gistab === tabName));
    document.querySelectorAll('.gis-tab-content').forEach(c => c.classList.remove('active'));
    document.getElementById(`gisTab-${tabName}`)?.classList.add('active');
  }

  // Clear all GIS map layers
  _clearGISLayers() {
    const map = this.maps.gis;
    if (!map) return;
    if (this._gisOverlay) { map.removeLayer(this._gisOverlay); this._gisOverlay = null; }
    if (this._gisMarkers) { this._gisMarkers.forEach(m => map.removeLayer(m)); this._gisMarkers = []; }
    if (this._gisLabels) { this._gisLabels.forEach(m => map.removeLayer(m)); this._gisLabels = []; }
  }

  // Import field boundary (KML/GeoJSON)
  importFieldBoundary() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.kml,.geojson,.json,.kmz';
    input.onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        const geojson = await InterpolationEngine.parseFieldBoundary(file);
        this._setFieldBoundary(geojson, file.name);
      } catch (err) {
        this.toast('Error: ' + err.message, 'danger');
      }
    };
    input.click();
  }

  // Demo boundary (polygon around demo sample points)
  loadDemoBoundary() {
    const base = { lat: -27.035, lng: -55.545 };
    const coords = [
      [base.lng - 0.002, base.lat - 0.002],
      [base.lng + 0.012, base.lat - 0.002],
      [base.lng + 0.012, base.lat + 0.012],
      [base.lng - 0.002, base.lat + 0.012],
      [base.lng - 0.002, base.lat - 0.002]
    ];
    const geojson = {
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        properties: { name: 'Lote Demo - Bella Vista' },
        geometry: { type: 'Polygon', coordinates: [coords] }
      }]
    };
    this._setFieldBoundary(geojson, 'Demo Lote');
  }

  _setFieldBoundary(geojson, sourceName) {
    this._fieldBoundary = geojson;
    this._boundaryPolygon = InterpolationEngine.getPolygonCoords(geojson);
    const areaHa = InterpolationEngine.polygonAreaHa(this._boundaryPolygon);
    this._fieldAreaHa = Math.round(areaHa * 10) / 10;

    // Sync with legacy property names used by nutrient-maps, prescription, and report views
    this.fieldBoundary = geojson;
    this.fieldPolygon = this._boundaryPolygon;
    this.fieldAreaHa = areaHa;
    const fName = geojson.features?.[0]?.properties?.name || sourceName || 'Lote';

    // Update client data area
    if (areaHa > 0) {
      this.clientData.area = this._fieldAreaHa + ' ha';
    }

    // Update UI
    const infoEl = document.getElementById('gisFieldInfo');
    if (infoEl) infoEl.innerHTML = `<strong>${fName}</strong> — ${this._fieldAreaHa} ha`;
    const badge = document.getElementById('gisBoundaryBadge');
    if (badge) { badge.style.display = 'inline-flex'; badge.textContent = `${this._fieldAreaHa} ha`; }
    const statusEl = document.getElementById('boundaryStatus');
    if (statusEl) { statusEl.textContent = `${this._fieldAreaHa} ha`; statusEl.className = 'boundary-status loaded'; }

    // Draw on GIS map
    if (this.maps.gis) {
      if (this._gisBoundaryLayer) this.maps.gis.removeLayer(this._gisBoundaryLayer);
      this._gisBoundaryLayer = InterpolationEngine.addBoundaryToMap(this.maps.gis, geojson, { color: '#ffffff', weight: 3 });
      this.maps.gis.fitBounds(this._gisBoundaryLayer.getBounds(), { padding: [30, 30] });
    }

    // Also draw on other maps
    for (const key of ['nutrient', 'prescription']) {
      if (this.maps[key]) {
        if (this[`_${key}BoundaryLayer`]) this.maps[key].removeLayer(this[`_${key}BoundaryLayer`]);
        this[`_${key}BoundaryLayer`] = InterpolationEngine.addBoundaryToMap(this.maps[key], geojson, { color: '#ffffff', weight: 2 });
      }
    }

    this.toast(`Perímetro cargado: ${fName} (${this._fieldAreaHa} ha)`);
  }

  _updateGISSamplesBadge() {
    const badge = document.getElementById('gisSamplesBadge');
    if (badge) {
      badge.style.display = this.samples.length > 0 ? 'inline-flex' : 'none';
      badge.textContent = `${this.samples.length} pts`;
    }
  }

  // Master GIS map generator
  generateGISMap(mode = 'fertility') {
    if (!this.maps.gis) this.initGISMap();
    this._clearGISLayers();
    this._updateGISSamplesBadge();

    const showLabels = document.getElementById('gisShowLabels')?.checked !== false;
    const showPoints = document.getElementById('gisShowPoints')?.checked !== false;
    const clipBoundary = document.getElementById('gisClipBoundary')?.checked !== false;
    const polygon = (clipBoundary && this._boundaryPolygon) ? this._boundaryPolygon : null;

    if (mode === 'fertility') {
      this._generateGISFertility(showLabels, showPoints, polygon);
    } else if (mode === 'zones') {
      this._generateGISZones(showLabels, polygon);
    } else if (mode === 'vrt') {
      this._generateGISVRT(showLabels, polygon);
    }
  }

  _getGISPoints(nutrient) {
    return this.samples
      .filter(s => s.lat && s.lng && s.soilData && s.soilData[nutrient] !== undefined)
      .map(s => ({ lat: s.lat, lng: s.lng, value: s.soilData[nutrient], name: s.name }));
  }

  // FERTILITY MAP
  _generateGISFertility(showLabels, showPoints, polygon) {
    const nutrient = document.getElementById('gisNutrient').value;
    const resolution = parseInt(document.getElementById('gisResolution').value);
    const power = parseInt(document.getElementById('gisPower').value);
    const info = NUTRIENT_INFO[nutrient] || { label: nutrient, unit: '' };
    const points = this._getGISPoints(nutrient);

    if (points.length < 2) { this.toast('Se necesitan al menos 2 puntos con datos de ' + nutrient, 'warning'); return; }

    const bounds = this._boundaryPolygon
      ? InterpolationEngine.getBounds({ features: [{ geometry: { type: 'Polygon', coordinates: [this._boundaryPolygon] }, type: 'Feature' }] })
      : InterpolationEngine.getBounds(points);

    const gridResult = InterpolationEngine.interpolateIDW(points, bounds, { resolution, power, smooth: 2 });

    this._gisOverlay = InterpolationEngine.addToLeafletMap(this.maps.gis, gridResult, {
      cropId: this.cropId, nutrient, opacity: 0.75, layerOpacity: 0.85, polygon
    });

    if (showPoints) {
      this._gisMarkers = InterpolationEngine.addSampleMarkers(this.maps.gis, points, nutrient, { cropId: this.cropId });
    }

    if (showLabels) {
      this._gisLabels = InterpolationEngine.addZoneLabels(this.maps.gis, gridResult, { nutrient, unit: info.unit, numLabels: 12 });
    }

    if (!this._gisBoundaryLayer) {
      this.maps.gis.fitBounds([[bounds.minLat, bounds.minLng], [bounds.maxLat, bounds.maxLng]]);
    }

    // Legend + stats
    const legendEl = document.getElementById('gisLegend');
    legendEl.innerHTML = '';
    legendEl.appendChild(InterpolationEngine.createLegend(nutrient, this.cropId, gridResult.stats));

    const { stats } = gridResult;
    document.getElementById('gisStats').innerHTML = `
      <div class="card" style="padding:10px">
        <div class="grid-3" style="gap:8px">
          <div class="stat-card" style="padding:8px"><div class="stat-value" style="font-size:16px;color:var(--danger)">${stats.min}</div><div class="stat-label" style="font-size:10px">Mín</div></div>
          <div class="stat-card" style="padding:8px"><div class="stat-value" style="font-size:16px;color:var(--warning)">${stats.mean}</div><div class="stat-label" style="font-size:10px">Media</div></div>
          <div class="stat-card" style="padding:8px"><div class="stat-value" style="font-size:16px;color:var(--success)">${stats.max}</div><div class="stat-label" style="font-size:10px">Máx</div></div>
        </div>
        <div style="margin-top:8px;font-size:11px;color:var(--text-dim)">${points.length} pts · ${resolution}² · IDW p=${power}${polygon ? ' · Recortado' : ''}</div>
      </div>`;

    this.toast(`Mapa ${info.label} generado`);
  }

  // MANAGEMENT ZONES MAP
  _generateGISZones(showLabels, polygon) {
    const nutrient = document.getElementById('gisZoneBase').value;
    const numZones = parseInt(document.getElementById('gisNumZones').value);
    const info = NUTRIENT_INFO[nutrient] || { label: nutrient, unit: '' };
    const points = this._getGISPoints(nutrient);

    if (points.length < 2) { this.toast('Se necesitan al menos 2 puntos', 'warning'); return; }

    const bounds = this._boundaryPolygon
      ? InterpolationEngine.getBounds({ features: [{ geometry: { type: 'Polygon', coordinates: [this._boundaryPolygon] }, type: 'Feature' }] })
      : InterpolationEngine.getBounds(points);

    const gridResult = InterpolationEngine.interpolateIDW(points, bounds, { resolution: 80, power: 2, smooth: 2 });
    const zoneResult = InterpolationEngine.generateManagementZones(gridResult, numZones);

    this._gisOverlay = InterpolationEngine.addToLeafletMap(this.maps.gis, zoneResult, {
      isZones: true, opacity: 0.70, layerOpacity: 0.80, polygon
    });

    // Zone labels at centroids
    if (showLabels) {
      this._gisLabels = [];
      for (const z of zoneResult.zones) {
        if (z.cellCount === 0) continue;
        const icon = L.divIcon({
          className: 'map-zone-label',
          html: `<span style="font-size:14px">Z${z.zone}<br><small style="font-weight:500;font-size:11px">${z.mean} ${info.unit}</small></span>`,
          iconSize: [0, 0], iconAnchor: [0, 0]
        });
        const marker = L.marker([z.centroidLat, z.centroidLng], { icon, interactive: false }).addTo(this.maps.gis);
        this._gisLabels.push(marker);
      }
    }

    if (!this._gisBoundaryLayer) {
      this.maps.gis.fitBounds([[bounds.minLat, bounds.minLng], [bounds.maxLat, bounds.maxLng]]);
    }

    // Zone legend + stats
    let html = '<div class="map-legend pro"><div class="legend-title">Zonas de Manejo — ' + info.label + '</div>';
    for (const z of zoneResult.zones) {
      const rgb = z.color;
      html += `<div class="legend-item">
        <span class="legend-color" style="background:rgb(${rgb.join(',')})"></span>
        <span class="legend-label">Zona ${z.zone}:</span>
        <span class="legend-range">${z.mean} ${info.unit} (${z.areaPct}%)</span>
      </div>`;
    }
    html += '</div>';
    document.getElementById('gisZoneLegend').innerHTML = html;

    let statsHtml = '<div class="card" style="padding:10px"><table class="data-table" style="font-size:12px"><thead><tr><th>Zona</th><th>Media</th><th>Rango</th><th>Área</th></tr></thead><tbody>';
    for (const z of zoneResult.zones) {
      statsHtml += `<tr><td><span class="zone-color" style="background:rgb(${z.color.join(',')});width:16px;height:16px"></span> Z${z.zone}</td>
        <td class="cell-value">${z.mean}</td><td>${z.min} – ${z.max}</td><td>${z.areaPct}%</td></tr>`;
    }
    statsHtml += '</tbody></table></div>';
    document.getElementById('gisZoneStats').innerHTML = statsHtml;

    this.toast(`${numZones} zonas de manejo generadas (${info.label})`);
  }

  // VRT PRESCRIPTION MAP
  _generateGISVRT(showLabels, polygon) {
    const nutrient = document.getElementById('gisVrtNutrient').value;
    const yieldTarget = parseFloat(document.getElementById('gisVrtYield').value) || CROPS_DB[this.cropId]?.defaultYield;
    const source = document.getElementById('gisVrtSource').value;
    const points = this._getGISPoints(nutrient);

    if (points.length < 2) { this.toast('Se necesitan al menos 2 puntos', 'warning'); return; }

    const bounds = this._boundaryPolygon
      ? InterpolationEngine.getBounds({ features: [{ geometry: { type: 'Polygon', coordinates: [this._boundaryPolygon] }, type: 'Feature' }] })
      : InterpolationEngine.getBounds(points);

    const gridResult = InterpolationEngine.interpolateIDW(points, bounds, { resolution: 80, power: 2, smooth: 2 });
    const prescResult = InterpolationEngine.generatePrescription(gridResult, nutrient, this.cropId, yieldTarget, source);

    this._gisOverlay = InterpolationEngine.addToLeafletMap(this.maps.gis, prescResult, {
      isPrescription: true, opacity: 0.75, layerOpacity: 0.85, polygon
    });

    if (showLabels) {
      const doseGrid = prescResult.grid.map(row => row.map(c => c.dose));
      const labelGrid = { grid: doseGrid, resolution: prescResult.resolution, bounds: prescResult.bounds, stats: prescResult.stats };
      this._gisLabels = InterpolationEngine.addZoneLabels(this.maps.gis, labelGrid, { unit: 'kg/ha', numLabels: 10, isPrescription: true });
    }

    if (!this._gisBoundaryLayer) {
      this.maps.gis.fitBounds([[bounds.minLat, bounds.minLng], [bounds.maxLat, bounds.maxLng]]);
    }

    this._lastGISPrescription = prescResult;

    // Legend + stats
    const legendEl = document.getElementById('gisVrtLegend');
    legendEl.innerHTML = '';
    legendEl.appendChild(InterpolationEngine.createPrescLegend(prescResult, 5));

    const zones = InterpolationEngine.prescriptionToZones(prescResult, 5);
    let statsHtml = `<div class="card" style="padding:10px">
      <div class="grid-3" style="gap:8px;margin-bottom:8px">
        <div class="stat-card" style="padding:8px"><div class="stat-value" style="font-size:16px;color:var(--success)">${prescResult.stats.minDose}</div><div class="stat-label" style="font-size:10px">Mín</div></div>
        <div class="stat-card" style="padding:8px"><div class="stat-value" style="font-size:16px;color:var(--warning)">${prescResult.stats.meanDose}</div><div class="stat-label" style="font-size:10px">Media</div></div>
        <div class="stat-card" style="padding:8px"><div class="stat-value" style="font-size:16px;color:var(--danger)">${prescResult.stats.maxDose}</div><div class="stat-label" style="font-size:10px">Máx</div></div>
      </div>
      <table class="data-table" style="font-size:11px"><thead><tr><th>Zona</th><th>Rango</th><th>Media</th><th>%</th></tr></thead><tbody>`;
    for (const z of zones) {
      const t = (z.zone - 1) / 4;
      const c = InterpolationEngine._continuousColor(t, 'prescription');
      statsHtml += `<tr><td><span class="zone-color" style="background:${c};width:14px;height:14px"></span> Z${z.zone}</td>
        <td>${z.minDose}–${z.maxDose}</td><td class="cell-value">${z.meanDose}</td><td>${z.areaPct}%</td></tr>`;
    }
    statsHtml += '</tbody></table></div>';
    document.getElementById('gisVrtStats').innerHTML = statsHtml;

    this.toast(`Prescripción ${prescResult.fertKey} generada`);
  }

  exportGISPrescription() {
    if (!this._lastGISPrescription) { this.toast('Genere una prescripción VRT primero', 'warning'); return; }
    const geojson = InterpolationEngine.prescriptionToGeoJSON(this._lastGISPrescription);
    const blob = new Blob([JSON.stringify(geojson, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `prescripcion_${this._lastGISPrescription.fertKey}_${new Date().toISOString().slice(0,10)}.geojson`;
    a.click();
    URL.revokeObjectURL(url);
    this.toast('GeoJSON exportado');
  }

  // Export VRT prescription as SHP ZIP (compatible with John Deere, Case IH, New Holland)
  exportGISPrescriptionSHP() {
    if (!this._lastGISPrescription) { this.toast('Genere una prescripción VRT primero', 'warning'); return; }
    const polygon = (document.getElementById('gisClipBoundary')?.checked !== false && this._boundaryPolygon) ? this._boundaryPolygon : null;
    const zipData = InterpolationEngine.prescriptionToSHP(this._lastGISPrescription, polygon);
    if (!zipData) { this.toast('No hay datos para exportar', 'warning'); return; }

    const blob = new Blob([zipData], { type: 'application/zip' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `prescripcion_SHP_${this._lastGISPrescription.fertKey}_${new Date().toISOString().slice(0,10)}.zip`;
    a.click();
    URL.revokeObjectURL(url);
    this.toast('SHP exportado — Compatible JD/Case/NH');
  }

  // Download individual nutrient map as professional PDF
  downloadNutrientMapPDF(nutrient) {
    const points = this._getGISPoints(nutrient);
    if (points.length < 2) { this.toast('Se necesitan al menos 2 puntos con datos de ' + nutrient, 'warning'); return; }

    const polygon = this._boundaryPolygon || null;
    const bounds = polygon
      ? InterpolationEngine.getBounds({ features: [{ geometry: { type: 'Polygon', coordinates: [polygon] }, type: 'Feature' }] })
      : InterpolationEngine.getBounds(points);

    const resolution = parseInt(document.getElementById('gisResolution')?.value || '120');
    const gridResult = InterpolationEngine.interpolateIDW(points, bounds, { resolution, power: 2, smooth: 2 });
    if (!gridResult) { this.toast('Error de interpolación', 'danger'); return; }

    let canvas = InterpolationEngine.renderGridToCanvas(gridResult, { cropId: this.cropId, nutrient, opacity: 0.9, renderScale: 4 });
    if (polygon) canvas = InterpolationEngine.applyPolygonClip(canvas, gridResult.bounds, polygon);

    // Load logo then generate PDF
    const logoImg = new Image();
    logoImg.crossOrigin = 'anonymous';
    logoImg.onload = () => {
      const pdfCanvas = InterpolationEngine.generateNutrientMapPDF({
        canvas, gridResult, polygon, nutrient,
        cropId: this.cropId, stats: gridResult.stats,
        clientData: this.clientData, logoImg
      });
      this._downloadCanvas(pdfCanvas, `Mapa_${nutrient}_${this.clientData?.propiedad || 'campo'}_${new Date().toISOString().slice(0,10)}.pdf`);
    };
    logoImg.onerror = () => {
      // Generate without logo
      const pdfCanvas = InterpolationEngine.generateNutrientMapPDF({
        canvas, gridResult, polygon, nutrient,
        cropId: this.cropId, stats: gridResult.stats,
        clientData: this.clientData, logoImg: null
      });
      this._downloadCanvas(pdfCanvas, `Mapa_${nutrient}_${this.clientData?.propiedad || 'campo'}_${new Date().toISOString().slice(0,10)}.pdf`);
    };
    logoImg.src = 'img/Logo.png';
  }

  // Download all nutrient maps as individual PDFs
  downloadAllNutrientMapsPDF() {
    const nutrients = ['pH_H2O','MO','P','K','Ca','Mg','V','Al','H_Al','S','B','Cu','Fe','Mn','Zn','CTC','SB','clay'];
    const available = nutrients.filter(n => {
      const pts = this._getGISPoints(n);
      return pts.length >= 2;
    });

    if (available.length === 0) { this.toast('No hay datos suficientes para generar mapas', 'warning'); return; }

    this.toast(`Generando ${available.length} mapas PDF...`);
    let idx = 0;
    const downloadNext = () => {
      if (idx >= available.length) {
        this.toast(`${available.length} mapas PDF generados`);
        return;
      }
      this.downloadNutrientMapPDF(available[idx]);
      idx++;
      setTimeout(downloadNext, 800); // Delay to avoid browser blocking
    };
    downloadNext();
  }

  // Download relationship map as PDF
  downloadRelationshipMapPDF(relId) {
    const relCalcs = {
      Ca_Mg: { calc: d => (d.Ca || 0) / Math.max(d.Mg || 1, 0.1), label: 'Ca/Mg', opt: { optMin: 3, optMax: 5 } },
      Ca_K: { calc: d => (d.Ca || 0) / Math.max(d.K || 1, 0.01), label: 'Ca/K', opt: { optMin: 10, optMax: 20 } },
      Mg_K: { calc: d => (d.Mg || 0) / Math.max(d.K || 1, 0.01), label: 'Mg/K', opt: { optMin: 2, optMax: 5 } },
      CaMg_K: { calc: d => ((d.Ca || 0) + (d.Mg || 0)) / Math.max(d.K || 1, 0.01), label: '(Ca+Mg)/K', opt: { optMin: 15, optMax: 30 } }
    };

    const rel = relCalcs[relId];
    if (!rel) return;

    const geoSamples = this.samples.filter(s => s.lat && s.lng && s.soilData);
    const points = geoSamples
      .map(s => ({ lat: s.lat, lng: s.lng, value: rel.calc(s.soilData) }))
      .filter(p => !isNaN(p.value) && isFinite(p.value));

    if (points.length < 3) { this.toast('Datos insuficientes', 'warning'); return; }

    const polygon = this._boundaryPolygon || null;
    const bounds = polygon
      ? InterpolationEngine.getBounds({ features: [{ geometry: { type: 'Polygon', coordinates: [polygon] }, type: 'Feature' }] })
      : InterpolationEngine.getBounds(points);

    const gridResult = InterpolationEngine.interpolateIDW(points, bounds, { resolution: 120, power: 2, smooth: 2 });
    if (!gridResult) return;

    // Use relationship coloring from report generator
    const canvas = ReportGenerator._renderRelationshipCanvas(gridResult, rel.opt, polygon);

    const logoImg = new Image();
    logoImg.crossOrigin = 'anonymous';
    logoImg.onload = () => {
      const pdfCanvas = InterpolationEngine.generateRelationshipMapPDF({
        canvas, gridResult, polygon, relId,
        relLabel: rel.label, optRange: rel.opt,
        stats: gridResult.stats, clientData: this.clientData, logoImg
      });
      this._downloadCanvas(pdfCanvas, `Mapa_Relacion_${relId}_${new Date().toISOString().slice(0,10)}.pdf`);
    };
    logoImg.onerror = () => {
      const pdfCanvas = InterpolationEngine.generateRelationshipMapPDF({
        canvas, gridResult, polygon, relId,
        relLabel: rel.label, optRange: rel.opt,
        stats: gridResult.stats, clientData: this.clientData, logoImg: null
      });
      this._downloadCanvas(pdfCanvas, `Mapa_Relacion_${relId}_${new Date().toISOString().slice(0,10)}.pdf`);
    };
    logoImg.src = 'img/Logo.png';
  }

  // Helper: download canvas as PNG image (named .pdf for user convenience, or can use actual PDF lib)
  _downloadCanvas(canvas, filename) {
    // Convert canvas to PNG blob and download
    canvas.toBlob(blob => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      // Change extension to .png since we're exporting canvas image
      a.download = filename.replace('.pdf', '.png');
      a.click();
      URL.revokeObjectURL(url);
    }, 'image/png', 1.0);
  }

  // ===== FULL REPORT =====
  generateFullReport() {
    // Ensure we have current data
    if (Object.keys(this.soilData).length === 0) this.soilData = this.getSoilFormData();
    if (Object.keys(this.leafData).length === 0) this.leafData = this.getLeafFormData();

    const html = ReportGenerator.generateReport(this);
    document.getElementById('fullReport').innerHTML = html;

    // Draw canvas charts after DOM render
    requestAnimationFrame(() => {
      ReportGenerator.renderCharts(this);
    });
  }

  printReport() {
    const report = document.getElementById('fullReport');
    if (!report || report.querySelector('.empty-state')) {
      this.toast('Generá el reporte primero', 'warning');
      return;
    }
    // Hide client card and sidebar for print
    document.getElementById('clientDataCard').style.display = 'none';
    document.querySelector('.sidebar').style.display = 'none';
    document.querySelector('.main-header').style.display = 'none';
    window.print();
    // Restore after print
    setTimeout(() => {
      document.getElementById('clientDataCard').style.display = '';
      document.querySelector('.sidebar').style.display = '';
      document.querySelector('.main-header').style.display = '';
    }, 500);
  }

  // ===== TOAST =====
  toast(msg, type = 'success') {
    const existing = document.querySelector('.toast-admin');
    if (existing) existing.remove();
    const t = document.createElement('div');
    t.className = 'toast-admin';
    t.style.cssText = `position:fixed;bottom:24px;right:24px;padding:12px 20px;border-radius:10px;font-size:14px;font-weight:500;z-index:9999;
      background:${type === 'danger' ? 'var(--danger)' : type === 'warning' ? 'var(--warning)' : 'var(--dark-3)'};
      color:white;border:1px solid var(--border);box-shadow:0 4px 20px rgba(0,0,0,0.3);animation:fadeIn .3s`;
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 3000);
  }
}

// Init
const admin = new PixAdmin();
document.addEventListener('DOMContentLoaded', () => admin.init());
