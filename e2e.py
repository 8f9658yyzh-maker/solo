import re, sys, time
from playwright.sync_api import sync_playwright
BASE = 'http://127.0.0.1:8099'
errors = []
AUTO = """
(()=>{ if(window.__auto) return; window.__auto=true;
 setInterval(()=>{
  const q=s=>document.querySelector(s);
  const ok=b=>b&&!b.disabled;
  const bet=q('[data-a=tBetOpen]'), call=q('[data-a=tCall]'), show=q('[data-a=tShow]'), fold=q('[data-a=tFold]'), up=q('[data-a=tUpOpen]'), conf=q('[data-a=tConfirm]');
  if(conf){ conf.click(); return; }
  const r=Math.random();
  if(ok(bet)){ if(r<.1&&ok(fold)) fold.click(); else if(r<.25&&ok(show)) show.click(); else bet.click(); return; }
  if(ok(show)&&r<.3){ show.click(); return; }
  if(ok(up)&&r<.4){ up.click(); return; }
  if(ok(call)){ if(r<.2&&ok(fold)) fold.click(); else call.click(); return; }
  if(ok(fold)) fold.click();
 }, 350);
})();
"""
def login(ctx, user):
    page = ctx.new_page()
    page.on('pageerror', lambda e: errors.append((user, 'pageerror', str(e))))
    page.on('console', lambda m: errors.append((user, 'console', m.text)) if m.type == 'error' and 'fonts' not in m.text and 'Failed to load resource' not in m.text else None)
    page.goto(BASE + '/#/login')
    page.fill('#f_user', user); page.fill('#f_pass', 'password-1')
    page.click('[data-a=doLogin]')
    page.wait_for_selector('.tabs', timeout=8000)
    return page

with sync_playwright() as p:
    b = p.chromium.launch()
    players = ['yui_p', 'ken_p', 'mina_p', 'riku_p']
    ctxs = [b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True) for _ in players]
    pages = [login(c, u) for c, u in zip(ctxs, players)]
    pages[0].screenshot(path='shots2/home.png')
    print('home ok')
    for pg in pages:
        pg.wait_for_selector('[data-a=sit]')
        pg.locator('[data-a=sit]').first.click()
        pg.wait_for_selector('.dlg'); pg.fill('#dlg_in', '5000'); pg.click('.dlg [data-d="0"]')
        pg.wait_for_selector('.stage', timeout=8000)
    print('seated')
    time.sleep(1.0)
    for pg in pages: pg.evaluate(AUTO)
    # 自分の番の画面を撮る
    shot = {'bet':False,'call':False,'biki':False}
    t0 = time.time()
    # 自動操作を止めて、1人だけ手動の画面を撮る
    pages[0].evaluate("window.__auto=true; ")
    time.sleep(6)
    pages[0].screenshot(path='shots2/table_a.png')
    for i in range(1, 4): pages[i].screenshot(path=f'shots2/table_{i}.png')
    # 数ゲーム進むまで待つ
    games = 0
    for _ in range(40):
        t = pages[1].inner_text('.stage')
        m = re.search(r'GAME\s+(\d+)', t)
        games = int(m.group(1)) if m else 0
        if games >= 12: break
        time.sleep(1)
    print('games', games)
    # メニュー・公平確認
    pages[1].locator('[data-a=tMenu]').last.click()
    pages[1].screenshot(path='shots2/menu.png')
    pages[1].click('[data-v=fair]'); time.sleep(0.5)
    pages[1].screenshot(path='shots2/fair.png')
    ver = pages[1].locator('[data-a=tVerify]')
    print('verify buttons', ver.count())
    if ver.count():
        ver.first.click(); time.sleep(0.3)
        print('verify result:', 'ok' if '一致 ✓' in pages[1].inner_text('.sheet') else 'NG')
    pages[1].screenshot(path='shots2/fair_ok.png')
    pages[1].mouse.click(190, 60)
    # 練習モード
    pg = pages[2]
    pg.goto(BASE + '/#/practice'); pg.wait_for_selector('#pr_n')
    pg.screenshot(path='shots2/practice_setup.png')
    pg.select_option('#pr_up', '0'); pg.click('[data-a=prStart]'); pg.wait_for_selector('.stage')
    pg.evaluate(AUTO); time.sleep(8)
    pg.screenshot(path='shots2/practice.png')
    t = pg.inner_text('.stage'); print('practice up-off tags UP present?', 'UP' in re.sub(r'UP\s*\n?\s*アップ','',t))
    print('errors', errors[:8])
    b.close()
