import random, re, sys
from playwright.sync_api import sync_playwright

errors = []
seen = set()
def run(seats, tag, games):
    with sync_playwright() as p:
        b = p.chromium.launch()
        ctx = b.new_context(viewport={'width': 400, 'height': 860}, device_scale_factor=2, is_mobile=True, has_touch=True)
        ctx.add_init_script("(()=>{const st=window.setTimeout;window.setTimeout=(f,ms,...a)=>st(f,Math.min(ms||0,25),...a);})()")
        page = ctx.new_page()
        page.on('pageerror', lambda e: errors.append(('pageerror', str(e))))
        page.on('console', lambda m: errors.append(('console', m.text)) if m.type == 'error' and 'fonts' not in m.text and 'Failed to load resource' not in m.text else None)
        page.goto('file:///home/claude/solo/dist/test.html')
        page.wait_for_selector('#lobbyFields select')
        if tag == 'a':
            page.screenshot(path='shots/lobby.png', full_page=True)
        page.select_option('#f-seats', str(seats))
        page.click('[data-act=start]')
        done_games = 0
        for i in range(4000):
            page.wait_for_timeout(15)
            if page.locator('#result [data-act=next]').count():
                h2 = page.locator('#result h2').first.inner_text()
                kind = 'fold' if '全員が降りた' in page.locator('#result').inner_text() else ('nagashi' if h2.startswith('流し') else 'show')
                key = f'{tag}_{kind}'
                if key not in seen:
                    seen.add(key)
                    page.screenshot(path=f'shots/res_{key}.png', full_page=True)
                done_games += 1
                if done_games >= games:
                    break
                page.click('#result [data-act=next]')
                continue
            for sel in ['[data-act=bet]', '[data-act=bfollow]', '[data-act=follow]']:
                loc = page.locator('#actions ' + sel)
                if loc.count():
                    if tag == 'a' and sel == '[data-act=bet]' and 'turn' not in seen:
                        seen.add('turn'); page.screenshot(path='shots/turn_oya.png')
                    if sel == '[data-act=bfollow]' and random.random() < .6:
                        c = page.locator('#actions [data-act=amt][data-d=max]')
                        if c.count(): c.click()
                        if 'biki' not in seen: seen.add('biki'); page.screenshot(path='shots/turn_biki.png')
                    if sel == '[data-act=bet]' and random.random() < .5:
                        c = page.locator('#actions [data-act=amt][data-d=max]')
                        if c.count(): c.click()
                    if random.random() < .18 and page.locator('#actions [data-act=fold]').count():
                        page.click('#actions [data-act=fold]')
                    else:
                        loc.first.click()
                    break
            else:
                if page.locator('#actions [data-act=show]').count() and random.random() < .5:
                    page.click('#actions [data-act=show]')
                elif page.locator('#actions [data-act=fold]').count():
                    page.click('#actions [data-act=fold]')
        w = page.evaluate('[document.documentElement.scrollWidth, window.innerWidth]')
        print(f'{seats}人: 完了 {done_games}ゲーム, 横幅 scrollWidth={w[0]} / innerWidth={w[1]}', 'はみ出しなし' if w[0] <= w[1] else '横にはみ出し!')
        if tag == 'a':
            # 設定変更、公平性テスト、卓を離れる
            page.click('summary:has-text("卓の設定を変える")'); page.fill('#n-limit', '7'); page.click('[data-act=apply]')
            print('設定変更メッセージ:', page.locator('#applyMsg').inner_text())
            page.click('summary:has-text("公平性のしくみ")'); page.click('[data-act=fair-test]')
            page.wait_for_selector('#fairOut table', timeout=10000)
            print('公平性テスト:', page.locator('#fairOut p.ok, #fairOut p.ng').first.inner_text())
            page.locator('#fairBox').scroll_into_view_if_needed(); page.screenshot(path='shots/fair.png', full_page=False)
            
            if page.locator('#result [data-act=verify]').count():
                page.click('#result summary:has-text("山札を答え合わせする")')
                page.locator('#result [data-act=verify]').first.click()
                print('答え合わせ(勝負のゲーム):', page.locator('#result [id^=vr-] p').first.inner_text())
                page.locator('#result .doc').first.scroll_into_view_if_needed(); page.screenshot(path='shots/verify.png')
            page.click('#result [data-act=leave]')
            page.wait_for_selector('#end table')
            print('終了画面の照合:', page.locator('#end td.ok').count(), '件一致 /', page.locator('#end td.ng').count(), '件不一致')
            page.screenshot(path='shots/end.png', full_page=True)
        b.close()

run(4, 'a', 12)
run(10, 'b', 6)
print('エラー数:', len(errors))
for e in errors[:10]: print(e)
print('撮影:', sorted(seen))
