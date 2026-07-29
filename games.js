// games.js — shared game logic: leveling, reward formulas, achievement catalog,
// anti-cheat plausibility caps, and the deterministic daily challenge.
// Kept separate from server.js so the rules governing rewards live in one place.

import { run, get, all } from './db.js';

export const GAMES = ['rhythm', 'flyer'];
export const RHYTHM_DIFFICULTIES = ['easy', 'medium', 'hard'];

// ---- Leveling (drives the "level" shown on profile, derived from lifetime
// Meowment Points — not a separate stored counter, so it can never drift out
// of sync with the points total). ----
export function levelForPoints(points) {
  return Math.max(1, Math.floor(1 + Math.sqrt(Math.max(points, 0) / 25)));
}
export function pointsForLevel(level) {
  return Math.pow(level - 1, 2) * 25;
}
// ---- Named level tiers ----
// 20 tiers x 5 sub-levels (I-V) = 100 named levels, in the spirit of the
// spec's example progression (Curious Kitten -> ... -> Legendary Meow).
// Computed from the numeric level rather than hand-listing 100 unique
// strings, which would be unmaintainable and mostly filler.
const LEVEL_TIERS = [
  'Curious Kitten', 'Playful Kitten', 'Young Hunter', 'Little Explorer', 'Backyard Adventurer',
  'Rising Whiskers', 'Clever Companion', 'Guardian', 'Swift Paws', 'Night Prowler',
  'Purr Master', 'Fish Whisperer', 'Loaf Legend', 'Sofa Sovereign', 'Community Champion',
  'Lion Heart', 'Celestial Cat', 'Mythic Meower', 'Grand Whisker', 'Legendary Meow',
];
const SUB_NUMERALS = ['I', 'II', 'III', 'IV', 'V'];

export function levelTierName(level) {
  const clamped = Math.max(1, Math.floor(level));
  const tierIndex = Math.min(LEVEL_TIERS.length - 1, Math.floor((clamped - 1) / 5));
  const tierName = LEVEL_TIERS[tierIndex];
  const isOverflow = clamped > LEVEL_TIERS.length * 5; // past level 100
  if (isOverflow) return `${tierName} +${clamped - LEVEL_TIERS.length * 5}`;
  const subLevel = ((clamped - 1) % 5); // 0-4
  return `${tierName} ${SUB_NUMERALS[subLevel]}`;
}

export function levelProgress(points) {
  const level = levelForPoints(points);
  const floor = pointsForLevel(level);
  const ceil = pointsForLevel(level + 1);
  return {
    level,
    tierName: levelTierName(level),
    pointsIntoLevel: points - floor,
    pointsForNextLevel: ceil - floor,
    progressPct: Math.min(100, Math.round(((points - floor) / (ceil - floor)) * 100)),
  };
}

// ---- Reward formulas ----
// Deliberately capped per-submission so a single freak run can't dump huge
// amounts of currency into an account.
const DIFF_MULT = { easy: 1, medium: 1.5, hard: 2 };

export function computeRhythmReward({ score, difficulty, maxCombo }) {
  const mult = DIFF_MULT[difficulty] || 1;
  const xp = Math.min(300, Math.round((score / 40) * mult));
  const coins = Math.min(150, Math.round((score / 90) * mult) + Math.floor(maxCombo / 10));
  return { xp, coins };
}

export function computeFlyerReward({ score, coinsCollected }) {
  const xp = Math.min(300, Math.round(score / 25));
  const coins = Math.min(150, Math.max(0, Math.round(coinsCollected)));
  return { xp, coins };
}

// ---- Anti-cheat: server-side plausibility bounds ----
// We can't fully verify client-run gameplay without a replay/simulation
// system, which is out of scope here. What we *can* do honestly: bound how
// many points a session could plausibly earn per second of real playtime
// (backed by a single-use, timestamped session token), and reject anything
// that blows past it.
const MAX_POINTS_PER_SEC = {
  rhythm: { easy: 18, medium: 30, hard: 48 },
  flyer: { default: 40 },
};

export function validateScoreSubmission({ game, difficulty, score, maxCombo, durationMs }) {
  if (!GAMES.includes(game)) return 'Unknown game';
  if (!Number.isFinite(score) || score < 0 || score > 999999) return 'Invalid score';
  if (!Number.isFinite(durationMs) || durationMs < 1000 || durationMs > 15 * 60 * 1000) return 'Invalid session duration';
  if (score > 0 && durationMs < 1500) return 'Score submitted too fast to be plausible';

  const seconds = durationMs / 1000;
  let capPerSec;
  if (game === 'rhythm') {
    capPerSec = (MAX_POINTS_PER_SEC.rhythm[difficulty] ?? MAX_POINTS_PER_SEC.rhythm.hard);
  } else {
    capPerSec = MAX_POINTS_PER_SEC.flyer.default;
  }
  const cap = seconds * capPerSec * 1.15; // 15% tolerance for bursty scoring
  if (score > cap) return 'Score exceeds the plausible maximum for this play duration';

  if (game === 'rhythm') {
    if (!Number.isFinite(maxCombo) || maxCombo < 0 || maxCombo > 5000) return 'Invalid combo';
  }
  return null; // valid
}

// ---- Achievement catalog ----
// A starter set of real, working, game-tied achievements — not a filler list
// of 100 placeholders. Each `check` runs against the player's real game
// history at submission time.
export const ACHIEVEMENTS = [
  {
    key: 'first_beat', game: 'rhythm', icon: '🥁', name: 'First Beat',
    description: 'Play the rhythm game for the first time.',
    check: (ctx) => ctx.rhythmPlays >= 1,
  },
  {
    key: 'combo_20', game: 'rhythm', icon: '🔥', name: 'Combo Starter',
    description: 'Reach a 20x combo in the rhythm game.',
    check: (ctx) => ctx.bestCombo >= 20,
  },
  {
    key: 'combo_50', game: 'rhythm', icon: '⚡', name: 'Combo Master',
    description: 'Reach a 50x combo in the rhythm game.',
    check: (ctx) => ctx.bestCombo >= 50,
  },
  {
    key: 'rhythm_hard_clear', game: 'rhythm', icon: '🐾', name: 'Paws of Steel',
    description: 'Score 400+ on Hard difficulty in the rhythm game.',
    check: (ctx) => ctx.bestRhythmHardScore >= 400,
  },
  {
    key: 'first_flight', game: 'flyer', icon: '🪽', name: 'First Flight',
    description: 'Play the endless flyer for the first time.',
    check: (ctx) => ctx.flyerPlays >= 1,
  },
  {
    key: 'flyer_500', game: 'flyer', icon: '☁️', name: 'Cloud Cruiser',
    description: 'Score 500+ in the endless flyer.',
    check: (ctx) => ctx.bestFlyerScore >= 500,
  },
  {
    key: 'flyer_2000', game: 'flyer', icon: '🚀', name: 'Sky Ace',
    description: 'Score 2000+ in the endless flyer.',
    check: (ctx) => ctx.bestFlyerScore >= 2000,
  },
  {
    key: 'coins_100', game: 'both', icon: '🐟', name: 'Coin Collector',
    description: 'Earn 100 total Fish Coins from games.',
    check: (ctx) => ctx.totalGameCoins >= 100,
  },
  {
    key: 'coins_500', game: 'both', icon: '🐠', name: 'Fish Tycoon',
    description: 'Earn 500 total Fish Coins from games.',
    check: (ctx) => ctx.totalGameCoins >= 500,
  },
  {
    key: 'marathon_20', game: 'both', icon: '🏆', name: 'Game Marathon',
    description: 'Play 20 game sessions total.',
    check: (ctx) => ctx.totalPlays >= 20,
  },
  {
    key: 'daily_devotion_3', game: 'both', icon: '📅', name: 'Daily Devotion',
    description: 'Complete the Daily Challenge on 3 different days.',
    check: (ctx) => ctx.dailyCompletions >= 3,
  },
  {
    key: 'top3_daily', game: 'both', icon: '🥉', name: 'Podium Finish',
    description: 'Land in the top 3 of a daily leaderboard.',
    check: (ctx) => ctx.hitTop3Today,
  },
];

// Gathers everything the achievement checks above need, from real rows.
async function buildAchievementContext(userId, justPlayedGame, hitTop3Today) {
  const rhythmPlays = (await get(`SELECT COUNT(*) c FROM game_scores WHERE user_id = ? AND game = 'rhythm'`, [userId])).c;
  const flyerPlays = (await get(`SELECT COUNT(*) c FROM game_scores WHERE user_id = ? AND game = 'flyer'`, [userId])).c;
  const bestCombo = (await get(`SELECT COALESCE(MAX(max_combo),0) c FROM game_scores WHERE user_id = ? AND game = 'rhythm'`, [userId])).c;
  const bestRhythmHardScore = (await get(`SELECT COALESCE(MAX(score),0) c FROM game_scores WHERE user_id = ? AND game = 'rhythm' AND difficulty = 'hard'`, [userId])).c;
  const bestFlyerScore = (await get(`SELECT COALESCE(MAX(score),0) c FROM game_scores WHERE user_id = ? AND game = 'flyer'`, [userId])).c;
  const totalGameCoins = (await get(`SELECT COALESCE(SUM(coins_earned),0) c FROM game_scores WHERE user_id = ?`, [userId])).c;
  const totalPlays = (await get(`SELECT COUNT(*) c FROM game_scores WHERE user_id = ?`, [userId])).c;
  const dailyCompletions = (await get(`SELECT COUNT(*) c FROM daily_challenge_completions WHERE user_id = ?`, [userId])).c;
  return { rhythmPlays, flyerPlays, bestCombo, bestRhythmHardScore, bestFlyerScore, totalGameCoins, totalPlays, dailyCompletions, hitTop3Today };
}

export async function checkAndUnlockAchievements(userId, { hitTop3Today = false } = {}) {
  const ctx = await buildAchievementContext(userId, null, hitTop3Today);
  const alreadyRows = await all(`SELECT achievement_key FROM user_achievements WHERE user_id = ?`, [userId]);
  const already = new Set(alreadyRows.map(r => r.achievement_key));
  const newly = [];
  for (const ach of ACHIEVEMENTS) {
    if (already.has(ach.key)) continue;
    if (ach.check(ctx)) {
      await run(`INSERT INTO user_achievements (user_id, achievement_key) VALUES (?, ?)`, [userId, ach.key]);
      newly.push(ach);
    }
  }
  return newly;
}

export async function achievementsForUser(userId) {
  const rows = await all(`SELECT achievement_key, unlocked_at FROM user_achievements WHERE user_id = ?`, [userId]);
  const unlocked = new Map(rows.map(r => [r.achievement_key, r.unlocked_at]));
  return ACHIEVEMENTS.map(a => ({
    key: a.key, game: a.game, icon: a.icon, name: a.name, description: a.description,
    unlocked: unlocked.has(a.key), unlocked_at: unlocked.get(a.key) || null,
  }));
}

// ---- Daily challenge ----
// Deterministic per calendar day (UTC) — same challenge for everyone, no
// server-side scheduler needed, and it's stable across restarts.
const CHALLENGE_POOL = [
  { game: 'rhythm', difficulty: 'easy', targetScore: 150, description: 'Score 150+ on Easy in Paw Percussion' },
  { game: 'rhythm', difficulty: 'medium', targetScore: 250, description: 'Score 250+ on Medium in Paw Percussion' },
  { game: 'rhythm', difficulty: 'hard', targetScore: 300, description: 'Score 300+ on Hard in Paw Percussion' },
  { game: 'flyer', difficulty: 'default', targetScore: 300, description: 'Score 300+ in Sky Loaf' },
  { game: 'flyer', difficulty: 'default', targetScore: 800, description: 'Score 800+ in Sky Loaf' },
];

export function todayDateStr() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD, UTC
}

export function dailyChallengeFor(dateStr) {
  let hash = 0;
  for (let i = 0; i < dateStr.length; i++) hash = (hash * 31 + dateStr.charCodeAt(i)) >>> 0;
  const pick = CHALLENGE_POOL[hash % CHALLENGE_POOL.length];
  return { ...pick, date: dateStr };
}

export async function maybeCompleteDailyChallenge(userId, { game, difficulty, score }) {
  const dateStr = todayDateStr();
  const challenge = dailyChallengeFor(dateStr);
  if (challenge.game !== game) return false;
  if (challenge.game === 'rhythm' && challenge.difficulty !== difficulty) return false;
  if (score < challenge.targetScore) return false;
  const already = await get(`SELECT 1 FROM daily_challenge_completions WHERE user_id = ? AND challenge_date = ?`, [userId, dateStr]);
  if (already) return false;
  await run(`INSERT INTO daily_challenge_completions (user_id, challenge_date, game) VALUES (?, ?, ?)`, [userId, dateStr, game]);
  return true;
}
