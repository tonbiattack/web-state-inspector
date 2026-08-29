# Web State Inspector

Chrome DevTools に追加する、**イベントの前後関係を集めて AI に渡す**ためのローカル専用デバッグ拡張です。DevTools の代替ではありません。操作・状態変更・通信・例外を Timeline にまとめ、調べたいイベントの周辺だけをコピーできます。

外部 API、サーバー、AI サービスには送信しません。Copy 操作でクリップボードへ出した内容だけが外部へ渡り得るため、貼り付け前に機密情報を確認してください。

## できること

- **Timeline**: User Action、Route Change、Storage Change、Network、JavaScript / Console Error を時刻順に記録します。
- **Copy event context**: 任意のイベントを基準に、既定で前 5 秒・後 2 秒の関連イベント、通信、Storage 変更、選択要素スナップショットを Markdown でコピーします。
- **Network**: method / URL / status / duration / headers / request body / response body を確認し、通信から Timeline の関連イベントへ移動できます。
- **Snapshots**: Snapshot 1 と Snapshot 2 の差分を、URL、Storage、Cookie、明示的な Framework State を中心に確認します。
- **AI Export**: 再現手順、エラー、失敗通信、関連操作を優先した Markdown または JSON をローカルで生成します。
- **Inspect**: Local Storage、Session Storage、Cookie を読み取り専用で確認します。
- **Framework State**: アプリが明示的な診断ブリッジを公開した場合だけ Pinia / TanStack Query を表示します。

## 画面構成

| 区分 | 画面 | 目的 |
|---|---|---|
| Debug | Timeline | 記録、関連イベントの確認、文脈コピー |
| Debug | Network | 通信の詳細確認と Timeline へのジャンプ |
| Debug | Snapshots | 2 点の状態差分 |
| Debug | AI Export | AI に渡すデバッグ文脈の生成 |
| Inspect | Storage | Local / Session Storage の現在値 |
| Inspect | Cookies | Cookie の現在値 |
| Experimental | Framework State | 明示的な診断ブリッジだけを表示 |

`State Change Timeline`、`Errors`、`Recordings`、`Compare`、IndexedDB、Cache Storage の独立画面は廃止しました。Storage 変更とエラーは Timeline に統合し、比較したい 2 状態は Snapshots の Diff で確認します。

## 最短の使い方

1. DevTools の **Web State Inspector** を開き、**Timeline** で `Start Recording` を押します。
2. 不具合を再現します。
3. エラー、通信、または直前の操作を選択し、**Copy event context** を押します。
4. コピー内容を確認してから AI やチケットへ貼り付けます。

500 エラーだけを渡すのではなく、クリック、Storage 更新、API 呼び出し、例外という流れを同時に渡せます。時刻の近さは因果関係を証明するものではありません。

## Network の更新停止

Recording 中も Network は新しい通信を集め続けます。`Pause updates` は**一覧の表示だけ**を固定するため、headers や body を開いたまま読めます。ボタンは `Resume updates (N new)` に変わり、再開すると保留中の通信を一括反映します。

各通信の `Show related events` は Timeline を開き、その通信を選択します。Network 詳細と JSON の開閉状態は、更新後も保持します。

## Snapshot

`Capture Snapshot 1`、アプリ操作、`Capture Snapshot 2`、`Diff` の順に使います。Raw Snapshot は既定で折りたたまれます。Snapshot は最低限、URL、Local / Session Storage、Cookie、明示的診断ブリッジの Framework State を比較対象にします。

Elements パネルで選んだ `$0` は `Capture Selected Element` で明示的に取得できます。ページ全体の DOM を自動取得しません。

## AI Export と取り扱い注意

AI Export は次の順で情報を整形します。

1. Reproduction Notes
2. JavaScript / Console Errors
3. Network Errors
4. User Actions
5. Route Changes
6. Storage Changes
7. Unified Timeline
8. Snapshot Diff / Current State

Network body、Authorization header、Cookie、token、個人情報などが含まれる可能性があります。自動マスキングは行いません。表示・コピー内容を確認し、不要な値を削除してから共有してください。

## インストール

```bash
pnpm install
pnpm run build
```

1. `chrome://extensions/` を開き、デベロッパーモードを有効にします。
2. **パッケージ化されていない拡張機能を読み込む** から、このリポジトリの `dist/` を選択します。
3. 対象ページで DevTools を開き、**Web State Inspector** パネルを選択します。

変更後は `pnpm run build` の後、Chrome 拡張機能ページから再読み込みします。

## 開発・検証

```bash
pnpm run verify
node scripts/serve.mjs
```

`pnpm run verify` は型検査、拡張の組み立て、回帰テストを実行します。テストには Timeline 集約、任意イベントの Context Window、Network 詳細の開閉保持、`Pause updates` / `Resume updates`、Snapshot 差分、AI Export を含みます。

動作確認ページは `http://localhost:4173/sample/` で開けます。

## 制約

- 記録は利用者が開始した後のイベントだけを対象にします。
- Network response body は DevTools API で取得できる場合だけ表示します。大きな body は上限で切り詰めます。
- Framework State はアプリ側の明示的な読み取り専用ブリッジが必要です。グローバル探索や Vue / React DevTools の内部 API には依存しません。
- Cookie や Storage は拡張の権限とブラウザの制約に従います。

## 関連資料

- [classic script bridge の `Unexpected token 'export'` 障害資料](docs/classic-script-bridge-incident-ja.md)
- [詳細操作ガイド](docs/user-guide-ja.md)

## 参考

- [chrome.devtools.inspectedWindow](https://developer.chrome.com/docs/extensions/reference/api/devtools/inspectedWindow)
- [chrome.devtools.network](https://developer.chrome.com/docs/extensions/reference/api/devtools/network)
- [Window: storage event](https://developer.mozilla.org/en-US/docs/Web/API/Window/storage_event)
