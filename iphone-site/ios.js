/* ONION on iPhone and iPad (a web app: open it in Safari, then Share -> Add to Home Screen).
   Gives the shared screens (renderer.js) the same window.fsApi the Windows and Android apps have, backed by the
   browser's own storage (IndexedDB) on the device. Nothing leaves the phone unless you post or share it.
   - Animations: stores 'projects' (id -> {meta, thumb}), 'cells' ('<id>/<fid>_<lid>' -> PNG bytes), 'files' (background, sound).
   - Exports: 'exports' (path -> {name, type, data, size, mtime}); the Done screen's Share button hands them to the iPhone's
     share sheet (Save Video puts an MP4 in Photos, Save to Files keeps a GIF or a .onion).
   - MP4: the iPhone's own H.264 encoder through WebCodecs (iOS 16.4+) + mp4-muxer (MIT); sound with AAC when the browser
     can encode it. Older iPhones: real-time recording with MediaRecorder. GIF: gifenc (MIT), made right here.
   Written in plain ES2017. */
(function () {
  'use strict';
  if (window.fsApi) return;                            // inside the Windows or Android app: they bring their own
  var VER = '1.7.1';
  var HOSTED = window.__ONION_HOST === 'artifact';   // published as a Claude page: saves go through its downloads prompt, no service worker
  var DB = null;
  function idb() {
    if (DB) return DB;
    DB = new Promise(function (res, rej) {
      var r = indexedDB.open('onion', 1);
      r.onupgradeneeded = function () {
        var d = r.result;
        ['projects', 'cells', 'files', 'exports', 'films'].forEach(function (s) { if (!d.objectStoreNames.contains(s)) d.createObjectStore(s); });
      };
      r.onsuccess = function () { res(r.result); };
      r.onerror = function () { rej(r.error || new Error('This browser will not let ONION keep files. Turn off Private Browsing and try again.')); };
    });
    return DB;
  }
  function tx(store, mode, fn) {
    return idb().then(function (d) {
      return new Promise(function (res, rej) {
        var t = d.transaction(store, mode), s = t.objectStore(store), out;
        Promise.resolve(fn(s)).then(function (v) { out = v; });
        t.oncomplete = function () { res(out); };
        t.onerror = t.onabort = function () { rej(t.error || new Error('storage error')); };
      });
    });
  }
  function req(r) { return new Promise(function (res, rej) { r.onsuccess = function () { res(r.result); }; r.onerror = function () { rej(r.error); }; }); }
  function get(store, key) { return tx(store, 'readonly', function (s) { return req(s.get(key)); }); }
  function put(store, key, val) { return tx(store, 'readwrite', function (s) { s.put(val, key); }); }
  function del(store, key) { return tx(store, 'readwrite', function (s) { s.delete(key); }); }
  function keysWith(store, prefix) {
    return tx(store, 'readonly', function (s) { return req(s.getAllKeys(IDBKeyRange.bound(prefix, prefix + '￿'))); });
  }
  function allOf(store) {
    return tx(store, 'readonly', function (s) { return Promise.all([req(s.getAllKeys()), req(s.getAll())]).then(function (r) { return r[0].map(function (k, i) { return [k, r[1][i]]; }); }); });
  }
  function u8(buf) { return buf instanceof Uint8Array ? buf.slice() : new Uint8Array(buf); }
  var even = function (v) { return Math.max(2, Math.round(v / 2) * 2); };
  var clean = function (s) { return String(s || 'animation').replace(/[\\/:*?"<>|]+/g, '').trim().slice(0, 80) || 'animation'; };
  var stamp = function () { var d = new Date(), p = function (n) { return (n < 10 ? '0' : '') + n; }; return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + '.' + p(d.getMinutes()); };

  // ask the browser to keep ONION's storage (Safari keeps it for Home Screen apps; in a Safari tab it may clear it after weeks unused)
  try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) { /* */ }

  /* ---- first start: the example animation */
  var seeded = (async function seed() {
    try {
      if (localStorage.getItem('onion:seeded')) return;
      var have = await allOf('projects'); if (have.length) { localStorage.setItem('onion:seeded', '1'); return; }
      var man = await (await fetch('sample-manifest.json')).json();
      for (var i = 0; i < man.length; i++) {
        var m = man[i], base = m.id + '-';
        var meta = await (await fetch(base + 'project.json')).json();
        for (var k = 0; k < m.cells.length; k++) await put('cells', m.id + '/' + m.cells[k].replace(/\.png$/, ''), u8(await (await fetch(base + 'cell-' + m.cells[k])).arrayBuffer()));
        if (m.bg) await put('files', m.id + '/bg', u8(await (await fetch(base + m.bg)).arrayBuffer()));
        var thumb = '';
        if (m.thumb) { var tb = await (await fetch(base + m.thumb)).blob(); thumb = await new Promise(function (r) { var fr = new FileReader(); fr.onload = function () { r(fr.result); }; fr.readAsDataURL(tb); }); }
        await put('projects', m.id, { meta: meta, thumb: thumb });
      }
      localStorage.setItem('onion:seeded', '1');
    } catch (e) { console.warn('sample', e); }
  })();

  /* ---- exports in memory too, so Share can open the share sheet straight from the tap */
  var recent = {};
  async function keepExport(name, ext, type, bytes) {
    var path = 'ONION/' + clean(name) + ' ' + stamp() + '.' + ext;
    var rec = { name: path.slice(6), type: type, data: u8(bytes), size: bytes.byteLength || bytes.length, mtime: Date.now() };
    await put('exports', path, rec);
    recent[path] = new File([rec.data], rec.name, { type: type });
    return { path: path, size: rec.size };
  }
  async function fileOf(path) {
    if (recent[path]) return recent[path];
    var rec = await get('exports', path) || await get('films', path);
    if (!rec) throw new Error('That file is gone.');
    return (recent[path] = new File([rec.data], rec.name || path.split('/').pop(), { type: rec.type }));
  }
  function viewer(file) {
    var url = URL.createObjectURL(file), box = document.createElement('div');
    box.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(6,3,12,.94);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;padding:max(16px,env(safe-area-inset-top)) 16px max(16px,env(safe-area-inset-bottom))';
    var media = /^video/.test(file.type) ? '<video controls autoplay playsinline loop style="max-width:100%;max-height:75vh;border-radius:16px;border:3px solid #000"></video>' : '<img alt="" style="max-width:100%;max-height:75vh;border-radius:16px;border:3px solid #000;background:#fff">';
    box.innerHTML = media + '<div style="display:flex;gap:10px"><button class="btn primary" data-s>Share / Save</button><button class="btn" data-c>Close</button></div>';
    box.firstChild.src = url;
    box.querySelector('[data-c]').onclick = function () { URL.revokeObjectURL(url); box.remove(); };
    box.querySelector('[data-s]').onclick = function () { shareFile(file); };
    document.body.appendChild(box);
  }
  function download(file) {
    var a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = file.name; document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 60000);
  }
  var DL_EXT = /\.(gif|png|jpe?g|webp|mp4|webm|zip|json|txt)$/i;
  async function hostedSave(file) {
    var dl = null; try { dl = window.claude && window.claude.use ? await window.claude.use('downloads') : null; } catch (e) { /* */ }
    var say = function (m) { if (window.__onion) window.__onion.toast(m, 3600); };
    if (!dl) { say('Saving files is not available here. Open ONION on your computer or tablet to save it.'); return; }
    var name = file.name.replace(/\.onion$/i, '.zip'); if (!DL_EXT.test(name)) name += '.zip';
    try { await dl.save({ filename: name, data: file }); }
    catch (e) {
      var c = e && e.code;
      if (c === 'declined') return;
      if (c === 'rate_limited') say('One save at a time: finish the save that is open, then try again.');
      else say('That file could not be saved here (' + (c || 'error') + ').');
    }
  }
  function shareFile(file) {
    if (HOSTED) return hostedSave(file);
    try {
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        return navigator.share({ files: [file], title: file.name }).catch(function (e) { if (e && e.name !== 'AbortError') download(file); });
      }
    } catch (e) { /* */ }
    download(file);
    return Promise.resolve();
  }

  /* ---- GIF (gifenc) */
  async function makeGif(job, spec, onProgress) {
    var G = window.gifenc, W = even(spec.width), H = even(spec.height);
    var cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    var cx = cv.getContext('2d', { willReadFrequently: true }), enc = G.GIFEncoder(), last = -1, fr = null, ents = spec.entries || [];
    for (var k = 0; k < ents.length; k++) {
      if (job.cancelled) throw new Error('cancelled');
      var e = ents[k];
      if (e.i !== last || !fr) {
        var bmp = await createImageBitmap(new Blob([job.frames.get(e.i)], { type: 'image/png' }));
        cx.fillStyle = '#ffffff'; cx.fillRect(0, 0, W, H); cx.drawImage(bmp, 0, 0, W, H); if (bmp.close) bmp.close();
        var data = cx.getImageData(0, 0, W, H).data, palette = G.quantize(data, 256);
        fr = { palette: palette, index: G.applyPalette(data, palette) }; last = e.i;
      }
      enc.writeFrame(fr.index, W, H, { palette: fr.palette, delay: Math.max(20, Math.round(e.dur * 1000)), repeat: spec.loop === false ? -1 : 0 });
      onProgress((k + 1) / ents.length);
      await new Promise(function (r) { setTimeout(r, 0); });
    }
    enc.finish();
    return enc.bytes();
  }

  /* ---- MP4: WebCodecs H.264 + mp4-muxer (+ AAC sound when the browser can encode it) */
  async function soundFor(spec, total) {
    if (!spec.audio || !spec.projectId) return null;
    var rec = await get('files', spec.projectId + '/audio'); if (!rec) return null;
    var AC = window.AudioContext || window.webkitAudioContext; if (!AC) return null;
    var ac = new AC(), buf = await ac.decodeAudioData(u8(rec.data).buffer); try { ac.close(); } catch (e) { /* */ }
    var sr = 48000, n = Math.ceil(total * sr), off = new (window.OfflineAudioContext || window.webkitOfflineAudioContext)(2, n, sr);
    var src = off.createBufferSource(); src.buffer = buf; src.connect(off.destination);
    var o = spec.audioOffset || 0; if (o >= 0) src.start(o); else src.start(0, -o);
    return { audio: await off.startRendering(), sr: sr };
  }
  async function aacOK(sr) {
    try { return !!(window.AudioEncoder && (await AudioEncoder.isConfigSupported({ codec: 'mp4a.40.2', sampleRate: sr, numberOfChannels: 2, bitrate: 128000 })).supported); }
    catch (e) { return false; }
  }
  async function pickAvc(W, H, fps) {
    var tries = ['avc1.640033', 'avc1.64002a', 'avc1.4d0033', 'avc1.42e033', 'avc1.42e01f'];
    for (var i = 0; i < tries.length; i++) {
      var cfg = { codec: tries[i], width: W, height: H, bitrate: Math.round(Math.min(16e6, W * H * fps * 0.14)), framerate: fps, avc: { format: 'avc' } };
      try { if ((await VideoEncoder.isConfigSupported(cfg)).supported) return cfg; } catch (e) { /* */ }
    }
    return null;
  }
  async function makeMp4(job, spec, onProgress) {
    var W = even(spec.width), H = even(spec.height), fps = spec.fps || 24, ents = spec.entries || [];
    var total = ents.reduce(function (s, e) { return s + e.dur; }, 0);
    if (!window.VideoEncoder || !window.Mp4Muxer) return recordMp4(job, spec, onProgress);
    var vcfg = await pickAvc(W, H, fps); if (!vcfg) return recordMp4(job, spec, onProgress);
    var snd = null; try { snd = await soundFor(spec, total); } catch (e) { console.warn('sound', e); }
    var withSound = snd && await aacOK(snd.sr);
    var M = window.Mp4Muxer, target = new M.ArrayBufferTarget();
    var muxer = new M.Muxer({ target: target, video: { codec: 'avc', width: W, height: H, frameRate: fps },
      audio: withSound ? { codec: 'aac', sampleRate: snd.sr, numberOfChannels: 2 } : undefined, fastStart: 'in-memory', firstTimestampBehavior: 'offset' });
    var err = null;
    var venc = new VideoEncoder({ output: function (c, m) { muxer.addVideoChunk(c, m); }, error: function (e) { err = e; } });
    venc.configure(vcfg);
    var cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    var cx = cv.getContext('2d'), cache = { i: -1, bmp: null };
    // every output frame at fps (holds become repeated frames), a key frame every 2 s
    var frames = Math.max(1, Math.round(total * fps)), t0 = 0, idx = 0, edge = ents.length ? ents[0].dur : 0;
    for (var f = 0; f < frames; f++) {
      if (job.cancelled || err) break;
      var t = (f + 0.5) / fps;
      while (idx < ents.length - 1 && t >= edge) { idx++; edge += ents[idx].dur; }
      var e = ents[idx];
      if (cache.i !== e.i) {
        if (cache.bmp && cache.bmp.close) cache.bmp.close();
        cache.bmp = await createImageBitmap(new Blob([job.frames.get(e.i)], { type: 'image/png' })); cache.i = e.i;
        cx.fillStyle = '#ffffff'; cx.fillRect(0, 0, W, H); cx.drawImage(cache.bmp, 0, 0, W, H);
      }
      var vf = new VideoFrame(cv, { timestamp: Math.round(f * 1e6 / fps), duration: Math.round(1e6 / fps) });
      venc.encode(vf, { keyFrame: f % Math.max(1, fps * 2) === 0 }); vf.close();
      while (venc.encodeQueueSize > 4) await new Promise(function (r) { setTimeout(r, 4); });
      if (f % 3 === 0) { onProgress(0.9 * (f + 1) / frames); await new Promise(function (r) { setTimeout(r, 0); }); }
    }
    await venc.flush(); venc.close();
    if (job.cancelled) throw new Error('cancelled');
    if (err) throw err;
    if (withSound) {
      var aerr = null, aenc = new AudioEncoder({ output: function (c, m) { muxer.addAudioChunk(c, m); }, error: function (e) { aerr = e; } });
      aenc.configure({ codec: 'mp4a.40.2', sampleRate: snd.sr, numberOfChannels: 2, bitrate: 128000 });
      var A = snd.audio, L = A.getChannelData(0), R = A.numberOfChannels > 1 ? A.getChannelData(1) : L, step = 4096;
      for (var s = 0; s < A.length; s += step) {
        var n = Math.min(step, A.length - s), planar = new Float32Array(n * 2);
        planar.set(L.subarray(s, s + n), 0); planar.set(R.subarray(s, s + n), n);
        var ad = new AudioData({ format: 'f32-planar', sampleRate: snd.sr, numberOfFrames: n, numberOfChannels: 2, timestamp: Math.round(s * 1e6 / snd.sr), data: planar });
        aenc.encode(ad); ad.close();
      }
      await aenc.flush(); aenc.close(); if (aerr) console.warn('aac', aerr);
    }
    muxer.finalize(); onProgress(1);
    return { bytes: new Uint8Array(target.buffer), sound: !!withSound, soundMissing: !!(snd && !withSound) };
  }
  // older iPhones: play the frames into a canvas and record it in real time (takes as long as the animation)
  async function recordMp4(job, spec, onProgress) {
    var type = ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm'].find(function (t) { return window.MediaRecorder && MediaRecorder.isTypeSupported(t); });
    if (!type) throw new Error('This iPhone cannot make videos (it needs iOS 16.4 or newer). Export a GIF instead.');
    var W = even(spec.width), H = even(spec.height), ents = spec.entries || [];
    var cv = document.createElement('canvas'); cv.width = W; cv.height = H; var cx = cv.getContext('2d');
    var bmps = {}; for (var k = 0; k < ents.length; k++) if (!bmps[ents[k].i]) bmps[ents[k].i] = await createImageBitmap(new Blob([job.frames.get(ents[k].i)], { type: 'image/png' }));
    var draw = function (i) { cx.fillStyle = '#fff'; cx.fillRect(0, 0, W, H); cx.drawImage(bmps[i], 0, 0, W, H); };
    draw(ents[0].i);
    var stream = cv.captureStream(spec.fps || 24), chunks = [], rec = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 8e6 });
    rec.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };
    var done = new Promise(function (r) { rec.onstop = r; });
    rec.start(250);
    var total = ents.reduce(function (s, e) { return s + e.dur; }, 0), t0 = performance.now(), acc = 0;
    for (var j = 0; j < ents.length; j++) {
      if (job.cancelled) break;
      draw(ents[j].i); acc += ents[j].dur;
      var wait = t0 + acc * 1000 - performance.now(); if (wait > 0) await new Promise(function (r) { setTimeout(r, wait); });
      onProgress(acc / total);
    }
    rec.stop(); await done;
    if (job.cancelled) throw new Error('cancelled');
    return { bytes: new Uint8Array(await new Blob(chunks).arrayBuffer()), ext: /webm/.test(type) ? 'webm' : 'mp4', sound: false };
  }

  var progressCbs = [], jobs = {};
  window.fsApi = {
    platform: 'ios',
    root: async function () { return 'ONION on this ' + (/iPad/.test(navigator.userAgent) ? 'iPad' : 'iPhone'); },
    version: async function () { return { ui: VER, app: VER, api: 3, from: 'web', notes: '' }; },
    uiOk: async function () {},
    restart: async function () { location.reload(); },
    list: async function () {
      await seeded;
      return (await allOf('projects')).map(function (kv) { var m = Object.assign({}, kv[1].meta); m.id = kv[0]; m.thumb = kv[1].thumb || ''; return m; });
    },
    load: async function (id) {
      await seeded;
      var p = await get('projects', id); if (!p) throw new Error('That animation is gone.');
      var keys = await keysWith('cells', id + '/'), cells = [];
      for (var k = 0; k < keys.length; k++) {
        var m = /^[^/]+\/(.+)_([^_]+)$/.exec(keys[k]); if (!m) continue;
        cells.push({ fid: m[1], lid: m[2], buf: await get('cells', keys[k]) });
      }
      var bg = await get('files', id + '/bg'), au = await get('files', id + '/audio'), meta = Object.assign({}, p.meta); meta.id = id;
      return { meta: meta, cells: cells, bg: bg || null, audio: au ? { buf: au.data, file: 'audio.' + au.ext } : null };
    },
    saveMeta: async function (id, meta, thumb) {
      var old = await get('projects', id), mm = Object.assign({}, meta); delete mm.thumb; delete mm.id;
      await put('projects', id, { meta: mm, thumb: thumb || (old && old.thumb) || '' });
    },
    saveCell: async function (id, fid, lid, buf) { var k = id + '/' + fid + '_' + lid; if (buf) await put('cells', k, u8(buf)); else await del('cells', k); },
    saveBg: async function (id, buf) { if (buf) await put('files', id + '/bg', u8(buf)); else await del('files', id + '/bg'); },
    saveAudio: async function (id, ext, buf) { if (buf) await put('files', id + '/audio', { ext: ext || 'mp3', data: u8(buf) }); else await del('files', id + '/audio'); },
    deleteProject: async function (id) {
      var keys = await keysWith('cells', id + '/');
      await tx('cells', 'readwrite', function (s) { keys.forEach(function (k) { s.delete(k); }); });
      await del('files', id + '/bg'); await del('files', id + '/audio'); await del('projects', id);
    },
    films: async function () {
      return (await allOf('films')).map(function (kv) {
        var r = kv[1]; return { file: kv[0], title: r.title, url: URL.createObjectURL(new Blob([r.data], { type: r.type })), thumb: r.thumb || '', size: r.size, mtime: r.mtime, note: '' };
      }).sort(function (a, b) { return b.mtime - a.mtime; });
    },
    openFolder: async function () {},
    showFile: async function (file) { return shareFile(await fileOf(file)); },
    saveFile: async function (name, mime, buf) {
      var f = new File([u8(buf)], name, { type: mime || 'application/octet-stream' });
      await shareFile(f);
      return { path: '' };
    },
    share: async function (path) { return shareFile(await fileOf(path)); },
    notify: null,

    exportBegin: async function () {
      var id = 'x' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      jobs[id] = { frames: new Map(), cancelled: false }; return id;
    },
    exportFrame: async function (id, i, buf) { var j = jobs[id]; if (!j) throw new Error('no export'); j.frames.set(i, u8(buf)); },
    exportCancel: async function (id) { var j = jobs[id]; if (j) j.cancelled = true; },
    exportFinish: async function (id, spec) {
      var j = jobs[id]; if (!j) throw new Error('no export');
      var tell = function (p) { progressCbs.forEach(function (cb) { try { cb(id, p); } catch (e) { /* */ } }); };
      try {
        if (spec.format === 'gif') {
          var gif = await makeGif(j, spec, tell);
          if (j.cancelled) throw new Error('cancelled');
          var r = await keepExport(spec.name, 'gif', 'image/gif', gif); r.width = even(spec.width); r.height = even(spec.height); return r;
        }
        var v = await makeMp4(j, spec, tell);
        var ext = v.ext || 'mp4', res = await keepExport(spec.name, ext, ext === 'webm' ? 'video/webm' : 'video/mp4', v.bytes);
        res.width = even(spec.width); res.height = even(spec.height);
        if (v.soundMissing && window.__onion) window.__onion.toast('This iPhone made the video without sound (it cannot encode AAC here).', 4200);
        return res;
      } finally { delete jobs[id]; }
    },
    exportFiles: async function (kind, name, files) {
      var pics = files.filter(function (f) { return typeof f.data !== 'string'; });
      if (kind === 'picture' || pics.length === 1) return keepExport(name, 'png', 'image/png', pics[0].data);
      // many pictures: one .zip (the share sheet can save it to Files, which unzips it)
      var zip = window.__onion && window.__onion.zipStore ? window.__onion.zipStore(pics.map(function (f) { return { name: f.name, data: u8(f.data) }; })) : null;
      if (!zip) return keepExport(name, 'png', 'image/png', pics[0].data);
      var r = await keepExport(name, 'zip', 'application/zip', new Uint8Array(await zip.arrayBuffer())); r.count = pics.length; return r;
    },
    openPath: async function (p) { viewer(await fileOf(p)); },
    showItem: async function (p) { return shareFile(await fileOf(p)); },
    readExport: async function (p) { var f = await fileOf(p); return new Uint8Array(await f.arrayBuffer()); },
    addToFilms: async function (p, title) {
      var rec = await get('exports', p); if (!rec) return null;
      var thumb = '';
      try {
        var v = document.createElement('video'); v.muted = true; v.playsInline = true; v.src = URL.createObjectURL(new Blob([rec.data], { type: rec.type }));
        await new Promise(function (r, j) { v.onloadeddata = r; v.onerror = j; setTimeout(r, 3000); });
        var c = document.createElement('canvas'); c.width = 480; c.height = Math.round(480 * (v.videoHeight || 270) / (v.videoWidth || 480));
        c.getContext('2d').drawImage(v, 0, 0, c.width, c.height); thumb = c.toDataURL('image/jpeg', 0.8);
      } catch (e) { /* no thumbnail */ }
      await put('films', p, { title: title || rec.name, type: rec.type, data: rec.data, size: rec.size, mtime: Date.now(), thumb: thumb });
      return p;
    },
    onChanged: function () {},
    onUpdate: function () {},
    onExportProgress: function (cb) { progressCbs.push(cb); },
  };

  /* ---- look and feel on a phone: safe areas, no rubber-band page, no double-tap zoom */
  document.documentElement.classList.add('ios');
  if (navigator.standalone || (window.matchMedia && matchMedia('(display-mode: standalone)').matches)) document.documentElement.classList.add('ios-app');
  /* ---- in a Safari tab: show how to put ONION on the Home Screen (once a day at most, until it is there) */
  var standalone = navigator.standalone || (window.matchMedia && matchMedia('(display-mode: standalone)').matches);
  var appleish = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (!HOSTED && !standalone && appleish) window.addEventListener('load', function () {
    var last = +(localStorage.getItem('onion:a2hs') || 0); if (Date.now() - last < 864e5) return;
    var b = document.createElement('div'); b.className = 'a2hs';
    b.innerHTML = '<img alt="" src="icon-180.png"><div><b>Put ONION on your Home Screen</b><br><span>Tap <svg viewBox="0 0 24 24"><path d="M12 15V3M8 7l4-4 4 4"/><path d="M6 11H5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1h-1"/></svg> Share, then <b>Add to Home Screen</b>. It opens full screen and keeps your animations safe.</span></div><button class="btn" aria-label="Close">OK</button>';
    b.querySelector('button').onclick = function () { localStorage.setItem('onion:a2hs', String(Date.now())); b.remove(); };
    setTimeout(function () { document.body.appendChild(b); }, 2500);
  });
  /* ---- offline: the service worker keeps the screens on the phone */
  if (!HOSTED && 'serviceWorker' in navigator && location.protocol === 'https:') {
    window.addEventListener('load', function () { navigator.serviceWorker.register('sw.js').catch(function (e) { console.warn('sw', e); }); });
  }
})();
