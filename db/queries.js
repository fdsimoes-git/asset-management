const { pool } = require('./pool');

// ── Helpers ──────────────────────────────────────────────────────────

/**
 * Convert a snake_case DB row to a camelCase JS user object.
 * JSON-parses encrypted TEXT fields back to {iv, encryptedData} objects.
 */
function dbRowToUser(row) {
    if (!row) return null;
    const user = {
        id:              Number(row.id),
        username:        row.username,
        passwordHash:    row.password_hash,
        role:            row.role,
        email:           parseJsonField(row.email),
        geminiApiKey:    parseJsonField(row.gemini_api_key),
        openaiApiKey:    parseJsonField(row.openai_api_key),
        anthropicApiKey: parseJsonField(row.anthropic_api_key),
        claudeOauthToken: parseJsonField(row.claude_oauth_token),
        githubCopilotToken: parseJsonField(row.github_copilot_token),
        totpSecret:      parseJsonField(row.totp_secret),
        totpEnabled:     row.totp_enabled,
        backupCodes:     row.backup_codes || [],
        aiProvider:      row.ai_provider,
        aiModel:         row.ai_model,
        partnerId:       row.partner_id != null ? Number(row.partner_id) : null,
        partnerLinkedAt: row.partner_linked_at ? row.partner_linked_at.toISOString() : null,
        isActive:        row.is_active,
        createdAt:       row.created_at ? row.created_at.toISOString() : null,
        updatedAt:       row.updated_at ? row.updated_at.toISOString() : null
    };
    return user;
}

function dbRowToEntry(row) {
    if (!row) return null;
    return {
        id:              Number(row.id),
        userId:          Number(row.user_id),
        month:           row.month,
        type:            row.type,
        amount:          parseFloat(row.amount),
        description:     row.description,
        tags:            row.tags || [],
        isCoupleExpense: row.is_couple_expense,
        createdAt:       row.created_at ? row.created_at.toISOString() : null,
        updatedAt:       row.updated_at ? row.updated_at.toISOString() : null
    };
}

function parseJsonField(val) {
    if (val == null) return null;
    if (typeof val === 'object') return val;
    try {
        return JSON.parse(val);
    } catch (err) {
        console.error('Failed to parse JSON field:', err.message, '— value preview:', String(val).slice(0, 50));
        return null;
    }
}

function stringifyJsonField(val) {
    if (val == null) return null;
    if (typeof val === 'string') return val;
    return JSON.stringify(val);
}

// ── User Queries ─────────────────────────────────────────────────────

async function findUserByUsername(username) {
    const { rows } = await pool.query(
        'SELECT * FROM users WHERE LOWER(username) = LOWER($1)',
        [username]
    );
    return dbRowToUser(rows[0]);
}

async function findUserById(id) {
    try {
        const { rows } = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
        return dbRowToUser(rows[0]);
    } catch (err) {
        console.error(`DB findUserById failed: id=${id} — ${err.message}`);
        throw err;
    }
}

async function getAllUsers() {
    const { rows } = await pool.query('SELECT * FROM users ORDER BY id');
    return rows.map(dbRowToUser);
}

async function getEntriesCountByUser() {
    const { rows } = await pool.query(
        'SELECT user_id, COUNT(*)::int AS count FROM entries GROUP BY user_id'
    );
    const map = {};
    for (const row of rows) map[Number(row.user_id)] = row.count;
    return map;
}

async function createUser(fields) {
    const { rows } = await pool.query(
        `INSERT INTO users (username, password_hash, role, email, gemini_api_key, openai_api_key,
         anthropic_api_key, claude_oauth_token, github_copilot_token, totp_secret, totp_enabled, backup_codes, ai_provider, ai_model,
         partner_id, partner_linked_at, is_active, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) RETURNING *`,
        [
            fields.username,
            fields.passwordHash,
            fields.role || 'user',
            stringifyJsonField(fields.email),
            stringifyJsonField(fields.geminiApiKey),
            stringifyJsonField(fields.openaiApiKey),
            stringifyJsonField(fields.anthropicApiKey),
            stringifyJsonField(fields.claudeOauthToken),
            stringifyJsonField(fields.githubCopilotToken),
            stringifyJsonField(fields.totpSecret),
            fields.totpEnabled || false,
            fields.backupCodes || [],
            fields.aiProvider || null,
            fields.aiModel || null,
            fields.partnerId || null,
            fields.partnerLinkedAt || null,
            fields.isActive !== undefined ? fields.isActive : true,
            fields.createdAt || new Date().toISOString(),
            fields.updatedAt || new Date().toISOString()
        ]
    );
    return dbRowToUser(rows[0]);
}

async function registerWithInviteCode(inviteCode, userFields) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        // Atomically consume the invite code
        const { rowCount } = await client.query(
            `UPDATE invite_codes SET is_used = TRUE, used_at = NOW()
             WHERE code = $1 AND is_used = FALSE`,
            [inviteCode.toUpperCase()]
        );
        if (rowCount === 0) {
            await client.query('ROLLBACK');
            return null;
        }
        // Create the user
        const { rows } = await client.query(
            `INSERT INTO users (username, password_hash, role, email, totp_secret, totp_enabled, backup_codes, is_active)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
            [
                userFields.username,
                userFields.passwordHash,
                userFields.role || 'user',
                stringifyJsonField(userFields.email),
                stringifyJsonField(userFields.totpSecret),
                userFields.totpEnabled || false,
                userFields.backupCodes || [],
                userFields.isActive !== undefined ? userFields.isActive : true
            ]
        );
        const newUser = dbRowToUser(rows[0]);
        // Set used_by on the invite code
        await client.query(
            'UPDATE invite_codes SET used_by = $1 WHERE code = $2',
            [newUser.id, inviteCode.toUpperCase()]
        );
        await client.query('COMMIT');
        return newUser;
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
}

// Column allowlist for dynamic SET
const USER_COLUMN_MAP = {
    username:        'username',
    passwordHash:    'password_hash',
    role:            'role',
    email:           { col: 'email',             json: true },
    geminiApiKey:    { col: 'gemini_api_key',    json: true },
    openaiApiKey:    { col: 'openai_api_key',    json: true },
    anthropicApiKey: { col: 'anthropic_api_key', json: true },
    claudeOauthToken: { col: 'claude_oauth_token', json: true },
    githubCopilotToken: { col: 'github_copilot_token', json: true },
    totpSecret:      { col: 'totp_secret',       json: true },
    totpEnabled:     'totp_enabled',
    backupCodes:     'backup_codes',
    aiProvider:      'ai_provider',
    aiModel:         'ai_model',
    partnerId:       'partner_id',
    partnerLinkedAt: 'partner_linked_at',
    isActive:        'is_active',
    updatedAt:       'updated_at'
};

async function updateUser(userId, updates) {
    const setClauses = [];
    const values = [];
    let paramIndex = 1;

    for (const [jsKey, value] of Object.entries(updates)) {
        const mapping = USER_COLUMN_MAP[jsKey];
        if (!mapping) continue;

        let col, val;
        if (typeof mapping === 'string') {
            col = mapping;
            val = value;
        } else {
            col = mapping.col;
            val = mapping.json ? stringifyJsonField(value) : value;
        }
        setClauses.push(`${col} = $${paramIndex}`);
        values.push(val);
        paramIndex++;
    }

    if (setClauses.length === 0) return null;

    values.push(userId);
    const { rows } = await pool.query(
        `UPDATE users SET ${setClauses.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
        values
    );
    return dbRowToUser(rows[0]);
}

async function deleteUser(userId) {
    await pool.query('DELETE FROM users WHERE id = $1', [userId]);
}

async function linkCouple(id1, id2, linkedAt) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query(
            'UPDATE users SET partner_id = $1, partner_linked_at = $2, updated_at = $2 WHERE id = $3',
            [id2, linkedAt, id1]
        );
        await client.query(
            'UPDATE users SET partner_id = $1, partner_linked_at = $2, updated_at = $2 WHERE id = $3',
            [id1, linkedAt, id2]
        );
        await client.query('COMMIT');
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
}

async function unlinkCouple(userId) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        // Get partner ID first
        const { rows } = await client.query('SELECT partner_id FROM users WHERE id = $1', [userId]);
        const partnerId = rows[0]?.partner_id;

        const now = new Date().toISOString();
        await client.query(
            'UPDATE users SET partner_id = NULL, partner_linked_at = NULL, updated_at = $1 WHERE id = $2',
            [now, userId]
        );
        if (partnerId) {
            await client.query(
                'UPDATE users SET partner_id = NULL, partner_linked_at = NULL, updated_at = $1 WHERE id = $2',
                [now, partnerId]
            );
        }
        await client.query('COMMIT');
        const affected = [userId];
        if (partnerId) affected.push(Number(partnerId));
        return affected;
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
}

async function getActiveAdminCount() {
    const { rows } = await pool.query(
        "SELECT COUNT(*)::int AS count FROM users WHERE role = 'admin' AND is_active = TRUE"
    );
    return rows[0].count;
}

async function getAdminCount() {
    const { rows } = await pool.query(
        "SELECT COUNT(*)::int AS count FROM users WHERE role = 'admin'"
    );
    return rows[0].count;
}

// ── Entry Queries ────────────────────────────────────────────────────

async function getEntriesByUser(userId, month) {
    if (month) {
        const { rows } = await pool.query(
            'SELECT * FROM entries WHERE user_id = $1 AND month = $2 ORDER BY id',
            [userId, month]
        );
        return rows.map(dbRowToEntry);
    }
    const { rows } = await pool.query(
        'SELECT * FROM entries WHERE user_id = $1 ORDER BY id',
        [userId]
    );
    return rows.map(dbRowToEntry);
}

async function getCoupleEntries(userId, partnerId, month) {
    if (month) {
        const { rows } = await pool.query(
            'SELECT * FROM entries WHERE is_couple_expense = TRUE AND user_id = ANY($1) AND month = $2 ORDER BY id',
            [[userId, partnerId], month]
        );
        return rows.map(dbRowToEntry);
    }
    const { rows } = await pool.query(
        'SELECT * FROM entries WHERE is_couple_expense = TRUE AND user_id = ANY($1) ORDER BY id',
        [[userId, partnerId]]
    );
    return rows.map(dbRowToEntry);
}

async function getIndividualEntries(userId, month) {
    if (month) {
        const { rows } = await pool.query(
            'SELECT * FROM entries WHERE user_id = $1 AND is_couple_expense = FALSE AND month = $2 ORDER BY id',
            [userId, month]
        );
        return rows.map(dbRowToEntry);
    }
    const { rows } = await pool.query(
        'SELECT * FROM entries WHERE user_id = $1 AND is_couple_expense = FALSE ORDER BY id',
        [userId]
    );
    return rows.map(dbRowToEntry);
}

/**
 * "My Share" view: user's own individual (non-couple) entries + all couple
 * entries from either partner, with couple amounts divided by 2 so the total
 * reflects the user's fair share of household finances.
 *
 * The halving happens here (server-side) so callers/frontend can treat the
 * returned rows like any other entry list. Rows still carry their real `id`
 * and `userId`, and `isCoupleExpense` is preserved so the UI can decorate
 * halved rows and disable edit/delete on them.
 */
async function getMyShareEntries(userId, partnerId, month) {
    const params = month ? [userId, partnerId, month] : [userId, partnerId];
    const sql = month
        ? `SELECT * FROM entries
           WHERE month = $3
             AND (
               (user_id = $1 AND is_couple_expense = FALSE)
               OR (user_id = ANY(ARRAY[$1, $2]::bigint[]) AND is_couple_expense = TRUE)
             )
           ORDER BY id`
        : `SELECT * FROM entries
           WHERE
             (user_id = $1 AND is_couple_expense = FALSE)
             OR (user_id = ANY(ARRAY[$1, $2]::bigint[]) AND is_couple_expense = TRUE)
           ORDER BY id`;
    const { rows } = await pool.query(sql, params);
    return rows.map(row => {
        const entry = dbRowToEntry(row);
        if (entry.isCoupleExpense) {
            // Round halved amounts to cents so per-row display (rendered via
            // .toFixed(2)) and aggregate totals are always consistent. The
            // trade-off is that summing many odd-cent couple entries can
            // drift by up to 1 cent per entry vs. the mathematical half,
            // which we accept as preferable to sub-cent floats that
            // misrender in the UI (e.g. 10.01/2 = 5.005 -> "5.00" with
            // IEEE-754 rounding). Use standard half-away-from-zero.
            const halved = entry.amount / 2;
            entry.amount = Math.round((halved + Number.EPSILON) * 100) / 100;
        }
        return entry;
    });
}

async function getEntryByIdAndUser(entryId, userId) {
    const { rows } = await pool.query(
        'SELECT * FROM entries WHERE id = $1 AND user_id = $2',
        [entryId, userId]
    );
    return dbRowToEntry(rows[0]);
}

async function createEntry({ userId, month, type, amount, description, tags, isCoupleExpense }) {
    try {
        const { rows } = await pool.query(
            `INSERT INTO entries (user_id, month, type, amount, description, tags, is_couple_expense)
             VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
            [userId, month, type, amount, description, tags || [], isCoupleExpense || false]
        );
        return dbRowToEntry(rows[0]);
    } catch (err) {
        console.error(`DB createEntry failed: userId=${userId} month=${month} type=${type} amount=${amount} — ${err.message}`);
        throw err;
    }
}

const ENTRY_COL_MAP = {
    month:           'month',
    type:            'type',
    amount:          'amount',
    description:     'description',
    tags:            'tags',
    isCoupleExpense: 'is_couple_expense'
};

async function updateEntry(entryId, userId, fields) {
    const setClauses = [];
    const values = [];
    let paramIndex = 1;

    for (const [jsKey, value] of Object.entries(fields)) {
        const col = ENTRY_COL_MAP[jsKey];
        if (!col) continue;
        setClauses.push(`${col} = $${paramIndex}`);
        values.push(value);
        paramIndex++;
    }

    if (setClauses.length === 0) return null;

    setClauses.push(`updated_at = NOW()`);
    values.push(entryId, userId);
    try {
        const { rows } = await pool.query(
            `UPDATE entries SET ${setClauses.join(', ')} WHERE id = $${paramIndex} AND user_id = $${paramIndex + 1} RETURNING *`,
            values
        );
        return dbRowToEntry(rows[0]);
    } catch (err) {
        console.error(`DB updateEntry failed: entryId=${entryId} userId=${userId} — ${err.message}`);
        throw err;
    }
}

async function deleteEntry(entryId, userId) {
    try {
        const { rowCount } = await pool.query(
            'DELETE FROM entries WHERE id = $1 AND user_id = $2',
            [entryId, userId]
        );
        return rowCount > 0;
    } catch (err) {
        console.error(`DB deleteEntry failed: entryId=${entryId} userId=${userId} — ${err.message}`);
        throw err;
    }
}

// ── Invite Code Queries ──────────────────────────────────────────────

async function findInviteCode(code) {
    const { rows } = await pool.query(
        'SELECT * FROM invite_codes WHERE code = $1',
        [code.toUpperCase()]
    );
    if (!rows[0]) return null;
    const row = rows[0];
    return {
        code:      row.code,
        createdAt: row.created_at ? row.created_at.toISOString() : null,
        createdBy: row.created_by,
        isUsed:    row.is_used,
        usedAt:    row.used_at ? row.used_at.toISOString() : null,
        usedBy:    row.used_by != null ? Number(row.used_by) : null
    };
}

async function createInviteCode(code, createdBy) {
    const { rows } = await pool.query(
        'INSERT INTO invite_codes (code, created_by) VALUES ($1, $2) RETURNING *',
        [code, String(createdBy)]
    );
    const row = rows[0];
    return {
        code:      row.code,
        createdAt: row.created_at.toISOString(),
        createdBy: row.created_by,
        isUsed:    row.is_used,
        usedAt:    null,
        usedBy:    null
    };
}

async function createInviteCodeIfNotExists(code, createdBy) {
    const { rows } = await pool.query(
        'INSERT INTO invite_codes (code, created_by) VALUES ($1, $2) ON CONFLICT (code) DO NOTHING RETURNING *',
        [code, String(createdBy)]
    );
    if (!rows[0]) return null;
    const row = rows[0];
    return {
        code:      row.code,
        createdAt: row.created_at.toISOString(),
        createdBy: row.created_by,
        isUsed:    row.is_used,
        usedAt:    null,
        usedBy:    null
    };
}

async function consumeInviteCode(code, usedBy) {
    const { rowCount } = await pool.query(
        `UPDATE invite_codes SET is_used = TRUE, used_at = NOW(), used_by = $1
         WHERE code = $2 AND is_used = FALSE`,
        [usedBy, code.toUpperCase()]
    );
    return rowCount > 0;
}

async function rollbackInviteCode(code) {
    await pool.query(
        'UPDATE invite_codes SET is_used = FALSE, used_at = NULL WHERE code = $1 AND used_by IS NULL',
        [code.toUpperCase()]
    );
}

async function deleteInviteCode(code) {
    await pool.query('DELETE FROM invite_codes WHERE code = $1', [code.toUpperCase()]);
}

async function getAllInviteCodes() {
    const { rows } = await pool.query('SELECT * FROM invite_codes ORDER BY created_at DESC');
    return rows.map(row => ({
        code:      row.code,
        createdAt: row.created_at ? row.created_at.toISOString() : null,
        createdBy: row.created_by,
        isUsed:    row.is_used,
        usedAt:    row.used_at ? row.used_at.toISOString() : null,
        usedBy:    row.used_by != null ? Number(row.used_by) : null
    }));
}

// ── Couple Queries ───────────────────────────────────────────────────

async function getCouples() {
    const { rows } = await pool.query(
        `SELECT u1.id AS u1_id, u1.username AS u1_username,
                u2.id AS u2_id, u2.username AS u2_username,
                u1.partner_linked_at
         FROM users u1
         JOIN users u2 ON u1.partner_id = u2.id AND u2.partner_id = u1.id
         WHERE u1.id < u2.id
         ORDER BY u1.partner_linked_at DESC`
    );
    return rows.map(row => ({
        user1: { id: Number(row.u1_id), username: row.u1_username },
        user2: { id: Number(row.u2_id), username: row.u2_username },
        linkedAt: row.partner_linked_at ? row.partner_linked_at.toISOString() : null
    }));
}

// ── PayPal Order Queries ─────────────────────────────────────────────

function dbRowToPaypalOrder(row) {
    if (!row) return null;
    return {
        orderId:     row.order_id,
        amount:      parseFloat(row.amount),
        currency:    row.currency,
        status:      row.status,
        inviteCode:  row.invite_code,
        userId:      row.user_id != null ? Number(row.user_id) : null,
        createdAt:   row.created_at ? row.created_at.toISOString() : null,
        confirmedAt: row.confirmed_at ? row.confirmed_at.toISOString() : null
    };
}

async function createPaypalOrder({ orderId, amount, currency, status, userId }) {
    const { rows } = await pool.query(
        `INSERT INTO paypal_orders (order_id, amount, currency, status, user_id)
         VALUES ($1,$2,$3,$4,$5) RETURNING *`,
        [orderId, amount, currency || 'BRL', status, userId || null]
    );
    return dbRowToPaypalOrder(rows[0]);
}

async function findPaypalOrder(orderId) {
    const { rows } = await pool.query(
        'SELECT * FROM paypal_orders WHERE order_id = $1',
        [orderId]
    );
    return dbRowToPaypalOrder(rows[0]);
}

async function completePaypalOrder(orderId, inviteCode) {
    const { rows } = await pool.query(
        `UPDATE paypal_orders SET status = 'COMPLETED', invite_code = $1, confirmed_at = NOW()
         WHERE order_id = $2 AND invite_code IS NULL RETURNING *`,
        [inviteCode, orderId]
    );
    return dbRowToPaypalOrder(rows[0]);
}

async function updatePaypalOrderStatus(orderId, status) {
    await pool.query(
        'UPDATE paypal_orders SET status = $1 WHERE order_id = $2',
        [status, orderId]
    );
}

async function cleanupExpiredPaypalOrders(maxAgeMs) {
    await pool.query(
        `DELETE FROM paypal_orders
         WHERE status != 'COMPLETED'
           AND created_at < NOW() - ($1::bigint * INTERVAL '1 millisecond')`,
        [maxAgeMs]
    );
}

module.exports = {
    // Users
    findUserByUsername,
    findUserById,
    getAllUsers,
    getEntriesCountByUser,
    createUser,
    updateUser,
    deleteUser,
    linkCouple,
    unlinkCouple,
    getActiveAdminCount,
    getAdminCount,
    registerWithInviteCode,

    // Entries
    getEntriesByUser,
    getCoupleEntries,
    getIndividualEntries,
    getMyShareEntries,
    getEntryByIdAndUser,
    createEntry,
    updateEntry,
    deleteEntry,
    // Couples
    getCouples,

    // Invite Codes
    findInviteCode,
    createInviteCode,
    createInviteCodeIfNotExists,
    consumeInviteCode,
    rollbackInviteCode,
    deleteInviteCode,
    getAllInviteCodes,

    // PayPal Orders
    createPaypalOrder,
    findPaypalOrder,
    completePaypalOrder,
    updatePaypalOrderStatus,
    cleanupExpiredPaypalOrders
};
