// Sync utilities for PIX Muestreo
// Background sync registration and network status management

class SyncManager {
  constructor() {
    this.syncInProgress = false;
    this.lastSyncTime = null;
  }

  // Register for background sync
  async registerBackgroundSync() {
    if ('serviceWorker' in navigator && 'SyncManager' in window) {
      try {
        const reg = await navigator.serviceWorker.ready;
        await reg.sync.register('sync-samples');
        console.log('Background sync registered');
      } catch (e) {
        console.log('Background sync not supported:', e);
      }
    }
  }

  // Auto-sync when coming online
  // NOTE: app.js _checkAutoSync() already registers a debounced online handler
  // for cloud+drive sync. This method only handles background sync registration.
  setupAutoSync() {
    // No duplicate online listener — app.js handles online→sync via _checkAutoSync()
    console.log('[SyncManager] Auto-sync delegated to app._checkAutoSync()');
  }

}

const syncManager = new SyncManager();

// Setup auto-sync on load
document.addEventListener('DOMContentLoaded', () => {
  syncManager.setupAutoSync();
});
