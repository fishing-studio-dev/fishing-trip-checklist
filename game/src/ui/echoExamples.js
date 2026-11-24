// 魚探の映り方の例（手引き用）: fixed example passes over one kind of fish each,
// drawn with the game's own sounder. Each runs in its own little world (not
// the player's sea, not the voyage RNG), so the pictures are the same every
// time. They show the general look; at sea the same fish can look different.
import { createWorld } from '../core/world.js';
import { createObservation, pingColumn, pushColumn } from '../core/sounder.js';

const CALM = { tideAmp: 0, windSpeed: 0, waterTemp: 20 };

export const ECHO_EXAMPLES = [
  {
    id: 'aji_run',
    title: 'アジ（潮が効いているとき）',
    text: '底から1〜2mに、濃い帯のような反応がべったり付く。潮が効いて食いが立つと、群れは底に押し付けられて締まる。',
    at: { x: 1155, y: 1700 },
    schools: [{ id: 'A', species: 'aji', a: { x: 1290, y: 1700 }, counts: { s: 60, m: 200, l: 60 }, sigmaH: 22, sigmaZ: 1.2, fixedOffBottom: 1.6, activityOverride: 1, orbitR: 0 }],
  },
  {
    id: 'aji_slack',
    title: 'アジ（潮が止まっているとき）',
    text: '同じアジでも、潮が止まると底から浮いて、ふわっと広がった雲のような反応になる。反応ははっきり出ているのに、ほとんど食わないことが多い。',
    at: { x: 1155, y: 1700 },
    schools: [{ id: 'A', species: 'aji', a: { x: 1290, y: 1700 }, counts: { s: 60, m: 200, l: 60 }, sigmaH: 26, sigmaZ: 3.2, fixedOffBottom: 5, activityOverride: 1, orbitR: 0 }],
  },
  {
    id: 'isaki',
    title: 'イサキ（高い根の上）',
    text: '根や瀬のてっぺんの上に、縦に伸びた柱のような反応が立つ。朝夕は特に高く浮く。',
    at: { x: 1365, y: 2200 },
    schools: [{ id: 'I', species: 'isaki', a: { x: 1500, y: 2200 }, counts: { s: 60, m: 160, l: 40 }, sigmaH: 12, sigmaZ: 3.5, fixedOffBottom: 7, activityOverride: 1, orbitR: 0 }],
  },
  {
    id: 'masaba',
    title: 'サバ（中層の大群）',
    text: '中層に横に長い帯が続く。数は多いが一尾一尾の反射は弱く、濃さの割に色は薄め。群れごと速く動く。',
    at: { x: 1155, y: 1700 },
    schools: [{ id: 'S', species: 'masaba', a: { x: 1290, y: 1700 }, counts: { s: 400, m: 1200, l: 300 }, sigmaH: 70, sigmaZ: 2.2, depthFrac: 0.45, activityOverride: 1, orbitR: 0 }],
  },
  {
    id: 'madai',
    title: 'マダイ（底近くに点々）',
    text: '底のすぐ上に、一尾ずつの「へ」の字（山形）が点々と出る。魚の大きさではなく、ビームの中にいる時間で山の長さが変わる。',
    at: { x: 1155, y: 1700 },
    schools: [{ id: 'M', species: 'madai', a: { x: 1290, y: 1700 }, counts: { s: 6, m: 14, l: 4 }, sigmaH: 35, sigmaZ: 0.8, fixedOffBottom: 2.2, activityOverride: 1, orbitR: 0 }],
  },
  {
    id: 'bait',
    title: 'ベイト（イワシ・追われていない）',
    text: '中層〜表層に、形の整った濃い団子。中まで濃さがそろっている。',
    at: { x: 1155, y: 1700 },
    schools: [{ id: 'B', species: 'iwashi', a: { x: 1290, y: 1700 }, counts: { s: 2000, m: 2000, l: 1000 }, sigmaH: 18, sigmaZ: 2.2, fixedDepth: 12, activityOverride: 1, orbitR: 0 }],
  },
  {
    id: 'bait_blue',
    title: 'ベイトと青物（追われている）',
    text: 'ベイトの団子が崩れて穴が開き、まだらになる。その下や横に、太い「へ」の字や斜めの線が出たら、ブリ・ヒラマサなどが付いている。泳がせ釣りの狙い目。',
    at: { x: 1155, y: 1700 },
    schools: [
      { id: 'B', species: 'iwashi', a: { x: 1290, y: 1700 }, counts: { s: 2000, m: 2000, l: 1000 }, sigmaH: 20, sigmaZ: 2.2, fixedDepth: 12, activityOverride: 1, orbitR: 0 },
      { id: 'Y', species: 'buri', a: { x: 1295, y: 1700 }, counts: { s: 3, m: 6, l: 3 }, sigmaH: 18, sigmaZ: 3, depthFrac: 0.45, activityOverride: 1, orbitR: 0 },
    ],
  },
  {
    id: 'squid',
    title: 'イカ（夜・集魚灯の下）',
    text: '薄い青や緑の点が散らばる。イカは浮き袋がないので反射が弱く、たくさんいても色は薄い。',
    at: { x: 485, y: 2650 },
    t: 21 * 3600,
    schools: [{ id: 'K', species: 'kensaki', a: { x: 620, y: 2650 }, counts: { s: 150, m: 300, l: 80 }, sigmaH: 90, sigmaZ: 4, activityOverride: 1, orbitR: 0 }],
  },
  {
    id: 'reef',
    title: '根魚（根・漁礁の上）',
    text: '底の凸凹にくっついて、底の線とほとんど見分けがつかない。魚探では「根があること」で探し、根魚そのものはあまり映らない。',
    at: { x: 1165, y: 1050 },
    schools: [
      { id: 'R1', species: 'kasago', a: { x: 1300, y: 1050 }, counts: { s: 4, m: 8, l: 3 }, sigmaH: 12, sigmaZ: 1, activityOverride: 1, orbitR: 0 },
      { id: 'R2', species: 'kijihata', a: { x: 1300, y: 1050 }, counts: { s: 2, m: 3, l: 1 }, sigmaH: 12, sigmaZ: 1, activityOverride: 1, orbitR: 0 },
    ],
  },
];

const cache = new Map();

/** Observation of a 180 s pass at 1.5 m/s (about 3 knots) across the example (360 pings). */
export function exampleObservation(ex, spec) {
  const key = `${ex.id}:${JSON.stringify(spec)}`;
  if (cache.has(key)) return cache.get(key);
  const t0 = ex.t || 9 * 3600;
  const world = createWorld(1, 20, t0, { conditions: CALM, schools: ex.schools });
  const obs = createObservation();
  for (let i = 0; i < 360; i++) {
    world.time = t0 + i * 0.5;
    pushColumn(obs, pingColumn(world, ex.at.x + i * 0.75, ex.at.y, spec, i));
  }
  cache.set(key, obs);
  return obs;
}
