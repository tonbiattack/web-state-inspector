# 検証記録

## 2026-08-27: 動作確認ページ

ローカル静的サーバーで `http://localhost:4173/sample/` を開き、ブラウザで以下を確認した。

| 確認対象 | 結果 | 観測内容 |
|---|---|---|
| localStorage | 成功 | `wsi.demo.user` のJSONと文字列値を初期化。 |
| sessionStorage | 成功 | 現在タブ用のJSONと文字列値を初期化。 |
| Cookie | 成功 | `wsi_demo_cookie=inspectable` を表示。 |
| IndexedDB | 成功 | `wsi-demo-db`、`users` 2件、`settings` 1件を初期化。 |
| Cache Storage | 成功 | `wsi-demo-cache-v1`、`/api/profile`、`/assets/demo.txt` を初期化。 |
| Vue + Pinia | 成功 | `Taro — authenticated: true`、カート情報を表示。 |
| React + TanStack Query | 成功 | `Query status: success` とユーザー情報を表示。 |
| 診断ブリッジ | 成功 | `window.__WEB_STATE_INSPECTOR__` に `version`、`getPinia`、`getTanStackQuery` が存在。 |

初回表示時にはCDNモジュールの読み込み待ちがあり、再確認時にすべての状態が表示された。Vue表示はテンプレート利用からレンダー関数へ変更して修正済みである。

## 自動検証

`pnpm run verify` を実行し、型検査、拡張の`dist/`生成、次の3件の回帰検査がすべて成功した。

1. Manifest V3、DevToolsページ、サービスワーカー、配布ファイルの構成。
2. 読み取り専用のStorage / Cookie取得と、拡張コードに外部通信・Cookie書込みがないこと。
3. IndexedDB / Cache Storageの100件上限と、明示的Framework診断ブリッジのみを使用すること。
