#!/usr/bin/env node
// Route3 native context engine (graft-inspired, zero-dependency, $0 structural core).
//
// Builds a deterministic knowledge graph of a repo — no LLM, no key, no embeddings —
// so dispatched route3-* experts stop "starting blind". Mirrors graft's best traits:
//   - structural pass via regex symbol/import extraction (deterministic)
//   - content-hash cache → incremental, cheap drift detection
//   - reviewable markdown nodes in .workflow/route3/context/nodes/
//   - query surface: map / skeleton / callers / check / pack
// If the real `graft` CLI is installed, ctx-graft.sh prefers it; this is the fallback
// that always works with only Node + git.
//
// Commands:
//   engine.mjs build   [--root DIR]
//   engine.mjs map     [--budget N]
//   engine.mjs skeleton <file>
//   engine.mjs callers  <file|symbol> [--depth N]
//   engine.mjs check   [--root DIR]           (exit 1 if stale)
//   engine.mjs pack    "<task query>" [--k N]
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const SRC_RE = /\.(ts|tsx|js|jsx|mjs|cjs|py|go)$/;
const OUT = '.workflow/route3/context';

function repoRoot(root) {
  try { return execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: root || '.', stdio: ['ignore','pipe','ignore'] }).toString().trim(); }
  catch { return path.resolve(root || '.'); }
}
function listFiles(root) {
  let out = '';
  try { out = execFileSync('git', ['ls-files'], { cwd: root, stdio: ['ignore','pipe','ignore'], maxBuffer: 1 << 28 }).toString(); }
  catch { return []; }
  return out.split('\n').filter(f =>
    SRC_RE.test(f) &&
    !f.includes('node_modules') &&
    !f.startsWith('.')          // exclude tooling dot-dirs (.claude/.agents/.cursor) — product graph only
  );
}
function sha(s) { return createHash('sha256').update(s).digest('hex').slice(0, 16); }
// Single source of truth for reading+hashing so build and check never disagree.
function readBody(root, rel) {
  let body = fs.readFileSync(path.join(root, rel), 'utf8');
  if (body.length > 400_000) body = body.slice(0, 400_000);
  return body;
}

// --- deterministic extraction (no AST dep) ---
function extract(rel, body) {
  const symbols = [];
  const imports = [];
  const ext = rel.split('.').pop();
  const add = (re, i = 1) => { let m; while ((m = re.exec(body))) if (m[i]) symbols.push(m[i]); };
  if (['ts','tsx','js','jsx','mjs','cjs'].includes(ext)) {
    add(/export\s+(?:async\s+)?function\s+([A-Za-z0-9_]+)/g);
    add(/export\s+(?:default\s+)?class\s+([A-Za-z0-9_]+)/g);
    add(/export\s+const\s+([A-Za-z0-9_]+)/g);
    add(/export\s+(?:interface|type|enum)\s+([A-Za-z0-9_]+)/g);
    add(/^\s*(?:async\s+)?function\s+([A-Za-z0-9_]+)/gm);
    let m; const imp = /(?:import\s[^'"]*from\s*|import\s*|export\s[^'"]*from\s*|require\()\s*['"]([^'"]+)['"]/g;
    while ((m = imp.exec(body))) imports.push(m[1]);
  } else if (ext === 'py') {
    add(/^\s*def\s+([A-Za-z0-9_]+)/gm);
    add(/^\s*class\s+([A-Za-z0-9_]+)/gm);
    let m; const imp = /^\s*(?:from\s+([.\w]+)\s+import|import\s+([.\w]+))/gm;
    while ((m = imp.exec(body))) imports.push(m[1] || m[2]);
  } else if (ext === 'go') {
    add(/^\s*func\s+(?:\([^)]*\)\s*)?([A-Za-z0-9_]+)/gm);
    add(/^\s*type\s+([A-Za-z0-9_]+)/gm);
    let m; const imp = /"([^"]+)"/g, blockM = body.match(/import\s*\(([\s\S]*?)\)/);
    if (blockM) while ((m = imp.exec(blockM[1]))) imports.push(m[1]);
  }
  return { symbols: [...new Set(symbols)], imports: [...new Set(imports)] };
}

// resolve a relative import specifier to a tracked repo file
function resolveImport(fromRel, spec, fileSet) {
  if (!spec.startsWith('.')) return null; // external dep — not a node
  const base = path.posix.join(path.posix.dirname(fromRel), spec);
  const cands = [base, base + '.ts', base + '.tsx', base + '.js', base + '.jsx',
    base + '.mjs', base + '/index.ts', base + '/index.tsx', base + '/index.js'];
  for (const c of cands) { const n = path.posix.normalize(c); if (fileSet.has(n)) return n; }
  return null;
}

function buildGraph(root) {
  const files = listFiles(root);
  const fileSet = new Set(files);
  const nodes = {};
  const hashes = {};
  for (const rel of files) {
    let body = '';
    try { body = readBody(root, rel); } catch { continue; }
    const { symbols, imports } = extract(rel, body);
    hashes[rel] = sha(body);
    const deps = [...new Set(imports.map(s => resolveImport(rel, s, fileSet)).filter(Boolean))];
    nodes[rel] = { file: rel, symbols, deps, hash: hashes[rel], loc: body.split('\n').length };
  }
  // reverse edges (fan-in / callers)
  for (const n of Object.values(nodes)) n.importedBy = [];
  for (const n of Object.values(nodes)) for (const d of n.deps) if (nodes[d]) nodes[d].importedBy.push(n.file);
  for (const n of Object.values(nodes)) n.fanIn = n.importedBy.length;
  return { nodes, hashes, builtFiles: files.length };
}

function writeGraph(root, g) {
  const dir = path.join(root, OUT);
  fs.mkdirSync(path.join(dir, 'nodes'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'graph.json'), JSON.stringify(g.nodes));
  fs.writeFileSync(path.join(dir, 'HASHES.json'), JSON.stringify(g.hashes));
  // reviewable markdown nodes for the top hubs (keep it bounded)
  const top = Object.values(g.nodes).sort((a, b) => b.fanIn - a.fanIn).slice(0, 200);
  for (const n of top) {
    const slug = n.file.replace(/[\/.]/g, '_');
    const md = [
      `# ${n.file}`, ``,
      `- loc: ${n.loc}  fan-in: ${n.fanIn}  hash: \`${n.hash}\``, ``,
      `## symbols`, ...(n.symbols.length ? n.symbols.map(s => `- \`${s}\``) : ['- (none extracted)']), ``,
      `## depends_on`, ...(n.deps.length ? n.deps.map(d => `- [[${d}]]`) : ['- (none)']), ``,
      `## imported_by (blast radius)`, ...(n.importedBy.length ? n.importedBy.slice(0, 50).map(d => `- [[${d}]]`) : ['- (leaf)']),
    ].join('\n');
    fs.writeFileSync(path.join(dir, 'nodes', slug + '.md'), md);
  }
  const manifest = { at: new Date().toISOString().replace(/\.\d+Z$/, 'Z'), files: g.builtFiles, nodesWritten: top.length, engine: 'route3-native-v1' };
  // NB: timestamp is stamped by the CLI wrapper in real runs; here it's informational only.
  fs.writeFileSync(path.join(dir, 'MANIFEST.json'), JSON.stringify(manifest, null, 2));
  return { dir, nodesWritten: top.length };
}

function loadGraph(root) {
  const p = path.join(root, OUT, 'graph.json');
  if (!fs.existsSync(p)) throw new Error('no graph — run: engine.mjs build');
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

// --- commands ---
function cmdBuild(root) {
  const t0 = Date.now();
  const g = buildGraph(root);
  const { dir, nodesWritten } = writeGraph(root, g);
  const edges = Object.values(g.nodes).reduce((a, n) => a + n.deps.length, 0);
  console.log(`CTX_BUILD ok files=${g.builtFiles} edges=${edges} nodes_md=${nodesWritten} out=${OUT} ms=${Date.now() - t0}`);
}
function cmdMap(root, budget) {
  const nodes = loadGraph(root);
  const arr = Object.values(nodes);
  const hubs = arr.slice().sort((a, b) => b.fanIn - a.fanIn).slice(0, budget || 20);
  console.log(`CTX_MAP files=${arr.length} — top hubs by fan-in:`);
  for (const h of hubs) console.log(`  ${String(h.fanIn).padStart(4)}  ${h.file}  (${h.symbols.length} sym)`);
  // dir hotspots
  const byDir = {};
  for (const n of arr) { const d = n.file.split('/').slice(0, 2).join('/'); byDir[d] = (byDir[d] || 0) + 1; }
  const hot = Object.entries(byDir).sort((a, b) => b[1] - a[1]).slice(0, 8);
  console.log(`CTX_MAP dir hotspots:`);
  for (const [d, c] of hot) console.log(`  ${String(c).padStart(4)}  ${d}/`);
}
function cmdSkeleton(root, file) {
  const abs = path.join(root, file);
  if (!fs.existsSync(abs)) { console.error(`no such file: ${file}`); process.exit(2); }
  const body = fs.readFileSync(abs, 'utf8');
  const re = /^\s*(export\s+.*|(?:async\s+)?function\s+\w+.*|class\s+\w+.*|interface\s+\w+.*|type\s+\w+\s*=.*|def\s+\w+.*|func\s+.*|const\s+\w+\s*=\s*(?:async\s*)?\(.*)/;
  console.log(`CTX_SKELETON ${file} (signatures only, ~1/10 tokens):`);
  body.split('\n').forEach((l, i) => { if (re.test(l) && l.length < 200) console.log(`  ${String(i + 1).padStart(4)}: ${l.trim()}`); });
}
function cmdCallers(root, target, depth) {
  const nodes = loadGraph(root);
  // target may be a file path or a symbol; resolve symbol → its defining file(s)
  let seeds = [];
  if (nodes[target]) seeds = [target];
  else { for (const n of Object.values(nodes)) if (n.symbols.includes(target)) seeds.push(n.file); }
  if (!seeds.length) { console.error(`CTX_CALLERS: '${target}' not found as file or symbol`); process.exit(1); }
  const seen = new Set(seeds);
  let frontier = seeds, d = 0;
  console.log(`CTX_CALLERS target=${target} seeds=${seeds.join(',')} (blast radius, depth<=${depth}):`);
  while (frontier.length && d < depth) {
    d++;
    const next = [];
    for (const f of frontier) for (const caller of (nodes[f]?.importedBy || [])) if (!seen.has(caller)) { seen.add(caller); next.push(caller); console.log(`  d${d}  ${caller}`); }
    frontier = next;
  }
  console.log(`CTX_CALLERS total_impacted=${seen.size - seeds.length}`);
}
function cmdCheck(root) {
  const cachedP = path.join(root, OUT, 'HASHES.json');
  if (!fs.existsSync(cachedP)) { console.error('no cache — run build'); process.exit(2); }
  const cached = JSON.parse(fs.readFileSync(cachedP, 'utf8'));
  const files = listFiles(root);
  const stale = [], added = [], removed = [];
  const cur = {};
  for (const rel of files) { try { cur[rel] = sha(readBody(root, rel)); } catch {} }
  for (const f of files) { if (!(f in cached)) added.push(f); else if (cached[f] !== cur[f]) stale.push(f); }
  for (const f of Object.keys(cached)) if (!(f in cur)) removed.push(f);
  const drift = stale.length + added.length + removed.length;
  console.log(`CTX_CHECK stale=${stale.length} added=${added.length} removed=${removed.length}`);
  [...stale.map(f => 'M ' + f), ...added.map(f => 'A ' + f), ...removed.map(f => 'D ' + f)].slice(0, 40).forEach(l => console.log('  ' + l));
  process.exit(drift ? 1 : 0);
}
function tokenize(s) { return (s.toLowerCase().match(/[a-z0-9]+/g) || []).filter(t => t.length > 2); }
function cmdPack(root, query, k) {
  const nodes = loadGraph(root);
  const q = new Set(tokenize(query));
  const scored = Object.values(nodes).map(n => {
    // Count DISTINCT query terms matched (not raw frequency) so symbol-heavy
    // files can't inflate. Path hits weigh 3x — a matching filename beats a
    // stray symbol token. Hubs get a small tie-breaker only.
    const pathTok = new Set(tokenize(n.file));
    const symTok = new Set(tokenize(n.symbols.join(' ')));
    let s = 0;
    for (const t of q) { if (pathTok.has(t)) s += 3; else if (symTok.has(t)) s += 1; }
    if (s === 0) return { n, s };
    s += Math.min(n.fanIn, 8) * 0.1;
    return { n, s };
  }).filter(x => x.s > 0).sort((a, b) => b.s - a.s).slice(0, k || 8);
  console.log(`<CONTEXT engine=route3-native query="${query}" nodes=${scored.length}>`);
  for (const { n, s } of scored) {
    console.log(`### ${n.file}  (score=${s.toFixed(2)} fan-in=${n.fanIn})`);
    if (n.symbols.length) console.log(`symbols: ${n.symbols.slice(0, 12).join(', ')}`);
    if (n.deps.length) console.log(`depends_on: ${n.deps.slice(0, 8).join(', ')}`);
  }
  console.log(`</CONTEXT>`);
}

// --- arg parse ---
const [cmd, ...rest] = process.argv.slice(2);
const flag = (name, def) => { const i = rest.indexOf(name); return i >= 0 ? rest[i + 1] : def; };
const root = repoRoot(flag('--root'));
const positional = rest.filter((a, i) => !a.startsWith('--') && !(i > 0 && rest[i - 1].startsWith('--')));
try {
  switch (cmd) {
    case 'build': cmdBuild(root); break;
    case 'map': cmdMap(root, parseInt(flag('--budget', '20'), 10)); break;
    case 'skeleton': cmdSkeleton(root, positional[0]); break;
    case 'callers': cmdCallers(root, positional[0], parseInt(flag('--depth', '2'), 10)); break;
    case 'check': cmdCheck(root); break;
    case 'pack': cmdPack(root, positional[0] || '', parseInt(flag('--k', '8'), 10)); break;
    default:
      console.error('usage: engine.mjs build|map|skeleton <f>|callers <f|sym>|check|pack "<q>"');
      process.exit(2);
  }
} catch (e) { console.error('ENGINE_ERROR:', e.message); process.exit(1); }
