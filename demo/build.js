'use strict';
// 体験版(1枚のHTML)を作る: node demo/build.js
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..'), rd = f => fs.readFileSync(path.join(root, f), 'utf8');
const wasm = fs.readFileSync(process.env.SQLITE_WASM || '/tmp/swx/sqlite-wasm/src/bin/sqlite3.wasm').toString('base64');
let sq = fs.readFileSync(process.env.SQLITE_MJS || '/tmp/swx/sqlite-wasm/src/bin/sqlite3.mjs', 'utf8');
sq = sq.replace(/import\.meta\.url/g, "'http://demo.invalid/'").replace('export default sqlite3InitModule;', 'window.sqlite3InitModule = sqlite3InitModule;')
  .replace(/export\s*\{\s*sqlite3InitModule as default[^}]*\};?/, 'window.sqlite3InitModule = sqlite3InitModule;');   // 新しい版(npm の dist/index.mjs)の書き方
if (/^export\s/m.test(sq)) throw new Error('SQLite の部品に export が残っています');
const defs = ['db', 'ledger', 'core', 'tables', 'billing', 'perks', 'stats', 'ads', 'chipreq', 'legal', 'index'].map(n => `window.__DEFS['./${n}']=function(module,exports,require,__dirname){${rd('server/' + n + '.js')}\n};`).join('\n');
let app = ['web/app.js', 'web/table.js', 'web/scene.js', 'web/perks.js', 'web/ads.js', 'web/boot.js'].map(rd).join('\n;\n');
const tk = "try { S.token = localStorage.getItem('solo_tok'); } catch (x) {}";
if (!app.includes(tk)) throw new Error('boot.js の token 行が見つかりません');
app = app.replace(tk, 'S.token = window.__demoToken || null;');
if (/<\/script/i.test(app)) throw new Error('script終端が含まれています');
const fonts = '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@500;600;700&family=Zen+Kaku+Gothic+New:wght@400;500;700&display=swap">';
const fail = "document.getElementById('app').innerHTML='<div style=\"padding:24px;color:#EAF0F7;font:14px/1.7 sans-serif\">体験版を起動できませんでした。<br><small>'+String(e&&e.message||e)+'</small></div>';";
const frag = `<title>ソロ 体験版</title>
${fonts}
<style>${rd('web/style.css')}</style>
<div id="app"></div>
<div id="toast" role="status" aria-live="polite"></div>
<script>${rd('engine.js')}</script>
<script>(function(){${sq}\n})();</script>
<script>${rd('demo/prelude.js')}</script>
<script>${defs}</script>
<script>${rd('demo/demo.js')}</script>
<script>window.__demoStart(${JSON.stringify(wasm)}, ${JSON.stringify(app)}).catch(function(e){${fail}console.error(e);});</script>`;
fs.writeFileSync(path.join(__dirname, 'solo-demo.fragment.html'), frag);   // 公開用(外側のhtml/head/bodyは公開時に付く)
fs.writeFileSync(path.join(__dirname, 'solo-demo.html'), '<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body>' + frag + '</body></html>');   // 手元の確認用
console.log('solo-demo.html / .fragment.html', (frag.length / 1e6).toFixed(2) + 'MB');
