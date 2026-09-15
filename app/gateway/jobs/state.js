'use strict';

// The success spine. Every other outcome is a failure branch, below.
const ACTIVE_TRANSITIONS = {
  RECEIVED:         ['AUTHENTICATED'],
  AUTHENTICATED:    ['AUTHORIZED'],
  AUTHORIZED:       ['NORMALIZED'],
  NORMALIZED:       ['QUEUED'],
  QUEUED:           ['EXECUTING'],
  EXECUTING:        ['READY_TO_PUBLISH'],
  READY_TO_PUBLISH: ['PUBLISHING'],
  PUBLISHING:       ['SUCCEEDED'],
};

const TERMINAL = new Set(['SUCCEEDED', 'FAILED', 'CANCELLED', 'REJECTED', 'EXPIRED']);

// A failure branch is recorded as failure_code; the job's status becomes the
// terminal state it maps to. Branches belonging to later slices are declared now
// so the vocabulary never drifts between slices.
const FAILURE_TERMINAL = {
  AUTH_REJECTED:              'REJECTED',
  POLICY_REJECTED:            'REJECTED',
  SECURITY_REJECTED:          'REJECTED',
  ARTIFACT_SECURITY_REJECTED: 'REJECTED',
  SOURCE_FAILED:              'FAILED',
  SOURCE_INTEGRITY_FAILURE:   'FAILED',
  SOURCE_TOO_LARGE:           'FAILED',
  SOURCE_STALE:               'FAILED',
  RUNNER_UNAVAILABLE:         'FAILED',
  RUNNER_VERSION_UNSUPPORTED: 'FAILED',
  RUNNER_LOST:                'FAILED',
  SANDBOX_FAILED:             'FAILED',
  AGENT_FAILED:               'FAILED',
  RESULT_INVALID:             'FAILED',
  PUBLISH_CONFLICT:           'FAILED',
  PUBLISH_FAILED:             'FAILED',
  LEASE_EXPIRED:              'EXPIRED',
  TIMED_OUT:                  'EXPIRED',
  CANCELLED:                  'CANCELLED',
};

class IllegalTransition extends Error {
  constructor(from, to) {
    super(`Illegal job transition ${from} -> ${to}`);
    this.name = 'IllegalTransition';
    this.from = from;
    this.to = to;
  }
}

function isTerminal(status) { return TERMINAL.has(status); }
function isActive(status) { return Object.hasOwn(ACTIVE_TRANSITIONS, status); }

function assertTransition(from, to) {
  if (isTerminal(from)) throw new IllegalTransition(from, to);
  const allowed = ACTIVE_TRANSITIONS[from];
  if (!allowed || !allowed.includes(to)) throw new IllegalTransition(from, to);
  return to;
}

function assertFailure(from, failureCode) {
  if (!isActive(from)) throw new IllegalTransition(from, failureCode);
  const terminal = FAILURE_TERMINAL[failureCode];
  if (!terminal) throw new IllegalTransition(from, failureCode);
  return terminal;
}

module.exports = {
  ACTIVE_TRANSITIONS, TERMINAL, FAILURE_TERMINAL,
  IllegalTransition, isTerminal, isActive, assertTransition, assertFailure,
};
