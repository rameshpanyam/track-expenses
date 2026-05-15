# 📘 Expense Tracker — v25 Feature Guide

> **Release:** v25  ·  **Date:** May 2026  ·  **Cache:** `expense-tracker-v25`
> 14 new features added on top of v24. Everything is offline-first and syncs to your Google Sheet automatically.

---

## 📋 Quick reference — where to find each feature

| # | Feature | Where to find it |
|---|---|---|
| F1  | Quick-Add Shortcuts          | Long-press app icon on home screen |
| F2  | Recurring expenses           | 🛠️ Tools button → 🔁 Recurring |
| F3  | Today's Spend Hero           | Dashboard (top of page) |
| F4  | Undo Toast (deletes)         | Auto-shows after any delete |
| F5  | Global Search                | 🛠️ Tools → 🔍 Search |
| F6  | AI Category Suggestion       | Auto-shows under the Note input on Add screen |
| F7  | Spending Calendar Heatmap    | Dashboard → "Spending calendar" section |
| F8  | What-If Budget Simulator     | 🛠️ Tools → 🧮 What-if |
| F9  | Year-in-Review wrap          | 🛠️ Tools → 🎉 Year wrap |
| F10 | End-of-Month Forecast        | Dashboard → "Forecast" card |
| F11 | Category Sparklines          | Dashboard → "Category trends" |
| F12 | Voice-First Auto-Save        | Tap mic on Add screen (auto-on) |
| F13 | Savings Goals                | 🛠️ Tools → 🎯 Goals |
| F14 | Export CSV / PDF             | 🛠️ Tools → 📤 Export |

---

## 🛠️ The Tools menu

A new **🛠️ Tools** button has been added to the top-right header (next to 🎯 Budget and 📑 Sheet).
Tapping it opens a 6-button grid:

```
🔍 Search        🔁 Recurring     🎯 Goals
🧮 What-if       🎉 Year wrap     📤 Export
```

Use Tools as the launchpad for anything you don't use every day. Add, Dashboard, and Insights still live in the bottom tab bar.

---

## F1. Quick-Add Shortcuts

Pin the app to your iPhone / Android home screen. Then **long-press the icon** — you'll see four quick-jump shortcuts:

- **Food** — opens Add screen with Food pre-selected
- **Grocery** — opens Add screen with Grocery pre-selected
- **Petrol** — opens Add screen with Petrol pre-selected
- **Voice** — opens directly into voice listening mode

These work without unlocking your phone deeper than the home screen — perfect when you're at the petrol pump or paying for chai.

> **iPhone tip:** Install via Safari → Share → "Add to Home Screen" first, then long-press the icon.

---

## F2. Recurring Expenses

Stop manually re-logging Netflix, broadband, and rent every month.

### How to set up
1. **🛠️ Tools → 🔁 Recurring**
2. Enter:
   - **Label** — e.g. "Netflix"
   - **Amount** — e.g. 649
   - **Day of month** — 1–28 (the day it usually hits your account)
   - **Category** — pick from your existing list
3. Tap **+ Add recurring**

### How it works
- On app open each month, any recurring whose `dayOfMonth` has passed gets auto-logged with note `🔁 Netflix`.
- **Idempotent**: a recurring fires at most once per month, even if you open the app 50 times.
- A toast says *"🔁 N recurring expenses added"* when something fires.
- Data lives in a new **`Recurring`** tab in your Google Sheet.

### Editing / deleting
- Tap the **🗑️** on any row in the Recurring list to delete it.
- To change an amount, delete and re-add (kept simple on purpose).

---

## F3. Today's Spend Hero

A new card at the top of the Dashboard showing **today's spending** — separate from the month hero.

What you see:
```
TODAY
₹450                    Daily allowance
2 entries today              ₹1,000
━━━━━━━━━━━░░░░░░  45%
₹550 left in today's allowance
```

- The **daily allowance** is your monthly budget ÷ days in the month.
- The bar turns red and the message becomes *"🚨 Over daily allowance by ₹X"* when you've spent over today's share.
- No budget set? The card shows the spend but invites you to set one.

This card refreshes whenever you Add, Delete, or Undo an expense.

---

## F4. Undo Toast for Deletes

Delete by mistake? Now you have **5 seconds** to undo.

After tapping the 🗑️ on any expense and confirming, you'll see:
```
Deleted ✕   [Undo]
```

Tap **Undo** within 5 seconds to restore the row exactly as it was (same date, category, amount, note). After 5s, the toast disappears and the delete is final.

> **Tech detail:** "Undo" actually re-appends a new row in Sheets, since Google Sheets doesn't support row-level undo. The restored row gets a fresh `createdAt`, but everything else is identical.

---

## F5. Global Search

Find any expense by category, note text, or exact amount.

1. **🛠️ Tools → 🔍 Search**
2. The search bar drops down at the top of Dashboard
3. Type:
   - `food` — shows all Food expenses
   - `swiggy` — matches "Swiggy" in any note
   - `200` — finds expenses of exactly ₹200
4. Results show inline below the bar, newest first

Search is **debounced 150ms** so it stays fast even on big lists. Max 100 results shown.

Close with the ✕ on the right of the bar.

---

## F6. AI Category Suggestion

Type a note and the app guesses the category for you — based on **three layers** of intelligence:

### How it works
1. **Your history wins** — if you've tagged the word "starbucks" as Food 5 times before, "starbucks Bandra" jumps straight to Food.
2. **Merchant hints** — Uber/Ola → Other, Netflix/Spotify → Recharge, Amazon/Flipkart → Other.
3. **Keyword map** — built-in dictionary of 80+ Indian phrases (biryani, dosa, kirana, jio, bisleri, etc.) mapped to the right category.

### What you see
When the suggestion fires, a purple bar appears below the Note input:
```
🤖 Looks like Food  [Use it]  ✕
```

- Tap **Use it** to auto-select that category.
- Tap **✕** to dismiss for this entry.
- The suggestion only shows if you haven't picked a category yet.

### Training the AI
Every time you save an expense with a note + category, the app records every word ≥3 chars in your `catHistoryV1` localStorage. So the more you use it, the smarter it gets — purely on-device, no data leaves your phone.

---

## F7. Spending Calendar Heatmap

GitHub-style heatmap of your spending.

### Toggle modes
On Dashboard, look for **Spending calendar** with two pill buttons:
- **This month** — month grid (Mon–Sun layout, today highlighted)
- **Last 12 months** — 53-week rolling grid showing the whole year at a glance

### Color levels
| Level | Spend |
|---|---|
| ⬜ | Empty / no spend |
| 🟫 | Tiny (1–25% of peak day) |
| 🟧 | Light (25–50%) |
| 🟥 | Heavy (50–75%) |
| 🟥 (bright) | Peak (75–100%) |

Hover any cell to see the date + amount.

---

## F8. "What-If" Budget Simulator

Drag sliders to see how trimming categories would change your monthly spend.

1. **🛠️ Tools → 🧮 What-if**
2. Modal shows every category you spent on this month
3. Drag each slider 0–100% to "cut" that category
4. Bottom card live-updates:
   - **Current spend** — what you actually spent
   - **What-if spend** — after applying cuts
   - **You'd save** — the difference
   - **Projected over 6 months** — the multi-month savings

**Reset** clears all sliders to 0%. **Close** discards the simulation (it's never saved — purely a planning tool).

Example: Drag Food slider to 30%, Petrol to 20% → app shows you'd save ₹X this month and ₹6X over 6 months.

---

## F9. Year-in-Review Wrap

Spotify Wrapped, but for your money.

1. **🛠️ Tools → 🎉 Year wrap**
2. Pick a year from the dropdown (every year with data is auto-listed)
3. See:
   - **Hero card** — total spent, # entries, # months tracked
   - **Per-month** — average per month + your top category + biggest day
   - **Monthly trend bar chart** — all 12 months
   - **Donut** — where money went
   - **Verdict** — green months saved ₹X, red months overspent ₹Y, **net** result

4. Tap **📥 Save as PDF** to download a portable summary

Replayable anytime — flip back to 2024, 2025, 2026 at will.

---

## F10. End-of-Month Forecast

A predictive card on the Dashboard:

```
📈 On pace to overspend
Projected to be ₹3,200 over the ₹50,000 budget.

₹53,200
```

### How it computes
- `dailyAvg = spentSoFar / daysElapsed`
- `projected = dailyAvg × daysInMonth + (unfired recurring this month)`
- Compares vs your budget

### Visual states
- 🚨 **Bad** (over budget) — red tint, urgent tone
- ✨ **Good** (under budget) — green tint, encouraging
- 📈 **Neutral** (no budget) — just shows the projected total

Only appears after 3 days of data in the current month (avoids noisy early-month projections).

---

## F11. Category Trends (Sparklines)

Three-month spend trend per category, shown as tiny inline SVG charts.

Dashboard → "Category trends (last 3 months)" section shows the top 8 categories with:
- Icon + name on the left
- **Mini sparkline** in the middle (3 dots + connecting line)
- This month's amount on the right
- **↑ 23%** / **↓ 12%** / **— flat** delta versus last month

Lets you spot at a glance: "Oh, my Food spend went up 40% — what changed?"

---

## F12. Voice-First Auto-Save

Tap the 🎤 mic on Add screen, say *"200 rupees food today"* — and it's saved instantly with no confirmation step.

### Default behavior
- **Auto-save is ON by default**
- You'll see a toast: *"✓ Heard: 200 rupees food today"*
- An **Undo** button appears for 5 seconds (same as F4)

### When auto-save kicks in
Auto-save only fires for **clean parses** with:
- A valid amount (₹1 to ₹10 lakh range)
- A recognizable category

If the parse is ambiguous ("buy chai"), it falls back to the **preview card** so you can confirm/edit.

Budget queries, date queries, and budget-set commands still go to their normal flows (not auto-saved).

---

## F13. Savings Goals (Gamified)

Define what you're saving for, and the app auto-credits money to it from your good budget months.

### Setting up a goal
1. **🛠️ Tools → 🎯 Goals**
2. Enter:
   - **Goal name** — "Goa trip", "iPhone", "Emergency fund"
   - **Target ₹** — how much you want
   - **Deadline** (optional) — for context only, not enforced
3. Tap **+ Add goal**

### Auto-credit (the magic part)
Each time you open the app, for every **completed past month** that was under-budget:
- `savings = budget - spent`
- Split equally across all **active** (incomplete) goals
- Capped by each goal's headroom (so a small goal doesn't gobble all savings)
- **Idempotent**: each (goal × month) pair credits at most once

You'll see *"🎯 Goals auto-credited from good months"* when this fires.

### Manual deposits
Tap **+** on any goal row to add money manually — for one-off bonuses, gifts, or top-ups.

### Goal completion
When `saved >= target`, the goal turns **green** with a "done" tag. It stops receiving auto-credits (so new savings flow to your other active goals).

Data lives in a new **`Goals`** tab in your Google Sheet.

---

## F14. Export to CSV / PDF

Backup, share with your CA, or just review on a bigger screen.

1. **🛠️ Tools → 📤 Export**
2. Pick a range:
   - All time
   - This month / Last month
   - This year / Last year
3. Tap **📄 CSV** or **📕 PDF**
4. File downloads to your device

### CSV format
```
Date,Category,Amount,Note,CreatedAt
2026-05-13,Food,200,Swiggy,2026-05-13T10:30:00.000Z
...
```
RFC-4180 compliant — commas, quotes, and newlines in notes are properly escaped.

### PDF format
- Title page with range and totals
- Per-category breakdown
- Full transaction list (paginated)
- A4 portrait
- Uses **jsPDF** library — lazy-loaded only when you first export (saves bandwidth)

---

## 🧪 Quality Assurance

This release ships with **577 automated tests** (up from 252 in v24) covering:

| Section | Tests | Coverage |
|---|---|---|
| Date helpers, range filters, range presets | 47 | Existing |
| Voice parse: amount, category, intent | 110 | Existing |
| Verdict, streak, donut math | 95 | Existing |
| Q. yyyymm / dToYMD / clamp | 15 | v25 |
| R. Recurring due check | 20 | v25 |
| S. Goal auto-credit math | 30 | v25 |
| U. AI category suggestion | 50 | v25 |
| V. Forecast math | 25 | v25 |
| W. Sparkline / delta | 20 | v25 |
| X. Heatmap level | 20 | v25 |
| Y. What-if math | 20 | v25 |
| Z. Year-wrap aggregation | 20 | v25 |
| AA. CSV format | 20 | v25 |
| AB. Export range | 15 | v25 |
| AC. URL quickadd parsing | 10 | v25 |
| AD. Today hero math | 15 | v25 |
| AE. Search filter | 20 | v25 |
| AF. Undo state machine | 10 | v25 |
| AG. Voice routing | 10 | v25 |
| AH. ID generation | 5 | v25 |

Run locally with:
```bash
node QA/auto-suite.js
```

---

## 🔁 Migration notes

- **First open of v25** — service worker auto-bumps cache, creates the **Recurring** + **Goals** tabs in your existing Google Sheet on first use of those features. No manual migration needed.
- **Old data** — every v24 expense and budget remains intact and visible.
- **localStorage** — adds two new keys: `catHistoryV1` (AI training) and `recurringSheetGid` / `goalsSheetGid` (sheet pointers).

---

## ✨ Tips & Tricks

- **Stack quick-add + voice**: long-press icon → "Voice" → "200 food today" → done in 4 seconds
- **AI gets smarter**: the more notes you write with categories, the better F6 gets — there's no cap
- **Search by amount** to find duplicates: search `200` and look for two same-day entries
- **What-if + Goals combo**: simulate a 20% cut on Food, see the projected savings, then create a goal targeting that amount
- **Year wrap** is great as January wallpaper — screenshot the hero card

---

*Generated for v25. Updates as features evolve.*
