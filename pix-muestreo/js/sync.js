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
  setupAutoSync() {
    window.addEventListener('online', async () => {
      console.log('Back online - checking for unsynced data');
      const unsynced = await pixDB.getUnsyncedSamples();
      if (unsynced.length > 0 && driveSync.isAuthenticated()) {
        app.toast(`${unsynced.length} muestras pendientes. Sincronizando...`, 'warning');
        setTimeout(() => app.syncToDrive(), 2000);
      }
    });
  }

}

const syncManager = new SyncManager();

// Setup auto-sync on load
document.addEventListener('DOMContentLoaded', () => {
  syncManager.setupAutoSync();
});
