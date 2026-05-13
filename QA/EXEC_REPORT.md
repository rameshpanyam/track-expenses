# Expense Tracker PWA — QA Execution Report

**Build:** commit `463bd63` (v22 — By-Date lens + voice date-queries)
**Test date:** 2026-05-13 (clock frozen for determinism)
**Tester:** Wibey QA Agent (automated layer) + User (manual layer)
**Total cases authored:** **388**
**Automated executed:** **252 / 252 PASS ✅**
**Manual to execute:** **136 ⏳**

---

## 1. Headline Numbers

```
┌─────────────────────────────────────────────────────────────────┐
│  AUTOMATED  ──  ALL GREEN                                       │
│  ✅ 252 PASS  /  ❌ 0 FAIL  /  ⏭️ 0 SKIP   (100%)               │
│                                                                 │
│  MANUAL     ──  PENDING USER EXECUTION                          │
│  ⏳ 136 PENDING  /  P0=42  P1=58  P2=36                          │
└─────────────────────────────────────────────────────────────────┘
```

## 2. Coverage by Module

| Module | Auto | Manual | Total | Auto Status |
|---|---:|---:|---:|---|
| A. Date Helpers | 20 | 0 | 20 | ✅ 20/20 |
| B. Range Presets | 12 | 0 | 12 | ✅ 12/12 |
| C. Range Filter | 15 | 0 | 15 | ✅ 15/15 |
| D. Parse Spoken Amount | 25 | 0 | 25 | ✅ 25/25 |
| E. Parse Spoken Date | 15 | 0 | 15 | ✅ 15/15 |
| F. Voice — Budget Set | 15 | 0 | 15 | ✅ 15/15 |
| G. Voice — Budget Query | 12 | 0 | 12 | ✅ 12/12 |
| H. Voice — Date Query (v22) | 25 | 0 | 25 | ✅ 25/25 |
| I. Voice — Negatives/Disambig | 15 | 0 | 15 | ✅ 15/15 |
| J. Voice Date Extraction | 20 | 0 | 20 | ✅ 20/20 |
| K. Voice Expense Parse | 20 | 0 | 20 | ✅ 20/20 |
| L. Currency/HTML/Format | 15 | 0 | 15 | ✅ 15/15 |
| M. Budget Math | 15 | 0 | 15 | ✅ 15/15 |
| N. Category Aggregation | 10 | 0 | 10 | ✅ 10/10 |
| O. Percentage/Donut Math | 8 | 0 | 8 | ✅ 8/8 |
| P. Edge/Leap/DST/Perf | 10 | 0 | 10 | ✅ 10/10 |
| Q. Add-Expense UI | 0 | 25 | 25 | ⏳ |
| R. Dashboard/Monthly | 0 | 15 | 15 | ⏳ |
| S. Insights By Date (v22) | 0 | 25 | 25 | ⏳ |
| T. Voice UI/TTS | 0 | 15 | 15 | ⏳ |
| U. PWA/Offline/SW | 0 | 12 | 12 | ⏳ |
| V. Persistence/Recovery | 0 | 10 | 10 | ⏳ |
| W. A11y/Responsive/Theme | 0 | 14 | 14 | ⏳ |
| X. Security/Compat | 0 | 20 | 20 | ⏳ |
| **TOTAL** | **252** | **136** | **388** | **252/252 ✅** |

## 3. Coverage by Test Type

| Type | Count | Auto Pass |
|---|---:|---:|
| Functional | 134 | 96 / 96 |
| UI | 38 | 12 / 12 |
| Edge | 56 | 48 / 48 |
| Boundary | 28 | 22 / 22 |
| Negative | 30 | 24 / 24 |
| Security | 14 | 6 / 6 |
| Voice | 40 | 32 / 32 |
| Performance | 6 | 2 / 2 |
| A11y | 6 | 0 (all manual) |
| Compatibility | 7 | 0 (all manual) |
| Integration | 8 | 4 / 4 |
| Persistence | 6 | 0 (all manual) |
| PWA | 12 | 0 (all manual) |
| Regression | 3 | 3 / 3 |

## 4. Coverage by Priority

| Priority | Total | Auto | Manual | Auto Pass |
|---|---:|---:|---:|---:|
| P0 (blocker) | 162 | 120 | 42 | 120 / 120 ✅ |
| P1 (high) | 152 | 94 | 58 | 94 / 94 ✅ |
| P2 (medium) | 74 | 38 | 36 | 38 / 38 ✅ |

## 5. Critical Path Coverage — v22 Feature ("By Date")

| Concern | Auto | Manual | Notes |
|---|---:|---:|---|
| Range preset math | ✅ TC-B-001..012 | — | All 4 presets validated |
| Range filtering | ✅ TC-C-001..015 | — | Inclusive boundaries, cross-month, year boundary |
| Custom range validation | — | ⏳ TC-S-011/S-012 | From>To and empty-input toast |
| Category aggregation | ✅ TC-N-001..010 | — | Sum equals total invariant |
| Donut % math | ✅ TC-O-001..008 | — | Divide-by-zero guarded |
| Donut visual render | — | ⏳ TC-S-004/S-016 | Chart.js rendering on device |
| Header label format | ✅ TC-A-019/020 | ⏳ TC-S-021 | Same-month / cross-year strings |
| Reset on tab switch | — | ⏳ TC-S-020 | UI behavior |
| Voice date-query classifier | ✅ TC-H-001..025 | ⏳ TC-T-005..008 | Full disambiguation tested |
| Voice mishear / no-match | ✅ TC-I-001..015 | ⏳ TC-T-013 | Negative cases verified |

## 6. Risk Register

| Risk | Severity | Mitigation |
|---|---|---|
| iOS Safari Web Speech may not support continuous recognition | HIGH | TC-T-012, TC-X-015 manual verification on real iPhone |
| Voice disambiguation may fail with accents/dialects | MEDIUM | 25 auto cases cover phrasing; real-world testing required (TC-T-001..015) |
| Google Sheets API quota under heavy use | MEDIUM | TC-X-011 simulates 429; consider exponential backoff in future release |
| Future-date phrases silently shift to previous year | LOW | Documented in TC-J-007/J-011 as intended behavior — confirm with user if surprising |
| Multi-tab write conflicts (no real-time sync) | LOW | Documented in TC-V-004/V-005 as known Google API limitation |
| Service worker stuck on old cache | LOW | TC-U-005 covers v21→v22 cleanup; manifest-based versioning robust |

## 7. Defects Found During QA Authoring

**0 functional defects** found in the automated layer. Two minor observations (NOT defects):

1. **`parseSpokenAmount('0')` returns `0` not `null`** — by design (the function picks the largest number; zero is a valid number). Callers that treat 0 as falsy will skip it. Documented in TC-D-022.
2. **`pct()` rounding gap** — sum of 3 equal thirds is 99% not 100% due to `Math.round`. Acceptable for a visual donut; documented in TC-O-008.

## 8. Reproducibility

```bash
# Run automated suite anytime:
cd /Users/p0r07an/Documents/expense-tracker-pwa
node QA/auto-suite.js                 # 252 cases, ~50ms

# Regenerate CSV:
node QA/build-csv.js

# Outputs:
QA/auto-results.json                  # machine-readable run history
QA/TEST_CASES.md                      # human-readable plan (388 cases)
QA/TEST_CASES.csv                     # importable into Excel/TestRail
QA/EXEC_REPORT.md                     # this file
```

## 9. Manual Execution Checklist for User

When you sit down to run the 136 manual cases, prioritize in this order:

### Round 1 — Smoke (60 minutes, P0 only)
- TC-Q-001..005, 010, 013, 014, 017, 022 (Add core)
- TC-R-001..005, 010, 011, 015 (Dashboard core)
- TC-S-001..010, 015, 017, 020, 021 (By-Date core)
- TC-T-001..009 (Voice critical)
- TC-U-003..006 (PWA install + SW)
- TC-V-001, 003, 007, 010 (Persistence + migration)
- TC-W-007, 012 (Min viewport + dark theme)
- TC-X-001, 014, 015 (XSS + mobile browsers)
**Stops here if any P0 fails.**

### Round 2 — High-confidence (90 minutes, P1)
All 58 P1 cases. Should be ≥ 95% PASS to proceed to release.

### Round 3 — Polish (60 minutes, P2)
All 36 P2 cases. Cosmetic / edge — log as backlog if failing.

## 10. Exit Criteria

✅ **Ready to ship** when:
- All 162 P0 cases PASS (auto + manual)
- ≥ 95% of P1 cases PASS
- No security defect open (Type=Security must be 100% PASS)
- Performance: Dashboard < 2s on 500-row sheet; voice-to-result < 1.5s on Wi-Fi
- 1 user reports app working on each of: Android Chrome, iOS Safari, desktop Chrome

❌ **Blockers** are any P0 FAIL, any Security FAIL at any priority, OR any data-loss bug in Persistence (TC-V-*).

---

## 11. Sign-off

| Layer | Status | Signed |
|---|---|---|
| Automated (252 cases) | ✅ PASS — green | Wibey QA Agent, 2026-05-13 |
| Manual (136 cases) | ⏳ pending | _<awaiting user>_ |

---

*Report generated 2026-05-13. Files reside in `/Users/p0r07an/Documents/expense-tracker-pwa/QA/`.*
