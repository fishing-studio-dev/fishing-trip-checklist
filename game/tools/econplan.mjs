// 収支の見通し（段4c）: a rough model of a 「ふつう」 year. A typical player lands
// `human` × what the omniscient bot lands, pays the day's costs at the current
// data.js prices, and buys gear in a fixed order as soon as it is affordable.
// Prints the day of each purchase and the day's profit on days 1, 10 and 30.
// Usage: node tools/econplan.mjs '{"human":0.5,"fish":1,"lv1s":40000,"lv5s":38000,"lv5c":60000}'
//   lv1s / lv5s: the bot's sales a day on the small boat at Lv1 / Lv5;
//   lv5c: on the medium boat with a deckhand and two electric reels
//   (measure them with tools/econone.mjs); fish: a price change since the measurement.
const D = await import(new URL('../src/core/data.js', import.meta.url).href);
const P = JSON.parse(process.argv[2] || '{}');
const human = P.human ?? 0.5, fish = P.fish ?? 1;
const E = D.EQUIPMENT, B = D.BOATS, O = Object.fromEntries(D.BOAT_OFFERS.map((o) => [o.id, o.price]));
const base = D.ECONOMY.tripBaseCost, wage = D.CREW.wage;
const kmS = P.kmS ?? 7, kmC = P.kmC ?? 9;
const items = [
  ['電動リール DR-1', E.reel_electric.price, 'reel'],
  ['曳縄具 TR-1', E.troll_tr1.price],
  ['中古の中型漁船A（下取り後）', O.used_cruiser_a - B.skiff_1.tradeIn, 'boat'],
  ['2台目の電動リール', E.reel_electric.price, 'reel2'],
  ['二周波魚探 ES-2', E.sounder_es2.price],
  ['延縄具 LL-1', E.longline_ll1.price],
  ['ジギングロッド JG-1', E.rod_jg1.price],
  ['揚げ縄機 LH-1', E.hauler_lh1.price],
  ['曳縄具 TR-2', E.troll_tr2.price],
  ['LED集魚灯 LD-1', E.lights_ld1.price],
  ['サイドビュー SV-1', E.sounder_sv1.price],
  ['延縄2本目', D.LONGLINE_LINES.extraPrice],
  ['延縄3本目', D.LONGLINE_LINES.extraPrice],
  ['ソナー CS-1', E.sonar_cs1.price],
  ['新艇の中型漁船（下取り後）', O.new_cruiser - B.cruiser_2.tradeIn],
];
let funds = D.DIFFICULTY.normal.startFunds;
let boat = 'skiff', xp = 0, i = 0;
const out = [];
for (let day = 1; day <= 200 && i < items.length; day++) {
  const lv5 = xp >= 240;
  let sales, cost;
  if (boat === 'skiff') {
    sales = (lv5 ? P.lv5s : P.lv1s) * human * fish * (P.reelBoost && day > (P.reelDay || 99) ? P.reelBoost : 1);
    cost = base + kmS * B.skiff_1.fuelPerKm;
  } else {
    sales = P.lv5c * human * fish;
    cost = base + kmC * B.cruiser_2.fuelPerKm + wage;
  }
  xp += P.fishPerDay ?? 150;
  funds += sales - cost;
  if (day === 1 || day === 10 || day === 30) out.push(`  ${day}日目の1日の黒字 ${Math.round(sales - cost).toLocaleString()}G（経費 ${Math.round(cost).toLocaleString()}G）`);
  while (i < items.length && funds >= items[i][1]) {
    funds -= items[i][1];
    out.push(`${String(day).padStart(3)}日目 ${items[i][0]} ${Math.round(items[i][1]).toLocaleString()}G`);
    if (items[i][2] === 'boat') boat = 'cruiser';
    i++;
  }
}
console.log(out.join('\n'));
