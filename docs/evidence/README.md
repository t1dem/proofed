# Kane CLI session logs (Proofed)

Twelve real `events.ndjson` logs captured by Kane CLI while checking Proofed itself (the dashboard and `proofed-demo-store`), including three regressions Kane caught during development and nine passing runs.

Only the local home directory prefix (`/Users/<user>/` → `~/`) was replaced before hashing. Every JSON line, session UUID, timestamp, step remark, and `credits_consumed` value is unchanged.

Verify checksums:

```sh
cd docs/evidence && shasum -a 256 -c SHA256SUMS.txt
```

| Date (UTC) | Target | Kane CLI | Result | Credits | What was checked | Log |
|---|---|---|---|---:|---|---|
| `2026-11-13 23:40:48Z` | `proofed-dashboard` | `0.10.3` | ✓ passed | 13.0 | Inbox grouping into Needs you / Checking / Fixing / Passed | [`270a2261`](2026-11-13-270a2261-proofed-dashboard-passed.events.ndjson) |
| `2026-11-13 23:40:48Z` | `proofed-dashboard` | `0.10.3` | ✓ passed | 27.7 | Settings gear button and repository fixer selection | [`3f101bf3`](2026-11-13-3f101bf3-proofed-dashboard-passed.events.ndjson) |
| `2026-11-13 23:42:56Z` | `proofed-dashboard` | `0.10.3` | ✗ failed | 12.9 | PR detail page (caught real bug: JS asset served as HTML) | [`f682294b`](2026-11-13-f682294b-proofed-dashboard-failed.events.ndjson) |
| `2026-11-13 23:45:50Z` | `proofed-dashboard` | `0.10.3` | ✗ failed | 21.6 | Fix with Claude action (caught real bug: state stayed unchanged) | [`dbe9afcc`](2026-11-13-dbe9afcc-proofed-dashboard-failed.events.ndjson) |
| `2026-11-13 23:58:41Z` | `proofed-dashboard` | `0.10.3` | ✓ passed | 23.8 | Re-run check and Fix with Claude after fix | [`0c8c7632`](2026-11-13-0c8c7632-proofed-dashboard-passed.events.ndjson) |
| `2026-11-14 00:06:37Z` | `proofed-dashboard` | `0.10.3` | ✗ failed | 18.1 | PR detail load (caught real bug: page stalled on initial load) | [`1981bb32`](2026-11-14-1981bb32-proofed-dashboard-failed.events.ndjson) |
| `2026-11-14 00:08:02Z` | `proofed-dashboard` | `0.10.3` | ✓ passed | 18.8 | PR detail page shows recorded failure details | [`30f4d659`](2026-11-14-30f4d659-proofed-dashboard-passed.events.ndjson) |
| `2026-11-14 00:16:40Z` | `proofed-dashboard` | `0.10.3` | ✓ passed | 24.6 | Before-the-fix view above recording | [`28ea62da`](2026-11-14-28ea62da-proofed-dashboard-passed.events.ndjson) |
| `2026-11-14 00:17:51Z` | `proofed-dashboard` | `0.10.3` | ✓ passed | 29.0 | Pause and resume repository checks | [`54c9f015`](2026-11-14-54c9f015-proofed-dashboard-passed.events.ndjson) |
| `2026-11-14 00:18:00Z` | `proofed-dashboard` | `0.10.3` | ✓ passed | 24.2 | Repository inbox filter and return to Inbox | [`907f66b5`](2026-11-14-907f66b5-proofed-dashboard-passed.events.ndjson) |
| `2026-11-21 17:50:05Z` | `proofed-demo-store` | `0.10.4` | ✓ passed | 21.4 | Promo code total (lowercase welcome10) | [`c8faa846`](2026-11-21-c8faa846-proofed-demo-store-passed.events.ndjson) |
| `2026-11-21 17:50:06Z` | `proofed-demo-store` | `0.10.4` | ✓ passed | 23.1 | Place an order (€17.90 confirmation) | [`fa48e69e`](2026-11-21-fa48e69e-proofed-demo-store-passed.events.ndjson) |

For CI runs and recorded clips from GitHub Actions, see:
- [`t1dem/proofed` Proofed workflow](https://github.com/t1dem/proofed/actions/workflows/proofed.yml) and [`proofed-clips`](https://github.com/t1dem/proofed-clips)
- [`t1dem/proofed-demo-store` Proofed workflow](https://github.com/t1dem/proofed-demo-store/actions/workflows/proofed.yml) and [`proofed-clips`](https://github.com/t1dem/proofed-demo-store/tree/proofed-clips)
