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
   v25 FEATURE PACK — MIRROR PURE FUNCTIONS FROM features.js
   These mirror the testable logic so any regression in the new feature module
   fails this suite.
   ═══════════════════════════════════════════════════════════════════════════ */

/* ---- yyyymm / dToYMD / clamp ---- */
function yyyymm(d) { return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`; }
function dToYMD(d) { return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
function clamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }

/* ---- AI_KEYWORDS / MERCHANT_HINTS (must match features.js) ---- */
const AI_KEYWORDS = {
  food: ['food','lunch','dinner','breakfast','meal','eat','eating','restaurant','hotel','biryani','swiggy','zomato','snack','snacks','chai','tea','coffee','tiffin','starbucks','dominos','pizza','burger','kfc','mcdonald','mcdonalds','subway','dosa','idli','curry','rice','thali','cafe','bakery','sweet','sweets'],
  grocery: ['grocery','groceries','supermarket','kirana','big bazaar','dmart','reliance','zepto','blinkit','instamart','more','spencer','bigbasket','grofers','jiomart'],
  market: ['market','vegetable','vegetables','fruit','fruits','sabzi','mandi','farm','farmer'],
  medicine: ['medicine','medicines','medical','pharmacy','pharmacist','doctor','hospital','tablet','tablets','capsule','drug','health','apollo','wellness','prescription','clinic','dental','dentist'],
  petrol: ['petrol','fuel','diesel','gas','pump','filling','indianoil','iocl','bpcl','hpcl','shell','reliance petrol'],
  recharge: ['recharge','mobile','phone','internet','data','sim','jio','airtel','vi','bsnl','broadband','wifi','wifi bill','postpaid','prepaid'],
  water: ['water','aqua','bisleri','mineral','kinley','rail neer'],
  gifts: ['gift','gifts','present','birthday','anniversary','wedding','flower','flowers','bouquet'],
  other: ['other','misc','miscellaneous'],
};
const MERCHANT_HINTS = {
  'uber': 'other', 'ola': 'other', 'rapido': 'other',
  'amazon': 'other', 'flipkart': 'other', 'myntra': 'other', 'meesho': 'other',
  'netflix': 'recharge', 'spotify': 'recharge', 'hotstar': 'recharge', 'prime': 'recharge', 'youtube': 'recharge',
};

/* In-memory history store (per-test resettable) */
let _catHistory = {};
function _resetCatHistory() { _catHistory = {}; }
function recordCatHistory(note, catKey) {
  if (!note || !catKey) return;
  const lower = note.toLowerCase().trim();
  if (!lower) return;
  const tokens = lower.split(/\s+/).filter(t => t.length >= 3);
  for (const t of tokens) {
    if (!_catHistory[t]) _catHistory[t] = {};
    _catHistory[t][catKey] = (_catHistory[t][catKey] || 0) + 1;
  }
}
function suggestCategoryFromNote(note) {
  if (!note) return null;
  const lower = note.toLowerCase();
  const tokens = lower.split(/\s+/).filter(t => t.length >= 3);
  const votes = {};
  for (const t of tokens) {
    const h = _catHistory[t];
    if (!h) continue;
    for (const [cat, n] of Object.entries(h)) votes[cat] = (votes[cat] || 0) + n;
  }
  let bestHistory = null;
  for (const [cat, n] of Object.entries(votes)) {
    if (!bestHistory || n > bestHistory[1]) bestHistory = [cat, n];
  }
  if (bestHistory) return bestHistory[0];
  for (const [m, c] of Object.entries(MERCHANT_HINTS)) {
    if (new RegExp(`\\b${m}\\b`, 'i').test(lower)) return c;
  }
  for (const [cat, kws] of Object.entries(AI_KEYWORDS)) {
    for (const kw of kws) {
      if (new RegExp(`\\b${kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(lower)) return cat;
    }
  }
  return null;
}

/* ---- Recurring due check ---- */
function recurringIsDue(rec, today /* Date */) {
  const ymStr = yyyymm(today);
  if (rec.dayOfMonth > today.getDate()) return false;
  if (rec.lastRunYYYYMM === ymStr) return false;
  return true;
}

/* ---- Goal auto-credit math (split budget gap across active goals) ---- */
function autoCreditCalc(budgets, goals, currentYM) {
  /* budgets: [{year,month,budget,spent}], goals: [{target,saved,lastCreditedYYYYMM}] */
  const eligible = budgets.filter(b => {
    const ymd = `${b.year}-${String(b.month).padStart(2,'0')}`;
    return ymd < currentYM && b.spent < b.budget && b.budget > 0;
  });
  const newGoals = goals.map(g => ({ ...g }));
  for (const b of eligible) {
    const ymd = `${b.year}-${String(b.month).padStart(2,'0')}`;
    const active = newGoals.filter(g => g.saved < g.target && (g.lastCreditedYYYYMM || '') < ymd);
    if (active.length === 0) continue;
    const savings = Math.max(0, b.budget - b.spent);
    const perGoal = savings / active.length;
    for (const g of active) {
      const headroom = Math.max(0, g.target - g.saved);
      const credit = Math.min(perGoal, headroom);
      g.saved += credit;
      g.lastCreditedYYYYMM = ymd;
    }
  }
  return newGoals;
}

/* ---- Forecast math (linear projection) ---- */
function computeForecastPure(spentSoFar, daysElapsed, daysInMonth, budget /* may be null */, recRemaining = 0) {
  if (daysElapsed < 3) return null;
  const dailyAvg  = spentSoFar / daysElapsed;
  const projected = dailyAvg * daysInMonth + recRemaining;
  return {
    spentSoFar, dailyAvg, daysElapsed, daysInMonth,
    projected,
    budget: budget || 0,
    overBy:  budget && projected > budget ? projected - budget : 0,
    underBy: budget && projected <= budget ? budget - projected : 0,
  };
}

/* (Sparkline helpers removed in v25.4 — feature retired) */

/* ---- Heatmap level (0..4) ---- */
function heatmapLevel(value, max) {
  if (value === 0) return 0;
  return Math.min(4, Math.ceil((value / Math.max(max, 1)) * 4));
}

/* ---- What-if savings math ---- */
function whatIfRecalc(byCat, cuts) {
  let cur = 0, after = 0;
  for (const [k, v] of Object.entries(byCat)) {
    cur += v;
    const cut = cuts[k] || 0;
    after += v * (1 - cut / 100);
  }
  return { current: cur, after, saved: cur - after, sixMonth: (cur - after) * 6 };
}

/* ---- Year-wrap aggregation ---- */
function yearWrapAgg(expenses, year) {
  const exps = expenses.filter(e => e.date && parseInt(e.date.slice(0,4)) === year);
  if (exps.length === 0) return null;
  const total = exps.reduce((s, e) => s + e.amount, 0);
  const months = new Array(12).fill(0);
  const byCat = {};
  const byDay = {};
  exps.forEach(e => {
    const [y, m, d] = e.date.split('-').map(Number);
    months[m - 1] += e.amount;
    byCat[e.category] = (byCat[e.category] || 0) + e.amount;
    byDay[e.date]     = (byDay[e.date]     || 0) + e.amount;
  });
  const topCatEntry = Object.entries(byCat).sort((a, b) => b[1] - a[1])[0];
  const biggestDay  = Object.entries(byDay).sort((a, b) => b[1] - a[1])[0];
  const monthsTracked = months.filter(v => v > 0).length;
  return {
    total, months, byCat, byDay,
    topCat:    topCatEntry ? topCatEntry[0] : null,
    topCatAmt: topCatEntry ? topCatEntry[1] : 0,
    biggestDay:    biggestDay ? biggestDay[0] : null,
    biggestDayAmt: biggestDay ? biggestDay[1] : 0,
    monthsTracked,
    avgPerMonth: monthsTracked > 0 ? total / monthsTracked : 0,
    entries: exps.length,
  };
}

/* ---- CSV escape ---- */
function csvEscape(v) {
  const s = String(v == null ? '' : v).replace(/"/g, '""');
  return /[",\n]/.test(s) ? `"${s}"` : s;
}
function toCSV(rows) {
  return rows.map(r => r.map(csvEscape).join(',')).join('\n');
}

/* ---- Export range data ---- */
function exportRange(range, now = new Date()) {
  const y = now.getFullYear(), m = now.getMonth() + 1;
  if (range === 'this-month') {
    return { from: `${y}-${String(m).padStart(2,'0')}-01`,
             to:   `${y}-${String(m).padStart(2,'0')}-${String(new Date(y, m, 0).getDate()).padStart(2,'0')}` };
  }
  if (range === 'last-month') {
    const lm = new Date(y, m - 2, 1);
    const ly = lm.getFullYear(), lmo = lm.getMonth() + 1;
    return { from: `${ly}-${String(lmo).padStart(2,'0')}-01`,
             to:   `${ly}-${String(lmo).padStart(2,'0')}-${String(new Date(ly, lmo, 0).getDate()).padStart(2,'0')}` };
  }
  if (range === 'this-year') return { from: `${y}-01-01`, to: `${y}-12-31` };
  if (range === 'last-year') return { from: `${y-1}-01-01`, to: `${y-1}-12-31` };
  return { from: '0000-01-01', to: '9999-12-31' };
}

/* ---- URL quickadd parser ---- */
function parseQuickaddURL(href) {
  try {
    const u = new URL(href);
    return u.searchParams.get('quickadd');
  } catch (_) { return null; }
}

/* ---- Today hero allowance/clamp math ---- */
function todayHeroMath(todaySpend, budgetForMonth, daysInMonth) {
  const dailyAllowance = budgetForMonth > 0 ? budgetForMonth / daysInMonth : 0;
  if (dailyAllowance === 0) return { allowance: 0, pct: 0, over: false, remaining: 0 };
  const pct = clamp((todaySpend / dailyAllowance) * 100, 0, 100);
  return {
    allowance: dailyAllowance,
    pct,
    over: todaySpend > dailyAllowance,
    remaining: Math.max(0, dailyAllowance - todaySpend),
    overBy:   Math.max(0, todaySpend - dailyAllowance),
  };
}

/* ---- Search filter ---- */
function searchMatch(expenses, q, catMap) {
  q = String(q || '').trim().toLowerCase();
  if (!q) return [];
  const isAmount = /^\d+(\.\d+)?$/.test(q);
  const amtQuery = isAmount ? parseFloat(q) : null;
  return expenses.filter(e => {
    if (!e) return false;
    if (amtQuery !== null && Math.abs(e.amount - amtQuery) < 0.5) return true;
    const note = (e.note || '').toLowerCase();
    if (note.includes(q)) return true;
    const c = catMap[e.category];
    if (c && c.label.toLowerCase().includes(q)) return true;
    if (e.category && e.category.toLowerCase().includes(q)) return true;
    return false;
  }).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
}

/* ---- Goals progress ---- */
function goalProgress(g) {
  if (!g.target || g.target <= 0) return 0;
  return clamp(Math.round((g.saved / g.target) * 100), 0, 100);
}
function goalDone(g) { return g.target > 0 && g.saved >= g.target; }

/* ═══════════════════════════════════════════════════════════════════════════
   Q.  YYYYMM / dToYMD / clamp  (TC-Q-001..Q-015)
   ═══════════════════════════════════════════════════════════════════════════ */
T('TC-Q-001','yyyymm May 2026', () => assert.strictEqual(yyyymm(new Date(2026,4,13)),'2026-05'));
T('TC-Q-002','yyyymm Jan 2026', () => assert.strictEqual(yyyymm(new Date(2026,0,1)),'2026-01'));
T('TC-Q-003','yyyymm Dec 2025', () => assert.strictEqual(yyyymm(new Date(2025,11,31)),'2025-12'));
T('TC-Q-004','yyyymm pads single digit month', () => assert.strictEqual(yyyymm(new Date(2026,8,1)),'2026-09'));
T('TC-Q-005','yyyymm lexically sortable', () => assert.ok(yyyymm(new Date(2025,11,1)) < yyyymm(new Date(2026,0,1))));
T('TC-Q-006','dToYMD May 1', () => assert.strictEqual(dToYMD(new Date(2026,4,1)),'2026-05-01'));
T('TC-Q-007','dToYMD Dec 31', () => assert.strictEqual(dToYMD(new Date(2025,11,31)),'2025-12-31'));
T('TC-Q-008','dToYMD pads single digit', () => assert.strictEqual(dToYMD(new Date(2026,0,5)),'2026-01-05'));
T('TC-Q-009','dToYMD round-trips strToDate', () => assert.strictEqual(dToYMD(strToDate('2024-02-29')),'2024-02-29'));
T('TC-Q-010','clamp inside range', () => assert.strictEqual(clamp(50,0,100),50));
T('TC-Q-011','clamp below min', () => assert.strictEqual(clamp(-5,0,100),0));
T('TC-Q-012','clamp above max', () => assert.strictEqual(clamp(150,0,100),100));
T('TC-Q-013','clamp at min boundary', () => assert.strictEqual(clamp(0,0,100),0));
T('TC-Q-014','clamp at max boundary', () => assert.strictEqual(clamp(100,0,100),100));
T('TC-Q-015','clamp with negative range', () => assert.strictEqual(clamp(-50,-100,-10),-50));

/* ═══════════════════════════════════════════════════════════════════════════
   R.  RECURRING DUE CHECK  (TC-R-001..R-020)
   ═══════════════════════════════════════════════════════════════════════════ */
const today1 = new Date(2026,4,13);   /* May 13 2026 */
const today2 = new Date(2026,4,1);    /* May 1  2026 */

T('TC-R-001','due when day=13, today=May 13, not yet run', () => assert.strictEqual(recurringIsDue({dayOfMonth:13,lastRunYYYYMM:''}, today1), true));
T('TC-R-002','not due when day=14 (future)', () => assert.strictEqual(recurringIsDue({dayOfMonth:14,lastRunYYYYMM:''}, today1), false));
T('TC-R-003','not due when already run this month', () => assert.strictEqual(recurringIsDue({dayOfMonth:5,lastRunYYYYMM:'2026-05'}, today1), false));
T('TC-R-004','due when last run was previous month', () => assert.strictEqual(recurringIsDue({dayOfMonth:1,lastRunYYYYMM:'2026-04'}, today1), true));
T('TC-R-005','due on day=1 if today=1', () => assert.strictEqual(recurringIsDue({dayOfMonth:1,lastRunYYYYMM:''}, today2), true));
T('TC-R-006','not due day=2 if today=1', () => assert.strictEqual(recurringIsDue({dayOfMonth:2,lastRunYYYYMM:''}, today2), false));
T('TC-R-007','idempotent — same lastRun blocks re-fire', () => { const r={dayOfMonth:5,lastRunYYYYMM:'2026-05'}; assert.strictEqual(recurringIsDue(r,today1), false); });
T('TC-R-008','due on day=28 (max valid)', () => assert.strictEqual(recurringIsDue({dayOfMonth:28,lastRunYYYYMM:''}, new Date(2026,4,28)), true));
T('TC-R-009','not due day=28 if today=27', () => assert.strictEqual(recurringIsDue({dayOfMonth:28,lastRunYYYYMM:''}, new Date(2026,4,27)), false));
T('TC-R-010','due when last run was older month', () => assert.strictEqual(recurringIsDue({dayOfMonth:1,lastRunYYYYMM:'2026-01'}, today1), true));
T('TC-R-011','due day=13 today=13 prev-month run', () => assert.strictEqual(recurringIsDue({dayOfMonth:13,lastRunYYYYMM:'2026-04'}, today1), true));
T('TC-R-012','due bumps idempotent after success simulation', () => { const r={dayOfMonth:1,lastRunYYYYMM:''}; assert.ok(recurringIsDue(r,today1)); r.lastRunYYYYMM='2026-05'; assert.ok(!recurringIsDue(r,today1)); });
T('TC-R-013','RECURRING_HEADERS shape sanity', () => { const headers=['Id','Label','Amount','Category','DayOfMonth','LastRunYYYYMM','CreatedAt']; assert.strictEqual(headers.length,7); });
T('TC-R-014','recurring amount parse via float', () => assert.strictEqual(parseFloat('499.5'), 499.5));
T('TC-R-015','recurring day parse via int', () => assert.strictEqual(parseInt('5'), 5));
T('TC-R-016','recurring filter discards empty id', () => { const rows=[{id:'',label:'X',amount:1},{id:'r1',label:'Y',amount:1}]; const ok=rows.filter(r=>r.id && r.label && r.amount>0); assert.strictEqual(ok.length,1); });
T('TC-R-017','recurring filter discards 0 amount', () => { const rows=[{id:'r1',label:'X',amount:0}]; const ok=rows.filter(r=>r.id && r.label && r.amount>0); assert.strictEqual(ok.length,0); });
T('TC-R-018','recurring across year boundary', () => assert.strictEqual(recurringIsDue({dayOfMonth:1,lastRunYYYYMM:'2025-12'}, new Date(2026,0,1)), true));
T('TC-R-019','two recurring same day: both due', () => { const a={dayOfMonth:5,lastRunYYYYMM:''},b={dayOfMonth:5,lastRunYYYYMM:''}; assert.ok(recurringIsDue(a,today1) && recurringIsDue(b,today1)); });
T('TC-R-020','recurring lastRun lexicographic compare', () => assert.ok('2026-04' < '2026-05'));

/* ═══════════════════════════════════════════════════════════════════════════
   S.  GOAL AUTO-CREDIT MATH  (TC-S-001..S-030)
   ═══════════════════════════════════════════════════════════════════════════ */
T('TC-S-001','single goal, single good month, full headroom', () => {
  const out = autoCreditCalc([{year:2026,month:4,budget:1000,spent:600}],
                             [{target:5000,saved:0,lastCreditedYYYYMM:''}], '2026-05');
  assert.strictEqual(out[0].saved, 400);
});
T('TC-S-002','single goal lastCreditedYYYYMM updated', () => {
  const out = autoCreditCalc([{year:2026,month:4,budget:1000,spent:600}],
                             [{target:5000,saved:0,lastCreditedYYYYMM:''}], '2026-05');
  assert.strictEqual(out[0].lastCreditedYYYYMM, '2026-04');
});
T('TC-S-003','current month NOT eligible', () => {
  const out = autoCreditCalc([{year:2026,month:5,budget:1000,spent:500}],
                             [{target:5000,saved:0,lastCreditedYYYYMM:''}], '2026-05');
  assert.strictEqual(out[0].saved, 0);
});
T('TC-S-004','bad month NOT eligible', () => {
  const out = autoCreditCalc([{year:2026,month:4,budget:1000,spent:1100}],
                             [{target:5000,saved:0,lastCreditedYYYYMM:''}], '2026-05');
  assert.strictEqual(out[0].saved, 0);
});
T('TC-S-005','zero budget NOT eligible', () => {
  const out = autoCreditCalc([{year:2026,month:4,budget:0,spent:0}],
                             [{target:5000,saved:0,lastCreditedYYYYMM:''}], '2026-05');
  assert.strictEqual(out[0].saved, 0);
});
T('TC-S-006','splits across 2 active goals evenly', () => {
  const out = autoCreditCalc([{year:2026,month:4,budget:1000,spent:600}],
    [{target:5000,saved:0,lastCreditedYYYYMM:''},{target:5000,saved:0,lastCreditedYYYYMM:''}], '2026-05');
  assert.strictEqual(out[0].saved, 200);
  assert.strictEqual(out[1].saved, 200);
});
T('TC-S-007','already-credited goal skipped', () => {
  const out = autoCreditCalc([{year:2026,month:4,budget:1000,spent:600}],
                             [{target:5000,saved:100,lastCreditedYYYYMM:'2026-04'}], '2026-05');
  assert.strictEqual(out[0].saved, 100);
});
T('TC-S-008','completed goal skipped', () => {
  const out = autoCreditCalc([{year:2026,month:4,budget:1000,spent:600}],
                             [{target:100,saved:100,lastCreditedYYYYMM:''}], '2026-05');
  assert.strictEqual(out[0].saved, 100);
});
T('TC-S-009','headroom cap respected', () => {
  const out = autoCreditCalc([{year:2026,month:4,budget:1000,spent:0}],
                             [{target:500,saved:0,lastCreditedYYYYMM:''}], '2026-05');
  assert.strictEqual(out[0].saved, 500);   /* capped at target */
});
T('TC-S-010','multiple eligible months stack', () => {
  const out = autoCreditCalc(
    [{year:2026,month:2,budget:1000,spent:800},{year:2026,month:3,budget:1000,spent:700}],
    [{target:5000,saved:0,lastCreditedYYYYMM:''}], '2026-05');
  assert.strictEqual(out[0].saved, 500); /* 200 + 300 */
});
T('TC-S-011','multiple months but only last applies', () => {
  const out = autoCreditCalc([{year:2026,month:3,budget:1000,spent:700}],
                             [{target:5000,saved:0,lastCreditedYYYYMM:'2026-02'}], '2026-05');
  assert.strictEqual(out[0].lastCreditedYYYYMM, '2026-03');
});
T('TC-S-012','no eligible budgets → goals unchanged', () => {
  const out = autoCreditCalc([], [{target:5000,saved:100,lastCreditedYYYYMM:''}], '2026-05');
  assert.strictEqual(out[0].saved, 100);
});
T('TC-S-013','no goals → no error', () => {
  assert.deepStrictEqual(autoCreditCalc([{year:2026,month:4,budget:1000,spent:500}], [], '2026-05'), []);
});
T('TC-S-014','mixed completed + active: only active credited', () => {
  const out = autoCreditCalc([{year:2026,month:4,budget:1000,spent:600}],
    [{target:100,saved:100,lastCreditedYYYYMM:''},{target:5000,saved:0,lastCreditedYYYYMM:''}], '2026-05');
  assert.strictEqual(out[0].saved, 100);
  assert.strictEqual(out[1].saved, 400);
});
T('TC-S-015','3 goals split equally', () => {
  const out = autoCreditCalc([{year:2026,month:4,budget:1200,spent:300}],
    [{target:5000,saved:0,lastCreditedYYYYMM:''},{target:5000,saved:0,lastCreditedYYYYMM:''},{target:5000,saved:0,lastCreditedYYYYMM:''}], '2026-05');
  out.forEach(g => assert.strictEqual(g.saved, 300));
});
T('TC-S-016','goal headroom respected with split', () => {
  const out = autoCreditCalc([{year:2026,month:4,budget:1000,spent:200}],
    [{target:100,saved:0,lastCreditedYYYYMM:''},{target:5000,saved:0,lastCreditedYYYYMM:''}], '2026-05');
  assert.strictEqual(out[0].saved, 100);   /* capped */
  assert.strictEqual(out[1].saved, 400);   /* gets full half */
});
T('TC-S-017','goalProgress 50%', () => assert.strictEqual(goalProgress({target:1000,saved:500}), 50));
T('TC-S-018','goalProgress 0%', () => assert.strictEqual(goalProgress({target:1000,saved:0}), 0));
T('TC-S-019','goalProgress 100%', () => assert.strictEqual(goalProgress({target:1000,saved:1000}), 100));
T('TC-S-020','goalProgress clamps >100', () => assert.strictEqual(goalProgress({target:1000,saved:2000}), 100));
T('TC-S-021','goalProgress zero target safe', () => assert.strictEqual(goalProgress({target:0,saved:500}), 0));
T('TC-S-022','goalDone true at exact target', () => assert.strictEqual(goalDone({target:1000,saved:1000}), true));
T('TC-S-023','goalDone true above target', () => assert.strictEqual(goalDone({target:1000,saved:1500}), true));
T('TC-S-024','goalDone false below target', () => assert.strictEqual(goalDone({target:1000,saved:999}), false));
T('TC-S-025','goalDone false zero target', () => assert.strictEqual(goalDone({target:0,saved:0}), false));
T('TC-S-026','GOALS_HEADERS shape', () => { const headers=['Id','Label','Target','Saved','Deadline','CreatedAt','LastCreditedYYYYMM']; assert.strictEqual(headers.length, 7); });
T('TC-S-027','lex compare 2026-04 < 2026-05', () => assert.ok('2026-04' < '2026-05'));
T('TC-S-028','already-credited-this-month idempotency', () => {
  const out = autoCreditCalc([{year:2026,month:4,budget:1000,spent:600}],
                             [{target:5000,saved:0,lastCreditedYYYYMM:'2026-04'}], '2026-05');
  assert.strictEqual(out[0].saved, 0);
});
T('TC-S-029','partial savings → partial credit, not overflow', () => {
  const out = autoCreditCalc([{year:2026,month:4,budget:1000,spent:999}],
                             [{target:5000,saved:0,lastCreditedYYYYMM:''}], '2026-05');
  assert.strictEqual(out[0].saved, 1);
});
T('TC-S-030','huge headroom doesn\'t exceed savings', () => {
  const out = autoCreditCalc([{year:2026,month:4,budget:1000,spent:500}],
                             [{target:1000000,saved:0,lastCreditedYYYYMM:''}], '2026-05');
  assert.strictEqual(out[0].saved, 500);
});

/* ═══════════════════════════════════════════════════════════════════════════
   U.  AI CATEGORY SUGGESTION  (TC-U-001..U-050)
   ═══════════════════════════════════════════════════════════════════════════ */
T('TC-U-001','keyword: "swiggy" → food', () => { _resetCatHistory(); assert.strictEqual(suggestCategoryFromNote('swiggy'),'food'); });
T('TC-U-002','keyword: "zomato" → food', () => { _resetCatHistory(); assert.strictEqual(suggestCategoryFromNote('zomato'),'food'); });
T('TC-U-003','keyword: "starbucks" → food', () => { _resetCatHistory(); assert.strictEqual(suggestCategoryFromNote('starbucks Bandra'),'food'); });
T('TC-U-004','keyword: "dominos pizza" → food', () => { _resetCatHistory(); assert.strictEqual(suggestCategoryFromNote('dominos pizza'),'food'); });
T('TC-U-005','keyword: "biryani" → food', () => { _resetCatHistory(); assert.strictEqual(suggestCategoryFromNote('biryani'),'food'); });
T('TC-U-006','keyword: "dosa" → food', () => { _resetCatHistory(); assert.strictEqual(suggestCategoryFromNote('dosa breakfast'),'food'); });
T('TC-U-007','keyword: "tea coffee" → food', () => { _resetCatHistory(); assert.strictEqual(suggestCategoryFromNote('tea coffee'),'food'); });
T('TC-U-008','keyword: "zepto" → grocery', () => { _resetCatHistory(); assert.strictEqual(suggestCategoryFromNote('zepto delivery'),'grocery'); });
T('TC-U-009','keyword: "blinkit" → grocery', () => { _resetCatHistory(); assert.strictEqual(suggestCategoryFromNote('blinkit'),'grocery'); });
T('TC-U-010','keyword: "bigbasket" → grocery', () => { _resetCatHistory(); assert.strictEqual(suggestCategoryFromNote('bigbasket order'),'grocery'); });
T('TC-U-011','keyword: "dmart" → grocery', () => { _resetCatHistory(); assert.strictEqual(suggestCategoryFromNote('dmart visit'),'grocery'); });
T('TC-U-012','keyword: "kirana" → grocery', () => { _resetCatHistory(); assert.strictEqual(suggestCategoryFromNote('kirana store'),'grocery'); });
T('TC-U-013','keyword: "vegetable" → market', () => { _resetCatHistory(); assert.strictEqual(suggestCategoryFromNote('vegetable mandi'),'market'); });
T('TC-U-014','keyword: "sabzi" → market', () => { _resetCatHistory(); assert.strictEqual(suggestCategoryFromNote('sabzi fresh'),'market'); });
T('TC-U-015','keyword: "fruit" → market', () => { _resetCatHistory(); assert.strictEqual(suggestCategoryFromNote('fruit basket'),'market'); });
T('TC-U-016','keyword: "pharmacy" → medicine', () => { _resetCatHistory(); assert.strictEqual(suggestCategoryFromNote('pharmacy run'),'medicine'); });
T('TC-U-017','keyword: "doctor" → medicine', () => { _resetCatHistory(); assert.strictEqual(suggestCategoryFromNote('doctor visit'),'medicine'); });
T('TC-U-018','keyword: "apollo" → medicine', () => { _resetCatHistory(); assert.strictEqual(suggestCategoryFromNote('apollo hospital'),'medicine'); });
T('TC-U-019','keyword: "dental" → medicine', () => { _resetCatHistory(); assert.strictEqual(suggestCategoryFromNote('dental cleaning'),'medicine'); });
T('TC-U-020','keyword: "petrol" → petrol', () => { _resetCatHistory(); assert.strictEqual(suggestCategoryFromNote('petrol fill'),'petrol'); });
T('TC-U-021','keyword: "fuel" → petrol', () => { _resetCatHistory(); assert.strictEqual(suggestCategoryFromNote('fuel'),'petrol'); });
T('TC-U-022','keyword: "diesel" → petrol', () => { _resetCatHistory(); assert.strictEqual(suggestCategoryFromNote('diesel pump'),'petrol'); });
T('TC-U-023','keyword: "indianoil" → petrol', () => { _resetCatHistory(); assert.strictEqual(suggestCategoryFromNote('indianoil station'),'petrol'); });
T('TC-U-024','keyword: "recharge" → recharge', () => { _resetCatHistory(); assert.strictEqual(suggestCategoryFromNote('recharge mobile'),'recharge'); });
T('TC-U-025','keyword: "jio" → recharge', () => { _resetCatHistory(); assert.strictEqual(suggestCategoryFromNote('jio postpaid'),'recharge'); });
T('TC-U-026','keyword: "airtel broadband" → recharge', () => { _resetCatHistory(); assert.strictEqual(suggestCategoryFromNote('airtel broadband'),'recharge'); });
T('TC-U-027','keyword: "wifi" → recharge', () => { _resetCatHistory(); assert.strictEqual(suggestCategoryFromNote('wifi bill'),'recharge'); });
T('TC-U-028','keyword: "bisleri" → water', () => { _resetCatHistory(); assert.strictEqual(suggestCategoryFromNote('bisleri delivery'),'water'); });
T('TC-U-029','keyword: "water" → water', () => { _resetCatHistory(); assert.strictEqual(suggestCategoryFromNote('water can'),'water'); });
T('TC-U-030','keyword: "kinley" → water', () => { _resetCatHistory(); assert.strictEqual(suggestCategoryFromNote('kinley'),'water'); });
T('TC-U-031','keyword: "gift" → gifts', () => { _resetCatHistory(); assert.strictEqual(suggestCategoryFromNote('gift hamper'),'gifts'); });
T('TC-U-032','keyword: "birthday" → gifts', () => { _resetCatHistory(); assert.strictEqual(suggestCategoryFromNote('birthday gift for amma'),'gifts'); });
T('TC-U-033','keyword: "anniversary" → gifts', () => { _resetCatHistory(); assert.strictEqual(suggestCategoryFromNote('anniversary present'),'gifts'); });
T('TC-U-034','merchant: "uber" → other', () => { _resetCatHistory(); assert.strictEqual(suggestCategoryFromNote('uber ride home'),'other'); });
T('TC-U-035','merchant: "ola" → other', () => { _resetCatHistory(); assert.strictEqual(suggestCategoryFromNote('ola airport'),'other'); });
T('TC-U-036','merchant: "amazon" → other', () => { _resetCatHistory(); assert.strictEqual(suggestCategoryFromNote('amazon order'),'other'); });
T('TC-U-037','merchant: "flipkart" → other', () => { _resetCatHistory(); assert.strictEqual(suggestCategoryFromNote('flipkart sale'),'other'); });
T('TC-U-038','merchant: "netflix" → recharge', () => { _resetCatHistory(); assert.strictEqual(suggestCategoryFromNote('netflix renewal'),'recharge'); });
T('TC-U-039','merchant: "spotify" → recharge', () => { _resetCatHistory(); assert.strictEqual(suggestCategoryFromNote('spotify monthly'),'recharge'); });
T('TC-U-040','merchant: "prime" → recharge', () => { _resetCatHistory(); assert.strictEqual(suggestCategoryFromNote('prime renewal'),'recharge'); });
T('TC-U-041','no match → null', () => { _resetCatHistory(); assert.strictEqual(suggestCategoryFromNote('asdfghjkl'),null); });
T('TC-U-042','empty note → null', () => { _resetCatHistory(); assert.strictEqual(suggestCategoryFromNote(''),null); });
T('TC-U-043','null note → null', () => { _resetCatHistory(); assert.strictEqual(suggestCategoryFromNote(null),null); });
T('TC-U-044','history beats keyword', () => {
  _resetCatHistory();
  recordCatHistory('starbucks coffee', 'recharge');  /* user mapped to recharge */
  recordCatHistory('starbucks coffee', 'recharge');
  recordCatHistory('starbucks coffee', 'recharge');
  assert.strictEqual(suggestCategoryFromNote('starbucks today'), 'recharge');
});
T('TC-U-045','history per-token: starbucks generalizes', () => {
  _resetCatHistory();
  recordCatHistory('starbucks bandra', 'food');
  assert.strictEqual(suggestCategoryFromNote('starbucks andheri'), 'food');
});
T('TC-U-046','history records each token', () => {
  _resetCatHistory();
  recordCatHistory('big bazaar grocery run', 'grocery');
  assert.strictEqual(_catHistory['bazaar'].grocery, 1);
  assert.strictEqual(_catHistory['grocery'].grocery, 1);
});
T('TC-U-047','history ignores tokens shorter than 3 chars', () => {
  _resetCatHistory();
  recordCatHistory('go to mart', 'grocery');
  assert.strictEqual(_catHistory['go'], undefined);
  assert.strictEqual(_catHistory['to'], undefined);
  assert.ok(_catHistory['mart']);
});
T('TC-U-048','votes accumulate', () => {
  _resetCatHistory();
  recordCatHistory('chai stand', 'food');
  recordCatHistory('chai stand', 'food');
  recordCatHistory('chai stand', 'food');
  assert.strictEqual(_catHistory['chai'].food, 3);
});
T('TC-U-049','tie-breaker: first cat with highest vote', () => {
  _resetCatHistory();
  recordCatHistory('xyzfoo', 'food');
  recordCatHistory('xyzfoo', 'grocery');
  /* Both have 1 vote — first encountered wins */
  const v = suggestCategoryFromNote('xyzfoo');
  assert.ok(v === 'food' || v === 'grocery');
});
T('TC-U-050','history dominant cat wins on mixed input', () => {
  _resetCatHistory();
  for (let i = 0; i < 5; i++) recordCatHistory('rare term', 'gifts');
  assert.strictEqual(suggestCategoryFromNote('rare term'), 'gifts');
});

/* ═══════════════════════════════════════════════════════════════════════════
   V.  FORECAST MATH  (TC-V-001..V-025)
   ═══════════════════════════════════════════════════════════════════════════ */
T('TC-V-001','forecast null when daysElapsed < 3', () => assert.strictEqual(computeForecastPure(500,2,31,null), null));
T('TC-V-002','forecast OK when daysElapsed >= 3', () => assert.ok(computeForecastPure(900,3,31,null) !== null));
T('TC-V-003','forecast dailyAvg = spend/days', () => assert.strictEqual(computeForecastPure(900,3,31,null).dailyAvg, 300));
T('TC-V-004','forecast projection = avg × monthLength', () => assert.strictEqual(computeForecastPure(900,3,31,null).projected, 9300));
T('TC-V-005','forecast adds recurring remainder', () => assert.strictEqual(computeForecastPure(900,3,31,null,500).projected, 9800));
T('TC-V-006','forecast overBy when over budget', () => assert.strictEqual(computeForecastPure(900,3,31,8000).overBy, 1300));
T('TC-V-007','forecast underBy when under budget', () => assert.strictEqual(computeForecastPure(900,3,31,15000).underBy, 5700));
T('TC-V-008','forecast under cap means overBy=0', () => assert.strictEqual(computeForecastPure(900,3,31,15000).overBy, 0));
T('TC-V-009','forecast over cap means underBy=0', () => assert.strictEqual(computeForecastPure(900,3,31,8000).underBy, 0));
T('TC-V-010','forecast no budget returns 0/0', () => { const f=computeForecastPure(900,3,31,null); assert.strictEqual(f.overBy,0); assert.strictEqual(f.underBy,0); });
T('TC-V-011','forecast last day = avg (no projection growth)', () => assert.strictEqual(computeForecastPure(31000,31,31,null).projected, 31000));
T('TC-V-012','forecast exact budget edge: underBy=0', () => assert.strictEqual(computeForecastPure(310,31,31,310).overBy, 0));
T('TC-V-013','forecast spends 0 → projection 0', () => assert.strictEqual(computeForecastPure(0,3,31,null).projected, 0));
T('TC-V-014','forecast with high recRemaining', () => assert.strictEqual(computeForecastPure(1000,5,30,null,3000).projected, 9000));
T('TC-V-015','forecast 28-day month (Feb)', () => assert.strictEqual(computeForecastPure(500,5,28,null).projected, 2800));
T('TC-V-016','forecast 30-day month (Apr)', () => assert.strictEqual(computeForecastPure(600,3,30,null).projected, 6000));
T('TC-V-017','forecast 31-day month (Jul)', () => assert.strictEqual(computeForecastPure(310,1,31,null), null));  /* daysElapsed < 3 */
T('TC-V-018','forecast small spend large month', () => { const f=computeForecastPure(30,3,30,1000); assert.strictEqual(f.projected, 300); assert.strictEqual(f.underBy, 700); });
T('TC-V-019','forecast huge spend', () => assert.strictEqual(computeForecastPure(100000,10,30,null).projected, 300000));
T('TC-V-020','forecast object shape', () => { const f=computeForecastPure(900,3,31,null); assert.ok(['spentSoFar','dailyAvg','daysElapsed','daysInMonth','projected','budget','overBy','underBy'].every(k => k in f)); });
T('TC-V-021','forecast spentSoFar preserved', () => assert.strictEqual(computeForecastPure(900,3,31,null).spentSoFar, 900));
T('TC-V-022','forecast daysElapsed preserved', () => assert.strictEqual(computeForecastPure(900,3,31,null).daysElapsed, 3));
T('TC-V-023','forecast daysInMonth preserved', () => assert.strictEqual(computeForecastPure(900,3,31,null).daysInMonth, 31));
T('TC-V-024','forecast budget preserved', () => assert.strictEqual(computeForecastPure(900,3,31,10000).budget, 10000));
T('TC-V-025','forecast no budget → budget=0', () => assert.strictEqual(computeForecastPure(900,3,31,null).budget, 0));

/* (W. Sparkline tests removed in v25.4 — feature retired) */

/* ═══════════════════════════════════════════════════════════════════════════
   X.  HEATMAP LEVEL  (TC-X-001..X-020)
   ═══════════════════════════════════════════════════════════════════════════ */
T('TC-X-001','heatmap value 0 → level 0', () => assert.strictEqual(heatmapLevel(0, 1000), 0));
T('TC-X-002','heatmap value=max → level 4', () => assert.strictEqual(heatmapLevel(1000, 1000), 4));
T('TC-X-003','heatmap value 25% of max → level 1', () => assert.strictEqual(heatmapLevel(250, 1000), 1));
T('TC-X-004','heatmap value 50% of max → level 2', () => assert.strictEqual(heatmapLevel(500, 1000), 2));
T('TC-X-005','heatmap value 75% of max → level 3', () => assert.strictEqual(heatmapLevel(750, 1000), 3));
T('TC-X-006','heatmap value 1% of max → level 1', () => assert.strictEqual(heatmapLevel(10, 1000), 1));
T('TC-X-007','heatmap value capped at 4', () => assert.strictEqual(heatmapLevel(5000, 1000), 4));
T('TC-X-008','heatmap level 26% → 2 (ceil)', () => assert.strictEqual(heatmapLevel(260, 1000), 2));
T('TC-X-009','heatmap level 51% → 3 (ceil)', () => assert.strictEqual(heatmapLevel(510, 1000), 3));
T('TC-X-010','heatmap level 76% → 4 (ceil)', () => assert.strictEqual(heatmapLevel(760, 1000), 4));
T('TC-X-011','heatmap max=0 safe', () => assert.strictEqual(heatmapLevel(100, 0), 4));
T('TC-X-012','heatmap negative value yields non-positive level', () => assert.ok(heatmapLevel(-100, 1000) <= 0));
T('TC-X-013','heatmap one tiny value', () => assert.strictEqual(heatmapLevel(1, 1), 4));
T('TC-X-014','heatmap level math: ceil(.5) = 1 → level 1', () => assert.strictEqual(heatmapLevel(125, 1000), 1));
T('TC-X-015','heatmap level exactly at boundary 25%', () => assert.strictEqual(heatmapLevel(250, 1000), 1));
T('TC-X-016','heatmap level just over 25%', () => assert.strictEqual(heatmapLevel(251, 1000), 2));
T('TC-X-017','heatmap level just under 50%', () => assert.strictEqual(heatmapLevel(499, 1000), 2));
T('TC-X-018','heatmap level just over 50%', () => assert.strictEqual(heatmapLevel(501, 1000), 3));
T('TC-X-019','heatmap level just under 75%', () => assert.strictEqual(heatmapLevel(749, 1000), 3));
T('TC-X-020','heatmap level just over 75%', () => assert.strictEqual(heatmapLevel(751, 1000), 4));

/* ═══════════════════════════════════════════════════════════════════════════
   Y.  WHAT-IF MATH  (TC-Y-001..Y-020)
   ═══════════════════════════════════════════════════════════════════════════ */
T('TC-Y-001','what-if zero cuts → current = after', () => { const r = whatIfRecalc({food:1000,grocery:500},{}); assert.strictEqual(r.current, r.after); });
T('TC-Y-002','what-if 100% cut on one cat', () => { const r = whatIfRecalc({food:1000,grocery:500},{food:100}); assert.strictEqual(r.after, 500); });
T('TC-Y-003','what-if 50% cut on all', () => { const r = whatIfRecalc({food:1000,grocery:500},{food:50,grocery:50}); assert.strictEqual(r.after, 750); });
T('TC-Y-004','what-if saved = current - after', () => { const r = whatIfRecalc({food:1000},{food:25}); assert.strictEqual(r.saved, 250); });
T('TC-Y-005','what-if six-month projection = saved * 6', () => { const r = whatIfRecalc({food:1000},{food:25}); assert.strictEqual(r.sixMonth, 1500); });
T('TC-Y-006','what-if no cuts on empty cat → 0 saved', () => { const r = whatIfRecalc({},{food:50}); assert.strictEqual(r.saved, 0); });
T('TC-Y-007','what-if cut on non-existent cat ignored', () => { const r = whatIfRecalc({food:1000},{grocery:50}); assert.strictEqual(r.saved, 0); });
T('TC-Y-008','what-if 0% cut = no savings', () => { const r = whatIfRecalc({food:1000},{food:0}); assert.strictEqual(r.saved, 0); });
T('TC-Y-009','what-if large current', () => { const r = whatIfRecalc({food:50000,grocery:30000,petrol:10000},{food:20,grocery:10,petrol:50}); assert.strictEqual(r.saved, 50000*.2 + 30000*.1 + 10000*.5); });
T('TC-Y-010','what-if values are numeric', () => { const r = whatIfRecalc({food:1000},{food:25}); assert.strictEqual(typeof r.after, 'number'); });
T('TC-Y-011','what-if 1% cut precision', () => { const r = whatIfRecalc({food:10000},{food:1}); assert.strictEqual(r.saved, 100); });
T('TC-Y-012','what-if 99% cut leaves 1%', () => { const r = whatIfRecalc({food:10000},{food:99}); assert.ok(Math.abs(r.after - 100) < 0.001); });
T('TC-Y-013','what-if six-month with multiple cats', () => { const r = whatIfRecalc({a:1000,b:500},{a:50,b:50}); assert.strictEqual(r.sixMonth, (500+250)*6); });
T('TC-Y-014','what-if all 100% cuts → after=0', () => { const r = whatIfRecalc({a:100,b:200,c:300},{a:100,b:100,c:100}); assert.strictEqual(r.after, 0); });
T('TC-Y-015','what-if current sum matches input', () => { const r = whatIfRecalc({a:100,b:200,c:300},{}); assert.strictEqual(r.current, 600); });
T('TC-Y-016','what-if 50% twice in summary', () => { const r = whatIfRecalc({a:1000},{a:50}); assert.strictEqual(r.after, 500); assert.strictEqual(r.saved, 500); });
T('TC-Y-017','what-if accepts strings via Number coercion via *', () => { /* JS quirk: ints work */ const r = whatIfRecalc({a:1000},{a:50}); assert.ok(!isNaN(r.after)); });
T('TC-Y-018','what-if no cut object', () => { const r = whatIfRecalc({a:1000},{}); assert.strictEqual(r.saved, 0); });
T('TC-Y-019','what-if six-month negative impossible (cuts can\'t increase)', () => { const r = whatIfRecalc({a:1000},{a:50}); assert.ok(r.sixMonth >= 0); });
T('TC-Y-020','what-if returns shape', () => { const r = whatIfRecalc({a:1000},{a:50}); assert.ok('current' in r && 'after' in r && 'saved' in r && 'sixMonth' in r); });

/* ═══════════════════════════════════════════════════════════════════════════
   Z.  YEAR-WRAP AGGREGATION  (TC-Z-001..Z-020)
   ═══════════════════════════════════════════════════════════════════════════ */
const YW_EXP = [
  { date:'2025-01-15', category:'food', amount:1000 },
  { date:'2025-02-10', category:'food', amount:1500 },
  { date:'2025-03-05', category:'grocery', amount:500 },
  { date:'2025-03-25', category:'petrol', amount:2000 },
  { date:'2025-12-31', category:'gifts', amount:5000 },
  { date:'2026-01-01', category:'food', amount:200 },  /* different year */
];

T('TC-Z-001','wrap returns null for empty year', () => assert.strictEqual(yearWrapAgg(YW_EXP, 2027), null));
T('TC-Z-002','wrap total for 2025', () => { const w=yearWrapAgg(YW_EXP,2025); assert.strictEqual(w.total, 1000+1500+500+2000+5000); });
T('TC-Z-003','wrap entries count', () => assert.strictEqual(yearWrapAgg(YW_EXP,2025).entries, 5));
T('TC-Z-004','wrap top category = gifts', () => assert.strictEqual(yearWrapAgg(YW_EXP,2025).topCat, 'gifts'));
T('TC-Z-005','wrap top category amount', () => assert.strictEqual(yearWrapAgg(YW_EXP,2025).topCatAmt, 5000));
T('TC-Z-006','wrap biggest day', () => assert.strictEqual(yearWrapAgg(YW_EXP,2025).biggestDay, '2025-12-31'));
T('TC-Z-007','wrap biggest day amount', () => assert.strictEqual(yearWrapAgg(YW_EXP,2025).biggestDayAmt, 5000));
T('TC-Z-008','wrap months tracked count', () => assert.strictEqual(yearWrapAgg(YW_EXP,2025).monthsTracked, 4));
T('TC-Z-009','wrap avg per month', () => { const w=yearWrapAgg(YW_EXP,2025); assert.strictEqual(w.avgPerMonth, w.total / 4); });
T('TC-Z-010','wrap excludes other years', () => { const w=yearWrapAgg(YW_EXP,2025); assert.ok(!Object.keys(w.byDay).some(d => d.startsWith('2026'))); });
T('TC-Z-011','wrap months[] length 12', () => assert.strictEqual(yearWrapAgg(YW_EXP,2025).months.length, 12));
T('TC-Z-012','wrap months[0] Jan = 1000', () => assert.strictEqual(yearWrapAgg(YW_EXP,2025).months[0], 1000));
T('TC-Z-013','wrap months[1] Feb = 1500', () => assert.strictEqual(yearWrapAgg(YW_EXP,2025).months[1], 1500));
T('TC-Z-014','wrap months[2] Mar = 500+2000', () => assert.strictEqual(yearWrapAgg(YW_EXP,2025).months[2], 2500));
T('TC-Z-015','wrap months[11] Dec = 5000', () => assert.strictEqual(yearWrapAgg(YW_EXP,2025).months[11], 5000));
T('TC-Z-016','wrap months[3..10] are zero', () => { const w=yearWrapAgg(YW_EXP,2025); for (let i=3;i<11;i++) assert.strictEqual(w.months[i], 0); });
T('TC-Z-017','wrap byCat sum equals total', () => { const w=yearWrapAgg(YW_EXP,2025); assert.strictEqual(Object.values(w.byCat).reduce((s,n)=>s+n,0), w.total); });
T('TC-Z-018','wrap byDay sum equals total', () => { const w=yearWrapAgg(YW_EXP,2025); assert.strictEqual(Object.values(w.byDay).reduce((s,n)=>s+n,0), w.total); });
T('TC-Z-019','wrap empty list returns null', () => assert.strictEqual(yearWrapAgg([], 2025), null));
T('TC-Z-020','wrap byCat keys are category strings', () => assert.ok(Object.keys(yearWrapAgg(YW_EXP,2025).byCat).every(k => typeof k === 'string')));

/* ═══════════════════════════════════════════════════════════════════════════
   AA. CSV EXPORT FORMAT  (TC-AA-001..AA-020)
   ═══════════════════════════════════════════════════════════════════════════ */
T('TC-AA-001','csvEscape plain string', () => assert.strictEqual(csvEscape('hello'), 'hello'));
T('TC-AA-002','csvEscape with comma quoted', () => assert.strictEqual(csvEscape('a,b'), '"a,b"'));
T('TC-AA-003','csvEscape with quote doubled', () => assert.strictEqual(csvEscape('say "hi"'), '"say ""hi"""'));
T('TC-AA-004','csvEscape with newline quoted', () => assert.strictEqual(csvEscape('line1\nline2'), '"line1\nline2"'));
T('TC-AA-005','csvEscape null → empty', () => assert.strictEqual(csvEscape(null), ''));
T('TC-AA-006','csvEscape undefined → empty', () => assert.strictEqual(csvEscape(undefined), ''));
T('TC-AA-007','csvEscape number coerced', () => assert.strictEqual(csvEscape(42), '42'));
T('TC-AA-008','csvEscape empty string', () => assert.strictEqual(csvEscape(''), ''));
T('TC-AA-009','toCSV single row', () => assert.strictEqual(toCSV([['a','b','c']]), 'a,b,c'));
T('TC-AA-010','toCSV multiple rows', () => assert.strictEqual(toCSV([['a','b'],['c','d']]), 'a,b\nc,d'));
T('TC-AA-011','toCSV mixed types', () => assert.strictEqual(toCSV([['date',42,null]]), 'date,42,'));
T('TC-AA-012','toCSV header + data row', () => assert.strictEqual(toCSV([['Date','Amount'],['2026-05-13',200]]), 'Date,Amount\n2026-05-13,200'));
T('TC-AA-013','toCSV with comma in cell', () => assert.strictEqual(toCSV([['a, b','c']]), '"a, b",c'));
T('TC-AA-014','toCSV with quote in cell', () => assert.strictEqual(toCSV([['a"b','c']]), '"a""b",c'));
T('TC-AA-015','toCSV with newline in cell', () => assert.strictEqual(toCSV([['a\nb','c']]), '"a\nb",c'));
T('TC-AA-016','toCSV empty rows', () => assert.strictEqual(toCSV([]), ''));
T('TC-AA-017','toCSV preserves order', () => assert.strictEqual(toCSV([['1','2','3']]), '1,2,3'));
T('TC-AA-018','csvEscape with all 3 special chars', () => assert.strictEqual(csvEscape('a,b"c\nd'), '"a,b""c\nd"'));
T('TC-AA-019','csvEscape preserves spaces', () => assert.strictEqual(csvEscape('hello world'), 'hello world'));
T('TC-AA-020','csvEscape with leading/trailing space', () => assert.strictEqual(csvEscape(' a '), ' a '));

/* ═══════════════════════════════════════════════════════════════════════════
   AB. EXPORT RANGE  (TC-AB-001..AB-015)
   ═══════════════════════════════════════════════════════════════════════════ */
T('TC-AB-001','this-month from = 1st of month', () => assert.strictEqual(exportRange('this-month').from, '2026-05-01'));
T('TC-AB-002','this-month to = last day of month', () => assert.strictEqual(exportRange('this-month').to, '2026-05-31'));
T('TC-AB-003','last-month from', () => assert.strictEqual(exportRange('last-month').from, '2026-04-01'));
T('TC-AB-004','last-month to = April 30', () => assert.strictEqual(exportRange('last-month').to, '2026-04-30'));
T('TC-AB-005','this-year from = Jan 1', () => assert.strictEqual(exportRange('this-year').from, '2026-01-01'));
T('TC-AB-006','this-year to = Dec 31', () => assert.strictEqual(exportRange('this-year').to, '2026-12-31'));
T('TC-AB-007','last-year from = 2025-01-01', () => assert.strictEqual(exportRange('last-year').from, '2025-01-01'));
T('TC-AB-008','last-year to = 2025-12-31', () => assert.strictEqual(exportRange('last-year').to, '2025-12-31'));
T('TC-AB-009','all from = 0000-01-01', () => assert.strictEqual(exportRange('all').from, '0000-01-01'));
T('TC-AB-010','all to = 9999-12-31', () => assert.strictEqual(exportRange('all').to, '9999-12-31'));
T('TC-AB-011','unknown range falls to all', () => assert.deepStrictEqual(exportRange('xyz'), exportRange('all')));
T('TC-AB-012','last-month Feb leap year', () => { const r=exportRange('last-month', new Date(2024,2,15)); assert.strictEqual(r.to, '2024-02-29'); });
T('TC-AB-013','last-month Feb non-leap', () => { const r=exportRange('last-month', new Date(2025,2,15)); assert.strictEqual(r.to, '2025-02-28'); });
T('TC-AB-014','last-month from Jan = previous year Dec', () => { const r=exportRange('last-month', new Date(2026,0,15)); assert.strictEqual(r.from, '2025-12-01'); });
T('TC-AB-015','last-month to from Jan = 2025-12-31', () => { const r=exportRange('last-month', new Date(2026,0,15)); assert.strictEqual(r.to, '2025-12-31'); });

/* ═══════════════════════════════════════════════════════════════════════════
   AC. URL QUICKADD PARSING  (TC-AC-001..AC-010)
   ═══════════════════════════════════════════════════════════════════════════ */
T('TC-AC-001','parse quickadd=food', () => assert.strictEqual(parseQuickaddURL('https://x.com/?quickadd=food'), 'food'));
T('TC-AC-002','parse quickadd=grocery', () => assert.strictEqual(parseQuickaddURL('https://x.com/?quickadd=grocery'), 'grocery'));
T('TC-AC-003','parse quickadd=petrol', () => assert.strictEqual(parseQuickaddURL('https://x.com/?quickadd=petrol'), 'petrol'));
T('TC-AC-004','parse quickadd=voice', () => assert.strictEqual(parseQuickaddURL('https://x.com/?quickadd=voice'), 'voice'));
T('TC-AC-005','parse missing param → null', () => assert.strictEqual(parseQuickaddURL('https://x.com/'), null));
T('TC-AC-006','parse other params no quickadd', () => assert.strictEqual(parseQuickaddURL('https://x.com/?utm=src'), null));
T('TC-AC-007','parse multiple params first wins', () => assert.strictEqual(parseQuickaddURL('https://x.com/?quickadd=food&utm=x'), 'food'));
T('TC-AC-008','parse invalid URL → null', () => assert.strictEqual(parseQuickaddURL('not a url'), null));
T('TC-AC-009','parse with hash fragment', () => assert.strictEqual(parseQuickaddURL('https://x.com/?quickadd=food#hash'), 'food'));
T('TC-AC-010','parse with subdir', () => assert.strictEqual(parseQuickaddURL('https://x.com/sub/?quickadd=grocery'), 'grocery'));

/* ═══════════════════════════════════════════════════════════════════════════
   AD. TODAY HERO MATH  (TC-AD-001..AD-015)
   ═══════════════════════════════════════════════════════════════════════════ */
T('TC-AD-001','no budget → allowance 0', () => assert.strictEqual(todayHeroMath(100, 0, 31).allowance, 0));
T('TC-AD-002','allowance = budget / daysInMonth', () => assert.strictEqual(todayHeroMath(100, 31000, 31).allowance, 1000));
T('TC-AD-003','pct clamped to 100', () => assert.strictEqual(todayHeroMath(2000, 31000, 31).pct, 100));
T('TC-AD-004','pct 0 when no spend', () => assert.strictEqual(todayHeroMath(0, 31000, 31).pct, 0));
T('TC-AD-005','remaining = allowance - spend', () => assert.strictEqual(todayHeroMath(300, 31000, 31).remaining, 700));
T('TC-AD-006','remaining 0 when over', () => assert.strictEqual(todayHeroMath(2000, 31000, 31).remaining, 0));
T('TC-AD-007','overBy = spend - allowance', () => assert.strictEqual(todayHeroMath(1500, 31000, 31).overBy, 500));
T('TC-AD-008','overBy 0 when under', () => assert.strictEqual(todayHeroMath(500, 31000, 31).overBy, 0));
T('TC-AD-009','over=true when over allowance', () => assert.strictEqual(todayHeroMath(1500, 31000, 31).over, true));
T('TC-AD-010','over=false when under', () => assert.strictEqual(todayHeroMath(500, 31000, 31).over, false));
T('TC-AD-011','over=false at exact', () => assert.strictEqual(todayHeroMath(1000, 31000, 31).over, false));
T('TC-AD-012','pct at 50%', () => assert.strictEqual(todayHeroMath(500, 31000, 31).pct, 50));
T('TC-AD-013','30-day month allowance', () => assert.strictEqual(todayHeroMath(0, 30000, 30).allowance, 1000));
T('TC-AD-014','28-day Feb allowance', () => assert.strictEqual(todayHeroMath(0, 28000, 28).allowance, 1000));
T('TC-AD-015','pct rounds within bounds', () => { const r=todayHeroMath(333, 31000, 31); assert.ok(r.pct >= 0 && r.pct <= 100); });

/* ═══════════════════════════════════════════════════════════════════════════
   AE. SEARCH FILTER  (TC-AE-001..AE-020)
   ═══════════════════════════════════════════════════════════════════════════ */
const SEARCH_CATMAP = {
  food:    { label: 'Food', icon: '🍔', color: '#E23744' },
  grocery: { label: 'Grocery', icon: '🛒', color: '#1BA672' },
  petrol:  { label: 'Petrol', icon: '⛽', color: '#FF7E36' },
};
const SEARCH_EXPS = [
  { date:'2026-05-13', category:'food',    amount:200, note:'Swiggy' },
  { date:'2026-05-12', category:'grocery', amount:1500, note:'DMart' },
  { date:'2026-05-11', category:'petrol',  amount:1000, note:'IOCL pump' },
  { date:'2026-05-10', category:'food',    amount:200, note:'Starbucks' },
];
T('TC-AE-001','empty query returns []', () => assert.strictEqual(searchMatch(SEARCH_EXPS,'',SEARCH_CATMAP).length, 0));
T('TC-AE-002','category label match', () => { const r=searchMatch(SEARCH_EXPS,'food',SEARCH_CATMAP); assert.strictEqual(r.length, 2); });
T('TC-AE-003','category key match', () => { const r=searchMatch(SEARCH_EXPS,'grocery',SEARCH_CATMAP); assert.strictEqual(r.length, 1); });
T('TC-AE-004','note substring match', () => { const r=searchMatch(SEARCH_EXPS,'swiggy',SEARCH_CATMAP); assert.strictEqual(r.length, 1); });
T('TC-AE-005','partial note match', () => { const r=searchMatch(SEARCH_EXPS,'mart',SEARCH_CATMAP); assert.strictEqual(r.length, 1); });
T('TC-AE-006','amount equality match', () => { const r=searchMatch(SEARCH_EXPS,'200',SEARCH_CATMAP); assert.strictEqual(r.length, 2); });
T('TC-AE-007','amount no match', () => { const r=searchMatch(SEARCH_EXPS,'9999',SEARCH_CATMAP); assert.strictEqual(r.length, 0); });
T('TC-AE-008','sorted desc by date', () => { const r=searchMatch(SEARCH_EXPS,'food',SEARCH_CATMAP); assert.strictEqual(r[0].date, '2026-05-13'); });
T('TC-AE-009','case-insensitive', () => { const r=searchMatch(SEARCH_EXPS,'SWIGGY',SEARCH_CATMAP); assert.strictEqual(r.length, 1); });
T('TC-AE-010','iocl match', () => { const r=searchMatch(SEARCH_EXPS,'iocl',SEARCH_CATMAP); assert.strictEqual(r.length, 1); });
T('TC-AE-011','garbage returns 0', () => { const r=searchMatch(SEARCH_EXPS,'qwertyu',SEARCH_CATMAP); assert.strictEqual(r.length, 0); });
T('TC-AE-012','empty list returns []', () => { const r=searchMatch([],'food',SEARCH_CATMAP); assert.strictEqual(r.length, 0); });
T('TC-AE-013','search includes both 200 entries', () => { const r=searchMatch(SEARCH_EXPS,'200',SEARCH_CATMAP); assert.strictEqual(r.length, 2); });
T('TC-AE-014','search by amount preserves order desc', () => { const r=searchMatch(SEARCH_EXPS,'200',SEARCH_CATMAP); assert.strictEqual(r[0].date,'2026-05-13'); });
T('TC-AE-015','search "petrol" returns one', () => { const r=searchMatch(SEARCH_EXPS,'petrol',SEARCH_CATMAP); assert.strictEqual(r.length, 1); });
T('TC-AE-016','search empty string after trim', () => { const r=searchMatch(SEARCH_EXPS,'   ',SEARCH_CATMAP); assert.strictEqual(r.length, 0); });
T('TC-AE-017','search by decimal amount no match if off by 1', () => { const r=searchMatch(SEARCH_EXPS,'201',SEARCH_CATMAP); assert.strictEqual(r.length, 0); });
T('TC-AE-018','search by category fragment "food"', () => { const r=searchMatch(SEARCH_EXPS,'fo',SEARCH_CATMAP); assert.strictEqual(r.length, 2); });
T('TC-AE-019','search ignores null entries safely', () => { const r=searchMatch([null,...SEARCH_EXPS],'food',SEARCH_CATMAP); assert.strictEqual(r.length, 2); });
T('TC-AE-020','search by category icon NOT a match', () => { const r=searchMatch(SEARCH_EXPS,'🍔',SEARCH_CATMAP); assert.strictEqual(r.length, 0); });

/* ═══════════════════════════════════════════════════════════════════════════
   AF. UNDO STATE MACHINE  (TC-AF-001..AF-010)
   ═══════════════════════════════════════════════════════════════════════════ */
function makeUndoMachine() {
  let pending = null;
  let timer = 0;
  return {
    onDelete(item) { pending = item; timer = Date.now(); },
    canUndo(nowMs = Date.now(), windowMs = 5000) { return pending !== null && (nowMs - timer) < windowMs; },
    undo() { const out = pending; pending = null; timer = 0; return out; },
    expire() { pending = null; timer = 0; },
    get pending() { return pending; },
  };
}
T('TC-AF-001','onDelete sets pending', () => { const m=makeUndoMachine(); m.onDelete({rowIndex:5}); assert.deepStrictEqual(m.pending,{rowIndex:5}); });
T('TC-AF-002','canUndo true right after delete', () => { const m=makeUndoMachine(); m.onDelete({rowIndex:1}); assert.strictEqual(m.canUndo(), true); });
T('TC-AF-003','canUndo false initially', () => { const m=makeUndoMachine(); assert.strictEqual(m.canUndo(), false); });
T('TC-AF-004','canUndo false after 5s+', () => { const m=makeUndoMachine(); m.onDelete({rowIndex:1}); assert.strictEqual(m.canUndo(Date.now()+6000), false); });
T('TC-AF-005','canUndo true within window', () => { const m=makeUndoMachine(); m.onDelete({rowIndex:1}); assert.strictEqual(m.canUndo(Date.now()+3000), true); });
T('TC-AF-006','undo returns pending and clears', () => { const m=makeUndoMachine(); m.onDelete({rowIndex:1}); assert.deepStrictEqual(m.undo(),{rowIndex:1}); assert.strictEqual(m.pending, null); });
T('TC-AF-007','undo on empty returns null', () => { const m=makeUndoMachine(); assert.strictEqual(m.undo(), null); });
T('TC-AF-008','expire clears pending', () => { const m=makeUndoMachine(); m.onDelete({a:1}); m.expire(); assert.strictEqual(m.pending, null); });
T('TC-AF-009','delete after expire stores new', () => { const m=makeUndoMachine(); m.onDelete({a:1}); m.expire(); m.onDelete({a:2}); assert.deepStrictEqual(m.pending,{a:2}); });
T('TC-AF-010','double delete: latest wins', () => { const m=makeUndoMachine(); m.onDelete({a:1}); m.onDelete({a:2}); assert.deepStrictEqual(m.undo(),{a:2}); });

/* ═══════════════════════════════════════════════════════════════════════════
   AG. VOICE AUTO-SAVE FLOW  (TC-AG-001..AG-010)
   ═══════════════════════════════════════════════════════════════════════════ */
function routeVoice(parsed, voiceAutoSave) {
  /* When voiceAutoSave=true and parsed has amount+category, route to autosave.
     Otherwise show preview card. */
  if (!parsed) return 'fail';
  if (parsed.intent && parsed.intent !== 'none' && parsed.intent !== 'add') return parsed.intent;
  if (voiceAutoSave && parsed.amount > 0 && parsed.category) return 'auto-save';
  return 'preview';
}
T('TC-AG-001','voice auto-save when toggle on + clean parse', () => assert.strictEqual(routeVoice({amount:200,category:'food'}, true), 'auto-save'));
T('TC-AG-002','voice preview when toggle off', () => assert.strictEqual(routeVoice({amount:200,category:'food'}, false), 'preview'));
T('TC-AG-003','voice preview when no category', () => assert.strictEqual(routeVoice({amount:200}, true), 'preview'));
T('TC-AG-004','voice preview when no amount', () => assert.strictEqual(routeVoice({category:'food'}, true), 'preview'));
T('TC-AG-005','voice routes budget-set intent regardless', () => assert.strictEqual(routeVoice({intent:'budget-set',amount:50000}, true), 'budget-set'));
T('TC-AG-006','voice routes date-query intent', () => assert.strictEqual(routeVoice({intent:'date-query'}, true), 'date-query'));
T('TC-AG-007','voice routes budget-query intent', () => assert.strictEqual(routeVoice({intent:'budget-query'}, true), 'budget-query'));
T('TC-AG-008','voice null parse fails', () => assert.strictEqual(routeVoice(null, true), 'fail'));
T('TC-AG-009','voice none intent falls through', () => assert.strictEqual(routeVoice({intent:'none',amount:200,category:'food'}, true), 'auto-save'));
T('TC-AG-010','voice add intent + autosave', () => assert.strictEqual(routeVoice({intent:'add',amount:200,category:'food'}, true), 'auto-save'));

/* ═══════════════════════════════════════════════════════════════════════════
   AH. ID GENERATION  (TC-AH-001..AH-005)
   ═══════════════════════════════════════════════════════════════════════════ */
function uuid() { return 'r' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4); }
T('TC-AH-001','uuid starts with r', () => assert.ok(uuid().startsWith('r')));
T('TC-AH-002','uuid length > 8', () => assert.ok(uuid().length > 8));
T('TC-AH-003','uuid unique across 1000 calls', () => { const s=new Set(); for (let i=0;i<1000;i++) s.add(uuid()); assert.strictEqual(s.size, 1000); });
T('TC-AH-004','uuid uses base36 chars', () => assert.match(uuid(), /^r[0-9a-z]+$/));
T('TC-AH-005','uuid type string', () => assert.strictEqual(typeof uuid(), 'string'));

/* ═══════════════════════════════════════════════════════════════════════════
   AI. CATEGORY MANAGEMENT  (v25.1)  (TC-AI-001..AI-030)
   ═══════════════════════════════════════════════════════════════════════════ */
const _CAT_BUILTINS = [
  { key:'food' }, { key:'grocery' }, { key:'market' }, { key:'medicine' },
  { key:'petrol' }, { key:'recharge' }, { key:'water' }, { key:'gifts' }, { key:'other' },
];
function isBuiltInCatKey(key, list) { return (list || _CAT_BUILTINS).some(c => c.key === key); }
function catUsageCount(expenses, key) { return (expenses || []).filter(e => e.category === key).length; }
function findUnusedCats(customCats, expenses) {
  return (customCats || []).filter(c => catUsageCount(expenses, c.key) === 0);
}
function catDeletePlan(key, customCats, expenses, opts) {
  opts = opts || {};
  const reassignTarget = opts.reassignTarget || 'other';
  const builtIns = opts.builtIns || _CAT_BUILTINS;
  if (isBuiltInCatKey(key, builtIns)) return { ok:false, reason:'builtin', usedCount:0 };
  const cat = (customCats || []).find(c => c.key === key);
  if (!cat) return { ok:false, reason:'not-found', usedCount:0 };
  const used = catUsageCount(expenses, key);
  return { ok:true, usedCount:used, canSafeDelete:used===0, requiresReassign:used>0, reassignTarget };
}
function customKeyFor(name) { return 'custom_' + name.toLowerCase().replace(/\s+/g, '_'); }
function reassignPlan(expenses, fromKey, toKey) {
  return (expenses || []).filter(e => e.category === fromKey).map(e => ({ ...e, category: toKey }));
}

/* — built-in protection — */
T('TC-AI-001','built-in food is locked', () => assert.strictEqual(isBuiltInCatKey('food'), true));
T('TC-AI-002','built-in grocery is locked', () => assert.strictEqual(isBuiltInCatKey('grocery'), true));
T('TC-AI-003','built-in other is locked', () => assert.strictEqual(isBuiltInCatKey('other'), true));
T('TC-AI-004','custom_travel is NOT built-in', () => assert.strictEqual(isBuiltInCatKey('custom_travel'), false));
T('TC-AI-005','unknown key is not built-in', () => assert.strictEqual(isBuiltInCatKey('garbage'), false));

/* — usage count — */
T('TC-AI-006','usageCount: empty list = 0', () => assert.strictEqual(catUsageCount([], 'food'), 0));
T('TC-AI-007','usageCount: one match', () => assert.strictEqual(catUsageCount([{category:'food'}], 'food'), 1));
T('TC-AI-008','usageCount: three matches mixed', () =>
  assert.strictEqual(catUsageCount(
    [{category:'food'},{category:'petrol'},{category:'food'},{category:'food'}], 'food'), 3));
T('TC-AI-009','usageCount: no match returns 0', () =>
  assert.strictEqual(catUsageCount([{category:'food'},{category:'petrol'}], 'custom_x'), 0));
T('TC-AI-010','usageCount: null expenses safe', () =>
  assert.strictEqual(catUsageCount(null, 'food'), 0));

/* — findUnusedCats — */
T('TC-AI-011','findUnused: none used → all unused', () => {
  const cats=[{key:'custom_a'},{key:'custom_b'}];
  assert.strictEqual(findUnusedCats(cats, []).length, 2);
});
T('TC-AI-012','findUnused: skip used ones', () => {
  const cats=[{key:'custom_a'},{key:'custom_b'},{key:'custom_c'}];
  const exp=[{category:'custom_b'}];
  const unused=findUnusedCats(cats, exp);
  assert.strictEqual(unused.length, 2);
  assert.deepStrictEqual(unused.map(c=>c.key).sort(), ['custom_a','custom_c']);
});
T('TC-AI-013','findUnused: empty cats → empty', () =>
  assert.deepStrictEqual(findUnusedCats([], [{category:'food'}]), []));
T('TC-AI-014','findUnused: all used → empty', () => {
  const cats=[{key:'custom_a'},{key:'custom_b'}];
  const exp=[{category:'custom_a'},{category:'custom_b'}];
  assert.deepStrictEqual(findUnusedCats(cats, exp), []);
});
T('TC-AI-015','findUnused: built-ins ignored (only customs passed)', () => {
  /* findUnused only inspects the customCats arg, so built-ins never appear */
  assert.deepStrictEqual(findUnusedCats([], []), []);
});

/* — catDeletePlan — */
T('TC-AI-016','deletePlan: built-in blocked', () => {
  const p=catDeletePlan('food', [], []);
  assert.strictEqual(p.ok, false); assert.strictEqual(p.reason, 'builtin');
});
T('TC-AI-017','deletePlan: not-found custom', () => {
  const p=catDeletePlan('custom_zzz', [{key:'custom_a'}], []);
  assert.strictEqual(p.ok, false); assert.strictEqual(p.reason, 'not-found');
});
T('TC-AI-018','deletePlan: safe delete when unused', () => {
  const p=catDeletePlan('custom_travel', [{key:'custom_travel'}], []);
  assert.strictEqual(p.ok, true);
  assert.strictEqual(p.canSafeDelete, true);
  assert.strictEqual(p.usedCount, 0);
});
T('TC-AI-019','deletePlan: requires reassign when used', () => {
  const p=catDeletePlan('custom_travel', [{key:'custom_travel'}],
    [{category:'custom_travel'},{category:'custom_travel'}]);
  assert.strictEqual(p.ok, true);
  assert.strictEqual(p.canSafeDelete, false);
  assert.strictEqual(p.requiresReassign, true);
  assert.strictEqual(p.usedCount, 2);
});
T('TC-AI-020','deletePlan: reassignTarget defaults to other', () => {
  const p=catDeletePlan('custom_a', [{key:'custom_a'}], [{category:'custom_a'}]);
  assert.strictEqual(p.reassignTarget, 'other');
});
T('TC-AI-021','deletePlan: custom reassignTarget honored', () => {
  const p=catDeletePlan('custom_a', [{key:'custom_a'}], [{category:'custom_a'}], { reassignTarget:'misc' });
  assert.strictEqual(p.reassignTarget, 'misc');
});

/* — key stability (custom_travel never changes) — */
T('TC-AI-022','customKey: spaces become underscores', () =>
  assert.strictEqual(customKeyFor('My Travel'), 'custom_my_travel'));
T('TC-AI-023','customKey: lowercased', () =>
  assert.strictEqual(customKeyFor('TRAVEL'), 'custom_travel'));
T('TC-AI-024','customKey: rename does NOT change key', () => {
  /* Renaming "Travel" → "Holiday" leaves key 'custom_travel' intact so existing
     expense rows keep working. The label is what changes, not the key. */
  const cat={ key:'custom_travel', label:'Travel', icon:'✈️', color:'#26C6DA' };
  cat.label = 'Holiday';
  assert.strictEqual(cat.key, 'custom_travel');
});

/* — reassignPlan (force-delete cascade) — */
T('TC-AI-025','reassignPlan: zero matches', () =>
  assert.deepStrictEqual(reassignPlan([{category:'food'}], 'custom_x', 'other'), []));
T('TC-AI-026','reassignPlan: rewrites category', () => {
  const out=reassignPlan(
    [{date:'2026-05-01',category:'custom_x',amount:100},
     {date:'2026-05-02',category:'food',     amount:50}],
    'custom_x', 'other');
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].category, 'other');
  assert.strictEqual(out[0].amount, 100);
});
T('TC-AI-027','reassignPlan: preserves date/amount/note', () => {
  const out=reassignPlan(
    [{date:'2026-01-01',category:'custom_x',amount:50,note:'taxi'}], 'custom_x','other');
  assert.strictEqual(out[0].date, '2026-01-01');
  assert.strictEqual(out[0].amount, 50);
  assert.strictEqual(out[0].note, 'taxi');
});
T('TC-AI-028','reassignPlan: handles many rows', () => {
  const exp=[]; for (let i=0;i<25;i++) exp.push({category:'custom_x', amount:i});
  const out=reassignPlan(exp,'custom_x','other');
  assert.strictEqual(out.length, 25);
  assert.ok(out.every(e => e.category === 'other'));
});

/* — bulk-cleanup of test categories (the user's stated pain point) — */
T('TC-AI-029','bulk: deleting all unused leaves only used cats', () => {
  const cats=[
    {key:'custom_a'}, /* used */
    {key:'custom_b'}, /* test (unused) */
    {key:'custom_c'}, /* test (unused) */
    {key:'custom_d'}, /* used */
  ];
  const exp=[{category:'custom_a'},{category:'custom_d'},{category:'custom_d'}];
  const unused=findUnusedCats(cats, exp);
  const remaining=cats.filter(c => !unused.some(u=>u.key===c.key));
  assert.strictEqual(remaining.length, 2);
  assert.deepStrictEqual(remaining.map(c=>c.key), ['custom_a','custom_d']);
});
T('TC-AI-030','bulk: nothing happens when no unused', () => {
  const cats=[{key:'custom_a'},{key:'custom_b'}];
  const exp=[{category:'custom_a'},{category:'custom_b'}];
  assert.strictEqual(findUnusedCats(cats, exp).length, 0);
});

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
