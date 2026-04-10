// PIX Cloud Sync — Supabase integration for multi-technician sync
// Uses direct REST API (PostgREST) — no external library needed
// Works alongside Google Drive sync — independent fallback paths

// Default Supabase credentials (PIX Muestreo project)
const _CLOUD_DEFAULT_URL = 'https://fnoocboaupjmxpkhdnij.supabase.co';
const _CLOUD_DEFAULT_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZub29jYm9hdXBqbXhwa2hkbmlqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU3NzA3MTYsImV4cCI6MjA5MTM0NjcxNn0.WCoLdveWAwpcwzWpvLFSgQeXeot6X263DTffdEWoCfg';

class PixCloud {
  constructor() {
    this.url = '';       // e.g. 'https://xxxxx.supabase.co'
    this.key = '';       // anon public key
    this._enabled = false;
    this._syncing = false; // Mutex: prevent concurrent syncAll
  }

  // Initialize from saved settings (falls back to hardcoded defaults)
  async init() {
    try {
      this.url = (await pixDB.getSetting('cloud_url') || _CLOUD_DEFAULT_URL).trim().replace(/\/+$/, '');
      this.key = (await pixDB.getSetting('cloud_key') || _CLOUD_DEFAULT_KEY).trim();
      this._enabled = !!(this.url && this.key);
      if (this._enabled) console.log('[Cloud] Initialized:', this.url);
    } catch (e) {
      // Even on DB error, try defaults
      this.url = _CLOUD_DEFAULT_URL;
      this.key = _CLOUD_DEFAULT_KEY;
      this._enabled = true;
      console.warn('[Cloud] Init from defaults (DB error):', e.message);
    }
  }

  isEnabled() { return this._enabled; }

  // ═══════════════════════════════════════════════
  // REST API helpers (PostgREST / Supabase)
  // ═══════════════════════════════════════════════

  async _fetch(path, options = {}) {
    if (!this._enabled) throw new Error('Cloud no configurado');
    const resp = await fetch(this.url + '/rest/v1' + path, {
      ...options,
      headers: {
        'apikey': this.key,
        'Authorization': 'Bearer ' + this.key,
        'Content-Type': 'application/json',
        'Prefer': options._prefer || 'return=representation',
        ...options.headers
      }
    });
    if (!resp.ok) {
      const errText = await resp.text().catch(() => resp.statusText);
      throw new Error(`Cloud ${resp.status}: ${errText}`);
    }
    return resp;
  }

  // ═══════════════════════════════════════════════
  // SYNC FIELD — Push complete field data to cloud
  // Called after Drive sync or independently
  // ═══════════════════════════════════════════════

  async syncField(projectName, fieldName, clientName, fieldObj, samples, collector) {
    if (!this._enabled) return;

    // Build zone summary
    const zones = {};
    for (const s of samples) {
      const z = s.zona || 1;
      if (!zones[z]) zones[z] = { zona: z, count: 0, barcode: null, clase: '' };
      zones[z].count++;
      if (s.zoneBarcode) zones[z].barcode = s.zoneBarcode;
      if (s.zoneIbraSampleId) zones[z].ibra = s.zoneIbraSampleId;
    }

    const row = {
      technician: collector || 'Sin nombre',
      project: projectName || 'Sin proyecto',
      field_name: fieldName || 'Sin campo',
      client: clientName || '',
      area_ha: fieldObj?.area || null,
      boundary: fieldObj?.boundary || null,
      samples: samples.map(s => ({
        pointName: s.pointName,
        zona: s.zona,
        lat: s.lat,
        lng: s.lng,
        accuracy: s.accuracy,
        depth: s.depth,
        sampleType: s.sampleType,
        barcode: s.barcode,
        collector: s.collector,
        collectedAt: s.collectedAt,
        notes: s.notes
      })),
      zones_summary: Object.values(zones),
      total_points: fieldObj?._totalPoints || samples.length,
      collected_points: samples.length,
      progress_pct: fieldObj?._totalPoints
        ? Math.round(samples.length / fieldObj._totalPoints * 100)
        : 100,
      synced_at: new Date().toISOString()
    };

    // Upsert: insert or update by (project, field_name)
    await this._fetch('/field_syncs', {
      method: 'POST',
      _prefer: 'resolution=merge-duplicates,return=representation',
      body: JSON.stringify(row)
    });

    // Log activity
    await this._logActivity(collector, 'sync', {
      project: projectName,
      field: fieldName,
      samples: samples.length
    });

    console.log(`[Cloud] Synced: ${fieldName} (${samples.length} samples)`);
  }

  // ═══════════════════════════════════════════════
  // SYNC ALL — Push all projects/fields at once
  // Mirror of the Drive syncAll flow
  // ═══════════════════════════════════════════════

  async syncAll(onProgress) {
    if (!this._enabled) throw new Error('Cloud no configurado');
    if (this._syncing) throw new Error('Sync ya en progreso');
    this._syncing = true;

    try {
    const projects = await pixDB.getAll('projects');
    const allSamples = await pixDB.getAll('samples');
    const allFields = await pixDB.getAll('fields');
    const allPoints = await pixDB.getAll('points');
    const collector = await pixDB.getSetting('collectorName') || 'Tecnico';

    let synced = 0;
    let total = 0;

    // Count fields with samples
    const fieldIds = [...new Set(allSamples.map(s => s.fieldId))];
    total = fieldIds.length;

    for (const fieldId of fieldIds) {
      const field = allFields.find(f => f.id === fieldId);
      if (!field) continue;

      const project = projects.find(p => p.id === field.projectId);
      const fieldSamples = allSamples.filter(s => s.fieldId === fieldId);
      const fieldPoints = allPoints.filter(p => p.fieldId === fieldId);

      // Enrich field with total points count
      field._totalPoints = fieldPoints.length;

      try {
        await this.syncField(
          project?.name || 'Sin proyecto',
          field.name || 'Sin campo',
          project?.client || '',
          field,
          fieldSamples,
          collector
        );
        synced++;
        if (onProgress) onProgress(synced, total);
      } catch (e) {
        console.warn(`[Cloud] Failed to sync field ${field.name}:`, e.message);
      }
    }

    return { synced, total };
    } finally { this._syncing = false; }
  }

  // ═══════════════════════════════════════════════
  // ACTIVITY LOG
  // ═══════════════════════════════════════════════

  async _logActivity(technician, action, details) {
    try {
      await this._fetch('/activity_log', {
        method: 'POST',
        _prefer: 'return=minimal',
        body: JSON.stringify({
          technician: technician || 'Anonimo',
          action,
          details
        })
      });
    } catch (e) {
      // Non-critical — don't throw
      console.warn('[Cloud] Activity log failed:', e.message);
    }
  }

  // ═══════════════════════════════════════════════
  // SETTINGS
  // ═══════════════════════════════════════════════

  async saveSettings(url, key) {
    const cleanUrl = (url || '').trim().replace(/\/+$/, '');
    const cleanKey = (key || '').trim();
    await pixDB.setSetting('cloud_url', cleanUrl);
    await pixDB.setSetting('cloud_key', cleanKey);
    this.url = cleanUrl;
    this.key = cleanKey;
    this._enabled = !!(cleanUrl && cleanKey);
  }

  // Test connection
  async testConnection() {
    if (!this._enabled) throw new Error('Configura URL y Key primero');
    const resp = await this._fetch('/field_syncs?select=count&limit=0', {
      method: 'HEAD'
    });
    return resp.ok;
  }
}

const pixCloud = new PixCloud();
