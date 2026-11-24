// Balance check: average daily earnings of one method (see tools/econbot.mjs).
// Usage: node tools/econone.mjs <handline|negyo|oyogase|troll|longline|ika> <days, e.g. 10,11,12> [level]
import { runDay } from './econbot.mjs';
const SL = { handline: {}, negyo: {}, oyogase: {}, troll: { stern_troll: 'troll_tr1' }, longline: { stern_troll: 'longline_ll1' }, ika: { roof_lights: 'lights_ld1' } };
const [m, daysArg, lv] = process.argv.slice(2);
const days = daysArg.split(',').map(Number);
const level = Number(lv || 1);
const rows = days.map((d) => { try { return runDay({ day: d, method: m, level, boat: 'skiff_1', slots: SL[m] }); } catch (e) { return { day: d, error: e.message }; } });
const ok = rows.filter((r) => r.net != null);
const avg = (k) => Math.round(ok.reduce((a, r) => a + r[k], 0) / Math.max(1, ok.length));
console.log(m.padEnd(9), `Lv${level}`, 'avg net', avg('net'), 'sales', avg('sales'), 'cost', avg('cost'), 'n', avg('n'), 'kg', avg('kg'), '|', rows.map((r) => r.storm ? 'storm' : r.error ? 'ERR:' + r.error.slice(0, 40) : r.net).join(' '));
