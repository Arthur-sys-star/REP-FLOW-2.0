/* Rep-Flow — shared frontend helpers: API calls, auth guard, toasts, formatting */

const API_BASE = '/api';

const Auth = {
  getToken() { return localStorage.getItem('repflow_token'); },
  getUser() {
    const raw = localStorage.getItem('repflow_user');
    return raw ? JSON.parse(raw) : null;
  },
  setSession(token, user) {
    localStorage.setItem('repflow_token', token);
    localStorage.setItem('repflow_user', JSON.stringify(user));
  },
  clear() {
    localStorage.removeItem('repflow_token');
    localStorage.removeItem('repflow_user');
  },
  logout() {
    this.clear();
    window.location.href = 'index.html';
  },
  // Call at the top of every protected page.
  requirePage(...allowedRoles) {
    const user = this.getUser();
    const token = this.getToken();
    if (!token || !user) {
      window.location.href = 'index.html';
      return null;
    }
    if (allowedRoles.length && !allowedRoles.includes(user.role)) {
      window.location.href = 'dashboard.html';
      return null;
    }
    return user;
  }
};

async function apiFetch(path, options = {}) {
  const token = Auth.getToken();
  const isFormData = options.body instanceof FormData;
  // Never set Content-Type ourselves for FormData — the browser must set it
  // (including the multipart boundary) or the upload will be rejected.
  const headers = isFormData
    ? { ...(options.headers || {}) }
    : { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  let response;
  try {
    response = await fetch(`${API_BASE}${path}`, { ...options, headers });
  } catch (networkErr) {
    throw new Error('Could not reach the Rep-Flow server. Is the backend running?');
  }

  if (response.status === 401) {
    // The login endpoint itself returns 401 for wrong credentials — that's
    // not an expired session, so let the real server message (e.g. "Invalid
    // email or password.") surface normally instead of bouncing the user
    // back to the login page they're already on.
    if (path === '/auth/login') {
      let data = null;
      try { data = JSON.parse(await response.text()); } catch (e) { /* ignore */ }
      throw new Error((data && data.message) || 'Invalid email or password.');
    }
    Auth.clear();
    window.location.href = 'index.html';
    throw new Error('Session expired. Please log in again.');
  }

  let data = null;
  const text = await response.text();
  try { data = text ? JSON.parse(text) : null; } catch (e) { /* non-JSON response */ }

  if (!response.ok) {
    throw new Error((data && data.message) || `Request failed (${response.status})`);
  }
  return data;
}

const Api = {
  get: (path) => apiFetch(path, { method: 'GET' }),
  post: (path, body) => apiFetch(path, { method: 'POST', body: JSON.stringify(body) }),
  put: (path, body) => apiFetch(path, { method: 'PUT', body: JSON.stringify(body) }),
  patch: (path, body) => apiFetch(path, { method: 'PATCH', body: JSON.stringify(body) }),
  del: (path) => apiFetch(path, { method: 'DELETE' }),
  // For multipart/form-data uploads (photos, QR images) — pass a FormData instance.
  upload: (path, formData) => apiFetch(path, { method: 'POST', body: formData })
};

/* ---------- Toasts ---------- */
function toast(message, type = 'success') {
  let wrap = document.querySelector('.toast-wrap');
  if (!wrap) {
    wrap = document.createElement('div');
    wrap.className = 'toast-wrap';
    document.body.appendChild(wrap);
  }
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = message;
  wrap.appendChild(el);
  setTimeout(() => el.remove(), 3800);
}

/* ---------- Formatting helpers ---------- */
function formatCurrency(value) {
  const n = Number(value || 0);
  return '₹' + n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function formatDate(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (isNaN(d)) return value;
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}
function formatDateTime(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (isNaN(d)) return value;
  return d.toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
function pill(value) {
  if (!value) return '';
  // Multi-word statuses ("Waiting for Approval") must not be interpolated
  // raw into a class attribute — that would split into several broken
  // space-separated classes. Slugify for the class, keep the real text
  // as the visible label.
  const slug = String(value).trim().replace(/\s+/g, '-');
  return `<span class="pill pill-${slug}">${value}</span>`;
}
function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}
function initials(name) {
  if (!name) return '?';
  return name.trim().split(/\s+/).slice(0, 2).map(p => p[0].toUpperCase()).join('');
}

/* ---------- Simple confirm modal (replaces window.confirm for consistent UI) ---------- */
function confirmAction(message, onConfirm) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay open';
  overlay.innerHTML = `
    <div class="modal-box" style="max-width:400px">
      <div class="modal-head"><h3>Please confirm</h3><button class="modal-close" data-close>&times;</button></div>
      <div class="modal-body"><p class="confirm-text">${escapeHtml(message)}</p></div>
      <div class="modal-foot">
        <button class="btn btn-outline" data-close>Cancel</button>
        <button class="btn btn-danger" data-confirm>Yes, proceed</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  overlay.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => overlay.remove()));
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  overlay.querySelector('[data-confirm]').addEventListener('click', () => {
    overlay.remove();
    onConfirm();
  });
}
