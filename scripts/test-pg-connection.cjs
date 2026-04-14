#!/usr/bin/env node
const { Client } = require('pg');

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('Set DATABASE_URL env var before running');
  process.exit(1);
}

(async () => {
  const client = new Client({ connectionString, ssl: { rejectUnauthorized: false } });
  try {
    await client.connect();
    const { rows } = await client.query('SELECT version(), current_database(), current_user');
    console.log('✅ Connected to Supabase');
    console.log(rows[0]);
  } catch (err) {
    console.error('❌ Connection failed:', err.message);
    process.exit(1);
  } finally {
    await client.end();
  }
})();
