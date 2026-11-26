# 台湾おすすめマップ

スマホ向け・閲覧専用の静的サイト（HTML/CSS/JS のみ。ビルド・バックエンド不要）。

## 起動

```
cd /Users/muimui/pmhub-work/taiwan-app
python3 -m http.server 4173 --bind 127.0.0.1
```

ブラウザで http://127.0.0.1:4173/ を開く。`file://` では fetch が動かないので必ずサーバー経由。

## 構成

- `index.html` 画面の骨組み（Leaflet は unpkg の CDN）
- `style.css` パステル調のスタイル（スマホ縦画面優先）
- `app.js` 読込・絞り込み・一覧・地図・下から出るカード
- `data/places.json` 本番データ（別担当が作成）。無ければ `data/places.sample.json`（動作確認用10件）を読む
- 地図タイル: OpenStreetMap 標準タイル（API キー不要）。重なるピンは Leaflet.markercluster でまとめる

## データ形式

`[{id,name,name_zh,category,area,lat,lng,stars,stars_provisional,memo,gmaps_url,visited}]`
- カテゴリの絵文字: ごはん🍜 / 小籠包🥟 / タピオカ・ドリンク🧋 / 観光🏯 / カフェ☕ / 夜市🏮 / その他📍
- ピンは★が高いほど大きく、色が変わる。仮の★は点線の縁＋「仮」タグ
- `gmaps_url` が無ければ緯度経度から Google Maps リンクを作る

## 機能

一覧（★の高い順）／カテゴリ・エリア・★下限で絞り込み／地図⇄一覧切替／ピンをタップで下からカード／台湾・台北・九份へ寄るボタン／空・読込失敗の表示
