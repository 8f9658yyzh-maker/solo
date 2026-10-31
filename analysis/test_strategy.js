'use strict';
// 戦略の分析(analysis/strategy.js)のテスト: 小さく回して、CSVの保存と、続きからの学習を確かめる。チップの合計は match の中で毎回確かめている(合わなければ止まる)
const assert = require('node:assert'), fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { main, readCsv, GENES } = require('./strategy');
let n = 0; const ok = m => { n++; console.log('  OK  ' + m); };
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'solo-strategy-'));
  try {
    const small = ['--games', '30', '--rounds', '1', '--eval', '2', '--data', dir, '--quiet'];
    const r1 = await main(['--gens', '2', ...small]);
    for (const f of ['population', 'history', 'progress', 'report', 'hands']) assert.ok(fs.existsSync(path.join(dir, f + '.csv')), f + '.csv');
    const pop = readCsv(path.join(dir, 'population.csv'));
    assert.strictEqual(pop.length, 12); assert.ok(pop.every(p => GENES.every(([k, lo, hi]) => +p[k] >= lo && +p[k] <= hi)));
    assert.strictEqual(pop[0].id, r1.best.id); assert.ok(r1.total.games > 0);
    ok('6人卓で2世代学習し、戦略・世代ごとの成績・CPUとの成績・分析・手札ごとの成績をCSVに保存する(チップの合計は毎回一致)');
    await main(['--gens', '1', ...small]);
    const hist = readCsv(path.join(dir, 'history.csv'));
    assert.deepStrictEqual(hist.map(h => +h.gen), [1, 2, 3]);
    assert.ok(readCsv(path.join(dir, 'population.csv')).every(p => +p.gen === 3));
    assert.strictEqual(readCsv(path.join(dir, 'progress.csv')).length, 2);
    ok('次に動かすと、保存した戦略の続き(3世代目)から学習し、記録は追記される');
    await main(['--gens', '1', '--fresh', ...small]);
    assert.strictEqual(+readCsv(path.join(dir, 'history.csv')).pop().gen, 1);
    ok('--fresh で最初から学習し直せる');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  console.log(`\n戦略の分析のテスト: ${n}項目すべて合格`);
})().catch(e => { console.error(e); process.exit(1); });
