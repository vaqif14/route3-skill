'use strict';

const { rank } = require('../commands/registry');

const LAYERS = ['global', 'installation', 'repository'];

function mostRestrictive(...permissions) {
  let highest = 'none';
  for (const permission of permissions) {
    if (permission === null || permission === undefined) continue;
    if (rank(permission) < 0) throw new Error(`Unknown permission: ${permission}`);
    if (rank(permission) > rank(highest)) highest = permission;
  }
  return highest;
}

// A layer may restrict. It may never widen: enabled is an AND across layers and
// the minimum permission is the maximum rank across layers.
function resolve(descriptor, layers = {}) {
  const enabled = LAYERS.every(name => !layers[name] || layers[name].enabled !== false);
  const minimum = mostRestrictive(
    descriptor.minimumPermission,
    layers.global && layers.global.minimum,
    layers.installation && layers.installation.minimum,
    layers.repository && layers.repository.minimum,
  );
  return { enabled, minimum };
}

module.exports = { mostRestrictive, resolve, LAYERS };
