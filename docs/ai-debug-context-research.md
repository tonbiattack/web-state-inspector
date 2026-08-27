# AI Debug Context: 収集方式と制約

## 収集方針

Debug Recordingの開始時点から、DevTools拡張が提供する`chrome.devtools.network` APIで完了済みネットワークリクエストを記録する。Networkパネルが保持するHAR形式の情報を利用し、`onRequestFinished`では完了後のRequest情報を受け取れる。[1] リクエスト本文はHARに含まれないため、取得不可を明示する。[1]

レスポンス本文は、DevToolsのRequestが提供する`getContent()`を試行し、文字列として得られた場合だけ最大100KiBで記録する。取得できない場合、空文字の場合、または最大長を超えた場合は、`responseBodyAvailable: false`または`truncated: true`、理由を結果に含める。Network APIの情報はDevToolsを開く前のリクエストを欠くことがあり、記録はStart Recording以降だけを対象にすることで、その非対称性を明示する。[1]

補助的にページ側の計測フックでFetchとXHRをラップすることは、Request開始と失敗の時系列、アプリ側のスタックを得るために有用である。しかし本実装では、情報の重複と書き換えリスクを減らすため、Network本体はChromeのDevTools Network APIを優先し、ページ計測はStorage・Error・Console Errorに限定する。Fetchはネットワーク例外でPromise rejectするが、404等のHTTPエラーでは通常rejectしないため、HTTPエラーの判断はレスポンスstatusから行う。[2]

## JavaScript Error収集

ページのメインフレームで、`error`、`unhandledrejection`、`console.error`を記録する。`unhandledrejection`は未処理のPromise rejectでグローバルに送られる。[4] 他方、クロスoriginスクリプト由来のrejectionは情報漏えい防止のため取得できない可能性がある。[4] すべて固定長リングバッファで保持し、同じmessage・source・line・columnを短い時間内に複数経路で受けた場合は重複を除く。

## SnapshotとAI Export

Snapshotは、ページ・環境、Web Storage、Cookie、IndexedDB／Cache Storageのメタデータ、明示的診断ブリッジ経由のPinia／TanStack QueryをJSON互換値へ変換して保持する。Cookieは既存のバックグラウンドAPI経由で読み取る。AI Exportは外部通信をせず、拡張内でMarkdownまたはJSONを生成してクリップボードへコピーする。

## 対象外

| 対象外 | 理由 |
|---|---|
| WebSocket、SSE、Service Worker内通信 | MVPはFetch/XHR相当のDevTools Network結果に限定する。 |
| すべてのNetwork response body | DevTools APIで取得不能な場合があり、最大100KiBへ制限する。 |
| リクエスト本文の確実な取得 | HARには含まれず、ページを侵襲せずに網羅できない。 |
| クロスorigin起因のPromise rejection | ブラウザのプライバシー制約でイベントが発火しないことがある。[4] |
| Vue／React DevTools内部状態 | 非公開APIや無差別探索に依存せず、明示的診断ブリッジだけを利用する。 |

## 参考資料

[1]: https://developer.chrome.com/docs/extensions/reference/api/devtools/network "chrome.devtools.network | Chrome for Developers"
[2]: https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API/Using_Fetch "Using the Fetch API | MDN Web Docs"
[3]: https://developer.mozilla.org/en-US/docs/Web/API/XMLHttpRequest "XMLHttpRequest | MDN Web Docs"
[4]: https://developer.mozilla.org/en-US/docs/Web/API/Window/unhandledrejection_event "Window: unhandledrejection event | MDN Web Docs"
