// Method progression: XP -> level -> handling skill.
import { PROGRESSION, METHODS, skillForLevel, EQUIPMENT } from './data.js';

export function levelFromXp(xp) {
  const t = PROGRESSION.xpTable;
  let lv = 1;
  for (let i = 0; i < t.length; i++) if (xp >= t[i]) lv = i + 1;
  return Math.min(lv, PROGRESSION.maxLevel);
}

export function xpProgress(xp) {
  const lv = levelFromXp(xp);
  const t = PROGRESSION.xpTable;
  if (lv >= PROGRESSION.maxLevel) return { level: lv, into: 0, need: 0, max: true };
  return { level: lv, into: xp - t[lv - 1], need: t[lv] - t[lv - 1], max: false };
}

/**
 * XP from one voyage. Fish landed is the main source; a small, capped amount
 * for time actually spent operating keeps a bad day from being worthless
 * without making idling or start/stop spam farmable.
 */
export function xpForVoyage(fishCount, opSeconds) {
  const fishXp = fishCount * PROGRESSION.xpPerFish;
  const opXp = Math.min(PROGRESSION.xpOpCapPerVoyage, Math.floor(opSeconds / 600) * PROGRESSION.xpPerTenOpMinutes);
  return { fishXp, opXp, total: fishXp + opXp };
}

/**
 * Estimated time for one full cycle with every hook filled at a given depth —
 * the "processing capacity" side of the catch (shown so growth is visible).
 */
export function cycleEstimate(level, reelId, depth = 30, firstBite = 3) {
  const m = METHODS.handline;
  const sk = skillForLevel(level);
  const reel = EQUIPMENT[reelId].reel;
  const retrieve = reel.retrieve != null ? reel.retrieve : sk.handRetrieve;
  const parts = {
    drop: depth / sk.dropSpeed,
    wait: firstBite + m.oiWait,
    retrieve: depth / retrieve,
    unhook: m.hooks * sk.unhook,
    rebait: sk.rebait,
  };
  const total = parts.drop + parts.wait + parts.retrieve + parts.unhook + parts.rebait;
  return { parts, total, fishPerMin: (m.hooks / total) * 60, retrieveSpeed: retrieve };
}
