# PROGRESS

公開先: https://structure-jenga.morilab-garage.com/ （更新: 2026-10-11）

## 済んだこと

- 限界モード（制限時間・揺れの増加・上限なしの得点・崩壊時 30% 減点・操作列からの再現）
- オンラインランキング（Cloudflare Workers + D1、ニックネームのみ、GitHub Actions の再現で検証、今日／歴代）
- サブドメインへの移行と HTTPS 強制、壊れた関連リンクの削除、非公開の脆弱性報告の有効化
- 検索まわり（説明文・OGP・twitter カード・h1・JSON-LD の作者／発行者など）
- CSP（自サイトとランキング Worker のみ。`tests/unit/test-csp.mjs` で照合）
- OGP 画像に「限界モード」「日替わりランキング」を追加（`npm run generate:ogp`）

## これからやれること

### 先生の手作業が要るもの

- [ ] Google Search Console に登録し、`sitemap.xml` を送信する
- [ ] `morilab-garage.com`（mori-portfolio）のトップからリンクを張る
- [ ] iOS Safari の実機確認（タップ判定、音の開始、限界モードのタイマー、崩壊演出）
- [ ] 限界モードを実際に遊んで、制限時間・揺れ・減点の手応えを調整する

### 機能

- [ ] ともだちモード（1 台を交代で回し、崩した人が負け）
- [ ] 結果画面からスコア付きで共有する（「今日の○○で 1234 点」）

### ランキングの運用

- [ ] ニックネームの禁止語フィルタ（今は README の削除コマンドで手動対応）
- [ ] 一覧の GET を Worker 側でキャッシュし、D1 の読み取りを減らす（利用者が増えたとき）
- [ ] 古い `pending`／`rejected` 行を定期的に消す

### 公開・流入

- [ ] itch.io でも公開する
- [ ] 大きな更新のときに JSON-LD の `dateModified` を書き換える

### 気になっている小さなこと

- [ ] iOS 15 以前の Safari は `'wasm-unsafe-eval'` 非対応で、崩壊演出が動かない可能性がある（少数のため保留）
