// PIX Cloud Sync — Supabase integration for multi-technician sync
// Uses direct REST API (PostgREST) — no external library needed
// Works alongside Google Drive sync — independent fallback paths

// App version constant — used by registerDevice() for fleet tracking
// IMPORTANT: Keep APP_VERSION in sync with CACHE_NAME in sw.js
const APP_VERSION = 'pix-muestreo-v65';

// Bound the number of retry attempts per field across app sessions. Without
// this, a field with a permanent failure (corrupt schema, oversize payload,
// 4xx not caught by preflight) is retried on every app start AND every
// 'online' event AND every 24h auto-sync — burning the user's data plan.
// Resets to 0 on any successful sync of that field.
const MAX_FIELD_SYNC_ATTEMPTS = 8;

// ── Supabase "bootstrap" endpoint & anon key ─────────────────────────────
// SECURITY MODEL: The Supabase anon key is PUBLIC by design — it grants only
// anonymous role access, and all data is protected by Row Level Security (RLS)
// policies enforced server-side. An attacker extracting this key from the APK
// gains NO additional capability beyond what any anonymous web client already
// has. The real security boundary lives in the Supabase dashboard (RLS rules,
// policy definitions on every table, service_role key kept server-side only).
//
// Rotation: if compromise is suspected or after personnel changes, rotate the
// anon key in Supabase → ship a new APK version → old APKs stop syncing until
// users update. Alternate URL/Key can also be provisioned per tenant via the
// in-app Settings screen (overrides these defaults at runtime — see init()).
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

  getSettings() {
    if (!this._enabled) return null;
    return { url: this.url, key: this.key };
  }

  // ═══════════════════════════════════════════════
  // REST API helpers (PostgREST / Supabase)
  // ═══════════════════════════════════════════════

  async _fetch(path, options = {}) {
    if (!this._enabled) throw new Error('Cloud no configurado');
    // v3.17: exponential backoff for transient failures (2G/3G jitter, 5xx).
    // 4 attempts with delays 0s, 1s, 2s, 4s → max ~7s total before giving up.
    // 4xx (client errors) bail immediately — retrying won't help.
    const MAX_ATTEMPTS = 4;
    let lastErr;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      if (attempt > 0) {
        const delay = Math.pow(2, attempt - 1) * 1000; // 1s, 2s, 4s
        await new Promise(r => setTimeout(r, delay));
      }
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000);
      try {
        const resp = await fetch(this.url + '/rest/v1' + path, {
          ...options,
          signal: controller.signal,
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
          const err = new Error(`Cloud ${resp.status}: ${errText}`);
          err.status = resp.status;
          // 4xx is deterministic client error — no point retrying auth or bad schema
          if (resp.status >= 400 && resp.status < 500) throw err;
          lastErr = err;
          continue; // 5xx → retry
        }
        return resp;
      } catch (e) {
        clearTimeout(timeoutId);
        if (e.status && e.status >= 400 && e.status < 500) throw e;
        // Network / timeout / 5xx — retry unless last attempt
        lastErr = (e.name === 'AbortError')
          ? new Error('Cloud: timeout de red (30s)')
          : e;
        if (attempt === MAX_ATTEMPTS - 1) throw lastErr;
      } finally {
        clearTimeout(timeoutId);
      }
    }
    throw lastErr || new Error('Cloud: falló tras reintentos');
  }

  // Build a Supabase Edge Function URL. Returns null if cloud not configured,
  // so callers (e.g. integrity.js) can "fail open" instead of crashing.
  _supabaseFunctionUrl(fnName) {
    if (!this.url || !fnName) return null;
    return this.url + '/functions/v1/' + encodeURIComponent(fnName);
  }

  // Auth headers for direct fetch() calls (Edge Functions, storage, etc.).
  // Kept separate from _fetch() because Functions use a different base URL
  // and some callers add their own Content-Type (multipart, binary, etc.).
  _authHeaders() {
    const h = {};
    if (this.key) {
      h['apikey'] = this.key;
      h['Authorization'] = 'Bearer ' + this.key;
    }
    return h;
  }

  // ═══════════════════════════════════════════════
  // SYNC FIELD — Push complete field data to cloud
  // Called after Drive sync or independently
  // ═══════════════════════════════════════════════

  async syncField(projectName, fieldName, clientName, fieldObj, samples, collector, tracks) {
    if (!this._enabled) return;

    // ── CONFLICT DETECTION (v3.17): before overwriting the field row in cloud,
    // pull the current version and refuse to clobber samples that have been
    // updated in cloud MORE RECENTLY than our local copy. Common scenario:
    // two técnicos work in the same lote; one syncs → we pull stale orders →
    // we're about to push back over the other's work. We log a warning and
    // skip just THOSE samples, keeping everyone's data intact.
    let cloudSamples = [];
    try {
      const existingResp = await this._fetch(
        `/field_syncs?project=eq.${encodeURIComponent(projectName || 'Sin proyecto')}` +
        `&field_name=eq.${encodeURIComponent(fieldName || 'Sin campo')}&select=samples,synced_at`
      );
      const existing = await existingResp.json();
      if (existing && existing.length > 0 && Array.isArray(existing[0].samples)) {
        cloudSamples = existing[0].samples;
      }
    } catch (e) {
      // Non-fatal — if preflight fails, proceed with best-effort push.
      console.warn('[Cloud] conflict preflight skipped:', e.message);
    }
    const cloudByPoint = {};
    for (const cs of cloudSamples) {
      const key = cs.pointId != null ? String(cs.pointId) : (cs.pointName || '');
      if (!key) continue;
      // Keep the NEWEST of any duplicates already in cloud
      if (!cloudByPoint[key] || (cs.collectedAt || '') > (cloudByPoint[key].collectedAt || '')) {
        cloudByPoint[key] = cs;
      }
    }
    let conflictsSkipped = 0;
    const mergedSamples = [];
    for (const s of samples) {
      const key = s.pointId != null ? String(s.pointId) : (s.pointName || '');
      const cloudSample = key ? cloudByPoint[key] : null;
      if (cloudSample) {
        const localTs = s.collectedAt || s.updatedAt || '';
        const cloudTs = cloudSample.collectedAt || cloudSample.updatedAt || '';
        // Cloud strictly newer AND different collector → don't overwrite.
        if (cloudTs && cloudTs > localTs && cloudSample.collector &&
            cloudSample.collector !== s.collector) {
          mergedSamples.push(cloudSample);
          conflictsSkipped++;
          continue;
        }
      }
      mergedSamples.push(s);
    }
    // Also fold in cloud-only samples that we don't have locally (multi-tech
    // captures where the other device already pushed a different pointId).
    const localKeys = new Set(samples.map(s =>
      s.pointId != null ? String(s.pointId) : (s.pointName || '')
    ).filter(Boolean));
    for (const [k, cs] of Object.entries(cloudByPoint)) {
      if (!localKeys.has(k)) mergedSamples.push(cs);
    }
    if (conflictsSkipped > 0) {
      console.warn(`[Cloud] ${conflictsSkipped} sample conflict(s) resolved by keeping cloud (newer).`);
    }

    // Build zone summary from the merged set — ensures progress_pct reflects
    // true total across all técnicos working the same lote.
    const zones = {};
    for (const s of mergedSamples) {
      const z = s.zona || 1;
      if (!zones[z]) zones[z] = { zona: z, count: 0, barcode: null, clase: '' };
      zones[z].count++;
      if (s.zoneBarcode) zones[z].barcode = s.zoneBarcode;
      if (s.zoneIbraSampleId) zones[z].ibra = s.zoneIbraSampleId;
    }

    // GPS track (breadcrumb trail) — v3.17: now also pushed to Supabase so
    // the office dashboard can audit the técnico's route.
    const trackPositions = (tracks && tracks.length > 0 && Array.isArray(tracks[0].positions))
      ? tracks[0].positions : [];

    const row = {
      technician: collector || 'Sin nombre',
      project: projectName || 'Sin proyecto',
      field_name: fieldName || 'Sin campo',
      client: clientName || '',
      area_ha: fieldObj?.area || null,
      boundary: fieldObj?.boundary || null,
      samples: mergedSamples.map(s => ({
        pointId: s.pointId,
        pointName: s.pointName,
        zona: s.zona,
        lat: s.lat,
        lng: s.lng,
        accuracy: s.accuracy,
        gpsMethod: s.gpsMethod || 'single',
        gnss: s.gnss || null,
        depth: s.depth,
        sampleType: s.sampleType,
        barcode: s.barcode,
        collector: s.collector,
        collectedAt: s.collectedAt,
        updatedAt: s.updatedAt || s.collectedAt,
        notes: s.notes
      })),
      track_positions: trackPositions,
      track_count: trackPositions.length,
      zones_summary: Object.values(zones),
      total_points: fieldObj?._totalPoints || mergedSamples.length,
      collected_points: mergedSamples.length,
      progress_pct: fieldObj?._totalPoints
        ? Math.round(mergedSamples.length / fieldObj._totalPoints * 100)
        : 100,
      conflicts_resolved: conflictsSkipped,
      synced_at: new Date().toISOString()
    };

    // Upsert: insert or update by (project, field_name)
    // CRITICAL: on_conflict tells PostgREST which unique constraint to use
    // Without it, duplicate project+field_name returns 409 instead of merging
    await this._fetch('/field_syncs?on_conflict=project,field_name', {
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
    // v3.17.4: return conflict info so syncAll can aggregate and the UI
    // can warn the técnico their work was overwritten by another técnico's newer data.
    return { conflicts: conflictsSkipped, sampleCount: mergedSamples.length };
  }

  // ═══════════════════════════════════════════════
  // DELETE FIELD SYNC — Remove cloud row when técnico deletes the field locally
  // Without this the dashboard keeps showing the deleted field as "pendiente".
  // Identifies the row by the (project, field_name) unique pair used on upsert.
  // Silent on failure: local delete must succeed even if cloud is offline.
  // ═══════════════════════════════════════════════

  async deleteFieldSync(projectName, fieldName) {
    if (!this._enabled) return;
    if (!projectName && !fieldName) return;
    try {
      const path = `/field_syncs?project=eq.${encodeURIComponent(projectName || 'Sin proyecto')}` +
                   `&field_name=eq.${encodeURIComponent(fieldName || 'Sin campo')}`;
      const resp = await this._fetch(path, { method: 'DELETE', _prefer: 'return=representation' });
      const body = await resp.text();
      const deleted = body && body !== '[]' ? JSON.parse(body).length : 0;
      console.log(`[Cloud] deleteFieldSync(${projectName}/${fieldName}) → ${deleted} row(s) removed`);
      if (deleted > 0) {
        await this._logActivity('system', 'delete_field_sync', { project: projectName, field: fieldName });
      }
    } catch (e) {
      console.warn('[Cloud] deleteFieldSync failed (non-fatal):', e.message || e);
    }
  }

  // ═══════════════════════════════════════════════
  // SYNC ALL — Push all projects/fields at once
  // Mirror of the Drive syncAll flow
  // ═══════════════════════════════════════════════

  async syncAll(onProgress) {
    if (!this._enabled) throw new Error('Cloud no configurado');
    if (this._syncing) throw new Error('Sync ya en progreso');
    this._syncing = true;
    this._lastSyncError = null;

    try {
    const projects = await pixDB.getAll('projects');
    const allSamples = await pixDB.getAll('samples');
    const allFields = await pixDB.getAll('fields');
    const allPoints = await pixDB.getAll('points');
    const allTracks = await pixDB.getAll('tracks');
    const collector = await pixDB.getSetting('collectorName') || 'Tecnico';

    // v3.17.5 / P1-1: persistent retry counter map. Stored as a settings entry
    // so it survives app restart, wipes-out, and repeated 'online' triggers.
    // Shape: { "<fieldId>": { attempts, lastError, lastAttemptAt } }
    let failureMap = {};
    try {
      const raw = await pixDB.getSetting('cloud_field_failures');
      if (raw) failureMap = (typeof raw === 'string') ? JSON.parse(raw) : raw;
      if (!failureMap || typeof failureMap !== 'object') failureMap = {};
    } catch (_) { failureMap = {}; }

    let synced = 0;
    let total = 0;
    let totalConflicts = 0; // v3.17.4: aggregate cross-técnico conflicts
    let authFailed = false; // v3.17.4: 401 short-circuits remaining fields
    let permanentlyFailed = 0; // v3.17.5: fields skipped because they exceeded MAX_FIELD_SYNC_ATTEMPTS
    let skippedNames = [];     // v3.17.5: surface stuck-field names to the UI

    // Count fields with samples
    const fieldIds = [...new Set(allSamples.map(s => s.fieldId))];
    total = fieldIds.length;

    for (const fieldId of fieldIds) {
      if (authFailed) break; // No point trying more fields if auth is bad
      const field = allFields.find(f => f.id === fieldId);
      if (!field) continue;

      // v3.17.5: skip fields that have failed too many times. The user can
      // reset the counter via pixCloud.resetFailureCounters() (wired to a
      // "Reintentar fallidos" button in the sync view).
      const failKey = String(fieldId);
      const failEntry = failureMap[failKey];
      if (failEntry && failEntry.attempts >= MAX_FIELD_SYNC_ATTEMPTS) {
        permanentlyFailed++;
        if (skippedNames.length < 5) skippedNames.push(field.name || `#${fieldId}`);
        continue;
      }

      const project = projects.find(p => p.id === field.projectId);
      const fieldSamples = allSamples.filter(s => s.fieldId === fieldId);
      const fieldPoints = allPoints.filter(p => p.fieldId === fieldId);
      const fieldTracks = allTracks.filter(t => t.fieldId === fieldId);

      // Enrich field with total points count
      field._totalPoints = fieldPoints.length;

      try {
        const result = await this.syncField(
          project?.name || 'Sin proyecto',
          field.name || 'Sin campo',
          project?.client || '',
          field,
          fieldSamples,
          collector,
          fieldTracks
        );
        synced++;
        if (result && result.conflicts) totalConflicts += result.conflicts;
        // Clear any previous failure record for this field on success.
        if (failureMap[failKey]) delete failureMap[failKey];
        if (onProgress) onProgress(synced, total);
      } catch (e) {
        console.warn(`[Cloud] Failed to sync field ${field.name}:`, e.message);
        // v3.17.4: detect auth failure (401) and surface a clear flag so
        // the técnico can see "sesión expirada" instead of a silent miss.
        if (e.status === 401 || /401|unauthorized|JWT/i.test(String(e.message || ''))) {
          authFailed = true;
          this._lastSyncError = 'AUTH_EXPIRED: Sesión Supabase vencida — reconfigurá la nube en Ajustes';
          // Don't increment counter on auth issues — that's a configuration
          // problem, not a per-field problem. Once cloud is reconfigured,
          // the existing samples should sync normally.
        } else {
          this._lastSyncError = `${field.name}: ${e.message}`;
          // v3.17.5: bump failure counter for this field so we eventually
          // stop retrying if it's a permanent issue (4xx schema, etc.).
          const prev = failureMap[failKey] || { attempts: 0 };
          failureMap[failKey] = {
            attempts: (prev.attempts || 0) + 1,
            lastError: String(e.message || '').slice(0, 200),
            lastAttemptAt: new Date().toISOString()
          };
          if (failureMap[failKey].attempts >= MAX_FIELD_SYNC_ATTEMPTS) {
            console.warn(`[Cloud] Field "${field.name}" reached max attempts (${MAX_FIELD_SYNC_ATTEMPTS}) — will skip until manual reset`);
          }
        }
      }
    }

    // Persist updated failure map (best-effort; never block sync on a setting write).
    try { await pixDB.setSetting('cloud_field_failures', JSON.stringify(failureMap)); } catch (_) {}

    // Persist timestamp of last successful cloud sync so the UI can show
    // "Última sincronización hace X min" and the stale-data warning.
    try { await pixDB.setSetting('cloud_last_sync_at', new Date().toISOString()); } catch (_) {}
    return {
      synced,
      total,
      conflicts: totalConflicts,
      authFailed,
      permanentlyFailed,        // v3.17.5
      stuckFields: skippedNames, // v3.17.5
      lastError: this._lastSyncError || null
    };
    } finally { this._syncing = false; }
  }

  // ═══════════════════════════════════════════════
  // RETRY COUNTER MANAGEMENT (v3.17.5 / P1-1)
  // ═══════════════════════════════════════════════
  // The retry counter is stored as a settings entry (`cloud_field_failures`)
  // and survives app restart. These helpers let the UI peek at stuck fields
  // and let the user manually reset counters via a "Reintentar fallidos"
  // button in the sync view.

  async getFailureMap() {
    try {
      const raw = await pixDB.getSetting('cloud_field_failures');
      if (!raw) return {};
      const parsed = (typeof raw === 'string') ? JSON.parse(raw) : raw;
      return (parsed && typeof parsed === 'object') ? parsed : {};
    } catch (_) {
      return {};
    }
  }

  async getStuckFieldCount() {
    const map = await this.getFailureMap();
    return Object.values(map).filter(v => (v.attempts || 0) >= MAX_FIELD_SYNC_ATTEMPTS).length;
  }

  // Clear all retry counters — exposed for a "Reintentar fallidos" button.
  // Returns the number of records cleared so the caller can show a toast.
  async resetFailureCounters() {
    try {
      const before = await this.getFailureMap();
      const count = Object.keys(before).length;
      await pixDB.setSetting('cloud_field_failures', JSON.stringify({}));
      return count;
    } catch (e) {
      console.warn('[Cloud] resetFailureCounters failed:', e.message);
      return 0;
    }
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

  // Test connection — returns true/false, throws only if not configured
  async testConnection() {
    if (!this._enabled) throw new Error('Configura URL y Key primero');
    try {
      const resp = await this._fetch('/field_syncs?limit=0', {
        method: 'HEAD'
      });
      return resp.ok;
    } catch (e) {
      console.warn('[Cloud] Test connection failed:', e.message);
      return false;
    }
  }

  // ═══════════════════════════════════════════════
  // DEVICE REGISTRATION
  // ═══════════════════════════════════════════════

  async registerDevice(deviceId, techName, location) {
    if (!this._enabled || !deviceId) return;
    try {
      const ua = navigator.userAgent;
      const row = {
        device_id: deviceId,
        technician_name: techName || 'Sin nombre',
        app_version: APP_VERSION,
        phone_model: this._extractModel(ua),
        os_version: this._extractOS(ua),
        sw_cache_version: APP_VERSION,
        last_seen: new Date().toISOString(),
        last_sync: new Date().toISOString(),
        last_location: location || null,
        active: true
      };
      await this._fetch('/devices?on_conflict=device_id', {
        method: 'POST',
        _prefer: 'resolution=merge-duplicates,return=minimal',
        body: JSON.stringify(row)
      });
      console.log('[Cloud] Device registered:', String(deviceId).slice(0, 8) + '...');
    } catch (e) {
      console.warn('[Cloud] Device registration failed:', e.message);
    }
  }

  _extractModel(ua) {
    const m = ua.match(/;\s*([^;)]+)\s*Build/i) || ua.match(/;\s*([^;)]+)\s*\)/i);
    return m ? m[1].trim() : (navigator.platform || 'Unknown');
  }

  _extractOS(ua) {
    const m = ua.match(/Android\s+([\d.]+)/i);
    if (m) return 'Android ' + m[1];
    const i = ua.match(/iPhone OS\s+([\d_]+)/i);
    if (i) return 'iOS ' + i[1].replace(/_/g, '.');
    return navigator.platform || 'Unknown';
  }

  // ═══════════════════════════════════════════════
  // PULL SERVICE ORDERS
  // ═══════════════════════════════════════════════

  async pullOrders(techName, techId) {
    if (!this._enabled) return [];
    try {
      let orders = [];
      // 1. Try by technician ID (most reliable)
      if (techId) {
        const resp = await this._fetch(
          `/service_orders?assigned_to=eq.${encodeURIComponent(techId)}&status=in.(pendiente,asignada,en_progreso)&order=created_at.desc`
        );
        orders = await resp.json();
      }
      // 2. Try by case-insensitive name match (handles casing differences)
      if (orders.length === 0 && techName) {
        const encoded = encodeURIComponent(techName);
        const resp = await this._fetch(
          `/service_orders?assigned_to_name=ilike.${encoded}&status=in.(pendiente,asignada,en_progreso)&order=created_at.desc`
        );
        orders = await resp.json();
      }
      // 3. Fallback: partial match (first name only, etc.)
      if (orders.length === 0 && techName) {
        const encoded = encodeURIComponent(techName);
        const resp = await this._fetch(
          `/service_orders?assigned_to_name=ilike.*${encoded}*&status=in.(pendiente,asignada,en_progreso)&order=created_at.desc`
        );
        orders = await resp.json();
      }
      console.log(`[Cloud] Pulled ${orders.length} orders for ${techName || techId}`);
      return orders;
    } catch (e) {
      console.warn('[Cloud] Pull orders failed:', e.message);
      return [];
    }
  }

  async updateOrderStatus(orderId, status) {
    if (!this._enabled || !orderId) return;
    const body = { status };
    if (status === 'en_progreso') body.started_at = new Date().toISOString();
    if (status === 'completada') body.completed_at = new Date().toISOString();
    await this._fetch(`/service_orders?id=eq.${encodeURIComponent(orderId)}`, {
      method: 'PATCH',
      body: JSON.stringify(body)
    });
    console.log(`[Cloud] Order ${String(orderId).slice(0, 8)}... → ${status}`);
  }

  // Check status of specific order IDs in cloud (for sync cancellations)
  async checkOrderStatuses(orderIds) {
    if (!this._enabled || !orderIds || orderIds.length === 0) return [];
    try {
      const ids = orderIds.map(id => `"${id}"`).join(',');
      const resp = await this._fetch(`/service_orders?id=in.(${ids})&select=id,status`);
      return await resp.json();
    } catch (e) {
      console.warn('[Cloud] Check order statuses failed:', e.message);
      return [];
    }
  }

  // ═══════════════════════════════════════════════
  // PULL TECHNICIAN CREDENTIALS
  // ═══════════════════════════════════════════════

  async pullTechnicians() {
    if (!this._enabled) return [];
    try {
      const resp = await this._fetch('/technicians?active=eq.true&select=username,password_hash,full_name,role,phone,email');
      return await resp.json();
    } catch (e) {
      console.warn('[Cloud] Pull technicians failed:', e.message);
      return [];
    }
  }
}

const pixCloud = new PixCloud();
