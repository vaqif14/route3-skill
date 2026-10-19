#!/usr/bin/env python3
"""Compare frozen Route3 reports; never execute agents or contact providers.

Exit 0: eligible improvement; 1: retain incumbent; 2: malformed input.
Report contract: references/measured-improvement.md.
"""

import argparse
import hashlib
import json
import math
from pathlib import Path
import re
import sys


SHA256 = re.compile(r"[0-9a-f]{64}\Z")
METRICS = ("duration_ms", "input_tokens", "output_tokens", "cost_usd")
GRADED = {"passed", "failed"}


def require(condition, message):
    if not condition:
        raise ValueError(message)


def unique_object(pairs):
    obj = {}
    for key, value in pairs:
        require(key not in obj, f"duplicate JSON key: {key}")
        obj[key] = value
    return obj


def text(value):
    return isinstance(value, str) and bool(value.strip())


def digest(value):
    return isinstance(value, str) and SHA256.fullmatch(value) is not None


def file_digest(path):
    hasher = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            hasher.update(block)
    return hasher.hexdigest()


def load_report(path):
    require(path.is_file(), "report must be a regular file")
    require(path.stat().st_size <= 2 * 1024 * 1024, "report exceeds 2 MiB")
    raw = path.read_bytes()
    obj = json.loads(raw, object_pairs_hook=unique_object)
    require(isinstance(obj, dict), "report must be an object")
    require(type(obj.get("schema_version")) is int and obj["schema_version"] == 1,
            "schema_version must be 1")
    for field in ("run_id", "capability", "subject"):
        require(text(obj.get(field)), f"{field} must be a nonempty string")
    protocol = obj.get("protocol")
    require(isinstance(protocol, dict), "protocol must be an object")
    require(set(protocol) == {"dataset_sha256", "evaluator_sha256",
                              "environment_sha256", "execution_mode"},
            "protocol must contain exactly the three fingerprints and execution_mode")
    for field in ("dataset_sha256", "evaluator_sha256", "environment_sha256"):
        require(digest(protocol.get(field)), f"{field} must be a SHA-256 digest")
    require(protocol.get("execution_mode") in ("repository", "recorded_model"),
            "unknown execution_mode")
    cases = obj.get("cases")
    require(isinstance(cases, list) and 0 < len(cases) <= 10000,
            "cases must contain 1..10000 records")
    index, evidence_issues = {}, []
    for case in cases:
        require(isinstance(case, dict) and text(case.get("id")), "case needs an id")
        cid = case["id"]
        require(cid not in index, f"duplicate case id: {cid}")
        require(type(case.get("critical")) is bool, f"{cid}: critical must be boolean")
        require(isinstance(case.get("status"), str)
                and case["status"] in GRADED | {"error", "not_run"},
                f"{cid}: unknown status")
        metrics = case.get("metrics", {})
        require(isinstance(metrics, dict) and set(metrics) <= set(METRICS),
                f"{cid}: unsupported metrics")
        for name, value in metrics.items():
            require(value is None or (type(value) in (int, float)
                    and math.isfinite(value) and value >= 0),
                    f"{cid}: {name} must be finite, nonnegative or null")
        evidence = case.get("evidence", [])
        require(isinstance(evidence, list), f"{cid}: evidence must be an array")
        if case["status"] in GRADED and not evidence:
            evidence_issues.append({"case_id": cid, "reason": "missing_evidence"})
        for item in evidence:
            require(isinstance(item, dict) and text(item.get("path"))
                    and digest(item.get("sha256")), f"{cid}: invalid evidence reference")
            artifact = path.parent / item["path"]
            try:
                valid = artifact.is_file() and file_digest(artifact) == item["sha256"]
            except OSError:
                valid = False
            if not valid:
                evidence_issues.append({"case_id": cid, "reason": "evidence_unverified"})
        index[cid] = case
    return obj, index, evidence_issues, hashlib.sha256(raw).hexdigest()


def compare(baseline, candidate):
    b, bi, be, bh = baseline
    c, ci, ce, ch = candidate
    issues = []
    if b["capability"] != c["capability"]:
        issues.append("capability_mismatch")
    if b["protocol"] != c["protocol"]:
        issues.append("protocol_mismatch")
    if b["run_id"] == c["run_id"]:
        issues.append("run_ids_not_distinct")
    if b["subject"] == c["subject"]:
        issues.append("subjects_not_distinct")
    missing, extra = sorted(bi.keys() - ci.keys()), sorted(ci.keys() - bi.keys())
    if missing or extra:
        issues.append("case_set_mismatch")
    common = sorted(bi.keys() & ci.keys())
    critical_changed = [cid for cid in common if bi[cid]["critical"] != ci[cid]["critical"]]
    if critical_changed:
        issues.append("critical_contract_mismatch")
    incomplete = {"baseline": [cid for cid in bi if bi[cid]["status"] not in GRADED],
                  "candidate": [cid for cid in ci if ci[cid]["status"] not in GRADED]}
    if any(incomplete.values()):
        issues.append("incomplete_execution")
    if be or ce:
        issues.append("unverified_evidence")
    paired = [cid for cid in common
              if bi[cid]["status"] in GRADED and ci[cid]["status"] in GRADED]
    wins = [cid for cid in paired if bi[cid]["status"] == "failed"
            and ci[cid]["status"] == "passed"]
    losses = [cid for cid in paired if bi[cid]["status"] == "passed"
              and ci[cid]["status"] == "failed"]
    critical_failed = [cid for cid in ci if ci[cid]["critical"]
                       and ci[cid]["status"] == "failed"]
    verdict = ("insufficient_evidence" if issues else "regressed" if losses
               else "improved" if wins else "unchanged")
    # No metric claims across incompatible protocols or unverified/incomplete runs.
    resource_metrics = {}
    if not issues:
        for metric in METRICS:
            ids = [cid for cid in paired if bi[cid].get("metrics", {}).get(metric) is not None
                   and ci[cid].get("metrics", {}).get(metric) is not None]
            bv = sum(bi[cid]["metrics"][metric] for cid in ids) if ids else None
            cv = sum(ci[cid]["metrics"][metric] for cid in ids) if ids else None
            overflow = any(isinstance(total, float) and not math.isfinite(total)
                           for total in (bv, cv))
            if isinstance(bv, float) and not math.isfinite(bv):
                bv = None
            if isinstance(cv, float) and not math.isfinite(cv):
                cv = None
            resource_metrics[metric] = {
                "paired_cases": len(ids), "total_cases": len(bi), "case_ids": ids,
                "baseline_paired_total": bv, "candidate_paired_total": cv,
                "delta": cv - bv if bv is not None and cv is not None else None,
                "aggregation_issue": "aggregate_overflow" if overflow else None,
            }
    return {
        "schema_version": 1, "verdict": verdict,
        "promotion_eligible": verdict == "improved" and not critical_failed,
        "evidence_scope": "reported_artifacts_not_independent_execution",
        "baseline": {"run_id": b["run_id"], "subject": b["subject"], "report_sha256": bh},
        "candidate": {"run_id": c["run_id"], "subject": c["subject"], "report_sha256": ch},
        "capability": b["capability"], "issues": issues,
        "coverage": {"baseline_cases": len(bi), "candidate_cases": len(ci),
                     "paired_graded": len(paired), "missing_candidate_cases": missing,
                     "extra_candidate_cases": extra, "incomplete": incomplete},
        "evidence_issues": {"baseline": be, "candidate": ce},
        "critical_contract_changes": critical_changed,
        "wins": wins, "regressions": losses, "candidate_critical_failures": critical_failed,
        "passed": {"baseline": sum(case["status"] == "passed" for case in bi.values()),
                   "candidate": sum(case["status"] == "passed" for case in ci.values())},
        "resource_metrics": resource_metrics,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("baseline", type=Path)
    parser.add_argument("candidate", type=Path)
    args = parser.parse_args()
    try:
        result = compare(load_report(args.baseline), load_report(args.candidate))
        print(json.dumps(result, indent=2, allow_nan=False))
        return 0 if result["promotion_eligible"] else 1
    except (ValueError, OSError, OverflowError, RecursionError) as error:
        print(json.dumps({"error": str(error), "promotion_eligible": False}), file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
