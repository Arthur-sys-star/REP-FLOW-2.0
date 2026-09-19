/* Rep-Flow — Activity / Audit Log (Admin only). Every write action across
   the app calls logActivity() server-side (see server/utils/audit.js), so
   this page is a straight read of that accountability trail. */

const currentUser = renderShell('Activity Log');

if (currentUser) {
  if (currentUser.role !== 'admin') {
    window.location.href = 'dashboard.html';
  } else {
    initPage();
  }
}

function initPage() {
  const body = document.getElementById('pageBody');
  body.innerHTML = `
    <div class="toolbar">
      <p class="muted" style="font-size:12.5px; margin:0;">Most recent activity first, across every user and every part of the system.</p>
      <div class="spacer"></div>
      <button class="btn btn-outline btn-sm" id="refreshLogBtn">Refresh</button>
    </div>
    <div class="card">
      <div class="table-wrap">
        <table>
          <thead><tr><th>When</th><th>User</th><th>Role</th><th>Action</th><th>Details</th></tr></thead>
          <tbody id="logRows"><tr class="empty-row"><td colspan="5">Loading…</td></tr></tbody>
        </table>
      </div>
    </div>
  `;
  document.getElementById('refreshLogBtn').addEventListener('click', loadLog);
  loadLog();
}

async function loadLog() {
  const tbody = document.getElementById('logRows');
  tbody.innerHTML = `<tr class="empty-row"><td colspan="5">Loading…</td></tr>`;
  try {
    const rows = await Api.get('/audit-logs?limit=200');
    if (rows.length === 0) {
      tbody.innerHTML = `<tr class="empty-row"><td colspan="5">No activity recorded yet.</td></tr>`;
      return;
    }
    tbody.innerHTML = rows.map(r => `
      <tr>
        <td>${formatDateTime(r.created_at)}</td>
        <td>${escapeHtml(r.user_name || 'System')}</td>
        <td>${r.role ? `<span class="pill pill-${escapeHtml(r.role)}">${escapeHtml(r.role)}</span>` : '—'}</td>
        <td>${escapeHtml(r.action)}</td>
        <td class="muted" style="font-size:12.5px;">${escapeHtml(r.details || '—')}</td>
      </tr>`).join('');
  } catch (err) {
    tbody.innerHTML = `<tr class="empty-row"><td colspan="5">Error: ${escapeHtml(err.message)}</td></tr>`;
  }
}
