// 手引き（R10）: a chaptered manual that can be opened at any time — in port or
// at sea — with figures. Tables are built from the game's own data (the
// season of each fish, how it feeds), and the sounder pictures are drawn with
// the game's own sounder (echoExamples.js), so the manual never drifts from
// the game. It only reads data; it never touches the simulation.
import { SPECIES, SEASONALITY, FEEDING, METHODS, EQUIPMENT, LONGLINE_LINES, PEERS } from '../core/data.js';
import { WATER_TEMP_MONTHLY } from '../core/sea.js';
import { ECHO_EXAMPLES } from './echoExamples.js';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const MONTHS = ['4', '5', '6', '7', '8', '9', '10', '11', '12', '1', '2', '3'];
const money = (n) => `${n.toLocaleString('ja-JP')}G`;

/** A small figure: the boat drifts down-tide across a school (why you stop up-tide of it). */
function driftFigure() {
  return `<svg class="mfig" viewBox="0 0 320 150" role="img" aria-label="潮上で止めて群れの上を流す図">
  <rect width="320" height="150" rx="8" fill="#0d2238"/>
  <defs><marker id="ar" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="#7fd3ff"/></marker>
  <marker id="ay" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="#ffd84d"/></marker></defs>
  <text x="12" y="20" fill="#7fd3ff" font-size="12">潮の流れ →</text>
  <line x1="12" y1="30" x2="300" y2="30" stroke="#7fd3ff" stroke-width="2" marker-end="url(#ar)" opacity=".6"/>
  <ellipse cx="190" cy="95" rx="55" ry="26" fill="#e0782f" opacity=".75"/><text x="168" y="99" fill="#fff" font-size="12">群れ</text>
  <path d="M60 90 l10 -6 l10 6 l-3 14 h-14 z" fill="#fff"/><text x="40" y="128" fill="#fff" font-size="11">ここで止める（潮上）</text>
  <line x1="84" y1="96" x2="268" y2="96" stroke="#ffd84d" stroke-width="2" stroke-dasharray="5 4" marker-end="url(#ay)"/>
  <text x="200" y="135" fill="#ffd84d" font-size="11">流されながら群れの上を通る</text></svg>`;
}

/** The tidal stream through half a cycle, with the four phases the fish feel. */
function tideFigure() {
  const pts = [];
  for (let i = 0; i <= 60; i++) {
    const x = 20 + i * 4.6;
    const y = 110 - Math.abs(Math.sin((i / 60) * Math.PI)) * 70;
    pts.push(`${x.toFixed(1)},${y.toFixed(1)}`);
  }
  const lab = (x, t, c) => `<text x="${x}" y="134" fill="${c}" font-size="11" text-anchor="middle">${t}</text>`;
  return `<svg class="mfig" viewBox="0 0 320 145" role="img" aria-label="潮の流れの強さと4つの局面">
  <rect width="320" height="145" rx="8" fill="#0d2238"/>
  <text x="12" y="18" fill="#9fb3c8" font-size="11">潮流の速さ（約6時間）</text>
  <polyline points="${pts.join(' ')}" fill="none" stroke="#7fd3ff" stroke-width="2.5"/>
  <line x1="20" y1="110" x2="296" y2="110" stroke="#4a6077"/>
  ${lab(26, '止まり', '#f0a07a')}${lab(80, '動き始め', '#7fe3a3')}${lab(158, '効いている', '#7fd3ff')}${lab(236, '緩み始め', '#ffd84d')}${lab(294, '止まり', '#f0a07a')}</svg>`;
}

/** The water temperature through the year (the season curve of this sea). */
function tempFigure() {
  const lo = 12;
  const hi = 28;
  const x = (i) => 30 + i * 24;
  const y = (t) => 120 - ((t - lo) / (hi - lo)) * 100;
  const pts = WATER_TEMP_MONTHLY.map((t, i) => `${x(i)},${y(t).toFixed(1)}`).join(' ');
  const seasons = [['春', 0, '#e48fb0'], ['夏', 3, '#2bb3c7'], ['秋', 6, '#d98a3a'], ['冬', 9, '#8ea3c2']];
  return `<svg class="mfig" viewBox="0 0 320 150" role="img" aria-label="1年の水温">
  <rect width="320" height="150" rx="8" fill="#0d2238"/>
  ${seasons.map(([n, i, c]) => `<rect x="${x(i) - 12}" y="16" width="72" height="108" fill="${c}" opacity=".12"/><text x="${x(i) + 24}" y="30" fill="${c}" font-size="12" text-anchor="middle">${n}</text>`).join('')}
  <polyline points="${pts}" fill="none" stroke="#ffd84d" stroke-width="2.5"/>
  ${WATER_TEMP_MONTHLY.map((t, i) => `<text x="${x(i)}" y="140" fill="#9fb3c8" font-size="10" text-anchor="middle">${MONTHS[i]}月</text>`).join('')}
  <text x="6" y="${y(14) + 4}" fill="#9fb3c8" font-size="10">14℃</text><text x="6" y="${y(26) + 4}" fill="#9fb3c8" font-size="10">26℃</text></svg>`;
}

/** 旬の表: each fish by month, from the general seasonal table. */
function seasonTable() {
  const rows = Object.entries(SEASONALITY)
    .filter(([sp]) => SPECIES[sp] && !SPECIES[sp].bait)
    .map(([sp, s]) => `<tr><th>${esc(SPECIES[sp].name)}</th>${s.months.map((v) => `<td class="heat" style="--h:${v.toFixed(2)}" title="${Math.round(v * 100)}%"></td>`).join('')}</tr>`)
    .join('');
  return `<div class="table-wrap"><table class="data season-table"><tr><th></th>${MONTHS.map((m) => `<th>${m}</th>`).join('')}</tr>${rows}</table></div>
  <p class="note">色が濃いほど多い（一般に言われる旬の目安）。その年の水温によって前後し、外れる年もあります。</p>`;
}

const PHASES = ['止まり', '動き始め', '効いている', '緩み始め'];
/** How each fish is said to feed with the tide and the light (FEEDING). */
function feedingTable() {
  const groups = [
    ['aji', 'isaki', 'masaba'],
    ['madai', 'akaamadai'],
    ['kasago', 'kijihata', 'akahata', 'oomonhata', 'ara'],
    ['buri', 'hiramasa', 'kanpachi', 'sawara', 'yokowa', 'shiira'],
    ['kensaki', 'yari'],
  ];
  const mark = (v, top) => (v >= top * 0.95 ? '◎' : v >= 1 ? '○' : v >= 0.6 ? '△' : '×');
  const rows = groups
    .flat()
    .map((sp) => {
      const f = FEEDING[sp];
      const top = Math.max(...f.tide);
      const light = f.night > f.day ? '夜' : f.dawn >= 0.5 ? '朝まずめ◎' : f.dawn + f.dusk > 0.4 ? 'まずめ○' : '日中も';
      return `<tr><th>${esc(SPECIES[sp].name)}</th>${f.tide.map((v) => `<td class="c">${mark(v, top)}</td>`).join('')}<td>${light}</td></tr>`;
    })
    .join('');
  return `<div class="table-wrap"><table class="data"><tr><th>魚</th>${PHASES.map((p) => `<th>${p}</th>`).join('')}<th>時間帯</th></tr>${rows}</table></div>
  <p class="note">◎よく食う ○食う △渋い ×ほとんど食わない（漁師や釣り人の間で言われる通説を単純にしたもの）。</p>`;
}

/** The sounder pictures: a canvas per example, drawn after the manual opens (see drawManualFigures). */
function echoGallery() {
  return `<div class="echo-gallery">${ECHO_EXAMPLES.map((ex) => `<figure><canvas class="echo-ex" data-echo="${esc(ex.id)}" width="300" height="150"></canvas><figcaption><b>${esc(ex.title)}</b>${esc(ex.text)}</figcaption></figure>`).join('')}</div>
  <p class="note">図はゲームの二周波魚探 ES-2 で、毎秒約1.5mで群れの上を通ったときのもの（右端が新しい）。小型魚探 ES-1 はビームが広く、細かい違いがつぶれて見えます。</p>`;
}

const methodChapter = (id, what, where, steps, tips) => ({
  id,
  title: METHODS[id].name,
  body: () => `<p>${esc(METHODS[id].detail)}</p>
    <dl class="kv"><dt>獲れる魚</dt><dd>${esc(what)}</dd><dt>場所</dt><dd>${esc(where)}</dd></dl>
    <h3>手順</h3><ol>${steps.map((s) => `<li>${s}</li>`).join('')}</ol>
    ${tips.length ? `<h3>コツ</h3><ul>${tips.map((t) => `<li>${t}</li>`).join('')}</ul>` : ''}`,
});

export const MANUAL_CHAPTERS = [
  {
    id: 'start',
    title: 'はじめに',
    body: () => `<p>小さな漁港から船を出し、毎日どこで何を獲るかを自分で決める漁師の暮らしです。<b>探す・決めるのはあなた</b>、仕掛けを落とす・タナを合わせる・巻き上げるといった<b>繰り返しの作業は自動</b>です。同じ漁を繰り返すと腕前（Lv）が上がって手際が良くなり、装備や船を良くすると一度に扱える量が増えます。</p>
    <h3>1日の流れ</h3><ol>
    <li><b>港</b>：季節の札・仲間の話・自分の日誌・今日の予報を見て、狙い（候補A〜D）を選ぶか、決めずに出港。休んでもかまいません。</li>
    <li><b>海</b>：魚探・ソナー・海図・海面の手掛かりで群れや根を探し、止まって（または走りながら）操業開始。</li>
    <li><b>帰港</b>：港に着くと自動で水揚げ・精算・保存。日暮れが近づくと自動で帰ります。</li></ol>
    <p>終わりはありません。1年は60日（春・夏・秋・冬が15日ずつ）で、季節がめぐるたびに海と魚が変わります。</p>
    <p class="note">この手引きはいつでも開けます（港の「手引き」、海の上の「？」）。</p>`,
  },
  {
    id: 'helm',
    title: '操船',
    body: () => `<h3>前進・後進のレバー</h3><p>画面の<b>レバー</b>を上に倒すと前進、下に倒すと後進。真ん中の<b>中立</b>で止まります。つまみをドラッグするか、目盛り（全速・半速・微速・極微速・中立・後進）をタップ。キーボードは <b>W</b>（上へ）・<b>S</b>（下へ）。</p>
    <h3>舵</h3><p><b>◀舵・舵▶</b> を押している間だけ舵が切れます（<b>A</b>・<b>D</b>）。レバーの下の黄色い帯が今の舵の向き。</p>
    <h3>流される</h3><p>止まっていても船は潮と風で流されます。海図の<b>黄色い矢印</b>が実際に進んでいる向き（対地）、白い船の形が船首の向き。一本釣りや根魚釣りは、群れや根の<b>少し潮上</b>で止めて、流されながら上を通ります。外れたら<b>流し直し（R）</b>で流し始めた地点へ戻れます。</p>
    ${driftFigure()}
    <h3>移動の補助</h3><p>海図を「拡大」して行き先をタップし、<b>航路で移動（G）</b>。印の一覧の「ここへ」でもまっすぐ向かえます。帰港（<b>H</b>）も自動。どれも操船すると取り消せます。</p>`,
  },
  {
    id: 'chart',
    title: '海図と印',
    body: () => `<ul><li>海図（GPSプロッター）には、地形・水深・自分の航跡・印・仲間の話の場所・航路が出ます。<b>魚の位置は出ません</b>。</li>
    <li>サイドビュー魚探を積むと、通った所の水深を10mごとに記録して<b>自分の水深図</b>（色と等深線）が育ちます。</li>
    <li><b>印</b>：<b>M</b> で現在地、魚探・サイドビュー・ソナーの画面をタップでその反応の位置に印。<b>K</b> で一覧（名前・メモ・ここへ・消す）。印は翌日以降も残ります。</li>
    <li>拡大した海図は「全体・−・＋」で縮尺を変えられます。</li></ul>`,
  },
  {
    id: 'sounder',
    title: '魚探の読み方',
    body: () => `<p>魚探は船の真下を映し、右端が今、左へ行くほど過去です。いちばん下の太い帯が<b>海底</b>（岩は厚く、砂は薄く映る）。その上の色の塊が<b>魚の反応</b>で、青→緑→黄→赤の順に強くなります。</p>
    <p>反応の<b>形・高さ・濃さ</b>で、何の魚かの見当がつきます（確実ではありません）。</p>${echoGallery()}`,
  },
  {
    id: 'search',
    title: 'ソナー・左右・海面',
    body: () => `<ul><li><b>ソナー（CS-1）</b>：船のまわり150〜600mを見回し、群れや根の反応の方向と距離を映します。何の魚かは出ません。タップで印。</li>
    <li><b>サイドビュー（SV-1）</b>：左右60mの海底と底近くを帯で映し、真上を通らなくても根や漁礁が見つかります。</li>
    <li><b>鳥山</b>：ベイトが浮くと鳥が集まります（朝が多い）。<b>ナブラ</b>：青物やサワラがベイトを水面で追う水しぶき。<b>潮目</b>：潮が速い時間に瀬の肩や駆け上がりに出る筋。どれも見えると見張りが知らせます。霧の朝は近くしか見えません。</li></ul>`,
  },
  {
    id: 'tide',
    title: '潮と食い',
    body: () => `<p>魚探に反応があっても、食わないことがあります。食いは<b>潮の局面</b>・<b>まずめ</b>（日の出・日の入り前後の薄暗い時間）・<b>水温</b>・<b>時化の翌日</b>で変わります。潮の局面は港の予報（潮流）と海の上の潮の流れで読めます。</p>${tideFigure()}
    ${feedingTable()}
    <p><b>通説どおりにいかない日もあります。</b>潮止まりに食う日、潮が動いても食わない日、何をしても食う日。仲間の話（「潮が動き出したら急に食った」など）や自分の日誌で、その日の海を読んでください。</p>
    <p>同じ漁法で腕前が上がると（Lv5〜）、海の上で「反応はあるのに当たりが遠い」「食いが立ってきた」と<b>漁師の勘</b>が働きます。Lv8からは、潮時表からその理由の見当も付きます。</p>`,
  },
  {
    id: 'season',
    title: '季節と旬',
    body: () => `<p>1年は60日、季節は海に合わせて<b>春＝4〜6月・夏＝7〜9月・秋＝10〜12月・冬＝1〜3月</b>（各15日）。ゲームの1日は暦の約6日に当たります。港の<b>季節の札</b>に日付・水温・日の出と日の入り・旬の魚が出ます。</p>${tempFigure()}
    <ul><li>出港は日の出の1時間前、日没の30分前に帰港を始めます。夏は長く、冬は短い1日です。</li>
    <li>冬は北西の季節風で荒れる日が多く、夏の終わりには台風のうねり、春は朝霧。荒れても出られますが、流されやすく作業が遅くなります。休むのは自由です。</li></ul>
    <h3>旬の目安</h3>${seasonTable()}`,
  },
  methodChapter('handline', 'マアジ・イサキ・マサバ', '瀬・根の周り、反応のある所', ['魚探で群れの反応を探す。', '反応の少し潮上で止める（レバーを中立）。', '操業開始（Space）。タナは魚探の反応に自動で合わせ、掛かったら回収・取り込み。', '流されて反応から外れたら流し直し（R）。'], ['アジは潮止まりにはほとんど食わない。潮が動き出す時間を狙う。', 'サバの層にタナが合うとサバばかり掛かる（安い）。', '中型漁船は竿が2本。電動リールは深いタナで速い。']),
  methodChapter('negyo', 'カサゴ・キジハタ・アカハタ・オオモンハタ・アラ', '根・漁礁・こぼれ瀬の真上（ピンポイント）', ['魚探・サイドビュー・ソナー・水深図で根や漁礁を見つけ、印を付ける。', '真上か少し潮上で止めて操業開始。オモリは底から少し上を自動で保つ。', '根から外れたら流し直し。'], ['潮が緩む・止まる時間が釣りやすい（大潮は難しい）。', '根掛かりで仕掛けを付け直す時間が取られる（腕前で減る）。', 'アカハタは浅い根、アラは大きな根。']),
  methodChapter('oyogase', 'ブリ・ヒラマサ・カンパチ', '根・瀬の周り、ベイトの反応の下', ['<b>まず一本釣りでアジを釣る</b>（魚倉のアジが活きエサになる）。', '漁法を泳がせ（T）にすると、パネルに手順が出る。', 'ベイトの団子の下や横に太い「へ」の字が出る所、根や瀬の周りで止めて操業開始。', 'アジを1尾ずつ針に付けて泳がせ、弱ったら自動で替える。掛かるとやり取りしてから巻き上げ。'], ['表層にベイトがいて曳縄に食わない日は、青物が下にいて表層の疑似餌を追わないことがある。そんな日こそ泳がせ（またはジギング）。', '朝夕のまずめ、潮が動き出す時間が良い。潮止まりは渋い。']),
  methodChapter('jigging', '青物・サワラ・ヨコワ・マダイ・根の大物（サバも）', 'ベイトや青物の反応の上、根・瀬の周り', [`港の装備で${esc(EQUIPMENT.rod_jg1.name)}（${money(EQUIPMENT.rod_jg1.price)}）を竿立てに付ける。`, '反応の上や根の周りで止めて操業開始。', 'ジグを底まで落とし、反応の少し上（または底から18m）までしゃくり上げてはまた落とす（自動）。'], [`根の上ではジグが根掛かりして失くすことがある（1個${money(EQUIPMENT.rod_jg1.rod.jigPrice)}、帰港時に精算）。`, '活きエサが要らない分、泳がせより食いは劣る。サバの群れの中ではサバばかり。']),
  methodChapter('troll', 'サワラ・シイラ・ヨコワ', '沖・駆け上がり・潮目（シイラは夏の潮目）', ['曳縄具を付ける（船尾）。', '海図を拡大して群れがいそうな所を通る航路をタップ。', '操業開始（Space）。決めた航路を往復しながら自動で曳き、掛かった魚を取り込む。'], ['自動航行は決めた航路を走るだけで、魚を探しには行かない。', 'ベイトはいるのに食わないときは、20分ほどで泳がせ・ジギングを勧められる。']),
  methodChapter('longline', 'マダイ・アカアマダイ・シロアマダイ', '平場や駆け上がりの底（アマダイは砂泥・魚探に映らない）', ['延縄具を付ける。張る向きは今の向きか、海図で経由点を指定。', '操業開始で投縄。浸けている間は自由に動ける（他の漁もできる）。', '揚げ縄（L）。ブイから離れていれば移動補助で向かう。'], [`縄は装備画面で買い足せて、最大${LONGLINE_LINES.max}本（1本${money(LONGLINE_LINES.extraPrice)}）。別々の場所に張り、揚げるときは番号を選べる。帰港時はすべて揚げる。`, '餌は時間とともに弱る。浸けて1時間前後が目安。', 'アマダイは巣穴にいて魚探に映らないので、仲間の話や自分の記録で場所を覚える。']),
  methodChapter('ika', 'ケンサキイカ（初夏〜秋）・ヤリイカ（冬〜春）', '沖の深い所', ['集魚灯を屋根に付けると、港で「夕方から出る」を選べる（日没の1時間前に出港）。', '沖の深い所で止めて操業開始。パラアンカーを入れ、灯でイカを船の下に寄せる。', '暗くなるほど寄ってくる。イカ角を自動でシャクる。'], ['暗くなって1〜2時間が勝負。']),
  {
    id: 'info',
    title: '仲間の話と候補',
    body: () => `<p>港では毎朝、漁法ごとの仲間（${Object.values(PEERS).map((p) => esc(p.name)).join('・')}）の話が聞けます。海の上では無線も入ります。</p>
    <ul><li>「水揚げ」「反応なし」は本人が確かめたこと、「魚探の反応」「目撃」は見たもの（魚種は見立て）。予想・見立て・経験則は別に書いてあります。</li>
    <li>時刻は<b>観測した時刻</b>で、今の魚の位置ではありません。古い話ほど当てになりません。又聞きは同じ話として数えます。</li>
    <li>候補（A〜D）は、自分が聞いた話・自分の記録・今日の予報だけから作っています。候補以外へ行くのも自由です。</li></ul>`,
  },
  {
    id: 'money',
    title: 'お金と船',
    body: () => `<ul><li>帰港すると魚を売り、氷・餌の定額・燃料（走った距離）・甲板員の日当・失くしたジグの代金を払います。「収支」で日ごと・漁法ごとの稼ぎが見られます。</li>
    <li>装備は港の「装備」で買って取り付けます。外した装備は倉庫に残り、売ることもできます。</li>
    <li>船は「船の買い替え」で新艇・中古艇を選べます（今の船は下取り）。中型漁船は魚倉が大きく、沖の瀬まで行けます。</li>
    <li>資金が足りなくても出漁はできます（払えない分は免除）。</li></ul>`,
  },
  {
    id: 'save',
    title: '保存',
    body: () => `<p>帰港して水揚げしたとき・装備を買ったとき・港で話を聞いたときに自動で保存します。海の上でも数秒ごとに途中経過を保存し、ページを閉じても次に開くと海の上から続けられます（同じ端末・同じブラウザ）。別の端末へ移すときは「セーブ管理」の「セーブをコピー」「貼り付けて読み込む」。</p>`,
  },
  {
    id: 'keys',
    title: '操作一覧',
    body: () => `<ul><li><b>W・S</b> レバー（前進↑・後進↓）、<b>A・D</b> 舵（押している間）</li>
    <li><b>Space</b> 操業開始／回収、<b>R</b> 流し直し、<b>T</b> 漁法の切替、<b>H</b> 帰港、<b>L</b> 揚げ縄</li>
    <li><b>C</b> 海図の拡大、<b>G</b> 航路で移動、<b>X</b> 航路を消す、<b>M</b> 印、<b>K</b> 印の一覧</li>
    <li><b>F</b> 魚探、<b>O</b> ソナー、<b>V</b> 視点（操船→作業→甲板を歩く）、<b>1・2・3</b> 時間の早さ、<b>P</b> 一時停止、<b>N</b> 音</li>
    <li><b>スマホ</b>：画面のボタンで同じ操作。横持ちでは海図・魚探・ソナーが並び、レバーは右端、あまり使わないボタンは「その他」。「海を見る」で海の見え方に切り替え。</li></ul>`,
  },
];

/** Which chapter fits what the player is doing now. */
export function chapterFor({ atSea = false, method = null } = {}) {
  if (atSea && method && MANUAL_CHAPTERS.some((c) => c.id === method)) return method;
  return atSea ? 'sounder' : 'start';
}

/** The manual as HTML: the chapter list and the open chapter. */
export function manualHtml(chapterId = 'start') {
  const ch = MANUAL_CHAPTERS.find((c) => c.id === chapterId) || MANUAL_CHAPTERS[0];
  const i = MANUAL_CHAPTERS.indexOf(ch);
  const prev = MANUAL_CHAPTERS[i - 1];
  const next = MANUAL_CHAPTERS[i + 1];
  const toc = MANUAL_CHAPTERS.map((c) => `<button type="button" class="toc-item${c === ch ? ' on' : ''}" data-act="manual" data-chapter="${c.id}">${esc(c.title)}</button>`).join('');
  return `<div class="card manual"><div class="manual-head"><h2>手引き <small>${i + 1}/${MANUAL_CHAPTERS.length}</small></h2><button type="button" class="btn small" data-act="closeModal">閉じる</button></div>
    <nav class="manual-toc" aria-label="章">${toc}</nav>
    <article class="manual-body" data-chapter="${ch.id}"><h2>${esc(ch.title)}</h2>${ch.body()}</article>
    <div class="actions manual-nav">${prev ? `<button type="button" class="btn small" data-act="manual" data-chapter="${prev.id}">← ${esc(prev.title)}</button>` : ''}${next ? `<button type="button" class="btn small" data-act="manual" data-chapter="${next.id}">${esc(next.title)} →</button>` : ''}<button type="button" class="btn small" data-act="guideReset">はじめての案内をもう一度出す</button></div></div>`;
}
