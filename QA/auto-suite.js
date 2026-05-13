/* ═══════════════════════════════════════════════════════════════════════════
   auto-suite.js — Headless executor for ALL automatable test cases
   ───────────────────────────────────────────────────────────────────────────
   Mirrors the pure-logic functions from app.js so that any regression in
   classifier / date math / range filter / formatter / category match /
   amount parse fails this suite.

   Run:  node QA/auto-suite.js
   Output: PASS/FAIL summary + JSON file QA/auto-results.json
   ═══════════════════════════════════════════════════════════════════════════ */
const assert = require('assert');
const fs     = require('fs');
const path   = require('path');

/* ── Fixed clock so every test is deterministic ───────────────────────────── */
const FAKE_NOW = new Date(2026, 4, 13);    // Wed, 13 May 2026
const _DateOrig = Date;
global.Date = class extends _DateOrig {
  constructor(...args) { return args.length ? new _DateOrig(...args) : new _DateOrig(FAKE_NOW); }
  static now() { return FAKE_NOW.getTime(); }
};

/* ═══════════════════════════════════════════════════════════════════════════
   MIRRORED SOURCE FUNCTIONS  (copy from app.js — keep in sync)
   ═══════════════════════════════════════════════════════════════════════════ */
const CATEGORIES = [
  { key:'food', label:'Food', color:'#FF6B6B' },
  { key:'grocery', label:'Grocery', color:'#26C6DA' },
  { key:'market', label:'Market', color:'#66BB6A' },
  { key:'medicine', label:'Medicine', color:'#AB47BC' },
  { key:'petrol', label:'Petrol', color:'#FFA726' },
  { key:'recharge', label:'Recharge', color:'#7C5CFC' },
  { key:'water', label:'Water', color:'#42A5F5' },
  { key:'gifts', label:'Gifts', color:'#EC407A' },
  { key:'other', label:'Other', color:'#78909C' },
];
let customCategories = [];
const allCategories = () => [...CATEGORIES, ...customCategories];

const VOICE_KEYWORDS = {
  food: ['food','lunch','dinner','breakfast','meal','eat','eating','restaurant','hotel','biryani','swiggy','zomato','snack','snacks','chai','tea','coffee','tiffin'],
  grocery: ['grocery','groceries','supermarket','kirana','big bazaar','dmart','reliance','zepto','blinkit','instamart'],
  market: ['market','vegetable','vegetables','fruit','fruits','sabzi','mandi'],
  medicine: ['medicine','medicines','medical','pharmacy','pharmacist','doctor','hospital','tablet','tablets','capsule','drug','health','apollo'],
  petrol: ['petrol','fuel','diesel','gas','pump','filling'],
  recharge: ['recharge','mobile','phone','internet','data','sim','jio','airtel','vi','bsnl','broadband','wifi'],
  water: ['water','aqua','bisleri','mineral'],
  gifts: ['gift','gifts','present','birthday','anniversary','wedding'],
  other: ['other','misc','miscellaneous'],
};
const MONTH_MAP = {
  january:1, jan:1, february:2, feb:2, march:3, mar:3,
  april:4, apr:4, may:5, june:6, jun:6, july:7, jul:7,
  august:8, aug:8, september:9, sep:9, october:10, oct:10,
  november:11, nov:11, december:12, dec:12,
};
const MONTHS = ['january','february','march','april','may','june','july','august','september','october','november','december'];

function todayStr() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
function dateToStr(d) { return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
function strToDate(s) { const [y,m,d]=s.split('-').map(Number); return new Date(y,m-1,d); }
function addDays(d,n) { const r=new Date(d); r.setDate(r.getDate()+n); return r; }
function startOfWeek(d) { const day=d.getDay(); const diff=day===0?-6:1-day; return addDays(d,diff); }
function ymd(d) { return dateToStr(d); }

function rangeForPreset(p, now=new Date()) {
  const today = dateToStr(now);
  if (p==='today') return {from:today,to:today};
  if (p==='yesterday') { const y=dateToStr(addDays(now,-1)); return {from:y,to:y}; }
  if (p==='this-week') return {from:dateToStr(startOfWeek(now)),to:today};
  if (p==='last-7') return {from:dateToStr(addDays(now,-6)),to:today};
  return null;
}
function expensesInRange(all, from, to) {
  return all.filter(e => e.date && e.date >= from && e.date <= to);
}

function parseSpokenAmount(text) {
  const t = text.toLowerCase().replace(/[,₹]/g,'').trim();
  let m = t.match(/(\d+(?:\.\d+)?)\s*(?:lakh|lakhs|lac|lacs)/);
  if (m) return Math.round(parseFloat(m[1]) * 100000);
  m = t.match(/(\d+(?:\.\d+)?)\s*(?:crore|crores|cr)\b/);
  if (m) return Math.round(parseFloat(m[1]) * 10000000);
  m = t.match(/(\d+(?:\.\d+)?)\s*k\b/);
  if (m) return Math.round(parseFloat(m[1]) * 1000);
  const WORD_NUMS = {one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,
    ten:10,eleven:11,twelve:12,thirteen:13,fourteen:14,fifteen:15,sixteen:16,
    seventeen:17,eighteen:18,nineteen:19,twenty:20,thirty:30,forty:40,fifty:50,
    sixty:60,seventy:70,eighty:80,ninety:90,hundred:100};
  m = t.match(/((?:[a-z]+\s+){0,3}[a-z]+)\s+(thousand|hundred)/);
  if (m) {
    const words = m[1].split(/\s+/);
    let n=0;
    for (const w of words) {
      if (WORD_NUMS[w]!=null) n = (w==='hundred')? n*100 : n+WORD_NUMS[w];
      else { n=NaN; break; }
    }
    if (!isNaN(n)&&n>0) return m[2]==='thousand'? n*1000 : n*100;
  }
  const nums = (t.match(/\b\d+(?:\.\d+)?\b/g) || []).map(parseFloat);
  if (nums.length) return Math.round(Math.max(...nums));
  return null;
}

function hasAmountWithCategory(t) {
  const amt = parseSpokenAmount(t);
  if (!amt || amt > 1000000) return false;
  for (const c of allCategories()) {
    if (new RegExp(`\\b${c.label.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}\\b`,'i').test(t)) return true;
  }
  for (const kws of Object.values(VOICE_KEYWORDS)) {
    for (const kw of kws) if (new RegExp(`\\b${kw}\\b`,'i').test(t)) return true;
  }
  return false;
}

function matchCategory(t, range) {
  for (const c of allCategories()) {
    const label = c.label.toLowerCase();
    const re = new RegExp(`\\b${label.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}\\b`,'i');
    if (re.test(t)) return { ...range, category: c.key };
  }
  for (const [cat,kws] of Object.entries(VOICE_KEYWORDS)) {
    for (const kw of kws) {
      const re = new RegExp(`\\b${kw}\\b`,'i');
      if (re.test(t)) return { ...range, category: cat };
    }
  }
  return range;
}

function parseSpokenDate(phrase) {
  if (!phrase) return null;
  const s = phrase.toLowerCase().trim();
  let m = s.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]+)(?:\s+(\d{4}))?/);
  if (m) {
    const day=parseInt(m[1]);
    const monIdx = MONTHS.findIndex(mn => mn.startsWith(m[2].slice(0,3)));
    if (monIdx>=0 && day>=1 && day<=31) {
      const year = m[3]? parseInt(m[3]) : new Date().getFullYear();
      return `${year}-${String(monIdx+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
    }
  }
  m = s.match(/\b([a-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?(?:\s+(\d{4}))?/);
  if (m) {
    const monIdx = MONTHS.findIndex(mn => mn.startsWith(m[1].slice(0,3)));
    const day = parseInt(m[2]);
    if (monIdx>=0 && day>=1 && day<=31) {
      const year = m[3]? parseInt(m[3]) : new Date().getFullYear();
      return `${year}-${String(monIdx+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
    }
  }
  return null;
}

function extractDateQueryRange(t) {
  const isQuestion = /\b(?:how\s+much|how\s+many|what\s+did\s+i|what(?:'s| is|\s+is)\s+(?:my|the)\s+(?:total|spend|spending|expenses?)|show(?:\s+me)?|tell\s+me|total\s+(?:for|of|spent|in|on)|expenses?\s+(?:for|of|on|in))\b/.test(t);
  const now = new Date();
  const today = dateToStr(now);
  const looksLikeAdd = !isQuestion && hasAmountWithCategory(t);
  if (/\btoday\b/.test(t) && isQuestion && !looksLikeAdd)
    return matchCategory(t, {from:today,to:today,presetName:'today'});
  if (/\byesterday\b/.test(t) && isQuestion && !looksLikeAdd) {
    const y = dateToStr(addDays(now,-1));
    return matchCategory(t, {from:y,to:y,presetName:'yesterday'});
  }
  if (/\b(?:this\s+week|current\s+week)\b/.test(t))
    return matchCategory(t, {from:dateToStr(startOfWeek(now)),to:today,presetName:'this-week'});
  if (/\blast\s+(?:7|seven)\s+days\b/.test(t))
    return matchCategory(t, {from:dateToStr(addDays(now,-6)),to:today,presetName:'last-7'});
  if (/\blast\s+week\b/.test(t)) {
    const s=addDays(startOfWeek(now),-7), e=addDays(startOfWeek(now),-1);
    return matchCategory(t, {from:dateToStr(s),to:dateToStr(e),presetName:'custom'});
  }
  if (/\blast\s+(?:30|thirty)\s+days\b/.test(t))
    return matchCategory(t, {from:dateToStr(addDays(now,-29)),to:today,presetName:'custom'});
  const fromTo = t.match(/\bfrom\s+(.+?)\s+(?:to|till|until)\s+(.+)$/);
  if (fromTo) {
    const f = parseSpokenDate(fromTo[1]);
    const tt= parseSpokenDate(fromTo[2]);
    if (f && tt) return matchCategory(t, {from:f,to:tt,presetName:'custom'});
  }
  if (isQuestion && !looksLikeAdd) {
    const single = parseSpokenDate(t);
    if (single) return matchCategory(t, {from:single,to:single,presetName:'custom'});
  }
  return null;
}

function classifyVoiceIntent(transcript) {
  const t = transcript.toLowerCase().trim();
  const setPatterns = [
    /\b(?:set|make|update|change)\s+(?:my\s+)?(?:monthly\s+)?budget(?:\s+(?:to|as|of|at))?\s+(.+)$/,
    /\b(?:my\s+)?(?:monthly\s+)?budget\s+(?:is|to|=)\s+(.+)$/,
    /\bthis\s+month(?:'s)?\s+budget\s+(?:is\s+)?(.+)$/,
    /\bbudget\s+(?:to\s+)?(\d[\d.\s]*(?:k|lakh|lac|crore|cr|thousand|hundred)?.*)$/,
  ];
  for (const re of setPatterns) {
    const m = t.match(re);
    if (m && m[1]) { const amt = parseSpokenAmount(m[1]); if (amt && amt>0) return {type:'budget-set',amount:amt}; }
  }
  const budgetTriggers = [
    /\bbudget\s+(?:left|remaining|remain)\b/,
    /\bhow\s+much\s+budget\s+(?:is\s+)?(?:left|remaining|remain)\b/,
    /\bwhat(?:'s| is)\s+my\s+budget\b/,
    /\bdid\s+i\s+(?:overspend|over\s*spend|go\s+over)\b/,
    /\bam\s+i\s+(?:over|under)\s+budget\b/,
    /\bgood\s+month\s+or\s+bad\s+month\b/,
    /\bhow\s+is\s+(?:my\s+)?budget\s+doing\b/,
    /\b(?:show|tell)\s+me\s+(?:my\s+)?(?:budget|verdict)\b/,
  ];
  if (budgetTriggers.some(re => re.test(t))) return {type:'budget-query',query:t};
  const dq = extractDateQueryRange(t);
  if (dq) return {type:'date-query',query:t,...dq};
  return {type:'none'};
}

function extractDateFromVoice(lower) {
  const now = new Date();
  const monthNames = 'january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|oct|nov|dec';
  const stripParts = [];
  let explicitYear = null;
  const yearCtxPatterns = [/\b(\d{4})\s+year\b/, /\byear\s+(\d{4})\b/, /\bin\s+(\d{4})\b/, /\bof\s+(\d{4})\b/];
  for (const p of yearCtxPatterns) {
    const ym = lower.match(p);
    if (ym) { const y=parseInt(ym[1]); if (y>=1900 && y<=2099) { explicitYear=y; stripParts.push(ym[0]); break; } }
  }
  let work = stripParts.length ? lower.replace(stripParts[0],' ').replace(/\s+/g,' ').trim() : lower;
  function bundle(date, dateText) {
    stripParts.push(dateText);
    let stripped = lower;
    for (const part of stripParts) stripped = stripped.replace(part,' ');
    return { date, stripped: stripped.replace(/\s+/g,' ').trim() };
  }
  let m = work.match(/\bday\s+before\s+yesterday\b/);
  if (m) { const d=new Date(); d.setDate(d.getDate()-2); return bundle(ymd(d), m[0]); }
  m = work.match(/\byesterday\b/);
  if (m) { const d=new Date(); d.setDate(d.getDate()-1); return bundle(ymd(d), m[0]); }
  m = work.match(/\btoday\b/);
  if (m) return bundle(todayStr(), m[0]);
  /* this/last/next month — only if no explicit year */
  if (!explicitYear) {
    let mm = work.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?this\s+month\b/);
    if (!mm) mm = work.match(/\bthis\s+month\s+(?:on\s+)?(\d{1,2})(?:st|nd|rd|th)?\b/);
    if (mm) { const day=parseInt(mm[1]); if (day>=1&&day<=31) return bundle(ymd(new Date(now.getFullYear(),now.getMonth(),day)),mm[0]); }
    mm = work.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?last\s+month\b/);
    if (!mm) mm = work.match(/\blast\s+month\s+(?:on\s+)?(\d{1,2})(?:st|nd|rd|th)?\b/);
    if (mm) { const day=parseInt(mm[1]); if (day>=1&&day<=31) return bundle(ymd(new Date(now.getFullYear(),now.getMonth()-1,day)),mm[0]); }
    mm = work.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?next\s+month\b/);
    if (!mm) mm = work.match(/\bnext\s+month\s+(?:on\s+)?(\d{1,2})(?:st|nd|rd|th)?\b/);
    if (mm) { const day=parseInt(mm[1]); if (day>=1&&day<=31) return bundle(ymd(new Date(now.getFullYear(),now.getMonth()+1,day)),mm[0]); }
  }
  let dm = work.match(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?(${monthNames})(?:[,\\s]+(\\d{4}))?\\b`,'i'));
  if (!dm) dm = work.match(new RegExp(`\\b(${monthNames})\\s+(?:the\\s+)?(\\d{1,2})(?:st|nd|rd|th)?(?:[,\\s]+(\\d{4}))?\\b`,'i'));
  if (dm) {
    let day, monthStr, inlineYear;
    if (/^\d/.test(dm[1])) { day=parseInt(dm[1]); monthStr=dm[2]; inlineYear=dm[3]; }
    else { monthStr=dm[1]; day=parseInt(dm[2]); inlineYear=dm[3]; }
    const month = MONTH_MAP[monthStr.toLowerCase()];
    if (month && day>=1 && day<=31) {
      let year;
      if (explicitYear) year=explicitYear;
      else if (inlineYear) { const yi=parseInt(inlineYear); year = (yi>=1900&&yi<=2099)? yi : now.getFullYear(); }
      else { year = now.getFullYear(); if (new Date(year, month-1, day) > now) year -= 1; }
      return bundle(ymd(new Date(year, month-1, day)), dm[0]);
    }
  }
  return null;
}

function parseVoiceCommand(text) {
  const lower = text.toLowerCase().trim();
  const dateRes = extractDateFromVoice(lower);
  const date = dateRes? dateRes.date : todayStr();
  let cleaned = dateRes? dateRes.stripped : lower;
  let note = '';
  const noteMatchers = [
    /\b(?:and\s+)?note(?:\s+is|:)?\s+(.+)$/i,
    /\bfor\s+(.+)$/i,
    /\s[—–-]\s+(.+)$/
  ];
  for (const re of noteMatchers) {
    const m = cleaned.match(re);
    if (m && m[1] && m[1].trim().length) {
      note = m[1].trim().replace(/[.,!?]+$/,'');
      cleaned = cleaned.slice(0, m.index).trim();
      break;
    }
  }
  const amountMatch = cleaned.match(/\b(\d+(?:\.\d+)?)\b/);
  const amount = amountMatch? parseFloat(amountMatch[1]) : null;
  const candidates = [];
  for (const c of customCategories) candidates.push({key:c.key, term:c.label.toLowerCase()});
  for (const [cat,kws] of Object.entries(VOICE_KEYWORDS)) for (const kw of kws) candidates.push({key:cat,term:kw});
  candidates.sort((a,b)=>b.term.length-a.term.length);
  let category = null;
  for (const c of candidates) {
    const re = new RegExp(`\\b${c.term.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}\\b`,'i');
    if (re.test(cleaned)) { category=c.key; break; }
  }
  if (note && !category) {
    for (const c of candidates) {
      const re = new RegExp(`\\b${c.term.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}\\b`,'i');
      if (re.test(note)) { category=c.key; note=note.replace(re,'').replace(/\s{2,}/g,' ').trim(); break; }
    }
  }
  return { amount, category, date, note };
}

function fmt(amount) { return '₹' + Number(amount).toLocaleString('en-IN', {maximumFractionDigits:0}); }
function fmtDate(s) { if (!s) return ''; const [,m,d]=s.split('-'); return `${parseInt(d)} ${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][parseInt(m)-1]}`; }
function fmtFullDate(s, withYear=true) {
  if (!s) return ''; const [y,m,d]=s.split('-');
  const mn=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][parseInt(m)-1];
  return withYear? `${parseInt(d)} ${mn} ${y}` : `${parseInt(d)} ${mn}`;
}
function escapeHTML(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
function computeSpentForMonth(all, year, month) {
  return all.reduce((sum,e)=>{ if(!e.date) return sum; const [y,m]=e.date.split('-').map(Number); return (y===year&&m===month)? sum+e.amount : sum; },0);
}
function deriveVerdict(year,month,budget,spent) {
  if (!budget || budget<=0) return {status:'no-budget',spillover:0};
  const spillover = Math.max(0, spent-budget);
  return { status: spillover>0? 'bad':'good', spillover };
}

/* ═══════════════════════════════════════════════════════════════════════════
   TEST FRAMEWORK
   ═══════════════════════════════════════════════════════════════════════════ */
const results = [];
let passCount = 0, failCount = 0;

function T(id, title, fn) {
  try {
    fn();
    results.push({ id, title, status:'PASS', error:null });
    passCount++;
  } catch (e) {
    results.push({ id, title, status:'FAIL', error:e.message });
    failCount++;
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   TEST CATALOGUE
   ═══════════════════════════════════════════════════════════════════════════ */

/* ── A. DATE HELPERS (TC-A-001 to TC-A-020) ──────────────────────────────── */
T('TC-A-001','dateToStr formats Date → yyyy-mm-dd', () => assert.strictEqual(dateToStr(new Date(2026,4,13)),'2026-05-13'));
T('TC-A-002','dateToStr zero-pads month & day', () => assert.strictEqual(dateToStr(new Date(2026,0,5)),'2026-01-05'));
T('TC-A-003','dateToStr handles Dec 31', () => assert.strictEqual(dateToStr(new Date(2026,11,31)),'2026-12-31'));
T('TC-A-004','strToDate parses yyyy-mm-dd → Date', () => { const d=strToDate('2026-05-13'); assert.strictEqual(d.getFullYear(),2026); assert.strictEqual(d.getMonth(),4); assert.strictEqual(d.getDate(),13); });
T('TC-A-005','strToDate round-trips dateToStr', () => assert.strictEqual(dateToStr(strToDate('2025-02-28')),'2025-02-28'));
T('TC-A-006','addDays +1 from May 13', () => assert.strictEqual(dateToStr(addDays(new Date(2026,4,13),1)),'2026-05-14'));
T('TC-A-007','addDays -1 from May 1 crosses month', () => assert.strictEqual(dateToStr(addDays(new Date(2026,4,1),-1)),'2026-04-30'));
T('TC-A-008','addDays -1 from Jan 1 crosses year', () => assert.strictEqual(dateToStr(addDays(new Date(2026,0,1),-1)),'2025-12-31'));
T('TC-A-009','addDays +365 from Jan 1', () => assert.strictEqual(dateToStr(addDays(new Date(2026,0,1),365)),'2027-01-01'));
T('TC-A-010','addDays handles leap year Feb', () => assert.strictEqual(dateToStr(addDays(new Date(2024,1,28),1)),'2024-02-29'));
T('TC-A-011','startOfWeek on Wed gives Mon', () => assert.strictEqual(dateToStr(startOfWeek(new Date(2026,4,13))),'2026-05-11'));
T('TC-A-012','startOfWeek on Mon = same Mon', () => assert.strictEqual(dateToStr(startOfWeek(new Date(2026,4,11))),'2026-05-11'));
T('TC-A-013','startOfWeek on Sun shifts back 6 days', () => assert.strictEqual(dateToStr(startOfWeek(new Date(2026,4,17))),'2026-05-11'));
T('TC-A-014','startOfWeek on Sat = Mon of same week', () => assert.strictEqual(dateToStr(startOfWeek(new Date(2026,4,16))),'2026-05-11'));
T('TC-A-015','todayStr returns frozen today', () => assert.strictEqual(todayStr(),'2026-05-13'));
T('TC-A-016','ymd same as dateToStr', () => assert.strictEqual(ymd(new Date(2026,4,13)),'2026-05-13'));
T('TC-A-017','fmtDate strips year', () => assert.strictEqual(fmtDate('2026-05-13'),'13 May'));
T('TC-A-018','fmtDate handles single-digit day', () => assert.strictEqual(fmtDate('2026-05-05'),'5 May'));
T('TC-A-019','fmtFullDate with year', () => assert.strictEqual(fmtFullDate('2026-05-13'),'13 May 2026'));
T('TC-A-020','fmtFullDate without year', () => assert.strictEqual(fmtFullDate('2026-05-13',false),'13 May'));

/* ── B. RANGE PRESETS (TC-B-001 to TC-B-012) ─────────────────────────────── */
T('TC-B-001','today preset = [today, today]', () => assert.deepStrictEqual(rangeForPreset('today'),{from:'2026-05-13',to:'2026-05-13'}));
T('TC-B-002','yesterday preset = [yesterday, yesterday]', () => assert.deepStrictEqual(rangeForPreset('yesterday'),{from:'2026-05-12',to:'2026-05-12'}));
T('TC-B-003','this-week preset = [Mon, today]', () => assert.deepStrictEqual(rangeForPreset('this-week'),{from:'2026-05-11',to:'2026-05-13'}));
T('TC-B-004','last-7 preset = [today-6, today]', () => assert.deepStrictEqual(rangeForPreset('last-7'),{from:'2026-05-07',to:'2026-05-13'}));
T('TC-B-005','unknown preset returns null', () => assert.strictEqual(rangeForPreset('garbage'),null));
T('TC-B-006','this-week on Monday = [Mon, Mon]', () => {const r=rangeForPreset('this-week',new Date(2026,4,11)); assert.strictEqual(r.from,'2026-05-11'); assert.strictEqual(r.to,'2026-05-11');});
T('TC-B-007','this-week on Sunday = previous Mon → Sun', () => {const r=rangeForPreset('this-week',new Date(2026,4,17)); assert.strictEqual(r.from,'2026-05-11');});
T('TC-B-008','last-7 always spans 7 days', () => {const r=rangeForPreset('last-7'); const days=(strToDate(r.to)-strToDate(r.from))/86400000+1; assert.strictEqual(days,7);});
T('TC-B-009','today preset has from===to', () => {const r=rangeForPreset('today'); assert.strictEqual(r.from,r.to);});
T('TC-B-010','yesterday preset has from===to', () => {const r=rangeForPreset('yesterday'); assert.strictEqual(r.from,r.to);});
T('TC-B-011','yesterday is exactly 1 day before today', () => {const r=rangeForPreset('yesterday'); const today=new Date(2026,4,13); const yd=strToDate(r.from); assert.strictEqual((today-yd)/86400000,1);});
T('TC-B-012','rangeForPreset is deterministic with frozen clock', () => assert.deepStrictEqual(rangeForPreset('today'),rangeForPreset('today')));

/* ── C. RANGE FILTER (TC-C-001 to TC-C-015) ──────────────────────────────── */
const EXP_SAMPLE = [
  { date:'2026-05-13', category:'food', amount:200 },
  { date:'2026-05-13', category:'petrol', amount:1000 },
  { date:'2026-05-12', category:'food', amount:300 },
  { date:'2026-05-11', category:'grocery', amount:1500 },
  { date:'2026-05-07', category:'food', amount:150 },
  { date:'2026-05-06', category:'gifts', amount:500 },
  { date:'2026-04-30', category:'food', amount:100 },
  { date:'',          category:'food', amount:100 },
];
T('TC-C-001','filter today returns 2 rows', () => assert.strictEqual(expensesInRange(EXP_SAMPLE,'2026-05-13','2026-05-13').length,2));
T('TC-C-002','filter yesterday returns 1 row', () => assert.strictEqual(expensesInRange(EXP_SAMPLE,'2026-05-12','2026-05-12').length,1));
T('TC-C-003','filter this-week returns 4 rows', () => assert.strictEqual(expensesInRange(EXP_SAMPLE,'2026-05-11','2026-05-13').length,4));
T('TC-C-004','filter last-7 returns 5 rows', () => assert.strictEqual(expensesInRange(EXP_SAMPLE,'2026-05-07','2026-05-13').length,5));
T('TC-C-005','filter cross-month range', () => assert.strictEqual(expensesInRange(EXP_SAMPLE,'2026-04-30','2026-05-13').length,7));
T('TC-C-006','filter empty range = no entries', () => assert.strictEqual(expensesInRange(EXP_SAMPLE,'2026-06-01','2026-06-30').length,0));
T('TC-C-007','filter excludes empty-date rows', () => { const r=expensesInRange(EXP_SAMPLE,'2026-01-01','2026-12-31'); assert.strictEqual(r.length,7); assert.ok(r.every(e => e.date)); });
T('TC-C-008','filter inclusive boundaries', () => assert.strictEqual(expensesInRange(EXP_SAMPLE,'2026-05-07','2026-05-07').length,1));
T('TC-C-009','filter single date with no match', () => assert.strictEqual(expensesInRange(EXP_SAMPLE,'2026-05-09','2026-05-09').length,0));
T('TC-C-010','filter same from/to inclusive', () => assert.strictEqual(expensesInRange(EXP_SAMPLE,'2026-05-13','2026-05-13').length,2));
T('TC-C-011','filter from>to gives 0 rows (safety)', () => assert.strictEqual(expensesInRange(EXP_SAMPLE,'2026-05-13','2026-05-01').length,0));
T('TC-C-012','filter today sums to 1200', () => {const r=expensesInRange(EXP_SAMPLE,'2026-05-13','2026-05-13'); assert.strictEqual(r.reduce((s,e)=>s+e.amount,0),1200);});
T('TC-C-013','filter this-week sums to 3000', () => {const r=expensesInRange(EXP_SAMPLE,'2026-05-11','2026-05-13'); assert.strictEqual(r.reduce((s,e)=>s+e.amount,0),3000);});
T('TC-C-014','filter last-7 sums to 3150', () => {const r=expensesInRange(EXP_SAMPLE,'2026-05-07','2026-05-13'); assert.strictEqual(r.reduce((s,e)=>s+e.amount,0),3150);});
T('TC-C-015','filter on empty list returns []', () => assert.strictEqual(expensesInRange([],'2026-05-01','2026-05-13').length,0));

/* ── D. PARSE-SPOKEN-AMOUNT (TC-D-001 to TC-D-025) ───────────────────────── */
T('TC-D-001','plain "500" → 500', () => assert.strictEqual(parseSpokenAmount('500'),500));
T('TC-D-002','"₹500" → 500', () => assert.strictEqual(parseSpokenAmount('₹500'),500));
T('TC-D-003','"1,000" → 1000', () => assert.strictEqual(parseSpokenAmount('1,000'),1000));
T('TC-D-004','"25k" → 25000', () => assert.strictEqual(parseSpokenAmount('25k'),25000));
T('TC-D-005','"25 k" → 25000', () => assert.strictEqual(parseSpokenAmount('25 k'),25000));
T('TC-D-006','"1.5k" → 1500', () => assert.strictEqual(parseSpokenAmount('1.5k'),1500));
T('TC-D-007','"1 lakh" → 100000', () => assert.strictEqual(parseSpokenAmount('1 lakh'),100000));
T('TC-D-008','"1.5 lakh" → 150000', () => assert.strictEqual(parseSpokenAmount('1.5 lakh'),150000));
T('TC-D-009','"2 lakhs" → 200000', () => assert.strictEqual(parseSpokenAmount('2 lakhs'),200000));
T('TC-D-010','"1 lac" → 100000', () => assert.strictEqual(parseSpokenAmount('1 lac'),100000));
T('TC-D-011','"1 crore" → 10000000', () => assert.strictEqual(parseSpokenAmount('1 crore'),10000000));
T('TC-D-012','"1.2 crores" → 12000000', () => assert.strictEqual(parseSpokenAmount('1.2 crores'),12000000));
T('TC-D-013','"1 cr" → 10000000', () => assert.strictEqual(parseSpokenAmount('1 cr'),10000000));
T('TC-D-014','"fifty thousand" → 50000', () => assert.strictEqual(parseSpokenAmount('fifty thousand'),50000));
T('TC-D-015','"twenty five thousand" → 25000', () => assert.strictEqual(parseSpokenAmount('twenty five thousand'),25000));
T('TC-D-016','"five hundred" → 500', () => assert.strictEqual(parseSpokenAmount('five hundred'),500));
T('TC-D-017','"one hundred" → 100', () => assert.strictEqual(parseSpokenAmount('one hundred'),100));
T('TC-D-018','no number → null', () => assert.strictEqual(parseSpokenAmount('hello world'),null));
T('TC-D-019','empty string → null', () => assert.strictEqual(parseSpokenAmount(''),null));
T('TC-D-020','picks largest number', () => assert.strictEqual(parseSpokenAmount('spent 500 saved 50000 today'),50000));
T('TC-D-021','decimal "123.45" → 123', () => assert.strictEqual(parseSpokenAmount('123.45'),123));
T('TC-D-022','"0" → null (no positive number)', () => assert.strictEqual(parseSpokenAmount('0'),0)); /* note: returns 0 */
T('TC-D-023','case-insensitive "LAKH"', () => assert.strictEqual(parseSpokenAmount('1 LAKH'),100000));
T('TC-D-024','mixed comma and decimal "12,345.67"', () => assert.strictEqual(parseSpokenAmount('12,345.67'),12346));
T('TC-D-025','very large "99 crore"', () => assert.strictEqual(parseSpokenAmount('99 crore'),990000000));

/* ── E. PARSE-SPOKEN-DATE (TC-E-001 to TC-E-015) ─────────────────────────── */
T('TC-E-001','"5 may" → 2026-05-05', () => assert.strictEqual(parseSpokenDate('5 may'),'2026-05-05'));
T('TC-E-002','"may 5" → 2026-05-05', () => assert.strictEqual(parseSpokenDate('may 5'),'2026-05-05'));
T('TC-E-003','"5th may" → 2026-05-05', () => assert.strictEqual(parseSpokenDate('5th may'),'2026-05-05'));
T('TC-E-004','"23rd june" → 2026-06-23', () => assert.strictEqual(parseSpokenDate('23rd june'),'2026-06-23'));
T('TC-E-005','"5 may 2025" → 2025-05-05', () => assert.strictEqual(parseSpokenDate('5 may 2025'),'2025-05-05'));
T('TC-E-006','"may 5 2025" → 2025-05-05', () => assert.strictEqual(parseSpokenDate('may 5 2025'),'2025-05-05'));
T('TC-E-007','"jan 1" → 2026-01-01', () => assert.strictEqual(parseSpokenDate('jan 1'),'2026-01-01'));
T('TC-E-008','"december 31" → 2026-12-31', () => assert.strictEqual(parseSpokenDate('december 31'),'2026-12-31'));
T('TC-E-009','"feb 29 2024" → 2024-02-29 (leap)', () => assert.strictEqual(parseSpokenDate('feb 29 2024'),'2024-02-29'));
T('TC-E-010','case insensitive "MAY 5"', () => assert.strictEqual(parseSpokenDate('MAY 5'),'2026-05-05'));
T('TC-E-011','invalid month "smay 5" → null', () => assert.strictEqual(parseSpokenDate('smay 5'),null));
T('TC-E-012','day=0 → null', () => assert.strictEqual(parseSpokenDate('may 0'),null));
T('TC-E-013','day=32 → null', () => assert.strictEqual(parseSpokenDate('may 32'),null));
T('TC-E-014','empty → null', () => assert.strictEqual(parseSpokenDate(''),null));
T('TC-E-015','"15th august" → 2026-08-15', () => assert.strictEqual(parseSpokenDate('15th august'),'2026-08-15'));

/* ── F. CLASSIFY VOICE INTENT — BUDGET-SET (TC-F-001 to TC-F-015) ───────── */
T('TC-F-001','"set budget 50000"', () => assert.deepStrictEqual(classifyVoiceIntent('set budget 50000'),{type:'budget-set',amount:50000}));
T('TC-F-002','"set my monthly budget to 50000"', () => assert.deepStrictEqual(classifyVoiceIntent('set my monthly budget to 50000'),{type:'budget-set',amount:50000}));
T('TC-F-003','"budget 50000"', () => assert.deepStrictEqual(classifyVoiceIntent('budget 50000'),{type:'budget-set',amount:50000}));
T('TC-F-004','"my budget is 50000"', () => assert.deepStrictEqual(classifyVoiceIntent('my budget is 50000'),{type:'budget-set',amount:50000}));
T('TC-F-005','"this month budget 50000"', () => assert.deepStrictEqual(classifyVoiceIntent('this month budget 50000'),{type:'budget-set',amount:50000}));
T('TC-F-006','"set budget fifty thousand"', () => assert.deepStrictEqual(classifyVoiceIntent('set budget fifty thousand'),{type:'budget-set',amount:50000}));
T('TC-F-007','"set budget 1 lakh"', () => assert.deepStrictEqual(classifyVoiceIntent('set budget 1 lakh'),{type:'budget-set',amount:100000}));
T('TC-F-008','"set budget 25k"', () => assert.deepStrictEqual(classifyVoiceIntent('set budget 25k'),{type:'budget-set',amount:25000}));
T('TC-F-009','"make budget 30000"', () => assert.deepStrictEqual(classifyVoiceIntent('make budget 30000'),{type:'budget-set',amount:30000}));
T('TC-F-010','"update budget to 40000"', () => assert.deepStrictEqual(classifyVoiceIntent('update budget to 40000'),{type:'budget-set',amount:40000}));
T('TC-F-011','"change budget at 60000"', () => assert.deepStrictEqual(classifyVoiceIntent('change budget at 60000'),{type:'budget-set',amount:60000}));
T('TC-F-012','"monthly budget is 70000"', () => assert.deepStrictEqual(classifyVoiceIntent('monthly budget is 70000'),{type:'budget-set',amount:70000}));
T('TC-F-013','"this month budget is 80000"', () => assert.deepStrictEqual(classifyVoiceIntent("this month's budget is 80000"),{type:'budget-set',amount:80000}));
T('TC-F-014','"budget = 90000"', () => assert.deepStrictEqual(classifyVoiceIntent('budget = 90000'),{type:'budget-set',amount:90000}));
T('TC-F-015','"set budget 1.5 lakh"', () => assert.deepStrictEqual(classifyVoiceIntent('set budget 1.5 lakh'),{type:'budget-set',amount:150000}));

/* ── G. CLASSIFY VOICE INTENT — BUDGET-QUERY (TC-G-001 to TC-G-012) ─────── */
T('TC-G-001','"budget left?"', () => assert.strictEqual(classifyVoiceIntent('budget left').type,'budget-query'));
T('TC-G-002','"how much budget left"', () => assert.strictEqual(classifyVoiceIntent('how much budget left').type,'budget-query'));
T('TC-G-003','"what is my budget"', () => assert.strictEqual(classifyVoiceIntent('what is my budget').type,'budget-query'));
T('TC-G-004','"did i overspend"', () => assert.strictEqual(classifyVoiceIntent('did i overspend').type,'budget-query'));
T('TC-G-005','"did i over spend"', () => assert.strictEqual(classifyVoiceIntent('did i over spend').type,'budget-query'));
T('TC-G-006','"am i over budget"', () => assert.strictEqual(classifyVoiceIntent('am i over budget').type,'budget-query'));
T('TC-G-007','"am i under budget"', () => assert.strictEqual(classifyVoiceIntent('am i under budget').type,'budget-query'));
T('TC-G-008','"good month or bad month"', () => assert.strictEqual(classifyVoiceIntent('good month or bad month').type,'budget-query'));
T('TC-G-009','"how is my budget doing"', () => assert.strictEqual(classifyVoiceIntent('how is my budget doing').type,'budget-query'));
T('TC-G-010','"show me my verdict"', () => assert.strictEqual(classifyVoiceIntent('show me my verdict').type,'budget-query'));
T('TC-G-011','"tell me my budget"', () => assert.strictEqual(classifyVoiceIntent('tell me my budget').type,'budget-query'));
T('TC-G-012','"budget remaining"', () => assert.strictEqual(classifyVoiceIntent('budget remaining').type,'budget-query'));

/* ── H. CLASSIFY VOICE INTENT — DATE-QUERY (TC-H-001 to TC-H-025) ───────── */
T('TC-H-001','"how much did i spend yesterday"', () => {const r=classifyVoiceIntent('how much did i spend yesterday'); assert.strictEqual(r.type,'date-query'); assert.strictEqual(r.presetName,'yesterday');});
T('TC-H-002','"what did i spend today"', () => {const r=classifyVoiceIntent('what did i spend today'); assert.strictEqual(r.type,'date-query'); assert.strictEqual(r.presetName,'today');});
T('TC-H-003','"show this week"', () => {const r=classifyVoiceIntent('show this week'); assert.strictEqual(r.type,'date-query'); assert.strictEqual(r.presetName,'this-week');});
T('TC-H-004','"current week"', () => assert.strictEqual(classifyVoiceIntent('show me current week').presetName,'this-week'));
T('TC-H-005','"last 7 days"', () => {const r=classifyVoiceIntent('last 7 days'); assert.strictEqual(r.type,'date-query'); assert.strictEqual(r.presetName,'last-7');});
T('TC-H-006','"last seven days"', () => assert.strictEqual(classifyVoiceIntent('last seven days').presetName,'last-7'));
T('TC-H-007','"last week"', () => {const r=classifyVoiceIntent('last week'); assert.strictEqual(r.type,'date-query'); assert.strictEqual(r.from,'2026-05-04'); assert.strictEqual(r.to,'2026-05-10');});
T('TC-H-008','"last 30 days"', () => {const r=classifyVoiceIntent('last 30 days'); assert.strictEqual(r.from,'2026-04-14'); assert.strictEqual(r.to,'2026-05-13');});
T('TC-H-009','"last thirty days"', () => assert.strictEqual(classifyVoiceIntent('last thirty days').from,'2026-04-14'));
T('TC-H-010','"from may 1 to may 10"', () => {const r=classifyVoiceIntent('from may 1 to may 10'); assert.strictEqual(r.type,'date-query'); assert.strictEqual(r.from,'2026-05-01'); assert.strictEqual(r.to,'2026-05-10');});
T('TC-H-011','"from may 1 till may 10"', () => assert.strictEqual(classifyVoiceIntent('from may 1 till may 10').from,'2026-05-01'));
T('TC-H-012','"from may 1 until may 10"', () => assert.strictEqual(classifyVoiceIntent('from may 1 until may 10').from,'2026-05-01'));
T('TC-H-013','"show me may 5"', () => {const r=classifyVoiceIntent('show me may 5'); assert.strictEqual(r.type,'date-query'); assert.strictEqual(r.from,'2026-05-05');});
T('TC-H-014','"how much on food yesterday"', () => {const r=classifyVoiceIntent('how much on food yesterday'); assert.strictEqual(r.type,'date-query'); assert.strictEqual(r.category,'food');});
T('TC-H-015','"how much spent on petrol today"', () => {const r=classifyVoiceIntent('how much spent on petrol today'); assert.strictEqual(r.category,'petrol');});
T('TC-H-016','"how much on grocery this week"', () => assert.strictEqual(classifyVoiceIntent('how much on grocery this week').category,'grocery'));
T('TC-H-017','"how many expenses today"', () => assert.strictEqual(classifyVoiceIntent('how many expenses today').type,'date-query'));
T('TC-H-018','"tell me yesterday"', () => assert.strictEqual(classifyVoiceIntent('tell me yesterday').type,'date-query'));
T('TC-H-019','"total spent yesterday"', () => assert.strictEqual(classifyVoiceIntent('total spent yesterday').type,'date-query'));
T('TC-H-020','expenses for today phrasing', () => assert.strictEqual(classifyVoiceIntent('expenses for today').type,'date-query'));
T('TC-H-021','"last 7 days food"', () => {const r=classifyVoiceIntent('last 7 days food'); assert.strictEqual(r.category,'food');});
T('TC-H-022','"this week petrol"', () => assert.strictEqual(classifyVoiceIntent('this week petrol').category,'petrol'));
T('TC-H-023','"from may 1 to may 10 food"', () => {const r=classifyVoiceIntent('from may 1 to may 10 food'); assert.strictEqual(r.category,'food'); assert.strictEqual(r.from,'2026-05-01');});
T('TC-H-024','disambig: "spent 500 on food yesterday" is NOT date-query', () => assert.notStrictEqual(classifyVoiceIntent('spent 500 on food yesterday').type,'date-query'));
T('TC-H-025','disambig: "yesterday spent 500 food" is NOT date-query', () => assert.notStrictEqual(classifyVoiceIntent('yesterday spent 500 food').type,'date-query'));

/* ── I. CLASSIFY — NEGATIVES / NOISE (TC-I-001 to TC-I-015) ──────────────── */
T('TC-I-001','random sentence → none', () => assert.strictEqual(classifyVoiceIntent('hello there how are you').type,'none'));
T('TC-I-002','empty → none', () => assert.strictEqual(classifyVoiceIntent('').type,'none'));
T('TC-I-003','only "yesterday" with no question → none', () => assert.strictEqual(classifyVoiceIntent('yesterday').type,'none'));
T('TC-I-004','only "today" with no question → none', () => assert.strictEqual(classifyVoiceIntent('today').type,'none'));
T('TC-I-005','expense-add: "500 grocery today" → none', () => assert.strictEqual(classifyVoiceIntent('500 grocery today').type,'none'));
T('TC-I-006','expense-add: "twenty rupees food yesterday" → none', () => assert.strictEqual(classifyVoiceIntent('twenty rupees food yesterday').type,'none'));
T('TC-I-007','expense-add: "spent 100 petrol" → none', () => assert.strictEqual(classifyVoiceIntent('spent 100 petrol').type,'none'));
T('TC-I-008','garbage budget set: "set budget abc" → none', () => assert.strictEqual(classifyVoiceIntent('set budget abc').type,'none'));
T('TC-I-009','"budget" alone → none', () => assert.strictEqual(classifyVoiceIntent('budget').type,'none'));
T('TC-I-010','"set budget" with no amount → none', () => assert.strictEqual(classifyVoiceIntent('set budget').type,'none'));
T('TC-I-011','non-English chars handled', () => assert.strictEqual(classifyVoiceIntent('हिंदी text').type,'none'));
T('TC-I-012','very long noise → none', () => assert.strictEqual(classifyVoiceIntent('a b c d e f g h i j k'.repeat(20)).type,'none'));
T('TC-I-013','"spent 500 yesterday" (no cat) is still none b/c no question', () => assert.strictEqual(classifyVoiceIntent('spent 500 yesterday').type,'none'));
T('TC-I-014','"yesterday food 500" → none (expense pattern)', () => assert.strictEqual(classifyVoiceIntent('yesterday food 500').type,'none'));
T('TC-I-015','SQL-injection-ish "today\'); DROP TABLE" → none safe', () => assert.strictEqual(classifyVoiceIntent("today'); DROP TABLE expenses --").type,'none'));

/* ── J. EXTRACT-DATE-FROM-VOICE (TC-J-001 to TC-J-020) ───────────────────── */
T('TC-J-001','"today" → today', () => assert.strictEqual(extractDateFromVoice('spent 500 today').date,'2026-05-13'));
T('TC-J-002','"yesterday" → today-1', () => assert.strictEqual(extractDateFromVoice('spent 500 yesterday').date,'2026-05-12'));
T('TC-J-003','"day before yesterday" → today-2', () => assert.strictEqual(extractDateFromVoice('spent 500 day before yesterday').date,'2026-05-11'));
T('TC-J-004','"5 may" → 2026-05-05', () => assert.strictEqual(extractDateFromVoice('spent 500 5 may').date,'2026-05-05'));
T('TC-J-005','"may 5" → 2026-05-05', () => assert.strictEqual(extractDateFromVoice('spent 500 may 5').date,'2026-05-05'));
T('TC-J-006','"5th may" → 2026-05-05', () => assert.strictEqual(extractDateFromVoice('5th may 500 rupees').date,'2026-05-05'));
T('TC-J-007','"23rd june" → 2025-06-23 (future → prev year)', () => assert.strictEqual(extractDateFromVoice('23rd june food 500').date,'2025-06-23'));
T('TC-J-008','"may 5 2025" inline year', () => assert.strictEqual(extractDateFromVoice('500 may 5 2025').date,'2025-05-05'));
T('TC-J-009','"in 2025" explicit year', () => assert.strictEqual(extractDateFromVoice('500 in 2025 on may 5').date,'2025-05-05'));
T('TC-J-010','no date phrase → null', () => assert.strictEqual(extractDateFromVoice('spent 500 on food'),null));
T('TC-J-011','future month defaults to last year', () => {const r=extractDateFromVoice('october 12'); assert.strictEqual(r.date,'2025-10-12');});
T('TC-J-012','past month stays current year', () => {const r=extractDateFromVoice('january 5'); assert.strictEqual(r.date,'2026-01-05');});
T('TC-J-013','strips date from cleaned text', () => {const r=extractDateFromVoice('spent 500 today'); assert.ok(!r.stripped.includes('today'));});
T('TC-J-014','"jan 1" lowercase', () => assert.strictEqual(extractDateFromVoice('jan 1').date,'2026-01-01'));
T('TC-J-015','4-digit amount NOT confused with year', () => {const r=extractDateFromVoice('spent 2024 rupees on food'); assert.strictEqual(r,null);});
T('TC-J-016','"5 of june" handled (→ prev year)', () => assert.strictEqual(extractDateFromVoice('5 of june').date,'2025-06-05'));
T('TC-J-017','"23rd of june" handled (→ prev year)', () => assert.strictEqual(extractDateFromVoice('23rd of june').date,'2025-06-23'));
T('TC-J-018','"june the 23rd" handled (→ prev year)', () => assert.strictEqual(extractDateFromVoice('june the 23rd').date,'2025-06-23'));
T('TC-J-019','this month on 5', () => assert.strictEqual(extractDateFromVoice('5 of this month').date,'2026-05-05'));
T('TC-J-020','last month on 5', () => assert.strictEqual(extractDateFromVoice('5 of last month').date,'2026-04-05'));

/* ── K. PARSE-VOICE-COMMAND (TC-K-001 to TC-K-020) ───────────────────────── */
T('TC-K-001','"spent 500 on food today"', () => {const r=parseVoiceCommand('spent 500 on food today'); assert.strictEqual(r.amount,500); assert.strictEqual(r.category,'food'); assert.strictEqual(r.date,'2026-05-13');});
T('TC-K-002','"500 petrol yesterday"', () => {const r=parseVoiceCommand('500 petrol yesterday'); assert.strictEqual(r.amount,500); assert.strictEqual(r.category,'petrol'); assert.strictEqual(r.date,'2026-05-12');});
T('TC-K-003','"1000 grocery"', () => {const r=parseVoiceCommand('1000 grocery'); assert.strictEqual(r.amount,1000); assert.strictEqual(r.category,'grocery');});
T('TC-K-004','note via "and note is"', () => {const r=parseVoiceCommand('500 food today and note is mangos'); assert.strictEqual(r.note,'mangos');});
T('TC-K-005','note via "note:"', () => {const r=parseVoiceCommand('500 food today note: mangos and onions'); assert.strictEqual(r.note,'mangos and onions');});
T('TC-K-006','note via "for X"', () => {const r=parseVoiceCommand('500 today for mangos'); assert.strictEqual(r.note,'mangos');});
T('TC-K-007','note via dash separator', () => {const r=parseVoiceCommand('500 food today - mangos'); assert.strictEqual(r.note,'mangos');});
T('TC-K-008','date strips before amount detection', () => {const r=parseVoiceCommand('2024 rupees today food'); assert.strictEqual(r.amount,2024); assert.strictEqual(r.date,'2026-05-13');});
T('TC-K-009','keyword "biryani" → food', () => {const r=parseVoiceCommand('500 biryani'); assert.strictEqual(r.category,'food');});
T('TC-K-010','keyword "zepto" → grocery', () => {const r=parseVoiceCommand('500 zepto'); assert.strictEqual(r.category,'grocery');});
T('TC-K-011','keyword "diesel" → petrol', () => {const r=parseVoiceCommand('1500 diesel'); assert.strictEqual(r.category,'petrol');});
T('TC-K-012','keyword "apollo" → medicine', () => {const r=parseVoiceCommand('200 apollo'); assert.strictEqual(r.category,'medicine');});
T('TC-K-013','no category → null', () => {const r=parseVoiceCommand('500 today'); assert.strictEqual(r.category,null);});
T('TC-K-014','"for food" treats food as category, not note', () => {const r=parseVoiceCommand('500 for food'); assert.strictEqual(r.category,'food'); assert.strictEqual(r.note,'');});
T('TC-K-015','word-boundary: "seafood" does NOT match food', () => {const r=parseVoiceCommand('500 seafood today'); assert.strictEqual(r.category,null);});
T('TC-K-016','date defaults to today', () => {const r=parseVoiceCommand('500 food'); assert.strictEqual(r.date,'2026-05-13');});
T('TC-K-017','multi-keyword: petrol+fuel → petrol', () => assert.strictEqual(parseVoiceCommand('500 petrol fuel').category,'petrol'));
T('TC-K-018','decimal amount', () => {const r=parseVoiceCommand('123.5 food'); assert.strictEqual(r.amount,123.5);});
T('TC-K-019','empty input', () => {const r=parseVoiceCommand(''); assert.strictEqual(r.amount,null); assert.strictEqual(r.category,null);});
T('TC-K-020','case-insensitive', () => {const r=parseVoiceCommand('500 FOOD TODAY'); assert.strictEqual(r.category,'food');});

/* ── L. FMT / ESCAPE / FORMATTING (TC-L-001 to TC-L-015) ─────────────────── */
T('TC-L-001','fmt 500 → ₹500', () => assert.strictEqual(fmt(500),'₹500'));
T('TC-L-002','fmt 1000 → ₹1,000', () => assert.strictEqual(fmt(1000),'₹1,000'));
T('TC-L-003','fmt 100000 → ₹1,00,000 (Indian grouping)', () => assert.strictEqual(fmt(100000),'₹1,00,000'));
T('TC-L-004','fmt 0 → ₹0', () => assert.strictEqual(fmt(0),'₹0'));
T('TC-L-005','fmt negative', () => assert.strictEqual(fmt(-500),'₹-500'));
T('TC-L-006','fmt rounds decimals', () => assert.strictEqual(fmt(123.45),'₹123'));
T('TC-L-007','escapeHTML <script>', () => assert.strictEqual(escapeHTML('<script>'),'&lt;script&gt;'));
T('TC-L-008','escapeHTML &', () => assert.strictEqual(escapeHTML('a & b'),'a &amp; b'));
T('TC-L-009','escapeHTML quotes', () => assert.strictEqual(escapeHTML('"hi"'),'&quot;hi&quot;'));
T('TC-L-010','escapeHTML apostrophe', () => assert.strictEqual(escapeHTML("don't"),"don&#39;t"));
T('TC-L-011','escapeHTML empty', () => assert.strictEqual(escapeHTML(''),''));
T('TC-L-012','fmtDate "2026-05-13" → "13 May"', () => assert.strictEqual(fmtDate('2026-05-13'),'13 May'));
T('TC-L-013','fmtFullDate Dec 25', () => assert.strictEqual(fmtFullDate('2026-12-25'),'25 Dec 2026'));
T('TC-L-014','fmt 1 crore', () => assert.strictEqual(fmt(10000000),'₹1,00,00,000'));
T('TC-L-015','escapeHTML handles non-string', () => assert.strictEqual(escapeHTML(42),'42'));

/* ── M. BUDGET MATH (TC-M-001 to TC-M-015) ───────────────────────────────── */
T('TC-M-001','computeSpent for May 2026 sums correctly', () => assert.strictEqual(computeSpentForMonth(EXP_SAMPLE,2026,5),3650));
T('TC-M-002','computeSpent for Apr 2026 = 100', () => assert.strictEqual(computeSpentForMonth(EXP_SAMPLE,2026,4),100));
T('TC-M-003','computeSpent for month with no data = 0', () => assert.strictEqual(computeSpentForMonth(EXP_SAMPLE,2030,1),0));
T('TC-M-004','computeSpent for empty list = 0', () => assert.strictEqual(computeSpentForMonth([],2026,5),0));
T('TC-M-005','computeSpent ignores empty-date rows', () => {const r=computeSpentForMonth([{date:'',amount:99}],2026,5); assert.strictEqual(r,0);});
T('TC-M-006','verdict no budget', () => assert.deepStrictEqual(deriveVerdict(2026,5,0,1000),{status:'no-budget',spillover:0}));
T('TC-M-007','verdict good (under)', () => assert.deepStrictEqual(deriveVerdict(2026,5,5000,3000),{status:'good',spillover:0}));
T('TC-M-008','verdict good (exactly at)', () => assert.deepStrictEqual(deriveVerdict(2026,5,5000,5000),{status:'good',spillover:0}));
T('TC-M-009','verdict bad (over)', () => assert.deepStrictEqual(deriveVerdict(2026,5,5000,6000),{status:'bad',spillover:1000}));
T('TC-M-010','verdict bad with large spillover', () => assert.deepStrictEqual(deriveVerdict(2026,5,1000,100000),{status:'bad',spillover:99000}));
T('TC-M-011','verdict 0 spent under budget = good', () => assert.deepStrictEqual(deriveVerdict(2026,5,5000,0),{status:'good',spillover:0}));
T('TC-M-012','verdict negative budget treated as no-budget', () => assert.strictEqual(deriveVerdict(2026,5,-100,500).status,'no-budget'));
T('TC-M-013','verdict spillover never negative', () => assert.strictEqual(deriveVerdict(2026,5,5000,1000).spillover,0));
T('TC-M-014','computeSpent boundary first day of month', () => {const r=computeSpentForMonth([{date:'2026-05-01',amount:100}],2026,5); assert.strictEqual(r,100);});
T('TC-M-015','computeSpent boundary last day Dec', () => {const r=computeSpentForMonth([{date:'2026-12-31',amount:777}],2026,12); assert.strictEqual(r,777);});

/* ── N. AGGREGATION (per-category totals for By-Date view) (TC-N-001..N-010) ─ */
function categoryAgg(rows) {
  const map = {};
  for (const e of rows) {
    if (!map[e.category]) map[e.category] = { total:0, count:0 };
    map[e.category].total += e.amount;
    map[e.category].count += 1;
  }
  return map;
}
T('TC-N-001','agg today: food=200,petrol=1000', () => {const a=categoryAgg(expensesInRange(EXP_SAMPLE,'2026-05-13','2026-05-13')); assert.strictEqual(a.food.total,200); assert.strictEqual(a.petrol.total,1000);});
T('TC-N-002','agg today counts', () => {const a=categoryAgg(expensesInRange(EXP_SAMPLE,'2026-05-13','2026-05-13')); assert.strictEqual(a.food.count,1); assert.strictEqual(a.petrol.count,1);});
T('TC-N-003','agg week food = 200+300+150', () => {const a=categoryAgg(expensesInRange(EXP_SAMPLE,'2026-05-07','2026-05-13')); assert.strictEqual(a.food.total,650);});
T('TC-N-004','agg week food count = 3', () => {const a=categoryAgg(expensesInRange(EXP_SAMPLE,'2026-05-07','2026-05-13')); assert.strictEqual(a.food.count,3);});
T('TC-N-005','agg empty range = {}', () => assert.deepStrictEqual(categoryAgg(expensesInRange(EXP_SAMPLE,'2030-01-01','2030-12-31')),{}));
T('TC-N-006','agg this-week petrol count', () => {const a=categoryAgg(expensesInRange(EXP_SAMPLE,'2026-05-11','2026-05-13')); assert.strictEqual(a.petrol.count,1);});
T('TC-N-007','agg this-week grocery total', () => {const a=categoryAgg(expensesInRange(EXP_SAMPLE,'2026-05-11','2026-05-13')); assert.strictEqual(a.grocery.total,1500);});
T('TC-N-008','agg sum equals range total', () => {const rows=expensesInRange(EXP_SAMPLE,'2026-05-07','2026-05-13'); const a=categoryAgg(rows); const sum=Object.values(a).reduce((s,v)=>s+v.total,0); assert.strictEqual(sum,3150);});
T('TC-N-009','agg ignores empty-date rows', () => {const rows=expensesInRange([{date:'',amount:100,category:'food'},{date:'2026-05-13',amount:50,category:'food'}],'2026-05-13','2026-05-13'); const a=categoryAgg(rows); assert.strictEqual(a.food.total,50);});
T('TC-N-010','agg with duplicate categories adds', () => {const a=categoryAgg([{date:'x',amount:100,category:'food'},{date:'x',amount:50,category:'food'}]); assert.strictEqual(a.food.total,150); assert.strictEqual(a.food.count,2);});

/* ── O. PERCENTAGE / DONUT MATH (TC-O-001..O-008) ──────────────────────── */
function pct(part, whole) { if (!whole) return 0; return Math.round((part/whole)*100); }
T('TC-O-001','pct 200/1000 = 20', () => assert.strictEqual(pct(200,1000),20));
T('TC-O-002','pct 0/1000 = 0', () => assert.strictEqual(pct(0,1000),0));
T('TC-O-003','pct 1000/1000 = 100', () => assert.strictEqual(pct(1000,1000),100));
T('TC-O-004','pct 333/1000 = 33', () => assert.strictEqual(pct(333,1000),33));
T('TC-O-005','pct guards divide-by-zero', () => assert.strictEqual(pct(100,0),0));
T('TC-O-006','pct rounds half up', () => assert.strictEqual(pct(665,1000),67));
T('TC-O-007','pct very small', () => assert.strictEqual(pct(1,1000),0));
T('TC-O-008','pct sum may equal 100 (3 cats)', () => {const a=pct(333,1000),b=pct(333,1000),c=pct(334,1000); assert.strictEqual(a+b+c,99);}); /* expected rounding gap */

/* ── P. EDGE/CORNER — BOUNDARY/LEAP/DST (TC-P-001..P-010) ──────────────── */
T('TC-P-001','leap-year addDays Feb 28 → Feb 29 (2024)', () => assert.strictEqual(dateToStr(addDays(new Date(2024,1,28),1)),'2024-02-29'));
T('TC-P-002','non-leap addDays Feb 28 → Mar 1 (2025)', () => assert.strictEqual(dateToStr(addDays(new Date(2025,1,28),1)),'2025-03-01'));
T('TC-P-003','addDays across DST (Mar 8 2026 → Mar 9)', () => assert.strictEqual(dateToStr(addDays(new Date(2026,2,8),1)),'2026-03-09'));
T('TC-P-004','startOfWeek across month boundary', () => {const d=new Date(2026,5,1); assert.ok(dateToStr(startOfWeek(d))<= '2026-06-01');});
T('TC-P-005','filter range spanning year boundary', () => {const data=[{date:'2025-12-31',amount:100},{date:'2026-01-01',amount:200}]; assert.strictEqual(expensesInRange(data,'2025-12-31','2026-01-01').length,2);});
T('TC-P-006','filter range with same start/end on last-of-month', () => {const data=[{date:'2026-01-31',amount:100}]; assert.strictEqual(expensesInRange(data,'2026-01-31','2026-01-31').length,1);});
T('TC-P-007','filter range lexical: "2026-9-1" not equal "2026-09-01"', () => {const data=[{date:'2026-09-01',amount:100}]; assert.strictEqual(expensesInRange(data,'2026-09-01','2026-09-01').length,1);});
T('TC-P-008','very large list 10000 entries — perf reasonable', () => {const data=Array(10000).fill(null).map((_,i)=>({date:'2026-05-13',amount:i,category:'food'})); const start=Date.now(); const r=expensesInRange(data,'2026-05-13','2026-05-13'); assert.strictEqual(r.length,10000); assert.ok(Date.now()-start<200);});
T('TC-P-009','category match: longest first ("outside food" beats "food")', () => {customCategories=[{key:'outside_food',label:'Outside Food'}]; const r=parseVoiceCommand('500 outside food today'); customCategories=[]; assert.strictEqual(r.category,'outside_food');});
T('TC-P-010','startOfWeek Sunday Jan 4 2026 → Mon Dec 29 2025', () => assert.strictEqual(dateToStr(startOfWeek(new Date(2026,0,4))),'2025-12-29'));

/* ═══════════════════════════════════════════════════════════════════════════
   FINISH — report
   ═══════════════════════════════════════════════════════════════════════════ */
const summary = { total: results.length, pass: passCount, fail: failCount, results };
fs.writeFileSync(path.join(__dirname,'auto-results.json'), JSON.stringify(summary, null, 2));

console.log('═══════════════════════════════════════════════════════════');
console.log(`  AUTO-SUITE  —  ${passCount}/${results.length} passed  (${failCount} failed)`);
console.log('═══════════════════════════════════════════════════════════');
if (failCount > 0) {
  console.log('\nFAILURES:');
  for (const r of results) if (r.status==='FAIL') console.log(`  ✗ ${r.id}  ${r.title}\n     → ${r.error}`);
  process.exit(1);
}
console.log('  ✓ ALL AUTOMATED CHECKS PASSED');
