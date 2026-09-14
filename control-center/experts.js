'use strict';

// Route3 expert layer: provider-agnostic specialties that are prepended to a
// job's task brief. Built-in experts are curated; custom experts are created
// from the panel and persisted privately under ~/.local/share/route3.

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { redact } = require('./security');

const LIMITS = Object.freeze({ labelMax: 60, focusMax: 200, briefMax: 2000, customLimit: 12, fileBytes: 196608 });

const BUILTIN = [
  {
    id: 'frontend', label: 'Frontend eksperti', focus: 'İnterfeys, komponentlər və istifadəçi təcrübəsi',
    brief: 'You are Route3\'s frontend specialist. Work only inside the assigned project paths. Read the existing components, design tokens and state patterns before writing code, and follow the project\'s framework, naming and styling conventions instead of introducing new dependencies or paradigms. Build small composable components, keep accessibility (labels, focus order, contrast) and responsive behavior in scope, and preserve the project\'s visual language. Verify your result with the project\'s build, lint and typecheck commands and report exactly which commands you ran and their outcomes.',
  },
  {
    id: 'backend', label: 'Backend eksperti', focus: 'API, məlumat modeli və servis qatı',
    brief: 'You are Route3\'s backend specialist. Work only inside the assigned project paths. Study the existing service, repository and schema patterns and follow them, including the framework\'s ORM, validation and error-handling idioms. Address data-model and migration implications, indexes, transactions, auth, rate limits and failure paths for every endpoint you touch; never silently break an existing API contract. Verify with the project\'s tests, typecheck and lint, and report the exact commands and their outcomes.',
  },
  {
    id: 'fullstack', label: 'Fullstack eksperti', focus: 'Uçdan uca dəyişiklik: verilənlər + API + interfeys',
    brief: 'You are Route3\'s fullstack specialist. Work only inside the assigned project paths. Trace each change end to end — schema or data model, API handler, and the interface that consumes it — and keep every layer consistent with the project\'s existing patterns. Do not leave one layer stubbed while another is finished: if scope forces a cut, say so explicitly and stop at a coherent boundary. Verify each touched layer with the project\'s build, tests, typecheck and lint, and report the exact commands and their outcomes.',
  },
  {
    id: 'qa', label: 'QA / test eksperti', focus: 'Test planı, regression örtüyü və keyfiyyət yoxlaması',
    brief: 'You are Route3\'s QA specialist. Work only inside the assigned project paths. Start from the acceptance criteria and risk areas, then write focused tests that fail for the real reason and pass for the right reason; match the project\'s existing test framework and fixtures. Cover regressions, boundary values and failure paths, keep tests deterministic, and separate them from product code changes. Run the project\'s suite, report failures with their exact output, and flag flaky or skipped tests instead of hiding them.',
  },
  {
    id: 'security', label: 'Təhlükəsizlik eksperti', focus: 'Təhlükəsizlik auditi və sərt müdafiə düzəlişləri',
    brief: 'You are Route3\'s security specialist. Work only inside the assigned project paths. Report concrete vulnerabilities with severity and file:line evidence — injection, auth and access control, secret handling, unsafe deserialization, dependency risk — before changing anything. Fixes must remove the vulnerability, not the check: never weaken validation, tests or logs to make a finding disappear. Never print or move secrets into logs, fixtures or new files. Verify fixes with the project\'s tests and state exactly what remains unresolved.',
  },
];

class ExpertRegistry {
  constructor({ home = os.homedir(), directory } = {}) {
    this.file = path.join(directory || path.join(home, '.local/share/route3'), 'experts.json');
    this.custom = [];
    this.warning = null;
    this.refresh();
  }

  readDisk() {
    let descriptor;
    try {
      descriptor = fs.openSync(this.file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    } catch (error) {
      if (error.code === 'ENOENT') return [];
      throw error;
    }
    try {
      const stat = fs.fstatSync(descriptor);
      if (!stat.isFile() || stat.size > LIMITS.fileBytes) throw new Error('Invalid expert file size or type.');
      const buffer = Buffer.alloc(LIMITS.fileBytes + 1);
      let size = 0, count;
      while (size < buffer.length && (count = fs.readSync(descriptor, buffer, size, buffer.length - size, null)) > 0) size += count;
      if (size > LIMITS.fileBytes) throw new Error('Expert file is too large.');
      const raw = JSON.parse(buffer.subarray(0, size).toString('utf8'));
      if (!raw || raw.version !== 1 || !Array.isArray(raw.experts) || raw.experts.length > LIMITS.customLimit) throw new Error('Invalid expert registry.');
      const ids = new Set(BUILTIN.map(expert => expert.id));
      return raw.experts.map(entry => {
        if (!entry || typeof entry !== 'object' || !/^x-[0-9a-f]{8}$/.test(entry.id) || ids.has(entry.id)
          || typeof entry.label !== 'string' || !entry.label.trim() || entry.label.length > LIMITS.labelMax
          || typeof entry.focus !== 'string' || entry.focus.length > LIMITS.focusMax
          || typeof entry.brief !== 'string' || entry.brief.trim().length < 10 || entry.brief.length > LIMITS.briefMax
          || typeof entry.createdAt !== 'string' || entry.createdAt.length > 40 || !Number.isFinite(Date.parse(entry.createdAt))) throw new Error('Invalid custom expert.');
        ids.add(entry.id);
        return { id: entry.id, label: redact(entry.label).slice(0, LIMITS.labelMax), focus: redact(entry.focus).slice(0, LIMITS.focusMax), brief: redact(entry.brief).slice(0, LIMITS.briefMax), custom: true, createdAt: entry.createdAt };
      });
    } finally { fs.closeSync(descriptor); }
  }

  refresh() {
    try {
      this.custom = this.readDisk();
      this.warning = null;
      return true;
    } catch {
      this.warning = 'Custom experts could not be read or validated. The last successfully loaded list is shown; changes are disabled until the expert file is repaired.';
      return false;
    }
  }

  warnings() { return this.warning ? [this.warning] : []; }

  save(experts) {
    const stage = `${this.file}.stage-${crypto.randomBytes(12).toString('hex')}`;
    let descriptor;
    try {
      descriptor = fs.openSync(stage, 'wx', 0o600);
      fs.writeFileSync(descriptor, JSON.stringify({ version: 1, experts }, null, 2));
      fs.fsyncSync(descriptor);
      fs.closeSync(descriptor);
      descriptor = undefined;
      fs.renameSync(stage, this.file);
    } finally {
      if (descriptor !== undefined) fs.closeSync(descriptor);
      try { fs.unlinkSync(stage); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
  }

  mutate(change) {
    const directory = path.dirname(this.file);
    const lock = `${this.file}.lock`;
    let descriptor;
    try {
      fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
      descriptor = fs.openSync(lock, 'wx', 0o600);
    } catch (error) {
      throw Object.assign(new Error(error.code === 'EEXIST' ? 'The expert registry is locked by another writer. Retry after that operation finishes.' : 'The expert registry cannot be written. Check local disk access.'), { statusCode: error.code === 'EEXIST' ? 409 : 500 });
    }
    try {
      if (!this.refresh()) throw Object.assign(new Error(this.warning), { statusCode: 409 });
      const latest = this.custom.map(expert => ({ ...expert }));
      const result = change(latest);
      this.save(latest);
      this.custom = latest;
      return result;
    } catch (error) {
      if (error.statusCode) throw error;
      throw Object.assign(new Error('The expert registry could not be saved. Check local disk access.'), { statusCode: 500 });
    } finally {
      fs.closeSync(descriptor);
      fs.unlinkSync(lock);
    }
  }

  list() {
    this.refresh();
    return [
      ...BUILTIN.map(({ id, label, focus }) => ({ id, label, focus, custom: false })),
      ...this.custom.map(({ id, label, focus, createdAt }) => ({ id, label, focus, custom: true, createdAt })),
    ];
  }

  find(id) {
    this.refresh();
    if (typeof id !== 'string' || !/^[a-z0-9-]{1,64}$/.test(id)) return null;
    const builtin = BUILTIN.find(expert => expert.id === id);
    if (builtin) return { ...builtin, custom: false };
    const custom = this.custom.find(expert => expert.id === id);
    return custom ? { ...custom, custom: true } : null;
  }

  create(input) {
    const label = typeof input?.label === 'string' ? input.label.trim() : '';
    if (!label || label.length > LIMITS.labelMax) throw Object.assign(new Error(`Expert name must contain 1–${LIMITS.labelMax} characters.`), { statusCode: 400 });
    const focus = typeof input?.focus === 'string' ? input.focus.trim().slice(0, LIMITS.focusMax) : '';
    const brief = typeof input?.brief === 'string' ? input.brief.trim() : '';
    if (brief.length < 10 || brief.length > LIMITS.briefMax) throw Object.assign(new Error(`Expert instructions must contain 10–${LIMITS.briefMax} characters.`), { statusCode: 400 });
    return this.mutate(latest => {
      if (latest.length >= LIMITS.customLimit) throw Object.assign(new Error(`Custom expert limit reached (${LIMITS.customLimit}). Remove one before creating another.`), { statusCode: 409 });
      let id = `x-${crypto.randomBytes(4).toString('hex')}`;
      while (latest.some(expert => expert.id === id)) id = `x-${crypto.randomBytes(4).toString('hex')}`;
      const expert = { id, label: redact(label).slice(0, LIMITS.labelMax), focus: focus ? redact(focus).slice(0, LIMITS.focusMax) : 'İstifadəçi təyinatlı ekspert', brief: redact(brief).slice(0, LIMITS.briefMax), custom: true, createdAt: new Date().toISOString() };
      latest.push(expert);
      return { ...expert };
    });
  }

  remove(id) {
    if (BUILTIN.some(expert => expert.id === id)) throw Object.assign(new Error('Built-in experts cannot be deleted.'), { statusCode: 400 });
    return this.mutate(latest => {
      const index = latest.findIndex(expert => expert.id === id);
      if (index < 0) throw Object.assign(new Error('Expert not found.'), { statusCode: 404 });
      latest.splice(index, 1);
      return true;
    });
  }
}

module.exports = { ExpertRegistry, BUILTIN, LIMITS };
