// はじめての案内 (first-time guide). Short hints that follow what the player is
// doing on the first voyages: steer out, read the sounder, stop up-tide of a
// school, start, go home. Also a one-time note the first time each method is
// chosen. It only reads the voyage (never changes the simulation) and what
// was seen is remembered per browser under the ryoshi-game: prefix.
import { METHODS } from '../core/data.js';

export const GUIDE_KEY = 'ryoshi-game:guide';

/** The steps of the first voyage, in order. `done(v, g)` says when the step is over. */
export const GUIDE_STEPS = [
  {
    id: 'out',
    text: '港を出ましょう。増速（W・▲）と舵（A/D・◀▶）で操船します。海図の黄色い矢印が今進んでいる向きです。海図を「拡大」して行き先をタップし「航路で移動」（G）でも向かえます。',
    done: (v) => v.distFromPort > 400 || v.operating || v.landed > 0,
  },
  {
    id: 'search',
    text: '魚探を見ながら走ります。右へ流れていく画面に、海底（太い帯）の上の色の濃い塊が出たら魚の群れです。候補の丸や仲間の話のあたりを探しましょう。',
    done: (v) => v.echo || v.operating || v.landed > 0,
  },
  {
    id: 'stop',
    text: '反応が出ました。減速（S・▼）して止まります。船は潮と風で黄色い矢印の向きに流されるので、群れの少し潮上で止まると、流れながら群れの上を通れます。',
    done: (v) => v.stopped || v.operating,
  },
  {
    id: 'start',
    text: '止まったら「操業開始」（Space）。仕掛けの投入・タナ合わせ・取り込みは自動です。漁法は T で切り替えます。',
    done: (v) => v.operating || v.landed > 0,
  },
  {
    id: 'fish',
    text: '操業中です。下のパネルに作業の段階と釣果が出ます。流されて反応から外れたら「流し直し」（R）で流し始めた地点へ戻れます。',
    done: (v) => v.landed > 0 && !v.operating,
  },
  {
    id: 'home',
    text: '魚倉が埋まる前か夕方前に「帰港」（H）。港に着くと自動で水揚げ・精算して保存します。翌朝は仲間の話と自分の日誌から次の狙いを決めます。',
    done: (v) => v.returning || v.docked,
  },
];

/** The one-time notes shown the first time a method is chosen. */
export const METHOD_TIPS = {
  negyo: '根魚釣り：根や漁礁の真上（少し潮上）で止めて Space。仕掛けは底を切って自動で上下します。根から外れたら R で流し直し。根掛かりは腕前で減ります。',
  oyogase: '泳がせ釣り：先に一本釣りで釣ったアジを1尾ずつ活きエサに使います。根や瀬の周り、ベイトの反応の下で止めて Space。青物は掛かるとやり取りに時間がかかります。',
  ika: 'イカ釣り：暗くなると集魚灯でまわりのイカが船の下に寄ってきます。沖の深い所で止めて Space（パラアンカーを入れて流され方を抑えます）。',
  troll: '曳縄：海図を拡大して航路をタップで決め、Space で走りながら曳きます。航行と仕掛けの出し入れは自動です。',
  longline: '延縄：張る向きを決めて Space で投縄。浸けている間は自由に動けます。揚げるときは L（確認が出ます）。',
};

/** Read the saved guide state (per browser). Never throws. */
export function loadGuide(storage) {
  try {
    const raw = storage && storage.getItem(GUIDE_KEY);
    const g = raw ? JSON.parse(raw) : null;
    if (g && typeof g === 'object') return { off: !!g.off, done: Array.isArray(g.done) ? g.done : [], tips: Array.isArray(g.tips) ? g.tips : [] };
  } catch {
    /* unreadable: start over */
  }
  return { off: false, done: [], tips: [] };
}

export function saveGuide(storage, g) {
  try {
    if (storage) storage.setItem(GUIDE_KEY, JSON.stringify(g));
  } catch {
    /* storage full or blocked: the guide just shows again next time */
  }
}

/** What the guide reads from a voyage (a small, plain summary). */
export function guideView(v, { portX, portY }) {
  const last = v.obs.cols.slice(-12);
  return {
    distFromPort: Math.hypot(v.boat.x - portX, v.boat.y - portY),
    echo: last.some((c) => c.maxFish >= 0.3),
    stopped: Math.abs(v.boat.speed) < 0.3 && Math.hypot(v.boat.x - portX, v.boat.y - portY) > 400,
    operating: !!(v.op && v.op.state !== 'ended'),
    landed: v.hold.count,
    returning: !!(v.autopilot && v.autopilot.kind === 'return'),
    docked: v.phase === 'docked',
    method: v.method,
    usedMethods: [...new Set(v.logs.map((l) => l.methodId))],
  };
}

/**
 * The note to show now, or null: a method's first-time note takes priority,
 * then the first step of the voyage guide not yet done. Steps already passed
 * (their condition met) are reported in `passed` so they can be remembered.
 */
export function guideNow(view, g, { everFished = false } = {}) {
  if (g.off) return { note: null, passed: [] };
  const passed = [];
  for (const s of GUIDE_STEPS) if (!g.done.includes(s.id) && s.done(view)) passed.push(s.id);
  const m = view.method;
  if (METHOD_TIPS[m] && !g.tips.includes(m) && !view.usedMethods.includes(m)) {
    return { note: { kind: 'tip', id: m, title: `はじめての${METHODS[m].name}`, text: METHOD_TIPS[m] }, passed };
  }
  // the voyage guide is for a newcomer: once a voyage has been fished and settled, it is not shown again
  if (everFished) return { note: null, passed };
  const doneNow = new Set([...g.done, ...passed]);
  const i = GUIDE_STEPS.findIndex((s) => !doneNow.has(s.id));
  if (i < 0) return { note: null, passed };
  const s = GUIDE_STEPS[i];
  return { note: { kind: 'step', id: s.id, title: `はじめての航海 ${i + 1}/${GUIDE_STEPS.length}`, text: s.text }, passed };
}
