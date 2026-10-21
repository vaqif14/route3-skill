#!/usr/bin/env python3
"""Provider-free local evidence records inspired by OpenJarvis trace primitives.

Independent implementation; no upstream code, model selection, execution, or
personal transcript collection. Local coordinator records are not an auth boundary.
"""
import argparse
from collections import Counter, deque
from contextlib import contextmanager
import copy
import hashlib
import json
import math
import os
from pathlib import Path
import re
import sqlite3
import stat
import sys
import threading

METRICS = ("latency_ms", "input_tokens", "output_tokens", "cost_usd", "energy_j", "flops")
SCOPE = {"project", "domain", "model", "environment"}
KINDS = {"route", "memory", "inference", "tool", "check"}
MAX_JSON = 256 * 1024
SCAN_LIMIT = 500


def require(condition, message):
    if not condition:
        raise ValueError(message)


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True, allow_nan=False)


def digest(value):
    return hashlib.sha256(canonical(value).encode()).hexdigest()


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        require(key not in result, "duplicate JSON key")
        result[key] = value
    return result


def reject_constant(value):
    raise ValueError("nonfinite JSON number")


def loads(raw):
    require(len(raw) <= MAX_JSON, "JSON document exceeds 256 KiB")
    return json.loads(raw, object_pairs_hook=unique_object, parse_constant=reject_constant)


def fields(value, allowed, required=()):
    require(type(value) is dict and set(value) <= set(allowed) and set(required) <= set(value), "missing or unsupported fields")


def redact(value):
    value = re.sub(r"\x1b\[[0-?]*[ -/]*[@-~]", "", value)
    value = re.sub(r"-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?(?:-----END [^-]*PRIVATE KEY-----|$)", "[REDACTED PRIVATE KEY]", value)
    value = re.sub(r"\b(?:Bearer|Basic)\s+[A-Za-z0-9+/=_\-.]+", "[REDACTED AUTH]", value, flags=re.I)
    value = re.sub(r'''((?:["']?)[\w.-]*(?:token|password|secret|api[_-]?key|authorization|cookie)[\w.-]*(?:["']?)\s*[:=]\s*)(?:"[^"\n]*"|'[^'\n]*'|[^\s,;}]+)''', r"\1[REDACTED]", value, flags=re.I)
    value = re.sub(r"\b(?:sk-|sk-ant-|ghp_|github_pat_)[A-Za-z0-9_-]{12,}", "[REDACTED KEY]", value)
    return re.sub(r"[\x00-\x1f\x7f]", " ", value)


def label(value, maximum=256):
    require(type(value) is str and value.strip() and len(value) <= maximum and not re.search(r"[\x00-\x1f\x7f\ud800-\udfff]", value), "invalid label")
    require(redact(value) == value, "secrets are not valid identifiers or scope labels")
    return value


def summary(value=""):
    require(type(value) is str and len(value) <= 1000, "summary must be text below 1001 characters")
    return redact(value)


def scope(value):
    fields(value, SCOPE, SCOPE)
    return {key: label(value[key]) for key in sorted(SCOPE)}


def metrics(value=None):
    value = {} if value is None else value
    fields(value, METRICS)
    result = {}
    for key in METRICS:
        item = value.get(key)
        require(item is None or (type(item) in (int, float) and item >= 0 and (type(item) is int or math.isfinite(item))), "metrics must be finite nonnegative numbers or null")
        if key in ("input_tokens", "output_tokens"):
            require(item is None or type(item) is int, "token counts must be integers")
        if type(item) is int:
            require(item <= 10 ** 100, "metric integer is too large")
        result[key] = item
    return result


def protocol(value):
    keys = {"dataset_sha256", "evaluator_sha256", "environment_sha256", "execution_mode"}
    fields(value, keys, keys)
    require(value["execution_mode"] in ("repository", "recorded_model"), "invalid execution mode")
    for key in keys - {"execution_mode"}:
        require(type(value[key]) is str and re.fullmatch(r"[0-9a-f]{64}", value[key]), "invalid protocol fingerprint")
    return copy.deepcopy(value)


def safe_path(value, create_parent=False):
    require(isinstance(value, (str, Path)) and str(value), "path is required")
    path = Path(os.path.abspath(os.path.expanduser(str(value))))
    require(not any(part in {".ssh", ".aws", ".gnupg", ".git"} or part == ".env" or part.startswith(".env.") or part in {"id_rsa", "id_ed25519", "credentials"} for part in path.parts), "protected path")
    current = Path(path.anchor)
    for index, part in enumerate(path.parts[1:]):
        current = current / part
        final = index == len(path.parts) - 2
        try:
            info = current.lstat()
        except FileNotFoundError:
            if create_parent and not final:
                current.mkdir(mode=0o700)
                continue
            if final:
                break
            raise ValueError("path parent does not exist")
        if stat.S_ISLNK(info.st_mode):
            # macOS system aliases are canonicalized; user-controlled symlinks
            # in all lower path components remain prohibited.
            require(current in (Path("/tmp"), Path("/var"), Path("/etc")), "symlink path is not allowed")
            current = Path(os.path.realpath(current))
        elif not final:
            require(stat.S_ISDIR(info.st_mode), "path parent is not a directory")
    return current


class EvidenceCache(set):
    def __init__(self):
        super().__init__()
        self.bytes = 0


def evidence(value, cache=None):
    require(type(value) is list and len(value) <= 8, "evidence must contain at most 8 references per record")
    result = []
    for item in value:
        fields(item, {"path", "sha256"}, {"path", "sha256"})
        require(type(item["path"]) is str and Path(item["path"]).is_absolute(), "evidence requires an explicit absolute path")
        require(type(item["sha256"]) is str and re.fullmatch(r"[0-9a-f]{64}", item["sha256"]), "invalid evidence digest")
        path = safe_path(item["path"])
        key = (str(path), item["sha256"])
        if cache is None or key not in cache:
            info = path.lstat()
            require(stat.S_ISREG(info.st_mode) and info.st_size <= 8 * 1024 * 1024, "evidence must be a regular file below 8 MiB")
            require(cache is None or (len(cache) < 256 and cache.bytes + info.st_size <= 64 * 1024 * 1024), "operation exceeds evidence verification budget")
            fd = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_NONBLOCK", 0))
            try:
                info = os.fstat(fd)
                require(stat.S_ISREG(info.st_mode) and info.st_size <= 8 * 1024 * 1024, "evidence must be a regular file below 8 MiB")
                hasher = hashlib.sha256()
                read_bytes = 0
                with os.fdopen(fd, "rb", closefd=False) as stream:
                    for block in iter(lambda: stream.read(65536), b""):
                        read_bytes += len(block)
                        require(read_bytes <= 8 * 1024 * 1024 and (cache is None or cache.bytes + read_bytes <= 64 * 1024 * 1024), "evidence read exceeds verification budget")
                        hasher.update(block)
                require(hasher.hexdigest() == item["sha256"], "evidence fingerprint mismatch")
            finally:
                os.close(fd)
            if cache is not None:
                cache.add(key)
                cache.bytes += read_bytes
        result.append({"path": str(path), "sha256": item["sha256"]})
    return result


def normalize_trace(value, cache=None):
    fields(value, {"schema_version", "id", "scope", "capability", "strategy", "outcome", "summary", "parent_id", "metrics", "metrics_scope", "steps", "evidence", "evaluation", "protocol"}, {"schema_version", "id", "scope", "capability", "strategy", "outcome", "steps"})
    require(type(value["schema_version"]) is int and value["schema_version"] == 1, "unsupported schema version")
    require(type(value["outcome"]) is str and value["outcome"] in {"completed", "failed", "cancelled", "unknown"}, "invalid execution outcome")
    require(value.get("metrics_scope", "self") == "self", "only self metrics are accepted")
    require(type(value["steps"]) is list and len(value["steps"]) <= 64, "steps must contain at most 64 ordered records")
    result = {"schema_version": 1, "id": label(value["id"]), "scope": scope(value["scope"]), "capability": label(value["capability"]), "strategy": label(value["strategy"]), "outcome": value["outcome"], "summary": summary(value.get("summary", "")), "parent_id": label(value["parent_id"]) if value.get("parent_id") is not None else None, "metrics_scope": "self", "metrics": metrics(value.get("metrics")), "evidence": evidence(value.get("evidence", []), cache), "steps": [], "evaluation": None, "protocol": protocol(value["protocol"]) if value.get("protocol") is not None else None}
    for index, step in enumerate(value["steps"]):
        fields(step, {"kind", "summary", "metrics", "metrics_scope", "evidence"}, {"kind"})
        require(type(step["kind"]) is str and step["kind"] in KINDS, "invalid step kind")
        require(step.get("metrics_scope", "self") == "self", "only self step metrics are accepted")
        result["steps"].append({"kind": step["kind"], "summary": summary(step.get("summary", "")), "metrics": metrics(step.get("metrics")), "metrics_scope": "self", "evidence": evidence(step.get("evidence", []), cache)})
    if value.get("evaluation") is not None:
        evaluation = value["evaluation"]
        fields(evaluation, {"status", "critical", "evaluator_sha256", "evidence"}, {"status", "critical", "evaluator_sha256", "evidence"})
        require(type(evaluation["status"]) is str and evaluation["status"] in {"passed", "failed", "error", "not_run"}, "invalid explicit evaluation")
        require(type(evaluation["critical"]) is bool and type(evaluation["evaluator_sha256"]) is str and re.fullmatch(r"[0-9a-f]{64}", evaluation["evaluator_sha256"]), "evaluation needs critical flag and evaluator fingerprint")
        refs = evidence(evaluation["evidence"], cache)
        require(evaluation["status"] not in {"passed", "failed"} or refs, "graded evaluation requires actual evidence")
        require(result["protocol"] is None or evaluation["evaluator_sha256"] == result["protocol"]["evaluator_sha256"], "evaluation/protocol mismatch")
        result["evaluation"] = {**evaluation, "evidence": refs}
    require(sum(len(item["evidence"]) for item in result["steps"]) + len(result["evidence"]) + len((result["evaluation"] or {}).get("evidence", [])) <= 64, "trace exceeds 64 evidence references")
    return result


def normalize_feedback(value, cache=None):
    fields(value, {"schema_version", "id", "trace_id", "source", "reviewer", "score", "outcome", "summary", "evidence"}, {"schema_version", "id", "trace_id", "source", "reviewer"})
    require(type(value["schema_version"]) is int and value["schema_version"] == 1, "unsupported schema version")
    score = value.get("score")
    require(score is None or (type(score) in (int, float) and 0 <= score <= 1 and math.isfinite(score)), "feedback score must be finite in 0..1")
    outcome = summary(value.get("outcome", ""))
    require(score is not None or outcome.strip(), "feedback needs an explicit score or textual outcome")
    return {"schema_version": 1, "id": label(value["id"]), "trace_id": label(value["trace_id"]), "source": label(value["source"]), "reviewer": label(value["reviewer"]), "score": score, "outcome": outcome, "summary": summary(value.get("summary", "")), "evidence": evidence(value.get("evidence", []), cache)}


class EventBus:
    """Optional bounded local observers; storage never subscribes to itself."""
    def __init__(self, history_limit=0):
        require(type(history_limit) is int and 0 <= history_limit <= 1000, "invalid history bound")
        self._history = deque(maxlen=history_limit)
        self._subscribers = []
        self._lock = threading.Lock()
        self.observer_errors = 0

    def subscribe(self, kind, callback):
        require(callable(callback), "observer must be callable")
        with self._lock:
            require(len(self._subscribers) < 32, "observer bound reached")
            entry = (kind, callback)
            self._subscribers.append(entry)
        def unsubscribe():
            with self._lock:
                if entry in self._subscribers:
                    self._subscribers.remove(entry)
        return unsubscribe

    @property
    def history(self):
        with self._lock:
            return copy.deepcopy(list(self._history))

    def emit(self, event):
        fields(event, {"kind", "trace_id", "step_index", "step_kind", "feedback_id"}, {"kind", "trace_id"})
        label(event["kind"], 64)
        label(event["trace_id"])
        if "feedback_id" in event:
            label(event["feedback_id"])
        if "step_index" in event:
            require(type(event["step_index"]) is int and 0 <= event["step_index"] < 64, "invalid event step index")
        if "step_kind" in event:
            require(type(event["step_kind"]) is str and event["step_kind"] in KINDS, "invalid event step kind")
        with self._lock:
            self._history.append(copy.deepcopy(event))
            callbacks = list(self._subscribers)
        for kind, callback in callbacks:
            if kind in ("*", event["kind"]):
                try:
                    callback(copy.deepcopy(event))
                except Exception:
                    with self._lock:
                        self.observer_errors += 1


class TraceStore:
    def __init__(self, db_path, bus=None):
        self.path = safe_path(db_path, create_parent=True)
        self.bus = bus or EventBus()
        if not self.path.exists():
            try:
                fd = os.open(self.path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0), 0o600)
                os.close(fd)
            except FileExistsError:
                pass  # Another coordinator may have initialized this path first.
        info = self.path.lstat()
        require(stat.S_ISREG(info.st_mode) and info.st_nlink == 1 and info.st_mode & 0o077 == 0, "database must be a private regular file")
        with self.connection() as db:
            version = db.execute("PRAGMA user_version").fetchone()[0]
            require(version in (0, 1), "unsupported database version")
            db.executescript("""
                CREATE TABLE IF NOT EXISTS traces(id TEXT PRIMARY KEY, scope TEXT NOT NULL, payload TEXT NOT NULL, payload_hash TEXT NOT NULL, input_hash TEXT NOT NULL);
                CREATE INDEX IF NOT EXISTS trace_scope ON traces(scope);
                CREATE TABLE IF NOT EXISTS feedback(id TEXT PRIMARY KEY, trace_id TEXT NOT NULL REFERENCES traces(id), payload TEXT NOT NULL, payload_hash TEXT NOT NULL, input_hash TEXT NOT NULL);
                CREATE INDEX IF NOT EXISTS feedback_trace ON feedback(trace_id);
                CREATE TRIGGER IF NOT EXISTS trace_no_update BEFORE UPDATE ON traces BEGIN SELECT RAISE(ABORT,'immutable trace'); END;
                CREATE TRIGGER IF NOT EXISTS trace_no_delete BEFORE DELETE ON traces BEGIN SELECT RAISE(ABORT,'immutable trace'); END;
                CREATE TRIGGER IF NOT EXISTS feedback_no_update BEFORE UPDATE ON feedback BEGIN SELECT RAISE(ABORT,'immutable feedback'); END;
                CREATE TRIGGER IF NOT EXISTS feedback_no_delete BEFORE DELETE ON feedback BEGIN SELECT RAISE(ABORT,'immutable feedback'); END;
                PRAGMA user_version=1;
            """)

    @contextmanager
    def connection(self, write=False):
        require(safe_path(self.path) == self.path, "database path changed")
        info = self.path.lstat()
        require(stat.S_ISREG(info.st_mode) and info.st_nlink == 1 and info.st_mode & 0o077 == 0, "unsafe database file")
        for suffix in ("-journal", "-wal", "-shm"):
            sibling = Path(str(self.path) + suffix)
            if sibling.exists() or sibling.is_symlink():
                require(stat.S_ISREG(sibling.lstat().st_mode), "unsafe SQLite sidecar")
        db = sqlite3.connect(str(self.path), timeout=5, isolation_level=None)
        try:
            db.execute("PRAGMA foreign_keys=ON")
            db.execute("PRAGMA trusted_schema=OFF")
            db.execute("BEGIN IMMEDIATE" if write else "BEGIN")
            yield db
            if db.in_transaction:
                db.commit()
        except BaseException:
            if db.in_transaction:
                db.rollback()
            raise
        finally:
            db.close()

    def _decode(self, row, kind, cache):
        require(row is not None, "unknown " + kind)
        value = loads(row[0])
        require(digest(value) == row[1], "stored payload fingerprint mismatch")
        normalized = normalize_trace(value, cache) if kind == "trace" else normalize_feedback(value, cache)
        require(normalized == value, "stored record is not canonical")
        return value

    def _trace(self, db, trace_id, cache):
        value = self._decode(db.execute("SELECT payload,payload_hash FROM traces WHERE id=?", (label(trace_id),)).fetchone(), "trace", cache)
        require(value["id"] == trace_id, "trace identity mismatch")
        return value

    def record(self, value):
        cache = EvidenceCache()
        normalized = normalize_trace(value, cache)
        require(len(canonical(value)) <= MAX_JSON, "trace exceeds input bound")
        raw_hash = digest(value)
        value = normalized
        inserted = False
        with self.connection(write=True) as db:
            old = db.execute("SELECT input_hash FROM traces WHERE id=?", (value["id"],)).fetchone()
            if old:
                require(old[0] == raw_hash, "trace id already has different content")
                value = self._trace(db, value["id"], cache)
            else:
                require(db.execute("SELECT COUNT(*) FROM traces").fetchone()[0] < 10000, "trace store bound reached")
                if value["parent_id"] is not None:
                    parent = self._trace(db, value["parent_id"], cache)
                    require(parent["scope"] == value["scope"], "parent scope mismatch")
                db.execute("INSERT INTO traces VALUES(?,?,?,?,?)", (value["id"], canonical(value["scope"]), canonical(value), digest(value), raw_hash))
                inserted = True
        if inserted:
            self.bus.emit({"kind": "trace.recorded", "trace_id": value["id"]})
            for index, step in enumerate(value["steps"]):
                self.bus.emit({"kind": "trace.step", "trace_id": value["id"], "step_index": index, "step_kind": step["kind"]})
        return {"inserted": inserted, "trace": value}

    def feedback(self, value):
        cache = EvidenceCache()
        normalized = normalize_feedback(value, cache)
        require(len(canonical(value)) <= MAX_JSON, "feedback exceeds input bound")
        raw_hash = digest(value)
        value = normalized
        inserted = False
        with self.connection(write=True) as db:
            self._trace(db, value["trace_id"], cache)
            old = db.execute("SELECT input_hash,payload,payload_hash FROM feedback WHERE id=?", (value["id"],)).fetchone()
            if old:
                require(old[0] == raw_hash, "feedback id already has different content")
                value = self._decode(old[1:], "feedback", cache)
            else:
                require(db.execute("SELECT COUNT(*) FROM feedback WHERE trace_id=?", (value["trace_id"],)).fetchone()[0] < 20, "feedback per-trace bound reached")
                db.execute("INSERT INTO feedback VALUES(?,?,?,?,?)", (value["id"], value["trace_id"], canonical(value), digest(value), raw_hash))
                inserted = True
        if inserted:
            self.bus.emit({"kind": "feedback.recorded", "trace_id": value["trace_id"], "feedback_id": value["id"]})
        return {"inserted": inserted, "feedback": value}

    def get(self, trace_id):
        cache = EvidenceCache()
        with self.connection() as db:
            trace = self._trace(db, trace_id, cache)
            feedback = [self._decode(row, "feedback", cache) for row in db.execute("SELECT payload,payload_hash FROM feedback WHERE trace_id=? ORDER BY rowid", (trace_id,))]
        return {"trace": trace, "feedback": feedback}

    def _scoped(self, db, requested_scope, cache):
        selected = scope(requested_scope)
        count = db.execute("SELECT COUNT(*) FROM traces WHERE scope=?", (canonical(selected),)).fetchone()[0]
        rows = db.execute("SELECT payload,payload_hash FROM traces WHERE scope=? ORDER BY rowid DESC LIMIT ?", (canonical(selected), SCAN_LIMIT)).fetchall()
        traces = [self._decode(row, "trace", cache) for row in rows]
        require(all(trace["scope"] == selected for trace in traces), "stored scope mismatch")
        return traces, {"matched": count, "scanned": len(traces), "scan_limit": SCAN_LIMIT, "truncated": count > len(traces)}

    @staticmethod
    def _refs(trace):
        return trace["evidence"] + [ref for step in trace["steps"] for ref in step["evidence"]] + (trace["evaluation"] or {}).get("evidence", [])

    def search(self, requested_scope, query="", limit=10):
        require(type(query) is str and len(query) <= 256 and type(limit) is int and 1 <= limit <= 100, "invalid query or limit")
        with self.connection() as db:
            traces, coverage = self._scoped(db, requested_scope, EvidenceCache())
        matches = [trace for trace in traces if self._refs(trace) and query.casefold() in " ".join([trace["summary"], trace["capability"], trace["strategy"]] + [step["summary"] for step in trace["steps"]]).casefold()]
        return {"scope": scope(requested_scope), "coverage": coverage, "results": matches[:limit], "matched_in_scan": len(matches), "experience_policy": "Verified artifacts only; execution outcomes and feedback are not permanent facts or automatic instructions."}

    def report(self, requested_scope):
        cache = EvidenceCache()
        with self.connection() as db:
            traces, coverage = self._scoped(db, requested_scope, cache)
            feedback = [self._decode(row, "feedback", cache) for trace in traces for row in db.execute("SELECT payload,payload_hash FROM feedback WHERE trace_id=?", (trace["id"],))]
        measured = {}
        for name in METRICS:
            values = [trace["metrics"][name] for trace in traces if trace["metrics"][name] is not None]
            total = sum(values) if values else None
            overflow = type(total) is float and not math.isfinite(total)
            mean = None if not values or overflow else total / len(values)
            measured[name] = {"measured_count": len(values), "total_count": len(traces), "sum": None if overflow else total, "mean": mean, "aggregation_issue": "aggregate_overflow" if overflow else None}
        graded = [trace for trace in traces if trace["evaluation"] and trace["evaluation"]["status"] in {"passed", "failed"}]
        return {"scope": scope(requested_scope), "coverage": coverage, "execution_outcomes": dict(Counter(trace["outcome"] for trace in traces)), "evaluation": {"graded": len(graded), "passed": sum(trace["evaluation"]["status"] == "passed" for trace in graded), "failed": sum(trace["evaluation"]["status"] == "failed" for trace in graded), "critical_failures": [trace["id"] for trace in graded if trace["evaluation"]["critical"] and trace["evaluation"]["status"] == "failed"], "ungraded": len(traces) - len(graded)}, "check_coverage": {"traces_with_checks": sum(any(step["kind"] == "check" for step in trace["steps"]) for trace in traces), "evidence_backed_traces": sum(bool(self._refs(trace)) for trace in traces)}, "metrics": measured, "feedback_count": len(feedback), "metric_policy": "Root self metrics only; no step, child, parent or inclusive-host metric rollup."}

    def export_report(self, mapping):
        fields(mapping, {"schema_version", "run_id", "scope", "capability", "subject", "protocol", "cases"}, {"schema_version", "run_id", "scope", "capability", "subject", "protocol", "cases"})
        require(type(mapping["schema_version"]) is int and mapping["schema_version"] == 1, "unsupported mapping version")
        frozen = protocol(mapping["protocol"])
        selected = scope(mapping["scope"])
        require(type(mapping["cases"]) is list and 1 <= len(mapping["cases"]) <= 500, "mapping needs 1..500 cases")
        result = {"schema_version": 1, "run_id": label(mapping["run_id"]), "capability": label(mapping["capability"]), "subject": label(mapping["subject"]), "protocol": frozen, "cases": []}
        seen, used, cache = set(), set(), EvidenceCache()
        with self.connection() as db:
            for case in mapping["cases"]:
                fields(case, {"id", "trace_id", "critical"}, {"id", "trace_id", "critical"})
                cid = label(case["id"])
                require(cid not in seen and type(case["critical"]) is bool, "duplicate case or invalid critical flag")
                seen.add(cid)
                output = {"id": cid, "critical": case["critical"], "status": "not_run", "evidence": [], "metrics": {key: None for key in ("duration_ms", "input_tokens", "output_tokens", "cost_usd")}}
                if case["trace_id"] is not None:
                    label(case["trace_id"])
                    require(case["trace_id"] not in used, "trace cannot represent multiple cases")
                    used.add(case["trace_id"])
                    trace = self._trace(db, case["trace_id"], cache)
                    require(trace["scope"] == selected and trace["protocol"] == frozen and trace["capability"] == result["capability"], "mapped trace scope, capability or protocol mismatch")
                    evaluation = trace["evaluation"]
                    if evaluation:
                        require(evaluation["critical"] == case["critical"] and evaluation["evaluator_sha256"] == frozen["evaluator_sha256"], "evaluation/critical protocol mismatch")
                        output["status"], output["evidence"] = evaluation["status"], evaluation["evidence"]
                    elif trace["outcome"] != "completed":
                        output["status"] = "error"
                    output["metrics"] = {"duration_ms": trace["metrics"]["latency_ms"], **{key: trace["metrics"][key] for key in ("input_tokens", "output_tokens", "cost_usd")}}
                result["cases"].append(output)
        return result


def load_file(path):
    path = safe_path(path)
    require(stat.S_ISREG(path.stat().st_mode) and path.stat().st_size <= MAX_JSON, "input must be a regular JSON file below 256 KiB")
    fd = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_NONBLOCK", 0))
    try:
        require(stat.S_ISREG(os.fstat(fd).st_mode), "input must remain a regular file")
        with os.fdopen(fd, "rb", closefd=False) as stream:
            return loads(stream.read(MAX_JSON + 1))
    finally:
        os.close(fd)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db", required=True, help="private local SQLite file")
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("init")
    for name in ("record", "feedback", "export-report"):
        commands.add_parser(name).add_argument("--file", required=True)
    search = commands.add_parser("search")
    search.add_argument("--scope", required=True)
    search.add_argument("--query", default="")
    search.add_argument("--limit", type=int, default=10)
    commands.add_parser("report").add_argument("--scope", required=True)
    commands.add_parser("show").add_argument("--trace-id", required=True)
    args = parser.parse_args(argv)
    try:
        store = TraceStore(args.db)
        if args.command == "init":
            result = {"schema_version": 1, "db": str(store.path), "status": "ready"}
        elif args.command in ("record", "feedback", "export-report"):
            method = {"record": store.record, "feedback": store.feedback, "export-report": store.export_report}[args.command]
            result = method(load_file(args.file))
        elif args.command == "show":
            result = store.get(args.trace_id)
        elif args.command == "search":
            result = store.search(load_file(args.scope), args.query, args.limit)
        else:
            result = store.report(load_file(args.scope))
        print(json.dumps(result, ensure_ascii=True, allow_nan=False))
        return 0
    except (ValueError, OSError, sqlite3.Error, OverflowError, RecursionError, TypeError) as error:
        print(json.dumps({"error": summary(str(error)[:1000]), "status": "rejected"}), file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
