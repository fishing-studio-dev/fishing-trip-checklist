// Tunable game data for M0.
// [仮設定] Every number here is a provisional game setting for the prototype,
// not a real-world value or a user-confirmed balance. Keep balance edits here.

export const SIM = {
  STEP: 0.1, // fixed simulation step in game seconds
  PING_EVERY_STEPS: 5, // sounder ping every 0.5 game s
  TRACK_EVERY_S: 10,
  MAX_STEPS_PER_ADVANCE: 4000,
};

export const TIME = {
  DEPART: 5 * 3600, // 05:00 departure
  WARN: 15 * 3600, // 15:00 return warning
  END: 16 * 3600, // 16:00 forced return (auto)
  // game seconds per real second, by situation. Changing scale never changes
  // results for the same elapsed game time (fixed-step simulation).
  SCALE: { sail: 6, operate: 15, auto: 18 },
  USER_MULT: [1, 2, 4],
};

export const AREA = { W: 3000, H: 3000 };

export const PORT = {
  name: '港',
  dock: { x: 1500, y: 85 },
  entrance: { x: 1500, y: 260 },
  approachRadius: 320, // within this distance the "入港" command is offered
};

// ---- Species (game settings, not biological facts) ----
// マアジ（本作設定）: by day the school stays close to the bottom around reefs and
// slopes, rises higher off the bottom in the early morning, and feeds better
// when the tide is moving. These are prototype assumptions for one species only.
export const SPECIES = {
  aji: {
    id: 'aji',
    name: 'マアジ',
    sizes: {
      s: { label: '小アジ', kg: 0.12, pricePerKg: 400 },
      m: { label: '中アジ', kg: 0.25, pricePerKg: 700 },
      l: { label: '大アジ', kg: 0.45, pricePerKg: 1000 },
    },
    sizeOrder: ['s', 'm', 'l'],
  },
};

// ---- Fishing method ----
export const METHODS = {
  handline: {
    id: 'handline',
    name: '一本釣り',
    detail: '胴突き仕掛け（3本針）をタナに合わせ、掛かったら回収する流し釣り',
    target: 'aji',
    hooks: 3,
    hookSpacing: 1.5, // m between hooks above the sinker
    biteRateMax: 0.1, // bites / s / hook at saturation (before activity)
    densityHalf: 0.004, // fish / m^3 for half-saturation
    oiWait: 10, // s waited after the first bite for more bites (追い食い)
    retuneAfter: 30, // s without bites before the tana is re-read from the sounder
    defaultOffBottom: 1.5, // m: tana used when the sounder shows no fish echo
    echoThreshold: 0.3,
    maxStartSpeed: 0.6, // m/s: boat must be (almost) stopped to start
  },
};

// ---- Method progression (漁法の習熟) ----
export const PROGRESSION = {
  maxLevel: 10,
  // cumulative XP needed to reach level index+1
  xpTable: [0, 30, 80, 150, 240, 350, 480, 640, 830, 1050],
  xpPerFish: 1,
  // small per-voyage experience for time actually spent operating, capped so
  // idling or start/stop spam can't farm it (仮設定)
  xpPerTenOpMinutes: 1,
  xpOpCapPerVoyage: 6,
};

/** Handling skill by level (手際). Level only changes work speed, never fish. */
export function skillForLevel(level) {
  const t = Math.max(0, Math.min(1, (level - 1) / (PROGRESSION.maxLevel - 1)));
  const lerp = (a, b) => a + (b - a) * t;
  return {
    rebait: lerp(15, 5), // s per cycle: bait & ready the rig
    unhook: lerp(8, 2.5), // s per fish: unhook and stow
    dropSpeed: lerp(1.2, 1.7), // m/s: paying out line
    handRetrieve: lerp(0.7, 1.1), // m/s: hand-hauling speed (hand reel only)
  };
}

// ---- Equipment ----
// type = which slot kinds accept it. Effects are explicit fields, not multipliers.
export const EQUIPMENT = {
  sounder_es1: {
    id: 'sounder_es1',
    type: 'sounder',
    name: '小型魚探 ES-1',
    price: 0,
    desc: '下向き一周波。水深と一定規模の魚群反応を時間履歴で表示する。',
    sounder: { halfAngleDeg: 22, binSize: 0.5, maxRange: 100, noise: 0.12, gainK: 350 },
  },
  reel_hand: {
    id: 'reel_hand',
    type: 'reel',
    name: '手巻きリール',
    price: 0,
    desc: '手で巻き上げる。巻上げ速度は手際（漁法レベル）で少し上がる。',
    reel: { retrieve: null, maxDepth: 80, model: 'hand' },
  },
  reel_electric: {
    id: 'reel_electric',
    type: 'reel',
    name: '電動リール DR-1',
    price: 15000,
    desc: 'モーターで巻き上げる。深いタナほど回収時間の短縮が大きい。対応水深150m。',
    reel: { retrieve: 2.6, maxDepth: 150, model: 'electric' },
  },
};

// ---- Boats ----
export const BOATS = {
  skiff_1: {
    id: 'skiff_1',
    name: '小型和船',
    length: 7.5,
    holdKg: 120,
    speeds: [-1.5, 0, 2.0, 4.5, 8.0], // throttle levels: 後進, 停止, 微速, 半速, 全速 (m/s)
    throttleNames: ['後進', '停止', '微速', '半速', '全速'],
    accel: 0.4,
    maxTurn: 0.2, // rad/s at full rudder
    windage: 0.025, // drift fraction of wind speed
    slots: [
      { id: 'helm_sounder', label: '操舵席（魚探）', accepts: 'sounder' },
      { id: 'starboard_reel', label: '右舷 竿受け', accepts: 'reel' },
    ],
  },
};

export const ECONOMY = {
  startFunds: 5000,
  currency: 'G',
  tripBaseCost: 300, // 氷・餌など1航海の定額
  fuelPerKm: 40, // under power
};

export const START_PROFILE = {
  boatModel: 'skiff_1',
  boatName: 'はやせ丸',
  slots: { helm_sounder: 'sounder_es1', starboard_reel: 'reel_hand' },
};

// ---- Tide (潮回り) table by day number modulo 15 (game calendar) ----
export const TIDE_CYCLE = [
  ['大潮', 0.34], ['大潮', 0.34], ['中潮', 0.26], ['中潮', 0.24], ['中潮', 0.22],
  ['小潮', 0.15], ['小潮', 0.14], ['小潮', 0.14], ['長潮', 0.09], ['若潮', 0.12],
  ['中潮', 0.21], ['中潮', 0.24], ['大潮', 0.32], ['大潮', 0.34], ['大潮', 0.34],
];
export const TIDE_PERIOD = 44712; // 12.42 h
