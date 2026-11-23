// Build the game as ONE self-contained page (no imports, no external files),
// for publishing as a claude.ai page that can be opened on a phone.
//
//   node tools/build-artifact.mjs <out.html> [--test <test.html>]
//
// <out.html>  page body for the host (it adds <!doctype>/<head>/<body> itself)
// --test      also write a standalone file that imitates the host's wrapper and
//             a strict Content-Security-Policy (inline scripts only), for local checks
//
// Needs the bundler esbuild, installed once without touching package.json:
//   npm install --no-save esbuild@0.28.2
// (or point ESBUILD_BIN at an esbuild binary). The game itself still has no
// runtime dependencies. three.js keeps its license comment.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const ESBUILD_BIN = process.env.ESBUILD_BIN || join(root, 'node_modules', '.bin', 'esbuild');
if (!existsSync(ESBUILD_BIN)) {
  console.error('esbuild が見つかりません。game フォルダで `npm install --no-save esbuild@0.28.2` を実行してください。');
  process.exit(1);
}
const args = process.argv.slice(2);
const out = resolve(args[0] || join(root, 'dist', 'ryoshi-game.html'));
const testIdx = args.indexOf('--test');
const testOut = testIdx >= 0 ? resolve(args[testIdx + 1]) : null;

const tmp = mkdtempSync(join(tmpdir(), 'ryoshi-build-'));
const bundlePath = join(tmp, 'game.js');
execFileSync(
  ESBUILD_BIN,
  ['src/ui/main.js', '--bundle', '--format=iife', '--minify', '--target=es2020', '--legal-comments=eof', '--alias:three=./vendor/three/three.module.js', '--define:globalThis.RYOSHI_HOSTED=true', `--outfile=${bundlePath}`, '--log-level=warning'],
  { cwd: root, stdio: 'inherit' },
);

// an inline <script> must never contain "</script" (or "<!--") in its text
const bundle = readFileSync(bundlePath, 'utf8').replace(/<\/script/gi, '<\\/script').replace(/<!--/g, '<\\!--');
const css = readFileSync(join(root, 'styles.css'), 'utf8');
const index = readFileSync(join(root, 'index.html'), 'utf8');
const body = index
  .slice(index.indexOf('<body>') + '<body>'.length, index.indexOf('</body>'))
  .replace(/<script type="module"[^>]*><\/script>\s*/g, '')
  .trim();
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const build = { hosted: true, version: pkg.version, builtAt: new Date().toISOString() };

const page = `<title>漁師ゲーム</title>
<style>
${css}
</style>
${body}
<script>window.__RYOSHI_BUILD__ = ${JSON.stringify(build)};</script>
<script>
${bundle}
</script>
`;
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, page);
console.log(`page: ${out} (${(page.length / 1024).toFixed(0)} KB)`);

if (testOut) {
  const csp = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; connect-src 'self'";
  const wrapped = `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<style>:root{color-scheme:light;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0;font:14px system-ui,sans-serif}img{max-width:100%}[hidden]{display:none!important}</style>
</head>
<body>
${page}</body>
</html>
`;
  mkdirSync(dirname(testOut), { recursive: true });
  writeFileSync(testOut, wrapped);
  console.log(`test page (host-like wrapper + strict CSP): ${testOut}`);
}
