/**
 * Sallybraids Admin Application
 * Admin dashboard JavaScript with CRUD operations and mock mode
 */

(function() {
  'use strict';

  // ============================================
  // Configuration & State
  // ============================================
  
  const CONFIG = {
    API_BASE_URL: window.__ENV__?.API_BASE_URL || '',
    STRIPE_KEY: window.__ENV__?.STRIPE_PUBLISHABLE_KEY || '',
    STORAGE_KEYS: {
      AUTH_TOKEN: 'sb_admin_token',
      SERVICES: 'sb_services',
      BOOKINGS: 'sb_bookings',
      BLOCKS: 'sb_blocks',
      SETTINGS: 'sb_settings',
      MEDIA: 'sb_media'
    }
  };

  const STATE = {
    isAuthenticated: false,
    currentPanel: 'dashboard',
    services: [],
    bookings: [],
    blocks: [],
    settings: null,
    media: {},
    editingService: null
  };

  // ============================================
  // Utility Functions (shared with app.js logic)
  // ============================================

  function showToast(message, type = 'info', title = '') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const icons = {
      success: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="#16a34a" stroke-width="2"/><path d="M8 12l3 3 5-5" stroke="#16a34a" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
      error: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="#dc2626" stroke-width="2"/><path d="M12 8v4m0 4h.01" stroke="#dc2626" stroke-width="2" stroke-linecap="round"/></svg>',
      warning: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M12 2L2 20h20L12 2z" stroke="#ea580c" stroke-width="2" stroke-linejoin="round"/><path d="M12 10v4m0 4h.01" stroke="#ea580c" stroke-width="2" stroke-linecap="round"/></svg>',
      info: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="#3b82f6" stroke-width="2"/><path d="M12 16v-4m0-4h.01" stroke="#3b82f6" stroke-width="2" stroke-linecap="round"/></svg>'
    };

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `
      <div class="toast-icon">${icons[type] || icons.info}</div>
      <div class="toast-content">
        ${title ? `<div class="toast-title">${escapeHtml(title)}</div>` : ''}
        <div class="toast-message">${escapeHtml(message)}</div>
      </div>
      <button type="button" class="toast-close" aria-label="Close notification">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <path d="M12 4L4 12M4 4l8 8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        </svg>
      </button>
    `;

    const closeBtn = toast.querySelector('.toast-close');
    closeBtn.addEventListener('click', () => toast.remove());

    container.appendChild(toast);
    setTimeout(() => toast.remove(), 5000);
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  function formatCurrency(amount) {
    return new Intl.NumberFormat('en-CA', {
      style: 'currency',
      currency: 'CAD'
    }).format(amount);
  }

  function formatDate(dateString) {
    return new Date(dateString).toLocaleDateString('en-CA', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  }

  function formatDateTime(dateString, timeString) {
    const date = new Date(`${dateString}T${timeString}`);
    return date.toLocaleString('en-CA', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    });
  }

  // ============================================
  // API & Storage Functions
  // ============================================

  async function apiRequest(endpoint, options = {}) {
    if (!CONFIG.API_BASE_URL) {
      return mockApiRequest(endpoint, options);
    }

    try {
      const token = sessionStorage.getItem(CONFIG.STORAGE_KEYS.AUTH_TOKEN);
      const response = await fetch(`${CONFIG.API_BASE_URL}${endpoint}`, {
        ...options,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': token ? `Bearer ${token}` : '',
          ...options.headers
        }
      });

      if (!response.ok) {
        throw new Error(`API error: ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      console.error('API request failed, falling back to mock mode:', error);
      return mockApiRequest(endpoint, options);
    }
  }

  function mockApiRequest(endpoint, options = {}) {
    const method = options.method || 'GET';

    // Auth endpoints
    if (endpoint === '/api/auth/login' && method === 'POST') {
      const mockToken = 'mock_jwt_' + Date.now();
      sessionStorage.setItem(CONFIG.STORAGE_KEYS.AUTH_TOKEN, mockToken);
      return Promise.resolve({ accessToken: mockToken });
    }

    // Services endpoints
    if (endpoint === '/api/services' && method === 'GET') {
      return Promise.resolve(loadFromStorage(CONFIG.STORAGE_KEYS.SERVICES) || []);
    }

    if (endpoint === '/api/services' && method === 'POST') {
      const service = JSON.parse(options.body);
      service.id = service.id || `service-${Date.now()}`;
      const services = loadFromStorage(CONFIG.STORAGE_KEYS.SERVICES) || [];
      services.push(service);
      saveToStorage(CONFIG.STORAGE_KEYS.SERVICES, services);
      return Promise.resolve(service);
    }

    if (endpoint.startsWith('/api/services/') && method === 'PUT') {
      const id = endpoint.split('/').pop();
      const updatedService = JSON.parse(options.body);
      const services = loadFromStorage(CONFIG.STORAGE_KEYS.SERVICES) || [];
      const index = services.findIndex(s => s.id === id);
      if (index !== -1) {
        services[index] = { ...services[index], ...updatedService };
        saveToStorage(CONFIG.STORAGE_KEYS.SERVICES, services);
        return Promise.resolve(services[index]);
      }
      return Promise.reject(new Error('Service not found'));
    }

    if (endpoint.startsWith('/api/services/') && method === 'DELETE') {
      const id = endpoint.split('/').pop();
      const services = loadFromStorage(CONFIG.STORAGE_KEYS.SERVICES) || [];
      const filtered = services.filter(s => s.id !== id);
      saveToStorage(CONFIG.STORAGE_KEYS.SERVICES, filtered);
      return Promise.resolve({ success: true });
    }

    // Bookings endpoints
    if (endpoint === '/api/bookings' && method === 'GET') {
      return Promise.resolve(loadFromStorage(CONFIG.STORAGE_KEYS.BOOKINGS) || []);
    }

    if (endpoint.startsWith('/api/bookings/') && method === 'PATCH') {
      const id = endpoint.split('/').pop();
      const updates = JSON.parse(options.body);
      const bookings = loadFromStorage(CONFIG.STORAGE_KEYS.BOOKINGS) || [];
      const index = bookings.findIndex(b => b.id === id);
      if (index !== -1) {
        bookings[index] = { ...bookings[index], ...updates };
        saveToStorage(CONFIG.STORAGE_KEYS.BOOKINGS, bookings);
        return Promise.resolve(bookings[index]);
      }
      return Promise.reject(new Error('Booking not found'));
    }

    // Calendar blocks
    if (endpoint === '/api/availability/blocks' && method === 'POST') {
      const block = JSON.parse(options.body);
      block.id = `block-${Date.now()}`;
      const blocks = loadFromStorage(CONFIG.STORAGE_KEYS.BLOCKS) || [];
      blocks.push(block);
      saveToStorage(CONFIG.STORAGE_KEYS.BLOCKS, blocks);
      return Promise.resolve(block);
    }

    if (endpoint === '/api/availability/blocks' && method === 'GET') {
      return Promise.resolve(loadFromStorage(CONFIG.STORAGE_KEYS.BLOCKS) || []);
    }

    // Settings
    if (endpoint === '/api/settings' && method === 'GET') {
      return Promise.resolve(loadFromStorage(CONFIG.STORAGE_KEYS.SETTINGS) || getDefaultSettings());
    }

    if (endpoint === '/api/settings' && method === 'PUT') {
      const settings = JSON.parse(options.body);
      saveToStorage(CONFIG.STORAGE_KEYS.SETTINGS, settings);
      return Promise.resolve(settings);
    }

    // Media
    if (endpoint === '/api/media/logo' && method === 'POST') {
      // In mock mode, we'll store base64 data URLs
      return Promise.resolve({ url: 'mock_upload_' + Date.now() });
    }

    return Promise.reject(new Error('Endpoint not implemented'));
  }

  function loadFromStorage(key) {
    try {
      const data = localStorage.getItem(key);
      return data ? JSON.parse(data) : null;
    } catch (error) {
      console.error('Failed to load from storage:', error);
      return null;
    }
  }

  function saveToStorage(key, data) {
    try {
      localStorage.setItem(key, JSON.stringify(data));
    } catch (error) {
      console.error('Failed to save to storage:', error);
    }
  }

  function getDefaultSettings() {
    return {
      businessName: 'Sallybraids',
      phone: '+1 (514) 969-7169',
      email: 'obaapasally@yahoo.com',
      location: 'Toronto, ON',
      instagram: '@sallybraids_',
      tiktok: '@sallybraids_',
      depositPercent: 35,
      depositMin: 15,
      hoursOpen: '07:00',
      hoursClose: '19:00'
    };
  }

  // ============================================
  // Authentication
  // ============================================

  async function handleLogin(e) {
    e.preventDefault();
    const form = e.target;
    const formData = new FormData(form);

    try {
      const submitBtn = form.querySelector('button[type="submit"]');
      submitBtn.disabled = true;
      submitBtn.textContent = 'Signing in...';

      // In production, this would call /api/auth/login
      // For mock mode, we accept any credentials
      await apiRequest('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({
          email: formData.get('email'),
          password: formData.get('password')
        })
      });

      STATE.isAuthenticated = true;
      showAuthenticatedView();
      showToast('Successfully signed in', 'success', 'Welcome!');

    } catch (error) {
      console.error('Login failed:', error);
      showToast('Login failed. Please try again.', 'error');
      const submitBtn = form.querySelector('button[type="submit"]');
      submitBtn.disabled = false;
      submitBtn.textContent = 'Sign In';
    }
  }

  function handleLogout() {
    sessionStorage.removeItem(CONFIG.STORAGE_KEYS.AUTH_TOKEN);
    STATE.isAuthenticated = false;
    showAuthScreen();
    showToast('Successfully signed out', 'info');
  }

  function showAuthScreen() {
    document.getElementById('auth-screen').style.display = 'flex';
    document.getElementById('admin-dashboard').style.display = 'none';
  }

  function showAuthenticatedView() {
    document.getElementById('auth-screen').style.display = 'none';
    document.getElementById('admin-dashboard').style.display = 'flex';
    checkApiConnection();
    loadAllData();
  }

  function checkApiConnection() {
    if (!CONFIG.API_BASE_URL) {
      const banner = document.getElementById('mock-mode-banner');
      if (banner) {
        banner.style.display = 'block';
        const closeBtn = banner.querySelector('.banner-close');
        if (closeBtn) {
          closeBtn.addEventListener('click', () => {
            banner.style.display = 'none';
          });
        }
      }
    }
  }

  // ============================================
  // Data Loading
  // ============================================

  async function loadAllData() {
    try {
      // Load services
      STATE.services = await apiRequest('/api/services');
      
      // Load bookings
      STATE.bookings = await apiRequest('/api/bookings');
      
      // Load blocks
      STATE.blocks = await apiRequest('/api/availability/blocks');
      
      // Load settings
      STATE.settings = await apiRequest('/api/settings');
      
      // If no services in storage, seed from catalog
      if (STATE.services.length === 0) {
        await seedServicesFromCatalog();
      }

      // Render current panel
      renderCurrentPanel();

    } catch (error) {
      console.error('Failed to load data:', error);
      showToast('Failed to load data. Using defaults.', 'warning');
    }
  }

  async function seedServicesFromCatalog() {
    // Try to get catalog from main page
    const catalog = loadFromStorage('sb_catalog');
    if (catalog && catalog.length > 0) {
      STATE.services = catalog;
      saveToStorage(CONFIG.STORAGE_KEYS.SERVICES, catalog);
    }
  }

  // ============================================
  // Navigation
  // ============================================

  function initNavigation() {
    const navLinks = document.querySelectorAll('.admin-nav-link');
    
    navLinks.forEach(link => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        const panel = link.dataset.panel;
        if (panel) {
          switchPanel(panel);
          
          // Update active state
          navLinks.forEach(l => l.classList.remove('active'));
          link.classList.add('active');
        }
      });
    });
  }

  function switchPanel(panelName) {
    // Hide all panels
    document.querySelectorAll('.admin-panel').forEach(panel => {
      panel.classList.remove('active');
    });

    // Show selected panel
    const panel = document.getElementById(`panel-${panelName}`);
    if (panel) {
      panel.classList.add('active');
      STATE.currentPanel = panelName;
      renderCurrentPanel();
    }
  }

  function renderCurrentPanel() {
    switch (STATE.currentPanel) {
      case 'dashboard':
        renderDashboard();
        break;
      case 'bookings':
        renderBookings();
        break;
      case 'calendar':
        renderCalendar();
        break;
      case 'services':
        renderServices();
        break;
      case 'media':
        renderMedia();
        break;
      case 'settings':
        renderSettings();
        break;
    }
  }

  // ============================================
  // Dashboard Panel
  // ============================================

  function renderDashboard() {
    renderStats();
    renderRecentBookings();
  }

  function renderStats() {
    const container = document.getElementById('stats-container');
    if (!container) return;

    const today = new Date();
    const thisMonth = today.getMonth();
    const thisYear = today.getFullYear();

    // Calculate stats
    const totalBookings = STATE.bookings.length;
    const monthBookings = STATE.bookings.filter(b => {
      const bookingDate = new Date(b.date);
      return bookingDate.getMonth() === thisMonth && bookingDate.getFullYear() === thisYear;
    }).length;

    const pendingDeposits = STATE.bookings.filter(b => 
      b.status === 'deposit_pending'
    ).length;

    const totalRevenue = STATE.bookings
      .filter(b => b.status === 'completed' || b.status === 'deposit_paid')
      .reduce((sum, b) => sum + (b.amountDue || 0), 0);

    const stats = [
      { label: 'Total Bookings', value: totalBookings },
      { label: 'This Month', value: monthBookings },
      { label: 'Pending Deposits', value: pendingDeposits },
      { label: 'Revenue (Paid)', value: formatCurrency(totalRevenue) }
    ];

    container.innerHTML = stats.map(stat => `
      <div class="stat-card">
        <div class="stat-label">${stat.label}</div>
        <div class="stat-value">${stat.value}</div>
      </div>
    `).join('');
  }

  function renderRecentBookings() {
    const container = document.getElementById('recent-bookings-container');
    if (!container) return;

    const recent = STATE.bookings
      .sort((a, b) => new Date(b.createdAt || b.date) - new Date(a.createdAt || a.date))
      .slice(0, 5);

    if (recent.length === 0) {
      container.innerHTML = '<p style="color: #737373; padding: var(--space-6); text-align: center;">No bookings yet.</p>';
      return;
    }

    container.innerHTML = `
      <div class="admin-table-wrapper">
        <table class="admin-table">
          <thead>
            <tr>
              <th>Date & Time</th>
              <th>Customer</th>
              <th>Service</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            ${recent.map(booking => `
              <tr onclick="openBookingDrawer('${booking.id}')" style="cursor: pointer;">
                <td>${formatDateTime(booking.date, booking.time)}</td>
                <td>${escapeHtml(booking.customer.name)}</td>
                <td>${escapeHtml(booking.serviceTitle)}</td>
                <td>${renderStatusBadge(booking.status)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  function renderStatusBadge(status) {
    const statusMap = {
      'deposit_pending': 'Pending',
      'deposit_paid': 'Confirmed',
      'completed': 'Completed',
      'cancelled': 'Cancelled',
      'no_show': 'No Show'
    };
    
    const statusClass = status.replace('_', '-');
    return `<span class="status-badge ${statusClass}">${statusMap[status] || status}</span>`;
  }

  // ============================================
  // Bookings Panel
  // ============================================

  function renderBookings() {
    populateServiceFilter();
    applyBookingFilters();
  }

  function populateServiceFilter() {
    const select = document.getElementById('filter-service');
    if (!select || select.dataset.populated) return;

    const options = STATE.services.map(s => 
      `<option value="${s.id}">${escapeHtml(s.title)}</option>`
    ).join('');

    select.innerHTML = '<option value="">All Services</option>' + options;
    select.dataset.populated = 'true';
  }

  function applyBookingFilters() {
    const dateFrom = document.getElementById('filter-date-from')?.value || '';
    const dateTo = document.getElementById('filter-date-to')?.value || '';
    const serviceId = document.getElementById('filter-service')?.value || '';
    const status = document.getElementById('filter-status')?.value || '';

    let filtered = [...STATE.bookings];

    if (dateFrom) {
      filtered = filtered.filter(b => b.date >= dateFrom);
    }
    if (dateTo) {
      filtered = filtered.filter(b => b.date <= dateTo);
    }
    if (serviceId) {
      filtered = filtered.filter(b => b.serviceId === serviceId);
    }
    if (status) {
      filtered = filtered.filter(b => b.status === status);
    }

    renderBookingsTable(filtered);
  }

  function renderBookingsTable(bookings) {
    const tbody = document.getElementById('bookings-tbody');
    if (!tbody) return;

    if (bookings.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; color: #737373; padding: var(--space-8);">No bookings found.</td></tr>';
      return;
    }

    tbody.innerHTML = bookings.map(booking => `
      <tr onclick="openBookingDrawer('${booking.id}')">
        <td>${formatDateTime(booking.date, booking.time)}</td>
        <td>
          <div><strong>${escapeHtml(booking.customer.name)}</strong></div>
          <div style="font-size: var(--text-xs); color: #737373;">${escapeHtml(booking.customer.phone)}</div>
        </td>
        <td>${escapeHtml(booking.serviceTitle)}</td>
        <td>${formatCurrency(booking.depositAmount || 0)}</td>
        <td>${renderStatusBadge(booking.status)}</td>
        <td>
          <div class="btn-group">
            <button type="button" class="btn btn-secondary btn-sm" onclick="event.stopPropagation(); openBookingDrawer('${booking.id}')">View</button>
          </div>
        </td>
      </tr>
    `).join('');
  }

  function openBookingDrawer(bookingId) {
    const booking = STATE.bookings.find(b => b.id === bookingId);
    if (!booking) return;

    const drawer = document.getElementById('booking-drawer');
    const overlay = document.getElementById('booking-drawer-overlay');
    const content = document.getElementById('booking-drawer-content');

    content.innerHTML = `
      <div style="margin-bottom: var(--space-6);">
        <h4 style="margin-bottom: var(--space-2);">Customer Information</h4>
        <div style="background: var(--stone); padding: var(--space-4); border-radius: var(--radius);">
          <p><strong>Name:</strong> ${escapeHtml(booking.customer.name)}</p>
          <p><strong>Phone:</strong> <a href="tel:${booking.customer.phone}">${escapeHtml(booking.customer.phone)}</a></p>
          <p><strong>Email:</strong> <a href="mailto:${booking.customer.email}">${escapeHtml(booking.customer.email)}</a></p>
        </div>
      </div>

      <div style="margin-bottom: var(--space-6);">
        <h4 style="margin-bottom: var(--space-2);">Appointment Details</h4>
        <div style="background: var(--stone); padding: var(--space-4); border-radius: var(--radius);">
          <p><strong>Service:</strong> ${escapeHtml(booking.serviceTitle)}</p>
          <p><strong>Date & Time:</strong> ${formatDateTime(booking.date, booking.time)}</p>
          <p><strong>Status:</strong> ${renderStatusBadge(booking.status)}</p>
        </div>
      </div>

      <div style="margin-bottom: var(--space-6);">
        <h4 style="margin-bottom: var(--space-2);">Payment Information</h4>
        <div style="background: var(--stone); padding: var(--space-4); border-radius: var(--radius);">
          <p><strong>Total:</strong> ${formatCurrency(booking.amountDue || 0)}</p>
          <p><strong>Deposit:</strong> ${formatCurrency(booking.depositAmount || 0)}</p>
          <p><strong>Remaining:</strong> ${formatCurrency((booking.amountDue || 0) - (booking.depositAmount || 0))}</p>
        </div>
      </div>

      ${booking.notes ? `
        <div style="margin-bottom: var(--space-6);">
          <h4 style="margin-bottom: var(--space-2);">Customer Notes</h4>
          <div style="background: var(--stone); padding: var(--space-4); border-radius: var(--radius);">
            <p style="white-space: pre-wrap;">${escapeHtml(booking.notes)}</p>
          </div>
        </div>
      ` : ''}

      <div>
        <h4 style="margin-bottom: var(--space-2);">Actions</h4>
        <div class="btn-group">
          ${booking.status === 'deposit_pending' ? `
            <button type="button" class="btn btn-primary btn-sm" onclick="updateBookingStatus('${booking.id}', 'deposit_paid')">Mark Deposit Received</button>
          ` : ''}
          ${booking.status === 'deposit_paid' ? `
            <button type="button" class="btn btn-primary btn-sm" onclick="updateBookingStatus('${booking.id}', 'completed')">Mark Completed</button>
          ` : ''}
          ${booking.status !== 'cancelled' && booking.status !== 'no_show' ? `
            <button type="button" class="btn btn-secondary btn-sm" onclick="updateBookingStatus('${booking.id}', 'cancelled')">Cancel</button>
            <button type="button" class="btn btn-danger btn-sm" onclick="updateBookingStatus('${booking.id}', 'no_show')">Mark No-Show</button>
          ` : ''}
        </div>
      </div>
    `;

    drawer.classList.add('open');
    overlay.classList.add('open');
  }

  function closeBookingDrawer() {
    const drawer = document.getElementById('booking-drawer');
    const overlay = document.getElementById('booking-drawer-overlay');
    drawer.classList.remove('open');
    overlay.classList.remove('open');
  }

  async function updateBookingStatus(bookingId, newStatus) {
    try {
      await apiRequest(`/api/bookings/${bookingId}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: newStatus })
      });

      // Update local state
      const booking = STATE.bookings.find(b => b.id === bookingId);
      if (booking) {
        booking.status = newStatus;
      }

      showToast('Booking status updated', 'success');
      closeBookingDrawer();
      renderCurrentPanel();

    } catch (error) {
      console.error('Failed to update booking:', error);
      showToast('Failed to update booking status', 'error');
    }
  }

  function exportBookingsCSV() {
    const headers = ['Date', 'Time', 'Customer Name', 'Phone', 'Email', 'Service', 'Total', 'Deposit', 'Status'];
    const rows = STATE.bookings.map(b => [
      b.date,
      b.time,
      b.customer.name,
      b.customer.phone,
      b.customer.email,
      b.serviceTitle,
      b.amountDue || 0,
      b.depositAmount || 0,
      b.status
    ]);

    const csv = [
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
    ].join('\n');

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `bookings-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);

    showToast('Bookings exported successfully', 'success');
  }

  // ============================================
  // Calendar Panel
  // ============================================

  function renderCalendar() {
    const container = document.getElementById('calendar-blocks-container');
    if (!container) return;

    const blocks = STATE.blocks || [];

    if (blocks.length === 0) {
      container.innerHTML = '<p style="color: #737373; text-align: center; padding: var(--space-6);">No blackout dates or blocks. Click "Add Block" to create one.</p>';
      return;
    }

    container.innerHTML = `
      <div class="admin-table-wrapper">
        <table class="admin-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Type</th>
              <th>Notes</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            ${blocks.map(block => `
              <tr>
                <td>${formatDate(block.date)}</td>
                <td><span class="status-badge">${block.type || 'Blackout'}</span></td>
                <td>${escapeHtml(block.notes || 'N/A')}</td>
                <td>
                  <button type="button" class="btn btn-danger btn-sm" onclick="deleteBlock('${block.id}')">Remove</button>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  async function addBlock() {
    const date = prompt('Enter date to block (YYYY-MM-DD):');
    if (!date) return;

    const notes = prompt('Notes (optional):');

    try {
      await apiRequest('/api/availability/blocks', {
        method: 'POST',
        body: JSON.stringify({
          date,
          type: 'blackout',
          notes: notes || ''
        })
      });

      // Reload blocks
      STATE.blocks = await apiRequest('/api/availability/blocks');
      renderCalendar();
      showToast('Block added successfully', 'success');

    } catch (error) {
      console.error('Failed to add block:', error);
      showToast('Failed to add block', 'error');
    }
  }

  async function deleteBlock(blockId) {
    if (!confirm('Remove this block?')) return;

    try {
      // For mock mode, remove from storage
      const blocks = loadFromStorage(CONFIG.STORAGE_KEYS.BLOCKS) || [];
      const filtered = blocks.filter(b => b.id !== blockId);
      saveToStorage(CONFIG.STORAGE_KEYS.BLOCKS, filtered);

      STATE.blocks = filtered;
      renderCalendar();
      showToast('Block removed', 'success');

    } catch (error) {
      console.error('Failed to delete block:', error);
      showToast('Failed to remove block', 'error');
    }
  }

  // ============================================
  // Services Panel
  // ============================================

  function renderServices() {
    const tbody = document.getElementById('services-tbody');
    if (!tbody) return;

    if (STATE.services.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; color: #737373; padding: var(--space-8);">No services yet. Click "Add Service" to create one.</td></tr>';
      return;
    }

    tbody.innerHTML = STATE.services.map((service, index) => `
      <tr>
        <td>
          <button type="button" class="btn btn-secondary btn-sm" onclick="moveService(${index}, -1)" ${index === 0 ? 'disabled' : ''}>↑</button>
          <button type="button" class="btn btn-secondary btn-sm" onclick="moveService(${index}, 1)" ${index === STATE.services.length - 1 ? 'disabled' : ''}>↓</button>
        </td>
        <td><strong>${escapeHtml(service.title)}</strong></td>
        <td>${escapeHtml(service.category)}</td>
        <td>${escapeHtml(service.duration)}</td>
        <td>${formatCurrency(service.price)}</td>
        <td>
          <div class="btn-group">
            <button type="button" class="btn btn-secondary btn-sm" onclick="editService('${service.id}')">Edit</button>
            <button type="button" class="btn btn-danger btn-sm" onclick="deleteService('${service.id}')">Delete</button>
          </div>
        </td>
      </tr>
    `).join('');
  }

  function moveService(index, direction) {
    if (index + direction < 0 || index + direction >= STATE.services.length) return;

    const temp = STATE.services[index];
    STATE.services[index] = STATE.services[index + direction];
    STATE.services[index + direction] = temp;

    saveToStorage(CONFIG.STORAGE_KEYS.SERVICES, STATE.services);
    renderServices();
  }

  function openServiceDrawer(serviceId = null) {
    const drawer = document.getElementById('service-drawer');
    const overlay = document.getElementById('service-drawer-overlay');
    const title = document.getElementById('service-drawer-title');
    const form = document.getElementById('service-form');

    form.reset();

    if (serviceId) {
      const service = STATE.services.find(s => s.id === serviceId);
      if (!service) return;

      STATE.editingService = service;
      title.textContent = 'Edit Service';

      document.getElementById('service-form-id').value = service.id;
      document.getElementById('service-form-title').value = service.title;
      document.getElementById('service-form-category').value = service.category;
      document.getElementById('service-form-duration').value = service.duration;
      document.getElementById('service-form-price').value = service.price;
      document.getElementById('service-form-image').value = service.img || '';
      document.getElementById('service-form-notes').value = Array.isArray(service.notes) ? service.notes.join('\n') : '';
    } else {
      STATE.editingService = null;
      title.textContent = 'Add Service';
      document.getElementById('service-form-id').value = '';
    }

    drawer.classList.add('open');
    overlay.classList.add('open');
  }

  function closeServiceDrawer() {
    const drawer = document.getElementById('service-drawer');
    const overlay = document.getElementById('service-drawer-overlay');
    drawer.classList.remove('open');
    overlay.classList.remove('open');
    STATE.editingService = null;
  }

  async function saveService() {
    const form = document.getElementById('service-form');
    const formData = new FormData(form);

    const serviceData = {
      id: formData.get('id') || `service-${Date.now()}`,
      title: formData.get('title'),
      category: formData.get('category'),
      duration: formData.get('duration'),
      price: parseFloat(formData.get('price')),
      img: formData.get('img') || '',
      notes: formData.get('notes').split('\n').filter(n => n.trim())
    };

    // Validate
    if (!serviceData.title || !serviceData.category || !serviceData.duration || !serviceData.price) {
      showToast('Please fill in all required fields', 'error');
      return;
    }

    try {
      if (STATE.editingService) {
        // Update existing
        await apiRequest(`/api/services/${serviceData.id}`, {
          method: 'PUT',
          body: JSON.stringify(serviceData)
        });

        const index = STATE.services.findIndex(s => s.id === serviceData.id);
        if (index !== -1) {
          STATE.services[index] = serviceData;
        }

        showToast('Service updated successfully', 'success');
      } else {
        // Create new
        await apiRequest('/api/services', {
          method: 'POST',
          body: JSON.stringify(serviceData)
        });

        STATE.services.push(serviceData);
        showToast('Service added successfully', 'success');
      }

      saveToStorage(CONFIG.STORAGE_KEYS.SERVICES, STATE.services);
      closeServiceDrawer();
      renderServices();

    } catch (error) {
      console.error('Failed to save service:', error);
      showToast('Failed to save service', 'error');
    }
  }

  async function deleteService(serviceId) {
    if (!confirm('Delete this service? This cannot be undone.')) return;

    try {
      await apiRequest(`/api/services/${serviceId}`, {
        method: 'DELETE'
      });

      STATE.services = STATE.services.filter(s => s.id !== serviceId);
      saveToStorage(CONFIG.STORAGE_KEYS.SERVICES, STATE.services);
      renderServices();
      showToast('Service deleted', 'success');

    } catch (error) {
      console.error('Failed to delete service:', error);
      showToast('Failed to delete service', 'error');
    }
  }

  // Make functions available globally for onclick handlers
  window.editService = openServiceDrawer;
  window.deleteService = deleteService;
  window.moveService = moveService;

  // ============================================
  // Media Panel
  // ============================================

  function renderMedia() {
    renderLogoUpload();
    renderServiceImages();
  }

  function renderLogoUpload() {
    const container = document.getElementById('logo-upload-container');
    if (!container) return;

    const currentLogo = '/images/sallybraids-logo-768.jpg';

    container.innerHTML = `
      <div style="display: flex; gap: var(--space-6); align-items: center;">
        <img src="${currentLogo}" alt="Current logo" width="100" height="100" style="border-radius: 50%; object-fit: cover; border: 2px solid var(--border);">
        <div style="flex: 1;">
          <div class="upload-zone" id="logo-drop-zone">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" style="margin: 0 auto var(--space-3); opacity: 0.3;">
              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
            <p style="margin: 0 0 var(--space-2); font-weight: 600;">Upload New Logo</p>
            <p style="margin: 0; font-size: var(--text-sm); color: #737373;">Click or drag & drop</p>
            <input type="file" id="logo-upload-input" accept="image/*" style="display: none;">
          </div>
        </div>
      </div>
    `;

    const dropZone = container.querySelector('#logo-drop-zone');
    const input = container.querySelector('#logo-upload-input');

    dropZone.addEventListener('click', () => input.click());
    input.addEventListener('change', handleLogoUpload);

    // Drag & drop
    dropZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropZone.classList.add('dragover');
    });

    dropZone.addEventListener('dragleave', () => {
      dropZone.classList.remove('dragover');
    });

    dropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropZone.classList.remove('dragover');
      if (e.dataTransfer.files.length > 0) {
        handleLogoUpload({ target: { files: e.dataTransfer.files } });
      }
    });
  }

  async function handleLogoUpload(e) {
    const file = e.target.files[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      showToast('Please select an image file', 'error');
      return;
    }

    try {
      showToast('Uploading logo...', 'info');

      // In production, upload to /api/media/logo
      // For mock mode, we'll just show success
      const formData = new FormData();
      formData.append('logo', file);

      // Mock upload
      await new Promise(resolve => setTimeout(resolve, 1000));

      showToast('Logo uploaded successfully! In production, this would update the actual logo file.', 'success');

    } catch (error) {
      console.error('Failed to upload logo:', error);
      showToast('Failed to upload logo', 'error');
    }
  }

  function renderServiceImages() {
    const container = document.getElementById('service-images-grid');
    if (!container) return;

    // Get unique service images
    const images = STATE.services
      .filter(s => s.img)
      .map(s => s.img)
      .filter((img, index, self) => self.indexOf(img) === index);

    if (images.length === 0) {
      container.innerHTML = '<p style="color: #737373; text-align: center; padding: var(--space-6); grid-column: 1 / -1;">No service images yet.</p>';
      return;
    }

    container.innerHTML = images.map(img => `
      <div class="media-item">
        <img src="${img}" alt="Service image" loading="lazy">
        <button type="button" class="media-item-remove" onclick="removeServiceImage('${img}')" aria-label="Remove image">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M12 4L4 12M4 4l8 8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
          </svg>
        </button>
      </div>
    `).join('');
  }

  function uploadServiceImage() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;

      try {
        showToast('Uploading image...', 'info');
        
        // In production, upload to /api/media/service-image
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        showToast('Image uploaded! In production, this would return a URL to use in service configuration.', 'success');

      } catch (error) {
        console.error('Failed to upload image:', error);
        showToast('Failed to upload image', 'error');
      }
    };
    input.click();
  }

  function removeServiceImage(imagePath) {
    if (!confirm('Remove this image? Services using it will show a placeholder.')) return;

    // Update services to remove this image
    STATE.services.forEach(service => {
      if (service.img === imagePath) {
        service.img = '';
      }
    });

    saveToStorage(CONFIG.STORAGE_KEYS.SERVICES, STATE.services);
    renderServiceImages();
    showToast('Image removed from services', 'success');
  }

  // Make functions available globally
  window.removeServiceImage = removeServiceImage;

  // ============================================
  // Settings Panel
  // ============================================

  function renderSettings() {
    const form = document.getElementById('settings-form');
    if (!form || !STATE.settings) return;

    // Populate form
    document.getElementById('setting-business-name').value = STATE.settings.businessName || '';
    document.getElementById('setting-phone').value = STATE.settings.phone || '';
    document.getElementById('setting-email').value = STATE.settings.email || '';
    document.getElementById('setting-location').value = STATE.settings.location || '';
    document.getElementById('setting-instagram').value = STATE.settings.instagram || '';
    document.getElementById('setting-tiktok').value = STATE.settings.tiktok || '';
    document.getElementById('setting-deposit-percent').value = STATE.settings.depositPercent || 35;
    document.getElementById('setting-deposit-min').value = STATE.settings.depositMin || 15;
    document.getElementById('setting-hours-open').value = STATE.settings.hoursOpen || '07:00';
    document.getElementById('setting-hours-close').value = STATE.settings.hoursClose || '19:00';
  }

  async function saveSettings(e) {
    e.preventDefault();

    const form = e.target;
    const formData = new FormData(form);

    const settings = {
      businessName: formData.get('businessName'),
      phone: formData.get('phone'),
      email: formData.get('email'),
      location: formData.get('location'),
      instagram: formData.get('instagram'),
      tiktok: formData.get('tiktok'),
      depositPercent: parseInt(formData.get('depositPercent')),
      depositMin: parseInt(formData.get('depositMin')),
      hoursOpen: formData.get('hoursOpen'),
      hoursClose: formData.get('hoursClose')
    };

    try {
      await apiRequest('/api/settings', {
        method: 'PUT',
        body: JSON.stringify(settings)
      });

      STATE.settings = settings;
      showToast('Settings saved successfully', 'success');

    } catch (error) {
      console.error('Failed to save settings:', error);
      showToast('Failed to save settings', 'error');
    }
  }

  function resetSettings() {
    if (!confirm('Reset all settings to defaults?')) return;

    STATE.settings = getDefaultSettings();
    saveToStorage(CONFIG.STORAGE_KEYS.SETTINGS, STATE.settings);
    renderSettings();
    showToast('Settings reset to defaults', 'success');
  }

  // ============================================
  // Event Listeners
  // ============================================

  function initEventListeners() {
    // Auth form
    const authForm = document.getElementById('auth-form');
    if (authForm) {
      authForm.addEventListener('submit', handleLogin);
    }

    // Logout
    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) {
      logoutBtn.addEventListener('click', handleLogout);
    }

    // Booking filters
    ['filter-date-from', 'filter-date-to', 'filter-service', 'filter-status'].forEach(id => {
      const el = document.getElementById(id);
      if (el) {
        el.addEventListener('change', applyBookingFilters);
      }
    });

    // Export bookings
    const exportBtn = document.getElementById('export-bookings-btn');
    if (exportBtn) {
      exportBtn.addEventListener('click', exportBookingsCSV);
    }

    // Add block
    const addBlockBtn = document.getElementById('add-block-btn');
    if (addBlockBtn) {
      addBlockBtn.addEventListener('click', addBlock);
    }

    // Add service
    const addServiceBtn = document.getElementById('add-service-btn');
    if (addServiceBtn) {
      addServiceBtn.addEventListener('click', () => openServiceDrawer());
    }

    // Service drawer controls
    const cancelServiceBtn = document.getElementById('cancel-service-form');
    if (cancelServiceBtn) {
      cancelServiceBtn.addEventListener('click', closeServiceDrawer);
    }

    const saveServiceBtn = document.getElementById('save-service-form');
    if (saveServiceBtn) {
      saveServiceBtn.addEventListener('click', saveService);
    }

    const closeServiceDrawerBtn = document.getElementById('close-service-drawer');
    if (closeServiceDrawerBtn) {
      closeServiceDrawerBtn.addEventListener('click', closeServiceDrawer);
    }

    document.getElementById('service-drawer-overlay')?.addEventListener('click', closeServiceDrawer);

    // Booking drawer controls
    const closeBookingDrawerBtn = document.getElementById('close-booking-drawer-btn');
    if (closeBookingDrawerBtn) {
      closeBookingDrawerBtn.addEventListener('click', closeBookingDrawer);
    }

    const closeBookingDrawer2 = document.getElementById('close-booking-drawer');
    if (closeBookingDrawer2) {
      closeBookingDrawer2.addEventListener('click', closeBookingDrawer);
    }

    document.getElementById('booking-drawer-overlay')?.addEventListener('click', closeBookingDrawer);

    // Upload service image
    const uploadServiceImageBtn = document.getElementById('upload-service-image-btn');
    if (uploadServiceImageBtn) {
      uploadServiceImageBtn.addEventListener('click', uploadServiceImage);
    }

    // Settings form
    const settingsForm = document.getElementById('settings-form');
    if (settingsForm) {
      settingsForm.addEventListener('submit', saveSettings);
    }

    const settingsResetBtn = document.getElementById('settings-reset-btn');
    if (settingsResetBtn) {
      settingsResetBtn.addEventListener('click', resetSettings);
    }
  }

  // Make functions globally available for inline onclick handlers
  window.openBookingDrawer = openBookingDrawer;
  window.updateBookingStatus = updateBookingStatus;
  window.deleteBlock = deleteBlock;

  // ============================================
  // Initialization
  // ============================================

  function init() {
    // Check if already authenticated (in session)
    const token = sessionStorage.getItem(CONFIG.STORAGE_KEYS.AUTH_TOKEN);
    if (token) {
      STATE.isAuthenticated = true;
      showAuthenticatedView();
    } else {
      showAuthScreen();
    }

    initNavigation();
    initEventListeners();

    console.log('Admin app initialized');
  }

  // Run when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();