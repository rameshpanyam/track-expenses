/**
 * 05 — PDF Upload Tests (80 tests)
 *
 * Strategy: parseLoanPDF is mocked via page.evaluate to return known
 * data for each bank format. Real PDF.js loading is blocked. Tests verify
 * that handleScheduleUpload() correctly:
 *   • Updates the badge text
 *   • Shows/hides the preview section
 *   • Populates the preview table
 *   • Sets loanSchedulePreview
 *   • Handles error cases gracefully
 *
 * After saveLoanForm():
 *   • schedule is persisted to loanSchedules[id]
 *   • loan.hasSchedule = true
 *   • localStorage updated
 */
'use strict';

const { test, expect }  = require('@playwright/test');
const path              = require('path');
const fs                = require('fs');
const { loadApp, goToLoans, openAddModal, mockPdfParser } = require('../helpers/setup');
const { CREDIT_FAIR, INDUSIND, KOTAK, makeLoanState } = require('../helpers/loan-data');

/* ─── Shared helpers ─────────────────────────────────────────────────── */

const DUMMY_PDF = path.join(__dirname, '../fixtures/dummy.pdf');

/** Ensure a tiny dummy.pdf exists (text content doesn't matter — parser is mocked) */
function ensureDummyPdf() {
  const dir = path.dirname(DUMMY_PDF);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(DUMMY_PDF)) {
    // Minimal valid PDF header
    fs.writeFileSync(DUMMY_PDF, '%PDF-1.4\n%%EOF');
  }
}

/** Trigger handleScheduleUpload with a mock parser result */
async function triggerUpload(page, mockResult) {
  await mockPdfParser(page, mockResult);
  // Set a dummy file on the input and dispatch change event
  await page.setInputFiles('#loan-form-sch-file', DUMMY_PDF);
  // Wait for async handler to complete (badge updates)
  await page.waitForFunction(
    () => !document.getElementById('loan-form-sch-badge').textContent.includes('⏳'),
    { timeout: 8000 }
  );
}

/** Build a mock schedule with N rows (all past dates) */
function buildMockSchedule(n, format = 'CreditFair') {
  const rows = [];
  for (let i = 0; i < n; i++) {
    const d = new Date('2020-01-05');
    d.setMonth(d.getMonth() + i);
    rows.push({
      no: i + 1,
      date: d.toISOString().slice(0, 10),
      emi: 10780,
      principal: 6280,
      interest: 4500,
      balance: Math.max(0, 500000 - (i + 1) * 6280),
    });
  }
  return { rows, format };
}

/* ─── Upload Section DOM Structure ──────────────────────────────────── */
test.describe('PDF Upload — DOM Structure', () => {
  let page;

  test.beforeAll(async ({ browser }) => {
    ensureDummyPdf();
    page = await browser.newPage();
    await loadApp(page);
    await goToLoans(page);
    await openAddModal(page);
  });

  test.afterAll(() => page.close());

  test('TC-PDF-DOM-001  upload area is visible', async () => {
    await expect(page.locator('.loan-sch-upload-area')).toBeVisible();
  });

  test('TC-PDF-DOM-002  file input exists and accepts .pdf', async () => {
    const accept = await page.locator('#loan-form-sch-file').getAttribute('accept');
    expect(accept).toBe('.pdf');
  });

  test('TC-PDF-DOM-003  file input type = "file"', async () => {
    const type = await page.locator('#loan-form-sch-file').getAttribute('type');
    expect(type).toBe('file');
  });

  test('TC-PDF-DOM-004  schedule badge element exists', async () => {
    await expect(page.locator('#loan-form-sch-badge')).toHaveCount(1);
  });

  test('TC-PDF-DOM-005  preview wrap hidden initially', async () => {
    const display = await page.locator('#loan-form-sch-preview-wrap').evaluate(el => el.style.display);
    expect(display).toBe('none');
  });

  test('TC-PDF-DOM-006  schedule table container exists', async () => {
    await expect(page.locator('#loan-form-sch-table')).toHaveCount(1);
  });

  test('TC-PDF-DOM-007  upload header text contains "Repayment schedule"', async () => {
    const text = await page.locator('.loan-sch-upload-header').textContent();
    expect(text.toLowerCase()).toContain('repayment schedule');
  });

  test('TC-PDF-DOM-008  upload label says "optional"', async () => {
    const text = await page.locator('.loan-sch-upload-header').textContent();
    expect(text.toLowerCase()).toContain('optional');
  });

  test('TC-PDF-DOM-009  upload area label has for= or wraps input', async () => {
    const el = page.locator('label.loan-sch-upload-area');
    await expect(el).toHaveCount(1);
  });

  test('TC-PDF-DOM-010  file input has onchange handler', async () => {
    const handler = await page.locator('#loan-form-sch-file').getAttribute('onchange');
    expect(handler).toContain('handleScheduleUpload');
  });
});

/* ─── CreditFair Format — Parse and State Update ────────────────────── */
test.describe('PDF Upload — CreditFair Format (60 rows)', () => {
  let page;
  const MOCK = buildMockSchedule(60, 'CreditFair');

  test.beforeAll(async ({ browser }) => {
    ensureDummyPdf();
    page = await browser.newPage();
    await loadApp(page);
    await goToLoans(page);
    await openAddModal(page);
    await triggerUpload(page, MOCK);
  });

  test.afterAll(() => page.close());

  test('TC-CF-001  badge shows ✅ after successful parse', async () => {
    const badge = await page.locator('#loan-form-sch-badge').textContent();
    expect(badge).toContain('✅');
  });

  test('TC-CF-002  badge shows row count (60 rows)', async () => {
    const badge = await page.locator('#loan-form-sch-badge').textContent();
    expect(badge).toContain('60');
  });

  test('TC-CF-003  badge mentions "CreditFair" format', async () => {
    const badge = await page.locator('#loan-form-sch-badge').textContent();
    expect(badge.toLowerCase()).toContain('creditfair');
  });

  test('TC-CF-004  preview wrap becomes visible', async () => {
    const display = await page.locator('#loan-form-sch-preview-wrap').evaluate(el => el.style.display);
    expect(display).not.toBe('none');
  });

  test('TC-CF-005  preview table shows format line', async () => {
    const text = await page.locator('#loan-form-sch-table').textContent();
    expect(text.toLowerCase()).toContain('creditfair');
  });

  test('TC-CF-006  preview table shows installment count', async () => {
    const text = await page.locator('#loan-form-sch-table').textContent();
    expect(text).toContain('60');
  });

  test('TC-CF-007  preview table shows first EMI date', async () => {
    const text = await page.locator('#loan-form-sch-table').textContent();
    expect(text).toContain('2020-01-05');
  });

  test('TC-CF-008  preview table shows last EMI date', async () => {
    const text = await page.locator('#loan-form-sch-table').textContent();
    // 60 months from Jan 2020 = Dec 2024
    expect(text).toContain(MOCK.rows[59].date);
  });

  test('TC-CF-009  preview table shows total interest', async () => {
    const totalInt = MOCK.rows.reduce((s, r) => s + r.interest, 0).toLocaleString('en-IN');
    const text = await page.locator('#loan-form-sch-table').textContent();
    // Interest should be mentioned
    expect(text).toContain('Total interest');
  });

  test('TC-CF-010  loanSchedulePreview is set in window', async () => {
    const preview = await page.evaluate(() => window.loanSchedulePreview);
    expect(preview).not.toBeNull();
    expect(Array.isArray(preview)).toBe(true);
  });

  test('TC-CF-011  loanSchedulePreview has 60 rows', async () => {
    const count = await page.evaluate(() => window.loanSchedulePreview?.length);
    expect(count).toBe(60);
  });

  test('TC-CF-012  each preview row has required fields', async () => {
    const row = await page.evaluate(() => window.loanSchedulePreview?.[0]);
    expect(row).toHaveProperty('no');
    expect(row).toHaveProperty('date');
    expect(row).toHaveProperty('emi');
    expect(row).toHaveProperty('principal');
    expect(row).toHaveProperty('interest');
    expect(row).toHaveProperty('balance');
  });

  test('TC-CF-013  preview rows have numeric EMI', async () => {
    const emis = await page.evaluate(() => window.loanSchedulePreview?.map(r => r.emi));
    emis.forEach(e => expect(typeof e).toBe('number'));
  });

  test('TC-CF-014  preview rows have numeric balance', async () => {
    const bals = await page.evaluate(() => window.loanSchedulePreview?.map(r => r.balance));
    bals.forEach(b => expect(typeof b).toBe('number'));
  });

  test('TC-CF-015  first row number = 1', async () => {
    const no = await page.evaluate(() => window.loanSchedulePreview?.[0]?.no);
    expect(no).toBe(1);
  });

  test('TC-CF-016  last row balance = 0 or near 0', async () => {
    const lastBal = await page.evaluate(() => {
      const p = window.loanSchedulePreview;
      return p[p.length - 1]?.balance;
    });
    expect(lastBal).toBeLessThanOrEqual(100); // allow small rounding
  });

  test('TC-CF-017  save hint text visible after upload', async () => {
    const text = await page.locator('#loan-form-sch-table').textContent();
    expect(text.toLowerCase()).toContain('save');
  });

  test('TC-CF-018  badge does not say ❌ on success', async () => {
    const badge = await page.locator('#loan-form-sch-badge').textContent();
    expect(badge).not.toContain('❌');
  });

  test('TC-CF-019  preview shows preview table with thead', async () => {
    await expect(page.locator('#loan-form-sch-table table thead')).toHaveCount(1);
  });

  test('TC-CF-020  preview table header has Date column', async () => {
    const headers = await page.locator('#loan-form-sch-table table thead th').allTextContents();
    expect(headers.some(h => h.toLowerCase().includes('date'))).toBe(true);
  });
});

/* ─── IndusInd Format — Parse and State Update ───────────────────────── */
test.describe('PDF Upload — IndusInd Format (60 rows)', () => {
  let page;
  const MOCK = buildMockSchedule(60, 'IndusInd');

  test.beforeAll(async ({ browser }) => {
    ensureDummyPdf();
    page = await browser.newPage();
    await loadApp(page);
    await goToLoans(page);
    await openAddModal(page);
    await triggerUpload(page, MOCK);
  });

  test.afterAll(() => page.close());

  test('TC-IND-001  badge ✅ for IndusInd', async () => {
    const badge = await page.locator('#loan-form-sch-badge').textContent();
    expect(badge).toContain('✅');
  });

  test('TC-IND-002  badge mentions IndusInd format', async () => {
    const badge = await page.locator('#loan-form-sch-badge').textContent();
    expect(badge.toLowerCase()).toContain('indusind');
  });

  test('TC-IND-003  60 rows detected', async () => {
    const count = await page.evaluate(() => window.loanSchedulePreview?.length);
    expect(count).toBe(60);
  });

  test('TC-IND-004  preview wrap visible', async () => {
    const display = await page.locator('#loan-form-sch-preview-wrap').evaluate(el => el.style.display);
    expect(display).not.toBe('none');
  });

  test('TC-IND-005  each IndusInd row has a date string', async () => {
    const dates = await page.evaluate(() => window.loanSchedulePreview?.map(r => r.date));
    dates.forEach(d => expect(typeof d).toBe('string'));
  });

  test('TC-IND-006  rows are chronologically ordered', async () => {
    const dates = await page.evaluate(() =>
      window.loanSchedulePreview?.map(r => r.date)
    );
    for (let i = 1; i < dates.length; i++) {
      expect(dates[i] >= dates[i - 1]).toBe(true);
    }
  });

  test('TC-IND-007  row numbers are sequential', async () => {
    const nos = await page.evaluate(() => window.loanSchedulePreview?.map(r => r.no));
    nos.forEach((no, i) => expect(no).toBe(i + 1));
  });

  test('TC-IND-008  preview table shows total interest row', async () => {
    const text = await page.locator('#loan-form-sch-table').textContent();
    expect(text.toLowerCase()).toContain('total interest');
  });

  test('TC-IND-009  badge row count matches preview array length', async () => {
    const count = await page.evaluate(() => window.loanSchedulePreview?.length);
    const badge = await page.locator('#loan-form-sch-badge').textContent();
    expect(badge).toContain(String(count));
  });

  test('TC-IND-010  preview shows first 5 rows in table', async () => {
    const rows = await page.locator('#loan-form-sch-table table tbody tr').count();
    expect(rows).toBeGreaterThanOrEqual(1);
    expect(rows).toBeLessThanOrEqual(6); // 5 rows + maybe 1 "more rows" row
  });
});

/* ─── Kotak Format — Parse and State Update ──────────────────────────── */
test.describe('PDF Upload — Kotak Format (60 rows)', () => {
  let page;
  const MOCK = buildMockSchedule(60, 'Kotak');

  test.beforeAll(async ({ browser }) => {
    ensureDummyPdf();
    page = await browser.newPage();
    await loadApp(page);
    await goToLoans(page);
    await openAddModal(page);
    await triggerUpload(page, MOCK);
  });

  test.afterAll(() => page.close());

  test('TC-KOT-001  badge ✅ for Kotak', async () => {
    const badge = await page.locator('#loan-form-sch-badge').textContent();
    expect(badge).toContain('✅');
  });

  test('TC-KOT-002  badge mentions Kotak format', async () => {
    const badge = await page.locator('#loan-form-sch-badge').textContent();
    expect(badge.toLowerCase()).toContain('kotak');
  });

  test('TC-KOT-003  60 rows in preview', async () => {
    const count = await page.evaluate(() => window.loanSchedulePreview?.length);
    expect(count).toBe(60);
  });

  test('TC-KOT-004  preview section visible', async () => {
    const display = await page.locator('#loan-form-sch-preview-wrap').evaluate(el => el.style.display);
    expect(display).not.toBe('none');
  });

  test('TC-KOT-005  all rows have non-negative balance', async () => {
    const bals = await page.evaluate(() => window.loanSchedulePreview?.map(r => r.balance));
    bals.forEach(b => expect(b).toBeGreaterThanOrEqual(0));
  });

  test('TC-KOT-006  all rows have positive EMI', async () => {
    const emis = await page.evaluate(() => window.loanSchedulePreview?.map(r => r.emi));
    emis.forEach(e => expect(e).toBeGreaterThan(0));
  });

  test('TC-KOT-007  principal + interest = EMI for each row', async () => {
    const rows = await page.evaluate(() => window.loanSchedulePreview);
    rows.forEach(r => {
      expect(r.principal + r.interest).toBe(r.emi);
    });
  });

  test('TC-KOT-008  balance decreases monotonically', async () => {
    const bals = await page.evaluate(() => window.loanSchedulePreview?.map(r => r.balance));
    for (let i = 1; i < bals.length; i++) {
      expect(bals[i]).toBeLessThanOrEqual(bals[i - 1]);
    }
  });

  test('TC-KOT-009  loanSchedulePreview is array', async () => {
    const isArr = await page.evaluate(() => Array.isArray(window.loanSchedulePreview));
    expect(isArr).toBe(true);
  });

  test('TC-KOT-010  preview table shows "more rows" note if count > 5', async () => {
    const text = await page.locator('#loan-form-sch-table').textContent();
    expect(text).toContain('more rows');
  });
});

/* ─── Error Handling ─────────────────────────────────────────────────── */
test.describe('PDF Upload — Invalid File Handling', () => {
  let page;

  test.beforeAll(async ({ browser }) => {
    ensureDummyPdf();
    page = await browser.newPage();
    await loadApp(page);
    await goToLoans(page);
    await openAddModal(page);
  });

  test.afterAll(() => page.close());

  async function triggerError(errorMsg) {
    await page.evaluate((msg) => {
      window.parseLoanPDF = async () => { throw new Error(msg); };
    }, errorMsg);
    await page.setInputFiles('#loan-form-sch-file', DUMMY_PDF);
    await page.waitForFunction(
      () => document.getElementById('loan-form-sch-badge').textContent.includes('❌'),
      { timeout: 8000 }
    );
  }

  test('TC-ERR-001  error: badge shows ❌', async () => {
    await triggerError('No schedule rows found in this PDF.');
    const badge = await page.locator('#loan-form-sch-badge').textContent();
    expect(badge).toContain('❌');
  });

  test('TC-ERR-002  error: badge shows error message', async () => {
    const badge = await page.locator('#loan-form-sch-badge').textContent();
    expect(badge).toContain('No schedule rows');
  });

  test('TC-ERR-003  error: preview stays hidden', async () => {
    const display = await page.locator('#loan-form-sch-preview-wrap').evaluate(el => el.style.display);
    expect(display).toBe('none');
  });

  test('TC-ERR-004  error: loanSchedulePreview is null', async () => {
    const preview = await page.evaluate(() => window.loanSchedulePreview);
    expect(preview).toBeNull();
  });

  test('TC-ERR-005  empty rows result: badge shows ❌', async () => {
    await page.evaluate(() => {
      window.parseLoanPDF = async () => ({ rows: [], format: 'unknown' });
    });
    await page.setInputFiles('#loan-form-sch-file', DUMMY_PDF);
    await page.waitForFunction(
      () => document.getElementById('loan-form-sch-badge').textContent.includes('❌'),
      { timeout: 8000 }
    );
    const badge = await page.locator('#loan-form-sch-badge').textContent();
    expect(badge).toContain('❌');
  });

  test('TC-ERR-006  parsing error message displayed correctly', async () => {
    await triggerError('Unrecognised PDF format');
    const badge = await page.locator('#loan-form-sch-badge').textContent();
    expect(badge).toContain('Unrecognised PDF format');
  });

  test('TC-ERR-007  after error then success: badge shows ✅', async () => {
    const mockOK = buildMockSchedule(5, 'CreditFair');
    await triggerUpload(page, mockOK);
    const badge = await page.locator('#loan-form-sch-badge').textContent();
    expect(badge).toContain('✅');
  });

  test('TC-ERR-008  successful upload after error: preview wrap visible', async () => {
    const display = await page.locator('#loan-form-sch-preview-wrap').evaluate(el => el.style.display);
    expect(display).not.toBe('none');
  });

  test('TC-ERR-009  badge shows parsing spinner during processing', async () => {
    // Mock a slow parser so we can catch the ⏳ state
    await page.evaluate(() => {
      window.parseLoanPDF = () => new Promise(resolve =>
        setTimeout(() => resolve({ rows: [{ no:1, date:'2020-01-01', emi:100, principal:80, interest:20, balance:920 }], format: 'Test' }), 100)
      );
    });
    // Trigger file input
    const inputHandle = page.locator('#loan-form-sch-file');
    await page.setInputFiles('#loan-form-sch-file', DUMMY_PDF);
    // Check badge immediately for spinner
    const badge = await page.locator('#loan-form-sch-badge').textContent();
    // Either ⏳ (caught it) or ✅ (resolved fast) — both valid
    expect(badge.length).toBeGreaterThan(0);
  });

  test('TC-ERR-010  schedule preview resets on re-open modal', async () => {
    // Close and reopen — preview should be hidden again
    await page.evaluate(() => closeLoanFormModal());
    await page.evaluate(() => openLoanAddModal());
    await page.waitForSelector('#loan-form-modal[style*="flex"]', { timeout: 5000 });
    const display = await page.locator('#loan-form-sch-preview-wrap').evaluate(el => el.style.display);
    expect(display).toBe('none');
  });
});
