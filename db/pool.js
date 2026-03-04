const { Pool } = require('pg');

const pool = new Pool({
    host:     process.env.PGHOST     || 'localhost',
    port:     parseInt(process.env.PGPORT || '5432', 10),
    database: process.env.PGDATABASE || 'asset_management',
    user:     process.env.PGUSER,
    password: process.env.PGPASSWORD,
    max:              5,
    idleTimeoutMillis: 30000,
    ssl:              false
});

pool.on('error', (err) => {
    console.error('Unexpected PostgreSQL pool error:', err.message);
});

async function testConnection() {
    const client = await pool.connect();
    try {
        await client.query('SELECT 1');
        console.log('PostgreSQL connection verified.');
    } finally {
        client.release();
    }
}

module.exports = { pool, testConnection };
