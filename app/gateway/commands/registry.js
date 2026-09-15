'use strict';

const PERMISSION_RANK = { none: 0, read: 1, triage: 2, write: 3, maintain: 4, admin: 5 };

// local: handled inside the gateway. Reads no repository content, needs no runner.
// capability null: a subcommand is mandatory.
const COMMANDS = {
  help:         { capability: 'HELP',         minimumPermission: 'read',  execution: 'NONE',   local: true },
  status:       { capability: 'STATUS',       minimumPermission: 'read',  execution: 'NONE',   local: true },
  cancel:       { capability: 'CANCEL',       minimumPermission: 'write', execution: 'NONE',   local: true },
  explain:      { capability: 'EXPLAIN',      minimumPermission: 'read',  execution: 'STATIC', local: false },
  plan:         { capability: 'PLAN',         minimumPermission: 'write', execution: 'STATIC', local: false },
  architecture: { capability: 'ARCHITECTURE', minimumPermission: 'write', execution: 'STATIC', local: false },
  setup:        { capability: 'SETUP',        minimumPermission: 'admin', execution: 'STATIC', local: false },
  review: {
    capability: 'REVIEW', minimumPermission: 'write', execution: 'STATIC', local: false,
    subcommands: { security: { capability: 'REVIEW_SECURITY', scope: 'security' } },
  },
  fix: {
    capability: 'FIX', minimumPermission: 'write', execution: 'TEST', local: false,
    subcommands: { tests: { capability: 'FIX_TESTS', scope: 'tests' } },
  },
  skill: {
    capability: null, minimumPermission: 'write', execution: 'STATIC', local: false,
    subcommands: { audit: { capability: 'SKILL_AUDIT', scope: 'audit' } },
  },
  create: {
    capability: null, minimumPermission: 'admin', execution: 'STATIC', local: false,
    subcommands: { skill: { capability: 'CREATE_SKILL', scope: 'skill' } },
  },
};

function rank(permission) {
  return Object.hasOwn(PERMISSION_RANK, permission) ? PERMISSION_RANK[permission] : -1;
}

function names() {
  return Object.keys(COMMANDS);
}

function subcommandsOf(command) {
  return (COMMANDS[command] && COMMANDS[command].subcommands) || {};
}

function descriptor(command, subcommand, entry, extra) {
  const from = extra || {};
  return {
    command,
    subcommand: subcommand || null,
    scope: from.scope || null,
    capability: from.capability || entry.capability,
    minimumPermission: from.minimumPermission || entry.minimumPermission,
    execution: from.execution || entry.execution,
    local: from.local !== undefined ? from.local : entry.local,
  };
}

function lookup(command, subcommand) {
  const entry = COMMANDS[command];
  if (!entry) return null;
  if (subcommand) {
    const extra = entry.subcommands && entry.subcommands[subcommand];
    return extra ? descriptor(command, subcommand, entry, extra) : null;
  }
  return entry.capability ? descriptor(command, null, entry, null) : null;
}

function describe() {
  const rows = [];
  for (const [command, entry] of Object.entries(COMMANDS)) {
    if (entry.capability) rows.push(lookup(command, null));
    for (const subcommand of Object.keys(entry.subcommands || {})) rows.push(lookup(command, subcommand));
  }
  return rows;
}

module.exports = { PERMISSION_RANK, rank, names, lookup, describe, subcommandsOf };
