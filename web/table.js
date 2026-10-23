'use strict';
/* ソロ 卓の画面(琉球モダン)。オンラインの卓と、練習モードの両方で使う。 */
const TB = { sid: 0, retry: 0, v: null, src: null, ui: { amount: 1, sheet: null, mode: null, pk: null, games: null, verify: {} }, es: null, tick: null, lastNo: 0, banner: null };
const POS = {
  7: [[48, 480], [48, 335], [48, 190], [195, 62], [342, 190], [342, 335], [342, 480]],
  6: [[48, 495], [48, 340], [48, 185], [342, 185], [342, 340], [342, 495]],
  5: [[48, 440], [48, 235], [195, 62], [342, 235], [342, 440]],
  4: [[48, 440], [48, 190], [342, 190], [342, 440]],
  3: [[48, 330], [195, 62], [342, 330]],
  2: [[110, 120], [280, 120]],
  1: [[195, 62]]
};
const HUES = ['#D98A9A', '#3FA7B5', '#5E9E78', '#9B86C8', '#D9835A', '#C8B25A', '#6FB3A3', '#7BA0E0'];
const hueOf = n => { let h = 0; for (const c of String(n)) h = (h * 31 + c.codePointAt(0)) >>> 0; return HUES[h % HUES.length]; };
const TAG = { BET: ['#C9A24B', '#0B1522'], CALL: ['#1C8196', '#fff'], UP: ['#B8322A', '#fff'], FOLD: ['#4A5A6E', '#EAF0F7'] };
function tagOf(say) {
  if (!say) return null;
  if (say.startsWith('ベット')) return ['BET', say.replace('ベット', '').trim()];
  if (say.startsWith('アップ')) return ['UP', say.replace('アップ', '').trim()];
  if (say.startsWith('ついて')) return ['CALL', ''];
  if (say.startsWith('降')) return ['FOLD', ''];
  return null;
}
const cardHTML = (c, big) => {   // big=true: 自分の手札(大) / 'mid': 卓の上の相手の手札 / なし: 一覧用(小)
  const m = String(c).match(/^(\d+)(.)$/); const n = m ? m[1] : c, s = m ? m[2] : '', ink = s === '♥' || s === '♦' ? '#B8322A' : '#1B2230';
  const face = 'background:linear-gradient(160deg,#FFFFFF 0%,#F1ECDD 70%,#E4DDCB 100%);border:1px solid #B9B29E;';
  if (big === true) return `<div style="width:66px;height:94px;border-radius:5px;${face}box-shadow:0 5px 12px rgba(0,0,0,.6),inset 0 0 0 2px rgba(255,255,255,.7);color:${ink};position:relative;display:flex;align-items:center;justify-content:center"><span style="position:absolute;left:5px;top:2px;font-size:15px;font-weight:700;line-height:1">${n}<br><span style="font-size:13px">${s}</span></span><span style="position:absolute;right:5px;bottom:2px;font-size:15px;font-weight:700;line-height:1;transform:rotate(180deg)">${n}<br><span style="font-size:13px">${s}</span></span><span style="font-size:40px;font-weight:700">${n}</span></div>`;
  if (big === 'mid') return `<div style="width:32px;height:46px;border-radius:3px;${face}box-shadow:0 2px 5px rgba(0,0,0,.6);color:${ink};font-weight:700;display:flex;flex-direction:column;align-items:center;justify-content:center;line-height:1"><span style="font-size:20px">${n}</span><span style="font-size:13px">${s}</span></div>`;
  return `<div style="width:22px;height:30px;border-radius:2px;${face}color:${ink};font-size:13px;font-weight:700;display:flex;flex-direction:column;align-items:center;justify-content:center;line-height:1"><span>${n}</span><span style="font-size:10px">${s}</span></div>`;
};
const oyaMark = (pos) => `<span title="親" style="position:absolute;${pos};width:24px;height:24px;border-radius:50%;background:radial-gradient(circle at 35% 30%,#FF8A7E,#D8281C 60%,#8E140C);border:1px solid #3A0A06;color:#fff;font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center;box-shadow:0 1px 3px rgba(0,0,0,.6);z-index:2">親</span>`;
const bikiMark = (pos) => `<span title="ビキ" style="position:absolute;${pos};width:26px;height:26px;box-sizing:border-box;border-radius:50%;border:4px solid #E0352A;background:#0B1522;color:#fff;font-size:10px;font-weight:700;display:flex;align-items:center;justify-content:center;box-shadow:0 1px 3px rgba(0,0,0,.6);z-index:2">ビ</span>`;
const TURNTXT = { oya: ['▼ BETの番', 0], follow: ['▼ CALLの番', 2], followUp: ['▼ UPにCALLの番', 1], biki: ['▼ UPの番', 1], carryJoin: ['▼ 参加の番', 2] };
const turnMark = (type) => { const t = TURNTXT[type] || ['▼ TURN', 0], bg = ['#C9A24B', '#B8322A', '#1C8196'][t[1]], fg = t[1] ? '#fff' : '#0B1522'; return `<span class="tring" style="border-color:${bg}"></span><span style="position:absolute;left:50%;top:-20px;transform:translateX(-50%);padding:0 8px;height:16px;line-height:16px;border-radius:8px;background:${bg};color:${fg};font-size:10px;font-weight:700;letter-spacing:.1em;white-space:nowrap;z-index:3;box-shadow:0 1px 4px rgba(0,0,0,.6)">${t[0]}</span>`; };
const back2 = () => `<div style="width:26px;height:38px;border-radius:3px;${BACKCSS};box-shadow:0 2px 5px rgba(0,0,0,.6),inset 0 0 0 2px #0F2236,inset 0 0 0 3px rgba(201,162,75,.45)"></div>`;

function stageScale() {
  const st = $('.stage'); if (!st) return;
  const sc = Math.min(window.innerWidth / 390, window.innerHeight / 844);
  st.style.transform = `scale(${sc})`; st.style.marginLeft = Math.max(0, (window.innerWidth - 390 * sc) / 2) + 'px';
}
window.addEventListener('resize', () => { stageScale(); if (typeof fxAlign === 'function') fxAlign(); });


/* ---------- 場のチップ(1か所・額ごとの色) ----------
   場のチップの合計を、大きい額から順に分けて、1か所にまとめて置く。
   100=白 / 500=赤 / 1,000=青 / 5,000=緑 / 10,000=黒 / 50,000=紫 / 100,000=金。端数(100未満)は灰色。 */
const DENOM = [[100000, '#E0B030', '#2A1B00', '100K'], [50000, '#7B4BC0', '#fff', '50K'], [10000, '#222A34', '#FFE08A', '10K'], [5000, '#2E9A55', '#fff', '5K'], [1000, '#2F6FD0', '#fff', '1K'], [500, '#D03A2E', '#fff', '500'], [100, '#E9EEF3', '#1B2430', '100']];
function chipBreak(pot) {
  let n = Math.max(0, Math.floor(Number(pot) || 0)); const out = [];
  DENOM.forEach(d => { const c = Math.floor(n / d[0]); if (c > 0) { out.push({ v: d[0], n: c, bg: d[1], fg: d[2], t: d[3] }); n -= c * d[0]; } });
  if (n > 0) out.push({ v: n, n: 1, bg: '#8A94A0', fg: '#0B1522', t: String(n), rem: true });
  return out;
}
function pileHTML(pot) {
  const st = chipBreak(pot).reverse();   // 小さい額が左、大きい額が右
  const W = Math.max(26, Math.min(46, Math.floor(190 / Math.max(1, st.length))));
  const stacks = st.map(d => {
    const show = Math.min(d.n, 7); let ch = '';
    const light = d.bg === '#E9EEF3';
    for (let k = 0; k < show; k++) {
      const top = k === show - 1, off = (k % 2 ? 1 : -1) * ((k * 7) % 3 === 0 ? 1 : 0);
      ch += `<div style="position:absolute;left:${off}px;bottom:${k * 5}px;width:44px;height:18px;margin-left:${(W - 44) / 2}px;border-radius:50%;box-sizing:border-box;background:radial-gradient(ellipse at 50% 35%,rgba(255,255,255,${top ? .32 : .12}) 0 30%,transparent 62%),${d.bg};border:3px dashed ${light ? 'rgba(80,95,115,.55)' : 'rgba(255,255,255,.8)'};box-shadow:0 ${top ? 3 : 1}px 2px rgba(0,0,0,.6),inset 0 0 0 2px ${light ? 'rgba(120,135,155,.5)' : 'rgba(0,0,0,.28)'};color:${d.fg};font-size:9px;font-weight:800;line-height:12px;text-align:center">${top ? `<span style="display:inline-block;width:26px;height:10px;margin-top:-1px;border-radius:50%;background:${d.bg};box-shadow:inset 0 0 0 1px ${light ? 'rgba(80,95,115,.5)' : 'rgba(255,255,255,.55)'}">${d.t}</span>` : ''}</div>`;
    }
    return `<div title="${fmt(d.v)}×${d.n}" style="display:flex;flex-direction:column;align-items:center;justify-content:flex-end;width:${W}px"><span style="font-size:10px;line-height:11px;color:#C5D3E3;height:11px;text-shadow:0 1px 2px #000">${d.n > 1 ? '×' + d.n : ''}</span><div style="position:relative;width:${W}px;height:${show * 5 + 16}px">${ch}</div></div>`;
  }).join('');
  return `<div id="chippile" style="height:78px;min-width:70px;display:flex;align-items:flex-end;justify-content:center">${stacks}</div>`;
}
function turnLine(v, req, closed) {
  if (closed) return '';
  const pill = (bg, fg, t, dot, glow) => `<span style="display:inline-flex;align-items:center;gap:8px;padding:5px 16px;border-radius:18px;background:${bg};color:${fg};font-size:15px;font-weight:700;letter-spacing:.14em;box-shadow:${glow || '0 2px 6px rgba(0,0,0,.5)'};border:1px solid rgba(255,255,255,.18)">${dot || ''}${t}</span>`;
  if (v.status === 'open') { const need = v.settings.startMode === 'condition' ? v.settings.minPlayers : 2; return pill('rgba(5,13,24,.85)', '#9FC0D8', `WAITING ${v.seats.filter(x => !x.empty).length}/${need}`); }
  if (req) return pill('linear-gradient(180deg,#E3BC5E,#B8892B)', '#1A1204', 'YOUR TURN', '<i style="width:9px;height:9px;border-radius:50%;background:#1A1204;display:inline-block"></i>', '0 0 16px rgba(227,188,94,.7)');
  const a = v.seats.find(x => x.acting && !x.empty);
  if (a) return pill('rgba(5,13,24,.88)', '#EAF0F7', `${e(a.name)}<span style="font-weight:500;font-size:12px;letter-spacing:.04em"> の番</span>`, `<i style="width:11px;height:11px;border-radius:50%;background:${hueOf(a.name)};display:inline-block;box-shadow:0 0 8px ${hueOf(a.name)}"></i>`);
  return '';
}
const JP_LOOP = 12000;
function jpTicker(v) {
  if (!v.jp || !v.jp.on || v.watch) return '';
  const ph = (period, add) => `animation-delay:-${(((Date.now() % (period * 1000)) / 1000) + (add || 0)).toFixed(2)}s`;   // 画面を作り直しても、光り方が最初に戻らない
  const st = ['✦', '✧', '★', '✦', '✧'].map((c, k) => `<span class="jpstar" style="left:${[8, 27, 52, 71, 90][k]}%;top:${[18, 62, 22, 58, 20][k]}%;${ph(1.8, k * .45)}">${c}</span>`).join('');
  const txt = `<span class="jpgold" style="letter-spacing:.32em;font-size:12px;${ph(2.6)}">${v.jp.last ? 'LAST GAME' : 'JACKPOT'}</span><b class="jpgold" style="font-size:25px;letter-spacing:.05em;${ph(2.6)}">${fmt(v.jp.pool)}</b>${v.jp.msg ? `<span style="font-size:12px;color:#FFE9B0">${e(v.jp.msg)}</span>` : ''}`;
  return `<button class="act" data-a="tSheet" data-v="rules" aria-label="積立の情報" id="jpbox" style="all:unset;cursor:pointer;position:absolute;left:14px;top:2px;width:362px;height:42px;overflow:hidden;border-radius:6px;z-index:5;box-sizing:border-box;border:2px solid #E8C25A;background:radial-gradient(ellipse at 15% 20%,rgba(255,120,200,.35),transparent 55%),radial-gradient(ellipse at 85% 80%,rgba(80,140,255,.35),transparent 55%),linear-gradient(180deg,#3A1466,#150A33);box-shadow:0 0 16px rgba(232,194,90,.55),inset 0 0 14px rgba(0,0,0,.55)">
    <div class="jpbulb t" style="${ph(1.1)}"></div><div class="jpbulb b" style="${ph(1.1, .55)}"></div>${st}
    <div class="jptrack" style="animation-delay:-${((Date.now() % JP_LOOP) / 1000).toFixed(2)}s"><span style="font-size:22px">🎰</span>${txt}<span class="jpgold" style="font-size:18px">✦</span><span style="font-size:20px">💎</span></div></button>`;
}

function seatHTML(s, x, y) {
  if (s.empty) return `<div style="position:absolute;left:${x - 27}px;top:${y - 27}px;width:54px;height:54px;border-radius:50%;border:1px dashed #2A4262;opacity:.7;display:flex;align-items:center;justify-content:center;color:#2A4262;font-size:9px;letter-spacing:.06em">EMPTY</div>`;
  const folded = s.inGame && !s.active, dim = folded || s.away, inPlay = s.inGame && s.active;
  const tg = tagOf(s.say), hue = hueOf(s.name);
  const glow = s.acting ? '0 0 0 3px rgba(201,162,75,.28),0 0 14px 3px rgba(201,162,75,.45)' : '0 2px 6px rgba(0,0,0,.5)';
  return `<button class="act" data-a="tPlayer" data-v="${s.i}" style="position:absolute;left:${x - 39}px;top:${y - 23}px;width:78px;padding:0;border:0;background:none;color:inherit;display:flex;flex-direction:column;align-items:center;z-index:3">
    <span style="position:relative;width:46px;height:46px;border-radius:50%;background:#10243A;border:2px solid ${folded ? '#59636F' : inPlay ? '#3FD0B8' : hue};box-shadow:${folded ? '0 2px 6px rgba(0,0,0,.5)' : inPlay && !s.acting ? '0 0 0 2px rgba(63,208,184,.25),0 0 10px 2px rgba(63,208,184,.45)' : glow};display:flex;align-items:center;justify-content:center;opacity:${dim ? .42 : 1};${folded ? 'filter:grayscale(1)' : ''}">${folded ? '<span style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:34px;font-weight:300;color:#C8D0DA;line-height:1;z-index:1">✕</span>' : ''}${inPlay ? '<span style="position:absolute;left:-3px;bottom:-3px;width:12px;height:12px;border-radius:50%;background:#3FD0B8;border:2px solid #07121F;z-index:2"></span>' : ''}
      <span style="font-size:17px;font-weight:500">${e(String(s.name).slice(0, 1).toUpperCase())}</span>
      ${s.acting ? turnMark(TB.actType) : ''}${s.oya ? oyaMark('right:-10px;top:-10px') : ''}${s.biki ? bikiMark('left:-10px;top:-10px') : ''}
      ${tg ? `<span style="position:absolute;left:50%;bottom:-9px;transform:translateX(-50%);padding:0 7px;height:15px;line-height:15px;border-radius:2px;background:${TAG[tg[0]][0]};color:${TAG[tg[0]][1]};font-size:11px;font-weight:600;letter-spacing:.1em;white-space:nowrap;border:1px solid #070F1A">${tg[0]}${tg[1] ? ' ' + e(tg[1]) : ''}</span>` : ''}
    </span>
    <span style="margin-top:9px;min-width:58px;max-width:76px;padding:1px 6px;border-radius:2px;background:rgba(5,13,24,.92);border:1px solid #1F344C;display:flex;flex-direction:column;align-items:center;opacity:${dim ? .5 : 1}">
      <span style="max-width:62px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:10px;font-weight:500">${e(s.name)}${s.away ? ' ・離席' : ''}${s.rest ? ' ・お休み' : ''}</span>
      ${s.chips != null ? `<span style="font-size:13px;font-weight:600;line-height:1.1;color:#C9A24B">${fmt(s.chips)}</span>` : ''}${s.net != null ? `<span style="font-size:10px;line-height:1.2;color:${s.net > 0 ? '#3FB6A8' : s.net < 0 ? '#E0645C' : '#8FA6BE'}">${s.net > 0 ? '+' : s.net < 0 ? '−' : ''}${fmt(Math.abs(s.net))}</span>` : ''}</span>
    ${s.hand ? `<span data-slot="${s.i}" style="display:flex;gap:2px;margin-top:3px;visibility:${FX.hide ? 'hidden' : 'visible'}">${s.hand.map(c => cardHTML(c, 'mid')).join('')}</span>` : s.hasCards ? `<span data-slot="${s.i}" style="display:flex;gap:2px;margin-top:3px;visibility:${FX.hide ? 'hidden' : 'visible'}">${back2()}${back2()}</span>` : ''}
  </button>`;
}

function barBtn(key, label, sub, bg, fg, border, enabled, act) {
  return `<button class="act" ${enabled ? '' : 'disabled'} data-a="${act}" style="flex:1;min-width:0;height:58px;border:${border ? '1px solid ' + border : '0'};border-radius:2px;background:${bg};color:${fg};line-height:1.1;opacity:${enabled ? 1 : .35}"><span style="display:block;font-size:19px;font-weight:600;letter-spacing:.14em;text-indent:.14em">${label}</span><span style="display:block;margin-top:2px;font-size:10px;font-weight:400;letter-spacing:.04em">${sub}</span></button>`;
}

function tableHTML(v) {
  TB.actType = v.actType; const ui = TB.ui, n = v.seats.length, me = v.you && v.you.seat >= 0 ? v.you.seat : -1;
  const base = me >= 0 ? me : 0, spectator = me < 0;
  const order = []; for (let k = 1; k < n; k++) order.push((base + k) % n);
  const pos = POS[Math.min(7, Math.max(1, order.length))];
  const black = v.color === 'black', rim = black ? '#3A3F4A' : '#B8322A';
  const req = v.req, mineSeat = me >= 0 ? v.seats[me] : v.seats[base];
  const s = v.settings;
  const closed = ['ended', 'stopped'].includes(v.status);
  // 中央のメッセージ
  let hintT = '', hintS = '';
  const last = v.log.length ? v.log[v.log.length - 1].m : '';
  if (closed) { hintT = 'TABLE CLOSED'; hintS = '卓は終了しました'; }
  else if (v.status === 'open') { const need = s.startMode === 'condition' ? s.minPlayers : 2; hintT = 'WAITING'; hintS = `${v.seats.filter(x => !x.empty).length}/${need}人 そろうと始まります`; }
  else if (req) { hintT = 'YOUR TURN'; hintS = ({ oya: 'ベットするか、降りるか選びます', follow: `${fmt(req.amount)}チップのベットです。ついていくか選びます`, followUp: `アップ ${fmt(req.amount)}チップです。ついていくか選びます`, biki: `${fmt(req.amount)}チップのベットです。アップもできます`, carryJoin: req.short ? `チップが足りません(必要${fmt(req.need)}チップ・今${fmt(req.have)}チップ)。時間内にAJからチップをもらい、メニューの「ポケットと卓のチップを移す」で卓に移してから「参加する」を押します。参加しないなら「不参加だった」を押します` : `流れた次の試合です。${fmt(req.fee)}チップ+参加料${fmt(req.ante)}チップで入るか、見送るか選びます` })[req.type] || ''; }
  else { hintT = v.phase === 'showdown' ? 'SHOWDOWN' : (v.seats.find(x => x.acting) ? e(v.seats.find(x => x.acting).name) + ' …' : 'PLAYING'); hintS = last; }
  const remain = req && req.deadline ? Math.max(0, Math.ceil((req.deadline - (Date.now() + (TB.skew || 0))) / 1000)) : null;
  // 下のボタン
  let bar;
  if (spectator) bar = `<div style="height:58px;display:flex;align-items:center;justify-content:center;color:#8FA6BE;letter-spacing:.2em;font-size:14px">WATCHING ・ 観戦中(手札も見えます)</div>`;
  else {
    const T = req && req.type;
    if (T === 'carryJoin') bar = `<div style="height:58px;display:flex;gap:6px;padding:0 12px">${barBtn('k', 'SKIP', req.short ? '不参加だった' : '見送る(傍観)', '#112238', '#C5D3E3', '#3B5674', true, 'tSkip')}${barBtn('j', 'JOIN', fmt(req.short ? req.need : req.fee + req.ante) + 'チップで参加', '#C9A24B', '#0B1522', '', true, 'tJoin')}</div>`;
    else {
    const canBet = T === 'oya' && req.canBet, canCall = T === 'follow' || T === 'followUp' || T === 'biki';
    const canUp = T === 'biki' && req.upCap > 0, canShow = T === 'oya' && req.canShow;
    const callSub = T === 'biki' || T === 'follow' || T === 'followUp' ? fmt(req.amount) + 'チップ' : (canShow ? '勝負する' : 'ついていく');
    bar = `<div style="height:58px;display:flex;gap:6px;padding:0 12px">${barBtn('f', 'FOLD', '降りる', '#112238', '#C5D3E3', '#3B5674', !!req, 'tFold')}${barBtn('b', 'BET', canBet ? fmt(req.minBet) + '〜' + fmt(req.cap) : 'ベット', '#C9A24B', '#0B1522', '', canBet, 'tBetOpen')}${canShow ? barBtn('s', 'SHOW', '勝負する', '#1C8196', '#fff', '', true, 'tShow') : barBtn('c', 'CALL', callSub, '#1C8196', '#fff', '', canCall, 'tCall')}${barBtn('u', 'UP', canUp ? fmt(req.minUp) + '〜' + fmt(req.upCap) : 'アップ', '#B8322A', '#fff', '', canUp, 'tUpOpen')}</div>`;
    }
  }
  // スライダー
  let slider = '';
  if (ui.mode && req) {
    const isUp = ui.mode === 'up', lo = isUp ? req.minUp : req.minBet, hi = isUp ? req.upCap : req.cap;
    ui.amount = Math.max(lo, Math.min(hi, ui.amount || lo));
    slider = `<div style="position:absolute;inset:0;z-index:20;background:rgba(3,8,16,.55)"></div>
    <div style="position:absolute;right:10px;top:238px;width:86px;height:436px;z-index:21;border-radius:3px;background:#0B1726;border:1px solid #C9A24B;box-shadow:0 10px 30px rgba(0,0,0,.65);display:flex;flex-direction:column;align-items:center;overflow:hidden">
      <div style="width:100%;height:62px;flex:none;background:#12263C;border-bottom:1px solid #C9A24B;display:flex;flex-direction:column;align-items:center;justify-content:center;line-height:1.05"><span style="font-size:12px;font-weight:600;color:#C9A24B;letter-spacing:.3em;text-indent:.3em">${isUp ? 'UP' : 'BET'}</span><span id="sl_v" style="font-size:30px;font-weight:600">${fmt(ui.amount)}</span></div>
      <div style="flex:1;display:flex;align-items:center;justify-content:center"><input class="vr" id="sl_r" type="range" min="${lo}" max="${hi}" step="${Math.max(1, Math.floor((hi - lo) / 200)) >= 1 && hi - lo > 200 ? Math.floor((hi - lo) / 100) : 1}" value="${ui.amount}" data-lo="${lo}" data-hi="${hi}" aria-label="チップを選ぶ"></div>
      <div style="padding-bottom:8px;font-size:11px;font-weight:600;letter-spacing:.14em;color:#8FA6BE">MAX ${fmt(hi)}</div></div>
    <div style="position:absolute;right:100px;top:400px;z-index:21;display:flex;flex-direction:column;gap:8px">
      <button class="act" data-a="tStep" data-v="1" style="width:50px;height:50px;border:1px solid #C9A24B;border-radius:2px;background:#0B1726;color:#EAF0F7;font-size:28px">+</button>
      <button class="act" data-a="tStep" data-v="-1" style="width:50px;height:50px;border:1px solid #C9A24B;border-radius:2px;background:#0B1726;color:#EAF0F7;font-size:28px">−</button>
      <button class="act" data-a="tMax" style="width:50px;height:34px;border:1px solid #C9A24B;border-radius:2px;background:#0B1726;color:#C9A24B;font-size:12px;font-weight:600">MAX</button></div>`;
    bar = `<div style="height:58px;display:flex;gap:6px;padding:0 12px;position:relative;z-index:22">
      <button class="act" data-a="tCancel" style="flex:1;border:1px solid #3B5674;border-radius:2px;background:#112238;color:#C5D3E3;line-height:1.1"><span style="display:block;font-size:17px;font-weight:600;letter-spacing:.14em">CANCEL</span><span style="display:block;font-size:10px">やめる</span></button>
      <button class="act" data-a="tConfirm" style="flex:2.2;border:0;border-radius:2px;background:#B8322A;color:#fff;line-height:1.1"><span id="sl_c" style="display:block;font-size:19px;font-weight:600;letter-spacing:.14em">${isUp ? 'CALL + UP' : 'BET'} ${fmt(ui.amount)}</span><span style="display:block;font-size:10px">決定</span></button></div>`;
  }
  const foldedMe = mineSeat && !mineSeat.empty && mineSeat.inGame && !mineSeat.active;
  const hand = v.mine && !foldedMe ? `<div data-slot="me" style="position:absolute;left:196px;top:584px;z-index:4;display:flex;visibility:${FX.hide ? 'hidden' : 'visible'}"><div style="transform:rotate(-4deg);transform-origin:bottom right">${cardHTML(v.mine.hand[0], true)}</div><div style="margin-left:-16px;transform:rotate(3deg);transform-origin:bottom left">${cardHTML(v.mine.hand[1], true)}</div></div>${v.mine.label && !FX.hide ? `<div style="position:absolute;left:206px;top:566px;z-index:5;padding:0 8px;height:16px;line-height:16px;border-radius:8px;background:rgba(5,13,24,.9);border:1px solid #C9A24B;font-size:10px;font-weight:600;color:#F2D9A0;letter-spacing:.06em">${e(v.mine.label)}</div>` : ''}` : '';
  const hueMe = mineSeat && !mineSeat.empty ? hueOf(mineSeat.name) : '#C9A24B';
  const meBlock = spectator ? '' : `<button class="act" data-a="tMenu" style="position:absolute;left:127px;top:584px;width:76px;padding:0;border:0;background:none;color:inherit;display:flex;flex-direction:column;align-items:center;z-index:3">
    <span id="meav" style="position:relative;width:50px;height:50px;border-radius:50%;background:#10243A;border:3px solid ${foldedMe ? '#59636F' : '#C9A24B'};${foldedMe ? 'filter:grayscale(1);opacity:.55;' : ''}box-shadow:${req ? '0 0 0 3px rgba(201,162,75,.28),0 0 14px 3px rgba(201,162,75,.45)' : '0 2px 6px rgba(0,0,0,.5)'};display:flex;align-items:center;justify-content:center">
      <span style="font-size:22px;font-weight:500">${foldedMe ? '✕' : e(String(mineSeat.name).slice(0, 1).toUpperCase())}</span>
      ${mineSeat.acting || req ? turnMark(req ? req.type : TB.actType) : ''}${mineSeat.oya ? oyaMark('right:-10px;top:-10px') : ''}${mineSeat.biki ? bikiMark('left:-10px;top:-10px') : ''}
      ${(() => { const t = tagOf(mineSeat.say); return t ? `<span style="position:absolute;left:50%;bottom:-9px;transform:translateX(-50%);padding:0 7px;height:15px;line-height:15px;border-radius:2px;background:${TAG[t[0]][0]};color:${TAG[t[0]][1]};font-size:11px;font-weight:600;letter-spacing:.1em;white-space:nowrap;border:1px solid #070F1A">${t[0]}${t[1] ? ' ' + e(t[1]) : ''}</span>` : ''; })()}
    </span><span style="margin-top:10px;min-width:66px;padding:2px 8px;border-radius:2px;background:rgba(5,13,24,.92);border:1px solid #1F344C;display:flex;flex-direction:column;align-items:center"><span style="font-size:11px;font-weight:500">${e(mineSeat.name)}</span><span style="font-size:15px;font-weight:600;line-height:1.1;color:#C9A24B">${fmt(mineSeat.chips)}</span>${mineSeat.net != null ? `<span style="font-size:10px;line-height:1.2;color:${mineSeat.net > 0 ? '#3FB6A8' : mineSeat.net < 0 ? '#E0645C' : '#8FA6BE'}">${mineSeat.net > 0 ? '+' : mineSeat.net < 0 ? '−' : ''}${fmt(Math.abs(mineSeat.net))}</span>` : ''}</span></button>
    <div id="tm_box" style="position:absolute;left:80px;top:598px;width:40px;height:40px;border-radius:2px;border:1px solid #C9A24B;background:rgba(5,13,24,.92);display:${remain != null ? 'flex' : 'none'};flex-direction:column;align-items:center;justify-content:center;line-height:1;z-index:3"><span id="tm_n" style="font-size:18px;font-weight:600;color:#C9A24B">${remain != null ? remain : ''}</span><span style="font-size:9px;letter-spacing:.14em;color:#9FB4CC">SEC</span></div>`;
  const banner = TB.banner ? `<div style="position:absolute;left:40px;right:40px;top:290px;z-index:10;padding:12px 14px;border:2px solid #E8C25A;background:linear-gradient(180deg,rgba(40,20,70,.96),rgba(12,8,30,.97));border-radius:10px;text-align:center;box-shadow:0 0 22px rgba(232,194,90,.55),0 8px 24px rgba(0,0,0,.7)">${TB.banner.text}</div>` : '';
  const vote = v.vote && me >= 0 ? `<div style="position:absolute;left:12px;right:12px;top:58px;z-index:30;padding:8px 10px;border:1px solid #C9A24B;background:#0B1726;border-radius:2px;display:flex;align-items:center;gap:8px"><div style="flex:1;font-size:12px;line-height:1.4"><b style="color:#C9A24B">${e(v.vote.who)}</b> が途中参加を希望(賛成${v.vote.yes}/${v.vote.need}必要)</div>${v.vote.mine ? `<span class="pill">${v.vote.mine === 'yes' ? '賛成済み' : '反対済み'}</span>` : `<button class="act" data-a="tVote" data-v="1" style="height:30px;padding:0 10px;border:0;background:#1C8196;color:#fff;border-radius:2px;font-weight:600">YES</button><button class="act" data-a="tVote" data-v="0" style="height:30px;padding:0 10px;border:1px solid #3B5674;background:#112238;color:#C5D3E3;border-radius:2px;font-weight:600">NO</button>`}</div>` : '';
  const closedOv = closed ? `<div style="position:absolute;inset:0;z-index:45;background:rgba(3,8,16,.82);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;text-align:center"><div style="font-size:26px;font-weight:600;letter-spacing:.3em;color:#C9A24B">TABLE CLOSED</div><div style="font-size:13px;color:#C5D3E3;line-height:1.7">卓が終わりました。<br>チップはポケットに戻りました。</div>${v.finalTxt || ''}<button class="act" data-a="tHome" style="height:48px;padding:0 28px;border:0;border-radius:2px;background:#C9A24B;color:#0B1522;font-size:16px;font-weight:600;letter-spacing:.2em">BACK <span style="font-size:11px;font-weight:400">ホームへ</span></button></div>` : '';
  const title = e(v.name || 'PRACTICE');
  return `<div class="stagewrap"><div class="stage">
  <div style="height:56px;display:flex;align-items:center;justify-content:space-between;padding:0 12px">
    <button class="act" data-a="${v.practice ? 'tHome' : 'tMenu'}" aria-label="メニュー" style="width:40px;height:40px;border:1px solid #2A4262;border-radius:2px;background:transparent;color:#EAF0F7"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="square"><path d="M15 5l-7 7 7 7"/></svg></button>
    <div style="height:36px;padding:0 16px;border-radius:2px;border:1px solid #2A4262;background:#0D1B2C;display:flex;align-items:center;gap:12px"><span style="font-size:15px;font-weight:600;letter-spacing:.16em;max-width:130px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${title}</span><span style="width:1px;height:14px;background:#2A4262"></span><span style="font-size:14px;font-weight:500;letter-spacing:.16em;color:#C9A24B">GAME ${v.gameNo || 0}</span></div>
    <button class="act" data-a="tMenu" aria-label="メニュー" style="width:40px;height:40px;border:1px solid #2A4262;border-radius:2px;background:transparent;color:#C9A24B"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="square"><path d="M4 7h16M4 12h16M4 17h10"/></svg></button></div>
  <div style="position:relative;height:690px">
    ${jpTicker(v)}
    <div style="position:absolute;left:16px;top:48px;width:358px;height:566px;border-radius:64px;border:16px solid transparent;background:repeating-radial-gradient(circle at 30% 20%,rgba(255,255,255,.025) 0 1px,transparent 1px 3px) padding-box,radial-gradient(ellipse at 50% 42%,#1A6A96 0%,#0F4C72 52%,#08283F 100%) padding-box,linear-gradient(135deg,#8A5A30 0%,#4A2C14 30%,#7A4C26 55%,#3A200E 80%,#6B4222 100%) border-box;box-shadow:0 0 0 1px rgba(201,162,75,.7),0 16px 34px rgba(0,0,0,.7),inset 0 0 0 2px ${rim},inset 0 0 50px rgba(0,0,0,.5),inset 0 4px 10px rgba(0,0,0,.6)"></div>
    <div style="position:absolute;left:16px;width:358px;top:296px;text-align:center;font-size:72px;font-weight:700;letter-spacing:.45em;text-indent:.45em;color:rgba(234,240,247,.05)">SOLO</div>
    <div style="position:absolute;left:62px;width:266px;top:196px;display:flex;flex-direction:column;align-items:center;gap:8px;text-align:center">
      <button class="act" data-a="tSheet" data-v="rules" aria-label="卓の情報" style="all:unset;cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:6px;-webkit-tap-highlight-color:transparent">
        <div style="display:flex;align-items:flex-end;gap:10px">${pileHTML(v.pot)}<span id="potbox" style="margin-bottom:2px;padding:1px 8px;border-radius:9px;background:rgba(5,13,24,.78);border:1px solid rgba(201,162,75,.6);font-size:13px;font-weight:700;color:#F2D9A0;white-space:nowrap"><span style="font-size:9px;letter-spacing:.2em;color:#C9A24B;margin-right:4px">POT</span>${fmt(v.pot)}</span></div>
        ${v.curBet > 0 ? `<div style="display:flex;gap:6px;align-items:center"><span style="padding:2px 10px;border-radius:2px;background:#C9A24B;color:#0B1522;font-size:13px;font-weight:700;letter-spacing:.08em">BET ${fmt(v.curBet)}</span>${v.curUp > 0 ? `<span style="padding:2px 10px;border-radius:2px;background:#B8322A;color:#fff;font-size:13px;font-weight:700;letter-spacing:.08em">UP +${fmt(v.curUp)}</span>` : ''}</div>` : ''}
      </button>
      ${turnLine(v, req, closed)}${peekHTML(v)}</div>
    ${order.map((idx, k) => seatHTML(v.seats[idx], pos[k][0], pos[k][1])).join('')}
    ${meBlock}${hand}${banner}${slider}
  </div>
  ${bar}${vote}${sheetHTML(v)}${closedOv}
  </div></div>`;
}

/* ---------- シート(メニューなど) ---------- */
function sheetHTML(v) {
  const ui = TB.ui; if (!ui.sheet) return '';
  const s = v.settings, back = `<button class="act" data-a="tMenu" style="width:38px;height:38px;border:1px solid #2A4262;border-radius:2px;background:transparent;color:#EAF0F7;font-size:22px">‹</button>`;
  const head = (t, sub) => `<div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">${back}<div style="flex:1;font-size:18px;font-weight:600;letter-spacing:.2em">${t}${sub ? ` <span style="color:#C9A24B;font-size:13px">${sub}</span>` : ''}</div></div>`;
  const mi = (a, t, sub, red) => `<button class="menu act" data-a="${a}" style="${red ? 'color:#E0594E' : ''}"><span><b>${t}</b><small>${sub}</small></span><i>›</i></button>`;
  let body = '';
  const me = v.you && v.you.seat >= 0 ? v.seats[v.you.seat] : null;
  if (ui.sheet === 'menu') {
    body = `${me ? `<div style="display:flex;align-items:center;gap:14px;padding-bottom:12px"><div style="flex:1"><div style="font-size:20px;font-weight:500">${e(me.name)}</div><div style="font-size:12px;letter-spacing:.14em;color:#8FA6BE">SEAT ${me.i + 1}</div></div><div style="text-align:right"><div style="font-size:11px;letter-spacing:.2em;color:#8FA6BE">CHIPS</div><div style="font-size:30px;font-weight:600;line-height:1;color:#C9A24B">${fmt(me.chips)}</div></div></div><div class="note">うち ${fmt(s.reserve)}チップは祝儀用の予備です。賭けられるのは ${fmt(Math.max(0, me.chips - s.reserve))}チップまでです。</div>` : ''}
    ${mi('tSheet" data-v="log', 'LEDGER', 'ゲームの流れ・結果')}${!v.practice ? mi('tSheet" data-v="gd', 'GAME DATA', 'ゲームごとのチップの流れ・動き・勝負のカード') : ''}${mi('tSheet" data-v="fair', 'FAIRNESS', '公平の確認(デッキの指紋)')}${mi('tSheet" data-v="rules', 'RULES', 'この卓のルール')}${mi('sfxToggle', SFX.on ? 'SOUND ON' : 'SOUND OFF', '音全体のオン・オフ(いまは' + (SFX.on ? 'オン' : 'オフ') + ')')}${mi('bgmToggle', BGM.on ? 'BGM ON' : 'BGM OFF', '音楽のオン・オフ(いまは' + (BGM.on ? 'オン' : 'オフ') + ')')}${mi('bgmSheet', 'BGM SELECT', '曲を選ぶ(ロビー用・卓用)')}
    ${!v.practice && s.chat && TB.chatOn ? mi('tSheet" data-v="chat', 'MESSAGES', '卓のメッセージ') : ''}
    ${!v.practice && me && s.startMode === 'free' ? mi('tSheet" data-v="exch', 'CHIPS ⇄ POCKET', 'ポケットと卓のチップを移す') : ''}
    ${!v.practice && me ? mi('tAway', v.you.away ? 'I\'M BACK' : 'AWAY', v.you.away ? '戻る' : '離席する(参加料は払い続け、自動で降ります。参加費は自動では引かれません)') : ''}
    ${me ? mi('tSheet" data-v="leave', 'LEAVE TABLE', '席を立つ', true) : mi('tHome', 'CLOSE', '閉じる')}`;
  } else if (ui.sheet === 'log') {
    const R = v.result, sg = x => (x > 0 ? '+' : x < 0 ? '−' : '') + fmt(Math.abs(x)), col = x => x > 0 ? '#3FB6A8' : x < 0 ? '#E0645C' : '#8FA6BE';
    const names = R ? Array.from(new Set([].concat(Object.keys(R.paid || {}), Object.keys(R.deltas || {})))) : [];
    const net = {}; v.seats.forEach(x => { if (!x.empty) net[x.name] = x.net; });
    body = head('LEDGER', 'GAME ' + (v.gameNo || 0)) + (R ? `<div class="note" style="margin-bottom:8px">直前のゲーム: ${R.winner ? e(R.winner) + ' の勝ち' : '流し(場のチップは次のゲームへ)'}</div>
      <div style="display:grid;grid-template-columns:1.4fr 1fr 1fr 1fr;gap:4px 6px;font-size:12px;margin-bottom:10px"><b class="mute">名前</b><b class="mute" style="text-align:right">払った合計</b><b class="mute" style="text-align:right">このゲーム</b><b class="mute" style="text-align:right">この卓の通算</b>
      ${names.map(k => `<span>${e(k)}</span><span style="text-align:right">${R.paid && R.paid[k] != null ? fmt(R.paid[k]) : '−'}</span><span style="text-align:right;color:${col((R.deltas || {})[k] || 0)}">${sg((R.deltas || {})[k] || 0)}</span><span style="text-align:right;color:${col(net[k] || 0)}">${net[k] != null ? sg(net[k]) : '−'}</span>`).join('')}</div>
      ${R.how === 'nagashi' && R.stake ? `<div class="note" style="margin-bottom:8px">流れた場にある、一人ひとりの出した合計: ${Object.entries(R.stake).map(([k, x]) => `${e(k)} ${fmt(x)}`).join(' / ')}</div>` : ''}` : '') + v.log.slice().reverse().slice(0, 40).map(l => `<div class="msgline">${e(l.m)}</div>`).join('');
  } else if (ui.sheet === 'gd') {
    const L = ui.gd, ACT = { bet: 'ベット', call: 'ついていく', call_up: 'アップについていく', up: 'アップ', fold: '降りた', fold_poor: 'チップ不足で降りた', show: '勝負を選んだ' };
    const sg = x => (x > 0 ? '+' : x < 0 ? '−' : '') + fmt(Math.abs(x)), col = x => x > 0 ? '#3FB6A8' : x < 0 ? '#E0645C' : '#8FA6BE';
    body = head('GAME DATA', 'ゲームデータ') + `<div class="note" style="margin-bottom:8px">チップの流れ・人の動き・勝者は、そのゲームに参加した人が見られます。カードが見られるのは、勝負まで進んだ人だけです(降りた人のカードは記録に残りません)。</div>` +
      (L == null ? '<div class="mute">読み込み中…</div>' : !L.length ? '<div class="mute">まだデータがありません</div>' : L.map(gm => {
        const open = ui.gdOpen === gm.no, how = gm.how === 'fold' ? '全員降り' : gm.how === 'show' ? '勝負' : gm.how === 'jackpot' ? 'ラストゲーム(積立)' : '流し';
        let det = '';
        if (open) {
          det = `<div style="margin:6px 0 4px;font-size:12px;color:#8FA6BE">親: ${e(gm.oya)} ・ 参加: ${gm.parts.map(e).join('、')}${gm.carried ? ` ・ 前から持ち越し ${fmt(gm.carried)}` : ''}</div>
          <div style="display:grid;grid-template-columns:1.4fr 1fr 1fr;gap:3px 6px;font-size:12px"><b class="mute">名前</b><b class="mute" style="text-align:right">払った合計</b><b class="mute" style="text-align:right">結果</b>
          ${Object.keys(gm.paid || {}).map(k => `<span>${e(k)}</span><span style="text-align:right">${fmt(gm.paid[k])}</span><span style="text-align:right;color:${col((gm.deltas || {})[k] || 0)}">${sg((gm.deltas || {})[k] || 0)}</span>`).join('')}</div>
          ${gm.how === 'nagashi' && gm.stake ? `<div class="mute" style="margin-top:4px;font-size:12px">流れた場にある出した合計: ${Object.entries(gm.stake).map(([k, x]) => e(k) + ' ' + fmt(x)).join(' / ')}</div>` : ''}
          <div style="margin-top:8px;font-size:12px;line-height:1.7">${gm.actions.map(a => `<div>${a.round ? a.round + '回目 ' : ''}${e(a.name)}: ${ACT[a.act] || a.act}${a.amount ? ' ' + fmt(a.amount) : ''}</div>`).join('') || '<span class="mute">動きの記録なし</span>'}</div>
          ${gm.how === 'fold' ? '' : gm.showdown ? `<div style="margin-top:8px">${gm.showdown.map(h => `<div style="display:flex;align-items:center;gap:8px;margin:4px 0"><span style="min-width:80px;font-size:12px">${e(h.name)}${gm.winner === h.name ? ' <b style="color:#C9A24B">勝ち</b>' : gm.how === 'nagashi' ? '' : ' 負け'}</span><span style="display:flex;gap:2px">${h.hand.map(c => cardHTML(c)).join('')}</span><span class="mute" style="font-size:12px">${e(h.label || '')}</span></div>`).join('')}</div>` : `<div class="mute" style="margin-top:8px;font-size:12px">勝負した人: ${gm.showdownNames.map(e).join('、')}(勝負していないので、カードは見られません)</div>`}${gm.allHands ? `<div style="margin-top:8px"><div class="mute" style="font-size:11px">降りた人のカード(作成者・統括責任者だけに見えます)</div>${gm.allHands.filter(h => h.folded).map(h => `<div style="display:flex;align-items:center;gap:8px;margin:4px 0"><span style="min-width:80px;font-size:12px">${e(h.name)} <span class="mute">降り</span></span><span style="display:flex;gap:2px">${h.hand.map(c => cardHTML(c)).join('')}</span></div>`).join('')}</div>` : ''}`;
        }
        return `<div style="border-top:1px solid #1F344C;padding:8px 0"><button class="act" data-a="tGdOpen" data-v="${gm.no}" style="all:unset;display:block;width:100%;cursor:pointer;font-size:13px"><b>GAME ${gm.no}</b> ${how}${gm.winner ? ' ・ ' + e(gm.winner) + ' の勝ち' : ''} <span class="mute" style="float:right">${open ? '▲' : '▼'}</span></button>${det}</div>`;
      }).join(''));
  } else if (ui.sheet === 'fair') {
    body = head('FAIRNESS', '公平の確認') + fairHTML(v);
  } else if (ui.sheet === 'rules') {
    const r = [].concat(v.jp && v.jp.on ? [['🎰 JACKPOT 積立', fmt(v.jp.pool)]] : [], [['ANTE 参加料', fmt(s.ante)], ['BET ベット', `${fmt(s.minBet)}〜${fmt(s.limit)}(${s.limitType === 'perGame' ? '1ゲーム合計' : '1回ごと'})`], ['MAX BETS 回数', s.maxBets + '回'], ['UP アップ', s.upEnabled ? `あり(ビキだけ・上限${fmt(s.upLimit == null ? s.limit : s.upLimit)}・${s.upLimitType === 'perGame' ? '合計' : '1回ごと'})` : 'なし'], ['通算回数', `ベット${s.gameMaxBets ? s.gameMaxBets + '回まで' : '制限なし'}・アップ${s.gameMaxUps ? s.gameMaxUps + '回まで' : '制限なし'}`], ['RESERVE 予備', fmt(s.reserve) + 'チップ(祝儀用)'], ['SHUGI 祝儀', s.shugiMul > 0 ? `ソロ（かち）で 参加料${fmt(s.ante)}×数字${s.shugiMul > 1 ? '×' + s.shugiMul : ''}（10ソロ＝${fmt(s.ante * 10 * s.shugiMul)}）を全員からもらう` : 'なし'], ['FEE 手数料', v.rules && (v.rules.feeBp || v.rules.jpBp) ? `場のチップから${pct(v.rules.feeBp + v.rules.jpBp)}を引きます。その大半（${pct(v.rules.jpBp)}）はジャックポットの積立としてプレイヤーに戻り、運営の取り分は${pct(v.rules.feeBp)}です` : 'なし'], ['JACKPOT', v.rules && v.rules.jpBp ? `${(v.jp && v.jp.rank) === 10 ? '10のソロ' : (v.jp ? v.jp.rank : 10) + '以上のソロ'}を出した人が、積立をもらう。途中から参加した人は、参加してからの積み上がり分まで。終了時はラストゲームで決着` : 'なし'], ['START 開始', s.startMode === 'condition' ? `条件開始: ${fmt(s.chips)}チップ・${s.minPlayers}人で開始` : '自由参加'], ['TIME 時間', s.durationMin ? s.durationMin + '分(ゲーム終了後に終了)' : 'なし'], ['END 終了', s.endZero ? s.endZero + '人が出られなくなったら' : '条件なし'], ['LATE JOIN', { allow: '途中参加OK', deny: '途中参加なし', vote: '着席者の多数決' }[s.lateJoin]], ['LEAVE', s.leave === 'allow' ? '退席OK(着席15分後から)' : '退席なし']]);
    body = head('INFO', e(v.name || '')) + `<div style="padding:8px 0"><div style="font-size:12px;font-weight:600;letter-spacing:.14em;color:#8FA6BE;margin-bottom:6px">CHIPS 場のチップの色(場の合計と同じ額になります)</div><div style="display:flex;flex-wrap:wrap;gap:6px 12px">${DENOM.slice().reverse().map(d => `<span style="display:inline-flex;align-items:center;gap:5px;font-size:12px"><span style="width:18px;height:12px;border-radius:50%;box-sizing:border-box;background:${d[1]};border:${d[1] === '#E9EEF3' ? '1px solid #9AA6B3' : '2px dashed rgba(255,255,255,.55)'}"></span>${fmt(d[0])}</span>`).join('')}</div></div>` + r.map(x => `<div style="display:flex;justify-content:space-between;gap:12px;padding:10px 0;border-top:1px solid #1F344C;font-size:14px"><span style="font-weight:600;letter-spacing:.14em;color:#8FA6BE">${x[0]}</span><span style="text-align:right">${e(x[1])}</span></div>`).join('');
  } else if (ui.sheet === 'chat') {
    body = head('MESSAGES', '卓のメッセージ') + `<div style="max-height:280px;overflow-y:auto">${v.chat.map(c => `<div class="msgline"><b>${e(c.name)}</b>${e(c.body)}</div>`).join('') || '<p class="mute">まだメッセージはありません。</p>'}</div><div class="row" style="margin-top:8px"><input id="ch_in" maxlength="200" placeholder="メッセージ"><button class="act" data-a="tSay" style="height:40px;padding:0 14px;border:0;background:#C9A24B;color:#0B1522;border-radius:2px;font-weight:600">SEND</button></div>`;
  } else if (ui.sheet === 'exch') {
    body = head('CHIPS ⇄ POCKET', 'ポケットと卓') + `<div class="note">ゲームに参加していないときだけ移せます。ポケット: ${fmt(v.you.pocket)}チップ/ チップ: ${fmt(me ? me.chips : 0)}${v.you.fee && !v.you.fee.exempt ? `<br>次の参加費 ${fmt(v.you.fee.next)}チップは、ポケットから引かれます。ポケットに残しておいてください。` : ''}${v.settings && v.settings.startMode === 'condition' ? '<br>条件開始の卓では、移せません。' : ''}</div><input id="ex_n" type="number" inputmode="numeric" placeholder="数" style="margin-top:10px"><div class="row" style="margin-top:8px"><button class="act" data-a="tExch" data-v="in" style="flex:1;height:46px;border:0;background:#1C8196;color:#fff;border-radius:2px;font-weight:600;letter-spacing:.14em">IN <small style="font-weight:400">ポケットから卓へ</small></button><button class="act" data-a="tExch" data-v="out" style="flex:1;height:46px;border:1px solid #3B5674;background:#112238;color:#C5D3E3;border-radius:2px;font-weight:600;letter-spacing:.14em">OUT <small style="font-weight:400">ポケットに戻す</small></button></div>`;
  } else if (ui.sheet === 'leave') {
    body = `<div style="font-size:18px;font-weight:600;letter-spacing:.2em;margin-bottom:8px">LEAVE TABLE?</div>` + (v.practice ? '<div style="font-size:13px;line-height:1.7;color:#C5D3E3">練習を終えます。結果はどこにも残りません。</div>' : v.you.canLeave ? `<div style="font-size:13px;line-height:1.7;color:#C5D3E3">席を立つと、チップはポケットに戻ります。ゲーム中のときは、そのゲームが終わってから席を立ちます。</div>` : `<div class="warn">${e(v.you.leaveWhy || '')}</div><div style="margin-top:8px;font-size:12px;line-height:1.7;color:#C5D3E3">席を離れたいときは「AWAY」にしてください。参加料は払い続け、ゲームは自動で降りになります。</div>`) + `<div style="display:flex;gap:8px;margin-top:16px"><button class="act" data-a="tMenu" style="flex:1;height:52px;border:1px solid #3B5674;border-radius:2px;background:#112238;color:#C5D3E3;font-size:16px;font-weight:600;letter-spacing:.18em">CANCEL</button><button class="act" ${v.practice || v.you.canLeave ? '' : 'disabled'} data-a="tLeave" style="flex:1;height:52px;border:0;border-radius:2px;background:#B8322A;color:#fff;font-size:16px;font-weight:600;letter-spacing:.18em;opacity:${v.practice || v.you.canLeave ? 1 : .35}">LEAVE</button></div>`;
  } else if (ui.sheet === 'player') {
    const p = v.seats[ui.pk]; if (!p || p.empty) { ui.sheet = null; return ''; }
    body = `<div style="display:flex;align-items:center;gap:14px"><div style="width:56px;height:56px;border-radius:50%;background:#10243A;border:2px solid ${hueOf(p.name)};display:flex;align-items:center;justify-content:center;font-size:24px">${e(String(p.name).slice(0, 1).toUpperCase())}</div><div style="flex:1"><div style="font-size:20px;font-weight:500">${e(p.name)}</div><div style="font-size:12px;letter-spacing:.14em;color:#8FA6BE">SEAT ${p.i + 1}</div></div><div style="text-align:right"><div style="font-size:11px;letter-spacing:.2em;color:#8FA6BE">CHIPS</div><div style="font-size:30px;font-weight:600;line-height:1;color:#C9A24B">${fmt(p.chips)}</div></div></div>
    <div class="note" style="margin-top:12px">ポケットのチップは、本人とAJなどの管理側だけが見られます。この卓で見えるのは、卓に持ち込んだチップだけです。</div>
    ${!v.practice && !p.you ? `<button class="act" data-a="tReport" data-v="${p.i}" style="width:100%;margin-top:12px;height:46px;border:1px solid #B8322A;background:transparent;color:#E0594E;border-radius:2px;font-weight:600;letter-spacing:.16em">REPORT <small style="font-weight:400">通報する</small></button>` : ''}`;
  }
  return `<button data-a="tClose" aria-label="閉じる" style="position:absolute;inset:0;z-index:40;border:0;background:rgba(3,8,16,.7);padding:0"></button><div class="sheet"><div class="grab"></div>${body}</div>`;
}

/* ---------- 描画と操作 ---------- */
function tableRender() {
  const v = TB.v; if (!v) return;
  const html = tableHTML(v); if (html === TB.lastHtml && !TB.force) return; TB.lastHtml = html; TB.force = false;
  const keep = ['ch_in', 'ex_n'].map(id => { const el = document.getElementById(id); return el ? [id, el.value, document.activeElement === el] : null; }).filter(Boolean);
  fxStyle(); $('#app').innerHTML = html; stageScale(); fxAlign();
  keep.forEach(([id, val2, foc]) => { const el = document.getElementById(id); if (el) { el.value = val2; if (foc) el.focus(); } });
  const r = $('#sl_r'); if (r) r.addEventListener('input', () => { TB.ui.amount = Number(r.value); $('#sl_v').textContent = fmt(TB.ui.amount); $('#sl_c').textContent = (TB.ui.mode === 'up' ? 'CALL + UP ' : 'BET ') + fmt(TB.ui.amount); });
}
function tableUpdate(v) {
  if (v.kicked) { toast('卓から外れました'); return tableHome(); }
  TB.skew = v.serverTime ? v.serverTime - Date.now() : 0;
  if (v.req == null && TB.ui.mode) TB.ui.mode = null;
  const prev0 = TB.v;
  if (v.result && v.result.no !== TB.lastNo) {
    if (prev0 && prev0.gameNo === v.result.no) { try { fxResult(prev0, v); } catch (x) { console.error(x); } }
    if (TB.lastNo) { const r = v.result; const bn = { no: r.no, text: r.how === 'nagashi' ? '<div class="jpgold" style="font-size:26px;letter-spacing:.3em">流 し</div>' : `<div style="font-size:12px;color:#C9A24B;letter-spacing:.3em">WINNER</div><div style="font-size:22px;font-weight:700;margin:2px 0">${e(r.winner || '')}</div>${r.how === 'jackpot' ? '' : `<div class="jpgold" style="font-size:30px">${r.pot != null ? '+' + fmt(r.pot) : ''}</div>`}${r.shugi ? `<div style="margin-top:4px"><span style="padding:2px 10px;border-radius:10px;background:#B8322A;color:#fff;font-size:13px;font-weight:700">祝儀 +${fmt(r.shugi)}</span></div>` : ''}${r.jp && r.jp.paid ? `<div style="margin-top:4px"><span style="padding:2px 12px;border-radius:10px;background:linear-gradient(90deg,#B8862B,#FFE08A,#B8862B);color:#2A1B00;font-size:14px;font-weight:800">🎰 JACKPOT +${fmt(r.jp.paid)}</span></div>` : ''}` }; const big = !!(r.shugi || (r.jp && r.jp.paid)), sid = TB.sid; setTimeout(() => { if (sid !== TB.sid) return; TB.banner = bn; tableRender(); setTimeout(() => { if (TB.banner === bn) { TB.banner = null; tableRender(); } }, 3200); }, big ? 2800 : r.how === 'show' ? 1900 : 0); }
    TB.lastNo = v.result.no;
  }
  const prev = TB.v;
  try { trackAct(prev, v); } catch (x) {}
  if (v.req && !(prev && prev.req)) SFX.play('ping', 0);
  TB.v = v;
  try { fxObserve(prev, v); } catch (x) { console.error(x); FX.hide = false; }
  // メニューなどを開いている間は、押し損ないを防ぐため画面を差し替えない(閉じたときに最新にする)
  if (['menu', 'rules', 'fair', 'exch', 'leave', 'player'].includes(TB.ui.sheet) && !v.ended && !['ended', 'stopped'].includes(v.status)) return;
  tableRender(); try { fxSync(v); } catch (x) { console.error(x); }
}
function tableHome() { if (TB.scene) { stopTable(); TB.scene = false; return go('#/scene'); } const was = !!(TB.v && !TB.v.practice); stopTable(); S.skipResume = false; S.tab = 'home'; if (was && typeof adShow === 'function') return adShow('tableEnd', () => go('#/home')); go('#/home'); }
function stopTable() { SFX.ambience('lobby'); TB.sid++; if (TB.es) { TB.es.close(); TB.es = null; } clearInterval(TB.tick); if (TB.src && TB.src.stop) TB.src.stop(); TB.src = null; TB.v = null; TB.ui = { amount: 1, sheet: null, mode: null, pk: null, games: null, verify: {} }; TB.lastNo = 0; TB.banner = null; TB.lastAct = null; fxClear(); }
async function tableOnline(id) {
  stopTable(); SFX.ambience('table'); TB.chatOn = (S.me && S.me.chatEnabled) !== false;
  TB.src = { id, online: true, act: a => api('POST', `/api/tables/${id}/act`, a), post: (p, b) => api('POST', `/api/tables/${id}/${p}`, b || {}) };
  TB.retry = 0; openStream(id);
  TB.tick = setInterval(() => { const n = $('#tm_n'); if (n && TB.v && TB.v.req && TB.v.req.deadline) { const s = Math.max(0, Math.ceil((TB.v.req.deadline - (Date.now() + (TB.skew || 0))) / 1000)); n.textContent = s; } }, 500);
}
/* 卓の中継につなぐ。URLには本物のログインの鍵ではなく、2分だけ使える引換券を載せる。切れたら引換券を取り直してつなぎ直す */
async function openStream(id) {
  const sid = TB.sid;
  let tk; try { tk = (await api('POST', `/api/tables/${id}/ticket`, {})).ticket; } catch (x) { if (sid === TB.sid) toast(x.message, true); return; }
  if (sid !== TB.sid) return;
  const es = TB.es = new EventSource(`/api/tables/${id}/stream?ticket=${encodeURIComponent(tk)}`);
  es.onmessage = m => { TB.retry = 0; const v = JSON.parse(m.data); if (v.ended || ['ended', 'stopped'].includes(v.status)) { v.finalTxt = ''; } tableUpdate(v); };
  es.onerror = () => {
    if (TB.es !== es || es.readyState !== 2) return;
    es.close(); TB.es = null;
    if (++TB.retry > 5) return toast('接続が切れました。ホームに戻ってやり直してください', true);
    setTimeout(() => { if (sid === TB.sid) openStream(id); }, 1200 * TB.retry);
  };
}
/* 手札確認チケット: 全員降りで勝負にならなかったゲームの終了後、次のゲームが始まる前だけ、勝者の手札を見られる */
function peekHTML(v) {
  const k = v.peek; if (!k || v.practice || !k.targets.length) return '';
  const any = k.targets.some(t => t.hand); if (!(k.count > 0) && !any) return '';
  const row = t => `<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;min-height:30px"><span style="font-size:12px;color:${t.winner ? '#C9A24B' : '#9FB2C8'};max-width:92px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${t.winner ? '★ ' : ''}${e(t.name)}</span>${t.hand ? `<span style="display:flex;gap:2px">${t.hand.map(c => cardHTML(c, 'mid')).join('')}</span>` : (k.count > 0 ? `<button class="act" data-a="tPeek" data-v="${e(t.name)}" style="height:26px;padding:0 10px;border-radius:2px;border:1px solid #C9A24B;background:transparent;color:#C9A24B;font-size:12px;font-weight:600">見る</button>` : '')}</div>`;
  return `<div style="min-width:200px;padding:6px 10px;border-radius:2px;border:1px solid rgba(201,162,75,.6);background:rgba(5,13,24,.86)"><div style="font-size:11px;color:#C9A24B;letter-spacing:.1em;margin-bottom:2px">手札確認 ・ 券${k.count}（★は勝者）</div>${k.targets.map(row).join('')}</div>`;
}
A.tPeek = async v => { try { await TB.src.post('peek', { target: v }); } catch (x) { toast(x.message, true); } };
const doAct = async a => { TB.ui.mode = null; if (TB.v) { TB.v.req = null; tableRender(); } await run(() => TB.src.act(a)); };
A.tFold = () => doAct({ act: 'fold' });
A.tJoin = () => doAct({ act: 'join' });
A.tSkip = () => doAct({ act: 'skip' });
A.tShow = () => doAct({ act: 'show' });
A.tCall = () => doAct({ act: 'follow', up: 0 });
A.tBetOpen = () => { const r = TB.v.req; TB.ui.mode = 'bet'; TB.ui.amount = r.minBet; tableRender(); };
A.tUpOpen = () => { const r = TB.v.req; TB.ui.mode = 'up'; TB.ui.amount = r.minUp; tableRender(); };
A.tCancel = () => { TB.ui.mode = null; tableRender(); };
A.tConfirm = () => TB.ui.mode === 'up' ? doAct({ act: 'follow', up: TB.ui.amount }) : doAct({ act: 'bet', amount: TB.ui.amount });
A.tStep = v => { const r = $('#sl_r'); if (!r) return; TB.ui.amount = Math.max(Number(r.dataset.lo), Math.min(Number(r.dataset.hi), TB.ui.amount + Number(v))); tableRender(); };
A.tMax = () => { const r = $('#sl_r'); TB.ui.amount = Number(r.dataset.hi); tableRender(); };
A.tGdOpen = v => { TB.ui.gdOpen = TB.ui.gdOpen === Number(v) ? null : Number(v); tableRender(); };
A.tMenu = () => { TB.ui.sheet = 'menu'; tableRender(); };
A.tClose = () => { TB.ui.sheet = null; tableRender(); };
A.tSheet = async v => { TB.ui.sheet = v; if (v === 'gd' && TB.src.online) { TB.ui.gd = null; tableRender(); try { TB.ui.gd = await api('GET', `/api/tables/${TB.src.id}/gamedata`); } catch (x) { TB.ui.gd = []; } } if (v === 'fair' && TB.src.online) { try { TB.ui.games = await api('GET', `/api/tables/${TB.src.id}/games`); } catch (x) {} } if (v === 'fair' && !TB.src.online) TB.ui.games = (TB.src.games ? TB.src.games() : []); tableRender(); };
A.tPlayer = v => { TB.ui.sheet = 'player'; TB.ui.pk = Number(v); tableRender(); };
A.tHome = () => tableHome();
A.tVote = async v => { await run(() => TB.src.post('vote', { yes: v === '1' })); };
A.tAway = async () => { await run(() => TB.src.post('away', { away: !TB.v.you.away })); TB.ui.sheet = null; };
A.tLeave = async () => { if (TB.v.practice) return tableHome(); const r = await run(() => TB.src.post('leave', {})); if (r) { if (r.queued) { toast('このゲームの後に退席します'); TB.ui.sheet = null; tableRender(); } else tableHome(); } };
A.tSay = async () => { const t = val('ch_in'); if (t.trim()) { await run(() => TB.src.post('say', { body: t })); const el = $('#ch_in'); if (el) el.value = ''; } };
A.tExch = async v => {
  const f = TB.v && TB.v.you && TB.v.you.fee, amt = num('ex_n');
  if (v === 'in' && f && !f.exempt && amt > 0 && TB.v.you.pocket - amt < f.next && !(await askYes(`この額を移すと、ポケットが ${fmt(TB.v.you.pocket - amt)}チップになり、次の参加費 ${fmt(f.next)}チップに足りなくなります。足りないと、参加費の時間が切れたときにお休みになります。それでも移しますか?`, '移す'))) return;
  if (await run(() => TB.src.post('exchange', { dir: v, amount: num('ex_n') }), '移しました')) { const m = await api('GET', '/api/me'); S.me = m; }
};
A.tReport = async v => { const p = TB.v.seats[Number(v)]; const why = await askText(`${p.name} さんを通報します。理由を入力してください(例: 不正の疑い、迷惑行為)`); if (!why) return; if (await run(() => TB.src.post('report', { seat: p.i, reason: why }), '通報しました')) { TB.ui.sheet = null; tableRender(); } };
A.tVerify = async v => {
  const g = (TB.ui.games || []).find(x => x.no === Number(v)); if (!g || !g.reveal) return;
  const h = Solo.sha256hex(g.reveal); TB.ui.verify[g.no] = (h === g.hash);
  if (TB.ui.verify[g.no]) { const parts = g.reveal.split('|'); toast('指紋が一致しました(配る前の山札と同じです)'); } else toast('指紋が一致しません', true); tableRender();
};

/* ---------- 練習モード(この端末の中だけで動く。結果はどこにも残らない) ---------- */
const PR = { cfg: { seats: 6, up: true, ante: 100, limit: 1000 }, T: null, pending: null, run: false, gen: 0, hist: [] };
function practiceSetup() {
  stopTable(); PR.run = false; PR.gen++;
  $('#app').innerHTML = `<div class="page"><div class="top"><div class="brand">PRACTICE<small>練習モード</small></div><button class="btn sm" data-a="tHome">BACK</button></div>
  <div class="card"><h3>SETUP<small>コンピューター相手の練習</small></h3>
  <div class="note">全員が 50,000チップから始めます。ここでの結果は、ポケットにもランキングにも、どこにも反映されません。</div>
  <div class="grid2"><div><label>人数<small>(自分を含む)</small></label><select id="pr_n">${[3, 4, 5, 6, 7, 8].map(n => `<option ${n === PR.cfg.seats ? 'selected' : ''}>${n}</option>`).join('')}</select></div>
  <div><label>アップ</label><select id="pr_up"><option value="1" ${PR.cfg.up ? 'selected' : ''}>あり</option><option value="0" ${PR.cfg.up ? '' : 'selected'}>なし</option></select></div></div>
  <div class="grid2"><div><label>参加料<small>(100以上)</small></label><input id="pr_a" type="number" value="${PR.cfg.ante}"></div><div><label>ベット上限</label><input id="pr_l" type="number" value="${PR.cfg.limit}"></div></div>
  <button class="btn gold block" style="margin-top:14px" data-a="prStart">START <small>はじめる</small></button></div>${(S.me && RANK[S.me.user.role] <= 4) || window.__demoToken ? '<div class="card"><h3>SCENE<small>演出の確認</small></h3><div class="note">10ソロなどの場面を、数字や文字を入れて、動く画面で確かめられます(管理側だけに表示)。</div><button class="btn block" data-a="scOpen">演出の確認画面へ <small>SCENE</small></button></div>' : ''}</div>`;
}
A.prStart = () => { PR.cfg = { seats: num('pr_n'), up: val('pr_up') === '1', ante: Math.max(100, num('pr_a') || 100), limit: Math.max(100, num('pr_l') || 1000) }; practiceRun(); };
function practiceView() {
  const T = PR.T, g = T.g, n = T.players.length;
  let bikiSeat = null; if (g && PR.cfg.up && g.phase !== 'done') { const r = Solo.ring(T, g); if (r.length >= 2) bikiSeat = r[r.length - 1]; }
  const seats = T.players.map((p, i) => ({ i, name: p.name, net: (PR.net || {})[p.name] || 0, chips: p.pts, away: false, you: i === 0, oya: !!(g && g.phase !== 'done' && g.oya === i), biki: bikiSeat === i, active: g ? g.active.has(i) : false, inGame: g ? g.parts.includes(i) : false, say: g && g.say ? (g.say[i] || '') : '', acting: !!(g && g.acting === i),
    hand: g && g.hands[i] && i !== 0 && (g.phase === 'showdown' || g.phase === 'done') && g.revealed.includes(i) ? g.hands[i].map(c => c.n + c.s) : null, hasCards: !!(g && g.hands[i] && g.parts.includes(i) && g.active.has(i) && i !== 0) }));
  const req = PR.pending ? Object.assign({}, PR.pending.req) : null;
  return { practice: true, name: 'PRACTICE', status: 'running', settings: { seats: n, ante: T.cfg.ante, minBet: T.cfg.minBet, limit: T.cfg.limit, limitType: T.cfg.limitType, maxBets: T.cfg.maxBets, reserve: T.cfg.reserve, upEnabled: PR.cfg.up, startMode: 'free', lateJoin: 'deny', leave: 'allow', durationMin: 0, endZero: 0, chat: false },
    you: { seat: 0, pocket: 0, canLeave: true }, seats, pot: T.pot, carry: T.carry ? { fee: T.carry.fee } : null, color: T.color, gameNo: T.gameNo, phase: g ? g.phase : 'wait', commit: g && g.commit ? g.commit.hash : null, actType: g && g.acting != null ? g.actType : null, curBet: g && g.phase !== 'done' ? g.curBet : 0, curUp: g && g.phase !== 'done' ? g.curUp : 0, deckN: 20, dealOrder: g && g.commit ? g.commit.order : null, nParts: g ? g.parts.length : 0,
    mine: g && g.hands[0] ? { hand: g.hands[0].map(c => c.n + c.s), label: g.ev[0] ? g.ev[0].label : null } : null, req, log: PR.log || [], chat: [], vote: null, result: PR.last || null, serverTime: Date.now() };
}
async function practiceRun() {
  stopTable(); SFX.ambience('table'); const gen = ++PR.gen; PR.run = true; PR.log = []; PR.last = null; PR.hist = []; PR.net = {};
  const T = PR.T = Solo.createTable({ seats: PR.cfg.seats, ante: PR.cfg.ante, minBet: Math.max(100, Math.floor(PR.cfg.ante)), limit: PR.cfg.limit, limitType: 'perBet', maxBets: 3, reserve: 10, startPts: 50000, minUnit: 100, upEnabled: PR.cfg.up }, { humans: [0] });
  T.players.forEach(p => { p.pts = 50000; });
  TB.chatOn = false;
  TB.src = { id: 0, online: false, stop: () => { PR.gen++; if (PR.pending) { const p = PR.pending; PR.pending = null; p.resolve({ act: p.req.type === 'carryJoin' ? 'skip' : 'fold' }); } }, act: async a => { const p = PR.pending; if (!p) return; PR.pending = null; p.resolve(a); }, post: async () => ({}), games: () => PR.hist.map(h => ({ no: h.no, hash: h.hash, how: h.how, reveal: h.how === 'fold' ? null : h.str })) };
  const push = () => { if (gen === PR.gen) tableUpdate(practiceView()); };
  const io = { log: (m, k) => { PR.log.push({ m, k }); if (PR.log.length > 60) PR.log.shift(); }, sync: push, beat: ms => new Promise(r => setTimeout(r, ms >= 1000 ? ms : ms * 0.6)), human: req => new Promise(res => { PR.pending = { req, resolve: res }; push(); }) };
  while (gen === PR.gen) {
    const r = await Solo.playGame(T, io);
    if (gen !== PR.gen) return;
    if (r.type === 'nogame') { toast('チップが足りなくなったので、練習をやり直します'); T.players.forEach(p => { p.pts = 50000; }); T.pot = 0; T.carry = null; continue; }
    const h = T.history[T.history.length - 1]; PR.hist.unshift({ no: h.no, hash: h.hash, str: h.str, how: h.how });
    Object.entries(r.deltas).forEach(([k, x]) => { const nmk = T.players[k].name; PR.net[nmk] = (PR.net[nmk] || 0) + x; });
    PR.last = { no: r.g.no, paid: Object.fromEntries(Object.entries(r.paid || {}).map(([k, x]) => [T.players[k].name, x])), stake: r.how === 'nagashi' || r.type === 'nagashi' ? Object.fromEntries(Object.entries(r.stake || {}).map(([k, x]) => [T.players[k].name, x])) : null, how: r.type === 'win' ? r.how : 'nagashi', winner: r.winner != null ? T.players[r.winner].name : null, pot: r.potWon || 0, shugi: r.shugi ? r.shugi.total : 0, shugiRank: r.shugi ? r.shugi.rank : 0, deltas: Object.fromEntries(Object.entries(r.deltas).map(([k, x]) => [T.players[k].name, x])) };
    push(); await new Promise(r => setTimeout(r, 4600));
  }
}

/* ---------- 公平性シート(乱数と指紋の見せ方) ---------- */
const fpHue = (hex, k) => parseInt(String(hex).substr(k * 2, 2) || '0', 16) * 1.4;
const fpArt = (hex, big) => `<span style="display:inline-flex;gap:${big ? 3 : 2}px;vertical-align:middle">${[0, 1, 2, 3, 4, 5, 6, 7].map(k => `<i style="display:block;width:${big ? 22 : 9}px;height:${big ? 30 : 14}px;border-radius:${big ? 3 : 2}px;background:hsl(${fpHue(hex, k)},58%,52%)"></i>`).join('')}</span>`;
const pct = bp => (Math.round(bp) / 100) + '%';
function fairHTML(v) {
  const ui = TB.ui, h = v.commit || '';
  const grp = x => (x.match(/.{1,16}/g) || []).map(e).join('<br>');
  const step = (n, t, d) => `<div style="display:flex;gap:10px;margin-top:10px"><div style="flex:none;width:24px;height:24px;border-radius:50%;background:#C9A24B;color:#0B1522;font-weight:700;display:flex;align-items:center;justify-content:center;font-size:13px">${n}</div><div style="flex:1"><div style="font-size:14px;font-weight:600">${t}</div><div style="font-size:12px;line-height:1.6;color:#C5D3E3;margin-top:2px">${d}</div></div></div>`;
  return `<div style="padding:12px;border:1px solid #1C8196;background:rgba(28,129,150,.12);border-radius:3px">
      <div style="font-size:15px;font-weight:600">🎲 山札は乱数(RNG)で混ぜています</div>
      <div style="font-size:12px;line-height:1.7;color:#DDE5EE;margin-top:4px">RNGは「乱数生成器」のことです。このゲームでは、暗号にも使われる予測できない乱数を使い、フィッシャー・イェーツ法という標準の混ぜ方で山札を並べます。人の手で並びを決めたり、特定の人に有利な並びにしたりする操作はありません。</div></div>
    ${step(1, '配る前に「指紋」を出す', '混ぜた山札の並びから、SHA-256という方法で指紋(文字列)を作り、配る前に全員の画面に出します。')}
    ${step(2, '配る', '指紋を出したあとで、その山札を上から順に配ります。')}
    ${step(3, '卓が終わったら照合', '山札の並びを公開します。下の VERIFY で、もう一度指紋を作って一致するか自分で確かめられます。一致すれば「配ったあとに並びを変えていない」ことが分かります。')}
    <div style="margin-top:12px;font-size:11px;line-height:1.6;color:#8FA6BE">※指紋で確かめられるのは「配る前と後で並びが同じ」ことです。「並びが偏っていない」ことは、上のRNGの仕組みで守っています。降りた人のカードが他の人に分からないよう、山札の中身は卓が終わるまで出しません。</div>
    <div style="margin-top:14px;padding:12px;border:1px solid #2A4262;background:#060E19;border-radius:3px">
      <div style="font-size:11px;letter-spacing:.2em;color:#8FA6BE">NOW ・ いまのゲームの指紋</div>
      ${h ? `<div style="margin:8px 0">${fpArt(h, true)}</div><div style="font-family:ui-monospace,Menlo,monospace;font-size:13px;line-height:1.6;color:#C9A24B">${grp(h)}</div>` : '<div class="mute" style="margin-top:6px">次のゲームで表示されます</div>'}</div>
    <div style="margin-top:14px;font-size:11px;letter-spacing:.2em;color:#8FA6BE">HISTORY ・ これまでのゲーム</div>
    ${(ui.games || []).map(g => `<div style="border-top:1px solid #1F344C;padding:8px 0"><div style="display:flex;align-items:center;gap:8px"><b style="font-size:13px">GAME ${g.no}</b><span class="mute" style="font-size:12px">${g.how === 'fold' ? '全員降り' : g.how === 'show' ? '勝負' : '流し'}</span><span style="flex:1"></span>${fpArt(g.hash)}</div>
      <div style="display:flex;align-items:center;gap:8px;margin-top:6px">${g.reveal ? `<button class="act" data-a="tVerify" data-v="${g.no}" style="height:28px;padding:0 12px;border:1px solid #C9A24B;background:transparent;color:#C9A24B;border-radius:2px;font-weight:600">VERIFY</button>${ui.verify[g.no] === true ? '<span class="tealc">一致 ✓ 並びは変わっていません</span>' : ui.verify[g.no] === false ? '<span class="redc">不一致 ✗</span>' : '<span class="mute" style="font-size:12px">タップで照合</span>'}` : '<span class="mute" style="font-size:12px">卓の終了後に照合できます</span>'}</div>
      <div class="mute" style="font-family:ui-monospace,monospace;font-size:10px;margin-top:4px">${grp(g.hash)}</div></div>`).join('') || '<p class="mute">まだゲームがありません。</p>'}`;
}

/* ---------- カードの演出(配る・降りる・集める) ----------
   絵は #fx という別の層に描く(卓の画面は変わるたびに作り直されるため、動きを切らさないように外に置く)。
   手札の置き場(data-slot)は、演出中も場所だけ残して見えなくし、その位置にカードを飛ばす。 */
const FX = { gen: 0, q: Promise.resolve(), busy: 0, hide: false, sunk: false, recycled: false, fp: '', n: 20, off: false };
try { FX.off = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (x) {}
const DK = { x: 195, y: 526 };   // 山札の場所(舞台の座標)
const BACKCSS = 'background:linear-gradient(135deg,#1C3550,#0F2236);border:1px solid #3B5674;box-shadow:inset 0 0 0 2px #0F2236,inset 0 0 0 3px rgba(201,162,75,.45)';
const fxWait = ms => new Promise(r => setTimeout(r, FX.off ? 0 : ms));
function fxRun(el, frames, ms, opt) {
  if (FX.off || !el.animate) return Promise.resolve();
  const a = el.animate(frames, Object.assign({ duration: ms, easing: 'ease-out', fill: 'forwards' }, opt || {}));
  return Promise.race([a.finished.catch(() => {}), new Promise(r => setTimeout(r, ms + (opt && opt.delay || 0) + 300))]);
}
function fxStyle() {
  if (document.getElementById('fxstyle')) return;
  const st = document.createElement('style'); st.id = 'fxstyle';
  st.textContent = '@keyframes tpulse{0%{box-shadow:0 0 0 0 rgba(201,162,75,.75);opacity:1}100%{box-shadow:0 0 0 12px rgba(201,162,75,0);opacity:.9}}.tring{position:absolute;inset:-5px;border-radius:50%;border:3px solid #C9A24B;animation:tpulse 1.1s ease-out infinite;pointer-events:none}';
  document.head.appendChild(st);
}
function fxRoot() {
  let r = document.getElementById('fx');
  if (!r) { r = document.createElement('div'); r.id = 'fx'; r.style.cssText = 'position:fixed;left:0;top:0;width:390px;height:844px;transform-origin:0 0;pointer-events:none;z-index:2'; document.body.appendChild(r); }
  fxAlign(); return r;
}
function fxAlign() {
  const r = document.getElementById('fx'), st = $('.stage'); if (!r) return;
  if (!st) { r.style.display = 'none'; return; }
  const b = st.getBoundingClientRect(), sc = b.width / 390;
  r.style.left = b.left + 'px'; r.style.top = b.top + 'px'; r.style.transform = `scale(${sc})`;
  r.style.display = (TB.ui && (TB.ui.sheet || TB.ui.mode)) ? 'none' : 'block';   // 子の要素が visible を持っていても隠れるよう、display で隠す
}
function fxClear() {
  FX.chips = [];
  FX.gen++; FX.q = Promise.resolve(); FX.busy = 0; FX.hide = false; FX.sunk = false; FX.recycled = false; FX.fp = ''; FX.n = 20;
  const r = document.getElementById('fx'); if (r) r.remove();
}
function fxEnq(fn) {
  const gen = FX.gen; FX.busy++;
  FX.q = FX.q.then(() => gen === FX.gen ? fn(gen) : null).catch(x => console.error(x)).then(() => { if (gen === FX.gen) FX.busy = Math.max(0, FX.busy - 1); });
}
function fxRect(el) { const st = $('.stage').getBoundingClientRect(), sc = st.width / 390, r = el.getBoundingClientRect(); return { x: (r.left - st.left) / sc, y: (r.top - st.top) / sc, w: r.width / sc, h: r.height / sc }; }
function fxCard(cx, cy, w, h) { const d = document.createElement('div'); d.style.cssText = `position:absolute;left:${cx - w / 2}px;top:${cy - h / 2}px;width:${w}px;height:${h}px;border-radius:3px;${BACKCSS}`; fxRoot().appendChild(d); return d; }
function pileStack(n) { let h = ''; const L = Math.min(n, 14); for (let i = 0; i < L; i++) h += `<div style="position:absolute;left:-13px;top:${-18 - i * 1.4}px;width:26px;height:36px;border-radius:3px;${BACKCSS}"></div>`; return h; }
function pileSet(n) {
  FX.n = n; const root = fxRoot(); let p = document.getElementById('fxpile');
  if (!p) { p = document.createElement('div'); p.id = 'fxpile'; p.style.cssText = `position:absolute;left:${DK.x}px;top:${DK.y}px;width:0;height:0`; root.appendChild(p); }
  p.innerHTML = `<div class="stk">${pileStack(n)}</div>`;
  return p;
}
function apertureEl() {
  let a = document.getElementById('fxhole');
  if (!a) { a = document.createElement('div'); a.id = 'fxhole'; a.style.cssText = `position:absolute;left:${DK.x - 52}px;top:${DK.y + 6}px;width:104px;height:34px;border-radius:50%;background:radial-gradient(ellipse at 50% 40%,#000 0%,#02060C 60%,#0A1A2B 100%);border:2px solid rgba(201,162,75,.85);box-shadow:0 0 14px rgba(0,0,0,.8),inset 0 4px 10px rgba(0,0,0,.9);opacity:0;transform:scaleX(.1)`; fxRoot().appendChild(a); }
  return a;
}
const holeOpen = () => fxRun(apertureEl(), [{ opacity: 0, transform: 'scaleX(.1)' }, { opacity: 1, transform: 'scaleX(1)' }], 260);
const holeClose = async () => { const a = apertureEl(); await fxRun(a, [{ opacity: 1, transform: 'scaleX(1)' }, { opacity: 0, transform: 'scaleX(.1)' }], 260); a.remove(); };
const HOLE = { x: DK.x, y: DK.y + 23 };

async function fxRise() {
  FX.sunk = false; FX.recycled = true;
  const p = pileSet(20);
  await fxRun(p, [{ transform: 'translateY(380px)', opacity: 0 }, { transform: 'translateY(0)', opacity: 1 }], 720, { easing: 'cubic-bezier(.2,.9,.3,1)' });
}
async function fxShuffle() {
  const p = pileSet(20), stk = p.querySelector('.stk');
  const tmp = [];
  const mkHalf = side => { const h = document.createElement('div'); h.style.cssText = `position:absolute;left:${DK.x + side * 34}px;top:${DK.y}px;width:0;height:0`; h.innerHTML = pileStack(10); fxRoot().appendChild(h); tmp.push(h); return h; };
  const L = mkHalf(-1), R = mkHalf(1); stk.style.opacity = '0';
  const lbl = p.querySelector('.pl div:last-child'); if (lbl) lbl.textContent = '🎲 乱数(RNG)でシャッフル中…';
  SFX.play('shuffle', 0);
  await fxWait(200);
  const jobs = [];
  for (let i = 0; i < 14; i++) {
    const side = i % 2 ? 1 : -1, c = fxCard(DK.x + side * 34, DK.y - 4, 26, 36); tmp.push(c);
    jobs.push(fxRun(c, [{ transform: `translate(0,-8px) rotate(${side * 14}deg)`, opacity: 1 }, { transform: `translate(${-side * 34}px,${-i * 0.4}px) rotate(0deg)`, opacity: 1 }], 230, { delay: i * 55, fill: 'both' }));
    if (i === 3) { fxRun(L, [{ opacity: 1 }, { opacity: 0 }], 560, { delay: 200 }); fxRun(R, [{ opacity: 1 }, { opacity: 0 }], 560, { delay: 200 }); }
  }
  await Promise.all(jobs);
  stk.style.opacity = '1'; tmp.forEach(x => x.remove());
  await fxRun(stk, [{ transform: 'scale(1.12)' }, { transform: 'scale(1)' }], 160);
  pileSet(20);
}
async function fxDeal(order, me, gen) {
  const landed = []; let n = 20;
  for (let r = 0; r < 2; r++) {
    for (const seat of order) {
      if (gen !== FX.gen) return;
      const key = seat === me ? 'me' : seat, slot = document.querySelector(`[data-slot="${key}"]`);
      n--; pileSet(n);
      if (!slot) continue;
      const R = fxRect(slot), cw = key === 'me' ? 66 : 26, ch = key === 'me' ? 94 : 38;
      const tx = (r ? R.x + R.w - cw / 2 : R.x + cw / 2), ty = R.y + R.h / 2;
      const c = fxCard(DK.x, DK.y - 18, 26, 36); landed.push(c); SFX.play('snap', 0.05);
      fxRun(c, [{ transform: 'translate(0,0) rotate(0deg) scale(1,1)' }, { transform: `translate(${tx - DK.x}px,${ty - (DK.y - 18)}px) rotate(${r ? -720 : 720}deg) scale(${cw / 26},${ch / 36})` }], 300, { easing: 'cubic-bezier(.25,.6,.3,1)' });
      await fxWait(170);
    }
  }
  await fxWait(330);
  if (gen !== FX.gen) return;
  FX.hide = false; tableRender(); landed.forEach(x => x.remove());
  const mine = document.querySelector('[data-slot="me"]'); if (mine) fxRun(mine, [{ opacity: 0 }, { opacity: 1 }], 250);
}
function fxCloneSlot(key) {
  const slot = document.querySelector(`[data-slot="${key}"]`); if (!slot || !slot.children.length) return null;
  const R = fxRect(slot), c = slot.cloneNode(true);
  c.removeAttribute('data-slot'); c.style.cssText = `position:absolute;left:${R.x}px;top:${R.y}px;width:${R.w}px;height:${R.h}px;margin:0;display:flex;gap:${key === 'me' ? 0 : 2}px;visibility:visible;z-index:3`;
  fxRoot().appendChild(c); return { el: c, R };
}
function fxFly(c, i) {
  const cx = c.R.x + c.R.w / 2, cy = c.R.y + c.R.h / 2, dir = i % 2 ? -1 : 1;
  return fxRun(c.el, [{ transform: 'translate(0,0) rotate(0deg) scale(1)', opacity: 1 }, { transform: `translate(${(HOLE.x - cx) * .55}px,${(HOLE.y - cy) * .5 - 24}px) rotate(${dir * 540}deg) scale(.8)`, opacity: 1, offset: .55 }, { transform: `translate(${HOLE.x - cx}px,${HOLE.y - cy}px) rotate(${dir * 1080}deg) scale(.25)`, opacity: .15 }], 620, { delay: i * 90, easing: 'cubic-bezier(.4,.1,.6,1)' });
}
async function fxAbsorb(c) { if (!c) return; SFX.play('whoosh', 0); await holeOpen(); await fxFly(c, 0); c.el.remove(); await holeClose(); }
async function fxCollect(gen) {
  const keys = [...document.querySelectorAll('[data-slot]')].map(x => x.getAttribute('data-slot'));
  const cl = keys.map(fxCloneSlot).filter(Boolean);
  FX.hide = true; tableRender();
  const p = document.getElementById('fxpile');
  SFX.play('whoosh', 0); SFX.play('whoosh', 0.45); await holeOpen();
  if (p) fxRun(p, [{ transform: 'translateY(0) scale(1)', opacity: 1 }, { transform: 'translateY(26px) scale(.5,.2)', opacity: 0 }], 420);
  await Promise.all(cl.map((c, i) => fxFly(c, i)));
  cl.forEach(c => c.el.remove());
  await holeClose();
  if (gen !== FX.gen) return;
  FX.sunk = true; FX.recycled = true;
  await fxWait(1000);                       // 1秒あけて、下から新しい山札が上がってくる
  if (gen !== FX.gen) return;
  await fxRise();
}
function fxObserve(prev, v) {
  if (FX.off) { FX.hide = false; return; }
  if (['ended', 'stopped'].includes(v.status)) { fxClear(); return; }
  const me = v.you && v.you.seat >= 0 ? v.you.seat : -1;
  if (v.commit) FX.fp = v.commit.slice(0, 8);
  if (!prev) return;
  if (v.gameNo !== prev.gameNo && v.dealOrder && v.phase !== 'wait') {
    FX.hide = true; FX.recycled = false;
    const order = v.dealOrder.slice();
    fxEnq(async gen => { if (!v.carry) fxChipsClear(); if (FX.sunk) await fxRise(); await fxShuffle(); await fxDeal(order, me, gen); const froms = order.map(i => fxSeatCenter(i, me)).filter(Boolean); await fxThrow(froms, '#C9A24B', 1); });
    return;
  }
  if (v.gameNo !== prev.gameNo) return;
  if ((v.phase === 'showdown' || (v.phase === 'done' && v.result && v.result.how === 'show')) && prev.phase !== 'showdown' && prev.phase !== 'done' && FX.sdNo !== v.gameNo) { FX.sdNo = v.gameNo; fxEnq(() => fxShowdown()); }
  v.seats.forEach((s, i) => {
    const ps = prev.seats[i];
    if (s.empty || !ps || ps.empty || !(ps.inGame && ps.active && !s.active)) return;
    const c = fxCloneSlot(i === me ? 'me' : i); if (c) fxEnq(() => fxAbsorb(c));
  });
  v.seats.forEach((s, i) => {
    const ps = prev.seats[i]; if (s.empty || !ps || ps.empty || s.say === ps.say) return;
    const t = tagOf(s.say); if (!t || t[0] === 'FOLD') return;
    const from = fxSeatCenter(i, me); if (from) fxEnq(() => fxThrow([from], t[0] === 'UP' ? '#C0392B' : '#C9A24B', t[0] === 'CALL' ? 1 : 2));
  });
  if (prev.phase !== 'done' && v.phase === 'done') { fxEnq(async gen => { await fxWait(2300); if (gen === FX.gen) await fxCollect(gen); }); }
}
/* 勝負!: 画面いっぱいに「勝負」を叩きつける(音つき) */
async function fxShowdown() {
  const root = fxRoot(); SFX.play('showdown', 0);
  const fl = document.createElement('div'); fl.style.cssText = 'position:absolute;left:0;top:0;width:390px;height:844px;z-index:7;pointer-events:none;background:radial-gradient(ellipse at 50% 45%,rgba(255,60,40,.55),rgba(0,0,0,.7) 70%)'; root.appendChild(fl);
  const t = document.createElement('div'); t.style.cssText = 'position:absolute;left:0;top:250px;width:390px;z-index:8;pointer-events:none;text-align:center;animation:sdslam 1.7s ease-out both';
  t.innerHTML = '<div style="position:absolute;left:-30px;right:-30px;top:12px;height:92px;transform:skewY(-4deg);background:linear-gradient(90deg,transparent,#B8201A 12%,#E0352A 50%,#B8201A 88%,transparent);box-shadow:0 0 30px rgba(255,60,40,.8)"></div><div style="position:relative;font-size:76px;font-weight:900;letter-spacing:.18em;text-indent:.18em;color:#FFF3C4;text-shadow:0 4px 0 #6A0F0A,0 0 22px rgba(255,200,80,.95);line-height:1.2">勝負</div><div style="position:relative;font-size:14px;font-weight:700;letter-spacing:.7em;text-indent:.7em;color:#FFE08A;margin-top:-4px">SHOWDOWN</div>';
  root.appendChild(t);
  const st = document.querySelector('.stage'); if (st) st.animate([{ transform: 'translate(0,0)' }, { transform: 'translate(-6px,4px)' }, { transform: 'translate(6px,-4px)' }, { transform: 'translate(-4px,-3px)' }, { transform: 'translate(0,0)' }], { duration: 380, delay: 80 });
  await fxRun(fl, [{ opacity: 0 }, { opacity: 1, offset: .12 }, { opacity: .85, offset: .6 }, { opacity: 0 }], 1500);
  fl.remove(); t.remove();
}
function fxSync(v) {
  if (FX.off) return;
  if (['ended', 'stopped'].includes(v.status)) { fxClear(); return; }
  if (FX.busy || FX.sunk) { fxAlign(); return; }
  const n = FX.recycled || !v.dealOrder || v.phase === 'wait' ? 20 : Math.max(0, 20 - 2 * v.dealOrder.length);
  pileSet(n);
}

/* ---------- チップの動き(投げて場に置く・勝者へ滑って戻る・祝儀のお祝い) ---------- */
FX.chips = [];
const chipCss = c => `position:absolute;width:16px;height:16px;border-radius:50%;box-sizing:border-box;border:3px dashed rgba(255,255,255,.85);background:${c};box-shadow:0 2px 3px rgba(0,0,0,.6);margin:-8px 0 0 -8px`;
function fxSeatCenter(i, me) {
  const el = i === me ? document.getElementById('meav') : document.querySelector(`[data-a="tPlayer"][data-v="${i}"] > span`);
  if (!el) return null; const R = fxRect(el); return { x: R.x + R.w / 2, y: R.y + R.h / 2 };
}
function fxPot() { const el = document.getElementById('chippile') || document.getElementById('potbox'); if (!el) return { x: 195, y: 290, w: 120 }; const R = fxRect(el); return { x: R.x + R.w / 2, y: R.y + R.h / 2, w: R.w }; }
function fxChipsClear() { (FX.chips || []).forEach(c => c.remove()); FX.chips = []; }
async function fxThrow(froms, color, per) {
  const pot = fxPot(), jobs = []; let k = 0;
  froms.forEach(f => {
    for (let j = 0; j < per; j++) {
      const c = document.createElement('div'); c.style.cssText = chipCss(color) + `;left:${f.x}px;top:${f.y}px;z-index:4`; fxRoot().appendChild(c);
      const tx = pot.x + (Math.random() * 16 - 8), ty = pot.y + (Math.random() * 8 - 2);   // 行き先は、場のチップの山の1か所だけ
      SFX.play('clack', 0.38 + k * 0.07);
      jobs.push(fxRun(c, [{ transform: 'translate(0,0) rotate(0deg) scale(1)', opacity: 1 }, { transform: `translate(${(tx - f.x) * .5}px,${(ty - f.y) * .5 - 34}px) rotate(540deg) scale(1.15)`, opacity: 1, offset: .5 }, { transform: `translate(${tx - f.x}px,${ty - f.y}px) rotate(1080deg) scale(.9)`, opacity: .0 }], 460, { delay: k++ * 70, easing: 'cubic-bezier(.3,.5,.4,1)' }).then(() => c.remove()));
    }
  });
  await Promise.all(jobs);
}
/* 勝ったとき: 場のチップの山と同じ形のものを重ねて置き、勝者へすべらせる */
function fxPileClone(pot) {
  fxChipsClear(); const el = document.getElementById('chippile'); if (!el || !(pot > 0)) return null;
  const R = fxRect(el), d = document.createElement('div'); d.innerHTML = pileHTML(pot);
  const c = d.firstChild; c.removeAttribute('id'); c.style.cssText += `;position:absolute;left:${R.x}px;top:${R.y}px;width:${R.w}px;z-index:4`; fxRoot().appendChild(c); FX.chips = [c]; return c;
}
function fxGlide(to, gold) {
  let chips = FX.chips.slice(); FX.chips = []; SFX.play('slide', 0); SFX.play('chime', 0.7);
  if (!chips.length && gold) {   // 場に山がないとき(ラストゲーム)は、金色のチップを数枚すべらせる
    const p = fxPot();
    for (let k = 0; k < 8; k++) { const c = document.createElement('div'); c.style.cssText = chipCss('#FFD04A') + `;left:${p.x + (k - 4) * 6}px;top:${p.y}px;z-index:4`; fxRoot().appendChild(c); chips.push(c); }
  }
  chips.forEach((c, i) => {
    const big = !!c.style.width, cx = parseFloat(c.style.left) + (big ? parseFloat(c.style.width) / 2 : 0), cy = parseFloat(c.style.top) + (big ? 34 : 0);
    fxRun(c, [{ transform: 'translate(0,0) scale(1)', opacity: 1 }, { transform: `translate(${to.x - cx}px,${to.y - cy}px) scale(.6)`, opacity: .1 }], 850, { delay: big ? 0 : i * 45, easing: 'cubic-bezier(.45,0,.2,1)' }).then(() => c.remove());
  });
}
function fxFanfare(rank, total, froms, jpot) {
  const root = fxRoot(), pot = fxPot(); SFX.play('fanfare', 0);
  const t = document.createElement('div');
  t.style.cssText = `position:absolute;left:${pot.x - 150}px;top:${pot.y - 138}px;width:300px;text-align:center;z-index:6;pointer-events:none;color:#FFE08A;text-shadow:0 2px 0 #7A1A12,0 0 14px rgba(255,200,60,.8);line-height:1.1`;
  t.innerHTML = `<div style="font-size:15px;font-weight:700;letter-spacing:.3em">パンパカパーン!</div><div style="font-size:${jpot ? 34 : 30}px;font-weight:800;margin-top:2px">${jpot ? 'JACKPOT!!' : (rank === 1 ? 'エース' : rank) + 'のソロ!'}</div><div style="font-size:15px;font-weight:700;margin-top:2px">${jpot ? (jpot.last ? 'ラストゲーム' : (rank === 1 ? 'エース' : rank) + 'のソロ') + ' 積立 +' + fmt(jpot.paid) : '祝儀 +' + fmt(total)}</div>`;
  root.appendChild(t);
  fxRun(t, [{ transform: 'scale(.2) rotate(-12deg)', opacity: 0 }, { transform: 'scale(1.18) rotate(3deg)', opacity: 1, offset: .35 }, { transform: 'scale(1) rotate(0)', opacity: 1, offset: .5 }, { transform: 'scale(1)', opacity: 1, offset: .85 }, { transform: 'scale(1.1)', opacity: 0 }], 2000, { easing: 'ease-out' }).then(() => t.remove());
  const cols = ['#E0352A', '#C9A24B', '#1C8196', '#FFE08A', '#fff', '#9B86C8'];
  for (let i = 0; i < 34; i++) {
    const p = document.createElement('div'), a = Math.random() * Math.PI * 2, d = 70 + Math.random() * 120;
    p.style.cssText = `position:absolute;left:${pot.x}px;top:${pot.y - 40}px;width:7px;height:11px;background:${cols[i % cols.length]};z-index:5;pointer-events:none`; root.appendChild(p);
    fxRun(p, [{ transform: 'translate(0,0) rotate(0)', opacity: 1 }, { transform: `translate(${Math.cos(a) * d}px,${Math.sin(a) * d * .8 - 30}px) rotate(${Math.random() * 720}deg)`, opacity: 1, offset: .6 }, { transform: `translate(${Math.cos(a) * d * 1.1}px,${Math.sin(a) * d * .8 + 60}px) rotate(900deg)`, opacity: 0 }], 1500, { delay: Math.random() * 200 }).then(() => p.remove());
  }
  return fxThrow(froms, jpot ? '#FFD04A' : '#E0352A', jpot ? 4 : 3);
}
/* 勝負がついたとき。祝儀があれば、みんなから場に送られてくるお祝いを見せてから、チップが勝者へ床をすべって戻る */
async function fxResult(prev, v) {
  if (FX.off) return;
  const r = v.result, me = v.you && v.you.seat >= 0 ? v.you.seat : -1;
  if (!r || r.how === 'nagashi' || !r.winner) return;
  const w = v.seats.find(s => !s.empty && s.name === r.winner); if (!w) return;
  const gen = FX.gen, jpOn = r.jp && r.jp.paid > 0;
  if (r.how !== 'jackpot') fxPileClone(prev ? prev.pot : v.pot);
  if (r.shugi > 0 && r.shugiRank) {
    const froms = v.seats.filter(s => !s.empty && s.inGame && s.i !== w.i).map(s => fxSeatCenter(s.i, me)).filter(Boolean);
    fxFanfare(r.shugiRank, r.shugi, froms); await fxWait(1500);
  } else await fxWait(500);
  if (gen !== FX.gen) return;
  if (jpOn) {   // ジャックポット: 積立の箱から勝者へ、金色のチップが飛ぶ
    const box = document.getElementById('jpbox'), jb = box ? fxRect(box) : null, from = jb ? { x: jb.x + jb.w / 2, y: jb.y + jb.h / 2 } : fxPot();
    fxFanfare(r.jp.rank || 10, 0, [from], r.jp); await fxWait(1800);
    if (gen !== FX.gen) return;
    const to0 = fxSeatCenter(w.i, me); if (to0 && r.how === 'jackpot') { fxGlide(to0, true); return; }
  }
  if (gen !== FX.gen) return;
  const to = fxSeatCenter(w.i, me); if (to) fxGlide(to);
}
/* 中央に「だれが何をしたか」を出すため、直近の動きを覚えておく */
function trackAct(prev, v) {
  if (!prev || prev.gameNo !== v.gameNo) { TB.lastAct = null; return; }
  v.seats.forEach((s, i) => {
    const ps = prev.seats[i]; if (s.empty || !ps || ps.empty || !s.say || s.say === ps.say) return;
    const t = tagOf(s.say); if (t) TB.lastAct = { game: v.gameNo, i, name: s.name, kind: t[0], amt: t[1] };
  });
}
function lastActHTML(v, hasReq, closed) {
  const a = TB.lastAct; if (!a || closed || hasReq || a.game !== v.gameNo || v.phase === 'done') return '';
  const c = TAG[a.kind];
  return `<span style="display:inline-flex;align-items:center;gap:6px;padding:3px 10px 3px 4px;border-radius:14px;background:rgba(5,13,24,.8);border:1px solid #1F344C"><span style="width:22px;height:22px;border-radius:50%;background:#10243A;border:2px solid ${hueOf(a.name)};display:flex;align-items:center;justify-content:center;font-size:11px">${e(String(a.name).slice(0, 1).toUpperCase())}</span><b style="font-size:12px;font-weight:600">${e(a.name)}</b><span style="padding:0 7px;height:17px;line-height:17px;border-radius:2px;background:${c[0]};color:${c[1]};font-size:11px;font-weight:700;letter-spacing:.08em">${a.kind}${a.amt ? ' ' + e(a.amt) : ''}</span></span>`;
}

/* ---------- 音 ----------
   フリー素材のファイルではなく、端末の中で音を作って鳴らす(ファイルの権利の心配がなく、通信もいらない)。
   好きなフリー素材に差し替えたいときは、SND の中の同じ名前の関数を、音声ファイルの再生に置き換えるだけでよい。
   ホーム=やわらかい音、卓に座る=卓のざわめき、と環境音が切り替わる。 */
const NOISE = new WeakMap();
function noiseBuf(ctx) { let b = NOISE.get(ctx); if (!b) { b = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate); const d = b.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; NOISE.set(ctx, b); } return b; }
function nz(ctx, out, t, o) {   // 雑音を帯域で切り出して、短く鳴らす
  const s = ctx.createBufferSource(); s.buffer = noiseBuf(ctx); s.loop = true; const f = ctx.createBiquadFilter(); f.type = o.type || 'bandpass'; f.frequency.setValueAtTime(o.f, t); if (o.f2) f.frequency.exponentialRampToValueAtTime(o.f2, t + o.d); f.Q.value = o.q || 1;
  const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(o.g, t + (o.a || 0.004)); g.gain.exponentialRampToValueAtTime(0.0001, t + o.d);
  s.connect(f); f.connect(g); g.connect(out); s.start(t, Math.random()); s.stop(t + o.d + 0.05);
}
function tone(ctx, out, t, f, d, g, type) {
  const o = ctx.createOscillator(); o.type = type || 'sine'; o.frequency.setValueAtTime(f, t);
  const e2 = ctx.createGain(); e2.gain.setValueAtTime(0.0001, t); e2.gain.exponentialRampToValueAtTime(g, t + 0.01); e2.gain.exponentialRampToValueAtTime(0.0001, t + d);
  o.connect(e2); e2.connect(out); o.start(t); o.stop(t + d + 0.05);
}
const SND = {
  shuffle(ctx, out, t) { for (let i = 0; i < 16; i++) nz(ctx, out, t + 0.2 + i * 0.055, { f: 3500 + Math.random() * 2500, q: 1.2, d: 0.05, g: 0.22 }); },
  snap(ctx, out, t) { nz(ctx, out, t, { f: 2800, q: 0.9, d: 0.06, g: 0.3 }); tone(ctx, out, t, 170, 0.07, 0.12); },
  clack(ctx, out, t) { tone(ctx, out, t, 2300, 0.07, 0.16, 'triangle'); tone(ctx, out, t + 0.012, 3400, 0.05, 0.1, 'triangle'); nz(ctx, out, t, { f: 5000, q: 1, d: 0.025, g: 0.12 }); },
  whoosh(ctx, out, t) { nz(ctx, out, t, { f: 350, f2: 2600, q: 0.8, d: 0.4, g: 0.22, a: 0.12 }); },
  slide(ctx, out, t) { nz(ctx, out, t, { type: 'lowpass', f: 1800, f2: 300, q: 0.7, d: 0.9, g: 0.16, a: 0.08 }); for (let i = 0; i < 6; i++) tone(ctx, out, t + 0.08 + i * 0.09, 2000 + i * 120, 0.05, 0.05, 'triangle'); },
  chime(ctx, out, t) { [784, 988, 1175, 1568].forEach((f, i) => tone(ctx, out, t + i * 0.09, f, 0.5, 0.12)); },
  showdown(ctx, out, t) {   // 勝負!: 太鼓の2連打 + 低い唸り + シンバル
    [0, 0.22].forEach((d, k) => { const o = ctx.createOscillator(), g = ctx.createGain(); o.type = 'sine'; o.frequency.setValueAtTime(150 - k * 20, t + d); o.frequency.exponentialRampToValueAtTime(48, t + d + 0.35); g.gain.setValueAtTime(0.0001, t + d); g.gain.exponentialRampToValueAtTime(0.38, t + d + 0.012); g.gain.exponentialRampToValueAtTime(0.0001, t + d + 0.5); o.connect(g); g.connect(out); o.start(t + d); o.stop(t + d + 0.55); nz(ctx, out, t + d, { f: 900, q: 0.8, d: 0.12, g: 0.2 }); });
    nz(ctx, out, t + 0.22, { type: 'highpass', f: 5500, q: 0.6, d: 1.1, g: 0.14, a: 0.01 });
    [196, 294, 392].forEach(f => tone(ctx, out, t + 0.22, f, 0.9, 0.09, 'sawtooth'));
  },
  ping(ctx, out, t) { tone(ctx, out, t, 880, 0.18, 0.16); tone(ctx, out, t + 0.1, 1320, 0.28, 0.14); },
  fanfare(ctx, out, t) {   // パン・パ・カ・パーン
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 3200; lp.connect(out);
    [[523, 0, 0.13], [523, 0.16, 0.1], [659, 0.3, 0.1], [784, 0.42, 0.12]].forEach(([f, d, l]) => tone(ctx, lp, t + d, f, l + 0.06, 0.22, 'sawtooth'));
    [523, 659, 784, 1047].forEach(f => tone(ctx, lp, t + 0.58, f, 0.9, 0.2, 'sawtooth'));
    nz(ctx, out, t + 0.58, { type: 'highpass', f: 6000, q: 0.5, d: 0.9, g: 0.12, a: 0.01 });
  }
};
const SFX = {
  ctx: null, master: null, on: true, mode: 'lobby', amb: null, timer: null,
  load() { try { this.on = localStorage.getItem('sfx') !== '0'; } catch (x) {} },
  init() {
    try {
      if (!this.ctx) { const C = window.AudioContext || window.webkitAudioContext; if (!C) return false; this.ctx = new C(); this.master = this.ctx.createGain(); this.master.gain.value = 1.4; this.master.connect(this.ctx.destination); }
      if (this.ctx.state === 'suspended') this.ctx.resume(); return true;
    } catch (x) { return false; }
  },
  /* iPhoneは「タップを離した瞬間(click / touchend)」でしか音を許可しない。許可されたら無音を1回鳴らして確定させる。
     本体のマナーモードがオンだと、ふつうの音は止まる。そのため、聞こえない無音の音声を流し続けて、メディアの音として扱わせる */
  unlock() {
    if (!this.init()) return Promise.resolve(false);
    const ctx = this.ctx;
    return Promise.resolve(ctx.resume ? ctx.resume() : null).catch(() => {}).then(() => {
      try { const b = ctx.createBuffer(1, 1, 22050), src = ctx.createBufferSource(); src.buffer = b; src.connect(ctx.destination); src.start(0); } catch (x) {}
      try {
        if (!this.el) {
          const n = 2205, buf = new ArrayBuffer(44 + n), v = new DataView(buf), w = (o, t) => { for (let i = 0; i < t.length; i++) v.setUint8(o + i, t.charCodeAt(i)); };
          w(0, 'RIFF'); v.setUint32(4, 36 + n, true); w(8, 'WAVEfmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, 22050, true); v.setUint32(28, 22050, true); v.setUint16(32, 1, true); v.setUint16(34, 8, true); w(36, 'data'); v.setUint32(40, n, true);
          for (let i = 0; i < n; i++) v.setUint8(44 + i, 128);
          const a = document.createElement('audio'); a.src = URL.createObjectURL(new Blob([buf], { type: 'audio/wav' })); a.loop = true; a.setAttribute('playsinline', ''); a.volume = 0.01; this.el = a;
        }
        const pr = this.el.play(); if (pr && pr.catch) pr.catch(() => {});
      } catch (x) {}
      if (ctx.state === 'running' && this.on) this.ambience(this.mode);
      return ctx.state === 'running';
    });
  },
  play(name, delay) { if (!this.on || FX.off || !this.ctx) return; if (this.ctx.state !== 'running') { try { this.ctx.resume(); } catch (x) {} return; } try { SND[name](this.ctx, this.master, this.ctx.currentTime + 0.02 + (delay || 0)); } catch (x) {} },
  toggle() { this.on = !this.on; try { localStorage.setItem('sfx', this.on ? '1' : '0'); } catch (x) {} if (this.on) { this.unlock().then(ok => { if (ok) { this.ambience(this.mode, true); this.play('ping', 0); } else toast('音が許可されていません。画面をもう一度タップしてください。マナーモードがオンだと鳴らないことがあります'); }); } else { this.stopAmb(); BGM.stop(); if (this.el) { try { this.el.pause(); } catch (x) {} } } },
  stopAmb() { clearTimeout(this.timer); const a = this.amb; this.amb = null; if (a && this.ctx) { try { a.g.gain.setTargetAtTime(0.0001, this.ctx.currentTime, 0.4); setTimeout(() => { try { a.nodes.forEach(n => n.stop && n.stop()); a.g.disconnect(); } catch (x) {} }, 2000); } catch (x) {} } },
  /* 環境音。lobby=なし(BGMのみ) / table=卓のざわめき(低い雑音とときどきチップの触れ合う音) */
  ambience(mode, force) {
    this.mode = mode; if (!this.on || !this.ctx || this.ctx.state !== 'running') return;
    BGM.start(mode);
    if (this.amb && this.amb.mode === mode && !force) return;
    this.stopAmb(); const ctx = this.ctx, g = ctx.createGain(); g.gain.value = 0.0001; g.connect(this.master); const nodes = [];
    if (mode === 'table') {
      const s = ctx.createBufferSource(); s.buffer = noiseBuf(ctx); s.loop = true; const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 520; const bp = ctx.createBiquadFilter(); bp.type = 'peaking'; bp.frequency.value = 260; bp.gain.value = 6;
      s.connect(lp); lp.connect(bp); bp.connect(g); s.start(); nodes.push(s); g.gain.setTargetAtTime(0.035, ctx.currentTime, 0.8);
      const clink = () => { if (!this.amb || this.amb.mode !== 'table') return; const t = ctx.currentTime + 0.05; const o = ctx.createGain(); o.gain.value = 0.35; o.connect(this.master); SND.clack(ctx, o, t); this.timer = setTimeout(clink, 2500 + Math.random() * 5000); };
      this.timer = setTimeout(clink, 2000);
    } else {
      // トップ画面は、曲だけを鳴らす(以前あった低い和音のうなりは、曲を変えてもオフにしても鳴り続けて不快だったため廃止)
    }
    this.amb = { mode, g, nodes };
  }
};

/* ---------- BGM ----------
   端末の中で作って鳴らす、夜のラウンジ風の曲(ファイルを使わないので権利の心配も通信もない)。
   エレピのコード・ベース・ブラシ風のリズム・ときどき入る静かなメロディーを、毎回少しずつ変えながら流す。
   ロビー=ゆっくり・リズムなし / 卓=少しテンポが上がり、リズムが入る。 */
const BGM = {
  on: true, st: null,
  CH: [   // [根音, 右手の和音]  Am9 | Dm9 | G13 | Cmaj9 | Fmaj7 | Bm7b5 | E7b9 | Am9
    [45, [60, 64, 67, 71], [69, 72, 76, 79, 71]], [50, [53, 57, 60, 64], [69, 72, 74, 76, 77]], [43, [53, 59, 62, 64], [71, 74, 76, 79, 69]], [48, [59, 62, 64, 67], [72, 74, 76, 79, 71]],
    [41, [57, 60, 64, 67], [69, 72, 76, 77, 79]], [47, [57, 62, 65, 69], [69, 72, 74, 77]], [40, [56, 62, 65, 68], [71, 74, 76, 80]], [45, [60, 64, 67, 71], [69, 72, 76, 71]]],


  // ---- 曲ごとの演奏パターン(曲の個性。コード・テンポだけでなく、リズムとフレーズの形が違う) ----
  melo(ctx, out, rv, X, pool, slots, pr, dur, g) {   // 和音に合う音を、とびすぎずに歩く。休みも多い
    const st = X.st; slots.forEach(k => {
      if (Math.random() > pr || st.run >= 2) { st.run = 0; return; }
      let i = st.last + (Math.random() < 0.5 ? -1 : 1) * (Math.random() < 0.7 ? 1 : 2); i = Math.max(0, Math.min(pool.length - 1, i)); st.last = i; st.run++;
      X.ep(ctx, out, rv, X.T(k) + 0.005, pool[i] + (Math.random() < 0.12 ? 12 : 0), X.d8 * dur, g || 0.05);
    });
  },
  snare(ctx, out, t, g) { nz(ctx, out, t, { f: 1900, q: 0.7, d: 0.16, g: g, a: 0.002 }); tone(ctx, out, t, 185, 0.1, g * 0.7, 'triangle'); },
  tom(ctx, out, t, f0, f1, g) {   // 太鼓・タム: 音程が下がる丸い低音
    const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + 0.18);
    const e2 = ctx.createGain(); e2.gain.setValueAtTime(g, t); e2.gain.exponentialRampToValueAtTime(0.0001, t + 0.42); o.connect(e2); e2.connect(out); o.start(t); o.stop(t + 0.45);
  },
  clap(ctx, out, t, g) { [0, 0.011, 0.024].forEach((d, i) => nz(ctx, out, t + d, { f: 1500, q: 1.1, d: i === 2 ? 0.14 : 0.03, g: g * (i === 2 ? 1 : 0.7), a: 0.002 })); },
  hat(ctx, out, t, g, open) { nz(ctx, out, t, { type: 'bandpass', f: 9000, q: 0.5, d: open ? 0.22 : 0.04, g: g * 1.2 }); },
  // サンライズ: 明るいポップ。和音を分けて上下になぞる(アルペジオ)、強拍は3・3・2のアクセント
  pat_sunrise(ctx, out, rv, K, X) {
    const { c, T, d8, table, ep } = X, tn = c[1].concat([c[1][0] + 12]), order = [0, 1, 2, 3, 4, 3, 2, 3], acc = [1, 0.55, 0.7, 1, 0.55, 0.7, 1, 0.6];
    order.forEach((o, k) => ep(ctx, out, rv, T(k), tn[o], d8 * 2.6, (table ? 0.05 : 0.04) * acc[k]));
    this.bass(ctx, out, T(0), c[0], d8 * 2.6, 0.14); this.bass(ctx, out, T(3), c[0] + 7, d8 * 2.2, 0.1); if (table) this.bass(ctx, out, T(6), c[0], d8 * 1.6, 0.09);
    if (table) { this.kick(ctx, out, T(0), 0.2); this.kick(ctx, out, T(3), 0.12); this.kick(ctx, out, T(4), 0.16); this.clap(ctx, out, T(2), 0.06); this.clap(ctx, out, T(6), 0.06); for (let k = 0; k < 8; k++) this.hat(ctx, out, T(k) + (k % 2 ? 0 : 0.0), k % 2 ? 0.045 : 0.022); }
    this.melo(ctx, out, rv, X, c[2], [0, 3, 4, 6, 7], table ? 0.4 : 0.3, 2.4, 0.05);
  },
  // ミッドナイト: スイングするジャズのバラード。歩くようなベース、すき間のある和音(1と「2のうら」)、シンバルの「チン・チッ・チン」
  pat_night(ctx, out, rv, K, X) {
    const { c, T, d8, table, ep } = X, b = c[0], w = [b, c[1][2] - 24, c[1][1] - 24, c[1][3] - 24];
    [0, 2, 4, 6].forEach((k, i) => this.bass(ctx, out, T(k), table ? w[i] : (i % 2 ? b + 7 : b), d8 * 1.9, table ? 0.14 : 0.1));
    c[1].forEach((m, i) => ep(ctx, out, rv, T(0) + i * 0.012, m, d8 * 3.2, 0.04)); c[1].slice(1).forEach((m, i) => ep(ctx, out, rv, T(3) + i * 0.01, m, d8 * 1.4, 0.034));
    if (X.n % 2) c[1].slice(1).forEach((m, i) => ep(ctx, out, rv, T(7) + i * 0.01, m, d8 * 1.2, 0.026));
    if (table) {
      [0, 2, 3, 4, 6, 7].forEach(k => this.hat(ctx, out, T(k), k === 3 || k === 7 ? 0.03 : 0.05, true));   // チン・チッ・チン
      this.snare(ctx, out, T(2), 0.03); this.snare(ctx, out, T(6), 0.03); this.kick(ctx, out, T(0), 0.1);
    }
    this.melo(ctx, out, rv, X, c[2], [0, 2, 3, 4, 6], table ? 0.32 : 0.24, 3, 0.048);
  },
  // 島の風: 三線のくり返しの旋律と、低い持続音。卓では太鼓と小さな手拍子が入る
  pat_ryukyu(ctx, out, rv, K, X) {
    const { c, T, d8, table, ep } = X, pool = c[2], r = c[1][0] + 12, st = X.st;
    const seq = [[0, r], [2, pool[1]], [3, pool[2]], [4, r], [6, pool[Math.min(3, pool.length - 1)]], [7, pool[2]]];
    seq.forEach(([k, m], i) => { if (!table && i % 2 && Math.random() < 0.5) return; ep(ctx, out, rv, T(k), m + (X.n % 4 === 3 && i === 5 ? 12 : 0), d8 * 2.2, (k === 0 ? 0.075 : 0.055)); });
    if (Math.random() < 0.5) ep(ctx, out, rv, T(5), pool[st.last = (st.last + 1) % pool.length], d8 * 1.6, 0.04);
    this.bass(ctx, out, T(0), c[0], d8 * 7, table ? 0.14 : 0.11);   // 低い持続音
    if (table) { this.tom(ctx, out, T(0), 110, 62, 0.34); this.tom(ctx, out, T(4), 100, 58, 0.28); [2, 3, 6, 7].forEach(k => nz(ctx, out, T(k), { f: 3600, q: 1.4, d: 0.07, g: 0.07, a: 0.002 })); this.clap(ctx, out, T(6), 0.05); }
  },
  // ビート: ローファイなヒップホップ。キックは1と「2のうら」、スネアは2と4、ずれたハイハット、うねる低音
  pat_beat(ctx, out, rv, K, X) {
    const { c, T, d8, table, ep, mi } = X, v = table ? 1 : 0.6;
    this.kick(ctx, out, T(0), 0.24 * v); this.kick(ctx, out, T(3), 0.17 * v); if (X.n % 2) this.kick(ctx, out, T(6) + 0.02, 0.12 * v);
    this.snare(ctx, out, T(2), 0.09 * v); this.snare(ctx, out, T(6), 0.09 * v);
    for (let k = 0; k < 8; k++) this.hat(ctx, out, T(k), (k % 2 ? 0.05 : 0.025) * v, k === 7);
    const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(this.mf(c[0] + 12), T(0)); const e2 = ctx.createGain(); e2.gain.setValueAtTime(0.0001, T(0)); e2.gain.exponentialRampToValueAtTime(0.2 * v, T(0) + 0.02); e2.gain.exponentialRampToValueAtTime(0.0001, T(0) + d8 * 2.8);
    o.connect(e2); e2.connect(out); o.start(T(0)); o.stop(T(0) + d8 * 3);
    this.bass(ctx, out, T(3), c[0] + 12, d8 * 1.5, 0.13 * v); this.bass(ctx, out, T(6), c[0] + 7, d8 * 1.2, 0.1 * v);
    c[1].forEach((m, i) => { ep(ctx, out, rv, T(0) + i * 0.008, m, d8 * 2.4, 0.038); ep(ctx, out, rv, T(5) + i * 0.008, m, d8 * 1.2, 0.03); });
    this.melo(ctx, out, rv, X, c[2], [1, 3, 5, 7], 0.3, 1.6, 0.045);
  },
  // ピアノソロ: ゆっくりした分散和音が、波のように上がって下がる。ペダルを踏んだような長い響き
  pat_piano(ctx, out, rv, K, X) {
    const { c, T, d8, ep } = X, tn = c[1].concat([c[1][0] + 12]), order = [0, 1, 2, 3, 4, 3, 2, 1];
    order.forEach((o, k) => ep(ctx, out, rv, T(k) + Math.random() * 0.012, tn[o], d8 * 5, 0.046 * (k === 0 ? 1.25 : k === 4 ? 1.1 : 0.85)));
    this.bass(ctx, out, T(0), c[0], d8 * 7, 0.12);
    this.melo(ctx, out, rv, X, c[2], [0, 4], 0.45, 6, 0.055);
  },

  // ポップ: 4つ打ちのキック、裏拍のハイハット、手拍子、パッド。メロディーは4小節くり返す(覚えやすい形)
  pat_pop(ctx, out, rv, K, X) {
    const { c, T, d8, table, st } = X, v = table ? 1 : 0.55;
    c[1].forEach((m, i) => this.pad(ctx, out, rv, T(0) + i * 0.01, m - 12, d8 * 7.6, 0.028));
    [0, 3, 6].forEach(k => c[1].forEach((m, i) => X.ep(ctx, out, rv, T(k) + i * 0.008, m, d8 * 1.5, 0.04)));
    [0, 2, 4, 6].forEach(k => this.kick(ctx, out, T(k), (k % 4 ? 0.14 : 0.2) * v)); [2, 6].forEach(k => this.clap(ctx, out, T(k), 0.07 * v));
    for (let k = 0; k < 8; k++) this.hat(ctx, out, T(k), (k % 2 ? 0.05 : 0.018) * v, k % 2 === 1 && k !== 7);
    [0, 1, 2, 3, 4, 5, 6, 7].forEach(k => this.bass(ctx, out, T(k), c[0] + (k % 4 === 3 ? 12 : 0), d8 * 0.9, table ? 0.1 : (k % 2 ? 0 : 0.09)));
    if (X.n % 4 === 0 || !st.mot) st.mot = [0, 2, 3, 4, 6, 7].map(k => Math.random() < 0.62 ? [k, Math.floor(Math.random() * c[2].length)] : null);
    st.mot.forEach(x => { if (x) this.lead(ctx, out, rv, T(x[0]), c[2][Math.min(x[1], c[2].length - 1)] + 12, d8 * 1.7, table ? 0.05 : 0.04); });
  },
  // シティポップ: ファンクなベース、エレピのコード(7thの和音)、16ビート風のハイハット
  pat_citypop(ctx, out, rv, K, X) {
    const { c, T, d8, table, ep } = X, v = table ? 1 : 0.6, b = c[0];
    [[0, 0, 1.4], [3, 12, 0.8], [4, 0, 1.2], [6, 7, 0.8], [7, 5, 0.6]].forEach(([k, o, l]) => this.bass(ctx, out, T(k), b + o, d8 * l, 0.13 * (k === 0 ? 1.1 : 0.85)));
    c[1].forEach((m, i) => { ep(ctx, out, rv, T(0) + i * 0.012, m, d8 * 2.6, 0.042); ep(ctx, out, rv, T(3) + i * 0.01, m, d8 * 1.1, 0.034); ep(ctx, out, rv, T(6) + i * 0.01, m, d8 * 1.3, 0.034); });
    this.kick(ctx, out, T(0), 0.2 * v); this.kick(ctx, out, T(5), 0.14 * v); this.kick(ctx, out, T(7), 0.1 * v);
    this.snare(ctx, out, T(2), 0.08 * v); this.snare(ctx, out, T(6), 0.08 * v); if (table) this.snare(ctx, out, T(3) + 0.01, 0.025);
    for (let k = 0; k < 8; k++) { this.hat(ctx, out, T(k), (k % 2 ? 0.04 : 0.024) * v, k === 3); if (table && k % 2) this.hat(ctx, out, T(k) + d8 * 0.5, 0.016, false); }
    this.melo(ctx, out, rv, X, c[2], [0, 2, 3, 5, 6], table ? 0.42 : 0.3, 1.8, 0.05);
  },
  // リゾート: ウクレレのかき鳴らし、スチールドラム風のメロディー、コンガ風の手のひらの太鼓
  pat_resort(ctx, out, rv, K, X) {
    const { c, T, d8, table } = X;
    [[0, 1], [2, 1], [3, -1], [5, -1], [6, 1], [7, -1]].forEach(([k, dir]) => { const tn = dir > 0 ? c[1] : c[1].slice().reverse(); tn.forEach((m, i) => this.uke(ctx, out, rv, T(k) + i * 0.014, m + 12, d8 * 1.5, (k === 0 ? 0.024 : 0.018))); });
    this.bass(ctx, out, T(0), c[0], d8 * 2.4, 0.1); this.bass(ctx, out, T(3), c[0] + 7, d8 * 1.6, 0.1); this.bass(ctx, out, T(4), c[0], d8 * 1.6, 0.1); this.bass(ctx, out, T(7), c[0] + 7, d8 * 0.8, 0.07);
    for (let k = 0; k < 8; k++) nz(ctx, out, T(k), { type: 'highpass', f: 6500, q: 0.5, d: 0.05, g: k % 2 ? 0.04 : 0.02 });   // シェイカー
    if (table) { [0, 3, 4, 7].forEach((k, i) => this.tom(ctx, out, T(k), i % 2 ? 260 : 200, i % 2 ? 190 : 140, 0.16)); [2, 6].forEach(k => nz(ctx, out, T(k), { f: 2200, q: 1.2, d: 0.05, g: 0.07, a: 0.002 })); }
    const st = X.st; [0, 2, 3, 4, 6, 7].forEach(k => { if (Math.random() > (table ? 0.5 : 0.36) || st.run >= 3) { st.run = 0; return; } let i = Math.max(0, Math.min(c[2].length - 1, st.last + (Math.random() < 0.5 ? -1 : 1))); st.last = i; st.run++; this.bell(ctx, out, rv, T(k), c[2][i] + 12, d8 * 2, 0.05); });
  },
  // ネオン: シンセウェーブ。のこぎり波のパッド、8分音符で刻むベース、ゲートがかった手拍子
  pat_neon(ctx, out, rv, K, X) {
    const { c, T, d8, table, st } = X, v = table ? 1 : 0.5;
    c[1].forEach((m, i) => this.pad(ctx, out, rv, T(0) + i * 0.02, m, d8 * 7.8, 0.034));
    for (let k = 0; k < 8; k++) this.bass(ctx, out, T(k), c[0] + (k % 2 ? 12 : 0), d8 * 0.8, (table ? 0.1 : 0.06) * (k % 4 === 0 ? 1.2 : 0.8));
    [0, 4].forEach(k => this.kick(ctx, out, T(k), 0.22 * v)); [2, 6].forEach(k => { this.clap(ctx, out, T(k), 0.08 * v); nz(ctx, out, T(k), { f: 900, q: 0.6, d: 0.3, g: 0.03 * v, a: 0.004 }); });
    for (let k = 1; k < 8; k += 2) this.hat(ctx, out, T(k), 0.04 * v, k === 7);
    const arp = c[1]; if (table || X.n % 2) [0, 2, 4, 6].forEach((k, i) => this.lead(ctx, out, rv, T(k) + d8 * 0.5 * 0, arp[(i + X.n) % arp.length] + 12, d8 * 1.2, 0.03));
    if (X.n % 4 === 0 || !st.mot) st.mot = [0, 3, 6].map(k => Math.random() < 0.7 ? [k, Math.floor(Math.random() * c[2].length)] : null);
    st.mot.forEach(x => { if (x) this.lead(ctx, out, rv, T(x[0]), c[2][Math.min(x[1], c[2].length - 1)] + 12, d8 * 2.6, 0.045); });
  },

  // ワルツ: 3拍子。「ズン・チャ・チャ」の流れに、ハープのような分散和音
  pat_waltz(ctx, out, rv, K, X) {
    const { c, T, d8, table, ep } = X, tn = c[1].concat([c[1][0] + 12]), order = [0, 1, 2, 3, 2, 1];
    order.forEach((o, k) => ep(ctx, out, rv, T(k), tn[o], d8 * 3.4, 0.034 * (k === 0 ? 1.3 : k % 2 ? 0.75 : 1)));
    this.bass(ctx, out, T(0), c[0], d8 * 2.6, 0.14); [2, 4].forEach(k => c[1].slice(1).forEach((m, i) => ep(ctx, out, rv, T(k) + i * 0.01, m - 12, d8 * 1.6, 0.03)));
    if (table) { this.kick(ctx, out, T(0), 0.14); [2, 4].forEach(k => this.hat(ctx, out, T(k), 0.04, false)); nz(ctx, out, T(0), { f: 300, q: 0.8, d: 0.06, g: 0.04 }); }
    this.melo(ctx, out, rv, X, c[2], [0, 2, 3, 4], table ? 0.5 : 0.4, 2.6, 0.05);
  },
  // シャッフル: 3連のはねたリズムのブルース。ブギーのように上がって下がるベース、裏拍の和音
  pat_shuffle(ctx, out, rv, K, X) {
    const { c, T, d8, table, ep } = X, off = [0, 4, 7, 9, 10, 9, 7, 4], v = table ? 1 : 0.6;
    off.forEach((o, k) => { if (!table && k % 2) return; this.bass(ctx, out, T(k), c[0] + 12 + o - 12 * (o > 8 ? 1 : 0), d8 * 0.9, 0.11 * (k % 4 === 0 ? 1.15 : 0.8)); });
    [1, 3, 5, 7].forEach(k => { if (!table && k % 4 === 3) return; c[1].forEach((m, i) => ep(ctx, out, rv, T(k) + i * 0.008, m, d8 * 0.9, 0.034)); });
    ep(ctx, out, rv, T(0), c[1][0], d8 * 2, 0.04);
    this.kick(ctx, out, T(0), 0.2 * v); this.kick(ctx, out, T(4), 0.15 * v); this.snare(ctx, out, T(2), 0.08 * v); this.snare(ctx, out, T(6), 0.08 * v);
    for (let k = 0; k < 8; k++) this.hat(ctx, out, T(k), (k % 2 ? 0.026 : 0.045) * v, false);
    this.melo(ctx, out, rv, X, c[2], [0, 2, 3, 4, 6, 7], table ? 0.4 : 0.3, 1.8, 0.05);
  },
  // ---- 曲の一覧 ----  [根音, 右手の和音, メロディーに使う音] を8小節ぶん。bpm/sw/rhythm/mel は [ロビー, 卓]
  TR: {
    lounge: { name: 'ラウンジ', desc: '夜のラウンジ風・エレピ(標準)', bpm: [68, 88], sw: [0.08, 0.16], rhythm: [false, true], mel: [0.26, 0.38] },
    sunrise: { pat: 'sunrise', name: 'サンライズ', desc: '明るい朝のカフェ風・エレピ', bpm: [72, 96], sw: [0.08, 0.14], rhythm: [false, true], mel: [0.3, 0.4],
      CH: [[48, [60, 64, 67, 71], [72, 74, 76, 79, 71]], [40, [59, 62, 64, 67], [71, 74, 76, 79]], [41, [57, 60, 64, 67], [69, 72, 74, 76, 77]], [43, [59, 62, 64, 69], [71, 74, 76, 79]],
        [45, [60, 64, 67, 71], [69, 72, 76, 79]], [50, [53, 57, 60, 64], [69, 72, 74, 76, 77]], [43, [53, 59, 62, 64], [71, 74, 76, 79, 69]], [48, [60, 64, 67, 71], [72, 74, 76, 79]]] },
    night: { pat: 'night', name: 'ミッドナイト', desc: '深夜のバー風・しっとり短調', bpm: [60, 80], sw: [0.2, 0.28], rhythm: [false, true], mel: [0.24, 0.34], vol: 0.95,
      CH: [[36, [60, 63, 67, 70], [72, 75, 77, 79, 70]], [44, [56, 60, 63, 67], [72, 75, 77, 79]], [41, [63, 65, 68, 72], [72, 75, 77, 80, 68]], [43, [59, 62, 65, 68], [71, 74, 77, 80, 67]],
        [39, [63, 67, 70, 74], [74, 75, 77, 79, 70]], [41, [63, 65, 68, 72], [72, 75, 77, 80]], [43, [59, 62, 65, 68], [71, 74, 77, 80]], [36, [60, 63, 67, 70], [72, 75, 79, 70]]] },
    ryukyu: { pat: 'ryukyu', name: '島の風', desc: '沖縄の音階・弦をはじく音', pluck: true, bpm: [64, 84], sw: [0.04, 0.08], rhythm: [false, true], mel: [0.5, 0.6], vol: 0.8,
      CH: [[36, [60, 67, 72], [72, 76, 77, 79, 83, 84]], [36, [60, 67, 72], [72, 76, 77, 79, 83]], [41, [60, 65, 69], [72, 76, 77, 79, 83]], [36, [60, 67, 72], [72, 76, 77, 79, 83, 84]],
        [43, [62, 67, 71], [71, 72, 76, 79, 83]], [41, [60, 65, 69], [72, 76, 77, 79]], [36, [60, 67, 72], [72, 76, 77, 79, 83]], [36, [60, 67, 72], [76, 77, 79, 83, 84]]] },
    beat: { pat: 'beat', name: 'ビート', desc: 'リズムがはっきり・クールな雰囲気', bpm: [84, 108], sw: [0.14, 0.18], rhythm: [true, true], mel: [0.3, 0.42], vol: 0.95 },
    pop: { pat: 'pop', name: 'ポップ', desc: '明るく元気・手拍子と4つ打ち', bpm: [100, 120], sw: [0.02, 0.02], rhythm: [true, true], mel: [0.5, 0.5], vol: 0.95,
      CH: [[48, [60, 64, 67, 72], [72, 74, 76, 79, 67]], [43, [55, 59, 62, 67], [71, 74, 76, 79]], [45, [57, 60, 64, 69], [72, 76, 79, 69]], [41, [57, 60, 65, 69], [72, 74, 77, 76, 69]],
        [48, [60, 64, 67, 72], [72, 74, 76, 79, 67]], [43, [55, 59, 62, 67], [71, 74, 76, 79]], [41, [57, 60, 65, 69], [72, 74, 77, 76, 69]], [43, [55, 59, 62, 67], [71, 74, 79, 76]]] },
    citypop: { pat: 'citypop', name: 'シティポップ', desc: 'おしゃれ・ファンクなベース', bpm: [92, 104], sw: [0.1, 0.12], rhythm: [true, true], mel: [0.36, 0.44], vol: 0.95,
      CH: [[41, [60, 64, 65, 69], [72, 76, 77, 79, 69]], [40, [59, 62, 64, 67], [71, 74, 76, 79]], [50, [57, 60, 62, 65], [69, 72, 74, 77]], [48, [59, 60, 64, 67], [72, 74, 76, 79, 71]],
        [41, [60, 64, 65, 69], [72, 76, 77, 79, 69]], [43, [59, 62, 65, 67], [71, 74, 77, 79]], [40, [59, 62, 64, 67], [71, 74, 76, 79]], [45, [57, 60, 64, 67], [69, 72, 76, 79]]] },
    resort: { pat: 'resort', name: 'リゾート', desc: 'ウクレレとスチールドラムの南国風', bpm: [84, 100], sw: [0.06, 0.1], rhythm: [false, true], mel: [0.4, 0.5], vol: 1,
      CH: [[48, [60, 64, 67, 69], [72, 74, 76, 79, 81]], [45, [57, 60, 64, 67], [72, 74, 76, 79]], [50, [57, 60, 62, 65], [74, 77, 79, 81]], [43, [59, 62, 65, 67], [74, 77, 79, 83]],
        [48, [60, 64, 67, 69], [72, 74, 76, 79, 81]], [41, [57, 60, 64, 65], [72, 76, 77, 81]], [43, [59, 62, 65, 67], [74, 77, 79, 83]], [48, [60, 64, 67, 69], [72, 76, 79, 81]]] },
    neon: { pat: 'neon', name: 'ネオン', desc: 'シンセウェーブ・夜の街のドライブ', bpm: [88, 104], sw: [0.02, 0.02], rhythm: [false, true], mel: [0.5, 0.5], vol: 0.9,
      CH: [[45, [57, 60, 64, 69], [72, 76, 79, 81, 69]], [41, [57, 60, 65, 69], [72, 77, 79, 81]], [48, [55, 60, 64, 67], [72, 76, 79, 67]], [43, [55, 59, 62, 67], [71, 74, 79, 67]],
        [45, [57, 60, 64, 69], [72, 76, 79, 81, 69]], [41, [57, 60, 65, 69], [72, 77, 79, 81]], [48, [55, 60, 64, 67], [72, 76, 79, 67]], [43, [55, 59, 62, 67], [71, 74, 79, 83]]] },
    waltz: { pat: 'waltz', len: 6, name: 'ワルツ', desc: '3拍子・やさしい分散和音', bpm: [88, 104], sw: [0.04, 0.06], rhythm: [false, true], mel: [0.4, 0.5], vol: 1.05,
      CH: [[45, [57, 60, 64, 69], [72, 76, 79, 69, 71]], [40, [56, 59, 62, 64], [71, 74, 76, 80]], [45, [57, 60, 64, 69], [72, 76, 79, 69]], [50, [57, 60, 62, 65], [69, 72, 74, 77]],
        [41, [57, 60, 65, 69], [72, 74, 77, 69]], [40, [56, 59, 62, 64], [71, 74, 76, 80]], [45, [57, 60, 64, 69], [72, 76, 79, 69]], [40, [56, 59, 62, 64], [71, 74, 76, 80]]] },
    shuffle: { pat: 'shuffle', name: 'シャッフル', desc: '3連のはねたリズム・ブルース風', bpm: [84, 100], sw: [0.33, 0.33], rhythm: [true, true], mel: [0.32, 0.42], vol: 0.95,
      CH: [[48, [60, 64, 67, 70], [72, 75, 76, 79, 70]], [48, [60, 64, 67, 70], [72, 75, 76, 79, 70]], [41, [60, 63, 65, 69], [72, 75, 77, 79, 70]], [48, [60, 64, 67, 70], [72, 75, 76, 79, 70]],
        [41, [60, 63, 65, 69], [72, 75, 77, 79, 70]], [41, [60, 63, 65, 69], [72, 75, 77, 79, 70]], [48, [60, 64, 67, 70], [72, 75, 76, 79, 70]], [43, [59, 62, 65, 67], [71, 74, 77, 79, 70]]] },
    piano: { pat: 'piano', name: 'ピアノソロ', desc: 'ゆっくり・音数が少ない', bpm: [56, 66], sw: [0.06, 0.08], rhythm: [false, false], mel: [0.34, 0.4], vol: 1.1,
      CH: [[48, [60, 64, 67, 71], [72, 74, 76, 79, 71]], [45, [60, 64, 67, 71], [69, 72, 76, 79, 71]], [41, [57, 60, 64, 67], [69, 72, 74, 76, 77]], [43, [59, 62, 64, 69], [71, 74, 76, 79]],
        [48, [60, 64, 67, 71], [72, 76, 79, 71]], [50, [53, 57, 60, 64], [69, 72, 74, 77]], [43, [53, 59, 62, 64], [71, 74, 76, 79]], [48, [60, 64, 67, 71], [72, 74, 76, 79]]] }
  },
  // ロビー(トップ画面)と卓は、別々に選べる。保存は端末ごと
  sel(mode) { let id = null; try { id = localStorage.getItem('bgm_' + (mode === 'table' ? 'table' : 'lobby')); } catch (x) {} return this.TR[id] ? id : 'lounge'; },
  choose(mode, id) {
    if (!this.TR[id]) return; try { localStorage.setItem('bgm_' + (mode === 'table' ? 'table' : 'lobby'), id); } catch (x) {}
    if (SFX.mode === mode) { this.start(mode); return; }
    this.preview(mode);   // いまの場面と違う方を選んだときは、10秒だけ試し聴き
  },
  preview(mode) {
    if (!this.on || !SFX.on || !SFX.ctx || SFX.ctx.state !== 'running') return;
    clearTimeout(this._pv); const back = SFX.mode; this.start(mode);
    this._pv = setTimeout(() => { if (SFX.mode === back) this.start(back); }, 10000);
  },
  mf: m => 440 * Math.pow(2, (m - 69) / 12),
  load() { try { this.on = localStorage.getItem('bgm') !== '0'; } catch (x) {} },
  rev(ctx) {   // 残響: 長さ2.4秒。後ろほど高音が減る(暗くなる)ようにして、自然な部屋の響きにする。左右で別の雑音にして広がりを出す
    if (this._rv && this._rv.ctx === ctx) return this._rv.node;
    const sr = ctx.sampleRate, len = Math.floor(sr * 2.4), pre = Math.floor(sr * 0.018), buf = ctx.createBuffer(2, len, sr);
    for (let c = 0; c < 2; c++) { const d = buf.getChannelData(c); let lp = 0;
      for (let i = pre; i < len; i++) { const x = i / len, a = 0.85 - 0.7 * x; lp += (Math.random() * 2 - 1 - lp) * (1 - a); d[i] = lp * Math.pow(1 - x, 2.4) * 2.2; } }
    const cv = ctx.createConvolver(); cv.buffer = buf; this._rv = { ctx, node: cv }; return cv;
  },
  pan(ctx, out, p) { if (!ctx.createStereoPanner) return out; const n = ctx.createStereoPanner(); n.pan.value = p; n.connect(out); return n; },
  ep(ctx, out, rv, t, m, d, g) {   // エレピ風: 基音+倍音+打鍵の「コツ」という成分。音の高さで明るさを変え、左右に少しずつ振る
    const f = this.mf(m), o2 = this.pan(ctx, out, (Math.random() - 0.5) * 0.5), lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = Math.min(9000, f * 7 + 900); lp.connect(o2);
    [[1, 1, 'sine'], [2, 0.22, 'sine'], [4, 0.05, 'sine'], [1.004, 0.5, 'triangle'], [0.998, 0.28, 'sine']].forEach(([k, a, ty]) => {
      const o = ctx.createOscillator(); o.type = ty; o.frequency.value = f * k; const e2 = ctx.createGain();
      e2.gain.setValueAtTime(0.0001, t); e2.gain.exponentialRampToValueAtTime(g * a, t + 0.008); e2.gain.exponentialRampToValueAtTime(g * a * 0.35, t + 0.25); e2.gain.exponentialRampToValueAtTime(0.0001, t + d);
      o.connect(e2); e2.connect(lp); if (rv) e2.connect(rv); o.start(t); o.stop(t + d + 0.05);
    });
    const b = ctx.createOscillator(); b.type = 'sine'; b.frequency.value = f * 6.01; const be = ctx.createGain(); be.gain.setValueAtTime(g * 0.07, t); be.gain.exponentialRampToValueAtTime(0.0001, t + 0.09); b.connect(be); be.connect(lp); b.start(t); b.stop(t + 0.12);   // 打鍵のコツ
  },
  pad(ctx, out, rv, t, m, d, g) {   // シンセのパッド: 少しずらした2本ののこぎり波を、ゆっくり立ち上げる
    const f = this.mf(m), lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(500, t); lp.frequency.linearRampToValueAtTime(Math.min(2200, f * 4), t + d * 0.5);
    const e2 = ctx.createGain(); e2.gain.setValueAtTime(0.0001, t); e2.gain.exponentialRampToValueAtTime(g, t + Math.min(0.5, d * 0.3)); e2.gain.exponentialRampToValueAtTime(0.0001, t + d);
    [-7, 7].forEach(c => { const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.detune.value = c; o.connect(lp); o.start(t); o.stop(t + d + 0.05); });
    lp.connect(e2); e2.connect(this.pan(ctx, out, (Math.random() - 0.5) * 0.8)); if (rv) e2.connect(rv);
  },
  lead(ctx, out, rv, t, m, d, g) {   // シンセのメロディー: のこぎり波+四角波、フィルターが閉じながら減衰
    const f = this.mf(m), lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 2; lp.frequency.setValueAtTime(3600, t); lp.frequency.exponentialRampToValueAtTime(900, t + Math.min(d, 0.6));
    const e2 = ctx.createGain(); e2.gain.setValueAtTime(0.0001, t); e2.gain.exponentialRampToValueAtTime(g, t + 0.01); e2.gain.exponentialRampToValueAtTime(g * 0.4, t + 0.12); e2.gain.exponentialRampToValueAtTime(0.0001, t + d);
    [['sawtooth', 3], ['square', -9]].forEach(([ty, c]) => { const o = ctx.createOscillator(); o.type = ty; o.frequency.value = f; o.detune.value = c; const og = ctx.createGain(); og.gain.value = ty === 'square' ? 0.45 : 0.7; o.connect(og); og.connect(lp); o.start(t); o.stop(t + d + 0.05); });
    lp.connect(e2); e2.connect(out); if (rv) e2.connect(rv);
  },
  uke(ctx, out, rv, t, m, d, g) {   // ウクレレ風: やわらかい三角波+倍音、短く減衰
    const f = this.mf(m), e2 = ctx.createGain(); e2.gain.setValueAtTime(0.0001, t); e2.gain.exponentialRampToValueAtTime(g, t + 0.004); e2.gain.exponentialRampToValueAtTime(0.0001, t + Math.min(d, 0.8));
    [[1, 'triangle', 1], [2, 'sine', 0.35], [3, 'sine', 0.12]].forEach(([k, ty, a]) => { const o = ctx.createOscillator(); o.type = ty; o.frequency.value = f * k; const og = ctx.createGain(); og.gain.value = a; o.connect(og); og.connect(e2); o.start(t); o.stop(t + Math.min(d, 0.8) + 0.05); });
    e2.connect(this.pan(ctx, out, (Math.random() - 0.5) * 0.4)); if (rv) e2.connect(rv);
  },
  bell(ctx, out, rv, t, m, d, g) {   // スチールドラム風: 基音と、整数倍ではない倍音が、ゆっくり消える
    const f = this.mf(m), e2 = ctx.createGain(); e2.gain.setValueAtTime(0.0001, t); e2.gain.exponentialRampToValueAtTime(g, t + 0.003); e2.gain.exponentialRampToValueAtTime(0.0001, t + Math.min(d, 1.1));
    [[1, 1], [2.76, 0.28], [5.4, 0.09]].forEach(([k, a]) => { const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f * k; const og = ctx.createGain(); og.gain.value = a; o.connect(og); og.connect(e2); o.start(t); o.stop(t + Math.min(d, 1.1) + 0.05); });
    e2.connect(this.pan(ctx, out, (Math.random() - 0.5) * 0.5)); if (rv) e2.connect(rv);
  },
  pluck(ctx, out, rv, t, m, d, g) {   // 弦をはじく音: のこぎり波をすばやく丸めて、短く減衰
    const f = this.mf(m), o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(f * 1.012, t); o.frequency.exponentialRampToValueAtTime(f, t + 0.04);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(2600, t); lp.frequency.exponentialRampToValueAtTime(500, t + 0.35);
    const e2 = ctx.createGain(); e2.gain.setValueAtTime(0.0001, t); e2.gain.exponentialRampToValueAtTime(g * 0.9, t + 0.006); e2.gain.exponentialRampToValueAtTime(0.0001, t + Math.min(d, 1.4));
    o.connect(lp); lp.connect(e2); e2.connect(out); if (rv) e2.connect(rv); o.start(t); o.stop(t + Math.min(d, 1.4) + 0.05);
  },
  bass(ctx, out, t, m, d, g) {   // 低音: 基音(三角波)に2倍音を足す。スマホの小さなスピーカーは65〜100Hzがほとんど出ないので、2倍音で「音の高さ」を聞かせ、こもった低い唸りを減らす
    const f = this.mf(m), lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 650;
    const e2 = ctx.createGain(); e2.gain.setValueAtTime(0.0001, t); e2.gain.exponentialRampToValueAtTime(g, t + 0.02); e2.gain.exponentialRampToValueAtTime(0.0001, t + d);
    [[1, 'triangle', 1], [2, 'sine', 0.45]].forEach(([k, ty, a]) => { const o = ctx.createOscillator(); o.type = ty; o.frequency.value = f * k; const og = ctx.createGain(); og.gain.value = a; o.connect(og); og.connect(lp); o.start(t); o.stop(t + d + 0.05); });
    lp.connect(e2); e2.connect(out);
  },
  kick(ctx, out, t, g) {
    const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(130, t); o.frequency.exponentialRampToValueAtTime(48, t + 0.12);
    const e2 = ctx.createGain(); e2.gain.setValueAtTime(g, t); e2.gain.exponentialRampToValueAtTime(0.0001, t + 0.22); o.connect(e2); e2.connect(out); o.start(t); o.stop(t + 0.25);
    nz(ctx, out, t, { f: 3200, q: 0.9, d: 0.018, g: g * 0.22, a: 0.001 });   // 打撃音
  },
  // 1小節(8分音符×8)を、時刻 t0 から並べる。n=何小節目か
  bar(ctx, out, rv, mode, n, t0, K) {
    K = K || this.TR.lounge; const mi = mode === 'table' ? 1 : 0, table = K.rhythm[mi], bpm = K.bpm[mi], d8 = 60 / bpm / 2, sw = K.sw[mi], c = K.CH[n % K.CH.length], st = this.st || (this.st = { last: 2, run: 0 });
    const ep = K.pluck ? this.pluck.bind(this) : this.ep.bind(this);
    if (K.pat) { const T0 = k => t0 + k * d8 + (k % 2 ? sw * d8 : 0); return this['pat_' + K.pat](ctx, out, rv, K, { mi, table, d8, sw, c, st, T: T0, n, ep }); }
    const T = k => t0 + k * d8 + (k % 2 ? sw * d8 : 0);
    // コード(小節の頭は長く、table ではもう一度短く)
    c[1].forEach((m, i) => ep(ctx, out, rv, T(0) + i * 0.012, m, d8 * 7.5, table ? 0.05 : 0.042));
    if (table) c[1].slice(1).forEach((m, i) => ep(ctx, out, rv, T(3) + i * 0.01, m, d8 * 2.4, 0.03));
    else if (n % 2) c[1].slice(2).forEach((m, i) => ep(ctx, out, rv, T(4) + i * 0.012, m, d8 * 3, 0.026));
    // ベース
    this.bass(ctx, out, T(0), c[0], d8 * 3.6, table ? 0.16 : 0.13);
    if (table) { this.bass(ctx, out, T(4), c[0] + 7, d8 * 1.6, 0.11); if (n % 2) this.bass(ctx, out, T(6) + 0.01, c[0] + 12, d8 * 1.2, 0.08); }
    else if (n % 4 === 3) this.bass(ctx, out, T(5), c[0] + 7, d8 * 2, 0.08);
    // リズム(table のみ): やわらかいキック・ブラシ・ハイハット
    if (table) {
      this.kick(ctx, out, T(0), 0.2); this.kick(ctx, out, T(5), 0.12);
      for (let k = 0; k < 8; k++) nz(ctx, out, T(k), { type: 'highpass', f: 7000, q: 0.6, d: 0.05, g: k % 2 ? 0.05 : 0.025 });
      nz(ctx, out, T(2), { f: 2600, q: 0.8, d: 0.2, g: 0.05, a: 0.01 }); nz(ctx, out, T(6), { f: 2600, q: 0.8, d: 0.2, g: 0.05, a: 0.01 });
    }
    // メロディー: 和音に合う音の中を、とびすぎないように歩く。休みも多い
    const pool = c[2], slots = table ? [0, 2, 3, 4, 6, 7] : [0, 2, 4, 6], pr = K.mel[mi];
    slots.forEach(k => {
      if (Math.random() > pr || (st.run >= 2)) { st.run = 0; return; }
      let i = st.last + (Math.random() < 0.5 ? -1 : 1) * (Math.random() < 0.7 ? 1 : 2); i = Math.max(0, Math.min(pool.length - 1, i)); st.last = i; st.run++;
      ep(ctx, out, rv, T(k) + 0.005, pool[i] + (Math.random() < 0.15 ? 12 : 0), d8 * (k === 0 ? 3.5 : 2.2), 0.05);
    });
  },
  start(mode) {
    const S = SFX; if (!this.on || !S.on || !S.ctx || S.ctx.state !== 'running') return;
    const id = this.sel(mode), K = this.TR[id];
    if (this.cur && this.cur.mode === mode && this.cur.id === id) return;
    this.stop(); const ctx = S.ctx, g = ctx.createGain(); g.gain.value = 0.0001;
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -16; comp.knee.value = 14; comp.ratio.value = 3.2; comp.attack.value = 0.012; comp.release.value = 0.28; const lim = ctx.createWaveShaper(), cv = new Float32Array(1025); for (let i = 0; i < 1025; i++) { const x = (i / 512) - 1; cv[i] = Math.tanh(x * 1.1) / Math.tanh(1.1); } lim.curve = cv; g.connect(comp); comp.connect(lim); lim.connect(S.master);
    const rg = ctx.createGain(); rg.gain.value = 0.55; const rv = this.rev(ctx); rv.connect(rg); rg.connect(g);
    g.gain.setTargetAtTime((mode === 'table' ? 0.67 : 0.8) * (K.vol || 1), ctx.currentTime, 1.2);   // ゆっくり音を上げる
    this.st = null;
    const cur = this.cur = { mode, id, g, rg, comp, lim, next: ctx.currentTime + 0.15, n: 0, timer: null };
    const bpm = K.bpm[mode === 'table' ? 1 : 0], barLen = 60 / bpm / 2 * (K.len || 8);
    const tick = () => {
      if (this.cur !== cur) return;
      while (cur.next < ctx.currentTime + 1.6) { try { this.bar(ctx, g, rv, mode, cur.n, cur.next, K); } catch (x) {} cur.n++; cur.next += barLen; }
    };
    tick(); cur.timer = setInterval(tick, 300);
  },
  stop() {
    const c = this.cur; this.cur = null; if (!c) return; clearInterval(c.timer); const ctx = SFX.ctx;
    try { c.g.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.3); setTimeout(() => { try { c.g.disconnect(); c.rg.disconnect(); if (c.comp) c.comp.disconnect(); if (c.lim) c.lim.disconnect(); } catch (x) {} }, 2500); } catch (x) {}
  },
  toggle() { this.on = !this.on; try { localStorage.setItem('bgm', this.on ? '1' : '0'); } catch (x) {} if (this.on) { SFX.unlock().then(() => this.start(SFX.mode)); } else this.stop(); }
};
BGM.TR.lounge.CH = BGM.CH; BGM.TR.beat.CH = BGM.CH; BGM.load();
A.bgmToggle = () => { BGM.toggle(); if (document.getElementById('bgmSheet')) A.bgmSheet(); if (TB.v) tableRender(); else if (S.me) renderHome(); };
/* ---------- BGMの選択画面(ロビーと卓を別々に選べる。選ぶとすぐ鳴る) ---------- */
A.bgmSheet = () => {
  let o = document.getElementById('bgmSheet'); if (o) o.remove();
  const row = (mode, id) => { const k = BGM.TR[id], on = BGM.sel(mode) === id;
    return `<button class="act" data-a="bgmPick" data-v="${mode}:${id}" style="width:100%;text-align:left;font:inherit;background:${on ? '#1d3a2e' : '#16212f'};border:1px solid ${on ? '#3f9f78' : '#243449'};border-radius:10px;padding:10px 12px;margin-bottom:6px;color:#e8eef5;display:flex;justify-content:space-between;align-items:center;cursor:pointer"><span><b>${on ? '● ' : '○ '}${k.name}</b><small style="display:block;color:#8FA6BE;margin-top:2px">${k.desc}</small></span><i style="font-style:normal">${on ? '選択中' : '▶ 試聴'}</i></button>`; };
  const sec = (mode, t) => `<div style="font-size:12px;font-weight:600;letter-spacing:.14em;color:#8FA6BE;margin:14px 0 6px">${t}</div>${Object.keys(BGM.TR).map(id => row(mode, id)).join('')}`;
  o = document.createElement('div'); o.id = 'bgmSheet';
  o.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.6);display:flex;align-items:flex-end;justify-content:center';
  o.innerHTML = `<div style="background:#101a26;color:#e8eef5;width:100%;max-width:520px;max-height:82vh;overflow:auto;border-radius:18px 18px 0 0;padding:16px 16px calc(20px + env(safe-area-inset-bottom,0px))">
    <div style="display:flex;justify-content:space-between;align-items:center"><b style="font-size:17px">BGM 曲の選択</b><button class="btn sm" data-a="bgmClose">閉じる</button></div>
    <div style="font-size:12px;color:#8FA6BE;margin-top:4px">音楽は端末の中で作って鳴らしています。選んだ曲はこの端末に保存されます。${BGM.on ? '' : '<br><b>いまBGMはオフです(メニューの BGM でオンにできます)</b>'}</div>
    ${sec('lobby', 'HOME トップ画面の曲')}${sec('table', 'TABLE 卓の曲')}
    <button class="btn" data-a="bgmToggle" style="width:100%;margin-top:14px">${BGM.on ? 'BGMをオフにする' : 'BGMをオンにする'}</button></div>`;
  document.body.appendChild(o);
};
A.bgmPick = v => { const [m, id] = String(v).split(':'); BGM.choose(m, id); A.bgmSheet(); };
A.bgmClose = () => { const o = document.getElementById('bgmSheet'); if (o) o.remove(); };

SFX.load();
A.sfxToggle = () => { SFX.toggle(); if (TB.v) tableRender(); else if (S.me) renderHome(); };
// 端末の決まりで、最初のタップがあるまで音は出せない。最初のタップで鳴らせるようにして、いまの場面の環境音を始める
['click', 'touchend', 'pointerup', 'keydown'].forEach(ev => document.addEventListener(ev, () => { if (SFX.on && !(SFX.ctx && SFX.ctx.state === 'running' && SFX.amb && (!BGM.on || BGM.cur))) SFX.unlock(); }, { passive: true, capture: true }));
