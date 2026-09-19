/* Rep-Flow — Inventory: parts metadata + a fully auditable stock ledger.
   Quantity NEVER changes through the part edit form — only through
   Stock In / Stock Out / Correction, each of which writes an
   inventory_transactions row. */

const currentUser = renderShell('Inventory');
let allParts = [];
let showLowStockOnly = false;

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
      <div class="search-box"><input type="text" id="searchInput" placeholder="Search name, SKU, category…"></div>
      <label style="display:flex; align-items:center; gap:6px; font-size:13px;">
        <input type="checkbox" id="lowStockToggle"> Show low-stock only
      </label>
      <div class="spacer"></div>
      <button class="btn btn-primary" id="addPartBtn">+ Add Part</button>
    </div>
    <div class="card">
      <div class="table-wrap">
        <table>
          <thead><tr><th>Part Name</th><th>Category</th><th>SKU</th><th>Quantity</th><th>Purchase Price</th><th>Selling Price</th><th>Status</th><th></th></tr></thead>
          <tbody id="partRows"><tr class="empty-row"><td colspan="8">Loading…</td></tr></tbody>
        </table>
      </div>
    </div>

    <div class="modal-overlay" id="partModal">
      <div class="modal-box">
        <div class="modal-head"><h3 id="partModalTitle">Add Part</h3><button class="modal-close" data-close>&times;</button></div>
        <div class="modal-body">
          <form id="partForm">
            <input type="hidden" id="partId">
            <div class="form-grid">
              <div class="field full"><label>Part Name *</label><input type="text" id="partName" required></div>
              <div class="field"><label>Category</label><input type="text" id="partCategory" placeholder="e.g. Laptop Parts"></div>
              <div class="field"><label>SKU *</label><input type="text" id="partSku" required></div>
              <div class="field"><label>Supplier</label><input type="text" id="partSupplier"></div>
              <div class="field"><label>Storage Location</label><input type="text" id="partLocation"></div>
              <div class="field" id="partQtyField"><label>Opening Quantity</label><input type="number" min="0" id="partQty" value="0"></div>
              <div class="field"><label>Purchase (Unit) Cost (₹)</label><input type="number" min="0" step="0.01" id="partCost" value="0"></div>
              <div class="field"><label>Selling Price (₹)</label><input type="number" min="0" step="0.01" id="partSellingPrice"></div>
              <div class="field"><label>Minimum Stock</label><input type="number" min="0" id="partMinStock" value="2"></div>
            </div>
            <p class="muted" style="font-size:11.5px;" id="partQtyNote"></p>
          </form>
        </div>
        <div class="modal-foot">
          <button class="btn btn-outline" data-close>Cancel</button>
          <button class="btn btn-primary" id="savePartBtn">Save Part</button>
        </div>
      </div>
    </div>

    <div class="modal-overlay" id="stockModal">
      <div class="modal-box">
        <div class="modal-head"><h3 id="stockModalTitle">Stock In</h3><button class="modal-close" data-close>&times;</button></div>
        <div class="modal-body" id="stockModalBody"></div>
        <div class="modal-foot">
          <button class="btn btn-outline" data-close>Cancel</button>
          <button class="btn btn-primary" id="stockSaveBtn">Save</button>
        </div>
      </div>
    </div>

    <div class="modal-overlay" id="txModal">
      <div class="modal-box wide">
        <div class="modal-head"><h3 id="txModalTitle">Stock Movement History</h3><button class="modal-close" data-close>&times;</button></div>
        <div class="modal-body" id="txModalBody"></div>
        <div class="modal-foot"><button class="btn btn-outline" data-close>Close</button></div>
      </div>
    </div>
  `;

  document.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', closeModals));
  document.getElementById('addPartBtn').addEventListener('click', () => openPartModal());
  document.getElementById('savePartBtn').addEventListener('click', savePart);
  document.getElementById('lowStockToggle').addEventListener('change', (e) => {
    showLowStockOnly = e.target.checked;
    loadParts();
  });
  let searchTimer;
  document.getElementById('searchInput').addEventListener('input', (e) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(loadParts, 300);
  });

  loadParts();
}

function closeModals() { document.querySelectorAll('.modal-overlay').forEach(m => m.classList.remove('open')); }

async function loadParts() {
  const tbody = document.getElementById('partRows');
  try {
    const params = new URLSearchParams();
    if (showLowStockOnly) params.set('lowStock', 'true');
    const search = document.getElementById('searchInput')?.value.trim();
    if (search) params.set('search', search);
    allParts = await Api.get(`/inventory?${params.toString()}`);
    if (allParts.length === 0) {
      tbody.innerHTML = `<tr class="empty-row"><td colspan="8">No low-stock parts. Inventory levels are currently healthy.</td></tr>`;
      return;
    }
    tbody.innerHTML = allParts.map(p => `
      <tr>
        <td><b>${escapeHtml(p.name)}</b>${p.location ? `<div class="muted" style="font-size:11px;">${escapeHtml(p.location)}</div>` : ''}</td>
        <td>${escapeHtml(p.category)}</td>
        <td>${escapeHtml(p.sku)}</td>
        <td>${p.quantity}</td>
        <td>${formatCurrency(p.purchase_price)}</td>
        <td>${formatCurrency(p.selling_price)}</td>
        <td>${stockStatusPill(p.stock_status)}</td>
        <td class="table-actions">
          <button class="btn btn-sm btn-outline" onclick="openPartModal(${p.id})">Edit</button>
          <button class="btn btn-sm btn-outline" onclick="openStockModal(${p.id}, 'in')">Stock In</button>
          <button class="btn btn-sm btn-outline" onclick="openStockModal(${p.id}, 'out')">Stock Out</button>
          <button class="btn btn-sm btn-outline" onclick="openStockModal(${p.id}, 'correction')">Correction</button>
          <button class="btn btn-sm btn-outline" onclick="openTransactions(${p.id})">History</button>
          ${currentUser.role === 'admin' ? `<button class="btn btn-sm btn-danger" onclick="deletePart(${p.id})">Delete</button>` : ''}
        </td>
      </tr>`).join('');
  } catch (err) {
    tbody.innerHTML = `<tr class="empty-row"><td colspan="8">Error: ${escapeHtml(err.message)}</td></tr>`;
  }
}

function txTypeBadge(type) {
  const map = { IN: 'pill-Delivered', OUT: 'pill-Cancelled', RETURN: 'pill-Ready', CORRECTION: 'pill-Diagnosis' };
  return `<span class="pill ${map[type] || ''}">${escapeHtml(type)}</span>`;
}

function stockStatusPill(status) {
  const cls = status === 'Out of Stock' ? 'pill-Cancelled' : status === 'Low Stock' ? 'pill-Received' : 'pill-Delivered';
  return `<span class="pill ${cls}">${status}</span>`;
}

/* ---------------- Add / Edit part metadata ---------------- */
function openPartModal(id) {
  document.getElementById('partForm').reset();
  document.getElementById('partId').value = id || '';
  document.getElementById('partModalTitle').textContent = id ? 'Edit Part' : 'Add Part';
  document.getElementById('partQtyField').style.display = id ? 'none' : '';
  document.getElementById('partQtyNote').textContent = id
    ? 'To change quantity, use Stock In / Stock Out / Correction instead — every change is logged.'
    : 'This becomes the part\'s opening stock and is logged as an IN transaction.';

  if (id) {
    const p = allParts.find(x => x.id === id);
    if (p) {
      document.getElementById('partName').value = p.name;
      document.getElementById('partCategory').value = p.category;
      document.getElementById('partSku').value = p.sku;
      document.getElementById('partSupplier').value = p.supplier || '';
      document.getElementById('partLocation').value = p.location || '';
      document.getElementById('partCost').value = p.purchase_price;
      document.getElementById('partSellingPrice').value = p.selling_price || '';
      document.getElementById('partMinStock').value = p.min_stock;
    }
  } else {
    document.getElementById('partQty').value = 0;
    document.getElementById('partCost').value = 0;
    document.getElementById('partMinStock').value = 2;
  }
  document.getElementById('partModal').classList.add('open');
}

async function savePart() {
  const id = document.getElementById('partId').value;
  const base = {
    name: document.getElementById('partName').value.trim(),
    category: document.getElementById('partCategory').value.trim() || 'General',
    sku: document.getElementById('partSku').value.trim(),
    supplier: document.getElementById('partSupplier').value.trim(),
    location: document.getElementById('partLocation').value.trim(),
    purchase_price: Number(document.getElementById('partCost').value || 0),
    selling_price: document.getElementById('partSellingPrice').value ? Number(document.getElementById('partSellingPrice').value) : null,
    min_stock: Number(document.getElementById('partMinStock').value || 0)
  };
  if (!base.name || !base.sku) {
    toast('Part name and SKU are required.', 'error');
    return;
  }
  try {
    if (id) {
      await Api.put(`/inventory/${id}`, base);
      toast('Part updated.');
    } else {
      await Api.post('/inventory', { ...base, quantity: Number(document.getElementById('partQty').value || 0) });
      toast('Part added.');
    }
    closeModals();
    loadParts();
  } catch (err) {
    toast(err.message, 'error');
  }
}

function deletePart(id) {
  confirmAction('Delete this part from inventory? This cannot be undone.', async () => {
    try {
      await Api.del(`/inventory/${id}`);
      toast('Part deleted.');
      loadParts();
    } catch (err) {
      toast(err.message, 'error');
    }
  });
}

/* ---------------- Stock In / Out / Correction ---------------- */
function openStockModal(partId, mode) {
  const part = allParts.find(p => p.id === partId);
  const titles = { in: 'Stock In', out: 'Stock Out', correction: 'Stock Correction' };
  document.getElementById('stockModalTitle').textContent = `${titles[mode]} — ${part.name}`;

  let bodyHtml = `<p class="muted" style="font-size:12.5px;">Current stock: <b>${part.quantity}</b></p>`;
  if (mode === 'in') {
    bodyHtml += `
      <div class="field"><label>Quantity Received *</label><input type="number" min="1" id="stockQty" value="1"></div>
      <div class="field"><label>Supplier</label><input type="text" id="stockSupplier" value="${escapeHtml(part.supplier || '')}"></div>
      <div class="field"><label>Reference #</label><input type="text" id="stockReference" placeholder="Invoice / PO number"></div>
    `;
  } else if (mode === 'out') {
    bodyHtml += `
      <div class="field"><label>Quantity *</label><input type="number" min="1" max="${part.quantity}" id="stockQty" value="1"></div>
      <div class="field"><label>Reason *</label><input type="text" id="stockReason" placeholder="e.g. Damaged, written off"></div>
      ${currentUser.role === 'admin' ? `<label style="display:flex; align-items:center; gap:6px; font-size:12.5px;"><input type="checkbox" id="stockAllowNegative"> Allow this to go negative (admin override)</label>` : ''}
    `;
  } else {
    bodyHtml += `
      <div class="field"><label>New Counted Quantity *</label><input type="number" min="0" id="stockNewQty" value="${part.quantity}"></div>
      <div class="field"><label>Reason *</label><input type="text" id="stockReason" placeholder="e.g. Physical stock count reconciliation"></div>
    `;
  }
  document.getElementById('stockModalBody').innerHTML = bodyHtml;
  document.getElementById('stockSaveBtn').onclick = () => submitStockChange(partId, mode);
  document.getElementById('stockModal').classList.add('open');
}

async function submitStockChange(partId, mode) {
  try {
    let res;
    if (mode === 'in') {
      const quantity = Number(document.getElementById('stockQty').value || 0);
      if (!quantity || quantity <= 0) throw new Error('Enter a quantity greater than zero.');
      res = await Api.post(`/inventory/${partId}/stock-in`, {
        quantity,
        supplier: document.getElementById('stockSupplier').value.trim(),
        reference_number: document.getElementById('stockReference').value.trim()
      });
    } else if (mode === 'out') {
      const quantity = Number(document.getElementById('stockQty').value || 0);
      const reason = document.getElementById('stockReason').value.trim();
      if (!quantity || quantity <= 0) throw new Error('Enter a quantity greater than zero.');
      if (!reason) throw new Error('A reason is required.');
      const allowNegative = document.getElementById('stockAllowNegative')?.checked || false;
      res = await Api.post(`/inventory/${partId}/stock-out`, { quantity, reason, allow_negative: allowNegative });
    } else {
      const new_quantity = Number(document.getElementById('stockNewQty').value);
      const reason = document.getElementById('stockReason').value.trim();
      if (new_quantity === undefined || new_quantity < 0 || Number.isNaN(new_quantity)) throw new Error('Enter a valid quantity (0 or more).');
      if (!reason) throw new Error('A reason is required.');
      res = await Api.post(`/inventory/${partId}/correction`, { new_quantity, reason });
    }
    toast(`Stock updated. New quantity: ${res.quantity}.`);
    closeModals();
    loadParts();
  } catch (err) {
    toast(err.message, 'error');
  }
}

/* ---------------- Transaction history ---------------- */
async function openTransactions(partId) {
  const part = allParts.find(p => p.id === partId);
  document.getElementById('txModalTitle').textContent = `Stock Movement History — ${part.name}`;
  document.getElementById('txModalBody').innerHTML = `<div class="loading-state">Loading…</div>`;
  document.getElementById('txModal').classList.add('open');
  try {
    const rows = await Api.get(`/inventory/${partId}/transactions`);
    document.getElementById('txModalBody').innerHTML = `
      <div class="table-wrap">
        <table>
          <thead><tr><th>Date</th><th>Type</th><th>Qty Change</th><th>Ticket</th><th>User</th><th>Reason / Supplier</th><th>Stock After</th></tr></thead>
          <tbody>
            ${rows.length ? rows.map(t => `
              <tr>
                <td>${formatDateTime(t.created_at)}</td>
                <td>${txTypeBadge(t.type)}</td>
                <td>${t.new_stock - t.previous_stock > 0 ? '+' : ''}${t.new_stock - t.previous_stock}</td>
                <td>${t.ticket_number ? escapeHtml(t.ticket_number) : '—'}</td>
                <td>${escapeHtml(t.user_name || '—')}</td>
                <td>${escapeHtml(t.reason || t.supplier || '—')}</td>
                <td>${t.new_stock}</td>
              </tr>`).join('') : `<tr class="empty-row"><td colspan="7">No stock movements recorded yet.</td></tr>`}
          </tbody>
        </table>
      </div>`;
  } catch (err) {
    document.getElementById('txModalBody').innerHTML = `<div class="empty-state">Error: ${escapeHtml(err.message)}</div>`;
  }
}
