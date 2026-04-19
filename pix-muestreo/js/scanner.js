// QR/Barcode Scanner for PIX Muestreo
class BarcodeScanner {
  constructor() {
    this.scanner = null;
    this.isScanning = false;
    this.onScanSuccess = null;
    this._timeoutId = null;       // Auto-stop after 60s idle
    this._onTimeout = null;       // Callback fired when auto-stop kicks in
  }

  // Initialize scanner.
  //   onSuccess   — (text, decodedResult) called on a hit
  //   onTimeout   — (optional) called if the scanner runs for 60s without
  //                 a hit. Lets the UI close the modal and tell the user
  //                 "no pude leer el código" instead of draining the camera
  //                 + battery indefinitely when nothing's in frame.
  async init(containerId, onSuccess, onTimeout) {
    this.onScanSuccess = onSuccess;
    this._onTimeout = onTimeout || null;

    this.scanner = new Html5Qrcode(containerId);

    const config = {
      fps: 10,
      qrbox: { width: 250, height: 250 },
      aspectRatio: 1.0,
      formatsToSupport: [
        Html5QrcodeSupportedFormats.QR_CODE,
        Html5QrcodeSupportedFormats.CODE_128,
        Html5QrcodeSupportedFormats.CODE_39,
        Html5QrcodeSupportedFormats.EAN_13,
        Html5QrcodeSupportedFormats.EAN_8,
        Html5QrcodeSupportedFormats.ITF,
        Html5QrcodeSupportedFormats.DATA_MATRIX
      ]
    };

    try {
      await this.scanner.start(
        { facingMode: 'environment' },
        config,
        (decodedText, decodedResult) => {
          // Vibrate on success
          if (navigator.vibrate) navigator.vibrate(200);
          if (this.onScanSuccess) {
            this.onScanSuccess(decodedText, decodedResult);
          }
        },
        () => {} // expected: called on each frame without detection
      );
      this.isScanning = true;

      // Safety net: camera + CPU eats ~3-5 %/min. Auto-stop after 60 s so
      // an unattended scanner screen doesn't silently drain the battery.
      this._timeoutId = setTimeout(() => {
        this._timeoutId = null;
        if (this.isScanning) {
          this.stop().finally(() => {
            if (this._onTimeout) try { this._onTimeout(); } catch (_) {}
          });
        }
      }, 60000);
    } catch (err) {
      this.isScanning = false;
      console.error('Scanner init error:', err);
      throw err;
    }
  }

  // ===== IBRA MEGALAB QR PARSER =====
  // Parses QR codes from IBRA Megalab sample bags
  // IBRA QR formats detected:
  //   1. URL: https://megalab.ibra.com.br/amostra/XXXXX or similar
  //   2. Structured: ID;ClientCode;SampleNum;LabOrder;Depth;...
  //   3. Pipe-separated: ID|Field|Point|Depth|LabOrder
  //   4. Simple numeric: just a sample bag number (e.g., "1234567")
  //   5. JSON: {"id":"...","amostra":"...","profundidade":"..."}
  static parseIBRA(rawCode) {
    if (!rawCode || typeof rawCode !== 'string') {
      return { isIBRA: false, raw: rawCode };
    }

    const trimmed = rawCode.trim();
    const result = {
      isIBRA: false,
      raw: trimmed,
      sampleId: null,       // ID de la bolsa/muestra
      labOrder: null,        // Número de orden del laboratorio
      clientCode: null,      // Código del cliente
      depth: null,           // Profundidad (ej: "0-20")
      fieldName: null,       // Nombre del lote/campo
      pointName: null,       // Nombre del punto
      sampleType: null,      // Tipo de análisis
      extraData: {}          // Datos adicionales
    };

    // Pattern 1: IBRA URL (megalab.ibra.com.br or ibra.com.br)
    if (/ibra\.com\.br/i.test(trimmed) || /megalab/i.test(trimmed)) {
      result.isIBRA = true;
      result.source = 'IBRA Megalab (URL)';
      try {
        const url = new URL(trimmed);
        // Extract sample ID from URL path or params
        const pathParts = url.pathname.split('/').filter(Boolean);
        if (pathParts.length > 0) {
          result.sampleId = pathParts[pathParts.length - 1];
        }
        // Check URL params
        for (const [key, val] of url.searchParams) {
          const k = key.toLowerCase();
          if (/amostra|sample|id/i.test(k)) result.sampleId = val;
          else if (/ordem|order|pedido/i.test(k)) result.labOrder = val;
          else if (/cliente|client/i.test(k)) result.clientCode = val;
          else if (/prof|depth/i.test(k)) result.depth = val;
          else if (/talhao|lote|field/i.test(k)) result.fieldName = val;
          else if (/ponto|point/i.test(k)) result.pointName = val;
          else result.extraData[key] = val;
        }
      } catch (e) {
        // If URL parsing fails, extract what we can
        const idMatch = trimmed.match(/(\d{4,})/);
        if (idMatch) result.sampleId = idMatch[1];
      }
      return result;
    }

    // Pattern 2: JSON format
    if (trimmed.startsWith('{')) {
      try {
        const json = JSON.parse(trimmed);
        result.isIBRA = true;
        result.source = 'IBRA Megalab (JSON)';
        result.sampleId = json.id || json.amostra || json.sampleId || json.codigo || null;
        result.labOrder = json.ordem || json.order || json.labOrder || json.pedido || null;
        result.clientCode = json.cliente || json.client || json.clientCode || null;
        result.depth = json.profundidade || json.prof || json.depth || null;
        result.fieldName = json.talhao || json.lote || json.field || null;
        result.pointName = json.ponto || json.point || null;
        result.sampleType = json.tipo || json.type || json.analise || null;
        // Store all remaining keys
        for (const [k, v] of Object.entries(json)) {
          if (!['id','amostra','sampleId','codigo','ordem','order','labOrder','pedido',
                'cliente','client','clientCode','profundidade','prof','depth',
                'talhao','lote','field','ponto','point','tipo','type','analise'].includes(k)) {
            result.extraData[k] = v;
          }
        }
        return result;
      } catch (e) { /* not valid JSON, continue */ }
    }

    // Pattern 3: Semicolon-separated (common IBRA lab format)
    // Format: SampleID;ClientCode;LabOrder;Depth;Field;Point;Type
    if (trimmed.includes(';')) {
      const parts = trimmed.split(';').map(s => s.trim());
      result.isIBRA = true;
      result.source = 'IBRA Megalab';
      if (parts.length >= 1) result.sampleId = parts[0] || null;
      if (parts.length >= 2) result.clientCode = parts[1] || null;
      if (parts.length >= 3) result.labOrder = parts[2] || null;
      if (parts.length >= 4 && /\d+-\d+|\d+/.test(parts[3])) result.depth = parts[3] || null;
      if (parts.length >= 5) result.fieldName = parts[4] || null;
      if (parts.length >= 6) result.pointName = parts[5] || null;
      if (parts.length >= 7) result.sampleType = parts[6] || null;
      return result;
    }

    // Pattern 4: Pipe-separated
    if (trimmed.includes('|')) {
      const parts = trimmed.split('|').map(s => s.trim());
      result.isIBRA = true;
      result.source = 'IBRA Megalab';
      if (parts.length >= 1) result.sampleId = parts[0] || null;
      if (parts.length >= 2) result.fieldName = parts[1] || null;
      if (parts.length >= 3) result.pointName = parts[2] || null;
      if (parts.length >= 4) result.depth = parts[3] || null;
      if (parts.length >= 5) result.labOrder = parts[4] || null;
      return result;
    }

    // Pattern 5: Key=Value pairs (comma or & separated)
    if (/\w+=\w+/.test(trimmed)) {
      const sep = trimmed.includes('&') ? '&' : ',';
      const pairs = trimmed.split(sep);
      const data = {};
      for (const pair of pairs) {
        const [k, ...vParts] = pair.split('=');
        if (k) data[k.trim().toLowerCase()] = vParts.join('=').trim();
      }
      if (Object.keys(data).length >= 2) {
        result.isIBRA = true;
        result.source = 'IBRA Megalab';
        result.sampleId = data.id || data.amostra || data.sample || data.codigo || null;
        result.labOrder = data.ordem || data.order || data.pedido || null;
        result.clientCode = data.cliente || data.client || null;
        result.depth = data.prof || data.profundidade || data.depth || null;
        result.fieldName = data.talhao || data.lote || data.field || null;
        result.pointName = data.ponto || data.point || null;
        result.extraData = data;
        return result;
      }
    }

    // Pattern 6: IBRA bag format with dash: 00966568-25 (8+ digits, dash, sequence)
    // Real IBRA megalab bags use format: XXXXXXXX-YY
    const ibraDashMatch = trimmed.match(/^(\d{6,10})-(\d{1,4})$/);
    if (ibraDashMatch) {
      result.isIBRA = true;
      result.source = 'IBRA Megalab (Bolsa)';
      result.sampleId = trimmed;              // Full code: 00966568-25
      result.extraData.baseId = ibraDashMatch[1];   // 00966568
      result.extraData.sequence = ibraDashMatch[2];  // 25
      return result;
    }

    // Pattern 7: Plain numeric/alphanumeric code (bag ID)
    // IBRA bags can also have 6-10 digit numeric codes without dash
    if (/^[A-Z]{0,3}\d{4,12}$/.test(trimmed)) {
      result.isIBRA = true;
      result.source = 'Código de bolsa';
      result.sampleId = trimmed;
      return result;
    }

    // Fallback: not recognized as IBRA, return raw
    result.sampleId = trimmed;
    return result;
  }

  // Format parsed IBRA data for display
  static formatIBRADisplay(parsed) {
    if (!parsed) return '';
    const lines = [];
    if (parsed.sampleId) lines.push(`Bolsa: ${parsed.sampleId}`);
    if (parsed.extraData && parsed.extraData.baseId) lines.push(`ID Base: ${parsed.extraData.baseId}`);
    if (parsed.extraData && parsed.extraData.sequence) lines.push(`Seq: ${parsed.extraData.sequence}`);
    if (parsed.labOrder) lines.push(`Orden Lab: ${parsed.labOrder}`);
    if (parsed.clientCode) lines.push(`Cliente: ${parsed.clientCode}`);
    if (parsed.depth) lines.push(`Prof: ${parsed.depth} cm`);
    if (parsed.fieldName) lines.push(`Lote: ${parsed.fieldName}`);
    if (parsed.pointName) lines.push(`Punto: ${parsed.pointName}`);
    if (parsed.sampleType) lines.push(`Tipo: ${parsed.sampleType}`);
    return lines.join(' · ');
  }

  // Stop scanning
  async stop() {
    // Always clear the idle-timeout so a stale timer can't fire stop() twice
    // or invoke onTimeout after a successful scan.
    if (this._timeoutId) {
      clearTimeout(this._timeoutId);
      this._timeoutId = null;
    }
    if (this.scanner && this.isScanning) {
      try {
        await this.scanner.stop();
      } catch (e) {
        // ignore
      }
      this.isScanning = false;
    }
  }

  // Take photo using camera
  static async takePhoto() {
    return new Promise((resolve, reject) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.capture = 'environment';

      input.onchange = e => {
        const file = e.target.files[0];
        // Cleanup: remove orphan input from DOM
        if (input.parentNode) input.parentNode.removeChild(input);
        if (!file) { reject('No file'); return; }

        const reader = new FileReader();
        reader.onload = ev => {
          // Compress image
          const img = new Image();
          img.onload = () => {
            const canvas = document.createElement('canvas');
            const maxSize = 1200;
            let w = img.width, h = img.height;
            if (w > maxSize || h > maxSize) {
              if (w > h) { h = h * maxSize / w; w = maxSize; }
              else { w = w * maxSize / h; h = maxSize; }
            }
            canvas.width = w;
            canvas.height = h;
            canvas.getContext('2d').drawImage(img, 0, 0, w, h);
            resolve(canvas.toDataURL('image/jpeg', 0.7));
          };
          img.onerror = () => reject('Error loading image');
          img.src = ev.target.result;
        };
        reader.onerror = () => reject('Error reading file');
        reader.readAsDataURL(file);
      };

      // Append briefly to DOM (required by some Android WebViews) then click
      input.style.display = 'none';
      document.body.appendChild(input);
      input.click();
    });
  }
}

const barcodeScanner = new BarcodeScanner();
