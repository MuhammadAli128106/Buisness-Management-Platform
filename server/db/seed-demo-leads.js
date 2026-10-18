// node server/db/seed-demo-leads.js — owner: Ali. Run AFTER seed.js.
// Adds demo leads (waiting / acknowledged / escalated / no owner / idle) and Telegram inbox
// conversations to "Acme Solar", using the real lead engine so audit + history are genuine.
// Safe to run once; it stops if the demo leads already exist.
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { pool, initDb } = require('./index');
const engine = require('../services/leadEngine');

const q = (sql, p) => pool.query(sql, p);

async function contact(ws, { name, phone, chat, source }) {
  const { rows: [c] } = await q(
    `INSERT INTO contacts (workspace_id, name, phone, telegram_chat_id, source) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [ws, name, phone || null, chat || null, source]
  );
  return c;
}
async function lead(ws, c, source, detail) {
  return engine.createLead({ ws, contactId: c.id, source, sourceDetail: detail });
}
async function overdue(id) { await q(`UPDATE leads SET ack_deadline = now() - interval '1 second' WHERE id = $1`, [id]); }

async function conversation(ws, c, ownerId, msgs) {
  const { rows: [cv] } = await q(
    `INSERT INTO conversations (workspace_id, contact_id, channel, assigned_user_id, last_message_at)
     VALUES ($1,$2,'telegram',$3, now()) ON CONFLICT (workspace_id, contact_id, channel) DO UPDATE SET last_message_at = now() RETURNING *`,
    [ws, c.id, ownerId]
  );
  let t = msgs.length;
  for (const [dir, body] of msgs) {
    await q(
      `INSERT INTO messages (workspace_id, conversation_id, direction, body, status, created_by, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6, now() - ($7 || ' minutes')::interval, now() - ($7 || ' minutes')::interval)`,
      [ws, cv.id, dir, body, dir === 'in' ? 'received' : 'sent', dir === 'out' ? ownerId : null, String(t * 3)]
    );
    await q(
      `INSERT INTO activities (workspace_id, contact_id, type, actor_id, summary, data) VALUES ($1,$2,$3,$4,$5,'{}')`,
      [ws, c.id, dir === 'in' ? 'message_in' : 'message_out', dir === 'out' ? ownerId : null, `${dir === 'in' ? 'Telegram message' : 'Reply'}: ${body}`]
    );
    t -= 1;
  }
}

async function main() {
  await initDb();
  const { rows: [w] } = await q(`SELECT id FROM workspaces WHERE slug = 'acme-solar'`);
  if (!w) throw new Error('Run "node db/seed.js" first — Acme Solar not found');
  const ws = w.id;
  const { rows: [done] } = await q(`SELECT 1 FROM contacts WHERE workspace_id = $1 AND name = 'Sana Javed'`, [ws]);
  if (done) { console.log('[demo-leads] already added — nothing to do'); return; }

  await q(`UPDATE users SET status = 'available' WHERE workspace_id = $1 AND level <> 'owner'`, [ws]);
  const { rows: [rules] } = await engine.getRules(ws).then((r) => ({ rows: [r] }));
  await q(`UPDATE assignment_rules SET ack_window_seconds = 1800, max_open_leads = 20 WHERE workspace_id = $1`, [ws]);

  // 1. Waiting for acknowledgement (30-minute countdown visible)
  for (const [name, phone] of [['Sana Javed', '+923211110101'], ['Kamran Akhtar', '+923211110102'], ['Mehwish Ali', '+923211110103']]) {
    await lead(ws, await contact(ws, { name, phone, source: 'web_form' }), 'web_form', 'Public form /f/acme-solar');
  }
  // 2. Acknowledged (manual entries)
  for (const [name, phone] of [['Tariq Mehmood', '+923211110104'], ['Nadia Hussain', '+923211110105'], ['Junaid Iqbal', '+923211110106']]) {
    const l = await lead(ws, await contact(ws, { name, phone, source: 'manual' }), 'manual', 'Walk-in');
    if (l.owner_id) await engine.acknowledge({ ws, leadId: l.id, userId: l.owner_id });
  }
  // 3. Telegram leads with Inbox conversations
  const tg = [
    ['Ahsan Raza', '700100201', [['in', 'Assalam o alaikum, what does a 5 kW system cost?'], ['out', 'Walaikum assalam! Around PKR 950k installed. Can we visit your roof this week?'], ['in', 'Yes, Thursday works.']]],
    ['Fiza Noor', '700100202', [['in', 'Do you install net metering too?'], ['out', 'Yes, we handle the full net-metering application.']]],
    ['Waqas Ahmed', '700100203', [['in', 'Hi, I need solar for my shop in G-9']]],
  ];
  for (const [i, [name, chat, msgs]] of tg.entries()) {
    const c = await contact(ws, { name, chat, source: 'telegram' });
    const l = await lead(ws, c, 'telegram', `chat ${chat}`);
    await conversation(ws, c, l.owner_id, msgs);
    if (i < 2 && l.owner_id) await engine.acknowledge({ ws, leadId: l.id, userId: l.owner_id });
  }
  // 4. Escalated twice → recovery queue ("Escalated 2 times")
  const esc = await lead(ws, await contact(ws, { name: 'Rizwan Shah', phone: '+923211110107', source: 'web_form' }), 'web_form', 'Public form /f/acme-solar');
  for (let i = 0; i < 2; i += 1) { await overdue(esc.id); await engine.escalateOne(ws, esc.id); }
  // 5. Chain exhausted → no owner
  const lost = await lead(ws, await contact(ws, { name: 'Huma Saleem', phone: '+923211110108', source: 'web_form' }), 'web_form', 'Public form /f/acme-solar');
  for (let i = 0; i < 6; i += 1) {
    const { rows: [s] } = await q('SELECT status FROM leads WHERE id = $1', [lost.id]);
    if (s.status !== 'assigned') break;
    await overdue(lost.id); await engine.escalateOne(ws, lost.id);
  }
  // 6. Acknowledged but idle for 2 hours → recovery queue ("No action for 10 min")
  const idle = await lead(ws, await contact(ws, { name: 'Shahzad Butt', phone: '+923211110109', source: 'manual' }), 'manual', 'Phone call');
  if (idle.owner_id) await engine.acknowledge({ ws, leadId: idle.id, userId: idle.owner_id });
  await q(`UPDATE leads SET last_action_at = now() - interval '2 hours', assigned_at = now() - interval '2 hours' WHERE id = $1`, [idle.id]);

  await q(`UPDATE assignment_rules SET ack_window_seconds = $2, max_open_leads = $3 WHERE workspace_id = $1`,
    [ws, rules.ack_window_seconds, rules.max_open_leads]);
  const { rows: [n] } = await q(`SELECT count(*)::int AS leads FROM leads WHERE workspace_id = $1`, [ws]);
  console.log(`[demo-leads] done — ${n.leads} leads, 3 Telegram conversations, recovery items added`);
}

main().then(() => pool.end()).catch((e) => { console.error('[demo-leads] failed:', e.message); pool.end(); process.exit(1); });
