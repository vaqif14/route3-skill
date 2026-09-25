'use strict';

// Indicators are review leads, never a safety verdict or an execution policy.
const INDICATORS = [
  ['prompt_injection', 'high', /ignore\s+(?:all\s+)?(?:previous|prior|system)\s+instructions|(?:system|developer)\s+prompt\s*(?:override|replacement)/i],
  ['policy_override', 'high', /(?:override|bypass|ignore|disable)\s+(?:route3[\s:-]*)?(?:policy|policies|safeguards|safety|approval|sandbox)|dangerously[-_]skip[-_]permissions|--yolo/i],
  ['credential_reading', 'high', /(?:read|cat|open|load|extract)[^\n]{0,80}(?:credentials?|passwords?|api[_-]?keys?|\.env\b)|process\.env\.(?:[A-Z_]*(?:TOKEN|SECRET|KEY))/i],
  ['ssh_key_access', 'high', /(?:~|\$HOME|home)[^\n]{0,50}\.ssh|id_(?:rsa|ed25519)|BEGIN\s+(?:RSA |OPENSSH )?PRIVATE KEY/i],
  ['browser_profile_extraction', 'high', /(?:Chrome|Chromium|Firefox|Safari|browser)[^\n]{0,90}(?:cookies?|Login Data|profiles?|keychain)|Cookies\.sqlite/i],
  ['secret_exfiltration', 'critical', /(?:curl|fetch|requests\.(?:post|get)|https?\.request)[^\n]{0,160}(?:TOKEN|SECRET|password|credentials?|\.env|api[_-]?key)|(?:exfiltrat|send|upload)[^\n]{0,70}(?:secrets?|credentials?|private.key)/i],
  ['curl_pipe_shell', 'critical', /(?:curl|wget)[^\n]{0,250}\|\s*(?:sudo\s+)?(?:ba|z|da|k)?sh\b/i],
  ['remote_code_download', 'high', /(?:curl|wget|fetch|requests\.get)[^\n]{0,160}(?:https?:|\.sh\b|\.py\b|\.js\b)|(?:pip|npm|npx|uvx)\s+(?:install\s+)?(?:https?:|git\+)/i],
  ['shell_interpolation', 'medium', /\$\([^)]{1,200}\)|`[^`\n]{1,200}`|shell\s*[:=]\s*(?:true|True)/],
  ['arbitrary_command_execution', 'high', /\b(?:eval|exec|execSync|os\.system|subprocess\.(?:run|Popen)|child_process)\s*\(?/],
  ['filesystem_escape', 'high', /(?:\.\.\/){2,}|(?:write|open|copy|unlink)[^\n]{0,90}(?:\/etc\/|\/private\/|\/Users\/|\/home\/)/i],
  ['home_destructive_write', 'critical', /(?:rm\s+[^\n]{0,25}-[^\n]{0,12}r[^\n]{0,12}f|rmtree|Remove-Item)[^\n]{0,60}(?:~|\$HOME|\/home\/|\/Users\/)/i],
  ['git_credential_access', 'high', /\.git-credentials|credential\s+(?:fill|approve)|git\s+config[^\n]{0,50}credential/i],
  ['hidden_network', 'high', /(?:curl|wget|fetch|requests\.)[^\n]{0,140}(?:\/dev\/null|2>\s*&1|silent)|(?:telemetry|beacon|webhook)[^\n]{0,100}https?:/i],
  ['postinstall_hook', 'high', /["'](?:postinstall|preinstall|prepare|prepublishOnly)["']\s*:/i],
  ['package_install_script', 'medium', /\b(?:npm|pnpm|yarn|pip|uv|brew)\s+(?:install|add)|\bnpx\s+/i],
  ['auto_update', 'medium', /auto[-_ ]?update|self[-_ ]?update|git\s+pull|(?:npm|pip|brew)\s+(?:update|upgrade)/i],
  ['encoded_payload', 'high', /(?:base64\s+(?:--decode|-d)|b64decode|atob|fromCharCode)\s*\(?|[A-Za-z0-9+/]{200,}={0,2}/],
  ['mcp_tool_poisoning', 'high', /(?:tool|mcp)[^\n]{0,90}(?:description|annotation|result)[^\n]{0,90}(?:ignore|override|secret|execute)|(?:<IMPORTANT>|<system>)[^\n]{0,160}/i],
];

function scanContent(text, { path = 'unknown', maxFindings = 200 } = {}) {
  const lines = String(text).split('\n');
  const findings = [];
  for (let index = 0; index < lines.length; index++) {
    for (const [indicator, severity, pattern] of INDICATORS) {
      if (pattern.test(lines[index])) findings.push({ indicator, severity, path, line: index + 1 });
      if (findings.length >= maxFindings) return { findings, truncated: true, safetyProven: false };
    }
  }
  return { findings, truncated: false, safetyProven: false };
}

const PERMISSIVE = new Set(['MIT', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause', 'ISC', '0BSD', 'Unlicense', 'CC0-1.0']);
function assessCandidate(candidate) {
  const findings = candidate.security?.findings || [];
  let recommendation = 'CATALOG_ONLY';
  let reason = 'Metadata discovery only; static and human review are required before integration.';
  if (findings.some(f => f.severity === 'critical')) {
    recommendation = 'REJECT'; reason = 'Critical static indicators require independent review; the scanner does not establish malicious intent.';
  } else if (candidate.review?.status === 'reviewed') {
    if (!PERMISSIVE.has(candidate.license) || !candidate.licenseEvidence?.length) {
      recommendation = 'ADOPT_PATTERN'; reason = 'License is unknown, unverified at the pinned revision, or requires compatibility review. Independently implement concepts only.';
    } else if (findings.some(f => f.severity === 'high')) {
      recommendation = 'ADOPT_PATTERN'; reason = 'High-risk static indicators prohibit a vendoring recommendation pending human review.';
    } else if (candidate.presence?.mcp === true || /\b(?:cli|sdk|tool)\b/i.test(candidate.description || '')) {
      recommendation = 'WRAP_EXTERNAL_TOOL'; reason = 'Prefer a narrow adapter; this recommendation does not authorize installation or execution.';
    } else if (candidate.presence?.skill === true) {
      recommendation = 'VENDOR_SUBSKILL'; reason = 'A bounded skill appears relevant and permissively licensed; human review, compatibility checks and evals are still required.';
    } else { recommendation = 'ADOPT_PATTERN'; reason = 'Use relevant concepts without adding an external runtime dependency.'; }
  }
  return { recommendation, reason, trust: 'UNTRUSTED', status: 'QUARANTINED', activationAllowed: false, humanReviewed: false, safetyProven: false };
}

module.exports = { INDICATORS, PERMISSIVE, scanContent, assessCandidate };
