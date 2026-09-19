/* Rep-Flow — Repair Tickets: intake, technician workspace, photos, charges,
   invoicing, payment, handover, and the status timeline — all built around
   ONE ticket as the single source of truth. */

const currentUser = renderShell('Repair Tickets');

const STATUS_FLOW = [
  'Received', 'Assigned', 'Inspection', 'Diagnosing',
  'Waiting for Approval', 'Waiting for Parts',
  'Repair In Progress', 'Testing', 'Repair Completed', 'Ready for Delivery'
];
const ALL_STATUSES = [...STATUS_FLOW, 'Delivered', 'Cancelled'];
// Mirrors server/routes/tickets.js ROLE_ALLOWED_TARGETS exactly — admin has
// no entry here, meaning "unrestricted within the forward-only flow".
const ROLE_ALLOWED_TARGETS = {
  staff: ['Received', 'Assigned', 'Waiting for Approval', 'Ready for Delivery', 'Cancelled'],
  technician: ['Inspection', 'Diagnosing', 'Waiting for Parts', 'Repair In Progress', 'Testing', 'Repair Completed']
};
// The set of statuses a ticket can legally move to next, given who's asking
// and where it is now — forward-only, same as the backend enforces.
function computeAllowedTargets(role, currentStatus) {
  if (['Delivered', 'Cancelled'].includes(currentStatus)) return [];
  const currentIndex = STATUS_FLOW.indexOf(currentStatus);
  const forwardOptions = STATUS_FLOW.filter((s, i) => i > currentIndex);
  const roleSet = ROLE_ALLOWED_TARGETS[role]; // undefined for admin
  const targets = roleSet ? forwardOptions.filter(s => roleSet.includes(s)) : forwardOptions;
  const canCancel = !roleSet || roleSet.includes('Cancelled');
  return canCancel ? [...targets, 'Cancelled'] : targets;
}
const ACCESSORY_OPTIONS = ['Charger', 'Cable', 'Adapter', 'Case', 'SIM Tray', 'Memory Card', 'Other'];
const PAYMENT_METHODS = ['Cash', 'UPI', 'Bank Transfer', 'Card'];

function parseAccessories(raw) {
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string' && raw) {
    try { return JSON.parse(raw); } catch (e) { return []; }
  }
  return [];
}

let customersCache = [];
let techniciansCache = [];
let partsCache = [];
let currentFilters = { status: '', search: '', includeDrafts: false };
let newTicketId = null;        // set once Step 1 of the New Ticket wizard has created the ticket
let currentDetail = null;      // cached response of the last GET /tickets/:id
let currentTab = 'overview';

if (currentUser) initPage();

function initPage() {
  const body = document.getElementById('pageBody');
  const canManage = ['admin', 'staff'].includes(currentUser.role);

  body.innerHTML = `
    <div class="toolbar">
      <div class="search-box"><input type="text" id="searchInput" placeholder="Search ticket #, customer, phone, brand, model…"></div>
      <select id="statusFilter" style="max-width:170px">
        <option value="">All active statuses</option>
        ${ALL_STATUSES.map(s => `<option value="${s}">${s}</option>`).join('')}
        ${canManage ? `<option value="Draft">Draft</option>` : ''}
      </select>
      <div class="spacer"></div>
      ${canManage ? `<button class="btn btn-primary" id="addTicketBtn">+ New Ticket</button>` : ''}
    </div>
    <div class="card">
      <div class="table-wrap">
        <table>
          <thead><tr><th>Ticket #</th><th>Customer</th><th>Device</th><th>Technician</th><th>Status</th><th>Payment</th><th>Created</th><th></th></tr></thead>
          <tbody id="ticketRows"><tr class="empty-row"><td colspan="8">Loading…</td></tr></tbody>
        </table>
      </div>
    </div>

    ${canManage ? newTicketModalHtml() : ''}
    <div class="modal-overlay" id="detailModal">
      <div class="modal-box wide">
        <div class="modal-head"><h3 id="detailModalTitle">Ticket Detail</h3><button class="modal-close" data-close>&times;</button></div>
        <div class="modal-body" id="detailModalBody"></div>
        <div class="modal-foot"><button class="btn btn-outline" data-close>Close</button></div>
      </div>
    </div>
    <div class="lightbox-overlay" id="lightbox">
      <button class="lightbox-close" id="lightboxClose">&times;</button>
      <img id="lightboxImg" src="" alt="">
      <div class="lightbox-caption" id="lightboxCaption"></div>
    </div>
  `;

  document.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', closeModals));
  document.getElementById('lightboxClose').addEventListener('click', closeLightbox);
  document.getElementById('lightbox').addEventListener('click', (e) => { if (e.target.id === 'lightbox') closeLightbox(); });

  document.getElementById('statusFilter').addEventListener('change', (e) => {
    currentFilters.status = e.target.value;
    currentFilters.includeDrafts = e.target.value === 'Draft';
    loadTickets();
  });
  let searchTimer;
  document.getElementById('searchInput').addEventListener('input', (e) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { currentFilters.search = e.target.value; loadTickets(); }, 300);
  });

  if (canManage) {
    document.getElementById('addTicketBtn').addEventListener('click', openNewTicketModal);
    preloadDropdownData();
  }

  loadTickets().then(() => {
    const params = new URLSearchParams(window.location.search);
    const openId = params.get('open');
    if (openId) openTicketDetail(Number(openId));
  });
}

function closeModals() { document.querySelectorAll('.modal-overlay').forEach(m => m.classList.remove('open')); }
function openLightbox(src, caption) {
  document.getElementById('lightboxImg').src = src;
  document.getElementById('lightboxCaption').textContent = caption || '';
  document.getElementById('lightbox').classList.add('open');
}
function closeLightbox() { document.getElementById('lightbox').classList.remove('open'); }

/* ================================================================
   List
   ================================================================ */
async function loadTickets() {
  const tbody = document.getElementById('ticketRows');
  try {
    const params = new URLSearchParams();
    if (currentFilters.status) params.set('status', currentFilters.status);
    if (currentFilters.search) params.set('search', currentFilters.search);
    if (currentFilters.includeDrafts) params.set('includeDrafts', 'true');
    const rows = await Api.get(`/tickets?${params.toString()}`);

    if (rows.length === 0) {
      tbody.innerHTML = `<tr class="empty-row"><td colspan="8">No tickets found. ${currentFilters.status || currentFilters.search ? 'Try changing your search or filter.' : ''}</td></tr>`;
      return;
    }
    tbody.innerHTML = rows.map(t => `
      <tr>
        <td><b>${escapeHtml(t.ticket_number)}</b></td>
        <td>${escapeHtml(t.customer_name)}</td>
        <td>${escapeHtml(t.brand)} ${escapeHtml(t.device_type)}${t.model ? ' (' + escapeHtml(t.model) + ')' : ''}</td>
        <td>${escapeHtml(t.technician_name || '—')}</td>
        <td>${pill(t.status)}</td>
        <td>${pill(t.payment_status)}</td>
        <td>${formatDate(t.created_at)}</td>
        <td><button class="btn btn-sm btn-outline" onclick="openTicketDetail(${t.id})">View</button></td>
      </tr>`).join('');
  } catch (err) {
    tbody.innerHTML = `<tr class="empty-row"><td colspan="8">Error: ${escapeHtml(err.message)}</td></tr>`;
  }
}

async function preloadDropdownData() {
  try {
    [customersCache, techniciansCache, partsCache] = await Promise.all([
      Api.get('/customers'),
      Api.get('/technicians'),
      Api.get('/inventory')
    ]);
  } catch (err) {
    toast('Could not preload form data: ' + err.message, 'error');
  }
}

/* ================================================================
   New Ticket wizard — Step 1: intake only (no charges, per spec 6.8).
   Step 2: Before photos, unlocked once the ticket exists.
   ================================================================ */
function newTicketModalHtml() {
  return `
    <div class="modal-overlay" id="newTicketModal">
      <div class="modal-box wide">
        <div class="modal-head"><h3 id="ntTitle">New Repair Ticket — Intake</h3><button class="modal-close" data-close onclick="resetTicketWizard()">&times;</button></div>
        <div class="modal-body">
          <div class="wizard-steps">
            <span id="wizStep1" class="current">1. Device Intake</span> → <span id="wizStep2">2. Before Photos</span>
          </div>

          <div id="ntStep1">
            <div class="customer-mode-toggle">
              <button type="button" id="ntModeExisting" class="active" onclick="setCustomerMode('existing')">Existing Customer</button>
              <button type="button" id="ntModeNew" onclick="setCustomerMode('new')">+ New Customer</button>
            </div>
            <div id="ntExistingCustomerBlock" class="field">
              <label>Search Customer *</label>
              <input type="text" id="ntCustomerSearch" placeholder="Search by name, phone or email…" oninput="filterCustomerOptions()">
              <select id="ntCustomer" size="5" style="margin-top:6px;"></select>
            </div>
            <div id="ntNewCustomerBlock" class="form-grid" style="display:none;">
              <div class="field"><label>Name *</label><input type="text" id="ntNewName"></div>
              <div class="field"><label>Phone *</label><input type="text" id="ntNewPhone"></div>
              <div class="field"><label>Email</label><input type="email" id="ntNewEmail"></div>
              <div class="field"><label>Address</label><input type="text" id="ntNewAddress"></div>
            </div>

            <h4 class="section-gap">Device Details</h4>
            <div class="form-grid">
              <div class="field"><label>Device Type *</label><input type="text" id="ntDeviceType" placeholder="e.g. Laptop"></div>
              <div class="field"><label>Brand *</label><input type="text" id="ntBrand" placeholder="e.g. HP"></div>
              <div class="field"><label>Model</label><input type="text" id="ntModel"></div>
              <div class="field"><label>Serial Number / IMEI</label><input type="text" id="ntSerial"></div>
              <div class="field"><label>Device Color</label><input type="text" id="ntColor"></div>
              <div class="field"><label>Expected Date</label><input type="date" id="ntExpectedDate"></div>
            </div>

            <h4 class="section-gap">Device Condition</h4>
            <div class="field full"><label>Condition Notes</label><textarea id="ntCondition" rows="2" placeholder="Visible scratches, cracks, dents, screen/body condition…"></textarea></div>

            <h4 class="section-gap">Accessories Received</h4>
            <div class="checklist" id="ntAccessories">
              ${ACCESSORY_OPTIONS.map(a => `<label><input type="checkbox" value="${a}"> ${a}</label>`).join('')}
            </div>

            <h4 class="section-gap">Reported Problem</h4>
            <div class="field full"><textarea id="ntProblem" rows="2" placeholder="e.g. Laptop is not charging"></textarea></div>
          </div>

          <div id="ntStep2" style="display:none;">
            <p class="muted" style="font-size:12.5px;">Ticket <b id="ntCreatedNumber"></b> created. Add BEFORE-repair photos now, or skip and add them later from the ticket detail.</p>
            <div id="ntBeforePhotoGrid" class="photo-grid" style="margin-bottom:12px;"></div>
            <div class="photo-upload-box">
              📷 Add photos (front, back, screen damage, serial/IMEI, existing scratches…)
              <input type="file" id="ntPhotoInput" accept="image/jpeg,image/png,image/webp" multiple>
            </div>
          </div>
        </div>
        <div class="modal-foot">
          <button class="btn btn-outline" data-close onclick="resetTicketWizard()">Cancel</button>
          <span id="ntStep1Actions">
            <button class="btn btn-outline" id="saveDraftBtn">Save as Draft</button>
            <button class="btn btn-primary" id="submitTicketBtn">Create Ticket</button>
          </span>
          <span id="ntStep2Actions" style="display:none;">
            <button class="btn btn-primary" id="finishWizardBtn">Done</button>
          </span>
        </div>
      </div>
    </div>`;
}

function setCustomerMode(mode) {
  document.getElementById('ntModeExisting').classList.toggle('active', mode === 'existing');
  document.getElementById('ntModeNew').classList.toggle('active', mode === 'new');
  document.getElementById('ntExistingCustomerBlock').style.display = mode === 'existing' ? '' : 'none';
  document.getElementById('ntNewCustomerBlock').style.display = mode === 'new' ? '' : 'none';
}

function filterCustomerOptions() {
  const q = document.getElementById('ntCustomerSearch').value.trim().toLowerCase();
  const list = q
    ? customersCache.filter(c => c.name.toLowerCase().includes(q) || (c.phone || '').includes(q) || (c.email || '').toLowerCase().includes(q))
    : customersCache;
  document.getElementById('ntCustomer').innerHTML = list.slice(0, 30)
    .map(c => `<option value="${c.id}">${escapeHtml(c.name)} — ${escapeHtml(c.phone)}</option>`).join('')
    || `<option disabled>No matching customers</option>`;
}

function openNewTicketModal() {
  resetTicketWizard();
  filterCustomerOptions();
  techniciansCache = techniciansCache; // no-op, technician assignment happens after creation via detail view
  document.getElementById('newTicketModal').classList.add('open');
}

function resetTicketWizard() {
  newTicketId = null;
  document.getElementById('ntTitle').textContent = 'New Repair Ticket — Intake';
  document.getElementById('wizStep1').classList.add('current');
  document.getElementById('wizStep2').classList.remove('current');
  document.getElementById('ntStep1').style.display = '';
  document.getElementById('ntStep2').style.display = 'none';
  document.getElementById('ntStep1Actions').style.display = '';
  document.getElementById('ntStep2Actions').style.display = 'none';
  setCustomerMode('existing');
  ['ntCustomerSearch', 'ntNewName', 'ntNewPhone', 'ntNewEmail', 'ntNewAddress', 'ntDeviceType',
   'ntBrand', 'ntModel', 'ntSerial', 'ntColor', 'ntExpectedDate', 'ntCondition', 'ntProblem'
  ].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  document.querySelectorAll('#ntAccessories input').forEach(cb => cb.checked = false);
  const saveDraftBtn = document.getElementById('saveDraftBtn');
  const submitBtn = document.getElementById('submitTicketBtn');
  if (saveDraftBtn) { saveDraftBtn.onclick = () => submitIntake(true); saveDraftBtn.disabled = false; }
  if (submitBtn) { submitBtn.onclick = () => submitIntake(false); submitBtn.disabled = false; }
  const finishBtn = document.getElementById('finishWizardBtn');
  if (finishBtn) finishBtn.onclick = finishWizard;
  const photoInput = document.getElementById('ntPhotoInput');
  if (photoInput) photoInput.onchange = handleWizardPhotoSelect;
}

async function resolveCustomerId() {
  const isNew = document.getElementById('ntModeNew').classList.contains('active');
  if (!isNew) {
    const id = document.getElementById('ntCustomer').value;
    if (!id) throw new Error('Select an existing customer, or switch to "+ New Customer".');
    return id;
  }
  const name = document.getElementById('ntNewName').value.trim();
  const phone = document.getElementById('ntNewPhone').value.trim();
  if (!name || !phone) throw new Error('New customer name and phone are required.');
  const customer = await Api.post('/customers', {
    name, phone,
    email: document.getElementById('ntNewEmail').value.trim(),
    address: document.getElementById('ntNewAddress').value.trim()
  });
  customersCache.push(customer);
  return customer.id;
}

async function submitIntake(isDraft) {
  const draftBtn = document.getElementById('saveDraftBtn');
  const submitBtn = document.getElementById('submitTicketBtn');
  draftBtn.disabled = true; submitBtn.disabled = true;
  try {
    const customer_id = await resolveCustomerId();
    const device_type = document.getElementById('ntDeviceType').value.trim();
    const brand = document.getElementById('ntBrand').value.trim();
    const reported_problem = document.getElementById('ntProblem').value.trim();
    if (!isDraft && (!device_type || !brand || !reported_problem)) {
      throw new Error('Device type, brand and reported problem are required to submit a ticket (draft skips this check).');
    }
    const accessories = Array.from(document.querySelectorAll('#ntAccessories input:checked')).map(cb => cb.value);
    const payload = {
      customer_id, device_type, brand,
      model: document.getElementById('ntModel').value.trim(),
      serial_number: document.getElementById('ntSerial').value.trim(),
      device_color: document.getElementById('ntColor').value.trim(),
      condition_notes: document.getElementById('ntCondition').value.trim(),
      accessories,
      reported_problem,
      expected_date: document.getElementById('ntExpectedDate').value || null,
      is_draft: isDraft
    };
    const ticket = await Api.post('/tickets', payload);
    toast(isDraft ? 'Draft saved.' : `Ticket ${ticket.ticket_number} created.`);
    loadTickets();

    if (isDraft) {
      document.getElementById('newTicketModal').classList.remove('open');
      resetTicketWizard();
      return;
    }

    // Move to Step 2 — Before Photos
    newTicketId = ticket.id;
    document.getElementById('ntCreatedNumber').textContent = ticket.ticket_number;
    document.getElementById('ntTitle').textContent = `Ticket ${ticket.ticket_number} — Before Photos`;
    document.getElementById('wizStep1').classList.remove('current');
    document.getElementById('wizStep2').classList.add('current');
    document.getElementById('ntStep1').style.display = 'none';
    document.getElementById('ntStep2').style.display = '';
    document.getElementById('ntStep1Actions').style.display = 'none';
    document.getElementById('ntStep2Actions').style.display = '';
    renderWizardPhotoGrid([]);
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    draftBtn.disabled = false; submitBtn.disabled = false;
  }
}

async function handleWizardPhotoSelect(e) {
  const files = Array.from(e.target.files || []);
  e.target.value = '';
  for (const file of files) {
    const fd = new FormData();
    fd.append('photo', file);
    fd.append('photo_type', 'BEFORE');
    try {
      await Api.upload(`/tickets/${newTicketId}/photos`, fd);
    } catch (err) {
      toast(`${file.name}: ${err.message}`, 'error');
    }
  }
  const detail = await Api.get(`/tickets/${newTicketId}`);
  renderWizardPhotoGrid(detail.photos.before);
}

function renderWizardPhotoGrid(photos) {
  document.getElementById('ntBeforePhotoGrid').innerHTML = photos.map(p => `
    <div class="photo-thumb" onclick="openLightbox('${p.file_path}', 'BEFORE photo')">
      <img src="${p.file_path}" alt="Before photo">
      <button class="photo-remove" onclick="event.stopPropagation(); removeWizardPhoto(${p.id})">&times;</button>
    </div>`).join('') || `<p class="muted" style="font-size:12px;">No photos added yet.</p>`;
}

async function removeWizardPhoto(photoId) {
  try {
    await Api.del(`/tickets/${newTicketId}/photos/${photoId}`);
    const detail = await Api.get(`/tickets/${newTicketId}`);
    renderWizardPhotoGrid(detail.photos.before);
  } catch (err) {
    toast(err.message, 'error');
  }
}

function finishWizard() {
  document.getElementById('newTicketModal').classList.remove('open');
  const id = newTicketId;
  resetTicketWizard();
  loadTickets();
  if (id) openTicketDetail(id);
}

/* ================================================================
   Ticket Detail — tabbed modal (spec section 7: sections, not a
   giant cluttered form).
   ================================================================ */
async function openTicketDetail(id) {
  try {
    currentDetail = await Api.get(`/tickets/${id}`);
    currentTab = 'overview';
    document.getElementById('detailModalTitle').textContent = `Ticket ${currentDetail.ticket.ticket_number}`;
    renderDetailShell();
    document.getElementById('detailModal').classList.add('open');
  } catch (err) {
    toast(err.message, 'error');
  }
}

function renderDetailShell() {
  const t = currentDetail.ticket;
  const isTech = currentUser.role === 'technician';
  const tabs = [
    { key: 'overview', label: 'Overview' },
    { key: 'photos', label: 'Photos' },
    { key: 'work', label: 'Diagnosis & Parts' },
    { key: 'billing', label: 'Charges & Invoice' },
    { key: 'handover', label: t.status === 'Ready for Delivery' || t.status === 'Delivered' ? 'Payment & Handover' : 'Payment' },
    { key: 'timeline', label: 'Timeline' }
  ];
  document.getElementById('detailModalBody').innerHTML = `
    <div class="tab-bar">
      ${tabs.map(tb => `<button class="tab-btn ${tb.key === currentTab ? 'active' : ''}" onclick="switchTab('${tb.key}', this)">${tb.label}</button>`).join('')}
    </div>
    <div id="tabContent"></div>
  `;
  renderTabContent();
}

function switchTab(key, btnEl) {
  currentTab = key;
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  if (btnEl) btnEl.classList.add('active');
  renderTabContent();
}

function renderTabContent() {
  const el = document.getElementById('tabContent');
  if (currentTab === 'overview') el.innerHTML = renderOverviewTab();
  else if (currentTab === 'photos') { el.innerHTML = renderPhotosTab(); wirePhotoInputs(); }
  else if (currentTab === 'work') el.innerHTML = renderWorkTab();
  else if (currentTab === 'billing') el.innerHTML = renderBillingTab();
  else if (currentTab === 'handover') renderHandoverTab(el);
  else if (currentTab === 'timeline') el.innerHTML = renderTimelineTab();
}

/* ---------------- Overview ---------------- */
function renderOverviewTab() {
  const t = currentDetail.ticket;
  const canManage = ['admin', 'staff'].includes(currentUser.role);
  const isDraft = !!t.is_draft;
  const isClosed = ['Delivered', 'Cancelled'].includes(t.status);
  const accessories = parseAccessories(t.accessories);

  const allowedTargets = computeAllowedTargets(currentUser.role, t.status);

  return `
    <div class="two-col">
      <div>
        <h4 class="mt-0">Customer</h4>
        <p><b>${escapeHtml(t.customer_name)}</b><br>${escapeHtml(t.customer_phone)}${t.customer_email ? ' · ' + escapeHtml(t.customer_email) : ''}</p>
        ${t.customer_address ? `<p class="muted" style="font-size:12.5px;">${escapeHtml(t.customer_address)}</p>` : ''}
        <p><a href="customers.html?open=${t.customer_id}" style="color:var(--brand); font-weight:600; font-size:12.5px;">View customer profile →</a></p>

        <h4 class="section-gap">Device</h4>
        <p>${escapeHtml(t.brand)} ${escapeHtml(t.device_type)} ${t.model ? '· ' + escapeHtml(t.model) : ''}</p>
        <p class="muted" style="font-size:12.5px;">
          ${t.serial_number ? 'Serial/IMEI: ' + escapeHtml(t.serial_number) : ''}
          ${t.device_color ? ' · Color: ' + escapeHtml(t.device_color) : ''}
        </p>

        <h4 class="section-gap">Condition at Intake</h4>
        <p>${escapeHtml(t.condition_notes || 'No condition notes recorded.')}</p>

        <h4 class="section-gap">Accessories Received</h4>
        <p>${accessories.length ? accessories.map(a => `<span class="pill pill-Active">${escapeHtml(a)}</span>`).join(' ') : '<span class="muted">None recorded.</span>'}</p>

        <h4 class="section-gap">Reported Problem</h4>
        <p>${escapeHtml(t.reported_problem)}</p>
        ${t.expected_date ? `<p class="muted" style="font-size:12.5px;">Expected: ${formatDate(t.expected_date)}</p>` : ''}
      </div>
      <div>
        <h4 class="mt-0">Status</h4>
        <p>${pill(t.status)} &nbsp; ${!isDraft ? pill(t.payment_status) : ''}</p>

        ${isDraft && canManage ? `
          <div style="margin-top:10px; display:flex; gap:8px; flex-wrap:wrap;">
            <button class="btn btn-sm btn-primary" onclick="submitDraft(${t.id})">Submit Ticket</button>
            <button class="btn btn-sm btn-danger" onclick="discardDraft(${t.id})">Discard Draft</button>
          </div>
        ` : ''}

        ${!isDraft && !isClosed && allowedTargets.length ? `
          <div style="margin-top:10px;">
            <label style="font-size:12px; font-weight:600; color:var(--text-muted); display:block; margin-bottom:4px;">Move to</label>
            <div style="display:flex; gap:8px; flex-wrap:wrap;">
              ${allowedTargets.map(s => `<button class="btn btn-sm ${s === 'Cancelled' ? 'btn-danger' : 'btn-primary'}" onclick="changeStatus(${t.id}, '${s}')">${s}</button>`).join('')}
            </div>
            ${(currentUser.role === 'admin' || currentUser.role === 'staff') && t.status !== 'Ready for Delivery' ? '' : `<p class="muted" style="font-size:11.5px; margin-top:6px;">"Delivered" is only reached via the Payment &amp; Handover checklist.</p>`}
          </div>
        ` : ''}

        ${canManage && !isDraft ? `
          <div style="margin-top:14px;">
            <label style="font-size:12px; font-weight:600; color:var(--text-muted); display:block; margin-bottom:4px;">Assigned Technician</label>
            <select id="techAssignSelect" onchange="reassignTechnician(${t.id}, this.value)" style="padding:8px; border:1px solid var(--border); border-radius:6px; width:100%;">
              <option value="">Unassigned</option>
              ${techniciansCache.filter(tc => tc.status === 'Active').map(tc => `<option value="${tc.id}" ${t.technician_id === tc.id ? 'selected' : ''}>${escapeHtml(tc.name)}</option>`).join('')}
            </select>
          </div>
        ` : (t.technician_name ? `<p style="margin-top:10px;"><b>Technician:</b> ${escapeHtml(t.technician_name)}</p>` : '')}

        <p class="muted section-gap" style="font-size:11.5px;">Created ${formatDateTime(t.created_at)} · Last updated ${formatDateTime(t.updated_at)}</p>
      </div>
    </div>
  `;
}

async function submitDraft(id) {
  try {
    await Api.patch(`/tickets/${id}/status`, { status: 'Received', note: 'Draft submitted' });
    toast('Ticket submitted.');
    await openTicketDetail(id);
    loadTickets();
  } catch (err) { toast(err.message, 'error'); }
}

function discardDraft(id) {
  confirmAction('Discard this draft ticket? This cannot be undone.', async () => {
    try {
      await Api.del(`/tickets/${id}`);
      toast('Draft discarded.');
      closeModals();
      loadTickets();
    } catch (err) { toast(err.message, 'error'); }
  });
}

async function reassignTechnician(id, technicianId) {
  try {
    await Api.put(`/tickets/${id}`, { technician_id: technicianId || null });
    toast('Technician assignment updated.');
    currentDetail = await Api.get(`/tickets/${id}`);
    loadTickets();
  } catch (err) { toast(err.message, 'error'); }
}

function changeStatus(id, status) {
  confirmAction(`Move this ticket to "${status}"?`, async () => {
    try {
      await Api.patch(`/tickets/${id}/status`, { status });
      toast(`Status updated to ${status}.`);
      await openTicketDetail(id);
      loadTickets();
    } catch (err) { toast(err.message, 'error'); }
  });
}

/* ---------------- Photos ---------------- */
function renderPhotosTab() {
  const t = currentDetail.ticket;
  const { before, after } = currentDetail.photos;
  const canManage = ['admin', 'staff'].includes(currentUser.role);
  const isMyTech = currentUser.role === 'technician';
  const canUploadBefore = canManage;
  const canUploadAfter = canManage || isMyTech;
  const canDelete = canManage;
  const hasBoth = before.length > 0 && after.length > 0;

  return `
    ${hasBoth ? `<button class="btn btn-sm btn-outline" onclick="toggleCompareMode()" id="compareToggleBtn">Compare Before &amp; After</button>` : ''}
    <div id="comparePane"></div>

    <div class="photo-section-label">Before Repair</div>
    <div class="photo-grid">${photoGridHtml(before, canDelete)}</div>
    ${canUploadBefore ? `
      <div class="photo-upload-box section-gap">
        📷 Add BEFORE photos
        <input type="file" id="beforePhotoInput" accept="image/jpeg,image/png,image/webp" multiple>
      </div>` : ''}

    <div class="photo-section-label">After Repair</div>
    <div class="photo-grid">${photoGridHtml(after, canDelete)}</div>
    ${canUploadAfter ? `
      <div class="photo-upload-box section-gap">
        📷 Add AFTER photos ${isMyTech ? '(required before marking the job Ready)' : ''}
        <input type="file" id="afterPhotoInput" accept="image/jpeg,image/png,image/webp" multiple>
      </div>` : ''}
  `;
}

// Called after renderPhotosTab() is injected into the DOM — wire up file inputs.
function wirePhotoInputs() {
  const b = document.getElementById('beforePhotoInput');
  const a = document.getElementById('afterPhotoInput');
  if (b) b.onchange = (e) => uploadPhotos(e, 'BEFORE');
  if (a) a.onchange = (e) => uploadPhotos(e, 'AFTER');
}

function photoGridHtml(photos, canDelete) {
  if (!photos.length) return `<p class="muted" style="font-size:12.5px;">No photos yet.</p>`;
  return photos.map(p => `
    <div class="photo-thumb" onclick="openLightbox('${p.file_path}', '${escapeHtml(p.caption || '')}')">
      <img src="${p.file_path}" alt="${p.photo_type} photo" loading="lazy">
      ${p.caption ? `<div class="photo-caption">${escapeHtml(p.caption)}</div>` : ''}
      ${canDelete ? `<button class="photo-remove" onclick="event.stopPropagation(); deletePhoto(${p.ticket_id}, ${p.id})">&times;</button>` : ''}
    </div>`).join('');
}

async function uploadPhotos(e, photoType) {
  const files = Array.from(e.target.files || []);
  e.target.value = '';
  const ticketId = currentDetail.ticket.id;
  for (const file of files) {
    const fd = new FormData();
    fd.append('photo', file);
    fd.append('photo_type', photoType);
    try {
      await Api.upload(`/tickets/${ticketId}/photos`, fd);
    } catch (err) {
      toast(`${file.name}: ${err.message}`, 'error');
    }
  }
  currentDetail = await Api.get(`/tickets/${ticketId}`);
  document.getElementById('tabContent').innerHTML = renderPhotosTab();
  wirePhotoInputs();
  toast('Photos uploaded.');
}

function deletePhoto(ticketId, photoId) {
  confirmAction('Remove this photo?', async () => {
    try {
      await Api.del(`/tickets/${ticketId}/photos/${photoId}`);
      currentDetail = await Api.get(`/tickets/${ticketId}`);
      document.getElementById('tabContent').innerHTML = renderPhotosTab();
      wirePhotoInputs();
      toast('Photo removed.');
    } catch (err) { toast(err.message, 'error'); }
  });
}

function toggleCompareMode() {
  const pane = document.getElementById('comparePane');
  if (pane.innerHTML) { pane.innerHTML = ''; return; }
  const { before, after } = currentDetail.photos;
  const rows = Math.max(before.length, after.length);
  let html = '<div class="two-col section-gap"><div><b class="muted" style="font-size:11.5px;">BEFORE</b></div><div><b class="muted" style="font-size:11.5px;">AFTER</b></div></div>';
  for (let i = 0; i < rows; i++) {
    html += `<div class="two-col" style="margin-bottom:10px;">
      <div>${before[i] ? `<img src="${before[i].file_path}" style="width:100%; border-radius:8px; cursor:pointer;" onclick="openLightbox('${before[i].file_path}','Before')">` : ''}</div>
      <div>${after[i] ? `<img src="${after[i].file_path}" style="width:100%; border-radius:8px; cursor:pointer;" onclick="openLightbox('${after[i].file_path}','After')">` : ''}</div>
    </div>`;
  }
  pane.innerHTML = html;
}

/* ---------------- Diagnosis & Parts ---------------- */
function renderWorkTab() {
  const t = currentDetail.ticket;
  const parts = currentDetail.parts;
  const canManage = ['admin', 'staff'].includes(currentUser.role);
  const isMyTicketAsTech = currentUser.role === 'technician' && t.technician_id;
  const canEditNotes = canManage || isMyTicketAsTech;
  const isClosed = ['Delivered', 'Cancelled'].includes(t.status) || !!t.is_draft;

  return `
    <h4 class="mt-0">Diagnosis</h4>
    ${canEditNotes ? `<div class="field"><textarea id="diagnosisText" rows="2">${escapeHtml(t.diagnosis || '')}</textarea></div>`
      : `<p>${escapeHtml(t.diagnosis || 'Not yet recorded.')}</p>`}

    <h4 class="section-gap">Repair Notes</h4>
    ${canEditNotes ? `
      <div class="field"><textarea id="repairNotesText" rows="2">${escapeHtml(t.repair_notes || '')}</textarea></div>
      <button class="btn btn-sm btn-primary" onclick="saveDiagnosis(${t.id})">Save Notes</button>
    ` : `<p>${escapeHtml(t.repair_notes || 'Not yet recorded.')}</p>`}

    <h4 class="section-gap">Spare Parts Used</h4>
    <p class="muted" style="font-size:12px; margin-top:-6px;">Stock is verified and deducted automatically the moment a part is added.</p>
    <div class="table-wrap">
      <table>
        <thead><tr><th>Part</th><th>Qty</th><th>Unit Cost</th><th>Subtotal</th>${canManage ? '<th></th>' : ''}</tr></thead>
        <tbody>
          ${parts.length ? parts.map(p => `
            <tr>
              <td>${escapeHtml(p.part_name)} <span class="muted">(${escapeHtml(p.sku)})</span></td>
              <td>${p.quantity}</td>
              <td>${formatCurrency(p.unit_cost_at_use)}</td>
              <td>${formatCurrency(p.quantity * p.unit_cost_at_use)}</td>
              ${canManage ? `<td><button class="btn btn-sm btn-danger" onclick="removePart(${t.id}, ${p.id})">Remove</button></td>` : ''}
            </tr>`).join('') : `<tr class="empty-row"><td colspan="${canManage ? 5 : 4}">No parts used yet.</td></tr>`}
        </tbody>
      </table>
    </div>
    ${(canManage || isMyTicketAsTech) && !isClosed ? `
      <div style="display:flex; gap:8px; margin-top:12px; align-items:flex-end; flex-wrap:wrap;">
        <div class="field" style="margin:0; min-width:220px;">
          <label>Part</label>
          <select id="addPartSelect">${partsCache.map(p => `<option value="${p.id}">${escapeHtml(p.name)} (Stock: ${p.quantity})</option>`).join('')}</select>
        </div>
        <div class="field" style="margin:0; width:90px;"><label>Qty</label><input type="number" id="addPartQty" min="1" value="1"></div>
        <button class="btn btn-sm btn-primary" onclick="addPart(${t.id})">Add Part</button>
      </div>` : ''}
  `;
}

async function saveDiagnosis(ticketId) {
  const diagnosis = document.getElementById('diagnosisText').value;
  const repair_notes = document.getElementById('repairNotesText').value;
  try {
    await Api.put(`/tickets/${ticketId}`, { diagnosis, repair_notes });
    currentDetail = await Api.get(`/tickets/${ticketId}`);
    toast('Notes saved.');
  } catch (err) { toast(err.message, 'error'); }
}

async function addPart(ticketId) {
  const part_id = document.getElementById('addPartSelect').value;
  const quantity = Number(document.getElementById('addPartQty').value || 0);
  if (!part_id || quantity <= 0) { toast('Select a part and a valid quantity.', 'error'); return; }
  try {
    const res = await Api.post(`/tickets/${ticketId}/parts`, { part_id, quantity });
    toast(res.message || 'Part added.');
    if (res.lowStock) toast(`Warning: "${res.part.name}" is now low on stock.`, 'error');
    partsCache = await Api.get('/inventory');
    currentDetail = await Api.get(`/tickets/${ticketId}`);
    document.getElementById('tabContent').innerHTML = renderWorkTab();
  } catch (err) { toast(err.message, 'error'); }
}

function removePart(ticketId, ticketPartId) {
  confirmAction('Remove this part from the ticket? Stock will be restored.', async () => {
    try {
      await Api.del(`/tickets/${ticketId}/parts/${ticketPartId}`);
      toast('Part removed and stock restored.');
      partsCache = await Api.get('/inventory');
      currentDetail = await Api.get(`/tickets/${ticketId}`);
      document.getElementById('tabContent').innerHTML = renderWorkTab();
    } catch (err) { toast(err.message, 'error'); }
  });
}

/* ---------------- Charges & Invoice ---------------- */
function renderBillingTab() {
  const t = currentDetail.ticket;
  const invoice = currentDetail.invoice;
  const canManage = ['admin', 'staff'].includes(currentUser.role);
  const isMyTicketAsTech = currentUser.role === 'technician' && t.technician_id;
  const canEditCharges = canManage || isMyTicketAsTech;

  return `
    <h4 class="mt-0">Charges</h4>
    <p class="muted" style="font-size:12px; margin-top:-6px;">Set after diagnosis/repair — never during intake. The total below is always computed the same way everywhere in Rep-Flow.</p>
    <div class="form-grid">
      <div class="field">
        <label>Service / Labour Charge (₹)</label>
        <input type="number" min="0" step="0.01" id="chgService" value="${t.service_charge}" ${canEditCharges ? '' : 'disabled'}>
      </div>
      <div class="field">
        <label>Other Charges (₹)</label>
        <input type="number" min="0" step="0.01" id="chgOther" value="${t.other_charges}" ${canManage ? '' : 'disabled'}>
      </div>
      <div class="field">
        <label>Discount (₹)</label>
        <input type="number" min="0" step="0.01" id="chgDiscount" value="${t.discount}" ${canManage ? '' : 'disabled'}>
      </div>
    </div>
    ${canEditCharges ? `<button class="btn btn-sm btn-primary" onclick="saveCharges(${t.id})">Save Charges</button>` : ''}
    ${!canManage && isMyTicketAsTech ? `<p class="muted" style="font-size:11.5px; margin-top:6px;">You can set the labour charge for your own repair. Other charges and discounts are set by front-desk staff.</p>` : ''}

    <div class="invoice-totals section-gap">
      <div><span>Service Charge</span><span>${formatCurrency(t.service_charge)}</span></div>
      <div><span>Spare Parts</span><span>${formatCurrency(t.parts_cost)}</span></div>
      <div><span>Other Charges</span><span>${formatCurrency(t.other_charges)}</span></div>
      <div><span>Discount</span><span>−${formatCurrency(t.discount)}</span></div>
      <div class="grand"><span>Total</span><span>${formatCurrency(t.computed_total)}</span></div>
    </div>

    <h4 class="section-gap">Invoice</h4>
    ${invoice ? `
      <p><b>${escapeHtml(invoice.invoice_number)}</b> &nbsp; ${pill(invoice.payment_status)} &nbsp; <span class="muted">${formatCurrency(invoice.total_amount)}</span></p>
      <div style="display:flex; gap:8px; flex-wrap:wrap;">
        ${canManage ? `<button class="btn btn-sm btn-accent" onclick="generateInvoice(${t.id})">Refresh Invoice from Current Charges</button>` : ''}
        <a href="billing.html?open=${invoice.id}" class="btn btn-sm btn-outline">Open Printable Invoice</a>
      </div>
      <p class="muted" style="font-size:11.5px; margin-top:6px;">One ticket can only ever have one invoice — this refreshes it in place rather than creating a duplicate.</p>
    ` : `
      <p class="muted" style="font-size:12.5px;">No invoice yet.</p>
      ${canManage ? `<button class="btn btn-sm btn-accent" onclick="generateInvoice(${t.id})">Generate Invoice</button>` : ''}
    `}
  `;
}

async function saveCharges(ticketId) {
  const payload = {
    service_charge: Number(document.getElementById('chgService').value || 0),
    other_charges: Number(document.getElementById('chgOther').value || 0),
    discount: Number(document.getElementById('chgDiscount').value || 0)
  };
  try {
    await Api.patch(`/tickets/${ticketId}/charges`, payload);
    currentDetail = await Api.get(`/tickets/${ticketId}`);
    document.getElementById('tabContent').innerHTML = renderBillingTab();
    toast('Charges saved.');
  } catch (err) { toast(err.message, 'error'); }
}

async function generateInvoice(ticketId) {
  try {
    const invoice = await Api.post('/billing/generate', { ticket_id: ticketId });
    toast(invoice.already_existed ? 'Invoice refreshed.' : `Invoice ${invoice.invoice_number} created.`);
    currentDetail = await Api.get(`/tickets/${ticketId}`);
    document.getElementById('tabContent').innerHTML = renderBillingTab();
  } catch (err) { toast(err.message, 'error'); }
}

/* ---------------- Payment & Handover ---------------- */
const HANDOVER_FIELDS = [
  { key: 'device_tested', label: 'Device tested' },
  { key: 'repair_verified', label: 'Repair verified' },
  { key: 'accessories_returned', label: 'Accessories returned' },
  { key: 'customer_verified', label: 'Customer verified device' },
  { key: 'condition_confirmed', label: 'Device condition confirmed' },
  { key: 'payment_completed', label: 'Payment completed/recorded' },
  { key: 'customer_received', label: 'Customer received device' }
];

async function renderHandoverTab(el) {
  const t = currentDetail.ticket;
  const invoice = currentDetail.invoice;
  const canManage = ['admin', 'staff'].includes(currentUser.role);

  el.innerHTML = `<div class="loading-state">Loading…</div>`;

  let payments = [];
  let balance = invoice ? Number(invoice.total_amount) : 0;
  if (invoice) {
    try {
      const billing = await Api.get(`/billing/${invoice.id}`);
      payments = billing.payments;
      balance = billing.invoice.balance;
    } catch (err) { /* fall through with defaults */ }
  }

  let handover = currentDetail.handover;
  if (t.status === 'Ready for Delivery' || t.status === 'Delivered') {
    try { handover = await Api.get(`/tickets/${t.id}/handover`); } catch (err) { /* keep cached */ }
  }

  el.innerHTML = `
    <h4 class="mt-0">Payment</h4>
    ${invoice ? `
      <div class="table-wrap">
        <table>
          <thead><tr><th>Date</th><th>Method</th><th>Reference</th><th>Amount</th><th>Received By</th></tr></thead>
          <tbody>
            ${payments.length ? payments.map(p => `
              <tr>
                <td>${formatDateTime(p.received_at)}</td>
                <td>${escapeHtml(p.method)}</td>
                <td>${escapeHtml(p.reference_number || '—')}</td>
                <td>${formatCurrency(p.amount)}</td>
                <td>${escapeHtml(p.received_by_name || '—')}</td>
              </tr>`).join('') : `<tr class="empty-row"><td colspan="5">No payments recorded yet.</td></tr>`}
          </tbody>
        </table>
      </div>
      <p style="margin-top:8px;"><b>Balance remaining: ${formatCurrency(balance)}</b> &nbsp; ${pill(invoice.payment_status)}</p>
      ${canManage && balance > 0.01 ? `
        <div class="form-grid" style="margin-top:10px;">
          <div class="field"><label>Amount (₹)</label><input type="number" id="payAmount" min="0.01" step="0.01" max="${balance}" value="${balance}"></div>
          <div class="field"><label>Method</label>
            <select id="payMethod">${PAYMENT_METHODS.map(m => `<option value="${m}">${m}</option>`).join('')}</select>
          </div>
          <div class="field"><label>Reference / UTR (optional)</label><input type="text" id="payReference"></div>
        </div>
        <button class="btn btn-sm btn-primary" onclick="recordPayment(${invoice.id}, ${t.id})">Record Payment</button>
        <a href="payment-settings.html" class="btn btn-sm btn-outline">View UPI / Bank Details</a>
      ` : ''}
    ` : `<p class="muted" style="font-size:12.5px;">Generate an invoice on the Charges &amp; Invoice tab first.</p>`}

    ${(t.status === 'Ready for Delivery' || t.status === 'Delivered') ? `
      <h4 class="section-gap">Handover Checklist</h4>
      ${t.status === 'Delivered' ? `
        <p class="pill pill-Delivered">Delivered</p>
        <p class="muted" style="font-size:12px;">Confirmed ${formatDateTime(handover?.confirmed_at)}</p>
      ` : `
        <div class="handover-progress" id="handoverProgress"></div>
        <div class="checklist-vertical" id="handoverChecklist">
          ${HANDOVER_FIELDS.map(f => `
            <label><input type="checkbox" data-field="${f.key}" ${handover && handover[f.key] ? 'checked' : ''} ${canManage ? '' : 'disabled'} onchange="updateHandoverProgress()"> ${f.label}</label>
          `).join('')}
        </div>
        ${canManage ? `
          <div style="display:flex; gap:8px; margin-top:12px;">
            <button class="btn btn-sm btn-outline" onclick="saveHandover(${t.id})">Save Progress</button>
            <button class="btn btn-sm btn-primary" id="confirmHandoverBtn" onclick="confirmHandover(${t.id})">Confirm Handover</button>
          </div>
        ` : ''}
      `}
    ` : ''}
  `;
  if (t.status === 'Ready for Delivery') updateHandoverProgress();
}

function updateHandoverProgress() {
  const boxes = document.querySelectorAll('#handoverChecklist input[type="checkbox"]');
  const checked = Array.from(boxes).filter(b => b.checked).length;
  const progressEl = document.getElementById('handoverProgress');
  if (progressEl) progressEl.innerHTML = `<b>${checked} / ${boxes.length}</b> checklist items confirmed`;
  const confirmBtn = document.getElementById('confirmHandoverBtn');
  if (confirmBtn) confirmBtn.disabled = checked < boxes.length;
}

async function saveHandover(ticketId) {
  const payload = {};
  document.querySelectorAll('#handoverChecklist input[type="checkbox"]').forEach(cb => { payload[cb.dataset.field] = cb.checked; });
  try {
    await Api.put(`/tickets/${ticketId}/handover`, payload);
    toast('Handover progress saved.');
  } catch (err) { toast(err.message, 'error'); }
}

function confirmHandover(ticketId) {
  confirmAction('Confirm handover and mark this ticket Delivered? This cannot be undone.', async () => {
    try {
      await saveHandover(ticketId);
      await Api.post(`/tickets/${ticketId}/handover/confirm`, {});
      toast('Handover confirmed — ticket delivered.');
      await openTicketDetail(ticketId);
      loadTickets();
    } catch (err) { toast(err.message, 'error'); }
  });
}

async function recordPayment(invoiceId, ticketId) {
  const amount = Number(document.getElementById('payAmount').value || 0);
  const method = document.getElementById('payMethod').value;
  const reference_number = document.getElementById('payReference').value.trim();
  if (!amount || amount <= 0) { toast('Enter a valid payment amount.', 'error'); return; }
  try {
    const res = await Api.post('/payments', { invoice_id: invoiceId, amount, method, reference_number });
    toast(`Payment recorded. Status: ${res.payment_status}.`);
    currentDetail = await Api.get(`/tickets/${ticketId}`);
    renderHandoverTab(document.getElementById('tabContent'));
    loadTickets();
  } catch (err) { toast(err.message, 'error'); }
}

/* ---------------- Timeline ---------------- */
function renderTimelineTab() {
  const history = currentDetail.history;
  return `
    <ul class="timeline">
      ${history.map(h => `
        <li>
          <span class="dot"></span>
          <div class="tcontent">
            <b>${escapeHtml(h.status)}</b>
            <div class="tmeta">${formatDateTime(h.changed_at)} ${h.changed_by_name ? '• by ' + escapeHtml(h.changed_by_name) : ''}</div>
            ${h.note ? `<div class="tnote">${escapeHtml(h.note)}</div>` : ''}
          </div>
        </li>`).join('') || `<li class="muted" style="list-style:none;">No history yet.</li>`}
    </ul>
  `;
}
