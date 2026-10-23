'use strict';
// 画面の演出に必要な情報(現在のベット額・アップ額・配る順)が、ゲームの進行どおりに出るかの確認
const Solo = require('../engine.js');
let ok = 0; const t = (c, m) => { if (!c) { console.error('  NG ' + m); process.exitCode = 1; } else { ok++; console.log('  OK  ' + m); } };
(async () => {
  const T = Solo.createTable({ seats: 3, ante: 100, minBet: 100, limit: 1000, limitType: 'perBet', maxBets: 3, reserve: 10, startPts: 50000, minUnit: 100, upEnabled: true }, { humans: [0, 1, 2] });
  T.players.forEach(p => { p.pts = 50000; });
  const seen = { bet: 0, up: 0, order: null, beat: [] };
  const io = {
    log() {}, beat: ms => { seen.beat.push(ms); return Promise.resolve(); },
    sync() { const g = T.g; if (g) { seen.bet = Math.max(seen.bet, g.curBet); seen.up = Math.max(seen.up, g.curUp); if (g.commit) seen.order = g.commit.order; } },
    human: async req => {
      if (req.type === 'oya') return { act: 'bet', amount: 300 };
      if (req.type === 'biki') return { act: 'follow', up: 200 };
      if (req.type === 'follow' || req.type === 'followUp') return { act: 'follow', up: 0 };
      return { act: 'fold' };
    }
  };
  const r = await Solo.playGame(T, io, { oya: 0 });
  t(seen.bet === 300, '親のベット額(300)が「現在のベット額」に出る');
  t(seen.up === 200, 'ビキのアップ額(200)が「アップ額」に出る');
  t(Array.isArray(seen.order) && seen.order.length === 3 && seen.order[0] === 0, '配る順(親から時計回り)が画面に渡せる');
  t(seen.beat.some(ms => ms >= 1800 + 350 * 3), '配る演出の分だけ、ゲームが待つ(人数が多いほど長い)');
  t(T.g.curBet === 0 || T.g.phase === 'done', 'ゲーム終了時に現在のベット額は残らない(画面側でも0にする)');
  console.log(`全${ok}項目 合格`);
})();
