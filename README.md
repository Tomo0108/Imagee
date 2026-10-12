# Imagee

Imagee は、端末の中だけで完結する画像エディタです。Web（PWA）、macOS、Windows で利用できます。アカウントやクラウドへのアップロードは必要ありません。

Videe / Melodee と同じ技術構成（React + TypeScript + Vite、Electron、PWA）で、画面デザインは Cleanee の Liquid Glass を土台にしています。

## 現在できること

- ライブラリ: 画像の追加（ボタン・ドラッグ＆ドロップ・貼り付け・OS の「このアプリで開く」）、検索、並べ替え、グリッド/リスト表示、お気に入り、名前の変更、削除
- エディタ: ズーム（ホイール、ピンチ、ショートカット）、手のひらツール、ピクセルグリッド、レイヤーの描画モード・不透明度・表示切替、回数無制限の履歴、ヒストグラムと画像情報
- 調整（非破壊・GPU でリアルタイム）: 露光量、コントラスト、ハイライト、シャドウ、白レベル、黒レベル、色温度、色かぶり補正、自然な彩度、彩度、周辺光量、自動補正、補正前との比較（`\` キー）
- 切り抜きと回転: 比率プリセット（1:1、4:5、16:9 など）、角度補正（余白を自動で切り抜き）、90° 回転、左右・上下反転
- 自動保存: 編集内容はライブラリに保存され、開き直すと続きから編集できます
- 書き出し: PNG / JPEG / WebP / AVIF、画質とサイズの指定、実際のファイルサイズの事前表示、メタデータなし

今後の予定は [docs/roadmap.md](docs/roadmap.md) を参照してください。

## 開発

Node.js 20 以降を使用します。

```sh
npm ci
npm run dev          # http://127.0.0.1:5173
npm run desktop:dev  # Electron を開発モードで起動
```

## ビルドと配布

```sh
npm run build
npm run package:mac
npm run package:win
```

macOS と Windows の配布物は `release/` に出力されます。`v*` タグを push すると GitHub Actions がビルドしてリリースを作成します。

Vercel ではリポジトリをそのままインポートすると Web 版（PWA）が公開されます。

## テスト

```sh
npm test                       # ロジックの単体テスト
npm run build && npm run test:ui   # Chromium で画面を操作してスクリーンショットを保存
```

## アイコン

アプリアイコンは別途デザインされます。`public/icons/README.md` に配置するファイルと設定箇所をまとめています。
