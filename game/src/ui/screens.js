// HTML for the menu screens. Pure functions of state -> markup.
import { EQUIPMENT, BOATS, ECONOMY, METHODS, SPECIES, PEERS, CREW, GUIDES, skillForLevel, trollSkillForLevel, longlineSkillForLevel, TIME, fits, sellValue } from '../core/data.js';
import { xpProgress, cycleEstimate, trollCycleEstimate, levelFromXp } from '../core/progress.js';
import { purchasePreview, boatOffers, planBoatPurchase } from '../core/economy.js';
import { forecastText, fmtClock } from '../core/sea.js';
import { reportLine, KIND_LABEL } from '../core/reports.js';
import { similarLogs, todaysReports, timeBandLabel, logTags, opRate, gearOfType, logGearItems, methodGear } from '../core/knowledge.js';

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (n) => `${Math.round(n).toLocaleString('ja-JP')}${ECONOMY.currency}`;
const sec = (s) => `${Math.round(s)}秒`;
const unitOf = (methodId) => SPECIES[METHODS[methodId || 'handline'].target].unit;

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
  <h1>漁師ゲーム <span class="tag">試作 M3</span></h1>
  <p class="lead">仲間の話・自分の日誌・今日の海況から狙いを決め、魚探を頼りに自分で群れとポイントを探す。操業は自動。漁を重ねて手際が上がり、設備で同じ時間により多く獲れるようになる——その核を確かめる試作です。</p>
  <div class="grid">
    <div class="card"><h2>この試作でできること</h2><ul>
      <li>港で「今日の海図」：仲間2人の話（観測した時刻と聞いた時刻つき）、自分の日誌、予報から候補を確認</li>
      <li>一本釣り（アジ）：停船して自動操業、流し直し・移動を判断</li>
      <li>曳縄（サワラ）：航路を決めれば航行と仕掛けの作業は自動（曳縄具の購入が必要）</li>
      <li>漁法ごとのレベル（手際）、電動リール・曳縄具、帰港で自動保存</li>
      <li>船の買い替え（新艇・中古）、装備の付け替え・倉庫・売却、2本仕掛け</li>
      <li>延縄（マダイ）：縄を張って浸け、その間に他の漁もできる。揚げる時機は自分で決める（延縄具の購入が必要）</li>
      <li>甲板を歩いて見て回る（視点切替 V）。持ち場へのショートカット</li>
    </ul></div>
    <div class="card"><h2>まだ無いもの</h2><ul>
      <li>追加の海域・季節の移り変わり、乗組員を雇う仕組み</li>
      <li>海上での途中保存（帰港時のみ保存）</li>
    </ul></div>
  </div>
  ${storageNote ? `<p class="save-bad">${esc(storageNote)}</p>` : ''}
  <p class="note">進行はこのブラウザに保存されます（端末・ブラウザごとに別の進行）。スマホでは画面下のボタンで操作します。横持ちにも対応しています。</p>
  <div class="actions"><button type="button" class="btn primary" data-act="newGame">新しく始める</button>
  <button type="button" class="btn" data-act="openSave">セーブを読み込む</button></div>
  ${playtestCard(null)}
</div>`;
}

/**
 * The playtest save: one button to try the boat purchase with 300,000G, and
 * one button back to the player's own progress (kept aside, never deleted).
 */
export function playtestCard(app) {
  if (app && app.inPlaytest) {
    return `<div class="card playtest"><h2>試遊用セーブで遊んでいます</h2>
    <p class="note">切り替える前の自分の進行は別に残してあります。いつでも戻せます（試遊用セーブでの進行は消えます）。</p>
    <div class="actions"><button type="button" class="btn" data-act="playtestRestore">自分の進行に戻す</button></div></div>`;
  }
  return `<div class="card playtest"><h2>試遊用：資金30万Gで試す</h2>
    <p class="note">船の買い替えや高い装備（ソナー・サイドビュー魚探など）をすぐ試せる進行（小型和船・曳縄具付き・資金300,000G）に切り替えます。${app ? '今の進行は別に残し、あとで「自分の進行に戻す」で戻せます。' : ''}</p>
    <div class="actions"><button type="button" class="btn" data-act="playtestLoad">試遊用セーブ（資金30万G）で遊ぶ</button></div></div>`;
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
  const gearNames = gearOfType(profile, METHODS[c.methodId].gearType).map((id) => EQUIPMENT[id].name);
  const feas = c.feasible.ok ? `<li>装備：可能（${esc(gearNames.join('＋'))}）</li>` : `<li class="warn-text">装備：${esc(c.feasible.reason)}</li>`;
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
  const tc = trollCycleEstimate(tx.level, troll && troll.troll ? troll.troll : undefined);
  const lx = xpProgress(profile.methods.longline.xp);
  const ls = longlineSkillForLevel(lx.level);
  const lineM = 99 * 6;
  const bar = (x) => `<div class="bar"><i style="width:${x.max ? 100 : Math.round((x.into / x.need) * 100)}%"></i></div><p class="note" style="margin:0 0 8px">${x.max ? '最大レベル' : `次のレベルまで ${x.need - x.into} 経験`}</p>`;
  return `<div class="card"><h2>漁師の腕前</h2>
    <dl class="kv"><dt>${esc(METHODS.handline.name)}</dt><dd><b>Lv ${hx.level}</b></dd></dl>${bar(hx)}
    <dl class="kv"><dt>餌付け・準備</dt><dd>${sk.rebait.toFixed(1)}秒</dd><dt>取り込み</dt><dd>${sk.unhook.toFixed(1)}秒/尾</dd><dt>巻上げ</dt><dd>${cyc.retrieveSpeed.toFixed(2)}m/秒</dd><dt>手返し目安</dt><dd>${sec(cyc.total)}/回</dd></dl>
    <dl class="kv" style="margin-top:10px"><dt>${esc(METHODS.troll.name)}</dt><dd><b>Lv ${tx.level}</b></dd></dl>${bar(tx)}
    <dl class="kv"><dt>仕掛けの投入</dt><dd>${ts.deploy.toFixed(0)}秒</dd><dt>やり取り</dt><dd>${ts.fight.toFixed(0)}秒</dd><dt>手繰り</dt><dd>${ts.haul.toFixed(2)}m/秒</dd><dt>1本あたりの手返し</dt><dd>${sec(tc.total)}</dd></dl>
    <dl class="kv" style="margin-top:10px"><dt>${esc(METHODS.longline.name)}</dt><dd><b>Lv ${lx.level}</b></dd></dl>${bar(lx)}
    <dl class="kv"><dt>投縄（約${lineM}m）</dt><dd>${sec(lineM / ls.setSpeed)}</dd><dt>揚げ縄（魚なし）</dt><dd>${sec(lineM / ls.haul)}</dd><dt>取り込み</dt><dd>${ls.unhook.toFixed(0)}秒/枚</dd></dl>
    <p class="note">手返し目安：一本釣りは水深30mで3本針すべてに掛かったとき、曳縄は1本掛かってから仕掛けを出し直すまで。延縄は張る・揚げるのが速いほど、同じ時間に多く浸けられます。魚が少ない場所では腕前の差は小さくなります。</p></div>`;
}

/** Hire a deckhand for today's trip (optional; the fisher can always go alone). */
function crewChoice(app) {
  const can = app.profile.funds >= CREW.wage;
  return `<div class="crew-choice"><label><input type="checkbox" id="hireCrew" ${app.hireCrew && can ? 'checked' : ''} ${can ? '' : 'disabled'}>
    今日は${esc(CREW.label)}を乗せる（日当${money(CREW.wage)}・帰港時に精算）</label>
    <p class="note">手が2人になります。2本の竿・TR-2の4本の取り込みで順番待ちが減り、延縄では${esc(CREW.label)}が魚を外す間も揚げ続けます。1人でも漁はすべてできます。${can ? '' : `（資金が${money(CREW.wage)}以上あるときに雇えます）`}</p></div>`;
}

function boatCard(profile) {
  const model = BOATS[profile.boat.model];
  const slots = model.slots.map((sl) => `<dt>${esc(sl.label)}</dt><dd>${esc(itemOf(profile, sl.id) ? itemOf(profile, sl.id).name : '（空き）')}</dd>`).join('');
  const next = [];
  if (!gearOfType(profile, 'reel').includes('reel_electric')) next.push(EQUIPMENT.reel_electric);
  if (!gearOfType(profile, 'troll').length) next.push(EQUIPMENT.troll_tr1);
  if (!gearOfType(profile, 'longline').length) next.push(EQUIPMENT.longline_ll1);
  else if (!gearOfType(profile, 'hauler').length) next.push(EQUIPMENT.hauler_lh1);
  const goal = next.map((it) => `<p class="note">次の設備：${esc(it.name)}（${money(it.price)}）${profile.funds >= it.price ? '<span class="tag good">購入可能</span>' : ` まであと${money(it.price - profile.funds)}`}</p>`).join('');
  const cheapest = boatOffers(profile).map((o) => o.price - model.tradeIn).sort((a, b) => a - b)[0];
  const boatGoal = cheapest != null ? `<p class="note">船の買い替え：下取り後 ${money(cheapest)} から${profile.funds >= cheapest ? '<span class="tag good">検討できる</span>' : ''}</p>` : '';
  return `<div class="card"><h2>船・装備</h2>
    <dl class="kv"><dt>船名</dt><dd>${esc(profile.boat.name)}</dd><dt>船体</dt><dd>${esc(model.name)}（${model.length}m）</dd><dt>魚倉</dt><dd>${model.holdKg}kg</dd><dt>全速</dt><dd>${(model.speeds[model.steps.full] * 1.944).toFixed(0)}ノット</dd><dt>行ける範囲</dt><dd>${esc(model.range ? model.range.label : '')}</dd>${slots}</dl>
    ${goal}${boatGoal}<div class="actions"><button type="button" class="btn" data-act="equip">装備</button><button type="button" class="btn" data-act="market">船の買い替え</button></div></div>`;
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
        <p class="note">● 水揚げ ◎ 魚探の反応 △ 目撃 × 反応なし（仲間が観測した地点・時刻。今の魚の位置ではありません）　A〜D 候補${(p.marks || []).length ? '　黄色は自分の印（▲現在地 ■魚探 ◆左右 ✚ソナー）' : ''}</p>
        <div class="actions"><button type="button" class="btn small" data-act="marks">自分の印の一覧（${(p.marks || []).length}）</button></div></div>
      <div class="cands">${cands.map((c) => candidateCard(c, today, p)).join('')}</div>
    </div>
    ${crewChoice(app)}
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
  <p class="note">保存は「帰港して水揚げしたとき」「装備を買ったとき」「港で仲間の話を聞いたとき」に自動で行います。海上では数秒ごとに途中経過も保存するので、海上でページを閉じても、次に開いたときに海上から続けられます（別の端末やブラウザでは続けられず、その航海は中断扱いになります）。</p>
</div>`;
}

export function receiptScreen(app) {
  const r = app.receipt;
  const rows = r.lines.map((l) => `<tr><td>${esc(SPECIES[l.species].name)}／${esc(l.label)}</td><td class="num">${l.count}${SPECIES[l.species].unit}</td><td class="num">${l.kg.toFixed(2)}kg</td><td class="num">${l.unitPrice}${ECONOMY.currency}/kg</td><td class="num">${money(l.amount)}</td></tr>`).join('') || '<tr><td colspan="5" class="note">水揚げなし</td></tr>';
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
      } else if (lvUp && mId === 'longline') {
        const a = longlineSkillForLevel(x.levelBefore);
        const b = longlineSkillForLevel(x.levelAfter);
        growth = `<table class="data"><tr><th>項目</th><th class="num">前</th><th class="num">後</th></tr>
        <tr><td>投縄（約594m）</td><td class="num">${sec(594 / a.setSpeed)}</td><td class="num up">${sec(594 / b.setSpeed)}</td></tr>
        <tr><td>揚げ縄（魚なし）</td><td class="num">${sec(594 / a.haul)}</td><td class="num up">${sec(594 / b.haul)}</td></tr>
        <tr><td>取り込み</td><td class="num">${a.unhook.toFixed(0)}秒/枚</td><td class="num up">${b.unhook.toFixed(0)}秒/枚</td></tr></table>`;
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
    <div class="card full"><h2>売上</h2><div class="table-wrap"><table class="data"><tr><th>区分</th><th class="num">数</th><th class="num">重量</th><th class="num">単価</th><th class="num">金額</th></tr>${rows}
      <tr><th colspan="4">売上合計</th><th class="num">${money(r.sales)}</th></tr></table></div>
      <dl class="kv" style="margin-top:8px"><dt>氷・餌（定額）</dt><dd>−${money(r.costs.base)}</dd><dt>燃料（${(r.distanceM / 1000).toFixed(1)}km）</dt><dd>−${money(r.costs.fuel)}</dd>${r.costs.crew ? `<dt>${esc(CREW.label)}の日当</dt><dd>−${money(r.costs.crew)}</dd>` : ''}
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
  return `<div class="table-wrap"><table class="data wrap"><tr><th>効果</th><th class="num">現在</th><th class="num">購入後</th></tr>
  <tr><td>巻上げ速度</td><td class="num">${c30a.retrieveSpeed.toFixed(2)}m/秒</td><td class="num up">${c30b.retrieveSpeed.toFixed(2)}m/秒</td></tr>
  <tr><td>対応水深</td><td class="num">${a.maxDepth}m</td><td class="num up">${b.maxDepth}m</td></tr>
  <tr><td>手返し目安 水深30m</td><td class="num">${sec(c30a.total)}</td><td class="num up">${sec(c30b.total)}</td></tr>
  <tr><td>手返し目安 水深50m</td><td class="num">${sec(c50a.total)}</td><td class="num up">${sec(c50b.total)}</td></tr></table></div>`;
}

function trollEffect(item) {
  const t = item.troll;
  return `<div class="table-wrap"><table class="data wrap"><tr><th>効果</th><th class="num">取り付け後</th></tr>
  <tr><td>できる漁</td><td class="num up">曳縄（サワラ）</td></tr>
  <tr><td>仕掛け</td><td class="num">${t.lines}本</td></tr>
  <tr><td>潜行板の深さ</td><td class="num">${t.lureDepths.join('・')}m</td></tr>
  <tr><td>曳く速さ</td><td class="num">約${(t.towSpeed * 1.944).toFixed(0)}ノット</td></tr></table></div>`;
}

/** What an upgrade changes and where to notice it (GUIDES), as a short block. */
export function guideHtml(itemId, compact = false) {
  const g = GUIDES[itemId];
  if (!g) return '';
  const li = (xs) => xs.map((x) => `<li>${esc(x)}</li>`).join('');
  return `<div class="guide"><h3>何が変わるか</h3><ul>${li(g.changes || [])}</ul>${!compact && g.inPlay ? `<h3>遊びでの見どころ</h3><ul>${li(g.inPlay)}</ul>` : ''}${g.note ? `<p class="note">${esc(g.note)}</p>` : ''}</div>`;
}

/** Side by side: the same example water through the current and the new sounder. */
function sounderDemo(cur, item) {
  return `<div class="sdemo-wrap"><h3>同じ海を通ったときの見え方（例）</h3>
    <div class="sdemo"><figure><canvas data-sdemo="${esc(cur.id)}"></canvas><figcaption>今：${esc(cur.name)}</figcaption></figure>
    <figure><canvas data-sdemo="${esc(item.id)}"></canvas><figcaption>取り付け後：${esc(item.name)}</figcaption></figure></div>
    <p class="note">例の海（船は左から右へ毎秒1mで180秒通過）：左に底から6mのアジの群れ、中ほどに上のほうの小さな群れ、右に底へ薄く散ったマダイ。ES-2では右のマダイの薄い反応と、群れの上下の形が見えるようになる。</p></div>`;
}

function haulerEffect(profile, item) {
  const lv = levelFromXp(profile.methods.longline.xp);
  const hand = longlineSkillForLevel(lv).haul;
  const m = item.hauler.haul;
  return `<div class="table-wrap"><table class="data wrap"><tr><th>効果（延縄Lv${lv}）</th><th class="num">手で揚げる</th><th class="num">取り付け後</th></tr>
  <tr><td>揚げ縄の速さ</td><td class="num">${hand.toFixed(2)}m/秒</td><td class="num up">${m.toFixed(1)}m/秒</td></tr>
  <tr><td>約594mを揚げる時間（魚なし）</td><td class="num">${sec(594 / hand)}</td><td class="num up">${sec(594 / Math.max(hand, m))}</td></tr>
  <tr><td>魚を外す</td><td class="num">手作業</td><td class="num">手作業（変わらない）</td></tr></table></div>
  ${gearOfType(profile, 'longline').length ? '' : '<p class="note">延縄具がないと使い道はありません。</p>'}`;
}

function longlineEffect(item) {
  const l = item.longline;
  return `<div class="table-wrap"><table class="data wrap"><tr><th>効果</th><th class="num">取り付け後</th></tr>
  <tr><td>できる漁</td><td class="num up">延縄（マダイ）</td></tr>
  <tr><td>針の数</td><td class="num">${l.hooks}本（${l.spacing}m間隔）</td></tr>
  <tr><td>縄の長さ</td><td class="num">約${(l.hooks - 1) * l.spacing}m</td></tr>
  <tr><td>張れる水深</td><td class="num">${METHODS.longline.minDepth}〜${l.maxDepth}m</td></tr></table></div>`;
}

function sounderEffect(cur, item) {
  const a = cur.sounder;
  const b = item.sounder;
  return `<div class="table-wrap"><table class="data wrap"><tr><th>効果</th><th class="num">現在</th><th class="num">取り付け後</th></tr>
  <tr><td>ビームの幅（狭いほど反応を分けて映す）</td><td class="num">${a.halfAngleDeg * 2}°</td><td class="num up">${b.halfAngleDeg * 2}°</td></tr>
  <tr><td>表示の細かさ</td><td class="num">${a.binSize}m</td><td class="num up">${b.binSize}m</td></tr>
  <tr><td>探れる深さ</td><td class="num">${a.maxRange}m</td><td class="num up">${b.maxRange}m</td></tr>
  <tr><td>弱い反応</td><td class="num">${a.gainK >= 800 ? 'よく拾う' : '標準'}</td><td class="num ${b.gainK > a.gainK ? 'up' : ''}">${b.gainK >= 800 ? 'よく拾う' : '標準'}</td></tr>
  <tr><td>反応の深さの数字</td><td class="num">${a.readout ? 'あり' : 'なし'}</td><td class="num ${b.readout && !a.readout ? 'up' : ''}">${b.readout ? 'あり' : 'なし'}</td></tr>
  <tr><td>左右の帯（サイドビュー）</td><td class="num">${a.side ? `左右${a.side.range}m` : 'なし'}</td><td class="num ${b.side && !a.side ? 'up' : ''}">${b.side ? `左右${b.side.range}mずつ` : 'なし'}</td></tr>
  <tr><td>デプスマッピング</td><td class="num">${a.mapping ? 'あり' : 'なし'}</td><td class="num ${b.mapping && !a.mapping ? 'up' : ''}">${b.mapping ? 'あり（10mごと）' : 'なし'}</td></tr></table></div>`;
}

/** Which boat model has a slot this item fits (for "not on this boat" notes). */
function whereItFits(item) {
  const out = [];
  for (const m of Object.values(BOATS)) for (const sl of m.slots) if (fits(item, sl)) out.push(`${m.name}の${sl.label}`);
  return out;
}

export function equipScreen(app) {
  const p = app.profile;
  const model = BOATS[p.boat.model];
  const level = levelFromXp(p.methods.handline.xp);
  const fitsHere = (it) => model.slots.some((sl) => fits(it, sl));
  const slotCards = model.slots
    .map((slot) => {
      const cur = itemOf(p, slot.id);
      const offers = Object.values(EQUIPMENT).filter((it) => fits(it, slot) && (!cur || it.id !== cur.id) && it.price > 0);
      const offerHtml = offers
        .map((it) => {
          const pv = purchasePreview(p, it.id, slot.id);
          const cmp = it.type === 'reel' ? reelCompare(level, cur ? cur.id : 'reel_hand', it.id) : it.type === 'troll' ? trollEffect(it) : it.type === 'longline' ? longlineEffect(it) : it.type === 'hauler' ? haulerEffect(p, it) : it.type === 'sounder' && cur ? sounderEffect(cur, it) : '';
          const demo = it.type === 'sounder' && cur ? sounderDemo(cur, it) : '';
          return `<div class="card offer"><h2>${esc(it.name)} <span class="tag">${money(it.price)}</span></h2><p class="note">${esc(it.desc)}</p>${cmp}${demo}${guideHtml(it.id)}
          <dl class="kv" style="margin-top:8px"><dt>支払総額</dt><dd>${money(it.price)}</dd><dt>購入後の資金</dt><dd>${money(Math.max(0, pv.fundsAfter))}</dd><dt>外す装備</dt><dd>${cur ? `${esc(cur.name)} → 倉庫` : 'なし（空きの取付位置）'}</dd></dl>
          <div class="actions"><button type="button" class="btn primary" data-act="buy" data-item="${esc(it.id)}" data-slot="${esc(slot.id)}" ${pv.ok ? '' : 'disabled'}>購入して取り付ける</button>${pv.ok ? '' : `<span class="note">${esc(pv.reason)}</span>`}</div></div>`;
        })
        .join('');
      const stored = p.storage.filter((x) => fits(EQUIPMENT[x.itemId], slot) && (!cur || x.itemId !== cur.id));
      const storedHtml = stored.map((x) => `<div class="actions"><span>${esc(EQUIPMENT[x.itemId].name)}（倉庫）</span><button type="button" class="btn" data-act="equipStored" data-uid="${esc(x.uid)}" data-slot="${esc(slot.id)}">ここに付ける</button></div>`).join('');
      const unmount = cur && slot.optional ? `<button type="button" class="btn" data-act="unmount" data-slot="${esc(slot.id)}">外して倉庫へ</button>` : '';
      return `<div class="card"><h2>${esc(slot.label)}</h2><p><b>${esc(cur ? cur.name : '（空き）')}</b></p><p class="note">${esc(cur ? cur.desc : 'この位置に対応する装備を取り付けられます。')}</p>
        ${unmount ? `<div class="actions">${unmount}</div>` : ''}${storedHtml}${offerHtml}</div>`;
    })
    .join('');
  const storage = p.storage.length
    ? `<div class="card full"><h2>倉庫</h2><div class="table-wrap"><table class="data wrap"><tr><th>装備</th><th>付けられる位置（この船）</th><th class="num">売値</th><th></th></tr>${p.storage
        .map((x) => {
          const it = EQUIPMENT[x.itemId];
          const where = model.slots.filter((sl) => fits(it, sl)).map((sl) => sl.label);
          return `<tr><td>${esc(it.name)}</td><td>${where.length ? esc(where.join('・')) : `<span class="tag warn">この船には付けられる位置がない</span> <span class="note">${esc(whereItFits(it).join('・'))}なら可</span>`}</td><td class="num">${money(sellValue(it))}</td><td><button type="button" class="mini" data-act="sell" data-uid="${esc(x.uid)}">売る</button></td></tr>`;
        })
        .join('')}</table></div><p class="note">倉庫の装備はなくなりません。売ると記載の金額が資金に入り、倉庫から消えます。</p></div>`
    : '';
  const others = Object.values(EQUIPMENT).filter((it) => it.price > 0 && !fitsHere(it));
  const otherHtml = others.length
    ? `<div class="card full"><h2>この船には付けられない装備</h2><ul>${others.map((it) => `<li><b>${esc(it.name)}</b>（${money(it.price)}）：${esc(whereItFits(it).join('・'))}に付けられる。${esc(it.desc)}</li>`).join('')}</ul>
      <div class="actions"><button type="button" class="btn" data-act="market">船の買い替えを見る</button></div></div>`
    : '';
  return `<div class="sheet"><h1>装備</h1>
  <p class="lead">${esc(p.boat.name)}（${esc(model.name)}）。装備は船体に決められた取付位置へ付けます。外した装備は倉庫に残り、別の位置へ付け直したり売ったりできます。資金：<b>${money(p.funds)}</b></p>
  <div class="grid">${slotCards}${storage}${otherHtml}</div>
  <p class="note">${saveLine(app.saveStatus)}</p>
  <div class="actions"><button type="button" class="btn primary" data-act="toPort">港に戻る</button><button type="button" class="btn" data-act="market">船の買い替え</button></div></div>`;
}

function boatSpecRows(cur, next) {
  const row = (label, a, b, better) => `<tr><td>${label}</td><td class="num">${a}</td><td class="num ${better ? 'up' : ''}">${b}</td></tr>`;
  const reelSlots = (m) => m.slots.filter((sl) => sl.accepts.includes('reel')).length;
  const has = (m, mount) => (m.slots.some((sl) => sl.accepts.includes(mount)) ? '可' : '不可');
  const kt = (m) => `${(m.speeds[m.steps.full] * 1.944).toFixed(0)}ノット`;
  return `<div class="table-wrap"><table class="data wrap spec"><tr><th>性能（表示どおり）</th><th class="num">今の船</th><th class="num">この船</th></tr>
    ${row('全長', `${cur.length}m`, `${next.length}m`, false)}
    ${row('魚倉', `${cur.holdKg}kg`, `${next.holdKg}kg`, next.holdKg > cur.holdKg)}
    ${row('全速', kt(cur), kt(next), next.speeds[next.steps.full] > cur.speeds[cur.steps.full])}
    ${row('燃料', `${cur.fuelPerKm}G/km`, `${next.fuelPerKm}G/km`, next.fuelPerKm < cur.fuelPerKm)}
    ${row('一本釣りの竿受け', `${reelSlots(cur)}か所`, `${reelSlots(next)}か所`, reelSlots(next) > reelSlots(cur))}
    ${row('大型の魚探（ES-2・SV-1）', has(cur, 'sounder_l'), has(next, 'sounder_l'), has(next, 'sounder_l') === '可' && has(cur, 'sounder_l') !== '可')}
    ${row('アウトリガー（TR-2）', has(cur, 'troll_l'), has(next, 'troll_l'), has(next, 'troll_l') === '可' && has(cur, 'troll_l') !== '可')}
    ${row('行ける範囲', esc(cur.range.label), esc(next.range.label), cur.range.maxY != null && next.range.maxY == null)}
    ${row('風での流されやすさ', `${Math.round(cur.windage * 1000) / 10}%`, `${Math.round(next.windage * 1000) / 10}%`, next.windage < cur.windage)}</table></div>`;
}

export function marketScreen(app) {
  const p = app.profile;
  const cur = BOATS[p.boat.model];
  const cards = boatOffers(p)
    .map((o) => {
      const m = BOATS[o.model];
      const plan = planBoatPurchase(p, o.id);
      const inc = Object.entries(o.included).map(([slotId, itemId]) => `${m.slots.find((x) => x.id === slotId).label}：${EQUIPMENT[itemId].name}`);
      return `<div class="card"><h2>${esc(o.title)} <span class="tag ${o.kind === 'new' ? 'good' : ''}">${o.kind === 'new' ? '新艇' : '中古'}</span></h2>
        <p class="note">${esc(o.note)}</p>
        ${boatSpecRows(cur, m)}
        <p class="note">付属の装備：${inc.length ? esc(inc.join('、')) : 'なし（今の装備を移す）'}</p>
        <dl class="kv"><dt>本体価格</dt><dd>${money(o.price)}</dd><dt>下取り（今の${esc(cur.name)}）</dt><dd>−${money(cur.tradeIn)}</dd><dt>差引の支払い</dt><dd><b>${money(plan.payable)}</b></dd></dl>
        <div class="actions"><button type="button" class="btn ${plan.ok ? 'primary' : ''}" data-act="boatQuote" data-offer="${esc(o.id)}">見積もりと装備の行き先を見る</button>${plan.ok ? '' : `<span class="note">${esc(plan.reason)}</span>`}</div></div>`;
    })
    .join('');
  return `<div class="sheet"><h1>船の買い替え</h1>
  <p class="lead">使う船は一隻だけです。買い替えると今の船は下取りに出し、付けていた装備は新しい船の合う位置へ移すか、倉庫に入れます。中古船も性能は表示どおりで、隠れた故障はありません（安い代わりに前の持ち主の装備付き）。資金：<b>${money(p.funds)}</b></p>
  <div class="card" style="margin-bottom:12px"><h2>今の船：${esc(p.boat.name)}（${esc(cur.name)}）</h2>
    <p class="note">${cur.slots.map((sl) => `${sl.label}：${itemOf(p, sl.id) ? itemOf(p, sl.id).name : '空き'}`).map(esc).join('／')}</p></div>
  <div style="margin-bottom:12px">${playtestCard(app)}</div>
  <div class="grid">${cards}</div>
  <div class="actions"><button type="button" class="btn primary" data-act="toPort">港に戻る</button><button type="button" class="btn" data-act="equip">装備</button></div></div>`;
}

/** Full quote: what is paid and where every item goes, before confirming. */
export function boatQuoteModal(profile, offerId) {
  const plan = planBoatPurchase(profile, offerId);
  const m = BOATS[plan.offer.model];
  const moves = plan.moves
    .map((mv) => `<tr><td>${esc(EQUIPMENT[mv.itemId].name)}</td><td>${esc(mv.from)}</td><td>${mv.to ? esc(mv.toLabel) : `<span class="tag warn">倉庫</span> <span class="note">${esc(mv.why)}</span>`}</td></tr>`)
    .join('');
  const extra = [
    ...plan.included.map((x) => `<tr><td>${esc(EQUIPMENT[x.itemId].name)}</td><td>付属（${esc(plan.offer.kind === 'used' ? '前の持ち主の装備' : '新艇')}）</td><td>新しい船の${esc(x.label)}</td></tr>`),
    ...plan.standard.map((x) => `<tr><td>${esc(EQUIPMENT[x.itemId].name)}</td><td>標準装備（合う魚探がないため）</td><td>新しい船の${esc(m.slots.find((s) => s.id === x.slotId).label)}</td></tr>`),
  ].join('');
  return `<div class="card quote"><h2>見積もり：${esc(plan.offer.title)}</h2>
    <dl class="kv"><dt>本体価格</dt><dd>${money(plan.price)}</dd><dt>下取り（今の船）</dt><dd>−${money(plan.tradeIn)}</dd><dt>支払総額</dt><dd><b>${money(plan.payable)}</b></dd><dt>購入後の資金</dt><dd><b>${money(plan.fundsAfter)}</b></dd></dl>
    <h3>装備の行き先</h3>
    <div class="table-wrap"><table class="data wrap"><tr><th>装備</th><th>今</th><th>買い替え後</th></tr>${moves}${extra}</table></div>
    <p class="note">倉庫に入った装備はなくならず、あとで付け直したり売ったりできます。船名「${esc(profile.boat.name)}」は新しい船に引き継ぎます。</p>
    <div class="actions"><button type="button" class="btn primary" data-act="buyBoatConfirm" data-offer="${esc(offerId)}" ${plan.ok ? '' : 'disabled'}>この内容で買い替える</button><button type="button" class="btn" data-act="closeModal">やめる</button>${plan.ok ? '' : `<span class="note">${esc(plan.reason)}</span>`}</div></div>`;
}

const END_TEXT = { player: '終了', redrift: '流し直し', return: '帰港', day_end: '時間切れ', hold_full: '魚倉満杯', move: '移動', haul: '揚げ縄へ' };

export function logScreen(app) {
  const p = app.profile;
  const f = app.logFilter || { method: '', area: '' };
  const areas = [...new Set(p.logs.map((l) => l.area))];
  const gearSig = (boat, items) => `${boat}:${items.join('+')}`;
  const nowSig = (m) => gearSig(p.boat.model, methodGear(p, m));
  const logs = p.logs.filter((l) => (!f.method || (l.methodId || 'handline') === f.method) && (!f.area || l.area === f.area)).slice().reverse();
  const rows = logs
    .map((l) => {
      const m = l.methodId || 'handline';
      const g = logTags(l);
      const thenItems = logGearItems({ ...l, methodId: m });
      const thenBoat = l.gear.boat || 'skiff_1';
      const lvNow = levelFromXp(p.methods[m].xp);
      const marks = [];
      if (gearSig(thenBoat, thenItems) !== nowSig(m)) marks.push('船・装備が今と違う');
      if (Math.abs(lvNow - l.level) >= 2) marks.push(`当時Lv${l.level}`);
      return `<tr><td>${l.day}日目</td><td>${fmtClock(l.startT)}–${fmtClock(l.endT)}<div class="note">${esc(timeBandLabel(g.timeBand))}</div></td><td>${esc(METHODS[m].name)}</td><td>${esc(l.area)}</td><td class="num">${Math.round(l.durationS / 60)}分</td>
      <td class="num">${l.count === 0 ? '<span class="tag">この時間に漁獲なし</span>' : `${l.count}${unitOf(m)}`}</td><td class="num">${l.kg.toFixed(1)}kg</td><td class="num">${opRate(l).toFixed(0)}${unitOf(m)}/時</td>
      <td class="num">${l.tana.min != null ? `${l.tana.min.toFixed(0)}–${l.tana.max.toFixed(0)}m` : '—'}${l.longline ? `<div class="note">浸け${l.longline.soakMin}分</div>` : ''}</td><td class="num">${Math.round(l.sounder.echoRatio * 100)}%</td><td>${esc(l.conditions.tideName)}・風${esc(g.windBand)}・潮${l.conditions.current.speed.toFixed(2)}m/s</td>
      <td>Lv${l.level}・${esc(BOATS[thenBoat] ? BOATS[thenBoat].name : thenBoat)}・${esc(thenItems.map((id) => (EQUIPMENT[id] ? EQUIPMENT[id].name : id)).join('＋') || '—')}${l.crew ? `＋${esc(CREW.label)}` : ''}${marks.map((x) => `<span class="tag warn">${esc(x)}</span>`).join('')}</td><td>${l.plan ? esc(l.plan.label) : '—'}</td><td>${esc(END_TEXT[l.endReason] || l.endReason)}</td></tr>`;
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
  const exportBtn = app.hosted
    ? '<button type="button" class="btn" data-act="copySave">セーブをコピー（文字列）</button>'
    : '<button type="button" class="btn" data-act="export">セーブを書き出す（JSON）</button><button type="button" class="btn" data-act="copySave">文字列としてコピー</button>';
  return `<div class="sheet"><h1>セーブ管理</h1>
  <div class="grid"><div class="card"><h2>現在のセーブ</h2>
    ${p ? `<dl class="kv"><dt>日数</dt><dd>${p.day}日目まで</dd><dt>資金</dt><dd>${money(p.funds)}</dd><dt>一本釣り</dt><dd>Lv ${levelFromXp(p.methods.handline.xp)}</dd><dt>曳縄</dt><dd>Lv ${levelFromXp(p.methods.troll.xp)}</dd><dt>延縄</dt><dd>Lv ${levelFromXp(p.methods.longline.xp)}</dd><dt>操業記録</dt><dd>${p.logs.length}件</dd><dt>聞いた話</dt><dd>${p.knowledge.reports.length}件</dd><dt>保存回数</dt><dd>${app.revision}</dd></dl>` : '<p class="note">プロフィールがありません。</p>'}
    <p class="note">${saveLine(app.saveStatus)}</p>
    <p class="note">このブラウザの保存領域（localStorage）に保存しています。直前のセーブを1つバックアップとして残します。以前の版（M0）のセーブを読み込んだときは、元のデータも別に残しています。ブラウザのデータ消去で消えるため、大事な進行は書き出して保管してください。</p>
    ${app.hosted ? '<p class="note">この公開ページではファイルのダウンロードができないため、セーブは文字列としてコピーして保管してください（メモアプリなどに貼り付け）。</p>' : ''}
    <div class="actions">${p ? exportBtn : ''}</div></div>
  <div class="card"><h2>セーブを読み込む</h2><p class="note">書き出したJSONファイルを読み込みます（M0のセーブも可）。内容を確認してから置き換え、現在のセーブはバックアップに残します。</p>
    <input type="file" id="importFile" accept="application/json,.json">
    <p class="note" style="margin-top:12px">または、コピーしておいたセーブの文字列を貼り付けて読み込む：</p>
    <textarea class="paste" id="pasteArea" placeholder="ここに貼り付け"></textarea>
    <div class="actions"><button type="button" class="btn" data-act="importPaste">貼り付けた内容を読み込む</button></div>
    <p id="importResult" class="note"></p></div>
  ${p ? playtestCard(app) : ''}</div>
  <div class="actions"><button type="button" class="btn primary" data-act="${p ? 'toPort' : 'toTitle'}">戻る</button></div></div>`;
}

export function helpModal() {
  return `<div class="card"><h2>操作説明</h2><ul>
  <li><b>W / ↑</b> 増速、<b>S / ↓</b> 減速（後進・停止・極微速・微速・半速・全速）</li>
  <li><b>A / ←</b>・<b>D / →</b> 押している間だけ舵を切る</li>
  <li><b>T</b> 漁法の切替（一本釣り／曳縄。積んでいる装備の範囲）</li>
  <li><b>Space</b> 操業開始／回収して終了（一本釣りは停船してから。曳縄は走りながら開始）</li>
  <li><b>R</b> 流し直し（一本釣り：回収→流し始めの地点へ自動で戻って再開）</li>
  <li><b>C</b> 海図の拡大。拡大した海図をクリックすると航路の経由点を追加（曳縄は曳く航路、延縄は縄を張る向き、ほかは移動の行き先）、<b>X</b> で航路を消去</li>
  <li><b>H</b> 帰港（港まで移動補助。操船すると取り消し）</li>
  <li><b>G</b> 航路で移動：拡大した海図をクリックして経由点（行き先）を置き、G でその順に走って終点で止まる（どの漁法でも。操船すると取り消し）</li>
  <li><b>L</b> 揚げ縄（延縄：縄を浸けているとき。遠ければブイまで移動補助で向かってから揚げる）</li>
  <li><b>M</b> 海図に印、<b>F</b> 魚探の表示切替、<b>V</b> 視点切替（操船 → 作業 → 甲板を歩く）、<b>1 / 2 / 3</b> 時間の早さ、<b>P</b> 一時停止</li>
  <li><b>印</b>：<b>M</b> で現在地に印。魚探・サイドビュー・ソナーの画面をタップ（クリック）すると、その反応の位置に印。<b>K</b>（海図の「印」）で印の一覧：名前・メモ・消す・海図で見る・「ここへ」（その印へまっすぐ移動）。印は帰港すると残り、翌日以降の海図と港の海図にも出ます。</li>
  <li><b>O</b> ソナー（積んでいるとき）。魚探パネルの「左右」でサイドビュー（サイドビュー魚探のとき）。</li>
  <li><b>甲板を歩く</b>：W/S で前後、A/D で向き。画面の持ち場ボタン（操舵席・右舷・船尾・魚倉など）で移動。操業中は釣り人が持ち場で作業するので歩けません。歩いても海や漁獲は変わりません。</li>
  <li><b>スマホ</b>：画面下のボタンで同じ操作ができます。舵のボタンは押している間だけ効きます。曳縄の航路は、海図の「拡大」を押してから海図をタップ。</li></ul>
  <p class="note">探す・決めるのはあなた、作業は自動。一本釣りは魚探の反応の潮上で止まって流す。曳縄は群れがいそうな場所を通る航路を決める（自動航行は決めた航路を走るだけで、魚を探しに行くことはありません）。表示の切替で海や魚が変わることはありません。</p>
  <div class="actions"><button type="button" class="btn primary" data-act="closeModal">閉じる</button></div></div>`;
}

// ---------------------------------------------------------------- the player's marks (印)
const KIND_ICON = { manual: '▲', sounder: '■', side: '◆', sonar: '✚' };

/**
 * The list of marks (saved and, at sea, today's): name, how it was made, when,
 * the depths read then, distance/bearing from the boat; rename, memo, delete,
 * and at sea a straight run to it. `editKey` opens the form for one row,
 * `delKey` asks before deleting one.
 */
export function marksList(rows, { atSea = false, editKey = null, delKey = null, kinds = {}, limits = {} } = {}) {
  const fmtDay = (r) => (r.source === 'voyage' ? '今日' : `${r.day}日目`);
  const body = rows.length
    ? rows
        .map((r) => {
          const kind = kinds[r.kind] ? kinds[r.kind].label : '印';
          const depths = [r.depth != null ? `水深${r.depth}m` : '', r.echo != null ? `反応${Math.round(r.echo)}m` : ''].filter(Boolean).join('・');
          const where = atSea && r.dist != null ? `<span class="mk-dist">${r.dist >= 1000 ? `${(r.dist / 1000).toFixed(1)}km` : `${Math.round(r.dist)}m`} ${r.bearing.name}</span>` : '';
          let tail = '';
          if (editKey === r.key) {
            tail = `<div class="mk-form"><label>名前 <input type="text" id="markName" maxlength="${limits.name || 16}" value="${esc(r.name)}" placeholder="${esc(r.title)}"></label>
              <label>メモ <input type="text" id="markMemo" maxlength="${limits.memo || 60}" value="${esc(r.memo)}" placeholder="例：朝、底から5mに反応"></label>
              <div class="actions"><button type="button" class="btn primary small" data-act="markSave" data-key="${esc(r.key)}">保存</button><button type="button" class="btn small" data-act="marks">やめる</button></div></div>`;
          } else if (delKey === r.key) {
            tail = `<div class="mk-form"><p>「${esc(r.title)}」を消します。元に戻せません。</p><div class="actions"><button type="button" class="btn warn small" data-act="markDelYes" data-key="${esc(r.key)}">消す</button><button type="button" class="btn small" data-act="marks">やめる</button></div></div>`;
          }
          return `<li class="mk-row${r.source === 'voyage' ? ' today' : ''}" data-key="${esc(r.key)}">
            <div class="mk-main"><span class="mk-icon" title="${esc(kind)}">${KIND_ICON[r.kind] || '▲'}</span><b>${esc(r.title)}</b> <span class="sub">${esc(kind)}・${fmtDay(r)} ${fmtClock(r.t)}${depths ? `・${depths}` : ''}</span> ${where}</div>
            ${r.memo ? `<div class="mk-memo">${esc(r.memo)}</div>` : ''}
            <div class="mk-acts">${atSea ? `<button type="button" class="btn small" data-act="markGo" data-key="${esc(r.key)}" title="この印へまっすぐ移動（移動補助）">ここへ</button>` : ''}<button type="button" class="btn small" data-act="markShow" data-key="${esc(r.key)}">海図で見る</button><button type="button" class="btn small" data-act="markEdit" data-key="${esc(r.key)}">名前・メモ</button><button type="button" class="btn small" data-act="markDel" data-key="${esc(r.key)}">消す</button></div>
            ${tail}</li>`;
        })
        .join('')
    : '<li class="note">まだ印がありません。海で M（現在地）、魚探・サイドビュー・ソナーの画面のタップで付けられます。</li>';
  return `<div class="card marks-card"><h2>自分の印 <span class="tag">${rows.length}</span></h2>
    <p class="note">印は見たときの位置・時刻・水深の記録です（今そこに魚がいるとは限りません）。帰港すると残り、翌日以降の海図と港の海図にも出ます。${atSea ? '開いている間、海は止まっています。' : ''}</p>
    <ul class="mk-list">${body}</ul>
    <div class="actions"><button type="button" class="btn" data-act="closeModal">閉じる</button></div></div>`;
}
