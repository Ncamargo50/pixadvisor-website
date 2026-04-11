// ═══════════════════════════════════════════════════════════════════
// PIX Muestreo — Professional Report Engine (report-pro.js)
// PDF generation, QR codes, map capture, photo embed, share
// ═══════════════════════════════════════════════════════════════════

const pixReport = (() => {

  // ─── QR Code Generator (uses qrcode-generator library) ─────
  const QR = {
    toSVG(text, size = 120) {
      // Use qrcode-generator library (loaded as global `qrcode`)
      if (typeof qrcode === 'undefined') return '';
      try {
        const qr = qrcode(0, 'L'); // auto version, low ECC
        qr.addData(text);
        qr.make();
        const count = qr.getModuleCount();
        const cellSize = size / count;
        let rects = '';
        for (let y = 0; y < count; y++) {
          for (let x = 0; x < count; x++) {
            if (qr.isDark(y, x)) {
              rects += `<rect x="${x * cellSize}" y="${y * cellSize}" width="${cellSize}" height="${cellSize}" fill="#000"/>`;
            }
          }
        }
        return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}"><rect width="${size}" height="${size}" fill="#fff"/>${rects}</svg>`;
      } catch (e) {
        console.warn('[ReportPro] QR generation failed:', e.message);
        return '';
      }
    },
    toDataURL(text, size = 200) {
      if (typeof qrcode === 'undefined') return '';
      try {
        const qr = qrcode(0, 'L');
        qr.addData(text);
        qr.make();
        return qr.createDataURL(4, 8); // cellSize=4, margin=8
      } catch (e) {
        return '';
      }
    }
  };

  // ─── Canvas Map Renderer (no CORS, no tiles needed) ────────
  // Draws zone polygons + sample points on a clean canvas
  function renderMapCanvas(fields, allSamples, width = 600, height = 400) {
    try {
      const canvas = document.createElement('canvas');
      canvas.width = width * 2; // 2x for retina
      canvas.height = height * 2;
      const ctx = canvas.getContext('2d');
      ctx.scale(2, 2);

      // Background
      ctx.fillStyle = '#f0f4f0';
      ctx.fillRect(0, 0, width, height);

      // Collect all coordinates for bounding box
      const allCoords = [];
      const zonePolygons = [];
      const samplePoints = [];

      for (const field of fields) {
        // Extract zone polygons from boundary
        if (field.boundary) {
          const features = field.boundary.type === 'FeatureCollection'
            ? field.boundary.features || []
            : [field.boundary];
          features.forEach((f, i) => {
            const geom = f.geometry || f;
            if (geom.type === 'Polygon' || geom.type === 'MultiPolygon') {
              const rings = geom.type === 'Polygon' ? [geom.coordinates[0]] : geom.coordinates.map(c => c[0]);
              const meta = (field.zonasMetadata && field.zonasMetadata[i]) || {};
              const clase = meta.clase || f.properties?.clase || '';
              rings.forEach(ring => {
                ring.forEach(c => allCoords.push(c));
                zonePolygons.push({ ring, clase, name: meta.name || f.properties?.name || '' });
              });
            }
          });
        }

        // Collect sample points
        const fieldSamples = allSamples.filter(s => s.fieldId === field.id && s.lat && s.lng);
        fieldSamples.forEach(s => {
          allCoords.push([s.lng, s.lat]);
          samplePoints.push(s);
        });
      }

      if (allCoords.length === 0) return null;

      // Calculate bounds with padding
      let minLng = Infinity, maxLng = -Infinity, minLat = Infinity, maxLat = -Infinity;
      allCoords.forEach(([lng, lat]) => {
        minLng = Math.min(minLng, lng); maxLng = Math.max(maxLng, lng);
        minLat = Math.min(minLat, lat); maxLat = Math.max(maxLat, lat);
      });
      const pad = 0.15; // 15% padding
      const dLng = (maxLng - minLng) || 0.001;
      const dLat = (maxLat - minLat) || 0.001;
      minLng -= dLng * pad; maxLng += dLng * pad;
      minLat -= dLat * pad; maxLat += dLat * pad;

      // Projection: lng/lat → canvas x/y (flip Y)
      const scaleX = width / (maxLng - minLng);
      const scaleY = height / (maxLat - minLat);
      const scale = Math.min(scaleX, scaleY);
      const offX = (width - (maxLng - minLng) * scale) / 2;
      const offY = (height - (maxLat - minLat) * scale) / 2;
      const toX = lng => offX + (lng - minLng) * scale;
      const toY = lat => offY + (maxLat - lat) * scale; // flip Y

      // Draw grid lines
      ctx.strokeStyle = '#ddd';
      ctx.lineWidth = 0.5;
      for (let i = 0; i <= 4; i++) {
        const x = width * i / 4;
        const y = height * i / 4;
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke();
      }

      // Zone colors
      const zoneColors = { 'Alta': '#4CAF50', 'Media': '#FFC107', 'Baja': '#F44336' };
      const zoneColorsDark = { 'Alta': '#2E7D32', 'Media': '#F9A825', 'Baja': '#C62828' };

      // Draw zone polygons
      for (const zone of zonePolygons) {
        const color = zoneColors[zone.clase] || '#607D8B';
        const dark = zoneColorsDark[zone.clase] || '#455A64';

        // Fill
        ctx.beginPath();
        zone.ring.forEach((c, i) => {
          const x = toX(c[0]), y = toY(c[1]);
          i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        });
        ctx.closePath();
        ctx.fillStyle = color + '55'; // 33% opacity
        ctx.fill();

        // Stroke
        ctx.strokeStyle = dark;
        ctx.lineWidth = 2.5;
        ctx.stroke();

        // Zone label at centroid
        if (zone.name) {
          const cx = zone.ring.reduce((s, c) => s + c[0], 0) / zone.ring.length;
          const cy = zone.ring.reduce((s, c) => s + c[1], 0) / zone.ring.length;
          ctx.fillStyle = '#fff';
          ctx.font = 'bold 13px Arial';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          // Text shadow
          ctx.strokeStyle = dark;
          ctx.lineWidth = 3;
          ctx.strokeText(zone.name, toX(cx), toY(cy));
          ctx.fillText(zone.name, toX(cx), toY(cy));
        }
      }

      // Draw sample points
      for (const s of samplePoints) {
        const x = toX(s.lng), y = toY(s.lat);
        const isPrin = (s.pointType || s.tipo) === 'principal';
        const isCollected = s.status === 'collected';
        const r = isPrin ? 7 : 4;

        // Point circle
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fillStyle = isCollected ? '#4CAF50' : (isPrin ? '#F44336' : '#FF9800');
        ctx.fill();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // Label for principal points
        if (isPrin && s.pointName) {
          ctx.fillStyle = '#333';
          ctx.font = 'bold 10px Arial';
          ctx.textAlign = 'left';
          ctx.fillText(s.pointName, x + r + 3, y + 3);
        }
      }

      // North arrow
      ctx.fillStyle = '#333';
      ctx.font = 'bold 14px Arial';
      ctx.textAlign = 'center';
      ctx.fillText('N', width - 25, 20);
      ctx.beginPath();
      ctx.moveTo(width - 25, 24);
      ctx.lineTo(width - 21, 36);
      ctx.lineTo(width - 29, 36);
      ctx.closePath();
      ctx.fill();

      // Legend
      const legend = [['Alta', '#4CAF50'], ['Media', '#FFC107'], ['Baja', '#F44336']];
      let ly = height - 50;
      ctx.font = 'bold 10px Arial';
      ctx.textAlign = 'left';
      for (const [name, color] of legend) {
        ctx.fillStyle = color;
        ctx.fillRect(10, ly, 12, 12);
        ctx.strokeStyle = '#333';
        ctx.lineWidth = 0.5;
        ctx.strokeRect(10, ly, 12, 12);
        ctx.fillStyle = '#333';
        ctx.fillText(name, 26, ly + 10);
        ly += 16;
      }

      // Scale bar (approximate)
      const midLat = (minLat + maxLat) / 2;
      const metersPerDeg = 111320 * Math.cos(midLat * Math.PI / 180);
      const pixelsPerMeter = scale / metersPerDeg * (maxLng - minLng) / (maxLng - minLng);
      // Not used for exact distance, just a visual reference

      // Border
      ctx.strokeStyle = '#999';
      ctx.lineWidth = 1;
      ctx.strokeRect(0, 0, width, height);

      return canvas.toDataURL('image/png');
    } catch (e) {
      console.warn('[ReportPro] Canvas map render failed:', e.message);
      return null;
    }
  }

  // Legacy function name for compatibility
  async function captureMapImage() {
    return null; // Replaced by renderMapCanvas
  }

  // ─── Photo Gallery Builder ─────────────────────────────────
  function buildPhotoGallery(samples) {
    const withPhotos = samples.filter(s => s.photo);
    if (withPhotos.length === 0) return '';
    let html = '<div style="page-break-before:always"></div>';
    html += '<h2 style="font-size:16px;color:#2E7D32;border-bottom:3px solid #4CAF50;padding-bottom:6px;margin-top:24px">Registro Fotografico Georreferenciado</h2>';
    html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:12px">';
    for (const s of withPhotos) {
      const time = s.collectedAt ? new Date(s.collectedAt).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' }) : '';
      html += `
        <div style="border:1px solid #ddd;border-radius:8px;overflow:hidden;break-inside:avoid">
          <img src="${s.photo}" style="width:100%;height:160px;object-fit:cover" />
          <div style="padding:6px 10px;background:#f9f9f9;font-size:10px">
            <div style="font-weight:700;font-size:12px">${_esc(s.pointName || 'Punto')} — Zona ${s.zona || 1}</div>
            <div style="color:#666;margin-top:2px">
              ${s.lat ? s.lat.toFixed(6) : '—'}, ${s.lng ? s.lng.toFixed(6) : '—'}
              ${s.accuracy ? ' | Prec: ' + s.accuracy.toFixed(1) + 'm' : ''}
              ${time ? ' | ' + time : ''}
            </div>
          </div>
        </div>`;
    }
    html += '</div>';
    return html;
  }

  // ─── Professional Multi-Page Report Builder ────────────────
  async function buildProReport(data) {
    const {
      project, fields, allSamples, ibra, collector, today,
      mapImage, tracks, cloudUrl
    } = data;

    // Pre-calculate all data
    let zonesHTML = '';
    let detailHTML = '';
    let totalMuestras = 0;
    let totalPuntos = 0;
    let totalArea = 0;
    let photoSamples = [];

    for (const field of fields) {
      const fieldSamples = allSamples.filter(s => s.fieldId === field.id);
      photoSamples.push(...fieldSamples.filter(s => s.photo));
      totalArea += field.area || 0;

      // Group by zone
      const zoneMap = {};
      for (const s of fieldSamples) {
        const z = s.zona || 1;
        if (!zoneMap[z]) zoneMap[z] = { samples: [], barcode: '', clase: '', ibraId: '' };
        zoneMap[z].samples.push(s);
        if (s.zoneBarcode) zoneMap[z].barcode = s.zoneBarcode;
        if (s.zoneIbraSampleId) zoneMap[z].ibraId = s.zoneIbraSampleId;
        if (s.clase) zoneMap[z].clase = s.clase;
      }

      // Also pull clase from zonasMetadata
      if (field.zonasMetadata) {
        for (const zm of field.zonasMetadata) {
          const z = zm.zona || 1;
          if (zoneMap[z] && zm.clase && !zoneMap[z].clase) zoneMap[z].clase = zm.clase;
        }
      }

      const sortedZones = Object.keys(zoneMap).sort((a, b) => Number(a) - Number(b));

      for (const z of sortedZones) {
        const zd = zoneMap[z];
        totalMuestras++;
        totalPuntos += zd.samples.length;
        const depths = [...new Set(zd.samples.map(s => s.depth || '0-20'))].join(', ');
        const claseColor = zd.clase === 'Alta' ? '#4CAF50' : zd.clase === 'Media' ? '#FFC107' : zd.clase === 'Baja' ? '#F44336' : '#607D8B';

        zonesHTML += `<tr>
          <td style="text-align:center;font-weight:700;font-size:13px">${z}</td>
          <td style="font-family:monospace;font-size:10px">${zd.ibraId || zd.barcode || '—'}</td>
          <td style="text-align:center"><span style="display:inline-block;padding:2px 10px;border-radius:12px;font-size:11px;font-weight:700;color:#fff;background:${claseColor}">${zd.clase || '—'}</span></td>
          <td style="text-align:center;font-weight:600">${zd.samples.length}</td>
          <td style="text-align:center">${depths} cm</td>
          <td style="text-align:center"><span style="color:${zd.samples.length > 0 ? '#4CAF50' : '#F44336'};font-weight:600">${zd.samples.length > 0 ? 'Completa' : 'Pendiente'}</span></td>
        </tr>`;

        // Detail rows
        for (const s of zd.samples) {
          const isPrin = (s.pointType || s.tipo) === 'principal';
          const hora = s.collectedAt ? new Date(s.collectedAt).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—';
          detailHTML += `<tr style="${isPrin ? 'background:#FFF8E1;font-weight:600' : ''}">
            <td style="text-align:center">${z}</td>
            <td>${isPrin ? 'Principal' : 'Sub'}</td>
            <td style="font-weight:600">${_esc(s.pointName || '—')}</td>
            <td style="font-family:monospace;text-align:right">${s.lat ? s.lat.toFixed(6) : '—'}</td>
            <td style="font-family:monospace;text-align:right">${s.lng ? s.lng.toFixed(6) : '—'}</td>
            <td style="text-align:center">${s.accuracy ? s.accuracy.toFixed(1) + 'm' : '—'}</td>
            <td style="text-align:center">${s.depth || '0-20'}</td>
            <td style="text-align:center;font-size:10px">${hora}</td>
            <td style="text-align:center">${s.photo ? '<span style="color:#4CAF50">Si</span>' : '—'}</td>
          </tr>`;
        }
      }
    }

    // Calculate track stats
    let trackDistKm = 0;
    let trackDuration = '';
    if (tracks && tracks.length > 0) {
      for (const t of tracks) {
        const positions = t.positions || [];
        for (let i = 1; i < positions.length; i++) {
          const R = 6371000;
          const dLat = (positions[i].lat - positions[i - 1].lat) * Math.PI / 180;
          const dLng = (positions[i].lng - positions[i - 1].lng) * Math.PI / 180;
          const a = Math.sin(dLat / 2) ** 2 + Math.cos(positions[i - 1].lat * Math.PI / 180) * Math.cos(positions[i].lat * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
          trackDistKm += R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        }
      }
      trackDistKm = Math.round(trackDistKm) / 1000;
      if (tracks[0].startTime && tracks[tracks.length - 1].endTime) {
        const ms = new Date(tracks[tracks.length - 1].endTime) - new Date(tracks[0].startTime);
        const mins = Math.round(ms / 60000);
        trackDuration = mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}min` : `${mins} min`;
      }
    }

    // QR code
    const qrUrl = cloudUrl || `https://pixadvisor.network/pix-muestreo/?report=${project.name.replace(/\s/g, '_')}_${today}`;
    const qrSVG = QR.toSVG(qrUrl, 100);

    // ── Assemble HTML ──
    return `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8">
<title>Reporte Profesional — ${_esc(project.name)} — ${today}</title>
<style>
  @page { size: A4; margin: 12mm 14mm; }
  * { box-sizing: border-box; }
  body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 12px; color: #333; margin: 0; padding: 0; }
  .page { padding: 0; }

  /* Header bar */
  .hdr { display: flex; justify-content: space-between; align-items: center; padding: 12px 0; border-bottom: 3px solid #2E7D32; margin-bottom: 16px; }
  .hdr-left .brand { font-size: 24px; font-weight: 800; color: #F44336; letter-spacing: -1px; }
  .hdr-left .sub { font-size: 10px; color: #888; margin-top: 2px; }
  .hdr-right { text-align: right; }
  .hdr-right .title { font-size: 16px; font-weight: 700; color: #2E7D32; }
  .hdr-right .date { font-size: 11px; color: #666; }

  /* Section headers */
  .sec-head { background: linear-gradient(135deg, #2E7D32, #4CAF50); color: #fff; padding: 6px 14px; font-size: 12px; font-weight: 700; border-radius: 4px 4px 0 0; margin-top: 16px; }
  .sec-head.red { background: linear-gradient(135deg, #c62828, #F44336); }
  .sec-head.blue { background: linear-gradient(135deg, #1565C0, #42A5F5); }
  .sec-head.orange { background: linear-gradient(135deg, #E65100, #FF9800); }

  /* Info grid */
  .info { display: grid; grid-template-columns: 130px 1fr 130px 1fr; border: 1px solid #ddd; border-top: 0; }
  .info.two-col { grid-template-columns: 130px 1fr; }
  .info .l { background: #f5f5f5; padding: 5px 10px; font-weight: 600; font-size: 11px; border-bottom: 1px solid #eee; border-right: 1px solid #eee; }
  .info .v { padding: 5px 10px; font-size: 12px; border-bottom: 1px solid #eee; }

  /* Tables */
  table { width: 100%; border-collapse: collapse; margin: 0; }
  th { background: #E8F5E9; padding: 6px 8px; text-align: center; font-size: 10px; font-weight: 700; border: 1px solid #C8E6C9; text-transform: uppercase; letter-spacing: 0.5px; }
  td { padding: 5px 8px; border: 1px solid #ddd; font-size: 11px; }
  .tbl-wrap { border: 1px solid #ddd; border-top: 0; overflow: hidden; }

  /* Stats bar */
  .stats { display: flex; gap: 0; margin-top: 16px; border-radius: 8px; overflow: hidden; border: 1px solid #ddd; }
  .stat-box { flex: 1; text-align: center; padding: 10px 8px; }
  .stat-box .num { font-size: 22px; font-weight: 800; color: #2E7D32; }
  .stat-box .lbl { font-size: 9px; color: #888; text-transform: uppercase; letter-spacing: 0.5px; margin-top: 2px; }
  .stat-box:nth-child(even) { background: #f9f9f9; }

  /* Map container */
  .map-box { border: 2px solid #ddd; border-radius: 8px; overflow: hidden; margin: 12px 0; background: #1a1a2e; }
  .map-box img { width: 100%; display: block; }

  /* QR section */
  .qr-section { display: flex; align-items: center; gap: 16px; margin-top: 16px; padding: 12px; background: #FFF8E1; border: 1px solid #FFE082; border-radius: 8px; }
  .qr-section .qr-text { font-size: 10px; color: #666; }
  .qr-section .qr-text b { font-size: 12px; color: #333; }

  /* Footer */
  .footer { margin-top: 20px; text-align: center; font-size: 9px; color: #aaa; border-top: 1px solid #eee; padding-top: 8px; }

  .page-break { page-break-before: always; }
  @media print { .no-print { display: none !important; } body { padding: 0; } }
</style></head><body>

<!-- ═══════════ PAGE 1: PORTADA + RESUMEN ═══════════ -->
<div class="page">

  <div class="hdr">
    <div class="hdr-left">
      <div class="brand">PIX<span style="color:#2E7D32">advisor</span></div>
      <div class="sub">Agricultura de Precision — Reporte de Muestreo</div>
    </div>
    <div class="hdr-right">
      <div class="title">${_esc(project.name)}</div>
      <div class="date">${today} | Tecnico: ${_esc(collector)}</div>
    </div>
  </div>

  <!-- Stats bar -->
  <div class="stats">
    <div class="stat-box"><div class="num">${totalMuestras}</div><div class="lbl">Zonas</div></div>
    <div class="stat-box"><div class="num">${totalPuntos}</div><div class="lbl">Puntos GPS</div></div>
    <div class="stat-box"><div class="num">${totalArea ? totalArea.toFixed(1) : '—'}</div><div class="lbl">Hectareas</div></div>
    <div class="stat-box"><div class="num">${trackDistKm ? trackDistKm.toFixed(1) : '—'}</div><div class="lbl">Km Recorridos</div></div>
    <div class="stat-box"><div class="num">${trackDuration || '—'}</div><div class="lbl">Tiempo Campo</div></div>
    <div class="stat-box"><div class="num">${photoSamples.length}</div><div class="lbl">Fotos</div></div>
  </div>

  ${mapImage ? `
  <!-- Map with zones -->
  <div style="margin-top:16px">
    <div class="sec-head blue">Mapa de Zonas de Manejo</div>
    <div class="map-box"><img src="${mapImage}" alt="Mapa de zonas"/></div>
  </div>` : ''}

  <!-- IBRA info -->
  <div class="sec-head red">Datos IBRA Megalab — Solicitante</div>
  <div class="info">
    <div class="l">Solicitante</div><div class="v" style="font-weight:700">${_esc(ibra.solicitante || '—')}</div>
    <div class="l">Responsavel</div><div class="v">${_esc(ibra.responsavel || '—')}</div>
    <div class="l">Telefone</div><div class="v">${_esc(ibra.telefone || '—')}</div>
    <div class="l">Email</div><div class="v">${_esc(ibra.email || '—')}</div>
    <div class="l">CNPJ/CPF</div><div class="v">${_esc(ibra.cnpj || '—')}</div>
    <div class="l">Endereco</div><div class="v">${_esc(ibra.endereco || '—')}</div>
    <div class="l">Municipio/UF</div><div class="v">${_esc(ibra.municipio || '—')} - ${_esc(ibra.uf || '—')}</div>
    <div class="l">CEP</div><div class="v">${_esc(ibra.cep || '—')}</div>
  </div>

  <!-- Client / Farm -->
  <div class="sec-head">Cliente / Propiedad</div>
  <div class="info">
    <div class="l">Cliente</div><div class="v" style="font-weight:700;font-size:14px">${_esc(project.client || '—')}</div>
    <div class="l">Hacienda</div><div class="v" style="font-weight:700;font-size:14px">${_esc(project.name)}</div>
    <div class="l">Lotes</div><div class="v">${fields.map(f => _esc(f.name) + (f.area ? ' (' + f.area.toFixed(1) + ' ha)' : '')).join(', ')}</div>
    <div class="l">Fecha colecta</div><div class="v">${today}</div>
    <div class="l">Tecnico</div><div class="v">${_esc(collector)}</div>
    <div class="l">Orden</div><div class="v">${_esc(project.orderTitle || '—')}</div>
  </div>

  <!-- Zones summary table -->
  <div class="sec-head orange">Muestras por Zona de Manejo</div>
  <div class="tbl-wrap">
    <table>
      <thead><tr>
        <th style="width:45px">Zona</th>
        <th>QR IBRA</th>
        <th style="width:70px">Clase</th>
        <th style="width:50px">Puntos</th>
        <th style="width:65px">Prof.</th>
        <th style="width:65px">Estado</th>
      </tr></thead>
      <tbody>${zonesHTML}</tbody>
    </table>
  </div>

  <!-- QR Trazabilidad -->
  <div class="qr-section">
    <div>${qrSVG}</div>
    <div class="qr-text">
      <b>Trazabilidad Digital</b><br>
      Escanee el codigo QR para acceder a la version digital de este reporte con mapa interactivo, fotos y datos completos.
      <div style="margin-top:4px;font-family:monospace;font-size:9px;color:#999;word-break:break-all">${_esc(qrUrl)}</div>
    </div>
  </div>

</div>

<!-- ═══════════ PAGE 2: DETALLE DE PUNTOS ═══════════ -->
<div class="page-break"></div>
<div class="page">
  <div class="hdr">
    <div class="hdr-left">
      <div class="brand" style="font-size:18px">PIX<span style="color:#2E7D32">advisor</span></div>
    </div>
    <div class="hdr-right">
      <div style="font-size:13px;font-weight:700;color:#333">Detalle de Puntos por Zona</div>
      <div class="date">${_esc(project.name)} — ${today}</div>
    </div>
  </div>

  <div class="tbl-wrap">
    <table>
      <thead><tr>
        <th style="width:40px">Zona</th>
        <th style="width:55px">Tipo</th>
        <th>Punto</th>
        <th style="width:80px">Latitud</th>
        <th style="width:80px">Longitud</th>
        <th style="width:45px">Prec.</th>
        <th style="width:45px">Prof.</th>
        <th style="width:60px">Hora</th>
        <th style="width:35px">Foto</th>
      </tr></thead>
      <tbody>${detailHTML}</tbody>
    </table>
  </div>

  <div style="margin-top:12px;padding:10px;background:#E3F2FD;border:1px solid #90CAF9;border-radius:6px;font-size:10px;color:#555">
    <b>Nota tecnica:</b> Coordenadas en WGS84 (EPSG:4326). Precision GPS medida por HDOP del receptor.
    Cada muestra compuesta es la mezcla del punto principal + submuestras de la misma zona de manejo.
    Profundidad en centimetros desde la superficie.
  </div>
</div>

<!-- ═══════════ PAGE 3: FOTOS (if any) ═══════════ -->
${buildPhotoGallery(photoSamples)}

<!-- ═══════════ FOOTER ═══════════ -->
<div class="footer">
  PIX Muestreo v3.11.0 — Pixadvisor Agricultura de Precision — pixadvisor.network — ${new Date().toLocaleString('es')}<br>
  Reporte generado automaticamente. Datos respaldados en Cloud + Google Drive.
</div>

</body></html>`;
  }

  // ─── Generate PDF from HTML ────────────────────────────────
  async function generatePDF(htmlContent, fileName) {
    if (typeof html2pdf === 'undefined') {
      console.error('[ReportPro] html2pdf not loaded');
      return null;
    }

    // Create temp container
    const container = document.createElement('div');
    container.style.cssText = 'position:absolute;left:-9999px;top:0;width:210mm;background:#fff';
    container.innerHTML = htmlContent;
    document.body.appendChild(container);

    try {
      const opt = {
        margin: 0,
        filename: fileName,
        image: { type: 'jpeg', quality: 0.92 },
        html2canvas: {
          scale: 2,
          useCORS: true,
          allowTaint: true,
          logging: false,
          letterRendering: true
        },
        jsPDF: {
          unit: 'mm',
          format: 'a4',
          orientation: 'portrait'
        },
        pagebreak: { mode: ['css', 'legacy'], before: '.page-break' }
      };

      // Generate PDF blob
      const pdfBlob = await html2pdf().set(opt).from(container).outputPdf('blob');
      return pdfBlob;
    } finally {
      document.body.removeChild(container);
    }
  }

  // ─── Share via WhatsApp / Email / OS Share ─────────────────
  async function shareReport(pdfBlob, fileName, projectName, today) {
    const file = new File([pdfBlob], fileName, { type: 'application/pdf' });

    // Try Web Share API (Android native share)
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({
          title: `Reporte IBRA — ${projectName}`,
          text: `Reporte de muestreo ${projectName} (${today}). Generado por PIX Muestreo.`,
          files: [file]
        });
        return 'shared';
      } catch (e) {
        if (e.name === 'AbortError') return 'cancelled';
        console.warn('[ReportPro] Share API failed:', e.message);
      }
    }

    // Fallback: download PDF
    const url = URL.createObjectURL(pdfBlob);
    try {
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      return 'downloaded';
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  // ─── Main Entry Point: Generate + Share ────────────────────
  async function generateAndShare(app, shareMode = 'download') {
    if (!app.currentProject) {
      app.toast('Abri un proyecto primero', 'warning');
      return;
    }

    app.toast('Generando reporte PDF profesional...', 'success');

    const project = app.currentProject;
    const fields = await pixDB.getAllByIndex('fields', 'projectId', project.id);
    const allSamples = await pixDB.getAll('samples');
    const ibra = await app.loadIbraSettings();
    const collector = await pixDB.getSetting('collectorName') || '';
    const today = new Date().toISOString().slice(0, 10);

    // Render map from zone/point data (no CORS issues, works offline)
    let mapImage = null;
    try {
      mapImage = renderMapCanvas(fields, allSamples, 600, 380);
    } catch (e) {
      console.warn('[ReportPro] Map render skipped:', e.message);
    }

    // Load tracks
    let tracks = [];
    for (const field of fields) {
      try {
        const ft = await pixDB.getAllByIndex('tracks', 'fieldId', field.id);
        tracks.push(...ft);
      } catch (e) {}
    }

    // Build professional HTML
    const html = await buildProReport({
      project, fields, allSamples, ibra, collector, today,
      mapImage, tracks, cloudUrl: null
    });

    const safeProjectName = project.name.replace(/[^a-zA-Z0-9_-]/g, '_');
    const fileName = `IBRA_PRO_${safeProjectName}_${today}.pdf`;

    // Generate PDF
    const pdfBlob = await generatePDF(html, fileName);
    if (!pdfBlob) {
      // Fallback to HTML download
      app._downloadBlob(html, fileName.replace('.pdf', '.html'), 'text/html');
      app.toast('PDF no disponible, descargado como HTML', 'warning');
      return;
    }

    // Backup HTML in IndexedDB
    try {
      await pixDB.saveFile({
        fieldId: fields[0]?.id || null,
        projectName: project.name,
        fieldName: fields.map(f => f.name).join(', '),
        fileName: fileName.replace('.pdf', '.html'),
        type: 'ibra_pro_report',
        mimeType: 'text/html',
        content: html
      });
    } catch (e) {}

    // Backup PDF blob in IndexedDB
    try {
      const reader = new FileReader();
      const base64 = await new Promise(resolve => {
        reader.onload = () => resolve(reader.result);
        reader.readAsDataURL(pdfBlob);
      });
      await pixDB.saveFile({
        fieldId: fields[0]?.id || null,
        projectName: project.name,
        fieldName: fields.map(f => f.name).join(', '),
        fileName,
        type: 'ibra_pro_pdf',
        mimeType: 'application/pdf',
        content: base64
      });
    } catch (e) {}

    if (shareMode === 'share') {
      const result = await shareReport(pdfBlob, fileName, project.name, today);
      if (result === 'shared') {
        app.toast('Reporte compartido exitosamente', 'success');
      } else if (result === 'downloaded') {
        app.toast('PDF descargado (compartir no disponible)', 'success');
      } else {
        app.toast('Compartir cancelado', 'warning');
      }
    } else {
      // Just download
      const url = URL.createObjectURL(pdfBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      app.toast(`PDF generado: ${fileName}`, 'success');
    }
  }

  // ─── HTML Escape Helper ────────────────────────────────────
  function _esc(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ─── Public API ────────────────────────────────────────────
  return {
    generateAndShare,
    buildProReport,
    generatePDF,
    shareReport,
    renderMapCanvas,
    QR
  };

})();
