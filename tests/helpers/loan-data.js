/**
 * Shared test data — loan objects, schedules, expected values.
 * All numbers pre-verified against the loans.js math formulas.
 */
'use strict';

const NOW = Date.now();

/* ─── Loan objects ──────────────────────────────────────────────────── */

const CREDIT_FAIR = {
  id: 'cf-test-001',
  name: 'Credit Fair',
  type: 'personal',
  rateType: 'flat',
  principal: 500000,
  interestRate: 10.8,
  tenureMonths: 60,
  startDate: '2023-05-01',
  emiDueDay: 5,
  emi: 10780,
  foreclosureChargePercent: 0,
  status: 'active',
  color: '#7C5CFC',
  hasSchedule: false,
  createdAt: NOW,
  updatedAt: NOW,
};

const INDUSIND = {
  id: 'ii-test-001',
  name: 'IndusInd Bank',
  type: 'personal',
  rateType: 'reducing',
  principal: 500000,
  interestRate: 15.0,
  tenureMonths: 60,
  startDate: '2022-11-01',
  emiDueDay: 4,
  emi: 11895,
  foreclosureChargePercent: 3,
  status: 'active',
  color: '#FF6B6B',
  hasSchedule: false,
  createdAt: NOW,
  updatedAt: NOW,
};

const KOTAK = {
  id: 'kt-test-001',
  name: 'Kotak Mahindra',
  type: 'personal',
  rateType: 'reducing',
  principal: 800000,
  interestRate: 10.5,
  tenureMonths: 60,
  startDate: '2023-07-01',
  emiDueDay: 2,
  emi: 17187,
  foreclosureChargePercent: 4,
  status: 'active',
  color: '#FF0000',
  hasSchedule: false,
  createdAt: NOW,
  updatedAt: NOW,
};

const CLOSED_LOAN = {
  id: 'closed-test-001',
  name: 'Old Loan',
  type: 'personal',
  rateType: 'reducing',
  principal: 200000,
  interestRate: 12,
  tenureMonths: 24,
  startDate: '2020-01-01',
  emiDueDay: null,
  emi: 9415,
  foreclosureChargePercent: 5,
  status: 'closed',
  closedDate: '2022-01-15',
  closedAmount: 205000,
  color: '#78909C',
  hasSchedule: false,
  createdAt: NOW,
  updatedAt: NOW,
};

/* ─── Minimal 5-row test schedule (past dates — all "paid") ─────────── */
const PAST_SCHEDULE = [
  { no: 1, date: '2023-01-05', emi: 10780, principal: 6280, interest: 4500, balance: 493720 },
  { no: 2, date: '2023-02-05', emi: 10780, principal: 6280, interest: 4500, balance: 487440 },
  { no: 3, date: '2023-03-05', emi: 10780, principal: 6280, interest: 4500, balance: 481160 },
  { no: 4, date: '2023-04-05', emi: 10780, principal: 6280, interest: 4500, balance: 474880 },
  { no: 5, date: '2023-05-05', emi: 10780, principal: 6280, interest: 4500, balance: 468600 },
];

/* ─── Mixed schedule: 3 paid rows + 2 future rows ───────────────────── */
const MIXED_SCHEDULE = [
  { no: 1, date: '2023-01-05', emi: 10780, principal: 6280, interest: 4500, balance: 493720 },
  { no: 2, date: '2023-02-05', emi: 10780, principal: 6280, interest: 4500, balance: 487440 },
  { no: 3, date: '2023-03-05', emi: 10780, principal: 6280, interest: 4500, balance: 481160 },
  { no: 4, date: '2099-01-05', emi: 10780, principal: 6280, interest: 4500, balance: 474880 },
  { no: 5, date: '2099-02-05', emi: 10780, principal: 6280, interest: 4500, balance: 468600 },
];

/* ─── Schedule with ₹3 closing balance (Kotak rounding) ─────────────── */
const KOTAK_ROUNDING_SCHEDULE = [
  { no: 59, date: '2023-01-02', emi: 17187, principal: 17034, interest: 153, balance: 200 },
  { no: 60, date: '2023-02-02', emi: 17187, principal: 17184, interest: 3,   balance: 3   },
];

/* ─── Loan state wrappers (suitable for localStorage seed) ─────────── */

function makeLoanState(loans, extras = {}) {
  return {
    loans,
    monthlySavings: extras.monthlySavings ?? 0,
    targetDate: extras.targetDate ?? null,
    closureOrder: loans.map(l => l.id),
  };
}

/* ─── Pre-computed expected values ──────────────────────────────────── */

const EXPECTED = {
  /** calcEmi(p, r, t) reducing-balance results (Math.round) */
  emi: {
    '100000-12-12':   8885,
    '500000-12-60':  11122,
    '300000-9-36':   9538,
    '800000-10.5-60': 17187,
    '200000-14-24':  9673,
    '150000-11-36':  4904,
    '1000000-8.5-120': 12400,
    '50000-18-12':   4584,
    '250000-10-48':  6339,
    '400000-13.5-48': 11476,
  },
  /** flat-rate EMI = round(P*r/12/100 + P/t) */
  emiFlat: {
    '500000-10.8-60': 12833,
    '300000-12-36':  11333,
    '100000-10-12':   9167,
    '200000-14-24':  10667,
    '400000-9.5-48': 11500,
  },
  /** foreclosureCost results for balance=350000 */
  foreclosure: {
    pct0:   { principal: 350000, charge: 0,     gst: 0,    total: 350000 },
    pct3:   { principal: 350000, charge: 10500,  gst: 1890, total: 362390 },
    pct4:   { principal: 350000, charge: 14000,  gst: 2520, total: 366520 },
    pct5:   { principal: 350000, charge: 17500,  gst: 3150, total: 370650 },
  },
};

module.exports = {
  CREDIT_FAIR,
  INDUSIND,
  KOTAK,
  CLOSED_LOAN,
  PAST_SCHEDULE,
  MIXED_SCHEDULE,
  KOTAK_ROUNDING_SCHEDULE,
  makeLoanState,
  EXPECTED,
};
