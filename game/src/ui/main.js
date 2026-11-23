// App controller: boot, screens, input, main loop.
import { TIME, BOATS, PORT, EQUIPMENT, METHODS, SIM, SPECIES } from '../core/data.js';
import { createProfile, markDeparture, resolveInterruptedVoyage } from '../core/profile.js';
import { settleVoyage, purchaseEquipment, purchasePreview, equipFromStorage } from '../core/economy.js';
import { loadSave, writeSave, exportSave, checkImport, memoryStorage, KEYS } from '../core/save.js';
import {
  createVoyage, advanceVoyage, isOperating, isTrolling, setHelm, setMethod, startOperation, stopOperation, redrift, returnToPort,
  nearPort, addManualMark, summarizeVoyage, canStartOperation, addRoutePoint, clearRoute, trollRouteFrom,
} from '../core/voyage.js';
import { acquireBriefing, buildCandidates, planSummary } from '../core/knowledge.js';
import { reportLine, peerName } from '../core/reports.js';
import { trollLineLabel } from '../core/troll.js';
import { linePhaseLabel, recentPace } from '../core/fishing.js';
import { fmtClock, compass8, areaNameAt, currentAt, makeDayConditions, forecastOf } from '../core/sea.js';
import { levelFromXp } from '../core/progress.js';
import { schoolCenter } from '../core/world.js';
import { buildStaticMap, drawChart, drawBriefingChart, chartToWorld } from './chart.js';
import { createSounderView } from './sounderView.js';
import * as S from './screens.js';

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
    if (c) drawBriefingChart(c, staticMap, { candidates: app.candidates, reports: chartReports(app.profile.knowledge.reports, app.profile.day + 1), logs: app.profile.logs });
  }
  if (screen === 'save') {
    const f = $('importFile');
    if (f) f.addEventListener('change', onImportFile);
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
  const p = markDeparture(app.profile, new Date().toISOString(), plan);
  const r = commit(p, '出港を記録');
  if (!r.ok) toast('出港の記録を保存できませんでした（このまま出港します）');
  let scenario = null;
  if (DEV && params.get('scenario') === 'near') scenario = nearScenario();
  app.voyage = createVoyage(app.profile, { scenario });
  $('msgs').dataset.last = '';
  app.carry = 0;
  app.seenMsg = 0;
  app.seenEvent = app.voyage.eventSeq - 1;
  app.notice = '';
  app.paused = false;
  app.lastFeed = '';
  show('sea');
  snapCamera = true;
}

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
  commit(res.profile, '水揚げ・精算');
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
  modal(`<div class="card"><h2>購入の確認</h2><p><b>${S.esc(pv.item.name)}</b> を購入して「${S.esc(pv.slot.label)}」に取り付けます。</p>
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
  toast(`${EQUIPMENT[itemId].name} を取り付けました`);
  show('equip');
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
  app.notice = r.interrupted ? `読み込んだセーブには${r.interrupted.day}日目の航海中の記録がありました。海上の途中経過は保存されないため、この航海は中断扱いにしました。` : 'セーブを読み込みました。';
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
      else r = startOperation(v);
      break;
    case 'redrift':
      r = redrift(v);
      break;
    case 'port':
      r = returnToPort(v);
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
    case 'method':
      r = setMethod(v, v.method === 'troll' ? 'handline' : 'troll');
      if (r.ok) toast(`漁法：${METHODS[v.method].name}${v.method === 'troll' ? '（海図 C をクリックして航路、Spaceで開始）' : ''}`);
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

/** Click on the big chart while trolling is selected: add a route point there. */
function onChartClick(ev) {
  const v = app.voyage;
  if (!v || app.screen !== 'sea') return;
  if (!app.chartBig) {
    toggle('chart');
    return;
  }
  if (v.method !== 'troll' && !isTrolling(v)) {
    toast('航路の指定は曳縄のとき（T で切替）');
    return;
  }
  const c = $('chart');
  const rect = c.getBoundingClientRect();
  const w = chartToWorld(c, v, true, ev.clientX - rect.left, ev.clientY - rect.top);
  const r = addRoutePoint(v, w);
  toast(r.ok ? `経由点${v.plannedRoute.length}を追加${isTrolling(v) ? '（航路を変更）' : ''}` : r.reason);
}

function toggle(name) {
  if (name === 'sounder') {
    app.sounderOpen = !app.sounderOpen;
  } else if (name === 'chart') {
    app.chartBig = !app.chartBig;
  } else if (name === 'view') {
    app.view = app.view === 'helm' ? 'deck' : 'helm';
    toast(app.view === 'deck' ? '作業視点' : '操船視点');
  } else if (name === 'pause') {
    app.paused = !app.paused;
  } else if (name === 'speed') {
    app.speedIdx = (app.speedIdx + 1) % TIME.USER_MULT.length;
  }
  updateHudStatic();
}

// ---------------------------------------------------------------- input
const held = { left: false, right: false };
let lastRudderInput = 0;
document.addEventListener('keydown', (e) => {
  if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
  if (!$('modal').hidden) {
    if (e.key === 'Escape') modal(null);
    return;
  }
  if (app.screen !== 'sea') return;
  const k = e.key.toLowerCase();
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
  if (k === 'a' || e.key === 'ArrowLeft') held.left = false;
  else if (k === 'd' || e.key === 'ArrowRight') held.right = false;
});
window.addEventListener('blur', () => {
  held.left = false;
  held.right = false;
});

document.addEventListener('pointerdown', (e) => {
  const b = e.target.closest('[data-hold]');
  if (!b) return;
  held[b.dataset.hold] = true;
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
document.addEventListener('change', (e) => {
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
    case 'sounder':
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
  if (isOperating(v)) {
    op.innerHTML = v.op.state === 'stopping' ? '回収中…' : '回収・終了<kbd>Space</kbd>';
    op.disabled = v.op.state === 'stopping';
  } else {
    op.innerHTML = '操業開始<kbd>Space</kbd>';
    op.disabled = false;
  }
  const troll = v.method === 'troll' || isTrolling(v);
  $('btnRedrift').disabled = troll || !(isOperating(v) || v.logs.length);
  $('btnMethod').innerHTML = `${METHODS[isOperating(v) ? v.op.methodId : v.method].name}<kbd>T</kbd>`;
  $('btnMethod').disabled = isOperating(v) || !v.equip.troll;
  $('btnClearRoute').hidden = !troll;
  const bp = $('btnPort');
  bp.innerHTML = v.autopilot && v.autopilot.kind === 'return' ? '帰港中…' : `${nearPort(v) ? '入港' : '帰港'}<kbd>H</kbd>`;
  $('btnSpeed').textContent = `早送り×${TIME.USER_MULT[app.speedIdx]}`;
  $('btnPause').textContent = app.paused ? '再開' : '停止';
  $('btnPause').classList.toggle('active', app.paused);
  $('btnView').textContent = app.view === 'deck' ? '作業視点' : '操船視点';
  $('sounderPanel').hidden = !app.sounderOpen;
  $('sounderOpen').hidden = app.sounderOpen;
  $('chartPanel').classList.toggle('big', app.chartBig);
  $('sounderTitle').textContent = EQUIPMENT[v.equip.sounderId].name;
}

/**
 * On phones, fit the operation panel into the free band so it never covers
 * the controls: portrait — below the status chips, above the messages;
 * landscape — bottom right, above the controls, below the sounder.
 */
function layoutHud() {
  const op = $('opPanel');
  const msgs = $('msgs');
  const W = window.innerWidth;
  const H = window.innerHeight;
  const landscapePhone = H <= 520 && W > H;
  const portraitPhone = W <= 900 && H >= W;
  if (!landscapePhone && !portraitPhone) {
    op.style.top = op.style.bottom = op.style.maxHeight = msgs.style.bottom = '';
    return;
  }
  const appR = $('app').getBoundingClientRect();
  const ctl = $('controls').getBoundingClientRect();
  const gapAboveControls = appR.bottom - ctl.top + 6;
  msgs.style.bottom = `${gapAboveControls}px`;
  if (landscapePhone) {
    const snd = ($('sounderPanel').hidden ? $('sounderOpen') : $('sounderPanel')).getBoundingClientRect();
    op.style.top = 'auto';
    op.style.bottom = `${gapAboveControls}px`;
    op.style.maxHeight = `${Math.max(50, ctl.top - snd.bottom - 12)}px`;
  } else {
    const top = $('hudTop').getBoundingClientRect();
    const msgTop = msgs.childElementCount ? msgs.getBoundingClientRect().top : ctl.top;
    op.style.bottom = 'auto';
    op.style.top = `${top.bottom - appR.top + 6}px`;
    op.style.maxHeight = `${Math.max(50, msgTop - top.bottom - 12)}px`;
  }
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
  const late = v.world.time >= TIME.WARN;
  let html = chip(`${v.day}日目`, fmtClock(v.world.time), late ? 'warn' : '');
  html += chip('針路', `${String(hdg).padStart(3, '0')}°`);
  html += chip('対地', `${(sog * 1.944).toFixed(1)}kt ${sog > 0.05 ? compass8(b.vx, b.vy) : ''}`);
  html += chip('水深', last ? `${last.bottom.toFixed(1)}m` : '--');
  html += chip('場所', S.esc(areaNameAt(b.x, b.y)));
  html += chip('漁法', METHODS[isOperating(v) ? v.op.methodId : v.method].name);
  html += chip('魚倉', `${v.hold.kg.toFixed(1)}/${v.capacityKg}kg`, v.hold.kg > v.capacityKg * 0.9 ? 'warn' : '');
  html += chip('時間', `×${scale}${app.paused ? ' 停止中' : ''}`, app.paused ? 'warn' : '');
  if (b.grounded) html += chip('注意', '浅瀬・陸', 'warn');
  if (b.outOfBounds) html += chip('注意', '漁場の外', 'warn');
  if (DEV) html += chip('DEV', `${Math.round(b.x)},${Math.round(b.y)}`, 'warn');
  $('hudTop').innerHTML = html;

  // operation panel
  const panel = $('opPanel');
  if (isTrolling(v)) {
    const op = v.op;
    const pace = recentPace(op, v.world.time, 1800);
    const el = v.world.time - op.startT;
    panel.hidden = false;
    panel.innerHTML = `<h3>自動操業 — ${METHODS.troll.name} Lv${op.level}</h3>
      ${op.lines.map((l) => `<div class="state">${S.esc(trollLineLabel(l))}</div>`).join('')}
      <div class="row"><span>経過</span><span>${Math.floor(el / 60)}分${String(Math.floor(el % 60)).padStart(2, '0')}秒</span></div>
      <div class="row"><span>この曳縄</span><span>${op.landedCount}本・${op.landedKg.toFixed(1)}kg</span></div>
      <div class="row"><span>直近30分</span><span>${pace.n}本</span></div>
      <div class="row"><span>航路</span><span>経由点${op.route.points.length - 1}・${op.route.dir > 0 ? '往路' : '復路'}${op.route.changes ? `（変更${op.route.changes}回）` : ''}</span></div>
      <div class="row"><span>速力</span><span>${(Math.abs(b.speed) * 1.944).toFixed(1)}kt</span></div>
      <div class="feed">${S.esc(app.lastFeed)}</div>`;
  } else if (isOperating(v)) {
    const op = v.op;
    const pace = recentPace(op, v.world.time);
    const line = op.lines[0];
    const el = v.world.time - op.startT;
    panel.hidden = false;
    panel.innerHTML = `<h3>自動操業 — ${METHODS.handline.name} Lv${op.level}</h3>
      <div class="state">${S.esc(linePhaseLabel(line))}</div>
      <div class="row"><span>経過</span><span>${Math.floor(el / 60)}分${String(Math.floor(el % 60)).padStart(2, '0')}秒</span></div>
      <div class="row"><span>この流し</span><span>${op.landedCount}尾・${op.landedKg.toFixed(1)}kg</span></div>
      <div class="row"><span>直近10分のペース</span><span>${pace.n}尾（${pace.perMin.toFixed(1)}尾/分）</span></div>
      <div class="row"><span>タナ</span><span>${line.tana != null ? `${line.tana.toFixed(1)}m（${line.tanaSource === 'echo' ? '魚探反応に合わせる' : '底から少し上'}）` : '—'}</span></div>
      <div class="row"><span>船の流れ</span><span>${sog > 0.03 ? `${compass8(b.vx, b.vy)}へ ${(sog * 1.944).toFixed(1)}kt` : 'ほぼ止まっている'}</span></div>
      <div class="feed">${S.esc(app.lastFeed)}</div>`;
  } else if (v.logs.length) {
    const l = v.logs[v.logs.length - 1];
    panel.hidden = false;
    panel.innerHTML = `<h3>前回の流し #${v.logs.length}</h3>
      <div class="row"><span>${fmtClock(l.startT)}〜 ${S.esc(l.area)}</span><span>${Math.round(l.durationS / 60)}分</span></div>
      <div class="row"><span>漁獲</span><span>${l.count}尾・${l.kg.toFixed(1)}kg</span></div>
      <div class="row"><span>この航海の合計</span><span>${v.hold.count}尾・${v.hold.kg.toFixed(1)}kg</span></div>
      <div class="feed">${canStartOperation(v).ok ? (v.method === 'troll' ? 'Spaceで曳縄を開始できます' : '停船中：Spaceで操業開始できます') : ''}</div>`;
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
    const rIn = (held.right ? 1 : 0) - (held.left ? 1 : 0);
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
    updateHud(now);
    const trollSel = v.method === 'troll' || isTrolling(v);
    let route = null;
    if (isTrolling(v)) route = { points: v.op.route.points, live: true };
    else if (v.method === 'troll') {
      const rt = trollRouteFrom(v);
      if (rt.ok) route = { points: rt.points, live: false };
    }
    const hint = trollSel ? (app.chartBig ? 'クリックで曳縄の経由点を追加（最大6）・Xで消去' : '曳縄：クリックで海図を拡大して航路を指定') : '';
    const reps = chartReports([...app.profile.knowledge.reports, ...v.heard], v.day);
    drawChart($('chart'), staticMap, v, { big: app.chartBig, dev: DEV, reports: reps, route, hint });
    if (app.sounderOpen) sounderView.draw(v.obs, { lines: isOperating(v) ? v.op.lines : null, waterTemp: v.world.cond.waterTemp });
    if (v.phase === 'docked') arriveAndSettle();
  }
  if (scene) {
    const atSea = app.screen === 'sea' && v;
    const line = atSea && isOperating(v) && v.op.methodId === 'handline' ? v.op.lines[0] : null;
    const tl = atSea && isTrolling(v) ? v.op.lines : null;
    const reel = app.profile ? app.profile.boat.slots.starboard_reel.itemId : 'reel_hand';
    const trollGear = atSea ? !!v.equip.troll : !!(app.profile && app.profile.boat.slots.stern_troll);
    scene.render({
      mode: atSea ? 'sea' : 'port',
      boat: atSea ? v.boat : { x: PORT.dock.x, y: PORT.dock.y + 20, heading: 0, speed: 0, vx: 0, vy: 0 },
      gameTime: atSea ? v.world.time : app.screen === 'receipt' ? 13 * 3600 : TIME.DEPART + 1800,
      windSpeed: atSea ? v.world.cond.windSpeed : 3,
      reelId: atSea ? v.equip.reelId : reel,
      lineActive: !!(line && ['drop', 'fish', 'adjust', 'retrieve'].includes(line.phase)),
      lineDepth: line ? line.depth : 0,
      working: line ? line.phase : tl ? (tl.some((l) => l.phase === 'haul' || l.phase === 'fight') ? 'retrieve' : tl.some((l) => l.phase === 'unhook' || l.phase === 'deploy') ? 'unhook' : null) : null,
      trollGear,
      trollLines: tl ? tl.map((l) => ({ active: l.phase === 'tow' || l.phase === 'fight' || l.phase === 'haul', side: l.side, len: l.phase === 'haul' ? l.haulLeft : 40 })) : null,
      view: app.view,
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
    const ir = resolveInterruptedVoyage(app.profile);
    if (ir.interrupted) {
      commit(ir.profile, '中断した航海の整理');
      notes.push(`${ir.interrupted.day}日目の航海は海上で中断されたため、漁獲・経費・経験は記録されていません（海上の途中保存は未実装）。`);
    }
    app.notice = notes.join(' ');
    show('port');
  } else {
    show('saveProblem');
  }
  $('loading').hidden = true;
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
        funds: app.profile && app.profile.funds,
        day: app.profile && app.profile.day,
        level: app.profile && levelFromXp(app.profile.methods.handline.xp),
        xp: app.profile && app.profile.methods.handline.xp,
        reel: app.profile && app.profile.boat.slots.starboard_reel.itemId,
        troll: app.profile && app.profile.boat.slots.stern_troll ? app.profile.boat.slots.stern_troll.itemId : null,
        trollXp: app.profile && app.profile.methods.troll.xp,
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
          pings: v.obs.pingCount,
          schools: v.world.schools.map((s) => ({ id: s.id, counts: { ...s.counts } })),
          lastEcho: v.obs.cols.length ? v.obs.cols[v.obs.cols.length - 1].maxFish : 0,
        },
      };
    },
    schoolCenters() {
      const v = app.voyage;
      if (!v) return [];
      return v.world.schools.map((s) => ({ id: s.id, ...schoolCenter(s, v.world.time), total: s.counts.s + s.counts.m + s.counts.l }));
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
