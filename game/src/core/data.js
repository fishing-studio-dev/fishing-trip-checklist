// Tunable game data (M0 + M1 + M2 + M3).
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

// The sea of the game: the coastal grounds (y < 3000) and, further out, 沖の瀬
// (M5). Small boats are limited to the coastal zone (BOATS[].range).
export const AREA = { W: 3000, H: 4600 };

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
    unit: '尾',
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
    unit: '本',
    arriveTemp: 18.8, // ℃: waves only come in at or above this water temperature
  },
  // マダイ（本作設定）: scattered thinly over the bottom of the deeper flats and
  // slope edges (30-60 m), hugging the bottom; stays in an area for many days;
  // feeds when the tide moves, best in the morning and evening. Too sparse to
  // fish well by drifting one rig — a longline laid across where they spread
  // covers the ground. Prototype assumptions only.
  madai: {
    id: 'madai',
    name: 'マダイ',
    sizes: {
      s: { label: '小ダイ', kg: 0.5, pricePerKg: 700 },
      m: { label: 'マダイ', kg: 1.3, pricePerKg: 1000 },
      l: { label: '大ダイ', kg: 3.0, pricePerKg: 1300 },
    },
    sizeOrder: ['s', 'm', 'l'],
    habit: 'bottom',
    unit: '枚',
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
    gearType: 'reel',
    goodRate: 25, // fish per hour regarded as 好調 in the logbook (目安)
  },
  troll: {
    id: 'troll',
    name: '曳縄',
    detail: '潜行板付きの仕掛け（曳縄具 TR-1 は2本、TR-2 は4本）を船尾から流し、決めた航路を走りながら掛かった魚を取り込む',
    target: 'sawara',
    gearType: 'troll',
    biteRateMax: 0.05, // strikes / s / lure at saturation (before activity)
    densityHalf: 0.0001,
    minTowSpeed: 1.2, // m/s: below this the lures don't work
    haulBoatSpeed: 1.5, // m/s: the boat eases off while a fish is hauled
    goodRate: 4,
  },
  longline: {
    id: 'longline',
    name: '延縄',
    detail: '餌を付けた針を並べた長い縄を海底に沿って張り（投縄）、浸けておいて、あとで揚げる（揚げ縄）。浸けている間は他の漁ができる',
    target: 'madai',
    gearType: 'longline',
    biteRateMax: 0.00015, // bites / s / baited hook at saturation (before activity and bait)
    densityHalf: 0.0001, // fish / m^3
    baitLife: 2400, // s: bait on a hook fades with soak time (exp(-t / baitLife))
    soakEvery: 10, // s: hooks on the bottom are evaluated on this fixed game-time cadence
    hookAboveBottom: 0.8, // m
    minDepth: 12, // m: shallower than this the line can't be laid
    nearBuoy: 70, // m: the boat must be this close to an end buoy to start hauling
    goodRate: 5, // fish per hour of the whole set-soak-haul cycle regarded as 好調
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

/** Longline handling skill by level: baiting/paying out, hauling and unhooking. */
export function longlineSkillForLevel(level) {
  const t = Math.max(0, Math.min(1, (level - 1) / (PROGRESSION.maxLevel - 1)));
  const lerp = (a, b) => a + (b - a) * t;
  return {
    setSpeed: lerp(1.2, 2.4), // m/s: boat speed while the line is paid out (baiting keeps up)
    haul: lerp(0.45, 0.9), // m/s: hand-hauling the line
    unhook: lerp(12, 4), // s per fish
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
// type  = what the item does (sounder / reel / troll)
// mount = which mounting it needs; a boat slot lists the mounts it accepts.
// Effects are explicit fields, not multipliers.
export const EQUIPMENT = {
  sounder_es1: {
    id: 'sounder_es1',
    type: 'sounder',
    mount: 'sounder',
    name: '小型魚探 ES-1',
    price: 0,
    desc: '下向き一周波。水深と一定規模の魚群反応を時間履歴で表示する。',
    sounder: { halfAngleDeg: 22, binSize: 0.5, maxRange: 100, noise: 0.12, gainK: 350 },
  },
  sounder_es2: {
    id: 'sounder_es2',
    type: 'sounder',
    mount: 'sounder_l',
    name: '二周波魚探 ES-2',
    price: 32000,
    desc: '大型の操舵室に付ける魚探。細いビームで真下の反応を分けて映し、弱い反応も拾う。表示の細かさは2倍で、魚群反応の深さを数字で出す。',
    sounder: { halfAngleDeg: 14, binSize: 0.25, maxRange: 120, noise: 0.05, gainK: 850, readout: true },
  },
  reel_hand: {
    id: 'reel_hand',
    type: 'reel',
    mount: 'reel',
    name: '手巻きリール',
    price: 0,
    desc: '手で巻き上げる。巻いている間は手がふさがる。巻上げ速度は手際（漁法レベル）で少し上がる。',
    reel: { retrieve: null, maxDepth: 80, model: 'hand' },
  },
  reel_electric: {
    id: 'reel_electric',
    type: 'reel',
    mount: 'reel',
    name: '電動リール DR-1',
    price: 15000,
    desc: 'モーターで巻き上げる。巻いている間も手が空く。深いタナほど回収時間の短縮が大きい。対応水深150m。',
    reel: { retrieve: 2.6, maxDepth: 150, model: 'electric' },
  },
  troll_tr1: {
    id: 'troll_tr1',
    type: 'troll',
    mount: 'troll',
    name: '曳縄具 TR-1',
    price: 9000,
    desc: '船尾に竿2本と潜行板付きの仕掛け。曳縄（サワラ狙い）ができるようになる。航路を決めれば航行と仕掛けの作業は自動。',
    troll: { lines: 2, lineLength: 40, lureDepths: [3, 7], spread: [3, 3], towSpeed: 2.6 },
  },
  troll_tr2: {
    id: 'troll_tr2',
    type: 'troll',
    mount: 'troll_l',
    name: '曳縄具 TR-2（アウトリガー）',
    price: 26000,
    desc: '両舷に張り出すアウトリガーで仕掛けを4本、幅広く曳く。取り込みは一人なので、同時に掛かると順番になる。中型の船尾に付ける。',
    troll: { lines: 4, lineLength: 40, lureDepths: [3, 7, 2, 5], spread: [3, 3, 10, 10], towSpeed: 2.6 },
  },
  longline_ll1: {
    id: 'longline_ll1',
    type: 'longline',
    mount: 'longline',
    name: '延縄具 LL-1（針100本）',
    price: 12000,
    desc: '餌付きの針100本を6m間隔に並べた縄（約600m）と、両端のブイ。海底に張って浸け、あとで揚げる。小型和船では船尾に付けるので、曳縄具とは付け替えになる。',
    longline: { hooks: 100, spacing: 6, maxDepth: 120 },
  },
  hauler_lh1: {
    id: 'hauler_lh1',
    type: 'hauler',
    mount: 'hauler',
    name: '揚げ縄機 LH-1',
    price: 18000,
    desc: '延縄を機械で巻き上げる。揚げ縄の速さが腕前によらず毎秒1.3mになる（手で揚げるとLv1で0.45、Lv10で0.9m）。魚を外すのは手作業のまま。延縄具がないと使い道はない。',
    hauler: { haul: 1.3 },
  },
};

// What each upgrade changes and where you will notice it in play — shown when
// buying and right after fitting (players could not tell what ES-2 did).
export const GUIDES = {
  sounder_es2: {
    changes: [
      'ビームが細くなる（幅44°→28°）。真下の狭い範囲だけを映すので、群れの真上にいるときだけ反応が濃く出て、外れるとすぐ薄くなる。近くの別の群れや底の起伏が混ざりにくい。',
      '感度が上がり雑音が減る。ES-1ではほとんど見えなかった薄い反応（散らばったマダイ、群れの縁）が青〜緑で映る。',
      '表示の細かさが2倍（0.5m→0.25m）。底べったりの反応が底の線から離れて見え、群れの上端・下端がはっきりする。',
      '魚群反応の深さを数字で表示する（例：「反応 21〜25m・底から3m」）。',
      '探れる深さ 100m→120m（沖の瀬のまわりの深場）。',
    ],
    inPlay: [
      '一本釣り：群れの真上に止まれたかが分かりやすい。自動のタナ合わせも、薄い群れの反応を拾って合わせやすくなる。',
      '延縄：マダイが薄く散っている場所を、通りがかりに魚探で見つけやすくなる。',
    ],
    note: '魚の種類・食い気・どの漁が良いかは表示しません（見立てはプレイヤーが行う）。',
  },
  reel_electric: {
    changes: ['巻き上げが速い（毎秒2.6m。手巻きは腕前で0.7〜1.1m）。深いタナほど1回の手返しが短くなる。', '巻いている間も手が空くので、2本仕掛けのもう1本の作業が止まらない。', '届く深さ 80m→150m。'],
    inPlay: ['操業パネルの「回収」の段階が短くなり、同じ時間に流せる回数が増える。'],
  },
  troll_tr1: {
    changes: ['曳縄（サワラ）ができるようになる。船尾から仕掛け2本（潜行板3m・7m）を曳く。'],
    inPlay: ['海図で航路を決めて Space。航行と仕掛けの作業は自動。サワラは水温が上がる時期に沖や駆け上がりへ回ってくる。'],
  },
  troll_tr2: {
    changes: ['仕掛けが4本になる（外側2本はアウトリガーで横10m）。広い幅を一度に探れる。', '取り込みは手の数だけ同時（1人なら順番）。甲板員を乗せると待ちが減る。'],
    inPlay: ['濃い群れを通ったときの掛かりが増える（試験ではLv10・30分で TR-1 19本 → TR-2 25本）。'],
  },
  longline_ll1: {
    changes: ['延縄（マダイ）ができるようになる。針100本・約600mの縄を海底に張り、浸けて、あとで揚げる。'],
    inPlay: ['張る向きは今の向きか海図で決める。浸けている間は他の漁ができる。揚げるときは L（確認あり）。'],
  },
  hauler_lh1: {
    changes: ['揚げ縄を機械で巻き上げる（毎秒1.3m、腕前によらない）。魚を外すのは手作業のまま。'],
    inPlay: ['揚げ縄の時間が短くなる（試験ではLv1で24分→9分）。同じ日に何度も張りやすくなる。'],
  },
};

/** Can this item be mounted on this boat slot? */
export function fits(item, slot) {
  return !!item && !!slot && slot.accepts.includes(item.mount);
}

/** Sale value of an item taken off the boat (simple, provisional). */
export function sellValue(item) {
  return item.price > 0 ? Math.round(item.price * 0.5) : 300;
}

// ---- Boats ----
// Performance is exactly what is listed — a used boat performs like a new one.
export const BOATS = {
  skiff_1: {
    id: 'skiff_1',
    name: '小型和船',
    length: 7.5,
    holdKg: 120,
    speeds: [-1.5, 0, 0.8, 2.0, 4.5, 8.0], // throttle levels (m/s)
    throttleNames: ['後進', '停止', '極微速', '微速', '半速', '全速'],
    steps: { stop: 1, deadSlow: 2, slow: 3, half: 4, full: 5 },
    accel: 0.4,
    maxTurn: 0.2, // rad/s at full rudder
    windage: 0.025, // drift fraction of wind speed
    fuelPerKm: 40,
    tradeIn: 15000,
    range: { maxY: 3000, label: '沿岸（港から約3km、沖の平場まで）' }, // 航行区域 (game setting)
    slots: [
      { id: 'helm_sounder', label: '操舵席（魚探）', accepts: ['sounder'] },
      { id: 'starboard_reel', label: '右舷 竿受け', accepts: ['reel'], rig: '右舷' },
      { id: 'stern_troll', label: '船尾（曳縄・延縄）', accepts: ['troll', 'longline'], optional: true },
      { id: 'starboard_hauler', label: '右舷前（揚げ縄機）', accepts: ['hauler'], optional: true },
    ],
  },
  cruiser_2: {
    id: 'cruiser_2',
    name: '中型漁船',
    length: 9.9,
    holdKg: 320,
    speeds: [-1.8, 0, 0.9, 2.2, 5.0, 10.0],
    throttleNames: ['後進', '停止', '極微速', '微速', '半速', '全速'],
    steps: { stop: 1, deadSlow: 2, slow: 3, half: 4, full: 5 },
    accel: 0.32,
    maxTurn: 0.17,
    windage: 0.018, // heavier hull: the wind pushes it less
    fuelPerKm: 60,
    tradeIn: 55000,
    range: { maxY: null, label: '沖の瀬まで（港から約4.5km）' },
    slots: [
      { id: 'helm_sounder', label: '操舵室（魚探・大型可）', accepts: ['sounder', 'sounder_l'] },
      { id: 'starboard_reel', label: '右舷 竿受け', accepts: ['reel'], rig: '右舷' },
      { id: 'port_reel', label: '左舷 竿受け', accepts: ['reel'], optional: true, rig: '左舷' },
      { id: 'stern_troll', label: '船尾 曳縄（アウトリガー可）', accepts: ['troll', 'troll_l'], optional: true },
      { id: 'deck_longline', label: '後部甲板（延縄）', accepts: ['longline'], optional: true },
      { id: 'starboard_hauler', label: '右舷前（揚げ縄機）', accepts: ['hauler'], optional: true },
    ],
  },
};

// ---- Boats for sale (造船所・中古船) ----
// New: every slot empty — move your gear over and build the layout you want
// (a basic sounder is fitted if none of yours fits). Used: cheaper, comes with
// the previous owner's gear already fitted. No hidden faults either way.
export const BOAT_OFFERS = [
  { id: 'new_cruiser', kind: 'new', model: 'cruiser_2', price: 110000, title: '新艇 中型漁船', note: '取付位置はすべて空き。今の装備を移し、好きな構成にできる。', included: {} },
  { id: 'used_cruiser_a', kind: 'used', model: 'cruiser_2', price: 65000, title: '中古 中型漁船（元「第三浜丸」・船齢12年）', note: '一本釣り向けの装備付き。', included: { helm_sounder: 'sounder_es1', starboard_reel: 'reel_hand', port_reel: 'reel_hand' } },
  { id: 'used_cruiser_b', kind: 'used', model: 'cruiser_2', price: 85000, title: '中古 中型漁船（元「千代丸」・船齢8年）', note: '大型魚探と電動リール、曳縄具付き。', included: { helm_sounder: 'sounder_es2', starboard_reel: 'reel_electric', stern_troll: 'troll_tr1' } },
  { id: 'new_skiff', kind: 'new', model: 'skiff_1', price: 40000, title: '新艇 小型和船', note: '小回りが利き、燃料が少なくて済む。', included: {} },
  { id: 'used_skiff', kind: 'used', model: 'skiff_1', price: 22000, title: '中古 小型和船（船齢15年）', note: '最低限の装備付き。', included: { helm_sounder: 'sounder_es1', starboard_reel: 'reel_hand' } },
];

// ---- Crew (乗組員) ----
// A deckhand hired for one voyage adds a second pair of hands: hand jobs on
// two rigs / four trolling lines wait less, and on the longline he unhooks
// while the fisher keeps hauling. He works at the fisher's own pace (same
// handling skill). Optional: everything works without him (handover §4.1).
export const CREW = {
  wage: 1800, // G per voyage, paid at settlement with the other costs (仮設定)
  label: '甲板員',
};

export const ECONOMY = {
  startFunds: 5000,
  currency: 'G',
  tripBaseCost: 300, // 氷・餌など1航海の定額
  fuelPerKm: 40, // under power (default; boats set their own)
};

export const START_PROFILE = {
  boatModel: 'skiff_1',
  boatName: 'はやせ丸',
  slots: { helm_sounder: 'sounder_es1', starboard_reel: 'reel_hand', stern_troll: null, starboard_hauler: null },
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
  matsu: { id: 'matsu', name: '松じい', method: 'longline', areas: ['沖の平場', '東の駆け上がり', '西の根'], desc: '延縄でマダイを獲る古株。序盤の数日は遠くの漁場に出ていて、7日目の朝から港で話が聞ける。', fromDay: 7 },
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
