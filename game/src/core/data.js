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
  // an evening trip for イカ釣り (集魚灯 fitted): out at 16:00, home by 23:00
  NIGHT: { DEPART: 16 * 3600, WARN: 22 * 3600, END: 23 * 3600 },
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
      s: { label: '小アジ', kg: 0.12, pricePerKg: 240 },
      m: { label: '中アジ', kg: 0.25, pricePerKg: 420 },
      l: { label: '大アジ', kg: 0.45, pricePerKg: 600 },
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
      s: { label: 'サゴシ', kg: 1.0, pricePerKg: 440 },
      m: { label: 'サワラ', kg: 2.5, pricePerKg: 720 },
      l: { label: '大サワラ', kg: 4.5, pricePerKg: 960 },
    },
    sizeOrder: ['s', 'm', 'l'],
    habit: 'pelagic',
    unit: '本',
    arriveTemp: 15.3, // ℃: in spring the waves come in once the water warms past this (本作設定)
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
      s: { label: '小ダイ', kg: 0.5, pricePerKg: 420 },
      m: { label: 'マダイ', kg: 1.3, pricePerKg: 600 },
      l: { label: '大ダイ', kg: 3.0, pricePerKg: 780 },
    },
    sizeOrder: ['s', 'm', 'l'],
    habit: 'bottom',
    unit: '枚',
  },
  // 根魚（本作設定）: live tight on hard structures — 漁礁, こぼれ瀬, 大きな根 and
  // the rocky tops of the reefs — right on the bottom, and stay there (居着き).
  // A structure holds only a few; they are fished pinpoint, over the structure.
  kasago: {
    id: 'kasago',
    name: 'カサゴ',
    sizes: {
      s: { label: '小カサゴ', kg: 0.15, pricePerKg: 600 },
      m: { label: 'カサゴ', kg: 0.25, pricePerKg: 840 },
      l: { label: '大カサゴ', kg: 0.4, pricePerKg: 1080 },
    },
    sizeOrder: ['s', 'm', 'l'],
    habit: 'reef',
    unit: '尾',
    group: 'negyo',
  },
  kijihata: {
    id: 'kijihata',
    name: 'キジハタ',
    sizes: {
      s: { label: '小キジハタ', kg: 0.4, pricePerKg: 1200 },
      m: { label: 'キジハタ', kg: 0.8, pricePerKg: 1680 },
      l: { label: '大キジハタ', kg: 1.4, pricePerKg: 2100 },
    },
    sizeOrder: ['s', 'm', 'l'],
    habit: 'reef',
    unit: '尾',
    group: 'negyo',
  },
  // ベイト（本作設定）: dense schools of small fish in the upper layer over open
  // water. Nobody here fishes them; they show on the sounder and sonar, and the
  // 青物 follow them.
  iwashi: {
    id: 'iwashi',
    name: 'イワシ（ベイト）',
    sizes: {
      s: { label: 'イワシ', kg: 0.01, pricePerKg: 0 },
      m: { label: 'イワシ', kg: 0.012, pricePerKg: 0 },
      l: { label: 'イワシ', kg: 0.015, pricePerKg: 0 },
    },
    sizeOrder: ['s', 'm', 'l'],
    habit: 'pelagic',
    unit: '尾',
    bait: true,
  },
  // イカ（本作設定）: by day near the bottom of the deeper water, at dusk they rise
  // and at night they come up under a lit boat (集魚灯). ケンサキイカ in the
  // warmer water, ヤリイカ in the cooler.
  kensaki: {
    id: 'kensaki',
    name: 'ケンサキイカ',
    sizes: {
      s: { label: '小ケンサキ', kg: 0.1, pricePerKg: 800 },
      m: { label: 'ケンサキイカ', kg: 0.18, pricePerKg: 1120 },
      l: { label: '大ケンサキ', kg: 0.3, pricePerKg: 1440 },
    },
    sizeOrder: ['s', 'm', 'l'],
    habit: 'squid',
    unit: '杯',
    group: 'ika',
  },
  yari: {
    id: 'yari',
    name: 'ヤリイカ',
    sizes: {
      s: { label: '小ヤリイカ', kg: 0.08, pricePerKg: 640 },
      m: { label: 'ヤリイカ', kg: 0.15, pricePerKg: 960 },
      l: { label: '大ヤリイカ', kg: 0.25, pricePerKg: 1200 },
    },
    sizeOrder: ['s', 'm', 'l'],
    habit: 'squid',
    unit: '杯',
    group: 'ika',
  },
  // 青物（本作設定）: big, fast fish that roam around reefs and pinnacles and
  // under bait schools, in mid water. ブリ in the cooler water, ヒラマサ in the
  // warmer. Taken with a live アジ (泳がせ釣り).
  buri: {
    id: 'buri',
    name: 'ブリ',
    sizes: {
      s: { label: 'ハマチ', kg: 2.5, pricePerKg: 480 },
      m: { label: 'メジロ', kg: 5.0, pricePerKg: 640 },
      l: { label: 'ブリ', kg: 9.0, pricePerKg: 800 },
    },
    sizeOrder: ['s', 'm', 'l'],
    habit: 'roam',
    unit: '本',
    group: 'aomono',
  },
  hiramasa: {
    id: 'hiramasa',
    name: 'ヒラマサ',
    sizes: {
      s: { label: '小ヒラマサ', kg: 3.0, pricePerKg: 880 },
      m: { label: 'ヒラマサ', kg: 6.0, pricePerKg: 1200 },
      l: { label: '大ヒラマサ', kg: 10.0, pricePerKg: 1520 },
    },
    sizeOrder: ['s', 'm', 'l'],
    habit: 'roam',
    unit: '本',
    group: 'aomono',
  },
  ara: {
    id: 'ara',
    name: 'アラ',
    sizes: {
      s: { label: '小アラ', kg: 1.5, pricePerKg: 1560 },
      m: { label: 'アラ', kg: 3.5, pricePerKg: 2040 },
      l: { label: '大アラ', kg: 7.0, pricePerKg: 2520 },
    },
    sizeOrder: ['s', 'm', 'l'],
    habit: 'reef',
    unit: '尾',
    group: 'negyo',
  },
  // クエ（本作設定・第3期）: the big grouper of the rocks — rare and solitary, in
  // the holes of the big pinnacles and reefs, out to feed at dusk and in the
  // night. Comes up out of the rocks for a live アジ (泳がせ); on a light 根魚
  // rig it often dives back into the rocks and breaks the line (bolt).
  // (In Kyushu クエ is also called アラ; the アラ of this game is the other fish.)
  kue: {
    id: 'kue',
    name: 'クエ',
    sizes: {
      s: { label: '小クエ', kg: 3, pricePerKg: 2700 },
      m: { label: 'クエ', kg: 8, pricePerKg: 3600 },
      l: { label: '大クエ', kg: 18, pricePerKg: 4500 },
    },
    sizeOrder: ['s', 'm', 'l'],
    habit: 'reef',
    unit: '尾',
    group: 'negyo',
    offBottom: 1.0,
    sigmaZ: 4, // m: rushes up out of its hole at a bait above it
    bolt: 0.55, // chance a hooked クエ dives into the rocks and breaks a 根魚 rig (half on the stronger 泳がせ gear)
  },
  // ---- 第2期の魚種（本作設定・玄界灘の旬を手本にした仮設定） ----
  // イサキ: schools stand up over the tops of high reefs and pinnacles in
  // tidal water; 梅雨イサキ (May–July) feed hard before spawning.
  isaki: {
    id: 'isaki',
    name: 'イサキ',
    sizes: {
      s: { label: '小イサキ', kg: 0.25, pricePerKg: 420 },
      m: { label: 'イサキ', kg: 0.45, pricePerKg: 600 },
      l: { label: '大イサキ', kg: 0.75, pricePerKg: 840 },
    },
    sizeOrder: ['s', 'm', 'l'],
    habit: 'bottom',
    unit: '尾',
  },
  // マサバ: big, dense schools in mid water over the open flats in autumn and
  // winter, moving fast; they grab any bait (cheap, and they get in the way).
  masaba: {
    id: 'masaba',
    name: 'マサバ',
    sizes: {
      s: { label: '小サバ', kg: 0.25, pricePerKg: 90 },
      m: { label: 'サバ', kg: 0.45, pricePerKg: 150 },
      l: { label: '大サバ', kg: 0.8, pricePerKg: 270 },
    },
    sizeOrder: ['s', 'm', 'l'],
    habit: 'midwater',
    unit: '尾',
  },
  // オオモンハタ: a grouper that swims a little above the rocks, chasing small fish.
  oomonhata: {
    id: 'oomonhata',
    name: 'オオモンハタ',
    sizes: {
      s: { label: '小オオモンハタ', kg: 0.4, pricePerKg: 720 },
      m: { label: 'オオモンハタ', kg: 0.8, pricePerKg: 1020 },
      l: { label: '大オオモンハタ', kg: 1.5, pricePerKg: 1320 },
    },
    sizeOrder: ['s', 'm', 'l'],
    habit: 'reef',
    unit: '尾',
    group: 'negyo',
    offBottom: 2.2, // m: holds higher off the rocks than the other 根魚
  },
  // アカハタ: a small red grouper of the shallow rocks (10–30 m), in warm water.
  akahata: {
    id: 'akahata',
    name: 'アカハタ',
    sizes: {
      s: { label: '小アカハタ', kg: 0.3, pricePerKg: 720 },
      m: { label: 'アカハタ', kg: 0.6, pricePerKg: 1020 },
      l: { label: '大アカハタ', kg: 1.0, pricePerKg: 1320 },
    },
    sizeOrder: ['s', 'm', 'l'],
    habit: 'reef',
    unit: '尾',
    group: 'negyo',
    maxDepth: 32, // only on the shallow structures
  },
  // アマダイ: live in burrows in the sandy mud of the flats, so the sounder
  // never shows them; taken on the longline. アカアマダイ on the deeper mud,
  // シロアマダイ on shallower sand — rare and dear.
  akaamadai: {
    id: 'akaamadai',
    name: 'アカアマダイ',
    sizes: {
      s: { label: '小アカアマダイ', kg: 0.3, pricePerKg: 1080 },
      m: { label: 'アカアマダイ', kg: 0.6, pricePerKg: 1680 },
      l: { label: '大アカアマダイ', kg: 1.0, pricePerKg: 2280 },
    },
    sizeOrder: ['s', 'm', 'l'],
    habit: 'burrow',
    unit: '尾',
  },
  shiroamadai: {
    id: 'shiroamadai',
    name: 'シロアマダイ',
    sizes: {
      s: { label: '小シロアマダイ', kg: 0.6, pricePerKg: 2100 },
      m: { label: 'シロアマダイ', kg: 1.2, pricePerKg: 3300 },
      l: { label: '大シロアマダイ', kg: 2.0, pricePerKg: 4500 },
    },
    sizeOrder: ['s', 'm', 'l'],
    habit: 'burrow',
    unit: '尾',
  },
  // シイラ: summer fish of the surface, along tide lines (潮目) and drifting weed.
  shiira: {
    id: 'shiira',
    name: 'シイラ',
    sizes: {
      s: { label: 'ペンペン', kg: 1.5, pricePerKg: 200 },
      m: { label: 'シイラ', kg: 4.0, pricePerKg: 280 },
      l: { label: '大シイラ', kg: 9.0, pricePerKg: 360 },
    },
    sizeOrder: ['s', 'm', 'l'],
    habit: 'pelagic',
    unit: '本',
    surface: true, // keeps to the top few metres
  },
  // ヨコワ（クロマグロの若魚）: fast schools of the upper layer in autumn and winter.
  yokowa: {
    id: 'yokowa',
    name: 'ヨコワ',
    sizes: {
      s: { label: '小ヨコワ', kg: 2.0, pricePerKg: 800 },
      m: { label: 'ヨコワ', kg: 4.5, pricePerKg: 1120 },
      l: { label: '大ヨコワ', kg: 8.0, pricePerKg: 1440 },
    },
    sizeOrder: ['s', 'm', 'l'],
    habit: 'pelagic',
    unit: '本',
  },
  // カンパチ: a summer–autumn 青物 that stays lower than ヒラマサ, close around the 根.
  kanpachi: {
    id: 'kanpachi',
    name: 'カンパチ',
    sizes: {
      s: { label: 'ショゴ', kg: 2.0, pricePerKg: 640 },
      m: { label: 'カンパチ', kg: 5.0, pricePerKg: 1040 },
      l: { label: '大カンパチ', kg: 10.0, pricePerKg: 1360 },
    },
    sizeOrder: ['s', 'm', 'l'],
    habit: 'roam',
    unit: '本',
    group: 'aomono',
  },
};

// ---- 季節（本作設定） ----
// How plentiful each fish is through the year: one value per month, April to
// March (1 = the height of its season, 0 = not here). Shaped after what is
// generally said of the 玄界灘 (e.g. 梅雨イサキ May–July, 寒ブリ in winter,
// ヒラマサ at their best in late winter and spring with May–June off, ケンサキイカ
// in early summer to autumn, ヤリイカ in winter and spring). Game settings.
// `warm`: how a warmer (+) or colder (−) year than usual changes the numbers,
// per ℃ of difference (暖冬の寒ブリは薄い).
export const SEASONALITY = {
  aji: { months: [0.8, 0.9, 1.0, 1.0, 0.9, 0.85, 0.85, 0.8, 0.7, 0.55, 0.5, 0.6], warm: 0.05 },
  isaki: { months: [0.25, 0.75, 1.0, 0.9, 0.6, 0.45, 0.35, 0.25, 0.15, 0.1, 0.1, 0.15], warm: 0.1 },
  masaba: { months: [0.35, 0.25, 0.15, 0.1, 0.1, 0.25, 0.6, 0.9, 1.0, 0.95, 0.8, 0.55], warm: -0.1 },
  sawara: { months: [0.8, 0.6, 0.15, 0, 0, 0.15, 0.55, 0.85, 1.0, 0.9, 0.6, 0.45], warm: 0 },
  shiira: { months: [0, 0.05, 0.35, 0.85, 1.0, 0.9, 0.45, 0.1, 0, 0, 0, 0], warm: 0.25 },
  yokowa: { months: [0, 0, 0, 0, 0, 0.1, 0.5, 0.85, 1.0, 0.8, 0.4, 0.1], warm: 0.1 },
  madai: { months: [1.0, 0.9, 0.6, 0.5, 0.5, 0.6, 0.85, 0.9, 0.75, 0.6, 0.55, 0.8], warm: 0 },
  akaamadai: { months: [0.6, 0.55, 0.5, 0.45, 0.45, 0.55, 0.85, 1.0, 1.0, 0.95, 0.85, 0.7], warm: 0 },
  shiroamadai: { months: [0.4, 0.4, 0.35, 0.35, 0.35, 0.45, 0.75, 0.9, 1.0, 0.9, 0.7, 0.5], warm: 0 },
  kasago: { months: [0.9, 0.9, 0.85, 0.75, 0.7, 0.75, 0.85, 0.95, 1.0, 1.0, 1.0, 0.95], warm: 0 },
  kijihata: { months: [0.45, 0.7, 0.95, 1.0, 1.0, 0.95, 0.75, 0.5, 0.3, 0.2, 0.2, 0.3], warm: 0.1 },
  oomonhata: { months: [0.3, 0.4, 0.55, 0.8, 1.0, 1.0, 0.9, 0.7, 0.45, 0.25, 0.2, 0.25], warm: 0.1 },
  akahata: { months: [0.35, 0.55, 0.85, 1.0, 1.0, 0.9, 0.7, 0.45, 0.25, 0.15, 0.15, 0.2], warm: 0.15 },
  ara: { months: [0.7, 0.65, 0.6, 0.55, 0.55, 0.6, 0.7, 0.8, 0.9, 1.0, 1.0, 0.85], warm: 0 },
  kue: { months: [0.7, 0.75, 0.8, 0.85, 0.9, 0.95, 1.0, 1.0, 1.0, 0.95, 0.8, 0.75], warm: 0 },
  buri: { months: [0.45, 0.25, 0.1, 0.05, 0.05, 0.15, 0.45, 0.7, 0.95, 1.0, 0.95, 0.7], warm: -0.25 },
  hiramasa: { months: [0.85, 0.25, 0.15, 0.45, 0.5, 0.55, 0.6, 0.7, 0.8, 0.9, 0.95, 1.0], warm: 0 },
  kanpachi: { months: [0.15, 0.25, 0.45, 0.75, 0.95, 1.0, 0.9, 0.6, 0.3, 0.1, 0.05, 0.1], warm: 0.2 },
  kensaki: { months: [0.15, 0.55, 0.9, 1.0, 1.0, 0.9, 0.7, 0.35, 0.1, 0, 0, 0.05], warm: 0.15 },
  yari: { months: [0.6, 0.3, 0.05, 0, 0, 0, 0.05, 0.25, 0.6, 0.9, 1.0, 0.9], warm: -0.15 },
  iwashi: { months: [0.9, 0.8, 0.7, 0.6, 0.6, 0.7, 0.85, 0.9, 0.8, 0.7, 0.65, 0.8], warm: 0 },
};
// ---- 食い（本作設定） ----
// How each fish feeds (the common wisdom of anglers and fishers, simplified):
//   tide: [潮止まり, 動き始め, 効いている, 緩み始め] — a multiplier for each phase
//         of the tidal stream (e.g. アジ hardly bite at slack water and come on
//         as the stream starts; 根魚 are easiest when it eases or stops).
//   fast: multiplier once the stream runs very hard (over about 0.3 m/s) —
//         the rig cannot keep the bottom (マダイ, 根魚).
//   dawn / dusk: extra at the low-light windows (まずめ) around sunrise and sunset.
//   day / night: baseline in daylight and in the dark.
//   temp: the comfortable water [low, high] ℃; outside it they slow down.
// Nature does not always follow the rule: on some days a school feeds against
// it (see MOODS). Game settings, not biological facts.
export const FEEDING = {
  aji: { tide: [0.2, 1.45, 1.1, 0.75], fast: 1, dawn: 0.45, dusk: 0.3, day: 1, night: 0.3, temp: [15, 26] },
  isaki: { tide: [0.35, 1.3, 1.15, 0.8], fast: 0.9, dawn: 0.7, dusk: 0.6, day: 0.8, night: 0.6, temp: [16, 26] },
  masaba: { tide: [0.7, 1.15, 1.1, 0.95], fast: 1, dawn: 0.4, dusk: 0.4, day: 1, night: 0.4, temp: [13, 24] },
  madai: { tide: [0.3, 1.5, 1.0, 1.35], fast: 0.7, dawn: 0.35, dusk: 0.3, day: 1, night: 0.4, temp: [14, 26] },
  akaamadai: { tide: [0.8, 1.1, 1.0, 1.0], fast: 0.9, dawn: 0.3, dusk: 0.15, day: 1, night: 0.3, temp: [13, 24] },
  shiroamadai: { tide: [0.8, 1.1, 1.0, 1.0], fast: 0.9, dawn: 0.3, dusk: 0.15, day: 1, night: 0.3, temp: [13, 24] },
  kasago: { tide: [1.25, 1.0, 0.75, 1.2], fast: 0.6, dawn: 0.45, dusk: 0.45, day: 1, night: 0.8, temp: [13, 25] },
  kijihata: { tide: [1.2, 1.05, 0.8, 1.2], fast: 0.6, dawn: 0.45, dusk: 0.5, day: 1, night: 0.6, temp: [18, 28] },
  akahata: { tide: [1.2, 1.05, 0.8, 1.2], fast: 0.6, dawn: 0.4, dusk: 0.45, day: 1, night: 0.5, temp: [19, 28] },
  oomonhata: { tide: [0.8, 1.25, 1.1, 1.0], fast: 0.75, dawn: 0.5, dusk: 0.5, day: 1, night: 0.5, temp: [17, 28] },
  ara: { tide: [0.6, 1.2, 1.15, 0.9], fast: 0.8, dawn: 0.4, dusk: 0.4, day: 1, night: 0.6, temp: [13, 26] },
  kue: { tide: [0.7, 1.15, 1.0, 1.05], fast: 0.7, dawn: 1.1, dusk: 1.7, day: 0.45, night: 1.4, temp: [15, 28] }, // クエ: out of the rocks at dusk and night
  buri: { tide: [0.2, 1.5, 1.25, 0.6], fast: 1, dawn: 0.7, dusk: 0.55, day: 1, night: 0.2, temp: [13, 22] },
  hiramasa: { tide: [0.2, 1.5, 1.25, 0.6], fast: 1, dawn: 0.7, dusk: 0.55, day: 1, night: 0.2, temp: [14, 25] },
  kanpachi: { tide: [0.25, 1.45, 1.2, 0.65], fast: 1, dawn: 0.6, dusk: 0.55, day: 1, night: 0.2, temp: [19, 28] },
  sawara: { tide: [0.45, 1.25, 1.1, 0.8], fast: 1, dawn: 0.7, dusk: 0.4, day: 0.9, night: 0.2, temp: [14, 24] },
  shiira: { tide: [0.8, 1.1, 1.05, 0.95], fast: 1, dawn: 0.3, dusk: 0.2, day: 1, night: 0.2, temp: [22, 30] },
  yokowa: { tide: [0.4, 1.35, 1.15, 0.75], fast: 1, dawn: 0.6, dusk: 0.4, day: 1, night: 0.2, temp: [14, 24] },
  kensaki: { tide: [1.0, 1.1, 0.85, 1.05], fast: 0.6, dawn: 0, dusk: 0.3, day: 0.35, night: 1.2, temp: [17, 28] },
  yari: { tide: [1.0, 1.1, 0.85, 1.05], fast: 0.6, dawn: 0, dusk: 0.3, day: 0.35, night: 1.2, temp: [12, 19] },
  iwashi: { tide: [1, 1, 1, 1], fast: 1, dawn: 0, dusk: 0, day: 1, night: 1, temp: [10, 30] },
};
// A school's mood for the day (本作設定): most days follow the rule above; on
// some the school feeds against it (潮止まりに食う・潮が動いても食わない), is off
// its food all day (反応はあるのに食わない), or feeds madly.
export const MOODS = [
  { id: 'usual', p: 0.72, k: 1 },
  { id: 'contrary', p: 0.12, k: 1 }, // the tide rule turned round
  { id: 'dull', p: 0.1, k: 0.4 }, // shows on the sounder, hardly bites
  { id: 'hot', p: 0.06, k: 1.35 }, // bites whatever the tide
];

// ---- 魚探の映り方（本作設定） ----
// How each fish shows on the sounder, shaped after what anglers and sounder
// makers describe (docs/REQUIREMENTS_R2.md §5.1):
//   school: a cloud / band of many small targets (アジ・イサキ・サバ・イワシ・イカ);
//           根魚 sit on the rocks and melt into the bottom line.
//   single: big fish seen one by one — each draws an arch (「へ」の字) as the
//           boat passes over it (far at the edge of the beam, nearest straight
//           below); a fish that stays under a drifting boat draws a long line.
//   none:   never seen (アマダイ in their burrows).
// ts: how strongly one fish returns the sound (target strength, relative).
// サバ have no swim bladder and squid none at all: weak echoes for their numbers.
export const ECHO = {
  aji: { kind: 'school', ts: 1 },
  isaki: { kind: 'school', ts: 1 },
  masaba: { kind: 'school', ts: 0.5 },
  iwashi: { kind: 'school', ts: 0.8, bait: true },
  kensaki: { kind: 'school', ts: 0.3 },
  yari: { kind: 'school', ts: 0.3 },
  kasago: { kind: 'school', ts: 0.3 },
  kijihata: { kind: 'school', ts: 0.3 },
  akahata: { kind: 'school', ts: 0.3 },
  madai: { kind: 'single', ts: 1.0, size: 0.45 },
  ara: { kind: 'single', ts: 1.3, size: 0.6 },
  kue: { kind: 'single', ts: 1.9, size: 0.8 },
  oomonhata: { kind: 'single', ts: 0.9, size: 0.45 },
  buri: { kind: 'single', ts: 1.6, size: 0.7, fast: true },
  hiramasa: { kind: 'single', ts: 1.6, size: 0.7, fast: true },
  kanpachi: { kind: 'single', ts: 1.5, size: 0.7, fast: true },
  sawara: { kind: 'single', ts: 1.1, size: 0.55, fast: true },
  yokowa: { kind: 'single', ts: 1.3, size: 0.6, fast: true },
  shiira: { kind: 'single', ts: 1.2, size: 0.6, fast: true },
  akaamadai: { kind: 'none', ts: 0 },
  shiroamadai: { kind: 'none', ts: 0 },
};

// The share of large fish follows the season for some (秋はハマチ・メジロ、冬はブリ).
export const SIZE_SEASON = {
  buri: [0.7, 0.6, 0.5, 0.5, 0.5, 0.5, 0.6, 0.8, 1.1, 1.3, 1.3, 1.0],
};


// ---- Fishing methods ----
export const METHODS = {
  handline: {
    id: 'handline',
    machineOk: true, // the bow machines (自動釣り機) work this rig
    name: '一本釣り',
    detail: '胴突き仕掛け（3本針）を魚探の反応のタナに合わせ、掛かったら回収する流し釣り。アジのほか、瀬の上のイサキ、中層のサバも掛かる',
    target: 'aji',
    targets: ['aji', 'isaki', 'masaba'], // whatever stands at the tana: アジ, イサキ over the reef tops, サバ in mid water
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
    drift: true, // fished from the drifting boat
    goodRate: 25, // fish per hour regarded as 好調 in the logbook (目安)
  },
  // 泳がせ釣り（本作設定）: a live アジ caught earlier on the handline is hooked
  // and let swim at the bait layer (or a few metres off the bottom) around a
  // reef or under bait. A tired bait is changed after a while. A hooked 青物 is
  // fought (hands busy) before it is wound up. Each bait takes one アジ from the
  // hold — without アジ there is nothing to fish with.
  oyogase: {
    id: 'oyogase',
    name: '泳がせ釣り',
    detail: '一本釣りで釣った活きアジを針に付けて泳がせ、根や瀬の周り・ベイトの下を回る青物（ブリ・ヒラマサ・カンパチ）を狙う。エサのアジは魚倉から使う',
    target: 'buri',
    targets: ['buri', 'hiramasa', 'kanpachi', 'kue'],
    hooks: 1,
    hookSpacing: 0,
    liveBait: 'aji', // one fish from the hold per bait
    baitLife: 600, // s: a live bait that has not been taken is changed for a fresh one
    biteRateMax: 0.015, // a live bait is found from far off: big fish, thin in the water
    densityHalf: 0.00005,
    oiWait: 0,
    retuneAfter: 120,
    defaultOffBottom: 6,
    defaultFrac: 0.65, // with no echo the bait swims in mid water (65% of the depth), where 青物 roam
    echoThreshold: 0.3,
    fight: true, // a big fish is played before it can be wound up
    maxStartSpeed: 0.6,
    gearType: 'reel',
    drift: true,
    goodRate: 2,
  },
  // イカ釣り（本作設定）: in the evening the lamps are lit and the boat drifts;
  // squid from the water around are drawn in under the light over time (they
  // are taken from their school as they come, so nothing is created). Jigs
  // (イカ角) on each reel are worked at the squid's layer automatically.
  ika: {
    id: 'ika',
    machineOk: true, // automatic squid jigging machines
    name: 'イカ釣り',
    detail: '集魚灯を点けて船の下にイカを寄せ、イカ角（擬似餌）を並べた仕掛けをシャクって釣る。夕方から夜の漁（集魚灯が要る）',
    target: 'kensaki',
    targets: ['kensaki', 'yari'],
    hooks: 5,
    hookSpacing: 1.2,
    biteRateMax: 0.02,
    densityHalf: 0.003,
    oiWait: 20,
    retuneAfter: 60,
    defaultOffBottom: 0,
    defaultFrac: 0.4, // with no echo the jigs work at 40% of the depth (the squid's night layer)
    echoThreshold: 0.3,
    lights: true,
    gatherRate: 0.00004, // squid drawn in per squid in the area per second under full darkness
    gatherReach: 250, // m added to a school's spread: how far the light reaches
    maxStartSpeed: 0.6,
    gearType: 'lights',
    drift: true,
    goodRate: 20,
  },
  // 根魚釣り（本作設定）: a short two-hook rig with the sinker kept just off the
  // bottom (底を切る) right over a structure. The rig follows the bottom by
  // itself; a fish is wound up at once before it dives into the rocks. Over
  // rock the rig sometimes snags (根掛かり): the line is cut and re-rigged —
  // time lost, less often with skill. Fished by drifting across the pinpoint.
  negyo: {
    id: 'negyo',
    name: '根魚釣り',
    detail: '2本針の短い仕掛けを、オモリが底から少し上になるように保ち、根・漁礁の真上を流して根魚（カサゴ・キジハタ・アカハタ・オオモンハタ・アラ）を狙う',
    target: 'kasago',
    targets: ['kasago', 'kijihata', 'ara', 'oomonhata', 'akahata', 'kue'],
    hooks: 2,
    hookSpacing: 0.6,
    firstHook: 0.4, // m above the sinker for the lowest hook
    bottomMode: true, // the sinker follows the bottom (0.3 m off)
    bottomLift: 0.3,
    biteRateMax: 0.03,
    densityHalf: 0.002,
    oiWait: 2, // wound up almost at once (no waiting for more bites)
    retuneAfter: Infinity,
    defaultOffBottom: 0.3,
    echoThreshold: 0.3,
    snagRate: 0.0035, // snags / s on hard bottom at level 1 (fewer with skill)
    maxStartSpeed: 0.6,
    gearType: 'reel',
    drift: true,
    goodRate: 8,
  },
  // ジギング（本作設定）: a metal jig is dropped to the bottom and jerked up
  // 15–20 m (or up into the echo above it), then dropped again — all
  // automatic. No live bait is needed; it takes 青物 under the bait and round
  // the reefs, and what sits near the bottom (マダイ・根の大物), with サバ in the
  // way. A jig that snags on rock is lost (bought again at settlement).
  jigging: {
    id: 'jigging',
    name: 'ジギング',
    detail: 'メタルジグを底まで落とし、15〜20m（魚探の反応があればその上まで）しゃくり上げてはまた落とす。活きエサは要らない。青物・サワラ・ヨコワ、底近くのマダイや根の大物が掛かる。サバも食ってくる。根掛かりするとジグを失う',
    target: 'buri',
    targets: ['buri', 'hiramasa', 'kanpachi', 'sawara', 'yokowa', 'madai', 'oomonhata', 'ara', 'kue', 'masaba'],
    // how readily each fish takes a jig (relative): サバ swarm it, マダイ and 根魚 take it near the bottom
    appeal: { buri: 1, hiramasa: 1, kanpachi: 1, sawara: 0.8, yokowa: 0.7, madai: 0.5, oomonhata: 0.6, ara: 0.5, kue: 0.25, masaba: 0.15 },
    hooks: 1,
    hookSpacing: 0,
    firstHook: 0,
    jig: true,
    sweep: 18, // m jerked up from the bottom each time
    jerkSpeed: 0.9, // m/s while jerking up (a fraction of the winding speed)
    snagPerTouch: 0.035, // chance a jig touching rock snags (Lv1; less with skill)
    biteRateMax: 0.012,
    densityHalf: 0.00005,
    oiWait: 0,
    retuneAfter: 90,
    defaultOffBottom: 1,
    echoThreshold: 0.3,
    fight: true,
    maxStartSpeed: 0.6,
    gearType: 'rod',
    drift: true,
    goodRate: 2,
  },
  troll: {
    id: 'troll',
    name: '曳縄',
    detail: '潜行板付きの仕掛け（曳縄具 TR-1 は2本、TR-2 は4本）を船尾から流し、決めた航路を走りながら掛かった魚を取り込む',
    target: 'sawara',
    targets: ['sawara', 'shiira', 'yokowa'],
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
    targets: ['madai', 'akaamadai', 'shiroamadai'],
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
    rerig: lerp(45, 15), // s: cut a snagged line and tie a new rig (根掛かり)
    fight: lerp(120, 40), // s: playing a 6 kg 青物 before winding it up (heavier fish take longer)
    snagMul: lerp(1, 0.4), // how often the rig snags on rock (keeping it just off the bottom)
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
    price: 70000,
    desc: '大型の操舵室に付ける魚探。細いビームで真下の反応を分けて映し、弱い反応も拾う。表示の細かさは2倍で、魚群反応の深さを数字で出す。',
    sounder: { halfAngleDeg: 14, binSize: 0.25, maxRange: 120, noise: 0.05, gainK: 850, readout: true },
  },
  sounder_sv1: {
    id: 'sounder_sv1',
    type: 'sounder',
    mount: 'sounder_l',
    name: 'サイドビュー魚探 SV-1',
    price: 180000,
    desc: 'ES-2と同じ真下の魚探に加え、船の左右それぞれ60mの海底と底近くの魚を帯状に映す。測った水深を10mごとに記録し、自分だけの細かい海図（デプスマッピング）を作る。大型の操舵室に付ける。',
    sounder: { halfAngleDeg: 14, binSize: 0.25, maxRange: 120, noise: 0.05, gainK: 850, readout: true, side: { range: 60, res: 5 }, mapping: true },
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
    price: 22000,
    desc: 'モーターで巻き上げる。巻いている間も手が空く。深いタナほど回収時間の短縮が大きい。対応水深150m。',
    reel: { retrieve: 2.6, maxDepth: 150, model: 'electric' },
  },
  troll_tr1: {
    id: 'troll_tr1',
    type: 'troll',
    mount: 'troll',
    name: '曳縄具 TR-1',
    price: 15000,
    desc: '船尾に竿2本と潜行板付きの仕掛け。曳縄（サワラ狙い）ができるようになる。航路を決めれば航行と仕掛けの作業は自動。',
    troll: { lines: 2, lineLength: 40, lureDepths: [3, 7], spread: [3, 3], towSpeed: 2.6 },
  },
  troll_tr2: {
    id: 'troll_tr2',
    type: 'troll',
    mount: 'troll_l',
    name: '曳縄具 TR-2（アウトリガー）',
    price: 55000,
    desc: '両舷に張り出すアウトリガーで仕掛けを4本、幅広く曳く。取り込みは一人なので、同時に掛かると順番になる。中型の船尾に付ける。',
    troll: { lines: 4, lineLength: 40, lureDepths: [3, 7, 2, 5], spread: [3, 3, 10, 10], towSpeed: 2.6 },
  },
  longline_ll1: {
    id: 'longline_ll1',
    type: 'longline',
    mount: 'longline',
    name: '延縄具 LL-1（針100本）',
    price: 18000,
    desc: '餌付きの針100本を6m間隔に並べた縄（約600m）と、両端のブイ。海底に張って浸け、あとで揚げる。小型和船では船尾に付けるので、曳縄具とは付け替えになる。',
    longline: { hooks: 100, spacing: 6, maxDepth: 120 },
  },
  sonar_cs1: {
    id: 'sonar_cs1',
    type: 'sonar',
    mount: 'sonar',
    name: 'スキャニングソナー CS-1',
    price: 300000,
    desc: '船底から水中を横向きに見回し、船のまわり150〜600mの魚群反応と、海底から立ち上がる根・漁礁の反応を映す。中型漁船の船底に付ける。',
    sonar: { ranges: [150, 300, 600], gain: 900 },
  },
  hauler_lh1: {
    id: 'hauler_lh1',
    type: 'hauler',
    mount: 'hauler',
    name: '揚げ縄機 LH-1',
    price: 40000,
    desc: '延縄を機械で巻き上げる。揚げ縄の速さが腕前によらず毎秒1.3mになる（手で揚げるとLv1で0.45、Lv10で0.9m）。魚を外すのは手作業のまま。延縄具がないと使い道はない。',
    hauler: { haul: 1.3 },
  },
  rod_jg1: {
    id: 'rod_jg1',
    type: 'rod',
    mount: 'rod',
    name: 'ジギングロッド JG-1（ジグ付き）',
    price: 18000,
    desc: 'ジギング用の竿と手巻きリール、メタルジグ一式。竿立てに置き、漁法「ジギング」ができるようになる。根掛かりで失くしたジグは帰港時に買い足す（1個あたりの代金がかかる）。対応水深120m。',
    rod: { reel: { retrieve: null, maxDepth: 120, model: 'hand' }, jigPrice: 1200 },
  },
  lights_ld1: {
    id: 'lights_ld1',
    type: 'lights',
    mount: 'lights',
    name: 'LED集魚灯 LD-1',
    price: 90000,
    desc: '屋根に付ける集魚灯。夕方から夜に点けると、まわりのイカが船の下に寄ってくる。これがあると港で「夕方から出る（イカ釣り）」を選べ、日没の少し前に出て夜中（1〜3時ごろ）まで漁ができる。',
    lights: { power: 1 },
  },
  // 自動釣り機（本作設定・第3期）: a machine on a bow rod holder of the medium boat
  // that drops, works, winds up and takes the fish off by itself — no hands
  // needed, slower than a skilled fisher. Rigs that need no bait (サビキ・イカ角):
  // 一本釣り and イカ釣り only.
  machine_af1: {
    id: 'machine_af1',
    type: 'machine',
    mount: 'machine',
    name: '自動釣り機 AF-1',
    price: 45000,
    desc: '中型漁船の船首の竿受けに付ける機械。仕掛けの上げ下げ・しゃくり・取り込みを人の手を使わずにする（手の作業より遅い）。餌の要らない一本釣り（サビキ）とイカ釣りで動く。対応水深150m。',
    reel: { retrieve: 2.0, maxDepth: 150, model: 'machine' },
    machine: { prep: 14, unhook: 7, methods: ['handline', 'ika'] },
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
  sounder_sv1: {
    changes: [
      '真下の魚探はES-2と同じ（細いビーム・高い感度・反応の深さの数字）。',
      '左右の帯：船の左右60mずつの海底を、走りながら帯状に映す（サイドビュー）。硬い岩や漁礁は明るく、海底の起伏は明暗と影で、底近くの魚は明るい点で出る。真下を通らなくても、横にある小さな瀬や漁礁、底の魚に気づける。',
      'デプスマッピング：測った水深を10mごとに記録し、海図に細かい等深線（2mごと）として重ねる。翌日以降も残り、印を付けた瀬や漁礁の形を後から確かめられる。',
    ],
    inPlay: [
      '海図に載っていない小さな瀬・大きな根・漁礁を探すとき、左右120mの幅で一度に調べられる。',
      '走った所の細かい地形が海図に残るので、根魚や青物の付き場（根の肩・漁礁の際）を予想しやすくなる。',
    ],
    note: '魚の種類は表示しません。映るのは地形と、底近くに何かがいる反応です。',
  },
  machine_af1: {
    changes: ['中型漁船の船首の竿受け（2か所）に付けられる。一本釣りとイカ釣りで、仕掛けが1本増える。', '餌付けも取り込みも機械がするので、釣り人の手が空くのを待たない（1尾7秒・仕掛けの準備14秒）。'],
    inPlay: ['操業パネルに「船首右（自動）」の行が増える。根魚・泳がせ・ジギングでは使わない（人の手が要る釣り）。'],
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
  sonar_cs1: {
    changes: [
      '船のまわりを丸く見る（真上から見た図、船首が上）。距離は150・300・600mから選べる。魚探が真下しか見ないのに対し、まわり数百mの群れを一度に探せる。',
      '水中の群れは色の濃い塊で、海底から立ち上がった根や漁礁は硬い反応（点状）で出る。',
      '画面をタップ（クリック）すると、その位置に印を付けられる（海図に残る）。',
    ],
    inPlay: [
      '青物やベイトの群れのように動き回る群れを、遠くから見つけて先回りできる。',
      '漁礁や小さな根の場所の見当を付けてから、魚探・サイドビューで確かめる、という探し方ができる。',
    ],
    note: '魚の種類は表示しません。反応の大きさ・動き・場所から見立てます。',
  },
  lights_ld1: {
    changes: [
      '港で「夕方から出る（イカ釣り）」を選べるようになる（日没の20分前に出港し、日没の8時間後・遅くとも翌3時までに帰港）。',
      '漁法に「イカ釣り」が加わる。暗くなると集魚灯の光でまわり数百mのイカが船の下に寄り、各リールのイカ角で自動で釣る。',
    ],
    inPlay: [
      'イカは昼は深い所の底近くにいて、夕方に浮いてくる。イカのいる沖の深い所で灯を点けて、寄ってくるのを待つ。',
      '寄ったイカは魚探に船の真下の反応として映る。反応が薄ければ場所を変える判断になる。',
    ],
    note: 'まだ明るいうちは灯が効きにくい（日没後に効く）。',
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
    fuelPerKm: 60,
    tradeIn: 40000,
    range: { maxY: 3000, label: '沿岸（港から約3km、沖の平場まで）' }, // 航行区域 (game setting)
    slots: [
      { id: 'helm_sounder', label: '操舵席（魚探）', accepts: ['sounder'] },
      { id: 'starboard_reel', label: '右舷 竿受け', accepts: ['reel'], rig: '右舷' },
      { id: 'stern_troll', label: '船尾（曳縄・延縄）', accepts: ['troll', 'longline'], optional: true },
      { id: 'starboard_hauler', label: '右舷前（揚げ縄機）', accepts: ['hauler'], optional: true },
      { id: 'roof_lights', label: '屋根（集魚灯）', accepts: ['lights'], optional: true },
      { id: 'rod_rack', label: '竿立て（ジギング）', accepts: ['rod'], optional: true },
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
    fuelPerKm: 110,
    tradeIn: 180000,
    range: { maxY: null, label: '沖の瀬まで（港から約4.5km）' },
    slots: [
      { id: 'helm_sounder', label: '操舵室（魚探・大型可）', accepts: ['sounder', 'sounder_l'] },
      { id: 'starboard_reel', label: '右舷 竿受け', accepts: ['reel'], rig: '右舷' },
      { id: 'port_reel', label: '左舷 竿受け', accepts: ['reel'], optional: true, rig: '左舷' },
      // 第3期: two more rod holders at the bow — a reel, or an automatic fishing machine
      { id: 'bow_starboard_reel', label: '船首右 竿受け（リール・自動釣り機）', accepts: ['reel', 'machine'], optional: true, rig: '船首右' },
      { id: 'bow_port_reel', label: '船首左 竿受け（リール・自動釣り機）', accepts: ['reel', 'machine'], optional: true, rig: '船首左' },
      { id: 'stern_troll', label: '船尾 曳縄（アウトリガー可）', accepts: ['troll', 'troll_l'], optional: true },
      { id: 'deck_longline', label: '後部甲板（延縄）', accepts: ['longline'], optional: true },
      { id: 'starboard_hauler', label: '右舷前（揚げ縄機）', accepts: ['hauler'], optional: true },
      { id: 'hull_sonar', label: '船底（ソナー）', accepts: ['sonar'], optional: true },
      { id: 'roof_lights', label: '屋根（集魚灯）', accepts: ['lights'], optional: true },
      { id: 'rod_rack', label: '竿立て（ジギング）', accepts: ['rod'], optional: true },
    ],
  },
};

// ---- Boats for sale (造船所・中古船) ----
// New: every slot empty — move your gear over and build the layout you want
// (a basic sounder is fitted if none of yours fits). Used: cheaper, comes with
// the previous owner's gear already fitted. No hidden faults either way.
export const BOAT_OFFERS = [
  { id: 'new_cruiser', kind: 'new', model: 'cruiser_2', price: 420000, title: '新艇 中型漁船', note: '取付位置はすべて空き。今の装備を移し、好きな構成にできる。', included: {} },
  { id: 'used_cruiser_a', kind: 'used', model: 'cruiser_2', price: 230000, title: '中古 中型漁船（元「第三浜丸」・船齢12年）', note: '一本釣り向けの装備付き。', included: { helm_sounder: 'sounder_es1', starboard_reel: 'reel_hand', port_reel: 'reel_hand' } },
  { id: 'used_cruiser_b', kind: 'used', model: 'cruiser_2', price: 320000, title: '中古 中型漁船（元「千代丸」・船齢8年）', note: '大型魚探と電動リール、曳縄具付き。', included: { helm_sounder: 'sounder_es2', starboard_reel: 'reel_electric', stern_troll: 'troll_tr1' } },
  { id: 'new_skiff', kind: 'new', model: 'skiff_1', price: 120000, title: '新艇 小型和船', note: '小回りが利き、燃料が少なくて済む。', included: {} },
  { id: 'used_skiff', kind: 'used', model: 'skiff_1', price: 70000, title: '中古 小型和船（船齢15年）', note: '最低限の装備付き。', included: { helm_sounder: 'sounder_es1', starboard_reel: 'reel_hand' } },
];

// ---- Crew (乗組員) ----
// A deckhand hired for one voyage adds a second pair of hands: hand jobs on
// two rigs / four trolling lines wait less, and on the longline he unhooks
// while the fisher keeps hauling. He works at the fisher's own pace (same
// handling skill). Optional: everything works without him (handover §4.1).
export const CREW = {
  wage: 8000, // G per voyage, paid at settlement with the other costs (仮設定)
  label: '甲板員',
};

// 延縄の縄（R07）: one comes with the longline gear; up to two more can be
// bought, each laid on its own (separate places, separate soaks).
export const LONGLINE_LINES = { max: 3, extraPrice: 15000 };

// ---- 難易度（R05）: chosen when a new game starts and fixed for that save. ----
// Only the money changes — the sea, the fish, their bite and the weather are
// the same at every level. price: what the fish fetch; cost: ice, bait, fuel,
// the deckhand; gear: equipment, boats, lines, jigs (and what they sell for).
export const DIFFICULTY = {
  easy: { id: 'easy', name: 'やさしい', price: 1.2, cost: 0.75, gear: 0.8, startFunds: 30000, desc: '魚が高く売れ、経費と装備が安い。のんびり漁師を楽しみたい人向け。' },
  normal: { id: 'normal', name: 'ふつう', price: 1, cost: 1, gear: 1, startFunds: 10000, desc: '釣れない日は赤字。腕と判断で少しずつ船と装備を良くしていく。' },
  hard: { id: 'hard', name: 'きびしい', price: 0.85, cost: 1.3, gear: 1.25, startFunds: 3000, desc: '相場が安く経費がかさむ。漁場と漁法の選び方が暮らしに直結する。' },
};

// ---- 相場（R19・本作設定） ----
// The price of a fish moves from day to day: plentiful (in season) fish sell
// cheaper, scarce ones dearer, and after a rough day (few boats out) prices
// rise. One day's market only takes so much of one fish at the full price:
// beyond `depthKg` the price per kg falls step by step (tiers).
export const MARKET = {
  seasonSwing: 0.3, // in-season fish up to 15% cheaper, out-of-season up to 15% dearer
  dailySwing: 0.12, // the day-to-day wobble (smooth across days: yesterday's board hints at today)
  afterRough: 1.15, // the day after a rough day
  tiers: [1, 0.8, 0.6, 0.45], // price for each successive `depthKg` of one fish sold the same day
  depthKg: { aji: 30, isaki: 30, masaba: 60, sawara: 40, shiira: 60, yokowa: 40, madai: 30, akaamadai: 12, shiroamadai: 6, kasago: 10, kijihata: 8, akahata: 8, oomonhata: 10, ara: 15, kue: 10, buri: 80, hiramasa: 60, kanpachi: 50, kensaki: 25, yari: 25 },
};

// ---- 注文（R02）: requests from the market and the cooks — take them or not. ----
export const ORDERS = {
  maxActive: 3, // accepted and not yet done
  perDay: [1, 3], // offered each morning
  days: [1, 3], // days to deliver (including today)
  bonus: [0.25, 0.6], // added to the market price for the ordered kg
};

export const ECONOMY = {
  startFunds: 10000, // the 「ふつう」 start (DIFFICULTY.normal.startFunds)
  currency: 'G',
  tripBaseCost: 1500, // 氷・餌など1航海の定額
  fuelPerKm: 60, // under power (default; boats set their own)
  playtestFunds: 1500000, // the playtest save's funds (tests/e2e/fixtures/make-rich-save.mjs)
};

export const START_PROFILE = {
  boatModel: 'skiff_1',
  boatName: 'はやせ丸',
  slots: { helm_sounder: 'sounder_es1', starboard_reel: 'reel_hand', stern_troll: null, starboard_hauler: null, roof_lights: null, rod_rack: null },
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
  // 第2期（R20）: a peer for every method
  kuroki: { id: 'kuroki', name: '黒木さん', method: 'negyo', areas: ['西の根', '北の瀬', '南の浅場'], desc: '根魚釣りひと筋。根と漁礁を細かく回る。潮の緩む時間を大事にする。', fromDay: 2 },
  oda: { id: 'oda', name: '小田さん', method: 'oyogase', areas: ['北の瀬', '東の駆け上がり', '沖の平場'], desc: '活きアジの泳がせで青物を狙う。ベイトの反応を追いかけて走り回る。', fromDay: 3 },
  nakamura: { id: 'nakamura', name: '中村さん', method: 'jigging', areas: ['北の瀬', '東の駆け上がり', '沖の平場'], desc: 'ジギングで青物を追う若手。ベイトの反応と潮目をよく見ている。サバに泣かされることも多い。', fromDay: 2 },
  yoshimura: { id: 'yoshimura', name: '吉村さん', method: 'ika', areas: ['沖の深み', '北の瀬'], desc: '夕方から集魚灯を点けてイカを釣る。朝の港では前の晩の話をしてくれる。', fromDay: 4 },
};

// Time bands used to tag logs and compare similar conditions.
export const TIME_BANDS = [
  { id: 'dawn', label: '早朝', from: 0, to: 7 },
  { id: 'morning', label: '朝', from: 7, to: 10 },
  { id: 'midday', label: '昼', from: 10, to: 13 },
  { id: 'afternoon', label: '午後', from: 13, to: 24 },
];

// Port briefing happens at this game time of the day being prepared.
export const BRIEFING_T = 3.5 * 3600; // before the earliest departure of the year (summer, about 04:10)

// ---- Early-season script (序盤の海の筋書き・仮設定) ----
// Days 0-6 of a new save use these conditions and fish so that the three
// information scenarios of the handover (§7.5) occur. Reports are still
// generated from this world like any other day. Later days are procedural.
//   d1: a peer's fresh catch report points to a new place (北の瀬)
//   d2: same tide class and calm wind as d1 -> reproduce a past success
//   d3-4: water warms, サワラ arrive (needs trolling gear)
//   d5: 大潮 + strong wind, the 北の瀬東 school has thinned -> switch
export const SEASON_SCRIPT = {
  0: { cond: { windSpeed: 2.5, windDirDeg: 225, waterTemp: 14.7 }, aji: [['kita_e', 620, 0.3], ['nishi', 380, 0.25]], sawara: [] },
  1: { cond: { windSpeed: 2.4, windDirDeg: 200, waterTemp: 14.9 }, aji: [['kita_e', 640, 0.32], ['nishi', 360, 0.25], ['minami', 300, 0.05]], sawara: [] },
  2: { cond: { windSpeed: 3.2, windDirDeg: 210, waterTemp: 15.1 }, aji: [['kita_e', 600, 0.3], ['nishi', 380, 0.22]], sawara: [] },
  3: { cond: { windSpeed: 3.0, windDirDeg: 30, waterTemp: 15.4 }, aji: [['kita_e', 560, 0.3], ['nishi', 400, 0.25], ['higashi_s', 300, 0.2]], sawara: [['higashi', 40]] },
  4: { cond: { windSpeed: 4.5, windDirDeg: 40, waterTemp: 15.6 }, aji: [['kita_e', 170, 0.3], ['nishi', 420, 0.25], ['higashi_s', 320, 0.2]], sawara: [['higashi', 45], ['oki', 30]] },
  5: { cond: { windSpeed: 7.6, windDirDeg: 45, waterTemp: 15.8 }, aji: [['kita_s', 380, 0.3], ['nishi', 420, 0.25]], sawara: [['higashi', 50], ['oki', 35]] },
  6: { cond: { windSpeed: 3.4, windDirDeg: 60, waterTemp: 15.9 }, aji: [['kita_s', 420, 0.3], ['nishi', 400, 0.25], ['higashi_n', 320, 0.2]], sawara: [['oki', 40]] },
};
