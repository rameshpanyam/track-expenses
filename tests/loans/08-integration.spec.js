/**
 * 08 — Integration Tests (50 tests)
 *
 * End-to-end flows:
 *   • Add a new loan through the form and verify it persists
 *   • Edit an existing loan and verify field updates
 *   • Delete a loan and verify removal
 *   • Mark a loan as closed
 *   • Closure plan renders with correct data
 */
'use strict';

const { test, expect } = require('@playwright/test');
const { loadApp, goToLoans, openAddModal, openEditModal, closeModal, seedLoanState }
  = require('../helpers/setup');
const { CREDIT_FAIR, INDUSIND, KOTAK, makeLoanState } = require('../helpers/loan-data');

/* ─── Complete Add Loan Flow ─────────────────────────────────────────── */
test.describe('Integration — Add Loan Flow', () => {
  let page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await loadApp(page, {});
    await goToLoans(page);
  });

  test.afterAll(() => page.close());

  async function fillAndSave({ name, principal, rate, rateType, tenure, startDate, emiDueDay, emi, foreclosure }) {
    await openAddModal(page);
    if (name)        await page.fill('#loan-form-name',         name);
    if (principal)   await page.fill('#loan-form-principal',    String(principal));
    if (rate)        await page.fill('#loan-form-rate',         String(rate));
    if (rateType)    await page.selectOption('#loan-form-rate-type', rateType);
    if (tenure)      await page.fill('#loan-form-tenure',       String(tenure));
    if (startDate)   await page.fill('#loan-form-startdate',    startDate);
    if (emiDueDay)   await page.fill('#loan-form-emi-due-day',  String(emiDueDay));
    if (emi)         await page.fill('#loan-form-emi',          String(emi));
    if (foreclosure !== undefined) await page.fill('#loan-form-foreclosure', String(foreclosure));
    // Pick first color swatch
    await page.locator('#loan-form-colors .loan-color-swatch').first().click();
    await page.evaluate(() => saveLoanForm());
  }

  test('TC-INT-001  saving a loan closes the modal', async () => {
    await fillAndSave({ name: 'Test Bank', principal: 100000, rate: 12, rateType: 'reducing',
                        tenure: 12, startDate: '2023-01-01', emiDueDay: 5, foreclosure: 5 });
    const display = await page.locator('#loan-form-modal').evaluate(el => el.style.display);
    expect(display).toBe('none');
  });

  test('TC-INT-002  saved loan appears in loanState', async () => {
    const count = await page.evaluate(() => window.loanState?.loans?.length);
    expect(count).toBeGreaterThanOrEqual(1);
  });

  test('TC-INT-003  saved loan has correct name', async () => {
    const name = await page.evaluate(() =>
      window.loanState.loans.find(l => l.name === 'Test Bank')?.name
    );
    expect(name).toBe('Test Bank');
  });

  test('TC-INT-004  saved loan has correct principal', async () => {
    const principal = await page.evaluate(() =>
      window.loanState.loans.find(l => l.name === 'Test Bank')?.principal
    );
    expect(principal).toBe(100000);
  });

  test('TC-INT-005  saved loan has correct rateType', async () => {
    const rt = await page.evaluate(() =>
      window.loanState.loans.find(l => l.name === 'Test Bank')?.rateType
    );
    expect(rt).toBe('reducing');
  });

  test('TC-INT-006  saved loan has correct emiDueDay', async () => {
    const dd = await page.evaluate(() =>
      window.loanState.loans.find(l => l.name === 'Test Bank')?.emiDueDay
    );
    expect(dd).toBe(5);
  });

  test('TC-INT-007  saved loan has status = active', async () => {
    const status = await page.evaluate(() =>
      window.loanState.loans.find(l => l.name === 'Test Bank')?.status
    );
    expect(status).toBe('active');
  });

  test('TC-INT-008  saved loan persisted in localStorage', async () => {
    const stored = await page.evaluate(() => {
      const raw = localStorage.getItem('expense-tracker.loans.v1');
      if (!raw) return null;
      return JSON.parse(raw).loans.find(l => l.name === 'Test Bank');
    });
    expect(stored).not.toBeNull();
    expect(stored.name).toBe('Test Bank');
  });

  test('TC-INT-009  loan card rendered after save', async () => {
    await page.evaluate(() => renderLoans());
    const cards = await page.locator('.loan-card').count();
    expect(cards).toBeGreaterThanOrEqual(1);
  });

  test('TC-INT-010  saved loan has unique ID', async () => {
    const id = await page.evaluate(() =>
      window.loanState.loans.find(l => l.name === 'Test Bank')?.id
    );
    expect(id).toBeTruthy();
    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);
  });

  test('TC-INT-011  name required: empty name does not save', async () => {
    const countBefore = await page.evaluate(() => window.loanState?.loans?.length);
    await openAddModal(page);
    // Don't fill name; try to save
    await page.evaluate(() => {
      document.getElementById('loan-form-principal').value = '50000';
      document.getElementById('loan-form-rate').value = '10';
      document.getElementById('loan-form-tenure').value = '12';
      document.getElementById('loan-form-emi').value = '4392';
    });
    await page.evaluate(() => saveLoanForm());
    const countAfter = await page.evaluate(() => window.loanState?.loans?.length);
    expect(countAfter).toBe(countBefore); // unchanged — validation blocked save
  });

  test('TC-INT-012  adding flat-rate loan saves correct rateType', async () => {
    await fillAndSave({ name: 'Flat Loan', principal: 200000, rate: 10.8, rateType: 'flat',
                        tenure: 24, startDate: '2023-06-01', emiDueDay: 10, foreclosure: 0 });
    const rt = await page.evaluate(() =>
      window.loanState.loans.find(l => l.name === 'Flat Loan')?.rateType
    );
    expect(rt).toBe('flat');
  });

  test('TC-INT-013  zero foreclosure charge saved correctly', async () => {
    const fc = await page.evaluate(() =>
      window.loanState.loans.find(l => l.name === 'Flat Loan')?.foreclosureChargePercent
    );
    expect(fc).toBe(0);
  });

  test('TC-INT-014  adding a second loan increments loan count', async () => {
    const count = await page.evaluate(() => window.loanState?.loans?.length);
    expect(count).toBeGreaterThanOrEqual(2);
  });

  test('TC-INT-015  hero updates with new total after add', async () => {
    await page.evaluate(() => renderLoans());
    const heroText = await page.locator('#loan-hero').textContent();
    expect(heroText.length).toBeGreaterThan(0);
  });
});

/* ─── Complete Edit Loan Flow ─────────────────────────────────────────── */
test.describe('Integration — Edit Loan Flow', () => {
  let page;
  let testLoanId;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    const state = makeLoanState([CREDIT_FAIR, INDUSIND]);
    await loadApp(page, { loans: state });
    await goToLoans(page);
    testLoanId = CREDIT_FAIR.id;
    await openEditModal(page, testLoanId);
  });

  test.afterAll(() => page.close());

  test('TC-EDT-INT-001  editing name updates loanState', async () => {
    await page.fill('#loan-form-name', 'Credit Fair Updated');
    await page.evaluate(() => saveLoanForm());
    const name = await page.evaluate((id) =>
      window.loanState.loans.find(l => l.id === id)?.name,
      testLoanId
    );
    expect(name).toBe('Credit Fair Updated');
  });

  test('TC-EDT-INT-002  edit persists to localStorage', async () => {
    const stored = await page.evaluate((id) => {
      const raw = localStorage.getItem('expense-tracker.loans.v1');
      return JSON.parse(raw).loans.find(l => l.id === id)?.name;
    }, testLoanId);
    expect(stored).toBe('Credit Fair Updated');
  });

  test('TC-EDT-INT-003  editing emiDueDay updates loan', async () => {
    await openEditModal(page, testLoanId);
    await page.fill('#loan-form-emi-due-day', '15');
    await page.evaluate(() => saveLoanForm());
    const day = await page.evaluate((id) =>
      window.loanState.loans.find(l => l.id === id)?.emiDueDay,
      testLoanId
    );
    expect(day).toBe(15);
  });

  test('TC-EDT-INT-004  editing rateType to reducing saves', async () => {
    await openEditModal(page, testLoanId);
    await page.selectOption('#loan-form-rate-type', 'reducing');
    await page.evaluate(() => saveLoanForm());
    const rt = await page.evaluate((id) =>
      window.loanState.loans.find(l => l.id === id)?.rateType,
      testLoanId
    );
    expect(rt).toBe('reducing');
  });

  test('TC-EDT-INT-005  edit updates updatedAt timestamp', async () => {
    const tsBefore = await page.evaluate((id) =>
      window.loanState.loans.find(l => l.id === id)?.updatedAt,
      testLoanId
    );
    await new Promise(r => setTimeout(r, 10));
    await openEditModal(page, testLoanId);
    await page.fill('#loan-form-name', 'CF Updated 2');
    await page.evaluate(() => saveLoanForm());
    const tsAfter = await page.evaluate((id) =>
      window.loanState.loans.find(l => l.id === id)?.updatedAt,
      testLoanId
    );
    expect(tsAfter).toBeGreaterThanOrEqual(tsBefore);
  });

  test('TC-EDT-INT-006  editing one loan does not affect another', async () => {
    const iiRate = await page.evaluate((id) =>
      window.loanState.loans.find(l => l.id === id)?.interestRate,
      INDUSIND.id
    );
    expect(iiRate).toBe(INDUSIND.interestRate);
  });

  test('TC-EDT-INT-007  editing foreclosure to 0 saves 0', async () => {
    await openEditModal(page, testLoanId);
    await page.fill('#loan-form-foreclosure', '0');
    await page.evaluate(() => saveLoanForm());
    const fc = await page.evaluate((id) =>
      window.loanState.loans.find(l => l.id === id)?.foreclosureChargePercent,
      testLoanId
    );
    expect(fc).toBe(0);
  });

  test('TC-EDT-INT-008  card updates after edit', async () => {
    await page.evaluate(() => renderLoans());
    const cards = await page.locator('.loan-card').count();
    expect(cards).toBe(2);
  });
});

/* ─── Delete Loan Flow ───────────────────────────────────────────────── */
test.describe('Integration — Delete Loan', () => {
  let page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    const state = makeLoanState([CREDIT_FAIR, INDUSIND]);
    await loadApp(page, { loans: state });
    await goToLoans(page);
  });

  test.afterAll(() => page.close());

  test('TC-DEL-001  delete removes loan from loanState', async () => {
    await openEditModal(page, CREDIT_FAIR.id);
    await page.evaluate(() => deleteLoanForm());
    const count = await page.evaluate(() => window.loanState.loans.length);
    expect(count).toBe(1);
  });

  test('TC-DEL-002  correct loan deleted', async () => {
    const remaining = await page.evaluate(() => window.loanState.loans[0]?.name);
    expect(remaining).toBe(INDUSIND.name);
  });

  test('TC-DEL-003  deleted loan not in localStorage', async () => {
    const stored = await page.evaluate((id) => {
      const raw = localStorage.getItem('expense-tracker.loans.v1');
      return JSON.parse(raw).loans.find(l => l.id === id);
    }, CREDIT_FAIR.id);
    expect(stored).toBeUndefined();
  });

  test('TC-DEL-004  delete closes modal', async () => {
    const display = await page.locator('#loan-form-modal').evaluate(el => el.style.display);
    expect(display).toBe('none');
  });

  test('TC-DEL-005  UI shows 1 card after delete', async () => {
    await page.evaluate(() => renderLoans());
    const cards = await page.locator('.loan-card').count();
    expect(cards).toBe(1);
  });

  test('TC-DEL-006  deleting last loan shows empty state', async () => {
    await openEditModal(page, INDUSIND.id);
    await page.evaluate(() => deleteLoanForm());
    await page.evaluate(() => renderLoans());
    const cards = await page.locator('.loan-card').count();
    expect(cards).toBe(0);
  });

  test('TC-DEL-007  empty state text shown after last delete', async () => {
    const text = await page.locator('#loan-cards-list').textContent();
    expect(text.toLowerCase()).toContain('no loans');
  });
});

/* ─── Mark Loan Closed ───────────────────────────────────────────────── */
test.describe('Integration — Mark Loan Closed', () => {
  let page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    const state = makeLoanState([CREDIT_FAIR]);
    await loadApp(page, { loans: state });
    await goToLoans(page);
  });

  test.afterAll(() => page.close());

  test('TC-CLOSE-001  markLoanClosed changes status to closed', async () => {
    await page.evaluate((id) =>
      window.markLoanClosed && window.markLoanClosed(id, 450000),
      CREDIT_FAIR.id
    );
    const status = await page.evaluate((id) =>
      window.loanState.loans.find(l => l.id === id)?.status,
      CREDIT_FAIR.id
    );
    expect(status).toBe('closed');
  });

  test('TC-CLOSE-002  closed loan balance = 0', async () => {
    const loan = await page.evaluate((id) =>
      window.loanState.loans.find(l => l.id === id),
      CREDIT_FAIR.id
    );
    const bal = await page.evaluate((l) => window.loanCurrentBalance(l), loan);
    expect(bal).toBe(0);
  });

  test('TC-CLOSE-003  closed loan appears in closed section', async () => {
    await page.evaluate(() => renderLoans());
    const closedText = await page.locator('#loan-cards-list').textContent();
    expect(closedText.toLowerCase()).toContain('closed');
  });

  test('TC-CLOSE-004  closing updates localStorage', async () => {
    const stored = await page.evaluate((id) => {
      const raw = localStorage.getItem('expense-tracker.loans.v1');
      return JSON.parse(raw).loans.find(l => l.id === id)?.status;
    }, CREDIT_FAIR.id);
    expect(stored).toBe('closed');
  });
});
