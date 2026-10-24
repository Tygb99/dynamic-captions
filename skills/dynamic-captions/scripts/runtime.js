// dynamic-captions runtime (browser side). Loaded by captions.html after data.js (window.CAPDATA).
// Contract for the renderer: window.ready, window.DURATION, window.seek(t), window.visible(t), window.bounds(), window.styles.
// style=mix : every phrase gets its own style (auto plan or D.plan = [{from, to, style}] in seconds).
(() => {
  const P = new URLSearchParams(location.search);
  const D = window.CAPDATA;
  const W = D.width, H = D.height, portrait = H > W;
  const styleId = P.get('style') || D.style || 'block-sweep';
  const root = document.getElementById('cap');
  const U = portrait ? W / 1080 : H / 1080;
  const FS = (portrait ? 88 : 64) * U * (D.scale || 1);
  const PAL = D.palette; // {accent, accent2}
  const CYCLE = [PAL.accent, '#FFFFFF', PAL.accent2]; // key-word colour rotation (mix / lead-big)
  const zone = D.zone;
  const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
  const easeOut = (x) => 1 - Math.pow(1 - clamp(x), 3);
  const easeExpo = (x) => (x >= 1 ? 1 : 1 - Math.pow(2, -10 * clamp(x)));
  const easeBack = (x) => { x = clamp(x); const c1 = 1.9, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); };
  const strip = (s) => s.replace(/[.,!?…~"'“”‘’()\[\]]/g, '');
  // ---------- decoration layer: emoji reactions, accent line, dark shade (all optional: D.deco = ['emoji','line'], D.shade = 0..1) ----------
  const DECO = new Set(D.deco || []);
  const EMO_DEFAULT = { '와': '😮', '오': '😲', '빵': '🍞', '불': '🔥', '새까맣': '😱', '조금': '🤏', '성공': '🎉', '완벽': '👌', '천천히': '🐢', '먹': '😋', '용': '🐉', '잘했': '👏', '사랑': '❤️', '돈': '💰', '시간': '⏰', '아이디어': '💡', '질문': '❓', '위험': '⚠️', '주의': '⚠️', '컴퓨터': '💻', '영상': '🎬', '음악': '🎵', '노래': '🎵', '커피': '☕', '최고': '🏆', '추천': '👍', '좋': '👍', '봐': '👀', '확신': '💯', '무료': '🆓', '웃': '😄', '눈물': '😢', '화내': '😡', '놀라': '😮',
    fire: '🔥', perfect: '👌', wow: '😮', love: '❤️', money: '💰', idea: '💡', music: '🎵', bread: '🍞', dragon: '🐉', eat: '😋', free: '🆓', time: '⏰' };
  const EMO = Object.assign({}, EMO_DEFAULT, D.emojiMap || {});
  const emoKeys = Object.keys(EMO).sort((a, b) => b.length - a.length);
  // one-character keys must be at the start of the word ("용이" yes, "사용" no); longer keys may be anywhere inside. The user's emojiMap always wins.
  const emoMatch = (t) => { t = t.toLowerCase(); return emoKeys.find((k) => { k = k.toLowerCase(); return k.length <= 1 ? t.startsWith(k) : t.includes(k); }); };
  // display width in Hangul-equivalents (Hangul/CJK 1, Latin and digits .55, other .4): max-chars limits follow real width
  const wlen = (s) => { let n = 0; for (const ch of strip(s)) n += /[\u1100-\u11ff\u3130-\u318f\uac00-\ud7af\u3040-\u30ff\u4e00-\u9fff]/.test(ch) ? 1 : /[A-Za-z0-9]/.test(ch) ? 0.55 : 0.4; return n; };
  const OUT = (em = 0.065, c = 'rgba(8,8,12,.92)') => {
    const o = [[1, 0], [-1, 0], [0, 1], [0, -1], [.7, .7], [-.7, .7], [.7, -.7], [-.7, -.7]];
    return o.map(([x, y]) => `${(x * em).toFixed(3)}em ${(y * em).toFixed(3)}em 0 ${c}`).join(',') + `,0 .06em .18em rgba(0,0,0,.55)`;
  };

  // ---------- words, key words, phrases ----------
  const words = D.words.map((w, i) => ({ ...w, i, dur: Math.max(0.12, w.end - w.start) }));
  const emphList = (D.emphasis || []).map(strip);
  const isEmph = (w) => w.emph === true || emphList.some((e) => e && strip(w.text).includes(e));
  // words spoken noticeably slower than usual (>=2x the median time per character, >=0.4 s) are emphasis candidates (real timings only)
  const pcs = words.filter((w) => !w.approx && strip(w.text).length >= 2 && w.dur >= 0.2).map((w) => w.dur / strip(w.text).length).sort((a, b) => a - b);
  const medPC = pcs.length ? pcs[Math.floor(pcs.length / 2)] : 0.12;
  const slowSpoken = (w) => !w.approx && strip(w.text).length >= 2 && w.dur >= 0.4 && w.dur / strip(w.text).length >= 2 * medPC;
  function group(opts) {
    const out = []; let cur = [], chars = 0;
    const flush = () => { if (cur.length) out.push(cur); cur = []; chars = 0; };
    words.forEach((w) => {
      const n = wlen(w.text);
      if (cur.length && (cur.length >= opts.maxWords || chars + n > opts.maxChars || w.start - cur[cur.length - 1].end > 0.5 || cur[cur.length - 1].lineEnd)) flush();
      cur.push(w); chars += n;
      if (/[.?!…]$/.test(w.text) || (/,$/.test(w.text) && chars >= opts.maxChars * 0.6)) flush();
    });
    flush();
    // orphan guard: a phrase left with a single short word joins the previous phrase when it still fits
    if (opts.maxWords > 2) for (let i = out.length - 1; i > 0; i--) {
      const cur1 = out[i], prev = out[i - 1], last = prev[prev.length - 1];
      if (cur1.length === 1 && cur1[0].start - last.end < 0.3 && !last.lineEnd && !/[.?!…]$/.test(last.text) && prev.length <= opts.maxWords && prev.reduce((s, w) => s + wlen(w.text), 0) + wlen(cur1[0].text) <= opts.maxChars * 1.25) { prev.push(cur1[0]); out.splice(i, 1); }
    }
    return out.map((ws, k) => {
      const longest = ws.reduce((a, b) => (strip(b.text).length >= strip(a.text).length ? b : a), ws[0]);
      // key word: explicit > number > slowly spoken (not the last word, whose end often includes a pause) > longest
      const slow = ws.slice(0, -1).filter(slowSpoken).sort((a, b) => b.dur / strip(b.text).length - a.dur / strip(a.text).length)[0];
      const key = ws.find(isEmph) || ws.find((w) => /\d/.test(w.text)) || slow || longest;
      return { words: ws, start: ws[0].start, end: ws[ws.length - 1].end, key, k, hasEmph: ws.some(isEmph), hasNum: ws.some((w) => /\d/.test(w.text)) };
    }).map((ph, k, arr) => {
      const nxt = arr[k + 1];
      ph.vs = Math.max(0, ph.start - 0.06);
      ph.ve = nxt ? Math.min(ph.end + 0.4, nxt.start - 0.03) : ph.end + 0.4;
      if (ph.ve < ph.end + 0.12) ph.ve = ph.end + 0.12;
      const minVe = ph.vs + 0.7; // a caption stays on screen at least 0.7 s unless the next one starts
      if (ph.ve < minVe) ph.ve = nxt ? Math.min(minVe, nxt.start - 0.03) : minVe;
      return ph;
    });
  }

  // ---------- container (safe zone) ----------
  Object.assign(root.style, {
    position: 'absolute', left: (W * 0.06) + 'px', width: (W * 0.88) + 'px',
    top: (H * zone.top) + 'px', height: (H * (zone.bottom - zone.top)) + 'px',
    display: 'flex', justifyContent: 'center', alignItems: portrait ? 'center' : 'flex-end', textAlign: 'center',
  });
  const css = document.createElement('style');
  css.textContent = `
  #cap{font-family:CapMain,sans-serif;font-weight:800;font-size:${FS}px;line-height:1.18;color:#fff;font-synthesis:none}
  #cap .ln{display:flex;flex-wrap:wrap;justify-content:var(--jc,center);align-items:baseline;column-gap:.3em;row-gap:.06em}
  #cap .w{display:inline-block;position:relative;white-space:nowrap;will-change:transform}
  #cap .col{display:flex;flex-direction:column;align-items:var(--ai,center);row-gap:.02em}
  #cap .dec{position:absolute;pointer-events:none}
  `;
  document.head.appendChild(css);
  const mk = (tag, cls, parent, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; if (parent) parent.appendChild(e); return e; };
  const keyColor = (ph, mix) => (mix ? CYCLE[ph.k % CYCLE.length] : PAL.accent);

  // helper for the "small words around one big key" family (hero-key, lead-big, stamp)
  function buildRows(ph, el, preSize, makeKey) {
    const col = mk('div', 'col', el); const k = ph.words.indexOf(ph.key);
    const pre = ph.words.slice(0, k), post = ph.words.slice(k + 1); ph.els = [];
    const row = (ws) => { if (!ws.length) return; const r = mk('div', 'ln', col); r.style.fontSize = preSize; ws.forEach((w) => { const s = mk('span', 'w', r, w.text); s.style.textShadow = OUT(0.07); ph.els[w.i] = s; }); };
    row(pre);
    const kr = mk('div', 'ln', col); const ks = mk('span', 'w', kr, ph.key.text); makeKey(ks); ph.els[ph.key.i] = ks;
    row(post);
  }
  const smallEnter = (s, p, vis) => { s.style.opacity = vis ? 1 : 0; s.style.transform = `translateY(${vis ? (1 - easeOut(p)) * 0.3 : 0.3}em)`; };

  // ---------- style library ----------
  const S = {};

  // 1. block-sweep : colour block covers the word while it is spoken
  S['block-sweep'] = {
    label: '색 블록 훑기', group: { maxChars: portrait ? 11 : 24, maxWords: portrait ? 4 : 7 },
    build(ph, el) {
      const ln = mk('div', 'ln', el); ph.els = ph.words.map((w) => {
        const s = mk('span', 'w', ln, w.text); s.style.padding = '0 .12em'; s.style.isolation = 'isolate';
        const b = mk('i', 'blk', s); Object.assign(b.style, { position: 'absolute', left: 0, right: 0, top: '.06em', bottom: '.0em', background: w === ph.key ? PAL.accent2 : PAL.accent, transformOrigin: 'left center', transform: 'scaleX(0)', zIndex: -1, borderRadius: '.14em' });
        s.b = b; return s;
      });
    },
    update(ph, t) {
      ph.words.forEach((w, k) => {
        const s = ph.els[k], on = t >= w.start && t < w.end + 0.08;
        const p = easeOut((t - w.start) / 0.11), fade = clamp(1 - (t - (w.end + 0.08)) / 0.18);
        s.b.style.transform = `scaleX(${t < w.start ? 0 : p})`; s.b.style.opacity = t < w.end + 0.08 ? 1 : fade;
        s.style.color = on ? '#0b0b0f' : '#fff'; s.style.textShadow = on ? 'none' : OUT(0.055);
        s.style.opacity = t < w.start ? 0.82 : 1;
        s.style.transform = on ? `scale(${1 + 0.07 * p})` : 'scale(1)';
      });
    },
  };

  // 2. pop-word : one or two words at a time, bounce-in
  S['pop-word'] = {
    label: '한 단어 팝', slack: 1.1, noFade: true, scale: 1.28, group: { maxChars: portrait ? 7 : 12, maxWords: 2 },
    build(ph, el, mix) {
      const ln = mk('div', 'ln', el); ln.style.fontFamily = 'CapDisplay,CapMain,sans-serif'; ln.style.fontWeight = 400;
      ph.els = ph.words.map((w) => { const s = mk('span', 'w', ln, w.text); s.style.color = w === ph.key ? keyColor(ph, mix) : '#fff'; return s; });
    },
    update(ph, t) {
      ph.words.forEach((w, k) => {
        const s = ph.els[k], p = (t - w.start) / 0.2, vis = t >= w.start - 0.01;
        s.style.opacity = vis ? 1 : 0;
        const sc = vis ? 0.55 + 0.45 * easeBack(p) : 0.55;
        s.style.transform = `scale(${sc}) rotate(${(w === ph.key ? -3 : 0) * (1 - clamp(p)) - (w === ph.key ? 3 : 0)}deg)`;
        s.style.textShadow = OUT(0.06);
      });
    },
  };

  // 3. karaoke-fill : colour sweeps through each word
  S['karaoke-fill'] = {
    label: '노래방 채우기', group: { maxChars: portrait ? 11 : 22, maxWords: portrait ? 4 : 6 },
    build(ph, el) {
      const ln = mk('div', 'ln', el); ph.els = ph.words.map((w) => {
        const s = mk('span', 'w', ln, w.text); s.style.color = '#fff'; s.style.textShadow = OUT(0.06);
        const f = mk('span', 'f', s, w.text); Object.assign(f.style, { position: 'absolute', left: 0, top: 0, color: PAL.accent, textShadow: OUT(0.06), clipPath: 'inset(0 100% 0 0)' });
        s.f = f; return s;
      });
    },
    update(ph, t) { ph.words.forEach((w, k) => { const s = ph.els[k], p = clamp((t - w.start) / w.dur); s.f.style.clipPath = `inset(0 ${(1 - p) * 100}% 0 0)`; }); },
  };

  // 4. hero-key : the key word slams in big (display font), other words small
  S['hero-key'] = {
    label: '핵심어 히어로', slack: 1.25, group: { maxChars: portrait ? 12 : 22, maxWords: portrait ? 4 : 6 },
    build(ph, el, mix) {
      buildRows(ph, el, '0.7em', (ks) => Object.assign(ks.style, { fontFamily: 'CapDisplay,CapMain,sans-serif', fontWeight: 400, fontSize: '2.1em', lineHeight: '1.0', color: keyColor(ph, mix), textShadow: OUT(0.05) + `,0 0 .3em ${keyColor(ph, mix)}55` }));
    },
    update(ph, t) {
      ph.words.forEach((w) => {
        const s = ph.els[w.i]; const p = (t - w.start) / (w === ph.key ? 0.22 : 0.16); const vis = t >= w.start - 0.01;
        if (w === ph.key) { s.style.opacity = vis ? 1 : 0; s.style.transform = `scale(${vis ? 1 + 0.25 * (1 - easeExpo(p)) : 1.25}) rotate(-3deg)`; } else smallEnter(s, p, vis);
      });
    },
  };

  // 5. stack-kinetic : sizes by importance, words fly in from alternating sides
  S['stack-kinetic'] = {
    label: '크기 대비 쌓기', group: { maxChars: portrait ? 13 : 24, maxWords: portrait ? 5 : 8 },
    build(ph, el, mix) {
      const ln = mk('div', 'ln', el); ln.style.columnGap = '.22em';
      ph.els = ph.words.map((w, k) => {
        const n = strip(w.text).length, key = w === ph.key; const s = mk('span', 'w', ln, w.text);
        s.style.fontSize = (key ? 1.55 : n <= 2 ? 0.72 : 1) + 'em'; s.style.color = key ? keyColor(ph, mix) : '#fff';
        if (key) { s.style.fontFamily = 'CapDisplay,CapMain,sans-serif'; s.style.fontWeight = 400; }
        s.style.textShadow = OUT(0.065); s.dir = [-1, 0, 1, 0][k % 4]; s.dirY = [0, 1, 0, -1][k % 4]; return s;
      });
    },
    update(ph, t) {
      ph.words.forEach((w, k) => {
        const s = ph.els[k], p = easeOut((t - w.start) / 0.24), vis = t >= w.start - 0.01;
        s.style.opacity = vis ? p : 0; s.style.transform = `translate(${(1 - p) * 0.5 * s.dir}em,${(1 - p) * 0.4 * s.dirY}em)`; s.style.filter = `blur(${(1 - p) * 8}px)`;
      });
    },
  };

  // 6. underline-ink : calm; accent underline draws under the spoken word (no marker block over the text)
  S['underline-ink'] = {
    label: '밑줄 짚기', group: { maxChars: portrait ? 12 : 26, maxWords: portrait ? 4 : 8 },
    build(ph, el) {
      const ln = mk('div', 'ln', el); ln.style.fontFamily = 'CapCalm,CapMain,sans-serif'; ln.style.fontWeight = 700;
      ph.els = ph.words.map((w) => {
        const s = mk('span', 'w', ln, w.text); s.style.textShadow = OUT(0.06);
        const u = mk('i', 'u', s); Object.assign(u.style, { position: 'absolute', left: 0, right: 0, bottom: '-.04em', height: '.11em', background: w === ph.key ? PAL.accent2 : PAL.accent, borderRadius: '.06em', transformOrigin: 'left', transform: 'scaleX(0)' });
        s.u = u; return s;
      });
    },
    update(ph, t) {
      ph.words.forEach((w, k) => {
        const s = ph.els[k], p = easeOut((t - w.start) / Math.max(0.18, Math.min(0.4, w.dur)));
        s.u.style.transform = `scaleX(${t < w.start ? 0 : p})`;
        const on = t >= w.start && t < w.end + 0.05; s.style.opacity = t < w.start ? 0.62 : 1; s.style.transform = `translateY(${on ? -0.04 : 0}em)`;
      });
    },
  };

  // 7. glass-card : dark rounded card, active word lights up
  S['glass-card'] = {
    label: '유리 카드', group: { maxChars: portrait ? 12 : 26, maxWords: portrait ? 4 : 8 },
    build(ph, el) {
      const card = mk('div', 'card', el); Object.assign(card.style, { background: 'rgba(12,16,28,.76)', border: '2px solid rgba(255,255,255,.2)', borderRadius: '.5em', padding: '.28em .62em .32em', boxShadow: '0 .3em 1em rgba(0,0,0,.45)', position: 'relative', fontSize: '0.86em' });
      const bar = mk('i', 'bar', card); Object.assign(bar.style, { position: 'absolute', left: '.22em', top: '.3em', bottom: '.3em', width: '.1em', borderRadius: '.05em', background: PAL.accent });
      const ln = mk('div', 'ln', card); ln.style.paddingLeft = '.18em'; ph.card = card;
      ph.els = ph.words.map((w) => mk('span', 'w', ln, w.text));
    },
    update(ph, t) {
      const e = easeOut((t - ph.vs) / 0.22); ph.card.style.transform = `translateY(${(1 - e) * 0.35}em)`;
      ph.words.forEach((w, k) => { const s = ph.els[k], on = t >= w.start && t < w.end + 0.05; s.style.color = on ? PAL.accent : t >= w.end ? '#fff' : 'rgba(255,255,255,.58)'; s.style.transform = `scale(${on ? 1.06 : 1})`; });
    },
  };

  // 8. neon-glow : words ignite one by one
  S['neon-glow'] = {
    label: '네온 점등', group: { maxChars: portrait ? 11 : 22, maxWords: portrait ? 4 : 6 },
    build(ph, el) { const ln = mk('div', 'ln', el); ln.style.letterSpacing = '.03em'; ln.style.fontWeight = 700; ph.els = ph.words.map((w) => mk('span', 'w', ln, w.text)); },
    update(ph, t) {
      ph.words.forEach((w, k) => {
        const s = ph.els[k], c = w === ph.key ? PAL.accent2 : PAL.accent, p = t - w.start;
        if (p < 0) { s.style.opacity = 0.28; s.style.color = '#cfd6e6'; s.style.textShadow = 'none'; return; }
        const flick = p < 0.18 ? (Math.sin(p * 90) > -0.3 ? 1 : 0.35) : 1;
        s.style.opacity = flick; s.style.color = '#fff'; s.style.textShadow = `0 0 .12em ${c},0 0 .32em ${c},0 0 .7em ${c}99,` + OUT(0.04, 'rgba(6,6,14,.85)');
      });
    },
  };

  // 9. lead-big : small lead-in line + one big bold key word whose colour rotates (white / accent / accent2)
  S['lead-big'] = {
    label: '작은말+큰핵심어', slack: 1.25, group: { maxChars: portrait ? 12 : 22, maxWords: portrait ? 4 : 6 },
    build(ph, el) {
      const c = CYCLE[ph.k % CYCLE.length];
      buildRows(ph, el, '0.72em', (ks) => Object.assign(ks.style, { fontSize: '1.85em', lineHeight: '1.02', color: c, textShadow: OUT(0.055) }));
      ph.els.forEach((s) => { if (s !== ph.els[ph.key.i]) { s.style.fontWeight = 700; } });
    },
    update(ph, t) {
      ph.words.forEach((w) => {
        const s = ph.els[w.i], vis = t >= w.start - 0.01;
        if (w === ph.key) { const p = (t - w.start) / 0.3; s.style.opacity = vis ? 1 : 0; s.style.transform = `translateY(${vis ? (1 - easeBack(p)) * 0.5 : 0.5}em) scale(${vis ? 0.85 + 0.15 * easeBack(p) : 0.85})`; }
        else smallEnter(s, (t - w.start) / 0.16, vis);
      });
    },
  };

  // 10. chip-label : key word gets a highlighter chip (accent bar, dark text), words rise one by one
  S['chip-label'] = {
    label: '라벨 칩', group: { maxChars: portrait ? 11 : 24, maxWords: portrait ? 4 : 7 },
    build(ph, el) {
      const ln = mk('div', 'ln', el); ph.els = ph.words.map((w) => {
        const s = mk('span', 'w', ln, w.text); s.style.textShadow = OUT(0.065);
        if (w === ph.key) Object.assign(s.style, { padding: '0 .22em', background: PAL.accent, color: '#0b0b0f', textShadow: 'none', borderRadius: '.16em', boxShadow: '0 .08em .3em rgba(0,0,0,.35)' });
        return s;
      });
    },
    update(ph, t) {
      ph.words.forEach((w, k) => {
        const s = ph.els[k], vis = t >= w.start - 0.01, p = (t - w.start) / 0.2;
        s.style.opacity = vis ? 1 : 0;
        if (w === ph.key) s.style.transform = `scale(${vis ? 0.6 + 0.4 * easeBack(p) : 0.6}) rotate(-2.5deg)`; else smallEnter(s, p, vis);
      });
    },
  };

  // 11. stamp : key word is stamped in a rotated red outline box, other words small
  S['stamp'] = {
    label: '도장 찍기', slack: 1.18, group: { maxChars: portrait ? 12 : 22, maxWords: portrait ? 4 : 6 },
    build(ph, el) {
      buildRows(ph, el, '0.78em', (ks) => Object.assign(ks.style, { fontSize: '1.5em', color: PAL.accent2, border: `.09em solid ${PAL.accent2}`, borderRadius: '.18em', padding: '.04em .3em .08em', background: 'rgba(0,0,0,.28)', textShadow: '0 0 .05em rgba(0,0,0,.5)', letterSpacing: '.02em' }));
    },
    update(ph, t) {
      ph.words.forEach((w) => {
        const s = ph.els[w.i], vis = t >= w.start - 0.01;
        if (w === ph.key) { const p = (t - w.start) / 0.16; s.style.opacity = vis ? 1 : 0; s.style.transform = `scale(${vis ? 1 + 0.3 * (1 - easeOut(p)) : 1.3}) rotate(-5deg)`; } else smallEnter(s, (t - w.start) / 0.16, vis);
      });
    },
  };

  // 12. line-rise : each word slides up out of a mask (calm editorial reveal)
  S['line-rise'] = {
    label: '줄마다 올라오기', group: { maxChars: portrait ? 12 : 26, maxWords: portrait ? 4 : 8 },
    build(ph, el) {
      const ln = mk('div', 'ln', el); ln.style.columnGap = '.12em'; ph.els = ph.words.map((w) => {
        const s = mk('span', 'w', ln, ''); Object.assign(s.style, { overflow: 'hidden', padding: '.12em .1em .18em', margin: '-.12em -.1em -.18em' });
        const i = mk('span', 'in', s, w.text); i.style.display = 'inline-block'; i.style.textShadow = OUT(0.06); if (w === ph.key) i.style.color = PAL.accent; s.inner = i; return s;
      });
    },
    update(ph, t) { ph.words.forEach((w, k) => { const p = easeOut((t - w.start + 0.04) / 0.26); ph.els[k].inner.style.transform = `translateY(${t < w.start - 0.04 ? 120 : (1 - p) * 120}%)`; }); },
  };

  // 13. hand-note : handwriting face, slight wobble, scribble underline under the key word (casual / vlog tone)
  S['hand-note'] = {
    label: '손글씨 메모', group: { maxChars: portrait ? 11 : 22, maxWords: portrait ? 4 : 6 },
    build(ph, el) {
      const ln = mk('div', 'ln', el); ln.style.fontFamily = 'CapHand,CapMain,sans-serif'; ln.style.fontWeight = 700; ln.style.fontSize = '1.2em';
      ph.els = ph.words.map((w, k) => {
        const s = mk('span', 'w', ln, w.text); s.style.textShadow = OUT(0.07); s.rot = [-2, 1.5, -1, 2.5][k % 4];
        if (w === ph.key) { s.style.color = PAL.accent; const u = mk('i', 'u', s); Object.assign(u.style, { position: 'absolute', left: '-2%', right: '-2%', bottom: '-.02em', height: '.1em', background: PAL.accent, borderRadius: '.1em', transformOrigin: 'left', transform: 'scaleX(0) rotate(-1.5deg)' }); s.u = u; }
        return s;
      });
    },
    update(ph, t) {
      ph.words.forEach((w, k) => {
        const s = ph.els[k], vis = t >= w.start - 0.01, p = (t - w.start) / 0.18;
        s.style.opacity = vis ? 1 : 0; s.style.transform = `rotate(${s.rot}deg) scale(${vis ? 0.7 + 0.3 * easeBack(p) : 0.7})`;
        if (s.u) s.u.style.transform = `scaleX(${vis ? easeOut((t - w.start - 0.05) / 0.3) : 0}) rotate(-1.5deg)`;
      });
    },
  };

  // 14. line-focus : the spoken line sits on a solid panel; words have three states (not yet / speaking / spoken)
  S['line-focus'] = {
    label: '줄 패널 강조', group: { maxChars: portrait ? 11 : 20, maxWords: portrait ? 4 : 6 },
    build(ph, el) {
      const panel = mk('div', 'panel', el); Object.assign(panel.style, { background: '#2447ff', borderRadius: '.3em', padding: '.16em .5em .22em', boxShadow: '0 .2em .8em rgba(0,0,0,.4)' });
      const ln = mk('div', 'ln', panel); ph.panel = panel; ph.els = ph.words.map((w) => mk('span', 'w', ln, w.text));
    },
    update(ph, t) {
      const e = easeOut((t - ph.vs) / 0.18); ph.panel.style.transform = `scale(${0.92 + 0.08 * e})`;
      ph.words.forEach((w, k) => {
        const s = ph.els[k], on = t >= w.start && t < w.end + 0.04;
        s.style.color = on ? PAL.accent : t >= w.end ? '#fff' : 'rgba(255,255,255,.55)'; s.style.transform = `scale(${on ? 1.08 : 1})`;
        s.style.textShadow = on ? `0 0 .35em ${PAL.accent}88` : 'none';
      });
    },
  };

  // 15. fill-rise : outlined letters fill up from the bottom while the word is spoken (good for lyric hooks)
  S['fill-rise'] = {
    label: '윤곽 채움', slack: 1.1, group: { maxChars: portrait ? 8 : 16, maxWords: portrait ? 3 : 5 },
    build(ph, el, mix) {
      const ln = mk('div', 'ln', el); ln.style.fontFamily = 'CapDisplay,CapMain,sans-serif'; ln.style.fontWeight = 400; ln.style.fontSize = '1.25em';
      ph.els = ph.words.map((w) => {
        const s = mk('span', 'w', ln, w.text); Object.assign(s.style, { color: 'transparent', webkitTextStroke: '.04em #fff', filter: 'drop-shadow(0 .04em .07em rgba(0,0,0,.75))' });
        const f = mk('span', 'f', s, w.text); Object.assign(f.style, { position: 'absolute', left: 0, top: 0, color: w === ph.key ? PAL.accent2 : PAL.accent, webkitTextStroke: '0', clipPath: 'inset(100% 0 0 0)' }); s.f = f; return s;
      });
    },
    update(ph, t) { ph.words.forEach((w, k) => { const p = clamp((t - w.start) / Math.max(0.2, w.dur)); ph.els[k].f.style.clipPath = `inset(${(1 - easeOut(p)) * 100}% 0 0 0)`; }); },
  };

  // 16. impact-wide : the phrase is blown up to fill the width (1-2 short words, display face) - for hooks, titles, punch lines
  S['impact-wide'] = {
    label: '꽉 찬 큰 글씨', fill: 2.4, slack: 1.1, group: { maxChars: portrait ? 6 : 10, maxWords: 2 },
    build(ph, el, mix) {
      const ln = mk('div', 'ln', el); ln.style.fontFamily = 'CapDisplay,CapMain,sans-serif'; ln.style.fontWeight = 400; ln.style.lineHeight = '1.0';
      ph.els = ph.words.map((w) => { const s = mk('span', 'w', ln, w.text); s.style.color = w === ph.key ? keyColor(ph, mix) : '#fff'; s.style.textShadow = OUT(0.045); return s; });
    },
    update(ph, t) { ph.words.forEach((w, k) => { const s = ph.els[k], p = easeBack((t - w.start) / 0.18), vis = t >= w.start - 0.01; s.style.opacity = vis ? 1 : 0; s.style.transform = `scale(${vis ? 0.7 + 0.3 * p : 0.7})`; }); },
  };

  // 17. news-bar : dark band with a coloured edge tab slides in from the left; words appear as spoken, key word in the accent colour
  S['news-bar'] = {
    label: '뉴스 띠', group: { maxChars: portrait ? 12 : 24, maxWords: portrait ? 4 : 7 },
    build(ph, el) {
      const bar = mk('div', 'card', el); Object.assign(bar.style, { background: 'rgba(8,10,18,.84)', borderRadius: '.18em', padding: '.2em .6em .26em .95em', position: 'relative', fontSize: '.9em', boxShadow: '0 .2em .7em rgba(0,0,0,.45)' });
      const tab = mk('i', 'tab', bar); Object.assign(tab.style, { position: 'absolute', left: 0, top: 0, bottom: 0, width: '.3em', background: PAL.accent2, borderRadius: '.18em 0 0 .18em' });
      const ln = mk('div', 'ln', bar); ph.card = bar; ph.els = ph.words.map((w) => { const s = mk('span', 'w', ln, w.text); if (w === ph.key) s.style.color = PAL.accent; return s; });
    },
    update(ph, t) { const e = easeOut((t - ph.vs) / 0.22); ph.card.style.transform = `translateX(${(1 - e) * -1.4}em)`; ph.words.forEach((w, k) => { ph.els[k].style.opacity = t >= w.start - 0.02 ? 1 : 0.0; }); },
  };

  // 18. typewriter : letters appear one by one while each word is spoken, blinking caret
  S['typewriter'] = {
    label: '타자기', group: { maxChars: portrait ? 10 : 20, maxWords: portrait ? 3 : 6 },
    build(ph, el) {
      const ln = mk('div', 'ln', el); ln.style.fontFamily = 'CapCalm,CapMain,sans-serif'; ph.chars = [];
      ph.els = ph.words.map((w) => { const s = mk('span', 'w', ln, ''); s.style.textShadow = OUT(0.06); if (w === ph.key) s.style.color = PAL.accent; ph.chars.push([...w.text].map((c) => { const i = mk('span', 'c', s, c); i.style.display = 'inline-block'; return i; })); return s; });
      const caret = mk('i', 'caret', ln); Object.assign(caret.style, { display: 'inline-block', width: '.08em', height: '.9em', background: PAL.accent, marginLeft: '.05em', alignSelf: 'center' }); ph.caret = caret;
    },
    update(ph, t) { ph.words.forEach((w, k) => { const cs = ph.chars[k], p = clamp((t - w.start) / Math.max(0.15, w.dur * 0.8)); cs.forEach((c, i) => { c.style.opacity = p * cs.length > i ? 1 : 0; }); }); ph.caret.style.opacity = Math.floor(t * 4) % 2 === 0 ? 1 : 0.2; },
  };

  // 19. wave : letters of the spoken word bob like a wave and take the accent colour
  S['wave'] = {
    label: '출렁 글자', group: { maxChars: portrait ? 9 : 18, maxWords: portrait ? 3 : 6 },
    build(ph, el) {
      const ln = mk('div', 'ln', el); ph.chars = [];
      ph.els = ph.words.map((w) => { const s = mk('span', 'w', ln, ''); s.style.textShadow = OUT(0.065); ph.chars.push([...w.text].map((c) => { const i = mk('span', 'c', s, c); i.style.display = 'inline-block'; return i; })); return s; });
    },
    update(ph, t) { ph.words.forEach((w, k) => { const on = t >= w.start && t < w.end + 0.1; ph.chars[k].forEach((c, i) => { c.style.transform = on ? `translateY(${(-Math.sin((t - w.start) * 14 - i * 0.7) * 0.12).toFixed(3)}em)` : 'translateY(0)'; c.style.color = on ? (w === ph.key ? PAL.accent2 : PAL.accent) : '#fff'; }); ph.els[k].style.opacity = t < w.start ? 0.7 : 1; }); },
  };

  // ---------- mix: one style per phrase ----------
  const MIX_BASE = ['block-sweep', 'line-rise', 'chip-label', 'lead-big', 'underline-ink', 'stack-kinetic', 'karaoke-fill'];
  const MIX_KEY = ['hero-key', 'stamp', 'lead-big'];
  function planFor(ph, hist) {
    for (const r of D.plan || []) if (ph.start >= r.from && ph.start < r.to && S[r.style]) return r.style;
    let pool;
    if (ph.hook && D.hook !== 'off') pool = ['hero-key', 'impact-wide', 'stack-kinetic', 'stamp'];
    else if (ph.words.length <= 2) pool = ['pop-word', 'hero-key'];
    else if (ph.hasNum) pool = ['hero-key', 'chip-label'];
    else if (ph.hasEmph) pool = MIX_KEY;
    else pool = MIX_BASE;
    const recent = hist.slice(-2);
    let cand = pool.filter((s) => !recent.includes(s));
    if (!cand.length) cand = pool.filter((s) => s !== hist[hist.length - 1]);
    if (!cand.length) cand = pool;
    return cand[ph.k % cand.length];
  }

  // ---------- engine ----------
  const isMix = styleId === 'mix';
  if (!isMix && !S[styleId]) throw new Error('unknown style ' + styleId + ' / ' + Object.keys(S).join(','));
  const phrases = group(isMix ? { maxChars: portrait ? 12 : 24, maxWords: portrait ? 4 : 7 } : S[styleId].group);
  // hook / chorus detection: a phrase whose text appears 2+ times (repeated chorus lines) is a hook -> bigger, centred, punchier styles (D.hook = 'off' turns this off)
  // (counted as a piece of the whole text, so a chorus line still counts when it was split into phrases differently the second time)
  { const all = words.map((w) => strip(w.text)).join('').toLowerCase(); const count = (s) => { let n = 0, i = -1; while ((i = all.indexOf(s, i + s.length)) >= 0) n++; return n; }; phrases.forEach((ph) => { ph.hk = ph.words.map((w) => strip(w.text)).join('').toLowerCase(); ph.hook = D.hook !== 'off' && ph.hk.length >= 6 && count(ph.hk) >= 2; }); }
  if (isMix) { const hist = []; phrases.forEach((ph) => { ph.sid = planFor(ph, hist); hist.push(ph.sid); }); window.mixPlan = phrases.map((p) => ({ k: p.k, start: +p.start.toFixed(2), style: p.sid })); }
  else phrases.forEach((ph) => { ph.sid = styleId; });
  if (DECO.has('emoji')) { let prevE = ''; phrases.forEach((ph) => { const order = [ph.key, ...ph.words.filter((w) => w !== ph.key)]; for (const w of order) { const k = emoMatch(strip(w.text)); if (k && EMO[k] !== prevE) { ph.emo = { e: EMO[k], w, at: w.start }; prevE = EMO[k]; break; } } }); }
  let shadeEl = document.getElementById('shade');
  if (!shadeEl && D.shade > 0) { shadeEl = document.createElement('div'); shadeEl.id = 'shade'; root.parentNode.insertBefore(shadeEl, root); }
  if (shadeEl) { const a = D.shade || 0, top = Math.max(0, zone.top - 0.07) * H, bot = Math.min(1, zone.bottom + 0.06) * H; Object.assign(shadeEl.style, { position: 'absolute', left: 0, width: W + 'px', top: top + 'px', height: (bot - top) + 'px', opacity: 0, background: `linear-gradient(to bottom, rgba(0,0,0,0), rgba(0,0,0,${a}) 30%, rgba(0,0,0,${a}) 70%, rgba(0,0,0,0))` }); }
  function elFor(ph, w) { const k = ph.words.indexOf(w); for (const c of [ph.els && ph.els[w.i], ph.els && ph.els[k]]) if (c && c.textContent.includes(w.text)) return c; return null; }
  function buildDeco(ph) {
    ph.deco = null; if (!DECO.size) return;
    const br = box.getBoundingClientRect(); const els = [...box.querySelectorAll('.w, .card')]; if (!els.length || !br.width) return;
    let x0 = 1e9, x1 = -1e9; els.forEach((e) => { const r = e.getBoundingClientRect(); if (r.width) { x0 = Math.min(x0, r.left); x1 = Math.max(x1, r.right); } });
    box.style.position = 'relative'; const d = {};
    if (DECO.has('line')) {
      const c = keyColor(ph, isMix); const line = mk('i', 'dec', box); Object.assign(line.style, { left: (x0 - br.left - 6) + 'px', width: (x1 - x0 + 12) + 'px', bottom: '.06em', height: '.085em', background: c, borderRadius: '.05em', transformOrigin: 'left center', transform: 'scaleX(0)', boxShadow: '0 .03em .12em rgba(0,0,0,.6)' });
      const dot = mk('i', 'dec', box); Object.assign(dot.style, { left: (x0 - br.left - 6) + 'px', bottom: '.0em', width: '.2em', height: '.2em', borderRadius: '50%', background: c, marginLeft: '-.06em', boxShadow: '0 .03em .12em rgba(0,0,0,.6)', opacity: 0 });
      d.line = line; d.dot = dot; d.w = x1 - x0 + 12;
    }
    if (ph.emo) {
      const el = elFor(ph, ph.emo.w); const r = el ? el.getBoundingClientRect() : null; let cx = r ? r.left + r.width / 2 - br.left : (x0 + x1) / 2 - br.left;
      const em = mk('span', 'dec', box, ph.emo.e); Object.assign(em.style, { left: cx + 'px', top: '0', fontSize: '1.75em', lineHeight: '1', fontFamily: '"Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",sans-serif', filter: 'drop-shadow(0 .05em .08em rgba(0,0,0,.55))', opacity: 0, transformOrigin: '50% 80%' });
      d.emo = em; d.at = ph.emo.at;
    }
    ph.deco = d;
  }
  function updateDeco(ph, t) {
    const d = ph.deco; if (!d) return;
    if (d.line) { const p = easeOut((t - ph.vs) / 0.4); d.line.style.transform = `scaleX(${p})`; d.dot.style.opacity = p > 0.02 ? 1 : 0; d.dot.style.left = `calc(${(d.line.style.left)} + ${(d.w * p).toFixed(1)}px)`; }
    if (d.emo) { const p = (t - d.at) / 0.28, vis = t >= d.at - 0.01; d.emo.style.opacity = vis ? 1 : 0; d.emo.style.transform = `translate(-50%,0) translateY(${vis ? -Math.sin(Math.max(0, t - d.at) * 5) * 0.06 : 0.3}em) scale(${vis ? 0.35 + 0.65 * easeBack(p) : 0.35}) rotate(${(1 - clamp(p)) * -22}deg)`; }
  }
  // ---------- caption POSITIONS: left / right / top / bottom variety, always inside platform-safe areas ----------
  // landscape: nothing below zone.bottom (YouTube caption area stays free); portrait: nothing in the bottom 25%, top 10% and right 10% (app UI)
  const zt = zone.top, zb = zone.bottom, CH = portrait ? (zb - zt) + 0.04 : 0.26, MID = (zt + zb) / 2;
  const pc = (cy) => ({ t: cy - CH / 2, b: cy + CH / 2 }), ptop = (t) => ({ t, b: t + CH });
  const POS = portrait ? {
    'mid-center': { l: .11, r: .89, ...pc(MID), ax: 'c', ay: 'c' }, 'mid-left': { l: .05, r: .80, ...pc(MID), ax: 'l', ay: 'c' }, 'mid-right': { l: .18, r: .88, ...pc(MID), ax: 'r', ay: 'c' },
    'upper-center': { l: .11, r: .89, ...pc(.25), ax: 'c', ay: 'c' }, 'upper-left': { l: .05, r: .80, ...pc(.25), ax: 'l', ay: 'c' }, 'upper-right': { l: .18, r: .88, ...pc(.25), ax: 'r', ay: 'c' },
  } : {
    'bottom-center': { l: .06, r: .94, t: zb - CH - 0.015, b: zb - 0.015, ax: 'c', ay: 'e' }, 'bottom-left': { l: .05, r: .56, t: zb - CH - 0.015, b: zb - 0.015, ax: 'l', ay: 'e' }, 'bottom-right': { l: .44, r: .95, t: zb - CH - 0.015, b: zb - 0.015, ax: 'r', ay: 'e' },
    'top-center': { l: .06, r: .94, ...ptop(.06), ax: 'c', ay: 's' }, 'upper-left': { l: .05, r: .56, ...ptop(.06), ax: 'l', ay: 's' }, 'upper-right': { l: .44, r: .95, ...ptop(.06), ax: 'r', ay: 's' },
    'mid-left': { l: .05, r: .50, ...ptop(.38), ax: 'l', ay: 'c' }, 'mid-right': { l: .50, r: .95, ...ptop(.38), ax: 'r', ay: 'c' }, 'mid-center': { l: .06, r: .94, ...ptop(.38), ax: 'c', ay: 'c' },
  };
  const PDEF = portrait ? 'mid-center' : 'bottom-center';
  const PSEQ_ALL = portrait ? ['mid-center', 'upper-left', 'mid-right', 'upper-right', 'mid-left', 'upper-center'] : ['bottom-center', 'upper-left', 'bottom-right', 'upper-right', 'bottom-left', 'mid-right', 'top-center', 'mid-left'];
  const PSEQ = PSEQ_ALL.filter((p) => !(D.posAvoid || []).includes(p));
  const PMODE = D.pos || 'varied';
  phrases.forEach((ph, i) => {
    let p = null; for (const r of D.posPlan || []) if (ph.start >= r.from && ph.start < r.to && POS[r.pos]) p = r.pos;
    if (!p && ph.hook && D.hook !== 'off' && POS['mid-center'] && !(D.posAvoid || []).includes('mid-center')) p = 'mid-center';
    if (!p) p = POS[PMODE] ? PMODE : PMODE === 'fixed' || !PSEQ.length ? PDEF : PSEQ[i % PSEQ.length];
    ph.pos = p; ph.pos0 = p;
  });
  // smallest allowed text size (px at this frame size): 40 px on 1080p landscape, 50 px on 1080x1920. A phrase that gets smaller than this in a half-width spot moves to the full-width spot of the same band.
  const MINPX = (portrait ? 50 : 40) * U;
  const WIDEN = portrait ? { 'mid-left': 'mid-center', 'mid-right': 'mid-center', 'upper-left': 'upper-center', 'upper-right': 'upper-center' } : { 'bottom-left': 'bottom-center', 'bottom-right': 'bottom-center', 'upper-left': 'top-center', 'upper-right': 'top-center', 'mid-left': 'mid-center', 'mid-right': 'mid-center' };
  Object.defineProperty(window, 'posPlan', { get: () => phrases.map((ph) => ({ k: ph.k, start: +ph.start.toFixed(2), pos: ph.pos, assigned: ph.pos0, minPx: ph.minPx === undefined ? null : +ph.minPx.toFixed(1) })) });
  let curPos = null;
  function applyPos(ph) {
    const P = POS[ph.pos]; curPos = P;
    const jx = { l: 'flex-start', c: 'center', r: 'flex-end' }[P.ax], ay = { s: 'flex-start', c: 'center', e: 'flex-end' }[P.ay];
    Object.assign(root.style, { left: (W * P.l) + 'px', width: (W * (P.r - P.l)) + 'px', top: (H * P.t) + 'px', height: (H * (P.b - P.t)) + 'px', justifyContent: jx, alignItems: ay, textAlign: { l: 'left', c: 'center', r: 'right' }[P.ax] });
    root.style.setProperty('--jc', jx); root.style.setProperty('--ai', jx);
    if (shadeEl) { const a = D.shade || 0, cw = W * (P.r - P.l), ch = H * (P.b - P.t), ex = cw * 0.18, ey = ch * 0.9; const gx = P.ax === 'l' ? 30 : P.ax === 'r' ? 70 : 50, gy = P.ay === 's' ? 38 : P.ay === 'e' ? 62 : 50;
      Object.assign(shadeEl.style, { left: (W * P.l - ex) + 'px', width: (cw + 2 * ex) + 'px', top: (H * P.t - ey) + 'px', height: (ch + 2 * ey) + 'px', background: `radial-gradient(ellipse at ${gx}% ${gy}%, rgba(0,0,0,${a}) 0%, rgba(0,0,0,${(a * 0.85).toFixed(3)}) 42%, rgba(0,0,0,0) 72%)` }); }
  }
  const BEATS = (D.beats || []).slice().sort((a, b) => a - b);
  let mounted = -1, box = null;
  const find = (t) => { let f = null; for (const ph of phrases) { if (t >= ph.vs && t < ph.ve) f = ph; } return f; };
  // faces (D.faces = [{t, boxes:[[x0,y0,x1,y1] as fractions]}] from find-faces.py): a caption must not cover a face. Spots are tried until the text is big enough AND clear of every face seen during the phrase.
  const FACES = D.faces || [];
  const facesFor = (ph) => FACES.filter((s) => s.t >= ph.vs - 0.5 && s.t <= ph.ve + 0.5).flatMap((s) => s.boxes.map((b) => [Math.max(0, b[0] - 0.03), Math.max(0, b[1] - 0.03), Math.min(1, b[2] + 0.03), Math.min(1, b[3] + 0.03)]));
  function faceHit(fb) {
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9; box.querySelectorAll('.w, .card').forEach((e) => { const r = e.getBoundingClientRect(); if (r.width) { x0 = Math.min(x0, r.left); y0 = Math.min(y0, r.top); x1 = Math.max(x1, r.right); y1 = Math.max(y1, r.bottom); } });
    const area = Math.max(1, (x1 - x0) * (y1 - y0)); let hit = 0;
    for (const f of fb) { const ix = Math.max(0, Math.min(x1, f[2] * W) - Math.max(x0, f[0] * W)), iy = Math.max(0, Math.min(y1, f[3] * H) - Math.max(y0, f[1] * H)); hit += ix * iy; }
    return Math.min(1, hit / area);
  }
  function mount(ph) {
    const fb = FACES.length ? facesFor(ph) : []; const avoid = D.posAvoid || [];
    const order = [ph.pos0]; if (WIDEN[ph.pos0]) order.push(WIDEN[ph.pos0]);
    if (fb.length) for (const p of Object.keys(POS)) if (!order.includes(p)) order.push(p);
    const cand = order.filter((p, i) => POS[p] && (i === 0 || !avoid.includes(p)));
    let best = null;
    for (const p of cand) { ph.pos = p; layout(ph); ph.faceHit = fb.length ? faceHit(fb) : 0; const score = (ph.minPx >= MINPX ? 0 : 1) + ph.faceHit * 10; if (!best || score < best.score) best = { p, score }; if (ph.minPx >= MINPX && ph.faceHit <= 0.02) { best = null; break; } }
    if (best && ph.pos !== best.p) { ph.pos = best.p; layout(ph); ph.faceHit = fb.length ? faceHit(fb) : 0; }
    ph.widened = ph.pos !== ph.pos0;
  }
  function layout(ph) {
    const sty = S[ph.sid];
    root.innerHTML = ''; box = mk('div', 'box', root); box.style.willChange = 'opacity';
    applyPos(ph);
    root.style.fontSize = (FS * (sty.scale || 1) * (ph.hook && D.hook !== 'off' ? 1.12 : 1)) + 'px';
    sty.build(ph, box, isMix); mounted = ph.k;
    if (DECO.has('emoji') && ph.emo) box.style.paddingTop = '1.75em'; // room for the emoji above the text
    if (DECO.has('line')) box.style.paddingBottom = '.34em'; // room for the accent line
    // auto-fit: shrink the whole phrase if wider than 90% of the frame (or taller than the portrait band)
    const els = box.querySelectorAll('.w, .card'); let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
    els.forEach((e) => { const r = e.getBoundingClientRect(); if (!r.width) return; x0 = Math.min(x0, r.left); x1 = Math.max(x1, r.right); y0 = Math.min(y0, r.top); y1 = Math.max(y1, r.bottom); });
    const cw = root.clientWidth, ch = root.clientHeight, bh = box.getBoundingClientRect().height; // box height includes the emoji / line padding
    const slack = sty.slack || 1; let ratio = Math.min(sty.fill || 1, (cw * 0.97) / ((x1 - x0) * slack));
    ratio = Math.min(ratio, (ch * 0.94) / (Math.max(bh, y1 - y0) * slack)); // 6% of the spot's height stays free for pop / swell animations
    box.style.fontSize = (ratio * 100).toFixed(1) + '%';
    // left/right-aligned captions grow toward the frame edge while they pop in (scale up to `slack`): keep that much room on the edge side
    if (curPos.ax !== 'c') { const grow = Math.max(0, ((sty.slack || 1) - 1) / 2) * (x1 - x0) * ratio + 6; if (curPos.ax === 'r') box.style.marginRight = grow + 'px'; else box.style.marginLeft = grow + 'px'; }
    buildDeco(ph);
    const wsz = [...box.querySelectorAll('.w')].map((e) => parseFloat(getComputedStyle(e).fontSize)).filter((n) => n > 0); ph.minPx = wsz.length ? Math.min(...wsz) : 99;
  }
  window.styles = { ...Object.fromEntries(Object.entries(S).map(([k, v]) => [k, v.label])), mix: '자동 섞기' };
  window.DURATION = D.duration;
  // mounts every phrase once and reports the smallest text size and the spot actually used (for QA)
  window.sizeScan = async () => { const out = []; for (const ph of phrases) { await window.seek((ph.vs + ph.ve) / 2); out.push({ k: ph.k, start: +ph.start.toFixed(2), text: ph.words.map((w) => w.text).join(' '), pos: ph.pos, assigned: ph.pos0, widened: !!ph.widened, minPx: +(ph.minPx === undefined ? 99 : ph.minPx).toFixed(1), ok: (ph.minPx === undefined ? 99 : ph.minPx) >= MINPX, faceHit: +(ph.faceHit || 0).toFixed(3) }); } return { minAllowed: +MINPX.toFixed(1), phrases: out }; };
  // QA data for the renderer: reading speed per phrase, and characters a font cannot draw (silently replaced by a fallback font)
  window.phraseStats = () => phrases.map((ph) => { const chars = ph.words.reduce((n, w) => n + [...strip(w.text)].length, 0); const vis = ph.ve - ph.vs; return { k: ph.k, start: +ph.start.toFixed(2), chars, visible: +vis.toFixed(2), cps: +(chars / vis).toFixed(1), text: ph.words.map((w) => w.text).join(' ') }; });
  window.fontCoverage = () => {
    const chars = [...new Set(words.flatMap((w) => [...strip(w.text)]))].filter((c) => !/\s/.test(c));
    const cv = document.createElement('canvas'); cv.width = cv.height = 64; const cx = cv.getContext('2d', { willReadFrequently: true });
    const px = (font, ch) => { cx.clearRect(0, 0, 64, 64); cx.font = font; cx.fillText(ch, 4, 48); return cx.getImageData(0, 0, 64, 64).data; };
    const res = {};
    for (const [name, spec] of [['CapMain', '800 40px'], ['CapDisplay', '400 40px'], ['CapCalm', '700 40px'], ['CapHand', '700 40px']]) {
      res[name] = chars.filter((ch) => { const a = px(`${spec} ${name}, "Zzz Fallback"`, ch), b = px(`${spec} "Zzz Fallback"`, ch); for (let i = 3; i < a.length; i += 4) if (a[i] !== b[i]) return false; return true; });
    }
    return res;
  };
  window.visible = (t) => !!find(t);
  window.seek = async (t) => {
    const ph = find(t);
    if (!ph) { root.innerHTML = ''; mounted = -1; if (shadeEl) shadeEl.style.opacity = 0; return; }
    const sty = S[ph.sid];
    if (mounted !== ph.k) { try { mount(ph); } catch (e) { console.error('build ' + ph.sid + ': ' + e.stack); throw e; } }
    box.style.opacity = sty.noFade ? 1 : Math.min(clamp((t - ph.vs) / 0.1), clamp((ph.ve - t) / 0.12));
    try { sty.update(ph, t); } catch (e) { console.error('update ' + ph.sid + ': ' + e.stack); throw e; }
    updateDeco(ph, t); if (shadeEl) shadeEl.style.opacity = box.style.opacity;
    // beat pulse: the whole caption swells a little on every beat of the song (D.beats = beat times in seconds; D.beatStrength default 0.045)
    if (BEATS.length) { let lo = 0, hi = BEATS.length - 1, b = -1; while (lo <= hi) { const mid = (lo + hi) >> 1; if (BEATS[mid] <= t) { b = mid; lo = mid + 1; } else hi = mid - 1; } const dt = b >= 0 ? t - BEATS[b] : 9; box.style.transform = dt < 0.4 ? `scale(${(1 + (D.beatStrength || 0.045) * Math.exp(-dt * 9)).toFixed(4)})` : 'none'; }
  };
  window.posRect = () => (mounted >= 0 && curPos ? { l: curPos.l, r: curPos.r, t: curPos.t, b: curPos.b } : null);
  window.bounds = () => {
    const els = root.querySelectorAll('.w, .card, .dec'); if (!els.length) return null;
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    els.forEach((e) => { const r = e.getBoundingClientRect(); if (r.width === 0 || getComputedStyle(e).opacity === '0') return; x0 = Math.min(x0, r.left); y0 = Math.min(y0, r.top); x1 = Math.max(x1, r.right); y1 = Math.max(y1, r.bottom); });
    return x0 > 1e8 ? null : { x0, y0, x1, y1, W, H };
  };
  Promise.all(['800 40px CapMain', '400 40px CapDisplay', '700 40px CapCalm', '700 40px CapHand'].map((f) => document.fonts.load(f, '가나다ABC'))).then(() => { window.ready = true; });
})();





