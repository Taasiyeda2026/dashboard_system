# Stage 0 Baseline Measurements (Read Models Transition)

- Generated at (UTC): 2026-04-25T22:56:52.771Z
- Samples per screen: 20
- Source: local mock harness using current backend/frontend code paths with `debug_perf=true`.

| Screen | API p50 (ms) | API p95 (ms) | Payload p50 (bytes) | Payload p95 (bytes) | First render (ms) | Cache hit ratio | First call source | Bottleneck notes |
|---|---:|---:|---:|---:|---:|---:|---|---|
| dashboard | 0 | 1 | 2044 | 2044 | 0.91 | 95.0% | server | sheet read (permissions) 0ms |
| activities | 0 | 2 | 3069 | 3069 | 3.12 | 95.0% | server | sheet read (permissions) 0ms |
| month | 0 | 1 | 5648 | 5648 | 1.66 | 95.0% | server | sheet read (permissions) 0ms |
| week | 0 | 1 | 4654 | 4654 | 0.91 | 95.0% | server | sheet read (permissions) 0ms |
| exceptions | 0 | 1 | 623 | 623 | 0.42 | 95.0% | server | sheet read (permissions) 0ms |
| finance | 0 | 1 | 2054 | 2054 | 23.22 | 95.0% | server | sheet read (permissions) 0ms |
| instructors | 0 | 1 | 359 | 359 | 0.49 | 95.0% | server | sheet read (permissions) 0ms |
| contacts | 0 | 1 | 444 | 444 | 0.82 | 95.0% | server | sheet read (permissions) 0ms |
| endDates | 0 | 1 | 2698 | 2698 | 6.86 | 95.0% | server | sheet read (permissions) 0ms |

