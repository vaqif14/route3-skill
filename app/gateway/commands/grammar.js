'use strict';

const { lookup } = require('./registry');

const PREFIX = '/route3';
const FENCE = /^\s*(`{3,}|~{3,})/;
const WORD = /^[A-Za-z][A-Za-z0-9-]*$/;
const FLAG = /^--([A-Za-z][A-Za-z0-9-]*)(?:=([A-Za-z0-9._][A-Za-z0-9._,:\/@-]{0,119}))?$/;
const MAX_TOKENS = 12;

// Fenced blocks are quoted text, not instructions. Stripping them first stops a
// pasted transcript or a quoted example from triggering a job.
function unfenced(body) {
  const lines = [];
  let fence = null;
  for (const line of String(body).split('\n')) {
    const match = FENCE.exec(line);
    if (fence !== null) {
      if (match && line.trim().startsWith(fence)) fence = null;
      continue;
    }
    if (match) { fence = match[1]; continue; }
    lines.push(line);
  }
  return lines;
}

function ast(command, subcommand, scope, options) {
  return { command, subcommand, scope, options };
}

function build(tokens) {
  const command = tokens[0].toLowerCase();
  if (!WORD.test(command)) return { ok: false, reason: 'invalid_command' };

  let subcommand = null;
  let index = 1;
  if (tokens.length > 1 && WORD.test(tokens[1])) { subcommand = tokens[1].toLowerCase(); index = 2; }

  let found = lookup(command, subcommand);
  if (!found && subcommand) {
    found = lookup(command, null);
    if (found) { subcommand = null; index = 1; }
  }
  if (!found) return { ok: false, reason: 'unknown_command', command, subcommand };

  const options = {};
  for (const token of tokens.slice(index)) {
    const flag = FLAG.exec(token);
    if (!flag) return { ok: false, reason: 'invalid_flag', token };
    options[flag[1]] = flag[2] === undefined ? true : flag[2];
  }
  return { ok: true, ast: ast(found.command, found.subcommand, found.scope, options) };
}

// Returns null when the comment carries no command at all. That is not an error.
function parseCommand(body) {
  for (const line of unfenced(body)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith(PREFIX)) continue;
    const rest = trimmed.slice(PREFIX.length);
    if (rest.length > 0 && !/^\s/.test(rest)) continue; // /route3x
    const tokens = rest.trim().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) return { ok: true, ast: ast('help', null, null, {}) };
    if (tokens.length > MAX_TOKENS) return { ok: false, reason: 'too_many_tokens' };
    return build(tokens);
  }
  return null;
}

module.exports = { parseCommand, unfenced };
