# Web State Inspector

**Web State Inspector** は、Chrome DevToolsに追加するManifest V3拡張です。Web StorageやCookieを閲覧するだけでなく、利用者が明示的に開始したデバッグ記録から **User Action、SPA Route Change、Storage変更、Network通信、JavaScript / Console Error** を統合し、AIへ貼り付け可能なMarkdownまたはJSONをローカルで生成します。

> **AI Debug Context** とは、不具合の前後に起きた操作、状態変化、通信失敗、例外、現在状態を、原因調査に使いやすい順序と粒度で整理したテキストです。本拡張はAIサービスへ接続・送信しません。利用者が出力内容を確認したうえで、任意のAIへ貼り付けるための補助ツールです。

`chrome.devtools.inspectedWindow.eval()`は、検査中ページのJavaScript状態を読むためのDevTools拡張APIです。本拡張はStorage、明示的な診断ブリッジ、利用者がElementsで選択した要素を読む必要がある箇所だけで利用し、結果をJSON互換値に限定します。[1]

## 主な機能

| 区分 | 機能 | 内容 |
|---|---|---|
| Storage | Local Storage / Session Storage | Key / Valueの読み取り、JSON整形、コピー、検索、手動Refresh、Auto Refresh。 |
| Storage | Cookie | Name、Value、Domain、Path、Expires、Secure、HttpOnly、SameSiteを表示。 |
| Storage | IndexedDB / Cache Storage | IndexedDBのメタデータと先頭100件のrecord、Cacheのメタデータと先頭100件のentryを表示。 |
| Framework | Pinia / TanStack Query | **Experimental**。対象アプリが明示的診断ブリッジを公開した場合だけ読み取る。 |
| Debug | Debug Recording | Start Recording以降のUser Action、Route Change、Storage、Network、Errorを固定長バッファへ記録。 |
| Debug | Unified Timeline | 操作から状態変化、通信、例外までをISO timestamp順で統合表示。 |
| Debug | Snapshots | ラベル付きのBefore / After Snapshot、JSON構造比較、Elementsで選択した要素だけの最小DOM Snapshot。 |
| Debug | AI Export | 再現メモを含むMarkdownまたはJSONをローカル生成し、Copy for AIでクリップボードへコピー。 |
| Debug | Recording Compare | 停止済みの正常・異常Recordingをローカルに2件まで保存し、最初の差分、API差分、時間近接チェーンを表示。 |
| Debug | Debug Summary | 最初の4xx / 5xx / status 0、JavaScript / Console Error、正常系との差分を優先抽出。 |

詳細な画面操作、同梱デモによる確認手順、AI Exportの使い分け、取得範囲と注意事項は[詳細操作ガイド](docs/user-guide-ja.md)を参照してください。

## インストール

1. このリポジトリをcloneするか、配布済みの`dist/`フォルダを入手します。
2. `chrome://extensions/` を開き、**デベロッパーモード**を有効化します。
3. **パッケージ化されていない拡張機能を読み込む**を選択します。
4. リポジトリの `dist/` フォルダを選択します。
5. 任意のWebページを開き、DevToolsの **Web State Inspector** パネルを選択します。

開発時は、変更後に `pnpm run build` を実行し、`chrome://extensions/` で拡張を再読み込みしてください。

## 基本的な使い方

### 状態の閲覧とAuto Refresh

左側のStorageまたはFrameworkカテゴリを選ぶと、対象ページの現在値を読み取ります。Local StorageとSession Storageでは、一覧上部の **Auto Refresh** をオンにすると、`500 ms`、`1 s`、`2 s`、`5 s`から選んだ間隔で現在の一覧だけを再取得します。Auto Refreshの既定値はオフです。

State Change TimelineまたはDebug Recordingが記録中であれば、Local StorageとSession Storageの一覧はAuto Refreshの設定にかかわらず`700 ms`間隔で追従します。Cookie、IndexedDB、Cache Storage、Framework Stateに無制限のポーリングは行いません。**JSONを表示で展開したStorage項目は、バックグラウンド更新後も開いたまま値だけを更新します。**

### Debug RecordingとUnified Timeline

**Debug / Timeline** を開き、**Start Recording** を押します。その時点以降、操作・画面遷移・Storage・Network・Errorを記録します。**Stop** は記録用のStorage、History API、Consoleのフックを元に戻し、**Clear** は検査中ページを変更せず拡張側の記録だけを削除します。

| イベント | 取得する情報 | 上限 |
|---|---|---:|
| User Action | `click`、`input`、`change`、`submit`、`focusin`、`focusout`、`keydown`と、対象要素の最小要約。 | 200件 |
| Route Change | `history.pushState`、`history.replaceState`、`popstate`、`hashchange`の遷移前後URL。 | 100件 |
| Storage変更 | `setItem`、`removeItem`、`clear`、変更前後、時刻、呼び出し元スタック。 | Timeline合計1,000件 |
| 別文書のStorage変更 | 同一originの別文書から届く`storage`イベントと発生元URL。 | Timeline合計1,000件 |
| Network | method、URL、status、duration、request / response headers、取得可能なbody。 | 500件 |
| JavaScript / Console | `error`、`unhandledrejection`、`console.error`、`console.warn`、stack、重複回数。 | 200件 |

User Actionはメインフレームの`document`でcapture phaseに記録します。高頻度の`mousemove`、`scroll`、`pointermove`は記録しません。`input`は要素ごとに**350 msのdebounce**をかけるため、入力の途中経過ではなく最後の入力イベントを保存します。`type="password"`の要素は実値を読まず、値を`[not captured]`として扱います。[2]

Route ChangeはVue RouterやReact Routerの内部APIを使いません。標準History APIを一時的にラップし、`popstate`と`hashchange`も別イベントとして記録します。`pushState()`は`hashchange`を発火させないため、これらを個別に監視します。[3] Stop時は、現在の関数が本拡張のラッパーである場合に限り元へ戻すため、記録中にアプリ側が置き換えた関数を上書きしません。

Unified Timelineは**ISO 8601 timestamp**で並べます。ページ側の計測フックとDevTools Network APIの`performance.now()`は同一原点を共有しないため、`performanceMs`は表示順の判定に使いません。同一時刻や近接時刻は、操作と後続イベントの厳密な因果関係を証明するものではありません。

`storage`イベントは変更を起こした同一ページではなく、同じStorage領域を共有する別文書で発火します。[4] そのため、同一ページでの原因追跡には、Record中に`Storage.prototype.setItem`、`removeItem`、`clear`を計測する方式を使用します。`localStorage.key = value`のようなプロパティ代入は、この初期版の追跡対象外です。

### 正常・異常Recordingの比較

不具合を再現できる場合は、次の順に操作します。

1. 正常な操作を **Start Recording** → **Stop** し、**Debug / Recordings** で `Normal` として保存します。
2. **Start Recording** で異常な操作を記録して停止し、`Broken` として保存します。
3. **Debug / Compare** でNormalとBrokenを選び、**Compare Recordings** を押します。
4. **First Divergence**、**Debug Summary**、**Network Differences**、**Possibly Related Event Chains** を確認してから、**Copy for AI** を使います。

比較は時刻、イベント種別、Storageキー、HTTP methodとAPI endpointを使うbest effortの対応付けです。時間的近接や差分は因果関係を保証しません。JSON response/request bodyは構造単位で、headers・query・status・durationも比較します。bodyは既存の100KiB上限を超えて保持しません。

### NetworkとJavaScript / Console Events

**Debug / Network** では、Start Recording以降に完了した通信を確認できます。Chrome DevTools Network APIは、Networkパネルに表示される通信をHAR形式で提供し、`onRequestFinished`から完了後のRequestを受け取れます。[5] 表示は **All**、**Fetch/XHR**、**Error only**、**4xx / 5xx** で絞り込めます。

HARにはrequest contentが含まれないため、request bodyは利用可能なHAR postDataがある場合だけ表示します。[5] response bodyは`getContent()`を試行し、取得できない場合は `Not available` と理由を示します。取得できたbodyも、メモリとAI出力を保護するため最大100KiBで切り詰め、`[truncated]`を付加します。DevToolsを開く前に発生した通信はAPIの記録に存在しない可能性があるため、Debug RecordingはStart以降の通信を対象にします。[5]

**Debug / Errors** は、ページの`error`、`unhandledrejection`、`console.error`、`console.warn`を記録します。`console.log`は標準では記録しません。未処理のPromise rejectionはグローバルスコープへ`unhandledrejection`イベントとして送られますが、クロスoriginスクリプト由来のrejectionはブラウザの情報漏えい対策により取得できない場合があります。[6] 同じmessage・source・行・列が短時間に複数経路から記録された場合は、重複表示を避けて回数を集約します。

Console引数はJSON化を試行します。循環参照、DOMノード、`BigInt`、関数、`symbol`などは安全な短縮表現へ変換して、記録処理そのものが例外を起こさないようにします。

### Snapshot、ラベル、Selected DOM

**Debug / Snapshots** でBefore / Afterラベルを入力してから **Capture Before** と **Capture After** を押します。**Show Diff** は巨大なdeep-diffライブラリに依存せず、JSON互換値を再帰比較して追加・削除・変更を表示します。ラベルは比較表示とAI Exportの`Snapshot Diff`見出しへそのまま反映されます。

Snapshotには次の情報を含めます。

| 区分 | 内容 |
|---|---|
| Page | URL、origin、title。 |
| Environment | User Agent、viewport、device pixel ratio、`document.readyState`。 |
| State | localStorage、sessionStorage、Cookie、IndexedDB metadata、Cache Storage metadata。 |
| Framework | 明示的診断ブリッジから取得できた場合だけ、PiniaとTanStack Queryの状態。 |

PiniaとTanStack Queryは、`window`全体を探索せず、対象アプリが`window.__WEB_STATE_INSPECTOR__`で明示的に提供した読み取り専用ブリッジだけを使用します。ブリッジがなければ **Not detected** と表示します。

Elementsパネルで調べたい要素を選択してから **Capture Selected Element** を押すと、DevTools Console APIの`$0`から、その**選択要素だけ**を取得します。[1] [7] この最小Snapshotには要約、短縮text、必要属性、dataset、disabled / hidden、ARIA属性、矩形、重要なcomputed styleのみを含めます。全DOM走査、`document.documentElement.outerHTML`、自動DOM dumpは行いません。Elementsで要素が選択されていない場合は何も取得せず、Elementsパネルで選択してから再実行するよう案内します。

### Copy for AI

**Debug / AI Export** でMarkdownまたはJSONを選び、Expected Result、Actual Result、Reproduction Steps、Additional Notesを入力して **Copy for AI** を押します。Snapshotをまだ取得していない場合、Copy時に`Current state`ラベルのSnapshotを1件取得します。

Markdownの章は、AIが再現と障害の事実を先に読めるよう、次の順で出力します。

| 順序 | 章 | 内容 |
|---:|---|---|
| 1 | Reproduction Notes | Expected Result、Actual Result、Reproduction Steps、Additional Notes。 |
| 2 | JavaScript and Console Events | `error`、rejection、`console.error`、`console.warn`。 |
| 3 | Network Errors | HTTP 4xx / 5xx、status 0、または収集エラーの通信。 |
| 4 | User Actions | 記録した操作と最小要約。 |
| 5 | Route Changes | 標準History APIとブラウザ遷移イベントの前後URL。 |
| 6 | Storage Changes | Storage変更前後と呼び出し元。 |
| 7 | Unified Timeline | すべての記録イベントをISO timestamp順に列挙。 |
| 8 | Snapshot Diff | Before / Afterラベル付きの状態差分。 |
| 9 | Current State | 現在のPage、Environment、記録件数、選択DOM Snapshot。 |

Recording比較を実行済みの場合は、`Debug Summary`、`First Divergence`、`Possibly Related Event Chains`、`Network Differences`を再現メモの直後に加えます。これにより、AIへ渡す情報は「最初に正常系と違った地点」を先頭側に置けます。

Timeline上で、あるUser Actionの**後0〜1.5秒**に起きたイベントには`[possibly related to …]`を補助表示します。この表示はISO timestampの時間近接だけに基づくものであり、因果関係を示すものではありません。時刻を解釈できないイベントには表示しません。

~~~~markdown
# Web Debug Context

## Reproduction Notes

Expected Result:

顧客詳細画面が表示される

Actual Result:

500エラー後に画面が更新されない

Reproduction Steps:

1. 顧客IDを入力する
2. 詳細を押す

## JavaScript and Console Events

### Error 1

Kind: console-error

Message: Customer detail failed: 500

## Network Errors

### 1. GET https://example.com/api/customers/123

Status: 500 Internal Server Error

## User Actions

10:21:01 CLICK button#customer-detail

## Unified Timeline

```
10:21:01 USER_ACTION CLICK button#customer-detail
10:21:01 STORAGE localStorage.selectedCustomerId 100 → 123 [possibly related to click button#customer-detail]
10:21:01 REQUEST GET https://example.com/api/customers/123 [possibly related to click button#customer-detail]
10:21:01 RESPONSE 500 GET https://example.com/api/customers/123 (61 ms) [possibly related to click button#customer-detail]
10:21:01 CONSOLE-ERROR Customer detail failed: 500 [possibly related to click button#customer-detail]
```
~~~~

JSON出力は同じ情報を`page`、`environment`、`session`、`snapshots`、`network`、`errors`、`storageChanges`、`timeline`、`userActions`、`routeChanges`、`selectedElements`、`reproductionNotes`、限定Export時の`focusedEvent`のキーで保持します。AIサービスへ送信する処理は一切ありません。

### 失敗イベント周辺だけのExport

**Debug / Timeline**、**Debug / Network**、または**Debug / Errors**で、4xx / 5xx、status 0の通信失敗、`javascript-error`、`console-error`、`promise-rejection`の行にある **Export around event** を押します。AI Export画面で失敗イベントを確認し、**Seconds before** と **Seconds after** を指定して **Copy focused context** を押すと、その時間窓内の情報だけを生成します。既定値は失敗の**前5秒・後2秒**で、0〜60秒に変更できます。

限定Exportには、選択した失敗イベントと時間窓、範囲内のTimeline、Network、Error、User Action、Route Change、Storage Change、選択DOMだけを含めます。範囲にまたがるNetworkは、失敗通信のheadersや取得可能なbodyを失わないよう、開始または完了時刻が時間窓と重なる場合に含めます。Snapshot本体とBefore / After Diffは時間基準で安全に限定できないため、限定Exportでは除外し、PageとEnvironmentのメタデータだけを残します。`console.warn`は確認材料として通常Exportには含みますが、単独では失敗イベントの選択対象にしません。

> 限定Exportの「前後時間内」はISO timestampの近接条件です。選択した失敗が周辺イベントの原因であること、または周辺イベントが失敗の原因であることを証明するものではありません。

## 取得範囲と制約

| 対象 | 取得する範囲 | 取得しない・制約 |
|---|---|---|
| User Action | 指定した低頻度イベントと対象要素の最小要約。password値は`[not captured]`。 | mousemove、scroll、pointermove、iframe内の操作、DOM全体。 |
| Route Change | `pushState`、`replaceState`、`popstate`、`hashchange`。 | Router内部API、初期ロード前の遷移、iframe内の遷移。 |
| localStorage / sessionStorage | 現在値、標準メソッドによる記録開始後の変更。 | 記録開始前、プロパティ代入、iframe内の変更。 |
| Cookie | Chromeの権限範囲で取得できるCookie。 | Cookie値の自動マスキング。 |
| Network | DevToolsに現れる完了RequestのHAR情報、取得可能なbody。 | 取得不能なbody、Start前の通信、WebSocket / SSE専用イベント。 |
| JavaScript / Console | メインフレームの`error`、`unhandledrejection`、`console.error`、`console.warn`。 | `console.log`、Worker専用の例外、クロスorigin制約を受けるrejection。 |
| Selected DOM | 利用者がElementsで選択し、Captureを押した`$0`の最小情報。 | 自動取得、全DOM、`outerHTML`、選択されていない要素。 |
| IndexedDB / Cache Storage | 現在のmetadataと、手動画面での読み取り。 | 変更履歴の追跡。 |
| Pinia / TanStack Query | 明示的診断ブリッジが返すJSON互換の状態。 | Vue / React DevToolsの内部API、無差別なグローバル探索。 |

Fetchはネットワーク例外ではrejectしますが、404や500などのHTTPエラーでは通常Responseとして解決するため、Network Errorの判定にはstatusも使用します。[8] XHRはstatus、responseText、response headersを提供できますが、実際に拡張が表示するNetwork情報は、ページを改変せずにDevTools Network APIから収集できる範囲を優先します。[9]

## セキュリティとプライバシー

本拡張は収集したデータを外部API、サーバー、AIサービスへ送信しません。Network、Cookie、Storage、Snapshot、AI Exportは、検査中ページとローカルの拡張プロセス内だけで処理します。

> **Copy for AIを押す前に、必ず内容を確認してください。** Cookie、Authorization header、access token、個人情報、顧客情報、非passwordの入力値、request / response bodyなどの機密情報が含まれることがあります。自動マスキングは実装していません。利用者が不要な情報を削除・確認したうえで、外部AIサービスへ貼り付けてください。

Debug RecordingのStorage、History API、Console計測は、対象ページのメインフレームに一時的なフックを設定します。Stopを押すと、計測フックは元のメソッドへ復元します。信頼できる開発・検証環境で使用してください。

## パフォーマンス設計

| バッファ | 上限 | 方針 |
|---|---:|---|
| Unified Timeline | 1,000イベント | 上限超過時は古いイベントから破棄するリングバッファ。 |
| User Action | 200件 | 高頻度イベントを除外し、inputは350ms debounceする。 |
| Route Change | 100件 | 標準History APIとブラウザイベントだけを保持する。 |
| Network | 500件 | 完了済みRequestだけを保持する。 |
| Error / Console | 200件 | 重複を集約し、上限超過時は古いErrorを破棄する。 |
| response body | 100KiB / 件 | 上限超過時は切り詰めて明示する。 |
| AI Export | Timeline 200件、Network 100件、Error 50件、Storage 100件 | 大量データを無制限にクリップボードへ出さない。 |
| Selected DOM | 3件 | 利用者が明示Captureした最新3件だけを保持する。 |
| IndexedDB / Cache表示 | 100件 / StoreまたはCache | 無制限の読み取りを避ける。 |

## アーキテクチャ

| 層 | 主なファイル | 責務 |
|---|---|---|
| Domain | `src/shared/types.ts` | Network、Error、Interaction、Timeline、Snapshot、Diff、AI Contextの型。 |
| Collectors | `network-collector.ts`、`error-collector.ts`、`change-tracker.ts`、`interaction-tracker.ts` | 読み取り・計測・上限管理。 |
| Session | `debug-session.ts` | Storage、Network、Error、User Action、Route Changeを共通Timelineへ集約。 |
| Snapshot | `snapshot-service.ts`、`selected-element-service.ts` | 現在状態と選択DOMの明示取得、Before / After比較。 |
| Formatter / Focus | `ai-export.ts`、`focused-event-context.ts`、`reproduction-notes.ts` | AI向けMarkdown / JSONのローカル生成、失敗イベント周辺の時間窓選択、再現メモの正規化。 |
| UI | `main.ts` | DevToolsナビゲーション、記録操作、Snapshot、Copy操作。 |

## 開発とテスト

```bash
pnpm install
pnpm run verify
```

`pnpm run verify` は、TypeScript型検査、`dist/`組み立て、Node標準テストを連続実行します。テストはNetworkのHAR正規化とフィルタ、response body切り詰め、Network / Timeline上限、Storage変更、Error / Console統合、User Actionのpassword保護とinput debounce、Route Change、Selected DOMの最小取得、Snapshot生成、Before / After Diff、AI Exportの優先順とISO timestamp相関、**失敗イベントを中心とする時間窓の限定Export**、Auto Refresh、Manifestとアイコン、読み取り専用設計を検証します。

動作確認ページは次のコマンドで起動できます。

```bash
node scripts/serve.mjs
# http://localhost:4173/sample/
```

サンプルページには、Storage変更、Fetch 200 / 500、XHR POST 201、`console.error`、`console.warn`、未処理Promise rejection、input / password / form submit、`pushState` / `replaceState`、**Action → State → Network → Error**の連鎖、Pinia、TanStack Queryを発生させる操作を用意しています。

## ディレクトリ構成

```text
src/
├── background/service-worker.ts
├── devtools.ts
├── panel/
│   ├── ai-export.ts
│   ├── change-tracker.ts
│   ├── debug-session.ts
│   ├── error-collector.ts
│   ├── focused-event-context.ts
│   ├── interaction-tracker.ts
│   ├── main.ts
│   ├── network-collector.ts
│   ├── page-evaluator.ts
│   ├── reproduction-notes.ts
│   ├── selected-element-service.ts
│   ├── snapshot-service.ts
│   └── storage-polling.ts
└── shared/types.ts
sample/index.html
docs/ai-debug-context-research.md
docs/interaction-tracking-research.md
docs/verification-notes.md
tests/
```

## 参考資料

[1]: https://developer.chrome.com/docs/extensions/reference/api/devtools/inspectedWindow "chrome.devtools.inspectedWindow | Chrome for Developers"
[2]: https://developer.mozilla.org/en-US/docs/Web/API/Element/input_event "Element: input event | MDN Web Docs"
[3]: https://developer.mozilla.org/en-US/docs/Web/API/History/pushState "History: pushState() method | MDN Web Docs"
[4]: https://developer.mozilla.org/en-US/docs/Web/API/Window/storage_event "Window: storage event | MDN Web Docs"
[5]: https://developer.chrome.com/docs/extensions/reference/api/devtools/network "chrome.devtools.network | Chrome for Developers"
[6]: https://developer.mozilla.org/en-US/docs/Web/API/Window/unhandledrejection_event "Window: unhandledrejection event | MDN Web Docs"
[7]: https://developer.chrome.com/docs/extensions/reference/api/devtools/panels "chrome.devtools.panels | Chrome for Developers"
[8]: https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API/Using_Fetch "Using the Fetch API | MDN Web Docs"
[9]: https://developer.mozilla.org/en-US/docs/Web/API/XMLHttpRequest "XMLHttpRequest | MDN Web Docs"
