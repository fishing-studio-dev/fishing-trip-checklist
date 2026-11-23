// HTML for the menu screens. Pure functions of state -> markup.
import { EQUIPMENT, BOATS, ECONOMY, METHODS, skillForLevel, TIME } from '../core/data.js';
import { xpProgress, cycleEstimate, levelFromXp } from '../core/progress.js';
import { purchasePreview } from '../core/economy.js';
import { forecastText, makeDayConditions, fmtClock } from '../core/sea.js';

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (n) => `${Math.round(n).toLocaleString('ja-JP')}${ECONOMY.currency}`;
const sec = (s) => `${Math.round(s)}秒`;

function saveLine(st) {
  if (!st) return '<span class="note">まだ保存していません</span>';
  if (st.ok) return `<span class="save-ok">保存済み</span><span class="note">（${esc(new Date(st.at).toLocaleString('ja-JP'))}・${esc(st.reason || '')}）</span>`;
  return `<span class="save-bad">保存できませんでした：${esc(st.error)}</span> <button type="button" class="mini" data-act="retrySave">再試行</button>`;
}

function reelId(profile) {
  return profile.boat.slots.starboard_reel.itemId;
}

export function titleScreen({ storageNote }) {
  return `<div class="sheet">
  <h1>漁師ゲーム <span class="tag">試作 M0</span></h1>
  <p class="lead">魚探を頼りに自分で群れとポイントを探し、操業は自動。漁を重ねて手際が上がり、設備を整えて同じ時間でより多く獲れるようになる——その核を確かめる試作です。</p>
  <div class="grid">
    <div class="card"><h2>この試作でできること</h2><ul>
      <li>出港 → 魚探で探索 → 停船して操業開始（投入・タナ取り・合わせ・回収は自動）</li>
      <li>流し直し・移動・終了の判断、帰港して一括水揚げ</li>
      <li>一本釣りのレベル（手際）と電動リールで処理量が伸びる</li>
      <li>帰港後に自動保存。再読み込みで続きから</li>
    </ul></div>
    <div class="card"><h2>まだ無いもの</h2><ul>
      <li>漁師仲間の情報・今日の海図・日誌による候補（M1予定）</li>
      <li>船の買い替え（新艇・中古）、第2漁法（M1〜M2予定）</li>
      <li>海上での途中保存（帰港時のみ保存）</li>
    </ul></div>
  </div>
  ${storageNote ? `<p class="save-bad">${esc(storageNote)}</p>` : ''}
  <div class="actions"><button type="button" class="btn primary" data-act="newGame">新しく始める</button>
  <button type="button" class="btn" data-act="openSave">セーブを読み込む</button></div>
</div>`;
}

export function saveProblemScreen(res) {
  const what = { unreadable: 'セーブデータを読み込めませんでした。', newer: 'このセーブは新しい版で作られています。', unavailable: 'このブラウザでは保存領域を使えません。' }[res.status] || '保存データに問題があります。';
  return `<div class="sheet"><h1>セーブデータの確認</h1>
  <div class="card"><p>${esc(what)}</p><p class="note">理由：${esc(res.error || '')}</p>
  ${res.quarantineKey ? `<p class="note">読めなかったデータは削除せず「${esc(res.quarantineKey)}」として残しています。書き出して保管できます。</p>` : ''}
  <div class="actions">
    ${res.quarantineKey ? '<button type="button" class="btn" data-act="exportQuarantine">読めなかったデータを書き出す</button>' : ''}
    <button type="button" class="btn" data-act="openSave">別のセーブファイルを読み込む</button>
    ${res.status !== 'unavailable' ? '<button type="button" class="btn warn" data-act="newGameConfirm">新しく始める（元データは残します）</button>' : '<button type="button" class="btn warn" data-act="newGame">保存なしで遊ぶ</button>'}
  </div></div></div>`;
}

export function portScreen(app) {
  const p = app.profile;
  const nextDay = p.day + 1;
  const cond = makeDayConditions(p.worldSeed, nextDay);
  const xp = xpProgress(p.methods.handline.xp);
  const sk = skillForLevel(xp.level);
  const rid = reelId(p);
  const cyc = cycleEstimate(xp.level, rid, 30);
  const model = BOATS[p.boat.model];
  const slots = model.slots.map((s) => `<dt>${esc(s.label)}</dt><dd>${esc(EQUIPMENT[p.boat.slots[s.id].itemId].name)}</dd>`).join('');
  const reel = EQUIPMENT.reel_electric;
  const goal = rid === 'reel_electric' ? '<p class="note">電動リールを搭載済み。深いタナでも回収が速い。</p>' : `<p class="note">次の設備：${esc(reel.name)}（${money(reel.price)}）${p.funds >= reel.price ? '<span class="tag good">購入可能</span>' : `まであと${money(reel.price - p.funds)}`}</p>`;
  return `<div class="sheet">
  <h1>港 <span class="tag">${nextDay}日目の朝・${fmtClock(TIME.DEPART)} 出港</span></h1>
  <p class="lead">海況を確かめて出港し、海図と魚探で群れを探します。停船してポイントを決めたら、投入から回収までは自動です。</p>
  ${app.notice ? `<div class="card" style="margin-bottom:12px;border-color:var(--warn)"><p>${esc(app.notice)}</p></div>` : ''}
  <div class="actions" style="margin:0 0 14px"><button type="button" class="btn primary" data-act="depart">出港する</button><button type="button" class="btn" data-act="help">操作説明</button></div>
  <div class="grid">
    <div class="card"><h2>今日の海況（予報）</h2><ul>${forecastText(cond).map((l) => `<li>${esc(l)}</li>`).join('')}</ul>
      <p class="note">船は潮と風で流されます。群れの<b>潮上</b>で操業を始めると、流れながら群れの上を通ります。港の掲示：アジは瀬・根・駆け上がりなど海底に起伏のある場所に付きやすい（一般的な目安）。</p></div>
    <div class="card"><h2>漁師の腕前</h2>
      <dl class="kv"><dt>${esc(METHODS.handline.name)}</dt><dd><b>Lv ${xp.level}</b></dd></dl>
      <div class="bar"><i style="width:${xp.max ? 100 : Math.round((xp.into / xp.need) * 100)}%"></i></div>
      <p class="note" style="margin:0 0 8px">${xp.max ? '最大レベル' : `次のレベルまで ${xp.need - xp.into} 経験`}</p>
      <dl class="kv"><dt>餌付け・準備</dt><dd>${sk.rebait.toFixed(1)}秒</dd><dt>取り込み</dt><dd>${sk.unhook.toFixed(1)}秒/尾</dd><dt>仕掛けの投入</dt><dd>${sk.dropSpeed.toFixed(2)}m/秒</dd><dt>巻上げ</dt><dd>${cyc.retrieveSpeed.toFixed(2)}m/秒${rid === 'reel_electric' ? '（電動）' : '（手巻き）'}</dd>
      <dt>手返し目安</dt><dd>${sec(cyc.total)}/回</dd></dl>
      <p class="note">手返し目安＝水深30mで3本針すべてに掛かったときの1回分。魚が少ない場所では待ち時間が増え、腕前の差は小さくなります。</p></div>
    <div class="card"><h2>船・装備</h2>
      <dl class="kv"><dt>船名</dt><dd>${esc(p.boat.name)}</dd><dt>船体</dt><dd>${esc(model.name)}（${model.length}m）</dd><dt>魚倉</dt><dd>${model.holdKg}kg</dd>${slots}</dl>
      ${goal}
      <div class="actions"><button type="button" class="btn" data-act="equip">装備・船</button></div></div>
    <div class="card"><h2>資金・記録</h2>
      <dl class="kv"><dt>資金</dt><dd class="big-num">${money(p.funds)}</dd><dt>出漁回数</dt><dd>${p.stats.voyages}回</dd><dt>累計漁獲</dt><dd>${p.stats.fish}尾・${p.stats.kg.toFixed(1)}kg</dd><dt>操業記録</dt><dd>${p.logs.length}件</dd></dl>
      <div class="actions"><button type="button" class="btn" data-act="log">操業日誌</button><button type="button" class="btn" data-act="openSave">セーブ管理</button></div>
      <p class="note">${saveLine(app.saveStatus)}</p></div>
  </div>
  <p class="note">保存は「帰港して水揚げしたとき」「装備を買ったとき」に自動で行います。海上の途中経過は保存されません（海上でページを閉じると、その航海は中断扱いになり漁獲は記録されません）。</p>
</div>`;
}

export function receiptScreen(app) {
  const r = app.receipt;
  const rows = r.lines.map((l) => `<tr><td>${esc(l.label)}</td><td class="num">${l.count}尾</td><td class="num">${l.kg.toFixed(2)}kg</td><td class="num">${l.unitPrice}${ECONOMY.currency}/kg</td><td class="num">${money(l.amount)}</td></tr>`).join('');
  const lvUp = r.xp.levelAfter > r.xp.levelBefore;
  let growth = '';
  if (lvUp) {
    const a = skillForLevel(r.xp.levelBefore);
    const b = skillForLevel(r.xp.levelAfter);
    const rid = reelId(app.profile);
    const ca = cycleEstimate(r.xp.levelBefore, rid, 30);
    const cb = cycleEstimate(r.xp.levelAfter, rid, 30);
    growth = `<p class="up">一本釣り Lv ${r.xp.levelBefore} → Lv ${r.xp.levelAfter}！ 手際が良くなりました。</p>
    <table class="data"><tr><th>項目</th><th class="num">前</th><th class="num">後</th></tr>
    <tr><td>餌付け・準備</td><td class="num">${a.rebait.toFixed(1)}秒</td><td class="num up">${b.rebait.toFixed(1)}秒</td></tr>
    <tr><td>取り込み</td><td class="num">${a.unhook.toFixed(1)}秒/尾</td><td class="num up">${b.unhook.toFixed(1)}秒/尾</td></tr>
    <tr><td>仕掛けの投入</td><td class="num">${a.dropSpeed.toFixed(2)}m/秒</td><td class="num up">${b.dropSpeed.toFixed(2)}m/秒</td></tr>
    ${rid === 'reel_hand' ? `<tr><td>手巻きの巻上げ</td><td class="num">${a.handRetrieve.toFixed(2)}m/秒</td><td class="num up">${b.handRetrieve.toFixed(2)}m/秒</td></tr>` : ''}
    <tr><td>手返し目安（水深30m）</td><td class="num">${sec(ca.total)}</td><td class="num up">${sec(cb.total)}</td></tr></table>`;
  }
  const xpAfter = xpProgress(r.xp.after);
  const ops = (app.receiptLogs || []).map((l, i) => `<tr><td>#${i + 1}</td><td>${fmtClock(l.startT)}</td><td>${esc(l.area)}</td><td class="num">${Math.round(l.durationS / 60)}分</td><td class="num">${l.count}尾</td></tr>`).join('');
  return `<div class="sheet"><h1>帰港・水揚げ <span class="tag">${r.day}日目</span></h1>
  <p class="lead">魚倉の魚を一括で水揚げし、出漁経費を精算しました（自動）。</p>
  <div class="grid">
    <div class="card full"><h2>売上</h2><div class="table-wrap"><table class="data"><tr><th>区分</th><th class="num">尾数</th><th class="num">重量</th><th class="num">単価</th><th class="num">金額</th></tr>${rows}
      <tr><th colspan="4">売上合計</th><th class="num">${money(r.sales)}</th></tr></table></div>
      <dl class="kv" style="margin-top:8px"><dt>氷・餌（定額）</dt><dd>−${money(r.costs.base)}</dd><dt>燃料（${(r.distanceM / 1000).toFixed(1)}km）</dt><dd>−${money(r.costs.fuel)}</dd>
      ${r.costs.waived ? `<dt>経費の免除</dt><dd>+${money(r.costs.waived)}</dd>` : ''}
      <dt>差引</dt><dd><b>${r.net >= 0 ? '+' : '−'}${money(Math.abs(r.net))}</b></dd><dt>資金</dt><dd>${money(r.fundsBefore)} → <b>${money(r.fundsAfter)}</b></dd></dl>
      ${r.costs.waived ? '<p class="note">資金が足りない分の経費は免除されます（不漁でも次の出港ができるように）。</p>' : ''}</div>
    <div class="card"><h2>経験</h2><dl class="kv"><dt>漁獲 ${r.xp.fishXp}尾</dt><dd>+${r.xp.fishXp}</dd><dt>操業時間（上限あり）</dt><dd>+${r.xp.opXp}</dd><dt>合計</dt><dd><b>+${r.xp.total}</b></dd></dl>
      <div class="bar"><i style="width:${xpAfter.max ? 100 : Math.round((xpAfter.into / xpAfter.need) * 100)}%"></i></div>
      <p class="note">${xpAfter.max ? '最大レベル' : `Lv ${xpAfter.level}・次まで ${xpAfter.need - xpAfter.into}`}</p>${growth}</div>
    <div class="card"><h2>この航海の操業</h2>${ops ? `<div class="table-wrap"><table class="data"><tr><th>#</th><th>開始</th><th>場所</th><th class="num">時間</th><th class="num">漁獲</th></tr>${ops}</table></div>` : '<p class="note">操業していません。</p>'}
      <p class="note">航行 ${(r.distanceM / 1000).toFixed(1)}km・操業 ${Math.round(r.opSeconds / 60)}分</p></div>
  </div>
  <p class="note">${saveLine(app.saveStatus)}</p>
  <div class="actions"><button type="button" class="btn primary" data-act="toPort">港に戻る</button><button type="button" class="btn" data-act="equip">装備・船</button></div></div>`;
}

function reelCompare(level, fromId, toId) {
  const a = EQUIPMENT[fromId].reel;
  const b = EQUIPMENT[toId].reel;
  const c30a = cycleEstimate(level, fromId, 30);
  const c30b = cycleEstimate(level, toId, 30);
  const c50a = cycleEstimate(level, fromId, 50);
  const c50b = cycleEstimate(level, toId, 50);
  return `<table class="data"><tr><th>効果</th><th class="num">現在</th><th class="num">購入後</th></tr>
  <tr><td>巻上げ速度</td><td class="num">${c30a.retrieveSpeed.toFixed(2)}m/秒</td><td class="num up">${c30b.retrieveSpeed.toFixed(2)}m/秒</td></tr>
  <tr><td>対応水深</td><td class="num">${a.maxDepth}m</td><td class="num up">${b.maxDepth}m</td></tr>
  <tr><td>手返し目安 水深30m</td><td class="num">${sec(c30a.total)}</td><td class="num up">${sec(c30b.total)}</td></tr>
  <tr><td>手返し目安 水深50m</td><td class="num">${sec(c50a.total)}</td><td class="num up">${sec(c50b.total)}</td></tr></table>`;
}

export function equipScreen(app) {
  const p = app.profile;
  const model = BOATS[p.boat.model];
  const level = levelFromXp(p.methods.handline.xp);
  const slotCards = model.slots
    .map((slot) => {
      const cur = EQUIPMENT[p.boat.slots[slot.id].itemId];
      const offers = Object.values(EQUIPMENT).filter((it) => it.type === slot.accepts && it.id !== cur.id && it.price > 0);
      const offerHtml = offers
        .map((it) => {
          const pv = purchasePreview(p, it.id, slot.id);
          const cmp = slot.accepts === 'reel' ? reelCompare(level, cur.id, it.id) : '';
          return `<div class="card" style="margin-top:8px;background:rgba(255,255,255,.03)"><h2>${esc(it.name)} <span class="tag">${money(it.price)}</span></h2><p class="note">${esc(it.desc)}</p>${cmp}
          <dl class="kv" style="margin-top:8px"><dt>支払総額</dt><dd>${money(it.price)}</dd><dt>購入後の資金</dt><dd>${money(Math.max(0, pv.fundsAfter))}</dd><dt>外す装備</dt><dd>${esc(cur.name)} → 倉庫</dd></dl>
          <div class="actions"><button type="button" class="btn primary" data-act="buy" data-item="${esc(it.id)}" data-slot="${esc(slot.id)}" ${pv.ok ? '' : 'disabled'}>購入して取り付ける</button>${pv.ok ? '' : `<span class="note">${esc(pv.reason)}</span>`}</div></div>`;
        })
        .join('');
      const stored = p.storage.filter((s) => EQUIPMENT[s.itemId].type === slot.accepts);
      const storedHtml = stored.map((s) => `<div class="actions"><span>${esc(EQUIPMENT[s.itemId].name)}（倉庫）</span><button type="button" class="btn" data-act="equipStored" data-uid="${esc(s.uid)}" data-slot="${esc(slot.id)}">取り付ける</button></div>`).join('');
      return `<div class="card"><h2>${esc(slot.label)}</h2><p><b>${esc(cur.name)}</b></p><p class="note">${esc(cur.desc)}</p>${offerHtml}${storedHtml}</div>`;
    })
    .join('');
  return `<div class="sheet"><h1>船・装備</h1>
  <p class="lead">${esc(p.boat.name)}（${esc(model.name)}）。装備は船体に決められた取付位置へ付けます。外した装備は倉庫に残り、いつでも付け直せます。資金：<b>${money(p.funds)}</b></p>
  <div class="grid">${slotCards}</div>
  <p class="note">船の買い替え（新艇・中古船の選択）と追加の装備は M2 で実装予定です。</p>
  <p class="note">${saveLine(app.saveStatus)}</p>
  <div class="actions"><button type="button" class="btn primary" data-act="toPort">港に戻る</button></div></div>`;
}

const END_TEXT = { player: '終了', redrift: '流し直し', return: '帰港', day_end: '時間切れ', hold_full: '魚倉満杯' };

export function logScreen(app) {
  const p = app.profile;
  const logs = p.logs.slice().reverse();
  const rows = logs
    .map((l) => {
      const perHour = l.durationS > 0 ? (l.count / l.durationS) * 3600 : 0;
      return `<tr><td>${l.day}日目</td><td>${fmtClock(l.startT)}–${fmtClock(l.endT)}</td><td>${esc(l.area)}</td><td class="num">${Math.round(l.durationS / 60)}分</td>
      <td class="num">${l.count === 0 ? '<span class="tag">この時間に漁獲なし</span>' : `${l.count}尾`}</td><td class="num">${l.kg.toFixed(1)}kg</td><td class="num">${perHour.toFixed(0)}尾/時</td>
      <td class="num">${l.tana.min != null ? `${l.tana.min.toFixed(0)}–${l.tana.max.toFixed(0)}m` : '—'}</td><td class="num">${l.bottom.min.toFixed(0)}–${l.bottom.max.toFixed(0)}m</td>
      <td class="num">${Math.round(l.sounder.echoRatio * 100)}%</td><td>${esc(l.conditions.tideName)}・潮${l.conditions.current.speed.toFixed(2)}m/s</td>
      <td>Lv${l.level}・${esc(EQUIPMENT[l.gear.reel]?.name || l.gear.reel)}</td><td>${esc(END_TEXT[l.endReason] || l.endReason)}</td></tr>`;
    })
    .join('');
  const intr = p.interruptedVoyages.length ? `<p class="note">海上で中断され記録されなかった航海：${p.interruptedVoyages.map((v) => `${v.day}日目`).join('、')}</p>` : '';
  return `<div class="sheet"><h1>操業日誌</h1>
  <p class="lead">操業を終えるたびに自動で記録されます（帰港・精算時に保存）。魚探反応率＝その操業中に魚探で群れの反応が出ていた割合。</p>
  ${logs.length ? `<div class="card table-wrap"><table class="data"><tr><th>日</th><th>時刻</th><th>場所</th><th class="num">時間</th><th class="num">漁獲</th><th class="num">重量</th><th class="num">時間あたり</th><th class="num">タナ</th><th class="num">水深</th><th class="num">魚探反応</th><th>海況</th><th>腕前・装備</th><th>終了</th></tr>${rows}</table></div>` : '<div class="card"><p class="note">まだ記録がありません。</p></div>'}
  ${intr}
  <p class="note">似た条件の記録の抽出、仲間の情報との比較は M1 で実装予定です。</p>
  <div class="actions"><button type="button" class="btn primary" data-act="toPort">港に戻る</button></div></div>`;
}

export function saveScreen(app) {
  const p = app.profile;
  return `<div class="sheet"><h1>セーブ管理</h1>
  <div class="grid"><div class="card"><h2>現在のセーブ</h2>
    ${p ? `<dl class="kv"><dt>日数</dt><dd>${p.day}日目まで</dd><dt>資金</dt><dd>${money(p.funds)}</dd><dt>一本釣り</dt><dd>Lv ${levelFromXp(p.methods.handline.xp)}</dd><dt>操業記録</dt><dd>${p.logs.length}件</dd><dt>保存回数</dt><dd>${app.revision}</dd></dl>` : '<p class="note">プロフィールがありません。</p>'}
    <p class="note">${saveLine(app.saveStatus)}</p>
    <p class="note">このブラウザの保存領域（localStorage）に保存しています。直前のセーブを1つバックアップとして残します。ブラウザのデータ消去で消えるため、大事な進行は書き出して保管してください。</p>
    <div class="actions">${p ? '<button type="button" class="btn" data-act="export">セーブを書き出す（JSON）</button>' : ''}</div></div>
  <div class="card"><h2>セーブを読み込む</h2><p class="note">書き出したJSONファイルを読み込みます。内容を確認してから置き換え、現在のセーブはバックアップに残します。</p>
    <input type="file" id="importFile" accept="application/json,.json">
    <p id="importResult" class="note"></p></div></div>
  <div class="actions"><button type="button" class="btn primary" data-act="${p ? 'toPort' : 'toTitle'}">戻る</button></div></div>`;
}

export function helpModal() {
  return `<div class="card"><h2>操作説明</h2><ul>
  <li><b>W / ↑</b> 増速、<b>S / ↓</b> 減速（後進・停止・微速・半速・全速）</li>
  <li><b>A / ←</b>・<b>D / →</b> 押している間だけ舵を切る</li>
  <li><b>Space</b> 停船中に操業開始／操業中は回収して終了</li>
  <li><b>R</b> 流し直し（回収→流し始めの地点へ自動で戻って再開）</li>
  <li><b>H</b> 帰港（港まで移動補助。操船すると取り消し）</li>
  <li><b>M</b> 海図に印、<b>C</b> 海図の拡大、<b>F</b> 魚探の表示切替、<b>V</b> 視点切替</li>
  <li><b>1 / 2 / 3</b> 時間の早さ ×1・×2・×4、<b>P</b> 一時停止</li></ul>
  <p class="note">探す・決めるのはあなた、作業は自動。魚探の反応（色の濃い帯）の上で止まり、潮で流される向きを考えて操業を始めましょう。表示の切替で海や魚が変わることはありません。</p>
  <div class="actions"><button type="button" class="btn primary" data-act="closeModal">閉じる</button></div></div>`;
}
