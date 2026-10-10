# LESS, STILL. — 構造分解

部材を叩いて音を聴き、一本ずつ抜いて構造を残す3Dパズルです。

[ゲームを開く](https://m-masaki72.github.io/structure-jenga/)

## 遊び方

- 部材をクリック・タップして選び、音を聴く。「抜く」で取り外す。
- 作品名か「アーキテクチャを選ぶ」から構造を変更する。
- 矢印キーで部材を選択、Spaceで聴く、Xで抜く。
- ドラッグで回転、スクロールで拡大。設定で音量と文字のヒントを変更する。

選んだ構造・音の設定・スコアはこのブラウザに保存します。音は最初の操作から再生します。設定でOFFにできます。
画面下のX・LINE・URLコピーから共有できます。「保存データを消す」はこのゲームの記録だけを消します。

## 起動と検証

Node.js 24以上を使います。

```sh
npm ci
npm start
```

[ローカルで開く](http://127.0.0.1:8770/)。終了はCtrl+C。

```sh
npm run verify
npx playwright install chromium
npm run test:e2e
```

単体テストでゲームの計算・保存を、E2Eで実際の操作・再開・スマホ表示・起動失敗を確認します。
E2EはChromiumのソフトウェア描画を使います。Safariと実機の音声・操作は別途確認が必要です。

## 公開

GitHub PagesのSourceを **GitHub Actions** にします。`main`へのpushでテストが成功すると公開します。
公開するのは`dist/`とライセンスだけです。外部API・APIキー・専用サーバーは不要です。
favicon・OGP・JSON-LD・サイトマップ・404ページを同梱しています。
公開先を変える場合は`dist/index.html`の公開URL・共有リンクと`dist/sitemap.xml`・`robots.txt`・`404.html`を更新してください。

## コード

- `dist/js/`：ゲーム・描画・音・保存。入口は`game-bootstrap.js`。
- `dist/styles/`：ゲーム画面と共有部分のCSS。
- `dist/vendor/`：公開に必要なライブラリとライセンス。
- `tests/unit/`：単体テスト。`tests/e2e/`：実ブラウザのテスト。
- `tools/`：構文確認とアイコン生成。

ゲーム向けの構造・崩壊の近似です。実際の建物の安全性を判定するものではありません。

## ライセンス

自作コードは[MIT](LICENSE)。同梱の[Three.js](dist/vendor/THREE-LICENSE.txt)はMIT、[Rapier](dist/vendor/RAPIER-LICENSE.txt)はApache-2.0です。

## 別のPCで続ける

このリポジトリをcloneして、`npm ci`、`npx playwright install chromium`、`npm start`を実行します。
Node.js 24以上が必要です。GitHub Pagesの公開にはSourceをGitHub Actionsに設定してください。
初回の公開が失敗した場合は、設定後にActionsのCheckを再実行します。

複数の3DゲームのE2Eは同時に実行せず、ゲームごとに順番に実行してください。
ソフトウェア描画で複数の大きな3D画面を動かすと、GPU競合で検証が遅れることがあります。
