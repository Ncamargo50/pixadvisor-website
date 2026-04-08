// Authentication module for PIX Muestreo - Multi-user with roles + remote sync
class PixAuth {
  constructor() {
    this.currentUser = null;
    // Master admin key — works on ANY APK installation, no sync required
    // SHA-256 of 'pixmaster2026'
    this._masterHash = 'ac201887896eb32421c6785528a878dbd31faf74050f0f041c80d9304c70e298';
  }

  // Restore session from localStorage
  async init() {
    const userId = localStorage.getItem('pix_user_id');
    if (!userId) return false;

    // M7 FIX: Master admin session restore — validate with timestamp check
    if (userId === 'master-admin') {
      const masterTs = localStorage.getItem('pix_master_ts');
      // Session expires after 24 hours
      if (masterTs && (Date.now() - parseInt(masterTs)) < 86400000) {
        this.currentUser = { id: 'master-admin', name: 'Administrador PIX', email: 'admin', role: 'admin', active: true, _isMaster: true };
        return true;
      }
      // Expired master session
      localStorage.removeItem('pix_user_id');
      localStorage.removeItem('pix_master_ts');
      return false;
    }

    try {
      const user = await pixDB.get('users', userId);
      if (user && user.active) {
        this.currentUser = user;
        return true;
      }
    } catch (e) { console.warn('Auth restore failed:', e); }
    localStorage.removeItem('pix_user_id');
    return false;
  }

  // Login with email and password (+ master key support)
  async login(email, password) {
    if (!email || !password) return null;
    const emailLower = email.toLowerCase().trim();
    const hash = await this.hashPassword(password);

    // MASTER KEY: works on ANY APK without sync
    // User types any email/name + master password → admin access
    if (hash === this._masterHash) {
      const masterUser = {
        id: 'master-admin',
        name: 'Administrador PIX',
        email: emailLower,
        role: 'admin',
        active: true,
        _isMaster: true
      };
      this.currentUser = masterUser;
      localStorage.setItem('pix_user_id', masterUser.id);
      localStorage.setItem('pix_master_ts', String(Date.now()));
      console.log('[Auth] Master key login');
      return masterUser;
    }

    // Try by email index first
    let user = await pixDB.getByIndex('users', 'email', emailLower);

    // Fallback: search by name (case-insensitive)
    if (!user) {
      const allUsers = await pixDB.getAll('users');
      user = allUsers.find(u => u.name.toLowerCase() === emailLower || u.email.toLowerCase() === emailLower);
    }

    if (!user) return null;
    if (!user.active) return null;
    if (user.passwordHash !== hash) return null;

    this.currentUser = user;
    localStorage.setItem('pix_user_id', user.id);
    return user;
  }

  // Logout
  logout() {
    this.currentUser = null;
    localStorage.removeItem('pix_user_id');
    location.reload();
  }

  // Role checks
  isAdmin() { return this.currentUser?.role === 'admin'; }
  isTecnico() { return this.currentUser?.role === 'tecnico'; }
  isCliente() { return this.currentUser?.role === 'cliente'; }
  getUserId() { return this.currentUser?.id || null; }
  getUserName() { return this.currentUser?.name || ''; }
  getUserRole() { return this.currentUser?.role || ''; }

  // Create new user (admin only)
  async createUser({ name, email, password, role }) {
    const id = 'user-' + Date.now() + '-' + Math.random().toString(36).substr(2, 6);
    const hash = await this.hashPassword(password);
    const user = {
      id,
      name: name.trim(),
      email: email.toLowerCase().trim(),
      passwordHash: hash,
      role: role || 'tecnico',
      active: true,
      createdAt: new Date().toISOString()
    };
    await pixDB.putUser(user);
    return user;
  }

  // Update user (admin only)
  async updateUser(userId, updates) {
    const user = await pixDB.get('users', userId);
    if (!user) return null;
    if (updates.name) user.name = updates.name.trim();
    if (updates.email) user.email = updates.email.toLowerCase().trim();
    if (updates.password) user.passwordHash = await this.hashPassword(updates.password);
    if (updates.role) user.role = updates.role;
    if (updates.active !== undefined) user.active = updates.active;
    user.updatedAt = new Date().toISOString();
    await pixDB.putUser(user);
    return user;
  }

  // Toggle user active status
  async toggleUserActive(userId) {
    const user = await pixDB.get('users', userId);
    if (!user) return null;
    user.active = !user.active;
    user.updatedAt = new Date().toISOString();
    await pixDB.putUser(user);
    return user;
  }

  // Get all users
  async getAllUsers() {
    return pixDB.getAll('users');
  }

  // Get technicians only
  async getTechnicians() {
    return pixDB.getAllByIndex('users', 'role', 'tecnico');
  }

  // SHA-256 hash — with fallback for WebView contexts where crypto.subtle may not be available
  async hashPassword(plain) {
    // Try native crypto.subtle first (fast, secure)
    if (typeof crypto !== 'undefined' && crypto.subtle) {
      try {
        const data = new TextEncoder().encode(plain);
        const buf = await crypto.subtle.digest('SHA-256', data);
        return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
      } catch (e) {
        console.warn('[Auth] crypto.subtle failed, using JS fallback:', e.message);
      }
    }
    // Fallback: pure JS SHA-256 (for Android WebView compatibility)
    return this._sha256Fallback(plain);
  }

  _sha256Fallback(str) {
    const utf8 = new TextEncoder().encode(str);
    const K = [
      0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
      0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
      0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
      0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
      0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
      0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
      0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
      0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2
    ];
    let H0=0x6a09e667,H1=0xbb67ae85,H2=0x3c6ef372,H3=0xa54ff53a,H4=0x510e527f,H5=0x9b05688c,H6=0x1f83d9ab,H7=0x5be0cd19;
    const len = utf8.length;
    const bitLen = len * 8;
    const padded = new Uint8Array(((len + 9 + 63) & ~63));
    padded.set(utf8);
    padded[len] = 0x80;
    const dv = new DataView(padded.buffer);
    dv.setUint32(padded.length - 4, bitLen, false);
    const rotr = (x,n) => ((x >>> n) | (x << (32-n))) >>> 0;
    for (let off = 0; off < padded.length; off += 64) {
      const W = new Uint32Array(64);
      for (let i=0;i<16;i++) W[i] = dv.getUint32(off+i*4,false);
      for (let i=16;i<64;i++) {
        const s0 = rotr(W[i-15],7)^rotr(W[i-15],18)^(W[i-15]>>>3);
        const s1 = rotr(W[i-2],17)^rotr(W[i-2],19)^(W[i-2]>>>10);
        W[i] = (W[i-16]+s0+W[i-7]+s1)>>>0;
      }
      let a=H0,b=H1,c=H2,d=H3,e=H4,f=H5,g=H6,h=H7;
      for (let i=0;i<64;i++) {
        const S1=rotr(e,6)^rotr(e,11)^rotr(e,25);
        const ch=(e&f)^((~e)&g);
        const t1=(h+S1+ch+K[i]+W[i])>>>0;
        const S0=rotr(a,2)^rotr(a,13)^rotr(a,22);
        const maj=(a&b)^(a&c)^(b&c);
        const t2=(S0+maj)>>>0;
        h=g;g=f;f=e;e=(d+t1)>>>0;d=c;c=b;b=a;a=(t1+t2)>>>0;
      }
      H0=(H0+a)>>>0;H1=(H1+b)>>>0;H2=(H2+c)>>>0;H3=(H3+d)>>>0;
      H4=(H4+e)>>>0;H5=(H5+f)>>>0;H6=(H6+g)>>>0;H7=(H7+h)>>>0;
    }
    return [H0,H1,H2,H3,H4,H5,H6,H7].map(v=>v.toString(16).padStart(8,'0')).join('');
  }

  // Role display labels
  getRoleLabel(role) {
    const labels = { admin: 'Administrador', tecnico: 'Tecnico', cliente: 'Cliente' };
    return labels[role] || role;
  }

  getRoleBadgeClass(role) {
    const classes = { admin: 'badge-admin', tecnico: 'badge-tecnico', cliente: 'badge-cliente' };
    return classes[role] || '';
  }

  // ===== REMOTE USER SYNC VIA API (primary) + GOOGLE DRIVE (fallback) =====

  /** API endpoint for user sync — configurable via settings */
  _userApiUrl = null;

  async getApiUrl() {
    if (this._userApiUrl) return this._userApiUrl;
    const saved = await pixDB.getSetting('userApiUrl');
    return saved || 'http://pixadvisor.local:9105';
  }

  /**
   * Sync users from PIX User API → merge into local IndexedDB.
   * Falls back to Google Drive if API unreachable.
   */
  async syncUsersFromAPI() {
    const apiUrl = await this.getApiUrl();
    try {
      const resp = await fetch(`${apiUrl}/api/users/sync`, {
        signal: AbortSignal.timeout(5000)
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const remoteData = await resp.json();

      if (!remoteData?.users?.length) return { synced: 0, status: 'no_data', source: 'api' };

      const result = await this._mergeRemoteUsers(remoteData.users);
      console.log(`[Auth] API sync: ${result.created} created, ${result.updated} updated`);
      return { ...result, status: 'ok', source: 'api' };
    } catch (e) {
      console.warn('[Auth] API sync failed, trying Drive fallback:', e.message);
      // Fallback to Drive sync
      return this.syncUsersFromDrive();
    }
  }

  /**
   * Merge remote users into local IndexedDB.
   * Shared logic for both API and Drive sync.
   */
  async _mergeRemoteUsers(remoteUsers) {
    const localUsers = await this.getAllUsers();
    const localMap = {};
    localUsers.forEach(u => { localMap[u.id] = u; });

    let created = 0, updated = 0, deactivated = 0;

    for (const remote of remoteUsers) {
      const local = localMap[remote.id];
      if (!local) {
        await pixDB.putUser({
          ...remote,
          active: remote.active !== false,
          _syncedFrom: 'api'
        });
        created++;
      } else {
        const remoteTime = new Date(remote.updatedAt || 0).getTime();
        const localTime = new Date(local.updatedAt || 0).getTime();
        if (remoteTime > localTime) {
          Object.assign(local, remote, { _syncedFrom: 'api' });
          local.active = remote.active !== false;
          await pixDB.putUser(local);
          updated++;
          if (!remote.active) deactivated++;
        }
      }
    }

    return { synced: created + updated, created, updated, deactivated };
  }

  /**
   * Sync users from Google Drive → merge into local IndexedDB.
   * Called on app startup if Drive is authenticated.
   * - New remote users → create locally
   * - Updated remote users (newer updatedAt) → update locally
   * - Deactivated remotely → deactivate locally
   * - Local-only users → keep (never delete)
   */
  async syncUsersFromDrive() {
    if (typeof driveSync === 'undefined' || !driveSync.isAuthenticated()) {
      console.log('[Auth] Drive not available, skipping user sync');
      return { synced: 0, status: 'offline' };
    }

    try {
      const remoteData = await driveSync.downloadUsersJSON();
      if (!remoteData || !remoteData.users || remoteData.users.length === 0) {
        return { synced: 0, status: 'no_data' };
      }

      const localUsers = await this.getAllUsers();
      const localMap = {};
      localUsers.forEach(u => { localMap[u.id] = u; });

      let created = 0, updated = 0, deactivated = 0;

      for (const remote of remoteData.users) {
        const local = localMap[remote.id];

        if (!local) {
          // New user from remote → create locally
          await pixDB.putUser({
            id: remote.id,
            name: remote.name,
            email: remote.email,
            passwordHash: remote.passwordHash,
            role: remote.role || 'tecnico',
            active: remote.active !== false,
            createdAt: remote.createdAt || new Date().toISOString(),
            updatedAt: remote.updatedAt || new Date().toISOString(),
            _syncedFrom: 'drive'
          });
          created++;
        } else {
          // Existing user — check if remote is newer
          const remoteTime = new Date(remote.updatedAt || 0).getTime();
          const localTime = new Date(local.updatedAt || 0).getTime();

          if (remoteTime > localTime) {
            // Remote is newer → update local
            local.name = remote.name;
            local.email = remote.email;
            local.passwordHash = remote.passwordHash;
            local.role = remote.role;
            local.active = remote.active !== false;
            local.updatedAt = remote.updatedAt;
            local._syncedFrom = 'drive';
            await pixDB.putUser(local);
            updated++;

            if (!remote.active && local.active) deactivated++;
          }
        }
      }

      console.log(`[Auth] User sync: ${created} created, ${updated} updated, ${deactivated} deactivated`);
      return { synced: created + updated, created, updated, deactivated, status: 'ok' };
    } catch (e) {
      console.warn('[Auth] User sync failed:', e.message);
      return { synced: 0, status: 'error', error: e.message };
    }
  }

  /**
   * Upload all local users to Drive (called from admin panel).
   */
  async pushUsersToDrive() {
    if (typeof driveSync === 'undefined' || !driveSync.isAuthenticated()) {
      throw new Error('Drive no autenticado');
    }
    const users = await this.getAllUsers();
    return driveSync.uploadUsersJSON(users);
  }
}

// Singleton
const pixAuth = new PixAuth();
