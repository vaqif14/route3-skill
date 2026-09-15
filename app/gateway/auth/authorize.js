'use strict';

const { rank, lookup } = require('../commands/registry');
const { resolve } = require('./policy');

const REJECTIONS = {
  installation_unknown:   { failureCode: 'AUTH_REJECTED',   message: 'Route3 is not installed for this account.' },
  installation_suspended: { failureCode: 'AUTH_REJECTED',   message: 'This Route3 installation is suspended.' },
  installation_disabled:  { failureCode: 'POLICY_REJECTED', message: 'This installation is not enabled for Route3. Route3 is currently in a private beta.' },
  repository_unknown:     { failureCode: 'AUTH_REJECTED',   message: 'Route3 has no record of this repository.' },
  repository_foreign:     { failureCode: 'AUTH_REJECTED',   message: 'This repository does not belong to the installation that sent the event.' },
  repository_disabled:    { failureCode: 'POLICY_REJECTED', message: 'Route3 is disabled for this repository.' },
  command_disabled:       { failureCode: 'POLICY_REJECTED', message: 'This command is not enabled here.' },
  actor_permission:       { failureCode: 'AUTH_REJECTED',   message: 'This command needs a higher repository permission.' },
};

function reject(reason, detail) {
  const base = REJECTIONS[reason];
  if (!base) throw new Error(`Unknown rejection reason: ${reason}`);
  return {
    ok: false, reason,
    failureCode: base.failureCode,
    message: detail ? `${base.message} ${detail}` : base.message,
  };
}

// Layer order is installation, repository, actor, command — but the command
// policy is computed before the actor lookup because it decides the bar the
// actor has to clear, and because a disabled command must cost no GitHub call.
async function authorize({ store, client, normalized, ast, allowlist }) {
  const descriptor = lookup(ast.command, ast.subcommand);
  if (!descriptor) return reject('command_disabled');

  // The installation id from the HMAC-verified payload is a guaranteed integer
  // (events.js requireInteger). A stored row's id may arrive as a string once a
  // BIGINT column is involved, so identity comparisons key off the verified value.
  const installationId = normalized.installationId;

  const installation = await store.getInstallation(installationId);
  if (!installation) return reject('installation_unknown');
  if (installation.suspendedAt) return reject('installation_suspended');
  if (installation.enabled !== true || !allowlist.has(installationId)) return reject('installation_disabled');

  const repository = await store.getRepository(normalized.repository.id);
  if (!repository) return reject('repository_unknown');
  if (Number(repository.installationId) !== installationId) {
    return { ...reject('repository_foreign'), securityEvent: true };
  }
  if (repository.enabled !== true) return reject('repository_disabled');

  const policy = resolve(descriptor, {
    global: { enabled: true },
    installation: installation.policy && installation.policy[descriptor.command],
    repository: repository.policy && repository.policy[descriptor.command],
  });
  if (!policy.enabled) return reject('command_disabled');

  const permission = await client.actorPermission(installation.id, repository.fullName, normalized.actor.login);
  if (rank(permission) < rank(policy.minimum)) {
    return reject('actor_permission', `Required: ${policy.minimum}. Yours: ${permission}.`);
  }

  return { ok: true, descriptor, installation, repository, permission, minimum: policy.minimum };
}

module.exports = { authorize, reject, REJECTIONS };
