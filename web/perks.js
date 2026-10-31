'use strict';
/* ソロ 特典の画面: 戦績・卓のテーマ・購入前の確認・利用規約への同意。
   有料で変わるのは遊びの外側だけ(チップ・勝ちやすさ・ゲーム中の情報には関係しない)。使えるかどうかはサーバーが決める。 */

/* ---------- 利用規約への同意(新しい版が出たとき) ---------- */
function termsGate() {
  return new Promise(resolve => {
    const ov = document.createElement('div'); ov.className = 'dlg';
    ov.innerHTML = `<div class="dlg-box" role="dialog" aria-modal="true"><div class="dlg-msg"><b>利用規約が新しくなりました</b><br>続けるには、内容を確かめて同意してください。</div>
      <p style="margin:0 0 12px"><a href="/legal/terms" target="_blank" rel="noopener" style="color:#C9A24B">利用規約</a> ・ <a href="/legal/privacy" target="_blank" rel="noopener" style="color:#C9A24B">プライバシーポリシー</a></p>
      <div class="row dlg-btns"><button class="btn" data-t="out">ログアウト</button><button class="btn gold" data-t="ok">同意する</button></div></div>`;
    ov.addEventListener('click', async ev => {
      const b = ev.target.closest('[data-t]'); if (!b) return;
      if (b.dataset.t === 'out') { ov.remove(); resolve(false); return A.logout(); }
      b.disabled = true;
      const r = await run(() => api('POST', '/api/terms/agree', { ver: S.me.terms.ver }), '同意しました');
      if (r) { S.me.terms.need = false; ov.remove(); resolve(true); } else b.disabled = false;
    });
    document.body.appendChild(ov);
  });
}

/* ---------- 申し込みの前の確認(特定商取引法の最終確認画面にあたる内容をここでも見せる) ---------- */
function buyConfirm(o) {
  const rows = [['商品', o.name], ['金額', o.price], ['支払い', o.when], ['使える時期', '支払いが確認でき次第すぐ(数秒〜1分)'], o.cancel ? ['解約', o.cancel] : null, ['返金', '支払い後の返金はできません(法令で認められる場合を除く)']].filter(Boolean);
  return new Promise(resolve => {
    const ov = document.createElement('div'); ov.className = 'dlg';
    ov.innerHTML = `<div class="dlg-box" role="dialog" aria-modal="true"><div class="dlg-msg"><b>申し込みの内容</b></div>
      <table class="t">${rows.map(r => `<tr><td class="mute" style="white-space:nowrap">${e(r[0])}</td><td>${e(r[1])}</td></tr>`).join('')}</table>
      <p class="mute" style="margin:8px 0">チップは増えません。次の画面(決済会社 Stripe)でカードを入れると申し込みが終わります。<a href="/legal/tokushoho" target="_blank" rel="noopener" style="color:#C9A24B">特定商取引法に基づく表記</a></p>
      <div class="row dlg-btns"><button class="btn" data-c="0">やめる</button><button class="btn gold" data-c="1">支払い画面へ進む</button></div></div>`;
    ov.addEventListener('click', ev => { const b = ev.target.closest('[data-c]'); if (!b && ev.target !== ov) return; ov.remove(); resolve(!!b && b.dataset.c === '1'); });
    document.body.appendChild(ov);
  });
}

/* ---------- 卓のテーマ ---------- */
function themeCard() {
  const p = S.me.perks; if (!p) return '';
  const pl = S.me.plan || {}, canBuy = !!(pl.plan && pl.open);
  return `<div class="card"><h3>TABLE THEME<small>卓のテーマ(見た目だけ)</small></h3>
  <div class="themes">${p.catalog.map(t => { const c = THEMES[t.id] || THEMES.classic, on = p.theme === t.id;
    return `<div class="theme${on ? ' on' : ''}"><button class="sw" data-a="${t.have ? 'pickTheme' : 'lockedTheme'}" data-v="${t.id}" aria-label="${e(t.name)}" style="background:radial-gradient(ellipse at 50% 42%,${c.felt}) padding-box,linear-gradient(135deg,${c.rail}) border-box">${t.have ? '' : '<span class="lock">🔒</span>'}</button>
      <div class="nm">${e(t.name)}${on ? ' <span class="tealc">使用中</span>' : ''}</div>
      ${!t.have && canBuy ? `<button class="btn sm gold" data-a="buyTheme" data-v="${t.item}">${fmt(p.price)}円</button>` : ''}</div>`; }).join('')}</div>
  <p class="mute" style="margin:8px 0 0">${p.plan ? '有料プランの間は、すべてのテーマを使えます。' : canBuy ? 'テーマは1つずつ買えます(買い切り)。有料プランなら全部使えます。' : '🔒のテーマは、有料プランの受け付けが始まると使えるようになります。'}</p></div>`;
}
A.pickTheme = async v => { const r = await run(() => api('POST', '/api/prefs', { theme: v }), 'テーマを変えました'); if (r) { S.me.perks.theme = r.theme; renderHome(); } };
A.lockedTheme = () => toast((S.me.plan && S.me.plan.open) ? '下の金額のボタンで買えます。有料プランなら全部使えます' : 'このテーマは、有料プランの受け付けが始まると使えます');
A.buyTheme = async (v, btn) => {
  const t = S.me.perks.catalog.find(x => x.item === v); if (!t) return;
  if (!(await buyConfirm({ name: '卓のテーマ「' + t.name + '」(買い切り)', price: fmt(S.me.perks.price) + '円(税込)', when: '申し込みの時に1回だけ' }))) return;
  if (btn) btn.disabled = true;
  const r = await run(() => api('POST', '/api/shop/buy', { item: v })); if (r && r.url) location.href = r.url; else if (btn) btn.disabled = false;
};

/* ---------- 戦績 ---------- */
const CAT_ORDER = ['ソロ', 'ジッピン', 'キュウピン', 'ゴピン', '9点', '8点', '7点', '6点', '5点', '4点', '3点', '2点', '1点', '豚（0点）', '流し（6・4）'];
async function statsCard() {
  const days = S.data.statsDays == null ? 7 : S.data.statsDays;
  let st; try { st = await api('GET', '/api/stats?days=' + days); } catch (x) { return ''; }
  const per = [[7, '7日'], [30, '30日'], [90, '90日'], [0, '全期間']];
  const sg = n => `<b class="${n > 0 ? 'tealc' : n < 0 ? 'redc' : ''}">${n > 0 ? '+' : ''}${fmt(n)}</b>`;
  const box = (k, v) => `<div class="kv"><span class="mute">${k}</span>${v}</div>`;
  let h = `<div class="card"><h3>RECORD<small>戦績(あなただけが見られます)</small></h3>
    <div class="chips">${per.map(([d, l]) => `<button class="${st.days === d ? 'on' : ''}" data-a="statsDays" data-v="${d}">${!st.full && d !== st.freeDays ? '🔒 ' : ''}${l}</button>`).join('')}</div>
    <div class="kvs">${box('ゲーム', `<b>${fmt(st.games)}</b>`)}${box('勝ち', `<b>${fmt(st.wins)}</b>`)}${box('勝率', `<b>${st.winRate}%</b>`)}${box('収支', sg(st.net))}${box('いちばん勝った', sg(st.biggestWin))}${box('いちばん負けた', sg(st.biggestLoss))}</div>`;
  if (!st.games) h += '<p class="mute">この期間のゲームはまだありません。卓で遊ぶと、ここに出ます(練習は数えません)。</p>';
  if (!st.full) return h + `<p class="mute" style="margin:10px 0 0">有料プランでは、30日・90日・全期間のほか、手役の内訳(出やすさの理論値との比べ)、勝負と降りの勝ち方、親の時の収支、日ごと・卓ごとの数字が見られます。</p></div>`;
  h += `<div class="kvs">${box('勝負まで進んだ', `<b>${fmt(st.showdowns)}</b><span class="mute"> うち勝ち ${fmt(st.showdownWins)}</span>`)}${box('相手が全員降りて勝ち', `<b>${fmt(st.foldWins)}</b>`)}${box('降りた割合', `<b>${st.foldRate}%</b>`)}${box('親の時の収支', sg(st.oyaNet) + `<span class="mute"> (${fmt(st.oyaGames)}回)</span>`)}${box('いちばん大きい場', `<b>${fmt(st.biggestPot)}</b>`)}${box('いちばん強い手', st.best ? `<b>${e(st.best.cat)}</b><span class="mute"> ${e(st.best.hand)}</span>` : '<b>-</b>')}</div>`;
  const tot = Object.values(st.hands).reduce((a, x) => a + x.games, 0);
  if (tot) h += `<h4 class="sub">手役の内訳<small>(配られた2枚。点線は理論上の出やすさ)</small></h4>` + CAT_ORDER.filter(c => st.hands[c] || st.odds[c]).map(c => { const x = st.hands[c] || { games: 0, wins: 0 }, mine = x.games / tot * 100, th = (st.odds[c] || 0) * 100;
    return `<div class="bar"><span class="lb">${e(c.replace('（6・4）', '').replace('（0点）', ''))}</span><span class="tr"><i style="width:${Math.min(100, mine * 2)}%"></i><u style="left:${Math.min(100, th * 2)}%"></u></span><span class="vl">${mine.toFixed(1)}%<span class="mute"> ${x.wins}/${x.games}勝</span></span></div>`; }).join('');
  if (st.daily.length > 1) {
    const max = Math.max(1, ...st.daily.map(d => Math.abs(d.net))), w = 320, bw = Math.max(2, Math.floor(w / st.daily.length) - 2);
    h += `<h4 class="sub">日ごとの収支</h4><svg viewBox="0 0 ${w} 80" width="100%" height="80" role="img" aria-label="日ごとの収支"><line x1="0" y1="40" x2="${w}" y2="40" stroke="#2A4262"/>${st.daily.map((d, i) => { const hh = Math.round(Math.abs(d.net) / max * 36); return `<rect x="${i * (bw + 2)}" y="${d.net >= 0 ? 40 - hh : 40}" width="${bw}" height="${Math.max(1, hh)}" fill="${d.net >= 0 ? '#3FD0B8' : '#E0352A'}"><title>${d.day} ${d.net >= 0 ? '+' : ''}${d.net}</title></rect>`; }).join('')}</svg>`;
  }
  if (st.tables.length) h += `<h4 class="sub">卓ごと</h4><table class="t"><tr><th>卓</th><th class="r">ゲーム</th><th class="r">勝ち</th><th class="r">収支</th></tr>${st.tables.map(t => `<tr><td>${e(t.name)}</td><td class="r">${fmt(t.games)}</td><td class="r">${fmt(t.wins)}</td><td class="r">${sg(t.net)}</td></tr>`).join('')}</table>`;
  return h + '</div>';
}
A.statsDays = v => {
  const st = Number(v);
  if (st !== 7 && !(S.me.perks && S.me.perks.plan)) return toast('7日より長い期間は、有料プランで見られます');
  S.data.statsDays = st; renderHome();
};
