'use strict';
function route() {
  clearTimers();
  const h = location.hash || '#/home';
  if (!h.startsWith('#/table/') && !h.startsWith('#/practice')) stopTable();
  if (h === '#/login') return authScreen('login');
  if (h === '#/signup') return authScreen('signup');
  if (!S.token) return go('#/login');
  if (h.startsWith('#/table/')) return loadMe().then(() => tableOnline(Number(h.split('/')[2]))).catch(x => { toast(x.message, true); S.skipResume = true; go('#/home'); });
  if (h === '#/scene') return sceneScreen();
  if (h === '#/practice') return practiceSetup();
  if (h === '#/wallet') S.tab = 'wallet';
  S.tab = S.tab === 'practice' ? 'home' : S.tab;
  renderHome();
}
window.addEventListener('hashchange', route);
try { S.token = localStorage.getItem('solo_tok'); } catch (x) {}
window.addEventListener('beforeunload', () => {});
// Stripe の支払い画面から戻ってきたとき(URLの ?plan=ok などを消してから知らせる)
{ const pq = new URLSearchParams(location.search).get('plan'); if (pq) { try { history.replaceState(null, '', '/' + location.hash); } catch (x) {} setTimeout(() => toast(pq === 'ok' ? '申し込みを受け付けました。使えるようになるまで数秒〜1分かかります' : '申し込みをやめました(お金はかかっていません)'), 600); if (pq === 'ok') { let n = 0; const iv = setInterval(async () => { n++; try { const p = await api('GET', '/api/plan'); if (p.active || n > 12) { clearInterval(iv); if (p.active && S.tab === 'wallet') renderHome(); } } catch (x) { clearInterval(iv); } }, 5000); } } }
// 単品の支払い画面から戻ってきたとき
{ const bq = new URLSearchParams(location.search).get('buy'); if (bq) { try { history.replaceState(null, '', '/' + location.hash); } catch (x) {} setTimeout(() => toast(bq === 'ok' ? '購入を受け付けました。使えるようになるまで数秒〜1分かかります' : '購入をやめました(お金はかかっていません)'), 600); if (bq === 'ok') { let n = 0; const iv = setInterval(() => { n++; if (S.tab === 'wallet' && !document.querySelector('.dlg')) renderHome(); if (n >= 6) clearInterval(iv); }, 5000); } } }
route();
