/**
 * Sallybraids Client Application
 * Main JavaScript for client-facing site
 */

(function() {
  'use strict';

  // ============================================
  // Configuration & State
  // ============================================
  
  const CONFIG = {
    API_BASE_URL: window.__ENV__?.API_BASE_URL || '',
    STRIPE_KEY: window.__ENV__?.STRIPE_PUBLISHABLE_KEY || '',
    DEPOSIT_PERCENT: 0.35,
    DEPOSIT_MIN: 15
  };

  const STATE = {
    catalog: [],
    selectedService: null,
    selectedDate: null,
    selectedTime: null,
    currentMonth: new Date(),
    availability: {},
    isApiConnected: false
  };

  // ============================================
  // Utility Functions
  // ============================================

  /**
   * Show toast notification
   */
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
    closeBtn.addEventListener('click', () => {
      toast.remove();
    });

    container.appendChild(toast);

    // Auto-remove after 5 seconds
    setTimeout(() => {
      if (toast.parentNode) {
        toast.remove();
      }
    }, 5000);
  }

  /**
   * Escape HTML to prevent XSS
   */
  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  /**
   * Format currency
   */
  function formatCurrency(amount) {
    return new Intl.NumberFormat('en-CA', {
      style: 'currency',
      currency: 'CAD'
    }).format(amount);
  }

  /**
   * Format date as YYYY-MM-DD
   */
  function formatDate(date) {
    return date.toISOString().split('T')[0];
  }

  /**
   * Parse time restriction from service notes
   */
  function parseTimeRestriction(notes) {
    if (!notes || !Array.isArray(notes)) return null;
    
    const restriction = notes.find(note => 
      typeof note === 'string' && note.toUpperCase().includes('DO NOT BOOK AFTER')
    );
    
    if (!restriction) return null;
    
    const match = restriction.match(/(\d+)(AM|PM)/i);
    if (!match) return null;
    
    let hours = parseInt(match[1]);
    const period = match[2].toUpperCase();
    
    if (period === 'PM' && hours !== 12) hours += 12;
    if (period === 'AM' && hours === 12) hours = 0;
    
    return hours;
  }

  /**
   * Check if time violates service restriction
   */
  function violatesTimeRestriction(service, timeString) {
    const maxHour = parseTimeRestriction(service.notes);
    if (maxHour === null) return false;
    
    const [hours] = timeString.split(':').map(Number);
    return hours > maxHour;
  }

  /**
   * Smooth scroll to element
   */
  function smoothScroll(target) {
    const element = document.querySelector(target);
    if (element) {
      const offset = 80; // Header height
      const elementPosition = element.getBoundingClientRect().top;
      const offsetPosition = elementPosition + window.pageYOffset - offset;
      
      window.scrollTo({
        top: offsetPosition,
        behavior: 'smooth'
      });
    }
  }

  // ============================================
  // API Functions
  // ============================================

  /**
   * Make API request with fallback to mock mode
   */
  async function apiRequest(endpoint, options = {}) {
    if (!CONFIG.API_BASE_URL) {
      return mockApiRequest(endpoint, options);
    }

    try {
      const response = await fetch(`${CONFIG.API_BASE_URL}${endpoint}`, {
        ...options,
        headers: {
          'Content-Type': 'application/json',
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

  /**
   * Mock API responses using localStorage
   */
  function mockApiRequest(endpoint, options = {}) {
    const method = options.method || 'GET';

    // GET /api/availability?date=YYYY-MM-DD
    if (endpoint.startsWith('/api/availability') && method === 'GET') {
      const url = new URL(endpoint, 'http://localhost');
      const date = url.searchParams.get('date');
      
      if (date) {
        return Promise.resolve(generateTimeSlots(date));
      }
      
      // Return blackout dates
      return Promise.resolve({
        blackoutDates: getBlackoutDates()
      });
    }

    // POST /api/bookings
    if (endpoint === '/api/bookings' && method === 'POST') {
      const booking = JSON.parse(options.body);
      booking.id = `booking-${Date.now()}`;
      booking.status = 'deposit_pending';
      booking.createdAt = new Date().toISOString();

      // Store in localStorage
      const bookings = JSON.parse(localStorage.getItem('sb_bookings') || '[]');
      bookings.push(booking);
      localStorage.setItem('sb_bookings', JSON.stringify(bookings));

      return Promise.resolve({
        bookingId: booking.id,
        status: 'deposit_pending',
        amountDue: booking.amountDue,
        depositAmount: booking.depositAmount,
        clientSecret: 'mock_client_secret_' + booking.id
      });
    }

    return Promise.reject(new Error('Endpoint not implemented in mock mode'));
  }

  /**
   * Generate time slots for a given date
   */
  function generateTimeSlots(dateString) {
    const slots = [];
    const startHour = 7;
    const endHour = 19;
    
    // Get existing bookings for this date
    const bookings = JSON.parse(localStorage.getItem('sb_bookings') || '[]');
    const dateBookings = bookings.filter(b => b.date === dateString);
    const bookedTimes = dateBookings.map(b => b.time);

    for (let hour = startHour; hour < endHour; hour++) {
      const time = `${hour.toString().padStart(2, '0')}:00`;
      const available = !bookedTimes.includes(time);
      
      slots.push({
        time,
        available,
        label: formatTimeLabel(time)
      });
    }

    return { date: dateString, slots };
  }

  /**
   * Format time for display
   */
  function formatTimeLabel(time) {
    const [hours, minutes] = time.split(':').map(Number);
    const period = hours >= 12 ? 'PM' : 'AM';
    const displayHours = hours > 12 ? hours - 12 : (hours === 0 ? 12 : hours);
    return `${displayHours}:${minutes.toString().padStart(2, '0')} ${period}`;
  }

  /**
   * Get blackout dates (mock: random dates in future)
   */
  function getBlackoutDates() {
    const stored = localStorage.getItem('sb_blackout_dates');
    if (stored) return JSON.parse(stored);
    
    // Generate some random blackout dates for demo
    const dates = [];
    const today = new Date();
    for (let i = 0; i < 3; i++) {
      const date = new Date(today);
      date.setDate(date.getDate() + Math.floor(Math.random() * 60) + 10);
      dates.push(formatDate(date));
    }
    
    localStorage.setItem('sb_blackout_dates', JSON.stringify(dates));
    return dates;
  }

  // ============================================
  // Service Catalog Rendering
  // ============================================

  /**
   * Load and render services
   */
  function loadServices() {
    const catalogScript = document.getElementById('catalog-data');
    if (!catalogScript) {
      console.error('Catalog data not found');
      return;
    }

    try {
      STATE.catalog = JSON.parse(catalogScript.textContent);
      renderServices();
    } catch (error) {
      console.error('Failed to parse catalog data:', error);
    }
  }

  /**
   * Render services grouped by category
   */
  function renderServices() {
    const container = document.getElementById('services-container');
    if (!container) return;

    // Group services by category
    const categories = {
      'Bohemian Barbie': [],
      'Knotless & Twists': [],
      'Fulani & Extras': [],
      "Men's Styles": []
    };

    STATE.catalog.forEach(service => {
      if (categories[service.category]) {
        categories[service.category].push(service);
      }
    });

    // Render each category
    let html = '';
    Object.keys(categories).forEach(categoryName => {
      const services = categories[categoryName];
      if (services.length === 0) return;

      html += `
        <div class="service-category">
          <h3 class="category-title">${escapeHtml(categoryName)}</h3>
          <div class="service-grid">
            ${services.map(service => renderServiceCard(service)).join('')}
          </div>
        </div>
      `;
    });

    container.innerHTML = html;

    // Add event listeners to book buttons
    container.querySelectorAll('[data-service-book]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const serviceId = e.currentTarget.dataset.serviceBook;
        openBookingModal(serviceId);
      });
    });

    // Add event listeners to "Show more" buttons
    container.querySelectorAll('[data-toggle-notes]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const serviceId = e.currentTarget.dataset.toggleNotes;
        toggleServiceNotes(serviceId);
      });
    });
  }

  /**
   * Render individual service card
   */
  function renderServiceCard(service) {
    const notesHtml = service.notes && service.notes.length > 0
      ? `<ul>${service.notes.map(note => `<li>${escapeHtml(note)}</li>`).join('')}</ul>`
      : '<p>Standard service guidelines apply.</p>';

    const shouldCollapse = service.notes && service.notes.length > 3;
    const notesClass = shouldCollapse ? 'service-notes service-notes-collapsed' : 'service-notes';

    return `
      <div class="service-card">
        <div class="service-card-header">
          <h4 class="service-card-title">${escapeHtml(service.title)}</h4>
          <div class="service-card-meta">
            <div class="service-duration">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.5"/>
                <path d="M8 4v4l3 2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
              </svg>
              <span>${escapeHtml(service.duration)}</span>
            </div>
            <div class="service-price">${formatCurrency(service.price)}</div>
          </div>
        </div>
        
        <div class="service-card-image">
          ${renderServiceImage(service)}
        </div>
        
        <div class="service-card-body">
          <div class="${notesClass}" id="notes-${service.id}">
            ${notesHtml}
          </div>
          ${shouldCollapse ? `
            <button type="button" class="service-notes-toggle" data-toggle-notes="${service.id}" aria-expanded="false">
              Show more
            </button>
          ` : ''}
          
          <div class="service-card-footer">
            <button type="button" class="btn btn-primary btn-block" data-service-book="${service.id}">
              Book This Service
            </button>
          </div>
        </div>
      </div>
    `;
  }

  /**
   * Render service image or placeholder
   */
  function renderServiceImage(service) {
    if (service.img) {
      return `<img src="${service.img}" alt="${escapeHtml(service.title)}" width="400" height="300" loading="lazy">`;
    }
    
    return `
      <div class="service-card-image-placeholder">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <rect x="3" y="3" width="18" height="18" rx="2" stroke="currentColor" stroke-width="2"/>
          <circle cx="8.5" cy="8.5" r="1.5" fill="currentColor"/>
          <path d="M21 15l-5-5L5 21" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        <p>Image coming soon</p>
      </div>
    `;
  }

  /**
   * Toggle service notes expansion
   */
  function toggleServiceNotes(serviceId) {
    const notesEl = document.getElementById(`notes-${serviceId}`);
    const toggleBtn = document.querySelector(`[data-toggle-notes="${serviceId}"]`);
    
    if (!notesEl || !toggleBtn) return;

    const isExpanded = toggleBtn.getAttribute('aria-expanded') === 'true';
    
    if (isExpanded) {
      notesEl.classList.add('service-notes-collapsed');
      toggleBtn.setAttribute('aria-expanded', 'false');
      toggleBtn.textContent = 'Show more';
    } else {
      notesEl.classList.remove('service-notes-collapsed');
      toggleBtn.setAttribute('aria-expanded', 'true');
      toggleBtn.textContent = 'Show less';
    }
  }

  // ============================================
  // Booking Modal
  // ============================================

  /**
   * Open booking modal
   */
  function openBookingModal(serviceId = null) {
    const modal = document.getElementById('booking-modal');
    if (!modal) return;

    // Pre-select service if provided
    if (serviceId) {
      const service = STATE.catalog.find(s => s.id === serviceId);
      if (service) {
        STATE.selectedService = service;
        const select = document.getElementById('booking-service');
        if (select) {
          select.value = serviceId;
          updateServiceDetails();
        }
      }
    }

    modal.style.display = 'flex';
    document.body.style.overflow = 'hidden';
    
    // Focus management
    const firstInput = modal.querySelector('select, input, button');
    if (firstInput) firstInput.focus();

    // Trap focus in modal
    modal.addEventListener('keydown', handleModalKeydown);
  }

  /**
   * Close booking modal
   */
  function closeBookingModal() {
    const modal = document.getElementById('booking-modal');
    if (!modal) return;

    modal.style.display = 'none';
    document.body.style.overflow = '';
    
    // Reset form
    const form = document.getElementById('booking-form');
    if (form) form.reset();
    
    // Clear state
    STATE.selectedService = null;
    STATE.selectedDate = null;
    STATE.selectedTime = null;
    
    // Hide service details and deposit
    document.getElementById('service-details').style.display = 'none';
    document.getElementById('deposit-summary').style.display = 'none';
  }

  /**
   * Handle modal keyboard interactions
   */
  function handleModalKeydown(e) {
    if (e.key === 'Escape') {
      closeBookingModal();
    }
  }

  /**
   * Update service details display
   */
  function updateServiceDetails() {
    const select = document.getElementById('booking-service');
    const detailsDiv = document.getElementById('service-details');
    
    if (!select || !detailsDiv) return;

    const serviceId = select.value;
    if (!serviceId) {
      detailsDiv.style.display = 'none';
      STATE.selectedService = null;
      return;
    }

    const service = STATE.catalog.find(s => s.id === serviceId);
    if (!service) return;

    STATE.selectedService = service;

    // Update display
    document.getElementById('service-duration').textContent = service.duration;
    document.getElementById('service-price').textContent = formatCurrency(service.price);
    
    const notesDisplay = document.getElementById('service-notes-display');
    if (service.notes && service.notes.length > 0) {
      notesDisplay.innerHTML = `<ul>${service.notes.map(n => `<li>${escapeHtml(n)}</li>`).join('')}</ul>`;
      notesDisplay.style.display = 'block';
    } else {
      notesDisplay.style.display = 'none';
    }

    detailsDiv.style.display = 'block';
    
    // Update deposit calculation
    updateDepositCalculation();
    
    // Refresh calendar (restrictions may have changed)
    if (STATE.selectedDate) {
      renderCalendar();
    }
  }

  /**
   * Calculate and display deposit
   */
  function updateDepositCalculation() {
    const depositDiv = document.getElementById('deposit-summary');
    if (!STATE.selectedService) {
      depositDiv.style.display = 'none';
      return;
    }

    const total = STATE.selectedService.price;
    const depositAmount = Math.max(
      total * CONFIG.DEPOSIT_PERCENT,
      CONFIG.DEPOSIT_MIN
    );
    const remaining = total - depositAmount;

    document.getElementById('deposit-total').textContent = formatCurrency(total);
    document.getElementById('deposit-amount').textContent = formatCurrency(depositAmount);
    document.getElementById('deposit-remaining').textContent = formatCurrency(remaining);

    depositDiv.style.display = 'block';
  }

  // ============================================
  // Calendar Widget
  // ============================================

  /**
   * Initialize calendar
   */
  function initCalendar() {
    const prevBtn = document.querySelector('[data-calendar-prev]');
    const nextBtn = document.querySelector('[data-calendar-next]');

    if (prevBtn) {
      prevBtn.addEventListener('click', () => {
        STATE.currentMonth.setMonth(STATE.currentMonth.getMonth() - 1);
        renderCalendar();
      });
    }

    if (nextBtn) {
      nextBtn.addEventListener('click', () => {
        STATE.currentMonth.setMonth(STATE.currentMonth.getMonth() + 1);
        renderCalendar();
      });
    }

    renderCalendar();
  }

  /**
   * Render calendar for current month
   */
  function renderCalendar() {
    const titleEl = document.getElementById('calendar-month-year');
    const datesEl = document.getElementById('calendar-dates');
    
    if (!titleEl || !datesEl) return;

    const year = STATE.currentMonth.getFullYear();
    const month = STATE.currentMonth.getMonth();
    
    // Update title
    titleEl.textContent = new Intl.DateTimeFormat('en-US', { 
      month: 'long', 
      year: 'numeric' 
    }).format(STATE.currentMonth);

    // Get first day of month and number of days
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    
    // Get previous month's last few days
    const prevMonthDays = new Date(year, month, 0).getDate();
    
    // Get blackout dates
    const blackoutDates = getBlackoutDates();
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    let html = '';

    // Previous month's days
    for (let i = firstDay - 1; i >= 0; i--) {
      html += `<button type="button" class="calendar-date other-month" disabled>${prevMonthDays - i}</button>`;
    }

    // Current month's days
    for (let day = 1; day <= daysInMonth; day++) {
      const date = new Date(year, month, day);
      const dateString = formatDate(date);
      const isPast = date < today;
      const isBlackout = blackoutDates.includes(dateString);
      const isToday = formatDate(date) === formatDate(today);
      const isSelected = STATE.selectedDate === dateString;

      let classes = 'calendar-date';
      if (isPast || isBlackout) classes += ' disabled';
      if (isToday) classes += ' today';
      if (isSelected) classes += ' selected';

      const disabled = isPast || isBlackout ? 'disabled' : '';
      const ariaLabel = `${date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}${isPast ? ' (past)' : ''}${isBlackout ? ' (unavailable)' : ''}`;

      html += `<button type="button" class="${classes}" data-date="${dateString}" ${disabled} aria-label="${ariaLabel}">${day}</button>`;
    }

    // Next month's days to fill grid
    const totalCells = Math.ceil((firstDay + daysInMonth) / 7) * 7;
    const remainingCells = totalCells - (firstDay + daysInMonth);
    for (let day = 1; day <= remainingCells; day++) {
      html += `<button type="button" class="calendar-date other-month" disabled>${day}</button>`;
    }

    datesEl.innerHTML = html;

    // Add click listeners
    datesEl.querySelectorAll('.calendar-date:not(.disabled):not(.other-month)').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const dateString = e.currentTarget.dataset.date;
        selectDate(dateString);
      });
    });
  }

  /**
   * Select a date and load time slots
   */
  async function selectDate(dateString) {
    STATE.selectedDate = dateString;
    STATE.selectedTime = null;
    
    renderCalendar();
    
    // Load time slots
    const timeSelect = document.getElementById('booking-time');
    if (!timeSelect) return;

    timeSelect.disabled = true;
    timeSelect.innerHTML = '<option value="">Loading...</option>';

    try {
      const data = await apiRequest(`/api/availability?date=${dateString}`);
      populateTimeSlots(data.slots);
    } catch (error) {
      console.error('Failed to load time slots:', error);
      showToast('Failed to load available times. Please try again.', 'error');
      timeSelect.innerHTML = '<option value="">Error loading times</option>';
    }
  }

  /**
   * Populate time slot dropdown
   */
  function populateTimeSlots(slots) {
    const timeSelect = document.getElementById('booking-time');
    if (!timeSelect) return;

    let html = '<option value="">Select a time...</option>';

    slots.forEach(slot => {
      if (slot.available) {
        // Check if time violates service restriction
        let warning = '';
        if (STATE.selectedService && violatesTimeRestriction(STATE.selectedService, slot.time)) {
          warning = ' ⚠️ (Not recommended - check service notes)';
        }
        
        html += `<option value="${slot.time}">${slot.label}${warning}</option>`;
      }
    });

    timeSelect.innerHTML = html;
    timeSelect.disabled = false;

    // Add change listener
    timeSelect.addEventListener('change', (e) => {
      STATE.selectedTime = e.target.value;
      
      // Show warning if violates restriction
      if (STATE.selectedService && STATE.selectedTime && 
          violatesTimeRestriction(STATE.selectedService, STATE.selectedTime)) {
        showToast(
          'This time may not allow us to complete your service. Please check the service notes for booking restrictions.',
          'warning',
          'Timing Restriction'
        );
      }
    });
  }

  // ============================================
  // Form Handling
  // ============================================

  /**
   * Validate form field
   */
  function validateField(field) {
    const value = field.value.trim();
    const type = field.type;
    const name = field.name;
    let error = '';

    if (field.required && !value) {
      error = 'This field is required';
    } else if (type === 'email' && value) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(value)) {
        error = 'Please enter a valid email address';
      }
    } else if (type === 'tel' && value) {
      const phoneRegex = /^\+?[\d\s\-\(\)]+$/;
      if (!phoneRegex.test(value) || value.replace(/\D/g, '').length < 10) {
        error = 'Please enter a valid phone number';
      }
    } else if (name === 'service' && !value) {
      error = 'Please select a service';
    } else if (name === 'time' && !value) {
      error = 'Please select a time slot';
    }

    // Show/hide error
    const errorDiv = field.parentElement.querySelector('.form-error');
    if (errorDiv) {
      if (error) {
        errorDiv.textContent = error;
        errorDiv.classList.add('visible');
        field.classList.add('error');
        return false;
      } else {
        errorDiv.textContent = '';
        errorDiv.classList.remove('visible');
        field.classList.remove('error');
        return true;
      }
    }

    return !error;
  }

  /**
   * Handle booking form submission
   */
  async function handleBookingSubmit(e) {
    e.preventDefault();

    const form = e.target;
    const formData = new FormData(form);

    // Validate all required fields
    let isValid = true;
    const requiredFields = form.querySelectorAll('[required]');
    requiredFields.forEach(field => {
      if (!validateField(field)) {
        isValid = false;
      }
    });

    // Validate date and time selected
    if (!STATE.selectedDate) {
      showToast('Please select a date', 'error');
      isValid = false;
    }

    if (!STATE.selectedTime) {
      showToast('Please select a time', 'error');
      isValid = false;
    }

    if (!isValid) {
      return;
    }

    // Prepare booking data
    const total = STATE.selectedService.price;
    const depositAmount = Math.max(
      total * CONFIG.DEPOSIT_PERCENT,
      CONFIG.DEPOSIT_MIN
    );

    const bookingData = {
      serviceId: STATE.selectedService.id,
      serviceTitle: STATE.selectedService.title,
      date: STATE.selectedDate,
      time: STATE.selectedTime,
      customer: {
        name: formData.get('name'),
        phone: formData.get('phone'),
        email: formData.get('email')
      },
      notes: formData.get('notes') || '',
      depositPercent: CONFIG.DEPOSIT_PERCENT,
      amountDue: total,
      depositAmount: depositAmount
    };

    // Submit booking
    try {
      const submitBtn = form.querySelector('button[type="submit"]');
      submitBtn.disabled = true;
      submitBtn.textContent = 'Processing...';

      const response = await apiRequest('/api/bookings', {
        method: 'POST',
        body: JSON.stringify(bookingData)
      });

      // Success!
      showToast(
        'Your booking has been created! Redirecting to payment...',
        'success',
        'Booking Confirmed'
      );

      // In production, redirect to Stripe payment
      // For mock mode, just show success and close
      setTimeout(() => {
        if (CONFIG.API_BASE_URL && CONFIG.STRIPE_KEY) {
          // TODO: Initialize Stripe Payment Element with response.clientSecret
          // window.location.href = `/payment?booking=${response.bookingId}`;
        } else {
          showToast(
            'Mock mode: Booking saved locally. In production, you would be redirected to payment.',
            'info',
            'Demo Mode'
          );
          closeBookingModal();
        }
      }, 1500);

    } catch (error) {
      console.error('Booking failed:', error);
      showToast(
        'Failed to create booking. Please try again or contact us directly.',
        'error',
        'Booking Error'
      );
      
      const submitBtn = form.querySelector('button[type="submit"]');
      submitBtn.disabled = false;
      submitBtn.textContent = 'Reserve & Pay Deposit';
    }
  }

  /**
   * Handle contact form submission
   */
  function handleContactSubmit(e) {
    e.preventDefault();

    const form = e.target;
    const formData = new FormData(form);

    // Validate fields
    let isValid = true;
    form.querySelectorAll('[required]').forEach(field => {
      if (!validateField(field)) {
        isValid = false;
      }
    });

    if (!isValid) return;

    // In production, this would submit to backend
    // For now, just show success message
    showToast(
      'Thank you for your message! We\'ll get back to you soon.',
      'success',
      'Message Sent'
    );

    form.reset();
  }

  // ============================================
  // Navigation & UI
  // ============================================

  /**
   * Initialize navigation
   */
  function initNavigation() {
    const hamburger = document.querySelector('.hamburger');
    const nav = document.getElementById('main-nav');
    const navLinks = document.querySelectorAll('.nav-link');

    // Hamburger toggle
    if (hamburger && nav) {
      hamburger.addEventListener('click', () => {
        const isExpanded = hamburger.getAttribute('aria-expanded') === 'true';
        hamburger.setAttribute('aria-expanded', !isExpanded);
        nav.setAttribute('aria-hidden', isExpanded);
      });
    }

    // Smooth scroll for nav links
    navLinks.forEach(link => {
      link.addEventListener('click', (e) => {
        const href = link.getAttribute('href');
        if (href.startsWith('#')) {
          e.preventDefault();
          smoothScroll(href);
          
          // Close mobile menu
          if (hamburger && nav) {
            hamburger.setAttribute('aria-expanded', 'false');
            nav.setAttribute('aria-hidden', 'true');
          }
          
          // Update active state
          navLinks.forEach(l => l.classList.remove('active'));
          link.classList.add('active');
        }
      });
    });

    // Update active nav on scroll
    window.addEventListener('scroll', updateActiveNav);
  }

  /**
   * Update active navigation item based on scroll position
   */
  function updateActiveNav() {
    const sections = document.querySelectorAll('section[id]');
    const scrollPos = window.pageYOffset + 100;

    sections.forEach(section => {
      const top = section.offsetTop;
      const height = section.offsetHeight;
      const id = section.getAttribute('id');

      if (scrollPos >= top && scrollPos < top + height) {
        document.querySelectorAll('.nav-link').forEach(link => {
          link.classList.remove('active');
          if (link.getAttribute('href') === `#${id}`) {
            link.classList.add('active');
          }
        });
      }
    });

    // Add shadow to header when scrolled
    const header = document.querySelector('.site-header');
    if (header) {
      if (window.pageYOffset > 50) {
        header.classList.add('scrolled');
      } else {
        header.classList.remove('scrolled');
      }
    }
  }

  /**
   * Initialize modal controls
   */
  function initModalControls() {
    // Open booking modal buttons
    document.querySelectorAll('[data-booking-open]').forEach(btn => {
      btn.addEventListener('click', () => openBookingModal());
    });

    // Close modal buttons
    document.querySelectorAll('[data-modal-close]').forEach(btn => {
      btn.addEventListener('click', closeBookingModal);
    });

    // Close on overlay click
    const modal = document.getElementById('booking-modal');
    if (modal) {
      const overlay = modal.querySelector('.modal-overlay');
      if (overlay) {
        overlay.addEventListener('click', closeBookingModal);
      }
    }
  }

  /**
   * Initialize forms
   */
  function initForms() {
    // Booking form
    const bookingForm = document.getElementById('booking-form');
    if (bookingForm) {
      // Service selection
      const serviceSelect = document.getElementById('booking-service');
      if (serviceSelect) {
        // Populate service options
        const options = STATE.catalog.map(service => 
          `<option value="${service.id}">${escapeHtml(service.title)} - ${formatCurrency(service.price)}</option>`
        ).join('');
        serviceSelect.innerHTML = '<option value="">Choose a service...</option>' + options;
        
        serviceSelect.addEventListener('change', updateServiceDetails);
      }

      // Real-time validation
      bookingForm.querySelectorAll('input, select, textarea').forEach(field => {
        field.addEventListener('blur', () => validateField(field));
      });

      bookingForm.addEventListener('submit', handleBookingSubmit);
    }

    // Contact form
    const contactForm = document.getElementById('contact-form');
    if (contactForm) {
      contactForm.querySelectorAll('input, textarea').forEach(field => {
        field.addEventListener('blur', () => validateField(field));
      });
      
      contactForm.addEventListener('submit', handleContactSubmit);
    }
  }

  /**
   * Initialize accordion
   */
  function initAccordion() {
    const accordionButtons = document.querySelectorAll('.accordion-button');
    
    accordionButtons.forEach(button => {
      button.addEventListener('click', () => {
        const isExpanded = button.getAttribute('aria-expanded') === 'true';
        
        // Close all others (optional: remove for multi-open)
        accordionButtons.forEach(btn => {
          if (btn !== button) {
            btn.setAttribute('aria-expanded', 'false');
          }
        });
        
        // Toggle current
        button.setAttribute('aria-expanded', !isExpanded);
      });
    });
  }

  /**
   * Show mock mode banner if API not connected
   */
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
      STATE.isApiConnected = false;
    } else {
      STATE.isApiConnected = true;
    }
  }

  /**
   * Set current year in footer
   */
  function setCurrentYear() {
    const yearEl = document.getElementById('current-year');
    if (yearEl) {
      yearEl.textContent = new Date().getFullYear();
    }
  }

  // ============================================
  // Initialization
  // ============================================

  /**
   * Initialize the application
   */
  function init() {
    // Check API connection
    checkApiConnection();
    
    // Load services
    loadServices();
    
    // Initialize UI components
    initNavigation();
    initModalControls();
    initCalendar();
    initForms();
    initAccordion();
    
    // Set current year
    setCurrentYear();
    
    // Log initialization
    console.log('Sallybraids app initialized', {
      apiConnected: STATE.isApiConnected,
      servicesLoaded: STATE.catalog.length
    });
  }

  // Run when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();