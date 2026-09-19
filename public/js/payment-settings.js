/* Rep-Flow — Payment Settings. Admin configures the business's UPI/bank
   receiving details; every other role gets a read-only view (front-desk
   staff need this to tell customers how to pay, per spec section 20). */

const currentUser = renderShell('Payment Settings');
if (currentUser) initPage();

function initPage() {
  const body = document.getElementById('pageBody');
  const isAdmin = currentUser.role === 'admin';

  body.innerHTML = `
    <div class="card">
      <div class="card-header"><h3>${isAdmin ? 'Business Payment Details' : 'How Customers Can Pay'}</h3></div>
      <div class="card-body" id="settingsBody">
        <div class="loading-state">Loading…</div>
      </div>
    </div>
  `;

  loadSettings(isAdmin);
}

async function loadSettings(isAdmin) {
  const el = document.getElementById('settingsBody');
  try {
    const s = (await Api.get('/payment-settings')) || {};
    el.innerHTML = isAdmin ? editableForm(s) : readOnlyView(s);
    if (isAdmin) wireEditableForm(s);
  } catch (err) {
    el.innerHTML = `<div class="empty-state">Error: ${escapeHtml(err.message)}</div>`;
  }
}

function readOnlyView(s) {
  const hasAny = s.business_name || s.upi_id || s.bank_name;
  if (!hasAny) return `<div class="empty-state">Payment details haven't been set up by an admin yet.</div>`;
  return `
    <div class="two-col">
      <div>
        <h4 class="mt-0">UPI</h4>
        <p>${s.upi_id ? `<b>${escapeHtml(s.upi_id)}</b>` : '<span class="muted">Not set</span>'}</p>
        ${s.upi_qr_path ? `<img src="${s.upi_qr_path}" alt="UPI QR code" style="max-width:180px; border:1px solid var(--border); border-radius:8px; padding:6px; background:#fff;">` : ''}
      </div>
      <div>
        <h4 class="mt-0">Bank Transfer</h4>
        <p>
          ${s.bank_name ? `${escapeHtml(s.bank_name)}<br>` : ''}
          ${s.account_holder ? `${escapeHtml(s.account_holder)}<br>` : ''}
          ${s.account_number ? `A/C: ${escapeHtml(s.account_number)}<br>` : ''}
          ${s.ifsc ? `IFSC: ${escapeHtml(s.ifsc)}<br>` : ''}
          ${s.branch ? escapeHtml(s.branch) : ''}
        </p>
      </div>
    </div>
    ${s.instructions ? `<h4 class="section-gap">Instructions for Customers</h4><p>${escapeHtml(s.instructions)}</p>` : ''}
  `;
}

function editableForm(s) {
  return `
    <div class="form-grid">
      <div class="field full"><label>Business / Shop Name</label><input type="text" id="psBusinessName" value="${escapeHtml(s.business_name || '')}"></div>
      <div class="field"><label>UPI ID</label><input type="text" id="psUpiId" value="${escapeHtml(s.upi_id || '')}" placeholder="yourshop@upi"></div>
      <div class="field"><label>Bank Name</label><input type="text" id="psBankName" value="${escapeHtml(s.bank_name || '')}"></div>
      <div class="field"><label>Account Holder Name</label><input type="text" id="psAccountHolder" value="${escapeHtml(s.account_holder || '')}"></div>
      <div class="field"><label>Account Number</label><input type="text" id="psAccountNumber" value="${escapeHtml(s.account_number || '')}"></div>
      <div class="field"><label>IFSC</label><input type="text" id="psIfsc" value="${escapeHtml(s.ifsc || '')}"></div>
      <div class="field"><label>Branch</label><input type="text" id="psBranch" value="${escapeHtml(s.branch || '')}"></div>
    </div>
    <div class="field full"><label>Payment Instructions for Customers</label><textarea id="psInstructions" rows="2">${escapeHtml(s.instructions || '')}</textarea></div>
    <button class="btn btn-sm btn-primary" id="psSaveBtn">Save Payment Settings</button>

    <h4 class="section-gap">UPI QR Code</h4>
    ${s.upi_qr_path ? `<img src="${s.upi_qr_path}" alt="Current UPI QR code" style="max-width:180px; border:1px solid var(--border); border-radius:8px; padding:6px; background:#fff; display:block; margin-bottom:10px;">` : `<p class="muted" style="font-size:12.5px;">No QR code uploaded yet.</p>`}
    <div class="photo-upload-box" style="max-width:320px;">
      📷 Upload / Replace QR Code
      <input type="file" id="psQrInput" accept="image/jpeg,image/png,image/webp">
    </div>
  `;
}

function wireEditableForm(s) {
  document.getElementById('psSaveBtn').addEventListener('click', async () => {
    const payload = {
      business_name: document.getElementById('psBusinessName').value.trim(),
      upi_id: document.getElementById('psUpiId').value.trim(),
      bank_name: document.getElementById('psBankName').value.trim(),
      account_holder: document.getElementById('psAccountHolder').value.trim(),
      account_number: document.getElementById('psAccountNumber').value.trim(),
      ifsc: document.getElementById('psIfsc').value.trim(),
      branch: document.getElementById('psBranch').value.trim(),
      instructions: document.getElementById('psInstructions').value.trim()
    };
    try {
      await Api.put('/payment-settings', payload);
      toast('Payment settings saved.');
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  document.getElementById('psQrInput').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    const fd = new FormData();
    fd.append('qr', file);
    try {
      await Api.upload('/payment-settings/qr', fd);
      toast('QR code updated.');
      loadSettings(true);
    } catch (err) {
      toast(err.message, 'error');
    }
  });
}
