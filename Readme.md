# osc-lrc-viewer

[rkbx-link](https://github.com/grufkork/rkbx_link)からOSCにて情報を受信し、ブラウザで歌詞をリアルタイム表示します。
OBSや他の配信ソフトと連携して、歌詞を表示することができます。

## 特徴

- OSC経由で楽曲情報・再生位置を受信
- LRC歌詞を[lrclib](https://lrclib.net/)より自動取得・キャッシュ
- 歌詞をWebSocketでフロントエンドに配信
- 歌詞のリアルタイム表示

## セットアップ

1. リポジトリをクローン
2. 依存パッケージをインストール

```
npm install
```

3. サーバー起動

```
npm run start-server
```

4. フロントエンド開発サーバー起動

```
npm run dev
```

## ビルド

```
npm run build
```



## 使用技術

- TypeScript / JavaScript
- React
- Vite
- node-osc
- ws (WebSocket)
- lrclib-api
