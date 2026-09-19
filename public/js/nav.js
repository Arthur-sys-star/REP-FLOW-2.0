/* Rep-Flow — shared app shell (sidebar + topbar), built per-page based on role */

const NAV_ITEMS = [
  { href: 'dashboard.html',    label: 'Dashboard',       icon: '&#9632;', roles: ['admin', 'staff', 'technician'] },
  { href: 'customers.html',    label: 'Customers',       icon: '&#9782;', roles: ['admin', 'staff'] },
  { href: 'tickets.html',      label: 'Repair Tickets',  icon: '&#9998;', roles: ['admin', 'staff', 'technician'] },
  { href: 'technicians.html',  label: 'Technicians',     icon: '&#9881;', roles: ['admin', 'staff'] },
  { href: 'inventory.html',    label: 'Inventory',       icon: '&#9733;', roles: ['admin', 'staff'] },
  { href: 'billing.html',      label: 'Billing / Invoices', icon: '&#8377;', roles: ['admin', 'staff'] },
  { href: 'reports.html',      label: 'Reports',         icon: '&#128202;', roles: ['admin'] },
  { href: 'payment-settings.html', label: 'Payment Settings', icon: '&#128179;', roles: ['admin'] },
  { href: 'audit-log.html',    label: 'Activity Log',    icon: '&#128220;', roles: ['admin'] },
  { href: 'users.html',        label: 'Users',           icon: '&#128100;', roles: ['admin'] }
];

function renderShell(pageTitle) {
  const user = Auth.requirePage();
  if (!user) return null;

  const currentPage = window.location.pathname.split('/').pop() || 'dashboard.html';
  const visibleItems = NAV_ITEMS.filter(item => item.roles.includes(user.role));
  const canSearch = user.role !== 'technician'; // technicians get a narrower, ticket-only search

  const navHtml = visibleItems.map(item => `
    <li><a href="${item.href}" class="${item.href === currentPage ? 'active' : ''}">
      <span class="nav-icon">${item.icon}</span> ${item.label}
    </a></li>
  `).join('');

  const shell = document.createElement('div');
  shell.className = 'app-shell';
  shell.innerHTML = `
    <aside class="sidebar" id="sidebar">
      <div class="brand">
        <div class="logo-mark">RF</div>
        <div class="brand-text"><b>Rep-Flow</b><span>Repair & Service Mgmt</span></div>
      </div>
      <ul class="nav-list">${navHtml}</ul>
      <div class="sidebar-footer">
        <div class="user-chip">
          <div class="avatar">${initials(user.name)}</div>
          <div class="who"><b>${escapeHtml(user.name)}</b><span>${escapeHtml(user.role)}</span></div>
        </div>
        <button class="btn btn-outline btn-block btn-sm" id="logoutBtn">Log out</button>
      </div>
    </aside>
    <div class="main-area">
      <header class="topbar">
        <div style="display:flex; align-items:center; gap:10px; flex:1; min-width:0;">
          <button class="menu-toggle" id="menuToggle">&#9776;</button>
          <h2>${escapeHtml(pageTitle)}</h2>
          ${canSearch ? `
            <div class="global-search">
              <input type="text" id="globalSearchInput" placeholder="Search tickets, customers, invoices, parts…">
              <div class="global-search-results" id="globalSearchResults"></div>
            </div>` : ''}
        </div>
        <div class="top-right">
          <div class="notif-bell-wrap">
            <button class="notif-bell" id="notifBell">&#128276;<span class="notif-dot" id="notifDot" style="display:none;"></span></button>
            <div class="notif-dropdown" id="notifDropdown"></div>
          </div>
          <span class="pill pill-${user.role}">${escapeHtml(user.role)}</span>
        </div>
      </header>
      <main class="page-body" id="pageBody"></main>
    </div>
  `;
  document.body.prepend(shell);

  document.getElementById('logoutBtn').addEventListener('click', () => Auth.logout());
  document.getElementById('menuToggle').addEventListener('click', () => {
    document.getElementById('sidebar').classList.toggle('open');
  });

  initNotifications();
  if (canSearch) initGlobalSearch();

  return user;
}

/* ---------------- Notifications ---------------- */
async function initNotifications() {
  const bell = document.getElementById('notifBell');
  const dropdown = document.getElementById('notifDropdown');
  const dot = document.getElementById('notifDot');

  try {
    const items = await Api.get('/notifications');
    dot.style.display = items.length ? 'block' : 'none';
    dropdown.innerHTML = items.length
      ? items.map(n => `<a href="${n.link}" class="notif-item notif-${n.type}">${escapeHtml(n.message)}</a>`).join('')
      : `<div class="notif-empty">You're all caught up.</div>`;
  } catch (err) {
    dropdown.innerHTML = `<div class="notif-empty">Could not load notifications.</div>`;
  }

  bell.addEventListener('click', (e) => {
    e.stopPropagation();
    dropdown.classList.toggle('open');
  });
  document.addEventListener('click', () => dropdown.classList.remove('open'));
}

/* ---------------- Global search ---------------- */
function initGlobalSearch() {
  const input = document.getElementById('globalSearchInput');
  const results = document.getElementById('globalSearchResults');
  let timer;

  input.addEventListener('input', () => {
    clearTimeout(timer);
    const q = input.value.trim();
    if (q.length < 2) { results.classList.remove('open'); return; }
    timer = setTimeout(async () => {
      try {
        const data = await Api.get(`/search?q=${encodeURIComponent(q)}`);
        renderSearchResults(data);
      } catch (err) { /* fail silently — search is a convenience, not critical */ }
    }, 250);
  });

  input.addEventListener('focus', () => { if (input.value.trim().length >= 2) results.classList.add('open'); });
  document.addEventListener('click', (e) => { if (!e.target.closest('.global-search')) results.classList.remove('open'); });

  function renderSearchResults(data) {
    const groups = [
      { title: 'Tickets', items: data.tickets.map(t => ({ label: `${t.ticket_number} — ${escapeHtml(t.brand)} ${escapeHtml(t.device_type)}`, href: `tickets.html?open=${t.id}` })) },
      { title: 'Customers', items: data.customers.map(c => ({ label: `${escapeHtml(c.name)} — ${escapeHtml(c.phone)}`, href: `customers.html?open=${c.id}` })) },
      { title: 'Invoices', items: data.invoices.map(i => ({ label: `${i.invoice_number} — ${formatCurrency(i.total_amount)}`, href: `billing.html?open=${i.id}` })) },
      { title: 'Parts', items: data.parts.map(p => ({ label: `${escapeHtml(p.name)} (${escapeHtml(p.sku)})`, href: `inventory.html` })) },
      { title: 'Technicians', items: data.technicians.map(t => ({ label: escapeHtml(t.name), href: `technicians.html` })) }
    ].filter(g => g.items.length);

    results.innerHTML = groups.length
      ? groups.map(g => `
          <div class="search-group-title">${g.title}</div>
          ${g.items.map(i => `<a href="${i.href}" class="search-result-item">${i.label}</a>`).join('')}
        `).join('')
      : `<div class="notif-empty">No matches found.</div>`;
    results.classList.add('open');
  }
}
