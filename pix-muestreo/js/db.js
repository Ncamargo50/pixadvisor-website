// IndexedDB - Offline database for PIX Muestreo
const DB_NAME = 'PixMuestreo';
const DB_VERSION = 3;

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
        }

        // Collected samples (muestras colectadas)
        if (!db.objectStoreNames.contains('samples')) {
          const ss = db.createObjectStore('samples', { keyPath: 'id', autoIncrement: true });
          ss.createIndex('pointId', 'pointId', { unique: false });
          ss.createIndex('synced', 'synced', { unique: false });
          ss.createIndex('fieldId', 'fieldId', { unique: false });
          ss.createIndex('userId', 'userId', { unique: false });
        } else {
          const ss = tx.objectStore('samples');
          if (!ss.indexNames.contains('userId')) ss.createIndex('userId', 'userId', { unique: false });
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
      };
      req.onsuccess = e => { this.db = e.target.result; resolve(this.db); };
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
        passwordHash: '7a17b544989777f595141ea66cc7b88f7e6d5efcb9f6d5f4fef6c1f1e187127e', // pix2026
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

  // Generic CRUD
  async add(store, data) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(store, 'readwrite');
      const req = tx.objectStore(store).add({ ...data, createdAt: new Date().toISOString() });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async put(store, data) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(store, 'readwrite');
      const req = tx.objectStore(store).put({ ...data, updatedAt: new Date().toISOString() });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  // Put user without auto-timestamps (uses string keyPath)
  async putUser(userData) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('users', 'readwrite');
      const req = tx.objectStore('users').put(userData);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async get(store, id) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(store, 'readonly');
      const req = tx.objectStore(store).get(id);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async getAll(store) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(store, 'readonly');
      const req = tx.objectStore(store).getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async getAllByIndex(store, indexName, value) {
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
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(store, 'readonly');
      const idx = tx.objectStore(store).index(indexName);
      const req = idx.get(value);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async delete(store, id) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(store, 'readwrite');
      const req = tx.objectStore(store).delete(id);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  async clear(store) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(store, 'readwrite');
      const req = tx.objectStore(store).clear();
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  async count(store) {
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
}

// Singleton
const pixDB = new PixDB();
