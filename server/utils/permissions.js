// Single source of truth for permission keys (CLAUDE.md §8). Musa owns.
const ALL_PERMISSIONS = [
  'crm.view', 'crm.create', 'crm.edit', 'crm.delete', 'crm.export', 'opp.value.view',
  'pipeline.manage', 'rules.manage', 'leads.view_all', 'leads.reassign',
  'integrations.manage', 'audit.view', 'users.manage',
];
const PERMISSION_LABELS = {
  'crm.view': 'View CRM records', 'crm.create': 'Create CRM records', 'crm.edit': 'Edit CRM records',
  'crm.delete': 'Delete CRM records', 'crm.export': 'Export CRM records', 'opp.value.view': 'See opportunity values',
  'pipeline.manage': 'Manage pipelines & custom fields', 'rules.manage': 'Manage assignment rules',
  'leads.view_all': 'See all leads', 'leads.reassign': 'Reassign leads & see recovery queue',
  'integrations.manage': 'Manage integrations', 'audit.view': 'View audit log', 'users.manage': 'Manage users & roles',
};
const DEFAULT_ROLES = {
  Admin: ALL_PERMISSIONS,
  Manager: ['crm.view', 'crm.create', 'crm.edit', 'crm.export', 'opp.value.view', 'leads.view_all', 'leads.reassign', 'audit.view'],
  'Sales Rep': ['crm.view', 'crm.create', 'crm.edit'],
};
module.exports = { ALL_PERMISSIONS, PERMISSION_LABELS, DEFAULT_ROLES };
