// Tunable game data (M0 + M1).
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
    habit: 'bottom',
  },
  // サワラ（本作設定）: roams in loose schools in the upper/middle layer over
  // open water and slopes, arrives in waves (回遊) when the water is warm
  // enough, feeds best in the morning. Prototype assumptions only.
  sawara: {
    id: 'sawara',
    name: 'サワラ',
    sizes: {
      s: { label: 'サゴシ', kg: 1.0, pricePerKg: 350 },
      m: { label: 'サワラ', kg: 2.5, pricePerKg: 600 },
      l: { label: '大サワラ', kg: 4.5, pricePerKg: 800 },
    },
    sizeOrder: ['s', 'm', 'l'],
    habit: 'pelagic',
    arriveTemp: 18.8, // ℃: waves only come in at or above this water temperature
  },
};

// ---- Fishing methods ----
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
    gearSlot: 'starboard_reel',
    goodRate: 25, // fish per hour regarded as 好調 in the logbook (目安)
  },
  troll: {
    id: 'troll',
    name: '曳縄',
    detail: '潜行板付きの仕掛け2本を船尾から流し、決めた航路を走りながら掛かった魚を取り込む',
    target: 'sawara',
    gearSlot: 'stern_troll',
    biteRateMax: 0.05, // strikes / s / lure at saturation (before activity)
    densityHalf: 0.0001,
    minTowSpeed: 1.2, // m/s: below this the lures don't work
    haulBoatSpeed: 1.5, // m/s: the boat eases off while a fish is hauled
    goodRate: 4,
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

/** Trolling handling skill by level. */
export function trollSkillForLevel(level) {
  const t = Math.max(0, Math.min(1, (level - 1) / (PROGRESSION.maxLevel - 1)));
  const lerp = (a, b) => a + (b - a) * t;
  return {
    deploy: lerp(60, 12), // s to set a lure and diving board (fiddly for a novice)
    fight: lerp(30, 10), // s playing the fish before hauling
    haul: lerp(0.8, 1.6), // m/s hand-hauling the trolling line
    unhook: lerp(15, 5), // s per fish
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
  troll_tr1: {
    id: 'troll_tr1',
    type: 'troll',
    name: '曳縄具 TR-1',
    price: 9000,
    desc: '船尾に竿2本と潜行板付きの仕掛け。曳縄（サワラ狙い）ができるようになる。航路を決めれば航行と仕掛けの作業は自動。',
    troll: { lines: 2, lineLength: 40, lureDepths: [3, 7], towSpeed: 2.6 },
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
      { id: 'stern_troll', label: '船尾 曳縄竿受け', accepts: 'troll', optional: true },
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
  slots: { helm_sounder: 'sounder_es1', starboard_reel: 'reel_hand', stern_troll: null },
};

// ---- Tide (潮回り) table by day number modulo 15 (game calendar) ----
export const TIDE_CYCLE = [
  ['大潮', 0.34], ['大潮', 0.34], ['中潮', 0.26], ['中潮', 0.24], ['中潮', 0.22],
  ['小潮', 0.15], ['小潮', 0.14], ['小潮', 0.14], ['長潮', 0.09], ['若潮', 0.12],
  ['中潮', 0.21], ['中潮', 0.24], ['中潮', 0.27], ['大潮', 0.34], ['大潮', 0.34],
];
export const TIDE_OFFSET = 10; // day d uses TIDE_CYCLE[(d + TIDE_OFFSET) % 15]
export const TIDE_PERIOD = 44712; // 12.42 h

// ---- Fishing peers (漁師仲間) ----
export const PEERS = {
  gen: { id: 'gen', name: '源さん', method: 'handline', areas: ['北の瀬', '西の根'], desc: '一本釣り一筋。瀬と根のアジに詳しい。' },
  hamada: { id: 'hamada', name: '浜田さん', method: 'troll', areas: ['東の駆け上がり', '沖の平場'], desc: '曳縄でサワラを追う。沖と駆け上がりをよく走る。' },
};

// Time bands used to tag logs and compare similar conditions.
export const TIME_BANDS = [
  { id: 'dawn', label: '早朝', from: 0, to: 7 },
  { id: 'morning', label: '朝', from: 7, to: 10 },
  { id: 'midday', label: '昼', from: 10, to: 13 },
  { id: 'afternoon', label: '午後', from: 13, to: 24 },
];

// Port briefing happens at this game time of the day being prepared.
export const BRIEFING_T = 4.5 * 3600;

// ---- Early-season script (序盤の海の筋書き・仮設定) ----
// Days 0-6 of a new save use these conditions and fish so that the three
// information scenarios of the handover (§7.5) occur. Reports are still
// generated from this world like any other day. Later days are procedural.
//   d1: a peer's fresh catch report points to a new place (北の瀬)
//   d2: same tide class and calm wind as d1 -> reproduce a past success
//   d3-4: water warms, サワラ arrive (needs trolling gear)
//   d5: 大潮 + strong wind, the 北の瀬東 school has thinned -> switch
export const SEASON_SCRIPT = {
  0: { cond: { windSpeed: 2.5, windDirDeg: 225, waterTemp: 18.1 }, aji: [['kita_e', 620, 0.3], ['nishi', 380, 0.25]], sawara: [] },
  1: { cond: { windSpeed: 2.4, windDirDeg: 200, waterTemp: 18.3 }, aji: [['kita_e', 640, 0.32], ['nishi', 360, 0.25], ['minami', 300, 0.05]], sawara: [] },
  2: { cond: { windSpeed: 3.2, windDirDeg: 210, waterTemp: 18.6 }, aji: [['kita_e', 600, 0.3], ['nishi', 380, 0.22]], sawara: [] },
  3: { cond: { windSpeed: 3.0, windDirDeg: 30, waterTemp: 19.0 }, aji: [['kita_e', 560, 0.3], ['nishi', 400, 0.25], ['higashi_s', 300, 0.2]], sawara: [['higashi', 40]] },
  4: { cond: { windSpeed: 4.5, windDirDeg: 40, waterTemp: 19.3 }, aji: [['kita_e', 170, 0.3], ['nishi', 420, 0.25], ['higashi_s', 320, 0.2]], sawara: [['higashi', 45], ['oki', 30]] },
  5: { cond: { windSpeed: 7.6, windDirDeg: 45, waterTemp: 19.5 }, aji: [['kita_s', 380, 0.3], ['nishi', 420, 0.25]], sawara: [['higashi', 50], ['oki', 35]] },
  6: { cond: { windSpeed: 3.4, windDirDeg: 60, waterTemp: 19.4 }, aji: [['kita_s', 420, 0.3], ['nishi', 400, 0.25], ['higashi_n', 320, 0.2]], sawara: [['oki', 40]] },
};
