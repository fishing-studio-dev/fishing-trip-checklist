// Builds tests/e2e/fixtures/m2-rich-save.json: the real M1 save (m1-save.json),
// migrated by the game's own loader, with funds raised to 100,000G so the
// boat purchase can be tested in the browser. Run: node tests/e2e/fixtures/make-rich-save.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSave, writeSave, memoryStorage, KEYS } from '../../../src/core/save.js';

const dir = path.dirname(fileURLToPath(import.meta.url));
const st = memoryStorage({ [KEYS.main]: fs.readFileSync(path.join(dir, 'm1-save.json'), 'utf8') });
const r = loadSave(st);
if (r.status !== 'ok') throw new Error(`m1 fixture did not load: ${r.status}`);
const rich = { ...r.profile, funds: 100000 };
const out = memoryStorage();
const w = writeSave(out, rich, 0, '2026-11-23T00:00:00.000Z');
if (!w.ok) throw new Error(w.error);
fs.writeFileSync(path.join(dir, 'm2-rich-save.json'), out.getItem(KEYS.main));
console.log('wrote m2-rich-save.json', rich.funds, rich.boat.model);
