// server.js — the entire backend. Built on Node's built-in http module
// (no Express — it isn't installable here without npm registry access).
// Every route below reads from and writes to a real SQLite database.
// There is no mock data anywhere in this file.
import 'dotenv/config';
console.log("Cloudinary:", process.env.CLOUDINARY_CLOUD_NAME);
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { run, get, all } from './db.js';
import { hashPassword, verifyPassword, createToken, verifyToken, tooManyAttempts } from './auth.js';
import { ApiError, V } from './validate.js';
import { applySecurityHeaders } from './security.js';
import {
  GAMES, RHYTHM_DIFFICULTIES, levelForPoints, levelProgress,
  computeRhythmReward, computeFlyerReward, validateScoreSubmission,
  checkAndUnlockAchievements, achievementsForUser, todayDateStr,
  dailyChallengeFor, maybeCompleteDailyChallenge,
} from './games.js';
import { BREEDS, getBreed, relatedBreedsFor } from './breeds.js';
import { logger, requestLogStart } from './logger.js';
import { handleLiveness, handleReadiness } from './health.js';
import { handleMetrics, observeHttp } from './metrics.js';
import { enforceRateLimit } from './rateLimit.js';
import { captureException } from './sentry.js';
import { handleUploadSignature, deleteAsset, publicIdFromUrl, MAX_BYTES } from './cloudinary.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, 'public');
const PORT = process.env.PORT || 3000;

// ---------- helpers ----------

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > 5_000_000) { // 5MB cap
        reject(new Error('Payload too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (chunks.length === 0) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString()));
      } catch {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

async function getAuthedUser(req) {
  const header = req.headers['authorization'] || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  const payload = verifyToken(token);
  if (!payload) return null;
  return await get('SELECT * FROM users WHERE id = ?', [payload.sub]);
}

function publicUser(u) {
  if (!u) return null;
  const { password_hash, password_salt, ...rest } = u;
  return { ...rest, ...levelProgress(u.meowment_points) };
}

function clientIp(req) {
  // Behind nginx/a load balancer, the real client IP arrives via
  // X-Forwarded-For (nginx/conf.d/ilovemeow.conf sets this). Only trust
  // it when TRUST_PROXY is set, so a direct internet connection to Node
  // (e.g. no reverse proxy configured) can't have its rate limiting
  // bypassed by a spoofed header.
  if (process.env.TRUST_PROXY === '1') {
    const forwarded = req.headers['x-forwarded-for'];
    if (forwarded) return forwarded.split(',')[0].trim();
  }
  return req.socket.remoteAddress || 'unknown';
}

// ---------- route handlers ----------

const routes = [];
function route(method, pattern, handler) {
  const keys = [];
  const regex = new RegExp(
    '^' + pattern.replace(/:[^/]+/g, (m) => { keys.push(m.slice(1)); return '([^/]+)'; }) + '$'
  );
  routes.push({ method, regex, keys, handler });
}

// ---- Auth ----

route('POST', '/api/auth/register', async (req, res) => {
  if (tooManyAttempts('register:' + clientIp(req))) {
    throw new ApiError(429, 'RATE_LIMITED', 'Too many attempts. Try again in a minute.');
  }
  const body = await readBody(req);
  const username = V.username(body.username);
  const email = V.email(body.email);
  const password = V.password(body.password);
  console.log("===== REGISTER REQUEST =====");
console.log("Username:", username);
console.log("Email:", email);

const existing = await get(
  'SELECT id FROM users WHERE username = ? OR email = ?',
  [username, email]
);

console.log("Existing:", existing);

if (existing) {
  console.log("Duplicate found!");
  throw new ApiError(409, 'ALREADY_EXISTS', 'That username or email is already taken.');
}
  const { hash, salt } = hashPassword(password);
  const id = crypto.randomUUID();
  await run(
    'INSERT INTO users (id, username, email, password_hash, password_salt) VALUES (?, ?, ?, ?, ?)',
    [id, username, email, hash, salt]
  );
  const user = await get('SELECT * FROM users WHERE id = ?', [id]);
  const token = createToken(id);
  sendJson(res, 201, { token, user: publicUser(user) });
});

route('POST', '/api/auth/login', async (req, res) => {
  if (tooManyAttempts('login:' + clientIp(req))) {
    throw new ApiError(429, 'RATE_LIMITED', 'Too many attempts. Try again in a minute.');
  }
  const body = await readBody(req);
  const usernameOrEmail = V.requiredString(body.usernameOrEmail, { field: 'usernameOrEmail', max: 254 });
  const password = V.requiredString(body.password, { field: 'password', max: 200 });
  const user = await get('SELECT * FROM users WHERE username = ? OR email = ?', [usernameOrEmail, usernameOrEmail]);
  if (!user || !verifyPassword(password, user.password_hash, user.password_salt)) {
    throw new ApiError(401, 'INVALID_CREDENTIALS', 'Incorrect username/email or password.');
  }
  const token = createToken(user.id);
  sendJson(res, 200, { token, user: publicUser(user) });
});

route('GET', '/api/auth/me', async (req, res) => {
  const user = await getAuthedUser(req);
  if (!user) return sendJson(res, 401, { error: 'Not authenticated' });
  sendJson(res, 200, { user: publicUser(user) });
});

// ---- Cats ----

route('POST', '/api/cats', async (req, res) => {
  const user = await getAuthedUser(req);
  if (!user) throw new ApiError(401, 'UNAUTHENTICATED', 'Not authenticated.');
  const body = await readBody(req);
  const name = V.requiredString(body.name, { field: 'name', min: 1, max: 30 });
  const breed = V.optionalString(body.breed, { field: 'breed', max: 40 });
  const gender = V.optionalString(body.gender, { field: 'gender', max: 20 });
  const birthday = V.optionalString(body.birthday, { field: 'birthday', max: 20 });
  const color = V.optionalString(body.color, { field: 'color', max: 40 });
  const favorite_food = V.optionalString(body.favorite_food, { field: 'favorite_food', max: 60 });
  const favorite_toy = V.optionalString(body.favorite_toy, { field: 'favorite_toy', max: 60 });
  const bio = V.optionalString(body.bio, { field: 'bio', max: 500 });
  const avatar_emoji = V.optionalString(body.avatar_emoji, { field: 'avatar_emoji', max: 8 }) || '🐾';
  const id = crypto.randomUUID();
  await run(
    `INSERT INTO cats (id, owner_id, name, breed, gender, birthday, color, favorite_food, favorite_toy, bio, avatar_emoji)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, user.id, name, breed, gender, birthday, color, favorite_food, favorite_toy, bio, avatar_emoji]
  );
  sendJson(res, 201, { cat: await get('SELECT * FROM cats WHERE id = ?', [id]) });
});

route('GET', '/api/cats', async (req, res, params, query) => {
  const ownerId = query.get('owner');
  const cats = ownerId
    ? await all('SELECT * FROM cats WHERE owner_id = ? ORDER BY created_at DESC', [ownerId])
    : await all('SELECT * FROM cats ORDER BY created_at DESC LIMIT 50');
  sendJson(res, 200, { cats });
});

route('GET', '/api/cats/:id', async (req, res, params) => {
  const cat = await get('SELECT * FROM cats WHERE id = ?', [params.id]);
  if (!cat) return sendJson(res, 404, { error: 'Cat not found' });
  const owner = await get('SELECT id, username, avatar_emoji FROM users WHERE id = ?', [cat.owner_id]);
  sendJson(res, 200, { cat, owner });
});

// ---- Reactions ----
// Replaces the old binary "purr" like with 8 cat-themed reaction types.
// A user has at most one reaction per Meow; picking a new type switches it
// in place (no separate unreact-then-react round trip needed), and picking
// the same type again removes it.
const REACTION_TYPES = {
  purr: '🐾', adorable: '😻', loaf: '🍞', zoomies: '⚡',
  sleepy: '😴', fishy: '🐟', royal: '👑', chaos: '😂',
};

// ---- Meows (feed) ----

async function attachCounts(meow, viewerId) {
  const rows = await all('SELECT type, COUNT(*) AS c FROM reactions WHERE meow_id = ? GROUP BY type', [meow.id]);
  const counts = {};
  let total = 0;
  for (const r of rows) { counts[r.type] = r.c; total += r.c; }
  const mine = viewerId
    ? (await get('SELECT type FROM reactions WHERE meow_id = ? AND user_id = ?', [meow.id, viewerId]))?.type || null
    : null;
  const meowmentCount = (await get('SELECT COUNT(*) AS c FROM meowments WHERE meow_id = ?', [meow.id])).c;
  return { ...meow, meowmentCount, reactions: { counts, total, mine } };
}

route('GET', '/api/feed', async (req, res, params, query) => {
  const viewer = await getAuthedUser(req);
  const limit = Math.min(parseInt(query.get('limit') || '20', 10), 50);
  const before = query.get('before');
  const rows = before
    ? await all(
        `SELECT m.*, u.username AS author_username, u.avatar_emoji AS author_avatar, u.avatar_url AS author_avatar_url, c.name AS cat_name
         FROM meows m JOIN users u ON u.id = m.author_id LEFT JOIN cats c ON c.id = m.cat_id
         WHERE m.created_at < ? ORDER BY m.created_at DESC LIMIT ?`,
        [before, limit]
      )
    : await all(
        `SELECT m.*, u.username AS author_username, u.avatar_emoji AS author_avatar, u.avatar_url AS author_avatar_url, c.name AS cat_name
         FROM meows m JOIN users u ON u.id = m.author_id LEFT JOIN cats c ON c.id = m.cat_id
         ORDER BY m.created_at DESC LIMIT ?`,
        [limit]
      );
  const feed = await Promise.all(rows.map((r) => attachCounts(r, viewer?.id)));
  sendJson(res, 200, { feed, empty: feed.length === 0 });
});

route('POST', '/api/meows', async (req, res) => {
  const user = await getAuthedUser(req);
  if (!user) throw new ApiError(401, 'UNAUTHENTICATED', 'Not authenticated.');
  if (tooManyAttempts('post:' + user.id, 15, 60_000)) {
    throw new ApiError(429, 'RATE_LIMITED', "You're posting too quickly. Slow down a little.");
  }
  const body = await readBody(req);
  const caption = V.optionalString(body.caption, { field: 'caption', max: 1000 });
  const image_url = V.optionalUrl(body.image_url, { field: 'image_url' });
  if (!caption && !image_url) throw new ApiError(400, 'EMPTY_POST', 'A Meow needs a caption or an image.');
  let cat_id = body.cat_id || null;
  if (cat_id) {
    const cat = await get('SELECT id FROM cats WHERE id = ? AND owner_id = ?', [cat_id, user.id]);
    if (!cat) throw new ApiError(403, 'FORBIDDEN', 'That cat is not yours to tag.');
  }
  const id = crypto.randomUUID();
  await run('INSERT INTO meows (id, author_id, cat_id, caption, image_url) VALUES (?, ?, ?, ?, ?)', [
    id, user.id, cat_id, caption, image_url,
  ]);
  await run('UPDATE users SET meowment_points = meowment_points + 5 WHERE id = ?', [user.id]);
  const newMeow = await get('SELECT m.*, u.username AS author_username, u.avatar_emoji AS author_avatar, u.avatar_url AS author_avatar_url FROM meows m JOIN users u ON u.id=m.author_id WHERE m.id = ?', [id]);
  sendJson(res, 201, { meow: await attachCounts(newMeow, user.id) });
});

route('DELETE', '/api/meows/:id', async (req, res, params) => {
  const user = await getAuthedUser(req);
  if (!user) return sendJson(res, 401, { error: 'Not authenticated' });
  const meow = await get('SELECT * FROM meows WHERE id = ?', [params.id]);
  if (!meow) return sendJson(res, 404, { error: 'Meow not found' });
  if (meow.author_id !== user.id) return sendJson(res, 403, { error: 'You can only delete your own Meows' });
  await run('DELETE FROM meows WHERE id = ?', [params.id]);
  sendJson(res, 200, { ok: true });
});

// ---- Reactions ----

route('GET', '/api/reactions/types', async (req, res) => {
  sendJson(res, 200, { types: REACTION_TYPES });
});

route('POST', '/api/meows/:id/react', async (req, res, params) => {
  const user = await getAuthedUser(req);
  if (!user) throw new ApiError(401, 'UNAUTHENTICATED', 'Not authenticated.');
  if (tooManyAttempts('react:' + user.id, 60, 60_000)) {
    throw new ApiError(429, 'RATE_LIMITED', 'Too many reactions in a row. Slow down a little.');
  }
  const meow = await get('SELECT * FROM meows WHERE id = ?', [params.id]);
  if (!meow) throw new ApiError(404, 'NOT_FOUND', 'Meow not found.');
  const { type } = await readBody(req);
  V.oneOf(type, Object.keys(REACTION_TYPES), { field: 'type' });

  const existing = await get('SELECT type FROM reactions WHERE meow_id = ? AND user_id = ?', [params.id, user.id]);
  if (existing && existing.type === type) {
    // Tapping the same reaction again removes it.
    await run('DELETE FROM reactions WHERE meow_id = ? AND user_id = ?', [params.id, user.id]);
  } else if (existing) {
    // Switching reaction type — one UPDATE, not a delete+insert round trip.
    await run('UPDATE reactions SET type = ?, created_at = datetime(\'now\') WHERE meow_id = ? AND user_id = ?', [type, params.id, user.id]);
  } else {
    await run('INSERT INTO reactions (meow_id, user_id, type) VALUES (?, ?, ?)', [params.id, user.id, type]);
    if (meow.author_id !== user.id) {
      await run('UPDATE users SET meowment_points = meowment_points + 1 WHERE id = ?', [meow.author_id]);
    }
  }

  const rows = await all('SELECT type, COUNT(*) AS c FROM reactions WHERE meow_id = ? GROUP BY type', [params.id]);
  const counts = {};
  let total = 0;
  for (const r of rows) { counts[r.type] = r.c; total += r.c; }
  const mine = existing && existing.type === type ? null : type;
  sendJson(res, 200, { reactions: { counts, total, mine } });
});

// ---- Meowments (comments) ----
// Threaded: any meowment can have a parent_id. Soft-deleted comments keep their
// row (as "[deleted]") so replies underneath them don't orphan or vanish.

function buildThread(rows) {
  const byId = new Map(rows.map(r => [r.id, { ...r, replies: [] }]));
  const roots = [];
  for (const r of byId.values()) {
    if (r.parent_id && byId.has(r.parent_id)) {
      byId.get(r.parent_id).replies.push(r);
    } else {
      roots.push(r);
    }
  }
  const sortChron = (a, b) => a.created_at.localeCompare(b.created_at);
  for (const r of byId.values()) r.replies.sort(sortChron);
  // Pinned root comment(s) first, then chronological.
  roots.sort((a, b) => (b.pinned - a.pinned) || sortChron(a, b));
  return roots;
}

route('GET', '/api/meows/:id/meowments', async (req, res, params) => {
  const rows = await all(
    `SELECT mm.*, u.username AS author_username, u.avatar_emoji AS author_avatar, u.avatar_url AS author_avatar_url
     FROM meowments mm JOIN users u ON u.id = mm.author_id
     WHERE mm.meow_id = ? ORDER BY mm.created_at ASC`,
    [params.id]
  );
  const shaped = rows.map(r => ({
    ...r,
    body: r.deleted ? '[deleted]' : r.body,
    gif_url: r.deleted ? '' : r.gif_url,
  }));
  sendJson(res, 200, { meowments: buildThread(shaped) });
});

route('POST', '/api/meows/:id/meowments', async (req, res, params) => {
  const user = await getAuthedUser(req);
  if (!user) throw new ApiError(401, 'UNAUTHENTICATED', 'Not authenticated.');
  if (tooManyAttempts('comment:' + user.id, 30, 60_000)) {
    throw new ApiError(429, 'RATE_LIMITED', "You're commenting too quickly. Slow down a little.");
  }
  const meow = await get('SELECT * FROM meows WHERE id = ?', [params.id]);
  if (!meow) throw new ApiError(404, 'NOT_FOUND', 'Meow not found.');
  const reqBody = await readBody(req);
  const body = V.optionalString(reqBody.body, { field: 'body', max: 500 });
  const gif_url = V.optionalUrl(reqBody.gif_url, { field: 'gif_url' });
  if (!body && !gif_url) throw new ApiError(400, 'EMPTY_COMMENT', 'Meowment cannot be empty.');
  let parent = null;
  if (reqBody.parent_id) {
    parent = await get('SELECT * FROM meowments WHERE id = ? AND meow_id = ?', [reqBody.parent_id, params.id]);
    if (!parent) throw new ApiError(400, 'PARENT_NOT_FOUND', "The comment you're replying to no longer exists.");
  }
  const id = crypto.randomUUID();
  await run(
    'INSERT INTO meowments (id, meow_id, author_id, parent_id, body, gif_url) VALUES (?, ?, ?, ?, ?, ?)',
    [id, params.id, user.id, reqBody.parent_id || null, body, gif_url]
  );
  if (meow.author_id !== user.id) {
    await run('UPDATE users SET meowment_points = meowment_points + 2 WHERE id = ?', [meow.author_id]);
  }
  sendJson(res, 201, {
    meowment: await get(
      `SELECT mm.*, u.username AS author_username, u.avatar_emoji AS author_avatar, u.avatar_url AS author_avatar_url
       FROM meowments mm JOIN users u ON u.id = mm.author_id WHERE mm.id = ?`,
      [id]
    ),
  });
});

route('PATCH', '/api/meowments/:id', async (req, res, params) => {
  const user = await getAuthedUser(req);
  if (!user) return sendJson(res, 401, { error: 'Not authenticated' });
  const mm = await get('SELECT * FROM meowments WHERE id = ?', [params.id]);
  if (!mm || mm.deleted) return sendJson(res, 404, { error: 'Meowment not found' });
  if (mm.author_id !== user.id) return sendJson(res, 403, { error: 'You can only edit your own Meowments' });
  const { body } = await readBody(req);
  if (!body || !body.trim()) return sendJson(res, 400, { error: 'Meowment cannot be empty' });
  if (body.length > 500) return sendJson(res, 400, { error: 'Meowment is too long (max 500 characters)' });
  await run('UPDATE meowments SET body = ?, edited_at = datetime(\'now\') WHERE id = ?', [body.trim(), params.id]);
  sendJson(res, 200, {
    meowment: await get(
      `SELECT mm.*, u.username AS author_username, u.avatar_emoji AS author_avatar, u.avatar_url AS author_avatar_url
       FROM meowments mm JOIN users u ON u.id = mm.author_id WHERE mm.id = ?`,
      [params.id]
    ),
  });
});

route('DELETE', '/api/meowments/:id', async (req, res, params) => {
  const user = await getAuthedUser(req);
  if (!user) return sendJson(res, 401, { error: 'Not authenticated' });
  const mm = await get('SELECT * FROM meowments WHERE id = ?', [params.id]);
  if (!mm) return sendJson(res, 404, { error: 'Meowment not found' });
  const meow = await get('SELECT * FROM meows WHERE id = ?', [mm.meow_id]);
  const canDelete = mm.author_id === user.id || (meow && meow.author_id === user.id);
  if (!canDelete) return sendJson(res, 403, { error: 'You can only delete your own Meowments (or ones on your own Meow)' });
  const hasReplies = (await get('SELECT COUNT(*) AS c FROM meowments WHERE parent_id = ?', [params.id])).c > 0;
  if (hasReplies) {
    // Soft delete so replies underneath keep their place in the thread.
    await run('UPDATE meowments SET deleted = 1, body = \'\', gif_url = \'\', pinned = 0 WHERE id = ?', [params.id]);
  } else {
    await run('DELETE FROM meowments WHERE id = ?', [params.id]);
  }
  sendJson(res, 200, { ok: true });
});

route('POST', '/api/meowments/:id/pin', async (req, res, params) => {
  const user = await getAuthedUser(req);
  if (!user) return sendJson(res, 401, { error: 'Not authenticated' });
  const mm = await get('SELECT * FROM meowments WHERE id = ?', [params.id]);
  if (!mm || mm.deleted) return sendJson(res, 404, { error: 'Meowment not found' });
  if (mm.parent_id) return sendJson(res, 400, { error: 'Only top-level Meowments can be pinned' });
  const meow = await get('SELECT * FROM meows WHERE id = ?', [mm.meow_id]);
  if (!meow || meow.author_id !== user.id) return sendJson(res, 403, { error: 'Only the Meow\'s author can pin a comment' });
  if (mm.pinned) {
    await run('UPDATE meowments SET pinned = 0 WHERE id = ?', [params.id]);
    return sendJson(res, 200, { pinned: false });
  }
  // Only one pinned comment per Meow at a time.
  await run('UPDATE meowments SET pinned = 0 WHERE meow_id = ?', [mm.meow_id]);
  await run('UPDATE meowments SET pinned = 1 WHERE id = ?', [params.id]);
  sendJson(res, 200, { pinned: true });
});

// ---- Explore (Pinterest-style masonry with real filters) ----

function ageBucket(birthday) {
  if (!birthday) return null;
  const b = new Date(birthday);
  if (isNaN(b.getTime())) return null;
  const years = (Date.now() - b.getTime()) / (1000 * 60 * 60 * 24 * 365.25);
  if (years < 1) return 'kitten';
  if (years < 7) return 'adult';
  return 'senior';
}

route('GET', '/api/explore/filters', async (req, res) => {
  const breedRows = await all(`SELECT DISTINCT breed FROM cats WHERE breed != '' ORDER BY breed ASC`);
  const colorRows = await all(`SELECT DISTINCT color FROM cats WHERE color != '' ORDER BY color ASC`);
  const breeds = breedRows.map(r => r.breed);
  const colors = colorRows.map(r => r.color);
  sendJson(res, 200, { breeds, colors });
});

route('GET', '/api/explore', async (req, res, params, query) => {
  const viewer = await getAuthedUser(req);
  const breed = query.get('breed') || '';
  const color = query.get('color') || '';
  const age = query.get('age') || ''; // kitten | adult | senior
  const sort = query.get('sort') || 'newest'; // newest | trending | discussed
  const limit = Math.min(parseInt(query.get('limit') || '30', 10), 60);
  const offset = Math.max(parseInt(query.get('offset') || '0', 10), 0);

  const clauses = [];
  const args = [];
  if (breed) { clauses.push('c.breed = ?'); args.push(breed); }
  if (color) { clauses.push('c.color = ?'); args.push(color); }
  const where = clauses.length ? 'WHERE ' + clauses.join(' AND ') : '';

  // Pull a generous window, then apply the age-bucket filter (computed from
  // birthday in JS, since SQLite date math is awkward) and sort/paginate.
  let rows = await all(
    `SELECT m.*, u.username AS author_username, u.avatar_emoji AS author_avatar, u.avatar_url AS author_avatar_url,
            c.name AS cat_name, c.breed AS cat_breed, c.color AS cat_color, c.birthday AS cat_birthday
     FROM meows m
     JOIN users u ON u.id = m.author_id
     LEFT JOIN cats c ON c.id = m.cat_id
     ${where}
     ORDER BY m.created_at DESC
     LIMIT 500`,
    args
  );

  if (age) rows = rows.filter(r => ageBucket(r.cat_birthday) === age);

  let shaped = await Promise.all(rows.map(r => attachCounts(r, viewer?.id)));

  if (sort === 'trending') {
    shaped.sort((a, b) => (b.reactions.total - a.reactions.total) || a.created_at.localeCompare(b.created_at) * -1);
  } else if (sort === 'discussed') {
    shaped.sort((a, b) => (b.meowmentCount - a.meowmentCount) || a.created_at.localeCompare(b.created_at) * -1);
  } // 'newest' already sorted by the SQL query

  const page = shaped.slice(offset, offset + limit);
  sendJson(res, 200, { results: page, total: shaped.length, hasMore: offset + limit < shaped.length });
});

// ---- Global search ----

route('GET', '/api/search', async (req, res, params, query) => {
  if (tooManyAttempts('search:' + clientIp(req), 40, 60_000)) {
    throw new ApiError(429, 'RATE_LIMITED', 'Too many searches. Try again in a minute.');
  }
  const q = (query.get('q') || '').trim();
  if (q.length < 2) return sendJson(res, 200, { users: [], cats: [], meows: [] });
  const like = `%${q.replace(/[%_]/g, '')}%`;

  const users = await all(
    `SELECT id, username, avatar_emoji, avatar_url, meowment_points FROM users WHERE username LIKE ? ORDER BY meowment_points DESC LIMIT 6`,
    [like]
  );
  const cats = await all(
    `SELECT cats.id, cats.name, cats.breed, cats.avatar_emoji, u.username AS owner_username
     FROM cats JOIN users u ON u.id = cats.owner_id
     WHERE cats.name LIKE ? OR cats.breed LIKE ? ORDER BY cats.created_at DESC LIMIT 6`,
    [like, like]
  );
  const meows = await all(
    `SELECT m.id, m.caption, m.image_url, m.created_at, u.username AS author_username
     FROM meows m JOIN users u ON u.id = m.author_id
     WHERE m.caption LIKE ? ORDER BY m.created_at DESC LIMIT 6`,
    [like]
  );

  // Log real, non-trivial searches for trending-search computation.
  if (q.length >= 2 && q.length <= 60) {
    await run('INSERT INTO search_logs (id, query) VALUES (?, ?)', [crypto.randomUUID(), q.toLowerCase()]);
  }

  sendJson(res, 200, { users, cats, meows });
});

route('GET', '/api/search/trending', async (req, res) => {
  const rows = await all(
    `SELECT query, COUNT(*) AS c FROM search_logs
     WHERE created_at >= datetime('now', '-7 days')
     GROUP BY query ORDER BY c DESC, query ASC LIMIT 8`
  );
  sendJson(res, 200, { trending: rows.map(r => r.query) });
});

// ---- Games ----

route('POST', '/api/games/session', async (req, res) => {
  const user = await getAuthedUser(req);
  if (!user) throw new ApiError(401, 'UNAUTHENTICATED', 'Not authenticated.');
  if (tooManyAttempts('game-session:' + user.id, 20, 60_000)) {
    throw new ApiError(429, 'RATE_LIMITED', 'Too many game sessions started at once. Slow down a little.');
  }
  const { game, difficulty } = await readBody(req);
  V.oneOf(game, GAMES, { field: 'game' });
  if (game === 'rhythm') V.oneOf(difficulty, RHYTHM_DIFFICULTIES, { field: 'difficulty' });
  const id = crypto.randomUUID();
  await run('INSERT INTO game_sessions (id, user_id, game, difficulty) VALUES (?, ?, ?, ?)', [id, user.id, game, difficulty || 'default']);
  sendJson(res, 201, { session_id: id });
});

route('POST', '/api/games/scores', async (req, res) => {
  const user = await getAuthedUser(req);
  if (!user) return sendJson(res, 401, { error: 'Not authenticated' });
  const { session_id, score, max_combo, duration_ms, coins_collected } = await readBody(req);

  const session = await get('SELECT * FROM game_sessions WHERE id = ?', [session_id]);
  if (!session || session.user_id !== user.id) return sendJson(res, 404, { error: 'Game session not found' });
  if (session.used) return sendJson(res, 400, { error: 'This game session was already submitted' });
  const startedMs = new Date(session.started_at.replace(' ', 'T') + 'Z').getTime();
  if (Date.now() - startedMs > 15 * 60 * 1000) return sendJson(res, 400, { error: 'Game session expired' });

  const err = validateScoreSubmission({
    game: session.game, difficulty: session.difficulty,
    score: Number(score), maxCombo: Number(max_combo) || 0, durationMs: Number(duration_ms),
  });
  if (err) return sendJson(res, 400, { error: err });

  await run('UPDATE game_sessions SET used = 1 WHERE id = ?', [session_id]);

  const reward = session.game === 'rhythm'
    ? computeRhythmReward({ score: Number(score), difficulty: session.difficulty, maxCombo: Number(max_combo) || 0 })
    : computeFlyerReward({ score: Number(score), coinsCollected: Number(coins_collected) || 0 });

  const scoreId = crypto.randomUUID();
  await run(
    `INSERT INTO game_scores (id, user_id, game, difficulty, score, max_combo, duration_ms, coins_earned, xp_earned)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [scoreId, user.id, session.game, session.difficulty, Number(score), Number(max_combo) || 0, Number(duration_ms), reward.coins, reward.xp]
  );
  await run('UPDATE users SET fish_coins = fish_coins + ?, meowment_points = meowment_points + ? WHERE id = ?', [reward.coins, reward.xp, user.id]);

  const challengeCompleted = await maybeCompleteDailyChallenge(user.id, { game: session.game, difficulty: session.difficulty, score: Number(score) });

  // Did this run land in today's top 3 for its game? (feeds the Podium Finish achievement)
  const todayTop3 = await all(
    `SELECT user_id, MAX(score) AS best FROM game_scores
     WHERE game = ? AND date(created_at) = date('now') GROUP BY user_id ORDER BY best DESC LIMIT 3`,
    [session.game]
  );
  const hitTop3Today = todayTop3.some(r => r.user_id === user.id);

  const newAchievements = await checkAndUnlockAchievements(user.id, { hitTop3Today });
  const updatedUser = await get('SELECT * FROM users WHERE id = ?', [user.id]);

  sendJson(res, 201, {
    score_id: scoreId,
    coins_earned: reward.coins,
    xp_earned: reward.xp,
    challengeCompleted,
    newAchievements,
    user: publicUser(updatedUser),
  });
});

route('GET', '/api/games/leaderboard', async (req, res, params, query) => {
  const game = query.get('game');
  const period = query.get('period') || 'alltime'; // daily | weekly | alltime
  if (!GAMES.includes(game)) return sendJson(res, 400, { error: 'Unknown game' });
  let dateClause = '';
  if (period === 'daily') dateClause = `AND date(gs.created_at) = date('now')`;
  else if (period === 'weekly') dateClause = `AND gs.created_at >= datetime('now', '-7 days')`;

  const rows = await all(
    `SELECT u.username, u.avatar_emoji, MAX(gs.score) AS best_score, gs.difficulty
     FROM game_scores gs JOIN users u ON u.id = gs.user_id
     WHERE gs.game = ? ${dateClause}
     GROUP BY gs.user_id
     ORDER BY best_score DESC
     LIMIT 20`,
    [game]
  );
  sendJson(res, 200, { leaderboard: rows.map((r, i) => ({ rank: i + 1, ...r })) });
});

route('GET', '/api/games/daily-challenge', async (req, res) => {
  const user = await getAuthedUser(req);
  const dateStr = todayDateStr();
  const challenge = dailyChallengeFor(dateStr);
  const completed = user
    ? !!(await get('SELECT 1 FROM daily_challenge_completions WHERE user_id = ? AND challenge_date = ?', [user.id, dateStr]))
    : false;
  sendJson(res, 200, { challenge, completed });
});

route('GET', '/api/games/achievements', async (req, res) => {
  const user = await getAuthedUser(req);
  if (!user) return sendJson(res, 401, { error: 'Not authenticated' });
  sendJson(res, 200, { achievements: await achievementsForUser(user.id) });
});

route('GET', '/api/games/hub', async (req, res) => {
  const user = await getAuthedUser(req);
  if (!user) return sendJson(res, 401, { error: 'Not authenticated' });

  const bestRhythm = (await get(`SELECT MAX(score) AS s FROM game_scores WHERE user_id = ? AND game = 'rhythm'`, [user.id])).s || 0;
  const bestFlyer = (await get(`SELECT MAX(score) AS s FROM game_scores WHERE user_id = ? AND game = 'flyer'`, [user.id])).s || 0;
  const totalPlays = (await get(`SELECT COUNT(*) c FROM game_scores WHERE user_id = ?`, [user.id])).c;
  const totalCoins = (await get(`SELECT COALESCE(SUM(coins_earned),0) c FROM game_scores WHERE user_id = ?`, [user.id])).c;
  const totalXp = (await get(`SELECT COALESCE(SUM(xp_earned),0) c FROM game_scores WHERE user_id = ?`, [user.id])).c;

  const recentlyPlayed = await all(
    `SELECT game, difficulty, score, max_combo, created_at FROM game_scores WHERE user_id = ? ORDER BY created_at DESC LIMIT 5`,
    [user.id]
  );

  const lastPlayed = recentlyPlayed[0] || null;

  const dateStr = todayDateStr();
  const challenge = dailyChallengeFor(dateStr);
  const challengeCompleted = !!(await get('SELECT 1 FROM daily_challenge_completions WHERE user_id = ? AND challenge_date = ?', [user.id, dateStr]));

  const achievements = await achievementsForUser(user.id);

  sendJson(res, 200, {
    continuePlaying: lastPlayed ? { game: lastPlayed.game, difficulty: lastPlayed.difficulty } : null,
    bestScores: { rhythm: bestRhythm, flyer: bestFlyer },
    stats: { totalPlays, totalCoins, totalXp },
    recentlyPlayed,
    dailyChallenge: { ...challenge, completed: challengeCompleted },
    achievements,
    levelProgress: levelProgress(user.meowment_points),
  });
});

// ---- Breed Explorer ----
// Reference content (breeds.js) is static, but the "how many cats on I Love
// Meow are this breed" count below is real, live data from the cats table —
// not part of the static file.

route('GET', '/api/breeds', async (req, res, params, query) => {
  const coat = query.get('coat') || '';
  const maxCare = query.get('maxCare') ? Number(query.get('maxCare')) : null;
  const minEnergy = query.get('minEnergy') ? Number(query.get('minEnergy')) : null;
  let list = BREEDS;
  if (coat) list = list.filter(b => b.coatLength === coat);
  if (maxCare) list = list.filter(b => b.careDifficulty <= maxCare);
  if (minEnergy) list = list.filter(b => b.energyLevel >= minEnergy);
  sendJson(res, 200, {
    breeds: list.map(({ related, ...rest }) => rest), // trim related[] from list view; detail view expands it
    total: list.length,
  });
});

route('GET', '/api/breeds/:slug', async (req, res, params) => {
  const breed = getBreed(params.slug);
  if (!breed) throw new ApiError(404, 'NOT_FOUND', 'No breed found with that name.');
  const catCount = (await get('SELECT COUNT(*) AS c FROM cats WHERE breed = ?', [breed.name])).c;
  sendJson(res, 200, {
    breed: { ...breed, related: relatedBreedsFor(params.slug).map(({ related, ...rest }) => rest) },
    catsOnPlatform: catCount,
  });
});

// ---- Health ----

route('GET', '/api/health', async (req, res) => {
  sendJson(res, 200, { status: 'ok', time: new Date().toISOString() });
});

// ---- Uploads (Cloudinary signed direct upload — see cloudinary.js) ----

route('POST', '/api/upload/signature', async (req, res, params, query) => {
  const user = await getAuthedUser(req);
  if (!user) throw new ApiError(401, 'UNAUTHORIZED', 'Log in to upload images.');
  handleUploadSignature(req, res, { type: query.get('type') });
});

// Real, server-side "never trust the client" size check: the browser
// reports what Cloudinary's own upload response said the final asset size
// was (Cloudinary re-encodes/derives this itself — it isn't something the
// client can fabricate a smaller number for and have it stick, since we
// re-derive the public_id from the secure_url rather than trusting one
// passed in). If it's over the limit, delete the asset immediately and
// reject; the browser then shows the person a friendly error and never
// stores that URL anywhere.
route('POST', '/api/upload/verify', async (req, res) => {
  const user = await getAuthedUser(req);
  if (!user) throw new ApiError(401, 'UNAUTHENTICATED', 'Not authenticated.');
  const body = await readBody(req);
  const secure_url = V.url(body.secure_url, { field: 'secure_url' });
  const bytes = V.number(body.bytes, { field: 'bytes', min: 0, integer: true });

  const publicId = publicIdFromUrl(secure_url);
  if (!publicId) throw new ApiError(400, 'INVALID_UPLOAD', 'That doesn\'t look like an upload from this app.');

  if (bytes > MAX_BYTES) {
    await deleteAsset(publicId);
    throw new ApiError(413, 'FILE_TOO_LARGE', 'That image is over 10MB even after compression — try a smaller photo.');
  }

  sendJson(res, 200, { ok: true, url: secure_url });
});

// ---- Profile (avatar / cover photo) ----
// The actual file bytes go straight from the browser to Cloudinary via the
// signed upload above — this just persists the resulting secure URL. We
// still validate it's a well-formed http(s) URL (same rule as meow
// image_url) rather than trusting the client blindly.
route('PATCH', '/api/profile', async (req, res) => {
  const user = await getAuthedUser(req);
  if (!user) throw new ApiError(401, 'UNAUTHENTICATED', 'Not authenticated.');
  const body = await readBody(req);
  const updates = {};
  if (body.avatar_url !== undefined) updates.avatar_url = V.optionalUrl(body.avatar_url, { field: 'avatar_url' });
  if (body.cover_url !== undefined) updates.cover_url = V.optionalUrl(body.cover_url, { field: 'cover_url' });
  const keys = Object.keys(updates);
  if (!keys.length) throw new ApiError(400, 'NO_CHANGES', 'Nothing to update.');
  await run(`UPDATE users SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`, [...keys.map((k) => updates[k]), user.id]);
  const updated = await get('SELECT * FROM users WHERE id = ?', [user.id]);
  sendJson(res, 200, { user: publicUser(updated) });
});

// ---------- static file serving ----------

const MIME = {
  '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function serveStatic(req, res, pathname) {
  let filePath = path.join(PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname);
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403); return res.end('Forbidden');
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      // SPA-ish fallback for clean routes like /feed, /profile
      const fallback = path.join(PUBLIC_DIR, pathname.replace(/\/$/, '') + '.html');
      fs.readFile(fallback, (err2, data2) => {
        if (err2) {
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          return res.end('Not found');
        }
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(data2);
      });
      return;
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

// ---------- server ----------

const server = http.createServer(async (req, res) => {
  applySecurityHeaders(res);
  const log = requestLogStart(req);
  res.setHeader('X-Request-Id', log.id);
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = decodeURIComponent(url.pathname);
  const startedAt = process.hrtime.bigint();

  // Orchestrator/load-balancer probes: cheap, no rate limiting, no logging
  // noise (Docker/K8s hit these every few seconds).
  if (pathname === '/health' && req.method === 'GET') {
    return handleLiveness(res);
  }
  if (pathname === '/health/ready' && req.method === 'GET') {
    return handleReadiness(res);
  }
  if (pathname === '/metrics' && req.method === 'GET') {
    return handleMetrics(req, res);
  }

  if (pathname.startsWith('/api/')) {
    // General-purpose rate limit ahead of routing. Auth endpoints have
    // their own stricter, endpoint-specific throttle (auth.js
    // tooManyAttempts) applied inside the handler in addition to this.
    const limited = await enforceRateLimit(req, res, clientIp(req));
    if (limited) {
      log.finish(res, { rate_limited: true });
      return;
    }

    const match = routes.find((r) => r.method === req.method && r.regex.test(pathname));
    if (!match) {
      sendJson(res, 404, { error: 'No such API route', code: 'NOT_FOUND' });
      log.finish(res);
      observeHttp(req.method, pathname, res.statusCode, Number(process.hrtime.bigint() - startedAt) / 1e9);
      return;
    }
    const values = match.regex.exec(pathname).slice(1);
    const params = Object.fromEntries(match.keys.map((k, i) => [k, values[i]]));
    try {
      await match.handler(req, res, params, url.searchParams);
    } catch (err) {
      if (err instanceof ApiError) {
        sendJson(res, err.status, { error: err.message, code: err.code });
      } else if (err.message === 'Payload too large') {
        sendJson(res, 413, { error: err.message, code: 'PAYLOAD_TOO_LARGE' });
      } else if (err.message === 'Invalid JSON') {
        sendJson(res, 400, { error: err.message, code: 'INVALID_JSON' });
      } else {
        // Unexpected error: log full details server-side (and ship to
        // Sentry if configured), never leak internals (stack traces, SQL,
        // file paths) to the client.
        logger.error('unhandled_route_error', { request_id: log.id, path: pathname, error: err.message, stack: err.stack });
        captureException(err, { request_id: log.id, path: pathname, method: req.method });
        sendJson(res, 500, { error: 'Something went wrong. Please try again.', code: 'INTERNAL_ERROR' });
      }
    }
    log.finish(res);
    observeHttp(req.method, match.regex.source, res.statusCode, Number(process.hrtime.bigint() - startedAt) / 1e9);
    return;
  }

  serveStatic(req, res, pathname);
  res.on('finish', () => log.finish(res));
});

// Fail loudly on unhandled promise rejections / uncaught exceptions instead
// of leaving the process in an undefined state — Docker's restart policy
// (docker-compose.yml: `restart: unless-stopped`) brings it back up clean.
process.on('unhandledRejection', (err) => {
  logger.error('unhandled_rejection', { error: err?.message, stack: err?.stack });
  captureException(err instanceof Error ? err : new Error(String(err)));
});
process.on('uncaughtException', (err) => {
  logger.error('uncaught_exception', { error: err.message, stack: err.stack });
  captureException(err);
  process.exit(1);
});

// Graceful shutdown: stop accepting new connections, let in-flight
// requests finish, then exit. Docker/K8s send SIGTERM before SIGKILL —
// without this handler, in-flight requests get dropped on every deploy.
function shutdown(signal) {
  logger.info('shutting_down', { signal });
  server.close(() => {
    logger.info('shutdown_complete', {});
    process.exit(0);
  });
  // Don't hang forever waiting for slow/stuck connections.
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

server.listen(PORT, () => {
  logger.info('server_started', { port: PORT, node_env: process.env.NODE_ENV || 'development' });
  console.log(`🐾 I Love Meow running at http://localhost:${PORT}`);
});
