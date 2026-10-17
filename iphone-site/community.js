/* =====================================================================
   ONION COMMUNITY - accounts, a swipe feed of animations, art, photos and GIFs, likes, favorites, remixes,
   collabs, the gold cat check, reports, blocks and admin tools. Talks to Supabase through community-api.js;
   the server rules live in community/schema.sql. Uses the editor's helpers through window.__onion.
   ===================================================================== */
(() => {
'use strict';
const O = window.__onion;
if (!O) return;
const { $, esc, toast, openSheet, closeSheet, confirmSheet, lsGet, lsSet } = O;
const CFG = window.ONION_COMMUNITY || {};
const READY = !!(CFG.url && CFG.anonKey && window.supabase && window.OnionCommunityAPI);
let api = null, sb = null;
if (READY) {
  sb = window.supabase.createClient(CFG.url, CFG.anonKey, { auth: { persistSession: true, autoRefreshToken: true, storageKey: 'onion-community-auth', detectSessionInUrl: false } });
  api = window.OnionCommunityAPI.createCommunity(sb, CFG.url);
}
const C = { tab: 'new', feeds: {}, page: null, muted: lsGet('cmMuted', true), observer: null, loadObs: null, me: null, pageStack: [] };

/* ---------------------------------------------------------------- little pieces */
const ICON = {
  heart: '<path d="M12 20.5s-8.5-5.3-8.5-11.4A4.6 4.6 0 0 1 12 6.4a4.6 4.6 0 0 1 8.5 2.7C20.5 15.2 12 20.5 12 20.5z"/>',
  star: '<path d="M12 3.2l2.6 5.5 6 .8-4.4 4.2 1.1 6-5.3-2.9-5.3 2.9 1.1-6L3.4 9.5l6-.8z"/>',
  remix: '<path d="M4 7h11l-3-3M20 17H9l3 3"/><path d="M15 7a5 5 0 0 1 5 5M9 17a5 5 0 0 1-5-5"/>',
  more: '<circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/>',
  sound: '<path d="M4 9v6h4l5 4V5L8 9z"/><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/>',
  mute: '<path d="M4 9v6h4l5 4V5L8 9z"/><path d="M17 9l5 6M22 9l-5 6"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  upload: '<path d="M12 16V4M7 9l5-5 5 5M5 20h14"/>',
  paw: '<ellipse cx="12" cy="16.2" rx="5.6" ry="4.6"/><circle cx="5.4" cy="10.2" r="2.4"/><circle cx="9.5" cy="5.8" r="2.4"/><circle cx="14.5" cy="5.8" r="2.4"/><circle cx="18.6" cy="10.2" r="2.4"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
  bell: '<path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 20.5a2.2 2.2 0 0 0 4 0"/>',
  flag: '<path d="M5 21V4"/><path d="M5 4h11l-2 4 2 4H5"/>',
  check: '<path d="M4 12l5 5L20 6"/>',
  people: '<circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.5 2.7-6 6-6s6 2.5 6 6"/><circle cx="17" cy="9" r="2.4"/><path d="M15.5 14.4c3 .2 5.5 2.4 5.5 5.6"/>',
  film: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M7 5v14M17 5v14M3 9h4M3 15h4M17 9h4M17 15h4"/>',
  draft: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M9 13h6M9 17h4"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
  trophy: '<path d="M8 4h8v5a4 4 0 0 1-8 0z"/><path d="M8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4"/><path d="M12 13v4M8.5 20h7M10 17h4"/>',
  vote: '<rect x="4" y="12" width="16" height="8" rx="2"/><path d="M8 12V5h8v7"/><path d="M10 8.5l1.6 1.6L14.5 7"/>',
};
const svg = (name, cls = '') => `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICON[name]}</svg>`;
/** the gold cat check: a little golden cat head with a check inside */
const CHECK = '<svg class="gold-check" viewBox="0 0 72 66" role="img" aria-label="Gold cat check"><title>Gold cat check</title><path fill="url(#goldCat)" stroke="#2a1500" stroke-width="5" stroke-linejoin="round" d="M8 42C8 33 10 27 13 23L12 9C12 5 15 4 18 6L28 15C33 13.5 39 13.5 44 15L54 6C57 4 60 5 60 9L59 23C62 27 64 33 64 42C64 54 52 61 36 61C20 61 8 54 8 42Z"/><path d="M22 39l9.5 9.5L51 29" fill="none" stroke="#fff" stroke-width="7.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const check = p => p && p.verified ? CHECK : '';
const nice = n => n >= 1e6 ? (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'K' : String(n || 0);
const ago = t => { const s = (Date.now() - new Date(t).getTime()) / 1000; return s < 60 ? 'now' : s < 3600 ? Math.floor(s / 60) + 'm' : s < 86400 ? Math.floor(s / 3600) + 'h' : s < 604800 ? Math.floor(s / 86400) + 'd' : new Date(t).toLocaleDateString(); };
let avN = 0;
function avatar(p, size = 40) {
  if (p && p.avatar_url) return `<span class="cm-av" style="width:${size}px;height:${size}px"><img alt="" src="${esc(p.avatar_url)}"></span>`;
  return `<span class="cm-av cat" style="width:${size}px;height:${size}px;--c:${esc((p && p.avatar_color) || '#b58cff')}">${O.catSvg('cmAv' + (avN++))}</span>`;
}
function who(p, cls = '') { return `<button class="cm-who ${cls}" data-user="${esc(p.username)}">@${esc(p.username)}${check(p)}</button>`; }
async function guard(fn) { try { return await fn(); } catch (e) { console.warn(e); toast(api ? api.friendly(e) : String(e.message || e), 3200); return undefined; } }

/* ---------------------------------------------------------------- screen */
function show() {
  $('#gallery').hidden = true; $('#editor').hidden = true; $('#community').hidden = false;
  document.documentElement.classList.add('in-community');
}
function hide() {
  pauseAll(); $('#community').hidden = true; document.documentElement.classList.remove('in-community');
  O.showGallery();
}
async function open(tab) {
  show();
  if (!READY) { renderOffline(); return; }
  await guard(async () => { C.me = await api.session(); });
  renderTop();
  switchTab(tab || C.tab);
}
function renderOffline() {
  $('#cmTabs').innerHTML = ''; $('#cmMe').innerHTML = ''; $('#cmPost').hidden = true; $('#cmSearchBtn').hidden = true;
  $('#cmFeed').hidden = true; const pg = $('#cmPage'); pg.hidden = false;
  pg.innerHTML = `<div class="cm-empty"><div class="cat-mascot">${O.catSvg('cmOff')}</div><h2 class="t3d">${esc(CFG.offlineTitle || 'The ONION community is almost here')}</h2>
    <p>${esc(CFG.offlineText || 'This version of ONION is not connected to the community server yet. Ask for the newest ONION, then come back to watch, post and remix animations.')}</p></div>`;
}
function renderTop() {
  const tabs = [['new', 'For you'], ['top', 'Top'], ['contests', 'Contests'], ['favorites', 'Favorites']];
  if (C.me && C.me.is_admin) tabs.push(['admin', 'Owner']);
  $('#cmTabs').innerHTML = tabs.map(([k, n]) => `<button data-tab="${k}" class="${k === C.tab && !C.page ? 'on' : ''}">${n}</button>`).join('');
  $('#cmTabs').querySelectorAll('button').forEach(b => b.onclick = () => switchTab(b.dataset.tab));
  $('#cmPost').hidden = false; $('#cmSearchBtn').hidden = false;
  $('#cmMe').innerHTML = C.me ? `${avatar(C.me, 34)}<span class="hide-narrow">@${esc(C.me.username)}</span>${check(C.me)}` : '<span>Log in</span>';
  $('#cmMe').title = C.me ? 'Your profile' : 'Log in or make an account';
}
function switchTab(tab) {
  C.tab = tab; C.page = null; C.pageStack = [];
  renderTop();
  if (tab === 'admin') { openAdmin(); return; }
  if (tab === 'contests') { openContests(); return; }
  if (tab === 'favorites' && !C.me) { authSheet('login', () => switchTab('favorites')); return; }
  $('#cmPage').hidden = true; $('#cmFeed').hidden = false;
  startFeed({ mode: tab });
}

/* ---------------------------------------------------------------- the feed: one post per screen, swipe or scroll */
function startFeed(src, startIndex = 0) {
  const feed = $('#cmFeed'); pauseAll(); feed.innerHTML = ''; feed.scrollTop = 0;
  C.feed = { src, posts: [], next: null, loading: false, done: false, list: !!src.list };
  if (C.observer) C.observer.disconnect();
  C.observer = new IntersectionObserver(onSeen, { root: feed, threshold: [0, 0.6] });
  if (src.list) { appendPosts(src.list); C.feed.done = true; setTimeout(() => { const el = feed.children[startIndex]; if (el) feed.scrollTop = el.offsetTop; }, 30); if (!src.list.length) emptyFeed(); return; }
  loadMore();
}
async function loadMore() {
  const F = C.feed; if (!F || F.loading || F.done) return;
  F.loading = true;
  const feed = $('#cmFeed'), spin = document.createElement('div'); spin.className = 'cm-loading'; spin.innerHTML = `<div class="cat-mascot hop">${O.catSvg('cmSpin' + Date.now())}</div><span>Loading cute stuff…</span>`;
  feed.appendChild(spin);
  try {
    const r = await api.feed({ mode: F.src.mode, userId: F.src.userId, ...(F.next || {}) });
    if (C.feed !== F) return;
    spin.remove();
    appendPosts(r.posts); F.next = r.next; F.done = !r.next;
    if (!F.posts.length) emptyFeed();
  } catch (e) {
    spin.innerHTML = `<p>${esc(api.friendly(e))}</p><button class="btn" id="cmRetry">Try again</button>`;
    spin.querySelector('#cmRetry').onclick = () => { spin.remove(); F.loading = false; loadMore(); };
    return;
  } finally { F.loading = false; }
}
function emptyFeed() {
  const msg = C.feed.src.mode === 'favorites' ? ['No favorites yet', 'Tap the star on a post to keep it here.'] : ['Nothing here yet', 'Be the first: tap Post and share an animation, a drawing or a GIF.'];
  $('#cmFeed').innerHTML = `<div class="cm-empty"><div class="cat-mascot">${O.catSvg('cmEmpty')}</div><h2 class="t3d">${msg[0]}</h2><p>${msg[1]}</p></div>`;
}
function appendPosts(posts) {
  const feed = $('#cmFeed');
  for (const p of posts) {
    C.feed.posts.push(p);
    const el = document.createElement('article'); el.className = 'cm-post'; el.dataset.id = p.id;
    el.innerHTML = cardHtml(p); feed.appendChild(el); wireCard(el, p); C.observer.observe(el);
  }
  // load the next page when the second-to-last post shows
  if (C.loadObs) C.loadObs.disconnect();
  if (!C.feed.done && feed.children.length) {
    C.loadObs = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) loadMore(); }, { root: feed, rootMargin: '0px 0px 120% 0px' });
    C.loadObs.observe(feed.children[Math.max(0, feed.children.length - 2)]);
  }
}
function mediaHtml(p) {
  const ar = `aspect-ratio:${p.width}/${p.height}`;
  if (p.kind === 'video') return `<div class="cm-media" style="${ar}"><video class="cm-v" playsinline loop ${C.muted ? 'muted' : ''} preload="none" poster="${esc(p.poster_url)}" data-src="${esc(p.media_url)}"></video></div>`;
  return `<div class="cm-media" style="${ar}"><img alt="${esc(p.caption || 'art by @' + p.author.username)}" loading="lazy" src="${esc(p.media_url)}"></div>`;
}
function cardHtml(p) {
  const credits = [];
  if (p.remix_of && p.remix_of.author) credits.push(`<span class="cm-chip remix">${svg('remix')}remix of ${who(p.remix_of.author)}</span>`);
  for (const w of (p.won || [])) credits.push(`<button class="cm-chip gold" data-contest="${w.id}">${svg('trophy')}Won “${esc(w.title)}”</button>`);
  if (p.collabs.length) credits.push(`<span class="cm-chip">with ${p.collabs.map(c => who(c)).join(' ')}</span>`);
  return `<div class="cm-stage" style="--poster:url('${esc(p.poster_url || p.media_url)}')">${mediaHtml(p)}<div class="cm-burst"></div></div>
    <div class="cm-info">
      <div class="cm-by"><button class="cm-avbtn" data-user="${esc(p.author.username)}" aria-label="@${esc(p.author.username)}">${avatar(p.author, 46)}</button>
        <div><b class="cm-name">${esc(p.author.display_name || p.author.username)}</b><div>${who(p.author)} <span class="cm-ago">· ${ago(p.created_at)}</span></div></div></div>
      ${p.caption ? `<p class="cm-cap">${esc(p.caption)}</p>` : ''}
      <div class="cm-credits">${credits.join('')}<span class="cm-chip views" title="${(p.view_count || 0).toLocaleString()} views">${svg('eye')}${nice(p.view_count || 0)} views</span></div>
    </div>
    <div class="cm-rail">
      <button class="cm-act like ${p.liked ? 'on' : ''}" aria-label="Like" aria-pressed="${p.liked}">${svg('heart')}<span>${nice(p.like_count)}</span></button>
      <button class="cm-act fav ${p.faved ? 'on' : ''}" aria-label="Favorite" aria-pressed="${p.faved}">${svg('star')}<span>${nice(p.fav_count)}</span></button>
      ${p.allow_remix && p.project_url ? `<button class="cm-act remix" aria-label="Remix">${svg('remix')}<span>${p.remix_count ? nice(p.remix_count) : 'Remix'}</span></button>` : ''}
      ${p.kind === 'video' ? `<button class="cm-act snd" aria-label="Sound">${svg(C.muted ? 'mute' : 'sound')}</button>` : ''}
      <button class="cm-act more" aria-label="More">${svg('more')}</button>
    </div>`;
}
function wireCard(el, p) {
  el.querySelectorAll('[data-user]').forEach(b => b.onclick = e => { e.stopPropagation(); openProfile(b.dataset.user); });
  el.querySelectorAll('[data-contest]').forEach(b => b.onclick = e => { e.stopPropagation(); C.pageStack.push(C.page || { kind: 'feed' }); C.page = null; openContest(b.dataset.contest); });
  const like = el.querySelector('.like'), fav = el.querySelector('.fav');
  like.onclick = () => toggleLike(el, p);
  fav.onclick = () => toggleFav(el, p);
  const rx = el.querySelector('.remix'); if (rx) rx.onclick = () => remix(p);
  const snd = el.querySelector('.snd'); if (snd) snd.onclick = () => setMuted(!C.muted);
  el.querySelector('.more').onclick = () => moreSheet(p, el);
  const stage = el.querySelector('.cm-stage'); let lastTap = 0;
  stage.addEventListener('click', e => {
    const now = Date.now();
    if (now - lastTap < 320) { burst(el); if (!p.liked) toggleLike(el, p); lastTap = 0; return; }
    lastTap = now;
    const v = el.querySelector('video'); if (v) setTimeout(() => { if (lastTap && Date.now() - lastTap >= 300) { v.paused ? v.play().catch(() => {}) : v.pause(); } }, 330);
  });
}
function burst(el) {
  const b = el.querySelector('.cm-burst'); b.classList.remove('go'); void b.offsetWidth; b.classList.add('go');
}
async function toggleLike(el, p) {
  if (!C.me) { authSheet('login'); return; }
  const on = !p.liked; p.liked = on; p.like_count += on ? 1 : -1; paintActs(el, p);
  const r = await guard(() => api.like(p.id, on));
  if (r === undefined && api) { /* guard already said why */ }
}
async function toggleFav(el, p) {
  if (!C.me) { authSheet('login'); return; }
  const on = !p.faved; p.faved = on; p.fav_count += on ? 1 : -1; paintActs(el, p);
  await guard(() => api.favorite(p.id, on));
  toast(on ? 'Saved to Favorites' : 'Removed from Favorites', 1200);
}
function paintActs(el, p) {
  const l = el.querySelector('.like'), f = el.querySelector('.fav');
  l.classList.toggle('on', p.liked); l.setAttribute('aria-pressed', p.liked); l.querySelector('span').textContent = nice(p.like_count);
  f.classList.toggle('on', p.faved); f.setAttribute('aria-pressed', p.faved); f.querySelector('span').textContent = nice(p.fav_count);
  if (p.liked) { l.classList.remove('pop'); void l.offsetWidth; l.classList.add('pop'); }
}
const viewed = new Set();
function onSeen(entries) {
  for (const e of entries) {
    const id = e.target.dataset.id;
    if (id && e.intersectionRatio >= 0.6 && C.me && !viewed.has(id)) {
      clearTimeout(e.target._vt); e.target._vt = setTimeout(() => { if (!viewed.has(id)) { viewed.add(id); api.view(id).catch(() => {}); } }, 1200);
    } else if (e.intersectionRatio < 0.6) clearTimeout(e.target._vt);
    const v = e.target.querySelector('video');
    if (e.intersectionRatio > 0 && v && !v.src) { v.src = v.dataset.src; v.preload = 'auto'; }   // load when near
    if (v) { if (e.intersectionRatio >= 0.6 && !$('#community').hidden) { v.muted = C.muted; v.play().catch(() => {}); } else v.pause(); }
  }
  // warm up the next post's video
  const feed = $('#cmFeed'), cur = [...feed.children].find(c => { const r = c.getBoundingClientRect(), fr = feed.getBoundingClientRect(); return r.top >= fr.top - 10 && r.top < fr.top + fr.height / 2; });
  const nx = cur && cur.nextElementSibling && cur.nextElementSibling.querySelector('video');
  if (nx && !nx.src) { nx.src = nx.dataset.src; nx.preload = 'metadata'; }
}
function pauseAll() { document.querySelectorAll('#cmFeed video').forEach(v => v.pause()); }
function setMuted(m) {
  C.muted = m; lsSet('cmMuted', m);
  document.querySelectorAll('#cmFeed video').forEach(v => { v.muted = m; });
  document.querySelectorAll('#cmFeed .snd').forEach(b => b.innerHTML = svg(m ? 'mute' : 'sound'));
  toast(m ? 'Sound off' : 'Sound on', 900);
}

/* ---------------------------------------------------------------- remix: open someone's animation in your editor */
async function remix(p) {
  toast('Opening @' + p.author.username + "'s animation to remix…", 2000);
  await guard(async () => {
    const r = await fetch(p.project_url); if (!r.ok) throw new Error('That remix file is gone.');
    const { id, meta } = await O.importOnion(await r.arrayBuffer(), { remixOf: { post: p.id, username: p.author.username }, sample: false });
    meta.name = ('Remix of ' + String(meta.name || 'animation').replace(/\s*\(copy\)$/, '').replace(/^Remix of /, '')).slice(0, 60);
    await window.fsApi.saveMeta(id, Object.assign({}, meta, { name: meta.name }), '');
    O.S.projects = await window.fsApi.list();
    $('#community').hidden = true; document.documentElement.classList.remove('in-community'); pauseAll();
    await O.openProject(id);
    toast('Remixing @' + p.author.username + "'s animation. Draw your twist, then tap Post!", 4000);
  });
}

/* ---------------------------------------------------------------- the … menu: report, block, delete, admin */
function moreSheet(p, el) {
  const mine = p.mine, admin = C.me && C.me.is_admin;
  const sh = openSheet(`<h2>${mine ? 'Your post' : 'Post by @' + esc(p.author.username)}</h2>
    <div class="cm-menu">
      ${mine ? '<button class="list-btn" data-a="edit"><b>Edit caption</b></button><button class="list-btn danger-t" data-a="delete"><b>Delete post</b></button>' : ''}
      ${!mine ? '<button class="list-btn" data-a="report"><b>Report this post</b><small>Tell the ONION team something is wrong with it</small></button>' : ''}
      ${!mine ? `<button class="list-btn" data-a="block"><b>Block @${esc(p.author.username)}</b><small>You will not see their posts</small></button>` : ''}
      ${admin ? `<button class="list-btn admin" data-a="counts"><b>Owner: set likes and views</b><small>${nice(p.like_count)} likes · ${nice(p.view_count || 0)} views now</small></button>` : ''}
      ${admin && !mine ? `<button class="list-btn admin" data-a="hide"><b>Owner: hide this post</b></button><button class="list-btn danger-t" data-a="odel"><b>Owner: delete this post</b><small>Gone for everyone, files too</small></button><button class="list-btn admin" data-a="ban"><b>Owner: ban @${esc(p.author.username)}</b></button>` : ''}
      ${admin ? `<button class="list-btn admin" data-a="check"><b>Owner: ${p.author.verified ? 'remove' : 'give'} the gold cat check</b></button>` : ''}
    </div>
    <div class="actions"><button class="btn" data-close>Close</button></div>`);
  const on = (a, fn) => { const b = sh.querySelector(`[data-a="${a}"]`); if (b) b.onclick = fn; };
  on('edit', () => {
    const s2 = openSheet(`<h2>Edit caption</h2><label class="field"><span>Caption</span><textarea id="cmCapEdit" maxlength="300">${esc(p.caption)}</textarea></label>
      <div class="actions"><button class="btn" data-close>Cancel</button><button class="btn primary" id="cmCapSave">Save</button></div>`);
    s2.querySelector('#cmCapSave').onclick = () => guard(async () => { p.caption = s2.querySelector('#cmCapEdit').value; await api.editPost(p.id, { caption: p.caption }); closeSheet(); el.innerHTML = cardHtml(p); wireCard(el, p); toast('Saved'); });
  });
  on('delete', () => confirmSheet('Delete this post?', 'It disappears for everyone. Your animation stays in ONION.', 'Delete', () => guard(async () => { await api.deletePost(p); el.remove(); toast('Post deleted'); C.me = await api.session(); })));
  on('report', () => {
    if (!C.me) { authSheet('login'); return; }
    const reasons = ['Mean or bullying', 'Too scary or gross', 'Grown-up stuff', 'Stolen art', 'Spam', 'Something else'];
    const s2 = openSheet(`<h2>Report post</h2><div class="cm-menu">${reasons.map(r => `<button class="list-btn" data-r="${esc(r)}"><b>${r}</b></button>`).join('')}</div><div class="actions"><button class="btn" data-close>Cancel</button></div>`);
    s2.querySelectorAll('[data-r]').forEach(b => b.onclick = () => guard(async () => { await api.report(p.id, b.dataset.r); closeSheet(); toast('Thanks. The ONION team will look at it.', 2600); }));
  });
  on('block', () => {
    if (!C.me) { authSheet('login'); return; }
    confirmSheet('Block @' + esc(p.author.username) + '?', 'You will not see their posts. You can unblock them on their profile.', 'Block', () => guard(async () => {
      await api.block(p.author.id, true); toast('Blocked'); document.querySelectorAll('#cmFeed .cm-post').forEach(c => { const q = C.feed.posts.find(x => x.id === c.dataset.id); if (q && q.author.id === p.author.id) c.remove(); });
    }));
  });
  on('hide', () => guard(async () => { await api.hidePost(p.id, true); closeSheet(); el.remove(); toast('Hidden'); }));
  on('counts', () => countsSheet(p, el));
  on('odel', () => confirmSheet('Delete this post?', `The post by @${esc(p.author.username)} and its files are deleted for everyone.`, 'Delete', () => guard(async () => { await api.deletePost(p); el.remove(); toast('Post deleted'); })));
  on('ban', () => confirmSheet('Ban @' + esc(p.author.username) + '?', 'Their posts and profile disappear and they cannot post.', 'Ban', () => guard(async () => { await api.ban(p.author.id, true); toast('Banned'); el.remove(); })));
  on('check', () => guard(async () => { await api.setCheck(p.author.id, !p.author.verified); closeSheet(); toast(p.author.verified ? 'Gold cat check removed' : 'Gold cat check given!'); p.author.verified = !p.author.verified; el.innerHTML = cardHtml(p); wireCard(el, p); }));
}

/* the owner sets how many likes and views a post shows (server: onion_owner_set_counts, owner only) */
function countsSheet(p, el) {
  const row = (id, label, val) => `<div class="field"><span>${label}</span><div class="row" style="margin:0;flex-wrap:wrap"><input type="number" id="${id}" min="0" max="1000000000" step="1" value="${val}" style="flex:1;min-width:120px;height:42px;border:2.5px solid var(--ink);background:var(--well);border-radius:12px;padding:0 12px">
    ${[100, 1000, 10000, 100000].map(n => `<button class="btn" data-add="${id}" data-n="${n}">+${nice(n)}</button>`).join('')}</div></div>`;
  const sh = openSheet(`<h2>Likes and views</h2><p class="hint">Only you, the owner of ONION, can change these. Post by @${esc(p.author.username)}.</p>
    ${row('ocLikes', 'Likes', p.like_count)}${row('ocViews', 'Views', p.view_count || 0)}
    <div class="actions"><button class="btn" data-close>Cancel</button><button class="btn primary" id="ocSave">Save</button></div>`);
  sh.querySelectorAll('[data-add]').forEach(b => b.onclick = () => { const i = sh.querySelector('#' + b.dataset.add); i.value = Math.max(0, (+i.value || 0) + (+b.dataset.n)); });
  sh.querySelector('#ocSave').onclick = () => guard(async () => {
    const likes = Math.max(0, Math.round(+sh.querySelector('#ocLikes').value || 0)), views = Math.max(0, Math.round(+sh.querySelector('#ocViews').value || 0));
    await api.ownerSetCounts(p.id, likes, views); p.like_count = likes; p.view_count = views;
    closeSheet(); if (el) { el.innerHTML = cardHtml(p); wireCard(el, p); } toast(`Now ${nice(likes)} likes and ${nice(views)} views`, 2200);
  });
}

/* ---------------------------------------------------------------- drafts (v1.6.1): posts only you can see until you press Post */
function draftsSheet(ds) {
  const sh = openSheet(`<h2>Your drafts</h2><p class="hint">Only you can see these. Open one to finish it.</p>
    <div class="cm-pick">${ds.map((q, i) => `<button class="cm-tile" data-i="${i}"><img alt="" src="${esc(q.poster_url || q.media_url)}"><span>${svg('draft')}${esc((q.caption || 'Draft').slice(0, 30))}</span></button>`).join('')}</div>
    <div class="actions"><button class="btn" data-close>Close</button></div>`);
  sh.querySelectorAll('[data-i]').forEach(b => b.onclick = () => draftSheet(ds[+b.dataset.i]));
}
function draftSheet(p, after) {
  const sh = openSheet(`<h2>Draft</h2>
    <div class="cm-prev"><img alt="" src="${esc(p.poster_url || p.media_url)}"><span class="chip">${svg('draft')} Draft · only you can see it</span></div>
    <label class="field"><span>Caption</span><textarea id="dfCap" maxlength="300">${esc(p.caption || '')}</textarea></label>
    ${p.project_path ? `<label class="check"><input type="checkbox" id="dfRemix" ${p.allow_remix ? 'checked' : ''}> Let people remix it</label>` : ''}
    <label class="field"><span>Collab with (optional)</span><div class="cm-at"><b>@</b><input type="text" id="dfCollab" value="${esc(p.collab_names || '')}" placeholder="friend1, friend2" spellcheck="false" autocomplete="off"></div></label>
    <p class="hint err" id="dfErr" hidden></p>
    <div class="actions"><button class="btn danger" id="dfDel">${svg('trash')}Delete draft</button><span style="flex:1"></span><button class="btn" id="dfSave">Save</button><button class="btn primary" id="dfGo">${svg('paw')}Post it now</button></div>`);
  const vals = () => ({ caption: sh.querySelector('#dfCap').value, allowRemix: sh.querySelector('#dfRemix') ? sh.querySelector('#dfRemix').checked : undefined, collabs: sh.querySelector('#dfCollab').value.split(/[\s,]+/) });
  const err = m => { const e = sh.querySelector('#dfErr'); e.textContent = m; e.hidden = !m; };
  sh.querySelector('#dfSave').onclick = async () => { try { await api.saveDraft(p.id, vals()); closeSheet(); toast('Draft saved', 1400); if (after) after(); } catch (e) { err(api.friendly(e)); } };
  sh.querySelector('#dfGo').onclick = async () => {
    const b = sh.querySelector('#dfGo'); b.disabled = true;
    try {
      const post = await api.publishDraft(p, vals()); closeSheet(); C.me = await api.session();
      toast(post && post.collabNotFound && post.collabNotFound.length ? 'Posted! No account called @' + post.collabNotFound.join(', @') : 'Posted!', 2600);
      await open('new');
    } catch (e) { err(api.friendly(e)); b.disabled = false; }
  };
  sh.querySelector('#dfDel').onclick = () => confirmSheet('Delete this draft?', 'It is gone for good. Your animation in ONION stays.', 'Delete', () => guard(async () => {
    await api.deletePost(p); toast('Draft deleted', 1600); if (after) after(); else if (C.page && C.page.kind === 'profile') { C.page = null; openProfile(C.me.username); }
  }));
}

/* ---------------------------------------------------------------- accounts */
function authSheet(mode = 'login', after) {
  const sh = openSheet(`<h2>${mode === 'login' ? 'Log in to ONION' : 'Make your ONION account'}</h2>
    <div class="seg cm-authtabs"><button data-m="login" class="${mode === 'login' ? 'on' : ''}">Log in</button><button data-m="signup" class="${mode === 'signup' ? 'on' : ''}">New account</button></div>
    ${mode === 'signup' ? `
      <label class="field"><span>Username</span><div class="cm-at"><b>@</b><input type="text" id="auUser" maxlength="20" autocomplete="username" placeholder="catartist" spellcheck="false"></div><small class="hint" id="auUserHint">3-20 letters, numbers, _ or . (this is your public name)</small></label>
      <label class="field"><span>Display name</span><input type="text" id="auName" maxlength="40" placeholder="Cat Artist"></label>` : ''}
    <label class="field"><span>Email</span><input type="text" id="auEmail" autocomplete="email" inputmode="email" spellcheck="false"></label>
    <label class="field"><span>Password</span><input type="password" id="auPass" autocomplete="${mode === 'login' ? 'current-password' : 'new-password'}"></label>
    ${mode === 'signup' ? `<div class="cm-rules"><b>ONION rules</b><ul><li>Be kind. No bullying.</li><li>Post your own art, or remixes of posts that allow it.</li><li>Keep it cute or cartoon-spooky: nothing grown-up, nothing real and gory.</li><li>Never post your address, school, phone or other private info.</li></ul></div>
      <label class="check"><input type="checkbox" id="auAge"> I'm 13 or older and I'll follow the ONION rules</label>` : ''}
    <p class="hint err" id="auErr" hidden></p>
    <div class="actions"><button class="btn" data-close>Cancel</button><button class="btn primary" id="auGo">${mode === 'login' ? 'Log in' : 'Make account'}</button></div>`);
  sh.querySelectorAll('.cm-authtabs button').forEach(b => b.onclick = () => authSheet(b.dataset.m, after));
  const err = m => { const e = sh.querySelector('#auErr'); e.textContent = m; e.hidden = !m; };
  const user = sh.querySelector('#auUser');
  if (user) {
    let t = 0;
    user.oninput = () => { user.value = user.value.toLowerCase().replace(/[^a-z0-9_.]/g, ''); clearTimeout(t); const h = sh.querySelector('#auUserHint');
      if (user.value.length < 3) { h.textContent = '3-20 letters, numbers, _ or . (this is your public name)'; return; }
      t = setTimeout(async () => { const ok = await api.usernameAvailable(user.value).catch(() => null); h.textContent = ok ? '@' + user.value + ' is free!' : ok === false ? '@' + user.value + ' is taken' : ''; h.classList.toggle('good', !!ok); }, 350); };
  }
  sh.querySelector('#auGo').onclick = async () => {
    err('');
    const email = sh.querySelector('#auEmail').value, pass = sh.querySelector('#auPass').value, go = sh.querySelector('#auGo');
    go.disabled = true;
    try {
      if (mode === 'signup') {
        if (!sh.querySelector('#auAge').checked) throw new Error('Tick the box to say you are 13 or older and will follow the rules.');
        C.me = await api.signUp({ email, password: pass, username: user.value, displayName: sh.querySelector('#auName').value });
        toast('Welcome to ONION, @' + C.me.username + '!', 2600);
      } else {
        C.me = await api.signIn(email, pass);
        toast('Hi @' + C.me.username + '!', 1600);
      }
      closeSheet(); renderTop(); startPolling(); O.setUserName(C.me.display_name || C.me.username); if (after) after(); else if (!C.page) switchTab(C.tab);
    } catch (e) { err(api.friendly(e)); } finally { go.disabled = false; }
  };
  setTimeout(() => { const f = sh.querySelector(mode === 'signup' ? '#auUser' : '#auEmail'); if (f) f.focus(); }, 40);
}

/* ---------------------------------------------------------------- profiles */
function showPage(html) {
  pauseAll(); $('#cmFeed').hidden = true; const pg = $('#cmPage'); pg.hidden = false; pg.innerHTML = html; pg.scrollTop = 0;
  $('#cmTabs').querySelectorAll('button').forEach(b => b.classList.remove('on'));
  return pg;
}
async function openProfile(username) {
  if (C.page) C.pageStack.push(C.page);
  C.page = { kind: 'profile', username };
  const pg = showPage(`<div class="cm-loading"><div class="cat-mascot hop">${O.catSvg('cmPl')}</div></div>`);
  await guard(async () => {
    const p = await api.profile(username);
    if (!p) { pg.innerHTML = `<div class="cm-empty"><h2 class="t3d">No one called @${esc(username)}</h2><p>They may have left ONION.</p></div>`; return; }
    const isMe = C.me && C.me.id === p.id;
    const [r, invites, blocked, drafts] = await Promise.all([api.feed({ mode: 'user', userId: p.id, limit: 60 }), isMe ? api.collabInvites() : [], C.me && !isMe ? api.blockedIds() : new Set(), isMe ? api.drafts().catch(() => []) : []]);
    const posts = r.posts;
    pg.innerHTML = `<div class="cm-profile">
      <button class="btn cm-pback">${svg('back')}Back</button>
      <div class="cm-phead ears">
        ${avatar(p, 96)}
        <div class="cm-pinfo"><h2 class="t3d">${esc(p.display_name || p.username)}</h2><div class="cm-handle">@${esc(p.username)}${check(p)}</div>
          ${p.bio ? `<p>${esc(p.bio)}</p>` : ''}
          <div class="cm-stats"><span><b>${nice(p.post_count)}</b> posts</span><span><b>${nice(p.like_count)}</b> likes</span><span><b>${nice(posts.reduce((n, q) => n + (q.view_count || 0), 0))}</b> views</span>${p.trophies ? `<span class="gold ct-trophies">${TROPHY}<b>${nice(p.trophies)}</b> ${p.trophies === 1 ? 'trophy' : 'trophies'}</span>` : ''}${p.is_admin ? '<span class="gold">ONION owner</span>' : ''}${p.verified ? '<span class="gold">Gold cat check</span>' : ''}</div></div>
        <div class="cm-pacts">
          ${isMe ? `<button class="btn primary" id="cmEdit">Edit profile</button>${p.verified ? '' : '<button class="btn gold-btn" id="cmReq">' + CHECK + 'Get the gold cat check</button>'}<button class="btn" id="cmOut">Log out</button>` : ''}
          ${!isMe && C.me ? `<button class="btn" id="cmBlock">${blocked.has(p.id) ? 'Unblock' : 'Block'}</button>` : ''}
          ${!isMe && C.me && C.me.is_admin ? `<button class="btn gold-btn" id="cmGive">${CHECK}${p.verified ? 'Remove check' : 'Give check'}</button><button class="btn danger" id="cmODel">${svg('trash')}Delete account</button>` : ''}
        </div>
      </div>
      ${isMe && drafts.length ? `<div class="sec cm-invites"><h3>Your drafts <span class="mono">${drafts.length}</span></h3><p class="hint">Only you can see these.</p><div class="cm-grid" style="margin-top:10px">${drafts.map((q, i) => `<button class="cm-tile" data-draft="${i}"><img alt="" loading="lazy" src="${esc(q.poster_url || q.media_url)}"><span>${svg('draft')}${esc((q.caption || 'Draft').slice(0, 28))}</span><i class="kind">DRAFT</i></button>`).join('')}</div></div>` : ''}
      ${isMe && invites.length ? `<div class="sec cm-invites"><h3>Collab invites</h3>${invites.map(i => `<div class="cm-inv" data-id="${i.id}"><img alt="" src="${esc(i.poster_url || i.media_url)}"><span>${who(i.author)} wants you on <b>${esc(i.caption || 'their post')}</b></span><button class="btn primary" data-yes>Join</button><button class="btn" data-no>No thanks</button></div>`).join('')}</div>` : ''}
      <div class="cm-grid">${posts.length ? posts.map((q, i) => `<button class="cm-tile" data-i="${i}"><img alt="" loading="lazy" src="${esc(q.poster_url || q.media_url)}"><span>${svg('heart')}${nice(q.like_count)} · ${nice(q.view_count || 0)} views</span>${q.kind === 'video' ? '<i class="kind">▶</i>' : q.kind === 'gif' ? '<i class="kind">GIF</i>' : ''}</button>`).join('') : `<div class="cm-empty small"><p>${isMe ? 'Your posts show up here. Tap Post to share your first one!' : 'No posts yet.'}</p></div>`}</div>
    </div>`;
    pg.querySelector('.cm-pback').onclick = () => back();
    pg.querySelectorAll('[data-user]').forEach(b => b.onclick = () => openProfile(b.dataset.user));
    pg.querySelectorAll('.cm-tile').forEach(t => t.onclick = () => { C.pageStack.push(C.page); C.page = { kind: 'list' }; $('#cmPage').hidden = true; $('#cmFeed').hidden = false; startFeed({ list: posts }, +t.dataset.i); });
    const on = (id, fn) => { const b = pg.querySelector(id); if (b) b.onclick = fn; };
    on('#cmEdit', () => editProfile(p));
    pg.querySelectorAll('[data-draft]').forEach(b => b.onclick = () => draftSheet(drafts[+b.dataset.draft], () => { C.page = null; openProfile(C.me.username); }));
    on('#cmODel', () => {
      const s2 = openSheet(`<h2>Delete @${esc(p.username)}?</h2><p class="hint">Their profile, posts, likes and favorites are deleted for good. This can't be undone.</p>
        <label class="field"><span>Type their username to confirm</span><div class="cm-at"><b>@</b><input type="text" id="odName" spellcheck="false" autocomplete="off"></div></label>
        <div class="actions"><button class="btn" data-close>Cancel</button><button class="btn danger" id="odGo" disabled>Delete account</button></div>`);
      const inp = s2.querySelector('#odName'), go = s2.querySelector('#odGo');
      inp.oninput = () => { go.disabled = inp.value.trim().toLowerCase().replace(/^@/, '') !== p.username; };
      go.onclick = () => guard(async () => { go.disabled = true; await api.ownerDeleteAccount(p.id); closeSheet(); toast('@' + p.username + ' was deleted', 2600); back(); });
      setTimeout(() => inp.focus(), 40);
    });
    on('#cmOut', () => confirmSheet('Log out?', 'You can log back in any time.', 'Log out', () => guard(async () => { await api.signOut(); C.me = null; O.setUserName(''); renderTop(); switchTab('new'); pollNotifs(); toast('Logged out'); })));
    on('#cmReq', () => guard(async () => { const m = await api.requestCheck(); openSheet(`<h2>The gold cat check</h2><div class="cm-goldbig">${CHECK}</div><p class="hint" style="text-align:center">${esc(m)}</p><p class="hint">The gold cat check shows people you are a real ONION artist. Post 5 times and get 50 likes, then ask for it here: an ONION admin says yes.</p><div class="actions"><button class="btn primary" data-close>OK</button></div>`); }));
    on('#cmBlock', () => guard(async () => { const on2 = !blocked.has(p.id); await api.block(p.id, on2); toast(on2 ? 'Blocked' : 'Unblocked'); C.page = null; openProfile(p.username); }));
    on('#cmGive', () => guard(async () => { await api.setCheck(p.id, !p.verified); toast(p.verified ? 'Check removed' : 'Gold cat check given!'); C.page = null; openProfile(p.username); }));
    pg.querySelectorAll('.cm-inv').forEach(row => {
      row.querySelector('[data-yes]').onclick = () => guard(async () => { await api.answerCollab(row.dataset.id, true); row.remove(); toast('You are on the collab!'); });
      row.querySelector('[data-no]').onclick = () => guard(async () => { await api.answerCollab(row.dataset.id, false); row.remove(); });
    });
  });
}
function editProfile(p) {
  const colors = ['#b58cff', '#ff8fd6', '#8ff0c0', '#7cc8ff', '#ffd36b', '#ff6b8b', '#efe6ff', '#2b1a4a'];
  let color = p.avatar_color, pic = null;
  const sh = openSheet(`<h2>Edit profile</h2>
    <div class="cm-editav"><span id="epAv">${avatar(p, 84)}</span><div><div class="cm-colors">${colors.map(c => `<button data-c="${c}" style="--c:${c}" class="${c === color ? 'on' : ''}" aria-label="Cat colour ${c}"></button>`).join('')}</div>
      <button class="btn" id="epPic">${svg('upload')}Use a picture</button></div></div>
    <label class="field"><span>Display name</span><input type="text" id="epName" maxlength="40" value="${esc(p.display_name)}"></label>
    <label class="field"><span>Bio</span><textarea id="epBio" maxlength="200" placeholder="I draw spooky cats">${esc(p.bio)}</textarea></label>
    <input type="file" id="epFile" accept="image/png,image/jpeg,image/webp" hidden>
    <div class="actions"><button class="btn danger" id="epDel">Delete account</button><span style="flex:1"></span><button class="btn" data-close>Cancel</button><button class="btn primary" id="epSave">Save</button></div>`);
  sh.querySelectorAll('.cm-colors button').forEach(b => b.onclick = () => { color = b.dataset.c; pic = null; sh.querySelectorAll('.cm-colors button').forEach(x => x.classList.toggle('on', x === b)); sh.querySelector('#epAv').innerHTML = avatar({ avatar_color: color }, 84); });
  sh.querySelector('#epPic').onclick = () => sh.querySelector('#epFile').click();
  sh.querySelector('#epFile').onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    const img = await createImageBitmap(f), s = 256, c = document.createElement('canvas'); c.width = s; c.height = s;
    const k = Math.max(s / img.width, s / img.height), cx = c.getContext('2d'); cx.drawImage(img, (s - img.width * k) / 2, (s - img.height * k) / 2, img.width * k, img.height * k);
    pic = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.88));
    sh.querySelector('#epAv').innerHTML = `<span class="cm-av" style="width:84px;height:84px"><img alt="" src="${URL.createObjectURL(pic)}"></span>`;
  };
  sh.querySelector('#epSave').onclick = () => guard(async () => {
    C.me = await api.updateProfile({ display_name: sh.querySelector('#epName').value.trim(), bio: sh.querySelector('#epBio').value.trim(), avatar_color: color }, pic);
    closeSheet(); renderTop(); C.page = null; openProfile(C.me.username); toast('Profile saved');
  });
  sh.querySelector('#epDel').onclick = () => confirmSheet('Delete your ONION account?', 'Your profile, posts, likes and favorites are deleted for good. Your animations on this device stay.', 'Delete forever', () => guard(async () => {
    await api.deleteAccount(); C.me = null; renderTop(); switchTab('new'); toast('Your account is deleted');
  }));
}

/* ---------------------------------------------------------------- search */
function searchSheet() {
  const sh = openSheet(`<h2>Find artists</h2><label class="field"><div class="cm-at"><b>@</b><input type="text" id="sqIn" placeholder="username" spellcheck="false" autocomplete="off"></div></label><div class="cm-results" id="sqOut"></div><div class="actions"><button class="btn" data-close>Close</button></div>`);
  const inp = sh.querySelector('#sqIn'), out = sh.querySelector('#sqOut'); let t = 0;
  inp.oninput = () => { clearTimeout(t); t = setTimeout(() => guard(async () => {
    const r = await api.search(inp.value);
    out.innerHTML = r.length ? r.map(p => `<button class="list-btn cm-res" data-user="${esc(p.username)}">${avatar(p, 40)}<span><b>${esc(p.display_name || p.username)}</b><small>@${esc(p.username)} · ${nice(p.like_count)} likes</small></span>${check(p)}</button>`).join('') : (inp.value ? '<p class="hint">No one found.</p>' : '');
    out.querySelectorAll('[data-user]').forEach(b => b.onclick = () => { closeSheet(); openProfile(b.dataset.user); });
  }), 250); };
  setTimeout(() => inp.focus(), 40);
}

/* ---------------------------------------------------------------- posting */
function postMenu() {
  if (!C.me) { authSheet('login', postMenu); return; }
  const projects = (O.S.projects || []).slice().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  const sh = openSheet(`<h2>Post to ONION</h2>
    <div class="cm-menu" id="pmDrafts"></div>
    <div class="cm-menu">
      <button class="list-btn" id="pmFile">${svg('upload')}<span><b>A picture, GIF or video from this device</b><small>Art, photos, GIFs or MP4 videos (up to 50 MB)</small></span></button>
    </div>
    <div class="field"><span>Or one of your animations</span><div class="cm-pick">${projects.map(p => `<button class="cm-tile" data-id="${esc(p.id)}">${p.thumb ? `<img alt="" src="${p.thumb}">` : ''}<span>${esc(p.name || 'Untitled')}</span></button>`).join('') || '<p class="hint">Make an animation first.</p>'}</div></div>
    <input type="file" id="pmIn" accept="image/png,image/jpeg,image/gif,image/webp,video/mp4" hidden>
    <div class="actions"><button class="btn" data-close>Cancel</button></div>`);
  sh.querySelector('#pmFile').onclick = () => sh.querySelector('#pmIn').click();
  api.drafts().then(ds => {
    const box = sh.querySelector('#pmDrafts'); if (!box || !ds.length) return;
    box.innerHTML = `<button class="list-btn">${svg('draft')}<span><b>Your drafts (${ds.length})</b><small>Finish one and post it, or delete it</small></span></button>`;
    box.querySelector('button').onclick = () => draftsSheet(ds);
  }).catch(() => {});
  sh.querySelector('#pmIn').onchange = e => { const f = e.target.files[0]; if (f) postFile(f); };
  sh.querySelectorAll('.cm-pick .cm-tile').forEach(t => t.onclick = async () => {
    closeSheet(); $('#community').hidden = true; document.documentElement.classList.remove('in-community'); pauseAll();
    await O.openProject(t.dataset.id); setTimeout(() => postSheet(), 300);
  });
}
async function mediaInfo(file) {
  if (file.type === 'video/mp4') {
    const v = document.createElement('video'); v.muted = true; v.preload = 'auto'; v.src = URL.createObjectURL(file);
    await new Promise((res, rej) => { v.onloadeddata = res; v.onerror = () => rej(new Error('That video could not be opened.')); });
    v.currentTime = Math.min(0.2, v.duration / 2 || 0); await new Promise(r => { v.onseeked = r; setTimeout(r, 1500); });
    const k = Math.min(1, 960 / v.videoWidth), c = document.createElement('canvas'); c.width = Math.round(v.videoWidth * k); c.height = Math.round(v.videoHeight * k);
    c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
    return { kind: 'video', width: v.videoWidth, height: v.videoHeight, duration: v.duration || 0, poster: await new Promise(r => c.toBlob(r, 'image/jpeg', 0.86)), media: file };
  }
  const img = await createImageBitmap(file);
  if (file.type === 'image/gif') {
    const k = Math.min(1, 960 / img.width), c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return { kind: 'gif', width: img.width, height: img.height, poster: await new Promise(r => c.toBlob(r, 'image/jpeg', 0.86)), media: file };
  }
  let media = file;
  if (file.type === 'image/webp' || file.size > 15e6) {   // re-encode big or webp pictures
    const k = Math.min(1, 2560 / Math.max(img.width, img.height)), c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); media = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.9));
  }
  return { kind: 'image', width: img.width, height: img.height, media };
}
async function postFile(file) {
  if (file.size > 50 * 1024 * 1024) { toast('That file is too big (50 MB at most).'); return; }
  const info = await guard(() => mediaInfo(file)); if (!info) return;
  postSheet({ info, preview: URL.createObjectURL(info.poster || info.media) });
}
/** from the editor (no args) or with a picked file */
async function postSheet(given) {
  if (!READY) { toast('This ONION is not connected to the community yet.'); return; }
  if (!C.me) { await guard(async () => { C.me = await api.session(); }); }
  if (!C.me) { authSheet('login', () => postSheet(given)); return; }
  const P = !given && O.S.proj, frames = P ? P.frames.length : 0;
  const kindName = given ? { video: 'Video', gif: 'GIF', image: 'Picture' }[given.info.kind] : frames > 1 ? 'Video' : 'Picture';
  let preview = given ? given.preview : URL.createObjectURL(await O.posterOf(720));
  const remixOf = P && P.remixOf;
  const sh = openSheet(`<h2>Post to ONION</h2>
    <div class="cm-prev"><img alt="" src="${preview}"><span class="chip">${kindName}${P && frames > 1 ? ' · ' + frames + ' drawings' : ''}</span></div>
    ${remixOf ? `<p class="cm-chip remix">${svg('remix')}Remix of @${esc(remixOf.username)}: they get the credit too</p>` : ''}
    <label class="field"><span>Caption</span><textarea id="psCap" maxlength="300" placeholder="Say something about it #cats">${P ? esc(P.name || '') : ''}</textarea></label>
    ${P ? `<label class="check"><input type="checkbox" id="psRemix" checked> Let people remix it (they get your drawings to build on, and you get credit)</label>` : ''}
    <label class="field"><span>Collab with (optional)</span><div class="cm-at"><b>@</b><input type="text" id="psCollab" placeholder="friend1, friend2" spellcheck="false" autocomplete="off"></div><small class="hint">They get an invite. Once they say yes, the post shows on their profile too.</small></label>
    <p class="hint">Everyone on ONION can see your post. Follow the ONION rules.</p>
    <div class="progress" id="psBarBox" hidden><i id="psBar"></i></div><p class="hint" id="psMsg"></p>
    <div class="actions"><button class="btn" data-close>Cancel</button><button class="btn" id="psDraft">${svg('draft')}Save as draft</button><button class="btn primary" id="psGo">${svg('paw')}Post it</button></div>`);
  sh.querySelector('#psDraft').onclick = () => send(true);
  sh.querySelector('#psGo').onclick = () => send(false);
  const send = async draft => {
    const go = sh.querySelector('#psGo'), dr = sh.querySelector('#psDraft'), bar = sh.querySelector('#psBar'), msg = sh.querySelector('#psMsg');
    go.disabled = true; dr.disabled = true; sh.querySelector('#psBarBox').hidden = false;
    const step = (t, p) => { msg.textContent = t; bar.style.width = Math.round(p * 100) + '%'; };
    try {
      let job;
      if (given) job = { ...given.info };
      else if (frames > 1) {
        step('Making the video…', 0.02);
        const v = await O.makePostVideo(p => step('Making the video…', p * 0.6));
        job = { kind: 'video', media: v.blob, width: v.width, height: v.height, duration: v.duration, poster: await O.posterOf(960) };
      } else {
        step('Getting the picture ready…', 0.2);
        job = { kind: 'image', media: await O.pictureOf(), width: P.w, height: P.h };
      }
      const allowRemix = P ? sh.querySelector('#psRemix').checked : false;
      if (P && allowRemix) { step('Packing your drawings for remixes…', 0.62); job.project = (await O.packProject(P.id)).blob; }
      const post = await api.post({ ...job, caption: sh.querySelector('#psCap').value, allowRemix, remixOf: remixOf ? remixOf.post : null, draft,
        collabs: sh.querySelector('#psCollab').value.split(/[\s,]+/), onProgress: p => step('Uploading…', 0.65 + p * 0.35) });
      closeSheet();
      if (draft) toast('Saved to your drafts. Only you can see it until you post it.', 3200);
      else if (post && post.collabNotFound && post.collabNotFound.length) toast('Posted! No account called @' + post.collabNotFound.join(', @'), 4000);
      else toast('Posted!', 2000);
      C.me = await api.session();
      if (O.S.proj) await O.closeProject();
      if (draft) { await open(); C.page = null; openProfile(C.me.username); } else open('new');
    } catch (e) {
      console.warn(e); msg.textContent = api.friendly(e); go.disabled = false; dr.disabled = false; sh.querySelector('#psBarBox').hidden = true;
    }
  };
}

/* ---------------------------------------------------------------- contests and voting (v1.7)
   The owner starts a contest (theme + how long entering and voting last). People enter ONE of their posts, then everyone
   gets ONE vote (changeable until voting ends, never for their own entry). Most votes wins; the winner gets a trophy. */
const TROPHY = '<svg class="trophy" viewBox="0 0 64 64" role="img" aria-label="Trophy"><title>Trophy</title><path fill="url(#goldCat)" stroke="#2a1500" stroke-width="4" stroke-linejoin="round" d="M18 8h28v14c0 9-6 16-14 16s-14-7-14-16z"/><path fill="none" stroke="#2a1500" stroke-width="4" stroke-linecap="round" d="M18 13H9c0 8 4 13 10 14M46 13h9c0 8-4 13-10 14"/><path fill="url(#goldCat)" stroke="#2a1500" stroke-width="4" stroke-linejoin="round" d="M27 38h10v8H27zM19 56c0-6 6-10 13-10s13 4 13 10z"/><path d="M24 11l3-4 3 4M34 11l3-4 3 4" fill="#ffd23f" stroke="#2a1500" stroke-width="2.5" stroke-linejoin="round"/><circle cx="28" cy="20" r="2.2" fill="#2a1500"/><circle cx="36" cy="20" r="2.2" fill="#2a1500"/><path d="M29 26q3 3 6 0" fill="none" stroke="#2a1500" stroke-width="2.4" stroke-linecap="round"/></svg>';
const PHASE = { enter: ['Taking entries', 'var(--slime)'], vote: ['Voting now', 'var(--pink)'], done: ['Finished', '#ffd23f'] };
function left(t) {
  const s = Math.max(0, (new Date(t).getTime() - Date.now()) / 1000);
  if (s < 60) return 'less than a minute';
  const d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60);
  return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`;
}
function phaseLine(c) {
  if (c.phase === 'enter') return `Entries close in <b>${left(c.entry_ends)}</b>, then voting runs for ${left2(c.entry_ends, c.vote_ends)}`;
  if (c.phase === 'vote') return `Voting ends in <b>${left(c.vote_ends)}</b>`;
  return c.winner ? `Won by ${who(c.winner)}` : c.finished ? 'No entries this time' : 'Counting the votes…';
}
function left2(a, b) { const s = (new Date(b) - new Date(a)) / 1000, d = Math.floor(s / 86400), h = Math.round(s % 86400 / 3600); return d ? (h ? `${d}d ${h}h` : `${d} day${d > 1 ? 's' : ''}`) : `${Math.max(1, h)}h`; }
const coverCache = {};
function coverUrl(scene) {
  if (coverCache[scene]) return coverCache[scene];
  try {
    const c = document.createElement('canvas'); c.width = 640; c.height = 300;
    const cx = c.getContext('2d');
    if (window.OnionArt) { window.OnionArt.drawScene(scene || 'stage', cx, 640, 300); if (scene === 'stage') window.OnionArt.drawCurtains(cx, 640, 300, 0.78, {}); }
    else { cx.fillStyle = '#2b1a4a'; cx.fillRect(0, 0, 640, 300); }
    return (coverCache[scene] = c.toDataURL('image/jpeg', 0.82));
  } catch (e) { return ''; }
}
function contestCard(c) {
  const ph = PHASE[c.phase];
  const pic = c.phase === 'done' && c.winner_post && c.winner_post.poster_url ? c.winner_post.poster_url : coverUrl(c.scene);
  return `<div class="ct-card ears" role="button" tabindex="0" data-cid="${c.id}">
    <span class="ct-cover"><img alt="" src="${esc(pic)}">${c.phase === 'done' && c.winner ? `<span class="ct-won">${TROPHY}</span>` : ''}<i class="ct-phase" style="--c:${ph[1]}">${ph[0]}</i></span>
    <span class="ct-body"><b class="ct-title">${esc(c.title)}</b>${c.prompt ? `<span class="ct-prompt">${esc(c.prompt)}</span>` : ''}
      <span class="ct-line">${phaseLine(c)}</span>
      <span class="ct-meta"><span>${svg('film')}${nice(c.entry_count)} ${c.entry_count === 1 ? 'entry' : 'entries'}</span><span>${svg('vote')}${nice(c.vote_count)} votes</span>
        ${c.myEntry ? '<span class="ct-you">You entered</span>' : ''}${c.myVote ? '<span class="ct-you">You voted</span>' : ''}</span></span></div>`;
}
async function openContests() {
  C.page = { kind: 'contests' };
  const pg = showPage(`<div class="cm-loading"><div class="cat-mascot hop">${O.catSvg('ctL')}</div></div>`);
  const tb = $('#cmTabs').querySelector('[data-tab="contests"]'); if (tb) tb.classList.add('on');
  await guard(async () => {
    const list = await api.contests();
    if (C.page.kind !== 'contests') return;
    const admin = C.me && C.me.is_admin;
    if (!api.contestsReady()) {
      pg.innerHTML = `<div class="cm-empty"><div class="cat-mascot">${O.catSvg('ctOff')}</div><h2 class="t3d">Contests are almost here</h2><p>${admin ? 'Run the ONION 1.7 server update (onion-schema-1.7.sql) in the Supabase SQL editor to switch contests on.' : 'The ONION owner is switching them on. Check back soon!'}</p></div>`;
      return;
    }
    const open = list.filter(c => c.phase !== 'done'), done = list.filter(c => c.phase === 'done');
    pg.innerHTML = `<div class="ct-wrap">
      <div class="ct-hero ears"><span class="ct-bigtrophy">${TROPHY}</span><div><h2 class="t3d">ONION Contests</h2><p>Enter your best animation, vote for your favourite, and win a trophy for your profile.</p></div>
        ${admin ? `<button class="btn gold-btn" id="ctNew">${svg('plus')}Start a contest</button>` : ''}</div>
      ${open.length ? `<h3 class="ct-h">Open now</h3><div class="ct-list">${open.map(contestCard).join('')}</div>` : `<div class="cm-empty small"><p>${admin ? 'No contest is running. Start one: everyone gets a notification.' : 'No contest is running right now. The ONION owner starts new ones, and you get a notification when they do.'}</p></div>`}
      ${done.length ? `<h3 class="ct-h">Winners</h3><div class="ct-list">${done.map(contestCard).join('')}</div>` : ''}
    </div>`;
    pg.querySelectorAll('[data-cid]').forEach(b => b.onclick = e => { if (e.target.closest('[data-user]')) return; openContest(b.dataset.cid); });
    pg.querySelectorAll('[data-cid]').forEach(b => b.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openContest(b.dataset.cid); } });
    pg.querySelectorAll('[data-user]').forEach(b => b.onclick = e => { e.stopPropagation(); openProfile(b.dataset.user); });
    const nb = pg.querySelector('#ctNew'); if (nb) nb.onclick = () => newContestSheet();
    // finish contests whose voting time is over (the server checks the time)
    for (const c of list) if (c.phase === 'done' && !c.finished) api.finishContest(c.id).then(() => { if (C.page.kind === 'contests') openContests(); }).catch(() => {});
  });
}
function newContestSheet() {
  const scenes = (window.OnionArt && window.OnionArt.SCENES) || [{ id: 'stage', name: 'Theatre stage' }];
  let scene = 'stage';
  const ideas = ['Spooky cats', 'My pet as a superhero', 'Walk cycle showdown', 'Under the sea', 'A tiny monster', 'Best 3-second loop', 'Snow day', 'Space cat'];
  const sh = openSheet(`<h2>Start a contest</h2><p class="hint">Only you, the owner, can start contests. Everyone gets a notification.</p>
    <label class="field"><span>Name</span><input type="text" id="ncTitle" maxlength="60" placeholder="${esc(ideas[Math.floor(Math.random() * ideas.length)])}"></label>
    <label class="field"><span>The challenge (what to make)</span><textarea id="ncPrompt" maxlength="300" placeholder="Animate a cat doing something spooky. Any length, any style!"></textarea></label>
    <div class="field"><span>Cover</span><div class="ct-scenes">${scenes.map(s => `<button data-s="${s.id}" class="${s.id === scene ? 'on' : ''}" title="${esc(s.name)}"><img alt="${esc(s.name)}" src="${coverUrl(s.id)}"></button>`).join('')}</div></div>
    <div class="row" style="gap:12px;flex-wrap:wrap">
      <label class="field" style="flex:1;min-width:150px"><span>Entering lasts</span><select id="ncEnter">${[['0.0417', '1 hour'], ['1', '1 day'], ['2', '2 days'], ['3', '3 days'], ['5', '5 days'], ['7', '1 week'], ['14', '2 weeks']].map(([v, n]) => `<option value="${v}" ${v === '3' ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
      <label class="field" style="flex:1;min-width:150px"><span>Then voting lasts</span><select id="ncVote">${[['0.0417', '1 hour'], ['1', '1 day'], ['2', '2 days'], ['3', '3 days'], ['7', '1 week']].map(([v, n]) => `<option value="${v}" ${v === '2' ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
    </div>
    <p class="hint err" id="ncErr" hidden></p>
    <div class="actions"><button class="btn" data-close>Cancel</button><button class="btn gold-btn" id="ncGo">${svg('trophy')}Start it</button></div>`);
  sh.querySelectorAll('.ct-scenes button').forEach(b => b.onclick = () => { scene = b.dataset.s; sh.querySelectorAll('.ct-scenes button').forEach(x => x.classList.toggle('on', x === b)); });
  sh.querySelector('#ncGo').onclick = async () => {
    const t = sh.querySelector('#ncTitle'), e = sh.querySelector('#ncErr'), go = sh.querySelector('#ncGo');
    const title = t.value.trim() || t.placeholder;
    go.disabled = true;
    try {
      const id = await api.createContest({ title, prompt: sh.querySelector('#ncPrompt').value.trim(), scene, entryDays: +sh.querySelector('#ncEnter').value, voteDays: +sh.querySelector('#ncVote').value });
      closeSheet(); toast('Contest started! Everyone got a notification.', 2800); openContest(id);
    } catch (err) { e.textContent = api.friendly(err); e.hidden = false; go.disabled = false; }
  };
  setTimeout(() => sh.querySelector('#ncTitle').focus(), 40);
}
async function openContest(id) {
  if (C.page && !['contest', 'contest-reload'].includes(C.page.kind)) C.pageStack.push(C.page);
  C.page = { kind: 'contest', id };
  const pg = showPage(`<div class="cm-loading"><div class="cat-mascot hop">${O.catSvg('ctP')}</div></div>`);
  await guard(async () => {
    let c = await api.contest(id);
    if (c && c.phase === 'done' && !c.finished) { await api.finishContest(id).catch(() => {}); c = await api.contest(id); }
    if (C.page.kind !== 'contest' || C.page.id !== id) return;
    if (!c) { pg.innerHTML = `<div class="cm-empty"><h2 class="t3d">That contest is gone</h2></div>`; return; }
    const admin = C.me && C.me.is_admin, E = c.entries, ph = PHASE[c.phase];
    const canVote = c.phase === 'vote';
    const tile = (p, i) => {
      const mine = p.mine, voted = c.myVote === p.id, win = c.winner_post && (c.winner_post.id || c.winner_post) === p.id;
      return `<div class="ct-entry ${voted ? 'voted' : ''} ${win ? 'win' : ''}" data-i="${i}">
        <button class="cm-tile ct-pic" data-open="${i}"><img alt="" loading="lazy" src="${esc(p.poster_url || p.media_url)}">${p.kind === 'video' ? '<i class="kind">▶</i>' : p.kind === 'gif' ? '<i class="kind">GIF</i>' : ''}${win ? `<span class="ct-won">${TROPHY}</span>` : ''}${c.phase !== 'enter' && i < 3 && p.votes ? `<b class="ct-rank r${i + 1}">${i + 1}</b>` : ''}</button>
        <div class="ct-erow">${avatar(p.author, 30)}<span>${who(p.author)}</span><span class="ct-votes">${svg('vote')}${nice(p.votes)}</span></div>
        <div class="ct-eacts">
          ${canVote && !mine ? `<button class="btn ${voted ? 'gold-btn' : 'primary'}" data-vote="${i}">${voted ? svg('check') + 'Your vote' : svg('vote') + 'Vote'}</button>` : ''}
          ${canVote && mine ? '<span class="hint">Your entry</span>' : ''}
          ${admin && c.phase !== 'done' ? `<button class="btn" data-crown="${i}" title="Owner: make this the winner now">${svg('trophy')}Crown</button>` : ''}
          ${admin ? `<button class="btn danger" data-rm="${i}" title="Owner: remove this entry">${svg('trash')}</button>` : ''}
        </div></div>`;
    };
    pg.innerHTML = `<div class="ct-wrap">
      <button class="btn cm-pback">${svg('back')}Back</button>
      <div class="ct-head ears" style="--cover:url('${coverUrl(c.scene)}')">
        <div class="ct-headtx"><i class="ct-phase" style="--c:${ph[1]}">${ph[0]}</i><h2 class="t3d">${esc(c.title)}</h2>${c.prompt ? `<p>${esc(c.prompt)}</p>` : ''}
          <div class="ct-line">${phaseLine(c)}</div>
          <div class="ct-meta"><span>${svg('film')}${nice(c.entry_count)} entries</span><span>${svg('vote')}${nice(c.vote_count)} votes</span></div></div>
        <div class="ct-headacts">
          ${c.phase === 'enter' ? `<button class="btn primary" id="ctEnter">${svg('plus')}${c.myEntry ? 'Change my entry' : 'Enter this contest'}</button>${c.myEntry ? '<button class="btn" id="ctLeave">Take my entry out</button>' : ''}` : ''}
          ${c.phase === 'vote' && c.myVote ? '<button class="btn" id="ctUnvote">Take back my vote</button>' : ''}
          ${admin && c.phase === 'enter' ? `<button class="btn admin" id="ctStartVote">${svg('vote')}Owner: start voting now</button>` : ''}
          ${admin && c.phase !== 'done' ? `<button class="btn gold-btn" id="ctEnd">${svg('trophy')}Owner: end it, most votes wins</button>` : ''}
          ${admin ? `<button class="btn danger" id="ctDel">${svg('trash')}Owner: delete contest</button>` : ''}
        </div>
      </div>
      ${c.phase === 'done' && c.winner && E[0] ? `<div class="ct-winner ears"><span class="ct-bigtrophy">${TROPHY}</span><div><small>The winner</small><h3 class="t3d">${esc(c.winner.display_name || c.winner.username)}</h3><div>${who(c.winner)} · ${nice((E.find(p => p.id === (c.winner_post && (c.winner_post.id || c.winner_post))) || {}).votes || 0)} votes</div></div></div>` : ''}
      ${c.phase === 'enter' ? '<p class="hint ct-tip">Entries are shown newest last. Voting opens when entering ends: one vote each, and you can change it until voting ends.</p>' : ''}
      ${c.phase === 'vote' ? `<p class="hint ct-tip">${C.me ? 'Tap Vote on your favourite. You get one vote and can move it until voting ends.' : 'Log in to vote.'}</p>` : ''}
      <div class="ct-entries">${E.length ? E.map(tile).join('') : `<div class="cm-empty small"><div class="cat-mascot">${O.catSvg('ctE')}</div><p>${c.phase === 'enter' ? 'No entries yet. Be the first!' : 'Nobody entered this one.'}</p></div>`}</div>
    </div>`;
    pg.querySelector('.cm-pback').onclick = () => back();
    pg.querySelectorAll('[data-user]').forEach(b => b.onclick = () => openProfile(b.dataset.user));
    pg.querySelectorAll('[data-open]').forEach(b => b.onclick = () => { C.pageStack.push(C.page); C.page = { kind: 'list' }; $('#cmPage').hidden = true; $('#cmFeed').hidden = false; startFeed({ list: E }, +b.dataset.open); });
    const re = () => { C.page = { kind: 'contest-reload' }; openContest(id); };
    pg.querySelectorAll('[data-vote]').forEach(b => b.onclick = () => {
      if (!C.me) { authSheet('login', re); return; }
      const p = E[+b.dataset.vote]; if (c.myVote === p.id) return;
      guard(async () => { await api.vote(id, p.id); toast(c.myVote ? 'Vote moved to @' + p.author.username : 'Voted for @' + p.author.username + '!', 1800); re(); });
    });
    pg.querySelectorAll('[data-crown]').forEach(b => b.onclick = () => { const p = E[+b.dataset.crown]; confirmSheet('Crown @' + esc(p.author.username) + '?', 'The contest ends now and this entry wins the trophy.', 'Crown', () => guard(async () => { await api.crown(id, p.id); toast('@' + p.author.username + ' won!', 2400); re(); })); });
    pg.querySelectorAll('[data-rm]').forEach(b => b.onclick = () => { const p = E[+b.dataset.rm]; confirmSheet('Remove this entry?', `@${esc(p.author.username)}'s entry and its votes leave the contest. The post stays.`, 'Remove', () => guard(async () => { await api.removeEntry(id, p.id); re(); })); });
    const on = (sel, fn) => { const b = pg.querySelector(sel); if (b) b.onclick = fn; };
    on('#ctEnter', () => { if (!C.me) { authSheet('login', re); return; } enterSheet(c, re); });
    on('#ctLeave', () => confirmSheet('Take your entry out?', 'You can enter again while entries are open.', 'Take it out', () => guard(async () => { await api.leaveContest(id); re(); })));
    on('#ctUnvote', () => guard(async () => { await api.unvote(id); toast('Vote taken back', 1400); re(); }));
    on('#ctStartVote', () => confirmSheet('Start voting now?', 'Entering closes now and everyone can vote.', 'Start voting', () => guard(async () => { await api.startVoting(id); re(); })));
    on('#ctEnd', () => confirmSheet('End the contest now?', 'Voting closes and the entry with the most votes wins the trophy.', 'End it', () => guard(async () => { await api.finishContest(id); re(); })));
    on('#ctDel', () => confirmSheet('Delete this contest?', 'The contest and its votes are gone for everyone (the posts stay). A winner loses this trophy.', 'Delete', () => guard(async () => { await api.deleteContest(id); toast('Contest deleted'); C.page = null; openContests(); })));
  });
}
async function enterSheet(c, after) {
  const sh = openSheet(`<h2>Enter “${esc(c.title)}”</h2><p class="hint">Pick one of your posts. You can change it until entries close.</p>
    <div class="cm-pick" id="enPick"><div class="cm-loading" style="min-height:120px"><div class="cat-mascot hop">${O.catSvg('enL')}</div></div></div>
    <div class="cm-menu" style="margin-top:10px"><button class="list-btn" id="enNew">${svg('upload')}<span><b>Post something new first</b><small>Then come back and enter it</small></span></button></div>
    <div class="actions"><button class="btn" data-close>Cancel</button></div>`);
  sh.querySelector('#enNew').onclick = () => { closeSheet(); postMenu(); };
  const mine = await guard(() => api.myPosts()); if (!mine) return;
  const box = sh.querySelector('#enPick'); if (!box) return;
  box.innerHTML = mine.length ? mine.map((q, i) => `<button class="cm-tile ${c.myEntry === q.id ? 'on' : ''}" data-i="${i}"><img alt="" src="${esc(q.poster_url || q.media_url)}"><span>${c.myEntry === q.id ? svg('check') + 'Entered' : esc((q.caption || 'Post').slice(0, 26))}</span></button>`).join('')
    : '<p class="hint">You have no posts yet. Post an animation first.</p>';
  box.querySelectorAll('[data-i]').forEach(b => b.onclick = () => guard(async () => { await api.enterContest(c.id, mine[+b.dataset.i].id); closeSheet(); toast('You are in the contest! Good luck!', 2400); after && after(); }));
}

/* ---------------------------------------------------------------- admin */
async function openAdmin() {
  C.page = { kind: 'admin' };
  const pg = showPage(`<div class="cm-loading"><div class="cat-mascot hop">${O.catSvg('cmAd')}</div></div>`);
  $('#cmTabs').querySelector('[data-tab="admin"]').classList.add('on');
  await guard(async () => {
    const [reqs, reps, gold] = await Promise.all([api.checkRequests(), api.reports(), api.verifiedPeople()]);
    pg.innerHTML = `<div class="cm-admin">
      <div class="sec"><h3>Contests</h3><p class="hint">Start a themed challenge: people enter their animations, everyone votes, the winner gets a trophy.</p><div class="actions" style="margin-top:8px;justify-content:flex-start"><button class="btn gold-btn" id="adContest">${svg('trophy')}Start a contest</button><button class="btn" id="adContests">See all contests</button></div></div>
      <div class="sec"><h3>Send a notification to everyone</h3><p class="hint">Only you, the owner, can do this. Everyone on ONION gets it in their notifications.</p>
        <label class="field" style="margin-top:8px"><textarea id="anMsg" maxlength="500" placeholder="ONION 1.6 is here: try the new Elements brushes!"></textarea></label>
        <div class="actions" style="margin-top:8px"><button class="btn primary" id="anSend">${svg('bell')}Send to everyone</button></div></div>
      <div class="sec"><h3>Gold cat check requests <span class="mono">${reqs.length}</span></h3>${reqs.map(p => `<div class="cm-arow" data-id="${p.id}">${avatar(p, 40)}<span>${who(p)} · ${nice(p.post_count)} posts · ${nice(p.like_count)} likes</span><button class="btn gold-btn" data-yes>${CHECK}Give</button><button class="btn" data-no>No</button></div>`).join('') || '<p class="hint">No requests right now.</p>'}</div>
      <div class="sec"><h3>Reports <span class="mono">${reps.length}</span></h3>${reps.map(r => r.post ? `<div class="cm-arow rep" data-id="${r.id}" data-post="${r.post.id}" data-author="${r.post.author ? r.post.author.id : ''}"><img alt="" src="${esc(r.post.poster_url || r.post.media_url || '')}"><span><b>${esc(r.reason || 'Report')}</b><small>by @${esc(r.reporter ? r.reporter.username : '?')} · post by ${r.post.author ? who(r.post.author) : '?'}</small></span><button class="btn" data-view>View</button><button class="btn danger" data-hide>Hide post</button><button class="btn danger" data-ban>Ban</button><button class="btn" data-ok>Dismiss</button></div>` : '').join('') || '<p class="hint">No reports. Everyone is being nice.</p>'}</div>
      <div class="sec"><h3>People with the gold cat check <span class="mono">${gold.length}</span></h3><div class="cm-goldlist">${gold.map(p => `<span class="cm-chip">${who(p)}<button class="x" data-unc="${p.id}" title="Remove the check">×</button></span>`).join('')}</div></div>
    </div>`;
    pg.querySelectorAll('[data-user]').forEach(b => b.onclick = () => openProfile(b.dataset.user));
    pg.querySelector('#adContest').onclick = () => newContestSheet();
    pg.querySelector('#adContests').onclick = () => switchTab('contests');
    pg.querySelector('#anSend').onclick = () => {
      const m = pg.querySelector('#anMsg').value.trim(); if (!m) { toast('Write a message first.'); return; }
      confirmSheet('Send to everyone?', '“' + esc(m) + '” goes to every ONION account.', 'Send', () => guard(async () => { const n = await api.announce(m); pg.querySelector('#anMsg').value = ''; toast('Sent to ' + n + ' people', 2600); pollNotifs(); }));
    };
    pg.querySelectorAll('.cm-arow:not(.rep)').forEach(row => {
      row.querySelector('[data-yes]').onclick = () => guard(async () => { await api.setCheck(row.dataset.id, true); row.remove(); toast('Gold cat check given!'); });
      row.querySelector('[data-no]').onclick = () => guard(async () => { await api.setCheck(row.dataset.id, false); row.remove(); });
    });
    pg.querySelectorAll('.cm-arow.rep').forEach(row => {
      const r = reps.find(x => String(x.id) === row.dataset.id);
      row.querySelector('[data-view]').onclick = () => { C.pageStack.push(C.page); C.page = { kind: 'list' }; $('#cmPage').hidden = true; $('#cmFeed').hidden = false; startFeed({ list: [r.post] }); };
      row.querySelector('[data-hide]').onclick = () => guard(async () => { await api.hidePost(row.dataset.post, true); row.remove(); toast('Post hidden'); });
      row.querySelector('[data-ban]').onclick = () => confirmSheet('Ban this person?', 'Their posts and profile disappear and they cannot post.', 'Ban', () => guard(async () => { await api.ban(row.dataset.author, true); await api.dismissReport(row.dataset.id); row.remove(); toast('Banned'); }));
      row.querySelector('[data-ok]').onclick = () => guard(async () => { await api.dismissReport(row.dataset.id); row.remove(); });
    });
    pg.querySelectorAll('[data-unc]').forEach(b => b.onclick = () => guard(async () => { await api.setCheck(b.dataset.unc, false); b.parentElement.remove(); toast('Check removed'); }));
  });
}

/* ---------------------------------------------------------------- notifications (v1.6)
   Community notifications come from the server (likes, favorites, remixes, collabs, the gold cat check, news from the owner;
   the owner also gets check requests and reports). ONION's own notes (updates, exports, films from Claude) live on this device.
   The bell shows how many are unread; new ones pop up as a banner, or as a system notification when ONION is in the background. */
const NT = { list: [], unread: 0, localUnread: 0, tab: 'all', timer: 0, seen: lsGet('notifSeen', 0), pop: lsGet('popNotifs', true), open: false, tiles: null, tilesAt: 0 };
const NKIND = {
  like: ['heart', 'var(--pink)', 'liked your post'], favorite: ['star', 'var(--candle)', 'saved your post to their favorites'],
  remix: ['remix', 'var(--slime)', 'remixed your animation'], collab_invite: ['people', 'var(--sky)', 'invited you to a collab'],
  collab_accepted: ['people', 'var(--sky)', 'joined your collab'], check_given: ['check', '#ffd23f', 'You got the gold cat check!'],
  check_removed: ['check', 'var(--muted)', 'Your gold cat check was taken away'], check_request: ['check', '#ffd23f', 'asked for the gold cat check'],
  report: ['flag', 'var(--blood)', 'reported a post'], announce: ['bell', 'var(--lilac)', 'News from ONION'], app: ['film', 'var(--slime)', ''],
  contest_new: ['trophy', '#ffd23f', 'New contest'], contest_won: ['trophy', '#ffd23f', 'You won'], contest_result: ['trophy', 'var(--candle)', 'won'],
};
const localNotes = () => lsGet('appNotes', []);
function noteText(n) {
  const k = NKIND[n.kind] || NKIND.app, actor = n.actor ? '@' + n.actor.username : 'Someone';
  if (n.kind === 'app') return { title: n.title, body: n.body || '' };
  if (['check_given', 'check_removed'].includes(n.kind)) return { title: k[2], body: '' };
  if (n.kind === 'announce') return { title: 'News from ONION', body: n.message };
  if (n.kind === 'contest_new') return { title: `New contest: ${n.message}`, body: 'Enter your best animation and vote for your favourite!' };
  if (n.kind === 'contest_won') return { title: `You won “${n.message}”!`, body: 'A trophy is on your profile. Well done!' };
  if (n.kind === 'contest_result') return { title: `${actor} won “${n.message}”`, body: 'Thanks for entering! Watch the winner.' };
  return { title: `${actor} ${k[2]}`, body: n.kind === 'report' ? n.message : (n.post_id && n.post_id.caption) || '' };
}
function paintBell() {
  const total = NT.unread + localNotes().filter(n => !n.read).length, b = $('#bellBadge'), bell = $('#bellBtn');
  const before = +(b.textContent || 0) || 0;
  b.hidden = !total; b.textContent = total > 99 ? '99+' : String(total);
  if (total > before) { bell.classList.remove('ring'); void bell.offsetWidth; bell.classList.add('ring'); }
  const wc = $('#wdNotifCount'); if (wc) wc.textContent = total ? total + ' new' : '';
}
function banner(title, body, kind, onClick) {
  const box = $('#banners'), k = NKIND[kind] || NKIND.app, el = document.createElement('button'); el.className = 'banner';
  el.innerHTML = `<span class="np-item" style="all:unset;display:contents"><span class="np-ic" style="--c:${k[1]};width:36px;height:36px;border-radius:50%;display:grid;place-items:center;border:2.5px solid var(--ink);background:${k[1]};color:var(--ink);flex:none">${svg(k[0])}</span></span><span style="min-width:0"><b>${esc(title)}</b><span>${esc(String(body || '').slice(0, 120))}</span></span>`;
  el.querySelector('svg').style.cssText = 'width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round';
  const bye = () => { el.classList.add('out'); setTimeout(() => el.remove(), 320); };
  el.onclick = () => { bye(); (onClick || openNotifs)(); };
  box.appendChild(el); while (box.children.length > 3) box.firstChild.remove();
  setTimeout(bye, 5500);
}
function osPop(title, body) {
  if (!NT.pop) return;
  try {
    if (window.fsApi && window.fsApi.notify) { window.fsApi.notify(String(title).slice(0, 80), String(body || '').slice(0, 200)); return; }
    if ('Notification' in window && Notification.permission === 'granted') { const n = new Notification(title, { body: body || '', icon: 'icon.png' }); n.onclick = () => { window.focus(); openNotifs(); }; }
  } catch (e) { /* the system said no */ }
}
function announceNew(items) {
  if (!items.length) return;
  const away = document.hidden || !document.hasFocus();
  if (items.length > 3) { const t = `${items.length} new notifications`, b = items.slice(0, 3).map(n => noteText(n).title).join(' · '); away ? osPop(t, b) : banner(t, b, 'announce'); return; }
  for (const n of items.slice().reverse()) { const t = noteText(n); away ? osPop(t.title, t.body) : banner(t.title, t.body, n.kind); }
}
async function pollNotifs() {
  if (!READY) { paintBell(); return; }
  try {
    if (!C.me) { NT.unread = 0; NT.list = []; paintBell(); fillWidgets(); return; }
    const count = await api.unreadCount();
    if (count !== NT.unread || NT.open || !NT.list.length) {
      NT.list = await api.notifications(60);
      const fresh = NT.list.filter(n => n.id > NT.seen && !n.read);
      announceNew(fresh);
      const top = NT.list.reduce((m, n) => Math.max(m, n.id), 0); if (top > NT.seen) { NT.seen = top; lsSet('notifSeen', top); }
    }
    NT.unread = count; paintBell(); fillWidgets(); if (NT.open) renderNotifs();
  } catch (e) { console.warn('notifications', e); paintBell(); }
}
function startPolling() { clearInterval(NT.timer); NT.timer = setInterval(pollNotifs, 45000); pollNotifs(); }
window.addEventListener('focus', () => { if (C.me) pollNotifs(); });
window.addEventListener('onion-note', e => {
  paintBell(); fillWidgets(); if (NT.open) renderNotifs();
  const d = e.detail || {}; if (document.hidden || !document.hasFocus()) osPop(d.title, d.body); else if (d.banner !== false) banner(d.title, d.body, 'app');
});
function openNotifs() {
  NT.open = true; $('#notifPanel').hidden = false; $('#npPop').checked = NT.pop; renderNotifs(); pollNotifs();
  setTimeout(async () => {
    if (!NT.open) return;
    lsSet('appNotes', localNotes().map(n => Object.assign(n, { read: true })));
    if (C.me && NT.unread) { await guard(() => api.markAllRead()); NT.unread = 0; }
    paintBell(); fillWidgets();
  }, 1500);
}
function closeNotifs() { NT.open = false; $('#notifPanel').hidden = true; }
function allNotes() {
  const loc = localNotes().map(n => Object.assign({}, n, { kind: 'app', created_at: new Date(n.at).toISOString(), local: true }));
  return [...NT.list, ...loc].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
}
function renderNotifs() {
  document.querySelectorAll('#npTabs button').forEach(b => b.classList.toggle('on', b.dataset.t === NT.tab));
  const box = $('#npList');
  let L = allNotes(); if (NT.tab === 'community') L = L.filter(n => !n.local); if (NT.tab === 'app') L = L.filter(n => n.local);
  if (!L.length) {
    box.innerHTML = `<div class="np-empty"><div class="cat-mascot">${O.catSvg('npEmpty')}</div><b>All quiet</b><span>${!C.me && READY && NT.tab !== 'app' ? 'Log in to the community to get likes, remixes and collab invites here.' : 'New likes, remixes, collabs and news from ONION show up here.'}</span>${!C.me && READY && NT.tab !== 'app' ? '<button class="btn primary" id="npLogin">Log in</button>' : ''}</div>`;
    const lg = box.querySelector('#npLogin'); if (lg) lg.onclick = () => { closeNotifs(); authSheet('login', () => { renderTop(); startPolling(); O.setUserName(C.me.display_name || C.me.username); }); };
    return;
  }
  box.innerHTML = L.map((n, i) => {
    const k = NKIND[n.kind] || NKIND.app, t = noteText(n), th = n.post_id && n.post_id.poster_url;
    const face = n.actor && !['announce', 'check_given', 'check_removed', 'contest_new'].includes(n.kind) ? `${avatar(n.actor, 40)}<i>${svg(k[0])}</i>` : svg(k[0]);
    return `<div class="np-item ${n.read ? '' : 'unread'}" data-i="${i}" role="button" tabindex="0"><span class="np-ic" style="--c:${k[1]}">${face}</span>
      <span class="np-tx"><b>${esc(t.title)}</b>${t.body ? (n.kind === 'announce' || n.kind === 'report' || n.local ? `<span class="msg">${esc(t.body)}</span>` : `<span>${esc(t.body)}</span>`) : ''}<small>${ago(n.created_at)}</small></span>
      ${th ? `<img class="np-th" alt="" src="${esc(th)}">` : ''}<button class="x" data-x="${i}" title="Remove" aria-label="Remove">×</button></div>`;
  }).join('');
  box.querySelectorAll('.np-item').forEach(row => row.onclick = e => {
    const n = L[+row.dataset.i];
    if (e.target.closest('[data-x]')) {
      e.stopPropagation();
      if (n.local) lsSet('appNotes', localNotes().filter(x => x.id !== n.id));
      else { guard(() => api.deleteNotification(n.id)); NT.list = NT.list.filter(x => x.id !== n.id); }
      renderNotifs(); paintBell(); fillWidgets(); return;
    }
    noteGo(n);
  });
}
async function noteGo(n) {
  if (n.local) return;
  if (n.contest_id) { closeNotifs(); await open(); C.page = null; C.pageStack = [{ kind: 'contests' }]; openContest(n.contest_id); return; }
  if (['check_request', 'report'].includes(n.kind) && C.me && C.me.is_admin) { closeNotifs(); await open(); switchTab('admin'); return; }
  if (n.kind === 'collab_invite' || n.kind === 'check_given') { closeNotifs(); await open(); openProfile(C.me.username); return; }
  if (n.post_id && n.post_id.id) {
    closeNotifs(); await open();
    await guard(async () => { const p = await api.getPost(n.post_id.id); if (!p) { toast('That post is gone.'); return; } C.pageStack.push(C.page || { kind: 'feed' }); C.page = { kind: 'list' }; $('#cmPage').hidden = true; $('#cmFeed').hidden = false; startFeed({ list: [p] }); });
    return;
  }
  if (n.actor) { closeNotifs(); await open(); openProfile(n.actor.username); }
}
/* the home screen widgets that need the community (renderer.js draws them, this fills them) */
async function fillWidgets() {
  const nl = $('#wdNotifList');
  if (nl) {
    const L = allNotes().slice(0, 3);
    nl.innerHTML = L.length ? L.map(n => { const k = NKIND[n.kind] || NKIND.app, t = noteText(n); return `<div class="ni ${n.read ? '' : 'unread'}"><span class="np-ic" style="width:26px;height:26px;border-radius:50%;display:grid;place-items:center;background:${k[1]};border:2px solid var(--ink);flex:none">${svg(k[0])}</span><span>${esc(t.title)}</span><small class="hint">${ago(n.created_at)}</small></div>`; }).join('')
      : `<p>${!C.me && READY ? 'Log in to the community to get likes, remixes and collab invites.' : 'Nothing new. Go make something cute!'}</p>`;
    nl.querySelectorAll('svg').forEach(x => x.style.cssText = 'width:14px;height:14px;fill:none;stroke:var(--ink);stroke-width:2.4;stroke-linecap:round;stroke-linejoin:round');
    paintBell();
  }
  const tl = $('#wdCmTiles');
  if (tl) {
    if (!READY) { tl.innerHTML = '<p>The community is not connected in this version.</p>'; return; }
    try {
      if (!NT.tiles || Date.now() - NT.tilesAt > 120000) { NT.tiles = (await api.feed({ mode: 'new', limit: 6 })).posts; NT.tilesAt = Date.now(); }
      const T = NT.tiles.slice(0, 6);
      if (!$('#wdCmTiles')) return;
      tl.innerHTML = T.length ? T.map((q, i) => `<button class="cm-avbtn" data-i="${i}" style="border-radius:10px" title="by @${esc(q.author.username)}"><img alt="" loading="lazy" src="${esc(q.poster_url || q.media_url)}"></button>`).join('') : '<p>No posts yet. Be the first!</p>';
      tl.querySelectorAll('[data-i]').forEach(b => b.onclick = async () => { await open(); C.page = { kind: 'list' }; $('#cmPage').hidden = true; $('#cmFeed').hidden = false; startFeed({ list: T }, +b.dataset.i); });
    } catch (e) { tl.innerHTML = `<p>${esc(api.friendly(e))}</p>`; }
  }
}
window.addEventListener('onion-widgets', () => fillWidgets());
$('#npClose').onclick = closeNotifs;
$('#npClear').onclick = () => confirmSheet('Clear all notifications?', 'They are removed from this list for good.', 'Clear all', () => guard(async () => {
  lsSet('appNotes', []); if (C.me) await api.clearNotifications(); NT.list = []; NT.unread = 0; renderNotifs(); paintBell(); fillWidgets(); toast('Cleared', 1200);
}));
$('#npRead').onclick = () => guard(async () => { lsSet('appNotes', localNotes().map(n => Object.assign(n, { read: true }))); if (C.me) await api.markAllRead(); NT.unread = 0; NT.list.forEach(n => n.read = true); renderNotifs(); paintBell(); fillWidgets(); });
document.querySelectorAll('#npTabs button').forEach(b => b.onclick = () => { NT.tab = b.dataset.t; renderNotifs(); });
$('#npPop').onchange = async e => {
  NT.pop = e.target.checked; lsSet('popNotifs', NT.pop);
  if (NT.pop && !(window.fsApi && window.fsApi.notify) && 'Notification' in window && Notification.permission === 'default') { try { await Notification.requestPermission(); } catch (err) { /* */ } }
  if (NT.pop && window.fsApi && window.fsApi.notifyPermission) window.fsApi.notifyPermission();
};
document.addEventListener('keydown', e => { if (NT.open && e.key === 'Escape') { e.preventDefault(); closeNotifs(); } });

/* ---------------------------------------------------------------- navigation */
function back() {
  if (NT.open) { closeNotifs(); return true; }
  if ($('#community').hidden) return false;
  if (C.page) {
    const prev = C.pageStack.pop();
    if (prev && prev.kind === 'profile') { C.page = null; openProfile(prev.username); return true; }
    if (prev && prev.kind === 'admin') { openAdmin(); return true; }
    if (prev && prev.kind === 'contests') { openContests(); return true; }
    if (prev && prev.kind === 'contest') { C.page = null; openContest(prev.id); return true; }
    switchTab(C.tab === 'admin' && !(C.me && C.me.is_admin) ? 'new' : C.tab); return true;
  }
  hide(); return true;
}
function wire() {
  $('#cmBack').onclick = () => { if (C.page) back(); else hide(); };
  $('#cmMe').onclick = () => { if (!READY) return; if (C.me) { C.page = null; C.pageStack = []; openProfile(C.me.username); } else authSheet('login'); };
  $('#cmPost').onclick = () => postMenu();
  $('#cmSearchBtn').onclick = () => searchSheet();
  $('#communityBtn').onclick = () => open();
  const pb = $('#postBtn'); if (pb) pb.onclick = () => postSheet();
  document.addEventListener('keydown', e => {
    if ($('#community').hidden || $('#sheetRoot').firstChild || e.target.closest('input, textarea')) return;
    const feed = $('#cmFeed'); if (feed.hidden) return;
    if (['ArrowDown', 'j', 'PageDown'].includes(e.key)) { e.preventDefault(); feed.scrollBy({ top: feed.clientHeight, behavior: 'smooth' }); }
    if (['ArrowUp', 'k', 'PageUp'].includes(e.key)) { e.preventDefault(); feed.scrollBy({ top: -feed.clientHeight, behavior: 'smooth' }); }
    if (e.key === 'm') setMuted(!C.muted);
    if (e.key === 'Escape') back();
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden) pauseAll(); });
}
wire();
window.OnionCommunity = { open, back, postSheet, ready: READY, api: () => api, openNotifs, pollNotifs };
/* ---------------------------------------------------------------- server updates (v1.7.1)
   On the owner's PC an update from Claude can carry new server rules (server-update.js). They are applied here once, with
   the ONION server key, so the owner never has to paste SQL into Supabase again. Everyone else's copy has nothing to apply. */
async function applyServerUpdate() {
  const U = window.ONION_SERVER_UPDATE;
  if (!READY || !U || !U.key || !U.sql || lsGet('serverApplied', '') === U.sha) return;
  try {
    const { data, error } = await sb.rpc('onion_server_update', { key: U.key, version: U.version || '', body: U.sql });
    if (error) throw error;
    lsSet('serverApplied', U.sha);
    if (data !== 'already up to date') O.appNote('ONION server updated', `The community server is now on ${U.version}. Nothing for you to do.`);
  } catch (e) {
    const m = String(e && e.message || e);
    console.warn('server update', m);
    if (lsGet('serverWarned', '') === U.sha) return;
    lsSet('serverWarned', U.sha);
    if (/onion_server_update|schema cache|does not exist/i.test(m)) O.appNote('Server update waiting', 'Run onion-schema-1.7.sql once in the Supabase SQL Editor (it is in Documents\\ONION). After that, server updates install themselves.');
    else if (/server key/i.test(m)) O.appNote('Server update refused', 'The ONION server key on this PC does not match the server. Ask Claude to check Documents\\ONION\\server-key.txt.');
    else if (!/fetch|network/i.test(m)) O.appNote('Server update failed', m.slice(0, 200));
  }
}
/* at start: who is logged in, then keep the bell up to date */
(async () => {
  if (READY) { try { C.me = await api.session(); } catch (e) { /* offline */ } }
  if (C.me) O.setUserName(C.me.display_name || C.me.username);
  startPolling(); fillWidgets();
  applyServerUpdate();
})();
})();
