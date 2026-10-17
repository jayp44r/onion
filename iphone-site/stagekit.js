/* =====================================================================
   ONION stage kit (v1.6): theatre curtains and ready-made background scenes, drawn on a canvas.
   window.OnionArt.drawCurtains(ctx, w, h, k, opts)  k = 0 closed .. 1 open (drapes gather to the sides)
   window.OnionArt.SCENES  [{id, name}]   window.OnionArt.drawScene(id, ctx, w, h)
   Used by the theatre, the curtain intro/outro in exports, the curtain that opens the app, and the
   Backgrounds picker in Animation settings.
   ===================================================================== */
(() => {
'use strict';
const TAU = Math.PI * 2;
const hash = (i, k) => { const x = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453; return x - Math.floor(x); };
const ease = k => k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
const lerp = (a, b, t) => a + (b - a) * t;

const VELVET = {
  red: { dark: '#3d0410', mid: '#8e0f26', light: '#d23a52', shine: '#ff8a9a' },
  purple: { dark: '#1e0b3a', mid: '#4b2290', light: '#8d5ce0', shine: '#cdb0ff' },
  midnight: { dark: '#07091c', mid: '#1d2a66', light: '#4b62c4', shine: '#9fb4ff' },
};
const GOLD = { dark: '#8a5a12', mid: '#e0a92e', light: '#ffe08a' };

/* one drape (side = -1 left, +1 right): a curved inner edge that pinches at the tie-back as it opens,
   vertical velvet folds that follow that edge, a gold fringe, and a gold rope at the tie-back */
function drape(ctx, w, h, k, side, col, t) {
  const e = ease(Math.max(0, Math.min(1, k))), half = w / 2 + 2, tie = h * 0.64;
  const sway = Math.sin((t || 0) * 1.3 + side) * w * 0.004 * (1 - e);
  const wTop = lerp(half, w * 0.12, e), wTie = lerp(half, w * 0.055, e), wBot = lerp(half, w * 0.105, e);
  const width = y => {      // inner edge distance from the outer frame edge at height y
    if (y <= tie) { const u = y / tie; return lerp(wTop, wTie, u * u * (3 - 2 * u)) + sway * u; }
    const u = (y - tie) / (h - tie); return lerp(wTie, wBot, Math.sqrt(u)) + sway;
  };
  const X = (frac, y) => side < 0 ? frac * width(y) : w - frac * width(y);
  const N = 15, STEPS = 26;
  for (let i = 0; i < N; i++) {
    const f0 = i / N, f1 = (i + 1) / N;
    ctx.beginPath();
    for (let s = 0; s <= STEPS; s++) { const y = s / STEPS * h; ctx.lineTo(X(f0, y), y); }
    for (let s = STEPS; s >= 0; s--) { const y = s / STEPS * h; ctx.lineTo(X(f1, y) + side * -0.6, y); }
    ctx.closePath();
    const yA = h * 0.3, a = X(f0, yA), b = X(f1, yA);
    const g = ctx.createLinearGradient(a, 0, b, 0);
    const lit = 0.55 + 0.45 * Math.sin(i * 1.7 + 0.6);   // folds: some catch the light more than others
    g.addColorStop(0, col.dark); g.addColorStop(0.35, col.mid); g.addColorStop(0.55, lit > 0.8 ? col.light : col.mid);
    g.addColorStop(0.62, lit > 0.9 ? col.shine : col.light); g.addColorStop(1, col.dark);
    ctx.fillStyle = g; ctx.fill();
  }
  // shading: darker toward the floor and along the inner edge, so the drape looks heavy
  ctx.save();
  ctx.beginPath(); ctx.moveTo(side < 0 ? 0 : w, 0);
  for (let s = 0; s <= STEPS; s++) { const y = s / STEPS * h; ctx.lineTo(X(1, y), y); }
  ctx.lineTo(side < 0 ? 0 : w, h); ctx.closePath(); ctx.clip();
  const vg = ctx.createLinearGradient(0, 0, 0, h); vg.addColorStop(0, 'rgba(0,0,0,.28)'); vg.addColorStop(0.25, 'rgba(0,0,0,0)'); vg.addColorStop(0.8, 'rgba(0,0,0,.12)'); vg.addColorStop(1, 'rgba(0,0,0,.45)');
  ctx.fillStyle = vg; ctx.fillRect(0, 0, w, h);
  ctx.restore();
  // inner edge line + the shadow the drape casts on the stage
  ctx.beginPath(); for (let s = 0; s <= STEPS; s++) { const y = s / STEPS * h; ctx.lineTo(X(1, y), y); }
  ctx.strokeStyle = 'rgba(0,0,0,.55)'; ctx.lineWidth = Math.max(1.5, w * 0.003); ctx.stroke();
  if (e > 0.02) {
    ctx.save(); ctx.globalAlpha = 0.35 * e; ctx.beginPath();
    for (let s = 0; s <= STEPS; s++) { const y = s / STEPS * h; ctx.lineTo(X(1, y), y); }
    for (let s = STEPS; s >= 0; s--) { const y = s / STEPS * h; ctx.lineTo(X(1, y) - side * w * 0.035, y); }
    const sg = ctx.createLinearGradient(X(1, h / 2), 0, X(1, h / 2) - side * w * 0.035, 0); sg.addColorStop(0, 'rgba(0,0,0,.9)'); sg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = sg; ctx.fill(); ctx.restore();
  }
  // gold fringe along the bottom hem
  const fr = Math.max(6, h * 0.028), x0 = side < 0 ? 0 : w - width(h), x1 = side < 0 ? width(h) : w;
  ctx.fillStyle = GOLD.mid; ctx.fillRect(x0, h - fr, x1 - x0, fr * 0.35);
  ctx.strokeStyle = GOLD.dark; ctx.lineWidth = Math.max(1, fr * 0.12);
  for (let x = x0 + fr * 0.3; x < x1; x += fr * 0.42) { ctx.beginPath(); ctx.moveTo(x, h - fr * 0.65); ctx.lineTo(x + fr * 0.05, h); ctx.stroke(); }
  // tie-back rope with a tassel once the drape is gathered
  if (e > 0.3) {
    const a = (e - 0.3) / 0.7, ex = side < 0 ? width(tie) : w - width(tie), cx = side < 0 ? ex * 0.5 : (w + ex) * 0.5;
    ctx.save(); ctx.globalAlpha = Math.min(1, a * 1.6);
    ctx.lineWidth = Math.max(3, h * 0.014); ctx.lineCap = 'round';
    ctx.strokeStyle = GOLD.dark; ctx.beginPath(); ctx.moveTo(side < 0 ? 0 : w, tie - h * 0.01); ctx.quadraticCurveTo(cx, tie + h * 0.03, ex + side * h * 0.006, tie); ctx.stroke();
    ctx.strokeStyle = GOLD.mid; ctx.lineWidth *= 0.55; ctx.stroke();
    const tx = ex - side * h * 0.004, ty = tie + h * 0.012;
    ctx.fillStyle = GOLD.mid; ctx.beginPath(); ctx.arc(tx, ty, h * 0.013, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.moveTo(tx - h * 0.012, ty + h * 0.01); ctx.lineTo(tx + h * 0.012, ty + h * 0.01); ctx.lineTo(tx + h * 0.018, ty + h * 0.07); ctx.lineTo(tx - h * 0.018, ty + h * 0.07); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = GOLD.dark; ctx.lineWidth = Math.max(1, h * 0.002); ctx.stroke();
    ctx.restore();
  }
}

/* the valance across the top: scalloped swags with a gold trim */
function valance(ctx, w, h, col) {
  const vh = h * 0.1, n = Math.max(3, Math.round(w / h * 3));
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(w, 0); ctx.lineTo(w, vh * 0.6);
  for (let i = n - 1; i >= 0; i--) { const xa = (i + 1) / n * w, xb = i / n * w; ctx.quadraticCurveTo((xa + xb) / 2, vh * 1.45, xb, vh * 0.6); }
  ctx.closePath();
  const g = ctx.createLinearGradient(0, 0, 0, vh * 1.2); g.addColorStop(0, col.dark); g.addColorStop(0.55, col.mid); g.addColorStop(0.9, col.light); g.addColorStop(1, col.mid);
  ctx.fillStyle = g; ctx.fill();
  ctx.lineWidth = Math.max(2, h * 0.008); ctx.strokeStyle = GOLD.mid; ctx.beginPath(); ctx.moveTo(w, vh * 0.6);
  for (let i = n - 1; i >= 0; i--) { const xa = (i + 1) / n * w, xb = i / n * w; ctx.quadraticCurveTo((xa + xb) / 2, vh * 1.45, xb, vh * 0.6); }
  ctx.stroke();
  for (let i = 0; i <= n; i++) {        // little gold knots between the swags
    const x = i / n * w; ctx.fillStyle = GOLD.mid; ctx.beginPath(); ctx.arc(x, vh * 0.62, Math.max(3, h * 0.012), 0, TAU); ctx.fill();
    ctx.fillStyle = GOLD.light; ctx.beginPath(); ctx.arc(x - h * 0.003, vh * 0.6, Math.max(1, h * 0.004), 0, TAU); ctx.fill();
  }
}

function drawCurtains(ctx, w, h, k, opts = {}) {
  const col = VELVET[opts.color] || VELVET.red;
  ctx.save();
  drape(ctx, w, h, k, -1, col, opts.t);
  drape(ctx, w, h, k, 1, col, opts.t);
  if (opts.valance !== false) valance(ctx, w, h, col);
  ctx.restore();
}

/* ------------------------------------------------------------------ background scenes */
const SCENES = [
  { id: 'notebook', name: 'Notebook' }, { id: 'grid', name: 'Grid paper' }, { id: 'sky', name: 'Sunny day' },
  { id: 'sunset', name: 'Sunset' }, { id: 'night', name: 'Starry night' }, { id: 'stage', name: 'Theatre stage' },
  { id: 'beach', name: 'Beach' }, { id: 'desert', name: 'Desert' }, { id: 'underwater', name: 'Under the sea' },
  { id: 'spooky', name: 'Spooky moon' }, { id: 'candy', name: 'Candy land' }, { id: 'space', name: 'Outer space' },
];
function vgrad(ctx, w, h, stops, y0 = 0, y1 = h) { const g = ctx.createLinearGradient(0, y0, 0, y1); stops.forEach((c, i) => g.addColorStop(i / (stops.length - 1), c)); ctx.fillStyle = g; ctx.fillRect(0, y0, w, y1 - y0); }
function hill(ctx, w, h, y, amp, col, seed, n = 3) {
  ctx.beginPath(); ctx.moveTo(0, h); ctx.lineTo(0, y);
  for (let x = 0; x <= w; x += w / 60) ctx.lineTo(x, y - amp * (0.5 + 0.5 * Math.sin(x / w * Math.PI * n + seed)) - amp * 0.3 * Math.sin(x / w * 13 + seed * 2));
  ctx.lineTo(w, h); ctx.closePath(); ctx.fillStyle = col; ctx.fill();
}
function cloud(ctx, x, y, s, col = '#ffffff', shade = 'rgba(120,150,200,.25)') {
  const puffs = [[0, 0, 1], [-1.1, 0.25, 0.75], [1.1, 0.25, 0.8], [-0.5, -0.45, 0.8], [0.55, -0.4, 0.85]];
  ctx.fillStyle = shade; puffs.forEach(([a, b, r]) => { ctx.beginPath(); ctx.arc(x + a * s, y + b * s + s * 0.18, r * s, 0, TAU); ctx.fill(); });
  ctx.fillStyle = col; puffs.forEach(([a, b, r]) => { ctx.beginPath(); ctx.arc(x + a * s, y + b * s, r * s, 0, TAU); ctx.fill(); });
}
function glowDisc(ctx, x, y, r, col, glow) {
  const g = ctx.createRadialGradient(x, y, r * 0.8, x, y, r * 3.2); g.addColorStop(0, glow); g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r * 3.2, 0, TAU); ctx.fill();
  ctx.fillStyle = col; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
}
function stars(ctx, w, h, n, seed, maxY = h) {
  for (let i = 0; i < n; i++) {
    const x = hash(i, seed) * w, y = hash(i, seed + 1) * maxY, r = (0.4 + hash(i, seed + 2) * 1.4) * Math.max(1, w / 1280);
    ctx.fillStyle = `rgba(255,250,235,${0.45 + hash(i, seed + 3) * 0.55})`; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
    if (hash(i, seed + 4) > 0.94) { ctx.strokeStyle = 'rgba(255,250,235,.8)'; ctx.lineWidth = r * 0.6; ctx.beginPath(); ctx.moveTo(x - r * 4, y); ctx.lineTo(x + r * 4, y); ctx.moveTo(x, y - r * 4); ctx.lineTo(x, y + r * 4); ctx.stroke(); }
  }
}
function tree(ctx, x, y, len, ang, depth, lw) {
  if (depth <= 0 || len < 2) return;
  const x2 = x + Math.cos(ang) * len, y2 = y + Math.sin(ang) * len;
  ctx.lineWidth = lw; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x2, y2); ctx.stroke();
  tree(ctx, x2, y2, len * 0.72, ang - 0.42 - hash(depth, x) * 0.2, depth - 1, lw * 0.68);
  tree(ctx, x2, y2, len * 0.68, ang + 0.38 + hash(depth, y) * 0.25, depth - 1, lw * 0.68);
}
function drawScene(id, ctx, w, h) {
  const m = Math.min(w, h), U = m / 1000;
  ctx.save();
  switch (id) {
    case 'notebook': {
      ctx.fillStyle = '#fdfaf0'; ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = '#a9c8ec'; ctx.lineWidth = Math.max(1, 2 * U);
      for (let y = h * 0.12; y < h; y += m / 22) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
      ctx.strokeStyle = '#ee8a96'; ctx.lineWidth = Math.max(1.5, 3 * U); ctx.beginPath(); ctx.moveTo(w * 0.09, 0); ctx.lineTo(w * 0.09, h); ctx.stroke();
      break; }
    case 'grid': {
      ctx.fillStyle = '#fbfaff'; ctx.fillRect(0, 0, w, h); const s = m / 24;
      for (let i = 0, x = 0; x <= w; x += s, i++) { ctx.strokeStyle = i % 4 ? '#e6defa' : '#c9b8f4'; ctx.lineWidth = Math.max(1, (i % 4 ? 1.2 : 2) * U); ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
      for (let i = 0, y = 0; y <= h; y += s, i++) { ctx.strokeStyle = i % 4 ? '#e6defa' : '#c9b8f4'; ctx.lineWidth = Math.max(1, (i % 4 ? 1.2 : 2) * U); ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
      break; }
    case 'sky': {
      vgrad(ctx, w, h, ['#5fb8f5', '#a9dcff', '#e4f6ff']);
      glowDisc(ctx, w * 0.84, h * 0.17, 60 * U, '#fff4b8', 'rgba(255,236,150,.55)');
      cloud(ctx, w * 0.2, h * 0.2, 55 * U); cloud(ctx, w * 0.55, h * 0.12, 42 * U); cloud(ctx, w * 0.7, h * 0.33, 36 * U);
      hill(ctx, w, h, h * 0.74, h * 0.08, '#77c95b', 1, 2); hill(ctx, w, h, h * 0.84, h * 0.06, '#93dc6c', 3, 3);
      break; }
    case 'sunset': {
      vgrad(ctx, w, h, ['#5b2c83', '#e0607a', '#ff9f5a', '#ffd27a']);
      glowDisc(ctx, w * 0.5, h * 0.68, 90 * U, '#fff1b8', 'rgba(255,200,120,.6)');
      hill(ctx, w, h, h * 0.72, h * 0.07, '#7a3a78', 2, 2); hill(ctx, w, h, h * 0.82, h * 0.06, '#5a2a63', 5, 3); hill(ctx, w, h, h * 0.92, h * 0.04, '#3b1a49', 1, 4);
      break; }
    case 'night': {
      vgrad(ctx, w, h, ['#0d0827', '#24164f', '#3b2470']); stars(ctx, w, h, Math.round(w * h / 5000), 7, h * 0.8);
      glowDisc(ctx, w * 0.78, h * 0.2, 55 * U, '#fff6d8', 'rgba(255,240,200,.35)');
      ctx.fillStyle = '#24164f'; ctx.beginPath(); ctx.arc(w * 0.78 + 22 * U, h * 0.2 - 12 * U, 48 * U, 0, TAU); ctx.fill();
      hill(ctx, w, h, h * 0.8, h * 0.07, '#160d33', 2, 2); hill(ctx, w, h, h * 0.9, h * 0.05, '#0c0720', 4, 3);
      break; }
    case 'stage': {
      vgrad(ctx, w, h, ['#1a0610', '#3a0d1c', '#250812']);
      const floorY = h * 0.76;
      const sp = ctx.createRadialGradient(w / 2, floorY, 10, w / 2, floorY, w * 0.45); sp.addColorStop(0, 'rgba(255,236,190,.55)'); sp.addColorStop(1, 'rgba(255,236,190,0)');
      ctx.fillStyle = sp; ctx.fillRect(0, 0, w, h);
      vgrad(ctx, w, h, ['#8e5a33', '#6b4024'], floorY, h);
      ctx.strokeStyle = 'rgba(40,20,8,.55)'; ctx.lineWidth = Math.max(1, 2 * U);
      for (let i = 1; i < 6; i++) { const y = floorY + (h - floorY) * (i / 6) ** 1.4; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
      for (let i = -12; i <= 12; i++) { ctx.beginPath(); ctx.moveTo(w / 2 + i * w * 0.04, floorY); ctx.lineTo(w / 2 + i * w * 0.12, h); ctx.stroke(); }
      const lp = ctx.createRadialGradient(w / 2, floorY + (h - floorY) * 0.5, 5, w / 2, floorY + (h - floorY) * 0.5, w * 0.3); lp.addColorStop(0, 'rgba(255,240,200,.45)'); lp.addColorStop(1, 'rgba(255,240,200,0)');
      ctx.fillStyle = lp; ctx.fillRect(0, floorY, w, h - floorY);
      drawCurtains(ctx, w, h * 0.98, 1, { color: 'red' });
      break; }
    case 'beach': {
      vgrad(ctx, w, h, ['#62c2f7', '#bfe8ff'], 0, h * 0.55);
      glowDisc(ctx, w * 0.2, h * 0.16, 55 * U, '#fff4b8', 'rgba(255,236,150,.5)'); cloud(ctx, w * 0.62, h * 0.17, 40 * U); cloud(ctx, w * 0.86, h * 0.28, 30 * U);
      vgrad(ctx, w, h, ['#1f7fd0', '#3aa8e6'], h * 0.55, h * 0.72);
      ctx.strokeStyle = 'rgba(255,255,255,.65)'; ctx.lineWidth = Math.max(1.5, 3 * U); ctx.lineCap = 'round';
      for (let i = 0; i < 18; i++) { const x = hash(i, 3) * w, y = h * (0.58 + hash(i, 4) * 0.12), L = (30 + hash(i, 5) * 60) * U; ctx.beginPath(); ctx.moveTo(x, y); ctx.quadraticCurveTo(x + L / 2, y - 6 * U, x + L, y); ctx.stroke(); }
      ctx.fillStyle = '#f3dfac'; ctx.beginPath(); ctx.moveTo(0, h * 0.74); for (let x = 0; x <= w; x += w / 40) ctx.lineTo(x, h * 0.72 + Math.sin(x / w * 9) * 8 * U); ctx.lineTo(w, h); ctx.lineTo(0, h); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,.85)'; ctx.lineWidth = Math.max(2, 5 * U); ctx.beginPath(); for (let x = 0; x <= w; x += w / 40) ctx.lineTo(x, h * 0.72 + Math.sin(x / w * 9) * 8 * U); ctx.stroke();
      for (let i = 0; i < w * h / 900; i++) { ctx.fillStyle = hash(i, 9) > 0.5 ? '#d9b26f' : '#fff3cf'; ctx.fillRect(hash(i, 7) * w, h * 0.75 + hash(i, 8) * h * 0.25, 1.5 * U + 0.5, 1.5 * U + 0.5); }
      break; }
    case 'desert': {
      vgrad(ctx, w, h, ['#ffb86b', '#ffd9a0', '#ffefd0']);
      glowDisc(ctx, w * 0.72, h * 0.3, 80 * U, '#fff4c8', 'rgba(255,220,140,.55)');
      const dune = (y, amp, col, sd) => { ctx.beginPath(); ctx.moveTo(0, h); ctx.lineTo(0, y); for (let x = 0; x <= w; x += w / 50) ctx.lineTo(x, y - amp * Math.sin(x / w * Math.PI * 1.6 + sd)); ctx.lineTo(w, h); ctx.closePath(); ctx.fillStyle = col; ctx.fill(); };
      dune(h * 0.62, h * 0.08, '#e8b96a', 0.5); dune(h * 0.74, h * 0.07, '#d9a253', 2.2); dune(h * 0.88, h * 0.06, '#c98f42', 4);
      ctx.fillStyle = '#3f7a3a'; const cx = w * 0.2, cy = h * 0.8; ctx.fillRect(cx - 9 * U, cy - 110 * U, 18 * U, 110 * U);
      ctx.fillRect(cx - 40 * U, cy - 70 * U, 14 * U, 40 * U); ctx.fillRect(cx - 40 * U, cy - 36 * U, 40 * U, 12 * U); ctx.fillRect(cx + 26 * U, cy - 90 * U, 14 * U, 40 * U); ctx.fillRect(cx, cy - 56 * U, 40 * U, 12 * U);
      break; }
    case 'underwater': {
      vgrad(ctx, w, h, ['#33b6e6', '#137cc0', '#0b4a86']);
      ctx.fillStyle = 'rgba(255,255,255,.07)';
      for (let i = 0; i < 6; i++) { const x = w * (0.1 + i * 0.17); ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x + w * 0.06, 0); ctx.lineTo(x + w * 0.16, h); ctx.lineTo(x + w * 0.04, h); ctx.closePath(); ctx.fill(); }
      ctx.fillStyle = '#e8d29a'; ctx.beginPath(); ctx.moveTo(0, h); for (let x = 0; x <= w; x += w / 40) ctx.lineTo(x, h * 0.86 - Math.sin(x / w * 7) * 12 * U); ctx.lineTo(w, h); ctx.closePath(); ctx.fill();
      ctx.lineCap = 'round';
      for (let i = 0; i < 9; i++) { const x = hash(i, 11) * w, H = (90 + hash(i, 12) * 160) * U; ctx.strokeStyle = hash(i, 13) > 0.5 ? '#2fa36b' : '#4fc77f'; ctx.lineWidth = 10 * U;
        ctx.beginPath(); ctx.moveTo(x, h * 0.9); for (let s = 1; s <= 8; s++) ctx.lineTo(x + Math.sin(s * 1.3 + i) * 12 * U, h * 0.9 - H * s / 8); ctx.stroke(); }
      for (let i = 0; i < 26; i++) { const x = hash(i, 14) * w, y = hash(i, 15) * h * 0.8, r = (4 + hash(i, 16) * 12) * U;
        ctx.strokeStyle = 'rgba(255,255,255,.7)'; ctx.lineWidth = Math.max(1, 2 * U); ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.stroke();
        ctx.fillStyle = 'rgba(255,255,255,.8)'; ctx.beginPath(); ctx.arc(x - r * 0.35, y - r * 0.35, r * 0.22, 0, TAU); ctx.fill(); }
      break; }
    case 'spooky': {
      vgrad(ctx, w, h, ['#140a26', '#2d1650', '#4a2a6e']); stars(ctx, w, h, Math.round(w * h / 9000), 21, h * 0.6);
      glowDisc(ctx, w * 0.5, h * 0.36, 120 * U, '#fff3cf', 'rgba(255,230,170,.35)');
      ctx.fillStyle = 'rgba(200,170,120,.25)'; ctx.beginPath(); ctx.arc(w * 0.46, h * 0.33, 22 * U, 0, TAU); ctx.arc(w * 0.54, h * 0.4, 16 * U, 0, TAU); ctx.fill();
      hill(ctx, w, h, h * 0.78, h * 0.06, '#1a0d2e', 3, 2);
      ctx.strokeStyle = '#0d0618'; ctx.lineCap = 'round';
      tree(ctx, w * 0.14, h * 0.82, 150 * U, -Math.PI / 2 - 0.08, 7, 22 * U); tree(ctx, w * 0.86, h * 0.84, 130 * U, -Math.PI / 2 + 0.1, 7, 19 * U);
      hill(ctx, w, h, h * 0.9, h * 0.04, '#0d0618', 1, 4);
      ctx.fillStyle = '#0d0618';
      for (const [bx, by, bs] of [[0.36, 0.22, 1], [0.62, 0.17, 0.8], [0.68, 0.27, 0.65]]) {
        const x = w * bx, y = h * by, s = 22 * U * bs; ctx.beginPath(); ctx.moveTo(x, y);
        ctx.quadraticCurveTo(x - s * 0.6, y - s * 0.7, x - s * 1.6, y - s * 0.2); ctx.quadraticCurveTo(x - s, y + s * 0.05, x - s * 0.8, y + s * 0.3); ctx.quadraticCurveTo(x - s * 0.4, y + s * 0.05, x, y + s * 0.3);
        ctx.quadraticCurveTo(x + s * 0.4, y + s * 0.05, x + s * 0.8, y + s * 0.3); ctx.quadraticCurveTo(x + s, y + s * 0.05, x + s * 1.6, y - s * 0.2); ctx.quadraticCurveTo(x + s * 0.6, y - s * 0.7, x, y); ctx.fill(); }
      break; }
    case 'candy': {
      vgrad(ctx, w, h, ['#ffc6ea', '#ffe3f4', '#d8f7ea']);
      cloud(ctx, w * 0.25, h * 0.18, 46 * U, '#ffffff', 'rgba(255,143,214,.25)'); cloud(ctx, w * 0.74, h * 0.12, 36 * U, '#ffffff', 'rgba(255,143,214,.25)');
      hill(ctx, w, h, h * 0.76, h * 0.08, '#b58cff', 2, 2); hill(ctx, w, h, h * 0.86, h * 0.06, '#8ff0c0', 4, 3);
      for (let i = 0; i < 5; i++) {                 // lollipops
        const x = w * (0.12 + i * 0.19), y = h * (0.62 + hash(i, 31) * 0.1), r = (34 + hash(i, 32) * 16) * U;
        ctx.fillStyle = '#ffffff'; ctx.fillRect(x - 4 * U, y, 8 * U, h * 0.3);
        ctx.fillStyle = ['#ff8fd6', '#ffd36b', '#7cc8ff', '#ff6b8b', '#8ff0c0'][i]; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,.85)'; ctx.lineWidth = 6 * U; ctx.beginPath();
        for (let a = 0; a < 9; a += 0.2) ctx.lineTo(x + Math.cos(a) * r * a / 9, y + Math.sin(a) * r * a / 9); ctx.stroke();
      }
      break; }
    case 'space': {
      vgrad(ctx, w, h, ['#05030f', '#140a33', '#0a0620']); stars(ctx, w, h, Math.round(w * h / 2500), 41);
      const neb = ctx.createRadialGradient(w * 0.3, h * 0.4, 10, w * 0.3, h * 0.4, w * 0.45); neb.addColorStop(0, 'rgba(181,140,255,.35)'); neb.addColorStop(1, 'rgba(181,140,255,0)');
      ctx.fillStyle = neb; ctx.fillRect(0, 0, w, h);
      const px = w * 0.72, py = h * 0.58, pr = 120 * U;
      ctx.fillStyle = '#ff8fd6'; ctx.beginPath(); ctx.arc(px, py, pr, 0, TAU); ctx.fill();
      ctx.fillStyle = 'rgba(90,30,90,.35)'; ctx.beginPath(); ctx.arc(px + pr * 0.25, py + pr * 0.15, pr * 0.95, 0, TAU); ctx.fill();
      ctx.strokeStyle = '#ffd36b'; ctx.lineWidth = 12 * U; ctx.beginPath(); ctx.ellipse(px, py, pr * 1.7, pr * 0.42, -0.25, Math.PI * 0.05, Math.PI * 0.95, true); ctx.stroke();
      glowDisc(ctx, w * 0.15, h * 0.2, 26 * U, '#8ff0c0', 'rgba(143,240,192,.35)');
      break; }
    default: ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, w, h);
  }
  ctx.restore();
}

window.OnionArt = { drawCurtains, drawScene, SCENES, VELVET: Object.keys(VELVET), ease };
})();
