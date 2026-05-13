/* Generates TEST_CASES.csv from the auto-results.json + the manual matrix.
   Run after auto-suite.js so auto-results.json exists. */
const fs   = require('fs');
const path = require('path');

const autoResults = JSON.parse(fs.readFileSync(path.join(__dirname,'auto-results.json'),'utf8'));

/* Quick lookup: ID → metadata from the markdown plan. To keep the CSV self-
   contained, we hard-code Module/Type/Priority alongside auto-results. */
const META = {
  /* Auto IDs are A-P; we infer module from prefix and pull priority guesses */
  prefix: {
    'A':{module:'Date Helpers',type:'Functional/Edge'},
    'B':{module:'Range Presets',type:'Functional/Edge'},
    'C':{module:'Range Filter',type:'Functional/Boundary'},
    'D':{module:'Parse Spoken Amount',type:'Functional/Edge'},
    'E':{module:'Parse Spoken Date',type:'Functional/Edge'},
    'F':{module:'Voice Intent - Budget Set',type:'Voice/Functional'},
    'G':{module:'Voice Intent - Budget Query',type:'Voice/Functional'},
    'H':{module:'Voice Intent - Date Query',type:'Voice/Functional'},
    'I':{module:'Voice - Negatives/Disambig',type:'Negative/Security'},
    'J':{module:'Voice Date Extraction',type:'Voice/Edge'},
    'K':{module:'Voice Expense Parse',type:'Voice/Functional'},
    'L':{module:'Currency/HTML/Format',type:'Security/UI'},
    'M':{module:'Budget Math',type:'Functional/Boundary'},
    'N':{module:'Category Aggregation',type:'Functional'},
    'O':{module:'Percentage/Donut Math',type:'Functional/Edge'},
    'P':{module:'Edge/Leap/DST/Performance',type:'Edge/Performance'},
    'Q':{module:'Add-Expense UI',type:'Functional/UI'},
    'R':{module:'Dashboard/Monthly View',type:'UI/Functional'},
    'S':{module:'Insights By Date UI (v22)',type:'UI/Functional'},
    'T':{module:'Voice UI/TTS',type:'Voice/UI'},
    'U':{module:'PWA/Offline/SW',type:'PWA'},
    'V':{module:'Persistence/Multi-tab/Recovery',type:'Persistence/Recovery'},
    'W':{module:'Accessibility/Responsive/Theme',type:'A11y/UI'},
    'X':{module:'Security/Negative/Compatibility',type:'Security/Compat'},
  }
};

function escape(v) {
  if (v == null) return '';
  const s = String(v).replace(/"/g,'""');
  return /[",\n]/.test(s) ? `"${s}"` : s;
}

const rows = [
  ['ID','Module','Type','Priority','Auto','Title','Status','Notes/Error'].map(escape).join(',')
];

/* Auto rows */
for (const r of autoResults.results) {
  const prefix = r.id.split('-')[1];
  const m = META.prefix[prefix] || { module:'?', type:'?' };
  rows.push([
    r.id, m.module, m.type, 'P0/P1', '✅',
    r.title, r.status, r.error || ''
  ].map(escape).join(','));
}

/* Manual rows — keep a compact mapping. Loaded from a small dataset below
   to avoid re-parsing the markdown. */
const MANUAL = [
  ['TC-Q-001','Open app → Add tab is default','P0'],
  ['TC-Q-002','Tap Food tile','P0'],
  ['TC-Q-003','Enter amount and save','P0'],
  ['TC-Q-004','Save without category','P0'],
  ['TC-Q-005','Save without amount','P0'],
  ['TC-Q-006','Save with amount=0','P1'],
  ['TC-Q-007','Save with negative amount','P1'],
  ['TC-Q-008','Save with very large amount','P2'],
  ['TC-Q-009','Save with decimals','P2'],
  ['TC-Q-010','Save with note','P1'],
  ['TC-Q-011','Save with very long note (500 chars)','P2'],
  ['TC-Q-012','Save with emoji in note','P2'],
  ['TC-Q-013','XSS safety: HTML in note escaped','P0'],
  ['TC-Q-014','Change date to yesterday and save','P0'],
  ['TC-Q-015','Date picker future date','P2'],
  ['TC-Q-016','Date picker 5 years ago','P2'],
  ['TC-Q-017','Add custom category — happy path','P0'],
  ['TC-Q-018','Add custom category — empty name','P1'],
  ['TC-Q-019','Add custom category — duplicate name','P1'],
  ['TC-Q-020','Add custom category — emoji-only label','P2'],
  ['TC-Q-021','Tap saved expense to expand','P1'],
  ['TC-Q-022','Delete saved expense — confirm','P0'],
  ['TC-Q-023','Delete saved expense — cancel','P1'],
  ['TC-Q-024','Save offline (no internet)','P0'],
  ['TC-Q-025','Spam-tap Add button','P1'],

  ['TC-R-001','Switch to Dashboard tab','P0'],
  ['TC-R-002','Bar chart renders','P0'],
  ['TC-R-003','Donut chart renders','P0'],
  ['TC-R-004','Tap prev month','P0'],
  ['TC-R-005','Tap next month','P0'],
  ['TC-R-006','Navigate to empty month','P1'],
  ['TC-R-007','Year rollover Dec→Jan','P1'],
  ['TC-R-008','Category grouped list expand','P1'],
  ['TC-R-009','Category grouped list collapse','P1'],
  ['TC-R-010','Budget banner shows when set','P0'],
  ['TC-R-011','Budget banner — over budget','P0'],
  ['TC-R-012','Edit budget from banner','P1'],
  ['TC-R-013','Remove budget','P1'],
  ['TC-R-014','Dashboard performance with 500 entries','P1'],
  ['TC-R-015','Dashboard updates after Add','P0'],

  ['TC-S-001','Tap Insights tab','P0'],
  ['TC-S-002','Default chip is Today','P0'],
  ['TC-S-003','Today total matches add-tab total','P0'],
  ['TC-S-004','Today donut chart renders','P0'],
  ['TC-S-005','Today entries list shows correct rows','P0'],
  ['TC-S-006','Tap Yesterday chip','P0'],
  ['TC-S-007','Tap This week chip','P0'],
  ['TC-S-008','Tap Last 7 days chip','P0'],
  ['TC-S-009','Tap Custom chip → picker opens','P0'],
  ['TC-S-010','Custom range — valid Apply','P0'],
  ['TC-S-011','Custom range — From > To','P0'],
  ['TC-S-012','Custom range — empty From','P1'],
  ['TC-S-013','Custom range — From === To','P1'],
  ['TC-S-014','Custom range across year boundary','P1'],
  ['TC-S-015','Empty range shows empty state','P0'],
  ['TC-S-016','Donut center shows total','P1'],
  ['TC-S-017','Category list shows %, ₹, count','P0'],
  ['TC-S-018','Category list ordered by spend','P1'],
  ['TC-S-019','Inline entries list ordered desc','P1'],
  ['TC-S-020','Reset to today on tab switch','P0'],
  ['TC-S-021','Header label reflects active range','P0'],
  ['TC-S-022','Prev/Next arrows hidden on Insights','P1'],
  ['TC-S-023','Switch chip mid-render','P2'],
  ['TC-S-024','Delete entry inside by-date list','P1'],
  ['TC-S-025','Update budget then view by-date','P2'],

  ['TC-T-001','Hold-to-speak (Add) happy','P0'],
  ['TC-T-002','Voice — set budget','P0'],
  ['TC-T-003','Voice — budget left','P0'],
  ['TC-T-004','Voice — did i overspend','P1'],
  ['TC-T-005','Voice — yesterday query (v22)','P0'],
  ['TC-T-006','Voice — last 7 days (v22)','P0'],
  ['TC-T-007','Voice — from-to range (v22)','P0'],
  ['TC-T-008','Voice — category drill (v22)','P0'],
  ['TC-T-009','Voice — disambiguation expense vs query','P0'],
  ['TC-T-010','Voice — mute toggle','P1'],
  ['TC-T-011','Voice — mic permission denied','P0'],
  ['TC-T-012','Voice — unsupported browser','P1'],
  ['TC-T-013','Voice — gibberish input','P1'],
  ['TC-T-014','Voice — interrupt mid-utterance','P2'],
  ['TC-T-015','Voice — en-IN voice preference','P2'],

  ['TC-U-001','Install PWA prompt Android','P0'],
  ['TC-U-002','Install PWA iOS','P1'],
  ['TC-U-003','Launch installed PWA','P0'],
  ['TC-U-004','Service worker v22 installs','P0'],
  ['TC-U-005','Old cache deleted on update','P0'],
  ['TC-U-006','Offline — already loaded','P0'],
  ['TC-U-007','Offline — first-time load','P2'],
  ['TC-U-008','Offline → online auto-recover','P1'],
  ['TC-U-009','App update propagates','P1'],
  ['TC-U-010','manifest.json icons load','P1'],
  ['TC-U-011','Splash screen on launch','P2'],
  ['TC-U-012','Service worker scope subpath','P2'],

  ['TC-V-001','Reload preserves sheet selection','P0'],
  ['TC-V-002','Custom categories persist','P0'],
  ['TC-V-003','Sign out clears token','P0'],
  ['TC-V-004','Two tabs — write in tab 1','P1'],
  ['TC-V-005','Two tabs — delete in tab 2','P2'],
  ['TC-V-006','localStorage corruption recovery','P1'],
  ['TC-V-007','Stale spreadsheet ID recovery','P0'],
  ['TC-V-008','Token expiry mid-session','P0'],
  ['TC-V-009','Voice mute pref persists','P2'],
  ['TC-V-010','Migration v21→v22 keeps data','P0'],

  ['TC-W-001','Tab order via keyboard','P1'],
  ['TC-W-002','Focus rings visible','P1'],
  ['TC-W-003','ARIA labels on icon buttons','P1'],
  ['TC-W-004','Color contrast amount text','P1'],
  ['TC-W-005','prefers-reduced-motion respected','P1'],
  ['TC-W-006','Screen reader reads category','P2'],
  ['TC-W-007','Responsive 320px','P0'],
  ['TC-W-008','Responsive 768px tablet','P1'],
  ['TC-W-009','Responsive 1440px desktop','P2'],
  ['TC-W-010','Portrait orientation lock','P2'],
  ['TC-W-011','Landscape phone layout','P2'],
  ['TC-W-012','Dark theme readable','P0'],
  ['TC-W-013','Empty-state pulse animation','P2'],
  ['TC-W-014','Floating-money background motion','P2'],

  ['TC-X-001','XSS in note <script>','P0'],
  ['TC-X-002','XSS in custom category name','P0'],
  ['TC-X-003','XSS in spreadsheet name','P1'],
  ['TC-X-004','Inject via voice transcript','P0'],
  ['TC-X-005','Token never exposed in DOM','P0'],
  ['TC-X-006','HTTPS only','P0'],
  ['TC-X-007','OAuth scope limited','P0'],
  ['TC-X-008','No 3rd-party trackers','P1'],
  ['TC-X-009','CSP allows only Google + Chart.js','P2'],
  ['TC-X-010','Sheet API 401 handling','P0'],
  ['TC-X-011','Sheet API 429 rate limit','P1'],
  ['TC-X-012','Network timeout','P1'],
  ['TC-X-013','Concurrent sheet write conflict','P2'],
  ['TC-X-014','Browser: Chrome Android','P0'],
  ['TC-X-015','Browser: Safari iOS','P0'],
  ['TC-X-016','Browser: Firefox Desktop','P1'],
  ['TC-X-017','Browser: Edge Desktop','P2'],
  ['TC-X-018','OS: Android 10','P1'],
  ['TC-X-019','OS: iOS 15+','P1'],
  ['TC-X-020','Slow 3G simulated','P1'],
];

for (const [id,title,prio] of MANUAL) {
  const prefix = id.split('-')[1];
  const m = META.prefix[prefix] || { module:'?', type:'?' };
  rows.push([
    id, m.module, m.type, prio, '⏳',
    title, 'PENDING', 'Manual — execute on device'
  ].map(escape).join(','));
}

fs.writeFileSync(path.join(__dirname,'TEST_CASES.csv'), rows.join('\n'));
console.log(`Wrote ${rows.length-1} rows to TEST_CASES.csv`);
