#!/usr/bin/env node
// align-script.mjs : keep the SPELLING of a real script, keep the TIMES of the spoken audio.
//   node align-script.mjs --words words.json --script script.txt --out words.aligned.json [--max-word 1.8]
// words.json  = ASR result (word times, spelling may be wrong: names, numbers, spacing)
// script.txt  = what was meant to be said (plain text; blank lines and line breaks are ignored)
// Method: character-level edit alignment (spaces and punctuation ignored), so different spacing
// ("글을쓰게" vs "글을 쓰게") or merged/split words still line up. Each script word takes its start from
// its first aligned character and its end from its last. Unaligned script characters are interpolated.
// Report: matched ratio and every script word whose characters did not match the audio (check by ear/eye).
// The script is a reference, not the truth: if the speaker really said something else, fix the script.
import fs from 'node:fs';

const argv = process.argv.slice(2); const opt = {};
for (let i = 0; i < argv.length; i++) if (argv[i].startsWith('--')) opt[argv[i].slice(2)] = argv[i + 1]?.startsWith('--') || argv[i + 1] == null ? true : argv[++i];
if (!opt.words || !opt.script) { console.log(fs.readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(1, 12).join('\n')); process.exit(1); }

const src = JSON.parse(fs.readFileSync(opt.words, 'utf8')); const asr = src.words;
const norm = (c) => c.toLowerCase();
const isKept = (c) => /[0-9A-Za-z\u1100-\u11ff\u3130-\u318f\uac00-\ud7af\u3040-\u30ff\u4e00-\u9fff]/.test(c);

// ASR characters with times spread evenly inside each word
const A = [];
asr.forEach((w, wi) => { const cs = [...w.text].filter(isKept); const d = (w.end - w.start) / Math.max(1, cs.length); cs.forEach((c, k) => A.push({ c: norm(c), t0: w.start + d * k, t1: w.start + d * (k + 1), wi })); });
// script words (whitespace separated) and their characters
const tokens = fs.readFileSync(opt.script, 'utf8').split(/\s+/).filter(Boolean);
const S = []; tokens.forEach((tk, ti) => { [...tk].filter(isKept).forEach((c) => S.push({ c: norm(c), ti })); });
if (!A.length || !S.length) { console.error('empty input'); process.exit(1); }
const n = S.length, m = A.length; if (n * m > 4e7) { console.error('too long to align at once; split the script and words by section'); process.exit(1); }

// Levenshtein DP (match 0, substitute 1, insert/delete 1) with traceback
const W = m + 1; const D = new Uint16Array((n + 1) * W);
for (let j = 0; j <= m; j++) D[j] = j; for (let i = 0; i <= n; i++) D[i * W] = i;
for (let i = 1; i <= n; i++) for (let j = 1; j <= m; j++) {
  const sub = D[(i - 1) * W + j - 1] + (S[i - 1].c === A[j - 1].c ? 0 : 1);
  D[i * W + j] = Math.min(sub, D[(i - 1) * W + j] + 1, D[i * W + j - 1] + 1);
}
const map = new Array(n).fill(-1); const exact = new Array(n).fill(false);
let i = n, j = m;
while (i > 0 && j > 0) {
  const cur = D[i * W + j], same = S[i - 1].c === A[j - 1].c;
  if (cur === D[(i - 1) * W + j - 1] + (same ? 0 : 1)) { map[i - 1] = j - 1; exact[i - 1] = same; i--; j--; }
  else if (cur === D[(i - 1) * W + j] + 1) i--; else j--;
}
// times per script character (interpolate unaligned ones between neighbours)
const t0 = new Array(n), t1 = new Array(n);
for (let k = 0; k < n; k++) if (map[k] >= 0) { t0[k] = A[map[k]].t0; t1[k] = A[map[k]].t1; }
for (let k = 0; k < n; k++) if (map[k] < 0) {
  let a = k - 1; while (a >= 0 && map[a] < 0) a--; let b = k + 1; while (b < n && map[b] < 0) b++;
  const left = a >= 0 ? t1[a] : A[0].t0, right = b < n ? t0[b] : A[m - 1].t1; const gap = b - a - 1, idx = k - a - 1;
  t0[k] = left + ((right - left) * idx) / gap; t1[k] = left + ((right - left) * (idx + 1)) / gap;
}
const out = []; const mism = []; let ci = 0;
tokens.forEach((tk, ti) => {
  const idx = []; while (ci < n && S[ci].ti === ti) idx.push(ci++);
  if (!idx.length) return; // token of punctuation only
  const start = Math.min(...idx.map((k) => t0[k])), end = Math.max(...idx.map((k) => t1[k]));
  const bad = idx.filter((k) => !exact[k]).length;
  const heard = [...new Set(idx.filter((k) => map[k] >= 0).map((k) => A[map[k]].wi))].map((w) => asr[w].text).join(' ');
  if (bad) mism.push({ script: tk, heard, wrongChars: bad, at: +start.toFixed(2) });
  out.push({ text: tk, start: +start.toFixed(3), end: +Math.max(end, start + 0.08).toFixed(3) });
});
for (let k = 1; k < out.length; k++) if (out[k].start < out[k - 1].start) out[k].start = out[k - 1].start; // keep order
// speech models stretch the last word of a phrase across the pause/outro (seen: a 22 s "word" at the end of a rap): cap word length
const maxWord = +(opt['max-word'] || 1.8); let capped = 0;
for (const w of out) { const cap = Math.max(maxWord * 0.35, Math.min(maxWord, 0.3 + [...w.text].length * 0.22)); if (w.end - w.start > cap) { w.end = +(w.start + cap).toFixed(3); capped++; } }
if (capped) console.log(`  capped ${capped} over-long word end time(s) (max ${maxWord}s per word; --max-word to change)`);
const matched = exact.filter(Boolean).length / n;
const squeezed = out.filter((w) => w.end - w.start < 0.13).length; if (squeezed / out.length > 0.15 && !opt.force) { console.error('FAIL: ' + squeezed + ' of ' + out.length + ' script words have no time of their own (squeezed together). The script is probably longer than the audio, or covers a different part. Cut the script to match this audio, or use --force.'); process.exit(2); }
if (matched < 0.6 && !opt.force) { console.error('FAIL: script and audio differ too much (match under 60%). Wrong script or wrong section? Nothing was written (use --force to write anyway).'); process.exit(2); }
fs.writeFileSync(opt.out || 'words.aligned.json', JSON.stringify({ language: src.language, precision: src.precision || 'word-level', aligned: true, scriptMatch: +matched.toFixed(3), mismatches: mism, words: out }, null, 1));
console.log(`script words ${out.length} | exact character match ${(matched * 100).toFixed(1)}% | words needing a check ${mism.length}`);
for (const x of mism.slice(0, 20)) console.log(`  MISMATCH ${x.at}s script "${x.script}" / heard "${x.heard}" (${x.wrongChars} chars)`);

