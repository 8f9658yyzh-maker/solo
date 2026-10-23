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

## 試験
```
node test.js && node test_v2.js && node server/test_core.js && node server/test_tables.js && node server/test_server.js
```
## 動作確認用(テスト用アカウント入り)
`node server/dev_seed.js`(ポート8099。ユーザー kaito / aj_one / yui_p など、パスワードは password-1)

## 公開前に必ず
1. 弁護士の確認(設計書の第9章)。それまでは実際の利用者に公開しない。
2. HTTPS で公開(Node はそのまま公開せず、HTTPS の中継の後ろに置く)。
3. 電話番号のSMS確認(未実装)。年齢確認の方法(未決)。
4. SQLite を置く場所は、再起動しても消えないディスク(永続ボリューム)にする。

## 体験版(ブラウザの中だけで動く版)
- 作り方: `node demo/build.js`(SQLite の wasm を /tmp/swx/sqlite-wasm/src/bin に置いた状態で。環境変数 SQLITE_WASM / SQLITE_MJS で場所を変えられます)
- 中身: 本物のサーバーのプログラム(core / ledger / tables / index)をそのまま、ブラウザの中で動かします。通信のにせもの(fetch・EventSource)と、ボット、立場の切り替えだけが体験版専用です。
- 出力: `demo/solo-demo.html`(手元の確認用)、`demo/solo-demo.fragment.html`(アーティファクトに公開する用)
- 注意: 体験版では暗号の一部(パスワードの保存)を簡易版に置き換えています。本番は scrypt です。
