// The player's own marks (印). Marks are made at sea from the boat's position,
// a sounder echo, a side-view echo or a sonar echo; they are kept across days
// (profile.marks) with a name and a memo the player writes. Marks only hold
// what the player saw (position, time, depths read from the instruments) —
// never what fish are there now.
import { depthAt } from './sea.js';

export const MARK_KINDS = {
  manual: { label: '現在地の印', short: '印' },
  sounder: { label: '魚探の反応', short: '魚探' },
  side: { label: 'サイドビューの反応', short: '左右' },
  sonar: { label: 'ソナーの反応', short: 'ソナー' },
};
export const MARK_LIMITS = { name: 16, memo: 60, saved: 300, voyage: 80, auto: 40 };

/** Text the player typed, made safe to keep: no control characters, trimmed, length-capped. */
export function cleanText(s, max) {
  return Array.from(String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f]/g, ' ').trim()).slice(0, max).join('');
}

/** What a mark is called in lists and on the chart (today's unsaved marks read 「今日の…」). */
export function markTitle(m, today = false) {
  if (m.name) return m.name;
  const k = MARK_KINDS[m.kind] || MARK_KINDS.manual;
  const n = String(m.id).replace(/^M/, '');
  return `${today ? '今日の' : ''}${k.short}${n}`;
}

/** Push a voyage mark; automatic sounder marks and the player's marks are capped separately. */
export function pushVoyageMark(obs, m) {
  obs.marks.push(m);
  const auto = m.kind === 'auto';
  const same = obs.marks.filter((x) => (x.kind === 'auto') === auto);
  const cap = auto ? MARK_LIMITS.auto : MARK_LIMITS.voyage;
  if (same.length > cap) {
    const drop = same[0];
    obs.marks.splice(obs.marks.indexOf(drop), 1);
  }
}

/** A new voyage mark record at (x, y). */
export function newVoyageMark(obs, kind, x, y, t, { echo = null, bottom = null } = {}) {
  return {
    id: obs.markSeq++,
    kind,
    x: Math.round(x * 10) / 10,
    y: Math.round(y * 10) / 10,
    t,
    depth: echo != null ? Math.round(echo * 10) / 10 : null, // fish echo depth read at the time (if any)
    bottom: bottom != null ? Math.round(bottom * 10) / 10 : Math.round(depthAt(x, y) * 10) / 10,
    name: '',
    memo: '',
  };
}

// ---------------------------------------------------------------- saved marks (pure: new profile)

/** Rename / re-memo a saved mark. Returns {ok, profile} with a whole new profile. */
export function editSavedMark(profile, id, { name, memo }) {
  if (!profile.marks.some((m) => m.id === id)) return { ok: false, reason: 'その印は見つかりません。' };
  const marks = profile.marks.map((m) => (m.id === id ? { ...m, name: name !== undefined ? cleanText(name, MARK_LIMITS.name) : m.name, memo: memo !== undefined ? cleanText(memo, MARK_LIMITS.memo) : m.memo } : { ...m }));
  return { ok: true, profile: { ...profile, marks } };
}

/** Delete a saved mark. Returns {ok, profile}. */
export function removeSavedMark(profile, id) {
  if (!profile.marks.some((m) => m.id === id)) return { ok: false, reason: 'その印は見つかりません。' };
  return { ok: true, profile: { ...profile, marks: profile.marks.filter((m) => m.id !== id).map((m) => ({ ...m })) } };
}

/** Marks made at sea → saved marks (at settlement). Mutates the profile copy it is given. */
export function keepVoyageMarks(p, marks, day) {
  for (const m of marks || []) {
    if (m.kind === 'auto') continue;
    p.markSeq += 1;
    p.marks.push({
      id: `M${p.markSeq}`,
      x: Math.round(m.x),
      y: Math.round(m.y),
      name: cleanText(m.name, MARK_LIMITS.name),
      memo: cleanText(m.memo, MARK_LIMITS.memo),
      day,
      t: Math.round(m.t),
      kind: MARK_KINDS[m.kind] ? m.kind : 'manual',
      depth: m.bottom != null ? Math.round(m.bottom * 10) / 10 : null, // the bottom depth there
      echo: m.depth != null ? Math.round(m.depth * 10) / 10 : null, // the fish echo depth seen
    });
  }
  if (p.marks.length > MARK_LIMITS.saved) p.marks.splice(0, p.marks.length - MARK_LIMITS.saved);
}

// ---------------------------------------------------------------- the list

const DIRS = ['北', '北東', '東', '南東', '南', '南西', '西', '北西'];
/** Compass bearing (degrees, 0 = north) and its name, from one point to another. */
export function bearingOf(from, to) {
  const deg = ((Math.atan2(to.x - from.x, to.y - from.y) * 180) / Math.PI + 360) % 360;
  return { deg, name: DIRS[Math.round(deg / 45) % 8] };
}

/**
 * Every mark the player has, saved ones and (at sea) today's, newest first,
 * with the distance and bearing from the boat when there is one.
 */
export function markList(profile, v = null) {
  const rows = [];
  for (const m of (profile && profile.marks) || []) rows.push({ key: `s:${m.id}`, source: 'saved', ...m, echo: m.echo != null ? m.echo : null, title: markTitle(m) });
  if (v) {
    for (const m of v.obs.marks) {
      if (m.kind === 'auto') continue;
      rows.push({ key: `v:${m.id}`, source: 'voyage', ...m, id: m.id, day: v.day, depth: m.bottom, echo: m.depth, title: markTitle(m, true) });
    }
  }
  if (v) {
    for (const r of rows) {
      r.dist = Math.hypot(r.x - v.boat.x, r.y - v.boat.y);
      r.bearing = bearingOf(v.boat, r);
    }
  }
  rows.sort((a, b) => b.day - a.day || b.t - a.t);
  return rows;
}
