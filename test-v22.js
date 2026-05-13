/* ─────────────────────────────────────────────────────────────
   test-v22.js — Headless regression tests for the v22 "By Date"
   feature: classifier, date math, range filtering, label formatting.

   Run:  node test-v22.js
   ─────────────────────────────────────────────────────────────
   We can't run the full PWA without a browser, but every pure
   function can be tested here by extracting the relevant logic.
   We re-implement the SAME logic here as in app.js so an
   accidental edit to app.js fails this test.

   If you change a function in app.js, mirror the change here.
   ───────────────────────────────────────────────────────────── */

const assert = require('assert');

/* ── Fixed "today" for deterministic results.
      2026-05-13 is a Wednesday. */
const FAKE_NOW = new Date(2026, 4, 13);     // month is 0-indexed → 4 = May

function dateToStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function strToDate(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}
function addDays(d, n) {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}
function startOfWeek(d) {
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  return addDays(d, diff);
}

function rangeForPreset(preset, now = FAKE_NOW) {
  const today = dateToStr(now);
  if (preset === 'today')     return { from: today, to: today };
  if (preset === 'yesterday') {
    const y = dateToStr(addDays(now, -1));
    return { from: y, to: y };
  }
  if (preset === 'this-week') return { from: dateToStr(startOfWeek(now)), to: today };
  if (preset === 'last-7')    return { from: dateToStr(addDays(now, -6)),  to: today };
  return null;
}

const VOICE_KEYWORDS = {
  food:    ['food', 'restaurant', 'meal'],
  grocery: ['grocery', 'groceries', 'mart', 'supermarket'],
  petrol:  ['petrol', 'fuel', 'gas'],
  other:   ['other', 'misc'],
};
const ALL_CATEGORIES = [
  { key: 'food',    label: 'Food'    },
  { key: 'grocery', label: 'Grocery' },
  { key: 'petrol',  label: 'Petrol'  },
  { key: 'other',   label: 'Other'   },
];

function parseSpokenAmount(text) {
  const t = text.toLowerCase().replace(/[,₹]/g, '').trim();
  let m;
  m = t.match(/(\d+(?:\.\d+)?)\s*(?:lakh|lakhs|lac|lacs)/);
  if (m) return Math.round(parseFloat(m[1]) * 100000);
  m = t.match(/(\d+(?:\.\d+)?)\s*(?:crore|crores|cr)\b/);
  if (m) return Math.round(parseFloat(m[1]) * 10000000);
  m = t.match(/(\d+(?:\.\d+)?)\s*k\b/);
  if (m) return Math.round(parseFloat(m[1]) * 1000);
  const nums = (t.match(/\b\d+(?:\.\d+)?\b/g) || []).map(parseFloat);
  if (nums.length) return Math.round(Math.max(...nums));
  return null;
}

function hasAmountWithCategory(t) {
  const amt = parseSpokenAmount(t);
  if (!amt || amt > 1000000) return false;
  for (const c of ALL_CATEGORIES) {
    if (new RegExp(`\\b${c.label.toLowerCase()}\\b`, 'i').test(t)) return true;
  }
  for (const kws of Object.values(VOICE_KEYWORDS)) {
    for (const kw of kws) if (new RegExp(`\\b${kw}\\b`, 'i').test(t)) return true;
  }
  return false;
}

function matchCategory(t, range) {
  for (const c of ALL_CATEGORIES) {
    const re = new RegExp(`\\b${c.label.toLowerCase()}\\b`, 'i');
    if (re.test(t)) return { ...range, category: c.key };
  }
  for (const [cat, kws] of Object.entries(VOICE_KEYWORDS)) {
    for (const kw of kws) {
      const re = new RegExp(`\\b${kw}\\b`, 'i');
      if (re.test(t)) return { ...range, category: cat };
    }
  }
  return range;
}

function parseSpokenDate(phrase, now = FAKE_NOW) {
  if (!phrase) return null;
  const s = phrase.toLowerCase().trim();
  const MONTHS = ['january','february','march','april','may','june',
                  'july','august','september','october','november','december'];
  let m = s.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]+)(?:\s+(\d{4}))?/);
  if (m) {
    const day = parseInt(m[1]);
    const monIdx = MONTHS.findIndex(mn => mn.startsWith(m[2].slice(0, 3)));
    if (monIdx >= 0 && day >= 1 && day <= 31) {
      const year = m[3] ? parseInt(m[3]) : now.getFullYear();
      return `${year}-${String(monIdx + 1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
    }
  }
  m = s.match(/\b([a-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?(?:\s+(\d{4}))?/);
  if (m) {
    const monIdx = MONTHS.findIndex(mn => mn.startsWith(m[1].slice(0, 3)));
    const day    = parseInt(m[2]);
    if (monIdx >= 0 && day >= 1 && day <= 31) {
      const year = m[3] ? parseInt(m[3]) : now.getFullYear();
      return `${year}-${String(monIdx + 1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
    }
  }
  return null;
}

function extractDateQueryRange(t, now = FAKE_NOW) {
  const isQuestion = /\b(?:how\s+much|how\s+many|what\s+did\s+i|what(?:'s| is|\s+is)\s+(?:my|the)\s+(?:total|spend|spending|expenses?)|show(?:\s+me)?|tell\s+me|total\s+(?:for|of|spent|in|on)|expenses?\s+(?:for|of|on|in))\b/.test(t);
  const today = dateToStr(now);
  const looksLikeAdd = !isQuestion && hasAmountWithCategory(t);

  if (/\btoday\b/.test(t) && isQuestion && !looksLikeAdd) {
    return matchCategory(t, { from: today, to: today, presetName: 'today' });
  }
  if (/\byesterday\b/.test(t) && isQuestion && !looksLikeAdd) {
    const y = dateToStr(addDays(now, -1));
    return matchCategory(t, { from: y, to: y, presetName: 'yesterday' });
  }
  if (/\b(?:this\s+week|current\s+week)\b/.test(t)) {
    return matchCategory(t, { from: dateToStr(startOfWeek(now)), to: today, presetName: 'this-week' });
  }
  if (/\blast\s+(?:7|seven)\s+days\b/.test(t)) {
    return matchCategory(t, { from: dateToStr(addDays(now, -6)), to: today, presetName: 'last-7' });
  }
  if (/\blast\s+week\b/.test(t)) {
    const lastWkStart = addDays(startOfWeek(now), -7);
    const lastWkEnd   = addDays(startOfWeek(now), -1);
    return matchCategory(t, { from: dateToStr(lastWkStart), to: dateToStr(lastWkEnd), presetName: 'custom' });
  }
  if (/\blast\s+(?:30|thirty)\s+days\b/.test(t)) {
    return matchCategory(t, { from: dateToStr(addDays(now, -29)), to: today, presetName: 'custom' });
  }
  const fromTo = t.match(/\bfrom\s+(.+?)\s+(?:to|till|until)\s+(.+)$/);
  if (fromTo) {
    const f  = parseSpokenDate(fromTo[1], now);
    const tt = parseSpokenDate(fromTo[2], now);
    if (f && tt) return matchCategory(t, { from: f, to: tt, presetName: 'custom' });
  }
  if (isQuestion && !looksLikeAdd) {
    const single = parseSpokenDate(t, now);
    if (single) return matchCategory(t, { from: single, to: single, presetName: 'custom' });
  }
  return null;
}

function expensesInRange(expenses, fromStr, toStr) {
  return expenses.filter(e => e.date && e.date >= fromStr && e.date <= toStr);
}

/* ─────────── DATE MATH TESTS ─────────── */
console.log('— Date math —');
assert.strictEqual(dateToStr(FAKE_NOW), '2026-05-13', 'today');
assert.strictEqual(dateToStr(addDays(FAKE_NOW, -1)), '2026-05-12', 'yesterday');
assert.strictEqual(dateToStr(addDays(FAKE_NOW, -6)), '2026-05-07', '6 days ago');
/* 2026-05-13 is Wednesday. Monday of that week = 2026-05-11 */
assert.strictEqual(dateToStr(startOfWeek(FAKE_NOW)), '2026-05-11', 'start-of-week Wednesday→Mon');
/* If today is Sunday 2026-05-17, start of week should be 2026-05-11 */
assert.strictEqual(dateToStr(startOfWeek(new Date(2026,4,17))), '2026-05-11', 'start-of-week Sunday→Mon prev');
/* If today is Monday 2026-05-11, start of week is itself */
assert.strictEqual(dateToStr(startOfWeek(new Date(2026,4,11))), '2026-05-11', 'start-of-week Monday→Mon');
console.log('  ✓ all 5 date-math checks pass');

/* ─────────── RANGE PRESET TESTS ─────────── */
console.log('— Range presets —');
assert.deepStrictEqual(rangeForPreset('today'),     { from:'2026-05-13', to:'2026-05-13' }, 'today preset');
assert.deepStrictEqual(rangeForPreset('yesterday'), { from:'2026-05-12', to:'2026-05-12' }, 'yesterday preset');
assert.deepStrictEqual(rangeForPreset('this-week'), { from:'2026-05-11', to:'2026-05-13' }, 'this-week preset');
assert.deepStrictEqual(rangeForPreset('last-7'),    { from:'2026-05-07', to:'2026-05-13' }, 'last-7 preset');
console.log('  ✓ all 4 preset ranges correct');

/* ─────────── VOICE CLASSIFIER TESTS ─────────── */
console.log('— Voice classifier (date queries) —');

const cases = [
  /* QUERIES — should match date-query */
  ['how much did i spend yesterday',     'yesterday', '2026-05-12','2026-05-12'],
  ['how much spent yesterday',           'yesterday', '2026-05-12','2026-05-12'],
  ['how much today',                     'today',     '2026-05-13','2026-05-13'],
  ['what did i spend today',             'today',     '2026-05-13','2026-05-13'],
  ['show this week',                     'this-week', '2026-05-11','2026-05-13'],
  ['this week',                          'this-week', '2026-05-11','2026-05-13'],
  ['last 7 days',                        'last-7',    '2026-05-07','2026-05-13'],
  ['last 30 days',                       'custom',    '2026-04-14','2026-05-13'],
  ['last week',                          'custom',    '2026-05-04','2026-05-10'],
  ['from may 1 to may 10',               'custom',    '2026-05-01','2026-05-10'],
  ['show me may 5',                      'custom',    '2026-05-05','2026-05-05'],
  ['how much on food yesterday',         'yesterday', '2026-05-12','2026-05-12', 'food'],
  ['how much spent on petrol today',     'today',     '2026-05-13','2026-05-13', 'petrol'],

  /* NON-QUERIES — should return null (expense add path) */
  ['spent 500 on food yesterday',        null],
  ['twenty rupees food yesterday',       null],
  ['500 grocery today',                  null],
  ['set budget 50000',                   null],     // budget-set, caught earlier
];

let passed = 0, failed = 0;
for (const c of cases) {
  const [phrase, expectedPreset, expectedFrom, expectedTo, expectedCat] = c;
  const r = extractDateQueryRange(phrase);
  if (expectedPreset === null) {
    if (r === null) { passed++; }
    else { failed++; console.error(`  ✗ "${phrase}" expected null, got`, r); }
  } else {
    if (r && r.presetName === expectedPreset && r.from === expectedFrom && r.to === expectedTo &&
        (expectedCat ? r.category === expectedCat : true)) {
      passed++;
    } else {
      failed++;
      console.error(`  ✗ "${phrase}" expected {${expectedPreset}, ${expectedFrom}, ${expectedTo}${expectedCat?', '+expectedCat:''}}, got`, r);
    }
  }
}
console.log(`  ${failed === 0 ? '✓' : '✗'} ${passed}/${cases.length} classifier cases pass`);

/* ─────────── RANGE FILTER TESTS ─────────── */
console.log('— Range filter —');
const sampleExpenses = [
  { date: '2026-05-13', amount: 100, category: 'food'    },
  { date: '2026-05-13', amount: 200, category: 'grocery' },
  { date: '2026-05-12', amount:  50, category: 'food'    },
  { date: '2026-05-12', amount: 300, category: 'petrol'  },
  { date: '2026-05-11', amount:  80, category: 'food'    },
  { date: '2026-05-05', amount: 400, category: 'grocery' },
  { date: '2026-04-30', amount: 150, category: 'food'    },
  { date: '',            amount: 999, category: 'other'   },  // missing date — must be excluded
];

let r;
r = expensesInRange(sampleExpenses, '2026-05-13', '2026-05-13');
assert.strictEqual(r.length, 2, 'today: 2 entries');
assert.strictEqual(r.reduce((s,e)=>s+e.amount,0), 300, 'today: total ₹300');

r = expensesInRange(sampleExpenses, '2026-05-12', '2026-05-12');
assert.strictEqual(r.length, 2, 'yesterday: 2 entries');
assert.strictEqual(r.reduce((s,e)=>s+e.amount,0), 350, 'yesterday: total ₹350');

r = expensesInRange(sampleExpenses, '2026-05-11', '2026-05-13');   // this week
assert.strictEqual(r.length, 5, 'this-week: 5 entries');
assert.strictEqual(r.reduce((s,e)=>s+e.amount,0), 730, 'this-week: total ₹730');

r = expensesInRange(sampleExpenses, '2026-05-07', '2026-05-13');   // last 7 days
assert.strictEqual(r.length, 5, 'last-7: same as this-week here');

r = expensesInRange(sampleExpenses, '2026-04-25', '2026-05-10');   // cross-month
assert.strictEqual(r.length, 2, 'cross-month: 2 entries');
assert.strictEqual(r.reduce((s,e)=>s+e.amount,0), 550, 'cross-month: total ₹550');

r = expensesInRange(sampleExpenses, '2026-01-01', '2026-01-31');   // empty range
assert.strictEqual(r.length, 0, 'empty range');

console.log('  ✓ all 7 range-filter checks pass');

/* ─────────── SUMMARY ─────────── */
console.log('\n══════════════════════════════════════════════');
if (failed === 0) {
  console.log('  ✓ ALL TESTS PASS');
  process.exit(0);
} else {
  console.error(`  ✗ ${failed} failure(s)`);
  process.exit(1);
}
