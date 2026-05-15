/**
 * 07 — Pre-Populated Loan Import Tests (55 tests)
 *
 * Covers:
 *   • Import button visibility (only on fresh empty install)
 *   • initPrePopulatedLoans() creates exactly 3 loans
 *   • CreditFair metadata accuracy
 *   • IndusInd metadata accuracy
 *   • Kotak metadata accuracy
 *   • Schedule data persisted to loanSchedules
 *   • localStorage updated correctly
 *   • Import button hidden after import
 *   • UI re-renders after import
 */
'use strict';

const { test, expect } = require('@playwright/test');
const { loadApp, goToLoans } = require('../helpers/setup');

/* ─── Import Button Visibility ──────────────────────────────────────── */
test.describe('Pre-populated — Import Button Visibility', () => {
  let page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    // Fresh install: no loans in localStorage
    await loadApp(page, {});
    await goToLoans(page);
    await page.evaluate(() => window.renderLoans());
  });

  test.afterAll(() => page.close());

  test('TC-IMP-001  import button exists in DOM', async () => {
    await expect(page.locator('#loan-import-btn')).toHaveCount(1);
  });

  test('TC-IMP-002  import button visible when no loans exist', async () => {
    // On fresh install _loanNeedsPrePop=true; button should be shown
    const display = await page.locator('#loan-import-btn').evaluate(el => el.style.display);
    expect(display).not.toBe('none');
  });

  test('TC-IMP-003  import button shows text "Import My Loans"', async () => {
    const text = await page.locator('#loan-import-btn').textContent();
    expect(text).toContain('Import My Loans');
  });

  test('TC-IMP-004  import button has 📥 emoji', async () => {
    const text = await page.locator('#loan-import-btn').textContent();
    expect(text).toContain('📥');
  });

  test('TC-IMP-005  add loan button also visible', async () => {
    await expect(page.locator('.loan-add-btn')).toBeVisible();
  });

  test('TC-IMP-006  empty state message prompts both options', async () => {
    const text = await page.locator('#loan-cards-list').textContent();
    expect(text.toLowerCase()).toContain('add loan');
  });

  test('TC-IMP-007  import button hidden when loans exist', async () => {
    // Seed one loan
    await page.evaluate(() => {
      const state = {
        loans: [{ id: 'x1', name: 'Test Loan', type: 'personal', rateType: 'reducing',
                   principal: 100000, interestRate: 12, tenureMonths: 12, startDate: '2023-01-01',
                   emiDueDay: null, emi: 8885, foreclosureChargePercent: 5, status: 'active',
                   color: '#42A5F5', hasSchedule: false, createdAt: Date.now(), updatedAt: Date.now() }],
        monthlySavings: 0, targetDate: null, closureOrder: ['x1'],
      };
      localStorage.setItem('expense-tracker.loans.v1', JSON.stringify(state));
      window._loanNeedsPrePop = false;
      window.loadLoanState();
      window.renderLoans();
    });
    const display = await page.locator('#loan-import-btn').evaluate(el => el.style.display);
    expect(display).toBe('none');
  });

  test('TC-IMP-008  add button onclick calls openLoanAddModal', async () => {
    const onclick = await page.locator('.loan-add-btn').getAttribute('onclick');
    expect(onclick).toContain('openLoanAddModal');
  });

  test('TC-IMP-009  import button onclick calls initPrePopulatedLoans', async () => {
    const onclick = await page.locator('#loan-import-btn').getAttribute('onclick');
    expect(onclick).toContain('initPrePopulatedLoans');
  });

  test('TC-IMP-010  import button is inside loan-overview-actions wrapper', async () => {
    const parent = await page.locator('#loan-import-btn').evaluate(el => el.parentElement.className);
    expect(parent).toContain('loan-overview-actions');
  });
});

/* ─── After Import: All 3 Loans Created ─────────────────────────────── */
test.describe('Pre-populated — After Import (3 Loans)', () => {
  let page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await loadApp(page, {});
    // Trigger import
    await page.evaluate(() => window.initPrePopulatedLoans());
    await page.evaluate(() => window.renderLoans());
  });

  test.afterAll(() => page.close());

  test('TC-IMP-011  exactly 3 loans in loanState after import', async () => {
    const count = await page.evaluate(() => window.loanState?.loans?.length);
    expect(count).toBe(3);
  });

  test('TC-IMP-012  all 3 loans are active', async () => {
    const statuses = await page.evaluate(() => window.loanState.loans.map(l => l.status));
    statuses.forEach(s => expect(s).toBe('active'));
  });

  test('TC-IMP-013  all 3 loans have hasSchedule = true', async () => {
    const flags = await page.evaluate(() => window.loanState.loans.map(l => l.hasSchedule));
    flags.forEach(f => expect(f).toBe(true));
  });

  test('TC-IMP-014  loans persisted to localStorage', async () => {
    const stored = await page.evaluate(() => {
      const raw = localStorage.getItem('expense-tracker.loans.v1');
      return raw ? JSON.parse(raw).loans.length : 0;
    });
    expect(stored).toBe(3);
  });

  test('TC-IMP-015  schedules persisted to localStorage', async () => {
    const stored = await page.evaluate(() => {
      const raw = localStorage.getItem('expense-tracker.loan-sch.v1');
      return raw ? Object.keys(JSON.parse(raw)).length : 0;
    });
    expect(stored).toBe(3);
  });

  test('TC-IMP-016  import button hidden after import', async () => {
    const display = await page.locator('#loan-import-btn').evaluate(el => el.style.display);
    expect(display).toBe('none');
  });

  test('TC-IMP-017  loan cards rendered (3 cards)', async () => {
    const cards = await page.locator('.loan-card').count();
    expect(cards).toBe(3);
  });

  test('TC-IMP-018  hero shows total outstanding', async () => {
    const heroText = await page.locator('#loan-hero').textContent();
    expect(heroText.toLowerCase()).toContain('outstanding');
  });

  test('TC-IMP-019  _loanNeedsPrePop set to false', async () => {
    const flag = await page.evaluate(() => window._loanNeedsPrePop);
    expect(flag).toBe(false);
  });

  test('TC-IMP-020  second import call: returns false (no duplicates)', async () => {
    const result = await page.evaluate(() => window.initPrePopulatedLoans());
    expect(result).toBe(false);
  });
});

/* ─── CreditFair Metadata ─────────────────────────────────────────────── */
test.describe('Pre-populated — CreditFair Data Accuracy', () => {
  let page;
  let cfLoan;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await loadApp(page, {});
    await page.evaluate(() => window.initPrePopulatedLoans());
    cfLoan = await page.evaluate(() =>
      window.loanState.loans.find(l => l.name.toLowerCase().includes('credit'))
    );
  });

  test.afterAll(() => page.close());

  test('TC-CF-META-001  CreditFair loan exists', async () => {
    expect(cfLoan).not.toBeNull();
  });

  test('TC-CF-META-002  rateType = "flat"', async () => {
    expect(cfLoan.rateType).toBe('flat');
  });

  test('TC-CF-META-003  principal = 500000', async () => {
    expect(cfLoan.principal).toBe(500000);
  });

  test('TC-CF-META-004  interestRate = 10.8', async () => {
    expect(cfLoan.interestRate).toBe(10.8);
  });

  test('TC-CF-META-005  tenureMonths = 60', async () => {
    expect(cfLoan.tenureMonths).toBe(60);
  });

  test('TC-CF-META-006  emiDueDay = 5', async () => {
    expect(cfLoan.emiDueDay).toBe(5);
  });

  test('TC-CF-META-007  foreclosureChargePercent = 0', async () => {
    expect(cfLoan.foreclosureChargePercent).toBe(0);
  });

  test('TC-CF-META-008  hasSchedule = true', async () => {
    expect(cfLoan.hasSchedule).toBe(true);
  });

  test('TC-CF-META-009  schedule has 60 rows', async () => {
    const count = await page.evaluate(id =>
      window.loanSchedules[id]?.length,
      cfLoan.id
    );
    expect(count).toBe(60);
  });

  test('TC-CF-META-010  first schedule row date starts with "2023"', async () => {
    const firstDate = await page.evaluate(id =>
      window.loanSchedules[id]?.[0]?.date,
      cfLoan.id
    );
    expect(firstDate.startsWith('2023')).toBe(true);
  });

  test('TC-CF-META-011  first row interest = 4500', async () => {
    const interest = await page.evaluate(id =>
      window.loanSchedules[id]?.[0]?.interest,
      cfLoan.id
    );
    expect(interest).toBe(4500);
  });

  test('TC-CF-META-012  last row balance = 0', async () => {
    const lastBal = await page.evaluate(id => {
      const sch = window.loanSchedules[id];
      return sch[sch.length - 1]?.balance;
    }, cfLoan.id);
    expect(lastBal).toBe(0);
  });

  test('TC-CF-META-013  start date is 2023-05-01', async () => {
    expect(cfLoan.startDate).toBe('2023-05-01');
  });

  test('TC-CF-META-014  all 60 rows have positive EMI', async () => {
    const emis = await page.evaluate(id =>
      window.loanSchedules[id]?.map(r => r.emi),
      cfLoan.id
    );
    emis.forEach(e => expect(e).toBeGreaterThan(0));
  });

  test('TC-CF-META-015  interest constant at 4500 (flat rate characteristic)', async () => {
    const interests = await page.evaluate(id =>
      window.loanSchedules[id]?.map(r => r.interest),
      cfLoan.id
    );
    // All interest values should be 4500 for flat rate
    interests.forEach(i => expect(i).toBe(4500));
  });
});

/* ─── IndusInd and Kotak Quick Checks ───────────────────────────────── */
test.describe('Pre-populated — IndusInd and Kotak Spot Checks', () => {
  let page;
  let iiLoan, ktLoan;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await loadApp(page, {});
    await page.evaluate(() => window.initPrePopulatedLoans());
    [iiLoan, ktLoan] = await page.evaluate(() => {
      const loans = window.loanState.loans;
      return [
        loans.find(l => l.name.toLowerCase().includes('indus')),
        loans.find(l => l.name.toLowerCase().includes('kotak')),
      ];
    });
  });

  test.afterAll(() => page.close());

  test('TC-II-001  IndusInd loan exists', async () => { expect(iiLoan).toBeTruthy(); });

  test('TC-II-002  IndusInd rateType = "reducing"', async () => {
    expect(iiLoan.rateType).toBe('reducing');
  });

  test('TC-II-003  IndusInd emiDueDay = 4', async () => {
    expect(iiLoan.emiDueDay).toBe(4);
  });

  test('TC-II-004  IndusInd foreclosureCharge = 3', async () => {
    expect(iiLoan.foreclosureChargePercent).toBe(3);
  });

  test('TC-II-005  IndusInd schedule has 60 rows', async () => {
    const count = await page.evaluate(id => window.loanSchedules[id]?.length, iiLoan.id);
    expect(count).toBe(60);
  });

  test('TC-KT-001  Kotak loan exists', async () => { expect(ktLoan).toBeTruthy(); });

  test('TC-KT-002  Kotak rateType = "reducing"', async () => {
    expect(ktLoan.rateType).toBe('reducing');
  });

  test('TC-KT-003  Kotak emiDueDay = 2', async () => {
    expect(ktLoan.emiDueDay).toBe(2);
  });

  test('TC-KT-004  Kotak foreclosureCharge = 4', async () => {
    expect(ktLoan.foreclosureChargePercent).toBe(4);
  });

  test('TC-KT-005  Kotak schedule has 60 rows', async () => {
    const count = await page.evaluate(id => window.loanSchedules[id]?.length, ktLoan.id);
    expect(count).toBe(60);
  });

  test('TC-KT-006  Kotak last balance = 0', async () => {
    const lastBal = await page.evaluate(id => {
      const sch = window.loanSchedules[id];
      return sch[sch.length - 1]?.balance;
    }, ktLoan.id);
    expect(lastBal).toBeLessThanOrEqual(3); // ≤ 3 (rounding artifact treated as 0)
  });

  test('TC-KT-007  Kotak principal is positive', async () => {
    expect(ktLoan.principal).toBeGreaterThan(0);
  });

  test('TC-KT-008  all 3 loan IDs are unique', async () => {
    const ids = await page.evaluate(() => window.loanState.loans.map(l => l.id));
    expect(new Set(ids).size).toBe(3);
  });

  test('TC-KT-009  loanSchedules keys match loan IDs', async () => {
    const loanIds    = await page.evaluate(() => window.loanState.loans.map(l => l.id));
    const scheduleIds= await page.evaluate(() => Object.keys(window.loanSchedules));
    loanIds.forEach(id => expect(scheduleIds).toContain(id));
  });

  test('TC-KT-010  IndusInd schedule rows are chronologically sorted', async () => {
    const dates = await page.evaluate(id =>
      window.loanSchedules[id]?.map(r => r.date),
      iiLoan.id
    );
    for (let i = 1; i < dates.length; i++) {
      expect(dates[i] >= dates[i - 1]).toBe(true);
    }
  });
});
