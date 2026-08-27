# Web State Inspector

**Web State Inspector** は、Chrome DevToolsに追加するManifest V3拡張です。Web StorageやCookieを閲覧するだけでなく、明示的に開始したデバッグ記録から **Storage変更、Network通信、JavaScript Errorを時系列で整理し、AIへ貼り付けられるMarkdownまたはJSONをローカル生成**します。

> AI Debug Contextとは、不具合の前後に発生した状態変化、通信失敗、例外、実行環境を、原因推論に必要な順序と粒度で整理したテキストです。本拡張はAIサービスへ接続・送信しません。利用者が内容を確認したうえで、任意のAIへ貼り付けるための出力を生成します。

## 主な機能

| 区分 | 機能 | 内容 |
|---|---|---|
| Storage | Local Storage / Session Storage | Key / Valueの読み取り、JSON整形、コピー、検索、手動Refresh、Auto Refresh。 |
| Storage | Cookie | Name、Value、Domain、Path、Expires、Secure、HttpOnly、SameSiteを表示。 |
| Storage | IndexedDB / Cache Storage | IndexedDBのメタデータと先頭100件のrecord、Cacheのメタデータと先頭100件のentryを表示。 |
| Framework | Pinia / TanStack Query | **Experimental**。対象アプリが明示的診断ブリッジを公開した場合だけ読み取る。 |
| Debug | Debug Recording | Start Recording以降のStorage、Network、Errorを固定長バッファへ記録。 |
| Debug | Unified Timeline | Storage変更、Network Request / Response、JavaScript Error、console.error、Promise rejectionを時刻順に統合。 |
| Debug | Network | HAR由来のmethod、URL、status、duration、headersと、取得可能なresponse bodyを表示。 |
| Debug | Errors | `error`、`unhandledrejection`、`console.error`を重複抑制して表示。 |
| Debug | Snapshots | 現在状態をCapture Before / Capture Afterし、単純なJSON構造比較を表示。 |
| Debug | AI Export | 優先情報をMarkdownまたはJSONへ整形し、Copy for AIでクリップボードへコピー。 |

`chrome.devtools.inspectedWindow.eval()`は、検査中ページのJavaScript状態にアクセスできるDevTools拡張APIです。本拡張は、Storageや明示的診断ブリッジなど、ページのJavaScript状態を読む必要がある箇所に限って利用し、受け取る値をJSON互換値に限定します。[1]

## インストール

1. このリポジトリをcloneするか、Release相当の`dist/`フォルダを入手します。
2. `chrome://extensions/` を開き、**デベロッパーモード**を有効化します。
3. **パッケージ化されていない拡張機能を読み込む**を選択します。
4. リポジトリの `dist/` フォルダを選択します。
5. 任意のWebページを開き、DevToolsの **Web State Inspector** パネルを選択します。

開発時は、変更後に `pnpm run build` を実行し、`chrome://extensions/` の再読み込みを行ってください。

## 基本的な使い方

### 状態の閲覧とAuto Refresh

左側のStorageまたはFrameworkカテゴリを選ぶと、対象ページの現在値を読み取ります。Local StorageとSession Storageでは、一覧上部の **Auto Refresh** をオンにすると、`500 ms`、`1 s`、`2 s`、`5 s`から選んだ間隔で現在の一覧だけを再取得します。Auto Refreshの既定値はオフです。

State Change TimelineがRecord中であれば、Local StorageまたはSession Storageの一覧はAuto Refreshの設定にかかわらず`700 ms`間隔で追従します。Cookie、IndexedDB、Cache Storage、Framework Stateには無制限のポーリングを行いません。

### Debug Recording

左側の **Debug / Timeline** を開き、**Start Recording** を押します。その時点から、次のイベントを記録します。**Stop** は記録用のStorage・Errorフックを元に戻し、**Clear** は対象ページを変更せず、拡張側の記録だけを削除します。

| イベント | 取得する情報 | 上限 |
|---|---|---:|
| Storage変更 | `setItem`、`removeItem`、`clear`、変更前後、時刻、呼び出し元スタック。 | Timeline合計1,000件 |
| 別文書のStorage変更 | 同一originの別文書から届く`storage`イベントと発生元URL。 | Timeline合計1,000件 |
| Network | method、URL、status、duration、request / response headers、取得可能なbody。 | 500件 |
| JavaScript Error | message、stack、source URL、line、column。 | 200件 |
| Promise rejection / console.error | kind、message、stack、重複回数。 | 200件 |

`storage`イベントは変更を起こした同一ページではなく、同じStorage領域を共有する別文書で発火します。[2] そのため、同一ページでの原因追跡には、Record中に`Storage.prototype.setItem`、`removeItem`、`clear`を計測する方式を使用します。`localStorage.key = value`のようなプロパティ代入は、この初期版の追跡対象外です。

### Network

**Debug / Network** では、Start Recording以降に完了した通信を確認できます。Chrome DevTools Network APIは、Networkパネルに表示される通信をHAR形式で提供し、`onRequestFinished`から完了後のRequestを受け取れます。[3] 表示は **All**、**Fetch/XHR**、**Error only**、**4xx / 5xx** で絞り込めます。

HARにはrequest contentが含まれないため、request bodyは利用可能なHAR postDataがある場合だけ表示します。[3] response bodyは`getContent()`を試行し、取得できない場合は `Not available` と理由を示します。取得できたbodyも、メモリとAI出力を保護するため最大100KiBで切り詰め、`[truncated]`を付加します。DevToolsを開く前に発生した通信はAPIの記録に存在しない可能性があるため、Debug RecordingはStart以降の通信を対象にします。[3]

### JavaScript Errors

**Debug / Errors** は、ページの`error`、`unhandledrejection`、`console.error`を記録します。未処理のPromise rejectionはグローバルスコープへ`unhandledrejection`イベントとして送られますが、クロスoriginスクリプト由来のrejectionはブラウザの情報漏えい対策により取得できない場合があります。[4] 同一のmessage・source・行・列が短時間に複数経路から記録された場合は、重複表示を避けて回数を集約します。

### SnapshotとBefore / After Diff

**Debug / Snapshots** で **Capture Before** を押し、対象アプリを操作した後に **Capture After** を押します。**Show Diff** は巨大なdeep-diffライブラリに依存せず、JSON互換値を再帰比較して、追加・削除・変更を表示します。

Snapshotには次の情報を含めます。

| 区分 | 内容 |
|---|---|
| Page | URL、origin、title。 |
| Environment | User Agent、viewport、device pixel ratio、`document.readyState`。 |
| State | localStorage、sessionStorage、Cookie、IndexedDB metadata、Cache Storage metadata。 |
| Framework | 明示的診断ブリッジから取得できた場合だけ、PiniaとTanStack Queryの状態。 |

PiniaとTanStack Queryは、`window`全体を探索せず、対象アプリが`window.__WEB_STATE_INSPECTOR__`で明示的に提供した読み取り専用ブリッジだけを使用します。ブリッジがなければ **Not detected** と表示します。

### Copy for AI

**Debug / AI Export** で出力形式をMarkdownまたはJSONから選び、**Copy for AI** を押します。出力には、Page、Environment、記録件数、JavaScript Errors、失敗したNetwork、Storage Changes、Snapshot Diff、Unified Timelineを優先的に含めます。Snapshotをまだ取得していない場合、Copy時に現在のSnapshotを読み取ります。

Markdown出力は次のような構造です。

~~~~markdown
# Web Debug Context

## Page

URL: https://example.com/customers/123

Title: Customer Detail

## Network Errors

### 1. GET https://example.com/api/contracts/123

Status: 500 Internal Server Error

Duration: 61 ms

## Storage Changes

### Storage change 1

Area: localStorage

Key: selectedCustomerId

Before:

```
100
```

After:

```
123
```

## Unified Timeline

```
10:21:01 STORAGE localStorage.selectedCustomerId 100 → 123
10:21:01 REQUEST GET /api/customers/123
10:21:01 RESPONSE 500 GET /api/contracts/123 (61 ms)
10:21:01 JAVASCRIPT-ERROR TypeError: Cannot read properties of undefined
```
~~~~

JSON出力は同じ情報を`page`、`environment`、`session`、`snapshots`、`network`、`errors`、`storageChanges`、`timeline`のキーで保持します。AIサービスへ送信する処理は一切ありません。

## 取得範囲と制約

| 対象 | 取得する範囲 | 取得しない・制約 |
|---|---|---|
| localStorage / sessionStorage | 現在値、標準メソッドによる記録開始後の変更。 | 記録開始前、プロパティ代入、iframe内の変更。 |
| Cookie | Chromeの権限範囲で取得できるCookie。 | Cookie値の自動マスキングは初期版では未実装。 |
| Network | DevToolsに現れる完了RequestのHAR情報、取得可能なbody。 | 取得不能なbody、Start前の通信、WebSocket/SSE専用イベント。 |
| JavaScript Error | メインフレームの`error`、`unhandledrejection`、`console.error`。 | クロスorigin制約を受けるPromise rejection、Worker専用の例外。 |
| IndexedDB / Cache Storage | 現在のmetadataと、手動画面での読み取り。 | 変更履歴の追跡。 |
| Pinia / TanStack Query | 明示的診断ブリッジが返すJSON互換の状態。 | Vue / React DevToolsの内部API、無差別なグローバル探索。 |

Fetchはネットワーク例外ではrejectしますが、404や500などのHTTPエラーでは通常Responseとして解決するため、Network Errorの判定にはstatusも使用します。[5] XHRはstatus、responseText、response headersを提供できますが、実際に拡張が表示するNetwork情報は、ページを改変せずにDevTools Network APIから収集できる範囲を優先します。[6]

## セキュリティとプライバシー

本拡張は収集したデータを外部API、サーバー、AIサービスへ送信しません。Network、Cookie、Storage、Snapshot、AI Exportは、検査中ページとローカルの拡張プロセス内でだけ処理します。

> **Copy for AIを押す前に、必ず内容を確認してください。** Cookie、Authorization header、access token、個人情報、顧客情報、入力値、response bodyなどの機密情報が含まれることがあります。初期版には自動マスキングを実装していません。利用者が不要な情報を削除・確認したうえで、外部AIサービスへ貼り付けてください。

Debug RecordingのStorage・Error計測は、対象ページのメインフレームに一時的なフックを設定します。Stopを押すと、計測フックは元のメソッドへ復元します。信頼できる開発・検証環境で使用してください。

## パフォーマンス設計

| バッファ | 上限 | 方針 |
|---|---:|---|
| Unified Timeline | 1,000イベント | 上限超過時は古いイベントから破棄するリングバッファ。 |
| Network | 500件 | 完了済みRequestだけを保持。 |
| Error | 200件 | 重複を集約し、上限超過時は古いErrorを破棄。 |
| response body | 100KiB / 件 | 上限超過時は切り詰めて明示。 |
| IndexedDB / Cache表示 | 100件 / StoreまたはCache | 無制限の読み取りを避ける。 |

## アーキテクチャ

| 層 | 主なファイル | 責務 |
|---|---|---|
| Domain | `src/shared/types.ts` | Network、Error、Timeline、Snapshot、Diff、AI Contextの型。 |
| Collectors | `network-collector.ts`、`error-collector.ts`、`change-tracker.ts` | 読み取り・記録・上限管理。 |
| Session | `debug-session.ts` | Storage・Network・Errorを共通Timelineへ集約。 |
| Snapshot | `snapshot-service.ts` | 現在状態の取得とBefore / After比較。 |
| Formatter | `ai-export.ts` | AI向けMarkdown / JSONのローカル生成。 |
| UI | `main.ts` | DevToolsナビゲーション、各Debug画面、Copy操作。 |

## 開発とテスト

```bash
pnpm install
pnpm run verify
```

`pnpm run verify` は、TypeScript型検査、`dist/`組み立て、Node標準テストを連続実行します。テストはNetworkのHAR正規化とフィルタ、response body切り詰め、Network / Timeline上限、Storage変更、Error統合、Snapshot生成、Before / After Diff、Markdown / JSON整形、Auto Refresh、Manifestとアイコン、読み取り専用設計を検証します。

動作確認ページは次のコマンドで起動できます。

```bash
node scripts/serve.mjs
# http://localhost:4173/sample/
```

サンプルページには、Storage変更、Fetch 200 / 500、XHR POST 201、`console.error`、未処理Promise rejection、Pinia、TanStack Queryを発生させる操作を用意しています。

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
│   ├── main.ts
│   ├── network-collector.ts
│   ├── page-evaluator.ts
│   ├── snapshot-service.ts
│   └── storage-polling.ts
└── shared/types.ts
sample/index.html
docs/ai-debug-context-research.md
docs/change-tracking-research.md
docs/verification-notes.md
tests/
```

## 参考資料

[1]: https://developer.chrome.com/docs/extensions/reference/api/devtools/inspectedWindow "chrome.devtools.inspectedWindow | Chrome for Developers"
[2]: https://developer.mozilla.org/en-US/docs/Web/API/Window/storage_event "Window: storage event | MDN Web Docs"
[3]: https://developer.chrome.com/docs/extensions/reference/api/devtools/network "chrome.devtools.network | Chrome for Developers"
[4]: https://developer.mozilla.org/en-US/docs/Web/API/Window/unhandledrejection_event "Window: unhandledrejection event | MDN Web Docs"
[5]: https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API/Using_Fetch "Using the Fetch API | MDN Web Docs"
[6]: https://developer.mozilla.org/en-US/docs/Web/API/XMLHttpRequest "XMLHttpRequest | MDN Web Docs"
