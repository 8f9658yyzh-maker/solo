# SOLO 公開の手順書

上から順番に進めます。【あなた】はかいとさん本人の操作(ログイン・支払い・本人確認)、【Claude】は Claude がやる作業です。
カード番号・パスワード・鍵(sk_… whsec_… など)は、チャットに貼らないでください。

---

## 0. 手元で遊んでみる(お金はかかりません)

```bash
npm run dev
```

ブラウザで `http://127.0.0.1:8099` を開きます。テスト用の人が入っています(パスワードはすべて `password-1`)。

| ユーザー名 | 立場 |
|---|---|
| kaito | 作成者 |
| touhatsu | 統括責任者 |
| kanri | ゲーム管理責任者 |
| aj_one | AJ |
| yui_p / ken_p / mina_p / riku_p | プレイヤー |

2つのブラウザ(または1つは「シークレットウィンドウ」)で別々の人にログインし、同じ卓に座ると対戦できます。
データは保存されません(止めると消えます)。

試験: `npm test`(全部) / `node e2e_web.js`(ブラウザの通し確認。先に `npm run dev` を動かしておく)

---

## 1. サーバーを借りて置く(Fly.io)

1. 【あなた】Fly.io にログイン(アカウントは確認済み)。支払い用のカードが登録されているか、画面の「Billing」で確かめる
2. 【Claude】次のコマンドで置く(初回だけ)

```bash
fly launch --no-deploy --copy-config --name solo-club --region nrt
```

```bash
fly volumes create solo_data --region nrt --size 3
```

3. 秘密の値を入れる(画面に残らない入れ方。値は【あなた】が入れる)

```bash
fly secrets set CREATOR_USER=かいとさんのユーザー名 CREATOR_PASS=8文字以上 CREATOR_PHONE=電話番号
```

```bash
fly secrets set LEGAL_OPERATOR="運営者の名前" LEGAL_CONTACT="問い合わせのメールアドレス"
```

4. 【Claude】置く

```bash
fly deploy
```

5. 【Claude】動いているか確かめる: `https://solo-club.fly.dev/api/health` が `"level":"ok"` を返すこと

大事なこと:
- 機械(マシン)は **必ず1台** にする。`fly scale count 2` はしない(データが2つに分かれて壊れます)
- データは `/data/solo.db`、1時間ごとの控えは `/data/backups`。同じディスクなので、Fly.io の毎日の自動スナップショットも有効にしておく(健康診断は「注意: 控えが同じディスク」と出ますが、想定どおりです)

## 2. 住所(ドメイン)をつなぐ

1. 【あなた】`solo-club.jp` を買う(お名前.comなど。2年目からの更新料を確かめてから)
2. 【Claude】`fly certs add solo-club.jp` を実行し、表示された DNS の値(A と AAAA)を案内する
3. 【あなた】ドメインの販売会社の画面で、その値を入れる
4. 【Claude】`https://solo-club.jp` で開けることを確かめる

## 3. 困ったときにスマホを鳴らす(緊急の知らせ)

本番のサーバーが1分ごとに健康診断を見て、警報が出たらスマホに音つきの知らせを送ります。どちらかを選びます(両方でも可)。

- **ntfy(無料)**: 【あなた】App Store で「ntfy」を入れ、決めた名前(長く分かりにくいもの)を購読する。ntfy.sh で無料のアカウントを作り、合鍵(アクセストークン)を作るのを勧めます(無料の回数制限が、ネットの住所ごとではなくアカウントごとになるため)
- **Pushover(30日無料・その後 買い切り)**: 【あなた】アプリを入れて登録し、「User Key」と、アプリを1つ作って「API Token」を控える。緊急の知らせは、押して確かめるまで30秒ごとに鳴り続けます

【あなた】GitHub → solo → Settings → Secrets and variables → Actions → New repository secret に入れる(チャットには貼らない)
- ntfy: `NTFY_TOPIC`(購読した名前)、`NTFY_TOKEN`(合鍵。あれば)
- Pushover: `PUSHOVER_TOKEN`、`PUSHOVER_USER`

【Claude】本番へ置き直す(置く作業が金庫の値を本番に入れる)。そのあと試しの知らせを送る

鳴る場面: チップの合計のずれ・サーバーエラーの連続・卓のエラー停止・固まった卓・想定外のエラー・バックアップの失敗・ディスクの空き・支払い(Stripe)の知らせの失敗 / 遊んでいる途中で本番が止まって再起動した / 遊んでいる卓があるのに本番を止めた / 本番へ置く作業の失敗・止めた。同じ警報は6時間ごとに念押し、消えたら「戻りました」(ふつうの音)。
サーバーが丸ごと止まっている間は鳴らせません(Fly.io が自動で立ち上げ直し、立ち上がったときに鳴ります)。外から見張る仕組み(monitor/)は、必要になったら足します。

### 本番へ置くときの決まり(仕組みで守っている)
- 遊んでいる卓があると、置く作業は止まって失敗する。管理画面の「予告を出す」→ システム更新中になってから、Actions の「Run workflow」で置く(急ぐときは force に印)
- 止める合図を受けたサーバーは、今のゲームの後に卓を閉じ、チップをポケットへ戻してから終わる(最大120秒)

## 4. 10人で試験運用(広告も課金もなし)

1. 【あなた】作成者でログイン → 管理 → 招待コードを作り、AJ・プレイヤーを招く
2. 規約・プライバシーポリシーは `/legal/terms` `/legal/privacy`。登録画面で同意を必須にしてあり、同意した版を記録します
3. 【Claude】毎日: 健康診断・チップの合計(5億)・サーバー代を見る

## 5. 広告を始める

### 5-1. 地元スポンサー(審査なし・すぐできる)
1. 管理 → 「システム更新中にする」→ 設定の「広告」を 1 → 保存 → 再開
2. 管理 → SPONSORS → 「広告を追加する」(名前・文・リンク・画像・期間)
3. 表示回数とクリック数は日ごとに出ます(請求の資料)。募集ページは `/legal/sponsor`

### 5-2. Google AdSense(審査あり)
1. 【あなた】AdSense に申し込む(サイトは `https://solo-club.jp`)。審査用にクローラーのログイン(AdSense の「クローラーのアクセス」)を設定する。招待制でログインしないと中が見えないため
2. 【Claude】`/ads.txt` は ADSENSE_CLIENT を入れると自動で出ます
3. 承認されたら【あなた】広告ユニットを1つ作り、番号を入れる

```bash
fly secrets set ADSENSE_CLIENT=ca-pub-xxxxxxxxxxxxxxxx ADSENSE_SLOT=1234567890
```

4. 管理 → 設定の「広告会社(Google AdSense)の広告」を 1
5. 全画面のゲーム広告(H5 Games Ads)は別の申し込み。承認後に `fly secrets set ADSENSE_H5=1`

決まり(コードで守っています): ゲーム中の卓には出さない / 全画面は卓を出るときだけ・設定の間隔をあける / 有料プランと作成者・統括には出さない / 広告の見返りにチップは出さない

## 6. 課金を始める(試験運用のあとで決めてから)

1. 【あなた】`/legal/tokushoho` の【未記入】を埋める値を入れる

```bash
fly secrets set SELLER_NAME="販売業者" SELLER_HEAD="運営統括責任者" SELLER_ADDRESS="住所" SELLER_PHONE="電話番号" SELLER_EMAIL="メール"
```

2. 【あなた】Stripe をテスト環境で開き、秘密の鍵(sk_test_…)をコピー
3. 【Claude】Stripe の Webhook(知らせの送り先)を作る: URL は `https://solo-club.jp/api/stripe/webhook`、知らせの種類は次の7つ
   - `checkout.session.completed` / `checkout.session.async_payment_succeeded`
   - `customer.subscription.created` / `customer.subscription.updated` / `customer.subscription.deleted`
   - `invoice.payment_failed` / `charge.refunded`
4. 【あなた】鍵を入れる

```bash
fly secrets set STRIPE_SECRET_KEY=sk_test_xxx STRIPE_WEBHOOK_SECRET=whsec_xxx
```

5. 管理 → 設定の「有料プランの申し込み」を 1(値段もここで変えられます)
6. 【Claude】テスト用カード `4242 4242 4242 4242` で、プラン・テーマの購入・解約・返金を通す
7. 【あなた】Stripe を本番に切り替え、本番の鍵に入れ替え、自分のカードで1回申し込んで解約する

## 7. 本番のデータを変える前に(毎回)

- 管理画面の「予告を出す」→ 時間になると自動で「システム更新中」
- 変える直前に控えを1つ取る: `fly ssh console -C "ls -la /data/backups"` で最新の控えを確かめる
