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

## 2026-08-27: Framework State統合検証

`dist/`を展開済み拡張として検証用Chromeへ読み込み、`--auto-open-devtools-for-tabs`でサンプルページのDevToolsを開いた。Chrome DevTools Protocolで拡張の `devtools.html` 実行コンテキストに接続し、**ビルド済み** `panel/page-evaluator.js` の `PageEvaluator.getFrameworkState()` を実行した。従って、単にサンプルページのグローバル値を読む検証ではなく、拡張が利用する `chrome.devtools.inspectedWindow.eval()` の経路まで含む確認である。

| 検査ページ | 項目 | 結果 | 取得・表示対象 |
|---|---|---:|---|
| `sample/index.html` | Pinia | 成功 | `detected: true`。`userStore`（`userId: 123`、`name: Taro`、`authenticated: true`）および`cartStore`（items、coupon、itemCount）を取得。 |
| `sample/index.html` | TanStack Query | 成功 | `detected: true`。query key `["user", 123]`、`status: success`、data、updatedAtを取得。 |
| `sample/no-framework-bridge.html` | Pinia | 成功 | `detected: false`。`Pinia state is not accessible on this page.` を返却。 |
| `sample/no-framework-bridge.html` | TanStack Query | 成功 | `detected: false`。`TanStack Query state is not accessible on this page.` を返却。 |

この結果から、**明示的診断ブリッジを公開したアプリではPiniaおよびTanStack Queryの状態を取得でき、ブリッジがない通常ページでは安全に未検出扱いとなる**ことを確認した。拡張はPiniaまたはQueryClientを推測・走査しないため、任意の既存サイトに対して自動的に状態を取得する機能ではない。

## 2026-08-27: アイコン設定と自動テスト拡充

`static/icons/` にマスター画像とChrome拡張用の16、32、48、128ピクセルPNGを追加し、Manifest V3の`icons`へ登録した。128ピクセル版を目視確認し、濃紺の背景に、コード記号を含む虫眼鏡とStorageスタックが判別できることを確認した。

自動テストは既存の3件から9件へ拡充した。アイコンのManifest定義と実ファイルのPNG署名・寸法、配布物`dist/`へのコピー、要求されたパネルUI要素、サンプルの診断ブリッジ有無、`PageEvaluator`の非同期ブリッジ回収、ページ例外時のエラー処理を追加で検査する。`pnpm run verify`の最終実行では9件すべてが成功した。

## 2026-08-27: State Change Timeline統合検証

`dist/`を展開済み拡張として検証用Chromeへ読み込み、DevTools拡張の実行コンテキストで`ChangeTracker.start(50)`を実行した。次に、動作確認ページの4つの操作ボタンを通じて、`localStorage.setItem()`、同一キーの`setItem()`による更新、`localStorage.removeItem()`、`sessionStorage.clear()`を発生させた。

| 操作 | 結果 | 記録内容 |
|---|---:|---|
| `localStorage.setItem`（作成） | 成功 | key `wsi.demo.timeline`、`null` → step 1 JSON、呼び出し元 `sample/:77:22`。 |
| `localStorage.setItem`（更新） | 成功 | 同一keyのstep 1 JSON → step 2 JSON、呼び出し元 `sample/:83:22`。 |
| `localStorage.removeItem` | 成功 | step 2 JSON → `null`、呼び出し元 `sample/:87:22`。 |
| `sessionStorage.clear` | 成功 | 消去前の`wsi.demo.tab`および`wsi.demo.session`を記録し、呼び出し元 `sample/:91:24`。 |

4イベントが時刻順に取得され、いずれもStorage種別、操作、キー、変更前後、および計測フック内部ではない発生元の行番号を含んだ。`pnpm run verify`では、計測フックの変更前後、同値時の`unchanged`、`clear`の対象、外部`storage`イベント、固定長リングバッファ、Stop時のメソッド復元、UIの入口を含む12件の自動テストがすべて成功した。

## 2026-08-27: Storage一覧のAuto Refresh

Local StorageおよびSession Storageの一覧に、既定オフのAuto Refreshトグルと、`500 ms`、`1 s`、`2 s`、`5 s`の更新間隔を追加した。自動更新時は現在表示中のStorage一覧だけをバックグラウンド再取得し、取得中および別カテゴリへ移動済みの場合は重複更新しない。

State Change Timelineが記録中で、Local StorageまたはSession Storageの一覧へ移動した場合は、Auto Refreshがオフでも`700 ms`で一覧を追従させる。記録を停止すると、この暗黙の更新も停止する。

自動テストには、ユーザー指定間隔の再取得、取得中の重複防止、Storage以外を開いた後の抑止、Timeline記録中の700ms追従、タイマー再設定時の旧タイマー停止、パネル上の操作要素を追加した。`pnpm run verify`では16件のテストがすべて成功した。

実Chrome拡張のDevTools実行コンテキストでも、UIで選択できる最短の`500 ms`設定を検証した。検査対象ページの`wsi.auto-refresh.probe`を`before-500ms`としてからAuto Refreshを開始し、650ms後に`after-500ms`へ更新した。1.6秒の待機中に自動再取得が計2回発生し、`before-500ms`と`after-500ms`の両方を取得できた。したがって、更新後の値への自動追従を確認した。

## AI Debug Context 統合検証

最新版の`dist/`を読み込んだChrome DevTools拡張でDebug Recordingを開始し、動作確認ページからlocalStorageの`setItem`、Fetch 200、Fetch 500、XHR POST 201、`console.error`、未処理Promise rejectionを実行した。

実際の拡張コンテキストで取得したUnified Timelineは、`network-request` 3件、`network-response` 3件、`storage` 1件、`console-error` 1件、`promise-rejection` 1件を含んだ。Networkでは、Fetch 200のJSON response body、Fetch 500の`{"code":"INTERNAL_ERROR","message":"Intentional demo failure"}`、XHR POST 201のrequest/response bodyを取得できた。Fetch 500はNetwork Errorとしてstatus 500で記録された。

同じ実拡張コンテキストからSnapshotを収集し、ページタイトル、localStorage 3件、Cookie 1件、IndexedDB 1件、Cache Storage 1件、および明示的診断ブリッジ経由のPinia / TanStack Queryを取得できた。収集結果から生成したMarkdownにはNetwork Errors、status 500、Storage Changes、`wsi.demo.timeline`が含まれることを確認した。

`pnpm run verify`は、Network正規化・フィルタ・response body truncate・Network上限、Debug Sessionの統合Timeline・上限、Snapshot、Diff、Markdown / JSON formatter、Error収集とフック復元、既存Storage・Auto Refresh・Manifest検査を含む22テストが成功した。


## 2026-08-28: User Action / Route Change / AI Debug Context 最終検証

最終ビルド済みの`dist/`を新規プロファイルの検証用Chromeへ展開済み拡張として読み込み、DevTools実行コンテキストで`DebugSession`を開始した。サンプルページに対し、Customer IDの入力、passwordの入力、`console.warn`、**Action → State → Network → Error**を順に発生させ、十分なdebounce待機後に同じ実拡張コンテキストから記録を取得した。記録上のUTC時刻`2026-08-27T15:29:09Z`は、日本時間では2026-08-28の実行に相当する。

| 確認対象 | 結果 | 実拡張コンテキストでの観測 |
|---|---:|---|
| User Action | 成功 | `click` 2件とdebounce後の`input` 2件、合計4件を取得。対象ボタンは`button#debug-console-warn`および`[data-testid="custom-id"]`として要約された。 |
| password保護 | 成功 | `input#customer-password`の記録値は`[not captured]`であり、実際に入力した`do-not-export-this`は記録に含まれなかった。 |
| Route Change | 成功 | `pushState` 1件で、`/sample/`から`/customers/cust-final-123`への前後URLを取得。 |
| Storage Change | 成功 | `localStorage.selectedCustomerId`の`null`から`cust-final-123`への変更とページ側呼び出し元を取得。 |
| Console | 成功 | `console-warn` 1件と`console-error` 1件を別種別として取得。 |
| Network | 成功 | FetchのRequest / Responseを取得し、500、`fetch`、失敗URL、JSON response bodyを確認。 |
| Unified Timeline | 成功 | 上記を含む10イベントを取得。click → warn / action → Storage・Route・Network → Network Response 500 → console-errorの順にISO timestampで表示された。 |

Networkイベントの`performanceMs`はDevTools側の原点、User Action・Storage・Error・Route Changeの`performanceMs`はページ側の原点であり、同一値として比較できないことを実観測した。そのため、`DebugSession.getTimeline()`とAI Exportの近接判定はISO timestampを基準にする実装へ統一した。Network Request、Storage Change、Route Changeが同一ミリ秒になる場合もあり、この順序は因果関係の証明ではない。

Selected DOMはElementsパネルで明示選択した`$0`だけを取得する仕様である。CDPによる自動検証ではElementsパネルの利用者選択を再現せず、`selected-element-service.test.mjs`で`$0`限定、最小項目、`outerHTML`非使用を回帰検査した。手動確認時は、Elementsで対象ノードを選び、Web State Inspectorの**Capture Selected Element**を押す。

最終の`pnpm run verify`では、TypeScript型検査、`dist/`組み立て、Node標準テスト**27件**がすべて成功した。追加した回帰検査は、User Action・Route ChangeをDebugSessionへ統合すること、ページとDevToolsで異なる`performance.now()`値でもISO timestamp順に整列すること、AI Exportが指定順で`Current State`まで出力すること、ISO timestamp近接時だけ`possibly related`を表示することを含む。


## 2026-08-28: Auto Refresh時のJSON展開状態保持

Storage一覧はバックグラウンド更新時に内容を再描画するため、従来は`<details>`要素の開閉状態が初期化され、**JSONを表示**で展開済みの内容が閉じていた。Storage種別とキーから作る安定した展開状態キーを導入し、`toggle`イベントで保存した開閉状態を再描画後の`details.open`へ復元するよう変更した。

この変更により、Auto RefreshおよびTimeline記録中の700ms追従のどちらでも、同じJSON形式のStorage項目は展開状態を保ったまま最新値へ更新される。利用者が閉じた項目は次回以降も閉じた状態になる。`pnpm run verify`では、型検査、配布物生成、既存回帰に加え、キー単位の展開状態保持とStorage JSONビューへの開閉同期を検査する2件を追加し、合計29件すべてが成功した。


続く動画確認では、JSON概要のクリックとほぼ同時に再描画が発生し得ることを考慮する必要があると分かった。`toggle`イベントだけに状態保存を任せると、ブラウザのイベント配送より先にAuto Refresh、手動Refresh、または記録中追従の再描画が走る余地がある。そこでsummaryの`click`時に、既存の`details.open`を反転した値を**先行保存**し、後続の`toggle`でも実際の状態を同期する二段階の実装へ変更した。

最終ビルドを読み込んだ実Chromeの拡張コンテキストでは、概要クリック直後かつ`toggle`処理前に再描画を模した場合も、保存済み状態と新しい`details.open`がいずれも`true`となることを確認した。このため、Auto Refresh、Timeline記録中追従、手動Refreshなど、Storage一覧を再描画する経路でも展開済みJSONは閉じずに値が更新される。
