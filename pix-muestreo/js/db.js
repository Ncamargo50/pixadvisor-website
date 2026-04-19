// IndexedDB - Offline database for PIX Muestreo
const DB_NAME = 'PixMuestreo';
const DB_VERSION = 5;

class PixDB {
  constructor() {
    this.db = null;
  }

  async init() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = e => {
        const db = e.target.result;
        const tx = e.target.transaction;

        // Projects (haciendas/fazendas)
        if (!db.objectStoreNames.contains('projects')) {
          const ps = db.createObjectStore('projects', { keyPath: 'id', autoIncrement: true });
          ps.createIndex('name', 'name', { unique: false });
          ps.createIndex('userId', 'userId', { unique: false });
        } else {
          const ps = tx.objectStore('projects');
          if (!ps.indexNames.contains('userId')) ps.createIndex('userId', 'userId', { unique: false });
        }

        // Fields (talhoes/lotes)
        if (!db.objectStoreNames.contains('fields')) {
          const fs = db.createObjectStore('fields', { keyPath: 'id', autoIncrement: true });
          fs.createIndex('projectId', 'projectId', { unique: false });
          fs.createIndex('name', 'name', { unique: false });
        }

        // Sample points (puntos de muestreo)
        if (!db.objectStoreNames.contains('points')) {
          const pts = db.createObjectStore('points', { keyPath: 'id', autoIncrement: true });
          pts.createIndex('fieldId', 'fieldId', { unique: false });
          pts.createIndex('status', 'status', { unique: false });
          pts.createIndex('fieldId_status', ['fieldId', 'status'], { unique: false });
        } else {
          const pts = tx.objectStore('points');
          if (!pts.indexNames.contains('fieldId_status')) {
            pts.createIndex('fieldId_status', ['fieldId', 'status'], { unique: false });
          }
        }

        // Collected samples (muestras colectadas)
        if (!db.objectStoreNames.contains('samples')) {
          const ss = db.createObjectStore('samples', { keyPath: 'id', autoIncrement: true });
          ss.createIndex('pointId', 'pointId', { unique: false });
          ss.createIndex('synced', 'synced', { unique: false });
          ss.createIndex('fieldId', 'fieldId', { unique: false });
          ss.createIndex('userId', 'userId', { unique: false });
          ss.createIndex('fieldId_synced', ['fieldId', 'synced'], { unique: false });
        } else {
          const ss = tx.objectStore('samples');
          if (!ss.indexNames.contains('userId')) ss.createIndex('userId', 'userId', { unique: false });
          if (!ss.indexNames.contains('fieldId_synced')) {
            ss.createIndex('fieldId_synced', ['fieldId', 'synced'], { unique: false });
          }
        }

        // Track/route (recorrido GPS)
        if (!db.objectStoreNames.contains('tracks')) {
          const ts = db.createObjectStore('tracks', { keyPath: 'id', autoIncrement: true });
          ts.createIndex('fieldId', 'fieldId', { unique: false });
        }

        // Sync queue
        if (!db.objectStoreNames.contains('syncQueue')) {
          db.createObjectStore('syncQueue', { keyPath: 'id', autoIncrement: true });
        }

        // Settings
        if (!db.objectStoreNames.contains('settings')) {
          db.createObjectStore('settings', { keyPath: 'key' });
        }

        // === V3 NEW STORES ===

        // Users (usuarios con roles)
        if (!db.objectStoreNames.contains('users')) {
          const us = db.createObjectStore('users', { keyPath: 'id' });
          us.createIndex('email', 'email', { unique: true });
          us.createIndex('role', 'role', { unique: false });
          us.createIndex('active', 'active', { unique: false });
        }

        // Service Orders (ordenes de servicio)
        if (!db.objectStoreNames.contains('serviceOrders')) {
          const so = db.createObjectStore('serviceOrders', { keyPath: 'id', autoIncrement: true });
          so.createIndex('projectId', 'projectId', { unique: false });
          so.createIndex('fieldId', 'fieldId', { unique: false });
          so.createIndex('technicianId', 'technicianId', { unique: false });
          so.createIndex('status', 'status', { unique: false });
          so.createIndex('createdBy', 'createdBy', { unique: false });
          so.createIndex('priority', 'priority', { unique: false });
        }

        // === V5 NEW STORE: Offline file backup ===
        // Stores generated reports (HTML), tracks (GeoJSON), boundaries (GeoJSON)
        // so they persist inside the APK and can be re-downloaded or re-synced
        if (!db.objectStoreNames.contains('files')) {
          const fl = db.createObjectStore('files', { keyPath: 'id', autoIncrement: true });
          fl.createIndex('fieldId', 'fieldId', { unique: false });
          fl.createIndex('type', 'type', { unique: false });          // 'ibra_report', 'track', 'boundary', 'backup'
          fl.createIndex('synced', 'synced', { unique: false });      // 0 = pending, 1 = synced
          fl.createIndex('createdAt', 'createdAt', { unique: false });
        }
      };
      req.onblocked = () => reject(new Error('Base de datos bloqueada por otra pestaña/worker'));
      req.onsuccess = e => {
        this.db = e.target.result;
        // Allow other tabs to upgrade by closing this connection when needed
        this.db.onversionchange = () => { this.db.close(); this.db = null; };
        resolve(this.db);
      };
      req.onerror = e => reject(e.target.error);
    });
  }

  // One-time migration to seed admin and stamp existing data
  async migrateToV3() {
    const done = await this.getSetting('migration_v3_done');
    if (done) return;

    // Seed default admin user
    const users = await this.getAll('users');
    if (users.length === 0) {
      await this.putUser({
        id: 'admin-default',
        name: 'Administrador',
        email: 'admin@pixadvisor.local',
        passwordHash: '7a17b544989777f595141ea66cc7b88f7e6d5efcb9f6d5f4fef6c1f1e187127e',
        role: 'admin',
        active: true,
        createdAt: new Date().toISOString()
      });
    }

    // Stamp userId on existing projects
    const projects = await this.getAll('projects');
    for (const p of projects) {
      if (!p.userId) {
        p.userId = 'admin-default';
        await this.put('projects', p);
      }
    }

    // Stamp userId on existing samples
    const samples = await this.getAll('samples');
    for (const s of samples) {
      if (!s.userId) {
        s.userId = 'admin-default';
        await this.put('samples', s);
      }
    }

    await this.setSetting('migration_v3_done', true);
  }

  // Guard: ensure DB is initialized before any operation
  _ensureDB() {
    if (!this.db) throw new Error('IndexedDB no inicializada — llamá pixDB.init() primero');
  }

  // Generic CRUD
  // A3 FIX: Don't overwrite caller's createdAt (e.g. from sync/import)
  async add(store, data) {
    this._ensureDB();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(store, 'readwrite');
      const req = tx.objectStore(store).add({
        ...data,
        createdAt: data.createdAt || new Date().toISOString()
      });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  // A4 FIX: Don't overwrite caller's updatedAt (e.g. from remote sync)
  async put(store, data) {
    this._ensureDB();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(store, 'readwrite');
      const req = tx.objectStore(store).put({
        ...data,
        updatedAt: data.updatedAt || new Date().toISOString()
      });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  // Put user without auto-timestamps (uses string keyPath)
  async putUser(userData) {
    this._ensureDB();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('users', 'readwrite');
      const req = tx.objectStore('users').put(userData);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async get(store, id) {
    this._ensureDB();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(store, 'readonly');
      const req = tx.objectStore(store).get(id);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async getAll(store) {
    this._ensureDB();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(store, 'readonly');
      const req = tx.objectStore(store).getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async getAllByIndex(store, indexName, value) {
    this._ensureDB();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(store, 'readonly');
      const idx = tx.objectStore(store).index(indexName);
      const req = idx.getAll(value);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  // Get single record by index value
  async getByIndex(store, indexName, value) {
    this._ensureDB();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(store, 'readonly');
      const idx = tx.objectStore(store).index(indexName);
      const req = idx.get(value);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async delete(store, id) {
    this._ensureDB();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(store, 'readwrite');
      const req = tx.objectStore(store).delete(id);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  async clear(store) {
    this._ensureDB();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(store, 'readwrite');
      const req = tx.objectStore(store).clear();
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  async count(store) {
    this._ensureDB();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(store, 'readonly');
      const req = tx.objectStore(store).count();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  // Get unsynced samples
  async getUnsyncedSamples() {
    return this.getAllByIndex('samples', 'synced', 0);
  }

  // Mark sample as synced
  async markSynced(sampleId, extraMeta = null) {
    const sample = await this.get('samples', sampleId);
    if (sample) {
      sample.synced = 1;
      sample.syncedAt = new Date().toISOString();
      // Merge extra metadata (e.g., { photoFailed: true } for retry)
      if (extraMeta) Object.assign(sample, extraMeta);
      await this.put('samples', sample);
    }
  }

  // Get setting
  async getSetting(key) {
    const s = await this.get('settings', key);
    return s ? s.value : null;
  }

  // Set setting
  async setSetting(key, value) {
    return this.put('settings', { key, value });
  }

  // Atomic save: sample + point status update in ONE transaction
  // If either fails, both roll back — prevents orphaned samples on crash
  async saveSampleAtomic(sample, point) {
    this._ensureDB();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(['samples', 'points'], 'readwrite');
      const now = new Date().toISOString();
      tx.objectStore('samples').add({ ...sample, createdAt: sample.createdAt || now });
      tx.objectStore('points').put({ ...point, updatedAt: point.updatedAt || now });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('Transaction aborted'));
    });
  }

  // Bulk add multiple records in a single transaction
  async bulkAdd(store, items) {
    this._ensureDB();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(store, 'readwrite');
      const os = tx.objectStore(store);
      const now = new Date().toISOString();
      for (const item of items) {
        os.add({ ...item, createdAt: item.createdAt || now });
      }
      tx.oncomplete = () => resolve(items.length);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('bulkAdd transaction aborted'));
    });
  }

  // ═══════════════════════════════════════════════
  // FILE BACKUP — Save/retrieve generated files
  // ═══════════════════════════════════════════════

  // Save a file to IndexedDB for offline backup.
  //
  // IndexedDB QuotaExceededError is the single most common way this app
  // "silently breaks" in the field — the user keeps sampling, we keep
  // adding rows, and eventually writes start failing with no visible error.
  // We:
  //   1. Check quota before the write; refuse above 95 % to leave headroom.
  //   2. Catch the DOMException and surface a clear message to the caller.
  //   3. Opportunistically prune synced files when we're over 85 %.
  async saveFile(fileData) {
    // fileData: { fieldId, projectName, fieldName, fileName, type, mimeType, content, synced: 0 }
    // `content` may be a string (HTML / legacy base64 data URL) OR a Blob.
    // Blob is preferred for binary payloads (PDF, images) — avoids the ~33%
    // base64 expansion and the memory cost of the intermediate data URL.
    try {
      const est = await this.storageEstimate();
      if (est.percentUsed > 85) {
        await this._pruneSyncedFiles().catch(() => {});
      }
      if (est.quota && est.percentUsed >= 95) {
        const err = new Error('Almacenamiento casi lleno. Liberá espacio o sincronizá a la nube.');
        err.name = 'QuotaNearFull';
        err.estimate = est;
        throw err;
      }
    } catch (e) {
      // Only rethrow if WE threw — swallow storageEstimate() errors.
      if (e && e.name === 'QuotaNearFull') throw e;
    }
    // Correct byte-size for either Blob (`.size`) or string (`.length`, which
    // is close enough for ASCII/UTF-8-ish cases we care about here).
    // NOTE: we compute sizeBytes on the PLAINTEXT so quota accounting stays
    // intuitive — the encrypted envelope is ~28 bytes larger (IV + tag + b64
    // expansion) but we want sync/ui to reflect the user-visible size.
    let sizeBytes = 0;
    if (fileData.content) {
      if (typeof Blob !== 'undefined' && fileData.content instanceof Blob) {
        sizeBytes = fileData.content.size;
      } else if (typeof fileData.content === 'string') {
        sizeBytes = fileData.content.length;
      }
    }
    // At-rest encryption — opportunistic. If the vault isn't unlocked (old
    // browser, disabled, not yet initialized), we store plaintext and the
    // read path handles both transparently. Sensitive payloads (PDFs,
    // base64 photos) are the ones we MOST want encrypted; for those the
    // vault is guaranteed to be up by the time any UI path calls saveFile.
    let storedContent = fileData.content;
    try {
      if (window.pixVault && window.pixVault.isUnlocked() && storedContent != null) {
        storedContent = await window.pixVault.encryptField(storedContent);
      }
    } catch (e) {
      console.warn('[DB] encrypt failed, storing plaintext:', e && e.message);
    }
    try {
      return await this.add('files', {
        ...fileData,
        content: storedContent,
        encrypted: storedContent && storedContent.__enc ? 1 : 0,
        synced: fileData.synced || 0,
        sizeBytes
      });
    } catch (e) {
      // Browsers surface the quota error via DOMException.name==='QuotaExceededError'
      // (with error.code === 22) on IndexedDB transactions.
      const isQuota = (e && (e.name === 'QuotaExceededError' ||
                             e.code === 22 ||
                             /quota/i.test(String(e.message || ''))));
      if (isQuota) {
        // Try one more prune, then rethrow with a friendly message
        await this._pruneSyncedFiles().catch(() => {});
        const friendly = new Error('No hay espacio para guardar el archivo. Sincronizá a Drive/Cloud o liberá archivos viejos.');
        friendly.name = 'QuotaExceededError';
        friendly.cause = e;
        throw friendly;
      }
      throw e;
    }
  }

  // Return a file's `content` as a Blob regardless of whether it was stored
  // as a Blob (new path), a base64 data URL (legacy rows written by older
  // versions), or an encrypted envelope (v3.16+). Callers that need to
  // upload / download the raw bytes should go through this helper so all
  // three formats stay transparent.
  async getFileAsBlob(fileId) {
    const f = await this.get('files', fileId);
    if (!f || !f.content) return null;
    let content = f.content;
    // Encrypted envelope? Decrypt first (requires vault unlocked — boot
    // unlocks with device secret, so this works for all normal reads).
    if (content && typeof content === 'object' && content.__enc === 'pix-aesgcm-v1') {
      if (!window.pixVault || !window.pixVault.isUnlocked()) {
        throw new Error('Vault bloqueado — no se puede leer el archivo cifrado');
      }
      content = await window.pixVault.decryptField(content);
    }
    if (typeof Blob !== 'undefined' && content instanceof Blob) return content;
    if (typeof content === 'string') {
      const s = content;
      // Data URL? (data:<mime>;base64,<b64>)
      const dm = s.match(/^data:([^;]+);base64,(.*)$/);
      if (dm) {
        const bin = atob(dm[2]);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        return new Blob([bytes], { type: dm[1] || f.mimeType || 'application/octet-stream' });
      }
      // Plain string (e.g. HTML) — wrap directly.
      return new Blob([s], { type: f.mimeType || 'text/plain' });
    }
    if (content instanceof Uint8Array) {
      return new Blob([content], { type: f.mimeType || 'application/octet-stream' });
    }
    return null;
  }

  // Remove already-synced files older than 7 days to reclaim space.
  // Only deletes files with synced=1 AND syncedAt older than the cutoff —
  // never touches unsynced data.
  async _pruneSyncedFiles() {
    const cutoff = Date.now() - 7 * 24 * 3600 * 1000;
    const synced = await this.getAllByIndex('files', 'synced', 1);
    let removed = 0;
    for (const f of synced) {
      const syncedAt = f.syncedAt ? Date.parse(f.syncedAt) : 0;
      if (syncedAt && syncedAt < cutoff) {
        try { await this.delete('files', f.id); removed++; } catch (_) {}
      }
    }
    if (removed > 0) console.log(`[DB] Pruned ${removed} synced files to free space`);
    return removed;
  }

  // Get all saved files (newest first)
  async getFiles() {
    const files = await this.getAll('files');
    return files.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  }

  // Get unsynced files
  async getUnsyncedFiles() {
    return this.getAllByIndex('files', 'synced', 0);
  }

  // Mark file as synced
  async markFileSynced(fileId) {
    const file = await this.get('files', fileId);
    if (file) {
      file.synced = 1;
      file.syncedAt = new Date().toISOString();
      await this.put('files', file);
    }
  }

  // Get files for a specific field
  async getFilesByField(fieldId) {
    return this.getAllByIndex('files', 'fieldId', fieldId);
  }

  // Check storage quota — returns { usage, quota, percentUsed }
  async storageEstimate() {
    if (navigator.storage && navigator.storage.estimate) {
      const est = await navigator.storage.estimate();
      return {
        usage: est.usage || 0,
        quota: est.quota || 0,
        percentUsed: est.quota ? Math.round((est.usage / est.quota) * 100) : 0
      };
    }
    return { usage: 0, quota: 0, percentUsed: 0 };
  }
}

// Singleton
const pixDB = new PixDB();
