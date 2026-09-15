'use strict';

class GitHubError extends Error {
  constructor(message, { statusCode, transient }) {
    super(message);
    this.name = 'GitHubError';
    this.statusCode = statusCode;
    this.transient = Boolean(transient);
  }
}

function createClient({ tokens, fetchImpl = fetch, apiBase = 'https://api.github.com', userAgent = 'route3-gateway' }) {
  // The error message names the method and path only. The token never enters it.
  async function request(installationId, method, path, body) {
    const token = await tokens.get(installationId);
    const response = await fetchImpl(`${apiBase}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        accept: 'application/vnd.github+json',
        'x-github-api-version': '2022-11-28',
        'user-agent': userAgent,
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });

    if (!response.ok) {
      throw new GitHubError(`GitHub ${method} ${path} failed with ${response.status}`, {
        statusCode: response.status,
        transient: response.status >= 500 || response.status === 429,
      });
    }
    if (response.status === 204) return null;
    const text = await response.text();
    return text ? JSON.parse(text) : null;
  }

  return {
    request,
    async actorPermission(installationId, fullName, login) {
      const body = await request(installationId, 'GET', `/repos/${fullName}/collaborators/${login}/permission`);
      return body && typeof body.permission === 'string' ? body.permission : 'none';
    },
    createComment: (installationId, fullName, number, body) =>
      request(installationId, 'POST', `/repos/${fullName}/issues/${number}/comments`, { body }),
    updateComment: (installationId, fullName, commentId, body) =>
      request(installationId, 'PATCH', `/repos/${fullName}/issues/comments/${commentId}`, { body }),
    listComments: (installationId, fullName, number) =>
      request(installationId, 'GET', `/repos/${fullName}/issues/${number}/comments?per_page=100`),
  };
}

module.exports = { GitHubError, createClient };
