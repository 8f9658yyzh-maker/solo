'use strict';
// ブラウザでの通し確認(スマホの幅)。先に `PORT=8099 node server/dev_seed.js` を動かしておく。
// 2人が卓で実際に遊び → 戦績・テーマ・スポンサー広告・規約のページ・管理画面・チップの申請を、画面で確かめる。
// 画面の写真は SHOTS(既定 ./shots)に保存する。
const { chromium } = require('playwright');
const fs = require('fs');
const BASE = process.env.BASE || 'http://127.0.0.1:8099', SHOTS = process.env.SHOTS || 'shots';
fs.mkdirSync(SHOTS, { recursive: true });
const errors = [];
const AUTO = `(()=>{ if(window.__auto) return; window.__auto=true; setInterval(()=>{ const q=s=>document.querySelector(s), ok=b=>b&&!b.disabled;
  const bet=q('[data-a=tBetOpen]'), call=q('[data-a=tCall]'), fold=q('[data-a=tFold]'), conf=q('[data-a=tConfirm]'), dl=q('.dlg [data-d="0"]');
  if(dl){ dl.click(); return; } if(conf){ conf.click(); return; } if(ok(bet)){ bet.click(); return; } if(ok(call)){ call.click(); return; } }, 300); })();`;
const api = async (method, path, body, tok) => { const r = await fetch(BASE + path, { method, headers: { 'Content-Type': 'application/json', Authorization: tok ? 'Bearer ' + tok : '' }, body: method === 'GET' ? undefined : JSON.stringify(body || {}) }); const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(path + ' ' + r.status + ' ' + JSON.stringify(j)); return j; };
async function open(b, user) {
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push([user, 'pageerror', String(e)]));
  page.on('console', m => { if (m.type() === 'error' && !/fonts|Failed to load resource/.test(m.text())) errors.push([user, 'console', m.text()]); });
  await page.goto(BASE + '/#/login');
  await page.fill('#f_user', user); await page.fill('#f_pass', 'password-1'); await page.click('[data-a=doLogin]');
  await page.waitForSelector('.tabs', { timeout: 8000 });
  return page;
}
const step = m => console.log('  ✓ ' + m);
(async () => {
  // 準備(作成者の操作をAPIで): 広告を「出す」にし、スポンサーを1件入れる
  const kt = (await api('POST', '/api/login', { username: 'kaito', password: 'password-1', deviceId: 'e2e-kaito-device' })).token;
  await api('POST', '/api/maintenance', { on: true }, kt); await api('POST', '/api/config', { patch: { ads: 1 } }, kt); await api('POST', '/api/maintenance', { on: false }, kt);
  const png = 'data:image/png;base64,' + fs.readFileSync(__dirname + '/web/icons/icon-192.png').toString('base64');
  await api('POST', '/api/admin/sponsors', { name: '石垣そば屋', text: '島そば 大盛り無料(SOLOを見たと伝えてください)', url: 'https://example.com/', image: png, slot: 'both' }, kt);
  step('作成者: 広告を出す設定にし、地元スポンサーを1件登録');

  const b = await chromium.launch();
  const yui = await open(b, 'yui_p'), ken = await open(b, 'ken_p');
  await yui.waitForSelector('.sponsor'); await yui.screenshot({ path: SHOTS + '/1_home_sponsor.png', fullPage: true });
  step('プレイヤーのホームに、スポンサーの広告(バナー)と規約のリンクが出る');
  // 2人が同じ卓に座って遊ぶ
  for (const pg of [yui, ken]) {
    await pg.locator('[data-a=sit]').first().click();
    await pg.waitForSelector('#dlg_in'); await pg.fill('#dlg_in', '5000'); await pg.click('.dlg [data-d="0"]');
    await pg.waitForFunction(() => location.hash.startsWith('#/table/'));
    await pg.evaluate(AUTO);
  }
  const gameNo = async pg => Number((await pg.evaluate(() => (document.body.innerText.match(/GAME (\d+)/) || [])[1])) || 0);
  for (let i = 0; i < 120 && (await gameNo(yui)) < 4; i++) await yui.waitForTimeout(500);
  await yui.screenshot({ path: SHOTS + '/2_table.png' });
  const g = await gameNo(yui); if (g < 3) throw new Error('ゲームが進みません: GAME ' + g);
  step('2人が卓で遊んだ(GAME ' + g + ')');
  // 卓を見ているまま戦績を見る: ホームへ戻る(座ったまま)
  await yui.evaluate(() => { S.skipResume = true; location.hash = '#/wallet'; });
  await yui.waitForSelector('text=RECORD'); await yui.waitForTimeout(500);
  const rec = await yui.evaluate(() => document.querySelector('.kvs').innerText);
  if (!/ゲーム\s*\n?\s*[1-9]/.test(rec)) throw new Error('戦績にゲーム数が出ません: ' + rec);
  await yui.screenshot({ path: SHOTS + '/3_wallet_stats_theme.png', fullPage: true });
  step('ポケットの画面に戦績(ゲーム数・勝率・収支)、有料プラン、卓のテーマが出る');
  await yui.click('[data-a=statsDays][data-v="30"]'); await yui.waitForSelector('#toast.on');
  if (!(await yui.textContent('#toast')).includes('有料プラン')) throw new Error('無料で30日が見えてしまう');
  await yui.click('[data-a=lockedTheme][data-v=kogane]'); await yui.waitForTimeout(300);
  step('無料の人: 30日の戦績と🔒のテーマは押すと案内が出て、使えない');
  // 規約のページ
  const terms = await b.newPage(); await terms.goto(BASE + '/legal/terms'); const tt = await terms.textContent('h1'); if (tt !== '利用規約') throw new Error('規約のページ'); await terms.screenshot({ path: SHOTS + '/4_terms.png' });
  await terms.goto(BASE + '/legal/tokushoho'); if (!(await terms.textContent('body')).includes('【未記入】')) throw new Error('特商法の未記入表示'); await terms.close();
  step('利用規約・特商法のページが開き、未記入の所は【未記入】と出る');
  // 作成者の管理画面: 全テーマが使える・スポンサーの表示回数・チップの申請
  const kai = await open(b, 'kaito');
  await kai.click('[data-a=tab][data-v=admin]'); await kai.waitForSelector('text=SPONSORS');
  const sp = await kai.evaluate(() => [...document.querySelectorAll('.card')].find(c => c.innerText.includes('SPONSORS')).innerText);
  if (!/30日: 表示 [1-9]/.test(sp)) throw new Error('スポンサーの表示回数が数えられていない: ' + sp);
  await kai.screenshot({ path: SHOTS + '/5_admin_creator.png', fullPage: true });
  step('作成者の管理画面: スポンサーの表示回数・売上・チップの申請・設定が出る');
  await kai.click('[data-a=tab][data-v=wallet]'); await kai.waitForSelector('[data-a=pickTheme][data-v=kogane]'); await kai.click('[data-a=pickTheme][data-v=kogane]'); await kai.waitForSelector('text=使用中');
  const t = await kai.evaluate(() => S.me.perks.theme); if (t !== 'kogane') throw new Error('テーマが変わらない');
  await kai.evaluate(() => { location.hash = '#/practice'; }); await kai.waitForTimeout(800); await kai.screenshot({ path: SHOTS + '/6_practice_theme_kogane.png' });
  step('作成者はテーマを選べ、練習の画面にも反映される(黄金)');
  // チップの申請: AJ → 管理責任者
  const aj = await open(b, 'aj_one');
  await aj.click('[data-a=tab][data-v=admin]'); await aj.waitForSelector('#cr_n'); await aj.fill('#cr_n', '12345'); await aj.fill('#cr_note', '卓を増やすため'); await aj.click('[data-a=crAsk]'); await aj.waitForSelector('text=返事待ち');
  const man = await open(b, 'kanri');
  await man.click('[data-a=tab][data-v=admin]'); await man.waitForSelector('[data-a=crYes]'); await man.click('[data-a=crYes]'); await man.click('.dlg [data-d="0"]'); await man.waitForSelector('text=承認');
  await man.screenshot({ path: SHOTS + '/7_chip_request_manager.png', fullPage: true });
  step('チップの申請: AJ が申請 → 管理責任者が「配る」で承認');
  await b.close();
  const bad = errors.filter(x => !/googlesyndication|adsbygoogle/.test(x[2]));
  if (bad.length) { console.error('画面のエラー:', bad); process.exit(1); }
  console.log('ブラウザの通し確認: すべて合格(画面のエラー 0件)');
})().catch(e => { console.error('NG', e); process.exit(1); });
