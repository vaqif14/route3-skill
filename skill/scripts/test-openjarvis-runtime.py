#!/usr/bin/env python3
"""Deterministic local evidence tests; no models, network, or hardware probes."""
from concurrent.futures import ThreadPoolExecutor
import copy
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import unittest

sys.dont_write_bytecode = True
SCRIPT = Path(__file__).with_name("openjarvis-runtime.py")
SPEC = importlib.util.spec_from_file_location("route3_openjarvis", SCRIPT)
RUNTIME = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(RUNTIME)
COMPARE_SPEC = importlib.util.spec_from_file_location("route3_compare", SCRIPT.with_name("compare-runs.py"))
COMPARE = importlib.util.module_from_spec(COMPARE_SPEC)
COMPARE_SPEC.loader.exec_module(COMPARE)


class RuntimeTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="route3-openjarvis-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(os.path.realpath(self.temp.name))
        self.artifact = self.root / "check.txt"
        self.artifact.write_text("actual local deterministic check evidence\n")
        self.ref = {"path": str(self.artifact), "sha256": hashlib.sha256(self.artifact.read_bytes()).hexdigest()}
        self.scope = {"project": "project-a", "domain": "code", "model": "configured-host-model", "environment": "fixture-v1"}
        self.protocol = {"dataset_sha256": "a" * 64, "evaluator_sha256": "b" * 64, "environment_sha256": "c" * 64, "execution_mode": "repository"}
        self.db = self.root / "state" / "traces.sqlite"
        self.bus = RUNTIME.EventBus(history_limit=3)
        self.store = RUNTIME.TraceStore(self.db, bus=self.bus)

    def trace(self, identity="one", **extra):
        value = {"schema_version": 1, "id": identity, "scope": copy.deepcopy(self.scope), "capability": "native-host", "strategy": "review-then-check", "outcome": "completed", "summary": "Checked the local artifact", "steps": [{"kind": "route"}, {"kind": "check", "evidence": [self.ref]}], "metrics": {"latency_ms": 10, "input_tokens": 0}, "protocol": self.protocol}
        value.update(extra)
        return value

    def evaluation(self, status="passed", critical=False):
        return {"status": status, "critical": critical, "evaluator_sha256": self.protocol["evaluator_sha256"], "evidence": [self.ref]}

    def feedback(self, identity="fb", trace_id="one", **extra):
        value = {"schema_version": 1, "id": identity, "trace_id": trace_id, "source": "human", "reviewer": "local-owner", "score": 1, "summary": "Owner feedback", "evidence": [self.ref]}
        value.update(extra)
        return value

    def mapping(self, run_id="run-a", subject="revision-a", cases=None):
        return {"schema_version": 1, "run_id": run_id, "scope": self.scope, "capability": "native-host", "subject": subject, "protocol": self.protocol, "cases": cases if cases is not None else [{"id": "case-one", "trace_id": "one", "critical": False}]}

    def write(self, value, name):
        path = self.root / name
        path.write_text(json.dumps(value))
        return path

    def cli(self, *args):
        result = subprocess.run([sys.executable, str(SCRIPT), "--db", str(self.db), *map(str, args)], capture_output=True, text=True, timeout=10)
        return result, json.loads(result.stdout if result.returncode == 0 else result.stderr)

    def test_immutable_idempotent_rows_and_correlated_observers(self):
        observed = []
        self.bus.subscribe("*", lambda event: observed.append(event))
        self.bus.subscribe("trace.recorded", lambda event: (_ for _ in ()).throw(RuntimeError("observer failed")))
        trace = self.trace()
        self.assertTrue(self.store.record(trace)["inserted"])
        self.assertFalse(self.store.record(trace)["inserted"])
        self.assertEqual(len(observed), 3)
        self.assertEqual(observed[-1], {"kind": "trace.step", "trace_id": "one", "step_index": 1, "step_kind": "check"})
        self.assertEqual(self.bus.observer_errors, 1)
        self.assertEqual(len(self.bus.history), 3)
        with self.assertRaises(ValueError):
            self.store.record(self.trace(summary="different"))
        self.assertEqual(self.store.get("one")["trace"]["summary"], trace["summary"])
        with sqlite3.connect(self.db) as db:
            with self.assertRaises(sqlite3.IntegrityError):
                db.execute("UPDATE traces SET scope='changed'")
        self.assertEqual(self.db.stat().st_mode & 0o777, 0o600)
        self.assertEqual(self.db.parent.stat().st_mode & 0o777, 0o700)

    def test_event_history_is_bounded_correlated_and_isolated_from_observer_mutation(self):
        bus = RUNTIME.EventBus(history_limit=2)
        bus.subscribe("*", lambda event: event.update(trace_id="changed"))
        observed = []
        unsubscribe = bus.subscribe("*", lambda event: observed.append(event))
        for identity in ("one", "two", "three"):
            bus.emit({"kind": "trace.recorded", "trace_id": identity})
        self.assertEqual([event["trace_id"] for event in bus.history], ["two", "three"])
        self.assertEqual(observed[-1]["trace_id"], "three")
        unsubscribe()
        bus.emit({"kind": "trace.recorded", "trace_id": "four"})
        self.assertEqual(len(observed), 3)
        for invalid in [{"kind": "trace.recorded"}, {"kind": "trace.recorded", "trace_id": "one", "raw_transcript": "private"}, {"kind": "trace.step", "trace_id": "one", "step_index": -1}]:
            with self.assertRaises(ValueError):
                bus.emit(invalid)
        self.assertEqual(self.store.report(self.scope)["coverage"]["matched"], 0)

    def test_execution_is_not_evaluation_and_feedback_cannot_hide_critical_failure(self):
        self.store.record(self.trace(evaluation=self.evaluation("failed", True)))
        first = self.store.feedback(self.feedback())
        self.assertTrue(first["inserted"])
        self.assertFalse(self.store.feedback(self.feedback())["inserted"])
        with self.assertRaises(ValueError):
            self.store.feedback(self.feedback(score=0.1))
        report = self.store.report(self.scope)
        self.assertEqual(report["execution_outcomes"], {"completed": 1})
        self.assertEqual(report["evaluation"]["critical_failures"], ["one"])
        self.assertEqual(report["evaluation"]["failed"], 1)
        self.assertEqual(report["feedback_count"], 1)
        self.store.record(self.trace("ungraded", evidence=[], steps=[]))
        self.assertEqual(self.store.report(self.scope)["evaluation"]["ungraded"], 1)
        result = self.store.export_report(self.mapping(cases=[{"id": "critical", "trace_id": "one", "critical": True}, {"id": "ungraded", "trace_id": "ungraded", "critical": False}, {"id": "missing", "trace_id": None, "critical": True}]))
        self.assertEqual([case["status"] for case in result["cases"]], ["failed", "not_run", "not_run"])

    def test_step_metrics_never_roll_up_and_unknown_metrics_keep_coverage(self):
        value = self.trace()
        value["steps"][0]["metrics"] = {"latency_ms": 100, "cost_usd": 100}
        value["steps"][1]["metrics"] = {"latency_ms": 100, "cost_usd": 100}
        self.store.record(value)
        self.store.record(self.trace("unknown", outcome="unknown", metrics={}))
        report = self.store.report(self.scope)
        self.assertEqual(report["metrics"]["latency_ms"], {"measured_count": 1, "total_count": 2, "sum": 10, "mean": 10.0, "aggregation_issue": None})
        self.assertIsNone(report["metrics"]["cost_usd"]["sum"])
        self.assertIsNone(report["metrics"]["energy_j"]["mean"])
        self.assertEqual(report["metrics"]["input_tokens"]["measured_count"], 1)
        self.assertEqual(report["metrics"]["input_tokens"]["mean"], 0)
        other = {**self.scope, "project": "empty"}
        self.assertIsNone(self.store.report(other)["metrics"]["latency_ms"]["mean"])
        self.store.record(self.trace("large-one", metrics={"cost_usd": 1e308}))
        self.store.record(self.trace("large-two", metrics={"cost_usd": 1e308}))
        overflow = self.store.report(self.scope)["metrics"]["cost_usd"]
        self.assertEqual(overflow["aggregation_issue"], "aggregate_overflow")
        self.assertIsNone(overflow["sum"]); self.assertIsNone(overflow["mean"])

    def test_exact_scope_and_verified_experience_only(self):
        self.store.record(self.trace())
        self.store.record(self.trace("without-evidence", evidence=[], steps=[]))
        for field in self.scope:
            self.store.record(self.trace("other-" + field, scope={**self.scope, field: "different"}))
        result = self.store.search(self.scope, "artifact")
        self.assertEqual([trace["id"] for trace in result["results"]], ["one"])
        self.assertEqual(result["coverage"]["matched"], 2)
        self.assertEqual(self.store.search(self.scope, "not-matching")["results"], [])
        with self.assertRaises(ValueError):
            self.store.search({"project": "project-a"})
        with self.assertRaises(ValueError):
            self.store.search(self.scope, limit=101)
        self.store.record(self.trace("child", parent_id="one"))
        with self.assertRaises(ValueError):
            self.store.record(self.trace("bad-child", parent_id="unknown"))
        with self.assertRaises(ValueError):
            self.store.record(self.trace("cross-scope", parent_id="one", scope={**self.scope, "domain": "other"}))

    def test_tampering_rejected_on_record_get_search_report_feedback_and_export(self):
        self.store.record(self.trace(evaluation=self.evaluation()))
        self.store.feedback(self.feedback())
        self.artifact.write_text("tampered\n")
        operations = [lambda: self.store.record(self.trace()), lambda: self.store.get("one"), lambda: self.store.search(self.scope), lambda: self.store.report(self.scope), lambda: self.store.feedback(self.feedback("another")), lambda: self.store.export_report(self.mapping())]
        for operation in operations:
            with self.subTest(operation=operation), self.assertRaises(ValueError):
                operation()

    def test_feedback_artifact_is_reverified_independently(self):
        self.store.record(self.trace())
        artifact = self.root / "feedback.txt"; artifact.write_text("actual owner review")
        ref = {"path": str(artifact), "sha256": hashlib.sha256(artifact.read_bytes()).hexdigest()}
        self.store.feedback(self.feedback(evidence=[ref]))
        artifact.write_text("changed owner review")
        with self.assertRaises(ValueError):
            self.store.get("one")
        with self.assertRaises(ValueError):
            self.store.report(self.scope)

    def test_nonfinite_invalid_tokens_and_protected_surface_reject_atomically(self):
        for invalid in [float("nan"), float("inf"), -1, True, "2"]:
            with self.subTest(invalid=invalid), self.assertRaises(ValueError):
                self.store.record(self.trace(metrics={"cost_usd": invalid}))
        for invalid in [0.5, True, -1]:
            with self.assertRaises(ValueError):
                self.store.record(self.trace(metrics={"input_tokens": invalid}))
        with self.assertRaises(ValueError):
            self.store.record(self.trace(metrics_scope="inclusive"))
        with self.assertRaises(ValueError):
            self.store.record(self.trace(steps=[{"kind": "tool", "input": "secret raw transcript"}]))
        with self.assertRaises(ValueError):
            self.store.record(self.trace(evaluation={**self.evaluation(), "evidence": []}))
        with self.assertRaises(ValueError):
            self.store.record(self.trace(evaluation={**self.evaluation(), "evaluator_sha256": "f" * 64}))
        self.assertEqual(self.store.report(self.scope)["coverage"]["matched"], 0)
        self.store.record(self.trace(summary="api_key=private-value Bearer private-auth-value"))
        serialized = json.dumps(self.store.get("one"))
        self.assertNotIn("private-value", serialized); self.assertNotIn("private-auth-value", serialized)
        for invalid in [float("nan"), float("inf"), True, -0.1, 1.1]:
            with self.assertRaises(ValueError):
                self.store.feedback(self.feedback(score=invalid))
        self.assertEqual(self.store.get("one")["feedback"], [])

    def test_symlink_and_unsafe_paths_fail_closed(self):
        link = self.root / "linked.txt"; link.symlink_to(self.artifact)
        with self.assertRaises(ValueError):
            self.store.record(self.trace(evidence=[{**self.ref, "path": str(link)}]))
        directory = self.root / "linked-dir"; directory.symlink_to(self.root, target_is_directory=True)
        with self.assertRaises(ValueError):
            self.store.record(self.trace(evidence=[{**self.ref, "path": str(directory / "check.txt")}]))
        db_link = self.root / "db-link"; db_link.symlink_to(self.db)
        with self.assertRaises(ValueError):
            RUNTIME.TraceStore(db_link)
        with self.assertRaises(ValueError):
            RUNTIME.TraceStore(self.root / ".ssh" / "trace.db")
        journal = Path(str(self.db) + "-journal"); journal.symlink_to(self.artifact)
        with self.assertRaises(ValueError):
            self.store.report(self.scope)

    @unittest.skipUnless(hasattr(os, "mkfifo"), "FIFO regression requires POSIX")
    def test_fifo_evidence_and_inputs_fail_without_blocking(self):
        fifo = self.root / "blocked"; os.mkfifo(fifo)
        ref = {"path": str(fifo), "sha256": "0" * 64}
        record = self.write(self.trace(evidence=[ref]), "fifo.json")
        result, value = self.cli("record", "--file", record)
        self.assertEqual(result.returncode, 2); self.assertEqual(value["status"], "rejected")
        result, value = self.cli("record", "--file", fifo)
        self.assertEqual(result.returncode, 2); self.assertEqual(value["status"], "rejected")

    def test_database_error_rolls_back_and_concurrent_writers_do_not_duplicate(self):
        with sqlite3.connect(self.db) as db:
            db.execute("CREATE TRIGGER reject_bad BEFORE INSERT ON traces WHEN NEW.id='bad' BEGIN SELECT RAISE(ABORT,'fixture rejection'); END")
        with self.assertRaises(sqlite3.IntegrityError):
            self.store.record(self.trace("bad"))
        self.assertEqual(self.store.report(self.scope)["coverage"]["matched"], 0)
        def record(index):
            return RUNTIME.TraceStore(self.db).record(self.trace("parallel-" + str(index % 8)))["inserted"]
        with ThreadPoolExecutor(max_workers=8) as workers:
            results = list(workers.map(record, range(24)))
        self.assertEqual(sum(results), 8)
        self.assertEqual(self.store.report(self.scope)["coverage"]["matched"], 8)

    def test_report_scan_bound_is_explicit(self):
        original = RUNTIME.SCAN_LIMIT
        self.addCleanup(setattr, RUNTIME, "SCAN_LIMIT", original)
        RUNTIME.SCAN_LIMIT = 2
        for i in range(3):
            self.store.record(self.trace("bound-" + str(i)))
        result = self.store.search(self.scope, limit=10)
        self.assertEqual(len(result["results"]), 2)
        self.assertEqual(result["coverage"], {"matched": 3, "scanned": 2, "scan_limit": 2, "truncated": True})

    def test_export_preserves_explicit_evaluation_protocol_case_and_critical_alignment(self):
        self.store.record(self.trace(evaluation=self.evaluation("failed")))
        self.store.record(self.trace("better", evaluation=self.evaluation("passed")))
        self.store.record(self.trace("critical-before", evaluation=self.evaluation("failed", True)))
        self.store.record(self.trace("critical-after", evaluation=self.evaluation("failed", True)))
        self.store.feedback(self.feedback(trace_id="critical-after"))
        cases_before = [{"id": "one", "trace_id": "one", "critical": False}, {"id": "critical", "trace_id": "critical-before", "critical": True}]
        cases_after = [{"id": "one", "trace_id": "better", "critical": False}, {"id": "critical", "trace_id": "critical-after", "critical": True}]
        before = self.store.export_report(self.mapping(cases=cases_before))
        after = self.store.export_report(self.mapping("run-b", "revision-b", cases_after))
        result = COMPARE.compare(COMPARE.load_report(self.write(before, "before.json")), COMPARE.load_report(self.write(after, "after.json")))
        self.assertEqual(result["verdict"], "improved")
        self.assertFalse(result["promotion_eligible"])
        self.assertEqual(result["candidate_critical_failures"], ["critical"])
        bad_mappings = [self.mapping(cases=cases_before + [cases_before[0]]), self.mapping(cases=cases_before + [{"id": "duplicate-trace", "trace_id": "one", "critical": False}]), self.mapping(cases=[{"id": "wrong-critical", "trace_id": "one", "critical": True}]), self.mapping(cases=[{"id": "unknown", "trace_id": "absent", "critical": False}])]
        mismatch = self.mapping(); mismatch["protocol"] = {**self.protocol, "dataset_sha256": "f" * 64}; bad_mappings.append(mismatch)
        for mapping in bad_mappings:
            with self.assertRaises(ValueError):
                self.store.export_report(mapping)

    def test_cli_local_end_to_end_and_json_errors(self):
        result, value = self.cli("init")
        self.assertEqual(result.returncode, 0); self.assertEqual(value["status"], "ready")
        record = self.write(self.trace(evaluation=self.evaluation()), "record.json")
        scope = self.write(self.scope, "scope.json")
        result, value = self.cli("record", "--file", record)
        self.assertEqual(result.returncode, 0, result.stderr); self.assertTrue(value["inserted"])
        result, value = self.cli("feedback", "--file", self.write(self.feedback(), "feedback.json"))
        self.assertEqual(result.returncode, 0, result.stderr)
        result, value = self.cli("show", "--trace-id", "one")
        self.assertEqual(result.returncode, 0); self.assertEqual(value["feedback"][0]["reviewer"], "local-owner")
        result, value = self.cli("search", "--scope", scope, "--query", "artifact")
        self.assertEqual(result.returncode, 0); self.assertEqual(len(value["results"]), 1)
        result, value = self.cli("report", "--scope", scope)
        self.assertEqual(result.returncode, 0); self.assertEqual(value["evaluation"]["passed"], 1)
        result, value = self.cli("export-report", "--file", self.write(self.mapping(), "mapping.json"))
        self.assertEqual(result.returncode, 0); self.assertEqual(value["cases"][0]["status"], "passed")
        bad = self.root / "bad.json"; bad.write_text('{"schema_version":1,"score":NaN}')
        result, value = self.cli("feedback", "--file", bad)
        self.assertEqual(result.returncode, 2); self.assertEqual(value["status"], "rejected")
        bad.write_text('{"schema_version":1,"schema_version":1}')
        self.assertEqual(self.cli("record", "--file", bad)[0].returncode, 2)


if __name__ == "__main__":
    unittest.main()
