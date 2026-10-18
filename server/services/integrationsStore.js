// Per-workspace integration credentials (I5.2/I5.3). Secrets live only here, encrypted.
const { q } = require('../db/index');
const { encrypt, decrypt } = require('../utils/crypto');

/** → decrypted config object, or null when not connected. */
async function getConfig(ws, provider, client) {
  const r = await q(client).query(
    `SELECT config_enc FROM integrations WHERE workspace_id = $1 AND provider = $2 AND config_enc IS NOT NULL`,
    [ws, provider],
  );
  if (!r.rows[0]) return null;
  try { return decrypt(r.rows[0].config_enc); } catch (e) { console.error('[integrations] decrypt failed', e.message); return null; }
}

async function saveConfig(ws, provider, config, hint, userId, client) {
  await q(client).query(
    `INSERT INTO integrations (workspace_id, provider, status, config_enc, config_hint, updated_by, last_ok_at, last_error, updated_at)
     VALUES ($1,$2,'connected',$3,$4,$5, now(), NULL, now())
     ON CONFLICT (workspace_id, provider) DO UPDATE SET status='connected', config_enc=EXCLUDED.config_enc,
       config_hint=EXCLUDED.config_hint, updated_by=EXCLUDED.updated_by, last_ok_at=now(), last_error=NULL, updated_at=now()`,
    [ws, provider, encrypt(config), JSON.stringify(hint || {}), userId],
  );
}

async function removeConfig(ws, provider, client) {
  await q(client).query(
    `UPDATE integrations SET status='not_connected', config_enc=NULL, config_hint='{}', updated_at=now() WHERE workspace_id=$1 AND provider=$2`,
    [ws, provider],
  );
}

async function markOk(ws, provider) {
  try {
    await q().query(
      `INSERT INTO integrations (workspace_id, provider, status, last_ok_at) VALUES ($1,$2,'connected',now())
       ON CONFLICT (workspace_id, provider) DO UPDATE SET last_ok_at = now(),
         status = CASE WHEN integrations.config_enc IS NULL AND integrations.provider <> 'google' THEN integrations.status ELSE 'connected' END`,
      [ws, provider],
    );
  } catch (e) { console.error('[integrations.markOk]', e.message); }
}

async function markError(ws, provider, message) {
  try {
    await q().query(
      `INSERT INTO integrations (workspace_id, provider, status, last_error, last_error_at) VALUES ($1,$2,'error',$3,now())
       ON CONFLICT (workspace_id, provider) DO UPDATE SET status='error', last_error=$3, last_error_at=now()`,
      [ws, provider, String(message || 'Unknown error').slice(0, 500)],
    );
  } catch (e) { console.error('[integrations.markError]', e.message); }
}

module.exports = { getConfig, saveConfig, removeConfig, markOk, markError };
