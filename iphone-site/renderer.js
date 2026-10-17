(() => {
'use strict';
/* =====================================================================
   FILM STUDIOS - frame-by-frame animation app
   Storage: the artifact's db (projects/{id} + projects/{id}/cells/{frame~layer~part}),
   falling back to this browser's IndexedDB when db is unavailable.
   ===================================================================== */
const $ = s => document.querySelector(s);
const ANDROID = !!(window.fsApi && ['android', 'ios'].includes(window.fsApi.platform));   // tablets (android/) and the iPhone web app (ios/): no folders to show
const IOS = !!(window.fsApi && window.fsApi.platform === 'ios');                          // the iPhone/iPad web app (ios/ in the source)
const DEVICE = IOS ? (/iPad/.test(navigator.userAgent) ? 'iPad' : 'iPhone') : 'tablet';
const BIN = IOS ? null : ANDROID ? 'Trash folder' : 'Recycle Bin';
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const uid = () => Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const PART = 190000;            // chars per stored image part (db docs max 256 KiB)
const MAX_LAYERS = 6;
const SIZES = [
  { key: '1280x720', w: 1280, h: 720, name: 'Widescreen', sub: '16:9 · YouTube' },
  { key: '1920x1080', w: 1920, h: 1080, name: 'Full HD', sub: '16:9 · 1080p' },
  { key: '1080x1920', w: 1080, h: 1920, name: 'Vertical', sub: '9:16 · Shorts' },
  { key: '1080x1080', w: 1080, h: 1080, name: 'Square', sub: '1:1' },
];
const PALETTE = ['#1b1420', '#efe6d6', '#ffffff', '#8e8a96', '#f1c6a0', '#c98b6b', '#8a5a3c', '#5a3626',
                 '#a3162b', '#ff8fd6', '#5a3a7a', '#b58cff', '#1e2440', '#c9d4f0', '#d8702a', '#ffd27a'];
const PALETTE_NAMES = ['Ink', 'Bone', 'White', 'Fog', 'Light skin', 'Warm skin', 'Deep skin', 'Hair brown',
                       'Blood', 'Cat pink', 'Bruise', 'Onion lilac', 'Night', 'Moon', 'Pumpkin', 'Candle'];

function toast(msg, ms = 2600) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toast._t); toast._t = setTimeout(() => t.hidden = true, ms);
}
function mk(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
function cssVar(n) { return getComputedStyle(document.documentElement).getPropertyValue(n).trim(); }
function esc(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function hexToRgb(h) { h = h.replace('#', ''); if (h.length === 3) h = h.split('').map(c => c + c).join(''); return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]; }
function rgbToHex(r, g, b) { return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join(''); }
function loadImg(src) { return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; }); }
function lsGet(k, d) { try { const v = localStorage.getItem('fs:' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } }
function lsSet(k, v) { try { localStorage.setItem('fs:' + k, JSON.stringify(v)); } catch (e) {} }

/* ------------------------------------------------------------------ storage */
class DesktopStore {
  constructor(api) { this.api = api; this.kind = 'desktop'; this.readOnly = false; this.wantsBlob = true; this.subs = []; this.q = new Map(); }
  _serial(key, fn) { const prev = this.q.get(key) || Promise.resolve(); const next = prev.catch(() => {}).then(fn); this.q.set(key, next); return next; }
  watchProjects(cb) { const run = async () => { try { cb(await this.api.list()); } catch (e) { console.warn(e); cb([]); } }; this.subs.push(run); run(); return () => {}; }
  refresh() { this.subs.forEach(f => f()); }
  saveProject(p) { const m = metaOf(p); return this._serial('p:' + p.id, () => this.api.saveMeta(p.id, m, p.thumb || '')); }
  async getProject(id) { return (await this.api.list()).find(p => p.id === id) || null; }
  async deleteProject(id) { await this.api.deleteProject(id); this.refresh(); }
  async loadCells(pid) {
    const r = await this.api.load(pid); const data = new Map();
    for (const c of r.cells) data.set(c.fid + '~' + c.lid, URL.createObjectURL(new Blob([c.buf], { type: 'image/png' })));
    if (r.bg) data.set('bg~bg', URL.createObjectURL(new Blob([r.bg], { type: 'image/jpeg' })));
    if (r.audio) data.set('audio~a', URL.createObjectURL(new Blob([r.audio.buf])));
    return { data, parts: new Map([...data.keys()].map(k => [k, 1])) };
  }
  saveCell(pid, fid, lid, payload) {
    return this._serial('c:' + pid + fid + lid, async () => {
      let buf = null;
      if (payload && payload.blob) buf = await payload.blob.arrayBuffer();
      else if (payload && payload.url) buf = await (await fetch(payload.url)).arrayBuffer();
      if (fid === 'bg') await this.api.saveBg(pid, buf);
      else if (fid === 'audio') await this.api.saveAudio(pid, (payload && payload.ext) || 'mp3', buf);
      else await this.api.saveCell(pid, fid, lid, buf);
      return buf ? 1 : 0;
    });
  }
}
function metaOf(p) {
  return { name: p.name, w: p.w, h: p.h, fps: p.fps, bg: p.bg, loop: p.loop !== false, layers: p.layers, frames: p.frames,
           thumb: p.thumb || '', notes: p.notes || '', hasBg: !!p.hasBg, hasAudio: !!p.hasAudio, audioName: p.audioName || '',
           audioOffset: p.audioOffset || 0, sample: !!p.sample, createdAt: p.createdAt || Date.now(), updatedAt: Date.now(),
           remixOf: p.remixOf || null, bgScene: p.bgScene || '' };
}

/* ------------------------------------------------------------------ state */
const S = {
  store: null, projects: [], proj: null,
  cells: new Map(),       // "fid~lid" -> canvas (project size)
  parts: new Map(),       // "fid~lid" -> stored part count
  saved: new Set(),       // keys present in storage
  cur: 0, layer: null, tool: 'pen', color: lsGet('color', '#1b1420'), size: lsGet('size', 8), opacity: lsGet('op', 1), smooth: lsGet('sm', 0.45),
  fillAll: false, onion: lsGet('onion', 1), onionOp: lsGet('onionOp', 0.35),
  playing: false, view: { z: 1, tx: 0, ty: 0 }, undo: [], redo: [], dirty: new Set(), metaDirty: false,
  bgImg: null, audio: null, penSeen: false,
};
const W = () => S.proj.w, H = () => S.proj.h;
const curFrame = () => S.proj.frames[S.cur];
const keyOf = (fid, lid) => fid + '~' + lid;
function getCell(fid, lid, create) {
  const k = keyOf(fid, lid); let c = S.cells.get(k);
  if (!c && create) { c = mk(W(), H()); S.cells.set(k, c); }
  return c || null;
}
function activeLayer() { return S.proj.layers.find(l => l.id === S.layer) || S.proj.layers[0]; }

/* ------------------------------------------------------------------ save status */
function setSave(msg, err) { const p = $('#savePill'); p.textContent = msg; p.classList.toggle('err', !!err); }
function setFoot(msg) { $('#gFoot').textContent = msg; }

/* ------------------------------------------------------------------ gallery */
function projLen(p) { return (p.frames || []).reduce((s, f) => s + (f.hold || 1), 0) / (p.fps || 12); }
function renderGallery() {
  const list = $('#gList'); list.innerHTML = '';
  const q = ($('#gSearch').value || '').trim().toLowerCase(), sort = lsGet('gSort', 'recent');
  document.querySelectorAll('#gSort button').forEach(b => b.classList.toggle('on', b.dataset.s === sort));
  let ps = [...S.projects];
  ps.sort(sort === 'name' ? (a, b) => (a.name || '').localeCompare(b.name || '') : sort === 'long' ? (a, b) => projLen(b) - projLen(a) : (a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  const shown = q ? ps.filter(p => (p.name || '').toLowerCase().includes(q)) : ps;
  $('#gEmpty').hidden = ps.length > 0; $('#gNone').hidden = !(ps.length && !shown.length);
  for (const p of shown) {
    const b = document.createElement('div'); b.className = 'card ears'; b.tabIndex = 0; b.setAttribute('role', 'button'); b.setAttribute('aria-label', 'Open ' + (p.name || 'Untitled'));
    const frames = (p.frames || []).length, fps = p.fps || 12;
    const len = projLen(p);
    b.innerHTML = `<div class="thumb">${p.thumb ? `<img alt="" src="${p.thumb}">` : ''}<div class="film"></div></div>
      <div class="meta"><b>${esc(p.name || 'Untitled')}${p.sample ? '<span class="tag">Example</span>' : ''}</b>
      <span class="mono">${frames} drawing${frames === 1 ? '' : 's'} · ${len.toFixed(1)} s · ${fps} fps · ${p.w}×${p.h}</span></div>
      <button class="card-more" title="More: rename, duplicate, delete…" aria-label="More for ${esc(p.name || 'Untitled')}"><svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg></button>`;
    b.onclick = e => { if (!e.target.closest('.card-more')) openProject(p.id); };
    b.onkeydown = e => { if (e.key === 'Enter' && e.target === b) openProject(p.id); };
    b.oncontextmenu = e => { e.preventDefault(); cardMenu(p); };
    b.querySelector('.card-more').onclick = e => { e.stopPropagation(); cardMenu(p); };
    list.appendChild(b);
  }
  setFoot(ANDROID ? 'Everything saves by itself on this ' + DEVICE + '. To back up an animation or move it to your PC, open it, tap the gear and choose Save a copy.'
    : 'Everything saves by itself to Documents\\ONION. Claude can open these through the Claude desktop app: just tell Claude the animation\'s name. Save a copy (in an animation\'s settings) makes one file you can back up or open on a tablet.');
  renderWidgets(); greet();
}
$('#gSearch').oninput = () => renderGallery();
/* the … menu on an animation (v1.6.1): open, theatre, rename, duplicate, save a copy, delete, whenever you like */
function cardMenu(p) {
  const sh = openSheet(`<h2>${esc(p.name || 'Untitled')}</h2><div class="cm-menu">
    <button class="list-btn" data-a="open"><svg viewBox="0 0 24 24"><path d="M4 20l4-1 11-11-3-3L5 16l-1 4z"/></svg><span><b>Open</b></span></button>
    <button class="list-btn" data-a="theatre"><svg viewBox="0 0 24 24"><path d="M3 4h18"/><path d="M4 4c0 6 1 11 4 15h2C8 14 8 8 9 4"/><path d="M20 4c0 6-1 11-4 15h-2c2-5 2-11 1-15"/></svg><span><b>Watch in the theatre</b></span></button>
    <button class="list-btn" data-a="rename"><svg viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16z"/></svg><span><b>Rename</b></span></button>
    <button class="list-btn" data-a="dup"><svg viewBox="0 0 24 24"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/></svg><span><b>Duplicate</b><small>A second copy to try things on</small></span></button>
    <button class="list-btn" data-a="copy"><svg viewBox="0 0 24 24"><path d="M12 4v11M7 10l5 5 5-5M5 20h14"/></svg><span><b>Save a copy (.onion)</b><small>One file to back up or move</small></span></button>
    <button class="list-btn danger-t" data-a="del"><svg viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/></svg><span><b>Delete</b><small>${BIN ? 'Goes to the ' + BIN : 'Gone for good from this ' + DEVICE}</small></span></button>
  </div><div class="actions"><button class="btn" data-close>Close</button></div>`);
  const on = (a, fn) => { sh.querySelector(`[data-a="${a}"]`).onclick = fn; };
  on('open', () => { closeSheet(); openProject(p.id); });
  on('theatre', async () => { closeSheet(); await openProject(p.id); openTheatre(); });
  on('rename', () => {
    const s2 = openSheet(`<h2>Rename</h2><label class="field"><span>Name</span><input type="text" id="rnName" maxlength="60" value="${esc(p.name || '')}"></label>
      <div class="actions"><button class="btn" data-close>Cancel</button><button class="btn primary" id="rnGo">Rename</button></div>`);
    const inp = s2.querySelector('#rnName'); setTimeout(() => inp.select(), 30);
    const go = async () => { const n = inp.value.trim(); if (!n) return; closeSheet(); try { const q = Object.assign({}, p, { name: n }); await S.store.saveProject(q); p.name = n; S.store.refresh(); toast('Renamed', 1200); } catch (e) { toast('Could not rename it.'); } };
    s2.querySelector('#rnGo').onclick = go; inp.onkeydown = e => { if (e.key === 'Enter') go(); };
  });
  on('dup', async () => {
    closeSheet(); toast('Duplicating…', 1500);
    try { const { blob } = await packProject(p.id); const r = await importOnion(await blob.arrayBuffer(), { name: (p.name || 'Untitled') + ' (copy)' }); toast(`Made “${r.meta.name}”`, 2200); }
    catch (e) { console.warn(e); toast('Could not duplicate it.'); }
  });
  on('copy', () => { closeSheet(); saveCopy(p.id); });
  on('del', () => confirmSheet('Delete animation?', `“${esc(p.name || 'Untitled')}” and all its drawings ${BIN ? 'go to the ' + BIN : 'are deleted for good'}.`, 'Delete', async () => {
    try { await S.store.deleteProject(p.id); S.projects = S.projects.filter(x => x.id !== p.id); renderGallery(); toast(BIN ? 'Moved to the ' + BIN : 'Deleted'); }
    catch (e) { toast('Could not delete it. Try again.'); }
  }));
}
document.querySelectorAll('#gSort button').forEach(b => b.onclick = () => { lsSet('gSort', b.dataset.s); renderGallery(); });

/* ------------------------------------------------------------------ home widgets + wallpaper (v1.6) */
const WIDGETS = [
  ['continue', 'Keep drawing', 'Your last animation, one tap away'], ['clock', 'Cat clock', 'The time, on a cat'], ['idea', 'Drawing idea', 'A new idea every day'],
  ['notifs', 'Notifications', 'Likes, remixes, collabs and news'], ['community', 'New on ONION', 'The newest community posts'], ['stats', 'My stats', 'How much you have animated'],
  ['colour', 'Colour of the day', 'Five colours that go together'], ['note', 'Sticky note', 'Write yourself a note'],
];
const WIDGET_DEFAULT = ['continue', 'clock', 'idea', 'notifs', 'community', 'stats'];
function widgetList() {
  let L = lsGet('widgets', null);
  if (!Array.isArray(L)) L = WIDGETS.map(([id]) => ({ id, on: WIDGET_DEFAULT.includes(id) }));
  for (const [id] of WIDGETS) if (!L.find(x => x.id === id)) L.push({ id, on: false });
  return L.filter(x => WIDGETS.find(w => w[0] === x.id));
}
const IDEAS = ['A cat chasing its own tail', 'A ghost who is scared of the dark', 'A pumpkin that sneezes', 'A snail racing a rocket', 'Rain that falls upward',
  'A sandcastle that walks into the sea', 'A candle flame dancing', 'A teacup storm', 'A fish who wants to fly', 'A sleepy moon yawning',
  'A slime that eats the letters of your name', 'A bouncing ball that gets tired', 'A dragon lighting a birthday cake', 'A cat in a theatre taking a bow',
  'Lightning hitting a tiny umbrella', 'A sock puppet that comes alive', 'A cloud that rains only on one cat', 'A wave surfing a cat', 'A haunted vending machine',
  'Footprints in the sand that keep going', 'A snowman melting in slow motion', 'A volcano burping', 'A paper plane journey', 'An onion that cries',
  'A blinking eye that turns into a door', 'A bat learning to fly', 'A smoke ring that turns into a cat', 'A jellyfish lamp', 'A shy monster under the bed',
  'Walk cycle: a very proud chicken', 'A spider knitting a sweater', 'A cactus hugging a balloon', 'A ladder to the stars', 'A cat knocking a cup off a table',
  'A tornado made of leaves', 'A tiny knight and a huge cat', 'The curtains open on... ?', 'Two ghosts dancing', 'A bubble that will not pop', 'Morning in a sleepy town'];
const dayNo = () => Math.floor((Date.now() - new Date().getTimezoneOffset() * 60000) / 86400000);
function ideaNow() { const o = lsGet('ideaOff', { d: 0, n: 0 }); const n = o.d === dayNo() ? o.n : 0; return IDEAS[(dayNo() * 7 + n) % IDEAS.length]; }
function dayColours() {
  const d = dayNo(), h = (d * 47) % 360, mode = d % 3;
  const hs = mode === 0 ? [h, h + 25, h + 50, h + 180, h + 205] : mode === 1 ? [h, h + 120, h + 240, h + 30, h + 150] : [h, h + 15, h + 30, h + 45, h + 200];
  return hs.map((x, i) => hslToHex({ h: ((x % 360) + 360) % 360, s: [0.75, 0.65, 0.8, 0.55, 0.7][i], l: [0.62, 0.5, 0.72, 0.38, 0.58][i] }));
}
const CLOCK_SVG = `<svg class="face" viewBox="0 0 100 100" aria-hidden="true">
  <path d="M14 44 L18 8 L38 24 Q50 20 62 24 L82 8 L86 44 Q94 60 86 76 Q74 96 50 96 Q26 96 14 76 Q6 60 14 44Z" fill="var(--lilac)" stroke="var(--ink)" stroke-width="4" stroke-linejoin="round"/>
  <path d="M22 18 L25 33 L34 27Z M78 18 L75 33 L66 27Z" fill="var(--pink)"/>
  <circle cx="50" cy="58" r="30" fill="var(--paper)" stroke="var(--ink)" stroke-width="3.5"/>
  ${Array.from({ length: 12 }, (_, i) => { const a = i / 12 * Math.PI * 2; return `<circle cx="${50 + Math.sin(a) * 25}" cy="${58 - Math.cos(a) * 25}" r="${i % 3 ? 1.4 : 2.4}" fill="#2a1748"/>`; }).join('')}
  <path d="M38 50 q3 -4 6 0 M56 50 q3 -4 6 0" fill="none" stroke="#2a1748" stroke-width="2.4" stroke-linecap="round" opacity=".35"/>
  <line class="hand hr" x1="50" y1="58" x2="50" y2="42" stroke="#2a1748" stroke-width="4.5" stroke-linecap="round"/>
  <line class="hand mn" x1="50" y1="58" x2="50" y2="35" stroke="#2a1748" stroke-width="3" stroke-linecap="round"/>
  <circle cx="50" cy="58" r="3.5" fill="var(--pink)" stroke="#2a1748" stroke-width="1.5"/></svg>`;
function tickClock() {
  const el = document.querySelector('.wd-clock'); if (!el) return;
  const d = new Date(), m = d.getMinutes(), hr = d.getHours() % 12 + m / 60;
  el.querySelector('.hr').setAttribute('transform', `rotate(${hr * 30} 50 58)`); el.querySelector('.mn').setAttribute('transform', `rotate(${m * 6} 50 58)`);
  el.querySelector('.tm').textContent = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  el.querySelector('.dt').textContent = d.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
}
setInterval(() => { if (!$('#gallery').hidden) tickClock(); }, 15000);
function greet() {
  const h = new Date().getHours(), part = h < 5 ? 'Up late' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
  const name = S.userName ? ', ' + S.userName : '';
  $('#greet').textContent = `${part}${name}! ${h >= 21 || h < 5 ? 'A spooky little animation before bed?' : 'What will you animate today?'}`;
}
function renderWidgets() {
  const box = $('#widgets'); box.innerHTML = '';
  const recent = [...S.projects].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))[0];
  for (const w of widgetList().filter(x => x.on)) {
    const el = document.createElement('div'); el.className = 'wd ears wd-' + w.id; el.dataset.w = w.id;
    const title = (WIDGETS.find(x => x[0] === w.id) || [])[1];
    if (w.id === 'continue') {
      el.classList.add('wide');
      el.innerHTML = recent ? `<div class="thumb">${recent.thumb ? `<img alt="" src="${recent.thumb}">` : ''}</div>
        <div class="info"><h3>Keep drawing</h3><b>${esc(recent.name || 'Untitled')}</b><p class="mono">${(recent.frames || []).length} drawings · ${projLen(recent).toFixed(1)} s</p>
          <div class="row2"><button class="btn primary" data-a="open"><svg viewBox="0 0 24 24"><path d="M4 20l4-1 11-11-3-3L5 16l-1 4z"/></svg>Keep drawing</button>
          <button class="btn" data-a="theatre"><svg viewBox="0 0 24 24"><path d="M3 4h18"/><path d="M4 4c0 6 1 11 4 15h2C8 14 8 8 9 4"/><path d="M20 4c0 6-1 11-4 15h-2c2-5 2-11 1-15"/></svg>Watch in the theatre</button></div></div>`
        : `<div class="info"><h3>Keep drawing</h3><b>Your first animation</b><p>Make a new animation, draw a frame, add more frames and press play.</p><div class="row2"><button class="btn primary" data-a="new">New animation</button></div></div>`;
      el.classList.add('wd-cont');
    } else if (w.id === 'clock') {
      el.innerHTML = `${CLOCK_SVG}<div><div class="tm">--:--</div><div class="dt"></div></div>`;
    } else if (w.id === 'idea') {
      el.innerHTML = `<h3>Drawing idea <small>today</small></h3><div class="idea">${esc(ideaNow())}</div>
        <div class="acts"><button class="btn primary" data-a="start">Start it</button><button class="btn" data-a="another">Another idea</button></div>`;
    } else if (w.id === 'stats') {
      const n = S.projects.length, dr = S.projects.reduce((s, p) => s + (p.frames || []).length, 0), secs = S.projects.reduce((s, p) => s + projLen(p), 0), lay = S.projects.reduce((s, p) => s + (p.layers || []).length, 0);
      el.innerHTML = `<h3>My stats</h3><div class="nums"><div><b>${n}</b><span>animations</span></div><div><b>${dr}</b><span>drawings</span></div>
        <div><b>${secs < 60 ? secs.toFixed(1) + ' s' : (secs / 60).toFixed(1) + ' min'}</b><span>of animation</span></div><div><b>${lay}</b><span>layers</span></div></div>`;
    } else if (w.id === 'colour') {
      const cs = dayColours();
      el.innerHTML = `<h3>Colour of the day</h3><div class="cname">${esc(colourName(cs[0]))}</div><div class="sw">${cs.map(c => `<button style="--c:${c}" data-c="${c}" title="Draw with ${c}"></button>`).join('')}</div><p>Tap one to draw with it.</p>`;
    } else if (w.id === 'note') {
      el.innerHTML = `<h3>Sticky note</h3><textarea id="wdNote" maxlength="600" placeholder="Ideas, to-dos, a secret plan…" aria-label="Sticky note">${esc(lsGet('note', ''))}</textarea>`;
    } else if (w.id === 'notifs') {
      el.innerHTML = `<h3>Notifications <small id="wdNotifCount"></small></h3><div class="nl" id="wdNotifList"><p>Loading…</p></div><div class="acts"><button class="btn" data-a="bell">See all</button></div>`;
    } else if (w.id === 'community') {
      el.innerHTML = `<h3>New on ONION</h3><div class="tiles" id="wdCmTiles"><p>Loading…</p></div><div class="acts"><button class="btn cm-open" data-a="community">Open Community</button></div>`;
    } else el.innerHTML = `<h3>${esc(title || w.id)}</h3>`;
    box.appendChild(el);
  }
  box.querySelectorAll('[data-a]').forEach(b => b.onclick = async () => {
    const a = b.dataset.a;
    if (a === 'open') openProject(recent.id);
    else if (a === 'theatre') { await openProject(recent.id); openTheatre(); }
    else if (a === 'new') newProjectSheet();
    else if (a === 'start') newProjectSheet(ideaNow());
    else if (a === 'another') { const o = lsGet('ideaOff', { d: 0, n: 0 }); lsSet('ideaOff', { d: dayNo(), n: (o.d === dayNo() ? o.n : 0) + 1 }); renderWidgets(); }
    else if (a === 'bell') openNotifs();
    else if (a === 'community') $('#communityBtn').click();
  });
  box.querySelectorAll('.wd-colour [data-c]').forEach(b => b.onclick = () => { S.color = b.dataset.c; lsSet('color', S.color); noteRecent(S.color); toast('Drawing colour: ' + colourName(S.color), 1600); });
  const note = $('#wdNote'); if (note) note.oninput = () => lsSet('note', note.value);
  tickClock();
  window.dispatchEvent(new CustomEvent('onion-widgets'));
}
function openNotifs() { if (window.OnionCommunity && window.OnionCommunity.openNotifs) window.OnionCommunity.openNotifs(); }
$('#bellBtn').onclick = openNotifs;

const WALLS = [['dots', 'Cat dots'], ['paws', 'Paw prints'], ['glow', 'Lilac glow'], ['velvet', 'Velvet'],
  ['s:night', 'Starry night'], ['s:spooky', 'Spooky moon'], ['s:space', 'Outer space'], ['s:underwater', 'Under the sea'], ['s:sunset', 'Sunset'], ['s:candy', 'Candy land'],
  ['s:sky', 'Sunny day'], ['s:stage', 'Theatre'], ['s:beach', 'Beach'], ['s:desert', 'Desert'], ['mine', 'Your picture']];
const WALL_CSS = {
  paws: `url("data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="90" height="90" viewBox="0 0 90 90"><g fill="#b58cff" opacity=".22"><g transform="translate(14 14) rotate(-15 12 12)"><ellipse cx="12" cy="16" rx="5.6" ry="4.6"/><circle cx="5.4" cy="10" r="2.4"/><circle cx="9.5" cy="5.8" r="2.4"/><circle cx="14.5" cy="5.8" r="2.4"/><circle cx="18.6" cy="10" r="2.4"/></g><g transform="translate(56 54) rotate(20 12 12)"><ellipse cx="12" cy="16" rx="5.6" ry="4.6"/><circle cx="5.4" cy="10" r="2.4"/><circle cx="9.5" cy="5.8" r="2.4"/><circle cx="14.5" cy="5.8" r="2.4"/><circle cx="18.6" cy="10" r="2.4"/></g></g></svg>')}") 0 0 / 90px 90px, radial-gradient(circle at 30% 20%, #2a1748, #120a1f 70%)`,
  glow: 'radial-gradient(ellipse at 20% 0%, rgba(181,140,255,.55), transparent 55%), radial-gradient(ellipse at 90% 100%, rgba(255,143,214,.45), transparent 55%), radial-gradient(ellipse at 70% 30%, rgba(143,240,192,.18), transparent 50%), #120a1f',
  velvet: 'repeating-linear-gradient(90deg, rgba(0,0,0,.35) 0 18px, rgba(255,255,255,.06) 30px, rgba(0,0,0,.3) 46px), linear-gradient(#5a0716, #2a030b)',
};
const wallCache = {};
function wallUrl(id) {
  if (id === 'mine') return lsGet('wallPic', '');
  if (id.startsWith('s:') && window.OnionArt) {
    if (wallCache[id]) return wallCache[id];
    const c = mk(1920, 1080); window.OnionArt.drawScene(id.slice(2), c.getContext('2d'), 1920, 1080);
    return (wallCache[id] = c.toDataURL('image/jpeg', 0.86));
  }
  return '';
}
function applyWall() {
  const id = lsGet('wall', 'dots'), wall = $('#wall'), g = $('#gallery');
  const dim = lsGet('wallDim', 0.3);
  wall.style.setProperty('--wall-dim', id === 'dots' ? 0 : dim);
  if (id === 'dots' || (id === 'mine' && !lsGet('wallPic', ''))) { wall.style.background = ''; g.classList.remove('has-wall'); return; }
  g.classList.add('has-wall');
  if (WALL_CSS[id]) { wall.style.background = WALL_CSS[id]; return; }
  const u = wallUrl(id); wall.style.background = u ? `url("${u}") center / cover no-repeat` : '';
}
function customizeSheet() {
  const sh = openSheet(`<h2>Customize home</h2>
    <div class="field"><span>Wallpaper</span><div class="walls" id="cuWalls">${WALLS.map(([id, n]) => `<button data-w="${id}" class="${lsGet('wall', 'dots') === id ? 'on' : ''}"><span>${n}</span></button>`).join('')}</div>
      <div class="row"><button class="btn" id="cuPic"><svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-8 8"/></svg>Use my own picture</button></div>
      <div class="row"><label for="cuDim">Darker</label><input type="range" id="cuDim" min="0" max="80" value="${Math.round(lsGet('wallDim', 0.3) * 100)}"><output class="mono" id="cuDimO">${Math.round(lsGet('wallDim', 0.3) * 100)}%</output></div></div>
    <div class="field"><span>Widgets</span><div class="wlist" id="cuWl"></div></div>
    <div class="field"><span>Theatre curtains</span>
      <label class="check"><input type="checkbox" id="cuIntro" ${lsGet('curtainIntro', true) ? 'checked' : ''}> Curtains open when ONION starts</label>
      <div class="seg" id="cuCol">${Object.entries(CURTAIN_NAMES).map(([k, n]) => `<button data-c="${k}" class="${TH.color === k ? 'on' : ''}">${n}</button>`).join('')}</div>
      <p class="hint">The curtain button on the home screen closes them to hide the screen. Tap the curtains to open them again.</p></div>
    <input type="file" id="cuFile" accept="image/*" hidden>
    <div class="actions"><button class="btn primary" data-close>Done</button></div>`);
  sh.querySelectorAll('#cuWalls button').forEach(b => {
    const id = b.dataset.w;
    b.style.background = WALL_CSS[id] || (id === 'dots' ? 'radial-gradient(rgba(201,173,255,.3) 1.2px, transparent 1.3px) 0 0 / 10px 10px, #120a1f' : wallUrl(id) ? `url("${wallUrl(id)}") center / cover` : '');
    if (id === 'paws') b.style.backgroundSize = '45px 45px, auto';
    b.onclick = () => { if (id === 'mine' && !lsGet('wallPic', '')) { sh.querySelector('#cuFile').click(); return; } lsSet('wall', id); applyWall(); sh.querySelectorAll('#cuWalls button').forEach(x => x.classList.toggle('on', x === b)); };
  });
  sh.querySelector('#cuPic').onclick = () => sh.querySelector('#cuFile').click();
  sh.querySelector('#cuFile').onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    try {
      const img = await loadImg(URL.createObjectURL(f)), k = Math.min(1, 1920 / Math.max(img.width, img.height)), c = mk(Math.round(img.width * k), Math.round(img.height * k));
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      const url = c.toDataURL('image/jpeg', 0.84); lsSet('wallPic', url);
      if (lsGet('wallPic', '') !== url) { toast('That picture is too big to keep. Try a smaller one.'); return; }
      lsSet('wall', 'mine'); applyWall(); customizeSheet(); toast('Wallpaper set');
    } catch (err) { toast('That picture could not be used.'); }
  };
  sh.querySelector('#cuDim').oninput = e => { lsSet('wallDim', e.target.value / 100); sh.querySelector('#cuDimO').textContent = e.target.value + '%'; applyWall(); };
  sh.querySelector('#cuIntro').onchange = e => lsSet('curtainIntro', e.target.checked);
  sh.querySelectorAll('#cuCol button').forEach(b => b.onclick = () => { TH.color = b.dataset.c; lsSet('curtainColor', TH.color); sh.querySelectorAll('#cuCol button').forEach(x => x.classList.toggle('on', x === b)); });
  const paintWl = () => {
    const L = widgetList(), box = sh.querySelector('#cuWl');
    box.innerHTML = L.map((w, i) => { const d = WIDGETS.find(x => x[0] === w.id); return `<div class="wrow"><label class="check" style="flex:1"><input type="checkbox" data-i="${i}" ${w.on ? 'checked' : ''}><span><b>${d[1]}</b><br><small class="hint">${d[2]}</small></span></label>
      <button class="ico" data-up="${i}" ${i ? '' : 'disabled'} aria-label="Move up"><svg viewBox="0 0 24 24"><path d="M12 19V5M6 11l6-6 6 6"/></svg></button><button class="ico" data-dn="${i}" ${i < L.length - 1 ? '' : 'disabled'} aria-label="Move down"><svg viewBox="0 0 24 24"><path d="M12 5v14M6 13l6 6 6-6"/></svg></button></div>`; }).join('');
    box.querySelectorAll('input[data-i]').forEach(c => c.onchange = () => { const L2 = widgetList(); L2[+c.dataset.i].on = c.checked; lsSet('widgets', L2); renderWidgets(); });
    box.querySelectorAll('[data-up],[data-dn]').forEach(b => b.onclick = () => { const L2 = widgetList(), i = +(b.dataset.up ?? b.dataset.dn), j = b.dataset.up != null ? i - 1 : i + 1; [L2[i], L2[j]] = [L2[j], L2[i]]; lsSet('widgets', L2); renderWidgets(); paintWl(); });
  };
  paintWl();
}
$('#customBtn').onclick = customizeSheet;
window.addEventListener('resize', () => { if (lsGet('wall', 'dots').startsWith('s:')) applyWall(); });

function newProjectSheet(name0) {
  let size = SIZES[0], fps = 12;
  const sh = openSheet(`<h2>New animation</h2>
    <label class="field"><span>Name</span><input type="text" id="npName" value="${esc(typeof name0 === 'string' ? name0.slice(0, 60) : 'Untitled animation')}" maxlength="60"></label>
    <div class="field"><span>Canvas</span><div class="sizes" id="npSizes">${SIZES.map((s, i) => `<button data-i="${i}" class="${i ? '' : 'on'}"><i style="width:${s.w > s.h ? 36 : s.w === s.h ? 26 : 18}px;height:${s.w > s.h ? 20 : s.w === s.h ? 26 : 32}px"></i>${s.name}<small>${s.w}×${s.h}</small></button>`).join('')}</div></div>
    <div class="field"><span>Speed</span><div class="seg" id="npFps">${[8, 12, 15, 24, 30].map(f => `<button data-f="${f}" class="${f === 12 ? 'on' : ''}">${f} fps</button>`).join('')}</div></div>
    <p class="hint">12 fps is the classic cartoon speed (each drawing on twos at 24). You can change speed later.</p>
    <div class="actions"><button class="btn" data-close>Cancel</button><button class="btn primary" id="npGo">Create</button></div>`);
  sh.querySelectorAll('#npSizes button').forEach(b => b.onclick = () => { size = SIZES[+b.dataset.i]; sh.querySelectorAll('#npSizes button').forEach(x => x.classList.toggle('on', x === b)); });
  sh.querySelectorAll('#npFps button').forEach(b => b.onclick = () => { fps = +b.dataset.f; sh.querySelectorAll('#npFps button').forEach(x => x.classList.toggle('on', x === b)); });
  sh.querySelector('#npGo').onclick = async () => {
    const name = sh.querySelector('#npName').value.trim() || 'Untitled animation';
    const lid = uid();
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'animation';
    const p = { id: slug + '-' + uid().slice(0, 4), name, w: size.w, h: size.h, fps, bg: '#ffffff', loop: true, layers: [{ id: lid, name: 'Layer 1', visible: true, opacity: 1 }],
                frames: [{ id: uid(), hold: 1 }], createdAt: Date.now() };
    closeSheet();
    try { await S.store.saveProject(p); } catch (e) { toast('Could not save the new animation.'); }
    openProject(p.id, p);
  };
  setTimeout(() => sh.querySelector('#npName').select(), 30);
}

/* ------------------------------------------------------------------ open / close */
async function openProject(id, given) {
  let p = given || S.projects.find(x => x.id === id) || await S.store.getProject(id);
  if (!p) { toast('That animation was not found.'); return; }
  p = JSON.parse(JSON.stringify(p)); p.id = id;
  p.frames = (p.frames && p.frames.length) ? p.frames : [{ id: uid(), hold: 1 }];
  p.layers = (p.layers && p.layers.length) ? p.layers : [{ id: uid(), name: 'Layer 1', visible: true, opacity: 1 }];
  Object.assign(S, { proj: p, cells: new Map(), parts: new Map(), saved: new Set(), cur: 0, undo: [], redo: [], dirty: new Set(), bgImg: null, audio: null, view: { z: 1, tx: 0, ty: 0 } });
  S.layer = p.layers[p.layers.length - 1].id;
  $('#gallery').hidden = true; $('#editor').hidden = false;
  $('#pTitle').textContent = p.name; setSave('Opening…');
  layout(); buildTools(); renderSide(); renderStrip(); updateBar(); rebuild();
  try {
    const { data, parts } = await S.store.loadCells(p.id);
    S.parts = parts;
    const jobs = [];
    for (const [k, url] of data) {
      S.saved.add(k);
      const [fid, lid] = k.split('~');
      if (fid === 'audio') { jobs.push(loadAudioFromData(url, false)); continue; }
      jobs.push(loadImg(url).then(img => {
        if (fid === 'bg') { const c = mk(W(), H()); fitDraw(c.getContext('2d'), img, W(), H(), true); S.bgImg = c; }
        else getCell(fid, lid, true).getContext('2d').drawImage(img, 0, 0, W(), H());
      }).catch(() => {}));
    }
    await Promise.all(jobs);
    setSave('Saved');
  } catch (e) { console.warn(e); setSave('Could not load every drawing', true); }
  rebuild(); renderStrip(true); renderLayers();
}
async function closeProject() {
  stop(); await flushSaves(true);
  $('#editor').hidden = true; $('#gallery').hidden = false; S.proj = null; renderGallery(); S.store.refresh(); loadFilms();
}

/* ------------------------------------------------------------------ persistence */
let saveTimer = null, metaTimer = null, thumbTimer = null;
function markDirty(fid, lid) { S.dirty.add(keyOf(fid, lid)); setSave('Saving…'); clearTimeout(saveTimer); saveTimer = setTimeout(flushSaves, 900); scheduleThumb(fid); }
function markMeta() { S.metaDirty = true; setSave('Saving…'); clearTimeout(metaTimer); metaTimer = setTimeout(flushSaves, 700); }
function isEmpty(c) {
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  for (let i = 3; i < d.length; i += 16) if (d[i]) return false;
  for (let i = 7; i < d.length; i += 16) if (d[i]) return false;
  for (let i = 11; i < d.length; i += 16) if (d[i]) return false;
  for (let i = 15; i < d.length; i += 16) if (d[i]) return false;
  return true;
}
let flushing = null;
async function flushSaves(final) {
  if (!S.proj || S.store.readOnly) return;
  if (flushing) { await flushing; if (!S.dirty.size && !S.metaDirty) return; }
  flushing = (async () => {
    const p = S.proj, keys = [...S.dirty]; S.dirty.clear();
    try {
      for (const k of keys) {
        const [fid, lid] = k.split('~'); const c = S.cells.get(k);
        const live = referenced(fid, lid) && c && !isEmpty(c);
        if (live) { S.parts.set(k, await S.store.saveCell(p.id, fid, lid, await cellPayload(c, 'image/png'), S.parts.get(k) || 0)); S.saved.add(k); }
        else if (S.saved.has(k)) { await S.store.saveCell(p.id, fid, lid, null, S.parts.get(k) || 1); S.saved.delete(k); S.parts.delete(k); }
      }
      if (S.metaDirty || keys.length) { S.metaDirty = false; await S.store.saveProject(p); }
      if (!S.store.readOnly) setSave('Saved');
    } catch (e) {
      console.warn(e); keys.forEach(k => S.dirty.add(k)); S.metaDirty = true;
      if (!S.store.readOnly) { setSave('Not saved yet: retrying', true); clearTimeout(saveTimer); saveTimer = setTimeout(flushSaves, 4000); }
    }
  })();
  await flushing; flushing = null;
}
async function cellPayload(c, type, q) {
  if (S.store.wantsBlob) return { blob: await new Promise(r => c.toBlob(r, type, q)), type };
  return { url: c.toDataURL(type, q) };
}
function referenced(fid, lid) {
  if (fid === 'bg' || fid === 'audio') return true;
  return S.proj.frames.some(f => f.id === fid) && S.proj.layers.some(l => l.id === lid);
}
function syncCells() {    // after any structure change: drop stored cells nobody uses, restore ones that came back (undo)
  for (const k of new Set([...S.cells.keys(), ...S.saved])) {
    const [fid, lid] = k.split('~'); if (fid === 'bg' || fid === 'audio') continue;
    const ref = referenced(fid, lid);
    if (!ref && S.saved.has(k)) S.dirty.add(k);
    if (ref && !S.saved.has(k) && S.cells.has(k)) S.dirty.add(k);
  }
  markMeta(); clearTimeout(saveTimer); saveTimer = setTimeout(flushSaves, 700);
}
function scheduleThumb(fid) {
  clearTimeout(thumbTimer);
  thumbTimer = setTimeout(() => {
    if (!S.proj) return;
    if (fid) drawThumb(S.proj.frames.findIndex(f => f.id === fid));
    if (!S.playing) renderLayers();
    if (!fid || S.proj.frames[0].id === fid) {
      const tw = 320, th = Math.round(320 * H() / W()); const c = mk(tw, th); composite(c.getContext('2d'), 0, tw / W());
      S.proj.thumb = c.toDataURL('image/jpeg', 0.72); S.metaDirty = true;
    }
  }, 500);
}

/* ------------------------------------------------------------------ compositing */
function composite(ctx, fi, scale = 1, opts = {}) {
  const p = S.proj, f = p.frames[fi]; if (!f) return;
  ctx.save(); if (scale !== 1) ctx.scale(scale, scale);
  if (!opts.noBg) { ctx.fillStyle = p.bg || '#ffffff'; ctx.fillRect(0, 0, p.w, p.h); if (S.bgImg) ctx.drawImage(S.bgImg, 0, 0); }
  for (const l of p.layers) {
    if (!l.visible) continue; const c = S.cells.get(keyOf(f.id, l.id)); if (!c) continue;
    ctx.globalAlpha = l.opacity; ctx.drawImage(c, 0, 0);
  }
  ctx.restore();
}
let below = null, above = null, stroke = null, stroke2 = null, look = null, tint = null;
function rebuild() {      // caches under and over the active layer
  if (!S.proj) return;
  if (!below || below.width !== W() || below.height !== H()) { below = mk(W(), H()); above = mk(W(), H()); stroke = mk(W(), H()); stroke2 = mk(W(), H()); look = mk(W(), H()); tint = mk(W(), H()); }
  const b = below.getContext('2d'), a = above.getContext('2d'), p = S.proj, f = curFrame();
  b.clearRect(0, 0, W(), H()); a.clearRect(0, 0, W(), H());
  b.fillStyle = p.bg || '#ffffff'; b.fillRect(0, 0, W(), H()); if (S.bgImg) b.drawImage(S.bgImg, 0, 0);
  if (S.onion && !S.playing) {
    const tc = tint.getContext('2d');
    for (let d = S.onion; d >= 1; d--) for (const [dir, col] of [[-1, cssVar('--onion-prev') || '#d23c4b'], [1, cssVar('--onion-next') || '#1f9a86']]) {
      const g = S.cur + dir * d; if (g < 0 || g >= p.frames.length) continue;
      tc.globalCompositeOperation = 'source-over'; tc.globalAlpha = 1; tc.clearRect(0, 0, W(), H());
      composite(tc, g, 1, { noBg: true });
      tc.globalCompositeOperation = 'source-in'; tc.fillStyle = col; tc.fillRect(0, 0, W(), H()); tc.globalCompositeOperation = 'source-over';
      b.globalAlpha = S.onionOp / d; b.drawImage(tint, 0, 0); b.globalAlpha = 1;
    }
  }
  let seen = false;
  for (const l of p.layers) {
    if (l.id === S.layer) { seen = true; continue; }
    if (!l.visible) continue; const c = S.cells.get(keyOf(f.id, l.id)); if (!c) continue;
    const t = seen ? a : b; t.globalAlpha = l.opacity; t.drawImage(c, 0, 0); t.globalAlpha = 1;
  }
  draw();
}
const stage = $('#stage'); let sctx = stage.getContext('2d'); let dpr = 1, cw = 0, ch = 0;
function layout() {
  const r = $('#stageWrap').getBoundingClientRect(); dpr = Math.min(2, window.devicePixelRatio || 1);
  cw = r.width; ch = r.height; stage.width = Math.max(1, Math.round(cw * dpr)); stage.height = Math.max(1, Math.round(ch * dpr)); draw();
}
function railW() { return window.innerWidth > 860 ? 84 : 66; }   // room for the floating tool bar
function fitScale() { return Math.min((cw - 36 - railW()) / W(), (ch - 36) / H()); }
function viewT() {
  const s = Math.max(0.02, fitScale() * S.view.z), L = railW();
  return { s, ox: L + (cw - L - W() * s) / 2 + S.view.tx, oy: (ch - H() * s) / 2 + S.view.ty };
}
let raf = 0, playFrame = -1;
function draw() { if (!raf) raf = requestAnimationFrame(drawNow); }
function drawNow() {
  raf = 0; if (!S.proj || !cw) return;
  const { s, ox, oy } = viewT();
  sctx.setTransform(dpr, 0, 0, dpr, 0, 0); sctx.clearRect(0, 0, cw, ch);
  sctx.save(); sctx.shadowColor = 'rgba(0,0,0,.35)'; sctx.shadowBlur = 18; sctx.fillStyle = S.proj.bg || '#fff'; sctx.fillRect(ox, oy, W() * s, H() * s); sctx.restore();
  sctx.save(); sctx.translate(ox, oy); sctx.scale(s, s); sctx.beginPath(); sctx.rect(0, 0, W(), H()); sctx.clip();
  sctx.imageSmoothingEnabled = s < 2;
  if (S.playing && playFrame >= 0) composite(sctx, playFrame, 1);
  else {
    sctx.drawImage(below, 0, 0);
    const l = activeLayer(), c = getCell(curFrame().id, l.id, false);
    if (l.visible) {
      sctx.globalAlpha = l.opacity;
      if (c) sctx.drawImage(c, 0, 0);
      if (live && live.preview) {
        sctx.globalAlpha = l.opacity * (live.alpha ?? 1); if (live.st && live.st.b.blend) sctx.globalCompositeOperation = live.st.b.blend;
        sctx.drawImage(liveLook(), 0, 0); sctx.globalCompositeOperation = 'source-over';
      }
      sctx.globalAlpha = 1;
    }
    sctx.drawImage(above, 0, 0);
  }
  sctx.restore();
  $('#zoomHud').textContent = Math.round(s / fitScale() * 100) + '%';
}

/* ------------------------------------------------------------------ tools */
const ICONS = {
  pen: '<path d="M4 20l4-1 11-11-3-3L5 16l-1 4z"/><path d="M14 6l3 3"/>',
  pencil: '<path d="M5 19l1-4L16 5l3 3L9 18l-4 1z"/><path d="M14 7l3 3"/><path d="M6 15l3 3"/>',
  brush: '<path d="M14 4l6 6-6.5 6.5-6-6z"/><path d="M7.5 10.5c-2.5.5-4 2.5-4 5.5 0 1.5-.5 2.5-1.5 3.5 3.5.5 7-.5 8-3.5"/>',
  star: '<path d="M12 3c.8 5.6 3.4 8.2 9 9-5.6.8-8.2 3.4-9 9-.8-5.6-3.4-8.2-9-9 5.6-.8 8.2-3.4 9-9z"/>',
  drop: '<path d="M12 3.5c3.6 4.4 5.6 7.6 5.6 10.4a5.6 5.6 0 0 1-11.2 0c0-2.8 2-6 5.6-10.4z"/><path d="M9.6 14.5a2.6 2.6 0 0 0 2.4 2.4"/>',
  marker: '<path d="M6 18l-2 2h5l9-9-4-4-9 9 1 2z"/><path d="M13 6l4 4"/>',
  eraser: '<path d="M7 20h12M5 15l8-8 6 6-5 5H9l-4-3z"/><path d="M10 10l6 6"/>',
  fill: '<path d="M4 12l7-7 7 7-7 7-7-7z"/><path d="M19 15c1 1.5 1.5 2.5 1.5 3.2a1.5 1.5 0 0 1-3 0c0-.7.5-1.7 1.5-3.2z"/>',
  line: '<path d="M5 19L19 5"/><circle cx="5" cy="19" r="1.5"/><circle cx="19" cy="5" r="1.5"/>',
  rect: '<rect x="4" y="6" width="16" height="12" rx="1"/>',
  ellipse: '<ellipse cx="12" cy="12" rx="8" ry="6"/>',
  pick: '<path d="M14 4l6 6-2 2-6-6 2-2z"/><path d="M13 7l-8 8v4h4l8-8"/>',
  move: '<path d="M12 3v18M3 12h18M12 3l-3 3M12 3l3 3M12 21l-3-3M12 21l3-3M3 12l3-3M3 12l3 3M21 12l-3-3M21 12l-3 3"/>',
  hand: '<path d="M8 13V5.5a1.5 1.5 0 0 1 3 0V11M11 10V4.5a1.5 1.5 0 0 1 3 0V11M14 10.5V6a1.5 1.5 0 0 1 3 0v8a6 6 0 0 1-6 6h-1a6 6 0 0 1-5-2.7L3 14a1.5 1.5 0 0 1 2.5-1.6L8 15"/>',
};
const TOOLS = [['pen', 'Brush (P)'], ['eraser', 'Eraser (E)'], ['fill', 'Fill bucket (G)'],
  ['line', 'Line with your brush (L)'], ['rect', 'Rectangle with your brush (R)'], ['ellipse', 'Ellipse with your brush (O)'], ['pick', 'Colour picker (I)'], ['move', 'Move layer drawing (V)'], ['hand', 'Pan the canvas (H, or hold Space)']];
const TOOL_TONE = { pen: 'var(--lilac)', marker: 'var(--candle)', eraser: 'var(--pink)', fill: 'var(--sky)', line: 'var(--slime)', rect: 'var(--slime)',
  ellipse: 'var(--slime)', pick: 'var(--blood)', move: 'var(--bone)', hand: 'var(--bone)' };
function buildTools() {
  const t = $('#tools'); t.innerHTML = '';
  for (const [id, label] of TOOLS) {
    const b = document.createElement('button'); b.className = 'ico' + (S.tool === id ? ' on' : ''); b.title = label; b.setAttribute('aria-label', label.split(':')[0].split(' (')[0]);
    b.style.setProperty('--tool', TOOL_TONE[id]);
    b.innerHTML = `<svg viewBox="0 0 24 24">${ICONS[id]}</svg>`; b.dataset.tool = id; b.onclick = () => { if (id === 'pen' && S.tool === 'pen') showBrushes(); else setTool(id); }; t.appendChild(b);
  }
  const sw = document.createElement('button'); sw.className = 'swatch-now'; sw.id = 'swNow'; sw.title = 'Colour and brush'; sw.setAttribute('aria-label', 'Colour and brush');
  sw.onclick = () => togglePanel(); t.appendChild(sw); updateSwatchNow(); buildToolIcon();
}
function buildToolIcon() {
  const b = document.querySelector('#tools .ico[data-tool="pen"]'); if (!b) return; const br = BRUSH[S.brush], cat = BRUSH_CATS.find(c => c[0] === br.cat);
  b.innerHTML = `<svg viewBox="0 0 24 24">${ICONS[cat[2]]}</svg>`; b.title = `${br.name} (P) · click again for all brushes`; b.setAttribute('aria-label', 'Brush: ' + br.name);
}
function showBrushes() {
  if (window.innerWidth <= 860) togglePanel(true);
  const s = $('#brushSec'); s.scrollIntoView({ block: 'start', behavior: 'smooth' }); s.classList.remove('flash'); void s.offsetWidth; s.classList.add('flash');
}
const PAW_CURSOR = `url("data:image/svg+xml,${encodeURIComponent('<svg xmlns=\'http://www.w3.org/2000/svg\' width=\'28\' height=\'28\' viewBox=\'0 0 24 24\'><g fill=\'#b58cff\' stroke=\'#06030c\' stroke-width=\'1.3\'><ellipse cx=\'12\' cy=\'16.2\' rx=\'5.6\' ry=\'4.6\'/><circle cx=\'5.4\' cy=\'10.2\' r=\'2.4\'/><circle cx=\'9.5\' cy=\'5.8\' r=\'2.4\'/><circle cx=\'14.5\' cy=\'5.8\' r=\'2.4\'/><circle cx=\'18.6\' cy=\'10.2\' r=\'2.4\'/></g></svg>')}") 14 14, grab`;
function setTool(id) {
  S.tool = id; document.querySelectorAll('#tools .ico').forEach(b => b.classList.toggle('on', b.dataset.tool === id));
  if (settingsKey() !== S.setKey) { loadSettings(); syncSliders(); if ($('#bGrid')) renderBrushes(); }
  $('#fillRow').hidden = id !== 'fill';
  stage.style.cursor = id === 'hand' ? PAW_CURSOR : id === 'move' ? 'move' : 'crosshair';
}
function updateSwatchNow() { const s = $('#swNow'); if (s) { s.style.backgroundColor = S.color; s.style.setProperty('--c', S.color); s.innerHTML = `<i>${S.size}</i>`; } }

/* ------------------------------------------------------------------ brushes
   One drawing tool (P) with a library of 30 brushes in five sets. Every brush is stamped along the smoothed stroke:
   a dab shape (round, soft, nib, chisel, bristles, spray, fur, stamps...), pressure or mouse speed for size, start and end
   tapers, jitter and scatter, then a finish (paper grain, neon glow, wet edges) and a blend (multiply for markers).
   Randomness is hashed from the stroke seed and dab number, so the stroke can be redrawn exactly (the end taper does that). */
const TAU = Math.PI * 2;
const BRUSH_CATS = [['pens', 'Pens', 'pen'], ['pencils', 'Pencils', 'pencil'], ['markers', 'Markers', 'marker'], ['paint', 'Paint', 'brush'], ['elements', 'Elements', 'drop'], ['fun', 'Fun', 'star']];
const BRUSHES = [
  // pens
  { id: 'ink', name: 'Ink pen', cat: 'pens', size: 8, op: 1, spacing: 0.07, shape: 'round', psize: 0.85, taper: [1.4, 2.4] },
  { id: 'liner', name: 'Fine liner', cat: 'pens', size: 3, op: 1, spacing: 0.12, shape: 'round', psize: 0.08 },
  { id: 'ballpoint', name: 'Ballpoint', cat: 'pens', size: 2.5, op: 0.9, spacing: 0.15, shape: 'round', psize: 0.3, grain: 'fine', taper: [0.6, 0.6] },
  { id: 'brushpen', name: 'Brush pen', cat: 'pens', size: 14, op: 1, spacing: 0.05, shape: 'round', psize: 1.15, min: 0.06, taper: [2.6, 4] },
  { id: 'calli', name: 'Calligraphy', cat: 'pens', size: 16, op: 1, spacing: 0.04, shape: 'nib', angle: -0.78, aspect: 0.2, psize: 0.3 },
  { id: 'drip', name: 'Drip pen', cat: 'pens', size: 10, op: 1, spacing: 0.07, shape: 'round', psize: 0.55, taper: [1, 1.6], drips: true },
  // pencils
  { id: 'hb', name: 'HB pencil', cat: 'pencils', size: 3, op: 0.85, spacing: 0.18, shape: 'round', psize: 0.4, grain: 'pencil', taper: [0.5, 0.5] },
  { id: 'soft', name: 'Soft 6B', cat: 'pencils', size: 7, op: 0.95, spacing: 0.14, shape: 'round', psize: 0.55, grain: 'soft', taper: [0.4, 0.4] },
  { id: 'cpencil', name: 'Colour pencil', cat: 'pencils', size: 6, op: 0.92, spacing: 0.14, shape: 'round', psize: 0.4, grain: 'colour' },
  { id: 'sketch', name: 'Sketchy', cat: 'pencils', size: 3, op: 0.8, spacing: 0.22, shape: 'sketch', strands: 3, grain: 'pencil', psize: 0.3 },
  { id: 'charcoal', name: 'Charcoal', cat: 'pencils', size: 18, op: 1, spacing: 0.09, shape: 'soft', hard: 0.45, flow: 0.4, jsize: 0.22, scatter: 0.1, grain: 'coarse', psize: 0.4 },
  { id: 'crayon', name: 'Crayon', cat: 'pencils', size: 13, op: 1, spacing: 0.1, shape: 'round', psize: 0.25, scatter: 0.05, grain: 'wax' },
  { id: 'chalk', name: 'Chalk', cat: 'pencils', size: 15, op: 0.95, spacing: 0.1, shape: 'round', psize: 0.2, scatter: 0.1, grain: 'chalk' },
  // markers
  { id: 'felt', name: 'Felt marker', cat: 'markers', size: 10, op: 0.96, spacing: 0.07, shape: 'round', psize: 0 },
  { id: 'alcohol', name: 'Alcohol marker', cat: 'markers', size: 18, op: 0.5, spacing: 0.07, shape: 'round', psize: 0, blend: 'multiply' },
  { id: 'hilite', name: 'Highlighter', cat: 'markers', size: 24, op: 0.45, spacing: 0.05, shape: 'chisel', angle: 0, aspect: 0.32, psize: 0, blend: 'multiply' },
  { id: 'neon', name: 'Neon', cat: 'markers', size: 7, op: 1, spacing: 0.07, shape: 'round', psize: 0.2, glow: true, taper: [0.6, 0.8] },
  // paint
  { id: 'paint', name: 'Paint brush', cat: 'paint', size: 20, op: 1, spacing: 0.05, shape: 'bristle', bristles: 13, psize: 0.5, taper: [0.8, 1.2] },
  { id: 'dry', name: 'Dry brush', cat: 'paint', size: 24, op: 0.95, spacing: 0.04, shape: 'bristle', bristles: 18, dry: true, psize: 0.35 },
  { id: 'water', name: 'Watercolour', cat: 'paint', size: 28, op: 0.9, spacing: 0.09, shape: 'soft', hard: 0.6, flow: 0.13, jsize: 0.28, scatter: 0.05, grain: 'paper', wet: true, psize: 0.4 },
  { id: 'air', name: 'Airbrush', cat: 'paint', size: 44, op: 1, spacing: 0.07, shape: 'soft', hard: 0, flow: 0.06, psize: 0.3 },
  { id: 'spray', name: 'Spray can', cat: 'paint', size: 34, op: 1, spacing: 0.25, shape: 'spray', density: 0.55, fixed: true },
  // elements (v1.6): natural materials with their own colours, drawn as cartoon shapes with a light side and a shine
  { id: 'el-water', name: 'Water', cat: 'elements', size: 22, op: 0.9, spacing: 0.06, shape: 'liquid', psize: 0.55, taper: [1.2, 1.8], over: true, splash: true,
    pal: { base: '#3aa0e8', light: '#8fd3ff', hi: '#ffffff' } },
  { id: 'el-waves', name: 'Waves', cat: 'elements', size: 30, op: 1, spacing: 0.06, shape: 'wave', psize: 0.3, over: true,
    pal: { base: '#1f6fc4', light: '#4fb0ee', foam: '#ffffff' } },
  { id: 'el-rain', name: 'Rain drops', cat: 'elements', size: 14, op: 1, spacing: 1.25, shape: 'drop', jsize: 0.45, scatter: 0.9, fixed: true, over: true,
    pal: { base: '#4aa8f0', hi: '#ffffff' } },
  { id: 'el-sand', name: 'Sand', cat: 'elements', size: 30, op: 1, spacing: 0.22, shape: 'sand', psize: 0.5, density: 1,
    pal: { tones: ['#e8c98a', '#d9b26f', '#c99a55', '#f3dfac', '#b88746'], pebble: '#8c6a40' } },
  { id: 'el-fire', name: 'Fire', cat: 'elements', size: 26, op: 1, spacing: 0.32, shape: 'flame', psize: 0.5, fixed: true, over: true, glow: true, glowCol: '#ff7a1a',
    pal: { outer: '#ff4b1f', mid: '#ff9f1c', core: '#fff3b0' } },
  { id: 'el-smoke', name: 'Smoke', cat: 'elements', size: 34, op: 1, spacing: 0.32, shape: 'cloud', jsize: 0.35, scatter: 0.3, psize: 0.4, over: true,
    pal: { base: '#8a8696', light: '#c9c5d4', hi: '#ece9f2' } },
  { id: 'el-mist', name: 'Mist', cat: 'elements', size: 46, op: 0.9, spacing: 0.16, shape: 'puff', jsize: 0.45, scatter: 0.35, psize: 0.3,
    pal: { tones: ['#7d7a85', '#9f9ca8', '#c4c1cc', '#5e5b66'] } },
  { id: 'el-bolt', name: 'Lightning', cat: 'elements', size: 12, op: 1, spacing: 0.9, shape: 'bolt', fixed: true, over: true, glow: true, glowCol: '#6ec8ff',
    pal: { outer: '#7fd3ff', core: '#ffffff' } },
  { id: 'el-snow', name: 'Snow', cat: 'elements', size: 14, op: 1, spacing: 1.2, shape: 'flake', jsize: 0.6, scatter: 0.9, fixed: true,
    pal: { white: '#ffffff', edge: '#8fc4f2' } },
  { id: 'el-lava', name: 'Lava', cat: 'elements', size: 22, op: 1, spacing: 0.06, shape: 'liquid', psize: 0.55, taper: [1.2, 1.8], over: true, glow: true, glowCol: '#ff5a00', splash: true,
    pal: { base: '#d8320f', light: '#ff9a1f', hi: '#fff1a0' } },
  { id: 'el-slime', name: 'Slime', cat: 'elements', size: 22, op: 1, spacing: 0.06, shape: 'liquid', psize: 0.55, taper: [1, 1.4], over: true, drips: true,
    pal: { base: '#4fc94a', light: '#a8f27f', hi: '#ffffff' } },
  // fun
  { id: 'rainbow', name: 'Rainbow', cat: 'fun', size: 12, op: 1, spacing: 0.07, shape: 'round', psize: 0.4, rainbow: true, taper: [1, 1.6] },
  { id: 'fur', name: 'Fur', cat: 'fun', size: 16, op: 1, spacing: 0.22, shape: 'fur', fixed: true },
  { id: 'stars', name: 'Sparkles', cat: 'fun', size: 16, op: 1, spacing: 1.3, shape: 'star', jsize: 0.5, scatter: 0.45, fixed: true },
  { id: 'paws', name: 'Paw prints', cat: 'fun', size: 18, op: 1, spacing: 1.5, shape: 'paw', fixed: true },
  { id: 'hearts', name: 'Hearts', cat: 'fun', size: 16, op: 1, spacing: 1.5, shape: 'heart', jsize: 0.4, scatter: 0.35, fixed: true },
  { id: 'bubbles', name: 'Bubbles', cat: 'fun', size: 16, op: 1, spacing: 1.1, shape: 'bubble', jsize: 0.6, scatter: 0.6, fixed: true },
  { id: 'dots', name: 'Dotted', cat: 'fun', size: 6, op: 1, spacing: 2.2, shape: 'round', psize: 0, fixed: true },
  { id: 'pixel', name: 'Pixel', cat: 'fun', size: 6, op: 1, spacing: 0.5, shape: 'pixel', psize: 0, fixed: true },
];
const BRUSH = Object.fromEntries(BRUSHES.map(b => [b.id, b]));
const hash = (i, k) => { const x = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453; return x - Math.floor(x); };
const PAW_PATH = new Path2D('M12 16.2m-5.6 0a5.6 4.6 0 1 0 11.2 0a5.6 4.6 0 1 0-11.2 0M5.4 10.2m-2.4 0a2.4 2.4 0 1 0 4.8 0a2.4 2.4 0 1 0-4.8 0M9.5 5.8m-2.4 0a2.4 2.4 0 1 0 4.8 0a2.4 2.4 0 1 0-4.8 0M14.5 5.8m-2.4 0a2.4 2.4 0 1 0 4.8 0a2.4 2.4 0 1 0-4.8 0M18.6 10.2m-2.4 0a2.4 2.4 0 1 0 4.8 0a2.4 2.4 0 1 0-4.8 0');
const HEART_PATH = new Path2D('M12 21s-8.5-5.3-8.5-11.6A4.8 4.8 0 0 1 12 6.6a4.8 4.8 0 0 1 8.5 2.8C20.5 15.7 12 21 12 21z');
const STAR_PATH = new Path2D('M12 1.5C12.9 8.6 15.4 11.1 22.5 12 15.4 12.9 12.9 15.4 12 22.5 11.1 15.4 8.6 12.9 1.5 12 8.6 11.1 11.1 8.6 12 1.5z');
function shadeHex(hex, dl) { const c = hexToHsl(hex); return hslToHex({ h: c.h, s: c.s, l: clamp(c.l + dl, 0, 1) }); }
const spriteCache = new Map();
function softSprite(color, hard) {
  const key = color + '|' + hard; let c = spriteCache.get(key); if (c) return c;
  if (spriteCache.size > 48) spriteCache.clear();
  c = mk(96, 96); const x = c.getContext('2d'), [r, g, b] = hexToRgb(color), gr = x.createRadialGradient(48, 48, 0, 48, 48, 48);
  gr.addColorStop(0, `rgba(${r},${g},${b},1)`); gr.addColorStop(clamp(hard, 0, 0.95), `rgba(${r},${g},${b},${hard ? 1 : 0.85})`); gr.addColorStop(1, `rgba(${r},${g},${b},0)`);
  x.fillStyle = gr; x.fillRect(0, 0, 96, 96); spriteCache.set(key, c); return c;
}
const GRAIN_DEF = {   // cells: size of the paper tooth (fewer = coarser), fine: speckle share, cov: how much shows, sharp: edge contrast
  fine: { cells: 0, fine: 1, cov: 0.86, sharp: 2.4 }, pencil: { cells: 70, fine: 0.62, cov: 0.6, sharp: 3.6 },
  soft: { cells: 54, fine: 0.55, cov: 0.72, sharp: 3 }, colour: { cells: 44, fine: 0.5, cov: 0.64, sharp: 3.4 },
  coarse: { cells: 30, fine: 0.45, cov: 0.66, sharp: 3 }, wax: { cells: 22, fine: 0.35, cov: 0.68, sharp: 4.6 },
  chalk: { cells: 16, fine: 0.5, cov: 0.58, sharp: 5.5 }, paper: { cells: 34, fine: 0.25, cov: 0.95, sharp: 1.1 },
};
const grainTiles = {};
function grainTile(id) {
  if (grainTiles[id]) return grainTiles[id];
  const g = GRAIN_DEF[id], N = 256, cv = mk(N, N), x = cv.getContext('2d'), im = x.createImageData(N, N), d = im.data, C = g.cells, salt = id.length * 7;
  const grid = new Float32Array(Math.max(1, C * C)); for (let i = 0; i < grid.length; i++) grid[i] = hash(i, 17 + salt);
  for (let py = 0; py < N; py++) for (let px = 0; px < N; px++) {
    let low = 0.5;
    if (C) {
      const u = px / N * C, v = py / N * C, i0 = Math.floor(u), j0 = Math.floor(v), fu = u - i0, fv = v - j0, su = fu * fu * (3 - 2 * fu), sv = fv * fv * (3 - 2 * fv);
      const at = (i, j) => grid[(j % C) * C + (i % C)];
      low = (at(i0, j0) * (1 - su) + at(i0 + 1, j0) * su) * (1 - sv) + (at(i0, j0 + 1) * (1 - su) + at(i0 + 1, j0 + 1) * su) * sv;
    }
    const v = g.fine * hash(px + py * N, 5 + salt) + (1 - g.fine) * low;
    d[(py * N + px) * 4 + 3] = clamp(0.5 + (v - (1 - g.cov)) * g.sharp, 0, 1) * 255;
  }
  x.putImageData(im, 0, 0); return (grainTiles[id] = cv);
}
const patCache = new WeakMap();
function grainPattern(ctx, id) { let m = patCache.get(ctx); if (!m) patCache.set(ctx, m = {}); return m[id] || (m[id] = ctx.createPattern(grainTile(id), 'repeat')); }
const needsFinish = b => !!(b.grain || b.glow || b.wet || b.over);

function brushState(b, color, size, seed) {
  const st = { b, color, size, seed, i: 0, dist: 0, rem: 0, last: null, box: null, nextDrip: size * (2 + 5 * hash(seed, 9)), drips: 0 };
  if (b.shape === 'soft') st.sprite = softSprite(color, b.hard || 0);
  if (b.shape === 'bristle') st.bristles = Array.from({ length: b.bristles }, (_, j) => ({ o: (j + 0.5) / b.bristles * 2 - 1 + (hash(seed + j, 1) - 0.5) * 0.12,
    r: 0.1 + 0.13 * hash(seed + j, 2), c: shadeHex(color, (hash(seed + j, 3) - 0.5) * 0.34), p: hash(seed + j, 4) * 100 }));
  if (b.shape === 'fur') st.shades = [-0.12, -0.05, 0.04, 0.1].map(v => shadeHex(color, v));
  if (b.glow) st.core = mixHex(color, '#ffffff', 0.7);
  if (b.shape === 'puff') st.sprites = b.pal.tones.map(c => softSprite(c, 0.15));
  return st;
}
function mixHex(a, b, t) { const A = hexToRgb(a), B = hexToRgb(b); return rgbToHex(...A.map((v, i) => Math.round(v + (B[i] - v) * t))); }
const taperEase = x => x >= 1 ? 1 : 0.16 + 0.84 * Math.sqrt(Math.max(0, x));
function brushR(st, k, d, total) {
  const b = st.b; let f = Math.max(b.min ?? 0.15, 1 + (k - 1) * (b.psize || 0));
  if (b.taper && !st.noTaper) { if (b.taper[0]) f *= taperEase(d / (b.taper[0] * st.size)); if (b.taper[1] && isFinite(total)) f *= taperEase((total - d) / (b.taper[1] * st.size)); }
  return Math.max(0.35, st.size * 0.5 * f);
}
function growBox(st, x, y, r) { const B = st.box || (st.box = [x, y, x, y]); B[0] = Math.min(B[0], x - r); B[1] = Math.min(B[1], y - r); B[2] = Math.max(B[2], x + r); B[3] = Math.max(B[3], y + r); }
/* extend the stroke to point p ({x, y, k}); total = whole stroke length when known (for the end taper) */
function strokeTo(st, ctx, ctx2, p, total) {
  if (!st.last) { st.last = p; st.rem = 0; growBox(st, p.x, p.y, st.size); return; }
  const a = st.last, dx = p.x - a.x, dy = p.y - a.y, len = Math.hypot(dx, dy); if (len < 0.01) return;
  const ux = dx / len, uy = dy / len, b = st.b; let t = st.rem;
  while (t <= len) {
    const f = t / len, d = st.dist + t, r = brushR(st, a.k + (p.k - a.k) * f, d, total);
    stamp(st, ctx, ctx2, a.x + dx * f, a.y + dy * f, r, ux, uy, d);
    t += Math.max(b.shape === 'pixel' ? 1 : 0.4, (b.fixed ? st.size : r * 2) * b.spacing);
  }
  st.rem = t - len; st.dist += len; st.last = p;
}
function stamp(st, ctx, ctx2, x, y, r, ux, uy, d) {
  const b = st.b, i = st.i++, sd = st.seed * 7919 + i, H = k => hash(sd, k);
  if (b.jsize) r *= 1 + (H(1) - 0.5) * 2 * b.jsize;
  if (b.scatter) { const a = H(2) * TAU, m = H(3) * b.scatter * st.size; x += Math.cos(a) * m; y += Math.sin(a) * m; }
  const pal = b.pal, color = b.rainbow ? `hsl(${((d * 0.8 + st.seed * 37) % 360).toFixed(1)} 92% 62%)` : pal ? (pal.base || pal.outer || st.color) : st.color, dir = Math.atan2(uy, ux), px = -uy, py = ux;
  ctx.fillStyle = color; ctx.strokeStyle = color;
  switch (b.shape) {
    case 'round': ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill(); break;
    case 'soft': ctx.globalAlpha = b.flow ?? 1; ctx.drawImage(st.sprite, x - r, y - r, 2 * r, 2 * r); ctx.globalAlpha = 1; break;
    case 'nib': ctx.beginPath(); ctx.ellipse(x, y, r, Math.max(0.6, r * b.aspect), b.angle, 0, TAU); ctx.fill(); break;
    case 'chisel': ctx.save(); ctx.translate(x, y); ctx.rotate(b.angle || 0); ctx.fillRect(-r * b.aspect, -r, 2 * r * b.aspect, 2 * r); ctx.restore(); break;
    case 'pixel': { const s = Math.max(1, Math.round(st.size)); ctx.fillRect(Math.floor(x / s) * s, Math.floor(y / s) * s, s, s); break; }
    case 'sketch': for (let j = 0; j < b.strands; j++) {
      const o = (Math.sin(d / (st.size * 3.4) + j * 2.1 + st.seed) * 0.7 + Math.sin(d / (st.size * 11) + j * 4.7) * 0.9) * st.size * 0.9;
      ctx.beginPath(); ctx.arc(x + px * o, y + py * o, Math.max(0.5, r * 0.5), 0, TAU); ctx.fill(); } break;
    case 'bristle': for (const q of st.bristles) {
      if (b.dry && Math.sin(d * 0.05 + q.p) + Math.sin(d * 0.13 + q.p * 2) > 0.7) continue;
      ctx.fillStyle = b.rainbow ? color : q.c; ctx.beginPath(); ctx.arc(x + px * q.o * r, y + py * q.o * r, Math.max(0.5, r * q.r * (b.dry ? 0.9 : 1.25)), 0, TAU); ctx.fill(); } break;
    case 'spray': { const n = Math.max(4, Math.round(r * (b.density || 0.5))), dot = Math.max(0.7, st.size / 30);
      for (let j = 0; j < n; j++) { const a = hash(sd, 10 + j) * TAU, m = Math.sqrt(hash(sd, 60 + j)) * r; ctx.fillRect(x + Math.cos(a) * m - dot / 2, y + Math.sin(a) * m - dot / 2, dot, dot); } break; }
    case 'fur': { ctx.lineWidth = Math.max(0.7, st.size * 0.07); ctx.lineCap = 'round';
      for (let j = 0; j < 4; j++) {
        const a = dir + (hash(sd, 20 + j) - 0.5) * 1.2, L = r * (0.9 + hash(sd, 30 + j) * 1.3), o = (hash(sd, 40 + j) - 0.5) * r * 1.6;
        const sx = x + px * o, sy = y + py * o, bend = (hash(sd, 50 + j) - 0.5) * L * 0.6;
        ctx.strokeStyle = st.shades[j]; ctx.beginPath(); ctx.moveTo(sx, sy);
        ctx.quadraticCurveTo(sx + Math.cos(a) * L * 0.5 - Math.sin(a) * bend, sy + Math.sin(a) * L * 0.5 + Math.cos(a) * bend, sx + Math.cos(a) * L, sy + Math.sin(a) * L); ctx.stroke();
      } break; }
    case 'star': case 'heart': case 'paw': {
      const s = r / 12, side = b.shape === 'paw' ? (i % 2 ? 1 : -1) * r * 0.75 : 0;
      ctx.save(); ctx.translate(x + px * side, y + py * side);
      ctx.rotate(b.shape === 'paw' ? dir + Math.PI / 2 : b.shape === 'star' ? H(5) * 0.8 : (H(5) - 0.5) * 0.7);
      ctx.scale(s, s); ctx.translate(-12, -12); ctx.fill(b.shape === 'paw' ? PAW_PATH : b.shape === 'heart' ? HEART_PATH : STAR_PATH); ctx.restore();
      if (b.shape === 'star' && H(6) > 0.5) { ctx.beginPath(); ctx.arc(x + (H(7) - 0.5) * r * 3, y + (H(8) - 0.5) * r * 3, Math.max(0.8, r * 0.16), 0, TAU); ctx.fill(); }
      break; }
    case 'bubble': ctx.lineWidth = Math.max(1, r * 0.2); ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.stroke();
      ctx.beginPath(); ctx.arc(x - r * 0.38, y - r * 0.38, Math.max(0.8, r * 0.2), 0, TAU); ctx.fill(); break;
    /* ---- elements ---- */
    case 'liquid': {   // a round tube of liquid: body, a lighter band toward the light (up-left), a shine, now and then a splash drop
      ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
      if (ctx2) {
        ctx2.fillStyle = pal.light; ctx2.beginPath(); ctx2.arc(x - r * 0.22, y - r * 0.26, r * 0.56, 0, TAU); ctx2.fill();
        ctx2.fillStyle = pal.hi; ctx2.beginPath(); ctx2.arc(x - r * 0.4, y - r * 0.44, Math.max(0.6, r * 0.15), 0, TAU); ctx2.fill();
      }
      if (b.splash && H(9) > 0.93) {
        const a = H(10) * TAU, m = r * (1.5 + H(11) * 1.4), q = r * (0.16 + H(12) * 0.2), sx = x + Math.cos(a) * m, sy = y + Math.sin(a) * m;
        ctx.beginPath(); ctx.arc(sx, sy, q, 0, TAU); ctx.fill();
        if (ctx2) { ctx2.fillStyle = pal.hi; ctx2.beginPath(); ctx2.arc(sx - q * 0.35, sy - q * 0.35, Math.max(0.5, q * 0.32), 0, TAU); ctx2.fill(); }
        growBox(st, sx, sy, q + 2);
      }
      break; }
    case 'wave': {     // deep water with a lighter crest band and white foam curls riding on top
      ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
      if (ctx2) {
        ctx2.fillStyle = pal.light; ctx2.beginPath(); ctx2.arc(x, y - r * 0.38, r * 0.5, 0, TAU); ctx2.fill();
        if (st.nextFoam == null) st.nextFoam = st.size * 0.4;
        if (d >= st.nextFoam) {
          const R = r * (0.42 + 0.12 * H(13)), cx = x, cy = y - r * 0.55;
          ctx2.strokeStyle = pal.foam; ctx2.fillStyle = pal.foam; ctx2.lineCap = 'round'; ctx2.lineWidth = Math.max(1, r * 0.2);
          ctx2.beginPath(); ctx2.arc(cx, cy, R, Math.PI * 0.95, Math.PI * 2.15); ctx2.stroke();
          ctx2.beginPath(); ctx2.arc(cx + R * 1.05, cy + R * 0.35, Math.max(0.8, r * 0.13), 0, TAU); ctx2.fill();
          ctx2.beginPath(); ctx2.arc(cx - R * 1.2, cy - R * 0.4, Math.max(0.6, r * 0.08), 0, TAU); ctx2.fill();
          st.nextFoam = d + st.size * (0.9 + 0.5 * H(14));
        }
      }
      break; }
    case 'drop': {     // a falling raindrop: round bottom, pointed top, a shine
      const q = r * 0.62; ctx.beginPath(); ctx.moveTo(x, y - q * 2.1);
      ctx.bezierCurveTo(x + q * 0.35, y - q * 1.2, x + q, y - q * 0.55, x + q, y); ctx.arc(x, y, q, 0, Math.PI); ctx.bezierCurveTo(x - q, y - q * 0.55, x - q * 0.35, y - q * 1.2, x, y - q * 2.1); ctx.fill();
      if (ctx2) { ctx2.fillStyle = pal.hi; ctx2.beginPath(); ctx2.ellipse(x - q * 0.38, y - q * 0.15, Math.max(0.5, q * 0.18), Math.max(0.7, q * 0.34), -0.3, 0, TAU); ctx2.fill(); }
      break; }
    case 'sand': {     // lots of tiny grains in sandy tones, now and then a pebble
      const n = Math.min(70, Math.max(4, Math.round(r * r * 0.3 * (b.density || 1)))), g = Math.max(0.6, st.size / 24);
      for (let j = 0; j < n; j++) {
        const a = hash(sd, 100 + j) * TAU, m = Math.sqrt(hash(sd, 200 + j)) * r, s2 = g * (0.55 + hash(sd, 300 + j) * 0.9);
        ctx.fillStyle = pal.tones[Math.floor(hash(sd, 400 + j) * pal.tones.length)];
        ctx.fillRect(x + Math.cos(a) * m - s2 / 2, y + Math.sin(a) * m - s2 / 2, s2, s2);
      }
      if (H(15) > 0.9) { ctx.fillStyle = pal.pebble; ctx.beginPath(); ctx.ellipse(x + (H(16) - 0.5) * r, y + (H(17) - 0.5) * r, g * 1.6, g * 1.2, H(18) * 3, 0, TAU); ctx.fill(); }
      break; }
    case 'flame': {    // a flickering tongue of fire that always points up: red outside, orange, a yellow-white heart
      const h = r * (1.5 + H(19) * 1.7), w = r * (0.62 + H(20) * 0.35), sway = Math.sin(d * 0.06 + st.seed) * w * 0.5 + (H(21) - 0.5) * w * 0.5;
      const tongue = (c, k, dy) => { c.beginPath(); c.moveTo(x - w * k, y + dy); c.quadraticCurveTo(x - w * k * 0.9, y - h * k * 0.45 + dy, x + sway * k, y - h * k + dy);
        c.quadraticCurveTo(x + w * k * 0.9, y - h * k * 0.45 + dy, x + w * k, y + dy); c.arc(x, y + dy, w * k, 0, Math.PI); c.fill(); };
      ctx.fillStyle = pal.outer; tongue(ctx, 1, 0);
      if (ctx2) { ctx2.fillStyle = pal.mid; tongue(ctx2, 0.66, r * 0.12); ctx2.fillStyle = pal.core; tongue(ctx2, 0.34, r * 0.22); }
      growBox(st, x, y - h, w + 4);
      break; }
    case 'puff': {     // soft smoke puffs in a few greys, drifting up
      const k = Math.floor(H(22) * st.sprites.length), up = r * 0.5 * H(23);
      ctx.globalAlpha = 0.22; ctx.drawImage(st.sprites[k], x - r, y - r - up, 2 * r, 2 * r); ctx.globalAlpha = 1;
      break; }
    case 'cloud': {    // cartoon smoke: round puffs that drift up, a lighter top and a soft shine
      const R = r * (0.75 + H(29) * 0.45), cx = x + (H(30) - 0.5) * r * 0.6, cy = y - r * 0.35 * H(31);
      ctx.beginPath(); ctx.arc(cx, cy, R, 0, TAU); ctx.fill();
      if (ctx2) { ctx2.fillStyle = pal.light; ctx2.beginPath(); ctx2.arc(cx - R * 0.2, cy - R * 0.24, R * 0.62, 0, TAU); ctx2.fill();
        if (H(32) > 0.6) { ctx2.fillStyle = pal.hi; ctx2.beginPath(); ctx2.arc(cx - R * 0.36, cy - R * 0.42, R * 0.17, 0, TAU); ctx2.fill(); } }
      growBox(st, cx, cy, R + 2);
      break; }
    case 'bolt': {     // lightning: a jagged line that jumps sideways at every step, a white-hot core, now and then a fork
      const nx = x + px * (H(24) - 0.5) * st.size * 1.7, ny = y + py * (H(24) - 0.5) * st.size * 1.7, prev = st.bolt;
      st.bolt = { x: nx, y: ny };
      if (prev) {
        const seg = (c, ax, ay, bx, by, lw, col) => { c.strokeStyle = col; c.lineWidth = lw; c.lineCap = 'round'; c.lineJoin = 'round'; c.beginPath(); c.moveTo(ax, ay); c.lineTo(bx, by); c.stroke(); };
        seg(ctx, prev.x, prev.y, nx, ny, Math.max(1.2, r * 0.6), pal.outer);
        if (ctx2) seg(ctx2, prev.x, prev.y, nx, ny, Math.max(0.6, r * 0.22), pal.core);
        if (H(25) > 0.82) {
          let fx = nx, fy = ny; const side = H(26) > 0.5 ? 1 : -1;
          for (let j = 0; j < 3; j++) {
            const L = st.size * (1.2 - j * 0.25), a = dir + side * (0.6 + hash(sd, 500 + j) * 0.7), tx = fx + Math.cos(a) * L, ty = fy + Math.sin(a) * L;
            seg(ctx, fx, fy, tx, ty, Math.max(0.8, r * 0.35 * (1 - j * 0.25)), pal.outer); if (ctx2) seg(ctx2, fx, fy, tx, ty, Math.max(0.4, r * 0.12), pal.core);
            growBox(st, tx, ty, r + 4); fx = tx; fy = ty;
          }
        }
      }
      growBox(st, nx, ny, r + 4);
      break; }
    case 'flake': {    // snow: soft dots and little six-armed flakes, white with an icy edge so they show on white paper
      if (H(27) > 0.45) {
        ctx.fillStyle = pal.edge; ctx.beginPath(); ctx.arc(x, y, r * 0.42 + 1, 0, TAU); ctx.fill();
        ctx.fillStyle = pal.white; ctx.beginPath(); ctx.arc(x, y, r * 0.42, 0, TAU); ctx.fill();
      } else {
        ctx.lineCap = 'round'; const rot = H(28) * 1.05;
        for (const [col, lw] of [[pal.edge, Math.max(1.6, r * 0.24)], [pal.white, Math.max(0.8, r * 0.12)]]) {
          ctx.strokeStyle = col; ctx.lineWidth = lw; ctx.beginPath();
          for (let j = 0; j < 6; j++) {
            const a = rot + j * Math.PI / 3, ex = x + Math.cos(a) * r, ey = y + Math.sin(a) * r;
            ctx.moveTo(x, y); ctx.lineTo(ex, ey);
            const bx = x + Math.cos(a) * r * 0.6, by = y + Math.sin(a) * r * 0.6;
            ctx.moveTo(bx, by); ctx.lineTo(bx + Math.cos(a + 0.7) * r * 0.3, by + Math.sin(a + 0.7) * r * 0.3);
            ctx.moveTo(bx, by); ctx.lineTo(bx + Math.cos(a - 0.7) * r * 0.3, by + Math.sin(a - 0.7) * r * 0.3);
          }
          ctx.stroke();
        }
      }
      break; }
  }
  if (b.drips) ctx.fillStyle = color;
  if (b.glow && ctx2 && !pal) { ctx2.fillStyle = st.core; ctx2.beginPath(); ctx2.arc(x, y, r * 0.42, 0, TAU); ctx2.fill(); }
  let reach = r * (b.fixed || b.scatter ? 2.6 : 1.2) + (b.glow ? st.size * 2.6 : 0) + 2;
  if (b.drips && d >= st.nextDrip) {
    const n = st.drips++, len = st.size * (1.2 + 6 * hash(st.seed + n, 11) ** 2), w = r * (0.42 + 0.3 * hash(st.seed + n, 12));
    ctx.beginPath(); ctx.moveTo(x - w, y); ctx.lineTo(x - w * 0.62, y + len); ctx.lineTo(x + w * 0.62, y + len); ctx.lineTo(x + w, y); ctx.fill();
    ctx.beginPath(); ctx.arc(x, y + len, w * 0.95, 0, TAU); ctx.fill();
    st.nextDrip = d + st.size * (2.5 + 7 * hash(st.seed + n, 13)); growBox(st, x, y + len, w + 2);
  }
  growBox(st, x, y, reach);
}
/* the finished look of a stroke mask: grain, glow, wet edges (clipped to a box) */
function finishInto(dctx, st, src, src2, x0, y0, w, h) {
  const b = st.b; if (w <= 0 || h <= 0) return;
  dctx.save(); dctx.beginPath(); dctx.rect(x0, y0, w, h); dctx.clip(); dctx.clearRect(x0, y0, w, h);
  if (b.wet) dctx.filter = 'blur(0.8px)';
  if (b.glow) { dctx.shadowColor = b.glowCol || st.color; dctx.shadowBlur = Math.max(8, st.size * (b.pal ? 1.1 : 1.8)); }
  dctx.drawImage(src, x0, y0, w, h, x0, y0, w, h);
  if (b.glow) { dctx.shadowBlur = Math.max(4, st.size * 0.7); dctx.drawImage(src, x0, y0, w, h, x0, y0, w, h); dctx.shadowBlur = 0; dctx.shadowColor = 'transparent'; }
  dctx.filter = 'none';
  if (b.grain) { dctx.globalCompositeOperation = 'destination-in'; dctx.fillStyle = grainPattern(dctx, b.grain); dctx.fillRect(x0, y0, w, h); dctx.globalCompositeOperation = 'source-over'; }
  if ((b.glow || b.over) && src2) dctx.drawImage(src2, x0, y0, w, h, x0, y0, w, h);
  dctx.restore();
}
function boxOf(st, pad = 2) {
  const B = st.box || [0, 0, 0, 0];
  const x0 = clamp(Math.floor(B[0]) - pad, 0, W()), y0 = clamp(Math.floor(B[1]) - pad, 0, H());
  return [x0, y0, clamp(Math.ceil(B[2]) + pad, 0, W()) - x0, clamp(Math.ceil(B[3]) + pad, 0, H()) - y0];
}
/* what the live stroke looks like right now (used while drawing) */
function liveLook() {
  if (!live || !live.st || !needsFinish(live.st.b)) return stroke;
  const [x0, y0, w, h] = boxOf(live.st); finishInto(look.getContext('2d'), live.st, stroke, stroke2, x0, y0, w, h); return look;
}
function clearStrokeCanvases() { for (const c of [stroke, stroke2, look]) if (c) c.getContext('2d').clearRect(0, 0, W(), H()); }

/* brush settings: each brush (and the eraser) remembers its own size and opacity */
S.brush = BRUSH[lsGet('brush', 'ink')] ? lsGet('brush', 'ink') : 'ink';
S.bset = lsGet('bset', {}); S.setKey = null;
S.bcat = BRUSH[S.brush].cat;
function settingsKey() { return S.tool === 'eraser' ? 'eraser' : S.brush; }
function loadSettings() {
  const key = settingsKey(), d = S.bset[key] || {}, def = BRUSH[key] || { size: 24, op: 1 };
  S.setKey = key; S.size = d.size ?? def.size; S.opacity = d.op ?? def.op;
}
function saveSettings() { S.bset[settingsKey()] = { size: S.size, op: S.opacity }; lsSet('bset', S.bset); }
function syncSliders() {
  $('#sizeR').value = Math.round(S.size); $('#sizeO').textContent = Math.round(S.size);
  $('#opR').value = Math.round(S.opacity * 100); $('#opO').textContent = Math.round(S.opacity * 100) + '%';
  updateSwatchNow();
}
function setBrush(id, quietToast) {
  if (!BRUSH[id]) return; S.brush = id; lsSet('brush', id); S.bcat = BRUSH[id].cat;
  if (!['pen', 'line', 'rect', 'ellipse'].includes(S.tool)) setTool('pen'); else { loadSettings(); syncSliders(); }
  buildToolIcon(); renderBrushes();
  if (!quietToast) toast(BRUSH[id].name, 1000);
}
function brushPreview(cv, b, color) {
  const w = cv.width, h = cv.height, c = cv.getContext('2d'); c.clearRect(0, 0, w, h);
  const m = mk(w, h), m2 = b.glow || b.over ? mk(w, h) : null, mc = m.getContext('2d'), m2c = m2 && m2.getContext('2d');
  const size = clamp(b.fixed ? b.size * 1.25 : b.size * 1.5, 3.5, h * 0.42);
  const st = brushState(b, color, size, 11), pts = [], N = 80;
  for (let j = 0; j <= N; j++) { const t = j / N; pts.push({ x: w * 0.1 + t * w * 0.8, y: h * 0.52 + Math.sin(t * TAU) * h * 0.2, k: 0.3 + 0.8 * Math.sin(t * Math.PI) }); }
  let total = 0; for (let j = 1; j < pts.length; j++) total += Math.hypot(pts[j].x - pts[j - 1].x, pts[j].y - pts[j - 1].y);
  for (const p of pts) strokeTo(st, mc, m2c, p, total);
  if (needsFinish(b)) finishInto(c, st, m, m2, 0, 0, w, h); else c.drawImage(m, 0, 0);
}
let brushRaf = 0;
function renderBrushes() {
  const tabs = $('#bTabs'); tabs.innerHTML = '';
  for (const [id, name] of BRUSH_CATS) {
    const t = document.createElement('button'); t.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[BRUSH_CATS.find(c => c[0] === id)[2]]}</svg>${name}`; t.setAttribute('role', 'tab'); t.classList.toggle('on', id === S.bcat); t.setAttribute('aria-selected', String(id === S.bcat));
    t.onclick = () => { S.bcat = id; renderBrushes(); }; tabs.appendChild(t);
  }
  const grid = $('#bGrid'); grid.innerHTML = '';
  for (const b of BRUSHES.filter(b => b.cat === S.bcat)) {
    const card = document.createElement('button'); card.className = 'b-card' + (b.id === S.brush && S.tool !== 'eraser' ? ' on' : ''); card.dataset.id = b.id;
    card.title = b.name + (b.blend ? ' (layers like a real marker)' : b.rainbow || b.pal ? ' (makes its own colours)' : ''); card.setAttribute('aria-label', b.name);
    card.innerHTML = `<canvas width="232" height="80"></canvas><span>${esc(b.name)}</span>`;
    card.onclick = () => setBrush(b.id); grid.appendChild(card);
  }
  $('#bName').textContent = S.tool === 'eraser' ? 'Eraser' : BRUSH[S.brush].name;
  paintBrushPreviews();
}
function paintBrushPreviews() {
  if (brushRaf) return;
  brushRaf = requestAnimationFrame(() => {
    brushRaf = 0; const col = lum(S.color) > 0.82 ? '#1b1420' : S.color;
    for (const card of $('#bGrid').children) brushPreview(card.querySelector('canvas'), BRUSH[card.dataset.id], col);
  });
}

/* pointer input */
const pointers = new Map(); let live = null, pan = null, pinch = null, spaceDown = false;
function toProj(e) { const r = stage.getBoundingClientRect(); const { s, ox, oy } = viewT(); return { x: (e.clientX - r.left - ox) / s, y: (e.clientY - r.top - oy) / s }; }
stage.addEventListener('pointerdown', e => {
  if (!S.proj || S.playing) return;
  if ($('#side').classList.contains('open')) togglePanel(false);
  stage.setPointerCapture(e.pointerId); pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, type: e.pointerType });
  if (e.pointerType === 'pen') S.penSeen = true;
  if (pointers.size === 2) { cancelLive(); const [a, b] = [...pointers.values()]; pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, z: S.view.z, tx: S.view.tx, ty: S.view.ty }; return; }
  if (pointers.size > 2) return;
  if (S.tool === 'hand' || spaceDown || e.button === 1 || (e.pointerType === 'touch' && S.penSeen)) { pan = { x: e.clientX, y: e.clientY, tx: S.view.tx, ty: S.view.ty }; stage.style.cursor = 'grabbing'; return; }
  if (e.button && e.button !== 0) return;
  toolDown(e);
});
stage.addEventListener('pointermove', e => {
  if (!pointers.has(e.pointerId)) return;
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, type: e.pointerType });
  if (pinch && pointers.size >= 2) {
    const [a, b] = [...pointers.values()]; const d = Math.hypot(a.x - b.x, a.y - b.y); const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
    const r = stage.getBoundingClientRect(); const z = clamp(pinch.z * d / Math.max(10, pinch.d), 0.25, 12);
    const k = z / pinch.z; const px = pinch.cx - r.left - cw / 2, py = pinch.cy - r.top - ch / 2;
    S.view.z = z; S.view.tx = px - (px - pinch.tx) * k + (cx - pinch.cx); S.view.ty = py - (py - pinch.ty) * k + (cy - pinch.cy); draw(); return;
  }
  if (pan) { S.view.tx = pan.tx + e.clientX - pan.x; S.view.ty = pan.ty + e.clientY - pan.y; draw(); return; }
  if (live) { const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e]; for (const ev of (evs.length ? evs : [e])) toolMove(ev); }
});
function endPointer(e) {
  if (!pointers.has(e.pointerId)) return; pointers.delete(e.pointerId);
  if (pinch) { if (pointers.size < 2) pinch = null; return; }
  if (pan) { pan = null; setTool(S.tool); return; }
  if (live) toolUp(e);
}
stage.addEventListener('pointerup', endPointer); stage.addEventListener('pointercancel', e => { if (live) cancelLive(); endPointer(e); });
stage.addEventListener('wheel', e => {
  if (!S.proj) return; e.preventDefault();
  const r = stage.getBoundingClientRect();
  if (e.ctrlKey || e.metaKey || e.deltaMode === 1 || (Math.abs(e.deltaY) >= 40 && e.deltaX === 0)) {
    const z = clamp(S.view.z * Math.exp(-e.deltaY * 0.0022), 0.25, 12), k = z / S.view.z;
    const px = e.clientX - r.left - cw / 2, py = e.clientY - r.top - ch / 2;
    S.view.tx = px - (px - S.view.tx) * k; S.view.ty = py - (py - S.view.ty) * k; S.view.z = z;
  } else { S.view.tx -= e.deltaX; S.view.ty -= e.deltaY; }
  draw();
}, { passive: false });
$('#zoomHud').onclick = () => { S.view = { z: 1, tx: 0, ty: 0 }; draw(); };

function pressureK(ev, speed) {
  if (ev.pointerType === 'pen' && ev.pressure > 0) return 0.15 + 0.95 * ev.pressure;
  return clamp(1.15 - speed / 55, 0.4, 1.1);
}
function brushWidth(ev, speed) {
  if (S.tool === 'eraser') return S.size;
  let k = 1;
  if (ev.pointerType === 'pen' && ev.pressure > 0) k = 0.15 + 0.95 * ev.pressure;
  else k = clamp(1.15 - speed / 55, 0.4, 1.1);
  return S.size * k;
}
function toolDown(e) {
  const pt = toProj(e); const l = activeLayer(); const f = curFrame();
  if (S.tool === 'pick') { pickColor(pt); return; }
  if (!l.visible) { toast('This layer is hidden. Show it to draw on it.'); return; }
  const cell = getCell(f.id, l.id, true);
  if (S.tool !== 'eraser' && S.tool !== 'move') noteRecent(S.color);
  if (S.tool === 'fill') { doFill(cell, pt); return; }
  live = { tool: S.tool, cell, fid: f.id, lid: l.id, pts: [pt], sx: pt.x, sy: pt.y, w: brushWidth(e, 0), t: performance.now(),
           box: [pt.x, pt.y, pt.x, pt.y], preview: false, alpha: S.opacity, start: pt, seed: (Math.random() * 1e6) | 0 };
  clearStrokeCanvases(); const sc = stroke.getContext('2d');
  if (S.tool === 'move') { live.snap = mk(W(), H()); live.snap.getContext('2d').drawImage(cell, 0, 0); live.before = cell.getContext('2d').getImageData(0, 0, W(), H()); return; }
  if (S.tool === 'eraser') { live.before = cell.getContext('2d').getImageData(0, 0, W(), H()); dab(cell.getContext('2d'), pt, live.w, true); draw(); return; }
  live.preview = true;
  if (S.tool === 'pen') {
    const k0 = e.pointerType === 'pen' && e.pressure > 0 ? pressureK(e, 0) : 1;
    live.st = brushState(BRUSH[S.brush], S.color, S.size, live.seed); live.kSm = k0;
    live.samples = [{ x: pt.x, y: pt.y, k: k0 }]; strokeTo(live.st, sc, stroke2.getContext('2d'), live.samples[0], Infinity); draw();
  }
}
/* feed the brush a quadratic piece of the smoothed path, as small straight steps */
function brushQuad(L, a, c, b, k) {
  const n = Math.max(1, Math.ceil((Math.hypot(c.x - a.x, c.y - a.y) + Math.hypot(b.x - c.x, b.y - c.y)) / 2)), k0 = L.samples[L.samples.length - 1].k;
  const sc = stroke.getContext('2d'), sc2 = stroke2.getContext('2d');
  for (let j = 1; j <= n; j++) {
    const t = j / n, u = 1 - t, p = { x: u * u * a.x + 2 * u * t * c.x + t * t * b.x, y: u * u * a.y + 2 * u * t * c.y + t * t * b.y, k: k0 + (k - k0) * t };
    L.samples.push(p); strokeTo(L.st, sc, sc2, p, Infinity);
  }
}
function dab(ctx, p, w, erase) {
  ctx.save(); if (erase) ctx.globalCompositeOperation = 'destination-out';
  ctx.fillStyle = erase ? '#000' : S.color; ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(0.5, w / 2), 0, Math.PI * 2); ctx.fill(); ctx.restore();
}
function grow(box, x, y, r) { box[0] = Math.min(box[0], x - r); box[1] = Math.min(box[1], y - r); box[2] = Math.max(box[2], x + r); box[3] = Math.max(box[3], y + r); }
function toolMove(ev) {
  if (!live) return; const p = toProj(ev);
  if (live.tool === 'move') { const c = live.cell.getContext('2d'); c.clearRect(0, 0, W(), H()); c.drawImage(live.snap, Math.round(p.x - live.start.x), Math.round(p.y - live.start.y)); live.moved = true; draw(); return; }
  if (['line', 'rect', 'ellipse'].includes(live.tool)) { live.end = p; shapePreview(); draw(); return; }
  const k = 1 - S.smooth * 0.92; const nx = live.sx + (p.x - live.sx) * k, ny = live.sy + (p.y - live.sy) * k;
  const now = performance.now(), dt = Math.max(1, now - live.t), dist = Math.hypot(nx - live.sx, ny - live.sy);
  const speed = dist / dt * 16; live.t = now;
  if (live.tool === 'pen') {
    live.kSm = live.kSm * 0.6 + pressureK(ev, speed) * 0.4;
    const prev = live.pts[live.pts.length - 1], mid = { x: (prev.x + nx) / 2, y: (prev.y + ny) / 2 };
    brushQuad(live, live.lastMid || prev, prev, mid, live.kSm);
    live.lastMid = mid; live.pts.push({ x: nx, y: ny }); live.sx = nx; live.sy = ny; draw(); return;
  }
  const w = live.tool === 'pen' ? live.w * 0.6 + brushWidth(ev, speed) * 0.4 : brushWidth(ev, speed);
  const ctx = live.tool === 'eraser' ? live.cell.getContext('2d') : stroke.getContext('2d');
  ctx.save(); if (live.tool === 'eraser') ctx.globalCompositeOperation = 'destination-out';
  ctx.strokeStyle = live.tool === 'eraser' ? '#000' : S.color; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  const prev = live.pts[live.pts.length - 1];
  const mx = (prev.x + nx) / 2, my = (prev.y + ny) / 2, lm = live.lastMid || prev;
  ctx.lineWidth = Math.max(0.6, (live.w + w) / 2);
  ctx.beginPath(); ctx.moveTo(lm.x, lm.y); ctx.quadraticCurveTo(prev.x, prev.y, mx, my); ctx.stroke(); ctx.restore();
  live.lastMid = { x: mx, y: my }; live.pts.push({ x: nx, y: ny }); live.sx = nx; live.sy = ny; live.w = w;
  grow(live.box, nx, ny, w + 2); draw();
}
/* lines, rectangles and ellipses are drawn with the current brush */
function shapePreview() {
  const a = live.start, b = live.end; clearStrokeCanvases();
  let pts;
  if (live.tool === 'line') pts = [a, b];
  else if (live.tool === 'rect') { const x0 = Math.min(a.x, b.x), y0 = Math.min(a.y, b.y), x1 = Math.max(a.x, b.x), y1 = Math.max(a.y, b.y); pts = [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }, { x: x0, y: y0 }]; }
  else { const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2, rx = Math.abs(b.x - a.x) / 2, ry = Math.abs(b.y - a.y) / 2, n = clamp(Math.round((rx + ry) / 3), 24, 240);
    pts = Array.from({ length: n + 1 }, (_, j) => ({ x: cx + Math.cos(j / n * TAU - Math.PI / 2) * rx, y: cy + Math.sin(j / n * TAU - Math.PI / 2) * ry })); }
  pts = pts.map(p => ({ x: p.x, y: p.y, k: 1 }));
  let total = 0; for (let j = 1; j < pts.length; j++) total += Math.hypot(pts[j].x - pts[j - 1].x, pts[j].y - pts[j - 1].y);
  const st = brushState(BRUSH[S.brush], S.color, S.size, live.seed); st.noTaper = live.tool !== 'line';
  const sc = stroke.getContext('2d'), sc2 = stroke2.getContext('2d'); for (const p of pts) strokeTo(st, sc, sc2, p, total);
  if (!st.i) stamp(st, sc, sc2, a.x, a.y, st.size / 2, 1, 0, 0);
  live.st = st;
}
function commitBrush(L) {
  const st = L.st, [x0, y0, w, h] = boxOf(st, 3);
  if (w > 0 && h > 0) {
    const src = needsFinish(st.b) ? (finishInto(look.getContext('2d'), st, stroke, stroke2, x0, y0, w, h), look) : stroke;
    const cx = L.cell.getContext('2d'), before = cx.getImageData(x0, y0, w, h);
    cx.save(); cx.globalAlpha = L.alpha ?? S.opacity; cx.globalCompositeOperation = st.b.blend || 'source-over'; cx.drawImage(src, x0, y0, w, h, x0, y0, w, h); cx.restore();
    pushUndo({ k: 'cell', fid: L.fid, lid: L.lid, x: x0, y: y0, before, after: cx.getImageData(x0, y0, w, h) });
  }
  clearStrokeCanvases(); markDirty(L.fid, L.lid); draw();
}
function toolUp() {
  const L = live; live = null; if (!L) return;
  if (L.tool === 'move') {
    if (L.moved) pushUndo({ k: 'cell', fid: L.fid, lid: L.lid, x: 0, y: 0, before: L.before, after: L.cell.getContext('2d').getImageData(0, 0, W(), H()) });
    markDirty(L.fid, L.lid); rebuild(); return;
  }
  if (L.tool === 'eraser') { pushUndo({ k: 'cell', fid: L.fid, lid: L.lid, x: 0, y: 0, before: L.before, after: L.cell.getContext('2d').getImageData(0, 0, W(), H()) }); markDirty(L.fid, L.lid); draw(); return; }
  if (['line', 'rect', 'ellipse'].includes(L.tool)) { if (!L.end) { clearStrokeCanvases(); draw(); return; } commitBrush(L); return; }
  if (L.tool === 'pen') {
    const sc = stroke.getContext('2d'), sc2 = stroke2.getContext('2d');
    if (L.lastMid) { const q = L.pts[L.pts.length - 1]; brushQuad(L, L.lastMid, { x: (L.lastMid.x + q.x) / 2, y: (L.lastMid.y + q.y) / 2 }, q, L.kSm * 0.8); }
    const b = L.st.b;
    if (!L.st.i) { const s0 = L.samples[0]; stamp(L.st, sc, sc2, s0.x, s0.y, Math.max(0.5, L.st.size * 0.5 * Math.max(b.min ?? 0.15, 1 + (s0.k - 1) * (b.psize || 0))), 1, 0, 0); }
    else if (b.taper && b.taper[1] && L.samples.length > 1) {   // redraw the whole stroke with its end taper, now that its length is known
      clearStrokeCanvases(); const total = L.st.dist, st2 = brushState(b, L.st.color, L.st.size, L.st.seed);
      for (const p of L.samples) strokeTo(st2, sc, sc2, p, total); L.st = st2;
    }
    commitBrush(L); return;
  }
  const x0 = clamp(Math.floor(L.box[0]) - 2, 0, W()), y0 = clamp(Math.floor(L.box[1]) - 2, 0, H());
  const x1 = clamp(Math.ceil(L.box[2]) + 2, 0, W()), y1 = clamp(Math.ceil(L.box[3]) + 2, 0, H());
  const cx = L.cell.getContext('2d');
  if (x1 > x0 && y1 > y0) {
    const before = cx.getImageData(x0, y0, x1 - x0, y1 - y0);
    cx.save(); cx.globalAlpha = S.opacity; cx.drawImage(stroke, 0, 0); cx.restore();
    pushUndo({ k: 'cell', fid: L.fid, lid: L.lid, x: x0, y: y0, before, after: cx.getImageData(x0, y0, x1 - x0, y1 - y0) });
  }
  stroke.getContext('2d').clearRect(0, 0, W(), H()); markDirty(L.fid, L.lid); draw();
}
function cancelLive() {
  if (!live) return;
  if (live.before) live.cell.getContext('2d').putImageData(live.before, 0, 0);
  clearStrokeCanvases(); live = null; draw();
}
function pickColor(pt) {
  const x = Math.floor(pt.x), y = Math.floor(pt.y); if (x < 0 || y < 0 || x >= W() || y >= H()) return;
  const c = mk(1, 1), cx = c.getContext('2d'); cx.translate(-x, -y); composite(cx, S.cur, 1);
  const d = cx.getImageData(0, 0, 1, 1).data; setColor(rgbToHex(d[0], d[1], d[2])); toast('Colour picked'); setTool('pen');
}
function doFill(cell, pt) {
  const x = Math.floor(pt.x), y = Math.floor(pt.y), w = W(), h = H(); if (x < 0 || y < 0 || x >= w || y >= h) return;
  const cx = cell.getContext('2d'); const before = cx.getImageData(0, 0, w, h);
  let src = before.data;
  if (S.fillAll) { const c = mk(w, h); composite(c.getContext('2d'), S.cur, 1, { noBg: true }); src = c.getContext('2d').getImageData(0, 0, w, h).data; }
  const i0 = (y * w + x) * 4, tr = src[i0], tg = src[i0 + 1], tb = src[i0 + 2], ta = src[i0 + 3], tol = 48;
  const same = i => { const a = src[i + 3]; if (ta < 20 && a < 20) return true; return Math.abs(a - ta) <= tol && Math.abs(src[i] - tr) <= tol && Math.abs(src[i + 1] - tg) <= tol && Math.abs(src[i + 2] - tb) <= tol; };
  const mask = new Uint8Array(w * h), stack = [x, y];
  while (stack.length) {
    let sy = stack.pop(), sx = stack.pop(); let lx = sx;
    while (lx >= 0 && !mask[sy * w + lx] && same((sy * w + lx) * 4)) lx--;
    lx++; let up = false, dn = false;
    for (let xx = lx; xx < w && !mask[sy * w + xx] && same((sy * w + xx) * 4); xx++) {
      mask[sy * w + xx] = 1;
      if (sy > 0) { const m = !mask[(sy - 1) * w + xx] && same(((sy - 1) * w + xx) * 4); if (m && !up) { stack.push(xx, sy - 1); up = true; } else if (!m) up = false; }
      if (sy < h - 1) { const m = !mask[(sy + 1) * w + xx] && same(((sy + 1) * w + xx) * 4); if (m && !dn) { stack.push(xx, sy + 1); dn = true; } else if (!m) dn = false; }
    }
  }
  const grown = mask.slice();              // grow 1 px so the fill tucks under anti-aliased line edges
  for (let yy = 1; yy < h - 1; yy++) for (let xx = 1; xx < w - 1; xx++) { const i = yy * w + xx; if (!mask[i] && (mask[i - 1] || mask[i + 1] || mask[i - w] || mask[i + w])) grown[i] = 1; }
  const out = cx.getImageData(0, 0, w, h), d = out.data, [r, g, b] = hexToRgb(S.color), A = Math.round(255 * S.opacity);
  for (let i = 0; i < grown.length; i++) if (grown[i]) {
    const j = i * 4, a0 = d[j + 3] / 255, a1 = A / 255, ao = a1 + a0 * (1 - a1);
    if (ao <= 0) continue;
    d[j] = Math.round((r * a1 + d[j] * a0 * (1 - a1)) / ao); d[j + 1] = Math.round((g * a1 + d[j + 1] * a0 * (1 - a1)) / ao);
    d[j + 2] = Math.round((b * a1 + d[j + 2] * a0 * (1 - a1)) / ao); d[j + 3] = Math.round(ao * 255);
  }
  cx.putImageData(out, 0, 0);
  pushUndo({ k: 'cell', fid: curFrame().id, lid: activeLayer().id, x: 0, y: 0, before, after: out });
  markDirty(curFrame().id, activeLayer().id); draw();
}

/* ------------------------------------------------------------------ undo */
let undoBytes = 0;
function sizeOf(u) { return u.k === 'cell' ? (u.before.data.length + u.after.data.length) : 2000; }
function pushUndo(u) {
  S.undo.push(u); S.redo = []; undoBytes += sizeOf(u);
  while (S.undo.length > 60 || undoBytes > 160e6) undoBytes -= sizeOf(S.undo.shift());
  updateUndo();
}
function applyUndo(u, dir) {
  if (u.k === 'cell') {
    const c = getCell(u.fid, u.lid, true); c.getContext('2d').putImageData(dir < 0 ? u.before : u.after, u.x, u.y);
    const fi = S.proj.frames.findIndex(f => f.id === u.fid); if (fi >= 0 && fi !== S.cur) S.cur = fi;
    markDirty(u.fid, u.lid);
  } else {
    const st = JSON.parse(JSON.stringify(dir < 0 ? u.before : u.after));
    S.proj.frames = st.frames; S.proj.layers = st.layers; S.cur = clamp(st.cur, 0, st.frames.length - 1);
    if (!S.proj.layers.some(l => l.id === S.layer)) S.layer = S.proj.layers[S.proj.layers.length - 1].id;
    syncCells(); renderStrip(true); renderLayers();
  }
  rebuild(); updateBar(); renderStrip();
}
function undo() { const u = S.undo.pop(); if (!u) return; undoBytes -= sizeOf(u); S.redo.push(u); applyUndo(u, -1); updateUndo(); }
function redo() { const u = S.redo.pop(); if (!u) return; S.undo.push(u); undoBytes += sizeOf(u); applyUndo(u, 1); updateUndo(); }
function updateUndo() { $('#undoBtn').disabled = !S.undo.length; $('#redoBtn').disabled = !S.redo.length; }
function structSnap() { return { frames: JSON.parse(JSON.stringify(S.proj.frames)), layers: JSON.parse(JSON.stringify(S.proj.layers)), cur: S.cur }; }
function structChange(fn) { const before = structSnap(); fn(); const after = structSnap(); pushUndo({ k: 'struct', before, after }); syncCells(); renderStrip(true); renderLayers(); updateBar(); rebuild(); }

/* ------------------------------------------------------------------ frames */
function seqLen() { return S.proj.frames.reduce((s, f) => s + (f.hold || 1), 0); }
function startOf(fi) { let n = 0; for (let i = 0; i < fi; i++) n += S.proj.frames[i].hold || 1; return n; }
function updateBar() {
  if (!S.proj) return;
  const fps = S.proj.fps, n = startOf(S.cur), sec = n / fps;
  const tc = `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}.${String(n % fps).padStart(2, '0')}`;
  $('#tc').textContent = `F ${S.cur + 1}/${S.proj.frames.length}  ·  ${tc}  ·  ${(seqLen() / fps).toFixed(1)} s`;
  $('#fHold').textContent = 'x' + (curFrame().hold || 1);
  $('#fpsBtn').textContent = S.proj.fps + ' fps';
  $('#loopBtn').classList.toggle('on', S.proj.loop !== false);
  $('#fDel').disabled = S.proj.frames.length < 2; $('#fLeft').disabled = S.cur === 0; $('#fRight').disabled = S.cur >= S.proj.frames.length - 1;
  updateUndo();
}
function goFrame(i) { if (!S.proj) return; S.cur = clamp(i, 0, S.proj.frames.length - 1); updateBar(); renderStrip(); rebuild(); }
function thumbSize() { const th = 64; return { tw: Math.round(th * W() / H()), th }; }
const thumbs = new Map();
function renderStrip(full) {
  const st = $('#strip'); const { tw, th } = thumbSize();
  if (full || st.children.length !== S.proj.frames.length + 1) {
    st.innerHTML = ''; thumbs.clear();
    S.proj.frames.forEach((f, i) => {
      const b = document.createElement('button'); b.className = 'fr'; b.setAttribute('aria-label', 'Frame ' + (i + 1));
      const c = mk(tw * 2, th * 2); c.style.width = tw + 'px'; c.style.height = th + 'px'; b.appendChild(c);
      b.insertAdjacentHTML('beforeend', `<span class="n">${i + 1}</span>`);
      if ((f.hold || 1) > 1) b.insertAdjacentHTML('beforeend', `<span class="hold">x${f.hold}</span>`);
      b.onclick = () => goFrame(i); st.appendChild(b); thumbs.set(f.id, c); drawThumb(i);
    });
    const add = document.createElement('button'); add.className = 'fr add'; add.style.height = (th + 4) + 'px'; add.title = 'Add a frame at the end'; add.setAttribute('aria-label', 'Add a frame at the end');
    add.innerHTML = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>';
    add.onclick = () => addFrame(S.proj.frames.length - 1, false); st.appendChild(add);
  }
  [...st.children].forEach((b, i) => b.classList.toggle('on', i === S.cur));
  const on = st.children[S.cur]; if (on) on.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}
function drawThumb(i) {
  const f = S.proj && S.proj.frames[i]; if (!f) return; const c = thumbs.get(f.id); if (!c) return;
  const x = c.getContext('2d'); x.setTransform(1, 0, 0, 1, 0, 0); x.clearRect(0, 0, c.width, c.height); composite(x, i, c.width / W());
}
function addFrame(after, dup) {
  structChange(() => {
    const src = S.proj.frames[after], nf = { id: uid(), hold: dup ? (src.hold || 1) : 1 };
    S.proj.frames.splice(after + 1, 0, nf);
    if (dup) for (const l of S.proj.layers) { const c = getCell(src.id, l.id, false); if (c) getCell(nf.id, l.id, true).getContext('2d').drawImage(c, 0, 0); }
    S.cur = after + 1;
  });
}
function delFrame() {
  if (S.proj.frames.length < 2) return;
  structChange(() => { S.proj.frames.splice(S.cur, 1); S.cur = Math.min(S.cur, S.proj.frames.length - 1); });
  toast('Frame deleted. Undo brings it back.');
}
function moveFrame(d) {
  const j = S.cur + d; if (j < 0 || j >= S.proj.frames.length) return;
  structChange(() => { const f = S.proj.frames.splice(S.cur, 1)[0]; S.proj.frames.splice(j, 0, f); S.cur = j; });
}
function cycleHold() { structChange(() => { const f = curFrame(); f.hold = (f.hold || 1) % 4 + 1; }); }

/* ------------------------------------------------------------------ layers */
function renderLayers() {
  const box = $('#layers'); box.innerHTML = '';
  const ls = [...S.proj.layers].reverse();
  for (const l of ls) {
    const row = document.createElement('div'); row.className = 'layer' + (l.id === S.layer ? ' on' : '');
    row.innerHTML = `<button class="ico eye" title="${l.visible ? 'Hide' : 'Show'} layer" aria-label="${l.visible ? 'Hide' : 'Show'} ${esc(l.name)}"><svg viewBox="0 0 24 24">${l.visible
      ? '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>' : '<path d="M3 3l18 18M10.6 6.1A10 10 0 0 1 12 6c6 0 10 6 10 6a17 17 0 0 1-3.2 3.8M6.4 6.5C3.7 8.3 2 12 2 12s4 7 10 7a9.6 9.6 0 0 0 4.1-.9"/>'}</svg></button>
      <canvas width="92" height="52"></canvas><button class="nm" title="Select (double-click to rename)">${esc(l.name)}</button>
      <button class="ico" title="Rename layer" aria-label="Rename ${esc(l.name)}"><svg viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16v4z"/></svg></button>`;
    const [eye, , nm, ren] = row.children;
    eye.onclick = () => { l.visible = !l.visible; markMeta(); renderLayers(); rebuild(); renderStrip(true); };
    nm.onclick = () => { S.layer = l.id; renderLayers(); rebuild(); };
    nm.ondblclick = ren.onclick = () => renameLayer(l);
    const c = row.querySelector('canvas'), cell = getCell(curFrame().id, l.id, false);
    if (cell) c.getContext('2d').drawImage(cell, 0, 0, 92, 52);
    box.appendChild(row);
  }
  const l = activeLayer();
  $('#layerCount').textContent = S.proj.layers.length + '/' + MAX_LAYERS;
  $('#lOp').value = Math.round(l.opacity * 100); $('#lOpO').textContent = Math.round(l.opacity * 100) + '%';
  $('#layerHud').textContent = l.name + (l.visible ? '' : ' (hidden)');
  $('#lAdd').disabled = S.proj.layers.length >= MAX_LAYERS; $('#lDel').disabled = S.proj.layers.length < 2;
  const i = S.proj.layers.indexOf(l); $('#lUp').disabled = i >= S.proj.layers.length - 1; $('#lDown').disabled = i <= 0;
}
function renameLayer(l) {
  const sh = openSheet(`<h2>Rename layer</h2><label class="field"><span>Name</span><input type="text" id="rnL" maxlength="30" value="${esc(l.name)}"></label>
    <div class="actions"><button class="btn" data-close>Cancel</button><button class="btn primary" id="rnGo">Rename</button></div>`);
  const go = () => { l.name = sh.querySelector('#rnL').value.trim() || l.name; closeSheet(); markMeta(); renderLayers(); };
  sh.querySelector('#rnGo').onclick = go; sh.querySelector('#rnL').onkeydown = e => { if (e.key === 'Enter') go(); };
  setTimeout(() => sh.querySelector('#rnL').select(), 30);
}
$('#lAdd').onclick = () => { if (S.proj.layers.length >= MAX_LAYERS) return; structChange(() => { const i = S.proj.layers.indexOf(activeLayer()); const nl = { id: uid(), name: 'Layer ' + (S.proj.layers.length + 1), visible: true, opacity: 1 }; S.proj.layers.splice(i + 1, 0, nl); S.layer = nl.id; }); };
$('#lDel').onclick = () => { if (S.proj.layers.length < 2) return; const l = activeLayer(); confirmSheet('Delete layer?', `“${esc(l.name)}” and its drawings on every frame will be removed. Undo brings it back.`, 'Delete layer', () => structChange(() => { const i = S.proj.layers.indexOf(l); S.proj.layers.splice(i, 1); S.layer = S.proj.layers[Math.max(0, i - 1)].id; })); };
$('#lUp').onclick = () => structChange(() => { const L = S.proj.layers, i = L.indexOf(activeLayer()); if (i < L.length - 1) [L[i], L[i + 1]] = [L[i + 1], L[i]]; });
$('#lDown').onclick = () => structChange(() => { const L = S.proj.layers, i = L.indexOf(activeLayer()); if (i > 0) [L[i], L[i - 1]] = [L[i - 1], L[i]]; });
$('#lClear').onclick = () => { const f = curFrame(), l = activeLayer(), c = getCell(f.id, l.id, false); if (!c) return; const cx = c.getContext('2d'); const before = cx.getImageData(0, 0, W(), H()); cx.clearRect(0, 0, W(), H()); pushUndo({ k: 'cell', fid: f.id, lid: l.id, x: 0, y: 0, before, after: cx.getImageData(0, 0, W(), H()) }); markDirty(f.id, l.id); rebuild(); renderLayers(); };
$('#lImport').onclick = () => $('#fileImg').click();
$('#lOp').oninput = e => { activeLayer().opacity = e.target.value / 100; $('#lOpO').textContent = e.target.value + '%'; rebuild(); };
$('#lOp').onchange = () => { markMeta(); renderStrip(true); };
function fitDraw(ctx, img, w, h, cover) {
  const k = cover ? Math.max(w / img.width, h / img.height) : Math.min(w / img.width, h / img.height);
  const iw = img.width * k, ih = img.height * k; ctx.drawImage(img, (w - iw) / 2, (h - ih) / 2, iw, ih);
}
$('#fileImg').onchange = async e => {
  const file = e.target.files[0]; e.target.value = ''; if (!file) return;
  try {
    const img = await loadImg(URL.createObjectURL(file)); const f = curFrame(), l = activeLayer(), c = getCell(f.id, l.id, true), cx = c.getContext('2d');
    const before = cx.getImageData(0, 0, W(), H()); fitDraw(cx, img, W(), H(), false);
    pushUndo({ k: 'cell', fid: f.id, lid: l.id, x: 0, y: 0, before, after: cx.getImageData(0, 0, W(), H()) }); markDirty(f.id, l.id); rebuild(); renderLayers();
    toast('Image placed on ' + l.name);
  } catch (err) { toast('That image could not be opened.'); }
};

/* ------------------------------------------------------------------ side panel */
function renderSide() {
  renderColour();
  if (settingsKey() !== S.setKey) loadSettings();
  syncSliders(); renderBrushes();
  $('#smR').value = Math.round(S.smooth * 100); $('#smO').textContent = Math.round(S.smooth * 100);
  $('#onOp').value = Math.round(S.onionOp * 100); $('#onOpO').textContent = Math.round(S.onionOp * 100) + '%';
  ['onOff', 'on1', 'on2', 'on3'].forEach((id, n) => $('#' + id).classList.toggle('on', S.onion === n));
  $('#onionBtn').classList.toggle('on', S.onion > 0);
  if (S.proj) { renderLayers(); $('#soundBtn').classList.toggle('on', !!S.proj.hasAudio); }
}
/* ------------------------------------------------------------------ colour panel
   A colour cat (the current colour, blinks, boings on change), gumdrop swatches that turn into a kitten when picked,
   colour sets in tabs (Basics, Skin, Spooky, Candy, Mine), a mixer (strength/brightness square + hue bar with a cat knob),
   shades for cartoon shading (shadows lean purple, lights lean warm), recent colours, and a back-to-last-colour button. */
const PALETTES = [
  { id: 'basics', name: 'Basics', cols: PALETTE.map((c, i) => [c, PALETTE_NAMES[i]]) },
  { id: 'skin', name: 'Skin', cols: [['#fde7d6', 'Porcelain'], ['#f7d2b6', 'Peach'], ['#f1c6a0', 'Light skin'], ['#e6ac80', 'Sand'],
    ['#c98b6b', 'Warm skin'], ['#a86b4b', 'Caramel'], ['#8a5a3c', 'Deep skin'], ['#5e3a26', 'Cocoa'], ['#3b2418', 'Espresso'], ['#f5d76e', 'Blonde'],
    ['#d9a441', 'Honey'], ['#b5562a', 'Ginger'], ['#6b3e26', 'Chestnut'], ['#2a1d17', 'Black hair'], ['#c9c3cf', 'Silver'], ['#e98aa0', 'Lips']] },
  { id: 'spooky', name: 'Spooky', cols: [['#0b0710', 'Void'], ['#241433', 'Midnight'], ['#3d1f4f', 'Bruise'], ['#5b2a3c', 'Scab'],
    ['#7a0f1f', 'Dried blood'], ['#c2182b', 'Fresh blood'], ['#e0507a', 'Gore pink'], ['#9aa65a', 'Bile'], ['#5f7a3a', 'Rot'], ['#2f5a52', 'Swamp'],
    ['#cdd17a', 'Sickly'], ['#e2d9c2', 'Old bone'], ['#f2f5ff', 'Ghost'], ['#7f8aa3', 'Fog'], ['#ef7d22', 'Pumpkin'], ['#ffc94a', 'Candlelight']] },
  { id: 'candy', name: 'Candy', cols: [['#b58cff', 'Onion lilac'], ['#d9c2ff', 'Lavender'], ['#ff8fd6', 'Cat pink'], ['#ffc2e8', 'Bubblegum'],
    ['#ff6b8b', 'Strawberry'], ['#ffb38a', 'Peach fizz'], ['#ffd36b', 'Lemon drop'], ['#fff1b8', 'Cream'], ['#8ff0c0', 'Slime'], ['#c8ffe4', 'Mint'],
    ['#7cc8ff', 'Sky'], ['#c5e6ff', 'Cloud'], ['#6a4bd8', 'Grape'], ['#2b1a4a', 'Night jelly'], ['#ffffff', 'Sugar'], ['#1b1420', 'Licorice']] },
  { id: 'mine', name: 'Mine', cols: null },
];
const MINE_MAX = 16, RECENT_MAX = 8;
const CAT_HEAD = 'M8 42C8 33 10 27 13 23L12 9C12 5 15 4 18 6L28 15C33 13.5 39 13.5 44 15L54 6C57 4 60 5 60 9L59 23C62 27 64 33 64 42C64 54 52 61 36 61C20 61 8 54 8 42Z';
const catSvg = id => `<svg class="catsvg" viewBox="0 0 72 66" aria-hidden="true"><defs><clipPath id="${id}"><path d="${CAT_HEAD}"/></clipPath></defs>
  <path class="head" d="${CAT_HEAD}"/>
  <g clip-path="url(#${id})"><ellipse cx="36" cy="71" rx="42" ry="21" fill="#06030c" opacity=".22"/><ellipse cx="36" cy="16" rx="30" ry="12" fill="#fff" opacity=".08"/></g>
  <path d="M16 11L16.6 20.5L24 15.6Z M56 11L55.4 20.5L48 15.6Z" fill="var(--pink)" opacity=".9"/>
  <ellipse cx="21.5" cy="28" rx="7" ry="3.4" transform="rotate(-28 21.5 28)" fill="#fff" opacity=".55"/><circle cx="30.5" cy="23.6" r="1.8" fill="#fff" opacity=".55"/>
  <ellipse cx="17.5" cy="48.5" rx="4.4" ry="2.6" fill="var(--pink)" opacity=".6"/><ellipse cx="54.5" cy="48.5" rx="4.4" ry="2.6" fill="var(--pink)" opacity=".6"/>
  <g class="eyes"><ellipse cx="26" cy="40" rx="3.6" ry="4.6" fill="var(--eye)"/><ellipse cx="46" cy="40" rx="3.6" ry="4.6" fill="var(--eye)"/>
    <circle cx="27.3" cy="38.2" r="1.35" fill="var(--eyehl)"/><circle cx="47.3" cy="38.2" r="1.35" fill="var(--eyehl)"/></g>
  <path d="M33.5 45.5h5L36 48.5Z" fill="var(--pink)" stroke="var(--eye)" stroke-width=".9" stroke-linejoin="round"/>
  <path d="M31.3 50.3q2.35 2.7 4.7 0q2.35 2.7 4.7 0" fill="none" stroke="var(--eye)" stroke-width="1.9" stroke-linecap="round"/>
  <path class="line" d="${CAT_HEAD}"/></svg>`;
const KNOB_SVG = `<svg viewBox="0 0 30 28" aria-hidden="true"><path d="M3 17C3 12 4.5 9.5 6 8L5.5 2.8C5.5 1.4 6.8 1 7.8 1.8L11.8 5.4C13.9 4.9 16.1 4.9 18.2 5.4L22.2 1.8C23.2 1 24.5 1.4 24.5 2.8L24 8C25.5 9.5 27 12 27 17C27 22.5 21.6 26 15 26C8.4 26 3 22.5 3 17Z"
  fill="var(--hue)" stroke="var(--ink)" stroke-width="2.4" stroke-linejoin="round"/><path d="M7 4.6L7.3 8.4L10.2 6.4Z M23 4.6L22.7 8.4L19.8 6.4Z" fill="var(--pink)"/>
  <ellipse cx="10.8" cy="16" rx="1.7" ry="2.1" fill="#1a0f24"/><ellipse cx="19.2" cy="16" rx="1.7" ry="2.1" fill="#1a0f24"/>
  <path d="M13 19.6q1 1.1 2 0q1 1.1 2 0" fill="none" stroke="#1a0f24" stroke-width="1.1" stroke-linecap="round"/></svg>`;
const SWATCH_FACE = '<i><svg viewBox="0 0 20 20"><ellipse cx="6.6" cy="10.2" rx="1.7" ry="2.1"/><ellipse cx="13.4" cy="10.2" rx="1.7" ry="2.1"/><path d="M8.3 13.4q.85 1 1.7 0q.85 1 1.7 0"/></svg></i>';

function normHex(c) {
  c = String(c || '').trim().replace(/^#/, '').toLowerCase();
  if (/^[0-9a-f]{3}$/.test(c)) c = c.split('').map(x => x + x).join('');
  return /^[0-9a-f]{6}$/.test(c) ? '#' + c : null;
}
function hueOf(r, g, b, mx, d) { let h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h *= 60; return h < 0 ? h + 360 : h; }
function hexToHsv(hex) { const [r, g, b] = hexToRgb(hex).map(v => v / 255), mx = Math.max(r, g, b), d = mx - Math.min(r, g, b); return { h: d ? hueOf(r, g, b, mx, d) : 0, s: mx ? d / mx : 0, v: mx }; }
function hsvToHex({ h, s, v }) { const f = n => { const k = (n + h / 60) % 6; return v - v * s * Math.max(0, Math.min(k, 4 - k, 1)); }; return rgbToHex(...[5, 3, 1].map(n => Math.round(clamp(f(n), 0, 1) * 255))); }
function hexToHsl(hex) {
  const [r, g, b] = hexToRgb(hex).map(v => v / 255), mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
  return { h: d ? hueOf(r, g, b, mx, d) : 0, s: d ? d / (1 - Math.abs(2 * l - 1)) : 0, l };
}
function hslToHex({ h, s, l }) { const a = s * Math.min(l, 1 - l); const f = n => { const k = (n + h / 30) % 12; return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)); }; return rgbToHex(...[0, 8, 4].map(n => Math.round(clamp(f(n), 0, 1) * 255))); }
function lum(hex) { const [r, g, b] = hexToRgb(hex).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; }
const eyeFor = hex => lum(hex) < 0.18 ? '#fff6e8' : '#1a0f24';
function colourName(hex) {
  for (const p of PALETTES) for (const [c, n] of (p.cols || [])) if (c === hex) return n;
  const { h, s, l } = hexToHsl(hex);
  if (s < 0.12 || l < 0.06 || l > 0.97) return l < 0.1 ? 'Almost black' : l < 0.35 ? 'Dark grey' : l < 0.68 ? 'Grey' : l < 0.94 ? 'Light grey' : 'Almost white';
  const HUES = [[12, 'red'], [40, 'orange'], [64, 'yellow'], [90, 'lime'], [160, 'green'], [190, 'teal'], [215, 'sky blue'], [250, 'blue'], [285, 'purple'], [320, 'magenta'], [345, 'pink'], [361, 'red']];
  let name = HUES.find(([m]) => h < m)[1];
  if (h >= 12 && h < 50 && l < 0.42) name = 'brown';
  const out = (l < 0.25 ? 'deep ' : l > 0.8 ? 'pale ' : s < 0.35 ? 'dusty ' : '') + name;
  return out[0].toUpperCase() + out.slice(1);
}
/* cartoon shading: shadows get darker, a bit richer and lean toward purple; lights get paler and lean warm */
function shadesOf(hex) {
  const { h, s, l } = hexToHsl(hex), grey = s < 0.08, out = [];
  const toward = (a, b, t) => (a + ((((b - a) % 360) + 540) % 360 - 180) * t + 360) % 360;
  for (let n = 3; n >= 1; n--) out.push(hslToHex({ h: grey ? h : toward(h, 255, 0.08 * n), s: grey ? s : clamp(s * (1 + 0.08 * n), 0, 1), l: l * (1 - 0.22 * n) }));
  out.push(hex);
  for (let n = 1; n <= 3; n++) out.push(hslToHex({ h: grey ? h : toward(h, 55, 0.08 * n), s: grey ? s : s * (1 - 0.1 * n), l: l + (1 - l) * 0.25 * n }));
  return out;
}

Object.assign(S, { ctab: lsGet('ctab', 'basics'), mine: lsGet('mine', []), recent: lsGet('recent', []), prevColor: lsGet('prevColor', '#ffffff'),
  mixOpen: lsGet('mixOpen', false), hsv: hexToHsv(normHex(S.color) || '#1b1420'), shadeBase: S.color });
$('#cCat').innerHTML = catSvg('catClipColour'); $('#cHueKnob').innerHTML = KNOB_SVG; $('#gMascot').innerHTML = catSvg('catClipGallery');

function renderColour() {
  const tabs = $('#cTabs'); tabs.innerHTML = '';
  if (!PALETTES.some(p => p.id === S.ctab)) S.ctab = 'basics';
  for (const p of PALETTES) {
    const b = document.createElement('button'); b.setAttribute('role', 'tab');
    if (p.id === 'mine') { b.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20s-7.5-4.6-7.5-10.2A4.2 4.2 0 0 1 12 7.3a4.2 4.2 0 0 1 7.5 2.5C19.5 15.4 12 20 12 20z"/></svg>'; b.title = 'My colours'; b.setAttribute('aria-label', 'My colours'); }
    else b.textContent = p.name;
    b.setAttribute('aria-selected', String(p.id === S.ctab)); b.classList.toggle('on', p.id === S.ctab);
    b.onclick = () => { S.ctab = p.id; lsSet('ctab', p.id); renderColour(); }; tabs.appendChild(b);
  }
  const tab = PALETTES.find(p => p.id === S.ctab), mine = !tab.cols, sw = $('#swatches'); sw.innerHTML = '';
  for (const [c, n] of (tab.cols || S.mine.map(c => [c, colourName(c)]))) {
    const b = document.createElement('button'); b.dataset.c = c; b.style.setProperty('--c', c); b.style.setProperty('--eye', eyeFor(c));
    b.title = mine ? n + ' (right-click to remove)' : n; b.setAttribute('aria-label', n); b.innerHTML = SWATCH_FACE;
    b.onclick = () => setColor(c);
    if (mine) b.oncontextmenu = e => { e.preventDefault(); toggleMine(c, false); };
    sw.appendChild(b);
  }
  if (mine && S.mine.length < MINE_MAX) {
    const a = document.createElement('button'); a.className = 'add'; a.textContent = '+'; a.title = 'Keep the colour you have now'; a.setAttribute('aria-label', 'Keep the colour you have now');
    a.onclick = () => toggleMine(S.color, true); sw.appendChild(a);
    if (!S.mine.length) { const t = document.createElement('span'); t.className = 'c-empty'; t.textContent = 'Press + or the heart to keep colours you love here.'; sw.appendChild(t); }
  }
  renderRecent(); paintColour('init');
}
function renderRecent() {
  const r = $('#cRecent'); r.innerHTML = '';
  for (let i = 0; i < RECENT_MAX; i++) {
    const c = S.recent[i], b = document.createElement('button');
    if (c) { b.dataset.c = c; b.style.setProperty('--c', c); b.title = colourName(c); b.setAttribute('aria-label', 'Recent: ' + b.title); b.onclick = () => setColor(c); }
    else { b.className = 'empty'; b.disabled = true; b.tabIndex = -1; b.title = 'Colours you draw with land here'; b.setAttribute('aria-hidden', 'true'); }
    r.appendChild(b);
  }
}
function noteRecent(c) {
  if (S.recent[0] === c) return;
  S.recent = [c, ...S.recent.filter(x => x !== c)].slice(0, RECENT_MAX); lsSet('recent', S.recent); renderRecent(); paintColour('init');
}
function toggleMine(c, add) {
  const has = S.mine.includes(c); if (add === undefined) add = !has;
  if (add && !has) {
    if (S.mine.length >= MINE_MAX) { toast('My colours is full. Right-click one to remove it.'); return; }
    S.mine.push(c); toast(colourName(c) + ' kept in My colours', 1600);
  } else if (!add && has) { S.mine = S.mine.filter(x => x !== c); toast('Removed from My colours', 1400); }
  else if (add && has) { toast('Already in My colours', 1200); }
  lsSet('mine', S.mine); renderColour();
}
function paintColour(how) {
  const c = S.color, sec = $('#colourSec');
  sec.style.setProperty('--c', c); sec.style.setProperty('--eye', eyeFor(c)); sec.style.setProperty('--eyehl', lum(c) < 0.18 ? '#1a0f24' : '#ffffff');
  sec.style.setProperty('--h', S.hsv.h.toFixed(1)); sec.style.setProperty('--hue', `hsl(${S.hsv.h.toFixed(1)} 100% 50%)`);
  const name = colourName(c); $('#cName').textContent = name; $('#cName').title = name;
  if (how !== 'hex' && document.activeElement !== $('#cHex')) $('#cHex').value = c.slice(1).toUpperCase();
  const pv = $('#cPrev'), pn = colourName(S.prevColor); pv.style.setProperty('--c', S.prevColor); pv.title = 'Back to ' + pn; pv.setAttribute('aria-label', 'Back to ' + pn);
  const kept = S.mine.includes(c), sv = $('#cSave'); sv.classList.toggle('on', kept);
  sv.title = kept ? 'Remove from My colours' : 'Keep in My colours'; sv.setAttribute('aria-label', sv.title); sv.setAttribute('aria-pressed', String(kept));
  for (const b of $('#swatches').children) b.classList.toggle('on', b.dataset.c === c);
  for (const b of $('#cRecent').children) b.classList.toggle('on', b.dataset.c === c);
  const sh = $('#cShades'); sh.innerHTML = '';
  shadesOf(S.shadeBase).forEach((x, i) => {
    const b = document.createElement('button'); b.style.setProperty('--c', x); b.dataset.c = x;
    b.title = (i < 3 ? 'Shadow ' + (3 - i) : i > 3 ? 'Light ' + (i - 3) : 'Base colour') + ' · #' + x.slice(1).toUpperCase(); b.setAttribute('aria-label', b.title);
    if (x === c) b.className = 'now'; b.onclick = () => setColor(x, false, 'shade'); sh.appendChild(b);
  });
  $('#cSvThumb').style.left = (S.hsv.s * 100) + '%'; $('#cSvThumb').style.top = ((1 - S.hsv.v) * 100) + '%';
  $('#cHueKnob').style.left = (S.hsv.h / 360 * 100) + '%';
  $('#cSv').setAttribute('aria-valuetext', `strength ${Math.round(S.hsv.s * 100)}%, brightness ${Math.round(S.hsv.v * 100)}%`);
  $('#cHue').setAttribute('aria-valuenow', String(Math.round(S.hsv.h)));
  $('#cMixer').hidden = !S.mixOpen; $('#cMix').classList.toggle('on', S.mixOpen);
  $('#cMix').setAttribute('aria-expanded', String(S.mixOpen)); $('#cCat').setAttribute('aria-expanded', String(S.mixOpen));
  $('#cCat').title = S.mixOpen ? 'Close the colour mixer' : 'Open the colour mixer';
  if (how && how !== 'init' && how !== 'mix') { const cat = $('#cCat'); cat.classList.remove('boing'); void cat.offsetWidth; cat.classList.add('boing'); }
}
function setColor(c, quiet, how) {
  c = normHex(c); if (!c) return;
  if (c !== S.color && !quiet && how !== 'mix') { S.prevColor = S.color; lsSet('prevColor', S.prevColor); }
  S.color = c; lsSet('color', c);
  if (how !== 'mix') S.hsv = hexToHsv(c);
  if (how !== 'shade') S.shadeBase = c;
  paintColour(quiet ? 'init' : (how || 'pick'));
  updateSwatchNow();
  if (!quiet && S.tool === 'eraser') setTool('pen');
}
function toggleMixer() { S.mixOpen = !S.mixOpen; lsSet('mixOpen', S.mixOpen); paintColour('init'); }
$('#cCat').onclick = toggleMixer; $('#cMix').onclick = toggleMixer;
$('#cPrev').onclick = () => setColor(S.prevColor);
$('#cSave').onclick = () => toggleMine(S.color);
$('#cDrop').onclick = () => { setTool('pick'); togglePanel(false); toast('Tap your drawing to pick up a colour', 1800); };
const hexIn = $('#cHex');
hexIn.addEventListener('input', () => { const raw = hexIn.value.replace('#', ''); const v = normHex(raw); if (v && raw.length === 6) setColor(v, false, 'hex'); });
hexIn.addEventListener('keydown', e => { if (e.key === 'Enter') hexIn.blur(); if (e.key === 'Escape') { hexIn.value = S.color.slice(1).toUpperCase(); hexIn.blur(); } });
hexIn.addEventListener('blur', () => { const v = normHex(hexIn.value); if (v && v !== S.color) setColor(v); hexIn.value = S.color.slice(1).toUpperCase(); });
hexIn.addEventListener('focus', () => hexIn.select());
function mixTo() { if (S.hsv.h >= 360) S.hsv.h = 0; setColor(hsvToHex(S.hsv), false, 'mix'); }
function dragArea(el, onPos) {
  el.addEventListener('pointerdown', e => {
    if (e.button > 0) return;
    e.preventDefault(); el.setPointerCapture(e.pointerId); el.focus({ preventScroll: true });
    const start = S.color;
    const move = ev => { const r = el.getBoundingClientRect(); onPos(clamp((ev.clientX - r.left) / r.width, 0, 1), clamp((ev.clientY - r.top) / r.height, 0, 1)); mixTo(); };
    const up = () => {
      el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up);
      if (S.color !== start) { S.prevColor = start; lsSet('prevColor', start); paintColour('init'); }
    };
    move(e); el.addEventListener('pointermove', move); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
  });
}
dragArea($('#cSv'), (x, y) => { S.hsv.s = x; S.hsv.v = 1 - y; });
dragArea($('#cHue'), x => { S.hsv.h = x * 359.9; if (S.hsv.s < 0.08) S.hsv.s = 0.7; if (S.hsv.v < 0.12) S.hsv.v = 0.8; });
function sliderKeys(el, step) {
  el.addEventListener('keydown', e => {
    const big = e.shiftKey ? 5 : 1, k = e.key; if (!step(k, big)) return;
    e.preventDefault(); e.stopPropagation(); if (el._start == null) el._start = S.color; mixTo();
  });
  el.addEventListener('keyup', () => { if (el._start != null && el._start !== S.color) { S.prevColor = el._start; lsSet('prevColor', el._start); paintColour('init'); } el._start = null; });
}
sliderKeys($('#cSv'), (k, big) => {
  const d = 0.02 * big, H = S.hsv;
  if (k === 'ArrowLeft') H.s = clamp(H.s - d, 0, 1); else if (k === 'ArrowRight') H.s = clamp(H.s + d, 0, 1);
  else if (k === 'ArrowUp') H.v = clamp(H.v + d, 0, 1); else if (k === 'ArrowDown') H.v = clamp(H.v - d, 0, 1); else return false;
  return true;
});
sliderKeys($('#cHue'), (k, big) => {
  const d = 3 * big;
  if (k === 'ArrowLeft' || k === 'ArrowDown') S.hsv.h = (S.hsv.h - d + 360) % 360; else if (k === 'ArrowRight' || k === 'ArrowUp') S.hsv.h = (S.hsv.h + d) % 360; else return false;
  return true;
});
$('#sizeR').oninput = e => { S.size = +e.target.value; $('#sizeO').textContent = S.size; saveSettings(); updateSwatchNow(); };
$('#opR').oninput = e => { S.opacity = e.target.value / 100; $('#opO').textContent = e.target.value + '%'; saveSettings(); };
$('#smR').oninput = e => { S.smooth = e.target.value / 100; $('#smO').textContent = e.target.value; lsSet('sm', S.smooth); };
$('#fillThis').onclick = () => { S.fillAll = false; $('#fillThis').classList.add('on'); $('#fillAll').classList.remove('on'); };
$('#fillAll').onclick = () => { S.fillAll = true; $('#fillAll').classList.add('on'); $('#fillThis').classList.remove('on'); };
['onOff', 'on1', 'on2', 'on3'].forEach((id, n) => $('#' + id).onclick = () => { S.onion = n; lsSet('onion', n); renderSide(); rebuild(); });
$('#onOp').oninput = e => { S.onionOp = e.target.value / 100; $('#onOpO').textContent = e.target.value + '%'; lsSet('onionOp', S.onionOp); rebuild(); };
function togglePanel(force) { const s = $('#side'); s.classList.toggle('open', force ?? !s.classList.contains('open')); }
$('#panelBtn').onclick = () => togglePanel();
$('#onionBtn').onclick = () => { if (S.onion) { lsSet('onionLast', S.onion); S.onion = 0; } else S.onion = lsGet('onionLast', 1) || 1; lsSet('onion', S.onion); renderSide(); rebuild(); toast(S.onion ? 'Onion skin on' : 'Onion skin off', 1200); };
$('#soundBtn').onclick = () => openSound();

/* ------------------------------------------------------------------ playback + audio */
let actx = null, asrc = null, playT0 = 0, playStart = 0, playRaf = 0;
function seqIndex(n) { let k = 0; for (let i = 0; i < S.proj.frames.length; i++) { k += S.proj.frames[i].hold || 1; if (n < k) return i; } return S.proj.frames.length - 1; }
function startAudio(atFrame) {
  if (!S.audio) return;
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)(); if (actx.state === 'suspended') actx.resume();
    stopAudio(); asrc = actx.createBufferSource(); asrc.buffer = S.audio; asrc.connect(actx.destination);
    const t = atFrame / S.proj.fps + (S.proj.audioOffset || 0); if (t < S.audio.duration) asrc.start(0, Math.max(0, t));
  } catch (e) { console.warn(e); }
}
function stopAudio() { try { if (asrc) asrc.stop(); } catch (e) {} asrc = null; }
function play() {
  if (S.playing) return stop(); if (!S.proj) return;
  S.playing = true; $('#playIco').innerHTML = '<path d="M7 5h4v14H7zM13 5h4v14h-4z"/>'; $('#playBtn').setAttribute('aria-label', 'Pause');
  playStart = startOf(S.cur); if (playStart >= seqLen() - 1) playStart = 0;
  playT0 = performance.now(); startAudio(playStart); rebuild();
  const tick = () => {
    if (!S.playing) return;
    let n = playStart + Math.floor((performance.now() - playT0) / 1000 * S.proj.fps); const L = seqLen();
    if (n >= L) {
      if (S.proj.loop !== false) { playStart = 0; playT0 = performance.now(); n = 0; startAudio(0); }
      else { stop(); return; }
    }
    const fi = seqIndex(n); if (fi !== playFrame) { playFrame = fi; S.cur = fi; updateBar(); renderStrip(); draw(); }
    playRaf = requestAnimationFrame(tick);
  };
  tick();
}
function stop() {
  if (!S.playing) return; S.playing = false; playFrame = -1; cancelAnimationFrame(playRaf); stopAudio();
  $('#playIco').innerHTML = '<path d="M7 5l12 7-12 7z"/>'; $('#playBtn').setAttribute('aria-label', 'Play'); rebuild(); renderLayers();
}
async function loadAudioFromData(url, announce) {
  try {
    const buf = await (await fetch(url)).arrayBuffer();
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    S.audio = await actx.decodeAudioData(buf.slice(0)); S.audioUrl = url;
    if (announce) toast('Sound added: ' + (S.proj.audioName || 'audio'));
  } catch (e) { console.warn(e); if (announce) toast('That sound file could not be read.'); }
}
$('#fileAudio').onchange = async e => {
  const file = e.target.files[0]; e.target.value = ''; if (!file) return;
  if (file.size > 200e6) { toast('That sound file is over 200 MB. Trim it and try again.'); return; }
  const url = await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(file); });
  S.proj.audioName = file.name; S.proj.hasAudio = true; await loadAudioFromData(url, true);
  if (S.audio) {
    try { S.parts.set('audio~a', await S.store.saveCell(S.proj.id, 'audio', 'a', { url, ext: (file.name.split('.').pop() || 'mp3') }, S.parts.get('audio~a') || 0)); S.saved.add('audio~a'); } catch (err) { toast('The sound plays here but could not be saved.'); }
    markMeta(); renderSide(); if (S.afterAudio === 'sound') openSound(); else openSettings(); S.afterAudio = null;
  }
};
async function removeAudio() {
  S.audio = null; S.proj.hasAudio = false; S.proj.audioName = '';
  try { if (S.saved.has('audio~a')) await S.store.saveCell(S.proj.id, 'audio', 'a', null, S.parts.get('audio~a') || 1); } catch (e) {}
  S.saved.delete('audio~a'); markMeta();
}
$('#fileBg').onchange = async e => {
  const file = e.target.files[0]; e.target.value = ''; if (!file) return;
  try {
    const img = await loadImg(URL.createObjectURL(file)); const c = mk(W(), H()); fitDraw(c.getContext('2d'), img, W(), H(), true); S.bgImg = c;
    S.proj.hasBg = true; S.proj.bgScene = '';
    S.parts.set('bg~bg', await S.store.saveCell(S.proj.id, 'bg', 'bg', await cellPayload(c, 'image/jpeg', 0.86), S.parts.get('bg~bg') || 0)); S.saved.add('bg~bg');
    markMeta(); rebuild(); renderStrip(true); scheduleThumb(); openSettings(); toast('Background image set');
  } catch (err) { toast('That image could not be used as a background.'); }
};

/* a ready-made background scene (stagekit.js) becomes this animation's background picture */
async function applyScene(id) {
  const c = mk(W(), H()); window.OnionArt.drawScene(id, c.getContext('2d'), W(), H());
  S.bgImg = c; S.proj.hasBg = true; S.proj.bgScene = id;
  try {
    S.parts.set('bg~bg', await S.store.saveCell(S.proj.id, 'bg', 'bg', await cellPayload(c, 'image/jpeg', 0.9), S.parts.get('bg~bg') || 0)); S.saved.add('bg~bg');
  } catch (e) { toast('The background shows here but could not be saved.'); }
  markMeta(); rebuild(); renderStrip(true); scheduleThumb(); openSettings();
  toast((window.OnionArt.SCENES.find(x => x.id === id) || {}).name + ' background', 1200);
}

/* ------------------------------------------------------------------ sheets */
function openSheet(html) {
  closeSheet(); const root = $('#sheetRoot');
  root.innerHTML = `<div class="scrim"><div class="sheet-box ears"><div class="sheet" role="dialog" aria-modal="true">${html}</div></div></div>`;
  const scrim = root.firstChild; scrim.onclick = e => { if (e.target === scrim) closeSheet(); };
  scrim.querySelectorAll('[data-close]').forEach(b => b.onclick = closeSheet);
  return scrim.querySelector('.sheet');
}
function closeSheet() { $('#sheetRoot').innerHTML = ''; }
function confirmSheet(title, body, okLabel, fn) {
  const sh = openSheet(`<h2>${title}</h2><p class="hint">${body}</p><div class="actions"><button class="btn" data-close>Cancel</button><button class="btn primary" id="cfOk">${okLabel}</button></div>`);
  sh.querySelector('#cfOk').onclick = () => { closeSheet(); fn(); };
}
function openSound() {
  const p = S.proj;
  const sh = openSheet(`<h2>Sound</h2>
    <p class="hint">${p.hasAudio ? 'Plays with your animation and goes into exported videos.' : 'Add music, a voice line or sound effects. MP3, WAV, OGG and M4A work.'}</p>
    ${p.hasAudio ? `<div class="codebox"><code>${esc(p.audioName || 'sound')}${S.audio ? ' · ' + S.audio.duration.toFixed(1) + ' s' : ''}</code></div>
    <div class="row"><label for="sdOff">Starts at</label><input type="range" id="sdOff" min="0" max="${Math.max(1, Math.floor(S.audio ? S.audio.duration : 30))}" step="0.1" value="${p.audioOffset || 0}"><output id="sdOffO" class="mono">${(p.audioOffset || 0).toFixed(1)} s</output></div>` : ''}
    <div class="actions"><button class="btn" id="sdPick"><svg viewBox="0 0 24 24"><path d="M9 18V6l10-2v12"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="16.5" cy="16" r="2.5"/></svg>${p.hasAudio ? 'Replace sound' : 'Choose a sound file'}</button>
      ${p.hasAudio ? '<button class="btn danger" id="sdDel">Remove</button>' : ''}<span style="flex:1"></span><button class="btn primary" data-close>Done</button></div>`);
  sh.querySelector('#sdPick').onclick = () => { S.afterAudio = 'sound'; $('#fileAudio').click(); };
  const del = sh.querySelector('#sdDel'); if (del) del.onclick = async () => { await removeAudio(); renderSide(); openSound(); };
  const off = sh.querySelector('#sdOff'); if (off) { off.oninput = e => { p.audioOffset = +e.target.value; sh.querySelector('#sdOffO').textContent = p.audioOffset.toFixed(1) + ' s'; }; off.onchange = markMeta; }
}
function openSettings() {
  const p = S.proj;
  const sh = openSheet(`<h2>Animation settings</h2>
    <label class="field"><span>Name</span><input type="text" id="stName" maxlength="60" value="${esc(p.name)}"></label>
    <div class="field"><span>Speed</span><div class="seg" id="stFps">${[6, 8, 12, 15, 24, 30].map(f => `<button data-f="${f}" class="${f === p.fps ? 'on' : ''}">${f}</button>`).join('')}</div></div>
    <div class="field"><span>Paper colour</span><div class="row"><input type="color" id="stBg" value="${p.bg || '#ffffff'}" aria-label="Paper colour"><span class="hint">Shows under every frame.</span></div></div>
    <div class="field"><span>Background</span>
      <div class="scenes" id="stScenes">${window.OnionArt ? window.OnionArt.SCENES.map(sc => `<button data-sc="${sc.id}" class="${p.hasBg && p.bgScene === sc.id ? 'on' : ''}" title="${sc.name}"><canvas width="128" height="${Math.round(128 * p.h / p.w)}"></canvas><span>${sc.name}</span></button>`).join('') : ''}</div>
      <div class="row"><button class="btn" id="stBgImg"><svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-8 8"/></svg>${p.hasBg && !p.bgScene ? 'Replace your picture' : 'Use your own picture'}</button>${p.hasBg ? '<button class="btn danger" id="stBgDel">Remove background</button>' : ''}</div></div>
    <div class="field"><span>Sound</span><div class="row" style="flex-wrap:wrap">
      <button class="btn" id="stAudio">${p.hasAudio ? 'Replace sound' : 'Add sound'}</button>${p.hasAudio ? `<button class="btn danger" id="stAudioDel">Remove</button><span class="hint">${esc(p.audioName || '')}</span>` : ''}</div>
      ${p.hasAudio ? `<div class="row"><label for="stOff">Starts at</label><input type="range" id="stOff" min="0" max="${Math.max(1, Math.floor(S.audio ? S.audio.duration : 30))}" step="0.1" value="${p.audioOffset || 0}"><output id="stOffO" class="mono">${(p.audioOffset || 0).toFixed(1)} s</output></div>` : ''}</div>
    <label class="field"><span>Notes for Claude</span><textarea id="stNotes" maxlength="2000" placeholder="What is this animation for? e.g. “Use this run as the chase in the next film.”">${esc(p.notes || '')}</textarea></label>
    <div class="field"><span>Keep a copy</span><div class="row" style="flex-wrap:wrap"><button class="btn primary" id="stCopyFile"><svg viewBox="0 0 24 24"><path d="M12 4v11M7 10l5 5 5-5M5 20h14"/></svg>Save a copy (.onion)</button></div>
      <p class="hint">One file with every drawing, layer, sound and setting. Back it up, send it to yourself, or open it in ONION on ${ANDROID ? 'your PC or another device' : 'another computer, a tablet or an iPhone'} with Open saved.</p></div>
    <div class="field" ${ANDROID ? 'hidden' : ''}><span>Show Claude this animation</span><div class="codebox"><code id="stRef">Use my ONION animation “${esc(p.name)}” (Documents\\ONION\\Projects\\${p.id})</code><button class="btn" id="stCopy">Copy</button></div>
      <p class="hint">Paste this in the Claude desktop app. Claude opens the frames from your ONION folder.</p>
      <div class="row"><button class="btn" id="stFolder">Open this animation's folder</button></div></div>
    <p class="hint mono">${p.w}×${p.h} · ${p.frames.length} drawings · ${p.layers.length} layers</p>
    <div class="actions"><button class="btn danger" id="stDel">Delete animation</button><span style="flex:1"></span><button class="btn primary" id="stDone">Done</button></div>`);
  sh.querySelectorAll('#stFps button').forEach(b => b.onclick = () => { p.fps = +b.dataset.f; sh.querySelectorAll('#stFps button').forEach(x => x.classList.toggle('on', x === b)); markMeta(); updateBar(); });
  sh.querySelector('#stBg').oninput = e => { p.bg = e.target.value; rebuild(); };
  sh.querySelector('#stBg').onchange = () => { markMeta(); renderStrip(true); scheduleThumb(); };
  sh.querySelector('#stBgImg').onclick = () => $('#fileBg').click();
  sh.querySelectorAll('#stScenes button').forEach(b => {
    const cv = b.querySelector('canvas'), cx = cv.getContext('2d'); cx.scale(cv.width / p.w, cv.height / p.h); window.OnionArt.drawScene(b.dataset.sc, cx, p.w, p.h);
    b.onclick = () => applyScene(b.dataset.sc);
  });
  const bd = sh.querySelector('#stBgDel'); if (bd) bd.onclick = async () => { S.bgImg = null; p.hasBg = false; p.bgScene = ''; try { await S.store.saveCell(p.id, 'bg', 'bg', null, S.parts.get('bg~bg') || 1); } catch (e) {} S.saved.delete('bg~bg'); markMeta(); rebuild(); renderStrip(true); scheduleThumb(); openSettings(); };
  sh.querySelector('#stAudio').onclick = () => $('#fileAudio').click();
  const ad = sh.querySelector('#stAudioDel'); if (ad) ad.onclick = async () => { await removeAudio(); openSettings(); };
  const off = sh.querySelector('#stOff'); if (off) { off.oninput = e => { p.audioOffset = +e.target.value; sh.querySelector('#stOffO').textContent = p.audioOffset.toFixed(1) + ' s'; }; off.onchange = markMeta; }
  sh.querySelector('#stCopy').onclick = () => { const t = sh.querySelector('#stRef').textContent; navigator.clipboard.writeText(t).then(() => toast('Copied'), () => { const r = document.createRange(); r.selectNodeContents(sh.querySelector('#stRef')); getSelection().removeAllRanges(); getSelection().addRange(r); toast('Selected: press Copy on your keyboard'); }); };
  sh.querySelector('#stDel').onclick = () => confirmSheet('Delete animation?', `“${esc(p.name)}” and all its drawings ${BIN ? 'go to the ' + BIN : 'are deleted for good'}.`, 'Delete', async () => {
    const id = p.id; stop(); S.dirty.clear(); S.metaDirty = false; S.proj = null; $('#editor').hidden = true; $('#gallery').hidden = false;
    try { await S.store.deleteProject(id); toast(BIN ? 'Moved to the ' + BIN : 'Deleted'); } catch (e) { toast('Could not delete it. Try again.'); }
    S.projects = S.projects.filter(x => x.id !== id); renderGallery(); S.store.refresh();
  });
  const done = () => { const n = sh.querySelector('#stName').value.trim() || p.name; const notes = sh.querySelector('#stNotes').value; if (n !== p.name || notes !== (p.notes || '')) { p.name = n; p.notes = notes; markMeta(); } $('#pTitle').textContent = p.name; closeSheet(); };
  sh.querySelector('#stDone').onclick = done;
  sh.querySelector('#stFolder').onclick = () => window.fsApi.openFolder('project', p.id);
  sh.querySelector('#stCopyFile').onclick = () => saveCopy(p.id);
}
$('#settingsBtn').onclick = () => openSettings();
$('#fpsBtn').onclick = () => { const L = [6, 8, 12, 15, 24, 30]; S.proj.fps = L[(L.indexOf(S.proj.fps) + 1) % L.length] || 12; markMeta(); updateBar(); toast(S.proj.fps + ' frames per second'); };
$('#loopBtn').onclick = () => { S.proj.loop = S.proj.loop === false; markMeta(); updateBar(); };

/* ------------------------------------------------------------------ theatre (v1.6)
   Watch the animation on a little stage: velvet curtains open, it plays (with its sound), and at the end (or when you
   tap) the curtains close. A row of cat heads watches from the front. Curtains are drawn by stagekit.js. */
const TH = { on: false, p: 0, target: 0, raf: 0, last: 0, startT: 0, playing: false, frame: 0, ending: false, exitAfter: false,
  color: lsGet('curtainColor', 'red'), cw: 0, ch: 0, dpr: 1 };
const CURTAIN_NAMES = { red: 'Red velvet', purple: 'Purple velvet', midnight: 'Midnight blue' };
function swoosh(dur = 1.3) {
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)(); if (actx.state === 'suspended') actx.resume();
    const n = Math.round(actx.sampleRate * dur), buf = actx.createBuffer(1, n, actx.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.sin(Math.PI * i / n) ** 2;
    const src = actx.createBufferSource(), f = actx.createBiquadFilter(), g = actx.createGain();
    src.buffer = buf; f.type = 'bandpass'; f.Q.value = 0.8; f.frequency.setValueAtTime(500, actx.currentTime); f.frequency.linearRampToValueAtTime(1500, actx.currentTime + dur);
    g.gain.value = 0.16; src.connect(f).connect(g).connect(actx.destination); src.start();
  } catch (e) { /* no sound is fine */ }
}
function thLayout() {
  const c = $('#thCanvas'); TH.dpr = Math.min(2, window.devicePixelRatio || 1); TH.cw = window.innerWidth; TH.ch = window.innerHeight;
  c.width = Math.round(TH.cw * TH.dpr); c.height = Math.round(TH.ch * TH.dpr);
}
function openTheatre() {
  if (!S.proj || !window.OnionArt) return;
  stop(); TH.on = true; TH.p = 0; TH.target = 0; TH.playing = false; TH.frame = 0; TH.ending = false; TH.exitAfter = false;
  $('#theatre').hidden = false; $('#thColor').textContent = CURTAIN_NAMES[TH.color] || 'Red velvet'; thButtons(); thLayout();
  TH.last = performance.now(); cancelAnimationFrame(TH.raf); TH.raf = requestAnimationFrame(thTick);
  clearTimeout(TH.t); TH.t = setTimeout(() => { if (TH.on) thSet(true); }, 650);
}
function thButtons() { $('#thCurt').innerHTML = (TH.target ? 'Close' : 'Open') + ' the curtains'; }
function thSet(open) {
  if (open && TH.target === 1) return; if (!open && TH.target === 0) return;
  TH.target = open ? 1 : 0; swoosh(); thButtons();
  if (open) { TH.startT = performance.now(); TH.playing = true; TH.ending = false; startAudio(0); }
}
function closeTheatre() {
  TH.on = false; cancelAnimationFrame(TH.raf); clearTimeout(TH.t); stopAudio(); $('#theatre').hidden = true;
}
function thLeave() { if (TH.p > 0.02) { TH.exitAfter = true; thSet(false); } else closeTheatre(); }
function catAudience(ctx, w, h) {
  const n = Math.max(5, Math.round(w / 150)), r = Math.min(64, w / n * 0.42);
  for (let i = 0; i < n; i++) {
    const x = (i + 0.5) / n * w + Math.sin(i * 2.3) * r * 0.3, y = h - r * 0.55 + Math.sin(i * 1.7) * r * 0.12, s = r * (0.9 + 0.15 * Math.sin(i * 3.1));
    ctx.fillStyle = '#05020a';
    ctx.beginPath(); ctx.ellipse(x, y, s, s * 0.88, 0, 0, Math.PI * 2); ctx.fill();
    for (const side of [-1, 1]) { ctx.beginPath(); ctx.moveTo(x + side * s * 0.92, y - s * 0.2); ctx.lineTo(x + side * s * 0.78, y - s * 1.25); ctx.lineTo(x + side * s * 0.22, y - s * 0.8); ctx.closePath(); ctx.fill(); }
  }
}
function thTick(now) {
  if (!TH.on) return;
  const dt = Math.min(0.1, (now - TH.last) / 1000); TH.last = now;
  const sp = 1 / 1.6;
  if (TH.p < TH.target) TH.p = Math.min(TH.target, TH.p + dt * sp); else if (TH.p > TH.target) TH.p = Math.max(TH.target, TH.p - dt * sp * 1.15);
  if (TH.p === 0 && TH.target === 0 && TH.playing) { TH.playing = false; stopAudio(); }
  if (TH.p === 0 && TH.target === 0 && TH.exitAfter) { closeTheatre(); return; }
  if (TH.playing) {
    const L = seqLen(); let n = Math.floor((now - TH.startT) / 1000 * S.proj.fps);
    if (n >= L) {
      if (S.proj.loop !== false) { TH.startT = now; n = 0; startAudio(0); }
      else { n = L - 1; if (!TH.ending) { TH.ending = true; thSet(false); } }
    }
    TH.frame = seqIndex(n);
  }
  const c = $('#thCanvas'), ctx = c.getContext('2d'), w = TH.cw, h = TH.ch;
  ctx.setTransform(TH.dpr, 0, 0, TH.dpr, 0, 0);
  const bg = ctx.createRadialGradient(w / 2, h * 0.42, 40, w / 2, h * 0.42, Math.max(w, h) * 0.75);
  bg.addColorStop(0, '#2a1438'); bg.addColorStop(1, '#07030c'); ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);
  const availW = w - 80, availH = h - 190, s2 = Math.min(availW / W(), availH / H());
  const rw = W() * s2, rh = H() * s2, rx = (w - rw) / 2, ry = 34 + (availH - rh) / 2;
  // stage apron under the picture
  ctx.fillStyle = '#5a3420'; ctx.beginPath(); ctx.moveTo(rx - rw * 0.06, ry + rh); ctx.lineTo(rx + rw * 1.06, ry + rh); ctx.lineTo(rx + rw * 1.12, ry + rh + 26); ctx.lineTo(rx - rw * 0.12, ry + rh + 26); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#e0a92e'; ctx.fillRect(rx - rw * 0.12, ry + rh + 24, rw * 1.24, 5);
  ctx.save(); ctx.beginPath(); ctx.rect(rx, ry, rw, rh); ctx.clip(); ctx.translate(rx, ry); ctx.imageSmoothingQuality = 'high';
  composite(ctx, TH.frame, s2);
  ctx.restore();
  // curtains hang a little wider and higher than the picture
  const ex = rw * 0.04, ey = rh * 0.07;
  ctx.save(); ctx.beginPath(); ctx.rect(rx - ex, ry - ey, rw + ex * 2, rh + ey + 2); ctx.clip(); ctx.translate(rx - ex, ry - ey);
  window.OnionArt.drawCurtains(ctx, rw + ex * 2, rh + ey + 2, TH.p, { color: TH.color, t: now / 1000 });
  ctx.restore();
  // spotlight glow when open, and the cat audience in front
  if (TH.p > 0.5) { const g = ctx.createRadialGradient(w / 2, ry + rh, 10, w / 2, ry + rh, rw * 0.6); g.addColorStop(0, `rgba(255,230,170,${0.12 * (TH.p - 0.5) * 2})`); g.addColorStop(1, 'rgba(255,230,170,0)'); ctx.fillStyle = g; ctx.fillRect(0, 0, w, h); }
  catAudience(ctx, w, h - 64);
  TH.raf = requestAnimationFrame(thTick);
}
$('#theatreBtn').onclick = openTheatre;
$('#thCurt').onclick = () => thSet(!TH.target);
$('#thReplay').onclick = () => { if (TH.target) { TH.startT = performance.now(); TH.ending = false; startAudio(0); } else thSet(true); };
$('#thColor').onclick = () => { const L = Object.keys(CURTAIN_NAMES); TH.color = L[(L.indexOf(TH.color) + 1) % L.length]; lsSet('curtainColor', TH.color); $('#thColor').textContent = CURTAIN_NAMES[TH.color]; };
$('#thExit').onclick = thLeave;
$('#thCanvas').onclick = () => thSet(!TH.target);
window.addEventListener('resize', () => { if (TH.on) thLayout(); if (CO.on) coLayout(); });
document.addEventListener('keydown', e => {
  if (!TH.on) return;
  if (e.key === 'Escape') { e.preventDefault(); thLeave(); } else if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); thSet(!TH.target); }
}, true);

/* ------------------------------------------------------------------ the big curtain over the whole app (v1.6)
   It opens when ONION starts (can be turned off in Customize), and the curtain button on the home screen closes it to
   hide the screen; tap it to open again. */
const CO = { on: false, p: 1, target: 1, raf: 0, last: 0, dpr: 1, w: 0, h: 0 };
function coLayout() { const c = $('#coCanvas'); CO.dpr = Math.min(2, window.devicePixelRatio || 1); CO.w = window.innerWidth; CO.h = window.innerHeight; c.width = Math.round(CO.w * CO.dpr); c.height = Math.round(CO.h * CO.dpr); }
function coRun() {
  cancelAnimationFrame(CO.raf); CO.last = performance.now();
  const tick = now => {
    const dt = Math.min(0.1, (now - CO.last) / 1000); CO.last = now;
    if (CO.p < CO.target) CO.p = Math.min(CO.target, CO.p + dt / 1.5); else if (CO.p > CO.target) CO.p = Math.max(CO.target, CO.p - dt / 1.3);
    const ctx = $('#coCanvas').getContext('2d'); ctx.setTransform(CO.dpr, 0, 0, CO.dpr, 0, 0); ctx.clearRect(0, 0, CO.w, CO.h);
    window.OnionArt.drawCurtains(ctx, CO.w, CO.h, CO.p, { color: TH.color, t: now / 1000 });
    $('#coPlaque').classList.toggle('show', CO.p < 0.04 && CO.target === 0);
    if (CO.p >= 1 && CO.target === 1) { CO.on = false; $('#curtainOv').hidden = true; return; }
    CO.raf = requestAnimationFrame(tick);
  };
  CO.raf = requestAnimationFrame(tick);
}
function curtainsClose() {
  if (!window.OnionArt) return; CO.on = true; $('#curtainOv').hidden = false; coLayout(); CO.target = 0; if (CO.p <= 0) CO.p = 1; swoosh(1.1); coRun();
}
function curtainsOpen(quiet) { if (!CO.on) return; CO.target = 1; if (!quiet) swoosh(); coRun(); }
function curtainIntro() {
  if (!window.OnionArt || !lsGet('curtainIntro', true) || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  CO.on = true; CO.p = 0; CO.target = 0; $('#curtainOv').hidden = false; coLayout(); $('#coPlaque').classList.add('show', 'intro'); coRun();
  setTimeout(() => { $('#coPlaque').classList.remove('intro'); curtainsOpen(true); }, 900);
}
$('#curtainOv').onclick = () => { if (CO.target === 0) curtainsOpen(); };
$('#curtainBtn').onclick = curtainsClose;
document.addEventListener('keydown', e => { if (CO.on && CO.target === 0 && (e.key === 'Enter' || e.key === ' ' || e.key === 'Escape')) { e.preventDefault(); e.stopPropagation(); curtainsOpen(); } }, true);

/* ------------------------------------------------------------------ export */
function safeName() { return (S.proj.name || 'animation').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '_') || 'animation'; }
/* ------------------------------------------------------------------ export
   Studied from FlipaClip, CapCut, Procreate Dreams and Animation Desk: pick a format, then size, frame rate, quality,
   sound and loop; the app draws every frame and an encoder (ffmpeg) builds the file; a progress bar, then a finished
   screen with Open / Show in folder / Export another. Files land in Videos\ONION or Pictures\ONION. */
const EX_FORMATS = [
  { id: 'mp4', name: 'Video', sub: 'MP4 · sound', tone: 'var(--pumpkin)', icon: '<rect x="3" y="5" width="14" height="14" rx="3"/><path d="M17 10l4-3v10l-4-3"/>' },
  { id: 'gif', name: 'GIF', sub: 'Loops anywhere', tone: 'var(--slime)', icon: '<path d="M20 12a8 8 0 1 1-2.4-5.7"/><path d="M20 4v4h-4"/>' },
  { id: 'png', name: 'Frames', sub: 'PNG sequence', tone: 'var(--ghost)', icon: '<rect x="3" y="8" width="13" height="12" rx="2"/><path d="M7 8V5h14v12h-5"/>' },
  { id: 'pic', name: 'Picture', sub: 'This frame', tone: 'var(--sky)', icon: '<rect x="3" y="5" width="18" height="14" rx="3"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-8 8"/>' },
];
const EX_RES = [['orig', 'Original'], [720, '720p'], [1080, '1080p'], [1440, '1440p'], [2160, '4K']];
const EX_Q = { std: ['Standard', 23], high: ['High', 18], best: ['Best', 14] };
let EX = Object.assign({ fmt: 'mp4', res: 1080, fps: 0, q: 'high', sound: true, pingpong: false, loop: true, transparent: false, curtains: false }, lsGet('export', {}));
function exSize() {
  if (EX.res === 'orig' || EX.fmt === 'gif' && EX.res > 1080) { const k = EX.fmt === 'gif' && EX.res !== 'orig' ? Math.min(1, 1080 / Math.min(W(), H())) : 1; return [Math.round(W() * k / 2) * 2, Math.round(H() * k / 2) * 2]; }
  const k = EX.res / Math.min(W(), H()); return [Math.round(W() * k / 2) * 2, Math.round(H() * k / 2) * 2];
}
function exOrder() {
  const seq = S.proj.frames.map((f, i) => ({ i, hold: f.hold || 1 }));
  if (EX.pingpong && seq.length > 2) for (let j = seq.length - 2; j >= 1; j--) seq.push({ ...seq[j] });
  return seq;
}
function exFps() { return EX.fps || S.proj.fps; }
function exSeconds() { return exOrder().reduce((s, x) => s + x.hold, 0) / S.proj.fps; }
function exEstimate() {
  const [w, h] = exSize(), px = w * h, secs = exSeconds(), n = exOrder().reduce((s, x) => s + x.hold, 0);
  if (EX.fmt === 'mp4') { const bpp = { std: 0.035, high: 0.07, best: 0.13 }[EX.q]; return px * exFps() * bpp * secs / 8 / 1e6 + (EX.sound && S.proj.hasAudio ? secs * 0.024 : 0); }
  if (EX.fmt === 'gif') return px * Math.round(secs * exFps()) * 0.09 / 1e6;
  if (EX.fmt === 'png') return px * n * 0.12 / 1e6;
  return px * 0.25 / 1e6;
}
function openExport() {
  stop();
  const sh = openSheet('<div id="exBody"></div>'); sh.style.width = 'min(640px, calc(100vw - 36px))';
  renderExport(sh);
}
function renderExport(sh) {
  const f = EX_FORMATS.find(x => x.id === EX.fmt) || EX_FORMATS[0];
  const [w, h] = exSize(), mb = exEstimate(), secs = exSeconds();
  const resRow = EX.fmt === 'pic' || EX.fmt === 'png' || EX.fmt === 'mp4' || EX.fmt === 'gif'
    ? `<label class="field"><span>Size</span><select id="exRes">${EX_RES.filter(r => !(EX.fmt === 'gif' && r[0] !== 'orig' && r[0] > 1080)).map(r => `<option value="${r[0]}" ${String(EX.res) === String(r[0]) ? 'selected' : ''}>${r[1]}${r[0] === 'orig' ? ` (${W()}×${H()})` : ''}</option>`).join('')}</select></label>` : '';
  const fpsRow = EX.fmt === 'mp4' || EX.fmt === 'gif'
    ? `<label class="field"><span>Frame rate</span><select id="exFps"><option value="0" ${!EX.fps ? 'selected' : ''}>Same as animation (${S.proj.fps} fps)</option>${[24, 30, 60].filter(x => x !== S.proj.fps).map(x => `<option value="${x}" ${EX.fps === x ? 'selected' : ''}>${x} fps</option>`).join('')}</select></label>` : '';
  const qRow = EX.fmt === 'mp4' ? `<label class="field"><span>Quality</span><select id="exQ">${Object.entries(EX_Q).map(([k, v]) => `<option value="${k}" ${EX.q === k ? 'selected' : ''}>${v[0]}</option>`).join('')}</select></label>` : '';
  const checks = [];
  if (EX.fmt === 'mp4') checks.push(`<label class="check"><input type="checkbox" id="exSound" ${EX.sound && S.proj.hasAudio ? 'checked' : ''} ${S.proj.hasAudio ? '' : 'disabled'}> Include sound${S.proj.hasAudio ? '' : ' (no sound added)'}</label>`);
  if (EX.fmt === 'gif') checks.push(`<label class="check"><input type="checkbox" id="exLoop" ${EX.loop ? 'checked' : ''}> Loop forever</label>`);
  if (EX.fmt === 'png' || EX.fmt === 'pic') checks.push(`<label class="check"><input type="checkbox" id="exTrans" ${EX.transparent ? 'checked' : ''}> Transparent background</label>`);
  if (EX.fmt !== 'pic') checks.push(`<label class="check"><input type="checkbox" id="exPing" ${EX.pingpong ? 'checked' : ''}> Ping-pong (play forward, then back)</label>`);
  if ((EX.fmt === 'mp4' || EX.fmt === 'gif') && window.OnionArt) checks.push(`<label class="check"><input type="checkbox" id="exCurt" ${EX.curtains ? 'checked' : ''}> Theatre curtains (they open at the start and close at the end)</label>`);
  sh.querySelector('#exBody').outerHTML = `<div id="exBody" style="display:flex;flex-direction:column;gap:16px">
    <h2>Export</h2>
    <div class="fmt">${EX_FORMATS.map(x => `<button data-f="${x.id}" class="${x.id === EX.fmt ? 'on' : ''}" style="--tone:${x.tone}"><svg viewBox="0 0 24 24">${x.icon}</svg>${x.name}<small>${x.sub}</small></button>`).join('')}</div>
    <div class="opts">${resRow}${fpsRow}${qRow}</div>
    ${checks.length ? `<div style="display:flex;flex-direction:column;gap:8px">${checks.join('')}</div>` : ''}
    <div class="summary"><span class="chip mono">${w}×${h}</span>${EX.fmt === 'pic' ? `<span class="chip mono">frame ${S.cur + 1}</span>` : `<span class="chip mono">${secs.toFixed(1)} s</span><span class="chip mono">${exOrder().length} drawings</span>`}<span class="chip mono">about ${mb < 1 ? mb.toFixed(1) : Math.round(mb)} MB</span></div>
    <p class="hint">${IOS ? 'Kept in ONION on this ' + DEVICE + '. Tap Share when it is done to save it to Photos or Files.' : ANDROID ? (EX.fmt === 'mp4' ? 'Saved to your Gallery, in Movies/ONION.' : 'Saved to your Gallery, in Pictures/ONION.') : EX.fmt === 'mp4' || EX.fmt === 'gif' ? 'Saved to Videos\\ONION.' : 'Saved to Pictures\\ONION.'}</p>
    <div class="actions"><button class="btn" data-close>Cancel</button><button class="btn primary" id="exGo"><svg viewBox="0 0 24 24"><path d="M12 4v11M7 10l5 5 5-5M5 20h14"/></svg>Export ${f.name.toLowerCase()}</button></div></div>`;
  const save = () => { lsSet('export', EX); renderExport(sh); };
  sh.querySelectorAll('.fmt button').forEach(b => b.onclick = () => { EX.fmt = b.dataset.f; if (EX.fmt === 'gif' && EX.res !== 'orig' && EX.res > 1080) EX.res = 720; save(); });
  const on = (id, fn) => { const el = sh.querySelector(id); if (el) el.onchange = e => { fn(e.target); save(); }; };
  on('#exRes', t => EX.res = t.value === 'orig' ? 'orig' : +t.value);
  on('#exFps', t => EX.fps = +t.value);
  on('#exQ', t => EX.q = t.value);
  on('#exSound', t => EX.sound = t.checked);
  on('#exLoop', t => EX.loop = t.checked);
  on('#exTrans', t => EX.transparent = t.checked);
  on('#exPing', t => EX.pingpong = t.checked);
  on('#exCurt', t => EX.curtains = t.checked);
  sh.querySelectorAll('[data-close]').forEach(b => b.onclick = closeSheet);
  sh.querySelector('#exGo').onclick = () => runExport(sh);
}
function frameCanvas(i, w, h, transparent) {
  const c = mk(w, h), cx = c.getContext('2d'); cx.imageSmoothingQuality = 'high';
  composite(cx, i, w / W(), { noBg: !!transparent }); return c;
}
const pngBuf = c => new Promise(r => c.toBlob(b => b.arrayBuffer().then(r), 'image/png'));
let exJob = null;
async function runExport(sh) {
  await flushSaves(true);
  const body = sh.querySelector('#exBody');
  body.innerHTML = `<h2>Exporting…</h2>
    <div class="done-art"><div class="cat-mascot hop">${catSvg('catClipHop')}</div></div>
    <div class="progress"><i id="exBar"></i></div><p class="hint" id="exMsg">Getting ready…</p>
    <div class="actions"><button class="btn" id="exCancel">Cancel</button></div>`;
  const bar = body.querySelector('#exBar'), msg = body.querySelector('#exMsg');
  let cancelled = false;
  body.querySelector('#exCancel').onclick = async () => { cancelled = true; if (exJob) await window.fsApi.exportCancel(exJob); exJob = null; renderExportBody(sh); };
  const [w, h] = exSize(); const name = safeName().replace(/_/g, ' ');
  try {
    let res;
    if (EX.fmt === 'pic') {
      msg.textContent = 'Drawing the picture…';
      res = await window.fsApi.exportFiles('picture', `${name} frame ${S.cur + 1}`, [{ name: 'frame.png', data: await pngBuf(frameCanvas(S.cur, w, h, EX.transparent)) }]);
    } else if (EX.fmt === 'png') {
      const seq = exOrder(), files = [], cache = new Map(); let n = 0; const total = seq.reduce((s, x) => s + x.hold, 0);
      for (const it of seq) {
        if (cancelled) return;
        if (!cache.has(it.i)) cache.set(it.i, await pngBuf(frameCanvas(it.i, w, h, EX.transparent)));
        for (let k = 0; k < it.hold; k++) { n++; files.push({ name: `frame_${String(n).padStart(4, '0')}.png`, data: cache.get(it.i) }); }
        bar.style.width = (n / total * 90) + '%'; msg.textContent = `Drawing frame ${n} of ${total}`;
      }
      files.push({ name: 'timing.json', data: JSON.stringify({ name: S.proj.name, fps: S.proj.fps, width: w, height: h, pingpong: EX.pingpong,
        frames: seq.map(x => ({ drawing: x.i + 1, hold: x.hold })) }, null, 2) });
      msg.textContent = 'Writing files…';
      res = await window.fsApi.exportFiles('frames', `${name} frames`, files);
    } else {
      exJob = await window.fsApi.exportBegin();
      const plan = EX.curtains && window.OnionArt ? curtainPlan(exOrder(), !(EX.fmt === 'mp4' && EX.sound && S.proj.hasAudio)) : null;
      const used = [...new Set((plan ? plan.entries : exOrder()).map(x => x.i).filter(i => i < 90000))];
      const todo = used.length + (plan ? plan.extra.length : 0);
      for (let k = 0; k < used.length; k++) {
        if (cancelled) return;
        await window.fsApi.exportFrame(exJob, used[k], await pngBuf(frameCanvas(used[k], W(), H(), false)));
        bar.style.width = ((k + 1) / todo * 35) + '%'; msg.textContent = `Drawing ${k + 1} of ${todo}`;
      }
      if (plan) for (let k = 0; k < plan.extra.length; k++) {
        if (cancelled) return;
        const x = plan.extra[k], c = frameCanvas(x.i, W(), H(), false);
        window.OnionArt.drawCurtains(c.getContext('2d'), W(), H(), x.k, { color: TH.color });
        await window.fsApi.exportFrame(exJob, x.idx, await pngBuf(c));
        bar.style.width = ((used.length + k + 1) / todo * 35) + '%'; msg.textContent = `Drawing ${used.length + k + 1} of ${todo}`;
      }
      msg.textContent = EX.fmt === 'gif' ? 'Making the GIF…' : 'Encoding the video…';
      const job = exJob;
      window.fsApi.onExportProgress((id, pct) => { if (id === job) { bar.style.width = (35 + pct * 65) + '%'; msg.textContent = `${EX.fmt === 'gif' ? 'Making the GIF' : 'Encoding'} ${Math.round(pct * 100)}%`; } });
      res = await window.fsApi.exportFinish(job, { format: EX.fmt, name, width: w, height: h, fps: exFps(), crf: EX_Q[EX.q][1],
        entries: plan ? plan.entries : exOrder().map(x => ({ i: x.i, dur: x.hold / S.proj.fps })), audio: EX.sound && !!S.proj.hasAudio, audioOffset: S.proj.audioOffset || 0,
        projectId: S.proj.id, loop: EX.loop });
      exJob = null;
    }
    if (cancelled) return;
    exportDone(sh, res);
  } catch (e) {
    exJob = null; if (cancelled || /cancelled/.test(String(e && e.message))) return;
    console.warn(e);
    body.innerHTML = `<h2>Export stopped</h2><p class="hint">${esc(String(e && e.message || e)).slice(0, 300)}</p>
      <div class="actions"><button class="btn" data-close>Close</button><button class="btn primary" id="exAgain">Try again</button></div>`;
    body.querySelector('[data-close]').onclick = closeSheet; body.querySelector('#exAgain').onclick = () => renderExportBody(sh);
  }
}
/* theatre curtains in an export: they open over the first moments of the animation and close over the last ones, so the
   video keeps its length and its sound stays in sync. Curtain frames get indices from 90000 up. */
function curtainPlan(order, ownTime) {
  const F = S.proj.fps, step = 1 / 15;
  if (ownTime) {   // no sound to keep in sync: the curtains get their own 1.6 s at each end, over the first and last drawings
    const entries = [], extra = [], N = Math.round(1.6 / step), first = order[0].i, last = order[order.length - 1].i;
    const add = (i, k) => { const idx = 90000 + extra.length; extra.push({ idx, i, k }); entries.push({ i: idx, dur: step }); };
    for (let n = 0; n < N; n++) add(first, clamp((n / N - 0.15) / 0.85, 0, 1));
    for (const x of order) entries.push({ i: x.i, dur: x.hold / F });
    for (let n = 1; n <= N; n++) add(last, clamp(((N - n) / N - 0.15) / 0.85, 0, 1));
    return { entries, extra };
  }
  const total = order.reduce((s, x) => s + x.hold, 0) / F, win = Math.min(1.5, total * 0.42);
  const kAt = t => t < win ? clamp((t / win - 0.12) / 0.88, 0, 1) : t > total - win ? clamp(((total - t) / win - 0.12) / 0.88, 0, 1) : 1;
  const cuts = new Set([0, total]); let t = 0;
  for (const x of order) { cuts.add(+t.toFixed(6)); t += x.hold / F; }
  for (let c = 0; c < win; c += step) { cuts.add(+c.toFixed(6)); cuts.add(+(total - c).toFixed(6)); }
  const times = [...cuts].filter(c => c >= 0 && c <= total).sort((a, b) => a - b);
  const startT = []; t = 0; for (const x of order) { startT.push(t); t += x.hold / F; }
  const drawingAt = tt => { let j = 0; while (j + 1 < order.length && startT[j + 1] <= tt + 1e-9) j++; return order[j].i; };
  const entries = [], extra = [];
  for (let n = 0; n + 1 < times.length; n++) {
    const a = times[n], b = times[n + 1], dur = b - a; if (dur < 1e-6) continue;
    const i = drawingAt(a), k = kAt((a + b) / 2);
    if (k >= 1) { const last = entries[entries.length - 1]; if (last && last.i === i && !last.c) last.dur += dur; else entries.push({ i, dur }); }
    else { const idx = 90000 + extra.length; extra.push({ idx, i, k }); entries.push({ i: idx, dur, c: true }); }
  }
  return { entries: entries.map(e => ({ i: e.i, dur: e.dur })), extra };
}
function renderExportBody(sh) { const b = sh.querySelector('#exBody'); if (b) { b.innerHTML = ''; renderExport(sh); } }
function exportDone(sh, res) {
  const body = sh.querySelector('#exBody'); const isVideo = /\.mp4$/i.test(res.path), isGif = /\.gif$/i.test(res.path);
  const mb = res.size ? (res.size / 1e6).toFixed(1) + ' MB' : '';
  body.innerHTML = `<h2>Done!</h2>
    <div class="done-art"><svg viewBox="0 0 100 92" width="104" height="96" aria-hidden="true">
      <path d="M14 40 L20 8 L40 26 Q50 23 60 26 L80 8 L86 40 Q92 52 88 64 Q80 88 50 88 Q20 88 12 64 Q8 52 14 40Z" fill="var(--ink)" transform="translate(0 4)"/>
      <path d="M14 40 L20 8 L40 26 Q50 23 60 26 L80 8 L86 40 Q92 52 88 64 Q80 88 50 88 Q20 88 12 64 Q8 52 14 40Z" fill="var(--slime)" stroke="var(--ink)" stroke-width="4" stroke-linejoin="round"/>
      <path d="M23 17 L26 33 L36 27Z M77 17 L74 33 L64 27Z" fill="var(--pink)"/>
      <path d="M30 52 Q36 44 42 52 M58 52 Q64 44 70 52" fill="none" stroke="var(--ink)" stroke-width="4.5" stroke-linecap="round"/>
      <path d="M42 64 Q46 70 50 64 Q54 70 58 64" fill="none" stroke="var(--ink)" stroke-width="4" stroke-linecap="round"/>
      <path d="M8 58 L24 60 M8 68 L24 66 M92 58 L76 60 M92 68 L76 66" stroke="var(--ink)" stroke-width="3" stroke-linecap="round"/></svg></div>
    <div class="codebox"><code>${esc(res.path)}</code></div>${mb ? `<p class="hint">${mb}</p>` : ''}
    <div class="actions" style="justify-content:flex-start">
      <button class="btn primary" id="dnOpen">${isVideo ? 'Play it' : isGif ? 'Open the GIF' : 'Open'}</button>
      ${ANDROID ? (window.fsApi.share ? '<button class="btn" id="dnShare">Share</button>' : '') : '<button class="btn" id="dnShow">Show in folder</button>'}
      ${isVideo ? '<button class="btn" id="dnFilms">Add to Films shelf</button>' : ''}
      <span style="flex:1"></span><button class="btn" id="dnMore">Export another</button><button class="btn" data-close>Close</button></div>`;
  body.querySelector('#dnOpen').onclick = () => window.fsApi.openPath(res.path);
  const ds = body.querySelector('#dnShow'); if (ds) ds.onclick = () => window.fsApi.showItem(res.path);
  const dsh = body.querySelector('#dnShare'); if (dsh) dsh.onclick = () => window.fsApi.share(res.path);
  const fl = body.querySelector('#dnFilms'); if (fl) fl.onclick = async () => { const p = await window.fsApi.addToFilms(res.path, S.proj.name); if (p) { toast('Added to Films from Claude shelf'); fl.disabled = true; } };
  body.querySelector('#dnMore').onclick = () => renderExportBody(sh);
  body.querySelector('[data-close]').onclick = closeSheet;
  toast('Exported', 1500);
  appNote('Export finished', `“${S.proj ? S.proj.name : 'Animation'}” saved as ${res.path.split(/[\\/]/).pop()}`, { banner: false });
}
$('#exportBtn').onclick = openExport;

/* ------------------------------------------------------------------ wiring */
$('#backBtn').onclick = closeProject;
$('#newBtn').onclick = () => newProjectSheet(); $('#newBtn2').onclick = () => newProjectSheet();
$('#undoBtn').onclick = undo; $('#redoBtn').onclick = redo;
$('#prevBtn').onclick = () => goFrame(S.cur - 1); $('#nextBtn').onclick = () => goFrame(S.cur + 1);
$('#playBtn').onclick = play;
$('#fAdd').onclick = () => addFrame(S.cur, false); $('#fDup').onclick = () => addFrame(S.cur, true);
$('#fDel').onclick = delFrame; $('#fLeft').onclick = () => moveFrame(-1); $('#fRight').onclick = () => moveFrame(1); $('#fHold').onclick = cycleHold;
const KEYS = { p: 'pen', b: 'pen', e: 'eraser', g: 'fill', l: 'line', r: 'rect', o: 'ellipse', i: 'pick', v: 'move', h: 'hand' };
document.addEventListener('keydown', e => {
  if (!S.proj || $('#editor').hidden || e.target.closest('input, textarea, select') || $('#sheetRoot').firstChild) return;
  const k = e.key.toLowerCase();
  if ((e.ctrlKey || e.metaKey) && k === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
  if ((e.ctrlKey || e.metaKey) && k === 'y') { e.preventDefault(); redo(); return; }
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (k === ' ') { e.preventDefault(); if (!spaceDown) { spaceDown = true; stage.style.cursor = 'grab'; } return; }
  if (k === 'enter') { e.preventDefault(); play(); return; }
  if (k === ',' || k === 'arrowleft') { e.preventDefault(); goFrame(S.cur - 1); return; }
  if (k === '.' || k === 'arrowright') { e.preventDefault(); goFrame(S.cur + 1); return; }
  if (k === '[') { S.size = Math.max(1, Math.round(S.size) - 2); saveSettings(); syncSliders(); return; }
  if (k === ']') { S.size = Math.min(120, Math.round(S.size) + 2); saveSettings(); syncSliders(); return; }
  if (k === 'm') { setBrush('felt'); return; }
  if (k === 'n') { addFrame(S.cur, false); return; }
  if (k === 't') { openTheatre(); return; }
  if (KEYS[k]) setTool(KEYS[k]);
});
document.addEventListener('keyup', e => { if (e.key === ' ') { spaceDown = false; setTool(S.tool); } });
new ResizeObserver(() => { if (S.proj) layout(); }).observe($('#stageWrap'));
window.addEventListener('pagehide', () => { if (S.proj) flushSaves(true); });
document.addEventListener('visibilitychange', () => { if (document.hidden && S.proj) flushSaves(true); });

/* ------------------------------------------------------------------ boot */
async function loadFilms() {
  let films = [];
  try { films = await window.fsApi.films(); } catch (e) { console.warn(e); }
  const list = $('#fList'); list.innerHTML = ''; $('#fEmpty').hidden = films.length > 0;
  for (const f of films) {
    const b = document.createElement('button'); b.className = 'card ears';
    const mb = (f.size / 1e6).toFixed(0), when = new Date(f.mtime).toLocaleDateString();
    b.innerHTML = `<div class="thumb">${f.thumb ? `<img alt="" src="${f.thumb}">` : ''}<span class="play-badge"><svg viewBox="0 0 24 24"><path d="M7 5l12 7-12 7z"/></svg></span><div class="film"></div></div>
      <div class="meta"><b>${esc(f.title)}</b><span class="mono">${when} · ${mb} MB</span></div>`;
    b.onclick = () => playFilm(f); list.appendChild(b);
  }
}
function playFilm(f) {
  const sh = openSheet(`<h2>${esc(f.title)}</h2><video class="player" controls autoplay src="${f.url}"></video>${f.note ? `<p class="hint">${esc(f.note)}</p>` : ''}
    <div class="actions"><button class="btn" id="flShow">${IOS ? 'Share' : 'Show in folder'}</button><span style="flex:1"></span><button class="btn primary" data-close>Close</button></div>`);
  sh.style.width = 'min(980px, calc(100vw - 36px))';
  sh.querySelector('#flShow').onclick = () => window.fsApi.showFile(f.file);
  const v = sh.querySelector('video'); sh.querySelectorAll('[data-close]').forEach(x => x.addEventListener('click', () => v.pause()));
}
/* ------------------------------------------------------------------ the animated wordmark: tap it and the cats hop */
(() => {
  const wm = $('#wordmark'); if (!wm) return;
  wm.addEventListener('click', () => {
    wm.classList.remove('wm-hop'); void wm.offsetWidth; wm.classList.add('wm-hop');
    clearTimeout(wm._t); wm._t = setTimeout(() => wm.classList.remove('wm-hop'), 1300);
    const w = wm.getBoundingClientRect().width, cols = ['var(--pink)', 'var(--lilac)', 'var(--slime)', 'var(--candle)'];
    for (let i = 0; i < 10; i++) {
      const s = document.createElement('i'); s.className = 'wm-pop';
      s.style.setProperty('--shape', i % 3 ? 'var(--heart)' : 'var(--paw)'); s.style.setProperty('--c', cols[i % 4]);
      s.style.left = (Math.random() * (w - 20)) + 'px'; s.style.setProperty('--dx', (Math.random() * 90 - 45) + 'px'); s.style.setProperty('--r', (Math.random() * 70 - 35) + 'deg');
      s.style.animationDelay = (i * 0.045) + 's'; wm.appendChild(s); setTimeout(() => s.remove(), 1700);
    }
  });
})();

/* ------------------------------------------------------------------ saving
   Autosave runs all the time (900 ms after a change, and when the window hides). The Save button saves now.
   Save a copy packs an animation into one .onion file (a plain zip of its folder: project.json, cells/<frame>_<layer>.png,
   background.jpg, audio.<ext>, thumb.jpg) to back it up or move it between the PC and a tablet; Open saved brings one in. */
async function saveNow() {
  if (!S.proj) return;
  await flushSaves(true);
  const b = $('#saveBtn'); b.classList.remove('saved'); void b.offsetWidth; b.classList.add('saved');
  toast(S.dirty.size || S.metaDirty ? 'Not saved yet: trying again' : 'Saved', 1300);
}
$('#saveBtn').onclick = saveNow; $('#savePill').onclick = saveNow;
const CRC_T = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(u8) { let c = 0xFFFFFFFF; for (let i = 0; i < u8.length; i++) c = CRC_T[(c ^ u8[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
function zipStore(files) {
  const enc = new TextEncoder(), parts = [], central = []; let off = 0;
  const dt = new Date(), tm = (dt.getHours() << 11) | (dt.getMinutes() << 5) | (dt.getSeconds() >> 1), dd = ((dt.getFullYear() - 1980) << 9) | ((dt.getMonth() + 1) << 5) | dt.getDate();
  for (const f of files) {
    const name = enc.encode(f.name), data = f.data, crc = crc32(data);
    const h = new DataView(new ArrayBuffer(30));
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(10, tm, true); h.setUint16(12, dd, true);
    h.setUint32(14, crc, true); h.setUint32(18, data.length, true); h.setUint32(22, data.length, true); h.setUint16(26, name.length, true);
    parts.push(new Uint8Array(h.buffer), name, data);
    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(12, tm, true); c.setUint16(14, dd, true);
    c.setUint32(16, crc, true); c.setUint32(20, data.length, true); c.setUint32(24, data.length, true); c.setUint16(28, name.length, true); c.setUint32(42, off, true);
    central.push(new Uint8Array(c.buffer), name); off += 30 + name.length + data.length;
  }
  const size = central.reduce((n, x) => n + x.length, 0), e = new DataView(new ArrayBuffer(22));
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true); e.setUint32(12, size, true); e.setUint32(16, off, true);
  return new Blob([...parts, ...central, new Uint8Array(e.buffer)], { type: 'application/zip' });
}
async function unzip(buf) {
  const u8 = new Uint8Array(buf), dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength), out = new Map(), dec = new TextDecoder(); let eo = -1;
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { eo = i; break; }
  if (eo < 0) throw new Error('not a zip');
  let p = dv.getUint32(eo + 16, true);
  for (let k = 0, n = dv.getUint16(eo + 10, true); k < n; k++) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('bad zip');
    const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true), nl = dv.getUint16(p + 28, true), xl = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true), lo = dv.getUint32(p + 42, true);
    const name = dec.decode(u8.subarray(p + 46, p + 46 + nl)).replace(/\\/g, '/'); p += 46 + nl + xl + cl;
    const start = lo + 30 + dv.getUint16(lo + 26, true) + dv.getUint16(lo + 28, true);
    let data = u8.slice(start, start + csize);
    if (method === 8) data = new Uint8Array(await new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer());
    else if (method !== 0) continue;
    if (!name.endsWith('/')) out.set(name.replace(/^[^/]+\/(?=project\.json$|cells\/|background\.|audio\.|thumb\.)/, ''), data);
  }
  return out;
}
const u8ToB64 = u8 => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
const b64ToU8 = b => Uint8Array.from(atob(b), c => c.charCodeAt(0));
const ab = u8 => u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
/** one animation as a .onion zip Blob */
async function packProject(pid) {
    if (S.proj && S.proj.id === pid) await flushSaves(true);
    const r = await window.fsApi.load(pid), meta = { ...r.meta }; delete meta.id; delete meta.thumb;
    const files = [{ name: 'project.json', data: new TextEncoder().encode(JSON.stringify(meta, null, 1)) }];
    for (const c of r.cells) files.push({ name: `cells/${c.fid}_${c.lid}.png`, data: new Uint8Array(c.buf) });
    if (r.bg) files.push({ name: 'background.jpg', data: new Uint8Array(r.bg) });
    if (r.audio) files.push({ name: r.audio.file, data: new Uint8Array(r.audio.buf) });
    const pr = S.projects.find(x => x.id === pid);
    if (pr && pr.thumb && pr.thumb.startsWith('data:image/jpeg;base64,')) files.push({ name: 'thumb.jpg', data: b64ToU8(pr.thumb.split(',')[1]) });
    return { blob: zipStore(files), meta };
}
async function saveCopy(pid) {
  try {
    toast('Packing your animation…', 1600);
    const { blob, meta } = await packProject(pid), fname = ((meta.name || 'animation').replace(/[^\w\- ]+/g, '').trim() || 'animation') + '.onion';
    if (window.fsApi.saveFile) {
      const res = await window.fsApi.saveFile(fname, 'application/octet-stream', await blob.arrayBuffer());
      toast(res && res.path ? 'Saved a copy in ' + res.path : 'Saved a copy', 4200);
    } else {
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = fname; document.body.appendChild(a); a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 60000); toast('Pick where to keep your copy', 2600);
    }
  } catch (e) { console.warn(e); toast('Could not save a copy: ' + (e && e.message || e)); }
}
/** bring a .onion in as a new animation; extra fields go into its project.json; returns {id, meta, n} */
async function importOnion(buf, extra) {
    const z = await unzip(buf), pj = z.get('project.json');
    if (!pj) throw new Error('no project.json');
    const meta = Object.assign(JSON.parse(new TextDecoder().decode(pj)), extra || {});
    if (!Array.isArray(meta.frames) || !Array.isArray(meta.layers) || !meta.w || !meta.h) throw new Error('not an animation');
    const name = String(meta.name || 'Saved animation').slice(0, 60);
    meta.name = S.projects.some(x => x.name === name) ? (name + ' (copy)').slice(0, 60) : name;
    meta.sample = false; meta.updatedAt = Date.now(); delete meta.id; delete meta.thumb;
    const id = (name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'animation') + '-' + uid().slice(0, 4);
    const th = z.get('thumb.jpg');
    await window.fsApi.saveMeta(id, meta, th ? 'data:image/jpeg;base64,' + u8ToB64(th) : '');
    let n = 0;
    for (const [f, data] of z) {
      const m = /^cells\/([A-Za-z0-9-]{1,64})_([A-Za-z0-9-]{1,64})\.png$/.exec(f), a = /^audio\.([a-z0-9]{1,5})$/i.exec(f);
      if (m) { await window.fsApi.saveCell(id, m[1], m[2], ab(data)); n++; }
      else if (/^background\.(jpg|png)$/.test(f)) await window.fsApi.saveBg(id, ab(data));
      else if (a) await window.fsApi.saveAudio(id, a[1].toLowerCase(), ab(data));
    }
    S.store.refresh();
    return { id, meta, n };
}
async function openCopy(file) {
  try {
    const { meta, n } = await importOnion(await file.arrayBuffer());
    toast(`Opened “${meta.name}” (${n} drawing${n === 1 ? '' : 's'})`, 3000);
  } catch (e) { console.warn(e); toast('That file is not an ONION animation.'); }
}
$('#openCopyBtn').onclick = () => $('#fileOnion').click();
$('#fileOnion').onchange = e => { const f = e.target.files[0]; e.target.value = ''; if (f) openCopy(f); };
/* the tablet's back button and app switching (the Android app calls these) */
window.onionBack = () => {
  if (TH.on) { thLeave(); return true; }
  if (CO.on && CO.target === 0) { curtainsOpen(); return true; }
  if ($('#sheetRoot').firstChild) { closeSheet(); return true; }
  if (window.OnionCommunity && window.OnionCommunity.back()) return true;
  if ($('#side').classList.contains('open')) { togglePanel(false); return true; }
  if (S.proj) { closeProject(); return true; }
  return false;
};
window.onionFlush = () => { if (S.proj) flushSaves(true); };

function applyTheme(t) { document.documentElement.dataset.theme = t; lsSet('theme', t); }
applyTheme(lsGet('theme', 'dark'));
$('#themeBtn').onclick = () => { const t = (document.documentElement.dataset.theme === 'light') ? 'dark' : 'light'; applyTheme(t); toast(t === 'dark' ? 'Dark mode' : 'Light mode', 1200); };
/* ONION's own notifications (the bell's ONION tab; community.js shows them) */
function appNote(title, body, opts = {}) {
  const L = lsGet('appNotes', []); L.unshift({ id: 'l' + Date.now() + Math.random().toString(36).slice(2, 5), title, body: body || '', at: Date.now(), read: false });
  lsSet('appNotes', L.slice(0, 40)); window.dispatchEvent(new CustomEvent('onion-note', { detail: { title, body, banner: opts.banner } }));
}
function showUpdate(v) {
  appNote('Claude sent an update', `ONION ${v.version} is ready${v.notes ? ': ' + v.notes : ''}. Restart to use it.`);
  $('#updMsg').textContent = `Claude sent an update: ONION ${v.version}${v.notes ? ' · ' + v.notes : ''}`;
  $('#updBar').hidden = false;
}
$('#updRestart').onclick = async () => { if (S.proj) await flushSaves(true); window.fsApi.restart(); };
async function boot() {
  applyWall(); curtainIntro();
  S.store = new DesktopStore(window.fsApi);
  try {
    const v = await window.fsApi.version(); S.version = v;
    $('#appVer').textContent = `ONION ${v.ui}${v.from === 'Claude' ? ' (update from Claude)' : ''}`;
    if (v.ui && lsGet('lastVer', '') !== v.ui) { if (lsGet('lastVer', '')) appNote(`Welcome to ONION ${v.ui}`, 'New: Contests! Community → Contests: enter your best animation, vote for your favourite, win a trophy. ONION now runs on iPhone and iPad too.'); lsSet('lastVer', v.ui); }
    if (v.needsInstaller) toast(`Claude made version ${v.needsInstaller}: it needs the new installer, ask Claude for it.`, 6000);
    window.fsApi.uiOk();
  } catch (e) { console.warn(e); }
  window.fsApi.onUpdate(showUpdate);
  S.store.watchProjects(list => { S.projects = list.filter(p => p && p.frames); if (!S.proj) renderGallery(); });
  loadFilms();
  $('#projFolder').onclick = () => window.fsApi.openFolder('projects');
  $('#filmsFolder').onclick = () => window.fsApi.openFolder('films');
  if (ANDROID) {
    $('#projFolder').hidden = true; $('#filmsFolder').hidden = true; document.documentElement.classList.add('android');
    $('#fEmpty').textContent = 'Videos you export can go on this shelf: after an export, tap Add to Films shelf.';
    $('#filmsFolder').previousElementSibling.textContent = 'Your films';
  }
  $('#extReload').onclick = async () => { $('#extBar').hidden = true; const id = S.proj.id; await flushSaves(true); S.projects = await window.fsApi.list(); openProject(id); };
  window.fsApi.onChanged(paths => {
    S.store.refresh();
    if (paths.some(p => p.startsWith('Films'))) { loadFilms(); if (paths.some(p => /^Films[\\/].+\.mp4$/i.test(p))) appNote('A new film is on your shelf', 'Claude put a film in Films from Claude.'); }
    if (S.proj && paths.some(p => p.includes(S.proj.id))) $('#extBar').hidden = false;
  });
  document.addEventListener('keydown', e => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); saveNow(); } });
}
/* ------------------------------------------------------------------ for the community screens (community.js) */
/** the open animation as a video for posting: renders every drawing, encodes MP4 (ffmpeg on Windows, MediaCodec on tablets) */
async function makePostVideo(onProgress) {
  await flushSaves(true);
  const long = Math.max(W(), H()), k = Math.min(1, 1280 / long), w = Math.max(2, Math.round(W() * k / 2) * 2), h = Math.max(2, Math.round(H() * k / 2) * 2);
  const order = S.proj.frames.map((f, i) => ({ i, hold: f.hold || 1 })), used = [...new Set(order.map(x => x.i))];
  const job = await window.fsApi.exportBegin();
  window.fsApi.onExportProgress((id, pct) => { if (id === job) onProgress && onProgress(0.4 + pct * 0.5); });
  for (let n = 0; n < used.length; n++) { await window.fsApi.exportFrame(job, used[n], await pngBuf(frameCanvas(used[n], W(), H(), false))); onProgress && onProgress(0.4 * (n + 1) / used.length); }
  const res = await window.fsApi.exportFinish(job, { format: 'mp4', name: (S.proj.name || 'animation') + ' (posted)', width: w, height: h, fps: S.proj.fps > 24 ? 30 : 24, crf: 20,
    entries: order.map(x => ({ i: x.i, dur: x.hold / S.proj.fps })), audio: !!S.proj.hasAudio, audioOffset: S.proj.audioOffset || 0, projectId: S.proj.id, loop: true });
  if (!window.fsApi.readExport) throw new Error('This version of ONION cannot post videos yet: install the newest version.');
  const bytes = await window.fsApi.readExport(res.path);
  return { blob: new Blob([bytes], { type: 'video/mp4' }), width: res.width || w, height: res.height || h, duration: order.reduce((s, x) => s + x.hold, 0) / S.proj.fps };
}
function posterOf(maxW = 960) {
  const k = Math.min(1, maxW / W()), c = frameCanvas(0, Math.round(W() * k), Math.round(H() * k), false);
  return new Promise(r => c.toBlob(r, 'image/jpeg', 0.86));
}
function pictureOf() { const c = frameCanvas(S.cur, W(), H(), false); return new Promise(r => c.toBlob(r, 'image/png')); }
window.__onion = {
  S, $, esc, toast, openSheet, closeSheet, confirmSheet, catSvg, uid, lsGet, lsSet,
  openProject, closeProject: () => closeProject(), packProject, zipStore, appNote, curtainsClose, swoosh, renderWidgets, setUserName: n => { S.userName = n; if (!$('#gallery').hidden) greet(); }, importOnion, makePostVideo, posterOf, pictureOf, flushSaves,
  showGallery: () => { $('#editor').hidden = true; $('#gallery').hidden = false; renderGallery(); S.store.refresh(); },
};

renderSide(); boot();
})();
