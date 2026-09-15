'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { parseCommand } = require('../gateway/commands/grammar');
const { lookup, rank, names, subcommandsOf } = require('../gateway/commands/registry');

test('bare /route3 is treated as help', () => {
  assert.deepEqual(parseCommand('/route3').ast, { command: 'help', subcommand: null, scope: null, options: {} });
});

test('a simple command parses', () => {
  assert.deepEqual(parseCommand('/route3 review').ast, { command: 'review', subcommand: null, scope: null, options: {} });
});

test('a subcommand carries its scope', () => {
  assert.deepEqual(parseCommand('/route3 review security').ast, { command: 'review', subcommand: 'security', scope: 'security', options: {} });
});

test('flags parse as booleans and values', () => {
  assert.deepEqual(parseCommand('/route3 fix tests --deep --limit=20').ast.options, { deep: true, limit: '20' });
});

test('a comment without a command is not an error', () => {
  assert.equal(parseCommand('please review this when you can'), null);
});

test('a command inside a fenced code block is ignored', () => {
  assert.equal(parseCommand('see below:\n\n```\n/route3 fix\n```\n'), null);
});

test('/route3x is not a command', () => {
  assert.equal(parseCommand('/route3x fix'), null);
});

test('shell metacharacters never produce a command', () => {
  assert.deepEqual(parseCommand('/route3 review; rm -rf /'), { ok: false, reason: 'invalid_command' });
  assert.equal(parseCommand('/route3 $(whoami)').ok, false);
  assert.equal(parseCommand('/route3 review `id`').ok, false);
});

test('an unknown command is reported, not executed', () => {
  assert.deepEqual(parseCommand('/route3 deploy'), { ok: false, reason: 'unknown_command', command: 'deploy', subcommand: null });
});

test('a command whose subcommand is mandatory is rejected without one', () => {
  assert.equal(parseCommand('/route3 skill').ok, false);
  assert.equal(lookup('skill', null), null);
  assert.equal(lookup('skill', 'audit').capability, 'SKILL_AUDIT');
});

test('create skill resolves', () => {
  assert.equal(lookup('create', 'skill').capability, 'CREATE_SKILL');
  assert.equal(lookup('create', null), null);
});

test('permission ranks are ordered', () => {
  assert.ok(rank('admin') > rank('write'));
  assert.ok(rank('write') > rank('read'));
  assert.equal(rank('nonsense'), -1);
});

test('local commands need no runner', () => {
  assert.equal(lookup('help', null).local, true);
  assert.equal(lookup('status', null).local, true);
  assert.equal(lookup('review', null).local, false);
});

test('every registered command is reachable', () => {
  for (const name of names()) {
    const reachable = lookup(name, null) !== null || Object.keys(subcommandsOf(name)).length > 0;
    assert.ok(reachable, `${name} is reachable neither directly nor through a subcommand`);
  }
});
