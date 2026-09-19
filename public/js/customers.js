/* Rep-Flow — Customers: list, add/edit, and a real profile view
   (summary, service history, devices) rather than a raw record dump. */

const currentUser = renderShell('Customers');
let allCustomers = [];

if (currentUser) {
  if (!['admin', 'staff'].includes(currentUser.role)) {
    window.location.href = 'dashboard.html';
  } else {
    initPage();
  }
}

function initPage() {
  const body = document.getElementById('pageBody');
  body.innerHTML = `
    <div class="toolbar">
      <div class="search-box"><input type="text" id="searchInput" placeholder="Search by name, phone or email…"></div>
      <div class="spacer"></div>
      <button class="btn btn-primary" id="addCustomerBtn">+ Add Customer</button>
    </div>
    <div class="card">
      <div class="table-wrap">
        <table>
          <thead><tr><th>Name</th><th>Phone</th><th>Email</th><th>Address</th><th>Added</th><th></th></tr></thead>
          <tbody id="customerRows"><tr class="empty-row"><td colspan="6">Loading…</td></tr></tbody>
        </table>
      </div>
    </div>

    <div class="modal-overlay" id="customerModal">
      <div class="modal-box">
        <div class="modal-head"><h3 id="customerModalTitle">Add Customer</h3><button class="modal-close" data-close>&times;</button></div>
        <div class="modal-body">
          <form id="customerForm">
            <input type="hidden" id="customerId">
            <div class="form-grid">
              <div class="field full"><label>Full Name *</label><input type="text" id="custName" required></div>
              <div class="field"><label>Phone *</label><input type="text" id="custPhone" required></div>
              <div class="field"><label>Email</label><input type="email" id="custEmail"></div>
              <div class="field full"><label>Address</label><textarea id="custAddress" rows="2"></textarea></div>
            </div>
          </form>
        </div>
        <div class="modal-foot">
          <button class="btn btn-outline" data-close>Cancel</button>
          <button class="btn btn-primary" id="saveCustomerBtn">Save Customer</button>
        </div>
      </div>
    </div>

    <div class="modal-overlay" id="profileModal">
      <div class="modal-box wide">
        <div class="modal-head"><h3 id="profileModalTitle">Customer Profile</h3><button class="modal-close" data-close>&times;</button></div>
        <div class="modal-body" id="profileModalBody"></div>
        <div class="modal-foot"><button class="btn btn-outline" data-close>Close</button></div>
      </div>
    </div>
  `;

  document.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', closeModals));
  document.getElementById('addCustomerBtn').addEventListener('click', () => openCustomerModal());
  document.getElementById('saveCustomerBtn').addEventListener('click', saveCustomer);

  let searchTimer;
  document.getElementById('searchInput').addEventListener('input', (e) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => loadCustomers(e.target.value), 300);
  });

  loadCustomers().then(() => {
    const params = new URLSearchParams(window.location.search);
    const openId = params.get('open');
    if (openId) openProfile(Number(openId));
  });
}

function closeModals() {
  document.querySelectorAll('.modal-overlay').forEach(m => m.classList.remove('open'));
}

async function loadCustomers(search = '') {
  const tbody = document.getElementById('customerRows');
  try {
    const qs = search ? `?search=${encodeURIComponent(search)}` : '';
    allCustomers = await Api.get(`/customers${qs}`);
    if (allCustomers.length === 0) {
      tbody.innerHTML = `<tr class="empty-row"><td colspan="6">No customers found. ${search ? 'Try changing your search.' : ''}</td></tr>`;
      return;
    }
    tbody.innerHTML = allCustomers.map(c => `
      <tr>
        <td><b>${escapeHtml(c.name)}</b></td>
        <td>${escapeHtml(c.phone)}</td>
        <td>${escapeHtml(c.email || '—')}</td>
        <td>${escapeHtml(c.address || '—')}</td>
        <td>${formatDate(c.created_at)}</td>
        <td class="table-actions">
          <button class="btn btn-sm btn-outline" onclick="openProfile(${c.id})">Profile</button>
          <button class="btn btn-sm btn-outline" onclick="openCustomerModal(${c.id})">Edit</button>
          ${currentUser.role === 'admin' ? `<button class="btn btn-sm btn-danger" onclick="deleteCustomer(${c.id})">Delete</button>` : ''}
        </td>
      </tr>`).join('');
  } catch (err) {
    tbody.innerHTML = `<tr class="empty-row"><td colspan="6">Error: ${escapeHtml(err.message)}</td></tr>`;
  }
}

function openCustomerModal(id) {
  const isEdit = !!id;
  document.getElementById('customerModalTitle').textContent = isEdit ? 'Edit Customer' : 'Add Customer';
  document.getElementById('customerForm').reset();
  document.getElementById('customerId').value = id || '';

  if (isEdit) {
    const c = allCustomers.find(x => x.id === id);
    if (c) {
      document.getElementById('custName').value = c.name;
      document.getElementById('custPhone').value = c.phone;
      document.getElementById('custEmail').value = c.email || '';
      document.getElementById('custAddress').value = c.address || '';
    }
  }
  document.getElementById('customerModal').classList.add('open');
}

async function saveCustomer() {
  const id = document.getElementById('customerId').value;
  const payload = {
    name: document.getElementById('custName').value.trim(),
    phone: document.getElementById('custPhone').value.trim(),
    email: document.getElementById('custEmail').value.trim(),
    address: document.getElementById('custAddress').value.trim()
  };
  if (!payload.name || !payload.phone) {
    toast('Name and phone are required.', 'error');
    return;
  }
  try {
    if (id) {
      await Api.put(`/customers/${id}`, payload);
      toast('Customer updated.');
    } else {
      await Api.post('/customers', payload);
      toast('Customer added.');
    }
    closeModals();
    loadCustomers(document.getElementById('searchInput').value);
  } catch (err) {
    toast(err.message, 'error');
  }
}

function deleteCustomer(id) {
  confirmAction('Delete this customer? This cannot be undone.', async () => {
    try {
      await Api.del(`/customers/${id}`);
      toast('Customer deleted.');
      loadCustomers(document.getElementById('searchInput').value);
    } catch (err) {
      toast(err.message, 'error');
    }
  });
}

/* ---------------- Profile: summary, devices, service history ---------------- */
async function openProfile(id) {
  const modal = document.getElementById('profileModal');
  const bodyEl = document.getElementById('profileModalBody');
  modal.classList.add('open');
  bodyEl.innerHTML = `<div class="loading-state">Loading profile…</div>`;

  try {
    const data = await Api.get(`/customers/${id}`);
    const { customer, summary, history, devices } = data;
    document.getElementById('profileModalTitle').textContent = customer.name;

    bodyEl.innerHTML = `
      <div class="two-col">
        <div>
          <h4 class="mt-0">Contact</h4>
          <p><b>${escapeHtml(customer.name)}</b><br>${escapeHtml(customer.phone)}${customer.email ? ' · ' + escapeHtml(customer.email) : ''}</p>
          ${customer.address ? `<p class="muted" style="font-size:12.5px;">${escapeHtml(customer.address)}</p>` : ''}
          <p class="muted" style="font-size:11.5px;">Customer since ${formatDate(customer.created_at)}</p>
          <button class="btn btn-sm btn-primary section-gap" onclick="window.location.href='tickets.html'">+ New Ticket for this Customer</button>
        </div>
        <div>
          <h4 class="mt-0">Summary</h4>
          <div class="stat-grid" style="grid-template-columns: repeat(2, 1fr);">
            <div class="stat-card"><div class="stat-label">Total Tickets</div><div class="stat-value">${summary.total_tickets}</div></div>
            <div class="stat-card accent"><div class="stat-label">Active Repairs</div><div class="stat-value">${summary.active_repairs}</div></div>
            <div class="stat-card success"><div class="stat-label">Completed</div><div class="stat-value">${summary.completed_repairs}</div></div>
            <div class="stat-card ${summary.unpaid_invoices > 0 ? 'danger' : ''}"><div class="stat-label">Unpaid Invoices</div><div class="stat-value">${summary.unpaid_invoices}</div></div>
          </div>
          <p class="section-gap"><b>Total Spent (Paid):</b> ${formatCurrency(summary.total_spent)}</p>
        </div>
      </div>

      ${devices.length ? `
        <h4 class="section-gap">Devices</h4>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Device</th><th>Tickets</th></tr></thead>
            <tbody>
              ${devices.map(d => `<tr><td>${escapeHtml(d.device)}</td><td>${d.ticketNumbers.map(escapeHtml).join(', ')}</td></tr>`).join('')}
            </tbody>
          </table>
        </div>
      ` : ''}

      <h4 class="section-gap">Service History</h4>
      ${history.length === 0 ? `<div class="empty-state">No repair tickets yet for this customer.</div>` : `
        <div class="table-wrap">
          <table>
            <thead><tr><th>Ticket #</th><th>Device</th><th>Technician</th><th>Status</th><th>Payment</th><th>Amount</th><th>Date</th><th></th></tr></thead>
            <tbody>
              ${history.map(h => `
                <tr>
                  <td><b>${escapeHtml(h.ticket_number)}</b></td>
                  <td>${escapeHtml(h.brand)} ${escapeHtml(h.device_type)} ${h.model ? '(' + escapeHtml(h.model) + ')' : ''}</td>
                  <td>${escapeHtml(h.technician_name || '—')}</td>
                  <td>${pill(h.status)}</td>
                  <td>${pill(h.payment_status)}</td>
                  <td>${h.total_amount ? formatCurrency(h.total_amount) : '—'}</td>
                  <td>${formatDate(h.created_at)}</td>
                  <td>
                    <button class="btn btn-sm btn-outline" onclick="window.location.href='tickets.html?open=${h.id}'">Open Ticket</button>
                    ${h.invoice_id ? `<button class="btn btn-sm btn-outline" onclick="window.location.href='billing.html?open=${h.invoice_id}'">Invoice</button>` : ''}
                  </td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>
      `}
    `;
  } catch (err) {
    bodyEl.innerHTML = `<div class="empty-state">Error: ${escapeHtml(err.message)}</div>`;
  }
}
