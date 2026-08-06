#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");

const PKG_ROOT = path.resolve(__dirname, "..");
const SKILL_SRC = path.join(PKG_ROOT, "skill");
const AGENTS_SRC = path.join(PKG_ROOT, "agents");
const SKILL_NAME = "route3";

function parseArgs(argv) {
  const args = { cmd: "help", quiet: false, dryRun: false, targets: null };
  const rest = argv.slice(2);
  if (rest.length === 0) {
    args.cmd = "install";
    return args;
  }
  args.cmd = rest[0];
  for (let i = 1; i < rest.length; i++) {
    const a = rest[i];
    if (a === "--quiet" || a === "-q") args.quiet = true;
    else if (a === "--dry-run") args.dryRun = true;
    else if (a === "--claude") args.targets = (args.targets || []).concat("claude");
    else if (a === "--cursor") args.targets = (args.targets || []).concat("cursor");
    else if (a === "--all") args.targets = ["claude", "cursor"];
  }
  return args;
}

function log(quiet, msg) {
  if (!quiet) console.log(msg);
}

function rimraf(target, dryRun) {
  if (!fs.existsSync(target)) return;
  if (dryRun) return;
  fs.rmSync(target, { recursive: true, force: true });
}

function copyRecursive(src, dest, dryRun) {
  if (dryRun) return;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.cpSync(src, dest, { recursive: true, force: true });
}

function chmodScripts(skillDest, dryRun) {
  const scriptsDir = path.join(skillDest, "scripts");
  if (!fs.existsSync(scriptsDir)) return;
  for (const name of fs.readdirSync(scriptsDir)) {
    if (!name.endsWith(".sh")) continue;
    const p = path.join(scriptsDir, name);
    if (dryRun) continue;
    try { fs.chmodSync(p, 0o755); } catch (_) {}
  }
}

function targetsFor(args) {
  if (args.targets && args.targets.length) return args.targets;
  return ["claude", "cursor"];
}

function skillPaths(home, target) {
  if (target === "claude") {
    return {
      skill: path.join(home, ".claude", "skills", SKILL_NAME),
      agents: path.join(home, ".claude", "agents", SKILL_NAME),
    };
  }
  if (target === "cursor") {
    return {
      skill: path.join(home, ".cursor", "skills", SKILL_NAME),
      agents: path.join(home, ".cursor", "agents", SKILL_NAME),
    };
  }
  throw new Error("unknown target: " + target);
}

function install(args) {
  if (!fs.existsSync(path.join(SKILL_SRC, "SKILL.md"))) {
    console.error("route3-skill: skill/SKILL.md missing in package");
    process.exit(1);
  }
  const home = os.homedir();
  for (const t of targetsFor(args)) {
    const paths = skillPaths(home, t);
    log(args.quiet, "Installing Route3 → " + paths.skill);
    if (!args.dryRun) {
      rimraf(paths.skill, false);
      rimraf(paths.agents, false);
      copyRecursive(SKILL_SRC, paths.skill, false);
      if (fs.existsSync(AGENTS_SRC)) copyRecursive(AGENTS_SRC, paths.agents, false);
      chmodScripts(paths.skill, false);
    } else {
      log(args.quiet, "[dry-run] would copy skill → " + paths.skill);
      log(args.quiet, "[dry-run] would copy agents → " + paths.agents);
    }
  }
  log(args.quiet, "Route3 skill installed. In chat: /route3 <task>");
}

function uninstall(args) {
  const home = os.homedir();
  for (const t of targetsFor(args)) {
    const paths = skillPaths(home, t);
    log(args.quiet, "Removing Route3 ← " + paths.skill);
    rimraf(paths.skill, args.dryRun);
    rimraf(paths.agents, args.dryRun);
  }
  log(args.quiet, "Route3 skill uninstalled.");
}

function help() {
  console.log(`route3-skill — install the Route3 orchestrator skill

Usage:
  npx route3-skill install [--claude] [--cursor] [--all] [--dry-run] [--quiet]
  npx route3-skill uninstall [--claude] [--cursor] [--all] [--quiet]
  npm install -g route3-skill

Installs to:
  ~/.claude/skills/route3 + ~/.claude/agents/route3
  ~/.cursor/skills/route3 + ~/.cursor/agents/route3

Then invoke: /route3 <your task>
`);
}

const args = parseArgs(process.argv);
switch (args.cmd) {
  case "install":
  case "i":
    install(args);
    break;
  case "uninstall":
  case "remove":
  case "rm":
    uninstall(args);
    break;
  case "help":
  case "--help":
  case "-h":
    help();
    break;
  default:
    console.error("Unknown command:", args.cmd);
    help();
    process.exit(1);
}
