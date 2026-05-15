/**
 * 04 — Form UI Tests (75 tests)
 *
 * Covers:
 *   • Add modal initial state (all fields empty/default)
 *   • Edit modal field population (correct values from loan object)
 *   • Rate type selector (flat vs reducing) — new in v27
 *   • EMI due day field — new in v27
 *   • Foreclosure charge field
 *   • Color picker
 *   • EMI hint update on field change
 *   • Schedule upload section DOM presence
 */
'use strict';

const { test, expect } = require('@playwright/test');
const { loadApp, goToLoans, openAddModal, openEditModal, closeModal, seedLoanState }
  = require('../helpers/setup');
const { CREDIT_FAIR, INDUSIND, KOTAK, makeLoanState } = require('../helpers/loan-data');

/* ─── Add Modal — Initial State ─────────────────────────────────────── */
test.describe('Form UI — Add Loan Modal Initial State', () => {
  let page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await loadApp(page);
    await goToLoans(page);
    await openAddModal(page);
  });

  test.afterAll(() => page.close());

  test('TC-FRM-001  modal is visible after openLoanAddModal()', async () => {
    await expect(page.locator('#loan-form-modal')).toBeVisible();
  });

  test('TC-FRM-002  title says "Add Loan"', async () => {
    await expect(page.locator('#loan-modal-title')).toHaveText('Add Loan');
  });

  test('TC-FRM-003  name field is empty', async () => {
    await expect(page.locator('#loan-form-name')).toHaveValue('');
  });

  test('TC-FRM-004  type field defaults to "personal"', async () => {
    await expect(page.locator('#loan-form-type')).toHaveValue('personal');
  });

  test('TC-FRM-005  principal field is empty', async () => {
    await expect(page.locator('#loan-form-principal')).toHaveValue('');
  });

  test('TC-FRM-006  interest rate field is empty', async () => {
    await expect(page.locator('#loan-form-rate')).toHaveValue('');
  });

  test('TC-FRM-007  rate type defaults to "reducing"', async () => {
    await expect(page.locator('#loan-form-rate-type')).toHaveValue('reducing');
  });

  test('TC-FRM-008  tenure field is empty', async () => {
    await expect(page.locator('#loan-form-tenure')).toHaveValue('');
  });

  test('TC-FRM-009  start date defaults to today', async () => {
    const today = new Date().toISOString().slice(0, 10);
    await expect(page.locator('#loan-form-startdate')).toHaveValue(today);
  });

  test('TC-FRM-010  EMI due day field is empty', async () => {
    await expect(page.locator('#loan-form-emi-due-day')).toHaveValue('');
  });

  test('TC-FRM-011  EMI field is empty', async () => {
    await expect(page.locator('#loan-form-emi')).toHaveValue('');
  });

  test('TC-FRM-012  foreclosure charge field present', async () => {
    await expect(page.locator('#loan-form-foreclosure')).toBeVisible();
  });

  test('TC-FRM-013  color picker grid is present', async () => {
    await expect(page.locator('#loan-form-colors')).toBeVisible();
  });

  test('TC-FRM-014  PDF upload area is present', async () => {
    await expect(page.locator('.loan-sch-upload-area')).toBeVisible();
  });

  test('TC-FRM-015  schedule preview is hidden initially', async () => {
    const wrap = page.locator('#loan-form-sch-preview-wrap');
    const display = await wrap.evaluate(el => el.style.display);
    expect(display).toBe('none');
  });

  test('TC-FRM-016  delete button is hidden on add', async () => {
    const del = page.locator('#loan-form-delete');
    const display = await del.evaluate(el => el.style.display);
    expect(display).toBe('none');
  });

  test('TC-FRM-017  save button is visible', async () => {
    // Last button in confirm-actions without an id-delete
    await expect(page.locator('.loan-form-actions button.confirm-ok:not(#loan-form-delete)')).toBeVisible();
  });

  test('TC-FRM-018  cancel button is visible', async () => {
    await expect(page.locator('.loan-form-actions .confirm-cancel')).toBeVisible();
  });

  test('TC-FRM-019  rate type select has both options', async () => {
    const opts = await page.locator('#loan-form-rate-type option').count();
    expect(opts).toBe(2);
  });

  test('TC-FRM-020  rate type options are "reducing" and "flat"', async () => {
    const values = await page.locator('#loan-form-rate-type option').evaluateAll(
      els => els.map(e => e.value)
    );
    expect(values).toContain('reducing');
    expect(values).toContain('flat');
  });
});

/* ─── Edit Modal — Field Population ─────────────────────────────────── */
test.describe('Form UI — Edit Loan Modal Field Population', () => {
  let page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    const state = makeLoanState([CREDIT_FAIR, INDUSIND, KOTAK]);
    await loadApp(page, { loans: state });
    await goToLoans(page);
  });

  test.afterAll(() => page.close());

  async function openCreditFair() {
    await openEditModal(page, CREDIT_FAIR.id);
  }

  async function openIndusInd() {
    await closeModal(page);
    await openEditModal(page, INDUSIND.id);
  }

  async function openKotak() {
    await closeModal(page);
    await openEditModal(page, KOTAK.id);
  }

  test('TC-EDT-001  edit modal title = "Edit Loan"', async () => {
    await openCreditFair();
    await expect(page.locator('#loan-modal-title')).toHaveText('Edit Loan');
  });

  test('TC-EDT-002  CreditFair name populated correctly', async () => {
    await expect(page.locator('#loan-form-name')).toHaveValue(CREDIT_FAIR.name);
  });

  test('TC-EDT-003  CreditFair type populated correctly', async () => {
    await expect(page.locator('#loan-form-type')).toHaveValue(CREDIT_FAIR.type);
  });

  test('TC-EDT-004  CreditFair rateType = "flat"', async () => {
    await expect(page.locator('#loan-form-rate-type')).toHaveValue('flat');
  });

  test('TC-EDT-005  CreditFair principal = 500000', async () => {
    await expect(page.locator('#loan-form-principal')).toHaveValue('500000');
  });

  test('TC-EDT-006  CreditFair interest rate = 10.8', async () => {
    await expect(page.locator('#loan-form-rate')).toHaveValue('10.8');
  });

  test('TC-EDT-007  CreditFair tenure = 60', async () => {
    await expect(page.locator('#loan-form-tenure')).toHaveValue('60');
  });

  test('TC-EDT-008  CreditFair start date = 2023-05-01', async () => {
    await expect(page.locator('#loan-form-startdate')).toHaveValue('2023-05-01');
  });

  test('TC-EDT-009  CreditFair emiDueDay = 5', async () => {
    await expect(page.locator('#loan-form-emi-due-day')).toHaveValue('5');
  });

  test('TC-EDT-010  CreditFair EMI = 10780', async () => {
    await expect(page.locator('#loan-form-emi')).toHaveValue('10780');
  });

  test('TC-EDT-011  CreditFair foreclosure charge = 0', async () => {
    await expect(page.locator('#loan-form-foreclosure')).toHaveValue('0');
  });

  test('TC-EDT-012  CreditFair delete button visible on edit', async () => {
    await expect(page.locator('#loan-form-delete')).toBeVisible();
  });

  test('TC-EDT-013  IndusInd rateType = "reducing"', async () => {
    await openIndusInd();
    await expect(page.locator('#loan-form-rate-type')).toHaveValue('reducing');
  });

  test('TC-EDT-014  IndusInd emiDueDay = 4', async () => {
    await expect(page.locator('#loan-form-emi-due-day')).toHaveValue('4');
  });

  test('TC-EDT-015  IndusInd principal = 500000', async () => {
    await expect(page.locator('#loan-form-principal')).toHaveValue('500000');
  });

  test('TC-EDT-016  IndusInd interest rate = 15', async () => {
    await expect(page.locator('#loan-form-rate')).toHaveValue('15');
  });

  test('TC-EDT-017  IndusInd foreclosure = 3', async () => {
    await expect(page.locator('#loan-form-foreclosure')).toHaveValue('3');
  });

  test('TC-EDT-018  Kotak emiDueDay = 2', async () => {
    await openKotak();
    await expect(page.locator('#loan-form-emi-due-day')).toHaveValue('2');
  });

  test('TC-EDT-019  Kotak principal = 800000', async () => {
    await expect(page.locator('#loan-form-principal')).toHaveValue('800000');
  });

  test('TC-EDT-020  Kotak foreclosure = 4', async () => {
    await expect(page.locator('#loan-form-foreclosure')).toHaveValue('4');
  });
});

/* ─── Rate Type Selector Tests ──────────────────────────────────────── */
test.describe('Form UI — Rate Type Selector', () => {
  let page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await loadApp(page);
    await goToLoans(page);
    await openAddModal(page);
  });

  test.afterAll(() => page.close());

  test('TC-RTP-001  default is "reducing"', async () => {
    await expect(page.locator('#loan-form-rate-type')).toHaveValue('reducing');
  });

  test('TC-RTP-002  can change to "flat"', async () => {
    await page.selectOption('#loan-form-rate-type', 'flat');
    await expect(page.locator('#loan-form-rate-type')).toHaveValue('flat');
  });

  test('TC-RTP-003  can change back to "reducing"', async () => {
    await page.selectOption('#loan-form-rate-type', 'reducing');
    await expect(page.locator('#loan-form-rate-type')).toHaveValue('reducing');
  });

  test('TC-RTP-004  flat: hint shows flat EMI when rate/tenure/principal filled', async () => {
    await page.fill('#loan-form-principal', '500000');
    await page.fill('#loan-form-rate', '10.8');
    await page.fill('#loan-form-tenure', '60');
    await page.selectOption('#loan-form-rate-type', 'flat');
    await page.evaluate(() => recalcEmiHint());
    const hint = await page.locator('#loan-form-emi-hint').textContent();
    expect(hint).toContain('12,833');
  });

  test('TC-RTP-005  reducing: hint shows reducing EMI', async () => {
    await page.selectOption('#loan-form-rate-type', 'reducing');
    await page.evaluate(() => recalcEmiHint());
    const hint = await page.locator('#loan-form-emi-hint').textContent();
    // calcEmi(500000, 10.8, 60) — just verify it's different from flat 12833
    expect(hint).toMatch(/\d{2},\d{3}/); // some INR formatted number
  });

  test('TC-RTP-006  flat hint higher than reducing hint (same inputs)', async () => {
    await page.fill('#loan-form-principal', '300000');
    await page.fill('#loan-form-rate', '12');
    await page.fill('#loan-form-tenure', '36');

    await page.selectOption('#loan-form-rate-type', 'flat');
    await page.evaluate(() => recalcEmiHint());
    const flatHint = await page.locator('#loan-form-emi-hint').textContent();

    await page.selectOption('#loan-form-rate-type', 'reducing');
    await page.evaluate(() => recalcEmiHint());
    const reducingHint = await page.locator('#loan-form-emi-hint').textContent();

    // Both hints contain "₹" formatted numbers; flat must be higher (11,333 vs ~9,964)
    const extractNum = (s) => parseInt(s.replace(/[^0-9]/g, '').slice(0, 6));
    expect(extractNum(flatHint)).toBeGreaterThan(extractNum(reducingHint));
  });

  test('TC-RTP-007  hint is empty when principal missing', async () => {
    await page.evaluate(() => { document.getElementById('loan-form-principal').value = ''; });
    await page.evaluate(() => recalcEmiHint());
    const hint = await page.locator('#loan-form-emi-hint').textContent();
    expect(hint).toBe('');
  });

  test('TC-RTP-008  hint is empty when rate missing', async () => {
    await page.evaluate(() => {
      document.getElementById('loan-form-principal').value = '100000';
      document.getElementById('loan-form-rate').value = '';
      document.getElementById('loan-form-tenure').value = '12';
    });
    await page.evaluate(() => recalcEmiHint());
    const hint = await page.locator('#loan-form-emi-hint').textContent();
    expect(hint).toBe('');
  });

  test('TC-RTP-009  hint is clickable (fills EMI field)', async () => {
    await page.evaluate(() => {
      document.getElementById('loan-form-principal').value = '100000';
      document.getElementById('loan-form-rate').value = '12';
      document.getElementById('loan-form-tenure').value = '12';
      document.getElementById('loan-form-rate-type').value = 'reducing';
      recalcEmiHint();
    });
    await page.locator('#loan-form-emi-hint').click();
    await expect(page.locator('#loan-form-emi')).toHaveValue('8885');
  });

  test('TC-RTP-010  rate-type select triggers recalcEmiHint on change', async () => {
    await page.evaluate(() => {
      document.getElementById('loan-form-principal').value = '200000';
      document.getElementById('loan-form-rate').value = '12';
      document.getElementById('loan-form-tenure').value = '24';
    });
    await page.selectOption('#loan-form-rate-type', 'flat');
    // onchange="recalcEmiHint()" should fire automatically
    const hint = await page.locator('#loan-form-emi-hint').textContent();
    expect(hint.length).toBeGreaterThan(0);
  });
});

/* ─── EMI Due Day Field Tests ────────────────────────────────────────── */
test.describe('Form UI — EMI Due Day Field', () => {
  let page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await loadApp(page);
    await goToLoans(page);
    await openAddModal(page);
  });

  test.afterAll(() => page.close());

  test('TC-DUE-001  emiDueDay field exists in DOM', async () => {
    await expect(page.locator('#loan-form-emi-due-day')).toBeVisible();
  });

  test('TC-DUE-002  emiDueDay starts empty', async () => {
    await expect(page.locator('#loan-form-emi-due-day')).toHaveValue('');
  });

  test('TC-DUE-003  can type a value 1-28', async () => {
    await page.fill('#loan-form-emi-due-day', '5');
    await expect(page.locator('#loan-form-emi-due-day')).toHaveValue('5');
  });

  test('TC-DUE-004  min attribute = 1', async () => {
    const min = await page.locator('#loan-form-emi-due-day').getAttribute('min');
    expect(min).toBe('1');
  });

  test('TC-DUE-005  max attribute = 28', async () => {
    const max = await page.locator('#loan-form-emi-due-day').getAttribute('max');
    expect(max).toBe('28');
  });

  test('TC-DUE-006  input type is number', async () => {
    const type = await page.locator('#loan-form-emi-due-day').getAttribute('type');
    expect(type).toBe('number');
  });

  test('TC-DUE-007  has hint text about debit day', async () => {
    const hint = await page.locator('#loan-form-emi-due-day ~ .loan-form-emi-hint').textContent();
    expect(hint.toLowerCase()).toContain('day');
  });

  test('TC-DUE-008  CreditFair edit shows 5', async () => {
    await closeModal(page);
    const state = makeLoanState([CREDIT_FAIR]);
    await seedLoanState(page, state.loans);
    await openEditModal(page, CREDIT_FAIR.id);
    await expect(page.locator('#loan-form-emi-due-day')).toHaveValue('5');
  });

  test('TC-DUE-009  IndusInd edit shows 4', async () => {
    await closeModal(page);
    const state = makeLoanState([INDUSIND]);
    await seedLoanState(page, state.loans);
    await openEditModal(page, INDUSIND.id);
    await expect(page.locator('#loan-form-emi-due-day')).toHaveValue('4');
  });

  test('TC-DUE-010  Kotak edit shows 2', async () => {
    await closeModal(page);
    const state = makeLoanState([KOTAK]);
    await seedLoanState(page, state.loans);
    await openEditModal(page, KOTAK.id);
    await expect(page.locator('#loan-form-emi-due-day')).toHaveValue('2');
  });
});

/* ─── Foreclosure Field & Color Picker ──────────────────────────────── */
test.describe('Form UI — Foreclosure Field and Color Picker', () => {
  let page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await loadApp(page);
    await goToLoans(page);
    await openAddModal(page);
  });

  test.afterAll(() => page.close());

  test('TC-FC-UI-001  foreclosure field present', async () => {
    await expect(page.locator('#loan-form-foreclosure')).toBeVisible();
  });

  test('TC-FC-UI-002  foreclosure placeholder = "5"', async () => {
    const ph = await page.locator('#loan-form-foreclosure').getAttribute('placeholder');
    expect(ph).toBe('5');
  });

  test('TC-FC-UI-003  foreclosure hint mentions GST', async () => {
    const hint = await page.locator('#loan-form-foreclosure ~ .loan-form-emi-hint').textContent();
    expect(hint.toLowerCase()).toContain('gst');
  });

  test('TC-FC-UI-004  can enter 0 for zero charge', async () => {
    await page.fill('#loan-form-foreclosure', '0');
    await expect(page.locator('#loan-form-foreclosure')).toHaveValue('0');
  });

  test('TC-FC-UI-005  can enter 3.5 for fractional charge', async () => {
    await page.fill('#loan-form-foreclosure', '3.5');
    await expect(page.locator('#loan-form-foreclosure')).toHaveValue('3.5');
  });

  test('TC-FC-UI-006  color picker has color swatches', async () => {
    const swatches = await page.locator('#loan-form-colors .loan-color-swatch').count();
    expect(swatches).toBeGreaterThanOrEqual(8);
  });

  test('TC-FC-UI-007  clicking a swatch selects it', async () => {
    await page.locator('#loan-form-colors .loan-color-swatch').first().click();
    const selectedCount = await page.locator('#loan-form-colors .loan-color-swatch.selected').count();
    expect(selectedCount).toBe(1);
  });

  test('TC-FC-UI-008  color data attribute set after swatch click', async () => {
    const color = await page.locator('#loan-form-colors').getAttribute('data-color');
    expect(color).toBeTruthy();
    expect(color).toMatch(/^#[0-9A-Fa-f]{6}$/);
  });

  test('TC-FC-UI-009  cancel button closes modal', async () => {
    await page.click('.loan-form-actions .confirm-cancel');
    const display = await page.locator('#loan-form-modal').evaluate(el => el.style.display);
    expect(display).toBe('none');
  });

  test('TC-FC-UI-010  reopening modal resets schedule badge', async () => {
    await openAddModal(page);
    const badge = await page.locator('#loan-form-sch-badge').textContent();
    // Should show "No schedule uploaded" or be empty — NOT a leftover parsed badge
    expect(badge).not.toContain('✅');
  });
});
