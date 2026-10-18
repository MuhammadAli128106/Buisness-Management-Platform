// Creates a workspace with its Owner, default roles, default pipeline and assignment rules — one transaction (F1.1).
const bcrypt = require('bcryptjs');
const { slugify } = require('../utils/format');
const { DEFAULT_ROLES } = require('../utils/permissions');

const DEFAULT_STAGES = [
  ['New', 'open'], ['Contacted', 'open'], ['Proposal', 'open'], ['Won', 'won'], ['Lost', 'lost'],
];

async function uniqueSlug(client, base) {
  let slug = slugify(base); let i = 1;
  // eslint-disable-next-line no-await-in-loop
  while ((await client.query('SELECT 1 FROM workspaces WHERE slug = $1', [slug])).rowCount) { i += 1; slug = `${slugify(base)}-${i}`; }
  return slug;
}

/** → { workspace, owner, roles: {Admin, Manager, 'Sales Rep'}, pipeline, stages[] } */
async function createWorkspace(client, { companyName, name, email, password, slug }) {
  const ws = (await client.query(
    'INSERT INTO workspaces (name, slug) VALUES ($1, $2) RETURNING *',
    [companyName, slug || await uniqueSlug(client, companyName)],
  )).rows[0];

  const roles = {};
  for (const [roleName, perms] of Object.entries(DEFAULT_ROLES)) {
    roles[roleName] = (await client.query(
      'INSERT INTO roles (workspace_id, name, permissions) VALUES ($1,$2,$3) RETURNING *', [ws.id, roleName, perms],
    )).rows[0];
  }

  const owner = (await client.query(
    `INSERT INTO users (workspace_id, name, email, password_hash, level, role_id)
     VALUES ($1,$2,$3,$4,'owner',$5) RETURNING *`,
    [ws.id, name, email.trim().toLowerCase(), await bcrypt.hash(password, 12), roles.Admin.id],
  )).rows[0];

  const pipeline = (await client.query(
    'INSERT INTO pipelines (workspace_id, name, position) VALUES ($1, $2, 0) RETURNING *', [ws.id, 'Sales'],
  )).rows[0];
  const stages = [];
  for (let i = 0; i < DEFAULT_STAGES.length; i += 1) {
    stages.push((await client.query(
      'INSERT INTO stages (workspace_id, pipeline_id, name, position, kind) VALUES ($1,$2,$3,$4,$5) RETURNING *',
      [ws.id, pipeline.id, DEFAULT_STAGES[i][0], i, DEFAULT_STAGES[i][1]],
    )).rows[0]);
  }

  await client.query('INSERT INTO assignment_rules (workspace_id) VALUES ($1) ON CONFLICT DO NOTHING', [ws.id]);
  return { workspace: ws, owner, roles, pipeline, stages };
}

module.exports = { createWorkspace, uniqueSlug, DEFAULT_STAGES };
