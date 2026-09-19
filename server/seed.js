// Creates demo login accounts (and a couple of sample customers/technicians)
// with properly bcrypt-hashed passwords. Run once after importing schema.sql:
//   npm run seed
require('dotenv').config();
const bcrypt = require('bcryptjs');
const pool = require('./config/db');

const demoUsers = [
  { name: 'Admin User', email: 'admin@repflow.com', role: 'admin', password: process.env.SEED_ADMIN_PASSWORD || 'Admin@123' },
  { name: 'Staff User', email: 'staff@repflow.com', role: 'staff', password: process.env.SEED_STAFF_PASSWORD || 'Staff@123' },
  { name: 'Rahul Verma', email: 'technician@repflow.com', role: 'technician', password: process.env.SEED_TECH_PASSWORD || 'Tech@123' }
];

async function seed() {
  console.log('Seeding Rep-Flow demo data...');

  for (const u of demoUsers) {
    const [existing] = await pool.query('SELECT id FROM users WHERE email = ?', [u.email]);
    if (existing.length > 0) {
      console.log(`  - Skipping ${u.email} (already exists)`);
      continue;
    }
    const hash = await bcrypt.hash(u.password, 10);
    await pool.query(
      'INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)',
      [u.name, u.email, hash, u.role]
    );
    console.log(`  ✔ Created ${u.role} login: ${u.email} / ${u.password}`);
  }

  // Link the technician demo login to a technicians row (for job assignment)
  const [[techUser]] = await pool.query('SELECT id FROM users WHERE email = ?', ['technician@repflow.com']);
  if (techUser) {
    const [existingTech] = await pool.query('SELECT id FROM technicians WHERE user_id = ?', [techUser.id]);
    if (existingTech.length === 0) {
      await pool.query(
        `INSERT INTO technicians (user_id, name, phone, specialization, experience_years, status)
         VALUES (?, 'Rahul Verma', '9876543210', 'Laptop & Desktop Repair', 3.5, 'Active')`,
        [techUser.id]
      );
      console.log('  ✔ Linked technician profile for Rahul Verma');
    }
  }

  // A second technician with no login, purely for demo variety
  const [existingTech2] = await pool.query('SELECT id FROM technicians WHERE name = ?', ['Sana Sheikh']);
  if (existingTech2.length === 0) {
    await pool.query(
      `INSERT INTO technicians (name, phone, specialization, experience_years, status)
       VALUES ('Sana Sheikh', '9123456780', 'Mobile & Tablet Repair', 2.0, 'Active')`
    );
    console.log('  ✔ Added technician Sana Sheikh');
  }

  // One sample customer so the app isn't empty on first run
  const [existingCustomer] = await pool.query('SELECT id FROM customers WHERE phone = ?', ['9000011111']);
  if (existingCustomer.length === 0) {
    await pool.query(
      `INSERT INTO customers (name, phone, email, address)
       VALUES ('Ankit Sharma', '9000011111', 'ankit.sharma@example.com', 'Andheri West, Mumbai')`
    );
    console.log('  ✔ Added sample customer Ankit Sharma');
  }

  console.log('\nSeeding complete. Demo credentials:');
  demoUsers.forEach(u => console.log(`  ${u.role.padEnd(11)} ${u.email} / ${u.password}`));

  await pool.end();
}

seed().catch(err => {
  console.error('Seeding failed:', err.message);
  process.exit(1);
});
