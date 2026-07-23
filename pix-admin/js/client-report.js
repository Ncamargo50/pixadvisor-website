// PIX Admin — Client Report generator
// ─────────────────────────────────────────────────────────────────────────
// Reconstruido 2026-07-22: el index.html de v3.3.0 referenciaba este archivo
// pero nunca existió (404 → `ClientReport` undefined → "Reporte de cliente"
// tiraba error). Devuelve un documento HTML autocontenido, de marca Pixadvisor,
// listo para imprimir a PDF (window.print). No depende de ningún backend.
//
// Contrato: ClientReport.generate(reportData) → string HTML completo.
// reportData: { clientData, project, fieldName, cropName, yieldTarget, samples,
//   soilInterpretation, nutrients, prescription, zonasMetadata, boundary,
//   areaHa, collector, today, mapCanvasDataURL, nutrientMapDataURL,
//   prescriptionMapDataURL }
// ─────────────────────────────────────────────────────────────────────────

(function (global) {
  'use strict';

  // Paleta de marca (logo Pixadvisor): azul → teal → lima
  const BRAND = { blue: '#1E40AF', teal: '#0D9488', lima: '#7FD633', dark: '#0f172a', ink: '#1e293b', muted: '#64748b' };

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function num(v, dec) {
    const n = typeof v === 'number' ? v : parseFloat(v);
    if (Number.isNaN(n)) return '—';
    return n.toLocaleString('es-BO', { minimumFractionDigits: dec || 0, maximumFractionDigits: dec != null ? dec : 2 });
  }

  function safeImg(dataURL, alt, h) {
    if (!dataURL || typeof dataURL !== 'string' || !dataURL.startsWith('data:image')) return '';
    return `<img src="${dataURL}" alt="${esc(alt)}" style="width:100%;max-height:${h || 380}px;object-fit:contain;border:1px solid #e2e8f0;border-radius:8px"/>`;
  }

  // ── Secciones ────────────────────────────────────────────────────────

  function coverPage(d) {
    const c = d.clientData || {};
    return `
    <section class="page cover">
      <div class="cover-band"></div>
      <div class="cover-body">
        <div class="brand">PIX<span>ADVISOR</span></div>
        <div class="brand-sub">Agricultura de Precisión</div>
        <h1>Informe de Análisis de Suelo<br/>y Recomendación por Ambientes</h1>
        <div class="cover-meta">
          <div><span>Cliente</span><strong>${esc(c.nombre || '—')}</strong></div>
          <div><span>Propiedad</span><strong>${esc(c.propiedad || d.project || '—')}</strong></div>
          <div><span>Lote / Campo</span><strong>${esc(c.lote || d.fieldName || '—')}</strong></div>
          <div><span>Cultivo</span><strong>${esc(d.cropName || '—')}</strong></div>
          <div><span>Área</span><strong>${num(d.areaHa, 1)} ha</strong></div>
          <div><span>Muestras</span><strong>${esc(c.nMuestra || (d.samples ? d.samples.length : 0))}</strong></div>
        </div>
        <div class="cover-foot">
          <div><span>Responsable técnico</span><strong>${esc(c.responsable || d.collector || '—')}</strong></div>
          <div><span>Laboratorio</span><strong>${esc(c.laboratorio || 'IBRA megalab')}</strong></div>
          <div><span>Fecha</span><strong>${esc(d.today || '')}</strong></div>
        </div>
      </div>
    </section>`;
  }

  function summaryPage(d) {
    const interp = d.soilInterpretation || {};
    const alerts = Array.isArray(interp.alerts) ? interp.alerts : [];
    const danger = alerts.filter(a => a.type === 'danger').length;
    const warn = alerts.filter(a => a.type === 'warning').length;
    const nutrientCount = interp.nutrients ? Object.keys(interp.nutrients).length : (d.nutrients ? d.nutrients.length : 0);
    const withGps = (d.samples || []).filter(s => s.lat && s.lng).length;

    const kpis = [
      { label: 'Muestras analizadas', value: (d.samples || []).length, color: BRAND.teal },
      { label: 'Con georreferencia', value: withGps, color: BRAND.blue },
      { label: 'Parámetros evaluados', value: nutrientCount, color: BRAND.lima },
      { label: 'Alertas críticas', value: danger, color: danger ? '#ef4444' : BRAND.teal },
      { label: 'Alertas de manejo', value: warn, color: warn ? '#f59e0b' : BRAND.teal },
      { label: 'Meta de rendimiento', value: num(d.yieldTarget, 0), color: BRAND.blue }
    ];

    return `
    <section class="page">
      ${sectionHead('01', 'Resumen ejecutivo')}
      <div class="kpi-grid">
        ${kpis.map(k => `<div class="kpi" style="border-top-color:${k.color}">
          <div class="kpi-val" style="color:${k.color}">${esc(k.value)}</div>
          <div class="kpi-lbl">${esc(k.label)}</div></div>`).join('')}
      </div>
      ${alerts.length ? `
      <h3 class="sub">Hallazgos principales</h3>
      <div class="alerts">
        ${alerts.slice(0, 8).map(a => `<div class="alert alert-${a.type === 'danger' ? 'd' : 'w'}">
          <span class="dot"></span>${esc(a.msg)}</div>`).join('')}
      </div>` : `<p class="note">Sin alertas nutricionales críticas para los umbrales del cultivo seleccionado.</p>`}
      ${safeImg(d.mapCanvasDataURL, 'Mapa de zonas de manejo', 360) ? `
      <h3 class="sub">Zonas de manejo</h3>${safeImg(d.mapCanvasDataURL, 'Mapa de zonas de manejo', 360)}` : ''}
    </section>`;
  }

  function nutrientsPage(d) {
    const interp = d.soilInterpretation || {};
    const nutr = interp.nutrients || {};
    const keys = Object.keys(nutr);
    if (keys.length === 0) return '';
    const rows = keys.map(k => {
      const n = nutr[k] || {};
      return `<tr>
        <td><strong>${esc(n.label || k)}</strong>${n.methodLabel ? `<br><small>${esc(n.methodLabel)}</small>` : ''}</td>
        <td class="rt">${num(n.displayValue != null ? n.displayValue : n.value, n.decimals)} ${esc(n.unit || '')}</td>
        <td><span class="pill" style="background:${esc(n.color || '#94a3b8')}22;color:${esc(n.color || '#475569')}">${esc(n.label2 || n.class || '')} ${esc(clsLabel(n))}</span></td>
      </tr>`;
    }).join('');
    return `
    <section class="page">
      ${sectionHead('02', 'Diagnóstico nutricional del suelo')}
      <table class="tbl">
        <thead><tr><th>Parámetro</th><th class="rt">Valor</th><th>Interpretación</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <p class="note">Clasificación relativa a los rangos óptimos del cultivo <strong>${esc(d.cropName || '')}</strong>. Método P: ${esc(interp.pMethod || 'default')}.</p>
      ${safeImg(d.nutrientMapDataURL, 'Mapa de nutrientes', 380) ? `<h3 class="sub">Distribución espacial</h3>${safeImg(d.nutrientMapDataURL, 'Mapa de nutrientes', 380)}` : ''}
    </section>`;
  }

  function clsLabel(n) {
    if (n.label && n.class) return '';
    return n.label || '';
  }

  function prescriptionPage(d) {
    const presc = d.prescription || {};
    const keys = Object.keys(presc);
    const zonas = Array.isArray(d.zonasMetadata) ? d.zonasMetadata : [];
    if (keys.length === 0 && zonas.length === 0 && !d.prescriptionMapDataURL) return '';

    let prescBlock = '';
    if (keys.length) {
      const rows = keys.map(k => {
        const p = presc[k] || {};
        const dose = p.avgDose != null ? p.avgDose : (p.meanDose != null ? p.meanDose : p.dose);
        const total = p.totalKg != null ? p.totalKg : (p.total != null ? p.total : null);
        return `<tr>
          <td><strong>${esc(k)}</strong></td>
          <td class="rt">${num(dose, 0)} kg/ha</td>
          <td class="rt">${total != null ? num(total, 0) + ' kg' : '—'}</td>
          <td>${esc(p.source || p.fertilizer || '—')}</td>
        </tr>`;
      }).join('');
      prescBlock = `<h3 class="sub">Prescripción de tasa variable (VRT)</h3>
        <table class="tbl"><thead><tr><th>Nutriente</th><th class="rt">Dosis media</th><th class="rt">Total lote</th><th>Fuente</th></tr></thead>
        <tbody>${rows}</tbody></table>`;
    }

    let zonaBlock = '';
    if (zonas.length) {
      const rows = zonas.map(z => `<tr>
        <td><strong>Zona ${esc(z.zona)}</strong></td>
        <td>${esc(z.clase || '—')}</td>
        <td class="rt">${esc(z.count || 0)}</td>
        <td>${esc(z.ibra || z.barcode || '—')}</td>
      </tr>`).join('');
      zonaBlock = `<h3 class="sub">Resumen por zona de manejo</h3>
        <table class="tbl"><thead><tr><th>Zona</th><th>Clase</th><th class="rt">Muestras</th><th>Ref. lab</th></tr></thead>
        <tbody>${rows}</tbody></table>`;
    }

    return `
    <section class="page">
      ${sectionHead('03', 'Recomendación y prescripción')}
      ${prescBlock}
      ${zonaBlock}
      ${safeImg(d.prescriptionMapDataURL, 'Mapa de prescripción', 380) ? `<h3 class="sub">Mapa de prescripción</h3>${safeImg(d.prescriptionMapDataURL, 'Mapa de prescripción', 380)}` : ''}
    </section>`;
  }

  function sectionHead(num, title) {
    return `<div class="sec-head"><span class="sec-num">${num}</span><h2>${esc(title)}</h2></div>`;
  }

  function styles() {
    return `
    :root{--blue:${BRAND.blue};--teal:${BRAND.teal};--lima:${BRAND.lima};--ink:${BRAND.ink};--muted:${BRAND.muted}}
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:'Inter',-apple-system,Segoe UI,Roboto,sans-serif;color:var(--ink);background:#e2e8f0;-webkit-print-color-adjust:exact;print-color-adjust:exact}
    .page{background:#fff;width:210mm;min-height:297mm;margin:10px auto;padding:22mm 18mm;position:relative;box-shadow:0 2px 12px rgba(0,0,0,.12)}
    .cover{padding:0;overflow:hidden}
    .cover-band{height:120mm;background:linear-gradient(135deg,var(--blue) 0%,var(--teal) 62%,var(--lima) 130%)}
    .cover-body{padding:0 20mm}
    .cover .brand{font-weight:800;font-size:34px;letter-spacing:1px;color:#fff;margin-top:-70mm}
    .cover .brand span{color:var(--lima)}
    .cover .brand-sub{color:#e2f5f0;font-size:13px;letter-spacing:3px;text-transform:uppercase;margin-bottom:40mm}
    .cover h1{font-size:30px;line-height:1.25;color:var(--ink);margin:14mm 0 10mm}
    .cover-meta{display:grid;grid-template-columns:1fr 1fr;gap:10px 30px;margin-bottom:14mm}
    .cover-meta>div{border-bottom:1px solid #e2e8f0;padding-bottom:6px}
    .cover-meta span{display:block;font-size:10px;text-transform:uppercase;letter-spacing:1px;color:var(--muted)}
    .cover-meta strong{font-size:16px}
    .cover-foot{display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px;border-top:3px solid var(--lima);padding-top:12px}
    .cover-foot span{display:block;font-size:9px;text-transform:uppercase;letter-spacing:1px;color:var(--muted)}
    .cover-foot strong{font-size:12px}
    .sec-head{display:flex;align-items:center;gap:12px;border-bottom:2px solid var(--teal);padding-bottom:8px;margin-bottom:16px}
    .sec-num{background:var(--teal);color:#fff;font-weight:800;font-size:13px;padding:4px 9px;border-radius:6px}
    .sec-head h2{font-size:19px;color:var(--ink)}
    h3.sub{font-size:14px;color:var(--teal);margin:18px 0 8px;border-left:3px solid var(--lima);padding-left:8px}
    .kpi-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}
    .kpi{background:#f8fafc;border:1px solid #e2e8f0;border-top:3px solid var(--teal);border-radius:8px;padding:14px}
    .kpi-val{font-size:26px;font-weight:800}
    .kpi-lbl{font-size:11px;color:var(--muted);margin-top:2px}
    .alerts{display:flex;flex-direction:column;gap:6px}
    .alert{display:flex;align-items:flex-start;gap:8px;font-size:12px;padding:8px 10px;border-radius:6px;background:#f8fafc}
    .alert .dot{width:8px;height:8px;border-radius:50%;margin-top:4px;flex-shrink:0}
    .alert-d{background:#fef2f2;color:#991b1b}.alert-d .dot{background:#ef4444}
    .alert-w{background:#fffbeb;color:#92400e}.alert-w .dot{background:#f59e0b}
    .tbl{width:100%;border-collapse:collapse;font-size:12px;margin-top:6px}
    .tbl th{background:var(--teal);color:#fff;text-align:left;padding:8px 10px;font-size:11px;text-transform:uppercase;letter-spacing:.5px}
    .tbl td{padding:7px 10px;border-bottom:1px solid #eef2f6}
    .tbl tbody tr:nth-child(even){background:#f8fafc}
    .tbl .rt{text-align:right}
    .pill{padding:2px 9px;border-radius:10px;font-size:10px;font-weight:700}
    .note{font-size:11px;color:var(--muted);margin-top:10px;font-style:italic}
    @media print{body{background:#fff}.page{margin:0;box-shadow:none;page-break-after:always}}
    `;
  }

  const ClientReport = {
    generate(d) {
      d = d || {};
      const parts = [
        coverPage(d),
        summaryPage(d),
        nutrientsPage(d),
        prescriptionPage(d)
      ].filter(Boolean);

      return `<!doctype html><html lang="es"><head>
        <meta charset="utf-8"/>
        <meta name="viewport" content="width=device-width,initial-scale=1"/>
        <title>Informe Pixadvisor — ${esc((d.clientData && d.clientData.nombre) || d.fieldName || 'Cliente')}</title>
        <style>${styles()}</style>
      </head><body>${parts.join('\n')}</body></html>`;
    }
  };

  global.ClientReport = ClientReport;

})(window);
