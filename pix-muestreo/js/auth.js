// Authentication module for PIX Muestreo - Multi-user with roles
class PixAuth {
  constructor() {
    this.currentUser = null;
  }

  // Restore session from localStorage
  async init() {
    const userId = localStorage.getItem('pix_user_id');
    if (!userId) return false;
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

  // Login with email and password
  async login(email, password) {
    if (!email || !password) return null;
    const emailLower = email.toLowerCase().trim();
    const hash = await this.hashPassword(password);

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

  // SHA-256 hash
  async hashPassword(plain) {
    const data = new TextEncoder().encode(plain);
    const buf = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
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
}

// Singleton
const pixAuth = new PixAuth();
