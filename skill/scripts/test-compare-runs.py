#!/usr/bin/env python3
"""Local behavioral checks for comparison gates; no agent or provider calls."""

import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


SCRIPT = Path(__file__).with_name("compare-runs.py")
sys.dont_write_bytecode = True
SPEC = importlib.util.spec_from_file_location("compare_runs", SCRIPT)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class ComparisonTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="route3-comparison-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        artifact = self.root / "verify.log"
        artifact.write_text("verification artifact\n")
        self.evidence = {"path": artifact.name,
                         "sha256": hashlib.sha256(artifact.read_bytes()).hexdigest()}
        self.base = {
            "schema_version": 1, "run_id": "baseline", "capability": "dispatch",
            "subject": "revision-before",
            "protocol": {"dataset_sha256": "a" * 64, "evaluator_sha256": "b" * 64,
                         "environment_sha256": "c" * 64, "execution_mode": "repository"},
            "cases": [self.case("must-preserve", "passed", True),
                      self.case("repair", "failed", False)],
        }
        self.candidate = copy.deepcopy(self.base)
        self.candidate.update(run_id="candidate", subject="revision-after")
        self.candidate["cases"][1]["status"] = "passed"

    def case(self, cid, status, critical):
        return {"id": cid, "status": status, "critical": critical,
                "evidence": [copy.deepcopy(self.evidence)]}

    def write(self, report, name):
        path = self.root / name
        path.write_text(json.dumps(report))
        return path

    def compare(self):
        return MODULE.compare(
            MODULE.load_report(self.write(self.base, "baseline.json")),
            MODULE.load_report(self.write(self.candidate, "candidate.json")))

    def test_verified_improvement_and_order_independence(self):
        self.candidate["cases"].reverse()
        result = self.compare()
        self.assertEqual(result["verdict"], "improved")
        self.assertTrue(result["promotion_eligible"])
        self.assertEqual(result["wins"], ["repair"])

    def test_unchanged_retains_incumbent(self):
        self.candidate["cases"] = copy.deepcopy(self.base["cases"])
        self.assertEqual(self.compare()["verdict"], "unchanged")
        self.assertFalse(self.compare()["promotion_eligible"])

    def test_average_gain_cannot_hide_a_regression(self):
        self.base["cases"] += [self.case("another-repair", "failed", False)]
        self.candidate["cases"] += [self.case("another-repair", "passed", False)]
        self.candidate["cases"][0]["status"] = "failed"
        result = self.compare()
        self.assertGreater(result["passed"]["candidate"], result["passed"]["baseline"])
        self.assertEqual(result["verdict"], "regressed")
        self.assertFalse(result["promotion_eligible"])

    def test_remaining_critical_failure_blocks_adoption(self):
        self.base["cases"] += [self.case("broken-gate", "failed", True)]
        self.candidate["cases"] += [self.case("broken-gate", "failed", True)]
        result = self.compare()
        self.assertEqual(result["verdict"], "improved")
        self.assertFalse(result["promotion_eligible"])

    def test_each_protocol_dimension_is_frozen(self):
        for key in self.candidate["protocol"]:
            with self.subTest(key=key):
                original = self.candidate["protocol"][key]
                self.candidate["protocol"][key] = "recorded_model" if key == "execution_mode" else "f" * 64
                self.assertEqual(self.compare()["verdict"], "insufficient_evidence")
                self.candidate["protocol"][key] = original

    def test_missing_extra_and_critical_changed_cases_block_comparison(self):
        original = copy.deepcopy(self.candidate["cases"])
        for cases in [original[:1], original + [self.case("extra", "passed", False)]]:
            self.candidate["cases"] = cases
            self.assertEqual(self.compare()["verdict"], "insufficient_evidence")
        self.candidate["cases"] = original
        self.candidate["cases"][0]["critical"] = False
        self.assertIn("critical_contract_mismatch", self.compare()["issues"])

    def test_error_and_not_run_are_incomplete_not_quality_losses(self):
        for status in ["error", "not_run"]:
            self.candidate["cases"][0]["status"] = status
            result = self.compare()
            self.assertEqual(result["verdict"], "insufficient_evidence")
            self.assertEqual(result["regressions"], [])
            self.assertEqual(result["resource_metrics"], {})

    def test_missing_changed_and_nonexistent_evidence(self):
        for evidence in [[], [{**self.evidence, "sha256": "f" * 64}],
                         [{**self.evidence, "path": "absent.log"}]]:
            self.candidate["cases"][0]["evidence"] = evidence
            self.assertIn("unverified_evidence", self.compare()["issues"])

    def test_metrics_use_only_known_pairs(self):
        self.base["cases"][0]["metrics"] = {"cost_usd": 2, "input_tokens": 100}
        self.candidate["cases"][0]["metrics"] = {"cost_usd": 1, "input_tokens": None}
        self.candidate["cases"][1]["metrics"] = {"cost_usd": 100}
        metrics = self.compare()["resource_metrics"]
        self.assertEqual(metrics["cost_usd"]["paired_cases"], 1)
        self.assertEqual(metrics["cost_usd"]["delta"], -1)
        self.assertIsNone(metrics["input_tokens"]["baseline_paired_total"])
        self.assertIsNone(metrics["duration_ms"]["delta"])

    def test_duplicate_cases_and_invalid_metrics_rejected(self):
        self.candidate["cases"].append(copy.deepcopy(self.candidate["cases"][0]))
        with self.assertRaises(ValueError):
            self.compare()
        self.candidate["cases"].pop()
        for value in [-1, True, float("nan"), float("inf"), "2"]:
            self.candidate["cases"][0]["metrics"] = {"cost_usd": value}
            with self.subTest(value=value), self.assertRaises(ValueError):
                self.compare()

    def test_metric_aggregate_overflow_stays_unknown_without_losing_quality(self):
        for report in [self.base, self.candidate]:
            for case in report["cases"]:
                case["metrics"] = {"cost_usd": 1e308}
        result = self.compare()
        self.assertTrue(result["promotion_eligible"])
        metric = result["resource_metrics"]["cost_usd"]
        self.assertEqual(metric["aggregation_issue"], "aggregate_overflow")
        self.assertIsNone(metric["baseline_paired_total"])
        self.assertIsNone(metric["delta"])
        json.dumps(result, allow_nan=False)

    def test_duplicate_json_keys_rejected(self):
        path = self.root / "duplicate.json"
        path.write_text('{"schema_version":1,"schema_version":1}')
        with self.assertRaises(ValueError):
            MODULE.load_report(path)

    def test_malformed_status_has_structured_cli_error(self):
        bp = self.write(self.base, "baseline.json")
        for status in [[], {}, None, 1, True]:
            with self.subTest(status=status):
                self.candidate["cases"][0]["status"] = status
                cp = self.write(self.candidate, "candidate.json")
                proc = subprocess.run([sys.executable, str(SCRIPT), str(bp), str(cp)],
                                      capture_output=True, text=True)
                self.assertEqual(proc.returncode, 2)
                self.assertFalse(json.loads(proc.stderr)["promotion_eligible"])

    def test_cli_exit_codes_and_relative_evidence(self):
        bp = self.write(self.base, "baseline.json")
        cp = self.write(self.candidate, "candidate.json")
        def run():
            return subprocess.run([sys.executable, str(SCRIPT), str(bp), str(cp)],
                                  capture_output=True, text=True, cwd="/")
        proc = run()
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertTrue(json.loads(proc.stdout)["promotion_eligible"])
        self.candidate["cases"] = copy.deepcopy(self.base["cases"])
        self.write(self.candidate, cp.name)
        self.assertEqual(run().returncode, 1)
        cp.write_text("invalid JSON")
        proc = run()
        self.assertEqual(proc.returncode, 2)
        self.assertFalse(json.loads(proc.stderr)["promotion_eligible"])


if __name__ == "__main__":
    unittest.main()
