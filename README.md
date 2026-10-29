# ソロ プラットフォーム

外部の部品なし(Node 22 のみ)。データは SQLite 1ファイル。

## 動かす
```
CREATOR_USER=あなたのユーザー名 CREATOR_PASS=8文字以上のパスワード CREATOR_PHONE=09012345678 node server/index.js
# → http://localhost:8080  (最初の1回だけ作成者を作り、5億ptを発行します)
```
- データ: `data/solo.db`(環境変数 DB_FILE で変更)。**このファイルを定期的にバックアップしてください。**
- `TRUST_PROXY=1`: HTTPSの中継(Fly.io / Render など)の後ろで動かすとき、利用者のIPを正しく読む。
- `CHAT=0`: 卓のメッセージ機能を全体で止める。

## 手元で遊ぶ
`npm run dev` → http://127.0.0.1:8099 (テスト用の人と卓が入っています。パスワードは password-1)。公開の手順は **DEPLOY.md**。

## お金と広告の仕組み(チップは売らない・換金しない)
- 有料プラン(月額): 広告なし・詳しい戦績・卓のテーマ全部(`server/billing.js` `server/perks.js` `server/stats.js`)
- 単品(買い切り): 卓のテーマ1つずつ。値段は設定画面で変更
- 広告: 地元スポンサー(管理画面で登録・表示とクリックを日ごとに集計)と Google AdSense(`server/ads.js` `web/ads.js`)
- 規約・プライバシー・外部送信・特商法・広告主募集のページ: `/legal/〇〇`(`web/legal/`。未記入は【未記入】と表示)
- チップの申請: AJ・管理責任者 → 自分を招待した人(`server/chipreq.js`)
- 止まったときの LINE の知らせ: `monitor/`(Cloudflare Workers)

## 試験
```
npm test        # 全部(ブラウザの通し確認は node e2e_web.js)
```
## 動作確認用(テスト用アカウント入り)
`node server/dev_seed.js`(ポート8099。ユーザー kaito / aj_one / yui_p など、パスワードは password-1)

## 公開前に必ず
1. 弁護士の確認(設計書の第9章)。それまでは実際の利用者に公開しない。
2. HTTPS で公開(Node はそのまま公開せず、HTTPS の中継の後ろに置く)。
3. 電話番号のSMS確認(未実装)。年齢確認の方法(未決)。招待制の試験運用では、なしで進める決定(10/15)。
4. SQLite を置く場所は、再起動しても消えないディスク(永続ボリューム)にする。

## 体験版(ブラウザの中だけで動く版)
- 作り方: `npm pack @sqlite.org/sqlite-wasm@3.53.4-build2` を展開し、`SQLITE_WASM=…/dist/sqlite3.wasm SQLITE_MJS=…/dist/index.mjs node demo/build.js`
- 中身: 本物のサーバーのプログラム(core / ledger / tables / index)をそのまま、ブラウザの中で動かします。通信のにせもの(fetch・EventSource)と、ボット、立場の切り替えだけが体験版専用です。
- 出力: `demo/solo-demo.html`(手元の確認用)、`demo/solo-demo.fragment.html`(アーティファクトに公開する用)
- 注意: 体験版では暗号の一部(パスワードの保存)を簡易版に置き換えています。本番は scrypt です。
