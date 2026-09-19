require('dotenv').config();
const app = require('./app');
const pool = require('./config/db');

const PORT = process.env.PORT || 5000;

async function start() {
  try {
    // Fail fast with a clear message if MySQL isn't reachable.
    const conn = await pool.getConnection();
    console.log('✔ Connected to MySQL database:', process.env.DB_NAME);
    conn.release();
  } catch (err) {
    console.error('✘ Could not connect to MySQL. Check your .env settings and that MySQL is running.');
    console.error(err.message);
    process.exit(1);
  }

  app.listen(PORT, () => {
    console.log(`✔ Rep-Flow server running at http://localhost:${PORT}`);
  });
}

start();
