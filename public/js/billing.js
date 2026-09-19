/* Rep-Flow — Billing / Invoices: one ticket = one invoice, many payments. */

const currentUser = renderShell('Billing / Invoices');
const PAYMENT_METHODS = ['Cash', 'UPI', 'Bank Transfer', 'Card'];
let currentInvoiceData = null;
let paymentSettingsCache = null;

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
    <div class="card">
      <div class="table-wrap">
        <table>
          <thead><tr><th>Invoice #</th><th>Ticket #</th><th>Customer</th><th>Device</th><th>Total</th><th>Payment</th><th>Date</th><th></th></tr></thead>
          <tbody id="invoiceRows"><tr class="empty-row"><td colspan="8">Loading…</td></tr></tbody>
        </table>
      </div>
    </div>

    <div class="modal-overlay" id="invoiceModal">
      <div class="modal-box wide">
        <div class="modal-head"><h3>Invoice</h3><button class="modal-close" data-close>&times;</button></div>
        <div class="modal-body" id="invoiceModalBody"></div>
        <div class="modal-foot no-print">
          <button class="btn btn-outline" data-close>Close</button>
          <button class="btn btn-primary" id="printInvoiceBtn">Print Invoice</button>
        </div>
      </div>
    </div>
  `;

  document.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', closeModals));
  loadInvoices().then(() => {
    const params = new URLSearchParams(window.location.search);
    const openId = params.get('open');
    if (openId) openInvoice(Number(openId));
  });
}

function closeModals() { document.querySelectorAll('.modal-overlay').forEach(m => m.classList.remove('open')); }

async function loadInvoices() {
  const tbody = document.getElementById('invoiceRows');
  try {
    const rows = await Api.get('/billing');
    if (rows.length === 0) {
      tbody.innerHTML = `<tr class="empty-row"><td colspan="8">No invoices generated yet. Generate one from a ticket's Charges &amp; Invoice tab.</td></tr>`;
      return;
    }
    tbody.innerHTML = rows.map(i => `
      <tr>
        <td><b>${escapeHtml(i.invoice_number)}</b></td>
        <td>${escapeHtml(i.ticket_number)}</td>
        <td>${escapeHtml(i.customer_name)}</td>
        <td>${escapeHtml(i.brand)} ${escapeHtml(i.device_type)}</td>
        <td>${formatCurrency(i.total_amount)}</td>
        <td>${pill(i.payment_status)}</td>
        <td>${formatDate(i.created_at)}</td>
        <td><button class="btn btn-sm btn-outline" onclick="openInvoice(${i.id})">View</button></td>
      </tr>`).join('');
  } catch (err) {
    tbody.innerHTML = `<tr class="empty-row"><td colspan="8">Error: ${escapeHtml(err.message)}</td></tr>`;
  }
}

async function openInvoice(id) {
  const modal = document.getElementById('invoiceModal');
  const bodyEl = document.getElementById('invoiceModalBody');
  modal.classList.add('open');
  bodyEl.innerHTML = `<div class="loading-state">Loading invoice…</div>`;

  try {
    currentInvoiceData = await Api.get(`/billing/${id}`);
    if (!paymentSettingsCache) {
      try { paymentSettingsCache = await Api.get('/payment-settings'); } catch (e) { paymentSettingsCache = null; }
    }
    bodyEl.innerHTML = invoiceHtml(currentInvoiceData);
    document.getElementById('printInvoiceBtn').onclick = () => printInvoice(currentInvoiceData);
  } catch (err) {
    bodyEl.innerHTML = `<div class="empty-state">Error: ${escapeHtml(err.message)}</div>`;
  }
}

function invoiceHtml(data) {
  const { invoice, parts, payments } = data;
  return `
    <div class="invoice-sheet" id="invoiceSheet" style="padding:0;">
      <div class="invoice-head">
        <div class="brand-block">
          <b>${escapeHtml(paymentSettingsCache?.business_name || 'Rep-Flow')}</b>
          <div class="tagline">From Service Request to Successful Delivery.</div>
        </div>
        <div class="invoice-meta">
          <div><b>Invoice #:</b> ${escapeHtml(invoice.invoice_number)}</div>
          <div><b>Ticket #:</b> ${escapeHtml(invoice.ticket_number)}</div>
          <div><b>Date:</b> ${formatDate(invoice.created_at)}</div>
          <div>${pill(invoice.payment_status)}</div>
        </div>
      </div>
      <div class="two-col" style="margin-bottom:14px;">
        <div>
          <h4 class="mt-0">Billed To</h4>
          <p>${escapeHtml(invoice.customer_name)}<br>${escapeHtml(invoice.customer_phone)}<br>${escapeHtml(invoice.customer_address || '')}</p>
        </div>
        <div>
          <h4 class="mt-0">Device</h4>
          <p>${escapeHtml(invoice.brand)} ${escapeHtml(invoice.device_type)} ${invoice.model ? '(' + escapeHtml(invoice.model) + ')' : ''}
          ${invoice.serial_number ? '<br>S/N: ' + escapeHtml(invoice.serial_number) : ''}</p>
        </div>
      </div>

      <table class="invoice-table">
        <thead><tr><th>Description</th><th>Qty</th><th>Unit Cost</th><th>Subtotal</th></tr></thead>
        <tbody>
          <tr><td>Service Charge</td><td>—</td><td>—</td><td>${formatCurrency(invoice.service_charge)}</td></tr>
          ${parts.map(p => `<tr><td>${escapeHtml(p.part_name)}</td><td>${p.quantity}</td><td>${formatCurrency(p.unit_cost_at_use)}</td><td>${formatCurrency(p.quantity * p.unit_cost_at_use)}</td></tr>`).join('')}
          <tr><td>Other Charges</td><td>—</td><td>—</td><td>${formatCurrency(invoice.other_charges)}</td></tr>
          ${Number(invoice.discount) > 0 ? `<tr><td>Discount</td><td>—</td><td>—</td><td>−${formatCurrency(invoice.discount)}</td></tr>` : ''}
        </tbody>
      </table>

      <div class="invoice-totals">
        <div><span>Paid</span><span>${formatCurrency(invoice.paid_amount)}</span></div>
        <div><span>Balance</span><span>${formatCurrency(invoice.balance)}</span></div>
        <div class="grand"><span>Total Amount</span><span>${formatCurrency(invoice.total_amount)}</span></div>
      </div>

      <h4 class="section-gap">Payment History</h4>
      <table class="invoice-table">
        <thead><tr><th>Date</th><th>Method</th><th>Reference</th><th>Amount</th></tr></thead>
        <tbody>
          ${payments.length ? payments.map(p => `
            <tr><td>${formatDateTime(p.received_at)}</td><td>${escapeHtml(p.method)}</td><td>${escapeHtml(p.reference_number || '—')}</td><td>${formatCurrency(p.amount)}</td></tr>
          `).join('') : `<tr><td colspan="4" style="text-align:center; color:var(--text-muted);">No payments recorded yet.</td></tr>`}
        </tbody>
      </table>

      ${invoice.balance > 0.01 ? `
        <div class="section-gap no-print">
          <h4>Record a Payment</h4>
          <div class="form-grid">
            <div class="field"><label>Amount (₹)</label><input type="number" id="billPayAmount" min="0.01" step="0.01" max="${invoice.balance}" value="${invoice.balance}"></div>
            <div class="field"><label>Method</label><select id="billPayMethod">${PAYMENT_METHODS.map(m => `<option value="${m}">${m}</option>`).join('')}</select></div>
            <div class="field"><label>Reference / UTR (optional)</label><input type="text" id="billPayReference"></div>
          </div>
          <button class="btn btn-sm btn-primary" onclick="recordBillingPayment(${invoice.id})">Record Payment</button>
          <a href="payment-settings.html" class="btn btn-sm btn-outline">View UPI / Bank Details</a>
        </div>
      ` : ''}
    </div>
  `;
}

async function recordBillingPayment(invoiceId) {
  const amount = Number(document.getElementById('billPayAmount').value || 0);
  const method = document.getElementById('billPayMethod').value;
  const reference_number = document.getElementById('billPayReference').value.trim();
  if (!amount || amount <= 0) { toast('Enter a valid payment amount.', 'error'); return; }
  try {
    const res = await Api.post('/payments', { invoice_id: invoiceId, amount, method, reference_number });
    toast(`Payment recorded. Status: ${res.payment_status}.`);
    await openInvoice(invoiceId);
    loadInvoices();
  } catch (err) { toast(err.message, 'error'); }
}

function printInvoice(data) {
  const win = window.open('', '_blank', 'width=800,height=900');
  win.document.write(`
    <!DOCTYPE html><html><head><title>Invoice ${escapeHtml(data.invoice.invoice_number)}</title>
    <link rel="stylesheet" href="${window.location.origin}/css/style.css"></head>
    <body onload="window.print()">
      ${invoiceHtml(data)}
    </body></html>
  `);
  win.document.close();
}
