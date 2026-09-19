const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const { notFound, errorHandler } = require('./middleware/errorHandler');

const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const customerRoutes = require('./routes/customers');
const technicianRoutes = require('./routes/technicians');
const inventoryRoutes = require('./routes/inventory');
const ticketRoutes = require('./routes/tickets');
const handoverRoutes = require('./routes/handover');
const billingRoutes = require('./routes/billing');
const paymentRoutes = require('./routes/payments');
const paymentSettingsRoutes = require('./routes/paymentSettings');
const reportRoutes = require('./routes/reports');
const dashboardRoutes = require('./routes/dashboard');
const notificationRoutes = require('./routes/notifications');
const searchRoutes = require('./routes/search');
const auditLogRoutes = require('./routes/auditLogs');

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ---- API routes ----
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/customers', customerRoutes);
app.use('/api/technicians', technicianRoutes);
app.use('/api/inventory', inventoryRoutes);
app.use('/api/tickets', ticketRoutes);
app.use('/api/tickets', handoverRoutes); // adds /:ticketId/handover* onto the same /api/tickets prefix
app.use('/api/billing', billingRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/payment-settings', paymentSettingsRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/search', searchRoutes);
app.use('/api/audit-logs', auditLogRoutes);

app.get('/api/health', (req, res) => res.json({ status: 'ok', service: 'Rep-Flow API' }));

// ---- Serve the vanilla JS frontend ----
app.use(express.static(path.join(__dirname, '..', 'public')));

// Any non-API route falls back to the frontend (so direct URL access to
// e.g. /dashboard.html works, and unknown paths land on the login page).
app.get('*', (req, res, next) => {
  if (req.originalUrl.startsWith('/api/')) return next();
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

app.use('/api', notFound);
app.use(errorHandler);

module.exports = app;
