/* Rep-Flow — login page logic */

// If already logged in, skip straight to the dashboard.
if (Auth.getToken() && Auth.getUser()) {
  window.location.href = 'dashboard.html';
}

const roleHints = {
  admin: 'Demo credentials (created via <code>npm run seed</code>):<br><b>Admin:</b> admin@repflow.com / Admin@123',
  staff: 'Demo credentials (created via <code>npm run seed</code>):<br><b>Staff:</b> staff@repflow.com / Staff@123',
  technician: 'Demo credentials (created via <code>npm run seed</code>):<br><b>Technician:</b> technician@repflow.com / Tech@123'
};

document.querySelectorAll('#roleTabs button').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('#roleTabs button').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('demoHint').innerHTML = roleHints[btn.dataset.role];
  });
});

const form = document.getElementById('loginForm');
const errorBox = document.getElementById('loginError');
const loginBtn = document.getElementById('loginBtn');

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  errorBox.style.display = 'none';

  const email = document.getElementById('email').value.trim();
  const password = document.getElementById('password').value;

  loginBtn.disabled = true;
  loginBtn.textContent = 'Logging in...';

  try {
    const data = await Api.post('/auth/login', { email, password });
    Auth.setSession(data.token, data.user);
    window.location.href = 'dashboard.html';
  } catch (err) {
    errorBox.textContent = err.message || 'Login failed. Please try again.';
    errorBox.style.display = 'block';
  } finally {
    loginBtn.disabled = false;
    loginBtn.textContent = 'Log in';
  }
});
