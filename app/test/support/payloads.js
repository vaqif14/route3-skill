'use strict';

// A synthetic issue_comment payload with the fields the gateway reads.
function issueComment(overrides = {}) {
  const base = {
    action: 'created',
    installation: { id: 1001 },
    repository: {
      id: 5001, full_name: 'vaqif14/route3-e2e-fixture', default_branch: 'main',
      private: true, owner: { id: 9001, login: 'vaqif14' },
    },
    issue: { number: 42, pull_request: { url: 'https://api.github.com/pulls/42' } },
    comment: { id: 7001, body: '/route3 help' },
    sender: { id: 9001, login: 'vaqif14' },
  };
  return { ...base, ...overrides };
}

module.exports = { issueComment };
