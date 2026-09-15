'use strict';

const SUPPORTED = new Set([
  'issue_comment', 'pull_request', 'pull_request_review_comment',
  'issues', 'installation', 'installation_repositories',
]);

const COMMENT_EVENTS = new Set(['issue_comment', 'pull_request_review_comment']);
const COMMAND_ACTIONS = new Set(['created', 'edited']);

class InvalidEvent extends Error {
  constructor(reason) {
    super(`Invalid webhook payload: ${reason}`);
    this.name = 'InvalidEvent';
    this.reason = reason;
  }
}

function requireObject(value, field) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new InvalidEvent(`${field} is missing`);
  return value;
}

function requireInteger(value, field) {
  if (!Number.isInteger(value)) throw new InvalidEvent(`${field} is not an integer`);
  return value;
}

function requireString(value, field) {
  if (typeof value !== 'string' || value.length === 0) throw new InvalidEvent(`${field} is missing`);
  return value;
}

function repositoryOf(repository) {
  requireObject(repository, 'repository');
  return {
    id: requireInteger(repository.id, 'repository.id'),
    fullName: requireString(repository.full_name, 'repository.full_name'),
    defaultBranch: typeof repository.default_branch === 'string' ? repository.default_branch : 'main',
    private: Boolean(repository.private),
    ownerId: requireInteger(requireObject(repository.owner, 'repository.owner').id, 'repository.owner.id'),
  };
}

function normalize(event, payload) {
  if (!SUPPORTED.has(event)) return { supported: false, event };

  requireObject(payload, 'payload');
  const installationId = requireInteger(requireObject(payload.installation, 'installation').id, 'installation.id');
  const action = typeof payload.action === 'string' ? payload.action : null;
  const repository = payload.repository ? repositoryOf(payload.repository) : null;

  if (!COMMENT_EVENTS.has(event) || !COMMAND_ACTIONS.has(action)) {
    return { supported: true, actionable: false, event, installationId, action, repository };
  }

  const comment = requireObject(payload.comment, 'comment');
  const sender = requireObject(payload.sender, 'sender');
  const issue = requireObject(payload.issue || payload.pull_request, 'issue');
  const isPullRequest = event === 'pull_request_review_comment'
    || Boolean(payload.issue && payload.issue.pull_request)
    || Boolean(payload.pull_request);

  return {
    supported: true,
    actionable: true,
    event,
    installationId,
    action,
    repository: repositoryOf(requireObject(payload.repository, 'repository')),
    surface: isPullRequest ? 'pull_request' : 'issue',
    surfaceNumber: requireInteger(issue.number, 'issue.number'),
    commentId: requireInteger(comment.id, 'comment.id'),
    body: typeof comment.body === 'string' ? comment.body : '',
    actor: {
      id: requireInteger(sender.id, 'sender.id'),
      login: requireString(sender.login, 'sender.login'),
    },
  };
}

module.exports = { SUPPORTED, COMMENT_EVENTS, InvalidEvent, normalize };
