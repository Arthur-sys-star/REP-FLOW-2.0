/* Rep-Flow — Users (Admin only) */

const currentUser = renderShell('Users');
let allUsers = [];

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
      <div class="spacer"></div>
      <button class="btn btn-primary" id="addUserBtn">+ Add User</button>
    </div>
    <div class="card">
      <div class="table-wrap">
        <table>
          <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th>Created</th><th></th></tr></thead>
          <tbody id="userRows"><tr class="empty-row"><td colspan="6">Loading…</td></tr></tbody>
        </table>
      </div>
    </div>

    <div class="modal-overlay" id="userModal">
      <div class="modal-box">
        <div class="modal-head"><h3 id="userModalTitle">Add User</h3><button class="modal-close" data-close>&times;</button></div>
        <div class="modal-body">
          <form id="userForm">
            <input type="hidden" id="userId">
            <div class="form-grid">
              <div class="field full"><label>Full Name *</label><input type="text" id="userName" required></div>
              <div class="field full"><label>Email *</label><input type="email" id="userEmail" required></div>
              <div class="field" id="passwordField"><label>Password *</label><input type="password" id="userPassword" placeholder="min. 6 characters"></div>
              <div class="field"><label>Role *</label>
                <select id="userRole"><option value="staff">Staff</option><option value="admin">Admin</option><option value="technician">Technician</option></select>
              </div>
              <div class="field" id="activeField" style="display:none;">
                <label>Status</label>
                <select id="userActive"><option value="1">Active</option><option value="0">Inactive</option></select>
              </div>
            </div>
          </form>
        </div>
        <div class="modal-foot">
          <button class="btn btn-outline" data-close>Cancel</button>
          <button class="btn btn-primary" id="saveUserBtn">Save User</button>
        </div>
      </div>
    </div>

    <div class="modal-overlay" id="resetPwModal">
      <div class="modal-box" style="max-width:400px">
        <div class="modal-head"><h3>Reset Password</h3><button class="modal-close" data-close>&times;</button></div>
        <div class="modal-body">
          <input type="hidden" id="resetUserId">
          <div class="field"><label>New Password *</label><input type="password" id="newPassword" placeholder="min. 6 characters"></div>
        </div>
        <div class="modal-foot">
          <button class="btn btn-outline" data-close>Cancel</button>
          <button class="btn btn-primary" id="saveResetBtn">Update Password</button>
        </div>
      </div>
    </div>
  `;

  document.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', closeModals));
  document.getElementById('addUserBtn').addEventListener('click', () => openUserModal());
  document.getElementById('saveUserBtn').addEventListener('click', saveUser);
  document.getElementById('saveResetBtn').addEventListener('click', savePasswordReset);

  loadUsers();
}

function closeModals() { document.querySelectorAll('.modal-overlay').forEach(m => m.classList.remove('open')); }

async function loadUsers() {
  const tbody = document.getElementById('userRows');
  try {
    allUsers = await Api.get('/users');
    if (allUsers.length === 0) {
      tbody.innerHTML = `<tr class="empty-row"><td colspan="6">No users found.</td></tr>`;
      return;
    }
    tbody.innerHTML = allUsers.map(u => `
      <tr>
        <td><b>${escapeHtml(u.name)}</b></td>
        <td>${escapeHtml(u.email)}</td>
        <td><span class="pill pill-${u.role}">${escapeHtml(u.role)}</span></td>
        <td>${u.is_active ? pill('Active') : pill('Inactive')}</td>
        <td>${formatDate(u.created_at)}</td>
        <td class="table-actions">
          <button class="btn btn-sm btn-outline" onclick="openUserModal(${u.id})">Edit</button>
          <button class="btn btn-sm btn-outline" onclick="openResetModal(${u.id})">Reset Password</button>
          ${u.id !== currentUser.id ? `<button class="btn btn-sm btn-danger" onclick="deleteUser(${u.id})">Delete</button>` : ''}
        </td>
      </tr>`).join('');
  } catch (err) {
    tbody.innerHTML = `<tr class="empty-row"><td colspan="6">Error: ${escapeHtml(err.message)}</td></tr>`;
  }
}

function openUserModal(id) {
  document.getElementById('userForm').reset();
  document.getElementById('userId').value = id || '';
  document.getElementById('userModalTitle').textContent = id ? 'Edit User' : 'Add User';
  document.getElementById('passwordField').style.display = id ? 'none' : 'block';
  document.getElementById('activeField').style.display = id ? 'block' : 'none';
  document.getElementById('userPassword').required = !id;

  if (id) {
    const u = allUsers.find(x => x.id === id);
    if (u) {
      document.getElementById('userName').value = u.name;
      document.getElementById('userEmail').value = u.email;
      document.getElementById('userRole').value = u.role;
      document.getElementById('userActive').value = u.is_active ? '1' : '0';
    }
  }
  document.getElementById('userModal').classList.add('open');
}

async function saveUser() {
  const id = document.getElementById('userId').value;
  const name = document.getElementById('userName').value.trim();
  const email = document.getElementById('userEmail').value.trim();
  const role = document.getElementById('userRole').value;

  if (!name || !email) {
    toast('Name and email are required.', 'error');
    return;
  }

  try {
    if (id) {
      const is_active = document.getElementById('userActive').value === '1';
      await Api.put(`/users/${id}`, { name, email, role, is_active });
      toast('User updated.');
    } else {
      const password = document.getElementById('userPassword').value;
      if (!password || password.length < 6) {
        toast('Password must be at least 6 characters.', 'error');
        return;
      }
      await Api.post('/users', { name, email, password, role });
      toast('User created.');
    }
    closeModals();
    loadUsers();
  } catch (err) {
    toast(err.message, 'error');
  }
}

function openResetModal(id) {
  document.getElementById('resetUserId').value = id;
  document.getElementById('newPassword').value = '';
  document.getElementById('resetPwModal').classList.add('open');
}

async function savePasswordReset() {
  const id = document.getElementById('resetUserId').value;
  const password = document.getElementById('newPassword').value;
  if (!password || password.length < 6) {
    toast('Password must be at least 6 characters.', 'error');
    return;
  }
  try {
    await Api.put(`/users/${id}/password`, { password });
    toast('Password updated.');
    closeModals();
  } catch (err) {
    toast(err.message, 'error');
  }
}

function deleteUser(id) {
  confirmAction('Delete this user account? This cannot be undone.', async () => {
    try {
      await Api.del(`/users/${id}`);
      toast('User deleted.');
      loadUsers();
    } catch (err) {
      toast(err.message, 'error');
    }
  });
}
