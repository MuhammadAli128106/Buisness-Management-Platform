// node server/db/seed.js [--reset]  — owner: Musa.
// Creates demo workspaces "Acme Solar" (slug acme-solar) and "Beta Realty" (slug beta-realty).
// --reset wipes those two workspaces' data first (audit_log rows are kept; trigger forbids deletes — we disable it for the reset only).
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const bcrypt = require('bcryptjs');
const { pool, withTransaction, initDb } = require('./index');
const { createWorkspace } = require('../services/workspaceSetup');

const PW = 'Demo1234!';
const FIRST = ['Ayesha', 'Bilal', 'Hamza', 'Sara', 'Usman', 'Fatima', 'Zain', 'Hira', 'Omar', 'Mahnoor', 'Ali', 'Noor', 'Saad', 'Iqra', 'Faisal', 'Amna', 'Danish', 'Rabia', 'Taha', 'Zara'];
const LAST = ['Khan', 'Ahmed', 'Malik', 'Butt', 'Chaudhry', 'Sheikh', 'Qureshi', 'Raza', 'Siddiqui', 'Mirza'];
const COMPANIES = ['Green Roofs Ltd', 'Sunrise Textiles', 'Margalla Foods', 'Indus Clinics', 'Blue Area Offices'];

async function wipe(client, slug) {
  const ws = (await client.query('SELECT id FROM workspaces WHERE slug = $1', [slug])).rows[0];
  if (!ws) return;
  const tables = ['notifications', 'appointments', 'payments', 'messages', 'conversations', 'webhook_dedupe_none',
    'integration_events', 'google_tokens', 'integrations', 'lead_assignments', 'leads', 'activities', 'saved_lists',
    'opportunities', 'custom_fields', 'stages', 'pipelines', 'contacts', 'companies', 'assignment_rules'];
  await client.query('ALTER TABLE audit_log DISABLE TRIGGER audit_log_no_change');
  await client.query('DELETE FROM audit_log WHERE workspace_id = $1', [ws.id]);
  await client.query('ALTER TABLE audit_log ENABLE TRIGGER audit_log_no_change');
  for (const t of tables) {
    if (t === 'webhook_dedupe_none') continue;
    await client.query(`DELETE FROM ${t} WHERE workspace_id = $1`, [ws.id]);
  }
  await client.query('DELETE FROM refresh_tokens WHERE user_id IN (SELECT id FROM users WHERE workspace_id = $1)', [ws.id]);
  await client.query('UPDATE users SET backup_user_id = NULL, manager_user_id = NULL WHERE workspace_id = $1', [ws.id]);
  await client.query('DELETE FROM users WHERE workspace_id = $1', [ws.id]);
  await client.query('DELETE FROM roles WHERE workspace_id = $1', [ws.id]);
  await client.query('DELETE FROM workspaces WHERE id = $1', [ws.id]);
}

async function addUser(c, ws, roleId, name, email, level = 'user') {
  return (await c.query(
    `INSERT INTO users (workspace_id, name, email, password_hash, level, role_id) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [ws, name, email, await bcrypt.hash(PW, 10), level, roleId],
  )).rows[0];
}

async function seedAcme(c) {
  const { workspace, owner, roles, pipeline, stages } = await createWorkspace(c, {
    companyName: 'Acme Solar', slug: 'acme-solar', name: 'Olivia Owner', email: 'owner@acme.test', password: PW,
  });
  const ws = workspace.id;
  const ali = await addUser(c, ws, roles.Admin.id, 'Ali (Admin)', 'ali@acme.test', 'admin');
  const manager = await addUser(c, ws, roles.Manager.id, 'Maria Manager', 'manager@acme.test');
  const ahmed = await addUser(c, ws, roles['Sales Rep'].id, 'Ahmed (Sales)', 'ahmed@acme.test');
  const rep2 = await addUser(c, ws, roles['Sales Rep'].id, 'Rehan (Sales)', 'rep2@acme.test');
  // escalation chain: reps back each other up, Maria manages both
  await c.query('UPDATE users SET backup_user_id = $2, manager_user_id = $3 WHERE id = $1', [ahmed.id, rep2.id, manager.id]);
  await c.query('UPDATE users SET backup_user_id = $2, manager_user_id = $3 WHERE id = $1', [rep2.id, ahmed.id, manager.id]);
  await c.query('UPDATE users SET manager_user_id = $2 WHERE id = $1', [ali.id, owner.id]);
  // owner & admin are not in the round-robin pool by default
  await c.query(`UPDATE users SET status = 'busy' WHERE id = ANY($1)`, [[owner.id, ali.id]]);

  // custom fields: contact-wide + per pipeline (F2.3)
  const install = (await c.query(`INSERT INTO pipelines (workspace_id, name, position) VALUES ($1,'Installations',1) RETURNING *`, [ws])).rows[0];
  const iStages = [];
  for (const [i, [n, k]] of [['Site survey', 'open'], ['Scheduled', 'open'], ['Installed', 'won'], ['Cancelled', 'lost']].entries()) {
    iStages.push((await c.query(`INSERT INTO stages (workspace_id, pipeline_id, name, position, kind) VALUES ($1,$2,$3,$4,$5) RETURNING *`, [ws, install.id, n, i, k])).rows[0]);
  }
  await c.query(`INSERT INTO custom_fields (workspace_id, entity, key, label, type, options) VALUES
    ($1,'contact','city','City','dropdown','{Islamabad,Rawalpindi,Lahore,Karachi}'),
    ($1,'contact','preferred_contact','Preferred contact','dropdown','{WhatsApp,Phone,Email}')`, [ws]);
  await c.query(`INSERT INTO custom_fields (workspace_id, entity, pipeline_id, key, label, type) VALUES
    ($1,'opportunity',$2,'system_size_kw','System size (kW)','number'),
    ($1,'opportunity',$2,'proposal_date','Proposal date','date'),
    ($1,'opportunity',$3,'roof_type','Roof type','text')`, [ws, pipeline.id, install.id]);
  await c.query(`UPDATE stages SET required_field_keys = '{system_size_kw}' WHERE id = $1`, [stages.find((s) => s.name === 'Proposal').id]);

  const companyIds = [];
  for (const name of COMPANIES) {
    companyIds.push((await c.query(`INSERT INTO companies (workspace_id, name, domain, created_by) VALUES ($1,$2,$3,$4) RETURNING id`,
      [ws, name, `${name.toLowerCase().replace(/[^a-z]/g, '')}.pk`, owner.id])).rows[0].id);
  }
  const reps = [ahmed.id, rep2.id];
  const contacts = [];
  for (let i = 0; i < 20; i += 1) {
    const name = `${FIRST[i]} ${LAST[i % LAST.length]}`;
    const row = (await c.query(
      `INSERT INTO contacts (workspace_id, company_id, name, phone, email, tags, owner_id, source, custom, created_by, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, now() - ($11 || ' days')::interval) RETURNING *`,
      [ws, i % 4 === 3 ? null : companyIds[i % companyIds.length], name, `+92300${String(1000000 + i * 7919).slice(0, 7)}`,
        `${FIRST[i].toLowerCase()}.${LAST[i % LAST.length].toLowerCase()}@example.pk`,
        i % 3 === 0 ? ['vip', 'residential'] : i % 3 === 1 ? ['commercial'] : ['residential'],
        reps[i % 2], ['manual', 'web_form', 'whatsapp'][i % 3],
        JSON.stringify({ city: ['Islamabad', 'Rawalpindi', 'Lahore', 'Karachi'][i % 4], preferred_contact: 'WhatsApp' }), owner.id, String(i)],
    )).rows[0];
    contacts.push(row);
  }
  const opps = [
    ['5 kW rooftop', 0, 450000, 0, { system_size_kw: 5 }], ['10 kW commercial', 1, 1200000, 1, { system_size_kw: 10 }],
    ['Clinic backup system', 2, 800000, 2, { system_size_kw: 8, proposal_date: '2026-10-10' }], ['Textile mill array', 3, 5000000, 1, {}],
    ['3 kW home', 4, 280000, 3, { system_size_kw: 3 }], ['Office solar', 5, 950000, 0, {}],
    ['Farmhouse system', 6, 600000, 4, {}], ['Restaurant install', 7, 700000, 2, { system_size_kw: 7 }],
  ];
  for (const [title, ci, value, si, custom] of opps) {
    const st = stages[si];
    await c.query(
      `INSERT INTO opportunities (workspace_id, contact_id, pipeline_id, stage_id, title, value_cents, currency, owner_id, custom, created_by, closed_at)
       VALUES ($1,$2,$3,$4,$5,$6,'PKR',$7,$8,$9,$10)`,
      [ws, contacts[ci].id, pipeline.id, st.id, title, value * 100, contacts[ci].owner_id, JSON.stringify(custom), owner.id, st.kind === 'open' ? null : new Date()],
    );
  }
  await c.query(
    `INSERT INTO opportunities (workspace_id, contact_id, pipeline_id, stage_id, title, value_cents, currency, owner_id, custom, created_by)
     VALUES ($1,$2,$3,$4,'Install for Ayesha',45000000,'PKR',$5,'{"roof_type":"Flat concrete"}',$6)`,
    [ws, contacts[0].id, install.id, iStages[0].id, ahmed.id, owner.id],
  );
  for (const ct of contacts.slice(0, 6)) {
    await c.query(`INSERT INTO activities (workspace_id, contact_id, type, actor_id, summary) VALUES ($1,$2,'note',$3,$4)`,
      [ws, ct.id, ct.owner_id, `Intro call with ${ct.name.split(' ')[0]} — interested in solar.`]);
  }
  return { ws, slug: workspace.slug };
}

async function seedBeta(c) {
  const { workspace, roles } = await createWorkspace(c, {
    companyName: 'Beta Realty', slug: 'beta-realty', name: 'Bob Beta', email: 'owner@beta.test', password: PW,
  });
  await addUser(c, workspace.id, roles['Sales Rep'].id, 'Bina (Beta Sales)', 'rep@beta.test');
  const co = (await c.query(`INSERT INTO companies (workspace_id, name) VALUES ($1,'Beta Clients Co') RETURNING id`, [workspace.id])).rows[0];
  await c.query(`INSERT INTO contacts (workspace_id, company_id, name, phone, email) VALUES ($1,$2,'Beta Secret Contact','+923339999999','secret@beta.test')`, [workspace.id, co.id]);
  return { ws: workspace.id };
}

(async () => {
  await initDb();
  const reset = process.argv.includes('--reset');
  await withTransaction(async (c) => {
    const exists = (await c.query(`SELECT 1 FROM workspaces WHERE slug = 'acme-solar'`)).rowCount;
    if (exists && !reset) { console.log('[seed] demo workspaces already exist — run with --reset to recreate'); return; }
    await wipe(c, 'acme-solar'); await wipe(c, 'beta-realty');
    const a = await seedAcme(c); const b = await seedBeta(c);
    console.log(`[seed] Acme Solar ws=${a.ws} (public form /f/${a.slug})`);
    console.log(`[seed] Beta Realty ws=${b.ws}`);
    console.log(`[seed] logins (password ${PW}): owner@acme.test, ali@acme.test (Admin), manager@acme.test, ahmed@acme.test, rep2@acme.test, owner@beta.test, rep@beta.test`);
  });
  await pool.end();
})().catch((e) => { console.error('[seed] failed', e); process.exit(1); });
