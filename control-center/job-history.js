'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { StringDecoder } = require('node:string_decoder');
const { redact } = require('./security');
const clip = (value, bytes) => new StringDecoder('utf8').write(Buffer.from(redact(String(value || ''))).subarray(0, bytes));
class JobHistory {
  constructor(file, workspace) { this.file = file; this.workspace = workspace; }
  read() {
    if (!this.file || !fs.existsSync(this.file)) return [];
    const stat = fs.lstatSync(this.file);
    if (!stat.isFile() || stat.size > 4 * 1024 * 1024) throw new Error('Private job history must be a regular file below 4 MB.');
    const data = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    if (data.version !== 1 || !Array.isArray(data.jobs)) throw new Error('Unsupported private job history.');
    return data.jobs.slice(-100).filter(({job}) => job && /^[0-9a-f-]{36}$/.test(job.id) && typeof job.cwd === 'string' && (job.cwd === this.workspace || job.cwd.startsWith(this.workspace + path.sep))).map(({job,brief}) => ({ job: {...job, permissions: [], ...(['running','awaiting_approval'].includes(job.status) ? { status:'interrupted', endedAt:new Date().toISOString(), stopReason:'server_restart' } : {})}, brief:clip(brief,6000) }));
  }
  write(jobs, briefs) {
    if (!this.file) return;
    fs.mkdirSync(path.dirname(this.file), {recursive:true, mode:0o700});
    if (fs.existsSync(this.file) && !fs.lstatSync(this.file).isFile()) throw new Error('Private job history must be a regular file.');
    const entries = [...jobs.values()].slice(-100).map(job=>({job:{...job, permissions:[], logTail:clip(job.logTail,16000)},brief:clip(briefs.get(job.id),6000)}));
    const temp = `${this.file}.${crypto.randomBytes(8).toString('hex')}.tmp`;
    try { fs.writeFileSync(temp,JSON.stringify({version:1,jobs:entries}),{mode:0o600,flag:'wx'}); fs.renameSync(temp,this.file); }
    finally { try {fs.unlinkSync(temp);} catch {} }
  }
}
module.exports = { JobHistory, clip };
