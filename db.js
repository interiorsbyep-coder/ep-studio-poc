const { Pool } = require('pg');

if (!process.env.DATABASE_URL) {
  console.warn('WARNING: DATABASE_URL is not set. Database-backed routes will fail until it is.');
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('localhost')
    ? false
    : { rejectUnauthorized: false }
});

module.exports = pool;
