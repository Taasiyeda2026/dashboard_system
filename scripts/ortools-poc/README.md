# Isolated OR-Tools CP-SAT scheduling PoC

Prototype for issue #2257. Does not modify the live planner, production data, or deploy paths.

## One command

```sh
./scripts/ortools-poc/run.sh
```

Environment overrides:

- `DECISION_DIR` — decoded fixture directory (default `/tmp/v37-input`)
- `ORTOOLS_OUT` — output directory (default `/tmp/ortools-poc`)
- `ORTOOLS_TIME_LIMIT` — CP-SAT wall seconds across lexicographic phases (default `120`)
- `ORTOOLS_SEED` — deterministic seed (default `1`)
- `ORTOOLS_WORKERS` — CP-SAT workers (default `8`)

## Focused tests

```sh
cd scripts/ortools-poc && python3 -m unittest test_solve_cpsat.py -v
```

## Acceptance report

See `docs/ortools-cpsat-poc-20261010/ACCEPTANCE.md`.
