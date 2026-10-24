#!/usr/bin/env node
// 손글씨 글꼴용 "쓰기 시트" 만들기 (외부 패키지 없음, 크롬만 필요)
// 사용:
//   node handwriting-template.mjs --words words.json --out <폴더>
//   node handwriting-template.mjs --text 대본.txt --out <폴더>
// 결과: <폴더>/sheet-01.png ... (A4 세로 300dpi 2480x3508), <폴더>/layout.json
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf('--' + name); return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : def; };
const flag = (name) => args.includes('--' + name);

if (flag('help') || !opt('out')) {
  console.log('사용: node handwriting-template.mjs (--words words.json | --text 파일.txt) --out 폴더 [--extra "추가글자"] [--all-punct] [--no-digits] [--chrome 경로]');
  process.exit(opt('out') ? 0 : 1);
}

// ---------- 글자 모으기 ----------
let source = '';
if (opt('words')) {
  const j = JSON.parse(fs.readFileSync(opt('words'), 'utf8').replace(/^\uFEFF/, ''));
  const arr = Array.isArray(j) ? j : (j.words || []);
  source = arr.map((w) => (typeof w === 'string' ? w : (w.text ?? w.word ?? ''))).join(' ');
} else if (opt('text')) {
  source = fs.readFileSync(opt('text'), 'utf8');
} else { console.error('--words 또는 --text 가 필요합니다'); process.exit(1); }
source += (opt('extra', '') || '');

const PUNCT = '.,?!%~';
const set = new Set();
for (const ch of source) {
  const c = ch.codePointAt(0);
  if ((c >= 0xAC00 && c <= 0xD7A3) || (ch >= '0' && ch <= '9') || PUNCT.includes(ch)) set.add(ch);
}
if (!flag('no-digits')) for (const d of '0123456789') set.add(d);
if (flag('all-punct')) for (const p of PUNCT) set.add(p);
const order = (ch) => (ch >= '0' && ch <= '9' ? 0 : PUNCT.includes(ch) ? 1 : 2);
const chars = [...set].sort((a, b) => order(a) - order(b) || a.codePointAt(0) - b.codePointAt(0));
if (!chars.length) { console.error('쓸 글자가 없습니다'); process.exit(1); }

// ---------- 배치 ----------
const W = 2480, H = 3508;            // A4, 300dpi
const MARK = 80, MARK_C = 140;       // 정합 표시: 한 변 80px, 중심은 모서리에서 140px
const COLS = 8, ROWS = 10;
const CW = 260, CH = 290;            // 칸 크기
const GX = Math.round((W - COLS * CW) / 2), GY = 290;
const BASE = 0.78;                   // 기준선: 칸 위에서 78% 지점
const perSheet = COLS * ROWS;
const outDir = path.resolve(opt('out'));
fs.mkdirSync(outDir, { recursive: true });

const fontUrl = pathToFileURL(path.resolve(here, '..', 'assets', 'fonts', 'IBMPlexSansKR-Bold.ttf')).href;
const marks = [[MARK_C, MARK_C], [W - MARK_C, MARK_C], [W - MARK_C, H - MARK_C], [MARK_C, H - MARK_C]]; // 좌상 우상 우하 좌하

const sheets = [];
for (let s = 0; s * perSheet < chars.length; s++) {
  const sc = chars.slice(s * perSheet, (s + 1) * perSheet);
  const cells = sc.map((ch, i) => {
    const col = i % COLS, row = Math.floor(i / COLS);
    return { char: ch, col, row, x: GX + col * CW, y: GY + row * CH, w: CW, h: CH };
  });
  sheets.push({ index: s + 1, file: `sheet-${String(s + 1).padStart(2, '0')}.png`, marks, cells });
}

function sheetHtml(sh) {
  let svg = '';
  for (const [mx, my] of sh.marks) svg += `<rect x="${mx - MARK / 2}" y="${my - MARK / 2}" width="${MARK}" height="${MARK}" fill="#000"/>`;
  for (const c of sh.cells) {
    const by = c.y + CH * BASE;
    svg += `<rect x="${c.x}" y="${c.y}" width="${CW}" height="${CH}" fill="none" stroke="#9fd0ee" stroke-width="3"/>`;
    svg += `<line x1="${c.x + CW / 2}" y1="${c.y + 10}" x2="${c.x + CW / 2}" y2="${c.y + CH - 10}" stroke="#c9e4f5" stroke-width="2" stroke-dasharray="10 8"/>`;
    svg += `<line x1="${c.x + 10}" y1="${by}" x2="${c.x + CW - 10}" y2="${by}" stroke="#9fd0ee" stroke-width="3"/>`;
    svg += `<text x="${c.x + 10}" y="${c.y + 34}" font-size="30" fill="#bdbdbd">${c.char.replace('&', '&amp;').replace('<', '&lt;')}</text>`;
  }
  svg += `<text x="${W / 2}" y="130" font-size="64" text-anchor="middle" fill="#9a9a9a">시트 ${sh.index} / ${sheets.length}</text>`;
  svg += `<text x="${W / 2}" y="215" font-size="36" text-anchor="middle" fill="#b0b0b0">검은 펜으로 칸 가득 쓰세요. 숫자·문장부호는 가로 줄에 맞추세요. 네 모서리 검은 네모는 가리지 마세요.</text>`;
  return `<!doctype html><meta charset="utf-8"><style>
@font-face{font-family:L;src:url("${fontUrl}")}
html,body{margin:0;background:#fff}svg{display:block;font-family:L,sans-serif}</style>
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><rect width="${W}" height="${H}" fill="#fff"/>${svg}</svg>`;
}

// ---------- 크롬 찾기 ----------
const candidates = [opt('chrome'), process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  '/usr/bin/google-chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].filter(Boolean);
const chrome = candidates.find((p) => fs.existsSync(p));
if (!chrome) { console.error('크롬을 찾지 못했습니다. --chrome 경로를 알려 주세요.'); process.exit(1); }

const profile = path.join(outDir, '.chrome-profile');
for (const sh of sheets) {
  const html = path.join(outDir, `.sheet-${sh.index}.html`);
  fs.writeFileSync(html, sheetHtml(sh));
  const png = path.join(outDir, sh.file);
  const r = spawnSync(chrome, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1',
    `--user-data-dir=${profile}`, `--window-size=${W},${H}`, '--virtual-time-budget=4000',
    `--screenshot=${png}`, pathToFileURL(html).href], { encoding: 'utf8', timeout: 60000 });
  if (!fs.existsSync(png)) { console.error('시트 그림 만들기 실패', r.stderr); process.exit(1); }
  // 창이 더 크게 찍힌 경우를 대비해 PNG 크기 확인 (IHDR)
  const b = fs.readFileSync(png);
  const w = b.readUInt32BE(16), h = b.readUInt32BE(20);
  sh.pngSize = [w, h];
  if (w !== W) console.warn(`경고: ${sh.file} 가로 ${w} (기대 ${W})`);
  fs.rmSync(html, { force: true });
}
fs.rmSync(profile, { recursive: true, force: true });

fs.writeFileSync(path.join(outDir, 'layout.json'), JSON.stringify({
  version: 1, page: [W, H], dpi: 300, markSize: MARK, markCenters: marks,
  cell: [CW, CH], baselineRatio: BASE, cols: COLS, rows: ROWS, sheets,
}, null, 1));
console.log(JSON.stringify({ chars: chars.length, sheets: sheets.length, out: outDir, perSheet }, null, 1));

