/* Rep-Flow — Reports (Admin only). Every figure here comes straight from
   the database via GET /api/reports — nothing on this page is invented. */

const currentUser = renderShell('Reports');

if (currentUser) {
  if (currentUser.role !== 'admin') {
    window.location.href = 'dashboard.html';
  } else {
    loadReports();
  }
}

async function loadReports() {
  const body = document.getElementById('pageBody');
  body.innerHTML = `<div class="loading-state">Loading reports…</div>`;

  try {
    const data = await Api.get('/reports');

    body.innerHTML = `
      <div class="stat-grid">
        <div class="stat-card"><div class="stat-label">Total Customers</div><div class="stat-value">${data.total_customers}</div><div class="stat-sub">+${data.new_customers_30d} in last 30 days</div></div>
        <div class="stat-card"><div class="stat-label">Total Tickets</div><div class="stat-value">${data.total_tickets}</div></div>
        <div class="stat-card accent"><div class="stat-label">Open Tickets</div><div class="stat-value">${data.open_tickets}</div></div>
        <div class="stat-card"><div class="stat-label">Delivered Tickets</div><div class="stat-value">${data.delivered_tickets}</div></div>
        <div class="stat-card"><div class="stat-label">Cancelled Tickets</div><div class="stat-value">${data.cancelled_tickets}</div></div>
        <div class="stat-card success"><div class="stat-label">Revenue Collected</div><div class="stat-value">${formatCurrency(data.total_collected)}</div></div>
        <div class="stat-card ${data.outstanding > 0 ? 'danger' : ''}"><div class="stat-label">Outstanding</div><div class="stat-value">${formatCurrency(data.outstanding)}</div></div>
        <div class="stat-card"><div class="stat-label">Avg. Repair Time</div><div class="stat-value">${data.avg_repair_hours != null ? data.avg_repair_hours + 'h' : '—'}</div></div>
      </div>

      <div class="two-col">
        <div class="card">
          <div class="card-header"><h3>Repair Status Distribution</h3></div>
          <div class="card-body">
            <div class="table-wrap">
              <table>
                <thead><tr><th>Status</th><th>Count</th></tr></thead>
                <tbody>
                  ${data.statusDistribution.length ? data.statusDistribution.map(s => `
                    <tr><td>${pill(s.status)}</td><td>${s.count}</td></tr>`).join('') :
                    `<tr class="empty-row"><td colspan="2">No data yet.</td></tr>`}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div class="card">
          <div class="card-header"><h3>Technician Workload</h3></div>
          <div class="card-body">
            <div class="table-wrap">
              <table>
                <thead><tr><th>Technician</th><th>Total</th><th>Pending</th><th>Delivered</th></tr></thead>
                <tbody>
                  ${data.technicianWorkload.length ? data.technicianWorkload.map(t => `
                    <tr><td>${escapeHtml(t.name)}</td><td>${t.total_jobs}</td><td>${t.pending_jobs}</td><td>${t.delivered_jobs}</td></tr>`).join('') :
                    `<tr class="empty-row"><td colspan="4">No technicians yet.</td></tr>`}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      <div class="two-col section-gap" style="margin-top:16px">
        <div class="card">
          <div class="card-header"><h3>Payment Methods</h3></div>
          <div class="card-body">
            <div class="table-wrap">
              <table>
                <thead><tr><th>Method</th><th>Count</th><th>Total</th></tr></thead>
                <tbody>
                  ${data.paymentMethods.length ? data.paymentMethods.map(m => `
                    <tr><td>${escapeHtml(m.method)}</td><td>${m.count}</td><td>${formatCurrency(m.total)}</td></tr>`).join('') :
                    `<tr class="empty-row"><td colspan="3">No payments recorded yet.</td></tr>`}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div class="card">
          <div class="card-header"><h3>Inventory Snapshot</h3><a href="inventory.html" class="btn btn-sm btn-outline">Manage</a></div>
          <div class="card-body">
            <div class="stat-grid" style="grid-template-columns: repeat(3, 1fr);">
              <div class="stat-card"><div class="stat-label">Total Parts</div><div class="stat-value">${data.inventory.total_parts}</div></div>
              <div class="stat-card ${data.inventory.low_stock > 0 ? 'danger' : ''}"><div class="stat-label">Low Stock</div><div class="stat-value">${data.inventory.low_stock}</div></div>
              <div class="stat-card ${data.inventory.out_of_stock > 0 ? 'danger' : ''}"><div class="stat-label">Out of Stock</div><div class="stat-value">${data.inventory.out_of_stock}</div></div>
            </div>
            <div class="table-wrap section-gap">
              <table>
                <thead><tr><th>Movement Type</th><th>Count</th><th>Units</th></tr></thead>
                <tbody>
                  ${data.stockMovement.length ? data.stockMovement.map(m => `
                    <tr><td>${escapeHtml(m.type)}</td><td>${m.count}</td><td>${m.total_units}</td></tr>`).join('') :
                    `<tr class="empty-row"><td colspan="3">No stock movement recorded yet.</td></tr>`}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      <div class="card section-gap" style="margin-top:16px">
        <div class="card-header"><h3>Monthly Billed-Job Summary</h3></div>
        <div class="card-body">
          <div class="table-wrap">
            <table>
              <thead><tr><th>Month</th><th>Invoices</th><th>Total Billed</th></tr></thead>
              <tbody>
                ${data.monthlyBilling.length ? data.monthlyBilling.map(m => `
                  <tr><td>${escapeHtml(m.month)}</td><td>${m.invoice_count}</td><td>${formatCurrency(m.total_billed)}</td></tr>`).join('') :
                  `<tr class="empty-row"><td colspan="3">No billing data yet.</td></tr>`}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    `;
  } catch (err) {
    body.innerHTML = `<div class="empty-state">Error: ${escapeHtml(err.message)}</div>`;
  }
}
