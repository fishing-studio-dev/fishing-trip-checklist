// HTML for the menu screens. Pure functions of state -> markup.
import { EQUIPMENT, BOATS, ECONOMY, METHODS, SPECIES, PEERS, skillForLevel, trollSkillForLevel, TIME } from '../core/data.js';
import { xpProgress, cycleEstimate, trollCycleEstimate, levelFromXp } from '../core/progress.js';
import { purchasePreview } from '../core/economy.js';
import { forecastText, fmtClock } from '../core/sea.js';
import { reportLine, KIND_LABEL } from '../core/reports.js';
import { similarLogs, todaysReports, timeBandLabel, logTags, opRate } from '../core/knowledge.js';

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (n) => `${Math.round(n).toLocaleString('ja-JP')}${ECONOMY.currency}`;
const sec = (s) => `${Math.round(s)}秒`;
const unitOf = (methodId) => (methodId === 'troll' ? '本' : '尾');

function saveLine(st) {
  if (!st) return '<span class="note">まだ保存していません</span>';
  if (st.ok) return `<span class="save-ok">保存済み</span><span class="note">（${esc(new Date(st.at).toLocaleString('ja-JP'))}・${esc(st.reason || '')}）</span>`;
  return `<span class="save-bad">保存できませんでした：${esc(st.error)}</span> <button type="button" class="mini" data-act="retrySave">再試行</button>`;
}

function itemOf(profile, slotId) {
  const inst = profile.boat.slots[slotId];
  return inst ? EQUIPMENT[inst.itemId] : null;
}

const LABEL_CLASS = {
  今朝の確認情報あり: 'good',
  昨日の情報あり: 'good',
  自分の実績あり: 'good',
  似た条件の記録あり: 'good',
  情報が古い: 'warn',
  反応なしの報告あり: 'warn',
  情報が少ない: '',
  未経験: '',
  装備が必要: 'warn',
};
const labelHtml = (l) => `<span class="tag ${LABEL_CLASS[l] || ''}">${esc(l)}</span>`;

export function titleScreen({ storageNote }) {
  return `<div class="sheet">
  <h1>漁師ゲーム <span class="tag">試作 M1</span></h1>
  <p class="lead">仲間の話・自分の日誌・今日の海況から狙いを決め、魚探を頼りに自分で群れとポイントを探す。操業は自動。漁を重ねて手際が上がり、設備で同じ時間により多く獲れるようになる——その核を確かめる試作です。</p>
  <div class="grid">
    <div class="card"><h2>この試作でできること</h2><ul>
      <li>港で「今日の海図」：仲間2人の話（観測した時刻と聞いた時刻つき）、自分の日誌、予報から候補を確認</li>
      <li>一本釣り（アジ）：停船して自動操業、流し直し・移動を判断</li>
      <li>曳縄（サワラ）：航路を決めれば航行と仕掛けの作業は自動（曳縄具の購入が必要）</li>
      <li>漁法ごとのレベル（手際）、電動リール・曳縄具、帰港で自動保存</li>
    </ul></div>
    <div class="card"><h2>まだ無いもの</h2><ul>
      <li>船の買い替え（新艇・中古）、視点のさらなる作り込み（M2予定）</li>
      <li>甲板の自由移動、追加の漁法・魚種（M3予定）</li>
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

function evidenceLine(e, today) {
  const r = e.origin;
  const l = reportLine(r, today);
  const relayed = e.heardFrom.length > 1 ? `（${e.heardFrom.length}人から聞いたが元は同じ話）` : '';
  return `<li class="${e.superseded ? 'old' : ''}"><b>${esc(l.who)}</b>：${esc(l.when)}「${esc(r.text)}」<span class="note">${esc(l.heard)}${esc(relayed)}${e.superseded ? '・同じ人の新しい話があるため参考のみ' : ''}</span></li>`;
}

function candidateCard(c, today, profile) {
  const live = c.evidence.filter((e) => !e.superseded);
  const main = live.slice(0, 2).map((e) => evidenceLine(e, today)).join('');
  const neg = c.negatives.filter((e) => !e.superseded).map((e) => evidenceLine(e, today)).join('');
  const own = c.own.lines.map((l) => `<li>自分の日誌：${esc(l)}</li>`).join('');
  const notes = c.notes.map((n) => `<li>今日の海況：${esc(n)}</li>`).join('');
  const gearItem = itemOf(profile, METHODS[c.methodId].gearSlot);
  const feas = c.feasible.ok ? `<li>装備：可能（${esc(gearItem ? gearItem.name : '')}）</li>` : `<li class="warn-text">装備：${esc(c.feasible.reason)}</li>`;
  const details = [
    ...c.evidence.slice(2).map((e) => evidenceLine(e, today)),
    ...c.rules.map((r) => `<li><b>${esc(PEERS[r.speaker].name)}</b>の経験則：「${esc(r.text)}」</li>`),
    `<li>港の掲示：${esc(c.general)}</li>`,
  ].join('');
  return `<div class="cand" data-key="${esc(c.key)}">
    <div class="cand-head"><span class="letter">${c.letter}</span><b>${esc(c.area)}</b> — ${esc(SPECIES[c.species].name)}・${esc(METHODS[c.methodId].name)}</div>
    <div class="labels">${c.labels.map(labelHtml).join('')}</div>
    <ul class="basis">${main || '<li class="note">仲間からの具体的な話はまだない</li>'}${neg}${own}${notes}${feas}</ul>
    <details><summary>詳しく</summary><ul class="basis">${details}</ul></details>
    <div class="actions"><button type="button" class="btn ${c.feasible.ok ? 'primary' : ''}" data-act="departPlan" data-key="${esc(c.key)}" ${c.feasible.ok ? '' : 'disabled'}>${c.letter}を狙って出港</button></div>
  </div>`;
}

function peersCard(profile, today) {
  const reps = todaysReports(profile.knowledge, today);
  const by = {};
  for (const r of reps) (by[r.speaker] = by[r.speaker] || []).push(r);
  const blocks = Object.values(PEERS)
    .map((peer) => {
      const list = (by[peer.id] || [])
        .map((r) => {
          const l = reportLine(r, today);
          return `<li><span class="tag">${esc(r.kind === 'rule' ? '経験則' : KIND_LABEL[r.kind])}</span> ${r.kind === 'rule' ? '' : `<b>${esc(l.when)}</b>`}${esc(l.relay)}「${esc(r.text)}」${l.opinion ? `<div class="opinion">${esc(l.opinion)}</div>` : ''}<div class="note">${esc(l.heard)}</div></li>`;
        })
        .join('');
      return `<div class="peer"><h3>${esc(peer.name)} <span class="note">${esc(METHODS[peer.method].name)}・${esc(peer.areas.join('/'))}</span></h3><p class="note">${esc(peer.desc)}</p><ul class="reports">${list || '<li class="note">今朝は特に話がない</li>'}</ul></div>`;
    })
    .join('');
  return `<div class="card"><h2>仲間の話（${today}日目の朝に港で聞いた）</h2>${blocks}
    <p class="note">「水揚げ」「反応なし」は本人が確かめたこと、「魚探の反応」「目撃」は見たもの（魚種は見立て）。予想・見立て・経験則は観測とは別に書いています。時刻は観測した時刻で、今の魚の位置ではありません。</p></div>`;
}

function skillCard(profile) {
  const hx = xpProgress(profile.methods.handline.xp);
  const tx = xpProgress(profile.methods.troll.xp);
  const reel = itemOf(profile, 'starboard_reel');
  const troll = itemOf(profile, 'stern_troll');
  const sk = skillForLevel(hx.level);
  const cyc = cycleEstimate(hx.level, reel.id, 30);
  const ts = trollSkillForLevel(tx.level);
  const tc = trollCycleEstimate(tx.level, troll ? troll.troll : undefined);
  const bar = (x) => `<div class="bar"><i style="width:${x.max ? 100 : Math.round((x.into / x.need) * 100)}%"></i></div><p class="note" style="margin:0 0 8px">${x.max ? '最大レベル' : `次のレベルまで ${x.need - x.into} 経験`}</p>`;
  return `<div class="card"><h2>漁師の腕前</h2>
    <dl class="kv"><dt>${esc(METHODS.handline.name)}</dt><dd><b>Lv ${hx.level}</b></dd></dl>${bar(hx)}
    <dl class="kv"><dt>餌付け・準備</dt><dd>${sk.rebait.toFixed(1)}秒</dd><dt>取り込み</dt><dd>${sk.unhook.toFixed(1)}秒/尾</dd><dt>巻上げ</dt><dd>${cyc.retrieveSpeed.toFixed(2)}m/秒</dd><dt>手返し目安</dt><dd>${sec(cyc.total)}/回</dd></dl>
    <dl class="kv" style="margin-top:10px"><dt>${esc(METHODS.troll.name)}</dt><dd><b>Lv ${tx.level}</b></dd></dl>${bar(tx)}
    <dl class="kv"><dt>仕掛けの投入</dt><dd>${ts.deploy.toFixed(0)}秒</dd><dt>やり取り</dt><dd>${ts.fight.toFixed(0)}秒</dd><dt>手繰り</dt><dd>${ts.haul.toFixed(2)}m/秒</dd><dt>1本あたりの手返し</dt><dd>${sec(tc.total)}</dd></dl>
    <p class="note">手返し目安：一本釣りは水深30mで3本針すべてに掛かったとき、曳縄は1本掛かってから仕掛けを出し直すまで。魚が少ない場所では待ち時間が増え、腕前の差は小さくなります。</p></div>`;
}

function boatCard(profile) {
  const model = BOATS[profile.boat.model];
  const slots = model.slots.map((s) => `<dt>${esc(s.label)}</dt><dd>${esc(itemOf(profile, s.id) ? itemOf(profile, s.id).name : '（空き）')}</dd>`).join('');
  const next = [];
  if (itemOf(profile, 'starboard_reel').id !== 'reel_electric') next.push(EQUIPMENT.reel_electric);
  if (!itemOf(profile, 'stern_troll')) next.push(EQUIPMENT.troll_tr1);
  const goal = next.map((it) => `<p class="note">次の設備：${esc(it.name)}（${money(it.price)}）${profile.funds >= it.price ? '<span class="tag good">購入可能</span>' : ` まであと${money(it.price - profile.funds)}`}</p>`).join('');
  return `<div class="card"><h2>船・装備</h2>
    <dl class="kv"><dt>船名</dt><dd>${esc(profile.boat.name)}</dd><dt>船体</dt><dd>${esc(model.name)}（${model.length}m）</dd><dt>魚倉</dt><dd>${model.holdKg}kg</dd>${slots}</dl>
    ${goal}<div class="actions"><button type="button" class="btn" data-act="equip">装備・船</button></div></div>`;
}

export function portScreen(app) {
  const p = app.profile;
  const today = p.day + 1;
  const cands = app.candidates || [];
  return `<div class="sheet wide">
  <h1>港 <span class="tag">${today}日目の朝・${fmtClock(TIME.DEPART)} 出港</span></h1>
  <p class="lead">仲間の話・自分の日誌・今日の予報から狙いを決め、海では魚探で確かめて場所を決めます。候補は自分が聞いた・記録した情報だけから作っています。候補以外の場所へ行くのも自由です。</p>
  ${app.notice ? `<div class="card" style="margin-bottom:12px;border-color:var(--warn)"><p>${esc(app.notice)}</p></div>` : ''}
  <div class="card full brief"><h2>今日の海図 — 狙いの候補</h2>
    <div class="brief-grid">
      <div class="brief-chart"><canvas id="portChart" width="380" height="380"></canvas>
        <p class="note">● 水揚げ ◎ 魚探の反応 △ 目撃 × 反応なし（仲間が観測した地点・時刻。今の魚の位置ではありません）　■ 自分の操業地点　A/B/C 候補</p></div>
      <div class="cands">${cands.map((c) => candidateCard(c, today, p)).join('')}</div>
    </div>
    <div class="actions"><button type="button" class="btn" data-act="depart">狙いを決めずに出港</button><button type="button" class="btn" data-act="help">操作説明</button></div>
  </div>
  <div class="grid">
    ${peersCard(p, today)}
    <div class="card"><h2>今日の海況（予報）</h2><ul>${forecastText(app.forecast).map((l) => `<li>${esc(l)}</li>`).join('')}</ul>
      <p class="note">予報には誤差があります（潮汐表の時刻と潮回りは正確）。海の上の実際の風・流れは、出港してから船の流れ方で確かめてください。船は潮と風で流されるので、一本釣りは群れの潮上から流します。</p></div>
    ${skillCard(p)}
    ${boatCard(p)}
    <div class="card"><h2>資金・記録</h2>
      <dl class="kv"><dt>資金</dt><dd class="big-num">${money(p.funds)}</dd><dt>出漁回数</dt><dd>${p.stats.voyages}回</dd><dt>累計漁獲</dt><dd>${p.stats.fish}尾・${p.stats.kg.toFixed(1)}kg</dd><dt>操業記録</dt><dd>${p.logs.length}件</dd></dl>
      <div class="actions"><button type="button" class="btn" data-act="log">操業日誌</button><button type="button" class="btn" data-act="openSave">セーブ管理</button></div>
      <p class="note">${saveLine(app.saveStatus)}</p></div>
  </div>
  <p class="note">保存は「帰港して水揚げしたとき」「装備を買ったとき」「港で仲間の話を聞いたとき」に自動で行います。海上の途中経過は保存されません（海上でページを閉じると、その航海は中断扱いになり漁獲は記録されません）。</p>
</div>`;
}

export function receiptScreen(app) {
  const r = app.receipt;
  const rows = r.lines.map((l) => `<tr><td>${esc(SPECIES[l.species].name)}／${esc(l.label)}</td><td class="num">${l.count}尾</td><td class="num">${l.kg.toFixed(2)}kg</td><td class="num">${l.unitPrice}${ECONOMY.currency}/kg</td><td class="num">${money(l.amount)}</td></tr>`).join('') || '<tr><td colspan="5" class="note">水揚げなし</td></tr>';
  const xpBlocks = Object.entries(r.xp)
    .map(([mId, x]) => {
      const lvUp = x.levelAfter > x.levelBefore;
      const after = xpProgress(x.after);
      let growth = '';
      if (lvUp && mId === 'handline') {
        const rid = itemOf(app.profile, 'starboard_reel').id;
        const a = skillForLevel(x.levelBefore);
        const b = skillForLevel(x.levelAfter);
        growth = `<table class="data"><tr><th>項目</th><th class="num">前</th><th class="num">後</th></tr>
        <tr><td>餌付け・準備</td><td class="num">${a.rebait.toFixed(1)}秒</td><td class="num up">${b.rebait.toFixed(1)}秒</td></tr>
        <tr><td>取り込み</td><td class="num">${a.unhook.toFixed(1)}秒/尾</td><td class="num up">${b.unhook.toFixed(1)}秒/尾</td></tr>
        <tr><td>手返し目安（水深30m）</td><td class="num">${sec(cycleEstimate(x.levelBefore, rid, 30).total)}</td><td class="num up">${sec(cycleEstimate(x.levelAfter, rid, 30).total)}</td></tr></table>`;
      } else if (lvUp && mId === 'troll') {
        const a = trollSkillForLevel(x.levelBefore);
        const b = trollSkillForLevel(x.levelAfter);
        growth = `<table class="data"><tr><th>項目</th><th class="num">前</th><th class="num">後</th></tr>
        <tr><td>仕掛けの投入</td><td class="num">${a.deploy.toFixed(0)}秒</td><td class="num up">${b.deploy.toFixed(0)}秒</td></tr>
        <tr><td>やり取り</td><td class="num">${a.fight.toFixed(0)}秒</td><td class="num up">${b.fight.toFixed(0)}秒</td></tr>
        <tr><td>1本あたりの手返し</td><td class="num">${sec(trollCycleEstimate(x.levelBefore).total)}</td><td class="num up">${sec(trollCycleEstimate(x.levelAfter).total)}</td></tr></table>`;
      }
      return `<h3>${esc(METHODS[mId].name)}</h3><dl class="kv"><dt>漁獲 ${x.fish}${unitOf(mId)}</dt><dd>+${x.fishXp}</dd><dt>操業時間（上限あり）</dt><dd>+${x.opXp}</dd></dl>
      <div class="bar"><i style="width:${after.max ? 100 : Math.round((after.into / after.need) * 100)}%"></i></div>
      <p class="note">${after.max ? '最大レベル' : `Lv ${after.level}・次まで ${after.need - after.into}`}</p>${lvUp ? `<p class="up">${esc(METHODS[mId].name)} Lv ${x.levelBefore} → Lv ${x.levelAfter}！ 手際が良くなりました。</p>` : ''}${growth}`;
    })
    .join('');
  const logs = app.receiptLogs || [];
  const ops = logs.map((l, i) => `<tr><td>#${i + 1}</td><td>${fmtClock(l.startT)}</td><td>${esc(METHODS[l.methodId].name)}</td><td>${esc(l.area)}</td><td class="num">${Math.round(l.durationS / 60)}分</td><td class="num">${l.count}${unitOf(l.methodId)}</td></tr>`).join('');
  let planHtml = '';
  if (r.plan) {
    const hit = logs.filter((l) => `${l.methodId}:${l.area}` === r.plan.key);
    const n = hit.reduce((a, l) => a + l.count, 0);
    planHtml = `<div class="card full"><h2>今日の狙いと結果</h2><p>狙い：<b>${esc(r.plan.label)}</b>（根拠：${esc(r.plan.basis)}）</p>
      <p>${hit.length ? `狙いどおりの場所・漁法で${hit.length}回操業し、${n}${unitOf(hit[0].methodId)}。` : '狙いの場所・漁法では操業しませんでした。'}${logs.length > hit.length ? ` ほかに${logs.length - hit.length}回の操業。` : ''}</p>
      <p class="note">この狙いと根拠は操業日誌にも残っています。</p></div>`;
  }
  return `<div class="sheet"><h1>帰港・水揚げ <span class="tag">${r.day}日目</span></h1>
  <p class="lead">魚倉の魚を一括で水揚げし、出漁経費を精算しました（自動）。${r.heardCount ? `海上で無線で聞いた話${r.heardCount}件も記録しました。` : ''}</p>
  <div class="grid">
    ${planHtml}
    <div class="card full"><h2>売上</h2><div class="table-wrap"><table class="data"><tr><th>区分</th><th class="num">尾数</th><th class="num">重量</th><th class="num">単価</th><th class="num">金額</th></tr>${rows}
      <tr><th colspan="4">売上合計</th><th class="num">${money(r.sales)}</th></tr></table></div>
      <dl class="kv" style="margin-top:8px"><dt>氷・餌（定額）</dt><dd>−${money(r.costs.base)}</dd><dt>燃料（${(r.distanceM / 1000).toFixed(1)}km）</dt><dd>−${money(r.costs.fuel)}</dd>
      ${r.costs.waived ? `<dt>経費の免除</dt><dd>+${money(r.costs.waived)}</dd>` : ''}
      <dt>差引</dt><dd><b>${r.net >= 0 ? '+' : '−'}${money(Math.abs(r.net))}</b></dd><dt>資金</dt><dd>${money(r.fundsBefore)} → <b>${money(r.fundsAfter)}</b></dd></dl>
      ${r.costs.waived ? '<p class="note">資金が足りない分の経費は免除されます（不漁でも次の出港ができるように）。</p>' : ''}</div>
    <div class="card"><h2>経験</h2>${xpBlocks || '<p class="note">操業していないので経験はありません。</p>'}</div>
    <div class="card full"><h2>この航海の操業</h2>${ops ? `<div class="table-wrap"><table class="data"><tr><th>#</th><th>開始</th><th>漁法</th><th>場所</th><th class="num">時間</th><th class="num">漁獲</th></tr>${ops}</table></div>` : '<p class="note">操業していません。</p>'}
      <p class="note">航行 ${(r.distanceM / 1000).toFixed(1)}km・操業 ${Math.round(r.opSeconds / 60)}分</p></div>
  </div>
  <p class="note">${saveLine(app.saveStatus)}</p>
  <div class="actions"><button type="button" class="btn primary" data-act="toPort">港に戻る（翌朝の話を聞く）</button><button type="button" class="btn" data-act="equip">装備・船</button><button type="button" class="btn" data-act="log">操業日誌</button></div></div>`;
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

function trollEffect(item) {
  const t = item.troll;
  return `<table class="data"><tr><th>効果</th><th class="num">購入後</th></tr>
  <tr><td>できる漁</td><td class="num up">曳縄（サワラ）</td></tr>
  <tr><td>仕掛け</td><td class="num">${t.lines}本（潜行板の深さ ${t.lureDepths.join('m・')}m）</td></tr>
  <tr><td>曳く速さ</td><td class="num">${t.towSpeed}m/秒（約${(t.towSpeed * 1.944).toFixed(0)}ノット）</td></tr></table>`;
}

export function equipScreen(app) {
  const p = app.profile;
  const model = BOATS[p.boat.model];
  const level = levelFromXp(p.methods.handline.xp);
  const slotCards = model.slots
    .map((slot) => {
      const cur = itemOf(p, slot.id);
      const offers = Object.values(EQUIPMENT).filter((it) => it.type === slot.accepts && (!cur || it.id !== cur.id) && it.price > 0);
      const offerHtml = offers
        .map((it) => {
          const pv = purchasePreview(p, it.id, slot.id);
          const cmp = slot.accepts === 'reel' && cur ? reelCompare(level, cur.id, it.id) : slot.accepts === 'troll' ? trollEffect(it) : '';
          return `<div class="card" style="margin-top:8px;background:rgba(255,255,255,.03)"><h2>${esc(it.name)} <span class="tag">${money(it.price)}</span></h2><p class="note">${esc(it.desc)}</p>${cmp}
          <dl class="kv" style="margin-top:8px"><dt>支払総額</dt><dd>${money(it.price)}</dd><dt>購入後の資金</dt><dd>${money(Math.max(0, pv.fundsAfter))}</dd><dt>外す装備</dt><dd>${cur ? `${esc(cur.name)} → 倉庫` : 'なし（空きの取付位置）'}</dd></dl>
          <div class="actions"><button type="button" class="btn primary" data-act="buy" data-item="${esc(it.id)}" data-slot="${esc(slot.id)}" ${pv.ok ? '' : 'disabled'}>購入して取り付ける</button>${pv.ok ? '' : `<span class="note">${esc(pv.reason)}</span>`}</div></div>`;
        })
        .join('');
      const stored = p.storage.filter((s) => EQUIPMENT[s.itemId].type === slot.accepts);
      const storedHtml = stored.map((s) => `<div class="actions"><span>${esc(EQUIPMENT[s.itemId].name)}（倉庫）</span><button type="button" class="btn" data-act="equipStored" data-uid="${esc(s.uid)}" data-slot="${esc(slot.id)}">取り付ける</button></div>`).join('');
      return `<div class="card"><h2>${esc(slot.label)}</h2><p><b>${esc(cur ? cur.name : '（空き）')}</b></p><p class="note">${esc(cur ? cur.desc : 'この位置に対応する装備を取り付けられます。')}</p>${offerHtml}${storedHtml}</div>`;
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
  const f = app.logFilter || { method: '', area: '' };
  const areas = [...new Set(p.logs.map((l) => l.area))];
  const curReel = itemOf(p, 'starboard_reel').id;
  const curTroll = itemOf(p, 'stern_troll') ? itemOf(p, 'stern_troll').id : null;
  const logs = p.logs.filter((l) => (!f.method || (l.methodId || 'handline') === f.method) && (!f.area || l.area === f.area)).slice().reverse();
  const rows = logs
    .map((l) => {
      const m = l.methodId || 'handline';
      const g = logTags(l);
      const gearNow = m === 'troll' ? curTroll : curReel;
      const gearThen = m === 'troll' ? l.gear.troll : l.gear.reel;
      const lvNow = levelFromXp(p.methods[m].xp);
      const marks = [];
      if (gearThen && gearNow && gearThen !== gearNow) marks.push('装備が今と違う');
      if (Math.abs(lvNow - l.level) >= 2) marks.push(`当時Lv${l.level}`);
      return `<tr><td>${l.day}日目</td><td>${fmtClock(l.startT)}–${fmtClock(l.endT)}<div class="note">${esc(timeBandLabel(g.timeBand))}</div></td><td>${esc(METHODS[m].name)}</td><td>${esc(l.area)}</td><td class="num">${Math.round(l.durationS / 60)}分</td>
      <td class="num">${l.count === 0 ? '<span class="tag">この時間に漁獲なし</span>' : `${l.count}${unitOf(m)}`}</td><td class="num">${l.kg.toFixed(1)}kg</td><td class="num">${opRate(l).toFixed(0)}${unitOf(m)}/時</td>
      <td class="num">${l.tana.min != null ? `${l.tana.min.toFixed(0)}–${l.tana.max.toFixed(0)}m` : '—'}</td><td class="num">${Math.round(l.sounder.echoRatio * 100)}%</td><td>${esc(l.conditions.tideName)}・風${esc(g.windBand)}・潮${l.conditions.current.speed.toFixed(2)}m/s</td>
      <td>Lv${l.level}・${esc(EQUIPMENT[gearThen] ? EQUIPMENT[gearThen].name : '—')}${marks.map((x) => `<span class="tag warn">${esc(x)}</span>`).join('')}</td><td>${l.plan ? esc(l.plan.label) : '—'}</td><td>${esc(END_TEXT[l.endReason] || l.endReason)}</td></tr>`;
    })
    .join('');
  let summary = '';
  if (f.method && f.area) {
    const s = similarLogs(p.logs, { methodId: f.method, area: f.area, forecast: app.forecast, profile: p });
    summary = `<div class="card" style="margin-bottom:10px"><h2>${esc(f.area)}・${esc(METHODS[f.method].name)}の記録（今日の予報：${esc(s.tags.tideClass)}・風${esc(s.tags.windBand)}と比べて）</h2><ul>${s.lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ul></div>`;
  }
  const opt = (v, cur, label) => `<option value="${esc(v)}" ${v === cur ? 'selected' : ''}>${esc(label)}</option>`;
  const reps = p.knowledge.reports.slice().reverse().slice(0, 40);
  const repRows = reps
    .map((r) => {
      const l = reportLine(r, p.day + 1);
      return `<tr><td>${esc(l.who)}</td><td>${esc(l.when)}</td><td>${esc(l.heard)}</td><td>${esc(l.relay)}${esc(r.text)}${l.opinion ? `<div class="note">${esc(l.opinion)}</div>` : ''}</td></tr>`;
    })
    .join('');
  const intr = p.interruptedVoyages.length ? `<p class="note">海上で中断され記録されなかった航海：${p.interruptedVoyages.map((v) => `${v.day}日目`).join('、')}</p>` : '';
  return `<div class="sheet wide"><h1>操業日誌</h1>
  <p class="lead">操業を終えるたびに自動で記録されます（帰港・精算時に保存）。不漁も、装備やレベルも残ります。魚探反応＝操業中に魚探で群れの反応が出ていた割合。</p>
  <div class="actions" style="margin:0 0 10px"><label>漁法 <select data-filter="method">${opt('', f.method, 'すべて')}${Object.values(METHODS).map((m) => opt(m.id, f.method, m.name)).join('')}</select></label>
    <label>場所 <select data-filter="area">${opt('', f.area, 'すべて')}${areas.map((a) => opt(a, f.area, a)).join('')}</select></label>
    <span class="note">漁法と場所を選ぶと、今日の条件に似た記録をまとめます。</span></div>
  ${summary}
  ${logs.length ? `<div class="card table-wrap"><table class="data"><tr><th>日</th><th>時刻</th><th>漁法</th><th>場所</th><th class="num">時間</th><th class="num">漁獲</th><th class="num">重量</th><th class="num">時間あたり</th><th class="num">タナ/深さ</th><th class="num">魚探反応</th><th>海況</th><th>腕前・装備</th><th>狙い</th><th>終了</th></tr>${rows}</table></div>` : '<div class="card"><p class="note">該当する記録がありません。</p></div>'}
  ${intr}
  <div class="card" style="margin-top:12px"><h2>聞いた話の記録（新しい順・最大40件）</h2>${repRows ? `<div class="table-wrap"><table class="data"><tr><th>誰から</th><th>観測</th><th>聞いた</th><th>内容</th></tr>${repRows}</table></div>` : '<p class="note">まだありません。</p>'}</div>
  <div class="actions"><button type="button" class="btn primary" data-act="toPort">港に戻る</button></div></div>`;
}

export function saveScreen(app) {
  const p = app.profile;
  return `<div class="sheet"><h1>セーブ管理</h1>
  <div class="grid"><div class="card"><h2>現在のセーブ</h2>
    ${p ? `<dl class="kv"><dt>日数</dt><dd>${p.day}日目まで</dd><dt>資金</dt><dd>${money(p.funds)}</dd><dt>一本釣り</dt><dd>Lv ${levelFromXp(p.methods.handline.xp)}</dd><dt>曳縄</dt><dd>Lv ${levelFromXp(p.methods.troll.xp)}</dd><dt>操業記録</dt><dd>${p.logs.length}件</dd><dt>聞いた話</dt><dd>${p.knowledge.reports.length}件</dd><dt>保存回数</dt><dd>${app.revision}</dd></dl>` : '<p class="note">プロフィールがありません。</p>'}
    <p class="note">${saveLine(app.saveStatus)}</p>
    <p class="note">このブラウザの保存領域（localStorage）に保存しています。直前のセーブを1つバックアップとして残します。以前の版（M0）のセーブを読み込んだときは、元のデータも別に残しています。ブラウザのデータ消去で消えるため、大事な進行は書き出して保管してください。</p>
    <div class="actions">${p ? '<button type="button" class="btn" data-act="export">セーブを書き出す（JSON）</button>' : ''}</div></div>
  <div class="card"><h2>セーブを読み込む</h2><p class="note">書き出したJSONファイルを読み込みます（M0のセーブも可）。内容を確認してから置き換え、現在のセーブはバックアップに残します。</p>
    <input type="file" id="importFile" accept="application/json,.json">
    <p id="importResult" class="note"></p></div></div>
  <div class="actions"><button type="button" class="btn primary" data-act="${p ? 'toPort' : 'toTitle'}">戻る</button></div></div>`;
}

export function helpModal() {
  return `<div class="card"><h2>操作説明</h2><ul>
  <li><b>W / ↑</b> 増速、<b>S / ↓</b> 減速（後進・停止・微速・半速・全速）</li>
  <li><b>A / ←</b>・<b>D / →</b> 押している間だけ舵を切る</li>
  <li><b>T</b> 漁法の切替（一本釣り／曳縄。積んでいる装備の範囲）</li>
  <li><b>Space</b> 操業開始／回収して終了（一本釣りは停船してから。曳縄は走りながら開始）</li>
  <li><b>R</b> 流し直し（一本釣り：回収→流し始めの地点へ自動で戻って再開）</li>
  <li><b>C</b> 海図の拡大。曳縄のときは拡大した海図をクリックすると航路の経由点を追加、<b>X</b> で航路を消去（操業中でも変更できます）</li>
  <li><b>H</b> 帰港（港まで移動補助。操船すると取り消し）</li>
  <li><b>M</b> 海図に印、<b>F</b> 魚探の表示切替、<b>V</b> 視点切替、<b>1 / 2 / 3</b> 時間の早さ、<b>P</b> 一時停止</li></ul>
  <p class="note">探す・決めるのはあなた、作業は自動。一本釣りは魚探の反応の潮上で止まって流す。曳縄は群れがいそうな場所を通る航路を決める（自動航行は決めた航路を走るだけで、魚を探しに行くことはありません）。表示の切替で海や魚が変わることはありません。</p>
  <div class="actions"><button type="button" class="btn primary" data-act="closeModal">閉じる</button></div></div>`;
}
