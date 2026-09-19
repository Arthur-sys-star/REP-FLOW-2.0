/* Rep-Flow — Technicians */

const currentUser = renderShell('Technicians');
let allTechnicians = [];

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
      <div class="spacer"></div>
      <button class="btn btn-primary" id="addTechBtn">+ Add Technician</button>
    </div>
    <div class="card">
      <div class="table-wrap">
        <table>
          <thead><tr><th>Name</th><th>Phone</th><th>Specialization</th><th>Experience</th><th>Status</th><th>Assigned Jobs</th><th>Open Jobs</th><th></th></tr></thead>
          <tbody id="techRows"><tr class="empty-row"><td colspan="8">Loading…</td></tr></tbody>
        </table>
      </div>
    </div>

    <div class="modal-overlay" id="techModal">
      <div class="modal-box">
        <div class="modal-head"><h3 id="techModalTitle">Add Technician</h3><button class="modal-close" data-close>&times;</button></div>
        <div class="modal-body">
          <form id="techForm">
            <input type="hidden" id="techId">
            <div class="form-grid">
              <div class="field full"><label>Full Name *</label><input type="text" id="techName" required></div>
              <div class="field"><label>Phone *</label><input type="text" id="techPhone" required></div>
              <div class="field"><label>Experience (years)</label><input type="number" step="0.5" min="0" id="techExp" value="0"></div>
              <div class="field full"><label>Specialization</label><input type="text" id="techSpec" placeholder="e.g. Laptop & Desktop Repair"></div>
              <div class="field"><label>Status</label>
                <select id="techStatus"><option value="Active">Active</option><option value="Inactive">Inactive</option></select>
              </div>
              ${currentUser.role === 'admin' ? `
                <div class="field full" id="techLinkedUserWrap">
                  <label>Linked Login Account</label>
                  <select id="techUserId"><option value="">None</option></select>
                  <p class="muted" style="font-size:11.5px; margin-top:4px;">
                    Linking a technician-role login here is what lets that person see their own jobs on the Technician dashboard.
                  </p>
                </div>` : ''}
            </div>
          </form>
        </div>
        <div class="modal-foot">
          <button class="btn btn-outline" data-close>Cancel</button>
          <button class="btn btn-primary" id="saveTechBtn">Save Technician</button>
        </div>
      </div>
    </div>
  `;

  document.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', closeModals));
  document.getElementById('addTechBtn').addEventListener('click', () => openTechModal());
  document.getElementById('saveTechBtn').addEventListener('click', saveTechnician);

  loadTechnicians();
}

function closeModals() { document.querySelectorAll('.modal-overlay').forEach(m => m.classList.remove('open')); }

async function loadTechnicians() {
  const tbody = document.getElementById('techRows');
  try {
    allTechnicians = await Api.get('/technicians');
    if (allTechnicians.length === 0) {
      tbody.innerHTML = `<tr class="empty-row"><td colspan="8">No technicians yet.</td></tr>`;
      return;
    }
    tbody.innerHTML = allTechnicians.map(t => `
      <tr>
        <td><b>${escapeHtml(t.name)}</b></td>
        <td>${escapeHtml(t.phone)}</td>
        <td>${escapeHtml(t.specialization || '—')}</td>
        <td>${t.experience_years} yrs</td>
        <td>${pill(t.status)}</td>
        <td>${t.total_jobs}</td>
        <td>${t.open_jobs}</td>
        <td class="table-actions">
          <button class="btn btn-sm btn-outline" onclick="openTechModal(${t.id})">Edit</button>
          ${currentUser.role === 'admin' ? `<button class="btn btn-sm btn-danger" onclick="deleteTechnician(${t.id})">Delete</button>` : ''}
        </td>
      </tr>`).join('');
  } catch (err) {
    tbody.innerHTML = `<tr class="empty-row"><td colspan="8">Error: ${escapeHtml(err.message)}</td></tr>`;
  }
}

function openTechModal(id) {
  document.getElementById('techForm').reset();
  document.getElementById('techId').value = id || '';
  document.getElementById('techModalTitle').textContent = id ? 'Edit Technician' : 'Add Technician';

  let currentLinkedUser = null;
  if (id) {
    const t = allTechnicians.find(x => x.id === id);
    if (t) {
      document.getElementById('techName').value = t.name;
      document.getElementById('techPhone').value = t.phone;
      document.getElementById('techExp').value = t.experience_years;
      document.getElementById('techSpec').value = t.specialization || '';
      document.getElementById('techStatus').value = t.status;
      if (t.user_id) currentLinkedUser = { id: t.user_id, name: t.user_name, email: t.user_email };
    }
  } else {
    document.getElementById('techExp').value = 0;
    document.getElementById('techStatus').value = 'Active';
  }
  if (currentUser.role === 'admin') loadLinkableUsers(currentLinkedUser);
  document.getElementById('techModal').classList.add('open');
}

// Populates the "Linked Login Account" dropdown with technician-role users
// who aren't linked to a technician profile yet, plus (when editing) the
// one already linked to this technician so the current selection is shown.
async function loadLinkableUsers(currentLinkedUser) {
  const select = document.getElementById('techUserId');
  select.innerHTML = `<option value="">Loading…</option>`;
  try {
    const unlinked = await Api.get('/technicians/unlinked-users');
    const options = [...unlinked];
    if (currentLinkedUser && !options.some(u => u.id === currentLinkedUser.id)) {
      options.unshift(currentLinkedUser);
    }
    select.innerHTML = `<option value="">None</option>` +
      options.map(u => `<option value="${u.id}" ${currentLinkedUser && u.id === currentLinkedUser.id ? 'selected' : ''}>${escapeHtml(u.name)} (${escapeHtml(u.email)})</option>`).join('');
  } catch (err) {
    select.innerHTML = `<option value="">None</option>`;
  }
}

async function saveTechnician() {
  const id = document.getElementById('techId').value;
  const payload = {
    name: document.getElementById('techName').value.trim(),
    phone: document.getElementById('techPhone').value.trim(),
    experience_years: Number(document.getElementById('techExp').value || 0),
    specialization: document.getElementById('techSpec').value.trim(),
    status: document.getElementById('techStatus').value
  };
  if (currentUser.role === 'admin') {
    const userIdVal = document.getElementById('techUserId').value;
    payload.user_id = userIdVal || null;
  }
  if (!payload.name || !payload.phone) {
    toast('Name and phone are required.', 'error');
    return;
  }
  try {
    if (id) {
      await Api.put(`/technicians/${id}`, payload);
      toast('Technician updated.');
    } else {
      await Api.post('/technicians', payload);
      toast('Technician added.');
    }
    closeModals();
    loadTechnicians();
  } catch (err) {
    toast(err.message, 'error');
  }
}

function deleteTechnician(id) {
  confirmAction('Delete this technician? Tickets assigned to them will keep their history but lose the assignment.', async () => {
    try {
      await Api.del(`/technicians/${id}`);
      toast('Technician deleted.');
      loadTechnicians();
    } catch (err) {
      toast(err.message, 'error');
    }
  });
}
