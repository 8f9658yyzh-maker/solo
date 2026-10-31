// SOLO の見張り役(Cloudflare Workers で動かす)。5分ごとに /api/health を見て、問題があれば LINE で知らせる。
// - サーバー自身が止まると、自分では知らせを出せない。だから外(Cloudflare)に置く
// - 一瞬のつまずきで鳴らないよう、2回続けて問題があったときに知らせる。直ったら「戻りました」を1回
// - 止まったままなら6時間ごとに念押し。LINE の無料の通数(月200通)を使い切らないため、それ以外は送らない
// 必要な設定(Cloudflare の画面か wrangler で入れる):
//   HEALTH_URL   例 https://solo-club.jp/api/health
//   LINE_TOKEN   LINE公式アカウントの Messaging API のチャネルアクセストークン(秘密。wrangler secret put で入れる)
//   LINE_TO      知らせる相手のユーザーID(U から始まる)。空なら、友だち全員に送る(友だちが自分だけなら同じ)
//   KV           状態を覚えておく場所(Workers KV)
//   TEST_KEY     試しの知らせを送るときの合言葉(秘密)
const WHY = { ledger: 'チップの合計が合いません', errors500: 'サーバーのエラーが続いています', tableErrors: '卓がエラーで止まりました', stalledTables: '動かなくなった卓があります',
  uncaught: '想定外のエラーが起きました', backup: 'バックアップが取れていません', disk: 'ディスクの空きが少なくなっています', payment: '支払い(Stripe)の知らせを受け取れていません。払った人がプランを使えないおそれ' };
const H = 3600000;

export async function line(env, text, fetchFn = fetch) {
  const to = (env.LINE_TO || '').trim();
  const r = await fetchFn('https://api.line.me/v2/bot/message/' + (to ? 'push' : 'broadcast'), {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + env.LINE_TOKEN },
    body: JSON.stringify(to ? { to, messages: [{ type: 'text', text }] } : { messages: [{ type: 'text', text }] })
  });
  if (!r.ok) console.log('LINE に送れませんでした', r.status, await r.text().catch(() => ''));
  return r.ok;
}

// 1回の見回り。戻り値は今の状態(試験で使う)
export async function check(env, now = Date.now(), fetchFn = fetch) {
  let ok = false, why = '';
  try {
    const r = await fetchFn(env.HEALTH_URL, { headers: { 'User-Agent': 'solo-watch' }, signal: AbortSignal.timeout(10000) });
    const j = await r.json().catch(() => null);
    if (!r.ok) why = 'サーバーが正しく答えません(HTTP ' + r.status + ')';
    else if (!j || j.ok !== true) why = 'サーバーの答えがおかしいです';
    else if (j.level === 'alarm') why = (j.alarm || []).map(k => WHY[k] || k).join('・') || '警報が出ています';
    else ok = true;
  } catch (e) { why = e && e.name === 'TimeoutError' ? '10秒たっても答えがありません' : 'つながりません'; }
  const before = JSON.parse((await env.KV.get('state')) || '{}'), st = Object.assign({}, before);
  const fails = Number(env.FAILS) || 2;
  if (ok) {
    if (st.down) await line(env, `✅ SOLO が元に戻りました(問題が続いた時間: 約${Math.max(1, Math.round((now - st.since) / 60000))}分)`, fetchFn);
    if (st.down || st.fails) await env.KV.put('state', JSON.stringify({ down: false, fails: 0, okAt: now }));
    return { ok: true, down: false };
  }
  st.fails = (st.fails || 0) + 1; if (!st.since || !before.fails) st.since = now; st.why = why;
  if (!st.down && st.fails >= fails) { st.down = true; st.lastAlert = now; await line(env, `【緊急】⚠️ SOLO に問題があります\n${why}\n${env.HEALTH_URL}\n(直ったら、ここに知らせます)`, fetchFn); }
  else if (st.down && now - (st.lastAlert || 0) >= 6 * H) { st.lastAlert = now; await line(env, `⚠️ SOLO の問題がまだ続いています(約${Math.round((now - st.since) / H)}時間)\n${why}`, fetchFn); }
  await env.KV.put('state', JSON.stringify(st));
  return { ok: false, down: !!st.down, why };
}

export default {
  async scheduled(event, env, ctx) { ctx.waitUntil(check(env)); },
  async fetch(req, env) {
    const u = new URL(req.url);
    if (req.method === 'POST' && u.pathname === '/test') {   // 試しの知らせ: curl -X POST -H "X-Watch-Key: 合言葉" https://…/test
      if (!env.TEST_KEY || req.headers.get('X-Watch-Key') !== env.TEST_KEY) return new Response('合言葉が違います', { status: 403 });
      const sent = await line(env, '🔔 SOLO の見張り役から、試しの知らせです。これが届けば準備OKです');
      return new Response(sent ? '送りました' : '送れませんでした(LINE_TOKEN を確かめてください)', { status: sent ? 200 : 502 });
    }
    const st = JSON.parse((await env.KV.get('state')) || '{}');
    return Response.json({ watching: env.HEALTH_URL || null, down: !!st.down, fails: st.fails || 0, since: st.since || null });
  }
};
