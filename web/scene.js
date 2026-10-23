'use strict';
/* 演出の確認画面(#/scene)
   「こういう場面が出たとき、画面はどう動くか」を、数字や文字を入れて、本物の卓の画面で再生して確かめる。
   本物の卓と同じ描画・同じ演出(table.js)に、作り物の卓の状態を順に渡しているだけなので、
   ここで見えた動きは、そのまま実際の卓で出る動きと同じになる。お金・記録・ほかの人には、いっさい影響しない。 */
const SC = { p: { n: 5, ante: 100, pot: 1200, jp: 8800, rank: 10, who: 'me', msg: '祝! 10のソロ達成 ・ おめでとうございます' }, gen: 0 };
const SC_NAMES = ['あなた', 'ミナ', 'ケン', 'ユイ', 'ハル', 'ソラ', 'レン', 'アキ'];
const SC_LIST = [
  ['solo10', '10のソロ', '祝儀＋ジャックポット。いちばん派手な演出'],
  ['soloN', 'ソロ(祝儀だけ)', '「ソロの数字」で指定。ジャックポットの条件に満たない数字'],
  ['jackpot', 'ジャックポット当選', '積立を獲得(降りて1人勝ちでも、勝者のカードだけ公開)'],
  ['last', 'ラストゲーム', '終了前の最後の勝負。積立をかけて決着'],
  ['win', 'ふつうの勝ち(勝負)', '場のチップが勝者へ滑っていく'],
  ['fold', '全員降り', '1人を残して全員が降りる'],
  ['nagashi', '流し', '勝者なし。場のチップは次のゲームへ'],
  ['deal', 'カードを配る', 'シャッフル→配る→参加料が場に出る'],
  ['chips', '場のチップの増え方', '額ごとの色。合計に合わせて表示が変わる'],
  ['jpflow', '積立の電光掲示', '積立が増えていくようす(上の帯)'],
  ['text', '流れる文字', '「流す文字」を、上の帯に流して表示']
];
const sc$ = id => { const el = document.getElementById(id); return el ? el.value : ''; };
const scSleep = ms => new Promise(r => setTimeout(r, ms));

function sceneScreen() {
  stopTable(); SC.gen++; TB.scene = false;
  const p = SC.p, inp = (id, lab, val, extra) => `<div><label>${lab}</label><input id="${id}" ${extra || ''} value="${e(String(val))}"></div>`;
  $('#app').innerHTML = `<div class="page"><div class="top"><div class="brand">SCENE<small>演出の確認</small></div><button class="btn sm" data-a="scBack">BACK</button></div>
  <div class="card"><h3>INPUT<small>数字と文字を入れる</small></h3>
  <div class="note">作り物の卓で、本物の画面と同じ動きを再生します。お金や記録には影響しません。</div>
  <div class="grid2">
    <div><label>人数<small>(自分を含む)</small></label><select id="sc_n">${[3, 4, 5, 6, 7].map(n => `<option ${n === p.n ? 'selected' : ''}>${n}</option>`).join('')}</select></div>
    <div><label>勝つ人</label><select id="sc_who"><option value="me" ${p.who === 'me' ? 'selected' : ''}>あなた</option><option value="other" ${p.who === 'other' ? 'selected' : ''}>他の人(ミナ)</option></select></div>
  </div>
  <div class="grid2">${inp('sc_ante', '参加料', p.ante, 'type="number" inputmode="numeric"')}${inp('sc_pot', '場のチップ', p.pot, 'type="number" inputmode="numeric"')}</div>
  <div class="grid2">${inp('sc_jp', '積立の金額', p.jp, 'type="number" inputmode="numeric"')}${inp('sc_rank', 'ソロの数字(1=エース〜10)', p.rank, 'type="number" inputmode="numeric" min="1" max="10"')}</div>
  <label>流す文字<small>(上の帯に流れます)</small></label><input id="sc_msg" maxlength="60" value="${e(p.msg)}">
  </div>
  <div class="card"><h3>SCENES<small>押すとすぐ再生</small></h3>
  ${SC_LIST.map(s => `<button class="btn block" style="margin-bottom:8px;text-align:left" data-a="scPlay" data-v="${s[0]}"><b>▶ ${s[1]}</b><small style="display:block;opacity:.8;font-weight:400">${s[2]}</small></button>`).join('')}
  <p class="mute">再生中は、左上の「‹」で、この画面に戻れます。</p></div></div>`;
}
function scRead() {
  const num = (id, d, lo, hi) => { const x = Math.floor(Number(sc$(id))); return Number.isFinite(x) && sc$(id) !== '' ? Math.max(lo, Math.min(hi, x)) : d; };
  SC.p = { n: num('sc_n', 5, 3, 7), who: sc$('sc_who') === 'other' ? 'other' : 'me', ante: num('sc_ante', 100, 1, 1e7), pot: num('sc_pot', 1200, 0, 1e9), jp: num('sc_jp', 8800, 0, 1e9), rank: num('sc_rank', 10, 1, 10), msg: String(sc$('sc_msg')).slice(0, 60) };
  return SC.p;
}
A.scOpen = () => go('#/scene');
A.scBack = () => go('#/practice');
A.scPlay = v => { const p = scRead(); scenePlay(v, p); };

/* ---- 作り物の卓の状態 ---- */
function sceneView(p, o) {
  const n = p.n, g = o.gameNo, winSeat = p.who === 'me' ? 0 : 1;
  const seats = []; for (let i = 0; i < n; i++) {
    const inG = o.parts ? o.parts.includes(i) : false, act = o.active ? o.active.includes(i) : false;
    seats.push({ i, name: SC_NAMES[i], net: 0, chips: (o.chips && o.chips[i] != null ? o.chips[i] : 10000), away: false, rest: false, you: i === 0, oya: !!o.parts && o.oya === i, biki: false,
      active: act, inGame: inG, say: (o.say && o.say[i]) || '', acting: o.acting === i,
      hand: o.reveal && o.reveal.includes(i) && i !== 0 ? o.hands[i] : null, hasCards: !!(o.cards && inG && act && i !== 0 && !(o.reveal && o.reveal.includes(i))) });
  }
  const order = []; for (let k = 0; k < n; k++) order.push((1 + k) % n);
  const jp = o.jp == null ? { on: false } : { on: true, pool: o.jp, mine: o.jp, rank: 10, last: !!o.last, msg: o.msg || '' };
  return { practice: true, scene: true, name: 'SCENE', status: 'running', watch: false,
    settings: { seats: n, ante: p.ante, minBet: p.ante, limit: Math.max(p.ante * 10, 1000), limitType: 'perBet', maxBets: 3, reserve: p.ante * 10, shugiMul: 1, upEnabled: false, startMode: 'free', lateJoin: 'deny', leave: 'allow', durationMin: 0, endZero: 0, chat: false },
    you: { seat: 0, pocket: 0, canLeave: true }, seats, pot: o.pot || 0, carry: o.carry ? { fee: p.ante } : null, color: 'red', gameNo: g,
    phase: o.phase || 'wait', commit: o.cards ? 'a3f9c27be10d5486' : null, actType: null, curBet: o.curBet || 0, curUp: 0, deckN: 20, dealOrder: o.deal ? order : null,
    jp, rules: { feeBp: 100, jpBp: 200, shugiMul: 1 },
    mine: o.cards ? { hand: o.hands[0], label: o.labels ? o.labels[0] : null } : null, req: null, log: [], chat: [], vote: null, result: o.result || null, serverTime: Date.now() };
}
const scLabel = h => { const a = parseInt(h[0], 10), b = parseInt(h[1], 10); return a === b ? (a === 1 ? 'エース' : a) + 'のソロ' : ((a + b) % 10) + '点'; };
const scCard = (n, k) => n + ['♠', '♥', '♦', '♣'][k % 4];

/* シーンごとの台本(待ち時間ms, 状態) を作る */
function sceneScript(kind, p) {
  const G = 8, n = p.n, win = p.who === 'me' ? 0 : 1, all = Array.from({ length: n }, (_, i) => i), step = [];
  const ante = p.ante, rank = p.rank;
  const hands = []; for (let i = 0; i < n; i++) hands[i] = [scCard(2 + (i * 2) % 5, i), scCard(3 + (i * 3) % 4, i + 1)];
  const soloKinds = ['solo10', 'soloN', 'jackpot', 'last'];
  const wRank = kind === 'solo10' || kind === 'jackpot' || kind === 'last' ? 10 : kind === 'soloN' ? Math.min(rank, 9) : 0;
  hands[win] = wRank ? [scCard(wRank, 0), scCard(wRank, 1)] : [scCard(9, 0), scCard(8, 1)];
  if (wRank) hands.forEach((h, i) => { if (i !== win && parseInt(h[0], 10) === parseInt(h[1], 10)) hands[i] = [scCard(2, i), scCard(5, i + 1)]; });
  const labels = hands.map(scLabel);
  const jpOn = ['solo10', 'jackpot', 'last', 'jpflow', 'text'].includes(kind) || p.jp > 0 && !['chips', 'deal'].includes(kind);
  const base = { oya: 1, hands, labels, parts: all, jp: jpOn ? p.jp : null, msg: kind === 'text' || kind === 'jpflow' ? p.msg : '' };
  const antes = ante * n;
  const idle = Object.assign({}, base, { gameNo: G - 1, phase: 'wait', parts: null, pot: kind === 'nagashi' ? 0 : 0 });
  if (kind === 'chips') {
    step.push([300, Object.assign({}, idle, { gameNo: G, phase: 'bet', parts: all, active: all, cards: true, pot: 0 })]);
    const fr = [.01, .04, .1, .25, .5, .75, 1], seen = new Set();
    fr.forEach(f => { const pot = Math.max(100, Math.floor(p.pot * f / 100) * 100); if (seen.has(pot)) return; seen.add(pot); step.push([2200, Object.assign({}, base, { gameNo: G, phase: 'bet', active: all, cards: true, pot, curBet: 0 })]); });
    return step;
  }
  if (kind === 'jpflow' || kind === 'text') {
    step.push([200, Object.assign({}, idle, { jp: p.jp, msg: kind === 'text' ? p.msg : '' })]);
    const k = kind === 'text' ? 1 : 7;
    for (let i = 1; i <= k; i++) step.push([kind === 'text' ? 16000 : 2600, Object.assign({}, idle, { jp: p.jp + i * Math.max(1, Math.round(p.ante * .02 * n)), msg: kind === 'text' ? p.msg + ' ' : '' })]);
    return step;
  }
  step.push([300, Object.assign({}, idle)]);
  const bet = Math.max(ante, Math.floor(ante * 5 / ante) * ante);
  const hold = { gameNo: G, active: all, cards: true };
  step.push([900, Object.assign({}, base, hold, { phase: 'bet', deal: true, pot: antes, acting: 2 % n, curBet: 0 })]);
  if (kind === 'deal') { step.push([9000, Object.assign({}, base, hold, { phase: 'bet', pot: antes, acting: 2 % n })]); return step; }
  // 配り終わるのを待ってから、ベット
  let pot = antes, act = all.slice();
  const say = {};
  const sayStep = (i, t, add, wait) => { say[i] = t; pot += add; step.push([wait, Object.assign({}, base, hold, { phase: 'bet', active: act.slice(), say: Object.assign({}, say), pot, curBet: bet, acting: (i + 1) % n })]); };
  const ordr = []; for (let k = 0; k < n; k++) ordr.push((2 + k) % n);
  if (kind === 'fold') {
    ordr.forEach((i, k) => { if (i === win) return; act = act.filter(x => x !== i); say[i] = '降りた'; step.push([k === 0 ? 6800 : 1500, Object.assign({}, base, hold, { phase: 'bet', active: act.slice(), say: Object.assign({}, say), pot, acting: null })]); });
  } else {
    let first = true;
    ordr.forEach((i, k) => {
      const w = first ? 6800 : 1500; first = false;
      if (kind === 'nagashi' && i !== win && k % 2 === 1) { act = act.filter(x => x !== i); say[i] = '降りた'; step.push([w, Object.assign({}, base, hold, { phase: 'bet', active: act.slice(), say: Object.assign({}, say), pot, curBet: bet, acting: (i + 1) % n })]); return; }
      if (k === 0) sayStep(i, 'ベット ' + bet, bet, w); else sayStep(i, 'ついていく', bet, w);
    });
  }
  const live = act.slice(), spot = pot;
  // 勝負(カードを公開) → 結果
  const rev = kind === 'fold' || kind === 'nagashi' && false ? [] : live;
  const chipsAfter = i => 10000 - (live.includes(i) ? ante + (kind === 'fold' ? 0 : bet) : ante);
  if (kind === 'fold') {
    const gross = spot, fee = Math.ceil(gross * 0.01), cut = Math.ceil(gross * 0.02), net = gross - fee - cut;
    step.push([2000, Object.assign({}, base, hold, { phase: 'done', active: [win], say: Object.assign({}, say), pot: 0, chips: Object.assign({}, ...all.map(i => ({ [i]: i === win ? 10000 + net : chipsAfter(i) }))),
      result: { no: G, how: 'fold', winner: SC_NAMES[win], pot: net, fee, cut, shugi: 0, shugiRank: 0, jp: null, paid: {}, deltas: {}, hash: 'a3f9c27be10d5486' } })]);
    step.push([9000, null]); return step;
  }
  step.push([1800, Object.assign({}, base, hold, { phase: 'showdown', active: live, say: Object.assign({}, say), pot: spot, reveal: live })]);
  if (kind === 'nagashi') {
    step.push([1200, Object.assign({}, base, hold, { phase: 'done', active: live, reveal: live, say: Object.assign({}, say), pot: spot, result: { no: G, how: 'nagashi', winner: null, pot: 0, fee: 0, cut: 0, shugi: 0, shugiRank: 0, jp: null, paid: {}, deltas: {}, stake: {}, hash: 'a3f9c27be10d5486' } })]);
    step.push([9000, null]); return step;
  }
  const gross = spot, fee = Math.ceil(gross * 0.01), cut = Math.ceil(gross * 0.02), net = gross - fee - cut;
  const shugiOn = kind === 'solo10' || kind === 'soloN', shugi = shugiOn ? ante * wRank * (n - 1) : 0;
  const jpHit = kind === 'solo10' || kind === 'jackpot' || kind === 'last';
  const jpPaid = jpHit ? p.jp : 0;
  const how = kind === 'last' ? 'jackpot' : 'show';
  const res = { no: G, how, winner: SC_NAMES[win], pot: kind === 'last' ? 0 : net, fee, cut, shugi, shugiRank: shugiOn ? wRank : 0, jp: jpHit ? { paid: jpPaid, pool: p.jp, rank: wRank, last: kind === 'last' } : null, paid: {}, deltas: {}, hash: 'a3f9c27be10d5486' };
  step.push([1500, Object.assign({}, base, hold, { phase: 'done', active: live, reveal: live, say: Object.assign({}, say), pot: 0, jp: jpHit ? 0 : base.jp, last: kind === 'last',
    chips: Object.assign({}, ...all.map(i => ({ [i]: i === win ? 10000 + net + shugi + jpPaid : chipsAfter(i) - (shugiOn ? ante * wRank : 0) }))), result: res })]);
  step.push([10000, null]);
  return step;
}
/* 順に渡して動かす */
async function scenePlay(kind, p) {
  stopTable(); const gen = ++SC.gen; TB.scene = true; SFX.ambience('table'); TB.chatOn = false;
  TB.src = { id: 0, online: false, stop: () => { SC.gen++; }, act: async () => {}, post: async () => ({}), games: () => [] };
  const script = sceneScript(kind, p); let first = true;
  for (const [wait, o] of script) {
    await scSleep(wait); if (gen !== SC.gen) return;
    if (!o) { toast('再生が終わりました。もう一度見るには、もう一度押してください'); return; }
    const v = sceneView(p, o);
    if (first) { TB.lastNo = v.gameNo; first = false; }
    tableUpdate(v);
  }
}
