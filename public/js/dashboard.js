/* Rep-Flow — Dashboard (role determines which renderer runs, not which
   elements are hidden — admin/staff/technician get different views built
   from different backend payload shapes). */

const currentUser = renderShell('Dashboard');
if (currentUser) loadDashboard();

async function loadDashboard() {
  const body = document.getElementById('pageBody');
  body.innerHTML = `<div class="loading-state">Loading dashboard…</div>`;

  try {
    const data = await Api.get('/dashboard');
    if (data.role === 'admin') return renderAdminDashboard(body, data);
    if (data.role === 'staff') return renderStaffDashboard(body, data);
    if (data.role === 'technician') return renderTechnicianDashboard(body, data);
    body.innerHTML = `<div class="empty-state">Unrecognized account role.</div>`;
  } catch (err) {
    body.innerHTML = `<div class="empty-state">Could not load dashboard: ${escapeHtml(err.message)}</div>`;
  }
}

/* ================================================================
   ADMIN — business-wide view: revenue, technician workload, activity
   ================================================================ */
function renderAdminDashboard(body, data) {
  const t = data.totals;
  body.innerHTML = `
    <div class="stat-grid">
      <div class="stat-card"><div class="stat-label">Total Customers</div><div class="stat-value">${t.total_customers}</div></div>
      <div class="stat-card"><div class="stat-label">Total Jobs</div><div class="stat-value">${t.total_jobs}</div></div>
      <div class="stat-card accent"><div class="stat-label">In Progress</div><div class="stat-value">${t.in_progress_jobs}</div></div>
      <div class="stat-card success"><div class="stat-label">Ready for Delivery</div><div class="stat-value">${t.ready_jobs}</div></div>
      <div class="stat-card"><div class="stat-label">Delivered</div><div class="stat-value">${t.delivered_jobs}</div></div>
      <div class="stat-card ${t.pending_payments > 0 ? 'danger' : ''}"><div class="stat-label">Pending Payments</div><div class="stat-value">${t.pending_payments}</div></div>
      <div class="stat-card success"><div class="stat-label">Paid Revenue</div><div class="stat-value">${formatCurrency(t.paid_revenue)}</div></div>
      <div class="stat-card ${t.low_stock_count > 0 ? 'danger' : ''}"><div class="stat-label">Low-Stock Parts</div><div class="stat-value">${t.low_stock_count}</div></div>
    </div>

    <div class="card section-gap">
      <div class="card-header"><h3>Quick Actions</h3></div>
      <div class="card-body quick-actions">
        <a href="tickets.html" class="btn btn-primary">+ New Ticket</a>
        <a href="customers.html" class="btn btn-outline">+ New Customer</a>
        <a href="technicians.html" class="btn btn-outline">Manage Technicians</a>
        <a href="inventory.html" class="btn btn-outline">Manage Inventory</a>
        <a href="reports.html" class="btn btn-outline">View Reports</a>
      </div>
    </div>

    <div class="two-col">
      <div class="card">
        <div class="card-header"><h3>Recent Tickets</h3><a href="tickets.html" class="btn btn-sm btn-outline">View all</a></div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Ticket #</th><th>Customer</th><th>Device</th><th>Status</th><th>Payment</th><th>Created</th></tr></thead>
            <tbody>
              ${data.recentTickets.length ? data.recentTickets.map(rowRecentTicket).join('') :
                `<tr class="empty-row"><td colspan="6">No tickets yet.</td></tr>`}
            </tbody>
          </table>
        </div>
      </div>
      <div class="card">
        <div class="card-header"><h3>Repair Status Overview</h3></div>
        <div class="card-body">${statusOverview(data.statusDistribution, t.total_jobs)}</div>
      </div>
    </div>

    <div class="two-col section-gap" style="margin-top:16px">
      <div class="card">
        <div class="card-header"><h3>Technician Workload</h3><a href="technicians.html" class="btn btn-sm btn-outline">Manage</a></div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Technician</th><th>Active</th><th>Completed</th><th>Status</th></tr></thead>
            <tbody>
              ${data.technicianWorkload.length ? data.technicianWorkload.map(w => `
                <tr>
                  <td>${escapeHtml(w.name)}</td>
                  <td>${w.active_jobs || 0}</td>
                  <td>${w.completed_jobs || 0}</td>
                  <td>${pill(w.status)}</td>
                </tr>`).join('') : `<tr class="empty-row"><td colspan="4">No technicians yet.</td></tr>`}
            </tbody>
          </table>
        </div>
      </div>
      <div class="card">
        <div class="card-header"><h3>Recent Activity</h3></div>
        <div class="card-body">
          ${data.recentActivity.length ? data.recentActivity.map(a => `
            <div style="margin-bottom:10px; font-size:13px;">
              <b>${escapeHtml(a.ticket_number)}</b> → ${pill(a.status)}
              <div class="muted" style="font-size:11.5px; margin-top:2px;">
                ${a.changed_by_name ? escapeHtml(a.changed_by_name) + ' · ' : ''}${formatDate(a.changed_at)}
              </div>
            </div>`).join('') : `<div class="empty-state">No recent activity.</div>`}
        </div>
      </div>
    </div>

    <div class="card section-gap" style="margin-top:16px">
      <div class="card-header"><h3>Low Stock Alerts</h3><a href="inventory.html" class="btn btn-sm btn-outline">Manage Inventory</a></div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Part</th><th>SKU</th><th>In Stock</th><th>Min Stock</th></tr></thead>
          <tbody>
            ${data.lowStock.length ? data.lowStock.map(p => `
              <tr>
                <td>${escapeHtml(p.name)}</td>
                <td>${escapeHtml(p.sku)}</td>
                <td><span class="low-stock-badge">${p.quantity}</span></td>
                <td>${p.min_stock}</td>
              </tr>`).join('') : `<tr class="empty-row"><td colspan="4">All parts are sufficiently stocked.</td></tr>`}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

/* ================================================================
   STAFF — front-desk view: today's workload, customers, payments
   ================================================================ */
function renderStaffDashboard(body, data) {
  const t = data.totals;
  body.innerHTML = `
    <div class="stat-grid">
      <div class="stat-card accent"><div class="stat-label">Active Tickets</div><div class="stat-value">${t.active_tickets}</div></div>
      <div class="stat-card success"><div class="stat-label">Ready for Delivery</div><div class="stat-value">${t.ready_for_delivery}</div></div>
      <div class="stat-card ${t.pending_payments > 0 ? 'danger' : ''}"><div class="stat-label">Pending Payments</div><div class="stat-value">${t.pending_payments}</div></div>
      <div class="stat-card"><div class="stat-label">Today's Handovers</div><div class="stat-value">${t.handovers_today}</div></div>
    </div>

    <div class="card section-gap">
      <div class="card-header"><h3>Quick Actions</h3></div>
      <div class="card-body quick-actions">
        <a href="customers.html" class="btn btn-primary">+ New Customer</a>
        <a href="tickets.html" class="btn btn-primary">+ New Ticket</a>
        <a href="tickets.html" class="btn btn-outline">Search Ticket</a>
      </div>
    </div>

    <div class="two-col">
      <div class="card">
        <div class="card-header"><h3>Ready for Delivery</h3><a href="tickets.html" class="btn btn-sm btn-outline">View all tickets</a></div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Ticket #</th><th>Customer</th><th>Device</th><th>Payment</th></tr></thead>
            <tbody>
              ${data.readyTickets.length ? data.readyTickets.map(r => `
                <tr onclick="window.location.href='tickets.html?open=${r.id}'" style="cursor:pointer">
                  <td><b>${escapeHtml(r.ticket_number)}</b></td>
                  <td>${escapeHtml(r.customer_name)}</td>
                  <td>${escapeHtml(r.brand)} ${escapeHtml(r.device_type)}</td>
                  <td>${pill(r.payment_status)}</td>
                </tr>`).join('') : `<tr class="empty-row"><td colspan="4">Nothing ready for delivery right now.</td></tr>`}
            </tbody>
          </table>
        </div>
      </div>
      <div class="card">
        <div class="card-header"><h3>Recent Customers</h3><a href="customers.html" class="btn btn-sm btn-outline">View all</a></div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Name</th><th>Phone</th></tr></thead>
            <tbody>
              ${data.recentCustomers.length ? data.recentCustomers.map(c => `
                <tr onclick="window.location.href='customers.html?open=${c.id}'" style="cursor:pointer">
                  <td>${escapeHtml(c.name)}</td>
                  <td>${escapeHtml(c.phone)}</td>
                </tr>`).join('') : `<tr class="empty-row"><td colspan="2">No customers yet.</td></tr>`}
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <div class="card section-gap" style="margin-top:16px">
      <div class="card-header"><h3>Recent Tickets</h3><a href="tickets.html" class="btn btn-sm btn-outline">View all</a></div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Ticket #</th><th>Customer</th><th>Device</th><th>Status</th><th>Payment</th><th>Created</th></tr></thead>
          <tbody>
            ${data.recentTickets.length ? data.recentTickets.map(rowRecentTicket).join('') :
              `<tr class="empty-row"><td colspan="6">No tickets yet.</td></tr>`}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

/* ================================================================
   TECHNICIAN — personal workboard only
   ================================================================ */
function renderTechnicianDashboard(body, data) {
  if (data.unlinked) {
    body.innerHTML = `<div class="empty-state">
      Your login isn't linked to a technician profile yet. Ask an admin to
      link your account under Technicians.
    </div>`;
    return;
  }

  const t = data.totals;

  body.innerHTML = `
    <div class="stat-grid">
      <div class="stat-card accent"><div class="stat-label">Assigned Jobs</div><div class="stat-value">${t.assigned}</div></div>
      <div class="stat-card ${t.due_today > 0 ? 'danger' : ''}"><div class="stat-label">Due Today</div><div class="stat-value">${t.due_today}</div></div>
    </div>

    <div class="card section-gap">
      <div class="card-header"><h3>My Workboard</h3><a href="tickets.html" class="btn btn-sm btn-outline">View My Jobs</a></div>
      <div class="card-body">
        <div class="workboard">
          ${data.columns.map(col => {
            const jobs = col.jobs || [];
            return `
              <div class="workboard-col">
                <h4>${col.label} <span class="count">${jobs.length}</span></h4>
                ${jobs.length ? jobs.map(j => `
                  <div class="workboard-card" onclick="window.location.href='tickets.html?open=${j.id}'">
                    <div class="wc-ticket">${escapeHtml(j.ticket_number)}</div>
                    <div class="wc-device">${escapeHtml(j.brand)} ${escapeHtml(j.device_type)} ${j.model ? '· ' + escapeHtml(j.model) : ''}</div>
                    <div class="wc-device">${escapeHtml(j.customer_name)}</div>
                    ${j.expected_date ? `<div class="wc-due muted">Due ${formatDate(j.expected_date)}</div>` : ''}
                  </div>`).join('') : `<div class="workboard-empty">Nothing here.</div>`}
              </div>`;
          }).join('')}
        </div>
      </div>
    </div>

    <div class="card section-gap" style="margin-top:16px">
      <div class="card-header"><h3>Recent Activity on My Jobs</h3></div>
      <div class="card-body">
        ${data.recentActivity.length ? data.recentActivity.map(a => `
          <div style="margin-bottom:10px; font-size:13px;">
            <b>${escapeHtml(a.ticket_number)}</b> → ${pill(a.status)}
            <div class="muted" style="font-size:11.5px; margin-top:2px;">${formatDate(a.changed_at)}</div>
          </div>`).join('') : `<div class="empty-state">No recent activity yet.</div>`}
      </div>
    </div>
  `;
}

/* ================================================================
   Shared helpers
   ================================================================ */
function rowRecentTicket(row) {
  return `<tr onclick="window.location.href='tickets.html?open=${row.id}'" style="cursor:pointer">
    <td><b>${escapeHtml(row.ticket_number)}</b></td>
    <td>${escapeHtml(row.customer_name)}</td>
    <td>${escapeHtml(row.brand)} ${escapeHtml(row.device_type)}</td>
    <td>${pill(row.status)}</td>
    <td>${pill(row.payment_status)}</td>
    <td>${formatDate(row.created_at)}</td>
  </tr>`;
}

function statusOverview(distribution, total) {
  const order = [
    'Received', 'Assigned', 'Inspection', 'Diagnosing', 'Waiting for Approval',
    'Waiting for Parts', 'Repair In Progress', 'Testing', 'Repair Completed',
    'Ready for Delivery', 'Delivered', 'Cancelled'
  ];
  const map = {};
  distribution.forEach(d => map[d.status] = d.count);

  return order.filter(s => map[s]).map(status => {
    const count = map[status];
    const pct = total ? Math.round((count / total) * 100) : 0;
    return `
      <div style="margin-bottom:12px">
        <div style="display:flex; justify-content:space-between; font-size:12.5px; margin-bottom:4px;">
          <span>${pill(status)}</span><span class="muted">${count} (${pct}%)</span>
        </div>
        <div style="height:7px; background:var(--bg); border-radius:4px; overflow:hidden;">
          <div style="height:100%; width:${pct}%; background:var(--brand);"></div>
        </div>
      </div>`;
  }).join('') || `<div class="empty-state">No ticket data yet.</div>`;
}
