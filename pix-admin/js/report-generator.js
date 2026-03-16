// PIX Admin - Professional Report Generator
// Canvas-based charts + full report assembly

class ReportGenerator {

  // ===== COLOR PALETTE =====
  static COLORS = {
    teal: '#7FD633', blue: '#00A4CC', dark: '#0F1B2D', dark2: '#1a2a40', dark3: '#243447',
    text: '#e2e8f0', muted: '#94A3B8', dim: '#64748b',
    danger: '#ef4444', warning: '#f59e0b', success: '#22c55e', info: '#3b82f6',
    orange: '#f97316', purple: '#8b5cf6', pink: '#ec4899', cyan: '#06b6d4',
    classColors: { mb: '#ef4444', b: '#f97316', m: '#eab308', a: '#22c55e', ma: '#3b82f6', def: '#ef4444', ad: '#22c55e', ex: '#3b82f6', nulo: '#22c55e', bajo: '#a3e635', medio: '#eab308', alto: '#f97316', muyAlto: '#ef4444' }
  };

  // ===== GAUGE CHART =====
  static drawGauge(canvas, value, max, label, color, opts = {}) {
    const ctx = canvas.getContext('2d');
    const w = canvas.width, h = canvas.height;
    const cx = w / 2, cy = h * 0.6;
    const r = Math.min(w, h) * 0.38;
    const lineW = opts.lineWidth || 14;
    const startAngle = Math.PI * 0.8;
    const endAngle = Math.PI * 0.2 + Math.PI;
    const pct = Math.min(value / max, 1);
    const valAngle = startAngle + (endAngle - startAngle) * pct;

    ctx.clearRect(0, 0, w, h);

    // Track
    ctx.beginPath();
    ctx.arc(cx, cy, r, startAngle, endAngle);
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = lineW;
    ctx.lineCap = 'round';
    ctx.stroke();

    // Colored segments
    const segments = [
      { pct: 0.25, color: '#ef4444' },
      { pct: 0.45, color: '#f97316' },
      { pct: 0.65, color: '#eab308' },
      { pct: 0.85, color: '#22c55e' },
      { pct: 1.0, color: '#3b82f6' }
    ];
    if (!opts.noSegments) {
      for (let i = 0; i < segments.length; i++) {
        const s = i === 0 ? 0 : segments[i - 1].pct;
        const e = segments[i].pct;
        const a1 = startAngle + (endAngle - startAngle) * s;
        const a2 = startAngle + (endAngle - startAngle) * e;
        ctx.beginPath();
        ctx.arc(cx, cy, r, a1, a2);
        ctx.strokeStyle = segments[i].color + '30';
        ctx.lineWidth = lineW;
        ctx.lineCap = 'butt';
        ctx.stroke();
      }
    }

    // Value arc
    ctx.beginPath();
    ctx.arc(cx, cy, r, startAngle, valAngle);
    ctx.strokeStyle = color || this.COLORS.teal;
    ctx.lineWidth = lineW;
    ctx.lineCap = 'round';
    ctx.stroke();

    // Glow
    ctx.beginPath();
    ctx.arc(cx, cy, r, startAngle, valAngle);
    ctx.strokeStyle = (color || this.COLORS.teal) + '40';
    ctx.lineWidth = lineW + 8;
    ctx.lineCap = 'round';
    ctx.stroke();

    // Needle dot
    const nx = cx + r * Math.cos(valAngle);
    const ny = cy + r * Math.sin(valAngle);
    ctx.beginPath();
    ctx.arc(nx, ny, lineW / 2 + 2, 0, Math.PI * 2);
    ctx.fillStyle = '#fff';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(nx, ny, lineW / 2 - 1, 0, Math.PI * 2);
    ctx.fillStyle = color || this.COLORS.teal;
    ctx.fill();

    // Value text
    ctx.fillStyle = '#ffffff';
    ctx.font = `bold ${opts.fontSize || 28}px Inter, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(typeof value === 'number' ? value.toFixed(opts.decimals ?? 1) : value, cx, cy - 4);

    // Label
    ctx.fillStyle = this.COLORS.muted;
    ctx.font = `500 ${opts.labelSize || 12}px Inter, sans-serif`;
    ctx.fillText(label, cx, cy + r * 0.55);
  }

  // ===== HORIZONTAL BAR CHART =====
  static drawHBarChart(canvas, data, opts = {}) {
    const ctx = canvas.getContext('2d');
    const w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    const pad = { top: opts.title ? 36 : 12, right: 20, bottom: 12, left: opts.labelWidth || 80 };
    const barH = opts.barHeight || 26;
    const gap = opts.gap || 6;
    const maxVal = opts.maxVal || Math.max(...data.map(d => Math.abs(d.value)), 1);

    // Title
    if (opts.title) {
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 14px Inter, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(opts.title, pad.left, 22);
    }

    const chartW = w - pad.left - pad.right;

    data.forEach((d, i) => {
      const y = pad.top + i * (barH + gap);
      const barW = (Math.abs(d.value) / maxVal) * chartW;

      // Label
      ctx.fillStyle = this.COLORS.text;
      ctx.font = '600 12px Inter, sans-serif';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.fillText(d.label, pad.left - 10, y + barH / 2);

      // Bar background
      ctx.fillStyle = 'rgba(255,255,255,0.04)';
      this._roundRect(ctx, pad.left, y, chartW, barH, 4);
      ctx.fill();

      // Bar value
      const color = d.color || this.COLORS.teal;
      const grad = ctx.createLinearGradient(pad.left, 0, pad.left + barW, 0);
      grad.addColorStop(0, color + 'cc');
      grad.addColorStop(1, color);
      ctx.fillStyle = grad;
      this._roundRect(ctx, pad.left, y, Math.max(barW, 4), barH, 4);
      ctx.fill();

      // Value text
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 11px Inter, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(d.valueLabel || d.value.toFixed(1), pad.left + barW + 8, y + barH / 2);
    });
  }

  // ===== RADAR CHART =====
  static drawRadar(canvas, data, opts = {}) {
    const ctx = canvas.getContext('2d');
    const w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    const cx = w / 2, cy = h / 2;
    const r = Math.min(w, h) * 0.36;
    const n = data.length;
    if (n < 3) return;

    const angleStep = (Math.PI * 2) / n;

    // Grid rings
    for (let ring = 1; ring <= 5; ring++) {
      const rr = (r / 5) * ring;
      ctx.beginPath();
      for (let i = 0; i <= n; i++) {
        const a = -Math.PI / 2 + angleStep * i;
        const x = cx + rr * Math.cos(a);
        const y = cy + rr * Math.sin(a);
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.strokeStyle = 'rgba(255,255,255,0.06)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    // Spokes
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + angleStep * i;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + r * Math.cos(a), cy + r * Math.sin(a));
      ctx.strokeStyle = 'rgba(255,255,255,0.06)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    // Optimal range fill
    if (opts.showOptimal) {
      ctx.beginPath();
      for (let i = 0; i <= n; i++) {
        const idx = i % n;
        const a = -Math.PI / 2 + angleStep * idx;
        const pct = (data[idx].optMax || 0.8) * r;
        const x = cx + pct * Math.cos(a);
        const y = cy + pct * Math.sin(a);
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.fillStyle = 'rgba(34,197,94,0.08)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(34,197,94,0.25)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    // Data polygon
    ctx.beginPath();
    for (let i = 0; i <= n; i++) {
      const idx = i % n;
      const a = -Math.PI / 2 + angleStep * idx;
      const pct = Math.min(data[idx].pct || 0, 1) * r;
      const x = cx + pct * Math.cos(a);
      const y = cy + pct * Math.sin(a);
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    const color = opts.color || this.COLORS.teal;
    ctx.fillStyle = color + '25';
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.stroke();

    // Data points
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + angleStep * i;
      const pct = Math.min(data[i].pct || 0, 1) * r;
      const x = cx + pct * Math.cos(a);
      const y = cy + pct * Math.sin(a);

      ctx.beginPath();
      ctx.arc(x, y, 4, 0, Math.PI * 2);
      ctx.fillStyle = data[i].color || color;
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    // Labels
    ctx.font = '600 11px Inter, sans-serif';
    ctx.textBaseline = 'middle';
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + angleStep * i;
      const lx = cx + (r + 24) * Math.cos(a);
      const ly = cy + (r + 24) * Math.sin(a);
      ctx.textAlign = Math.abs(a + Math.PI / 2) < 0.1 ? 'center' :
        (lx > cx ? 'left' : 'right');
      ctx.fillStyle = data[i].color || this.COLORS.text;
      ctx.fillText(data[i].label, lx, ly);
    }
  }

  // ===== DONUT CHART =====
  static drawDonut(canvas, segments, centerText, opts = {}) {
    const ctx = canvas.getContext('2d');
    const w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    const cx = w / 2, cy = h / 2;
    const outerR = Math.min(w, h) * 0.4;
    const innerR = outerR * 0.65;
    const total = segments.reduce((s, d) => s + d.value, 0);
    let startA = -Math.PI / 2;

    for (const seg of segments) {
      const sweep = (seg.value / total) * Math.PI * 2;
      ctx.beginPath();
      ctx.arc(cx, cy, outerR, startA, startA + sweep);
      ctx.arc(cx, cy, innerR, startA + sweep, startA, true);
      ctx.closePath();
      ctx.fillStyle = seg.color;
      ctx.fill();
      startA += sweep;
    }

    // Center text
    if (centerText) {
      ctx.fillStyle = '#ffffff';
      ctx.font = `bold ${opts.centerFontSize || 20}px Inter, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(centerText, cx, cy - 6);
      if (opts.centerSub) {
        ctx.fillStyle = this.COLORS.muted;
        ctx.font = '500 11px Inter, sans-serif';
        ctx.fillText(opts.centerSub, cx, cy + 14);
      }
    }
  }

  // ===== NUTRIENT STATUS BARS =====
  static drawNutrientBars(canvas, nutrients, opts = {}) {
    const ctx = canvas.getContext('2d');
    const w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    const pad = { top: 16, right: 90, bottom: 8, left: 90 };
    const barH = 22;
    const gap = 10;
    const chartW = w - pad.left - pad.right;

    // Classification zones across the bar
    const zones = [
      { label: 'MB', pct: 0.15, color: '#ef4444' },
      { label: 'B', pct: 0.20, color: '#f97316' },
      { label: 'M', pct: 0.20, color: '#eab308' },
      { label: 'A', pct: 0.25, color: '#22c55e' },
      { label: 'MA', pct: 0.20, color: '#3b82f6' }
    ];

    nutrients.forEach((nut, i) => {
      const y = pad.top + i * (barH + gap);

      // Label
      ctx.fillStyle = this.COLORS.text;
      ctx.font = '600 12px Inter, sans-serif';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.fillText(nut.label, pad.left - 12, y + barH / 2);

      // Zone backgrounds
      let zx = pad.left;
      for (const z of zones) {
        const zw = chartW * z.pct;
        ctx.fillStyle = z.color + '18';
        ctx.fillRect(zx, y, zw, barH);
        zx += zw;
      }

      // Border
      ctx.strokeStyle = 'rgba(255,255,255,0.06)';
      ctx.lineWidth = 1;
      ctx.strokeRect(pad.left, y, chartW, barH);

      // Marker position
      const classIdx = { mb: 0.075, b: 0.25, m: 0.45, a: 0.65, ma: 0.87, def: 0.075, ad: 0.65, ex: 0.87, nulo: 0.65, bajo: 0.25, medio: 0.45, alto: 0.75, muyAlto: 0.87 };
      const pos = classIdx[nut.class] ?? 0.5;
      const mx = pad.left + chartW * pos;

      // Marker
      ctx.beginPath();
      ctx.arc(mx, y + barH / 2, 7, 0, Math.PI * 2);
      ctx.fillStyle = this.COLORS.classColors[nut.class] || '#eab308';
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.stroke();

      // Value + classification
      ctx.fillStyle = this.COLORS.classColors[nut.class] || this.COLORS.text;
      ctx.font = 'bold 12px Inter, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(`${nut.value} ${nut.classLabel || ''}`, pad.left + chartW + 10, y + barH / 2);
    });
  }

  // ===== DRIS BAR CHART (horizontal diverging) =====
  static drawDRISChart(canvas, drisData, opts = {}) {
    const ctx = canvas.getContext('2d');
    const w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    const pad = { top: 12, right: 100, bottom: 12, left: 50 };
    const barH = 24;
    const gap = 6;
    const maxAbs = Math.max(...drisData.map(d => Math.abs(d.index)), 1);
    const centerX = pad.left + (w - pad.left - pad.right) / 2;
    const halfW = (w - pad.left - pad.right) / 2;

    // Center line
    ctx.beginPath();
    ctx.moveTo(centerX, pad.top - 4);
    ctx.lineTo(centerX, pad.top + drisData.length * (barH + gap));
    ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.stroke();
    ctx.setLineDash([]);

    drisData.forEach((d, i) => {
      const y = pad.top + i * (barH + gap);
      const barW = (Math.abs(d.index) / maxAbs) * halfW * 0.9;
      const color = d.status === 'deficiente' ? '#ef4444' : d.status === 'limitante' ? '#f97316'
        : d.status === 'excesivo' ? '#3b82f6' : d.status === 'consumo lujoso' ? '#60a5fa' : '#22c55e';

      // Background
      ctx.fillStyle = 'rgba(255,255,255,0.03)';
      ctx.fillRect(pad.left, y, w - pad.left - pad.right, barH);

      // Bar
      const grad = ctx.createLinearGradient(
        d.index < 0 ? centerX - barW : centerX,
        0,
        d.index < 0 ? centerX : centerX + barW,
        0
      );
      grad.addColorStop(d.index < 0 ? 1 : 0, color + '40');
      grad.addColorStop(d.index < 0 ? 0 : 1, color);
      ctx.fillStyle = grad;

      if (d.index < 0) {
        this._roundRect(ctx, centerX - barW, y + 1, barW, barH - 2, 3);
      } else {
        this._roundRect(ctx, centerX, y + 1, barW, barH - 2, 3);
      }
      ctx.fill();

      // Nutrient label
      ctx.fillStyle = this.COLORS.text;
      ctx.font = 'bold 12px Inter, sans-serif';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.fillText(d.nutrient, pad.left - 8, y + barH / 2);

      // Index + status
      ctx.fillStyle = color;
      ctx.font = 'bold 11px Inter, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(`${d.index > 0 ? '+' : ''}${d.index}`, w - pad.right + 8, y + barH / 2 - 6);
      ctx.font = '500 10px Inter, sans-serif';
      ctx.fillText(d.status, w - pad.right + 8, y + barH / 2 + 8);
    });
  }

  // ===== RELATIONSHIP RADAR =====
  static buildRelationshipRadar(canvas, relationships) {
    const data = relationships.map(r => {
      const optMid = ((r.optMin || 0) + (r.optMax || 10)) / 2;
      const pct = Math.min(r.value / (optMid * 2), 1);
      const isOk = r.value >= (r.optMin || 0) && r.value <= (r.optMax || 999);
      return {
        label: r.name,
        pct,
        color: isOk ? '#22c55e' : r.value < (r.optMin || 0) ? '#f97316' : '#3b82f6'
      };
    });
    this.drawRadar(canvas, data, { showOptimal: true, color: '#00A4CC' });
  }

  // ===== SCORE CALCULATION =====
  static calculateSoilScore(soilInterp) {
    if (!soilInterp?.nutrients) return 0;
    const weights = { a: 100, ma: 85, m: 65, b: 35, mb: 10, ad: 100, ex: 85, def: 10, nulo: 100, bajo: 35, medio: 65, alto: 35, muyAlto: 10 };
    const entries = Object.values(soilInterp.nutrients);
    if (entries.length === 0) return 0;
    const total = entries.reduce((s, n) => s + (weights[n.class] || 50), 0);
    return Math.round(total / entries.length);
  }

  // ===== FULL REPORT BUILDER =====
  static generateReport(admin) {
    const { cropId, yieldTarget, soilData, leafData, pMethod, phMethod, unitSystem, samples, clientData } = admin;
    const cd = clientData || {};
    const crop = CROPS_DB[cropId];
    if (!crop) return '<div class="empty-state"><h3>Seleccione un cultivo</h3></div>';

    const hasSoil = Object.keys(soilData).length > 0;
    const hasLeaf = Object.keys(leafData).length > 0;
    if (!hasSoil && !hasLeaf) {
      return `<div class="empty-state">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6"/></svg>
        <h3>Sin datos para el reporte</h3>
        <p>Ingresá datos de análisis de suelo y/o foliar primero</p>
        <button class="btn btn-primary" onclick="admin.showView('soil')" style="margin-top:16px">Cargar Análisis</button>
      </div>`;
    }

    const options = { pMethod, phMethod, unitSystem };
    let soilInterp = null, normalizedData = null, relationships = [], liming = null, gypsum = null, fert = null, products = [];
    let leafInterp = null, dris = null, cross = [];

    if (hasSoil) {
      soilInterp = InterpretationEngine.interpretSoil(soilData, cropId, options);
      normalizedData = InterpretationEngine.normalizeLabData(soilData, unitSystem);
      relationships = InterpretationEngine.analyzeRelationships(normalizedData, cropId);
      liming = InterpretationEngine.calculateLiming(normalizedData, cropId);
      gypsum = InterpretationEngine.calculateGypsum(normalizedData, cropId);
      fert = InterpretationEngine.calculateFertilization(normalizedData, cropId, yieldTarget);
      products = InterpretationEngine.calculateProducts(fert);
    }
    if (hasLeaf) {
      leafInterp = InterpretationEngine.interpretLeaf(leafData, cropId);
      dris = InterpretationEngine.calculateDRIS(leafData, cropId);
    }
    if (hasSoil && hasLeaf) {
      cross = InterpretationEngine.crossDiagnosis(soilInterp, leafInterp);
    }

    const soilScore = soilInterp ? this.calculateSoilScore(soilInterp) : null;
    const now = new Date();
    const dateStr = now.toLocaleDateString('es-ES', { day: '2-digit', month: 'long', year: 'numeric' });
    const pMethodName = P_METHODS[pMethod]?.name || pMethod;
    const phMethodName = phMethod === 'cacl2' ? 'CaCl₂' : 'H₂O';

    let html = '';

    // ========== COVER HEADER ==========
    const hasClient = cd.nombre || cd.propiedad;
    html += `
    <div class="rpt-cover">
      <div class="rpt-cover-brand">
        <img src="img/Logo.png" alt="Pixadvisor" class="rpt-logo">
        <div class="rpt-cover-title">
          <h1>Reporte de Fertilidad</h1>
          <p>Análisis Completo de Suelo ${hasLeaf ? '& Foliar' : ''}</p>
        </div>
      </div>
      ${hasClient ? `
      <div class="rpt-client-info">
        <div class="rpt-client-grid">
          ${cd.nombre ? `<div class="rpt-client-item"><span class="rpt-client-label">Cliente</span><span class="rpt-client-value">${cd.nombre}</span></div>` : ''}
          ${cd.propiedad ? `<div class="rpt-client-item"><span class="rpt-client-label">Propiedad</span><span class="rpt-client-value">${cd.propiedad}</span></div>` : ''}
          ${cd.ubicacion ? `<div class="rpt-client-item"><span class="rpt-client-label">Ubicación</span><span class="rpt-client-value">${cd.ubicacion}</span></div>` : ''}
          ${cd.lote ? `<div class="rpt-client-item"><span class="rpt-client-label">Lote</span><span class="rpt-client-value">${cd.lote}</span></div>` : ''}
          ${cd.area ? `<div class="rpt-client-item"><span class="rpt-client-label">Área</span><span class="rpt-client-value">${cd.area}</span></div>` : ''}
          ${cd.responsable ? `<div class="rpt-client-item"><span class="rpt-client-label">Responsable</span><span class="rpt-client-value">${cd.responsable}</span></div>` : ''}
          ${cd.laboratorio ? `<div class="rpt-client-item"><span class="rpt-client-label">Laboratorio</span><span class="rpt-client-value">${cd.laboratorio}</span></div>` : ''}
          ${cd.nMuestra ? `<div class="rpt-client-item"><span class="rpt-client-label">N° Muestra</span><span class="rpt-client-value">${cd.nMuestra}</span></div>` : ''}
        </div>
      </div>` : ''}
      <div class="rpt-cover-meta">
        <div class="rpt-meta-item">
          <span class="rpt-meta-label">Cultivo</span>
          <span class="rpt-meta-value">${crop.name}</span>
          <span class="rpt-meta-sub"><em>${crop.scientific}</em></span>
        </div>
        <div class="rpt-meta-item">
          <span class="rpt-meta-label">Meta rendimiento</span>
          <span class="rpt-meta-value">${yieldTarget} ${crop.yieldUnit}</span>
        </div>
        <div class="rpt-meta-item">
          <span class="rpt-meta-label">Método Lab</span>
          <span class="rpt-meta-value">${pMethodName}</span>
          <span class="rpt-meta-sub">pH: ${phMethodName}</span>
        </div>
        <div class="rpt-meta-item">
          <span class="rpt-meta-label">Fecha</span>
          <span class="rpt-meta-value">${dateStr}</span>
        </div>
      </div>
    </div>`;

    // ========== EXECUTIVE SUMMARY ==========
    html += `<div class="rpt-section">
      <div class="rpt-section-title">
        <div class="rpt-section-icon">1</div>
        Resumen Ejecutivo
      </div>
      <div class="rpt-summary-grid">
        <div class="rpt-gauge-card">
          <canvas id="rptGaugeSoil" width="200" height="160"></canvas>
          <div class="rpt-gauge-label">Índice de Fertilidad</div>
        </div>`;

    if (soilInterp) {
      // Count classes
      const counts = { ok: 0, low: 0, high: 0, total: 0 };
      for (const n of Object.values(soilInterp.nutrients)) {
        counts.total++;
        if (['a', 'ad', 'nulo'].includes(n.class)) counts.ok++;
        else if (['mb', 'b', 'def'].includes(n.class)) counts.low++;
        else if (['ma', 'ex', 'muyAlto', 'alto'].includes(n.class)) counts.high++;
      }
      html += `
        <div class="rpt-gauge-card">
          <canvas id="rptDonutStatus" width="180" height="160"></canvas>
          <div class="rpt-gauge-label">Estado Nutrientes</div>
        </div>
        <div class="rpt-summary-stats">
          <div class="rpt-stat-mini rpt-stat-ok"><span class="rpt-stat-num">${counts.ok + Object.values(soilInterp.nutrients).filter(n => n.class === 'm' || n.class === 'medio').length}</span><span>Adecuados</span></div>
          <div class="rpt-stat-mini rpt-stat-low"><span class="rpt-stat-num">${counts.low}</span><span>Deficientes</span></div>
          <div class="rpt-stat-mini rpt-stat-high"><span class="rpt-stat-num">${counts.high}</span><span>Exceso</span></div>
          <div class="rpt-stat-mini rpt-stat-alert"><span class="rpt-stat-num">${soilInterp.alerts.length}</span><span>Alertas</span></div>
        </div>`;
    }
    html += `</div></div>`;

    // ========== ALERTS ==========
    if (soilInterp?.alerts?.length > 0) {
      html += `<div class="rpt-section">
        <div class="rpt-section-title"><div class="rpt-section-icon">!</div>Alertas Agronómicas</div>
        <div class="rpt-alerts">`;
      for (const a of soilInterp.alerts) {
        const icon = a.type === 'danger' ? '&#9888;' : a.type === 'warning' ? '&#9888;' : '&#9432;';
        html += `<div class="rpt-alert rpt-alert-${a.type}"><span class="rpt-alert-icon">${icon}</span>${a.msg}</div>`;
      }
      html += '</div></div>';
    }

    // ========== SOIL INTERPRETATION ==========
    if (soilInterp) {
      html += `<div class="rpt-section">
        <div class="rpt-section-title"><div class="rpt-section-icon">2</div>Interpretación de Suelo</div>
        <div class="rpt-dual-panel">
          <div class="rpt-panel-left">
            <canvas id="rptNutrientBars" width="560" height="${Object.keys(soilInterp.nutrients).length * 32 + 30}"></canvas>
          </div>
          <div class="rpt-panel-right">
            <table class="rpt-table">
              <thead><tr><th>Parámetro</th><th>Valor</th><th>Unidad</th><th>Clase</th></tr></thead>
              <tbody>`;
      for (const [key, n] of Object.entries(soilInterp.nutrients)) {
        const val = n.displayValue !== undefined ? n.displayValue : n.value;
        const valStr = typeof val === 'number' ? val.toFixed(n.decimals || 1) : val;
        const clsColor = this.COLORS.classColors[n.class] || '#eab308';
        html += `<tr>
          <td>${n.label}</td>
          <td class="rpt-val">${valStr}</td>
          <td class="rpt-unit">${n.unit}</td>
          <td><span class="rpt-badge" style="background:${clsColor}20;color:${clsColor}">${n.label_class || CLASS_LABELS[n.class] || n.class}</span></td>
        </tr>`;
      }
      html += `</tbody></table>
          </div>
        </div>`;

      // Texture info
      if (soilInterp.calculated?.texture) {
        html += `<div class="rpt-texture-bar">
          <span>Textura: <strong>${soilInterp.calculated.texture.class}</strong></span>
          <span>Grupo: <strong>${soilInterp.calculated.texture.group}</strong></span>
          ${soilData.clay ? `<span>Arcilla: <strong>${soilData.clay}%</strong></span>` : ''}
          ${soilData.sand ? `<span>Arena: <strong>${soilData.sand}%</strong></span>` : ''}
        </div>`;
      }
      html += '</div>';
    }

    // ========== NUTRIENT RELATIONSHIPS ==========
    if (relationships.length > 0) {
      html += `<div class="rpt-section">
        <div class="rpt-section-title"><div class="rpt-section-icon">3</div>Relaciones entre Nutrientes</div>
        <div class="rpt-dual-panel">
          <div class="rpt-panel-left" style="display:flex;justify-content:center;align-items:center">
            <canvas id="rptRelRadar" width="340" height="340"></canvas>
          </div>
          <div class="rpt-panel-right">
            <div class="rpt-rel-grid">`;
      for (const r of relationships) {
        const isOk = r.value >= (r.optMin || 0) && r.value <= (r.optMax || 999);
        html += `<div class="rpt-rel-item">
          <div class="rpt-rel-val" style="color:${r.color}">${r.value.toFixed(1)}</div>
          <div class="rpt-rel-detail">
            <div class="rpt-rel-name">${r.name}</div>
            <div class="rpt-rel-range">Óptimo: ${r.optMin}–${r.optMax}</div>
            <div class="rpt-rel-diag" style="color:${r.color}">${r.diagnostic}</div>
          </div>
        </div>`;
      }
      html += '</div></div></div></div>';
    }

    // ========== DRIS DIAGNOSIS ==========
    if (dris && !dris.error && dris.order?.length > 0) {
      const balanced = dris.balanced;
      html += `<div class="rpt-section">
        <div class="rpt-section-title"><div class="rpt-section-icon">4</div>Diagnóstico DRIS (Foliar)</div>
        <div class="rpt-dris-header">
          <div class="rpt-dris-stat"><span>IBN</span><strong style="color:${balanced ? '#22c55e' : '#f97316'}">${dris.ibn}</strong></div>
          <div class="rpt-dris-stat"><span>IBNm</span><strong style="color:${balanced ? '#22c55e' : '#f97316'}">${dris.ibnm}</strong></div>
          <div class="rpt-dris-stat"><span>Estado</span><strong style="color:${balanced ? '#22c55e' : '#f97316'}">${balanced ? 'Equilibrado' : 'Desbalanceado'}</strong></div>
        </div>
        <canvas id="rptDRISChart" width="700" height="${dris.order.length * 30 + 30}"></canvas>`;

      const limiting = dris.order.filter(d => d.index < -5);
      if (limiting.length > 0) {
        html += `<div class="rpt-limitation-order">
          <strong>Orden de limitación:</strong> ${limiting.map(d => `<span class="rpt-lim-nutrient">${d.nutrient}</span>`).join(' → ')}
        </div>`;
      }
      html += '</div>';
    }

    // ========== LEAF INTERPRETATION TABLE ==========
    if (leafInterp) {
      html += `<div class="rpt-section">
        <div class="rpt-section-title"><div class="rpt-section-icon">${dris ? '5' : '4'}</div>Interpretación Foliar</div>
        <table class="rpt-table">
          <thead><tr><th>Nutriente</th><th>Valor</th><th>Unidad</th><th>Rango Suficiencia</th><th>Clase</th></tr></thead>
          <tbody>`;
      for (const [key, n] of Object.entries(leafInterp.nutrients)) {
        const clsColor = this.COLORS.classColors[n.class] || '#eab308';
        const range = crop.leafRanges?.[key];
        const rangeStr = range ? `${range.low}–${range.high}` : '—';
        html += `<tr>
          <td>${n.label}</td>
          <td class="rpt-val">${n.value}</td>
          <td class="rpt-unit">${n.unit}</td>
          <td class="rpt-unit">${rangeStr}</td>
          <td><span class="rpt-badge" style="background:${clsColor}20;color:${clsColor}">${CLASS_LABELS[n.class] || n.class}</span></td>
        </tr>`;
      }
      html += '</tbody></table></div>';
    }

    // ========== CROSS DIAGNOSIS ==========
    if (cross.length > 0) {
      const secNum = (dris ? 6 : hasLeaf ? 5 : 4);
      html += `<div class="rpt-section">
        <div class="rpt-section-title"><div class="rpt-section-icon">${secNum}</div>Diagnóstico Cruzado Suelo × Hoja</div>
        <div class="rpt-cross-grid">`;
      for (const d of cross) {
        const type = d.type.includes('low') ? 'danger' : d.type.includes('ok') ? 'success' : 'warning';
        const icon = type === 'danger' ? '&#10060;' : type === 'success' ? '&#9989;' : '&#9888;';
        html += `<div class="rpt-cross-card rpt-cross-${type}">
          <span class="rpt-cross-icon">${icon}</span>
          <div>${d.msg}</div>
        </div>`;
      }
      html += '</div></div>';
    }

    // ========== LIMING & GYPSUM ==========
    if (liming || gypsum) {
      const secNum2 = (cross.length > 0 ? 7 : dris ? 6 : 5);
      html += `<div class="rpt-section">
        <div class="rpt-section-title"><div class="rpt-section-icon">${secNum2}</div>Enmiendas</div>
        <div class="rpt-amend-grid">`;
      if (liming) {
        html += `<div class="rpt-amend-card ${liming.needed ? 'rpt-amend-needed' : 'rpt-amend-ok'}">
          <div class="rpt-amend-title">Encalado</div>
          <div class="rpt-amend-msg">${liming.msg}</div>`;
        if (liming.needed) {
          html += `<div class="rpt-amend-stats">
            <div><span>${liming.dose_t_ha}</span><small>t/ha ${liming.source}</small></div>
            <div><span>${liming.currentV.toFixed(0)}% → ${liming.targetV}%</span><small>V% actual → meta</small></div>
            <div><span>${liming.CTC.toFixed(0)}</span><small>CTC mmolc/dm³</small></div>
          </div>`;
        }
        html += '</div>';
      }
      if (gypsum) {
        html += `<div class="rpt-amend-card ${gypsum.needed ? 'rpt-amend-needed' : 'rpt-amend-ok'}">
          <div class="rpt-amend-title">Yeso Agrícola</div>
          <div class="rpt-amend-msg">${gypsum.msg}</div>`;
        if (gypsum.needed) {
          html += `<div class="rpt-amend-stats">
            <div><span>${gypsum.dose_t_ha}</span><small>t/ha yeso</small></div>
          </div>`;
        }
        html += '</div>';
      }
      html += '</div></div>';
    }

    // ========== FERTILIZATION RECOMMENDATION ==========
    if (fert) {
      html += `<div class="rpt-section">
        <div class="rpt-section-title"><div class="rpt-section-icon rpt-icon-fert">F</div>Recomendación de Fertilización</div>
        <div class="rpt-fert-header">
          <span>Cultivo: <strong>${fert.crop}</strong></span>
          <span>Meta: <strong>${fert.yieldTarget} ${fert.yieldUnit}</strong></span>
          <span>Método: <strong>${pMethodName}</strong></span>
        </div>
        <table class="rpt-table rpt-table-fert">
          <thead><tr>
            <th>Nutriente</th><th>Extracción<br><small>kg/ha</small></th><th>Nivel<br>Suelo</th>
            <th>Nec. Neta<br><small>kg/ha</small></th><th>Efic.<br><small>%</small></th>
            <th>Dosis<br><small>kg/ha</small></th>
          </tr></thead>
          <tbody>`;
      for (const n of fert.nutrients.filter(x => !x.isMicro)) {
        const clsColor = this.COLORS.classColors[n.soilClass] || '#eab308';
        html += `<tr>
          <td><strong>${n.label}</strong></td>
          <td class="rpt-val">${n.extraction}</td>
          <td><span class="rpt-badge" style="background:${clsColor}20;color:${clsColor}">${n.soilLevel}</span></td>
          <td class="rpt-val">${n.netNeed}</td>
          <td class="rpt-unit">${n.efficiency}%</td>
          <td class="rpt-val rpt-dose">${n.doseKgHa}</td>
        </tr>`;
      }
      html += '</tbody></table>';

      // Micros
      const micros = fert.nutrients.filter(x => x.isMicro);
      if (micros.length > 0) {
        html += '<div class="rpt-micro-grid">';
        for (const m of micros) {
          const clsColor = this.COLORS.classColors[m.soilClass] || '#eab308';
          html += `<div class="rpt-micro-card">
            <div class="rpt-micro-val">${m.doseKgHa}</div>
            <div class="rpt-micro-label">${m.label} <small>kg/ha</small></div>
            <span class="rpt-badge" style="background:${clsColor}20;color:${clsColor}">${m.soilLevel}</span>
          </div>`;
        }
        html += '</div>';
      }
      html += '</div>';
    }

    // ========== PRODUCTS TABLE ==========
    if (products.length > 0) {
      html += `<div class="rpt-section">
        <div class="rpt-section-title"><div class="rpt-section-icon rpt-icon-prod">P</div>Productos Recomendados</div>
        <table class="rpt-table">
          <thead><tr><th>Nutriente</th><th>Producto / Fuente</th><th>Conc.</th><th>Dosis nutriente</th><th>Producto kg/ha</th></tr></thead>
          <tbody>`;
      for (const p of products) {
        html += `<tr>
          <td>${p.label}</td><td>${p.source}</td><td class="rpt-unit">${p.nutrientContent}%</td>
          <td class="rpt-val">${p.nutrientDose} kg/ha</td><td class="rpt-val rpt-dose">${p.productKgHa} kg/ha</td>
        </tr>`;
      }
      html += '</tbody></table></div>';
    }

    // ========== INTERPOLATED NUTRIENT MAPS ==========
    const geoSamples = (admin.samples || []).filter(s => s.lat && s.lng && s.soilData && Object.keys(s.soilData).length > 0);
    const hasGeoData = geoSamples.length >= 3;
    const polygon = admin._boundaryPolygon || admin.fieldPolygon || null;

    if (hasGeoData) {
      // Determine which nutrients have enough data for interpolation
      const mappableNutrients = ['pH_H2O','MO','P','K','Ca','Mg','V','Al','H_Al','S','B','Cu','Fe','Mn','Zn','CTC','SB','clay'];
      const nutrientsWithData = mappableNutrients.filter(n =>
        geoSamples.filter(s => s.soilData[n] !== undefined && s.soilData[n] !== null).length >= 3
      );

      if (nutrientsWithData.length > 0) {
        html += `<div class="rpt-section">
          <div class="rpt-section-title"><div class="rpt-section-icon">M</div>Mapas de Fertilidad por Nutriente</div>
          <p style="color:var(--text-muted);font-size:13px;margin-bottom:16px">
            Interpolación IDW con ${geoSamples.length} puntos de muestreo${polygon ? ' — recortado al perímetro del lote' : ''}
          </p>
          <div class="rpt-maps-grid">`;

        for (const nut of nutrientsWithData) {
          const info = typeof NUTRIENT_INFO !== 'undefined' ? NUTRIENT_INFO[nut] : null;
          const label = info?.label || nut;
          const unit = info?.unit || '';
          html += `<div class="rpt-map-thumb">
            <div class="rpt-map-render" id="rptMap_${nut}" data-nutrient="${nut}" style="min-height:180px;display:flex;align-items:center;justify-content:center;background:var(--dark-3)">
              <span style="color:var(--text-dim);font-size:12px">Generando...</span>
            </div>
            <div class="rpt-map-caption"><strong>${label}</strong>${unit ? ` <span style="color:var(--text-dim)">(${unit})</span>` : ''}</div>
          </div>`;
        }
        html += '</div></div>';
      }

      // ========== NUTRIENT RELATIONSHIP MAPS ==========
      if (relationships.length > 0 && nutrientsWithData.includes('Ca') && nutrientsWithData.includes('Mg')) {
        const relMaps = [];
        // Ca/Mg ratio map
        if (nutrientsWithData.includes('Ca') && nutrientsWithData.includes('Mg')) relMaps.push({ id: 'Ca_Mg', label: 'Ca/Mg', calc: d => (d.Ca || 0) / Math.max(d.Mg || 1, 0.1) });
        // Ca/K ratio map
        if (nutrientsWithData.includes('Ca') && nutrientsWithData.includes('K')) relMaps.push({ id: 'Ca_K', label: 'Ca/K', calc: d => (d.Ca || 0) / Math.max(d.K || 1, 0.01) });
        // Mg/K ratio map
        if (nutrientsWithData.includes('Mg') && nutrientsWithData.includes('K')) relMaps.push({ id: 'Mg_K', label: 'Mg/K', calc: d => (d.Mg || 0) / Math.max(d.K || 1, 0.01) });
        // V% (already a nutrient, but important for relationships)
        // (Ca+Mg)/K
        if (nutrientsWithData.includes('Ca') && nutrientsWithData.includes('Mg') && nutrientsWithData.includes('K'))
          relMaps.push({ id: 'CaMg_K', label: '(Ca+Mg)/K', calc: d => ((d.Ca || 0) + (d.Mg || 0)) / Math.max(d.K || 1, 0.01) });

        if (relMaps.length > 0) {
          html += `<div class="rpt-section">
            <div class="rpt-section-title"><div class="rpt-section-icon">R</div>Mapas de Relaciones entre Nutrientes</div>
            <p style="color:var(--text-muted);font-size:13px;margin-bottom:16px">
              Distribución espacial de relaciones catiónicas — ${polygon ? 'recortado al perímetro' : `${geoSamples.length} puntos`}
            </p>
            <div class="rpt-maps-grid">`;

          for (const rm of relMaps) {
            // Find optimal range from relationships array
            const relData = relationships.find(r => r.name === rm.label);
            const optRange = relData ? `Óptimo: ${relData.optMin}–${relData.optMax}` : '';
            html += `<div class="rpt-map-thumb">
              <div class="rpt-map-render" id="rptRelMap_${rm.id}" data-rel-id="${rm.id}" style="min-height:180px;display:flex;align-items:center;justify-content:center;background:var(--dark-3)">
                <span style="color:var(--text-dim);font-size:12px">Generando...</span>
              </div>
              <div class="rpt-map-caption"><strong>${rm.label}</strong>${optRange ? ` <span style="color:var(--text-dim)">${optRange}</span>` : ''}</div>
            </div>`;
          }
          html += '</div></div>';
        }
      }
    }

    // ========== LEGACY MAP THUMBNAILS (non-GIS) ==========
    if (!hasGeoData && (admin.maps?.nutrient || admin.maps?.prescription)) {
      html += `<div class="rpt-section">
        <div class="rpt-section-title"><div class="rpt-section-icon">M</div>Mapas Geoespaciales</div>
        <div class="rpt-maps-grid">`;
      if (admin.maps?.nutrient) {
        html += `<div class="rpt-map-thumb">
          <canvas id="rptMapNutrient" width="500" height="350"></canvas>
          <div class="rpt-map-caption">Mapa de Interpolación IDW</div>
        </div>`;
      }
      if (admin.maps?.prescription) {
        html += `<div class="rpt-map-thumb">
          <canvas id="rptMapPresc" width="500" height="350"></canvas>
          <div class="rpt-map-caption">Mapa de Prescripción VRT</div>
        </div>`;
      }
      html += '</div></div>';
    }

    // ========== FOOTER ==========
    html += `<div class="rpt-footer">
      <div class="rpt-footer-brand">
        <img src="img/Logo.png" alt="Pixadvisor" style="height:28px">
        <span>Pixadvisor Agricultura de Precisión</span>
      </div>
      <div class="rpt-footer-info">
        <span>Generado: ${now.toLocaleString('es-ES')}</span>
        <span>pixadvisor.network</span>
      </div>
    </div>`;

    // ========== PRINT BUTTON ==========
    html += `<div class="rpt-actions no-print">
      <button class="btn btn-primary" onclick="window.print()">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9V2h12v7"/><path d="M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
        Imprimir / PDF
      </button>
      <button class="btn btn-secondary" onclick="admin.showView('soil')">Volver a Análisis</button>
    </div>`;

    return html;
  }

  // ===== POST-RENDER: Draw all canvases =====
  static _autoSize(canvas, heightOverride) {
    const parent = canvas.parentElement;
    if (!parent) return;
    const pw = parent.offsetWidth;
    if (pw > 0) {
      canvas.width = pw;
      if (heightOverride) canvas.height = heightOverride;
    }
  }

  static renderCharts(admin) {
    const { soilData, leafData, cropId, pMethod, phMethod, unitSystem } = admin;
    const options = { pMethod, phMethod, unitSystem };

    // Soil gauge
    const gaugeCanvas = document.getElementById('rptGaugeSoil');
    if (gaugeCanvas) {
      const soilInterp = InterpretationEngine.interpretSoil(soilData, cropId, options);
      const score = this.calculateSoilScore(soilInterp);
      const color = score >= 75 ? '#22c55e' : score >= 50 ? '#eab308' : score >= 30 ? '#f97316' : '#ef4444';
      this.drawGauge(gaugeCanvas, score, 100, 'Puntaje', color, { decimals: 0, fontSize: 32 });
    }

    // Donut chart
    const donutCanvas = document.getElementById('rptDonutStatus');
    if (donutCanvas) {
      const soilInterp = InterpretationEngine.interpretSoil(soilData, cropId, options);
      const counts = { ok: 0, low: 0, med: 0, high: 0 };
      for (const n of Object.values(soilInterp.nutrients)) {
        if (['a', 'ad', 'nulo'].includes(n.class)) counts.ok++;
        else if (['mb', 'b', 'def'].includes(n.class)) counts.low++;
        else if (['m', 'medio'].includes(n.class)) counts.med++;
        else counts.high++;
      }
      const segments = [
        { value: counts.ok, color: '#22c55e' },
        { value: counts.med, color: '#eab308' },
        { value: counts.low, color: '#ef4444' },
        { value: counts.high, color: '#3b82f6' }
      ].filter(s => s.value > 0);
      const total = Object.values(soilInterp.nutrients).length;
      this.drawDonut(donutCanvas, segments, `${total}`, { centerSub: 'parámetros' });
    }

    // Nutrient status bars
    const barsCanvas = document.getElementById('rptNutrientBars');
    if (barsCanvas) {
      const soilInterp = InterpretationEngine.interpretSoil(soilData, cropId, options);
      const nutData = Object.entries(soilInterp.nutrients).map(([k, n]) => ({
        label: n.label.replace(/ *\(.*\)/, '').substring(0, 10),
        value: n.displayValue !== undefined ? n.displayValue : n.value,
        class: n.class,
        classLabel: CLASS_LABELS[n.class] || n.class
      }));
      this._autoSize(barsCanvas, nutData.length * 32 + 30);
      this.drawNutrientBars(barsCanvas, nutData);
    }

    // Relationship radar
    const radarCanvas = document.getElementById('rptRelRadar');
    if (radarCanvas) {
      const normalizedData = InterpretationEngine.normalizeLabData(soilData, unitSystem);
      const relationships = InterpretationEngine.analyzeRelationships(normalizedData, cropId);
      if (relationships.length >= 3) {
        this.buildRelationshipRadar(radarCanvas, relationships);
      }
    }

    // DRIS chart
    const drisCanvas = document.getElementById('rptDRISChart');
    if (drisCanvas && Object.keys(leafData).length > 0) {
      const dris = InterpretationEngine.calculateDRIS(leafData, cropId);
      if (!dris.error && dris.order?.length > 0) {
        this._autoSize(drisCanvas, dris.order.length * 30 + 30);
        this.drawDRISChart(drisCanvas, dris.order);
      }
    }

    // Map snapshots (legacy)
    this._captureMap('rptMapNutrient', admin.maps?.nutrient);
    this._captureMap('rptMapPresc', admin.maps?.prescription);

    // GIS Dashboard map snapshot
    this._captureGISMap(admin);

    // Generate per-nutrient interpolated maps for report
    this._renderReportNutrientMaps(admin);
    this._renderReportRelationshipMaps(admin);
  }

  // ===== RENDER PER-NUTRIENT INTERPOLATED MAPS FOR REPORT =====
  static _renderReportNutrientMaps(admin) {
    const geoSamples = (admin.samples || []).filter(s => s.lat && s.lng && s.soilData && Object.keys(s.soilData).length > 0);
    if (geoSamples.length < 3) return;

    const polygon = admin._boundaryPolygon || admin.fieldPolygon || null;
    const cropId = admin.cropId;

    // Find all rptMap_ containers
    document.querySelectorAll('[id^="rptMap_"]').forEach(container => {
      const nutrient = container.dataset.nutrient;
      if (!nutrient) return;

      const points = geoSamples
        .filter(s => s.soilData[nutrient] !== undefined)
        .map(s => ({ lat: s.lat, lng: s.lng, value: s.soilData[nutrient] }));
      if (points.length < 3) { container.innerHTML = '<span style="color:var(--text-dim);font-size:11px">Datos insuficientes</span>'; return; }

      // Calculate bounds from polygon or points
      let bounds;
      if (polygon && polygon.length >= 3) {
        const lats = polygon.map(c => c[1]), lngs = polygon.map(c => c[0]);
        bounds = { minLat: Math.min(...lats), maxLat: Math.max(...lats), minLng: Math.min(...lngs), maxLng: Math.max(...lngs) };
      } else {
        const pad = 0.002;
        bounds = {
          minLat: Math.min(...points.map(p => p.lat)) - pad, maxLat: Math.max(...points.map(p => p.lat)) + pad,
          minLng: Math.min(...points.map(p => p.lng)) - pad, maxLng: Math.max(...points.map(p => p.lng)) + pad
        };
      }

      const gridResult = InterpolationEngine.interpolateIDW(points, bounds, { resolution: 80, power: 2, smooth: 2 });
      if (!gridResult) return;

      let canvas = InterpolationEngine.renderGridToCanvas(gridResult, { cropId, nutrient, opacity: 0.85, renderScale: 3 });

      // Clip to polygon
      if (polygon) {
        canvas = InterpolationEngine.applyPolygonClip(canvas, gridResult.bounds, polygon);
      }

      // Draw into report container
      this._drawMapIntoContainer(container, canvas, gridResult, polygon, nutrient, cropId);
    });
  }

  // ===== RENDER RELATIONSHIP MAPS FOR REPORT =====
  static _renderReportRelationshipMaps(admin) {
    const geoSamples = (admin.samples || []).filter(s => s.lat && s.lng && s.soilData && Object.keys(s.soilData).length > 0);
    if (geoSamples.length < 3) return;

    const polygon = admin._boundaryPolygon || admin.fieldPolygon || null;

    const relCalcs = {
      Ca_Mg: d => (d.Ca || 0) / Math.max(d.Mg || 1, 0.1),
      Ca_K: d => (d.Ca || 0) / Math.max(d.K || 1, 0.01),
      Mg_K: d => (d.Mg || 0) / Math.max(d.K || 1, 0.01),
      CaMg_K: d => ((d.Ca || 0) + (d.Mg || 0)) / Math.max(d.K || 1, 0.01)
    };

    // Optimal ranges for coloring
    const relRanges = {
      Ca_Mg: { optMin: 3, optMax: 5 },
      Ca_K: { optMin: 10, optMax: 20 },
      Mg_K: { optMin: 2, optMax: 5 },
      CaMg_K: { optMin: 15, optMax: 30 }
    };

    document.querySelectorAll('[id^="rptRelMap_"]').forEach(container => {
      const relId = container.dataset.relId;
      const calc = relCalcs[relId];
      if (!calc) return;

      const points = geoSamples
        .filter(s => s.soilData.Ca !== undefined || s.soilData.Mg !== undefined || s.soilData.K !== undefined)
        .map(s => ({ lat: s.lat, lng: s.lng, value: calc(s.soilData) }))
        .filter(p => !isNaN(p.value) && isFinite(p.value));
      if (points.length < 3) { container.innerHTML = '<span style="color:var(--text-dim);font-size:11px">Datos insuficientes</span>'; return; }

      let bounds;
      if (polygon && polygon.length >= 3) {
        const lats = polygon.map(c => c[1]), lngs = polygon.map(c => c[0]);
        bounds = { minLat: Math.min(...lats), maxLat: Math.max(...lats), minLng: Math.min(...lngs), maxLng: Math.max(...lngs) };
      } else {
        const pad = 0.002;
        bounds = {
          minLat: Math.min(...points.map(p => p.lat)) - pad, maxLat: Math.max(...points.map(p => p.lat)) + pad,
          minLng: Math.min(...points.map(p => p.lng)) - pad, maxLng: Math.max(...points.map(p => p.lng)) + pad
        };
      }

      const gridResult = InterpolationEngine.interpolateIDW(points, bounds, { resolution: 80, power: 2, smooth: 2 });
      if (!gridResult) return;

      // Use relationship-aware coloring: green = optimal, red/orange = out of range
      const opt = relRanges[relId] || { optMin: gridResult.stats.min, optMax: gridResult.stats.max };
      const canvas = this._renderRelationshipCanvas(gridResult, opt, polygon);

      this._drawMapIntoContainer(container, canvas, gridResult, polygon, relId, null, opt);
    });
  }

  // Render relationship grid with green=optimal, red=out of range
  static _renderRelationshipCanvas(gridResult, optRange, polygon) {
    const { grid, resolution, stats } = gridResult;
    const scale = 3;
    const canvasSize = resolution * scale;
    const canvas = document.createElement('canvas');
    canvas.width = canvasSize;
    canvas.height = canvasSize;
    const ctx = canvas.getContext('2d');
    const imgData = ctx.createImageData(canvasSize, canvasSize);
    const data = imgData.data;
    const alpha = Math.round(0.85 * 255);

    for (let cy = 0; cy < canvasSize; cy++) {
      const fi = (resolution - 1) - (cy / canvasSize) * (resolution - 1);
      for (let cx = 0; cx < canvasSize; cx++) {
        const fj = (cx / canvasSize) * (resolution - 1);
        const val = InterpolationEngine._bilinearSample(grid, resolution, fi, fj);

        let rgb;
        if (val >= optRange.optMin && val <= optRange.optMax) {
          // Within optimal: green shades
          const mid = (optRange.optMin + optRange.optMax) / 2;
          const dist = Math.abs(val - mid) / ((optRange.optMax - optRange.optMin) / 2);
          rgb = [Math.round(30 + dist * 70), Math.round(170 - dist * 30), Math.round(50 + dist * 10)];
        } else if (val < optRange.optMin) {
          // Below optimal: yellow → red
          const severity = Math.min((optRange.optMin - val) / Math.max(optRange.optMin, 1), 1);
          rgb = [Math.round(200 + severity * 50), Math.round(180 - severity * 150), Math.round(50 - severity * 30)];
        } else {
          // Above optimal: blue → purple
          const severity = Math.min((val - optRange.optMax) / Math.max(optRange.optMax, 1), 1);
          rgb = [Math.round(60 + severity * 80), Math.round(100 - severity * 50), Math.round(180 + severity * 40)];
        }

        const idx = (cy * canvasSize + cx) * 4;
        data[idx] = rgb[0]; data[idx + 1] = rgb[1]; data[idx + 2] = rgb[2]; data[idx + 3] = alpha;
      }
    }
    ctx.putImageData(imgData, 0, 0);

    if (polygon) InterpolationEngine.applyPolygonClip(canvas, gridResult.bounds, polygon);
    return canvas;
  }

  // Draw interpolated canvas into a report container with legend bar
  static _drawMapIntoContainer(container, srcCanvas, gridResult, polygon, nutrient, cropId, relOpt) {
    container.innerHTML = '';
    const wrapper = document.createElement('div');
    wrapper.style.cssText = 'position:relative;background:#1a2a40;border-radius:6px;overflow:hidden';

    // Main map canvas
    const displayCanvas = document.createElement('canvas');
    const cw = Math.min(container.offsetWidth || 350, 500);
    const ch = Math.round(cw * 0.7);
    displayCanvas.width = cw;
    displayCanvas.height = ch;
    displayCanvas.style.cssText = 'width:100%;display:block';
    const ctx = displayCanvas.getContext('2d');

    // Background
    ctx.fillStyle = '#1a2a40';
    ctx.fillRect(0, 0, cw, ch);

    // Draw interpolated image
    const pad = 8;
    const legendH = 30;
    const availW = cw - pad * 2;
    const availH = ch - pad * 2 - legendH;
    const sc = Math.min(availW / srcCanvas.width, availH / srcCanvas.height);
    const dw = srcCanvas.width * sc, dh = srcCanvas.height * sc;
    const dx = (cw - dw) / 2, dy = pad;
    ctx.drawImage(srcCanvas, dx, dy, dw, dh);

    // Draw boundary outline
    if (polygon && polygon.length > 2) {
      const b = gridResult.bounds;
      ctx.beginPath();
      polygon.forEach((c, i) => {
        const px = dx + ((c[0] - b.minLng) / (b.maxLng - b.minLng)) * dw;
        const py = dy + ((b.maxLat - c[1]) / (b.maxLat - b.minLat)) * dh;
        i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
      });
      ctx.closePath();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    // Bottom legend bar
    const ly = ch - legendH;
    const stats = gridResult.stats;

    if (relOpt) {
      // Relationship legend: red | green (optimal) | blue
      const gw = cw - 40;
      const x0 = 20;
      // 3-zone gradient
      const grad = ctx.createLinearGradient(x0, 0, x0 + gw, 0);
      grad.addColorStop(0, 'rgb(230,100,40)');
      grad.addColorStop(0.3, 'rgb(40,170,55)');
      grad.addColorStop(0.5, 'rgb(30,160,50)');
      grad.addColorStop(0.7, 'rgb(40,170,55)');
      grad.addColorStop(1, 'rgb(100,80,200)');
      ctx.fillStyle = grad;
      this._roundRect(ctx, x0, ly + 4, gw, 10, 4);
      ctx.fill();

      ctx.font = '500 9px Inter, sans-serif';
      ctx.fillStyle = '#94A3B8';
      ctx.textAlign = 'left';
      ctx.fillText(`${stats.min.toFixed(1)}`, x0, ly + 26);
      ctx.textAlign = 'center';
      ctx.fillStyle = '#22c55e';
      ctx.fillText(`Ópt: ${relOpt.optMin}–${relOpt.optMax}`, cw / 2, ly + 26);
      ctx.textAlign = 'right';
      ctx.fillStyle = '#94A3B8';
      ctx.fillText(`${stats.max.toFixed(1)}`, x0 + gw, ly + 26);
    } else {
      // Nutrient gradient legend
      const gw = cw - 40;
      const x0 = 20;
      const palName = InterpolationEngine._getPaletteForNutrient(nutrient);
      const grad = ctx.createLinearGradient(x0, 0, x0 + gw, 0);
      for (let t = 0; t <= 1; t += 0.1) {
        const rgb = InterpolationEngine._samplePalette(t, palName);
        grad.addColorStop(t, `rgb(${rgb.join(',')})`);
      }
      ctx.fillStyle = grad;
      this._roundRect(ctx, x0, ly + 4, gw, 10, 4);
      ctx.fill();

      ctx.font = '500 9px Inter, sans-serif';
      ctx.fillStyle = '#94A3B8';
      ctx.textAlign = 'left';
      ctx.fillText(`${stats.min.toFixed(1)}`, x0, ly + 26);
      ctx.textAlign = 'center';
      ctx.fillText(`Media: ${stats.mean.toFixed(1)}`, cw / 2, ly + 26);
      ctx.textAlign = 'right';
      ctx.fillText(`${stats.max.toFixed(1)}`, x0 + gw, ly + 26);
    }

    wrapper.appendChild(displayCanvas);
    container.appendChild(wrapper);
  }

  static _captureMap(canvasId, leafletMap) {
    const canvas = document.getElementById(canvasId);
    if (!canvas || !leafletMap) return;
    // Use leaflet-image or dom-to-image fallback
    try {
      const mapContainer = leafletMap.getContainer();
      const ctx = canvas.getContext('2d');
      // Use html2canvas-style approach: draw the tile layer canvas
      const tileCanvases = mapContainer.querySelectorAll('canvas');
      if (tileCanvases.length > 0) {
        ctx.drawImage(tileCanvases[0], 0, 0, canvas.width, canvas.height);
      } else {
        // Fallback: draw a placeholder
        ctx.fillStyle = '#1a2a40';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = '#94A3B8';
        ctx.font = '14px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('Mapa generado — ver vista Mapas', canvas.width / 2, canvas.height / 2);
      }
    } catch (e) {
      // Silently fail
    }
  }

  // ===== GIS MAP CAPTURE =====
  static _captureGISMap(admin) {
    const wrap = document.getElementById('rptGISMapWrap');
    if (!wrap || !admin.maps?.gis || !admin._gisOverlay) return;

    // Use the overlay image data URL directly — it's already rendered as a pro interpolation
    const overlayUrl = admin._gisOverlay._url;
    if (!overlayUrl) return;

    const img = new Image();
    img.onload = () => {
      // Create a canvas and draw the overlay
      const canvas = document.createElement('canvas');
      canvas.width = Math.min(wrap.offsetWidth || 600, 800);
      canvas.height = Math.round(canvas.width * 0.65);
      canvas.style.width = '100%';
      canvas.style.display = 'block';
      canvas.style.borderRadius = '8px';
      const ctx = canvas.getContext('2d');

      // Dark background
      ctx.fillStyle = '#1a2a40';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Draw interpolated overlay centered
      const padding = 20;
      const availW = canvas.width - padding * 2;
      const availH = canvas.height - padding * 2;
      const scale = Math.min(availW / img.width, availH / img.height);
      const dw = img.width * scale;
      const dh = img.height * scale;
      const dx = (canvas.width - dw) / 2;
      const dy = (canvas.height - dh) / 2;
      ctx.drawImage(img, dx, dy, dw, dh);

      // Draw boundary outline if available
      if (admin.fieldBoundary || admin._fieldBoundary) {
        const coords = InterpolationEngine.getPolygonCoords(admin.fieldBoundary || admin._fieldBoundary);
        if (coords && coords.length > 2) {
          const bounds = admin._gisOverlay.getBounds();
          const sw = bounds.getSouthWest();
          const ne = bounds.getNorthEast();
          ctx.beginPath();
          coords.forEach((c, i) => {
            const px = dx + ((c[0] - sw.lng) / (ne.lng - sw.lng)) * dw;
            const py = dy + ((ne.lat - c[1]) / (ne.lat - sw.lat)) * dh;
            i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
          });
          ctx.closePath();
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 2;
          ctx.stroke();
        }
      }

      // Info overlay text
      const info = [];
      const boundaryName = admin.clientData?.propiedad || admin.clientData?.lote || '';
      if (boundaryName) info.push(boundaryName);
      if (admin._fieldAreaHa || admin.fieldAreaHa) info.push(`${(admin._fieldAreaHa || admin.fieldAreaHa).toFixed(1)} ha`);
      if (info.length > 0) {
        const text = info.join(' — ');
        ctx.font = 'bold 13px Inter, sans-serif';
        const tw = ctx.measureText(text).width;
        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        this._roundRect(ctx, 10, canvas.height - 36, tw + 20, 26, 6);
        ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, 20, canvas.height - 23);
      }

      wrap.appendChild(canvas);
    };
    img.src = overlayUrl;
  }

  // ===== UTILITY =====
  static _roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }
}
