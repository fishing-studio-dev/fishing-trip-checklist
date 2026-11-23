// App controller: boot, screens, input, main loop.
import { TIME, BOATS, PORT, EQUIPMENT, METHODS, SIM, SPECIES, CREW, GUIDES, sellValue } from '../core/data.js';
import { createProfile, markDeparture, resolveInterruptedVoyage, restDay } from '../core/profile.js';
import { settleVoyage, purchaseEquipment, purchasePreview, equipFromStorage, unmountToStorage, sellStored, buyBoat, planBoatPurchase } from '../core/economy.js';
import { loadSave, writeSave, exportSave, checkImport, memoryStorage, KEYS } from '../core/save.js';
import {
  createVoyage, advanceVoyage, isOperating, isTrolling, setHelm, setMethod, startOperation, stopOperation, redrift, returnToPort,
  nearPort, addManualMark, summarizeVoyage, canStartOperation, addRoutePoint, clearRoute, trollRouteFrom,
  isLonglining, lineInWater, haulLongline, lineRouteFrom, runRoute, addMarkAt, cycleSonarRange, baitInHold, editVoyageMark, removeVoyageMark, routeTo,
} from '../core/voyage.js';
import { sonarToWorld } from '../core/sonar.js';
import { surfaceCues } from '../core/surface.js';
import { longlineLabel, baitLeft, nearestBuoy, buoys } from '../core/longline.js';
import { acquireBriefing, buildCandidates, planSummary } from '../core/knowledge.js';
import { reportLine, peerName } from '../core/reports.js';
import { trollLineLabel } from '../core/troll.js';
import { linePhaseLabel, recentPace } from '../core/fishing.js';
import { fmtClock, compass8, areaNameAt, currentAt, makeDayConditions, forecastOf, visibilityAt } from '../core/sea.js';
import { levelFromXp } from '../core/progress.js';
import { schoolCenter } from '../core/world.js';
import { buildStaticMap, drawChart, drawBriefingChart, chartToWorld, worldToChart, bathyCanvas } from './chart.js';
import { drawSideView, sideViewHit } from './sideView.js';
import { markList, editSavedMark, removeSavedMark, MARK_KINDS, MARK_LIMITS } from '../core/marks.js';
import { sideToWorld } from '../core/sideview.js';
import { drawSonar, sonarTap } from './sonarView.js';
import { cellsFromBathy } from '../core/bathy.js';
import { createSounderView } from './sounderView.js';
import { demoObservation } from './sounderDemo.js';
import * as S from './screens.js';
import { PLAYTEST_SAVE } from './playtestSave.js';
import { snapshotVoyage, restoreVoyage } from '../core/voyageSnapshot.js';

const params = new URLSearchParams(location.search);
const DEV = params.get('dev') === '1';
// set by tools/build-artifact.mjs when the game is published as a claude.ai page
const BUILD = window.__RYOSHI_BUILD__ || { hosted: false };
const $ = (id) => document.getElementById(id);

// ---------------------------------------------------------------- storage
let storageUnavailable = false;
function pickStorage() {
  try {
    const s = window.localStorage;
    const k = 'ryoshi-game:probe';
    s.setItem(k, '1');
    s.removeItem(k);
    return s;
  } catch {
    storageUnavailable = true;
    return memoryStorage();
  }
}
const store = pickStorage();

const app = {
  profile: null,
  revision: 0,
  saveStatus: null,
  screen: 'loading',
  voyage: null,
  summary: null,
  receipt: null,
  settling: false,
  notice: '',
  loadResult: null,
  speedIdx: 0,
  paused: false,
  view: 'helm',
  sounderOpen: true,
  chartBig: false,
  carry: 0,
  seenMsg: 0,
  seenEvent: 0,
  lastFeed: '',
  hosted: !!BUILD.hosted,
  hireCrew: false, // today's choice at port (a deckhand for one voyage)
  nightTrip: false, // today's choice at port: leave in the evening for イカ釣り (lamp fitted)
  markSel: null, // the mark picked in the list ('s:M3' saved / 'v:5' today's), ringed on the charts
};

function commit(profile, reason) {
  app.profile = profile;
  const r = writeSave(store, profile, app.revision);
  if (r.ok) {
    app.revision = r.revision;
    app.saveStatus = { ok: true, at: r.savedAt, reason };
  } else app.saveStatus = { ok: false, error: r.error, reason };
  if (storageUnavailable && r.ok) app.saveStatus = { ok: false, error: 'このブラウザでは保存領域が使えないため、ページを閉じると消えます', reason };
  return r;
}

// ---------------------------------------------------------------- 3D (optional)
let scene = null;
async function initScene() {
  try {
    const mod = await import('./scene3d.js');
    scene = mod.createScene($('view3d'));
    window.addEventListener('resize', () => scene && scene.resize());
  } catch (e) {
    console.error(e);
    toast('3D表示を初期化できませんでした（海図と魚探で遊べます）');
  }
}

// ---------------------------------------------------------------- screens
function show(screen) {
  app.screen = screen;
  const el = $('screen');
  const hud = $('hud');
  hud.hidden = screen !== 'sea';
  if (screen === 'sea') {
    el.hidden = true;
    el.innerHTML = '';
    updateHudStatic();
    return;
  }
  el.hidden = false;
  app.inPlaytest = readKey(KEYS.beforePlaytest) != null;
  if (screen === 'port' || screen === 'log') preparePort();
  let html = '';
  switch (screen) {
    case 'title':
      html = S.titleScreen({ storageNote: storageUnavailable ? 'このブラウザでは保存領域が使えません。遊べますが、ページを閉じると進行は消えます。' : '' });
      break;
    case 'saveProblem':
      html = S.saveProblemScreen(app.loadResult);
      break;
    case 'port':
      html = S.portScreen(app);
      break;
    case 'receipt':
      html = S.receiptScreen(app);
      break;
    case 'equip':
      html = S.equipScreen(app);
      break;
    case 'market':
      html = S.marketScreen(app);
      break;
    case 'log':
      html = S.logScreen(app);
      break;
    case 'save':
      html = S.saveScreen(app);
      break;
    default:
      html = '';
  }
  el.innerHTML = html;
  el.scrollTop = 0;
  if (screen === 'port') {
    const c = $('portChart');
    if (c) drawBriefingChart(c, staticMap, { candidates: app.candidates, reports: chartReports(app.profile.knowledge.reports, app.profile.day + 1), boatModel: app.profile.boat.model, bathy: bathyCanvas(ownCells(), null), marks: app.profile.marks, selected: app.markSel });
  }
  if (screen === 'equip') drawSounderDemos(el);
  if (screen === 'save') {
    const f = $('importFile');
    if (f) f.addEventListener('change', onImportFile);
  }
}

/** The same example water seen through each sounder (equipment screen). */
function drawSounderDemos(root) {
  for (const c of root.querySelectorAll('canvas[data-sdemo]')) {
    const spec = EQUIPMENT[c.dataset.sdemo].sounder;
    createSounderView(c).draw(demoObservation(spec), { readout: !!spec.readout, fit: true });
  }
}

function modal(html) {
  const m = $('modal');
  if (!html) {
    m.hidden = true;
    m.innerHTML = '';
    return;
  }
  m.innerHTML = html;
  m.hidden = false;
}

let toastTimer = null;
function toast(text) {
  const t = $('toast');
  t.textContent = text;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}

/**
 * The morning in port: hear the peers (once per day, saved), read the forecast
 * and build today's candidates from what the player now knows.
 */
function preparePort() {
  const p = app.profile;
  if (!p) return;
  const d = p.day + 1;
  if (!p.activeVoyage && p.knowledge.briefedDay < d) commit(acquireBriefing(p, d), '港で仲間の話を聞いた');
  app.forecast = forecastOf(makeDayConditions(app.profile.worldSeed, d));
  app.candidates = buildCandidates({ knowledge: app.profile.knowledge, logs: app.profile.logs, today: d, forecast: app.forecast, profile: app.profile });
}

/** Peers' observations to mark on a chart (recent ones), labelled with who and when. */
function chartReports(reports, today) {
  return reports
    .filter((r) => r.spot && r.kind !== 'rule' && !r.relayedFrom && r.obsDay >= today - 1)
    .map((r) => {
      const l = reportLine(r, today);
      return { r, label: `${peerName(r.speaker).replace('さん', '')} ${l.when.replace(/の.*$/, '')}` };
    });
}

// ---------------------------------------------------------------- actions
function newGame() {
  const seed = DEV && params.get('seed') ? Number(params.get('seed')) : undefined;
  const p = createProfile({ worldSeed: seed });
  app.revision = 0;
  commit(p, '新規作成');
  app.notice = '';
  show('port');
}

function depart(planKey = null) {
  if (app.profile.activeVoyage) return;
  let plan = null;
  if (planKey) {
    const c = (app.candidates || []).find((x) => x.key === planKey);
    if (c) plan = { ...planSummary(c, app.profile.day + 1), methodId: c.methodId };
  }
  const crew = app.hireCrew && app.profile.funds >= CREW.wage ? 1 : 0;
  const hasLamp = Object.values(app.profile.boat.slots).some((x) => x && EQUIPMENT[x.itemId].type === 'lights');
  const night = hasLamp && (app.nightTrip || (plan && plan.methodId === 'ika')) ? 1 : 0;
  const p = markDeparture(app.profile, new Date().toISOString(), plan, { crew, night });
  app.nightTrip = false;
  const r = commit(p, '出港を記録');
  if (!r.ok) toast('出港の記録を保存できませんでした（このまま出港します）');
  let scenario = null;
  if (DEV && params.get('scenario') === 'near') scenario = nearScenario();
  enterSea(createVoyage(app.profile, { scenario }));
  saveVoyageNow();
}

/** The player's own measured depths (from the profile), decoded once per change. */
let ownCellsCache = { tiles: null, cells: {} };
function ownCells() {
  const b = app.profile && app.profile.bathy;
  if (b && b.tiles !== ownCellsCache.tiles) ownCellsCache = { tiles: b.tiles, cells: cellsFromBathy(b) };
  return ownCellsCache.cells;
}

/** Put a voyage (new or resumed) on screen. */
function enterSea(v) {
  app.voyage = v;
  $('msgs').dataset.last = '';
  app.carry = 0;
  app.seenMsg = 0;
  app.seenEvent = v.eventSeq - 1;
  app.notice = '';
  app.paused = false;
  app.lastFeed = '';
  show('sea');
  snapCamera = true;
}

// ---------------------------------------------------------------- saving at sea
let lastVoyageSave = 0;
/** Keep the voyage in progress in storage, so closing the page at sea loses nothing. */
function saveVoyageNow() {
  const v = app.voyage;
  if (!v || v.phase !== 'sea' || storageUnavailable) return;
  try {
    store.setItem(KEYS.voyage, JSON.stringify(snapshotVoyage(v)));
    lastVoyageSave = performance.now();
  } catch {
    /* storage full or blocked: the voyage simply is not resumable */
  }
}
function clearVoyageSave() {
  try {
    store.removeItem(KEYS.voyage);
  } catch {
    /* ignore */
  }
}
window.addEventListener('pagehide', saveVoyageNow);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') saveVoyageNow();
});

/** Dev-only scenario: one dense school close to the port for quick checks. */
function nearScenario() {
  return { schools: [{ id: 'DEV1', a: { x: 1500, y: 900 }, counts: { s: 80, m: 260, l: 80 }, sigmaH: 30, sigmaZ: 3, orbitR: 0 }] };
}

/**
 * Docked: land and sell everything, pay the trip cost, gain XP and save — all
 * at once, so closing the page after arriving can't lose the catch.
 */
function arriveAndSettle() {
  if (app.settling) return;
  app.settling = true;
  app.summary = summarizeVoyage(app.voyage);
  const res = settleVoyage(app.profile, app.summary);
  if (!res.ok) {
    app.notice = `精算できませんでした：${res.reason}`;
    app.voyage = null;
    app.settling = false;
    show('port');
    return;
  }
  const w = commit(res.profile, '水揚げ・精算');
  if (w.ok) clearVoyageSave(); // landed and saved: the voyage in progress is no longer needed
  app.receipt = res.receipt;
  app.receiptHold = app.summary.hold;
  app.receiptLogs = app.summary.logs;
  app.voyage = null;
  app.settling = false;
  show('receipt');
}

function buy(itemId, slotId) {
  const pv = purchasePreview(app.profile, itemId, slotId);
  if (!pv.ok) {
    toast(pv.reason);
    return;
  }
  modal(`<div class="card"><h2>購入の確認</h2><p><b>${S.esc(pv.item.name)}</b> を購入して「${S.esc(pv.slot.label)}」に取り付けます。</p>${S.guideHtml(itemId, true)}
  <dl class="kv"><dt>支払総額</dt><dd>${pv.price.toLocaleString()}G</dd><dt>購入後の資金</dt><dd>${pv.fundsAfter.toLocaleString()}G</dd><dt>外す装備</dt><dd>${S.esc(pv.removed ? pv.removed.name : 'なし')} → 倉庫</dd></dl>
  <div class="actions"><button type="button" class="btn primary" data-act="buyConfirm" data-item="${S.esc(itemId)}" data-slot="${S.esc(slotId)}">購入する</button><button type="button" class="btn" data-act="closeModal">やめる</button></div></div>`);
}

function buyConfirm(itemId, slotId) {
  modal(null);
  const res = purchaseEquipment(app.profile, itemId, slotId);
  if (!res.ok) {
    toast(res.reason);
    return;
  }
  commit(res.profile, '装備の購入');
  show('equip');
  const g = GUIDES[itemId];
  modal(`<div class="card"><h2>${S.esc(EQUIPMENT[itemId].name)} を取り付けました</h2>
  ${g ? `<h3>次の航海での見どころ</h3><ul>${[...(g.inPlay || []), ...(g.changes || [])].map((x) => `<li>${S.esc(x)}</li>`).join('')}</ul>${g.note ? `<p class="note">${S.esc(g.note)}</p>` : ''}` : ''}
  <div class="actions"><button type="button" class="btn primary" data-act="closeModal">閉じる</button></div></div>`);
}

function unmount(slotId) {
  const res = unmountToStorage(app.profile, slotId);
  if (!res.ok) {
    toast(res.reason);
    return;
  }
  commit(res.profile, '装備を倉庫へ');
  show('equip');
}

function sell(uid) {
  const inst = app.profile.storage.find((x) => x.uid === uid);
  if (!inst) return;
  const it = EQUIPMENT[inst.itemId];
  const value = sellValue(it);
  modal(`<div class="card"><h2>倉庫の装備を売る</h2><p><b>${S.esc(it.name)}</b> を売ります。売ると倉庫から消えます。</p>
  <dl class="kv"><dt>受け取る金額</dt><dd>${value.toLocaleString()}G</dd><dt>売った後の資金</dt><dd>${(app.profile.funds + value).toLocaleString()}G</dd></dl>
  <div class="actions"><button type="button" class="btn warn" data-act="sellConfirm" data-uid="${S.esc(uid)}">売る</button><button type="button" class="btn" data-act="closeModal">やめる</button></div></div>`);
}

function sellConfirm(uid) {
  modal(null);
  const res = sellStored(app.profile, uid);
  if (!res.ok) {
    toast(res.reason);
    return;
  }
  commit(res.profile, '装備の売却');
  toast(`${EQUIPMENT[res.receipt.itemId].name} を ${res.receipt.value.toLocaleString()}G で売りました`);
  show('equip');
}

function boatQuote(offerId) {
  const plan = planBoatPurchase(app.profile, offerId);
  if (!plan.offer) {
    toast(plan.reason);
    return;
  }
  modal(S.boatQuoteModal(app.profile, offerId));
}

function buyBoatConfirm(offerId) {
  modal(null);
  const res = buyBoat(app.profile, offerId);
  if (!res.ok) {
    toast(res.reason);
    return;
  }
  const r = commit(res.profile, '船の買い替え');
  const m = BOATS[res.receipt.model];
  const stored = res.receipt.moves.filter((mv) => !mv.to).map((mv) => EQUIPMENT[mv.itemId].name);
  show('port');
  modal(`<div class="card"><h2>${S.esc(m.name)}に買い替えました</h2>
  <dl class="kv"><dt>支払総額</dt><dd>${res.receipt.payable.toLocaleString()}G（本体 ${res.receipt.price.toLocaleString()}G − 下取り ${res.receipt.tradeIn.toLocaleString()}G）</dd><dt>資金</dt><dd>${res.receipt.fundsBefore.toLocaleString()}G → <b>${res.receipt.fundsAfter.toLocaleString()}G</b></dd>
  <dt>倉庫へ</dt><dd>${S.esc(stored.length ? stored.join('、') : 'なし')}</dd><dt>保存</dt><dd>${r.ok ? '保存しました' : `保存に失敗しました（${S.esc(r.error || '')}）`}</dd></dl>
  <p class="note">次の航海からこの船で出ます。装備は「装備」画面で確認・付け替えできます。</p>
  <div class="actions"><button type="button" class="btn primary" data-act="closeModal">閉じる</button><button type="button" class="btn" data-act="equip">装備を見る</button></div></div>`);
}

function equipStored(uid, slotId) {
  const res = equipFromStorage(app.profile, uid, slotId);
  if (!res.ok) {
    toast(res.reason);
    return;
  }
  commit(res.profile, '装備の付け替え');
  show('equip');
}

/**
 * Save a text file. The published page cannot download files, so that build
 * (esbuild --define:globalThis.RYOSHI_HOSTED=true) compiles this to copyText only.
 */
function download(name, text) {
  if (globalThis.RYOSHI_HOSTED) {
    copyText(text);
    return;
  }
  const blob = new Blob([text], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 500);
}

function exportCurrent() {
  const d = new Date();
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  download(`ryoshi-save-${stamp}-day${app.profile.day}.json`, exportSave(app.profile, app.revision));
  toast('セーブを書き出しました');
}

let pendingImport = null;

/** Copy the save as text (downloads are not available on the hosted page). */
/** Put text on the clipboard and show it selectable, so it can be kept even if the clipboard is refused. */
async function copyText(text) {
  let ok = false;
  try {
    await navigator.clipboard.writeText(text);
    ok = true;
  } catch {
    ok = false;
  }
  modal(`<div class="card"><h2>セーブの文字列</h2><p class="note">${ok ? 'コピーしました。' : 'コピーできなかったので、下の文字列を選択してコピーしてください。'}メモアプリなどに貼り付けて保管し、読み込むときは「セーブ管理」の貼り付け欄に戻します。</p>
  <textarea class="paste" id="copyArea" readonly></textarea>
  <div class="actions"><button type="button" class="btn primary" data-act="closeModal">閉じる</button></div></div>`);
  const area = $('copyArea');
  area.value = text;
  if (!ok) {
    area.focus();
    area.select();
  }
  toast(ok ? 'セーブをコピーしました' : '文字列を選択してコピーしてください');
}

function copySave() {
  copyText(exportSave(app.profile, app.revision));
}

function importText(text) {
  const res = checkImport(String(text || '').trim());
  const out = $('importResult');
  if (!res.ok) {
    if (out) out.textContent = `読み込めません：${res.error}`;
    return;
  }
  pendingImport = res.profile;
  const p = res.profile;
  modal(`<div class="card"><h2>セーブの読み込み</h2><p>次の内容で現在の進行を置き換えます。現在のセーブはバックアップに残ります。</p>
  <dl class="kv"><dt>日数</dt><dd>${p.day}日目まで</dd><dt>資金</dt><dd>${p.funds.toLocaleString()}G</dd><dt>一本釣り</dt><dd>Lv ${levelFromXp(p.methods.handline.xp)}</dd><dt>操業記録</dt><dd>${p.logs.length}件</dd></dl>
  <div class="actions"><button type="button" class="btn primary" data-act="importConfirm">読み込む</button><button type="button" class="btn" data-act="closeModal">やめる</button></div></div>`);
}

function onImportFile(ev) {
  const file = ev.target.files && ev.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => importText(reader.result);
  reader.readAsText(file);
}

function importConfirm() {
  modal(null);
  if (!pendingImport) return;
  let p = pendingImport;
  pendingImport = null;
  const r = resolveInterruptedVoyage(p);
  p = r.profile;
  commit(p, 'ファイルから読み込み');
  app.notice = r.interrupted ? `読み込んだセーブには${r.interrupted.day}日目の航海中の記録がありました。海上の途中経過はこのブラウザの中にしかないため、この航海は中断扱いにしました。` : 'セーブを読み込みました。';
  show('port');
}

// ---------------------------------------------------------------- sea commands
function cmd(name) {
  const v = app.voyage;
  if (!v || app.screen !== 'sea') return;
  let r = { ok: true };
  switch (name) {
    case 'op':
      if (isOperating(v)) r = stopOperation(v, 'player');
      else if (v.method === 'longline' && v.line && v.line.state === 'soaking') haulAsk('haul');
      else r = startOperation(v);
      break;
    case 'redrift':
      r = redrift(v);
      break;
    case 'port':
      // going home with the line in the water hauls it first: ask once
      if (v.line && v.line.state === 'soaking' && !(v.autopilot && v.autopilot.kind === 'return')) haulAsk('port');
      else r = returnToPort(v);
      break;
    case 'mark':
      addManualMark(v);
      break;
    case 'throttleUp':
      r = setHelm(v, { throttle: v.boat.throttle + 1 });
      break;
    case 'throttleDown':
      r = setHelm(v, { throttle: v.boat.throttle - 1 });
      break;
    case 'method': {
      const avail = availableMethods(v);
      const next = avail[(avail.indexOf(v.method) + 1) % avail.length];
      r = setMethod(v, next);
      const tip = { ika: v.world.time < 17.5 * 3600 ? '（暗くなるほど集魚灯が効く。沖の深い所で停船してSpace）' : '（沖の深い所で停船してSpace。集魚灯でイカを寄せる）', oyogase: `（魚倉の活きアジ${baitInHold(v, 'aji')}尾。根・瀬の周りやベイトの反応の下で停船してSpace）`, negyo: '（根・漁礁の真上か少し潮上で停船してSpace。外れたら R で流し直し）', troll: '（海図 C をクリックして航路、Spaceで開始）', longline: lineInWater(v) ? '（Spaceで揚げ縄）' : '（今の向きか海図 C で張る向きを決めて、Spaceで投縄）' };
      if (r.ok) toast(`漁法：${METHODS[v.method].name}${tip[v.method] || ''}`);
      break;
    }
    case 'haul':
      haulAsk('haul');
      break;
    case 'route':
      r = runRoute(v);
      break;
    case 'clearRoute':
      r = clearRoute(v);
      if (r.ok) toast('航路を消しました');
      break;
    default:
      break;
  }
  if (r && !r.ok && r.reason) toast(r.reason);
  updateHudStatic();
}

/**
 * 揚げ縄 is asked once before it starts (it cannot be stopped midway, and an
 * accidental press would end the soak). The sea is paused while the question
 * is open; Space cannot answer it — only a tap / click on the button.
 */
// ---------------------------------------------------------------- the player's marks
function marksModal(opts = {}) {
  if (!app.profile) return;
  const atSea = app.screen === 'sea' && !!app.voyage;
  modal(S.marksList(markList(app.profile, atSea ? app.voyage : null), { atSea, kinds: MARK_KINDS, limits: MARK_LIMITS, ...opts }));
  if (opts.editKey && $('markName')) $('markName').focus();
}

function markAction(act, key) {
  const atSea = app.screen === 'sea' && !!app.voyage;
  const v = atSea ? app.voyage : null;
  const row = markList(app.profile, v).find((r) => r.key === key);
  if (!row) {
    marksModal();
    toast('その印は見つかりません');
    return;
  }
  const refreshPort = () => app.screen === 'port' && show('port');
  switch (act) {
    case 'markEdit':
      marksModal({ editKey: key });
      break;
    case 'markSave': {
      const name = $('markName') ? $('markName').value : undefined;
      const memo = $('markMemo') ? $('markMemo').value : undefined;
      if (row.source === 'voyage') editVoyageMark(v, row.id, { name, memo });
      else {
        const r = editSavedMark(app.profile, row.id, { name, memo });
        if (r.ok) commit(r.profile, '印を編集した');
      }
      refreshPort();
      marksModal();
      toast('印を保存しました');
      break;
    }
    case 'markDel':
      marksModal({ delKey: key });
      break;
    case 'markDelYes': {
      if (row.source === 'voyage') removeVoyageMark(v, row.id);
      else {
        const r = removeSavedMark(app.profile, row.id);
        if (r.ok) commit(r.profile, '印を消した');
      }
      if (app.markSel === key) app.markSel = null;
      refreshPort();
      marksModal();
      toast(`「${row.title}」を消しました`);
      break;
    }
    case 'markGo': {
      const r = routeTo(v, { x: row.x, y: row.y });
      modal(null);
      app.markSel = key;
      toast(r.ok ? `「${row.title}」へ向かいます（移動補助・操船で取り消し）` : r.reason);
      updateHudStatic();
      break;
    }
    case 'markShow':
      app.markSel = key;
      modal(null);
      if (atSea) app.chartBig = true;
      refreshPort();
      toast(`「${row.title}」を白い丸で示しています`);
      if (atSea) updateHudStatic();
      break;
    default:
  }
}

function haulAsk(then) {
  const v = app.voyage;
  if (!v || !v.line || v.line.state !== 'soaking') {
    const r = haulLongline(v);
    if (!r.ok) toast(r.reason);
    return;
  }
  const soakMin = Math.floor((v.world.time - v.line.setEndT) / 60);
  const bait = Math.round(baitLeft(v.line, v.world.time) * 100);
  const b = nearestBuoy(v.line, v.boat.x, v.boat.y);
  const what = then === 'port' ? '縄を揚げてから帰港します' : '縄を揚げます';
  modal(`<div class="card"><h2>${what}。よろしいですか？</h2>
  <dl class="kv"><dt>浸けた時間</dt><dd>${soakMin}分</dd><dt>餌の残り（目安）</dt><dd>${bait}%</dd><dt>近いブイまで</dt><dd>${Math.round(b.dist)}m</dd></dl>
  <p class="note">揚げ縄は途中でやめられません（最後まで揚げます）。${b.dist > METHODS.longline.nearBuoy ? 'ブイまでは移動補助で向かいます。' : ''}まだ浸けておくなら「やめる」。</p>
  <div class="actions"><button type="button" class="btn primary" data-act="haulConfirm" data-then="${then}">${then === 'port' ? '揚げて帰港する' : '揚げる'}</button><button type="button" class="btn" data-act="closeModal">やめる（浸けておく）</button></div></div>`);
}

function haulConfirm(then) {
  modal(null);
  const v = app.voyage;
  if (!v) return;
  const r = then === 'port' ? returnToPort(v) : haulLongline(v);
  if (r && !r.ok && r.reason) toast(r.reason);
  updateHudStatic();
}

/** Methods whose gear is on board, in the order T cycles through them. */
function availableMethods(v) {
  return ['handline', 'negyo', 'oyogase', ...(v.equip.lights ? ['ika'] : []), ...(v.equip.troll ? ['troll'] : []), ...(v.equip.longline ? ['longline'] : [])];
}

/** Click on the big chart while trolling / longline is selected: add a route point there. */
function onChartClick(ev) {
  const v = app.voyage;
  if (!v || app.screen !== 'sea') return;
  if (!app.chartBig) {
    toggle('chart');
    return;
  }
  if (isLonglining(v)) {
    toast(v.op.kind === 'set' ? '投縄中です' : '揚げ縄中です');
    return;
  }
  const c = $('chart');
  const rect = c.getBoundingClientRect();
  const w = chartToWorld(c, v, true, ev.clientX - rect.left, ev.clientY - rect.top);
  const r = addRoutePoint(v, w);
  const what = isTrolling(v) ? '（曳縄の航路を変更）' : v.method === 'troll' ? '（曳縄の航路。G で移動だけもできる）' : v.method === 'longline' && !lineInWater(v) ? '（縄を張る向き。G で移動だけもできる）' : '（G でこの航路に沿って移動）';
  toast(r.ok ? `経由点${v.plannedRoute.length}を追加${what}` : r.reason);
}

function toggle(name) {
  if (name === 'sounder') {
    app.sounderOpen = !app.sounderOpen;
  } else if (name === 'sideview') {
    app.sideOpen = !app.sideOpen;
  } else if (name === 'sonar') {
    app.sonarOpen = !app.sonarOpen;
  } else if (name === 'sonarRange') {
    if (app.voyage && app.voyage.sonar) toast(`ソナーの距離 ${cycleSonarRange(app.voyage)}m`);
  } else if (name === 'chart') {
    app.chartBig = !app.chartBig;
  } else if (name === 'view') {
    app.view = { helm: 'deck', deck: 'walk', walk: 'helm' }[app.view] || 'helm';
    for (const k of ['wf', 'wb', 'wl', 'wr']) held[k] = false;
    toast({ helm: '操船視点', deck: '作業視点', walk: '甲板を歩く（W/S 前後・A/D 向き、持ち場ボタンで移動）' }[app.view]);
  } else if (name === 'pause') {
    app.paused = !app.paused;
  } else if (name === 'speed') {
    app.speedIdx = (app.speedIdx + 1) % TIME.USER_MULT.length;
  }
  updateHudStatic();
}

// ---------------------------------------------------------------- input
const held = { left: false, right: false, wf: false, wb: false, wl: false, wr: false };
let lastRudderInput = 0;
document.addEventListener('keydown', (e) => {
  if (e.target && (e.target.id === 'markName' || e.target.id === 'markMemo') && e.key === 'Enter') {
    const save = document.querySelector('[data-act=markSave]');
    if (save) save.click();
    return;
  }
  if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
  if (!$('modal').hidden) {
    if (e.key === 'Escape') modal(null);
    return;
  }
  if (app.screen !== 'sea') return;
  const k = e.key.toLowerCase();
  const walkKey = { w: 'wf', arrowup: 'wf', s: 'wb', arrowdown: 'wb', a: 'wl', arrowleft: 'wl', d: 'wr', arrowright: 'wr' }[k];
  if (app.view === 'walk' && walkKey) {
    held[walkKey] = true;
    if (!e.repeat) walkBusyNote();
    e.preventDefault();
    return;
  }
  if (k === 'a' || e.key === 'ArrowLeft') held.left = true;
  else if (k === 'd' || e.key === 'ArrowRight') held.right = true;
  if (e.repeat) {
    if (['arrowup', 'arrowdown', ' '].includes(k)) e.preventDefault();
    return;
  }
  switch (k) {
    case 'w':
    case 'arrowup':
      cmd('throttleUp');
      break;
    case 's':
    case 'arrowdown':
      cmd('throttleDown');
      break;
    case ' ':
      cmd('op');
      break;
    case 'r':
      cmd('redrift');
      break;
    case 'h':
      cmd('port');
      break;
    case 'm':
      cmd('mark');
      break;
    case 't':
      cmd('method');
      break;
    case 'x':
      cmd('clearRoute');
      break;
    case 'l':
      cmd('haul');
      break;
    case 'o':
      if (app.voyage && app.voyage.sonar) toggle('sonar');
      break;
    case 'k':
      marksModal();
      break;
    case 'g':
      cmd('route');
      break;
    case 'f':
      toggle('sounder');
      break;
    case 'c':
      toggle('chart');
      break;
    case 'v':
      toggle('view');
      break;
    case 'p':
    case 'escape':
      toggle('pause');
      break;
    case '1':
    case '2':
    case '3':
      app.speedIdx = Number(k) - 1;
      updateHudStatic();
      break;
    default:
      return;
  }
  e.preventDefault();
});
document.addEventListener('keyup', (e) => {
  const k = e.key.toLowerCase();
  const walkKey = { w: 'wf', arrowup: 'wf', s: 'wb', arrowdown: 'wb', a: 'wl', arrowleft: 'wl', d: 'wr', arrowright: 'wr' }[k];
  if (walkKey) held[walkKey] = false;
  if (k === 'a' || e.key === 'ArrowLeft') held.left = false;
  else if (k === 'd' || e.key === 'ArrowRight') held.right = false;
});
window.addEventListener('blur', () => {
  for (const key of Object.keys(held)) held[key] = false;
});

/** While an operation runs the fisher stays at his work; walking is for the free moments. */
let walkNoteAt = 0;
function walkBusyNote() {
  const v = app.voyage;
  if (!v || !isOperating(v) || performance.now() - walkNoteAt < 4000) return;
  walkNoteAt = performance.now();
  toast('作業中は持ち場で作業しています（甲板を歩けるのは操業していないとき）');
}

function walkTo(name) {
  const v = app.voyage;
  if (!v || !scene) return;
  if (isOperating(v)) {
    walkNoteAt = 0;
    walkBusyNote();
    return;
  }
  if (app.view !== 'walk') {
    app.view = 'walk';
    updateHudStatic();
  }
  scene.walkTo(name);
}

document.addEventListener('pointerdown', (e) => {
  const b = e.target.closest('[data-hold]');
  if (!b) return;
  held[b.dataset.hold] = true;
  if (b.dataset.hold.startsWith('w')) walkBusyNote();
  try {
    b.setPointerCapture?.(e.pointerId); // keep receiving pointerup even if the finger slides off
  } catch {
    /* not capturable (synthetic event) — release still works via pointerup/cancel */
  }
  e.preventDefault();
});
const releaseHold = (e) => {
  const b = e.target.closest && e.target.closest('[data-hold]');
  if (b) held[b.dataset.hold] = false;
};
document.addEventListener('pointerup', releaseHold);
// long-press on a control must not open the phone's text/context menu
document.addEventListener('contextmenu', (e) => {
  if (e.target.closest && e.target.closest('.ctl, #view3d, #chart')) e.preventDefault();
});
document.addEventListener('pointercancel', releaseHold);

$('chart').addEventListener('click', onChartClick);
// tap the sounder picture: a mark where that column was taken (the boat has moved on since)
$('sounder').addEventListener('click', (ev) => {
  const v = app.voyage;
  if (!v || app.screen !== 'sea') return;
  const r = $('sounder').getBoundingClientRect();
  const h = sounderView.hit(v.obs, ev.clientX - r.left, ev.clientY - r.top);
  if (!h) return;
  const echo = h.depth < h.col.bottom - 0.3 ? h.depth : null;
  addMarkAt(v, h.col.x, h.col.y, 'sounder', { echo, bottom: h.col.bottom });
  const back = Math.round(Math.hypot(v.boat.x - h.col.x, v.boat.y - h.col.y));
  toast(echo != null ? `魚探の反応（${Math.round(echo)}m）の位置に印・${back}m後ろ` : `魚探のその位置に印・${back}m後ろ`);
});
// tap the side view: a mark on that echo to port or starboard
$('sideview').addEventListener('click', (ev) => {
  const v = app.voyage;
  if (!v || app.screen !== 'sea' || !v.equip.sounder.side) return;
  const r = $('sideview').getBoundingClientRect();
  const h = sideViewHit($('sideview'), v.obs.side, ev.clientX - r.left, ev.clientY - r.top, v.equip.sounder.side.range);
  if (!h) return;
  const p = sideToWorld(h.row, h.offset);
  addMarkAt(v, p.x, p.y, 'side');
  toast(`${h.offset < 0 ? '左舷' : '右舷'}${Math.round(Math.abs(h.offset))}mの反応に印`);
});
// tap the sonar picture: a mark at that echo
$('sonar').addEventListener('click', (ev) => {
  const v = app.voyage;
  if (!v || !v.sonar || app.screen !== 'sea') return;
  const r = $('sonar').getBoundingClientRect();
  const hit = sonarTap($('sonar'), v.sonar, ev.clientX - r.left, ev.clientY - r.top);
  if (!hit) return;
  const p = sonarToWorld(v.boat, hit.rel, hit.dist);
  addMarkAt(v, p.x, p.y, 'sonar');
  toast(`ソナーの反応に印（${Math.round(hit.dist)}m先）`);
});
document.addEventListener('change', (e) => {
  if (e.target && e.target.id === 'hireCrew') {
    app.hireCrew = e.target.checked;
    return;
  }
  if (e.target && e.target.id === 'nightTrip') {
    app.nightTrip = e.target.checked;
    show('port');
    return;
  }
  const sel = e.target.closest && e.target.closest('[data-filter]');
  if (!sel || app.screen !== 'log') return;
  app.logFilter = { ...(app.logFilter || { method: '', area: '' }), [sel.dataset.filter]: sel.value };
  show('log');
});

document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-act]');
  if (!b || b.disabled) return;
  const act = b.dataset.act;
  switch (act) {
    case 'newGame':
      newGame();
      break;
    case 'newGameConfirm':
      modal(`<div class="card"><h2>新しく始める</h2><p>新しい進行で始めます。読めなかった元のデータは削除せず残します。</p><div class="actions"><button type="button" class="btn warn" data-act="newGameForce">新しく始める</button><button type="button" class="btn" data-act="closeModal">やめる</button></div></div>`);
      break;
    case 'newGameForce':
      modal(null);
      preserveRawMain();
      newGame();
      break;
    case 'depart':
      depart();
      break;
    case 'restDay': {
      if (!app.profile || app.profile.activeVoyage) break;
      commit(restDay(app.profile), '時化で休んだ');
      app.notice = `${app.profile.day}日目は時化で港で休みました。`;
      show('port');
      toast('港で休みました（翌朝）');
      break;
    }
    case 'departPlan':
      depart(b.dataset.key);
      break;
    case 'toPort':
      app.notice = '';
      show('port');
      break;
    case 'toTitle':
      show(app.loadResult && app.loadResult.status !== 'none' && app.loadResult.status !== 'ok' ? 'saveProblem' : 'title');
      break;
    case 'equip':
      modal(null);
      show('equip');
      break;
    case 'log':
      show('log');
      break;
    case 'openSave':
      show('save');
      break;
    case 'export':
      exportCurrent();
      break;
    case 'copySave':
      copySave();
      break;
    case 'importPaste':
      importText($('pasteArea') ? $('pasteArea').value : '');
      break;
    case 'exportQuarantine': {
      const key = app.loadResult && app.loadResult.quarantineKey;
      const raw = key ? store.getItem(key) : null;
      if (raw) download('ryoshi-save-unreadable.json', raw);
      break;
    }
    case 'importConfirm':
      importConfirm();
      break;
    case 'buy':
      buy(b.dataset.item, b.dataset.slot);
      break;
    case 'buyConfirm':
      buyConfirm(b.dataset.item, b.dataset.slot);
      break;
    case 'equipStored':
      equipStored(b.dataset.uid, b.dataset.slot);
      break;
    case 'unmount':
      unmount(b.dataset.slot);
      break;
    case 'sell':
      sell(b.dataset.uid);
      break;
    case 'sellConfirm':
      sellConfirm(b.dataset.uid);
      break;
    case 'market':
      modal(null);
      show('market');
      break;
    case 'playtestLoad':
      playtestLoad();
      break;
    case 'playtestLoadConfirm':
      playtestLoadConfirm();
      break;
    case 'playtestRestore':
      playtestRestore();
      break;
    case 'playtestRestoreConfirm':
      playtestRestoreConfirm();
      break;
    case 'boatQuote':
      boatQuote(b.dataset.offer);
      break;
    case 'buyBoatConfirm':
      buyBoatConfirm(b.dataset.offer);
      break;
    case 'retrySave':
      if (app.profile) commit(app.profile, '再試行');
      show(app.screen);
      break;
    case 'help':
      modal(S.helpModal());
      break;
    case 'closeModal':
      modal(null);
      break;
    case 'walkTo':
      walkTo(b.dataset.station);
      break;
    case 'haulConfirm':
      haulConfirm(b.dataset.then);
      break;
    case 'marks':
      marksModal();
      break;
    case 'markEdit':
    case 'markSave':
    case 'markDel':
    case 'markDelYes':
    case 'markGo':
    case 'markShow':
      markAction(act, b.dataset.key);
      break;
    case 'sounder':
    case 'sonar':
    case 'sonarRange':
    case 'sideview':
    case 'chart':
    case 'view':
    case 'pause':
    case 'speed':
      toggle(act);
      break;
    default:
      cmd(act);
  }
});

/** Before starting over on top of a save that couldn't be read, keep a copy. */
function readKey(key) {
  try {
    return store.getItem(key);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- playtest save
function playtestLoad() {
  const own = app.profile && !app.inPlaytest;
  modal(`<div class="card"><h2>試遊用セーブで遊ぶ</h2><p>資金300,000Gの試遊用の進行（小型和船・曳縄具付き、M1まで遊んだ状態）に切り替えます。</p>
  ${own ? '<p class="note">今の自分の進行は別に残します。「船の買い替え」や「セーブ管理」の「自分の進行に戻す」でいつでも戻せます。</p>' : ''}
  <div class="actions"><button type="button" class="btn primary" data-act="playtestLoadConfirm">切り替える</button><button type="button" class="btn" data-act="closeModal">やめる</button></div></div>`);
}

function playtestLoadConfirm() {
  modal(null);
  const res = checkImport(PLAYTEST_SAVE);
  if (!res.ok) {
    toast(`試遊用セーブを読めませんでした：${res.error}`);
    return;
  }
  // keep the player's own progress aside (once: a second load keeps the original)
  const raw = readKey(KEYS.main);
  if (raw != null && readKey(KEYS.beforePlaytest) == null) {
    try {
      store.setItem(KEYS.beforePlaytest, raw);
    } catch {
      toast('今の進行を残せなかったため、切り替えを中止しました');
      return;
    }
    if (readKey(KEYS.beforePlaytest) !== raw) {
      toast('今の進行を残せなかったため、切り替えを中止しました');
      return;
    }
  }
  commit(resolveInterruptedVoyage(res.profile).profile, '試遊用セーブに切り替え');
  app.notice = '試遊用セーブ（資金300,000G）に切り替えました。港の「船の買い替え」から試せます。';
  show('market');
  toast('試遊用セーブ（資金300,000G）に切り替えました');
}

function playtestRestore() {
  modal(`<div class="card"><h2>自分の進行に戻す</h2><p>試遊用セーブに切り替える前の、自分の進行に戻します。試遊用セーブで進めた分はなくなります。</p>
  <div class="actions"><button type="button" class="btn primary" data-act="playtestRestoreConfirm">戻す</button><button type="button" class="btn" data-act="closeModal">やめる</button></div></div>`);
}

function playtestRestoreConfirm() {
  modal(null);
  const raw = readKey(KEYS.beforePlaytest);
  const res = checkImport(raw);
  if (!res.ok) {
    toast(`残しておいた進行を読めませんでした：${res.error}（データはそのまま残しています）`);
    return;
  }
  const w = commit(resolveInterruptedVoyage(res.profile).profile, '自分の進行に戻す');
  // the kept copy is cleared only once it is safely back in the main save
  if (w.ok && !storageUnavailable) {
    try {
      store.removeItem(KEYS.beforePlaytest);
    } catch {
      /* keep it */
    }
  }
  app.notice = '自分の進行に戻しました。';
  show('port');
}

function preserveRawMain() {
  try {
    const raw = store.getItem(KEYS.main);
    if (raw != null) store.setItem(`${KEYS.quarantinePrefix}${Date.now()}`, raw);
  } catch {
    /* ignore */
  }
}

// ---------------------------------------------------------------- HUD
const staticMap = buildStaticMap();
const sounderView = createSounderView($('sounder'));
let snapCamera = true;

function chip(k, v, cls = '') {
  return `<span class="chip ${cls}"><span class="k">${k}</span><b>${v}</b></span>`;
}

function updateHudStatic() {
  const v = app.voyage;
  if (!v || app.screen !== 'sea') return;
  const model = BOATS[v.modelId];
  $('throttleLabel').textContent = model.throttleNames[v.boat.throttle];
  const op = $('btnOp');
  if (isLonglining(v)) {
    op.innerHTML = v.op.kind === 'set' ? '投縄中…' : '揚げ縄中…';
    op.disabled = true;
  } else if (isOperating(v)) {
    op.innerHTML = v.op.state === 'stopping' ? '回収中…' : '回収・終了<kbd>Space</kbd>';
    op.disabled = v.op.state === 'stopping';
  } else if (v.method === 'longline') {
    op.innerHTML = lineInWater(v) ? '揚げ縄<kbd>Space</kbd>' : '投縄開始<kbd>Space</kbd>';
    op.disabled = false;
  } else {
    op.innerHTML = '操業開始<kbd>Space</kbd>';
    op.disabled = false;
  }
  const troll = v.method === 'troll' || isTrolling(v);
  const ll = v.method === 'longline' || isLonglining(v);
  $('btnRedrift').disabled = troll || ll || !(isOperating(v) || v.logs.length);
  $('btnMethod').innerHTML = `${METHODS[isOperating(v) ? v.op.methodId : v.method].name}<kbd>T</kbd>`;
  $('btnMethod').disabled = isOperating(v) || availableMethods(v).length < 2;
  $('btnClearRoute').hidden = !(troll || (ll && !lineInWater(v)) || v.plannedRoute.length);
  const routing = !!(v.autopilot && v.autopilot.kind === 'route');
  $('btnRoute').hidden = !(v.plannedRoute.length || routing) || isTrolling(v) || isLonglining(v);
  $('btnRoute').innerHTML = routing ? '航路で移動中…' : '航路で移動<kbd>G</kbd>';
  $('btnRoute').disabled = routing;
  const soaking = !!(v.line && v.line.state === 'soaking');
  $('btnHaul').hidden = !soaking || (v.method === 'longline' && !isOperating(v));
  $('btnHaul').innerHTML = v.autopilot && v.autopilot.kind === 'haul' ? 'ブイへ移動中…' : '揚げ縄<kbd>L</kbd>';
  const walkView = app.view === 'walk';
  $('helmGroup').hidden = walkView;
  $('walkPad').hidden = !walkView;
  $('walkBar').hidden = !walkView;
  if (walkView && scene && !$('walkBar').childElementCount) {
    $('walkBar').innerHTML = scene.stationNames().map((st) => `<button type="button" class="mini" data-act="walkTo" data-station="${S.esc(st.name)}">${S.esc(st.label)}</button>`).join('');
  }
  const bp = $('btnPort');
  bp.innerHTML = v.autopilot && v.autopilot.kind === 'return' ? '帰港中…' : `${nearPort(v) ? '入港' : '帰港'}<kbd>H</kbd>`;
  $('btnSpeed').textContent = `早送り×${TIME.USER_MULT[app.speedIdx]}`;
  $('btnPause').textContent = app.paused ? '再開' : '停止';
  $('btnPause').classList.toggle('active', app.paused);
  $('btnView').textContent = { deck: '作業視点', walk: '甲板を歩く', helm: '操船視点' }[app.view];
  $('sounderPanel').hidden = !app.sounderOpen;
  $('sounderOpen').hidden = app.sounderOpen;
  $('chartPanel').classList.toggle('big', app.chartBig);
  $('chartToggle').textContent = app.chartBig ? '閉じる' : '拡大';
  $('sounderTitle').textContent = EQUIPMENT[v.equip.sounderId].name;
  $('btnSonar').hidden = !v.sonar;
  $('sonarPanel').hidden = !(v.sonar && app.sonarOpen);
  if (v.sonar) $('sonarRange').textContent = `${v.sonar.range}m`;
  const sideCap = !!v.equip.sounder.side;
  $('sideToggle').hidden = !sideCap;
  $('sideToggle').textContent = app.sideOpen ? '真下' : '左右';
  $('sideview').hidden = !(sideCap && app.sideOpen);
  $('sounder').hidden = sideCap && app.sideOpen;
}

/**
 * Place the HUD for the device and situation. While operating ("op-mode") the
 * sounder grows and the operation panel gets the free space; on phones the
 * chart is tucked away behind a button. The operation panel is fitted into
 * the free band so it never covers the controls.
 */
function hudMode() {
  const W = window.innerWidth;
  const H = window.innerHeight;
  const land = H <= 520 && W > H;
  const port = !land && W <= 900 && H >= W;
  const opMode = !!(app.voyage && isOperating(app.voyage));
  // the chart stays on screen while operating too (it shares the top row with the sounder)
  return { land, port, opMode, tuck: false };
}

function layoutHud() {
  const hud = $('hud');
  const op = $('opPanel');
  const msgs = $('msgs');
  const top = $('hudTop');
  const { land, port, opMode, tuck } = hudMode();
  // on phones the sonar takes the chart's place while it is open
  const sonarUp = !!(app.voyage && app.voyage.sonar && app.sonarOpen);
  hud.classList.toggle('op-mode', opMode);
  hud.classList.toggle('phone-land', land);
  hud.classList.toggle('phone-port', port);
  $('chartPanel').hidden = tuck || (sonarUp && (land || port) && !app.chartBig);
  for (const el of [op, msgs, top]) el.style.top = el.style.bottom = el.style.maxHeight = el.style.left = el.style.width = '';
  const appR = $('app').getBoundingClientRect();
  const ctl = $('controls').getBoundingClientRect();
  const rel = (y) => y - appR.top;
  const aboveControls = appR.bottom - ctl.top + 6;
  $('walkBar').style.bottom = `${aboveControls}px`;
  const snd = ($('sounderPanel').hidden ? $('sounderOpen') : $('sounderPanel')).getBoundingClientRect();
  if (!land && !port) {
    if (opMode || !op.hidden) {
      op.style.top = `${rel(snd.bottom) + 8}px`;
      op.style.maxHeight = `${Math.max(80, ctl.top - snd.bottom - 20)}px`;
    }
    return;
  }
  const wb = $('walkBar');
  const walkH = wb.hidden ? 0 : wb.getBoundingClientRect().height + 6;
  msgs.style.bottom = `${aboveControls + walkH}px`;
  if (land) {
    if (opMode) {
      // operation panel: the whole left column; messages next to it
      op.style.top = '4px';
      op.style.bottom = `${aboveControls}px`;
      op.style.maxHeight = 'none';
      const left = op.getBoundingClientRect().right - appR.left + 8;
      msgs.style.left = `${left}px`;
      msgs.style.width = `${Math.max(120, snd.left - appR.left - left - 8)}px`;
    } else {
      op.style.top = 'auto';
      op.style.bottom = `${aboveControls}px`;
      op.style.maxHeight = `${Math.max(50, ctl.top - snd.bottom - 12)}px`;
    }
    return;
  }
  // portrait phone: chips under the chart and sounder (op-mode) or under the panels
  if (opMode) top.style.top = `${rel(Math.max(snd.bottom, $('chartPanel').getBoundingClientRect().bottom)) + 6}px`;
  const tb = top.getBoundingClientRect();
  const msgTop = msgs.childElementCount ? msgs.getBoundingClientRect().top : ctl.top;
  op.style.bottom = 'auto';
  op.style.top = `${rel(tb.bottom) + 6}px`;
  op.style.maxHeight = `${Math.max(60, msgTop - tb.bottom - 12)}px`;
}

const STEPS = {
  handline: [['prep', '準備'], ['drop', '投入'], ['fish', '誘い'], ['retrieve', '回収'], ['unhook', '取込']],
  negyo: [['prep', '準備'], ['drop', '投入'], ['fish', '底を切る'], ['retrieve', '巻上げ'], ['unhook', '取込']],
  ika: [['prep', '準備'], ['drop', '投入'], ['fish', 'シャクリ'], ['retrieve', '巻上げ'], ['unhook', '取込']],
  oyogase: [['prep', 'エサ付け'], ['drop', '投入'], ['fish', '泳がせ'], ['fight', 'やり取り'], ['retrieve', '巻上げ'], ['unhook', '取込']],
  troll: [['deploy', '出す'], ['tow', '曳く'], ['fight', '掛かり'], ['haul', '手繰り'], ['unhook', '取込']],
  longline: [['set', '投縄'], ['soak', '浸け'], ['haul', '揚げ'], ['unhook', '取込']],
};

/** One row per rig: which step of the cycle it is in, and a short detail. */
function stepRow(methodId, line, label, detail) {
  const phase = line.phase === 'adjust' ? 'fish' : line.phase;
  const steps = STEPS[methodId];
  const at = steps.findIndex(([id]) => id === phase);
  const lis = steps.map(([, name], i) => `<li class="${i < at ? 'done' : i === at ? 'on' : ''}">${name}</li>`).join('');
  return `<div class="op-rig"><span class="rig">${S.esc(label)}</span><ol class="steps">${lis}</ol><div class="rig-detail">${S.esc(detail)}</div></div>`;
}

function bigNums(items) {
  return `<div class="op-big">${items.map(([k, val, unit, sub]) => `<div><span class="k">${k}</span><b>${val}<small>${unit}</small></b>${sub ? `<span class="s">${sub}</span>` : ''}</div>`).join('')}</div>`;
}

let hudAt = 0;
function updateHud(now) {
  const v = app.voyage;
  if (now - hudAt < 100) return;
  hudAt = now;
  updateHudStatic();
  const b = v.boat;
  const sog = Math.hypot(b.vx, b.vy);
  const hdg = Math.round(((b.heading * 180) / Math.PI + 360) % 360);
  const last = v.obs.cols[v.obs.cols.length - 1];
  const sit = v.autopilot ? 'auto' : isOperating(v) ? 'operate' : 'sail';
  const scale = TIME.SCALE[sit] * TIME.USER_MULT[app.speedIdx];
  const late = v.world.time >= (v.warnT || TIME.WARN);
  const opMode = isOperating(v);
  let html = chip(`${v.day}日目`, fmtClock(v.world.time), late ? 'warn' : '');
  // heading: an arrow that turns with the bow (north up, like the chart)
  html += chip('船首', `<svg class="hdg-arrow" viewBox="0 0 10 10" style="transform:rotate(${hdg}deg)" aria-hidden="true"><path d="M5 0.5 L9 9.5 L5 7 L1 9.5 Z"/></svg>${String(hdg).padStart(3, '0')}° ${compass8(Math.sin(b.heading), Math.cos(b.heading))}`, 'hdg');
  if (!opMode) html += chip('対地', `${(sog * 1.944).toFixed(1)}kt ${sog > 0.05 ? compass8(b.vx, b.vy) : ''}`);
  html += chip('水深', last ? `${last.bottom.toFixed(1)}m` : '--');
  html += chip('場所', S.esc(areaNameAt(b.x, b.y)));
  if (!opMode) {
    html += chip('漁法', METHODS[v.method].name);
    html += chip('魚倉', `${v.hold.kg.toFixed(1)}/${v.capacityKg}kg`, v.hold.kg > v.capacityKg * 0.9 ? 'warn' : '');
  }
  if (v.crew) html += chip('手', `2人（${CREW.label}）`);
  const vis = visibilityAt(v.world.cond, v.world.time);
  if (vis < 1500) html += chip('霧', `視界 約${Math.round(vis / 50) * 50}m`, 'warn');
  else if (v.world.cond.weather && v.world.cond.weather.rough) html += chip('海況', `やや時化（風${v.world.cond.windSpeed.toFixed(0)}m/s）`, 'warn');
  html += chip('時間', `×${scale}${app.paused ? ' 停止中' : ''}`, app.paused ? 'warn' : '');
  if (hudMode().tuck) html += '<button type="button" class="chip chip-btn" data-act="chart">海図を見る</button>';
  if (b.grounded) html += chip('注意', '浅瀬・陸', 'warn');
  if (b.outOfBounds) html += chip('注意', '漁場の外', 'warn');
  if (b.atRangeLimit) html += chip('注意', '航行区域の境（この船はここまで）', 'warn');
  if (DEV) html += chip('DEV', `${Math.round(b.x)},${Math.round(b.y)}`, 'warn');
  $('hudTop').innerHTML = html;

  // operation panel
  const panel = $('opPanel');
  const clock = (secs) => `${Math.floor(secs / 60)}:${String(Math.floor(secs % 60)).padStart(2, '0')}`;
  const holdNum = [`魚倉`, v.hold.kg.toFixed(0), `/${v.capacityKg}kg`, v.hold.kg > v.capacityKg * 0.9 ? '満杯が近い' : ''];
  const lineNote = v.line && v.line.state === 'soaking' ? lineSoakNote(v) : '';
  if (isLonglining(v)) {
    const op = v.op;
    const line = v.line;
    const phase = op.kind === 'set' ? 'set' : op.phase === 'unhook' ? 'unhook' : 'haul';
    const detail = longlineLabel(line, op, v.world.time);
    const soakMin = line.setEndT != null ? Math.round(((line.haulStartT || v.world.time) - line.setEndT) / 60) : 0;
    panel.hidden = false;
    panel.innerHTML = `<div class="op-head"><span>延縄 <b>Lv${op.level}</b></span><span class="op-clock">${clock(v.world.time - op.startT)}</span></div>
      ${stepRow('longline', { phase }, op.kind === 'set' ? '船尾' : '揚げ縄機', detail)}
      ${op.kind === 'set'
        ? bigNums([['張った針', line.hooks.length, `/${line.gear.hooks}本`, ''], ['速さ', (Math.abs(b.speed) * 1.944).toFixed(1), 'kt', ''], holdNum])
        : bigNums([['この縄', op.landedCount, '枚', `${op.landedKg.toFixed(1)}kg`], ['浸け', soakMin, '分', `${op.pos}/${line.gear.hooks}本揚げた`], holdNum])}
      <div class="op-note">${op.kind === 'haul' ? (op.machine ? `揚げ縄機で巻き上げています（毎秒${op.skill.haul.toFixed(1)}m）。` : `手で揚げています（毎秒${op.skill.haul.toFixed(2)}m）。`) : ''}${op.kind === 'set' ? '決めた向きに沿って、餌を付けた針を6m間隔で海底に張っています。' : v.crew ? `縄に沿って進みながら揚げています。掛かったマダイは${CREW.label}が外し、その間も揚げ続けます（${CREW.label}が手一杯のときは自分で外します）。` : '縄に沿って進みながら揚げています。掛かっていたマダイは1枚ずつ取り込みます。'}</div>
      <div class="feed">${S.esc(app.lastFeed)}</div>`;
  } else if (isTrolling(v)) {
    const op = v.op;
    const pace = recentPace(op, v.world.time, 1800);
    panel.hidden = false;
    panel.innerHTML = `<div class="op-head"><span>曳縄 <b>Lv${op.level}</b></span><span class="op-clock">${clock(v.world.time - op.startT)}</span></div>
      ${op.lines.map((l, i) => stepRow('troll', l, l.label || (l.side < 0 ? '左舷' : '右舷') + (op.lines.length > 2 ? `${Math.floor(i / 2) + 1}` : ''), trollLineLabel(l).replace(/^[^：]*：/, ''))).join('')}
      ${bigNums([['この曳縄', op.landedCount, '本', `${op.landedKg.toFixed(1)}kg`], ['直近30分', pace.n, '本', ''], holdNum])}
      <div class="op-note">航路：経由点${op.route.points.length - 1}・${op.route.dir > 0 ? '往路' : '復路'}${op.route.changes ? `（変更${op.route.changes}回）` : ''}・${(Math.abs(b.speed) * 1.944).toFixed(1)}kt</div>${lineNote}
      <div class="feed">${S.esc(app.lastFeed)}</div>`;
  } else if (isOperating(v)) {
    const op = v.op;
    const pace = recentPace(op, v.world.time);
    const line = op.lines[0];
    panel.hidden = false;
    const neg = op.methodId === 'negyo';
    const oyo = op.methodId === 'oyogase';
    const ika = op.methodId === 'ika';
    const under = ika ? v.world.schools.filter((s) => s.light && s.opId === op.id).reduce((a, s) => a + s.counts.s + s.counts.m + s.counts.l, 0) : 0;
    const drifting = sog > 0.03 ? `${compass8(b.vx, b.vy)}へ${(sog * 1.944).toFixed(1)}ktで流れている` : 'ほぼ流れていない';
    const bySp = Object.entries(op.landedBy || {}).map(([sp, c]) => `${SPECIES[sp].name}${c.s + c.m + c.l}`).join('・');
    const note = ika
      ? `集魚灯 点灯中・タナ ${line.tana != null ? `${line.tana.toFixed(0)}m（${line.tanaSource === 'echo' ? '魚探の反応に合わせる' : '中層'}）` : '—'}・船の下に寄ったイカ 約${under}杯（寄せた合計${op.stats.gathered || 0}）${bySp ? `・${bySp}` : ''}・${drifting}`
      : oyo
      ? `タナ ${line.tana != null ? `${line.tana.toFixed(0)}m（${line.tanaSource === 'echo' ? '魚探の反応に合わせる' : '反応がないので中層'}）` : '—'}・活きアジ残り${baitInHold(v, 'aji')}尾・エサ交換${op.stats.baitSwaps}回${bySp ? `・${bySp}` : ''}・${drifting}`
      : neg
      ? `底から${METHODS.negyo.bottomLift}m（底を切る）・水深${line.tana != null ? line.tana.toFixed(0) : '—'}m${op.stats.snags ? `・根掛かり${op.stats.snags}回` : ''}${bySp ? `・${bySp}` : ''}・${drifting}`
      : `タナ ${line.tana != null ? `${line.tana.toFixed(0)}m（${line.tanaSource === 'echo' ? '魚探の反応に合わせる' : '底から少し上'}）` : '—'}・${drifting}`;
    panel.innerHTML = `<div class="op-head"><span>${METHODS[op.methodId].name} <b>Lv${op.level}</b></span><span class="op-clock">${clock(v.world.time - op.startT)}</span></div>
      ${op.lines.map((l, i) => stepRow(ika ? 'ika' : oyo ? 'oyogase' : neg ? 'negyo' : 'handline', l, l.label || (i === 0 ? '右舷' : '左舷'), linePhaseLabel(l))).join('')}
      ${bigNums([['この流し', op.landedCount, SPECIES[op.species].unit, `${op.landedKg.toFixed(1)}kg`], ['直近10分', pace.perMin.toFixed(1), `${SPECIES[op.species].unit}/分`, `${pace.n}${SPECIES[op.species].unit}`], holdNum])}
      <div class="op-note">${note}</div>${lineNote}
      <div class="feed">${S.esc(app.lastFeed)}</div>`;
  } else if (v.method === 'longline' && !lineInWater(v)) {
    const rt = lineRouteFrom(v);
    panel.hidden = false;
    panel.innerHTML = `<h3>延縄の準備（針${v.equip.longline.hooks}本・約${(v.equip.longline.hooks - 1) * v.equip.longline.spacing}m）</h3>
      <div class="row"><span>張る向き</span><span>${rt.ok ? (rt.planned ? `経由点${v.plannedRoute.length}（海図で指定）` : '今の向きにまっすぐ') : '張れない'}</span></div>
      <div class="row"><span>水深</span><span>${(v.obs.cols.length ? v.obs.cols[v.obs.cols.length - 1].bottom : 0).toFixed(0)}m（${METHODS.longline.minDepth}m以上に張る）</span></div>
      <div class="feed">${rt.ok ? 'Spaceで投縄開始（張る間は自動で進みます）。海図（C）で向きを指定できます' : S.esc(rt.reason)}</div>`;
  } else if (lineNote && !v.logs.length) {
    panel.hidden = false;
    panel.innerHTML = `<h3>延縄を浸けています</h3>${lineNote}<div class="feed">浸けている間は自由に動けます（他の漁もできます）。</div>`;
  } else if (v.logs.length) {
    const l = v.logs[v.logs.length - 1];
    const u = SPECIES[l.species || 'aji'].unit;
    panel.hidden = false;
    panel.innerHTML = `<h3>前回の${l.methodId === 'longline' ? '縄' : '流し'} #${v.logs.length}</h3>
      <div class="row"><span>${fmtClock(l.startT)}〜 ${S.esc(l.area)}</span><span>${Math.round(l.durationS / 60)}分</span></div>
      <div class="row"><span>漁獲</span><span>${l.count}${u}・${l.kg.toFixed(1)}kg</span></div>
      <div class="row"><span>この航海の合計</span><span>${v.hold.count}匹・${v.hold.kg.toFixed(1)}kg</span></div>${lineNote}
      <div class="feed">${canStartOperation(v).ok ? ({ troll: 'Spaceで曳縄を開始できます', longline: lineInWater(v) ? 'Spaceで揚げ縄' : 'Spaceで投縄できます', negyo: '停船中：Spaceで根魚釣り（根・漁礁の真上で）', oyogase: `停船中：Spaceで泳がせ釣り（活きアジ${baitInHold(v, 'aji')}尾）`, ika: '停船中：Spaceで集魚灯を点けてイカ釣り' }[v.method] || '停船中：Spaceで操業開始できます') : ''}</div>`;
  } else if (v.method === 'troll') {
    const rt = trollRouteFrom(v);
    panel.hidden = false;
    panel.innerHTML = `<h3>曳縄の準備</h3>
      <div class="row"><span>航路</span><span>${rt.ok ? (rt.planned ? `経由点${v.plannedRoute.length}（海図で指定）` : '今の向きで往復（約700m）') : '取れない'}</span></div>
      <div class="feed">${rt.ok ? '海図（C）をクリックで経由点を追加、Spaceで開始' : S.esc(rt.reason)}</div>`;
  } else panel.hidden = true;

  // messages
  const box = $('msgs');
  const recent = v.messages.slice(-4);
  // rebuild only when a new message arrives (rebuilding restarts the fade-in)
  const lastId = recent.length ? recent[recent.length - 1].id : 0;
  if (box.dataset.last !== String(lastId)) {
    box.dataset.last = String(lastId);
    box.innerHTML = recent.map((m) => `<div class="msg ${m.level}"><span class="t">${fmtClock(m.t)}</span>${S.esc(m.text)}</div>`).join('');
  }
  layoutHud();
}

/** One line about the soaking longline (shown whatever else is going on). */
function lineSoakNote(v) {
  const line = v.line;
  const b = nearestBuoy(line, v.boat.x, v.boat.y);
  const bait = Math.round(baitLeft(line, v.world.time) * 100);
  return `<div class="op-note ll-note">延縄：${S.esc(longlineLabel(line, null, v.world.time))}・餌の残り目安${bait}%・ブイまで${Math.round(b.dist)}m（揚げ縄 L）</div>`;
}

function consumeEvents(v) {
  let landed = 0;
  for (const ev of v.events) {
    if (ev.id <= app.seenEvent) continue;
    app.seenEvent = ev.id;
    if (ev.type === 'landed') {
      landed += ev.fish.length;
      const by = {};
      for (const f of ev.fish) {
        const name = SPECIES[f.species].sizes[f.size].label;
        by[name] = (by[name] || 0) + 1;
      }
      app.lastFeed = `${fmtClock(ev.t)} 取り込み：${Object.entries(by).map(([k, n]) => `${k}×${n}`).join('・')}`;
    }
  }
  return landed;
}

// ---------------------------------------------------------------- loop
let bathyAt = 0;
let sonarAt = 0;
let cuesAt = 0;
let cuesNow = [];
let bathyNow = null;
let sideAt = 0;
let lastFrame = performance.now();
let realTime = 0;
function frame(now) {
  const realDt = Math.min(0.1, Math.max(0, (now - lastFrame) / 1000));
  lastFrame = now;
  realTime += realDt;
  const v = app.voyage;
  let newLandings = [];
  if (app.screen === 'sea' && v) {
    // rudder from held keys / buttons
    const rIn = app.view === 'walk' ? 0 : (held.right ? 1 : 0) - (held.left ? 1 : 0);
    if (rIn !== lastRudderInput) {
      if (rIn !== 0 || !v.autopilot) {
        const r = setHelm(v, { rudder: rIn });
        if (!r.ok && rIn !== 0) toast(r.reason);
      }
      lastRudderInput = rIn;
    }
    if (!app.paused && $('modal').hidden) {
      const sit = v.autopilot ? 'auto' : isOperating(v) ? 'operate' : 'sail';
      const scale = TIME.SCALE[sit] * TIME.USER_MULT[app.speedIdx];
      app.carry = advanceVoyage(v, realDt * scale, app.carry, SIM.MAX_STEPS_PER_ADVANCE);
    }
    const n = consumeEvents(v);
    if (n) newLandings = [n];
    // the voyage in progress is saved every few seconds (and when the page is hidden)
    if (v.phase === 'sea' && now - lastVoyageSave > 5000) saveVoyageNow();
    updateHud(now);
    const trollSel = v.method === 'troll' || isTrolling(v);
    const llPlan = v.method === 'longline' && !isOperating(v) && !lineInWater(v);
    let route = null;
    if (isTrolling(v)) route = { points: v.op.route.points, live: true };
    else if (v.method === 'troll') {
      const rt = trollRouteFrom(v);
      if (rt.ok) route = { points: rt.points, live: false };
    } else if (llPlan) {
      const rt = lineRouteFrom(v);
      if (rt.ok) route = { points: rt.points, live: false, color: 'rgba(255,198,92,0.9)' };
    } else if (v.autopilot && v.autopilot.kind === 'route') {
      route = { points: [{ x: v.boat.x, y: v.boat.y }, ...v.autopilot.route.slice(v.autopilot.leg)], live: false, color: 'rgba(255,255,255,0.95)' };
    } else if (v.plannedRoute.length) {
      route = { points: [{ x: v.boat.x, y: v.boat.y }, ...v.plannedRoute], live: false, color: 'rgba(255,255,255,0.85)' };
    }
    let hint = '';
    if (trollSel) hint = app.chartBig ? 'クリックで曳縄の経由点を追加（最大6）・Xで消去' : '曳縄：クリックで海図を拡大して航路を指定';
    else if (llPlan) hint = app.chartBig ? 'クリックで縄を張る向き（経由点）を指定・Xで消去' : '延縄：クリックで海図を拡大して張る向きを指定';
    else if (app.chartBig) hint = v.plannedRoute.length ? 'クリックで経由点を追加・G で航路に沿って移動・X で消去' : 'クリックで行き先（経由点）を置くと、G でそこへ移動できます';
    const reps = chartReports([...app.profile.knowledge.reports, ...v.heard], v.day);
    const showLine = v.line && v.line.state !== 'aboard' ? v.line : null;
    if (now - bathyAt > 1000) {
      bathyAt = now;
      bathyNow = bathyCanvas(ownCells(), v.bathy && v.bathy.cells);
    }
    drawChart($('chart'), staticMap, v, { big: app.chartBig, dev: DEV, reports: reps, route, hint, line: showLine, lineLabel: showLine ? longlineLabel(showLine, v.op, v.world.time) : '', bathy: bathyNow, saved: app.profile.marks, selected: app.markSel });
    if (app.sonarOpen && v.sonar && now - sonarAt > 150) {
      sonarAt = now;
      const marks = [...(app.profile.marks || []), ...v.obs.marks.filter((m) => m.kind !== 'auto')];
      drawSonar($('sonar'), v.sonar, v.boat, marks);
    }
    const sideCap = v.equip.sounder.side;
    if (app.sounderOpen && sideCap && app.sideOpen) {
      if (now - sideAt > 200) {
        sideAt = now;
        drawSideView($('sideview'), v.obs.side, sideCap.range);
      }
    } else if (app.sounderOpen) sounderView.draw(v.obs, { lines: isOperating(v) && v.op.lines ? v.op.lines : null, waterTemp: v.world.cond.waterTemp, readout: !!v.equip.sounder.readout });
    if (v.phase === 'docked') arriveAndSettle();
  }
  if (scene) {
    const atSea = app.screen === 'sea' && v;
    const hl = atSea && isOperating(v) && METHODS[v.op.methodId].drift ? v.op.lines : null;
    const tl = atSea && isTrolling(v) ? v.op.lines : null;
    const slots = app.profile ? app.profile.boat.slots : {};
    const itemAt = (id) => (slots[id] ? slots[id].itemId : null);
    const reels = atSea
      ? { starboard: (v.equip.rigs.find((r) => r.label === '右舷') || {}).reelId || null, port: (v.equip.rigs.find((r) => r.label === '左舷') || {}).reelId || null }
      : { starboard: itemAt('starboard_reel'), port: itemAt('port_reel') };
    const worker = (lines) => lines.find((l, i) => (v.op.worker === i));
    const busy = hl ? worker(hl) : tl ? worker(tl) : null;
    const llOp = atSea && isLonglining(v) ? v.op : null;
    let station = 'helm';
    if (hl) station = (busy || hl[0]).label === '左舷' ? 'port' : 'starboard';
    else if (tl) station = 'stern';
    else if (llOp) station = llOp.kind === 'set' ? 'stern' : 'hauler';
    let working = busy ? ({ haul: 'retrieve', fight: 'retrieve', deploy: 'unhook' }[busy.phase] || busy.phase) : null;
    if (llOp) working = llOp.kind === 'set' ? 'prep' : llOp.phase === 'unhook' ? 'unhook' : 'retrieve';
    // the deckhand: the second pair of hands goes where the second job is
    let crewStation = 'fishbox';
    let crewWorking = false;
    if (atSea && v.crew && isOperating(v)) {
      const second = v.op.busy && v.op.busy.length > 1 ? v.op.busy[1] : null;
      if (hl && second != null) {
        crewStation = hl[second].label === '左舷' ? 'port' : 'starboard';
        crewWorking = true;
      } else if (tl && second != null) {
        crewStation = 'sternPort';
        crewWorking = true;
      } else if (llOp && llOp.kind === 'haul') {
        crewStation = 'haulerAft';
        crewWorking = !!llOp.crewJob;
      } else if (llOp) crewStation = 'sternPort';
    }
    const lineBuoys = atSea && v.line && v.line.state !== 'aboard' ? buoys(v.line).filter((bu, i) => i === 0 || v.line.state !== 'setting') : null;
    const longlineId = atSea ? v.equip.longlineId : Object.values(slots).map((x) => x && x.itemId).find((id) => id && EQUIPMENT[id].type === 'longline') || null;
    const haulerId = atSea ? v.equip.haulerId : Object.values(slots).map((x) => x && x.itemId).find((id) => id && EQUIPMENT[id].type === 'hauler') || null;
    // surface signs (鳥山・ナブラ・潮目) worked out from the sea, refreshed twice a second
    if (atSea && now - cuesAt > 500) {
      cuesAt = now;
      cuesNow = surfaceCues(v.world).filter((c) => Math.hypot(c.x - v.boat.x, c.y - v.boat.y) < 2600);
    }
    scene.render({
      mode: atSea ? 'sea' : 'port',
      cues: atSea ? cuesNow : [],
      visibility: atSea ? visibilityAt(v.world.cond, v.world.time) : 3000,
      lightsOn: !!(atSea && v.equip.lights && isOperating(v) && METHODS[v.op.methodId].lights),
      boat: atSea ? v.boat : { x: PORT.dock.x, y: PORT.dock.y + 20, heading: 0, speed: 0, vx: 0, vy: 0 },
      gameTime: atSea ? v.world.time : app.screen === 'receipt' ? 13 * 3600 : TIME.DEPART + 1800,
      windSpeed: atSea ? v.world.cond.windSpeed : 3,
      boatModel: atSea ? v.modelId : app.profile ? app.profile.boat.model : 'skiff_1',
      reels,
      trollId: atSea ? v.equip.trollId : Object.values(slots).map((x) => x && x.itemId).find((id) => id && EQUIPMENT[id].type === 'troll') || null,
      hlLines: hl ? hl.map((l) => ({ station: l.label === '左舷' ? 'port' : 'starboard', active: ['drop', 'fish', 'adjust', 'retrieve'].includes(l.phase), depth: l.depth })) : null,
      trollLines: tl ? tl.map((l) => ({ active: l.phase === 'tow' || l.phase === 'fight' || (l.phase === 'haul'), offset: l.offset != null ? l.offset : l.side * 3, len: l.phase === 'haul' ? l.haulLeft : 40 })) : null,
      working,
      longlineId,
      haulerId,
      crew: atSea ? v.crew : 0,
      crewStation,
      crewWorking,
      buoys: lineBuoys,
      llMode: llOp ? llOp.kind : null,
      station,
      walkInput: atSea && app.view === 'walk' && !isOperating(v) ? { f: held.wf, b: held.wb, l: held.wl, r: held.wr } : null,
      view: atSea ? app.view : 'helm',
      realTime,
      realDt,
      snapCamera,
      newLandings,
    });
    snapCamera = false;
  }
  requestAnimationFrame(frame);
}

// ---------------------------------------------------------------- boot
async function boot() {
  await initScene();
  const res = loadSave(store);
  app.loadResult = res;
  if (res.status === 'none') {
    show('title');
  } else if (res.status === 'ok' || res.status === 'recovered') {
    app.profile = res.profile;
    app.revision = res.revision;
    app.saveStatus = { ok: true, at: res.savedAt, reason: '読み込み' };
    const notes = [];
    if (res.status === 'recovered') notes.push(`最新のセーブが読めなかったため、1つ前のセーブから復元しました（読めなかったデータは「${res.quarantineKey}」に残しています）。`);
    // a voyage left open: resume it at sea if its snapshot is there and intact
    if (app.profile.activeVoyage) {
      let raw = null;
      try {
        raw = store.getItem(KEYS.voyage);
      } catch {
        raw = null;
      }
      const rv = raw ? restoreVoyage(raw, app.profile.activeVoyage) : { ok: false, reason: '海上の保存データがありません' };
      if (rv.ok) {
        enterSea(rv.voyage);
        toast('海上から再開しました');
        rv.voyage.messages.push({ id: rv.voyage.msgSeq++, t: rv.voyage.world.time, text: '前回の続きから再開しました（海上で保存した時点から）。', level: 'info' });
        $('loading').hidden = true;
        finishBoot();
        return;
      }
      const ir = resolveInterruptedVoyage(app.profile);
      commit(ir.profile, '中断した航海の整理');
      notes.push(`${ir.interrupted.day}日目の航海は再開できなかったため（${rv.reason}）、漁獲・経費・経験は記録されていません。`);
    }
    app.notice = notes.join(' ');
    show('port');
  } else {
    show('saveProblem');
  }
  $('loading').hidden = true;
  finishBoot();
}

function finishBoot() {
  if (DEV) {
    const d = document.createElement('div');
    d.className = 'dev-banner';
    d.textContent = '開発モード：海図に魚群（開発表示）を表示中。通常プレイの情報ではありません。';
    document.body.appendChild(d);
    window.__ryoshi = devApi();
  }
  requestAnimationFrame((t) => {
    lastFrame = t;
    frame(t);
  });
}

/** Dev/test hooks (only with ?dev=1). Reads state; teleport is a test convenience. */
function devApi() {
  return {
    app,
    state() {
      const v = app.voyage;
      return {
        screen: app.screen,
        view: app.view,
        funds: app.profile && app.profile.funds,
        day: app.profile && app.profile.day,
        level: app.profile && levelFromXp(app.profile.methods.handline.xp),
        xp: app.profile && app.profile.methods.handline.xp,
        reel: app.profile && app.profile.boat.slots.starboard_reel.itemId,
        troll: app.profile ? Object.values(app.profile.boat.slots).map((x) => x && x.itemId).find((id) => id && EQUIPMENT[id].type === 'troll') || null : null,
        trollXp: app.profile && app.profile.methods.troll.xp,
        boatModel: app.profile && app.profile.boat.model,
        hireCrew: app.hireCrew,
        boatUid: app.profile && app.profile.boat.uid,
        slots: app.profile && Object.fromEntries(Object.entries(app.profile.boat.slots).map(([k, x]) => [k, x ? `${x.itemId}#${x.uid}` : null])),
        storage: app.profile && app.profile.storage.map((x) => `${x.itemId}#${x.uid}`),
        boatHistory: app.profile && app.profile.boatHistory.length,
        reports: app.profile && app.profile.knowledge.reports.length,
        candidates: (app.candidates || []).map((c) => ({ key: c.key, letter: c.letter, labels: c.labels, feasible: c.feasible.ok })),
        revision: app.revision,
        saveStatus: app.saveStatus,
        voyage: v && {
          id: v.id,
          time: v.world.time,
          boat: { x: v.boat.x, y: v.boat.y, heading: v.boat.heading, speed: v.boat.speed, throttle: v.boat.throttle },
          operating: isOperating(v),
          opState: v.op ? v.op.state : null,
          hold: v.hold,
          logs: v.logs.length,
          autopilot: v.autopilot ? v.autopilot.kind : null,
          method: v.method,
          trolling: isTrolling(v),
          heard: v.heard.length,
          plan: v.plan,
          route: isTrolling(v) ? v.op.route.points : v.plannedRoute,
          phase: v.phase,
          boatModel: v.modelId,
          opLines: v.op && v.op.lines ? v.op.lines.map((l) => ({ label: l.label || (l.side < 0 ? '左舷' : '右舷'), phase: l.phase, waiting: !!l.waiting })) : null,
          line: v.line ? { state: v.line.state, hooks: v.line.hooks.length, buoys: buoys(v.line) } : null,
          worker: v.op ? v.op.worker : null,
          busy: v.op && v.op.busy ? v.op.busy.slice() : null,
          crew: v.crew,
          pings: v.obs.pingCount,
          schools: v.world.schools.map((s) => ({ id: s.id, counts: { ...s.counts } })),
          lastEcho: v.obs.cols.length ? v.obs.cols[v.obs.cols.length - 1].maxFish : 0,
        },
      };
    },
    /** Page coordinates of a world point on the sea chart (tests click the chart like a player). */
    chartPoint(x, y) {
      const c = $('chart');
      const r = c.getBoundingClientRect();
      const p = worldToChart(c, app.voyage, app.chartBig, x, y);
      return { x: r.left + p.px, y: r.top + p.py };
    },
    cues() {
      return app.voyage ? surfaceCues(app.voyage.world) : [];
    },
    schoolCenters() {
      const v = app.voyage;
      if (!v) return [];
      return v.world.schools.map((s) => ({ id: s.id, species: s.species, ...schoolCenter(s, v.world.time), total: s.counts.s + s.counts.m + s.counts.l }));
    },
    speed(i) {
      app.speedIdx = i;
    },
    current() {
      const v = app.voyage;
      return v ? currentAt(v.world.cond, v.world.time) : null;
    },
    /** Fast-forward the same fixed-step simulation (equivalent to waiting). */
    fastForward(gameSeconds) {
      const v = app.voyage;
      if (!v) return;
      let left = gameSeconds;
      while (left > 0 && v.phase !== 'docked') {
        const chunk = Math.min(300, left);
        app.carry = advanceVoyage(v, chunk, app.carry);
        left -= chunk;
      }
    },
  };
}

boot();
