// PIX Admin — Cloud Sync (Supabase / PostgREST)
// ─────────────────────────────────────────────────────────────────────────
// Reconstruido 2026-07-22: el index.html de v3.3.0 referenciaba este archivo
// pero nunca existió (404 en producción → `adminCloud` undefined → el botón
// "Sincronizar con Supabase" tiraba error). Este cliente lee la MISMA tabla
// `field_syncs` que escribe la app de campo (pix-muestreo/js/cloud.js), con
// idéntico esquema de fila, de modo que el panel ve lo que sincronizan los
// técnicos sin depender de la PC del dueño.
//
// SEGURIDAD: la anon key de Supabase es PÚBLICA por diseño (rol anónimo; el
// acceso real lo gobiernan las políticas RLS server-side). Se puede sobrescribir
// en runtime vía window.PIX_CONFIG.supabase = { url, key }.
// ─────────────────────────────────────────────────────────────────────────

(function (global) {
  'use strict';

  const DEFAULT_URL = 'https://fnoocboaupjmxpkhdnij.supabase.co';
  const DEFAULT_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZub29jYm9hdXBqbXhwa2hkbmlqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU3NzA3MTYsImV4cCI6MjA5MTM0NjcxNn0.WCoLdveWAwpcwzWpvLFSgQeXeot6X263DTffdEWoCfg';

  // Nutrientes numéricos candidatos a interpolación (claves de soilData que
  // produce el laboratorio). Se filtran contra lo realmente presente.
  const NUTRIENT_KEYS = [
    'pH_H2O', 'pH_CaCl2', 'MO', 'P', 'K', 'Ca', 'Mg', 'S', 'Al', 'H_Al',
    'CTC', 'V', 'm', 'B', 'Cu', 'Fe', 'Mn', 'Zn', 'Na', 'CE',
    'Arena', 'Limo', 'Arcilla', 'SB', 'Ca_Mg', 'Ca_K', 'Mg_K'
  ];

  class AdminCloudSync {
    constructor() {
      const cfg = (global.PIX_CONFIG && global.PIX_CONFIG.supabase) || {};
      this.url = String(cfg.url || DEFAULT_URL).replace(/\/+$/, '');
      this.key = String(cfg.key || DEFAULT_KEY);
    }

    _headers() {
      return {
        'apikey': this.key,
        'Authorization': 'Bearer ' + this.key,
        'Content-Type': 'application/json'
      };
    }

    // Pull all synced fields, newest first. Throws with a clear message on
    // network/HTTP error so the caller can surface it (no silent hang).
    async pullFieldSyncs() {
      const path = '/rest/v1/field_syncs?select=*&order=synced_at.desc';
      let resp;
      try {
        resp = await fetch(this.url + path, {
          method: 'GET',
          headers: this._headers(),
          signal: AbortSignal.timeout(15000)
        });
      } catch (e) {
        if (e && e.name === 'TimeoutError') throw new Error('Supabase no respondió (timeout). ¿Proyecto pausado?');
        throw new Error('Sin conexión a Supabase: ' + (e && e.message ? e.message : e));
      }
      if (!resp.ok) {
        const body = await resp.text().catch(() => '');
        throw new Error('Supabase HTTP ' + resp.status + (body ? ' — ' + body.slice(0, 160) : ''));
      }
      const rows = await resp.json();
      return Array.isArray(rows) ? rows : [];
    }

    // Map a field_syncs row → admin sample objects (UI shape).
    // Lab data (soilData) llega vacío hasta que se vincula un CSV de laboratorio.
    importFieldSync(sync) {
      const raw = Array.isArray(sync && sync.samples) ? sync.samples : [];
      return raw.map((s, i) => ({
        id: i + 1,
        name: s.pointName || s.pointId || `M${i + 1}`,
        fieldName: sync.field_name || '',
        lote: sync.field_name || '',
        zona: (s.zona != null ? s.zona : null),
        lat: (typeof s.lat === 'number' ? s.lat : (s.lat != null ? parseFloat(s.lat) : null)),
        lng: (typeof s.lng === 'number' ? s.lng : (s.lng != null ? parseFloat(s.lng) : null)),
        depth: s.depth || '',
        soilData: {},
        labLinked: false,
        labSource: '',
        meta: {
          _barcode: s.barcode || '',
          _sampleId: s.pointId || s.pointName || '',
          _lote: sync.field_name || '',
          _zona: (s.zona != null ? s.zona : null)
        }
      }));
    }

    // ── Estáticos usados por el pipeline y el reporte ────────────────────

    // Vincula filas de laboratorio (labRows) a las muestras por barcode →
    // sampleId → (lote+zona). Muta samples in place, devuelve cuántas vinculó.
    static linkLabToSamples(samples, labRows) {
      if (!Array.isArray(samples) || !Array.isArray(labRows)) return 0;
      let linked = 0;

      const byBarcode = new Map();
      const bySampleId = new Map();
      for (const row of labRows) {
        if (row._barcode) byBarcode.set(String(row._barcode).trim().toLowerCase(), row);
        if (row._sampleId) bySampleId.set(String(row._sampleId).trim().toLowerCase(), row);
      }

      for (const s of samples) {
        const meta = s.meta || {};
        let row = null;
        if (meta._barcode) row = byBarcode.get(String(meta._barcode).trim().toLowerCase());
        if (!row && meta._sampleId) row = bySampleId.get(String(meta._sampleId).trim().toLowerCase());
        if (!row && (meta._lote != null || meta._zona != null)) {
          row = labRows.find(r =>
            String(r._lote || '').trim().toLowerCase() === String(meta._lote || '').trim().toLowerCase() &&
            String(r._zona != null ? r._zona : '') === String(meta._zona != null ? meta._zona : ''));
        }
        if (!row) continue;

        const soil = {};
        for (const [k, v] of Object.entries(row)) {
          if (k.startsWith('_')) continue;          // metadatos, no nutrientes
          const num = typeof v === 'number' ? v : parseFloat(v);
          if (v !== '' && v != null && !Number.isNaN(num)) soil[k] = num;
        }
        if (Object.keys(soil).length === 0) continue;

        s.soilData = { ...s.soilData, ...soil };
        s.labLinked = true;
        s.labSource = row._labSource || 'CSV';
        linked++;
      }
      return linked;
    }

    // Nutrientes numéricos realmente presentes en las muestras vinculadas.
    static getAvailableNutrients(samples) {
      const present = new Set();
      for (const s of (samples || [])) {
        const soil = s.soilData || {};
        for (const k of Object.keys(soil)) {
          const num = typeof soil[k] === 'number' ? soil[k] : parseFloat(soil[k]);
          if (!Number.isNaN(num)) present.add(k);
        }
      }
      // Orden estable: primero los conocidos, luego el resto.
      const ordered = NUTRIENT_KEYS.filter(k => present.has(k));
      for (const k of present) if (!ordered.includes(k)) ordered.push(k);
      return ordered;
    }

    // Puntos {lat,lng,value} para interpolar un nutriente dado (solo con GPS).
    static getSamplesForInterpolation(samples, nutrient) {
      const pts = [];
      for (const s of (samples || [])) {
        const lat = s.lat, lng = s.lng;
        const v = s.soilData ? s.soilData[nutrient] : undefined;
        const num = typeof v === 'number' ? v : parseFloat(v);
        if (typeof lat === 'number' && typeof lng === 'number' &&
            !Number.isNaN(lat) && !Number.isNaN(lng) && !Number.isNaN(num)) {
          pts.push({ lat, lng, value: num });
        }
      }
      return pts;
    }
  }

  // Instancia global usada por admin-app.js (`adminCloud`) + la clase (`AdminCloudSync`)
  global.AdminCloudSync = AdminCloudSync;
  global.adminCloud = new AdminCloudSync();

})(window);
