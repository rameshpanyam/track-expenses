/* ═══════════════════════════════════════════════════════════════════
   LOAN TRACKER MODULE — v27.0
   Key changes from v26.1:
   ✓ Google Sheets real-time sync (Loans tab + Loan_Schedule tab)
   ✓ PDF repayment schedule upload & parse (CreditFair / IndusInd / Kotak)
   ✓ Schedule-based calculations — uses bank's exact amortisation table
   ✓ Flat-rate vs Reducing-balance loan types
   ✓ EMI due-day field (e.g. 5th for CreditFair, 4th for IndusInd)
   ✓ FIXED foreclosure: outstanding PRINCIPAL only + charge% + 18% GST
   ✓ Pre-populated: 3 real loans with exact schedules from PDFs
   ✓ Start-date-aware balance — pays from actual start, not today

   Storage:
     localStorage['expense-tracker.loans.v1']    – loan metadata
     localStorage['expense-tracker.loan-sch.v1'] – all schedules, keyed by loanId
   Sheets (real-time on every save):
     "Loans" tab         – one row per loan
     "Loan_Schedule" tab – one row per installment
   ═══════════════════════════════════════════════════════════════════ */

'use strict';

/* ─── Constants ─────────────────────────────────────────────────── */
const LOAN_STORAGE_KEY     = 'expense-tracker.loans.v1';
const LOAN_SCH_STORAGE_KEY = 'expense-tracker.loan-sch.v1';
const FORECLOSURE_GST_PERCENT    = 18;
const DEFAULT_FORECLOSURE_PERCENT = 5;

const LOANS_TAB_NAME   = 'Loans';
const LOANS_HEADERS    = ['ID','Name','Type','RateType','Principal','InterestRate',
                          'TenureMonths','StartDate','EMIDueDay','EMI',
                          'ForeClosureChargePct','Status','ClosedDate',
                          'ClosedAmount','Color','HasSchedule','CreatedAt','UpdatedAt'];
const SCH_TAB_NAME     = 'Loan_Schedule';
const SCH_HEADERS      = ['LoanID','LoanName','InstNo','Date','EMI','Principal','Interest','Balance'];
// v26.5 — Loans_Meta sheet stores closure-planning savings inputs (single row).
const META_TAB_NAME    = 'Loans_Meta';
const META_HEADERS     = ['Key','Value','UpdatedAt'];

const LOAN_TYPES = [
  { key: 'personal',    icon: '💼', label: 'Personal Loan' },
  { key: 'home',        icon: '🏠', label: 'Home Loan' },
  { key: 'auto',        icon: '🚗', label: 'Auto Loan' },
  { key: 'credit-card', icon: '💳', label: 'Credit Card' },
  { key: 'education',   icon: '🎓', label: 'Education Loan' },
  { key: 'business',    icon: '🏢', label: 'Business Loan' },
  { key: 'other',       icon: '📦', label: 'Other' },
];

const LOAN_COLORS = [
  '#FF6B6B','#FFA726','#FFCA28','#66BB6A','#26C6DA',
  '#42A5F5','#7C5CFC','#AB47BC','#EC407A','#78909C',
];

/* ─── State ──────────────────────────────────────────────────────── */
var loanState          = null;
var loanSchedules      = {};   // { loanId: [{no,date,emi,principal,interest,balance},...] }
var loanActiveSubtab   = 'overview';
var loanEditingId      = null;
var loanSchedulePreview = null;  // parsed schedule pending confirmation
var loansGid           = Number(localStorage.getItem('loansSheetGid')   ?? -1);
var schGid             = Number(localStorage.getItem('schSheetGid')     ?? -1);
let pdfjsLib_          = null;   // lazy-loaded

/* ═══════════════════════════════════════════════════════════════════
   STORAGE
   ═══════════════════════════════════════════════════════════════════ */
function loadLoanState() {
  try {
    const raw = localStorage.getItem(LOAN_STORAGE_KEY);
    loanState = raw ? JSON.parse(raw)
                    : { loans: [], monthlySavings: 0, currentSavings: 0, emergencyReserve: 0,
                        targetDate: null, closureOrder: [] };
    // Forward-compat backfill
    if (!loanState.loans)          loanState.loans = [];
    if (loanState.monthlySavings   == null) loanState.monthlySavings   = 0;
    // v26.5 — Closure planning: lump-sum pool + protected reserve.
    if (loanState.currentSavings   == null) loanState.currentSavings   = 0;
    if (loanState.emergencyReserve == null) loanState.emergencyReserve = 0;
    if (!loanState.closureOrder)   loanState.closureOrder = [];
    loanState.loans.forEach(l => {
      if (l.foreclosureChargePercent == null) l.foreclosureChargePercent = DEFAULT_FORECLOSURE_PERCENT;
      if (!l.rateType)   l.rateType   = 'reducing';
      if (!l.emiDueDay)  l.emiDueDay  = null;
      if (l.hasSchedule == null) l.hasSchedule = false;
    });

    // Load separate schedule store
    const rawSch = localStorage.getItem(LOAN_SCH_STORAGE_KEY);
    loanSchedules = rawSch ? JSON.parse(rawSch) : {};
  } catch (e) {
    console.warn('loadLoanState error', e);
    loanState     = { loans: [], monthlySavings: 0, currentSavings: 0, emergencyReserve: 0,
                      targetDate: null, closureOrder: [] };
    loanSchedules = {};
  }
}

function saveLoanState() {
  try {
    localStorage.setItem(LOAN_STORAGE_KEY, JSON.stringify(loanState));
    localStorage.setItem(LOAN_SCH_STORAGE_KEY, JSON.stringify(loanSchedules));
  } catch (e) {
    console.warn('saveLoanState error', e);
  }
  // Fire-and-forget sheet sync (non-blocking — UI stays instant)
  syncLoansToSheet().catch(e => console.warn('Loan sheet sync failed:', e.message));
  syncLoanMetaToSheet().catch(e => console.warn('Loan meta sync failed:', e.message));
}

function saveLoanSchedule(loanId, rows) {
  loanSchedules[loanId] = rows;
  try { localStorage.setItem(LOAN_SCH_STORAGE_KEY, JSON.stringify(loanSchedules)); } catch(e){}
  syncScheduleToSheet(loanId, rows).catch(e => console.warn('Schedule sync failed:', e.message));
}

function getLoanSchedule(loanId) {
  return loanSchedules[loanId] || [];
}

/* ═══════════════════════════════════════════════════════════════════
   GOOGLE SHEETS SYNC
   ═══════════════════════════════════════════════════════════════════ */
async function ensureLoansTab() {
  if (!window.spreadsheetId || !window.accessToken) return false;
  const meta = await window.sheetsRequest('GET', `/${spreadsheetId}?fields=sheets.properties`);
  const tab  = meta.sheets.find(s => s.properties.title === LOANS_TAB_NAME);
  if (tab) {
    loansGid = tab.properties.sheetId;
    localStorage.setItem('loansSheetGid', loansGid);
    const hdr = await window.sheetsRequest('GET',
      `/${spreadsheetId}/values/${LOANS_TAB_NAME}!A1:R1`);
    if (!hdr.values?.length) {
      await window.sheetsRequest('POST',
        `/${spreadsheetId}/values/${LOANS_TAB_NAME}!A1:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
        { values: [LOANS_HEADERS] });
    }
  } else {
    const res = await window.sheetsRequest('POST', `/${spreadsheetId}:batchUpdate`,
      { requests: [{ addSheet: { properties: { title: LOANS_TAB_NAME } } }] });
    loansGid = res.replies[0].addSheet.properties.sheetId;
    localStorage.setItem('loansSheetGid', loansGid);
    await window.sheetsRequest('POST',
      `/${spreadsheetId}/values/${LOANS_TAB_NAME}!A1:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
      { values: [LOANS_HEADERS] });
  }
  return true;
}

async function ensureSchTab() {
  if (!window.spreadsheetId || !window.accessToken) return false;
  const meta = await window.sheetsRequest('GET', `/${spreadsheetId}?fields=sheets.properties`);
  const tab  = meta.sheets.find(s => s.properties.title === SCH_TAB_NAME);
  if (tab) {
    schGid = tab.properties.sheetId;
    localStorage.setItem('schSheetGid', schGid);
    const hdr = await window.sheetsRequest('GET',
      `/${spreadsheetId}/values/${SCH_TAB_NAME}!A1:H1`);
    if (!hdr.values?.length) {
      await window.sheetsRequest('POST',
        `/${spreadsheetId}/values/${SCH_TAB_NAME}!A1:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
        { values: [SCH_HEADERS] });
    }
  } else {
    const res = await window.sheetsRequest('POST', `/${spreadsheetId}:batchUpdate`,
      { requests: [{ addSheet: { properties: { title: SCH_TAB_NAME } } }] });
    schGid = res.replies[0].addSheet.properties.sheetId;
    localStorage.setItem('schSheetGid', schGid);
    await window.sheetsRequest('POST',
      `/${spreadsheetId}/values/${SCH_TAB_NAME}!A1:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
      { values: [SCH_HEADERS] });
  }
  return true;
}

async function syncLoansToSheet() {
  if (!window.spreadsheetId || !window.accessToken) return;
  await ensureLoansTab();
  // Overwrite entire Loans data range (row 2 onwards)
  const rows = loanState.loans.map(l => [
    l.id, l.name, l.type, l.rateType || 'reducing',
    l.principal, l.interestRate, l.tenureMonths,
    l.startDate, l.emiDueDay || '', l.emi,
    l.foreclosureChargePercent, l.status,
    l.closedDate || '', l.closedAmount || '',
    l.color, l.hasSchedule ? 'YES' : 'NO',
    l.createdAt, l.updatedAt,
  ]);
  // Clear old data then write fresh
  if (rows.length > 0) {
    await window.sheetsRequest('PUT',
      `/${spreadsheetId}/values/${LOANS_TAB_NAME}!A2:R${rows.length + 1}?valueInputOption=RAW`,
      { values: rows });
    // Clear any leftover rows below
    const clearStart = rows.length + 2;
    await window.sheetsRequest('POST',
      `/${spreadsheetId}/values/${LOANS_TAB_NAME}!A${clearStart}:R${clearStart + 100}:clear`, null);
  }
}

/** v26.5 — Sync the 3 savings inputs to the Loans_Meta tab.
 *  Tab format: { Key, Value, UpdatedAt } — one row per setting. */
async function syncLoanMetaToSheet() {
  if (!window.spreadsheetId || !window.accessToken) return;
  const meta = await window.sheetsRequest('GET', `/${spreadsheetId}?fields=sheets.properties`);
  const tab  = meta.sheets.find(s => s.properties.title === META_TAB_NAME);
  if (!tab) {
    await window.sheetsRequest('POST', `/${spreadsheetId}:batchUpdate`,
      { requests: [{ addSheet: { properties: { title: META_TAB_NAME } } }] });
    await window.sheetsRequest('POST',
      `/${spreadsheetId}/values/${META_TAB_NAME}!A1:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
      { values: [META_HEADERS] });
  }
  const now = new Date().toISOString();
  const rows = [
    ['currentSavings',   loanState.currentSavings   || 0, now],
    ['monthlySavings',   loanState.monthlySavings   || 0, now],
    ['emergencyReserve', loanState.emergencyReserve || 0, now],
  ];
  await window.sheetsRequest('PUT',
    `/${spreadsheetId}/values/${META_TAB_NAME}!A2:C${rows.length + 1}?valueInputOption=RAW`,
    { values: rows });
}

async function syncScheduleToSheet(loanId, rows) {
  if (!window.spreadsheetId || !window.accessToken || !rows?.length) return;
  await ensureSchTab();
  const loan = loanState.loans.find(l => l.id === loanId);
  const loanName = loan?.name || loanId;

  // Read all existing schedule rows
  const existing = await window.sheetsRequest('GET',
    `/${spreadsheetId}/values/${SCH_TAB_NAME}!A:H`);
  const allRows = (existing.values || []).slice(1); // skip header

  // Remove rows for this loan
  const kept = allRows.filter(r => r[0] !== loanId);
  // Add new rows for this loan
  const newRows = rows.map((r, i) => [
    loanId, loanName, r.no || (i + 1), r.date,
    r.emi, r.principal, r.interest, r.balance,
  ]);
  const combined = [SCH_HEADERS, ...kept, ...newRows];

  // Rewrite entire sheet
  await window.sheetsRequest('PUT',
    `/${spreadsheetId}/values/${SCH_TAB_NAME}!A1:H${combined.length}?valueInputOption=RAW`,
    { values: combined });
}

/* ═══════════════════════════════════════════════════════════════════
   v28.4 — PULL-ON-SIGN-IN LOADERS
   Called from app.js sign-in flow. Sheet wins on conflict so that
   when a user signs in on a fresh device, their loans/schedules/
   closure-planning inputs hydrate from the spreadsheet rather than
   starting empty from localStorage.
   ═══════════════════════════════════════════════════════════════════ */

/** Pull all loans from the "Loans" tab into loanState.loans.
 *  No-op if the tab is empty (keeps whatever localStorage has, which
 *  may include the pre-populated demo loans on a fresh install). */
async function loadLoansFromSheet() {
  if (!window.spreadsheetId || !window.accessToken) return false;
  if (typeof window.sheetsRequest !== 'function') return false;

  // Make sure local state object exists before we mutate it
  if (!loanState) loadLoanState();

  // Ensure the Loans tab + header row exist before reading
  await ensureLoansTab();

  const data = await window.sheetsRequest('GET',
    `/${window.spreadsheetId}/values/${LOANS_TAB_NAME}!A:R`);
  const rows = data.values || [];
  if (rows.length < 2) {
    // Sheet has only the header (or nothing) — keep local cache as-is.
    return true;
  }

  const loans = rows.slice(1)
    .filter(r => r[0]) // require an ID
    .map(r => ({
      id:                       r[0],
      name:                     r[1] || '',
      type:                     r[2] || 'other',
      rateType:                 r[3] || 'reducing',
      principal:                parseFloat(r[4])  || 0,
      interestRate:             parseFloat(r[5])  || 0,
      tenureMonths:             parseInt(r[6], 10) || 0,
      startDate:                r[7] || '',
      emiDueDay:                r[8] ? parseInt(r[8], 10) : null,
      emi:                      parseFloat(r[9])  || 0,
      foreclosureChargePercent: r[10] !== '' && r[10] != null
                                  ? parseFloat(r[10])
                                  : DEFAULT_FORECLOSURE_PERCENT,
      status:                   r[11] || 'active',
      closedDate:               r[12] || null,
      closedAmount:             r[13] ? parseFloat(r[13]) : null,
      color:                    r[14] || LOAN_COLORS[0],
      hasSchedule:              (r[15] === 'YES' || r[15] === 'true'),
      createdAt:                r[16] || '',
      updatedAt:                r[17] || '',
    }));

  loanState.loans = loans;
  try {
    localStorage.setItem(LOAN_STORAGE_KEY, JSON.stringify(loanState));
  } catch (e) { /* no-op */ }

  // Hide the pre-populate prompt — sheet just told us what loans exist
  window._loanNeedsPrePop = false;
  // Re-publish the (now-fresh) array to window
  window.loanState = loanState;
  return true;
}

/** Pull all amortization rows from "Loan_Schedule" into loanSchedules.
 *  Groups by LoanID into the {loanId: [rows]} map that the rest of the
 *  module expects. */
async function loadLoanScheduleFromSheet() {
  if (!window.spreadsheetId || !window.accessToken) return false;
  if (typeof window.sheetsRequest !== 'function') return false;

  await ensureSchTab();

  const data = await window.sheetsRequest('GET',
    `/${window.spreadsheetId}/values/${SCH_TAB_NAME}!A:H`);
  const rows = data.values || [];
  if (rows.length < 2) return true; // header only — nothing to load

  const grouped = {};
  for (const r of rows.slice(1)) {
    const loanId = r[0];
    if (!loanId) continue;
    if (!grouped[loanId]) grouped[loanId] = [];
    grouped[loanId].push({
      no:        parseInt(r[2], 10) || (grouped[loanId].length + 1),
      date:      r[3] || '',
      emi:       parseFloat(r[4]) || 0,
      principal: parseFloat(r[5]) || 0,
      interest:  parseFloat(r[6]) || 0,
      balance:   parseFloat(r[7]) || 0,
    });
  }
  // Sort each loan's schedule by installment number for safety
  Object.values(grouped).forEach(arr => arr.sort((a, b) => a.no - b.no));

  loanSchedules = grouped;
  try {
    localStorage.setItem(LOAN_SCH_STORAGE_KEY, JSON.stringify(loanSchedules));
  } catch (e) { /* no-op */ }
  window.loanSchedules = loanSchedules;
  return true;
}

/** Pull closure-planning inputs (currentSavings, monthlySavings,
 *  emergencyReserve) from the Loans_Meta tab. */
async function loadLoanMetaFromSheet() {
  if (!window.spreadsheetId || !window.accessToken) return false;
  if (typeof window.sheetsRequest !== 'function') return false;
  if (!loanState) loadLoanState();

  // Check if Loans_Meta tab exists — don't create it on read
  const meta = await window.sheetsRequest('GET',
    `/${window.spreadsheetId}?fields=sheets.properties`);
  const tab  = meta.sheets.find(s => s.properties.title === META_TAB_NAME);
  if (!tab) return true; // tab not created yet — nothing to load

  const data = await window.sheetsRequest('GET',
    `/${window.spreadsheetId}/values/${META_TAB_NAME}!A:C`);
  const rows = data.values || [];
  if (rows.length < 2) return true;

  for (const r of rows.slice(1)) {
    const key = r[0];
    const val = parseFloat(r[1]);
    if (!key || isNaN(val)) continue;
    if (key === 'currentSavings')   loanState.currentSavings   = val;
    if (key === 'monthlySavings')   loanState.monthlySavings   = val;
    if (key === 'emergencyReserve') loanState.emergencyReserve = val;
  }
  try {
    localStorage.setItem(LOAN_STORAGE_KEY, JSON.stringify(loanState));
  } catch (e) { /* no-op */ }
  window.loanState = loanState;
  return true;
}

/* ═══════════════════════════════════════════════════════════════════
   AMORTIZATION MATH
   ═══════════════════════════════════════════════════════════════════ */

/** Standard EMI formula (reducing balance). */
function calcEmi(principal, annualRate, tenureMonths) {
  if (!principal || !tenureMonths) return 0;
  const r = (annualRate || 0) / 12 / 100;
  if (r === 0) return Math.round(principal / tenureMonths);
  const n = tenureMonths;
  return Math.round(principal * r * Math.pow(1 + r, n) / (Math.pow(1 + r, n) - 1));
}

/** Reducing-balance outstanding after N EMI payments. */
function outstandingReducing(principal, annualRate, emi, monthsPaid) {
  if (!principal || monthsPaid <= 0) return Math.max(0, principal);
  const r = (annualRate || 0) / 12 / 100;
  let bal = principal;
  for (let i = 0; i < monthsPaid; i++) {
    bal -= (emi - bal * r);
    if (bal <= 0) return 0;
  }
  return Math.round(bal);
}

/** Flat-rate outstanding: only principal reduces linearly. */
function outstandingFlat(principal, tenureMonths, monthsPaid) {
  const perMonth = principal / (tenureMonths || 1);
  return Math.max(0, Math.round(principal - perMonth * monthsPaid));
}

/** Balance from uploaded schedule — uses last paid row's closing balance. */
function balanceFromSchedule(loanId) {
  const schedule = getLoanSchedule(loanId);
  if (!schedule.length) return null;
  const today = new Date(); today.setHours(23, 59, 59, 999);
  let lastBalance = null;
  for (const row of schedule) {
    if (new Date(row.date) <= today) lastBalance = row.balance;
    else break;
  }
  // If no row is due yet (loan just started), return the first row's balance + emi (before first payment)
  if (lastBalance === null) {
    const loan = loanState.loans.find(l => l.id === loanId);
    return loan ? loan.principal : schedule[0].balance + schedule[0].principal;
  }
  return Math.max(0, lastBalance);
}

/** Calendar months between two dates (endDate defaults to today). */
function monthsBetween(startDate, endDate) {
  const s = new Date(startDate);
  const e = endDate ? new Date(endDate) : new Date();
  return Math.max(0, (e.getFullYear() - s.getFullYear()) * 12 + (e.getMonth() - s.getMonth()));
}

/** Current outstanding principal for any loan. */
function loanCurrentBalance(loan) {
  if (!loan) return 0;
  if (loan.status === 'closed') return 0;

  if (loan.hasSchedule) {
    const schBal = balanceFromSchedule(loan.id);
    if (schBal !== null) return schBal;
  }

  // Formula-based fallback
  if (!loan.startDate) return loan.principal || 0;
  const monthsPaid = monthsBetween(loan.startDate);
  if (loan.rateType === 'flat') {
    return outstandingFlat(loan.principal, loan.tenureMonths, monthsPaid);
  }
  return outstandingReducing(loan.principal, loan.interestRate, loan.emi, monthsPaid);
}

/** Months remaining until loan reaches ₹0. */
function loanMonthsRemaining(loan) {
  if (!loan || loan.status === 'closed') return 0;
  if (loan.hasSchedule) {
    const schedule = getLoanSchedule(loan.id);
    if (schedule.length) {
      const today = new Date(); today.setHours(23, 59, 59, 999);
      return schedule.filter(r => new Date(r.date) > today).length;
    }
  }
  const bal = loanCurrentBalance(loan);
  if (!bal || bal <= 0) return 0;
  const r = (loan.interestRate || 0) / 12 / 100;
  if (r === 0) return Math.ceil(bal / loan.emi);
  if (loan.emi <= bal * r) return Infinity;
  return Math.ceil(Math.log(loan.emi / (loan.emi - bal * r)) / Math.log(1 + r));
}

/**
 * FIXED foreclosure cost:
 *   total = outstanding PRINCIPAL + (principal × chargePct%) + GST-on-charge
 *   No future interest is included — that's the bank's problem once you close.
 */
function foreclosureCost(loan, balancePrincipal) {
  const principal = Math.max(0, balancePrincipal || 0);
  const pct = loan.foreclosureChargePercent ?? DEFAULT_FORECLOSURE_PERCENT;
  const charge  = Math.round(principal * pct / 100);
  const gst     = Math.round(charge * FORECLOSURE_GST_PERCENT / 100);
  const total   = principal + charge + gst;
  return { principal: Math.round(principal), chargePercent: pct, charge, gst, total };
}

/** Project outstanding for next nMonths (schedule-aware). */
function projectLoan(loan, nMonths) {
  const today = new Date();
  const schedule = loan.hasSchedule ? getLoanSchedule(loan.id) : [];
  const out = [];

  for (let i = 0; i < nMonths; i++) {
    const d = new Date(today.getFullYear(), today.getMonth() + i, 1);
    const monthKey = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
    const monthLabel = d.toLocaleString('en-US', { month: 'short', year: 'numeric' });

    let balance = 0;
    if (schedule.length) {
      // Use last schedule row whose month <= this projected month
      const target = d.getFullYear() * 12 + d.getMonth();
      let found = null;
      for (const r of schedule) {
        const rd = new Date(r.date);
        if (rd.getFullYear() * 12 + rd.getMonth() <= target) found = r;
      }
      balance = found ? Math.max(0, found.balance) : loan.principal;
      // If all schedule rows are before today but month is future, check if closed
      const last = schedule[schedule.length - 1];
      if (last && new Date(last.date).getFullYear() * 12 + new Date(last.date).getMonth() < target) {
        balance = 0;
      }
    } else {
      const monthsAhead = i + monthsBetween(loan.startDate);
      if (loan.rateType === 'flat') {
        balance = outstandingFlat(loan.principal, loan.tenureMonths, monthsAhead);
      } else {
        balance = outstandingReducing(loan.principal, loan.interestRate, loan.emi, monthsAhead);
      }
    }

    out.push({ monthLabel, monthKey, monthIdx: i, balance, isClosed: balance === 0 });
  }
  return out;
}

/* ═══════════════════════════════════════════════════════════════════
   CLOSURE PLAN (Debt Snowball)
   ═══════════════════════════════════════════════════════════════════ */
function computeClosurePlan() {
  const active = loanState.loans.filter(l => l.status === 'active');
  if (!active.length) return [];

  let order = (loanState.closureOrder || []).filter(id => active.find(l => l.id === id));
  const missing = active.filter(l => !order.includes(l.id)).map(l => l.id);
  order = [...order, ...missing];
  if (!order.length) {
    order = active.slice().sort((a, b) => loanCurrentBalance(a) - loanCurrentBalance(b)).map(l => l.id);
  }

  const savings = loanState.monthlySavings || 0;
  // v26.5 — Starting pool = current savings - emergency reserve (never negative).
  // currentSavings is a one-time lump sum the user has available today.
  // emergencyReserve is held back from the pool as a safety buffer.
  const currentSavings   = loanState.currentSavings   || 0;
  const emergencyReserve = loanState.emergencyReserve || 0;
  const out = [];
  const balances = {};
  active.forEach(l => { balances[l.id] = loanCurrentBalance(l); });
  let freedEmi   = 0;
  let pool       = Math.max(0, currentSavings - emergencyReserve);
  const closed   = new Set();

  for (let month = 0; month < 120; month++) {
    pool += savings + freedEmi;
    // Decrement balances by EMI principal (approximate for non-schedule loans)
    active.forEach(l => {
      if (closed.has(l.id)) return;
      const r = (l.interestRate || 0) / 12 / 100;
      const interest = balances[l.id] * r;
      const principalPaid = (l.rateType === 'flat')
        ? (l.principal / l.tenureMonths)
        : (l.emi - interest);
      balances[l.id] = Math.max(0, balances[l.id] - principalPaid);
    });

    let chainClosed = true;
    while (chainClosed) {
      chainClosed = false;
      for (const id of order) {
        if (closed.has(id)) continue;
        const loan = active.find(l => l.id === id);
        const cost = foreclosureCost(loan, balances[id]);
        if (cost.chargePercent === 0 && cost.principal > 0 && pool >= cost.principal) {
          // Zero-foreclosure loans — just need the principal
          pool -= cost.principal;
          freedEmi += loan.emi;
          closed.add(id);
          const d = new Date(); d.setMonth(d.getMonth() + month);
          out.push({ loanId: id, name: loan.name, closureMonth: d.toLocaleString('en-US', { month: 'short', year: 'numeric' }),
                     monthOffset: month, lumpSum: cost.principal, breakdown: cost, leftover: pool });
          chainClosed = true; break;
        } else if (cost.total > 0 && pool >= cost.total) {
          pool -= cost.total;
          freedEmi += loan.emi;
          closed.add(id);
          const d = new Date(); d.setMonth(d.getMonth() + month);
          out.push({ loanId: id, name: loan.name, closureMonth: d.toLocaleString('en-US', { month: 'short', year: 'numeric' }),
                     monthOffset: month, lumpSum: cost.total, breakdown: cost, leftover: pool });
          chainClosed = true; break;
        }
      }
    }
    if (closed.size === active.length) break;
  }
  return out;
}

/* ═══════════════════════════════════════════════════════════════════
   SIMULATOR
   ═══════════════════════════════════════════════════════════════════ */
function simulatePrepayment(loanId, amount) {
  const loan = loanState.loans.find(l => l.id === loanId);
  if (!loan || amount <= 0) return null;

  const currentBal = loanCurrentBalance(loan);
  const fullCost   = foreclosureCost(loan, currentBal);
  const isFullClose = amount >= fullCost.total;

  let newBal, newMonths, cost;
  if (isFullClose) {
    newBal   = 0; newMonths = 0; cost = fullCost.total;
  } else {
    newBal   = Math.max(0, currentBal - amount);
    newMonths = loanMonthsRemaining({ ...loan, principal: newBal });
    cost     = amount;
  }

  const oldMonths = loanMonthsRemaining(loan);
  const interestSaved = Math.round(
    (oldMonths * loan.emi) - (cost + newMonths * loan.emi)
  );
  const d = new Date();
  d.setMonth(d.getMonth() + newMonths);
  return {
    loanName: loan.name, currentBalance: currentBal, newBalance: newBal,
    oldMonthsLeft: oldMonths, newMonthsLeft: newMonths,
    monthsSaved: oldMonths - newMonths,
    interestSaved, isFullClose,
    newClosureMonth: newMonths === 0 ? 'Closed now 🎉'
      : d.toLocaleString('en-US', { month: 'short', year: 'numeric' }),
    foreclosureCostBreakdown: isFullClose ? fullCost : null,
    fullForeclosureCost: fullCost,
  };
}

/* ═══════════════════════════════════════════════════════════════════
   PDF PARSING — lazy-load PDF.js, detect bank, extract rows
   ═══════════════════════════════════════════════════════════════════ */
async function loadPDFJS() {
  if (pdfjsLib_) return pdfjsLib_;
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js';
    s.onload = () => {
      pdfjsLib_ = window['pdfjs-dist/build/pdf'] || window.pdfjsLib;
      if (!pdfjsLib_) { reject(new Error('PDF.js did not load')); return; }
      pdfjsLib_.GlobalWorkerOptions.workerSrc =
        'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';
      resolve(pdfjsLib_);
    };
    s.onerror = () => reject(new Error('Failed to load PDF.js CDN'));
    document.head.appendChild(s);
  });
}

async function extractPDFText(file) {
  const lib = await loadPDFJS();
  const buf = await file.arrayBuffer();
  const pdf = await lib.getDocument({ data: buf }).promise;
  let text = '';
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    // Group items by approximate Y-position to reconstruct rows
    const items = content.items.map(it => ({ str: it.str, y: Math.round(it.transform[5]) }));
    const byY = {};
    items.forEach(it => {
      if (!byY[it.y]) byY[it.y] = [];
      byY[it.y].push(it.str);
    });
    Object.keys(byY).sort((a, b) => b - a).forEach(y => {
      text += byY[y].join(' ') + '\n';
    });
  }
  return text;
}

/** Detect which bank format the PDF belongs to. */
function detectBankFormat(text) {
  const t = text.toLowerCase();
  if (t.includes('credit fair') || t.includes('k. m. global') || t.includes('creditfair') ||
      t.includes('foreclosure amount')) return 'creditfair';
  if (t.includes('indusind') || t.includes('flow date') || t.includes('flow amount')) return 'indusind';
  if (t.includes('kotak') || (t.includes('closing balance') && t.includes('installment'))) return 'kotak';
  return 'generic';
}

/** Parse number: strip ₹, commas, spaces → float */
function parseAmt(s) {
  if (!s) return 0;
  return parseFloat(String(s).replace(/[₹,\s]/g, '')) || 0;
}

/** Convert various date strings → YYYY-MM-DD */
function parseDate(s) {
  if (!s) return null;
  s = s.trim();
  // DD-MM-YYYY
  let m = s.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  // DD Month, YYYY  or  DD Month YYYY
  const MONTHS = { jan:'01',feb:'02',mar:'03',apr:'04',may:'05',jun:'06',
                   jul:'07',aug:'08',sep:'09',oct:'10',nov:'11',dec:'12' };
  m = s.match(/^(\d{1,2})\s+(\w+)[,\s]+(\d{4})$/i);
  if (m) {
    const mo = MONTHS[m[2].toLowerCase().slice(0,3)];
    if (mo) return `${m[3]}-${mo}-${m[1].padStart(2,'0')}`;
  }
  return null;
}

/** Normalize PDF.js text quirks before regex matching.
 *  v26.4 — covers more real-world extraction artifacts:
 *    - Unicode superscript ordinals (ˢᵗ ⁿᵈ ʳᵈ ᵗʰ) → drop them
 *    - Non-breaking / thin spaces → regular space
 *    - "₹" sometimes extracted as "Rs." or "Rs " — strip both
 */
function normalizePdfText(text) {
  return text
    .replace(/ˢᵗ|ⁿᵈ|ʳᵈ|ᵗʰ/g, '')
    .replace(/[\u00A0\u2007\u202F\u200B]/g, ' ')
    .replace(/\bRs\.?\s*/gi, '₹');
}

/** Parse Credit Fair schedule.
 *  Columns: No | Date | EMI | Principal | Interest | ForeClosureAmount
 *  The "Foreclosure Amount" IS the closing outstanding principal.
 *
 *  v26.4 — Two-strategy approach for robustness:
 *    Strategy 1: Tight match (row#, ordinal, "Installment", date, 4 amounts)
 *    Strategy 2: Loose fallback — just row# + date + 4 amounts (drops keywords)
 *  Returns the strategy with more rows.
 */
function parseCreditFair(text) {
  const normalized = normalizePdfText(text);
  const AMT = '₹?\\s*([\\d][\\d,.]*)';

  // Strategy 1 — original "Installment" keyword pattern
  const reTight = new RegExp(
    '(\\d+)\\s*(?:st|nd|rd|th)?\\s*Installment\\s+(\\d{1,2}\\s+\\w+,?\\s+\\d{4})\\s+' +
    AMT + '\\s+' + AMT + '\\s+' + AMT + '\\s+' + AMT,
    'gi'
  );
  const tight = collectRows(normalized, reTight);

  // Strategy 2 — keyword-less fallback. Anchored on "1..60" + date + 4 amounts.
  // Constrained to first capture being ≤ 3 digits to avoid false matches.
  const reLoose = new RegExp(
    '(?:^|\\s)(\\d{1,3})\\s*(?:st|nd|rd|th)?\\s+(\\d{1,2}\\s+\\w+,?\\s+\\d{4})\\s+' +
    AMT + '\\s+' + AMT + '\\s+' + AMT + '\\s+' + AMT,
    'gi'
  );
  const loose = collectRows(normalized, reLoose);

  return tight.length >= loose.length ? tight : loose;
}

/** Shared helper: run regex against text, build row objects. */
function collectRows(text, re) {
  const rows = [];
  let m;
  while ((m = re.exec(text)) !== null) {
    const date = parseDate(m[2]);
    if (!date) continue;
    rows.push({
      no: parseInt(m[1]),
      date,
      emi:       parseAmt(m[3]),
      principal: parseAmt(m[4]),
      interest:  parseAmt(m[5]),
      balance:   parseAmt(m[6]),
    });
  }
  return rows;
}

/** Parse IndusInd schedule.
 *  Columns: Date | EMI | Interest | Principal | Charges(0)
 *  No closing balance in PDF — compute from running subtraction of principal.
 */
function parseIndusInd(text) {
  const rows = [];
  // Match date-based rows: DD-MM-YYYY amount amount amount 0
  const re = /(\d{2}-\d{2}-\d{4})\s+([\d,]+\.?\d*)\s+([\d,]+\.?\d*)\s+([\d,]+\.?\d*)\s+\d/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const date = parseDate(m[1]);
    if (!date) continue;
    rows.push({
      date,
      emi:      parseAmt(m[2]),
      interest: parseAmt(m[3]),
      principal:parseAmt(m[4]),
      balance:  0, // computed below
    });
  }
  if (!rows.length) return rows;
  // Number them & compute running balance
  // Detect starting principal from first row: first row's emi = interest + principal
  // Running balance = prev_balance - principal_paid
  // We need the starting principal. Use sum of all principal payments.
  const totalPrincipal = rows.reduce((s, r) => s + r.principal, 0);
  let bal = Math.round(totalPrincipal); // approx starting principal
  rows.forEach((r, i) => {
    bal -= r.principal;
    r.balance = Math.max(0, Math.round(bal));
    r.no = i + 1;
  });
  // Adjust so the last row is 0
  if (rows.length) rows[rows.length - 1].balance = 0;
  return rows;
}

/** Parse Kotak schedule.
 *  Columns: Date | Type | Rate | TotalAmount | Principal | Interest | ClosingBalance
 */
function parseKotak(text) {
  const rows = [];
  // Match installment rows: {date} Installment {rate} {total} {principal} {interest} {balance}
  const re = /(\d{2}\s+\w{3}\s+\d{4})\s+Installment\s+[\d.]+\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/gi;
  let m, no = 1;
  while ((m = re.exec(text)) !== null) {
    const date = parseDate(m[1]);
    if (!date) continue;
    const balance = parseAmt(m[5]);
    rows.push({
      no: no++,
      date,
      emi:       parseAmt(m[2]),
      principal: parseAmt(m[3]),
      interest:  parseAmt(m[4]),
      balance:   balance <= 3 ? 0 : balance, // treat ₹3 rounding as 0
    });
  }
  return rows;
}

/** Generic fallback: tries to find rows with 4-5 numbers separated by spaces. */
function parseGeneric(text) {
  const rows = [];
  const normalized = normalizePdfText(text);
  // Accept DD-MM-YYYY, DD/MM/YYYY, DD Month YYYY (with optional comma), DD MMM, YYYY
  const re = /(\d{2}[-/]\d{2}[-/]\d{4}|\d{1,2}\s+\w+,?\s+\d{4})\s+₹?\s*([\d][\d,.]*)\s+₹?\s*([\d][\d,.]*)\s+₹?\s*([\d][\d,.]*)\s+₹?\s*([\d][\d,.]*)/g;
  let m, no = 1;
  while ((m = re.exec(normalized)) !== null) {
    const date = parseDate(m[1]);
    if (!date) continue;
    rows.push({ no: no++, date, emi: parseAmt(m[2]), principal: parseAmt(m[3]),
                interest: parseAmt(m[4]), balance: parseAmt(m[5]) });
  }
  return rows;
}

async function parseLoanPDF(file) {
  const text   = await extractPDFText(file);
  const format = detectBankFormat(text);

  // Run the format-specific parser first.
  let primary;
  if      (format === 'creditfair') primary = parseCreditFair(text);
  else if (format === 'indusind')   primary = parseIndusInd(text);
  else if (format === 'kotak')      primary = parseKotak(text);
  else                              primary = parseGeneric(text);

  // v26.4 — Defensive fallback: if the detected parser yielded 0 rows,
  // try every other parser and pick whichever extracts the most rows.
  // Real-world PDFs are messy — better to recover than fail.
  if (!primary.length) {
    const candidates = [
      parseCreditFair(text),
      parseIndusInd(text),
      parseKotak(text),
      parseGeneric(text),
    ];
    primary = candidates.reduce((best, cur) => cur.length > best.length ? cur : best, []);
  }

  // Expose raw text on debug hook so end-users can share for diagnosis.
  if (!primary.length && typeof window !== 'undefined') {
    window.__lastPdfText = text;
    console.warn('[Loans] PDF parsed but 0 rows detected. Inspect window.__lastPdfText. First 500 chars:\n', text.slice(0, 500));
  }

  return { rows: primary, format };
}

/* ═══════════════════════════════════════════════════════════════════
   FORMATTERS
   ═══════════════════════════════════════════════════════════════════ */
function fmtINR(n) {
  if (n == null || isNaN(n)) return '₹0';
  return '₹' + Math.round(n).toLocaleString('en-IN');
}
function fmtINRShort(n) {
  if (n == null || isNaN(n)) return '₹0';
  const a = Math.abs(n);
  if (a >= 10000000) return '₹' + (n/10000000).toFixed(2) + 'Cr';
  if (a >= 100000)   return '₹' + (n/100000).toFixed(2) + 'L';
  if (a >= 1000)     return '₹' + (n/1000).toFixed(1) + 'K';
  return '₹' + Math.round(n);
}
function loanTypeMeta(typeKey) {
  return LOAN_TYPES.find(t => t.key === typeKey) || LOAN_TYPES[LOAN_TYPES.length - 1];
}

/* ═══════════════════════════════════════════════════════════════════
   RENDERING
   ═══════════════════════════════════════════════════════════════════ */
function renderLoans() {
  if (!loanState) loadLoanState();
  renderLoanHero();
  renderLoanSubtab();
}

function renderLoanHero() {
  const active = loanState.loans.filter(l => l.status === 'active');
  const totalOutstanding = active.reduce((s, l) => s + loanCurrentBalance(l), 0);
  const totalEmi         = active.reduce((s, l) => s + l.emi, 0);
  const totalPrincipal   = active.reduce((s, l) => s + l.principal, 0);
  const paidDown = totalPrincipal - totalOutstanding;
  const paidPct  = totalPrincipal > 0 ? Math.round((paidDown / totalPrincipal) * 100) : 0;

  let debtFreeLabel = '—', monthsLeft = 0;
  if (!active.length) {
    debtFreeLabel = '🎉 No active loans';
  } else {
    const plan = computeClosurePlan();
    if (plan.length === active.length) {
      debtFreeLabel = plan[plan.length - 1].closureMonth;
      monthsLeft    = plan[plan.length - 1].monthOffset + 1;
    } else {
      const maxMo = Math.max(...active.map(loanMonthsRemaining).filter(n => isFinite(n)));
      monthsLeft = maxMo || 0;
      const d = new Date(); d.setMonth(d.getMonth() + monthsLeft);
      debtFreeLabel = d.toLocaleString('en-US', { month: 'short', year: 'numeric' });
    }
  }

  const heroEl = document.getElementById('loan-hero');
  if (!heroEl) return;
  heroEl.innerHTML = !active.length ? `
    <div class="loan-hero-empty">
      <div class="loan-hero-empty-icon">🎯</div>
      <div class="loan-hero-empty-title">No active loans</div>
      <div class="loan-hero-empty-sub">Add a loan to track outstanding balance, plan closures, and simulate prepayments.</div>
    </div>
  ` : `
    <div class="loan-hero-title">Total outstanding</div>
    <div class="loan-hero-amount">${fmtINRShort(totalOutstanding)}</div>
    <div class="loan-hero-meta">${active.length} active · EMI ${fmtINRShort(totalEmi)}/mo</div>
    <div class="loan-hero-progress">
      <div class="loan-hero-progress-bar"><div class="loan-hero-progress-fill" style="width:${paidPct}%"></div></div>
      <div class="loan-hero-progress-meta">${paidPct}% paid · Debt-free by <strong>${debtFreeLabel}</strong>${monthsLeft ? ' (' + monthsLeft + ' mo)' : ''}</div>
    </div>
  `;
}

function renderLoanSubtab() {
  document.querySelectorAll('.loan-subtab-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.subtab === loanActiveSubtab));
  document.querySelectorAll('.loan-subpanel').forEach(p => p.classList.remove('active'));
  const panel = document.getElementById('loan-sub-' + loanActiveSubtab);
  if (panel) panel.classList.add('active');

  if (loanActiveSubtab === 'overview')   renderLoanOverview();
  if (loanActiveSubtab === 'projection') renderLoanProjection();
  if (loanActiveSubtab === 'closure')    renderLoanClosure();
  if (loanActiveSubtab === 'simulator')  renderLoanSimulator();
}

function setLoanSubtab(sub) {
  loanActiveSubtab = sub;
  renderLoanSubtab();
}

/* ── Overview ────────────────────────────────────────────────────── */
function renderLoanOverview() {
  const el = document.getElementById('loan-cards-list');
  if (!el) return;
  const active = loanState.loans.filter(l => l.status === 'active');
  const closed = loanState.loans.filter(l => l.status === 'closed');

  // Show / hide the "Import My Loans" button for fresh installs
  const importBtn = document.getElementById('loan-import-btn');
  if (importBtn) {
    importBtn.style.display = (loanState.loans.length === 0 && window._loanNeedsPrePop) ? '' : 'none';
  }

  if (!loanState.loans.length) {
    el.innerHTML = `
      <div class="loan-empty">
        <p>No loans yet.</p>
        <p>Tap <strong>+ Add Loan</strong> to add manually, or use <strong>📥 Import My Loans</strong> to load your 3 pre-configured bank loans with exact repayment schedules.</p>
      </div>`;
    return;
  }
  let html = '';
  if (active.length) {
    html += '<p class="loan-section-label">Active loans</p>';
    html += '<p class="loan-edit-hint">💡 Tap any card to edit · Upload PDF schedule for exact calculations</p>';
    active.forEach(l => { html += renderLoanCard(l); });
  }
  if (closed.length) {
    html += '<p class="loan-section-label loan-section-label-closed">Closed loans 🎉</p>';
    closed.forEach(l => { html += renderLoanCard(l); });
  }
  el.innerHTML = html;
}

function renderLoanCard(loan) {
  const t         = loanTypeMeta(loan.type);
  const bal       = loanCurrentBalance(loan);
  const monthsLeft= loan.status === 'closed' ? 0 : loanMonthsRemaining(loan);
  const isClosed  = loan.status === 'closed';
  const paidDown  = loan.principal - bal;
  const paidPct   = loan.principal > 0 ? Math.min(100, Math.round((paidDown / loan.principal) * 100)) : 0;
  const hasSch    = loan.hasSchedule;

  // Next EMI from schedule
  let nextEmiHtml = '';
  if (hasSch && !isClosed) {
    const sch = getLoanSchedule(loan.id);
    const today = new Date(); today.setHours(23,59,59,999);
    const next = sch.find(r => new Date(r.date) > today);
    if (next) {
      nextEmiHtml = `<div class="loan-card-next-emi">Next EMI: <strong>${fmtINR(next.emi)}</strong> on ${next.date}</div>`;
    }
  }

  return `
    <div class="loan-card ${isClosed ? 'loan-card-closed' : ''}" onclick="openLoanEditModal('${loan.id}')">
      <div class="loan-card-head">
        <span class="loan-card-icon" style="background:${loan.color}20; color:${loan.color}">${t.icon}</span>
        <div class="loan-card-info">
          <div class="loan-card-name">${loan.name}${hasSch ? ' <span class="loan-sch-badge">📋 Schedule</span>' : ''}</div>
          <div class="loan-card-sub">${t.label} · ${loan.rateType === 'flat' ? loan.interestRate + '% flat' : loan.interestRate + '%'} · ${loan.tenureMonths} mo</div>
        </div>
        ${isClosed ? '<span class="loan-card-badge-closed">CLOSED</span>' : '<span class="loan-card-edit-icon">✏️</span>'}
      </div>
      <div class="loan-card-amount-row">
        <div>
          <div class="loan-card-amount">${fmtINRShort(bal)}</div>
          <div class="loan-card-amount-lbl">${isClosed ? 'cleared' : 'outstanding'}</div>
        </div>
        <div class="loan-card-emi">
          <div class="loan-card-emi-val">${fmtINRShort(loan.emi)}</div>
          <div class="loan-card-emi-lbl">EMI/mo</div>
        </div>
        <div class="loan-card-tenure">
          <div class="loan-card-tenure-val">${isClosed ? '—' : (monthsLeft === Infinity ? '∞' : monthsLeft + ' mo')}</div>
          <div class="loan-card-tenure-lbl">${isClosed ? 'closed' : 'left'}</div>
        </div>
      </div>
      ${!isClosed ? `
        <div class="loan-card-progress">
          <div class="loan-card-progress-bar"><div class="loan-card-progress-fill" style="width:${paidPct}%; background:${loan.color}"></div></div>
          <div class="loan-card-progress-meta">${paidPct}% paid · ${fmtINRShort(paidDown)} of ${fmtINRShort(loan.principal)}</div>
        </div>
        ${nextEmiHtml}
      ` : `<div class="loan-card-closed-meta">Closed ${loan.closedDate || ''} · ${fmtINRShort(loan.closedAmount || 0)}</div>`}
    </div>
  `;
}

/* ── Schedule View (shown inline in edit modal) ──────────────────── */
function renderScheduleTable(loanId, containerId) {
  const el = document.getElementById(containerId);
  if (!el) return;
  const rows = getLoanSchedule(loanId);
  if (!rows.length) { el.innerHTML = '<div class="loan-empty"><p>No schedule uploaded yet.</p></div>'; return; }

  const today = new Date(); today.setHours(23, 59, 59, 999);
  const totalEmi  = rows.reduce((s, r) => s + r.emi, 0);
  const totalInt  = rows.reduce((s, r) => s + r.interest, 0);
  const totalPrin = rows.reduce((s, r) => s + r.principal, 0);
  const paidRows  = rows.filter(r => new Date(r.date) <= today);
  const remRows   = rows.filter(r => new Date(r.date) > today);

  el.innerHTML = `
    <div class="loan-sch-summary">
      <div class="loan-sch-sum-row"><span>Total installments</span><strong>${rows.length}</strong></div>
      <div class="loan-sch-sum-row"><span>Paid</span><strong class="green">${paidRows.length}</strong></div>
      <div class="loan-sch-sum-row"><span>Remaining</span><strong class="amber">${remRows.length}</strong></div>
      <div class="loan-sch-sum-row"><span>Total interest</span><strong>${fmtINR(totalInt)}</strong></div>
      <div class="loan-sch-sum-row"><span>Total repayable</span><strong>${fmtINR(totalEmi)}</strong></div>
    </div>
    <div class="loan-sch-table-wrap">
      <table class="loan-sch-table">
        <thead><tr><th>#</th><th>Date</th><th>EMI</th><th>Principal</th><th>Interest</th><th>Balance</th></tr></thead>
        <tbody>
          ${rows.map(r => {
            const isPaid = new Date(r.date) <= today;
            return `<tr class="${isPaid ? 'sch-row-paid' : 'sch-row-upcoming'}">
              <td>${r.no || ''}</td>
              <td>${r.date}</td>
              <td>${fmtINR(r.emi)}</td>
              <td>${fmtINR(r.principal)}</td>
              <td>${fmtINR(r.interest)}</td>
              <td><strong>${r.balance === 0 ? '✓ 0' : fmtINR(r.balance)}</strong></td>
            </tr>`;
          }).join('')}
        </tbody>
        <tfoot><tr class="sch-total-row">
          <td colspan="2"><strong>TOTAL</strong></td>
          <td><strong>${fmtINR(totalEmi)}</strong></td>
          <td><strong>${fmtINR(totalPrin)}</strong></td>
          <td><strong>${fmtINR(totalInt)}</strong></td>
          <td><strong>₹0</strong></td>
        </tr></tfoot>
      </table>
    </div>
  `;
}

/* ── Projection ──────────────────────────────────────────────────── */
function renderLoanProjection() {
  const el = document.getElementById('loan-projection-table');
  if (!el) return;
  const active = loanState.loans.filter(l => l.status === 'active');
  if (!active.length) {
    el.innerHTML = '<div class="loan-empty"><p>No active loans to project.</p></div>'; return;
  }
  const N = 12;
  const projections = active.map(l => ({ loan: l, rows: projectLoan(l, N) }));

  let html = '<div class="loan-projection-wrap"><table class="loan-projection-tbl"><thead><tr><th class="sticky-col">Bank</th>';
  projections[0].rows.forEach(r => { html += `<th>${r.monthLabel}</th>`; });
  html += '</tr></thead><tbody>';

  projections.forEach(({ loan, rows }) => {
    html += `<tr><td class="sticky-col"><span style="color:${loan.color}">●</span> ${loan.name}${loan.hasSchedule ? ' 📋' : ''}</td>`;
    rows.forEach(r => {
      html += `<td class="${r.isClosed ? 'proj-cell proj-closed' : 'proj-cell'}" onclick="showProjectionDetail(event,'${loan.id}','${r.monthKey}')">${r.balance === 0 ? '✓' : fmtINRShort(r.balance)}</td>`;
    });
    html += '</tr>';
  });

  html += '<tr class="proj-total-row"><td class="sticky-col"><strong>TOTAL</strong></td>';
  for (let i = 0; i < N; i++) {
    const total = projections.reduce((s, p) => s + p.rows[i].balance, 0);
    html += `<td><strong>${fmtINRShort(total)}</strong></td>`;
  }
  html += '</tr></tbody></table></div>';
  html += '<p class="loan-section-hint">💡 Tap a cell to see month detail. 📋 = schedule-based (exact).</p>';
  el.innerHTML = html;
}

function showProjectionDetail(evt, loanId, monthKey) {
  const loan = loanState.loans.find(l => l.id === loanId);
  if (!loan) return;
  const schedule = getLoanSchedule(loanId);
  let detail = '';

  if (schedule.length) {
    const row = schedule.find(r => r.date.slice(0,7) === monthKey);
    if (row) {
      detail = `<strong>${loan.name}</strong> · ${monthKey}<br>
        Outstanding: ${fmtINR(row.balance)}<br>
        EMI: ${fmtINR(row.emi)} (₹${Math.round(row.principal).toLocaleString('en-IN')} principal + ₹${Math.round(row.interest).toLocaleString('en-IN')} interest)`;
    }
  }
  if (!detail) {
    const [y, m] = monthKey.split('-').map(Number);
    const targetDate = new Date(y, m - 1, 1);
    const monthsAhead = Math.round((targetDate - new Date()) / (30 * 24 * 3600 * 1000));
    const bal = projectLoan(loan, Math.max(monthsAhead + 2, 1)).find(r => r.monthKey === monthKey);
    detail = `<strong>${loan.name}</strong> · ${monthKey}<br>Outstanding: ${bal ? fmtINR(bal.balance) : '—'}<br><em>(Formula estimate)</em>`;
  }

  window.toast?.(detail, false);
}

/* ── Closure ─────────────────────────────────────────────────────── */
function renderLoanClosure() {
  const el = document.getElementById('loan-closure-content');
  if (!el) return;
  const active = loanState.loans.filter(l => l.status === 'active');
  if (!active.length) {
    el.innerHTML = '<div class="loan-empty"><p>No active loans for closure planning.</p></div>'; return;
  }
  const plan = computeClosurePlan();
  const startingPool = Math.max(0,
    (loanState.currentSavings || 0) - (loanState.emergencyReserve || 0));

  let html = `
    <div class="loan-closure-input-card loan-closure-savings-card">
      <div class="loan-closure-savings-grid">
        <div class="loan-closure-savings-field">
          <label class="loan-closure-input-lbl">Current savings
            <span class="loan-closure-input-hint">lump sum you have today</span>
          </label>
          <div class="loan-closure-input-wrap">
            <span class="loan-closure-input-prefix">₹</span>
            <input type="number" id="loan-current-savings" class="loan-closure-input"
                   value="${loanState.currentSavings || ''}" placeholder="200000"
                   onchange="updateCurrentSavings(this.value)" />
          </div>
        </div>
        <div class="loan-closure-savings-field">
          <label class="loan-closure-input-lbl">Monthly savings
            <span class="loan-closure-input-hint">saved each month after EMIs</span>
          </label>
          <div class="loan-closure-input-wrap">
            <span class="loan-closure-input-prefix">₹</span>
            <input type="number" id="loan-monthly-savings" class="loan-closure-input"
                   value="${loanState.monthlySavings || ''}" placeholder="50000"
                   onchange="updateMonthlySavings(this.value)" />
          </div>
        </div>
        <div class="loan-closure-savings-field">
          <label class="loan-closure-input-lbl">Emergency reserve
            <span class="loan-closure-input-hint">held back from closure pool</span>
          </label>
          <div class="loan-closure-input-wrap">
            <span class="loan-closure-input-prefix">₹</span>
            <input type="number" id="loan-emergency-reserve" class="loan-closure-input"
                   value="${loanState.emergencyReserve || ''}" placeholder="50000"
                   onchange="updateEmergencyReserve(this.value)" />
          </div>
        </div>
      </div>
      ${(loanState.currentSavings || loanState.emergencyReserve) ? `
      <div class="loan-closure-pool-note">
        <span>💰 Starting pool:</span>
        <strong>${fmtINR(startingPool)}</strong>
        ${loanState.emergencyReserve ? `
          <span class="loan-closure-pool-sub">(₹${(loanState.currentSavings||0).toLocaleString('en-IN')} − ₹${(loanState.emergencyReserve||0).toLocaleString('en-IN')} reserve)</span>
        ` : ''}
      </div>` : ''}
    </div>
  `;

  if (!loanState.monthlySavings && !loanState.currentSavings) {
    html += `<div class="loan-closure-empty"><p>👆 Enter current and/or monthly savings to see the closure plan.</p>
      <p class="muted">We cascade your starting pool + monthly savings + freed EMIs to project when each loan closes.</p></div>`;
  } else if (!plan.length) {
    const totalIn = (loanState.currentSavings || 0) + (loanState.monthlySavings || 0) * 12;
    html += `<div class="loan-closure-empty"><p>⚠️ Your savings (${fmtINRShort(totalIn)} in year 1) aren't enough to close any loan within 10 years.</p>
      <p class="muted">Increase savings, lower the emergency reserve, or wait — loans close naturally via EMIs.</p></div>`;
  } else {
    html += '<p class="loan-section-label">Closure timeline</p><div class="loan-closure-timeline">';
    plan.forEach((step, i) => {
      const loan = loanState.loans.find(l => l.id === step.loanId);
      const t    = loanTypeMeta(loan.type);
      const b    = step.breakdown;
      const isZeroCharge = b.chargePercent === 0;
      // v26.5 — Step in month 0 can be paid immediately from current savings
      const isPayNow = step.monthOffset === 0;
      html += `
        <div class="loan-closure-step ${isPayNow ? 'loan-closure-step-paynow' : ''}">
          <div class="loan-closure-step-num">${i + 1}</div>
          <div class="loan-closure-step-body">
            <div class="loan-closure-step-head">
              <span class="loan-closure-step-icon" style="background:${loan.color}20; color:${loan.color}">${t.icon}</span>
              <span class="loan-closure-step-name">${loan.name}${loan.hasSchedule ? ' 📋' : ''}</span>
              ${isPayNow ? '<span class="loan-closure-paynow-badge">⚡ Pay now</span>' : ''}
              <span class="loan-closure-step-when">${step.closureMonth}</span>
            </div>
            <div class="loan-closure-breakdown">
              <div class="loan-closure-bd-row"><span>Outstanding principal</span><span class="loan-closure-bd-val">${fmtINR(b.principal)}</span></div>
              ${isZeroCharge
                ? `<div class="loan-closure-bd-row loan-zero-charge"><span>✅ Zero preclosure charges</span><span class="loan-closure-bd-val">₹0</span></div>`
                : `<div class="loan-closure-bd-row"><span>Preclosure fee (${b.chargePercent}%)</span><span class="loan-closure-bd-val">+${fmtINR(b.charge)}</span></div>
                   <div class="loan-closure-bd-row"><span>GST on fee (${FORECLOSURE_GST_PERCENT}%)</span><span class="loan-closure-bd-val">+${fmtINR(b.gst)}</span></div>`
              }
              <div class="loan-closure-bd-row loan-closure-bd-total">
                <span><strong>Total to pay bank</strong></span>
                <span class="loan-closure-bd-val"><strong>${fmtINR(b.total)}</strong></span>
              </div>
            </div>
            <div class="loan-closure-step-meta">
              💰 Leftover: <strong>${fmtINR(step.leftover)}</strong> · Frees <strong>${fmtINR(loan.emi)}/mo</strong>
            </div>
            <div class="loan-closure-step-actions">
              ${i > 0 ? `<button class="loan-closure-mv-btn" onclick="moveLoanInOrder('${step.loanId}',-1)">↑ Earlier</button>` : ''}
              ${i < plan.length - 1 ? `<button class="loan-closure-mv-btn" onclick="moveLoanInOrder('${step.loanId}',1)">↓ Later</button>` : ''}
              <button class="loan-closure-close-btn" onclick="markLoanClosed('${step.loanId}',${step.lumpSum})">✓ Mark closed</button>
            </div>
          </div>
        </div>
      `;
    });
    html += '</div>';
    const last = plan[plan.length - 1];
    html += `<div class="loan-closure-summary">
      <div class="loan-closure-summary-icon">🎉</div>
      <div class="loan-closure-summary-body">
        <div class="loan-closure-summary-title">Debt-free by ${last.closureMonth}</div>
        <div class="loan-closure-summary-sub">${last.monthOffset + 1} months · ${fmtINRShort(last.leftover)} left in savings</div>
      </div>
    </div>`;
  }
  el.innerHTML = html;
}

function updateMonthlySavings(v) {
  loanState.monthlySavings = Math.max(0, parseInt(v, 10) || 0);
  saveLoanState();
  renderLoans();
}
// v26.5 — Current savings (lump sum) and emergency reserve setters.
// Both feed into computeClosurePlan() via starting pool computation.
function updateCurrentSavings(v) {
  loanState.currentSavings = Math.max(0, parseInt(v, 10) || 0);
  saveLoanState();
  renderLoans();
}
function updateEmergencyReserve(v) {
  loanState.emergencyReserve = Math.max(0, parseInt(v, 10) || 0);
  saveLoanState();
  renderLoans();
}
function moveLoanInOrder(loanId, delta) {
  const plan  = computeClosurePlan();
  let order   = plan.map(p => p.loanId);
  if (!order.length) order = loanState.loans.filter(l => l.status === 'active').map(l => l.id);
  const idx   = order.indexOf(loanId);
  if (idx < 0) return;
  const ni    = idx + delta;
  if (ni < 0 || ni >= order.length) return;
  [order[idx], order[ni]] = [order[ni], order[idx]];
  loanState.closureOrder = order;
  saveLoanState();
  renderLoans();
}

/* ── Simulator ───────────────────────────────────────────────────── */
function renderLoanSimulator() {
  const el = document.getElementById('loan-simulator-content');
  if (!el) return;
  const active = loanState.loans.filter(l => l.status === 'active');
  if (!active.length) {
    el.innerHTML = '<div class="loan-empty"><p>Add active loans to run simulations.</p></div>'; return;
  }
  el.innerHTML = `
    <div class="loan-sim-card">
      <p class="loan-sim-title">What if I prepay extra this month?</p>
      <p class="loan-sim-sub">See months & interest saved vs no prepayment.</p>
      <label class="loan-sim-lbl">Extra amount</label>
      <div class="loan-closure-input-wrap">
        <span class="loan-closure-input-prefix">₹</span>
        <input type="number" id="loan-sim-amount" class="loan-closure-input" placeholder="50000" oninput="runLoanSim()" />
      </div>
      <label class="loan-sim-lbl">Apply to</label>
      <select id="loan-sim-target" class="loan-sim-select" onchange="runLoanSim()">
        ${active.map(l => `<option value="${l.id}">${l.name} (${fmtINRShort(loanCurrentBalance(l))})</option>`).join('')}
      </select>
      <div class="loan-sim-quick-row">
        <span class="loan-sim-quick-lbl">Quick:</span>
        ${[10000,25000,50000,100000].map(a =>
          `<button class="loan-sim-quick-btn" onclick="document.getElementById('loan-sim-amount').value=${a};runLoanSim();">${fmtINRShort(a)}</button>`
        ).join('')}
      </div>
      <div id="loan-sim-result" class="loan-sim-result"></div>
      <p class="loan-section-label" style="margin-top:24px;">Compare across all loans</p>
      <div id="loan-sim-compare" class="loan-sim-compare"></div>
    </div>
  `;
}

function runLoanSim() {
  const amt    = parseInt(document.getElementById('loan-sim-amount')?.value, 10) || 0;
  const loanId = document.getElementById('loan-sim-target')?.value;
  const res    = simulatePrepayment(loanId, amt);
  const resEl  = document.getElementById('loan-sim-result');

  if (!res || amt <= 0) { if (resEl) resEl.innerHTML = ''; }
  else {
    resEl.innerHTML = `
      <div class="loan-sim-result-card">
        <div class="loan-sim-result-row"><span>New balance</span><strong>${fmtINR(res.newBalance)}</strong></div>
        <div class="loan-sim-result-row"><span>Months remaining</span><strong>${res.newMonthsLeft} mo</strong></div>
        <div class="loan-sim-result-row loan-sim-saved"><span>Months saved</span><strong>${res.monthsSaved}</strong></div>
        <div class="loan-sim-result-row loan-sim-saved"><span>Interest saved</span><strong>${fmtINR(res.interestSaved)}</strong></div>
        <div class="loan-sim-result-row"><span>New closure</span><strong>${res.newClosureMonth}</strong></div>
        ${res.isFullClose && res.foreclosureCostBreakdown ? `
          <div class="loan-sim-foreclosure-note">
            <strong>Full closure breakdown:</strong>
            Principal ${fmtINR(res.foreclosureCostBreakdown.principal)} +
            Fee ${fmtINR(res.foreclosureCostBreakdown.charge)} +
            GST ${fmtINR(res.foreclosureCostBreakdown.gst)} =
            <strong>${fmtINR(res.foreclosureCostBreakdown.total)}</strong>
          </div>
        ` : ''}
      </div>
    `;
  }

  const cmpEl = document.getElementById('loan-sim-compare');
  if (cmpEl && amt > 0) {
    const active = loanState.loans.filter(l => l.status === 'active');
    const sims   = active.map(l => ({ loan: l, sim: simulatePrepayment(l.id, amt) }))
                         .sort((a, b) => (b.sim?.interestSaved || 0) - (a.sim?.interestSaved || 0));
    cmpEl.innerHTML = sims.map(({ loan, sim }, i) => !sim ? '' : `
      <div class="loan-sim-compare-row ${i === 0 ? 'loan-sim-best' : ''}">
        ${i === 0 ? '<span class="loan-sim-best-badge">🏆 BEST</span>' : ''}
        <div class="loan-sim-compare-name"><span style="color:${loan.color}">●</span> ${loan.name}</div>
        <div class="loan-sim-compare-stats">
          <span>${sim.monthsSaved} mo saved</span>
          <span>${fmtINR(sim.interestSaved)} interest saved</span>
        </div>
      </div>
    `).join('');
  } else if (cmpEl) cmpEl.innerHTML = '';
}

/* ═══════════════════════════════════════════════════════════════════
   ADD / EDIT MODAL
   ═══════════════════════════════════════════════════════════════════ */
function openLoanAddModal() {
  loanEditingId = null;
  loanSchedulePreview = null;
  const today = new Date().toISOString().slice(0, 10);

  document.getElementById('loan-modal-title').textContent = 'Add Loan';
  document.getElementById('loan-form-name').value        = '';
  document.getElementById('loan-form-type').value        = 'personal';
  document.getElementById('loan-form-rate-type').value   = 'reducing';
  document.getElementById('loan-form-principal').value   = '';
  document.getElementById('loan-form-rate').value        = '';
  document.getElementById('loan-form-tenure').value      = '';
  document.getElementById('loan-form-startdate').value   = today;
  document.getElementById('loan-form-emi-due-day').value = '';
  document.getElementById('loan-form-emi').value         = '';
  document.getElementById('loan-form-emi-hint').textContent = '';
  const fcEl = document.getElementById('loan-form-foreclosure');
  if (fcEl) fcEl.value = DEFAULT_FORECLOSURE_PERCENT;
  document.getElementById('loan-form-delete').style.display = 'none';
  renderLoanColorPicker(LOAN_COLORS[Math.floor(Math.random() * LOAN_COLORS.length)]);
  clearScheduleUploadUI();
  document.getElementById('loan-form-modal').style.display = 'flex';
}

function openLoanEditModal(loanId) {
  const loan = loanState.loans.find(l => l.id === loanId);
  if (!loan) return;
  loanEditingId = loanId;
  loanSchedulePreview = null;

  document.getElementById('loan-modal-title').textContent = 'Edit Loan';
  document.getElementById('loan-form-name').value        = loan.name;
  document.getElementById('loan-form-type').value        = loan.type;
  document.getElementById('loan-form-rate-type').value   = loan.rateType || 'reducing';
  document.getElementById('loan-form-principal').value   = loan.principal;
  document.getElementById('loan-form-rate').value        = loan.interestRate;
  document.getElementById('loan-form-tenure').value      = loan.tenureMonths;
  document.getElementById('loan-form-startdate').value   = loan.startDate;
  document.getElementById('loan-form-emi-due-day').value = loan.emiDueDay || '';
  document.getElementById('loan-form-emi').value         = loan.emi;
  document.getElementById('loan-form-emi-hint').textContent = '';
  const fcEl = document.getElementById('loan-form-foreclosure');
  if (fcEl) fcEl.value = loan.foreclosureChargePercent ?? DEFAULT_FORECLOSURE_PERCENT;
  document.getElementById('loan-form-delete').style.display = 'inline-block';
  renderLoanColorPicker(loan.color);

  // Show existing schedule if any
  if (loan.hasSchedule) {
    const schWrap = document.getElementById('loan-form-sch-preview-wrap');
    if (schWrap) {
      schWrap.style.display = 'block';
      renderScheduleTable(loanId, 'loan-form-sch-table');
    }
    const badge = document.getElementById('loan-form-sch-badge');
    if (badge) badge.textContent = `📋 Schedule loaded (${getLoanSchedule(loanId).length} rows)`;
  } else {
    clearScheduleUploadUI();
  }

  document.getElementById('loan-form-modal').style.display = 'flex';
}

function closeLoanFormModal() {
  document.getElementById('loan-form-modal').style.display = 'none';
  loanSchedulePreview = null;
}

function clearScheduleUploadUI() {
  const badge = document.getElementById('loan-form-sch-badge');
  const wrap  = document.getElementById('loan-form-sch-preview-wrap');
  const inp   = document.getElementById('loan-form-sch-file');
  if (badge) badge.textContent = 'No schedule uploaded';
  if (wrap)  wrap.style.display = 'none';
  if (inp)   inp.value = '';
  loanSchedulePreview = null;
}

function renderLoanColorPicker(selectedColor) {
  const wrap = document.getElementById('loan-form-colors');
  if (!wrap) return;
  wrap.dataset.color = selectedColor;
  wrap.innerHTML = LOAN_COLORS.map(c => `
    <span class="loan-color-swatch ${c === selectedColor ? 'selected' : ''}"
          style="background:${c}" onclick="pickLoanColor('${c}')"></span>
  `).join('');
}

function pickLoanColor(c) {
  document.getElementById('loan-form-colors').dataset.color = c;
  renderLoanColorPicker(c);
}

function recalcEmiHint() {
  const p = parseInt(document.getElementById('loan-form-principal').value, 10) || 0;
  const r = parseFloat(document.getElementById('loan-form-rate').value) || 0;
  const t = parseInt(document.getElementById('loan-form-tenure').value, 10) || 0;
  const rt= document.getElementById('loan-form-rate-type')?.value || 'reducing';
  const hintEl = document.getElementById('loan-form-emi-hint');
  if (p && t) {
    let emi;
    if (rt === 'flat') {
      const monthlyInt  = p * r / 12 / 100;
      const monthlyPrin = p / t;
      emi = Math.round(monthlyInt + monthlyPrin);
    } else {
      emi = calcEmi(p, r, t);
    }
    hintEl.textContent = `Calculated EMI: ${fmtINR(emi)}/mo (tap to use)`;
    hintEl.onclick = () => { document.getElementById('loan-form-emi').value = emi; hintEl.textContent = ''; };
    hintEl.style.cursor = 'pointer';
  } else {
    hintEl.textContent = '';
  }
}

/* ── PDF Schedule Upload ─────────────────────────────────────────── */
async function handleScheduleUpload(input) {
  const file = input.files?.[0];
  if (!file) return;
  const badge = document.getElementById('loan-form-sch-badge');
  if (badge) badge.textContent = '⏳ Parsing PDF…';

  try {
    const { rows, format } = await parseLoanPDF(file);
    if (!rows.length) throw new Error('No schedule rows found in this PDF.');

    loanSchedulePreview = rows;
    if (badge) badge.textContent = `✅ ${rows.length} rows detected (${format} format)`;

    // Show preview table
    const wrap = document.getElementById('loan-form-sch-preview-wrap');
    if (wrap) {
      wrap.style.display = 'block';
      const tbody = document.getElementById('loan-form-sch-table');
      if (tbody) {
        tbody.innerHTML = `
          <div class="loan-sch-summary">
            <div class="loan-sch-sum-row"><span>Format detected</span><strong>${format}</strong></div>
            <div class="loan-sch-sum-row"><span>Installments</span><strong>${rows.length}</strong></div>
            <div class="loan-sch-sum-row"><span>First EMI</span><strong>${rows[0]?.date}</strong></div>
            <div class="loan-sch-sum-row"><span>Last EMI</span><strong>${rows[rows.length-1]?.date}</strong></div>
            <div class="loan-sch-sum-row"><span>Total interest</span><strong>${fmtINR(rows.reduce((s,r)=>s+r.interest,0))}</strong></div>
          </div>
          <div class="loan-sch-table-wrap">
            <table class="loan-sch-table">
              <thead><tr><th>#</th><th>Date</th><th>EMI</th><th>Principal</th><th>Interest</th><th>Balance</th></tr></thead>
              <tbody>
                ${rows.slice(0, 5).map(r => `
                  <tr><td>${r.no||''}</td><td>${r.date}</td><td>${fmtINR(r.emi)}</td>
                  <td>${fmtINR(r.principal)}</td><td>${fmtINR(r.interest)}</td><td>${fmtINR(r.balance)}</td></tr>
                `).join('')}
                ${rows.length > 5 ? `<tr><td colspan="6" class="muted" style="text-align:center">… ${rows.length - 5} more rows (save to see all)</td></tr>` : ''}
              </tbody>
            </table>
          </div>
          <p class="loan-form-emi-hint" style="color:var(--green)">✅ Schedule will be saved when you click Save. All calculations will use exact bank data.</p>
        `;
      }
    }
  } catch (err) {
    if (badge) badge.textContent = `❌ ${err.message}`;
    loanSchedulePreview = null;
    console.error('PDF parse error:', err);
  }
}

function saveLoanForm() {
  const name    = document.getElementById('loan-form-name').value.trim();
  const type    = document.getElementById('loan-form-type').value;
  const rateType= document.getElementById('loan-form-rate-type')?.value || 'reducing';
  const principal = parseInt(document.getElementById('loan-form-principal').value, 10) || 0;
  const rate    = parseFloat(document.getElementById('loan-form-rate').value) || 0;
  const tenure  = parseInt(document.getElementById('loan-form-tenure').value, 10) || 0;
  const startDate = document.getElementById('loan-form-startdate').value;
  const emiDueDay = parseInt(document.getElementById('loan-form-emi-due-day').value, 10) || null;
  let   emi     = parseInt(document.getElementById('loan-form-emi').value, 10) || 0;
  const color   = document.getElementById('loan-form-colors').dataset.color;
  const fcRaw   = document.getElementById('loan-form-foreclosure')?.value;
  let   fcPct   = parseFloat(fcRaw);
  if (isNaN(fcPct) || fcPct < 0) fcPct = DEFAULT_FORECLOSURE_PERCENT;

  if (!name)      { window.toast?.('Enter a loan name', 'error'); return; }
  if (!principal) { window.toast?.('Enter principal amount', 'error'); return; }
  if (!tenure)    { window.toast?.('Enter tenure (months)', 'error'); return; }
  if (!startDate) { window.toast?.('Pick a start date', 'error'); return; }
  if (!emi) {
    if (rateType === 'flat') {
      emi = Math.round((principal / tenure) + (principal * rate / 12 / 100));
    } else {
      emi = calcEmi(principal, rate, tenure);
    }
  }

  const hasSchedule = !!(loanSchedulePreview?.length ||
    (loanEditingId && loanState.loans.find(l => l.id === loanEditingId)?.hasSchedule));
  const now = Date.now();

  if (loanEditingId) {
    const loan = loanState.loans.find(l => l.id === loanEditingId);
    if (loan) {
      Object.assign(loan, { name, type, rateType, principal, interestRate: rate,
        tenureMonths: tenure, startDate, emiDueDay, emi, color,
        foreclosureChargePercent: fcPct, hasSchedule, updatedAt: now });
    }
  } else {
    loanState.loans.push({
      id: 'loan-' + now + '-' + Math.floor(Math.random() * 1000),
      name, type, rateType, principal, interestRate: rate,
      tenureMonths: tenure, startDate, emiDueDay, emi, color,
      foreclosureChargePercent: fcPct, hasSchedule,
      status: 'active', closedDate: null, closedAmount: null,
      createdAt: now, updatedAt: now,
    });
  }

  saveLoanState();

  // Save schedule if a new one was uploaded
  if (loanSchedulePreview?.length) {
    const loanId = loanEditingId || loanState.loans[loanState.loans.length - 1].id;
    saveLoanSchedule(loanId, loanSchedulePreview);
    loanSchedulePreview = null;
  }

  closeLoanFormModal();
  renderLoans();
  window.toast?.(loanEditingId ? '✓ Loan updated & synced' : '✓ Loan added & synced');
}

function deleteLoanForm() {
  if (!loanEditingId) return;
  if (!confirm('Delete this loan? This cannot be undone.')) return;
  loanState.loans = loanState.loans.filter(l => l.id !== loanEditingId);
  loanState.closureOrder = (loanState.closureOrder || []).filter(id => id !== loanEditingId);
  delete loanSchedules[loanEditingId];
  try { localStorage.setItem(LOAN_SCH_STORAGE_KEY, JSON.stringify(loanSchedules)); } catch(e){}
  saveLoanState();
  closeLoanFormModal();
  renderLoans();
  window.toast?.('✓ Loan deleted');
}

function markLoanClosed(loanId, lumpSum) {
  const loan = loanState.loans.find(l => l.id === loanId);
  if (!loan) return;
  if (!confirm(`Mark "${loan.name}" as closed?\nAmount paid: ${fmtINR(lumpSum)}`)) return;
  loan.status      = 'closed';
  loan.closedDate  = new Date().toISOString().slice(0, 10);
  loan.closedAmount = lumpSum;
  loan.updatedAt   = Date.now();
  saveLoanState();
  renderLoans();
  window.toast?.('🎉 Loan closed!');
}

/* ═══════════════════════════════════════════════════════════════════
   PRE-POPULATED LOANS (all 3 real loans from PDFs)
   ═══════════════════════════════════════════════════════════════════ */

/* Compact schedule format: [date, emi, principal, interest, balance] */
const PREPOP_LOANS = [
  {
    meta: {
      name: 'Credit Fair (Scaler)', type: 'education', rateType: 'flat',
      principal: 284000, interestRate: 10.8, tenureMonths: 60,
      startDate: '2023-05-18', emiDueDay: 5, emi: 7289,
      foreclosureChargePercent: 0,   // Zero prepayment charges (per PDF)
      color: '#7C5CFC',
    },
    schedule: [
      ['2023-06-05',7289,2911,4378,281089],['2023-07-05',7289,2956,4333,278134],
      ['2023-08-05',7289,3001,4288,275133],['2023-09-05',7289,3047,4242,272085],
      ['2023-10-05',7289,3094,4195,268991],['2023-11-05',7289,3142,4147,265849],
      ['2023-12-05',7289,3190,4099,262658],['2024-01-05',7289,3240,4049,259419],
      ['2024-02-05',7289,3290,3999,256129],['2024-03-05',7289,3340,3949,252789],
      ['2024-04-05',7289,3392,3897,249397],['2024-05-05',7289,3444,3845,245953],
      ['2024-06-05',7289,3497,3792,242456],['2024-07-05',7289,3551,3738,238904],
      ['2024-08-05',7289,3606,3683,235299],['2024-09-05',7289,3661,3628,231637],
      ['2024-10-05',7289,3718,3571,227919],['2024-11-05',7289,3775,3514,224144],
      ['2024-12-05',7289,3833,3456,220310],['2025-01-05',7289,3893,3396,216418],
      ['2025-02-05',7289,3953,3336,212465],['2025-03-05',7289,4013,3276,208452],
      ['2025-04-05',7289,4075,3214,204377],['2025-05-05',7289,4138,3151,200238],
      ['2025-06-05',7289,4202,3087,196036],['2025-07-05',7289,4267,3022,191770],
      ['2025-08-05',7289,4333,2956,187437],['2025-09-05',7289,4399,2890,183038],
      ['2025-10-05',7289,4467,2822,178570],['2025-11-05',7289,4536,2753,174034],
      ['2025-12-05',7289,4606,2683,169428],['2026-01-05',7289,4677,2612,164752],
      ['2026-02-05',7289,4749,2540,160002],['2026-03-05',7289,4822,2467,155180],
      ['2026-04-05',7289,4897,2392,150284],['2026-05-05',7289,4972,2317,145311],
      ['2026-06-05',7289,5049,2240,140263],['2026-07-05',7289,5127,2162,135136],
      ['2026-08-05',7289,5206,2083,129930],['2026-09-05',7289,5286,2003,124644],
      ['2026-10-05',7289,5367,1922,119277],['2026-11-05',7289,5450,1839,113827],
      ['2026-12-05',7289,5534,1755,108293],['2027-01-05',7289,5619,1670,102673],
      ['2027-02-05',7289,5706,1583,96967], ['2027-03-05',7289,5794,1495,91173],
      ['2027-04-05',7289,5883,1406,85290], ['2027-05-05',7289,5974,1315,79315],
      ['2027-06-05',7289,6066,1223,73249], ['2027-07-05',7289,6160,1129,67090],
      ['2027-08-05',7289,6255,1034,60835], ['2027-09-05',7289,6351,938,54484],
      ['2027-10-05',7289,6449,840,48035],  ['2027-11-05',7289,6548,741,41486],
      ['2027-12-05',7289,6649,640,34837],  ['2028-01-05',7289,6752,537,28085],
      ['2028-02-05',7289,6856,433,21229],  ['2028-03-05',7289,6962,327,14267],
      ['2028-04-05',7289,7069,220,7198],   ['2028-05-05',7309,7198,111,0],
    ],
  },
  {
    meta: {
      name: 'IndusInd Bank', type: 'personal', rateType: 'reducing',
      principal: 580000, interestRate: 14.4, tenureMonths: 60,
      startDate: '2022-11-10', emiDueDay: 4, emi: 12756,
      foreclosureChargePercent: 3,
      color: '#FF6B6B',
    },
    schedule: [
      ['2022-12-04',12756,8370,4386,571630],['2023-01-04',12756,7173,5583,564457],
      ['2023-02-04',12756,7243,5513,557214],['2023-03-04',12756,7840,4916,549374],
      ['2023-04-04',12756,7390,5366,541984],['2023-05-04',12756,7633,5123,534351],
      ['2023-06-04',12756,7537,5219,526814],['2023-07-04',12756,7777,4979,519037],
      ['2023-08-04',12756,7686,5070,511351],['2023-09-04',12756,7762,4994,503589],
      ['2023-10-04',12756,7996,4760,495593],['2023-11-04',12756,7915,4841,487678],
      ['2023-12-04',12756,8146,4610,479532],['2024-01-04',12756,8074,4682,471458],
      ['2024-02-04',12756,8164,4592,463294],['2024-03-04',12756,8534,4222,454760],
      ['2024-04-04',12756,8326,4430,446434],['2024-05-04',12756,8548,4208,437886],
      ['2024-06-04',12756,8491,4265,429395],['2024-07-04',12756,8708,4048,420687],
      ['2024-08-04',12756,8658,4098,412029],['2024-09-04',12756,8743,4013,403286],
      ['2024-10-04',12756,8955,3801,394331],['2024-11-04',12756,8915,3841,385416],
      ['2024-12-04',12756,9123,3633,376293],['2025-01-04',12756,9089,3667,367204],
      ['2025-02-04',12756,9170,3586,358034],['2025-03-04',12756,9597,3159,348437],
      ['2025-04-04',12756,9353,3403,339084],['2025-05-04',12756,9551,3205,329533],
      ['2025-06-04',12756,9537,3219,319996],['2025-07-04',12756,9732,3024,310264],
      ['2025-08-04',12756,9725,3031,300539],['2025-09-04',12756,9821,2935,290718],
      ['2025-10-04',12756,10008,2748,280710],['2025-11-04',12756,10014,2742,270696],
      ['2025-12-04',12756,10198,2558,260498],['2026-01-04',12756,10211,2545,250287],
      ['2026-02-04',12756,10312,2444,239975],['2026-03-04',12756,10639,2117,229336],
      ['2026-04-04',12756,10516,2240,218820],['2026-05-04',12756,10688,2068,208132],
      ['2026-06-04',12756,10723,2033,197409],['2026-07-04',12756,10890,1866,186519],
      ['2026-08-04',12756,10934,1822,175585],['2026-09-04',12756,11041,1715,164544],
      ['2026-10-04',12756,11201,1555,153343],['2026-11-04',12756,11258,1498,142085],
      ['2026-12-04',12756,11413,1343,130672],['2027-01-04',12756,11480,1276,119192],
      ['2027-02-04',12756,11592,1164,107600],['2027-03-04',12756,11806,950,95794],
      ['2027-04-04',12756,11821,935,83973], ['2027-05-04',12756,11962,794,72011],
      ['2027-06-04',12756,12053,703,59958], ['2027-07-04',12756,12189,567,47769],
      ['2027-08-04',12756,12289,467,35480], ['2027-09-04',12756,12410,346,23070],
      ['2027-10-04',12756,12538,218,10532], ['2027-11-04',10635,10532,103,0],
    ],
  },
  {
    meta: {
      name: 'Kotak Mahindra Bank', type: 'personal', rateType: 'reducing',
      principal: 807061, interestRate: 12.88, tenureMonths: 61,
      startDate: '2023-06-26', emiDueDay: 2, emi: 18359,
      foreclosureChargePercent: 4,
      color: '#FF0000',
    },
    schedule: [
      ['2023-08-02',18359,7725,10634,799336],['2023-09-02',18359,9777,8582,789558],
      ['2023-10-02',18359,9882,8477,779676], ['2023-11-02',18359,9989,8370,769687],
      ['2023-12-02',18359,10096,8263,759592],['2024-01-02',18359,10204,8155,749387],
      ['2024-02-02',18359,10314,8045,739074],['2024-03-02',18359,10424,7935,728649],
      ['2024-04-02',18359,10536,7823,718113],['2024-05-02',18359,10649,7710,707464],
      ['2024-06-02',18359,10764,7595,696700],['2024-07-02',18359,10879,7480,685820],
      ['2024-08-02',18359,10996,7363,674824],['2024-09-02',18359,11114,7245,663710],
      ['2024-10-02',18359,11234,7125,652476],['2024-11-02',18359,11354,7005,641122],
      ['2024-12-02',18359,11476,6883,629646],['2025-01-02',18359,11599,6760,618047],
      ['2025-02-02',18359,11724,6635,606323],['2025-03-02',18359,11850,6509,594474],
      ['2025-04-02',18359,11977,6382,582497],['2025-05-02',18359,12105,6254,570392],
      ['2025-06-02',18359,12235,6124,558156],['2025-07-02',18359,12367,5992,545789],
      ['2025-08-02',18359,12500,5860,533290],['2025-09-02',18359,12634,5725,520656],
      ['2025-10-02',18359,12769,5590,507887],['2025-11-02',18359,12906,5453,494980],
      ['2025-12-02',18359,13045,5314,481936],['2026-01-02',18359,13185,5174,468750],
      ['2026-02-02',18359,13327,5032,455424],['2026-03-02',18359,13470,4889,441954],
      ['2026-04-02',18359,13614,4745,428340],['2026-05-02',18359,13760,4599,414580],
      ['2026-06-02',18359,13908,4451,400671],['2026-07-02',18359,14057,4302,386614],
      ['2026-08-02',18359,14208,4151,372406],['2026-09-02',18359,14361,3998,358045],
      ['2026-10-02',18359,14515,3844,343530],['2026-11-02',18359,14671,3688,328859],
      ['2026-12-02',18359,14828,3531,314030],['2027-01-02',18359,14988,3371,299043],
      ['2027-02-02',18359,15149,3210,283894],['2027-03-02',18359,15311,3048,268583],
      ['2027-04-02',18359,15476,2883,253107],['2027-05-02',18359,15642,2717,237466],
      ['2027-06-02',18359,15810,2549,221656],['2027-07-02',18359,15979,2380,205677],
      ['2027-08-02',18359,16151,2208,189526],['2027-09-02',18359,16324,2035,173202],
      ['2027-10-02',18359,16500,1859,156702],['2027-11-02',18359,16677,1682,140025],
      ['2027-12-02',18359,16856,1503,123170],['2028-01-02',18359,17037,1322,106133],
      ['2028-02-02',18359,17220,1139,88913], ['2028-03-02',18359,17404,955,71509],
      ['2028-04-02',18359,17591,768,53918],  ['2028-05-02',18359,17780,579,36138],
      ['2028-06-02',18359,17971,388,18167],  ['2028-07-02',18359,18164,195,0],
    ],
  },
];

function initPrePopulatedLoans() {
  if (!loanState) loadLoanState();
  // Only pre-populate if loans are completely empty
  if (loanState.loans.length > 0) return false;

  const now = Date.now();
  PREPOP_LOANS.forEach((def, idx) => {
    const loanId = `loan-prepop-${idx + 1}`;
    const loan = {
      id: loanId,
      ...def.meta,
      hasSchedule: true,
      status: 'active',
      closedDate: null,
      closedAmount: null,
      createdAt: now,
      updatedAt: now,
    };
    loanState.loans.push(loan);

    // Convert compact array to schedule objects
    const rows = def.schedule.map((r, i) => ({
      no: i + 1,
      date: r[0],
      emi: r[1],
      principal: r[2],
      interest: r[3],
      balance: r[4],
    }));
    loanSchedules[loanId] = rows;
  });

  saveLoanState();
  try { localStorage.setItem(LOAN_SCH_STORAGE_KEY, JSON.stringify(loanSchedules)); } catch(e){}

  // Hide import button (no longer needed) and re-render
  window._loanNeedsPrePop = false;
  const importBtn = document.getElementById('loan-import-btn');
  if (importBtn) importBtn.style.display = 'none';
  renderLoans();
  if (typeof showToast === 'function') showToast('✅ 3 loans imported with exact schedules!');
  return true;
}

/* ═══════════════════════════════════════════════════════════════════
   EXPOSE TO WINDOW
   ═══════════════════════════════════════════════════════════════════ */
window.loanState             = loanState;
window.loanSchedules         = loanSchedules;
window.loadLoanState         = loadLoanState;
window.saveLoanState         = saveLoanState;
// v28.4 — Sheet pull-on-sign-in loaders
window.loadLoansFromSheet         = loadLoansFromSheet;
window.loadLoanScheduleFromSheet  = loadLoanScheduleFromSheet;
window.loadLoanMetaFromSheet      = loadLoanMetaFromSheet;
window.renderLoans           = renderLoans;
window.setLoanSubtab         = setLoanSubtab;
window.openLoanAddModal      = openLoanAddModal;
window.openLoanEditModal     = openLoanEditModal;
window.closeLoanFormModal    = closeLoanFormModal;
window.recalcEmiHint         = recalcEmiHint;
window.saveLoanForm          = saveLoanForm;
window.deleteLoanForm        = deleteLoanForm;
window.pickLoanColor         = pickLoanColor;
window.updateMonthlySavings  = updateMonthlySavings;
window.updateCurrentSavings  = updateCurrentSavings;
window.updateEmergencyReserve = updateEmergencyReserve;
window.moveLoanInOrder       = moveLoanInOrder;
window.markLoanClosed        = markLoanClosed;
window.runLoanSim            = runLoanSim;
window.handleScheduleUpload  = handleScheduleUpload;
window.showProjectionDetail  = showProjectionDetail;
window.calcEmi               = calcEmi;
window.loanCurrentBalance    = loanCurrentBalance;
window.foreclosureCost       = foreclosureCost;
window.initPrePopulatedLoans = initPrePopulatedLoans;

/* ── Init ────────────────────────────────────────────────────────── */
(function init() {
  loadLoanState();
  // Offer pre-population only on completely fresh installs
  if (loanState.loans.length === 0) {
    // Show button prompt on loans view after render
    window._loanNeedsPrePop = true;
  }
})();
