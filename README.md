# Web State Inspector

**Web State Inspector** は、現在DevToolsで検査しているページのブラウザ内状態を、専用パネルで**読み取り専用**に確認する Chrome 拡張です。外部サーバーへの送信、解析機能、状態の書き換えは実装していません。

> 設計原則は「取れないものを無理に取らない」です。ブラウザ標準のStorageは正確に表示し、フレームワーク内部状態は対象アプリが明示的に許可した場合に限って表示します。

## 機能一覧

| 分類 | 機能 | 実装状況 | 備考 |
|---|---|---:|---|
| Storage | localStorage | 対応 | Key / Value。JSON値は整形・折りたたみ・コピーに対応。 |
| Storage | sessionStorage | 対応 | 現在の検査タブのKey / Valueを表示。 |
| Storage | Cookie | 対応 | Name / Value / Domain / Path / Expires / Secure / HttpOnly / SameSiteを表示。 |
| Storage | IndexedDB | 対応 | データベース、Object Store、最大100件のレコードを表示。 |
| Storage | Cache Storage | 対応 | Cache名、Request URL、Method、Response statusを最大100件表示。 |
| Framework | Pinia | Experimental | アプリが明示的診断ブリッジを公開したときだけ表示。 |
| Framework | TanStack Query | Experimental | アプリが明示的診断ブリッジを公開したときだけ表示。 |
| UI | Search | 対応 | localStorage、sessionStorage、Cookie、IndexedDBの現在表示中データを絞り込み。 |
| UI | Refresh | 対応 | 現在選択しているカテゴリを再取得。 |

`chrome.devtools.inspectedWindow.eval()` は、検査対象ページのJavaScript状態へアクセスできるDevTools拡張APIです。本拡張では同期的なStorage取得に利用し、取得値はJSON互換のデータとしてのみ扱います。[1]

## スクリーンショット

以下は読み込み後の想定構成です。実際の値には、DevToolsを開いているページのローカル状態が表示されます。

```text
Web State Inspector                                [Search key / value] [Refresh]

Storage                                      │  Local Storage
  Local Storage                               │  2 件
  Session Storage                             │  ┌──────────────────┬─────────────────────┐
  Cookies                                     │  │ Key              │ Value               │
  IndexedDB                                   │  ├──────────────────┼─────────────────────┤
  Cache Storage                               │  │ wsi.demo.user    │ { JSONを表示 }     │
                                              │  └──────────────────┴─────────────────────┘
Framework                                     │
  Pinia (Experimental)                        │
  TanStack Query (Experimental)               │
```

`sample/index.html` をローカルWebサーバーで開くと、全Storageと明示的なPinia / TanStack Query診断ブリッジを確認できます。

![動作確認ページ。localStorage、sessionStorage、Cookie、IndexedDB / Cache Storage、Vue + Pinia、React + TanStack Queryのサンプルを表示。](docs/screenshots/demo-page.webp)

## インストール方法

Node.js 22以降とpnpmを使用します。

```bash
pnpm install
pnpm run build
```

ビルドに成功すると、Chromeへ読み込む展開済み拡張が `dist/` に作成されます。

## Chromeへの読み込み方法

Chromeで `chrome://extensions/` を開き、画面右上の **デベロッパーモード** を有効にします。次に **パッケージ化されていない拡張機能を読み込む** を選び、このリポジトリの `dist/` ディレクトリを指定してください。

拡張を読み込んだ後、HTTPまたはHTTPSの任意のページでDevToolsを開くと、上部のパネル一覧に **Web State Inspector** が追加されます。ソースを変更した場合は、`pnpm run build` 後に `chrome://extensions/` の更新ボタンで拡張を再読み込みしてください。

## 使い方

DevToolsで検査対象ページを開き、**Web State Inspector** パネルを選択します。左側のカテゴリを選ぶと内容を読み取り、右側に一覧を表示します。対象ページで状態が更新された場合は、右上の **Refresh** を押してください。

値がJSONとして解析できるlocalStorage / sessionStorageの項目は、折りたたまれた整形JSONとして表示されます。展開後に **Copy** を選ぶと、整形された値をクリップボードへコピーできます。CookieはCookie APIから取得するため、HTTPOnly属性を持つCookieもChromeの権限が許す範囲で確認できます。[2]

IndexedDBの一覧では、データベースとObject Storeを展開し、Storeを選択すると先頭から最大100件をCursorで読み取ります。Cache Storageも同様に、Cacheを選ぶと先頭から最大100件のRequestとResponse metadataを表示します。大量のデータを無制限に取得しないため、表示件数が上限を超える場合は明示します。

## 対応しているStorage

| 対象 | 取得経路 | 表示単位 | 制限 |
|---|---|---|---|
| localStorage | 検査対象ページの文脈 | Key / Value | 同期読み取り。文字列またはJSONを表示。 |
| sessionStorage | 検査対象ページの文脈 | Key / Value | タブ固有の状態を表示。 |
| Cookie | `chrome.cookies.getAll()` | Cookie属性 | HTTP/HTTPSのURLのみ。全ホストの読み取り権限が必要。 |
| IndexedDB | 検査対象ページの文脈 | DB → Store → Record | データベース列挙APIがない環境では空表示。Recordは100件まで。 |
| Cache Storage | 検査対象ページの文脈 | Cache → Request | Response bodyは読まず、metadataのみ。Requestは100件まで。 |

IndexedDBは構造化データをクライアント側に保存するための低水準APIです。[3] Cache Storageは名前付きCacheの集合としてRequest / Responseを保持し、本拡張では`Cache.keys()`と`Cache.match()`で読み取り専用のメタデータ表示を行います。[4]

## Pinia / TanStack Queryの制限

**すべてのWebサイトで取得できるわけではありません。** この制約は意図的です。

Vue DevToolsにはPiniaの統合タブがありますが、これはVue DevTools自身の機能であり、第三者拡張が任意サイトのPinia storeを安全かつ安定的に列挙できる公開インターフェースではありません。[5] Piniaインスタンスがproduction buildでグローバルに露出することも保証されません。

TanStack Queryも、公式Devtoolsは`QueryClientProvider`配下でコンポーネントとして読み込む方式です。通常のDevtoolsはproduction bundleから除外され、任意のサイトの`QueryClient`を第三者が発見できる一般APIは提供されていません。[6]

そのため、本拡張は以下を**行いません**。

- `window` やJavaScriptオブジェクトを無差別に走査してPiniaまたはQueryClientらしき値を探すこと。
- Vue DevToolsまたはTanStack Query Devtoolsの内部プロトコル、非公開フック、バージョン依存hackに接続すること。
- 検出できない状態をエラーとして扱ったり、アプリに状態変更を求めたりすること。

代わりに、対象アプリの開発者が次の読み取り専用ブリッジを**明示的に**公開した場合だけ、Experimental項目として状態を表示します。拡張は`getPinia`または`getTanStackQuery`が存在しなければ `Not detected` を表示します。

```ts
// 開発用のエントリポイントなど、公開範囲を理解した場所に置いてください。
declare global {
  interface Window {
    __WEB_STATE_INSPECTOR__?: {
      version: 1;
      getPinia?: () => unknown | Promise<unknown>;
      getTanStackQuery?: () => unknown | Promise<unknown>;
    };
  }
}

window.__WEB_STATE_INSPECTOR__ = Object.freeze({
  version: 1,
  getPinia: () => ({
    userStore: { id: userStore.$id, state: userStore.$state },
  }),
  getTanStackQuery: () => queryClient.getQueryCache().getAll().map((query) => ({
    queryKey: query.queryKey,
    status: query.state.status,
    data: query.state.data ?? null,
    updatedAt: query.state.dataUpdatedAt || null,
  })),
});
```

このブリッジは本番環境へ自動的に含めないことを推奨します。本番でも使う場合は、認証情報・トークン・個人情報などを返さないようアプリ側で必要最小限のスナップショットに制限してください。拡張は任意のWebページを検査できるため、ページから返る値は信頼できない入力として扱い、UIへHTMLとして挿入しません。[1]

## 権限について

| Manifest設定 | 用途 | 必要性 |
|---|---|---|
| `devtools_page` | DevToolsに専用パネルを追加する。 | 必須 |
| `cookies` | `chrome.cookies.getAll()`によるCookieの読み取り。 | Cookie表示に必須 |
| `host_permissions: ["<all_urls>"]` | ユーザーがDevToolsで検査する任意HTTP/HTTPSサイトのCookie読み取り。 | Cookie表示に必須 |

ChromeのCookie APIは、`cookies` 権限に加えて対象ホストのホスト権限を要求します。[2] 本拡張は`tabs`、`scripting`、`storage`、`webRequest`、書き込み用Cookie API、コンテンツスクリプトを使用しません。

## セキュリティとプライバシー

| 項目 | 方針 |
|---|---|
| データ送信 | 実装しない。ネットワーク通信、Analytics、外部API呼び出しはない。 |
| 状態変更 | 実装しない。Storage、Cookie、IndexedDB、Cache Storageは読み取りのみ。 |
| 表示対象 | DevToolsを開いた現在の検査対象ページのメインフレーム。 |
| 大量データ | IndexedDBとCache Storageは最大100件に制限。 |
| Framework State | 明示的に公開された読み取り専用ブリッジだけを使用。 |

> `sample/` はVue、Pinia、React、TanStack QueryをCDNから読み込むデモです。これはサンプルページ自身の依存読み込みであり、拡張のデータ送信機能ではありません。配布する`dist/`拡張は外部スクリプトを読み込みません。

## 技術スタック

| 要素 | 採用技術 |
|---|---|
| 拡張形式 | Chrome Extension Manifest V3 |
| 言語 | TypeScript |
| UI | Vanilla TypeScript / DOM API |
| DevTools連携 | `chrome.devtools.panels`、`chrome.devtools.inspectedWindow` |
| Cookie | `chrome.cookies` |
| ビルド | TypeScript Compiler、Node.js |

Reactを拡張パネル自体には導入していません。パネルの状態と画面要素が小規模であり、依存・バンドルサイズを増やさず、Manifest V3で必要な静的ビルドを単純に保つためです。`sample/`では、診断ブリッジの利用例を示すためVue + PiniaとReact + TanStack Queryを用います。

## ディレクトリ構成

```text
web-state-inspector/
├── static/                         # Manifestと配布用HTML/CSS
│   ├── manifest.json
│   ├── devtools.html
│   └── panel/
├── src/
│   ├── devtools.ts                  # パネル登録
│   ├── background/service-worker.ts # Cookieの読み取り
│   ├── panel/
│   │   ├── main.ts                  # UIと取得制御
│   │   └── page-evaluator.ts        # 検査対象ページでの安全な読み取り
│   └── shared/types.ts
├── sample/index.html                # 動作確認用ページ
├── docs/research-decision.md        # Framework Stateの調査判断
├── scripts/build.mjs                # dist組み立て
├── tests/                           # 静的構成の回帰検査
├── package.json
└── README.md
```

## 開発方法

```bash
pnpm install
pnpm run typecheck  # 型検査
pnpm run build      # dist/生成
pnpm run test       # 配布物の構成・安全性を検査
pnpm run verify     # 上記を順番に実行
```

動作確認ページは、任意のローカル静的Webサーバーから `sample/` を配信してください。例えばプロジェクトルートから静的サーバーを起動し、`http://localhost:<port>/sample/` を開きます。次にDevToolsのWeb State InspectorでカテゴリごとにRefreshを実行し、localStorage、sessionStorage、Cookie、`wsi-demo-db`、`wsi-demo-cache-v1`、Pinia、TanStack Queryの表示を確認します。

## 参考資料

[1]: https://developer.chrome.com/docs/extensions/reference/api/devtools/inspectedWindow "chrome.devtools.inspectedWindow | Chrome for Developers"
[2]: https://developer.chrome.com/docs/extensions/reference/api/cookies "chrome.cookies | Chrome for Developers"
[3]: https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API "IndexedDB API | MDN Web Docs"
[4]: https://developer.mozilla.org/en-US/docs/Web/API/CacheStorage "CacheStorage | MDN Web Docs"
[5]: https://devtools.vuejs.org/getting-started/features "Features | Vue DevTools"
[6]: https://tanstack.com/query/latest/docs/framework/react/devtools "Devtools | TanStack Query"
