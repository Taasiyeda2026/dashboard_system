#!/usr/bin/env python3
"""Isolated CP-SAT set-packing solver for the OR-Tools scheduling PoC."""
from __future__ import annotations

import argparse
import json
import time
from collections import defaultdict
from pathlib import Path

from ortools.sat.python import cp_model


STATUS_NAMES = {
    cp_model.OPTIMAL: "OPTIMAL",
    cp_model.FEASIBLE: "FEASIBLE",
    cp_model.INFEASIBLE: "INFEASIBLE",
    cp_model.MODEL_INVALID: "MODEL_INVALID",
    cp_model.UNKNOWN: "UNKNOWN",
}


def load_model(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def teaching_minutes(candidate: dict) -> int:
    total = 0
    for meeting in candidate["meetings"]:
        start = meeting["start_time"].split(":")
        end = meeting["end_time"].split(":")
        start_m = int(start[0]) * 60 + int(start[1])
        end_m = int(end[0]) * 60 + int(end[1])
        total += max(0, end_m - start_m)
    return total


def home_travel_score(candidate: dict) -> int:
    # Smaller is better. Unknown home routes already filtered at export.
    km = candidate.get("homeKm")
    minutes = candidate.get("homeMinutes")
    if km is None or minutes is None:
        return 10_000_000
    return int(round(float(km) * 100 + float(minutes)))


def _configure_solver(solver: cp_model.CpSolver, time_limit_s: float, seed: int, workers: int) -> None:
    solver.parameters.max_time_in_seconds = float(time_limit_s)
    solver.parameters.random_seed = int(seed)
    solver.parameters.num_search_workers = int(workers)
    solver.parameters.enumerate_all_solutions = False


def _build_base_model(model_data: dict):
    candidates = model_data["candidates"]
    open_ids = model_data["openCourseIds"]
    conflicts = model_data["conflictPairs"]

    by_course: dict[str, list[dict]] = defaultdict(list)
    for cand in candidates:
        by_course[cand["courseId"]].append(cand)

    cp = cp_model.CpModel()
    vars_by_id: dict[int, cp_model.IntVar] = {}
    for cand in candidates:
        vars_by_id[cand["id"]] = cp.NewBoolVar(f"c{cand['id']}_{cand['courseId']}")

    for course_id in open_ids:
        course_vars = [vars_by_id[c["id"]] for c in by_course.get(course_id, [])]
        if course_vars:
            cp.AddAtMostOne(course_vars)

    for left, right in conflicts:
        if left in vars_by_id and right in vars_by_id:
            cp.Add(vars_by_id[left] + vars_by_id[right] <= 1)

    assigned_expr = sum(vars_by_id[c["id"]] for c in candidates) if candidates else 0
    hours_expr = sum(teaching_minutes(c) * vars_by_id[c["id"]] for c in candidates) if candidates else 0
    # Cap travel score per candidate to keep Int domain small.
    travel_expr = sum(min(home_travel_score(c), 50_000) * vars_by_id[c["id"]] for c in candidates) if candidates else 0
    return cp, vars_by_id, assigned_expr, hours_expr, travel_expr


def solve(model_data: dict, time_limit_s: float, seed: int, workers: int) -> dict:
    candidates = model_data["candidates"]
    protected = model_data["protectedRows"]
    open_ids = model_data["openCourseIds"]
    conflicts = model_data["conflictPairs"]

    # Lexicographic hierarchy with three short CP-SAT passes to avoid Int64 overflow
    # from multiplicative objective weights on large candidate pools.
    phase_limit = max(5.0, float(time_limit_s) / 3.0)
    stages = []

    def selected_from(solver_obj, vars_map):
        return [cand for cand in candidates if solver_obj.Value(vars_map[cand["id"]]) == 1]

    cp1, vars1, assigned_expr, hours_expr, travel_expr = _build_base_model(model_data)
    cp1.Maximize(assigned_expr)
    solver = cp_model.CpSolver()
    _configure_solver(solver, phase_limit, seed, workers)
    wall0 = time.perf_counter()
    status = solver.Solve(cp1)
    best_assigned = int(solver.ObjectiveValue()) if status in (cp_model.OPTIMAL, cp_model.FEASIBLE) else 0
    selected = selected_from(solver, vars1) if status in (cp_model.OPTIMAL, cp_model.FEASIBLE) else []
    stages.append({"phase": "max_assigned", "status": STATUS_NAMES.get(status, str(status)), "value": best_assigned})

    cp2, vars2, assigned_expr2, hours_expr2, travel_expr2 = _build_base_model(model_data)
    if candidates:
        cp2.Add(assigned_expr2 == best_assigned)
    cp2.Maximize(hours_expr2)
    solver = cp_model.CpSolver()
    _configure_solver(solver, phase_limit, seed + 1, workers)
    status = solver.Solve(cp2)
    best_hours = int(solver.ObjectiveValue()) if status in (cp_model.OPTIMAL, cp_model.FEASIBLE) else 0
    if status in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        selected = selected_from(solver, vars2)
    stages.append({"phase": "max_teaching_minutes", "status": STATUS_NAMES.get(status, str(status)), "value": best_hours})

    cp3, vars_by_id, assigned_expr3, hours_expr3, travel_expr3 = _build_base_model(model_data)
    if candidates:
        cp3.Add(assigned_expr3 == best_assigned)
        cp3.Add(hours_expr3 == best_hours)
        # Hint the previous lexicographic solution to help the travel pass.
        for cand in selected:
            cp3.AddHint(vars_by_id[cand["id"]], 1)
    cp3.Minimize(travel_expr3)
    solver = cp_model.CpSolver()
    _configure_solver(solver, phase_limit, seed + 2, workers)
    status = solver.Solve(cp3)
    best_travel = int(solver.ObjectiveValue()) if status in (cp_model.OPTIMAL, cp_model.FEASIBLE) else None
    if status in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        selected = selected_from(solver, vars_by_id)
    stages.append({"phase": "min_home_travel", "status": STATUS_NAMES.get(status, str(status)), "value": best_travel})
    wall_s = time.perf_counter() - wall0
    # Final status reflects the last improving feasible/optimal stage retained.
    if selected:
        status = cp_model.OPTIMAL if all(s["status"] == "OPTIMAL" for s in stages[:2]) and stages[-1]["status"] == "OPTIMAL" else cp_model.FEASIBLE

    selected_by_course = {c["courseId"]: c for c in selected}
    rows = []
    for row in protected:
        rows.append({
            "courseId": row["courseId"],
            "kind": "live",
            "status": "שיבוץ מאושר — נשמר",
            "instructorEmpId": row["instructorEmpId"],
            "meetings": row["meetings"],
            "teachingHours": row.get("teachingHours"),
            "source": "protected",
        })
    for course_id in open_ids:
        cand = selected_by_course.get(course_id)
        if cand:
            rows.append({
                "courseId": course_id,
                "kind": "fixed-proposal" if cand.get("officialDates") else "proposal",
                "status": "הצעה מוכנה",
                "instructorEmpId": cand["instructorEmpId"],
                "meetings": cand["meetings"],
                "teachingHours": cand["teachingHours"],
                "candidateId": cand["id"],
                "source": "ortools-cpsat",
            })
        else:
            diag = next((d for d in model_data["courseDiagnostics"] if d["courseId"] == course_id), {})
            rows.append({
                "courseId": course_id,
                "kind": "missing" if diag.get("missing") else "recruitment",
                "status": "חסר שיבוץ",
                "instructorEmpId": "",
                "meetings": [],
                "diagnostics": {
                    "options": diag.get("options", 0),
                    "failures": diag.get("failures", []),
                    "incomplete": diag.get("incomplete", False),
                },
                "source": "ortools-cpsat",
            })

    rows.sort(key=lambda r: r["courseId"])
    assigned = sum(1 for r in rows if r.get("instructorEmpId"))
    open_assigned = sum(1 for r in rows if r.get("source") == "ortools-cpsat" and r.get("instructorEmpId"))
    meeting_hours = sum(float(r.get("teachingHours") or 0) for r in rows if r.get("instructorEmpId"))

    all_optimal = all(s["status"] == "OPTIMAL" for s in stages)
    return {
        "solver": {
            "status": STATUS_NAMES.get(status, str(status)),
            "statusCode": int(status),
            "provenOptimal": all_optimal,
            "lexicographicStages": stages,
            "wallSeconds": wall_s,
            "userTime": solver.UserTime(),
            "wallTime": solver.WallTime(),
            "objectiveValue": {
                "assignedOpen": best_assigned,
                "teachingMinutes": best_hours,
                "homeTravelScore": best_travel,
            },
            "bestObjectiveBound": solver.BestObjectiveBound() if status in (cp_model.OPTIMAL, cp_model.FEASIBLE, cp_model.UNKNOWN) else None,
            "seed": seed,
            "timeLimitSeconds": time_limit_s,
            "numSearchWorkers": workers,
            "numCandidates": len(candidates),
            "numConflictPairs": len(conflicts),
            "ortoolsVersion": getattr(cp_model, "__version__", "unknown"),
        },
        "metrics": {
            "rows": len(rows),
            "assigned": assigned,
            "protectedLive": len(protected),
            "openCourses": len(open_ids),
            "openAssigned": open_assigned,
            "meetingHours": meeting_hours,
            "unassignedOpen": len(open_ids) - open_assigned,
        },
        "rows": rows,
        "selectedCandidateIds": [c["id"] for c in selected],
        "engineVersion": model_data.get("engineVersion"),
        "inputFingerprint": model_data.get("inputFingerprint"),
    }


def validate_internal(result: dict, model_data: dict) -> dict:
    """Local hard checks: protected identity, overlaps, at-most-one course."""
    rows = result["rows"]
    protected_ids = {r["courseId"]: r["instructorEmpId"] for r in model_data["protectedRows"]}
    protected_changed = []
    for row in rows:
        if row["courseId"] in protected_ids:
            if row.get("instructorEmpId") != protected_ids[row["courseId"]] or row.get("kind") != "live":
                protected_changed.append(row["courseId"])

    # Instructor pairwise overlaps ignoring travel (travel already in export conflicts).
    slots = defaultdict(list)
    for row in rows:
        emp = row.get("instructorEmpId")
        if not emp:
            continue
        for meeting in row.get("meetings") or []:
            start = meeting["start_time"]
            end = meeting["end_time"]
            slots[(emp, meeting["date"])].append((start, end, row["courseId"]))

    overlaps = []
    for key, items in slots.items():
        items = sorted(items)
        for i, (s1, e1, a1) in enumerate(items):
            for s2, e2, a2 in items[i + 1 :]:
                if a1 == a2:
                    continue
                if s1 < e2 and s2 < e1:
                    overlaps.append({"empDate": key, "a": a1, "b": a2})

    course_counts = defaultdict(int)
    for row in rows:
        if row.get("instructorEmpId") and row.get("kind") != "live":
            course_counts[row["courseId"]] += 1
    multi = [cid for cid, n in course_counts.items() if n > 1]

    return {
        "protectedChanged": len(protected_changed),
        "protectedChangedIds": protected_changed[:20],
        "pairwiseOverlaps": len(overlaps),
        "overlapSamples": overlaps[:10],
        "duplicateOpenAssignments": multi,
        "valid": len(protected_changed) == 0 and len(overlaps) == 0 and not multi,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="OR-Tools CP-SAT scheduling PoC solver")
    parser.add_argument("--model", required=True, help="Path to ortools-model.json")
    parser.add_argument("--out", required=True, help="Output directory")
    parser.add_argument("--time-limit", type=float, default=120.0)
    parser.add_argument("--seed", type=int, default=1)
    parser.add_argument("--workers", type=int, default=8)
    args = parser.parse_args()

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    model_data = load_model(Path(args.model))
    result = solve(model_data, args.time_limit, args.seed, args.workers)
    result["internalValidation"] = validate_internal(result, model_data)

    (out / "ortools-plan.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    summary = {
        "solver": result["solver"],
        "metrics": result["metrics"],
        "internalValidation": result["internalValidation"],
        "inputFingerprint": result["inputFingerprint"],
    }
    (out / "ortools-metrics.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=False))


if __name__ == "__main__":
    main()
