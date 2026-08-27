# 実装可否の調査記録

## 結論

`localStorage`、`sessionStorage`、`IndexedDB`、`Cache Storage` は、検査対象ページのメインフレームで読み取り専用の式を評価することで取得する。Chrome の `chrome.devtools.inspectedWindow.eval()` は検査対象ページの JavaScript 状態へアクセスでき、返値は JSON 準拠のデータに限られるため、パネル側では取得値をプレーンな JSON へ正規化して扱う。[1]

Cookie はバックグラウンドの `chrome.cookies.getAll()` を使用する。この API は `cookies` 権限と、対象ホストへのホスト権限を必要とする。[2] そのため、拡張には `cookies` と全ホストへの読み取り用 `host_permissions` を宣言する。拡張はデバッグ対象のユーザーが開いたページについてのみ Cookie を要求し、書き込み API と外部通信は実装しない。

## Pinia と TanStack Query

Pinia は Vue DevTools に統合されており、Vue DevTools では Pinia タブで store と状態を表示できる。[3] しかし、この統合は Vue DevTools の内部プロトコルであり、第三者の DevTools 拡張が汎用的・安定的に store を取得する公開 API ではない。Pinia の状態はアプリケーション内部の Pinia インスタンスにあり、production build でグローバルに公開される保証もない。[4]

TanStack Query についても公式 Devtools は `QueryClientProvider` 内へ React コンポーネントとして配置する方式であり、production では通常の Devtools がバンドルから除外される。公式サイトは第三者ブラウザ拡張の存在を案内しているが、すべてのアプリで任意の QueryClient を列挙する汎用公開 API は提示していない。[5]

よって、本実装では JavaScript オブジェクトの総当たりや Vue/TanStack DevTools 内部プロトコルへの依存を行わない。Framework State は **明示的な任意接続** として `window.__WEB_STATE_INSPECTOR__` の読み取り専用ブリッジのみを確認する。存在しない場合は `Not detected` を表示する。サンプルでは Pinia と TanStack Query の状態を、このブリッジに明示的にシリアライズして登録する。これは対象アプリの開発者が意図して公開した場合に限った取得であり、production build での利用可否もアプリ側のブリッジ設定に依存する。

| 対象 | 取得方式 | 実装判断 |
|---|---|---|
| localStorage / sessionStorage | 検査ページの文脈で列挙 | 実装する |
| Cookie | `chrome.cookies` + ホスト権限 | 実装する |
| IndexedDB | 検査ページの `indexedDB.databases()` と読み取りトランザクション | 実装する |
| Cache Storage | 検査ページの `caches` API | 実装する |
| Pinia | 明示的な任意ブリッジのみ | Experimental |
| TanStack Query | 明示的な任意ブリッジのみ | Experimental |

## 参考文献

[1]: https://developer.chrome.com/docs/extensions/reference/api/devtools/inspectedWindow "chrome.devtools.inspectedWindow | Chrome for Developers"
[2]: https://developer.chrome.com/docs/extensions/reference/api/cookies "chrome.cookies | Chrome for Developers"
[3]: https://devtools.vuejs.org/getting-started/features "Features | Vue DevTools"
[4]: https://pinia.vuejs.org/core-concepts/plugins.html "Plugins | Pinia"
[5]: https://tanstack.com/query/latest/docs/framework/react/devtools "Devtools | TanStack Query"
