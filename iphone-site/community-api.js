/* ONION Community: everything the app asks the online server (Supabase, see community/schema.sql).
   Works in the app (window.OnionCommunityAPI) and in Node for tests (module.exports).
   createCommunity(supabaseClient, projectUrl) -> api; every call throws an Error with a message people can read. */
(function (root) {
  'use strict';
  const AUTHOR = 'id,username,display_name,avatar_path,avatar_color,verified';
  const POST = `*,author(${AUTHOR}),remix_of(id,author(username,verified)),post_collabs(accepted,user_id(${AUTHOR}))`;
  const USERNAME = /^[a-z0-9_.]{3,20}$/;

  function friendly(e) {
    const m = String((e && (e.message || e.msg || e.error_description || e.error)) || e || 'Something went wrong');
    if (/Invalid login credentials/i.test(m)) return 'That email or password is not right.';
    if (/already registered|already exists|user_already_exists/i.test(m)) return 'That email already has an account. Try logging in.';
    if (/Database error saving new user/i.test(m)) return 'That username is taken or not allowed.';
    if (/duplicate key/i.test(m)) return 'Already done.';
    if (/only the ONION owner/i.test(m)) return 'Only the owner of ONION can do that.';
    if (/row-level security|permission denied/i.test(m)) return 'You are not allowed to do that.';
    if (/Failed to fetch|NetworkError|network/i.test(m)) return 'No internet connection to the ONION community.';
    if (/exceeded the maximum allowed size|Payload too large/i.test(m)) return 'That file is too big (50 MB at most).';
    return m.replace(/^.*?exception:\s*/i, '');
  }
  async function must(p) {
    const r = await p;
    if (r && r.error) throw new Error(friendly(r.error));
    return r ? r.data : null;
  }

  function createCommunity(sb, url) {
    const base = String(url || '').replace(/\/+$/, '');
    let meCache = null, blockedCache = null, hasDrafts = true;   // hasDrafts: false on a server without the v1.6.1 rules
    let hasContests = true;                                        // false on a server without the v1.7 rules
    const pub = q => hasDrafts ? q.eq('draft', false) : q;
    const publicUrl = path => path ? `${base}/storage/v1/object/public/media/${String(path).split('/').map(encodeURIComponent).join('/')}` : '';
    const uid = async () => { const { data } = await sb.auth.getSession(); return data && data.session ? data.session.user.id : null; };

    async function profileById(id) { return must(sb.from('profiles').select('*').eq('id', id).maybeSingle()); }
    async function decorate(posts) {
      const me = await uid();
      posts = (posts || []).filter(Boolean);
      const blocked = me ? await api.blockedIds() : new Set();
      posts = posts.filter(p => !blocked.has(p.author && p.author.id));
      const ids = posts.map(p => p.id);
      let liked = new Set(), faved = new Set();
      if (me && ids.length) {
        const [l, f] = await Promise.all([
          must(sb.from('likes').select('post_id').in('post_id', ids)),
          must(sb.from('favorites').select('post_id').in('post_id', ids))]);
        liked = new Set(l.map(x => x.post_id)); faved = new Set(f.map(x => x.post_id));
      }
      let wins = [];
      if (ids.length && hasContests) {
        try { wins = await must(sb.from('contests').select('id,title,winner_post').in('winner_post', ids)); }
        catch (e) { if (/contests/.test(e.message)) hasContests = false; }
      }
      for (const p of posts) {
        p.won = wins.filter(w => w.winner_post === p.id).map(w => ({ id: w.id, title: w.title }));
        p.liked = liked.has(p.id); p.faved = faved.has(p.id); p.mine = me && p.author && p.author.id === me;
        p.media_url = publicUrl(p.media_path); p.poster_url = publicUrl(p.poster_path); p.project_url = publicUrl(p.project_path);
        p.collabs = (p.post_collabs || []).filter(c => c.accepted && c.user_id).map(c => c.user_id);
        if (p.author) p.author.avatar_url = publicUrl(p.author.avatar_path);
      }
      return posts;
    }

    const cleanNames = list => [...new Set((list || []).map(s => String(s).replace(/^@/, '').trim().toLowerCase()).filter(s => USERNAME.test(s)))].slice(0, 5);
    async function invite(pid, collabs, me) {
      const names = cleanNames(collabs), notFound = [];
      if (names.length) {
        const people = await must(sb.from('profiles').select('id,username').in('username', names));
        for (const n of names) if (!people.find(p => p.username === n)) notFound.push(n);
        const rows = people.filter(p => p.id !== me).map(p => ({ post_id: pid, user_id: p.id }));
        if (rows.length) await must(sb.from('post_collabs').insert(rows));
      }
      return notFound;
    }
    const api = {
      publicUrl,
      friendly,
      async session() {
        const id = await uid(); if (!id) { meCache = null; return null; }
        meCache = await profileById(id); return meCache;
      },
      me() { return meCache; },
      async usernameAvailable(u) { return !!(await must(sb.rpc('onion_username_available', { u: String(u || '').toLowerCase() }))); },
      async signUp({ email, password, username, displayName }) {
        username = String(username || '').trim().toLowerCase();
        if (!USERNAME.test(username)) throw new Error('Usernames are 3-20 letters, numbers, _ or .');
        if (!(await api.usernameAvailable(username))) throw new Error('@' + username + ' is taken. Try another.');
        if (String(password || '').length < 6) throw new Error('Use at least 6 characters for the password.');
        const d = await must(sb.auth.signUp({ email: String(email || '').trim(), password, options: { data: { username, display_name: String(displayName || username).slice(0, 40) } } }));
        if (!d.session) throw new Error('Check your email to confirm your account, then log in.');
        return api.session();
      },
      async signIn(email, password) {
        await must(sb.auth.signInWithPassword({ email: String(email || '').trim(), password }));
        const p = await api.session();
        if (!p) throw new Error('This account has no ONION profile.');
        if (p.banned) { await sb.auth.signOut(); meCache = null; throw new Error('This account has been banned from the ONION community.'); }
        return p;
      },
      async signOut() { await sb.auth.signOut(); meCache = null; blockedCache = null; },
      async profile(username) {
        const p = await must(sb.from('profiles').select('*').eq('username', String(username || '').toLowerCase()).maybeSingle());
        if (p) p.avatar_url = publicUrl(p.avatar_path);
        return p;
      },
      async search(q) {
        q = String(q || '').toLowerCase().replace(/[^a-z0-9_.]/g, '');
        if (!q) return [];
        const r = await must(sb.from('profiles').select(AUTHOR + ',bio,post_count,like_count').ilike('username', q + '%').order('like_count', { ascending: false }).limit(20));
        r.forEach(p => p.avatar_url = publicUrl(p.avatar_path)); return r;
      },
      async updateProfile(fields, avatarBlob) {
        const id = await uid(); if (!id) throw new Error('Log in first.');
        const patch = {};
        for (const k of ['display_name', 'bio', 'avatar_color']) if (fields[k] !== undefined) patch[k] = fields[k];
        if (avatarBlob) {
          const path = `${id}/avatar-${Date.now().toString(36)}.${/png/.test(avatarBlob.type) ? 'png' : 'jpg'}`;
          await must(sb.storage.from('media').upload(path, avatarBlob, { contentType: avatarBlob.type || 'image/jpeg', upsert: false }));
          if (meCache && meCache.avatar_path) sb.storage.from('media').remove([meCache.avatar_path]).catch(() => {});
          patch.avatar_path = path;
        }
        await must(sb.from('profiles').update(patch).eq('id', id));
        return api.session();
      },
      /** mode: 'new' | 'top' | 'favorites' | 'user'; page: {before (ISO time) | offset}; returns {posts, next} */
      async feed(opts = {}) {
        try { return await api.feed1(opts); }
        catch (e) { if (hasDrafts && /draft/.test(e.message)) { hasDrafts = false; return api.feed1(opts); } throw e; }
      },
      async feed1({ mode = 'new', before = null, offset = 0, userId = null, limit = 8 } = {}) {
        if (mode === 'favorites') {
          const me = await uid(); if (!me) return { posts: [], next: null };
          let q = sb.from('favorites').select(`created_at,post_id(${POST})`).eq('user_id', me).order('created_at', { ascending: false }).limit(limit);
          if (before) q = q.lt('created_at', before);
          const rows = await must(q);
          const posts = await decorate(rows.map(r => r.post_id));
          return { posts, next: rows.length === limit ? { before: rows[rows.length - 1].created_at } : null };
        }
        if (mode === 'top') {
          const since = new Date(Date.now() - 30 * 86400000).toISOString();
          const rows = await must(pub(sb.from('posts').select(POST)).gt('created_at', since).order('like_count', { ascending: false }).order('created_at', { ascending: false }).range(offset, offset + limit - 1));
          return { posts: await decorate(rows), next: rows.length === limit ? { offset: offset + limit } : null };
        }
        let q = pub(sb.from('posts').select(POST)).order('created_at', { ascending: false }).limit(limit);
        if (mode === 'user' && userId) {
          const cols = await must(sb.from('post_collabs').select('post_id').eq('user_id', userId).eq('accepted', true));
          const ids = cols.map(c => c.post_id);
          q = ids.length ? q.or(`author.eq.${userId},id.in.(${ids.join(',')})`) : q.eq('author', userId);
        }
        if (before) q = q.lt('created_at', before);
        const rows = await must(q);
        return { posts: await decorate(rows), next: rows.length === limit ? { before: rows[rows.length - 1].created_at } : null };
      },
      async getPost(id) { const r = await must(sb.from('posts').select(POST).eq('id', id).maybeSingle()); return r ? (await decorate([r]))[0] : null; },
      /** media/poster/project are Blobs; collabs: usernames to invite */
      async post({ kind, media, poster, project, caption = '', width = 1280, height = 720, duration = 0, allowRemix = false, remixOf = null, collabs = [], draft = false, onProgress }) {
        const id = await uid(); if (!id) throw new Error('Log in to post.');
        if (meCache && meCache.banned) throw new Error('This account cannot post.');
        const pid = (root.crypto && root.crypto.randomUUID) ? root.crypto.randomUUID() : require('crypto').randomUUID();
        const ext = kind === 'video' ? 'mp4' : kind === 'gif' ? 'gif' : (media.type === 'image/jpeg' ? 'jpg' : 'png');
        const dir = `${id}/${pid}`, up = async (name, blob, type) => {
          await must(sb.storage.from('media').upload(`${dir}/${name}`, blob, { contentType: type, upsert: false, cacheControl: '31536000' }));
          return `${dir}/${name}`;
        };
        const tell = p => { try { onProgress && onProgress(p); } catch (e) { /* */ } };
        const uploaded = [];
        try {
          tell(0.1);
          const media_path = await up('media.' + ext, media, kind === 'video' ? 'video/mp4' : kind === 'gif' ? 'image/gif' : (ext === 'jpg' ? 'image/jpeg' : 'image/png')); uploaded.push(media_path); tell(0.6);
          const poster_path = poster ? await up('poster.jpg', poster, 'image/jpeg') : ''; if (poster_path) uploaded.push(poster_path); tell(0.75);
          const project_path = allowRemix && project ? await up('project.onion', project, 'application/zip') : ''; if (project_path) uploaded.push(project_path); tell(0.9);
          await must(sb.from('posts').insert({ id: pid, kind, media_path, poster_path, project_path, caption: String(caption).slice(0, 300),
            width: Math.round(width), height: Math.round(height), duration: Math.round(duration * 100) / 100, allow_remix: !!(allowRemix && project_path), remix_of: remixOf || null,
            draft: !!draft, collab_names: draft ? cleanNames(collabs).join(',').slice(0, 140) : '' }));
        } catch (e) {
          if (uploaded.length) sb.storage.from('media').remove(uploaded).catch(() => {});
          throw e;
        }
        const notFound = draft ? [] : await invite(pid, collabs, id);
        tell(1);
        const p = await api.getPost(pid); if (p) p.collabNotFound = notFound;
        await api.session();
        return p;
      },
      async editPost(id, { caption, allowRemix }) {
        const patch = {}; if (caption !== undefined) patch.caption = String(caption).slice(0, 300); if (allowRemix !== undefined) patch.allow_remix = !!allowRemix;
        await must(sb.from('posts').update(patch).eq('id', id));
      },
      async deletePost(p) {
        await must(sb.from('posts').delete().eq('id', p.id));
        const files = [p.media_path, p.poster_path, p.project_path].filter(Boolean);
        if (files.length) await sb.storage.from('media').remove(files).catch(() => {});
        await api.session();
      },
      async like(postId, on) {
        if (!(await uid())) throw new Error('Log in to like posts.');
        if (on) { const r = await sb.from('likes').insert({ post_id: postId }); if (r.error && !/duplicate key/.test(r.error.message)) throw new Error(friendly(r.error)); }
        else await must(sb.from('likes').delete().eq('post_id', postId).eq('user_id', await uid()));
      },
      async favorite(postId, on) {
        if (!(await uid())) throw new Error('Log in to save favorites.');
        if (on) { const r = await sb.from('favorites').insert({ post_id: postId }); if (r.error && !/duplicate key/.test(r.error.message)) throw new Error(friendly(r.error)); }
        else await must(sb.from('favorites').delete().eq('post_id', postId).eq('user_id', await uid()));
      },
      async report(postId, reason) {
        if (!(await uid())) throw new Error('Log in to report posts.');
        const r = await sb.from('reports').insert({ post_id: postId, reason: String(reason || '').slice(0, 200) });
        if (r.error && !/duplicate key/.test(r.error.message)) throw new Error(friendly(r.error));
      },
      async blockedIds() {
        if (blockedCache) return blockedCache;
        const me = await uid(); if (!me) return new Set();
        blockedCache = new Set((await must(sb.from('blocks').select('blocked'))).map(b => b.blocked));
        return blockedCache;
      },
      async block(userId, on) {
        if (!(await uid())) throw new Error('Log in first.');
        if (on) { const r = await sb.from('blocks').insert({ blocked: userId }); if (r.error && !/duplicate key/.test(r.error.message)) throw new Error(friendly(r.error)); }
        else await must(sb.from('blocks').delete().eq('blocked', userId));
        blockedCache = null;
      },
      async collabInvites() {
        const me = await uid(); if (!me) return [];
        const rows = await must(sb.from('post_collabs').select(`post_id(${POST})`).eq('user_id', me).eq('accepted', false));
        return decorate(rows.map(r => r.post_id));
      },
      async answerCollab(postId, accept) {
        const me = await uid();
        if (accept) await must(sb.from('post_collabs').update({ accepted: true }).eq('post_id', postId).eq('user_id', me));
        else await must(sb.from('post_collabs').delete().eq('post_id', postId).eq('user_id', me));
      },
      async requestCheck() { return must(sb.rpc('onion_request_check')); },
      async isAdmin() { return !!(meCache && meCache.is_admin); },
      async checkRequests() {
        const r = await must(sb.from('profiles').select('*').eq('verify_requested', true).eq('verified', false).order('like_count', { ascending: false }).limit(50));
        r.forEach(p => p.avatar_url = publicUrl(p.avatar_path)); return r;
      },
      async verifiedPeople() { return must(sb.from('profiles').select(AUTHOR + ',like_count,post_count').eq('verified', true).order('username').limit(200)); },
      async reports() {
        const rows = await must(sb.from('reports').select(`id,reason,created_at,reporter(username),post_id(${POST})`).order('created_at', { ascending: false }).limit(100));
        const posts = await decorate(rows.map(r => r.post_id));
        return rows.map(r => ({ id: r.id, reason: r.reason, created_at: r.created_at, reporter: r.reporter, post: posts.find(p => p && r.post_id && p.id === r.post_id.id) || r.post_id }));
      },
      async dismissReport(id) { await must(sb.from('reports').delete().eq('id', id)); },
      async setCheck(userId, value) { await must(sb.rpc('onion_admin_set_check', { target: userId, value: !!value })); },
      async hidePost(postId, value) { await must(sb.rpc('onion_admin_hide_post', { target: postId, value: !!value })); },
      async ban(userId, value) { await must(sb.rpc('onion_admin_ban', { target: userId, value: !!value })); },
      /* ---- v1.6.1: drafts and deleting ---- */
      async drafts() {
        const me = await uid(); if (!me || !hasDrafts) return [];
        return decorate(await must(sb.from('posts').select(POST).eq('author', me).eq('draft', true).order('created_at', { ascending: false }).limit(60)));
      },
      async saveDraft(id, { caption, allowRemix, collabs }) {
        const patch = { caption: String(caption || '').slice(0, 300), collab_names: cleanNames(collabs).join(',').slice(0, 140) };
        if (allowRemix !== undefined) patch.allow_remix = !!allowRemix;
        await must(sb.from('posts').update(patch).eq('id', id));
      },
      /** post a draft for everyone: saves the caption and remix choice, makes it public, then sends the collab invites */
      async publishDraft(p, { caption, allowRemix, collabs }) {
        const me = await uid(); if (!me) throw new Error('Log in first.');
        const patch = { caption: String(caption || '').slice(0, 300) };
        if (allowRemix !== undefined) patch.allow_remix = !!(allowRemix && p.project_path);
        await must(sb.from('posts').update(patch).eq('id', p.id));
        await must(sb.rpc('onion_publish', { target: p.id }));
        const notFound = await invite(p.id, collabs, me);
        await api.session();
        const post = await api.getPost(p.id); if (post) post.collabNotFound = notFound;
        return post;
      },
      /** the owner only: delete someone's account, their files first */
      async ownerDeleteAccount(userId) {
        const posts = await must(sb.from('posts').select('media_path,poster_path,project_path').eq('author', userId));
        const prof = await must(sb.from('profiles').select('avatar_path').eq('id', userId).maybeSingle());
        const files = posts.flatMap(p => [p.media_path, p.poster_path, p.project_path]).filter(Boolean);
        if (prof && prof.avatar_path) files.push(prof.avatar_path);
        for (let i = 0; i < files.length; i += 100) await sb.storage.from('media').remove(files.slice(i, i + 100)).catch(() => {});
        await must(sb.rpc('onion_owner_delete_account', { target: userId }));
      },
      /* ---- v1.7: contests and voting ---- */
      /** 'enter' | 'vote' | 'done' (the server decides for real; this is for the screens) */
      phase(c) {
        if (c.finished) return 'done';
        const now = Date.now();
        return now < new Date(c.entry_ends).getTime() ? 'enter' : now < new Date(c.vote_ends).getTime() ? 'vote' : 'done';
      },
      contestsReady() { return hasContests; },
      async contests(limit = 30) {
        const CON = `*,winner(${AUTHOR}),winner_post(id,kind,poster_path,media_path)`;
        let rows;
        try { rows = await must(sb.from('contests').select(CON).order('created_at', { ascending: false }).limit(limit)); }
        catch (e) { if (/contests/.test(e.message)) { hasContests = false; return []; } throw e; }
        const me = await uid(); let mine = [], votes = [];
        if (me && rows.length) {
          const cids = rows.map(c => c.id);
          [mine, votes] = await Promise.all([must(sb.from('contest_entries').select('contest_id,post_id').eq('author', me).in('contest_id', cids)),
            must(sb.from('contest_votes').select('contest_id,post_id').in('contest_id', cids))]);
        }
        for (const c of rows) {
          c.phase = api.phase(c);
          c.myEntry = (mine.find(m => m.contest_id === c.id) || {}).post_id || null;
          c.myVote = (votes.find(v => v.contest_id === c.id) || {}).post_id || null;
          if (c.winner) c.winner.avatar_url = publicUrl(c.winner.avatar_path);
          if (c.winner_post) c.winner_post.poster_url = publicUrl(c.winner_post.poster_path || (c.winner_post.kind !== 'video' ? c.winner_post.media_path : ''));
        }
        return rows;
      },
      /** one contest with its entries (each entry is a full post + vote_count), most votes first */
      async contest(id) {
        const c = (await api.contests(60)).find(x => x.id === id) ||
          await must(sb.from('contests').select(`*,winner(${AUTHOR})`).eq('id', id).maybeSingle());
        if (!c) return null;
        c.phase = api.phase(c);
        const rows = await must(sb.from('contest_entries').select(`vote_count,created_at,post_id(${POST})`).eq('contest_id', id)
          .order('vote_count', { ascending: false }).order('created_at', { ascending: true }).limit(200));
        const posts = await decorate(rows.map(r => r.post_id));
        c.entries = rows.map(r => { const p = r.post_id && posts.find(q => q.id === r.post_id.id); if (p) { p.votes = r.vote_count; p.entered_at = r.created_at; } return p; }).filter(Boolean);
        return c;
      },
      async createContest({ title, prompt = '', scene = 'stage', entryDays = 3, voteDays = 2 }) {
        return must(sb.rpc('onion_contest_create', { title: String(title || '').slice(0, 60), prompt: String(prompt || '').slice(0, 300), scene, entry_days: +entryDays, vote_days: +voteDays }));
      },
      async enterContest(contestId, postId) { if (!(await uid())) throw new Error('Log in to enter.'); await must(sb.rpc('onion_contest_enter', { contest: contestId, post: postId })); },
      async leaveContest(contestId) { await must(sb.rpc('onion_contest_leave', { contest: contestId })); },
      async vote(contestId, postId) { if (!(await uid())) throw new Error('Log in to vote.'); await must(sb.rpc('onion_contest_vote', { contest: contestId, post: postId })); },
      async unvote(contestId) { await must(sb.rpc('onion_contest_unvote', { contest: contestId })); },
      async finishContest(contestId) { await must(sb.rpc('onion_contest_finish', { contest: contestId })); },
      async crown(contestId, postId) { await must(sb.rpc('onion_contest_crown', { contest: contestId, post: postId })); },
      async startVoting(contestId) { await must(sb.rpc('onion_contest_start_voting', { contest: contestId })); },
      async removeEntry(contestId, postId) { await must(sb.rpc('onion_contest_remove_entry', { contest: contestId, post: postId })); },
      async deleteContest(contestId) { await must(sb.rpc('onion_contest_delete', { contest: contestId })); },
      /** your own posts you could enter (newest first) */
      async myPosts(limit = 60) {
        const me = await uid(); if (!me) return [];
        return decorate(await must(pub(sb.from('posts').select(POST)).eq('author', me).order('created_at', { ascending: false }).limit(limit)));
      },
      /* ---- v1.6: views, notifications, owner tools ---- */
      async view(postId) { if (!(await uid())) return; await sb.rpc('onion_view', { target: postId }); },
      async notifications(limit = 60) {
        if (!(await uid())) return [];
        const q = cols => sb.from('notifications').select(`id,kind,message,read,created_at,actor(${AUTHOR}),post_id(id,kind,poster_path,media_path,caption)${cols}`)
          .order('created_at', { ascending: false }).limit(limit);
        let rows;
        try { rows = await must(q(hasContests ? ',contest_id' : '')); }
        catch (e) { if (!/contest_id/.test(e.message)) throw e; hasContests = false; rows = await must(q('')); }
        for (const n of rows) {
          if (n.actor) n.actor.avatar_url = publicUrl(n.actor.avatar_path);
          if (n.post_id) n.post_id.poster_url = publicUrl(n.post_id.poster_path || (n.post_id.kind !== 'video' ? n.post_id.media_path : ''));
        }
        return rows;
      },
      async unreadCount() {
        if (!(await uid())) return 0;
        const r = await sb.from('notifications').select('id', { count: 'exact', head: true }).eq('read', false);
        if (r.error) throw new Error(friendly(r.error));
        return r.count || 0;
      },
      async markAllRead() { const me = await uid(); if (me) await must(sb.from('notifications').update({ read: true }).eq('user_id', me).eq('read', false)); },
      async deleteNotification(id) { await must(sb.from('notifications').delete().eq('id', id)); },
      async clearNotifications() { const me = await uid(); if (me) await must(sb.from('notifications').delete().eq('user_id', me)); },
      /** the owner only: set the likes and/or views a post shows (null keeps a number as it is) */
      async ownerSetCounts(postId, likes, views) {
        await must(sb.rpc('onion_owner_set_counts', { target: postId, likes: likes == null ? null : Math.round(likes), views: views == null ? null : Math.round(views) }));
      },
      async announce(message) { return must(sb.rpc('onion_owner_announce', { msg: String(message || '').slice(0, 500) })); },
      async deleteAccount() {
        const me = await uid(); if (!me) throw new Error('Log in first.');
        const mine = await must(sb.from('posts').select('media_path,poster_path,project_path').eq('author', me));
        const files = mine.flatMap(p => [p.media_path, p.poster_path, p.project_path]).filter(Boolean);
        if (meCache && meCache.avatar_path) files.push(meCache.avatar_path);
        for (let i = 0; i < files.length; i += 100) await sb.storage.from('media').remove(files.slice(i, i + 100)).catch(() => {});
        await must(sb.rpc('onion_delete_me'));
        await sb.auth.signOut(); meCache = null;
      },
    };
    return api;
  }
  root.OnionCommunityAPI = { createCommunity, friendly };
  if (typeof module !== 'undefined' && module.exports) module.exports = { createCommunity, friendly };
})(typeof window !== 'undefined' ? window : globalThis);
