#!/usr/bin/env python3
"""Compare OR-Tools PoC metrics to the frozen regional JS baseline."""
from __future__ import annotations

import argparse
import json
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--ortools-metrics", required=True)
    parser.add_argument("--baseline-metrics", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--baseline-label", default="regional-js-v37")
    args = parser.parse_args()

    ortools = json.loads(Path(args.ortools_metrics).read_text(encoding="utf-8"))
    baseline = json.loads(Path(args.baseline_metrics).read_text(encoding="utf-8"))

    base_assigned = baseline.get("assigned")
    base_hours = (baseline.get("quality") or {}).get("meetingHours")
    base_elapsed_ms = baseline.get("elapsedMs")

    o_metrics = ortools.get("metrics") or ortools
    o_solver = ortools.get("solver") or {}
    o_valid = (ortools.get("internalValidation") or {}).get("valid")

    comparison = {
        "baselineLabel": args.baseline_label,
        "baseline": {
            "assigned": base_assigned,
            "meetingHours": base_hours,
            "elapsedMs": base_elapsed_ms,
            "version": baseline.get("version"),
        },
        "ortools": {
            "assigned": o_metrics.get("assigned"),
            "meetingHours": o_metrics.get("meetingHours"),
            "protectedLive": o_metrics.get("protectedLive"),
            "openAssigned": o_metrics.get("openAssigned"),
            "elapsedWallSeconds": o_solver.get("wallSeconds"),
            "status": o_solver.get("status"),
            "provenOptimal": o_solver.get("provenOptimal"),
            "internalValid": o_valid,
        },
        "delta": {
            "assigned": (o_metrics.get("assigned") or 0) - (base_assigned or 0),
            "meetingHours": (o_metrics.get("meetingHours") or 0) - (base_hours or 0),
        },
        "acceptance": {
            "aimAssignedAtLeastBaseline": (o_metrics.get("assigned") or 0) >= (base_assigned or 0),
            "protectedLiveExpected": 109,
            "protectedLiveActual": o_metrics.get("protectedLive"),
            "noNewHardViolationsReportedSeparately": True,
        },
        "recommendationNotes": [
            "Do not claim global optimality unless solver.status == OPTIMAL.",
            "Candidate universe is bounded by the same generatePool budget/profile as the JS exporter.",
            "Coverage gaps vs baseline, if any, are reported without relaxing constraints.",
        ],
    }

    if (o_metrics.get("assigned") or 0) >= (base_assigned or 0) and o_valid and o_metrics.get("protectedLive") == 109:
        comparison["recommendation"] = "GO — PoC meets or beats baseline coverage under hard constraints; consider staged integration evaluation."
    elif o_valid and o_metrics.get("protectedLive") == 109:
        comparison["recommendation"] = "NO-GO for replacement yet — valid but below baseline coverage; diagnose candidate scarcity / conflict density before integration."
    else:
        comparison["recommendation"] = "NO-GO — validity or protected-row gate failed."

    Path(args.out).write_text(json.dumps(comparison, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(comparison, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
