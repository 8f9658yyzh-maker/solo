'use strict';
// 画面の「場のチップ」の分け方の検査(画面のファイルから該当部分だけを取り出して動かす)
const assert = require('node:assert'), fs = require('fs'), vm = require('vm');
const src = fs.readFileSync(__dirname + '/../web/table.js', 'utf8');
const pick = (a, b) => { const i = src.indexOf(a), j = src.indexOf(b, i); assert.ok(i >= 0 && j > i, a); return src.slice(i, j); };
const ctx = {}; vm.createContext(ctx);
vm.runInContext(pick('const DENOM =', 'function pileHTML') + '\nthis.cbJson = x => JSON.stringify(chipBreak(x)); this.dnJson = JSON.stringify(DENOM);', ctx);
const CB = x => JSON.parse(ctx.cbJson(x)), DN = JSON.parse(ctx.dnJson);
let n = 0; const ok = m => { n++; console.log('  OK  ' + m); };
assert.deepStrictEqual(DN.map(d => d[0]), [100000, 50000, 10000, 5000, 1000, 500, 100]); assert.deepStrictEqual(DN.map(d => d[1]).length, new Set(DN.map(d => d[1])).size, '色は重ならない');
ok('額は7種類で、色はすべて違う');
const sum = b => b.reduce((a, d) => a + d.v * d.n, 0);
assert.deepStrictEqual(CB(10000).map(d => [d.v, d.n]), [[10000, 1]], '10,000は黒1枚');
assert.deepStrictEqual(CB(0), []);
for (let i = 0; i < 5000; i++) { const p = Math.floor(Math.random() * 5e6) * (i % 3 === 0 ? 1 : 100); assert.strictEqual(sum(CB(p)), p, 'pot=' + p); }
assert.deepStrictEqual(CB(1250).map(d => [d.v, d.n]), [[1000, 1], [100, 2], [50, 1]]);
ok('場のチップは、どんな額でも合計が実際の場と一致する(5,000通り)。10,000は1枚、端数は別に出る');
console.log('\n全' + n + '項目 合格');
