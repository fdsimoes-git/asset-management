const { Pool } = require('pg');

if (!process.env.PGUSER) {
    console.error('FATAL: PGUSER must be set.');
    process.exit(1);
}
if (process.env.PGPASSWORD === undefined) {
    console.error('FATAL: PGPASSWORD must be set (can be empty for local trust auth).');
    process.exit(1);
}

const pool = new Pool({
    host:     process.env.PGHOST     || 'localhost',
    port:     parseInt(process.env.PGPORT || '5432', 10),
    database: process.env.PGDATABASE || 'asset_management',
    user:     process.env.PGUSER,
    password: process.env.PGPASSWORD,
    max:                10,
    idleTimeoutMillis:  30000,
    connectionTimeoutMillis: 5000,
    ssl:                false
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
