# Expense Tracker PWA — Comprehensive QA Test Plan (v22)

**Build under test:** commit `463bd63` (v22 — By-Date lens + date-query voice intents)
**Test runner / author:** Wibey QA Agent
**Test date:** 2026-05-13
**Total test cases:** **388**
**Automated (executed via `QA/auto-suite.js`):** **252 ✅ ALL PASS**
**Manual (to be executed on device by user):** **136 ⏳ PENDING USER EXECUTION**

---

## How to read this document

| Field | Meaning |
|---|---|
| **ID** | `TC-<MODULE>-<NUM>` — stable identifier |
| **Module** | One of 22 modules listed in the index below |
| **Type** | Functional / UI / Integration / System / Regression / Edge / Negative / Boundary / Performance / Security / Accessibility / PWA / Voice / Compatibility / Usability / Persistence |
| **Priority** | P0 (blocker) / P1 (high) / P2 (medium) / P3 (low) |
| **Auto?** | ✅ = executed by `auto-suite.js`, ⏳ = manual |
| **Status** | PASS / FAIL / PENDING / BLOCKED |

---

## Module Index

| # | Module | Cases | Auto | Manual |
|---|---|---:|---:|---:|
| A | Date Helpers | 20 | 20 | 0 |
| B | Range Presets | 12 | 12 | 0 |
| C | Range Filter | 15 | 15 | 0 |
| D | Parse Spoken Amount | 25 | 25 | 0 |
| E | Parse Spoken Date | 15 | 15 | 0 |
| F | Voice Intent — Budget Set | 15 | 15 | 0 |
| G | Voice Intent — Budget Query | 12 | 12 | 0 |
| H | Voice Intent — Date Query | 25 | 25 | 0 |
| I | Voice Intent — Negatives / Disambiguation | 15 | 15 | 0 |
| J | Voice Date Extraction | 20 | 20 | 0 |
| K | Voice Expense Parse | 20 | 20 | 0 |
| L | Currency / HTML / Format | 15 | 15 | 0 |
| M | Budget Math | 15 | 15 | 0 |
| N | Category Aggregation | 10 | 10 | 0 |
| O | Percentage / Donut Math | 8 | 8 | 0 |
| P | Edge / Leap / DST / Performance | 10 | 10 | 0 |
| Q | Add-Expense UI (manual) | 25 | 0 | 25 |
| R | Dashboard / Monthly View (manual) | 15 | 0 | 15 |
| S | Insights → By Date UI (manual) | 25 | 0 | 25 |
| T | Voice UI / TTS (manual) | 15 | 0 | 15 |
| U | PWA / Offline / Service Worker | 12 | 0 | 12 |
| V | Persistence / Multi-tab / Recovery | 10 | 0 | 10 |
| W | Accessibility / Responsive / Theme | 14 | 0 | 14 |
| X | Security / Negative / Compatibility | 20 | 0 | 20 |
| | **TOTAL** | **388** | **252** | **136** |

---

## A. Date Helpers (auto-executed — 20 cases, all PASS ✅)

| ID | Title | Type | Priority | Auto | Status |
|---|---|---|---|---|---|
| TC-A-001 | dateToStr formats Date → yyyy-mm-dd | Functional | P0 | ✅ | PASS |
| TC-A-002 | dateToStr zero-pads month & day | Edge | P0 | ✅ | PASS |
| TC-A-003 | dateToStr handles Dec 31 | Edge | P1 | ✅ | PASS |
| TC-A-004 | strToDate parses yyyy-mm-dd → Date | Functional | P0 | ✅ | PASS |
| TC-A-005 | strToDate round-trips dateToStr | Integration | P0 | ✅ | PASS |
| TC-A-006 | addDays +1 from May 13 | Functional | P0 | ✅ | PASS |
| TC-A-007 | addDays -1 from May 1 crosses month | Boundary | P0 | ✅ | PASS |
| TC-A-008 | addDays -1 from Jan 1 crosses year | Boundary | P0 | ✅ | PASS |
| TC-A-009 | addDays +365 from Jan 1 | Boundary | P1 | ✅ | PASS |
| TC-A-010 | addDays handles leap year Feb | Edge | P1 | ✅ | PASS |
| TC-A-011 | startOfWeek on Wed gives Mon | Functional | P0 | ✅ | PASS |
| TC-A-012 | startOfWeek on Mon = same Mon | Boundary | P0 | ✅ | PASS |
| TC-A-013 | startOfWeek on Sun shifts back 6 days | Edge | P0 | ✅ | PASS |
| TC-A-014 | startOfWeek on Sat = Mon of same week | Boundary | P1 | ✅ | PASS |
| TC-A-015 | todayStr returns today | Functional | P0 | ✅ | PASS |
| TC-A-016 | ymd same as dateToStr | Regression | P2 | ✅ | PASS |
| TC-A-017 | fmtDate strips year | UI | P1 | ✅ | PASS |
| TC-A-018 | fmtDate handles single-digit day | UI | P2 | ✅ | PASS |
| TC-A-019 | fmtFullDate with year | UI | P1 | ✅ | PASS |
| TC-A-020 | fmtFullDate without year | UI | P1 | ✅ | PASS |

## B. Range Presets (auto — 12 cases ✅)

| ID | Title | Type | Priority | Status |
|---|---|---|---|---|
| TC-B-001 | today preset = [today, today] | Functional | P0 | PASS |
| TC-B-002 | yesterday preset = [yesterday, yesterday] | Functional | P0 | PASS |
| TC-B-003 | this-week preset = [Mon, today] | Functional | P0 | PASS |
| TC-B-004 | last-7 preset = [today-6, today] | Functional | P0 | PASS |
| TC-B-005 | unknown preset returns null | Negative | P1 | PASS |
| TC-B-006 | this-week on Monday = [Mon, Mon] | Edge | P1 | PASS |
| TC-B-007 | this-week on Sunday rolls back to previous Mon | Edge | P0 | PASS |
| TC-B-008 | last-7 always spans 7 days | Boundary | P1 | PASS |
| TC-B-009 | today preset has from===to | Regression | P1 | PASS |
| TC-B-010 | yesterday preset has from===to | Regression | P1 | PASS |
| TC-B-011 | yesterday is exactly 1 day before today | Regression | P0 | PASS |
| TC-B-012 | rangeForPreset is deterministic | Regression | P2 | PASS |

## C. Range Filter (auto — 15 cases ✅)

| ID | Title | Type | Priority | Status |
|---|---|---|---|---|
| TC-C-001 | filter today returns 2 rows | Functional | P0 | PASS |
| TC-C-002 | filter yesterday returns 1 row | Functional | P0 | PASS |
| TC-C-003 | filter this-week returns 4 rows | Functional | P0 | PASS |
| TC-C-004 | filter last-7 returns 5 rows | Functional | P0 | PASS |
| TC-C-005 | filter cross-month range | Boundary | P0 | PASS |
| TC-C-006 | filter empty range = 0 rows | Negative | P1 | PASS |
| TC-C-007 | filter excludes empty-date rows | Edge | P0 | PASS |
| TC-C-008 | filter inclusive boundaries | Boundary | P0 | PASS |
| TC-C-009 | filter single date with no match | Negative | P1 | PASS |
| TC-C-010 | filter same from/to inclusive | Regression | P1 | PASS |
| TC-C-011 | filter from>to gives 0 rows | Negative | P1 | PASS |
| TC-C-012 | filter today sums to 1200 | Functional | P0 | PASS |
| TC-C-013 | filter this-week sums to 3000 | Functional | P0 | PASS |
| TC-C-014 | filter last-7 sums to 3150 | Functional | P0 | PASS |
| TC-C-015 | filter on empty list returns [] | Negative | P1 | PASS |

## D. Parse Spoken Amount (auto — 25 cases ✅)

| ID | Title | Type | Priority | Status |
|---|---|---|---|---|
| TC-D-001 | plain "500" → 500 | Functional | P0 | PASS |
| TC-D-002 | "₹500" → 500 | Functional | P0 | PASS |
| TC-D-003 | "1,000" → 1000 | Functional | P0 | PASS |
| TC-D-004 | "25k" → 25000 | Functional | P0 | PASS |
| TC-D-005 | "25 k" with space → 25000 | Edge | P1 | PASS |
| TC-D-006 | "1.5k" → 1500 | Edge | P1 | PASS |
| TC-D-007 | "1 lakh" → 100000 | Functional | P0 | PASS |
| TC-D-008 | "1.5 lakh" → 150000 | Functional | P0 | PASS |
| TC-D-009 | "2 lakhs" plural → 200000 | Edge | P1 | PASS |
| TC-D-010 | "1 lac" alt spelling → 100000 | Edge | P1 | PASS |
| TC-D-011 | "1 crore" → 10000000 | Functional | P0 | PASS |
| TC-D-012 | "1.2 crores" → 12000000 | Edge | P1 | PASS |
| TC-D-013 | "1 cr" abbrev → 10000000 | Edge | P1 | PASS |
| TC-D-014 | "fifty thousand" word number → 50000 | Functional | P0 | PASS |
| TC-D-015 | "twenty five thousand" → 25000 | Functional | P0 | PASS |
| TC-D-016 | "five hundred" → 500 | Edge | P1 | PASS |
| TC-D-017 | "one hundred" → 100 | Edge | P1 | PASS |
| TC-D-018 | no number → null | Negative | P1 | PASS |
| TC-D-019 | empty string → null | Negative | P1 | PASS |
| TC-D-020 | picks largest number from sentence | Functional | P0 | PASS |
| TC-D-021 | decimal "123.45" rounded → 123 | Edge | P2 | PASS |
| TC-D-022 | "0" → 0 (returned) | Boundary | P2 | PASS |
| TC-D-023 | case-insensitive "1 LAKH" | Edge | P2 | PASS |
| TC-D-024 | "12,345.67" mixed format | Edge | P2 | PASS |
| TC-D-025 | very large "99 crore" → 990000000 | Boundary | P2 | PASS |

## E. Parse Spoken Date (auto — 15 cases ✅)

| ID | Title | Type | Priority | Status |
|---|---|---|---|---|
| TC-E-001 | "5 may" → 2026-05-05 | Functional | P0 | PASS |
| TC-E-002 | "may 5" → 2026-05-05 | Functional | P0 | PASS |
| TC-E-003 | "5th may" ordinal → 2026-05-05 | Functional | P0 | PASS |
| TC-E-004 | "23rd june" → 2026-06-23 | Functional | P0 | PASS |
| TC-E-005 | "5 may 2025" with year | Functional | P1 | PASS |
| TC-E-006 | "may 5 2025" with year | Functional | P1 | PASS |
| TC-E-007 | "jan 1" abbreviated month | Functional | P0 | PASS |
| TC-E-008 | "december 31" last day | Boundary | P0 | PASS |
| TC-E-009 | "feb 29 2024" leap day | Edge | P1 | PASS |
| TC-E-010 | case insensitive "MAY 5" | Edge | P1 | PASS |
| TC-E-011 | invalid month "smay 5" → null | Negative | P1 | PASS |
| TC-E-012 | day=0 → null | Boundary | P1 | PASS |
| TC-E-013 | day=32 → null | Boundary | P1 | PASS |
| TC-E-014 | empty input → null | Negative | P1 | PASS |
| TC-E-015 | "15th august" → 2026-08-15 | Functional | P1 | PASS |

## F. Voice Intent — Budget Set (auto — 15 cases ✅)

| ID | Title | Type | Priority | Status |
|---|---|---|---|---|
| TC-F-001 | "set budget 50000" | Functional | P0 | PASS |
| TC-F-002 | "set my monthly budget to 50000" | Functional | P0 | PASS |
| TC-F-003 | "budget 50000" (bare) | Functional | P0 | PASS |
| TC-F-004 | "my budget is 50000" | Functional | P0 | PASS |
| TC-F-005 | "this month budget 50000" | Functional | P0 | PASS |
| TC-F-006 | "set budget fifty thousand" word-number | Voice | P0 | PASS |
| TC-F-007 | "set budget 1 lakh" Indian unit | Voice | P0 | PASS |
| TC-F-008 | "set budget 25k" abbrev | Voice | P0 | PASS |
| TC-F-009 | "make budget 30000" verb variant | Functional | P1 | PASS |
| TC-F-010 | "update budget to 40000" | Functional | P1 | PASS |
| TC-F-011 | "change budget at 60000" preposition variant | Edge | P2 | PASS |
| TC-F-012 | "monthly budget is 70000" | Functional | P1 | PASS |
| TC-F-013 | "this month's budget is 80000" | Edge | P1 | PASS |
| TC-F-014 | "budget = 90000" equals sign | Edge | P2 | PASS |
| TC-F-015 | "set budget 1.5 lakh" decimal Indian | Edge | P1 | PASS |

## G. Voice Intent — Budget Query (auto — 12 cases ✅)

| ID | Title | Type | Priority | Status |
|---|---|---|---|---|
| TC-G-001 | "budget left?" | Functional | P0 | PASS |
| TC-G-002 | "how much budget left" | Functional | P0 | PASS |
| TC-G-003 | "what is my budget" | Functional | P0 | PASS |
| TC-G-004 | "did i overspend" | Functional | P0 | PASS |
| TC-G-005 | "did i over spend" two-word | Edge | P1 | PASS |
| TC-G-006 | "am i over budget" | Functional | P1 | PASS |
| TC-G-007 | "am i under budget" | Functional | P1 | PASS |
| TC-G-008 | "good month or bad month" verdict | Voice | P1 | PASS |
| TC-G-009 | "how is my budget doing" | Voice | P1 | PASS |
| TC-G-010 | "show me my verdict" | Voice | P1 | PASS |
| TC-G-011 | "tell me my budget" | Voice | P1 | PASS |
| TC-G-012 | "budget remaining" | Functional | P1 | PASS |

## H. Voice Intent — Date Query (auto — 25 cases ✅)

| ID | Title | Type | Priority | Status |
|---|---|---|---|---|
| TC-H-001 | "how much did i spend yesterday" → date-query yesterday | Functional | P0 | PASS |
| TC-H-002 | "what did i spend today" → date-query today | Functional | P0 | PASS |
| TC-H-003 | "show this week" → this-week preset | Functional | P0 | PASS |
| TC-H-004 | "show me current week" → this-week | Edge | P1 | PASS |
| TC-H-005 | "last 7 days" → last-7 preset | Functional | P0 | PASS |
| TC-H-006 | "last seven days" word form | Voice | P1 | PASS |
| TC-H-007 | "last week" → previous Mon-Sun | Functional | P0 | PASS |
| TC-H-008 | "last 30 days" → 30-day rolling window | Functional | P1 | PASS |
| TC-H-009 | "last thirty days" word form | Voice | P1 | PASS |
| TC-H-010 | "from may 1 to may 10" range | Functional | P0 | PASS |
| TC-H-011 | "from may 1 till may 10" variant | Edge | P1 | PASS |
| TC-H-012 | "from may 1 until may 10" variant | Edge | P1 | PASS |
| TC-H-013 | "show me may 5" single date | Functional | P0 | PASS |
| TC-H-014 | "how much on food yesterday" → category drill-down | Functional | P0 | PASS |
| TC-H-015 | "how much spent on petrol today" | Functional | P0 | PASS |
| TC-H-016 | "how much on grocery this week" | Functional | P1 | PASS |
| TC-H-017 | "how many expenses today" count question | Edge | P1 | PASS |
| TC-H-018 | "tell me yesterday" → date-query | Edge | P1 | PASS |
| TC-H-019 | "total spent yesterday" | Functional | P1 | PASS |
| TC-H-020 | "expenses for today" | Functional | P1 | PASS |
| TC-H-021 | "last 7 days food" no question marker (unambiguous range) | Edge | P1 | PASS |
| TC-H-022 | "this week petrol" | Edge | P1 | PASS |
| TC-H-023 | "from may 1 to may 10 food" range + category | Edge | P1 | PASS |
| TC-H-024 | Disambig: "spent 500 on food yesterday" → NOT date-query | Negative | P0 | PASS |
| TC-H-025 | Disambig: "yesterday spent 500 food" → NOT date-query | Negative | P0 | PASS |

## I. Voice Intent — Negatives / Disambiguation (auto — 15 cases ✅)

| ID | Title | Type | Priority | Status |
|---|---|---|---|---|
| TC-I-001 | random sentence → none | Negative | P1 | PASS |
| TC-I-002 | empty transcript → none | Negative | P0 | PASS |
| TC-I-003 | "yesterday" with no question → none | Edge | P0 | PASS |
| TC-I-004 | "today" with no question → none | Edge | P0 | PASS |
| TC-I-005 | expense-add: "500 grocery today" → none | Negative | P0 | PASS |
| TC-I-006 | expense-add: "twenty rupees food yesterday" → none | Negative | P0 | PASS |
| TC-I-007 | expense-add: "spent 100 petrol" → none | Negative | P0 | PASS |
| TC-I-008 | garbage "set budget abc" → none | Negative | P0 | PASS |
| TC-I-009 | "budget" alone → none | Negative | P1 | PASS |
| TC-I-010 | "set budget" no amount → none | Negative | P1 | PASS |
| TC-I-011 | non-English characters handled | Security | P1 | PASS |
| TC-I-012 | very long noise → none | Performance | P2 | PASS |
| TC-I-013 | "spent 500 yesterday" no category → none | Negative | P0 | PASS |
| TC-I-014 | "yesterday food 500" expense pattern → none | Negative | P0 | PASS |
| TC-I-015 | SQL-injection-ish input safely handled | Security | P0 | PASS |

## J. Voice Date Extraction (auto — 20 cases ✅)

| ID | Title | Type | Priority | Status |
|---|---|---|---|---|
| TC-J-001 | "today" extracted | Functional | P0 | PASS |
| TC-J-002 | "yesterday" → today-1 | Functional | P0 | PASS |
| TC-J-003 | "day before yesterday" → today-2 | Edge | P0 | PASS |
| TC-J-004 | "5 may" | Functional | P0 | PASS |
| TC-J-005 | "may 5" | Functional | P0 | PASS |
| TC-J-006 | "5th may" ordinal | Functional | P0 | PASS |
| TC-J-007 | "23rd june" → previous year (future → -1) | Edge | P0 | PASS |
| TC-J-008 | "may 5 2025" inline year | Functional | P1 | PASS |
| TC-J-009 | "in 2025 on may 5" explicit year context | Edge | P1 | PASS |
| TC-J-010 | no date phrase → null | Negative | P1 | PASS |
| TC-J-011 | future month "october 12" → prev year | Edge | P0 | PASS |
| TC-J-012 | past month "january 5" → current year | Edge | P0 | PASS |
| TC-J-013 | stripped text excludes matched date | Integration | P0 | PASS |
| TC-J-014 | "jan 1" lowercase | Functional | P1 | PASS |
| TC-J-015 | "2024 rupees" NOT confused as year | Edge | P0 | PASS |
| TC-J-016 | "5 of june" preposition | Edge | P1 | PASS |
| TC-J-017 | "23rd of june" ordinal + prep | Edge | P1 | PASS |
| TC-J-018 | "june the 23rd" "the" word | Edge | P1 | PASS |
| TC-J-019 | "5 of this month" relative | Functional | P0 | PASS |
| TC-J-020 | "5 of last month" relative | Functional | P0 | PASS |

## K. Voice Expense Parse (auto — 20 cases ✅)

| ID | Title | Type | Priority | Status |
|---|---|---|---|---|
| TC-K-001 | "spent 500 on food today" full sentence | Functional | P0 | PASS |
| TC-K-002 | "500 petrol yesterday" terse | Functional | P0 | PASS |
| TC-K-003 | "1000 grocery" no date | Functional | P0 | PASS |
| TC-K-004 | note via "and note is" | Voice | P1 | PASS |
| TC-K-005 | note via "note:" colon | Voice | P1 | PASS |
| TC-K-006 | note via "for X" trailing | Voice | P1 | PASS |
| TC-K-007 | note via dash separator " - X" | Voice | P1 | PASS |
| TC-K-008 | date stripped before amount detection | Integration | P0 | PASS |
| TC-K-009 | keyword "biryani" → food | Voice | P1 | PASS |
| TC-K-010 | keyword "zepto" → grocery | Voice | P1 | PASS |
| TC-K-011 | keyword "diesel" → petrol | Voice | P1 | PASS |
| TC-K-012 | keyword "apollo" → medicine | Voice | P1 | PASS |
| TC-K-013 | no category → null | Negative | P1 | PASS |
| TC-K-014 | "for food" treats food as category | Edge | P1 | PASS |
| TC-K-015 | word-boundary "seafood" not food | Edge | P0 | PASS |
| TC-K-016 | date defaults to today | Functional | P1 | PASS |
| TC-K-017 | multi-keyword petrol+fuel | Edge | P2 | PASS |
| TC-K-018 | decimal amount preserved | Edge | P1 | PASS |
| TC-K-019 | empty input safely null | Negative | P1 | PASS |
| TC-K-020 | case-insensitive parse | Edge | P1 | PASS |

## L. Currency / HTML / Format (auto — 15 cases ✅)

| ID | Title | Type | Priority | Status |
|---|---|---|---|---|
| TC-L-001 | fmt 500 → ₹500 | Functional | P0 | PASS |
| TC-L-002 | fmt 1000 → ₹1,000 | Functional | P0 | PASS |
| TC-L-003 | fmt 100000 → ₹1,00,000 Indian grouping | Localization | P0 | PASS |
| TC-L-004 | fmt 0 → ₹0 | Edge | P1 | PASS |
| TC-L-005 | fmt negative number | Edge | P2 | PASS |
| TC-L-006 | fmt rounds decimals | Edge | P1 | PASS |
| TC-L-007 | escapeHTML `<script>` | Security | P0 | PASS |
| TC-L-008 | escapeHTML `&` ampersand | Security | P0 | PASS |
| TC-L-009 | escapeHTML quotes | Security | P0 | PASS |
| TC-L-010 | escapeHTML apostrophe | Security | P0 | PASS |
| TC-L-011 | escapeHTML empty string | Edge | P2 | PASS |
| TC-L-012 | fmtDate "2026-05-13" → "13 May" | UI | P1 | PASS |
| TC-L-013 | fmtFullDate Dec 25 | UI | P1 | PASS |
| TC-L-014 | fmt 1 crore Indian grouping | Localization | P1 | PASS |
| TC-L-015 | escapeHTML coerces non-string | Security | P1 | PASS |

## M. Budget Math (auto — 15 cases ✅)

| ID | Title | Type | Priority | Status |
|---|---|---|---|---|
| TC-M-001 | computeSpent May 2026 | Functional | P0 | PASS |
| TC-M-002 | computeSpent Apr 2026 partial | Functional | P0 | PASS |
| TC-M-003 | computeSpent for unrelated month = 0 | Negative | P1 | PASS |
| TC-M-004 | computeSpent for empty list = 0 | Negative | P1 | PASS |
| TC-M-005 | computeSpent ignores empty-date rows | Edge | P0 | PASS |
| TC-M-006 | verdict no budget | Functional | P0 | PASS |
| TC-M-007 | verdict good (under budget) | Functional | P0 | PASS |
| TC-M-008 | verdict exactly at budget = good | Boundary | P0 | PASS |
| TC-M-009 | verdict bad (over budget) | Functional | P0 | PASS |
| TC-M-010 | verdict bad with large spillover | Edge | P1 | PASS |
| TC-M-011 | verdict 0 spent under budget = good | Edge | P1 | PASS |
| TC-M-012 | verdict negative budget → no-budget | Negative | P2 | PASS |
| TC-M-013 | verdict spillover never negative | Boundary | P1 | PASS |
| TC-M-014 | computeSpent boundary first day of month | Boundary | P1 | PASS |
| TC-M-015 | computeSpent boundary last day Dec | Boundary | P1 | PASS |

## N. Category Aggregation (auto — 10 cases ✅)

| ID | Title | Type | Priority | Status |
|---|---|---|---|---|
| TC-N-001 | agg today: food=200, petrol=1000 | Functional | P0 | PASS |
| TC-N-002 | agg today counts per category | Functional | P0 | PASS |
| TC-N-003 | agg week food = 200+300+150 | Functional | P0 | PASS |
| TC-N-004 | agg week food count = 3 | Functional | P0 | PASS |
| TC-N-005 | agg empty range = empty object | Negative | P1 | PASS |
| TC-N-006 | agg this-week petrol count | Regression | P1 | PASS |
| TC-N-007 | agg this-week grocery total | Regression | P1 | PASS |
| TC-N-008 | agg sum equals range total | Integration | P0 | PASS |
| TC-N-009 | agg ignores empty-date rows | Edge | P0 | PASS |
| TC-N-010 | agg adds duplicate category amounts | Functional | P0 | PASS |

## O. Percentage / Donut Math (auto — 8 cases ✅)

| ID | Title | Type | Priority | Status |
|---|---|---|---|---|
| TC-O-001 | pct 200/1000 = 20 | Functional | P0 | PASS |
| TC-O-002 | pct 0/1000 = 0 | Boundary | P1 | PASS |
| TC-O-003 | pct 1000/1000 = 100 | Boundary | P1 | PASS |
| TC-O-004 | pct 333/1000 = 33 | Functional | P1 | PASS |
| TC-O-005 | pct divide-by-zero guarded | Negative | P0 | PASS |
| TC-O-006 | pct rounds half up | Edge | P2 | PASS |
| TC-O-007 | pct very small = 0 | Edge | P2 | PASS |
| TC-O-008 | pct sum 3 cats ≈ 100 (rounding gap) | Edge | P2 | PASS |

## P. Edge / Leap / DST / Performance (auto — 10 cases ✅)

| ID | Title | Type | Priority | Status |
|---|---|---|---|---|
| TC-P-001 | leap year Feb 28 → Feb 29 (2024) | Edge | P1 | PASS |
| TC-P-002 | non-leap Feb 28 → Mar 1 (2025) | Edge | P1 | PASS |
| TC-P-003 | addDays across DST | Edge | P2 | PASS |
| TC-P-004 | startOfWeek across month boundary | Boundary | P1 | PASS |
| TC-P-005 | filter spans year boundary | Boundary | P0 | PASS |
| TC-P-006 | filter last-of-month single day | Boundary | P1 | PASS |
| TC-P-007 | filter zero-padding consistency | Regression | P0 | PASS |
| TC-P-008 | filter 10000 entries under 200ms | Performance | P1 | PASS |
| TC-P-009 | category match longest-first (custom > builtin) | Regression | P0 | PASS |
| TC-P-010 | startOfWeek Jan 4 Sun → prev year | Edge | P1 | PASS |

---

# 🔵 MANUAL TEST CASES (136 cases — execute on device)

> **Test data prerequisites:** sign in to Google, link a fresh "Track Expenses" sheet, ensure the sheet has at least the following baseline entries for varied dates so range/category logic has something to display:
> - 2 entries today (Food ₹200, Petrol ₹1000)
> - 1 entry yesterday (Food ₹300)
> - 1 entry 2 days ago (Grocery ₹1500)
> - 1 entry 6 days ago (Food ₹150)
> - 1 entry 7 days ago (Gifts ₹500)
> - 1 entry 13 days ago (Food ₹100)
> - 1 entry last month (any category ₹500)

---

## Q. Add-Expense UI (25 manual cases)

| ID | Title | Type | Priority | Steps | Expected | Status |
|---|---|---|---|---|---|---|
| TC-Q-001 | Open app → Add tab is default | Functional | P0 | Launch app, complete sign-in | "Add" tab active, 9 category tiles visible, today's total shown | ⏳ |
| TC-Q-002 | Tap "Food" tile | Functional | P0 | Tap Food | Food tile highlights with accent border, Add button enables | ⏳ |
| TC-Q-003 | Enter amount and save | Functional | P0 | Cat=Food, Amount=500, tap Add | Toast "Saved", confetti, expense appears in Today list | ⏳ |
| TC-Q-004 | Save without category | Negative | P0 | Amount=500, tap Add | Add button disabled (greyed out) | ⏳ |
| TC-Q-005 | Save without amount | Negative | P0 | Cat=Food, no amount, tap Add | Add button disabled | ⏳ |
| TC-Q-006 | Save with amount=0 | Negative | P1 | Cat=Food, Amount=0 | Add button disabled (must be > 0) | ⏳ |
| TC-Q-007 | Save with negative amount | Negative | P1 | Amount=-100 | Input strips minus OR Add disabled | ⏳ |
| TC-Q-008 | Save with very large amount (10000000) | Boundary | P2 | Amount=10000000 | Saves and formats as ₹1,00,00,000 | ⏳ |
| TC-Q-009 | Save with decimals (123.45) | Edge | P2 | Amount=123.45 | Saves as ₹123 (rounded for display, raw stored) | ⏳ |
| TC-Q-010 | Save with note | Functional | P1 | Cat=Food, Amt=500, Note="lunch" | Saved with note, note visible on tap-to-expand | ⏳ |
| TC-Q-011 | Save with very long note (500 chars) | Boundary | P2 | Paste 500-char note | Saves; row shows truncated note, full visible on tap | ⏳ |
| TC-Q-012 | Save with emoji in note | Edge | P2 | Note="🍕 yum 🤤" | Emoji preserved on save and read | ⏳ |
| TC-Q-013 | Save with HTML-like note | Security | P0 | Note=`<script>alert(1)</script>` | Saved literally, NEVER executes, renders escaped on display | ⏳ |
| TC-Q-014 | Change date to yesterday and save | Functional | P0 | Date picker → yesterday, save | Saved with yesterday's date; appears under yesterday in by-date | ⏳ |
| TC-Q-015 | Date picker future date | Edge | P2 | Date = today+30 | Allows save (no business rule blocks future) | ⏳ |
| TC-Q-016 | Date picker 5 years ago | Edge | P2 | Date = 2021-01-01 | Saves with that date | ⏳ |
| TC-Q-017 | Add custom category — happy path | Functional | P0 | "+ Add" tile → Name="Travel" Color=blue → save | New tile appears at end; persists across reload | ⏳ |
| TC-Q-018 | Add custom category — empty name | Negative | P1 | Open modal, save with blank name | Save button disabled OR error | ⏳ |
| TC-Q-019 | Add custom category — duplicate name | Negative | P1 | Try name="Food" | Reject as duplicate OR allow with different key | ⏳ |
| TC-Q-020 | Add custom category — emoji-only label | Edge | P2 | Name="🏠" | Saves; tile shows the emoji | ⏳ |
| TC-Q-021 | Tap saved expense to expand | UI | P1 | Tap recent row | Row expands showing note + delete button | ⏳ |
| TC-Q-022 | Delete saved expense — confirm | Functional | P0 | Tap delete → "Delete" | Row disappears, toast "Deleted", today total updates | ⏳ |
| TC-Q-023 | Delete saved expense — cancel | Negative | P1 | Tap delete → "Cancel" | Modal closes, row remains | ⏳ |
| TC-Q-024 | Save offline (no internet) | PWA | P0 | Disable wifi, save expense | Error toast OR queued sync (verify against current behavior) | ⏳ |
| TC-Q-025 | Spam-tap Add button | Negative | P1 | Tap Add 5 times rapidly | Only one row saved (button disabled during save) | ⏳ |

## R. Dashboard / Monthly View (15 manual cases)

| ID | Title | Type | Priority | Steps | Expected | Status |
|---|---|---|---|---|---|---|
| TC-R-001 | Switch to Dashboard tab | Functional | P0 | Tap Dashboard | Monthly total, donut, top category visible | ⏳ |
| TC-R-002 | Bar chart renders | UI | P0 | View Dashboard | Bar chart of daily spend for current month | ⏳ |
| TC-R-003 | Donut chart renders | UI | P0 | View Dashboard | Donut shows per-category breakdown with legend | ⏳ |
| TC-R-004 | Tap "‹" prev month | Functional | P0 | Tap prev arrow | Header label shows prev month, charts re-render | ⏳ |
| TC-R-005 | Tap "›" next month | Functional | P0 | Tap next arrow | Header advances; future months show empty state | ⏳ |
| TC-R-006 | Navigate to empty month | Edge | P1 | Go back 12+ months until empty | "No data" placeholder; no chart errors | ⏳ |
| TC-R-007 | Year rollover Dec→Jan | Boundary | P1 | Navigate from Jan back one | Header shows "Dec YYYY-1", year updates | ⏳ |
| TC-R-008 | Category grouped list expand | UI | P1 | Tap "Food" category header | Group expands showing all Food entries for month | ⏳ |
| TC-R-009 | Category grouped list collapse | UI | P1 | Tap again | Group collapses | ⏳ |
| TC-R-010 | Budget banner shows when set | Integration | P0 | Set budget, return to Dashboard | Banner shows budget + spent + verdict | ⏳ |
| TC-R-011 | Budget banner — over budget | Integration | P0 | Set budget=100 when spend >100 | Banner shows OVERSPENT badge with animation | ⏳ |
| TC-R-012 | Edit budget from banner | Functional | P1 | Tap banner → modal | Modal opens with current value, save updates | ⏳ |
| TC-R-013 | Remove budget | Functional | P1 | Modal → "Remove budget" | Banner disappears, budget row deleted from sheet | ⏳ |
| TC-R-014 | Dashboard performance with 500 entries | Performance | P1 | Seed sheet with 500 entries | Render < 2s, scrolling smooth | ⏳ |
| TC-R-015 | Dashboard updates after Add | Integration | P0 | Add expense → Dashboard | Total reflects new amount immediately | ⏳ |

## S. Insights → By Date UI (25 manual cases — NEW IN v22)

| ID | Title | Type | Priority | Steps | Expected | Status |
|---|---|---|---|---|---|---|
| TC-S-001 | Tap Insights tab | Functional | P0 | Tap Insights | Verdict strip + Streak + By-Date all visible | ⏳ |
| TC-S-002 | Default chip is "Today" | UI | P0 | Open Insights | Today chip has accent gradient (active state) | ⏳ |
| TC-S-003 | Today total matches add-tab total | Integration | P0 | Compare numbers | Both show same ₹ for today | ⏳ |
| TC-S-004 | Today donut chart renders | UI | P0 | View | Donut shows today's categories with colors | ⏳ |
| TC-S-005 | Today entries list shows correct rows | Functional | P0 | View | Inline list of today's expenses, sorted | ⏳ |
| TC-S-006 | Tap "Yesterday" chip | Functional | P0 | Tap Yesterday | Card updates to yesterday's data, header label "Yesterday" | ⏳ |
| TC-S-007 | Tap "This week" chip | Functional | P0 | Tap | Mon-today range applied, totals correct | ⏳ |
| TC-S-008 | Tap "Last 7 days" chip | Functional | P0 | Tap | Today-6 to today, totals correct | ⏳ |
| TC-S-009 | Tap "Custom" chip → picker opens | UI | P0 | Tap Custom | Date picker panel slides down with From/To inputs | ⏳ |
| TC-S-010 | Custom range — valid Apply | Functional | P0 | From=this month 1, To=this month 5, Apply | Range applies, card updates, label shows "1–5 May" | ⏳ |
| TC-S-011 | Custom range — From > To | Negative | P0 | From=10 May, To=5 May, Apply | Error toast "From date is after To date", no change | ⏳ |
| TC-S-012 | Custom range — empty From | Negative | P1 | Leave From blank, Apply | Toast "Pick both From and To dates" | ⏳ |
| TC-S-013 | Custom range — From === To | Edge | P1 | Same date both | Treated as single day, header shows that date | ⏳ |
| TC-S-014 | Custom range across year boundary | Edge | P1 | From=2025-12-25 To=2026-01-05 | Total = all entries in window, label has years | ⏳ |
| TC-S-015 | Empty range shows empty state | UI | P0 | Range with no entries | Donut hidden, message "Nothing here. Try another date or range." | ⏳ |
| TC-S-016 | Donut center shows total ₹ | UI | P1 | Range with entries | Center of donut displays total amount, "total" below | ⏳ |
| TC-S-017 | Category list shows %, ₹, count | UI | P0 | Any range with multiple cats | Each row: icon, name, pct%, ₹amount, ×count | ⏳ |
| TC-S-018 | Category list ordered by spend | UI | P1 | Multi-cat range | Highest-spend category first | ⏳ |
| TC-S-019 | Inline entries list ordered by date desc | UI | P1 | Multi-day range | Newest first | ⏳ |
| TC-S-020 | Reset to today on tab switch | Functional | P0 | Insights → set last-7 → Add → Insights | Returns to default "Today" chip | ⏳ |
| TC-S-021 | Header label reflects active range | UI | P0 | Tap each chip | Header shows "Today", "Yesterday", "11–13 May", "7–13 May", etc. | ⏳ |
| TC-S-022 | Prev/Next arrows hidden on Insights | UI | P1 | View | Arrows around the header label not visible | ⏳ |
| TC-S-023 | Switch chip mid-render | Edge | P2 | Rapid-tap multiple chips | Last chip wins; chart doesn't double-render | ⏳ |
| TC-S-024 | Delete entry inside by-date list | Integration | P1 | Long-press entry → delete | Removed from sheet + card auto-updates | ⏳ |
| TC-S-025 | Update budget then view by-date | Integration | P2 | Set budget → switch chips | By-date data unaffected by budget changes | ⏳ |

## T. Voice UI / TTS (15 manual cases — partially NEW IN v22)

| ID | Title | Type | Priority | Steps | Expected | Status |
|---|---|---|---|---|---|---|
| TC-T-001 | Hold-to-speak (Add tab) — happy | Voice | P0 | Hold mic, say "500 food today", release | Result card shows parsed chips, Confirm saves | ⏳ |
| TC-T-002 | Voice — set budget | Voice | P0 | Say "set budget 50 thousand" | Budget saves; TTS says "Budget set to ₹50,000…" | ⏳ |
| TC-T-003 | Voice — budget left | Voice | P0 | Say "how much budget left" | TTS reads remaining or "no budget set" | ⏳ |
| TC-T-004 | Voice — "did i overspend" | Voice | P1 | Say it | TTS reads good/bad month verdict | ⏳ |
| TC-T-005 | Voice — yesterday query (NEW) | Voice | P0 | Insights tab → Ask by voice → "spent yesterday?" | Switches range to yesterday + speaks total + top cat | ⏳ |
| TC-T-006 | Voice — last 7 days (NEW) | Voice | P0 | "last 7 days" | Range applies, TTS reads total + top cat | ⏳ |
| TC-T-007 | Voice — from-to range (NEW) | Voice | P0 | "from may 1 to may 10" | Custom range applies, label "1–10 May", TTS reads | ⏳ |
| TC-T-008 | Voice — category drill (NEW) | Voice | P0 | "how much on food yesterday" | Range=yesterday but filtered to food, TTS reads food total | ⏳ |
| TC-T-009 | Voice — disambiguation: "spent 500 on food yesterday" | Voice | P0 | Hold mic (add tab) | Treated as ADD, not date-query; result card pre-fills 500+food+yesterday | ⏳ |
| TC-T-010 | Voice — mute toggle | Voice | P1 | Set `localStorage.voiceMuted='1'`, redo query | Result card shows; TTS does NOT speak | ⏳ |
| TC-T-011 | Voice — mic permission denied | Negative | P0 | Deny mic permission | Error toast "mic blocked", no crash | ⏳ |
| TC-T-012 | Voice — unsupported browser (desktop Firefox) | Compatibility | P1 | Use FF | Graceful "voice not supported" message | ⏳ |
| TC-T-013 | Voice — gibberish input | Negative | P1 | Say "blah blah" | Result card shows raw transcript, no parsed action | ⏳ |
| TC-T-014 | Voice — interrupt mid-utterance | Edge | P2 | Start speaking, tap cancel | Voice cancels, no save | ⏳ |
| TC-T-015 | Voice — TTS uses en-IN voice if available | Voice | P2 | Listen to reply | Indian English voice prefers; falls back to en-GB | ⏳ |

## U. PWA / Offline / Service Worker (12 manual cases)

| ID | Title | Type | Priority | Steps | Expected | Status |
|---|---|---|---|---|---|---|
| TC-U-001 | Install PWA prompt on Android | PWA | P0 | First load in Chrome Android | "Add to home screen" banner appears | ⏳ |
| TC-U-002 | Install PWA on iOS (Add to Home) | PWA | P1 | Safari → Share → Add | Icon appears on home screen | ⏳ |
| TC-U-003 | Launch installed PWA | PWA | P0 | Tap home icon | Opens in standalone mode (no browser chrome) | ⏳ |
| TC-U-004 | Service worker installs (v22) | PWA | P0 | DevTools → Application → SW | `expense-tracker-v22` registered & activated | ⏳ |
| TC-U-005 | Old cache deleted on update | PWA | P0 | Upgrade from v21 → v22 | Old v21 cache removed in activate event | ⏳ |
| TC-U-006 | Offline — already loaded app | PWA | P0 | Load app, go offline, refresh | Shell loads from cache | ⏳ |
| TC-U-007 | Offline — first-time load | PWA | P2 | Go offline before first visit | Fails gracefully (no Google auth) | ⏳ |
| TC-U-008 | Offline → online — auto-recover | PWA | P1 | Lose then regain network | Reloads data; user not signed out | ⏳ |
| TC-U-009 | App update propagates without reload | PWA | P1 | Deploy v23 while app open | New SW waits; reload picks it up | ⏳ |
| TC-U-010 | manifest.json icons load | PWA | P1 | Inspect manifest | 192 + 512 icons present, correct theme color | ⏳ |
| TC-U-011 | Splash screen shows on launch | PWA | P2 | Tap icon | Splash with bg color, then app | ⏳ |
| TC-U-012 | Service worker scope handles subpath | PWA | P2 | Deploy to /expense-tracker/ subpath | Relative `BASE` path resolves correctly | ⏳ |

## V. Persistence / Multi-tab / Recovery (10 manual cases)

| ID | Title | Type | Priority | Steps | Expected | Status |
|---|---|---|---|---|---|---|
| TC-V-001 | Reload preserves sheet selection | Persistence | P0 | Reload page | Same sheet auto-loads, no chooser shown | ⏳ |
| TC-V-002 | Custom categories persist | Persistence | P0 | Add custom cat → reload | Custom cat still in grid | ⏳ |
| TC-V-003 | Sign out clears token | Persistence | P0 | Sign out, reload | Login screen, no auto-sign-in | ⏳ |
| TC-V-004 | Two tabs same sheet — write in tab 1 | Concurrency | P1 | Add in tab 1, refresh tab 2 | Tab 2 shows new entry after reload | ⏳ |
| TC-V-005 | Two tabs same sheet — delete in tab 2 | Concurrency | P2 | Delete in tab 2 while tab 1 stale | Tab 1 may show stale until reload (Google API limitation) | ⏳ |
| TC-V-006 | localStorage corruption | Recovery | P1 | Manually break `customCategories` JSON | App handles gracefully (catches parse error OR resets) | ⏳ |
| TC-V-007 | Stale spreadsheet ID (deleted sheet) | Recovery | P0 | Trash the sheet in Drive, reload app | Falls back to chooser, doesn't crash | ⏳ |
| TC-V-008 | Token expiry mid-session | Recovery | P0 | Wait for token expiry (1 hr) → Add | Silent re-auth OR re-prompt sign-in | ⏳ |
| TC-V-009 | Voice mute pref persists | Persistence | P2 | Mute → reload | TTS stays muted | ⏳ |
| TC-V-010 | Migration v21→v22 keeps user data | Regression | P0 | Upgrade with existing budget+expenses | No data lost, new By-Date works | ⏳ |

## W. Accessibility / Responsive / Theme (14 manual cases)

| ID | Title | Type | Priority | Steps | Expected | Status |
|---|---|---|---|---|---|---|
| TC-W-001 | Tab order via keyboard | A11y | P1 | Tab through controls | Logical order, no traps | ⏳ |
| TC-W-002 | Focus rings visible | A11y | P1 | Tab to button | Visible outline matching theme | ⏳ |
| TC-W-003 | ARIA labels on icon buttons | A11y | P1 | Inspect mic, delete, prev/next | Each has aria-label | ⏳ |
| TC-W-004 | Color contrast amount text | A11y | P1 | Check ₹ amounts vs bg | WCAG AA pass (4.5:1+) | ⏳ |
| TC-W-005 | prefers-reduced-motion respected | A11y | P1 | OS setting → reduce motion | Confetti + floating money disabled | ⏳ |
| TC-W-006 | Screen reader reads category | A11y | P2 | NVDA / VoiceOver on tile | Reads "Food, category" | ⏳ |
| TC-W-007 | Responsive 320px width | Responsive | P0 | DevTools resize to 320 | All controls reachable, no horizontal scroll | ⏳ |
| TC-W-008 | Responsive 768px tablet | Responsive | P1 | Resize to 768 | Layout adapts, no broken grid | ⏳ |
| TC-W-009 | Responsive 1440px desktop | Responsive | P2 | Max width applied | Content centered with max-width clamp | ⏳ |
| TC-W-010 | Portrait orientation lock | Responsive | P2 | Rotate device | App still usable, no broken layouts | ⏳ |
| TC-W-011 | Landscape phone layout | Responsive | P2 | Rotate | No clipped controls | ⏳ |
| TC-W-012 | Dark theme readable | UI | P0 | View all tabs | All text legible against dark bg | ⏳ |
| TC-W-013 | Empty-state pulse animation | UI | P2 | Empty Add screen | Subtle pulse animation, not too fast | ⏳ |
| TC-W-014 | Floating-money background motion | UI | P2 | Idle on Add tab | Subtle floating ₹ symbols rise in background | ⏳ |

## X. Security / Negative / Compatibility (20 manual cases)

| ID | Title | Type | Priority | Steps | Expected | Status |
|---|---|---|---|---|---|---|
| TC-X-001 | XSS in note `<script>` | Security | P0 | Save note with script tag | Renders escaped, NEVER executes | ⏳ |
| TC-X-002 | XSS in custom category name | Security | P0 | Cat name = `<img src=x onerror=alert(1)>` | Escaped on display | ⏳ |
| TC-X-003 | XSS in spreadsheet name | Security | P1 | Rename sheet to script in Drive | Chooser displays escaped | ⏳ |
| TC-X-004 | Inject via voice transcript | Security | P0 | Speak something with `<` chars | Renders escaped in voice-heard chip | ⏳ |
| TC-X-005 | Token never exposed in DOM | Security | P0 | Inspect HTML / localStorage | Access token NOT in localStorage; only sheet IDs | ⏳ |
| TC-X-006 | HTTPS only | Security | P0 | Try http:// | Browser refuses or auto-upgrades | ⏳ |
| TC-X-007 | OAuth scope limited | Security | P0 | Review consent screen | Only spreadsheets + drive.metadata.readonly | ⏳ |
| TC-X-008 | No 3rd-party trackers | Security | P1 | DevTools → Network | No analytics / pixel beacons | ⏳ |
| TC-X-009 | CSP allows only Google + Chart.js | Security | P2 | Inspect headers | No inline-script eval allowed | ⏳ |
| TC-X-010 | Sheet API failure 401 | Negative | P0 | Force invalid token | Toast error, re-prompt sign-in | ⏳ |
| TC-X-011 | Sheet API failure 429 (rate limit) | Negative | P1 | Spam requests | Graceful error, doesn't crash | ⏳ |
| TC-X-012 | Network timeout | Negative | P1 | Throttle to 0 in DevTools | Toast error after timeout | ⏳ |
| TC-X-013 | Concurrent sheet write conflict | Negative | P2 | Edit sheet manually while app saves | App refetches OR shows stale until refresh | ⏳ |
| TC-X-014 | Browser: Chrome (mobile, Android) | Compatibility | P0 | Sign in, add, voice | All features work | ⏳ |
| TC-X-015 | Browser: Safari (iOS) | Compatibility | P0 | Same | Voice fallback if not supported | ⏳ |
| TC-X-016 | Browser: Firefox Desktop | Compatibility | P1 | Same | Voice gracefully unavailable | ⏳ |
| TC-X-017 | Browser: Edge Desktop | Compatibility | P2 | Same | All features OK | ⏳ |
| TC-X-018 | OS: Android 10 | Compatibility | P1 | Old device | App loads, perf acceptable | ⏳ |
| TC-X-019 | OS: iOS 15+ | Compatibility | P1 | iPhone | App loads, perf acceptable | ⏳ |
| TC-X-020 | Slow network (3G simulated) | Performance | P1 | DevTools throttle | First load < 5s, interactive < 8s | ⏳ |

---

## Test Summary

| Category | Pass | Fail | Pending | Total |
|---|---:|---:|---:|---:|
| Auto (A-P) | 252 | 0 | 0 | **252** |
| Manual (Q-X) | 0 | 0 | 136 | **136** |
| **TOTAL** | **252** | **0** | **136** | **388** |

## Exit Criteria

- ✅ **All P0 auto cases PASS** — 100% (no blockers in pure logic layer)
- ⏳ **P0 manual cases** must all PASS before release sign-off
- ⏳ **P1 manual cases** must have <10% FAIL or all FAILs root-caused
- ⏳ Performance: Dashboard render < 2s on 500-row sheet, voice-to-result < 1.5s

## Risk Areas Identified

1. **Voice disambiguation** is logic-heavy — covered by 25 auto + 5 manual cases. Real-world accents may trigger edge cases not in this suite.
2. **Google API quota** — no auto coverage for 429/quota errors. Manual TC-X-011 stresses this.
3. **iOS Safari voice** — Web Speech API has limited iOS support; TC-T-012/TC-X-015 are critical.
4. **Future-date defaulting** — extractDateFromVoice silently shifts future-looking dates to previous year (TC-J-007/J-011). Confirm with user this is intended UX.
5. **Concurrent multi-tab** — Google Sheets API has no real-time push; TC-V-004/V-005 explicitly document the staleness window.

---

*Generated by Wibey QA Agent on 2026-05-13.
Re-run automated suite anytime with: `node QA/auto-suite.js`.*
