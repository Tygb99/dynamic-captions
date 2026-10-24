#!/usr/bin/env node
// listen-check.mjs : make the "please listen to these spots" clip for the user.
//   node listen-check.mjs --video <captioned or source mp4> --aligned words.aligned.json --out <dir> [--max 12] [--before 2.5] [--len 6]
// The AI cannot hear. This tool collects every place where the script (lyrics) and the recognised speech DISAGREE
// (the MISMATCH list written by align-script.mjs), cuts a short clip around each, burns "script / heard / time" on it,
// and joins them into listen-check.mp4 + listen-check.md. The user listens once (about 1 minute) and says which words are wrong.
// Without --aligned it falls back to the spots with the longest word gaps and the fastest reading speed from --stats (optional).
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const argv = process.argv.slice(2); const opt = {};
for (let i = 0; i < argv.length; i++) if (argv[i].startsWith('--')) opt[argv[i].slice(2)] = argv[i + 1]?.startsWith('--') || argv[i + 1] == null ? true : argv[++i];
if (!opt.video || !opt.out) { console.log(fs.readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(1, 9).join('\n')); process.exit(1); }
const out = path.resolve(opt.out); fs.mkdirSync(out, { recursive: true });
const ff = (args, cwd) => { const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: 'inherit', cwd }); if (r.status) throw new Error('ffmpeg failed'); };
const video = path.resolve(opt.video); const max = +(opt.max || 12), before = +(opt.before || 2.5), len = +(opt.len || 6);
const dur = +spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', video], { encoding: 'utf8' }).stdout.trim();

let spots = [];
if (opt.aligned) {
  const j = JSON.parse(fs.readFileSync(opt.aligned, 'utf8'));
  spots = (j.mismatches || []).map((m) => ({ at: m.at, script: m.script, heard: m.heard, why: `가사 "${m.script}" / 받아쓰기 "${m.heard}"` }));
}
if (!spots.length) { console.log('No disagreement spots found (nothing to check). Either the script matched perfectly or --aligned has no mismatches.'); process.exit(0); }
// merge spots closer than 3 s into one clip, keep the first max
spots.sort((a, b) => a.at - b.at); const clips = [];
for (const s of spots) { const last = clips[clips.length - 1]; if (last && s.at - last.at < 3) { last.items.push(s); } else clips.push({ at: s.at, items: [s] }); }
const use = clips.slice(0, max);
fs.copyFileSync(new URL('../assets/fonts/IBMPlexSansKR-Bold.ttf', import.meta.url), path.join(out, 'lab.ttf'));
const files = []; const md = ['# 직접 들어 보고 확인할 곳', '', '영상 시각 / 가사 / 받아쓰기(소리로 들린 말) 순서입니다. 가사와 다르게 불렸으면 알려 주세요.', '', '| # | 시각 | 가사 | 받아쓰기 |', '|---|---|---|---|'];
use.forEach((c, i) => {
  const st = Math.max(0, c.at - before), l = Math.min(len, dur - st); const f = `c${String(i).padStart(2, '0')}.mp4`;
  const label = `#${i + 1}  ${Math.floor(c.at / 60)}:${String(Math.round(c.at % 60)).padStart(2, '0')}   ` + c.items.map((x) => `"${x.script}" ← "${x.heard}"`).join('   ');
  fs.writeFileSync(path.join(out, `t${i}.txt`), label, 'utf8');
  ff(['-ss', String(st), '-t', String(l), '-i', video, '-vf', `scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,drawtext=fontfile=lab.ttf:textfile=t${i}.txt:x=24:y=24:fontsize=34:fontcolor=white:box=1:boxcolor=black@0.7:boxborderw=10`, '-r', '24', '-c:v', 'libx264', '-crf', '20', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-ar', '48000', '-ac', '2', f], out);
  files.push(f);
  for (const x of c.items) md.push(`| ${i + 1} | ${Math.floor(x.at / 60)}:${String(Math.round(x.at % 60)).padStart(2, '0')} | ${x.script} | ${x.heard} |`);
});
fs.writeFileSync(path.join(out, 'concat.txt'), files.map((f) => `file '${f}'`).join('\n'));
ff(['-f', 'concat', '-safe', '0', '-i', 'concat.txt', '-c', 'copy', 'listen-check.mp4'], out);
fs.writeFileSync(path.join(out, 'listen-check.md'), md.join('\n'));
console.log(`clips ${use.length} (of ${clips.length} spots, ${spots.length} words) -> ${path.join(out, 'listen-check.mp4')}\n  list: ${path.join(out, 'listen-check.md')}`);
