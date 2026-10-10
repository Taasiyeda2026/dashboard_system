#!/usr/bin/env python3
"""Focused automated tests for the OR-Tools PoC solver (no production I/O)."""
from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from solve_cpsat import solve, validate_internal


def tiny_model() -> dict:
    return {
        "engineVersion": "test",
        "inputFingerprint": "test",
        "protectedRows": [
            {
                "courseId": "p1",
                "kind": "live",
                "instructorEmpId": "10",
                "meetings": [
                    {"date": "2026-11-02", "start_time": "09:00", "end_time": "10:00", "meeting_no": 1}
                ],
                "teachingHours": 1.0,
            }
        ],
        "openCourseIds": ["a1", "a2", "a3"],
        "candidates": [
            {
                "id": 0,
                "courseId": "a1",
                "instructorEmpId": "1",
                "meetings": [
                    {"date": "2026-11-03", "start_time": "09:00", "end_time": "10:00", "meeting_no": 1}
                ],
                "teachingHours": 1.0,
                "homeKm": 5,
                "homeMinutes": 10,
                "officialDates": False,
            },
            {
                "id": 1,
                "courseId": "a1",
                "instructorEmpId": "2",
                "meetings": [
                    {"date": "2026-11-03", "start_time": "09:00", "end_time": "10:00", "meeting_no": 1}
                ],
                "teachingHours": 1.0,
                "homeKm": 30,
                "homeMinutes": 40,
                "officialDates": False,
            },
            {
                "id": 2,
                "courseId": "a2",
                "instructorEmpId": "1",
                "meetings": [
                    {"date": "2026-11-03", "start_time": "09:30", "end_time": "10:30", "meeting_no": 1}
                ],
                "teachingHours": 1.0,
                "homeKm": 5,
                "homeMinutes": 10,
                "officialDates": False,
            },
            {
                "id": 3,
                "courseId": "a2",
                "instructorEmpId": "2",
                "meetings": [
                    {"date": "2026-11-04", "start_time": "09:00", "end_time": "11:00", "meeting_no": 1}
                ],
                "teachingHours": 2.0,
                "homeKm": 8,
                "homeMinutes": 12,
                "officialDates": False,
            },
            {
                "id": 4,
                "courseId": "a3",
                "instructorEmpId": "2",
                "meetings": [
                    {"date": "2026-11-04", "start_time": "10:00", "end_time": "12:00", "meeting_no": 1}
                ],
                "teachingHours": 2.0,
                "homeKm": 8,
                "homeMinutes": 12,
                "officialDates": False,
            },
        ],
        # a1@1 conflicts with a2@1; a2@2 conflicts with a3@2
        "conflictPairs": [[0, 2], [3, 4]],
        "courseDiagnostics": [
            {"courseId": "a1", "options": 2, "failures": []},
            {"courseId": "a2", "options": 2, "failures": []},
            {"courseId": "a3", "options": 1, "failures": []},
        ],
    }


class SolveTests(unittest.TestCase):
    def test_maximizes_coverage_without_conflicts(self):
        result = solve(tiny_model(), time_limit_s=10, seed=1, workers=1)
        self.assertIn(result["solver"]["status"], {"OPTIMAL", "FEASIBLE"})
        self.assertEqual(result["metrics"]["protectedLive"], 1)
        # Feasible pack of all three open courses exists (e.g. a1@2, a2@1, a3@2).
        self.assertEqual(result["metrics"]["openAssigned"], 3)
        self.assertEqual(result["metrics"]["assigned"], 4)
        validation = validate_internal(result, tiny_model())
        self.assertTrue(validation["valid"])
        self.assertEqual(validation["protectedChanged"], 0)
        selected = {r["courseId"]: r["instructorEmpId"] for r in result["rows"] if r.get("instructorEmpId")}
        self.assertEqual(selected["p1"], "10")
        self.assertEqual(set(selected), {"p1", "a1", "a2", "a3"})
        # Conflict [0,2] forbids a1@1 with a2@1; [3,4] forbids a2@2 with a3@2.
        selected_ids = set(result["selectedCandidateIds"])
        self.assertFalse({0, 2}.issubset(selected_ids))
        self.assertFalse({3, 4}.issubset(selected_ids))

    def test_at_most_one_candidate_per_course(self):
        model = tiny_model()
        # Remove conflicts so solver could pick both a1 candidates without at-most-one.
        model["conflictPairs"] = [[3, 4]]
        result = solve(model, time_limit_s=10, seed=1, workers=1)
        counts = {}
        for row in result["rows"]:
            if row.get("instructorEmpId") and row["courseId"] != "p1":
                counts[row["courseId"]] = counts.get(row["courseId"], 0) + 1
        self.assertTrue(all(v == 1 for v in counts.values()))


if __name__ == "__main__":
    unittest.main()
