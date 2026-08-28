# Web State Inspector バグ調査報告書

**対象**: `tonbiattack/web-state-inspector`
**調査対象コミット**: `c8f9222ddf6ece7f5b482719712ffb2815902197`（`main`）
**調査日**: 2026-08-28
**結論**: **修正を推奨します（Request changes）。** 自動テストはすべて成功しましたが、調査の結果、デバッグ情報の完全性および Clear 操作の契約に関する **4件の再現可能な不具合** を確認しました。

| 優先度 | 件数 | 概要 |
|---|---:|---|
| High | 2 | Snapshot Diff の対象漏れ、および Snapshot 収集失敗の隠蔽。 |
| Medium | 2 | Clear 後に、保留済みの Network または debounce 中の input が記録へ混入する競合。 |

## 調査範囲と方法

Chrome DevTools 拡張のパネル、状態収集、Snapshot、統合タイムライン、Network、操作追跡、背景の Cookie 取得、および関連テストを確認しました。依存関係をロックファイルから導入したうえで `pnpm run verify` を実行し、型検査・ビルド・Node 標準テストの **33件すべてが成功** することを確認しています。

しかし、既存テストは主に正常系と個別コンポーネントの上限管理を検証しており、Snapshot の部分失敗、Clear と非同期完了の競合、ならびに公開ガイドの Diff 対象に関する境界条件を検証していません。以下の4件は、ビルド済みモジュールを用いた独立した再現スクリプトで観測済みです。リポジトリ本体は変更していません。

## 確認された不具合

### 1. High — Snapshot Diff が公開仕様に含まれる Page、Environment、Cookie の変化を比較しない

`diffSnapshots()` が比較する値は `comparableSnapshot()` で作られますが、この関数に含まれるのは `localStorage`、`sessionStorage`、Pinia、TanStack Query、IndexedDB、Cache Storage だけです。[2] Page URL・title、Environment、Cookie は Snapshot 自体には収集される一方、比較入力から除外されています。[3]

一方、利用者ガイドは Before / After Diff の対象として **Page、Environment、Web Storage、Cookie、IndexedDB / Cache Storage のメタデータ、Framework State** を明記しています。[1] したがって、ログイン成功後の URL 遷移・タイトル更新・セッション Cookie 更新のような典型的な状態変化が、Diff 画面で「差分なし」と誤って表示されます。

| 項目 | 内容 |
|---|---|
| 場所 | `src/panel/snapshot-service.ts` の `comparableSnapshot()`（17–25行） |
| 再現条件 | Before と After で URL、title、Cookie 値だけを変える。その他の比較対象は同一にする。 |
| 実測結果 | `diffSnapshots()` は `entries: []` を返した。 |
| 利用者影響 | 認証、画面遷移、Cookie 更新が不具合分析の重要な手がかりであっても、Diff が「変化なし」と報告する。誤った切り分けにつながる。 |
| 推奨修正 | 比較対象へ `page`、`environment`、Cookie を追加する。Cookie の値を差分へ露出させたくない設計なら、Cookie の名前・domain・属性だけを比較する形式にし、ガイドと UI 文言をその仕様へ明確に合わせる。 |
| 必要な回帰テスト | URL/title/viewport/Cookie が単独で変化した場合に、それぞれ対応する差分 path が出ることを検証する。 |

> 再現スクリプト `snapshot-diff-coverage-repro.mjs` では、URL、title、HttpOnly Cookie 値を Before / After 間で変更しても、出力は `entries: []` でした。

### 2. High — Snapshot の収集失敗が空配列・未検出状態へ置き換えられ、成功として表示される

`SnapshotService.capture()` はページ情報の取得に成功すると、localStorage、sessionStorage、Cookie、IndexedDB、Cache Storage、Framework 診断ブリッジを並列取得します。しかし各取得が失敗した場合、結果は空配列または「Not detected」相当のフォールバック値へ置き換えられ、最終的に常に `ok: true` を返します。[2] UI 側も `ok: false` の場合しかエラーを表示しないため、利用者は「対象状態が空だった」のか「取得できなかった」のかを区別できません。[4]

この挙動は、権限・ブラウザ制限・一時的な評価失敗・非同期取得タイムアウトが発生した場合に、実際には存在する状態を「存在しない」と解釈させます。Snapshot が AI Export や Before / After 比較の入力にも用いられるため、下流の分析結果も不完全なまま生成されます。

| 項目 | 内容 |
|---|---|
| 場所 | `src/panel/snapshot-service.ts` の `capture()`（70–103行）、`src/panel/main.ts` の `captureSnapshot()`（1016–1028行） |
| 再現条件 | Page details のみ成功させ、Storage、Cookie、IndexedDB、Cache、Framework の取得をすべて失敗させる。 |
| 実測結果 | Snapshot は `ok: true` で返り、Storage/Cookie/IndexedDB/Cache は空、Framework は通常の未検出メッセージになった。個別の失敗理由は UI に伝達されない。 |
| 利用者影響 | Snapshot が不完全である事実を検知できず、差分なし・状態なしという誤認を生む。障害調査用ツールとしての証拠完全性を損なう。 |
| 推奨修正 | 各コレクタの取得状態（成功・空・失敗とエラー理由）を Snapshot の型へ保持し、UI に警告を表示する。全取得失敗時は `ok: false` とし、部分成功時も「不完全な Snapshot」と明示する。 |
| 必要な回帰テスト | 全取得失敗時に失敗結果となること、部分失敗時に成功データを残しつつ失敗カテゴリと理由が UI/型に残ることを検証する。 |

> 再現スクリプト `snapshot-partial-failure-repro.mjs` では、7つのサブコレクタを失敗させても `{ ok: true }` の空の Snapshot が作られました。

### 3. Medium — Clear 後に、Clear 前の Network リクエストが非同期完了して記録に再追加される

`NetworkCollector.record()` は `getContent()` で response body を非同期に待機してから `entries` へ追加します。[5] 一方、`clear()` は配列を空にするだけで、すでに開始済みの `record()` の結果を無効化する世代番号や取消状態を持ちません。[5] そのため、遅い response body の待機中に Clear を押すと、Clear 後に当該リクエストが新しい記録として再追加されます。

README は Clear を「拡張側の記録だけを削除」と説明しています。[6] したがって、この事象は Clear を押した時点で画面にあった全記録を消去する、という利用者の自然な契約に反します。Clear 後に再現をやり直すと、前回の通信が混入して時系列・AI Export が汚染されます。

| 項目 | 内容 |
|---|---|
| 場所 | `src/panel/network-collector.ts` の `record()`（102–133行）および `clear()`（90–92行） |
| 再現条件 | `getContent()` が未解決のリクエストを受信後、body 完了前に `clear()` を実行し、その後 body を解決する。 |
| 実測結果 | Clear 直後に空だった `entries` に、旧リクエストが1件追加された。タイムライン用 callback も1回実行された。 |
| 利用者影響 | 再現セッションを分離するための Clear が機能せず、AI 出力と Unified Timeline に前セッションの通信が混入する。 |
| 推奨修正 | `start()` と `clear()` で増加させる generation / epoch を導入し、`record()` 開始時の generation が非同期完了時にも現在値と一致するときだけ追加・通知する。`stop()` でも同様に無効化する。 |
| 必要な回帰テスト | 未解決の `getContent()` 中に Clear を実行した後、body 解決後にも entry・callback が追加されないことを検証する。 |

> 再現スクリプト `network-clear-race-repro.mjs` は、Clear 後に `GET https://example.test/slow` が1件追加されることを示しました。

### 4. Medium — Clear 後に、Clear 前の debounce 中 input が User Action として追加される

操作記録は input ごとに 350 ms の debounce を設定します。[7] `InteractionTracker.clear()` は action 配列と ID を初期化しますが、保留中のタイマーを取消しません。[7] 記録中に input を発火させ、350 ms を待たずに Clear を押すと、Clear より前の入力が後から新しい action として追加されます。

この競合は Clear の直後に再現操作を開始するほど見えやすく、同じ ID `action-1` が旧操作に再利用されます。DebugSession は Clear 時に InteractionTracker も消去するため、統合 Timeline / AI Export の事実関係にも混入します。[8]

| 項目 | 内容 |
|---|---|
| 場所 | `src/panel/interaction-tracker.ts` の input debounce（87–100行）と `clear()`（142–151行） |
| 再現条件 | input イベント発火後、350 ms 未満で Clear を実行し、保留タイマーを満了させる。 |
| 実測結果 | Clear 直後は action 0件だが、タイマー満了後に `action-1` の input が1件追加された。 |
| 利用者影響 | Clear 後の記録へ前セッションの操作・入力値が混入し、再現手順や時系列の信頼性が低下する。 |
| 推奨修正 | `inputTimers` を `WeakMap` だけでなく反復可能な `Map` または timer Set でも管理し、`clear()` と `stop()` で全 timer を取消する。Network と同様に generation を照合すると、stop→start が短時間に起きた場合の古い callback 再混入も防げる。 |
| 必要な回帰テスト | debounce 待機中の Clear 後に action が追加されないこと、stop→start の直後にも旧タイマーが新セッションへ混入しないことを検証する。 |

> 再現スクリプト `interaction-clear-repro.mjs` は、Clear 前の input がタイマー満了後に `action-1` として追加されることを示しました。

## テスト状況と未検出だった理由

| 確認 | 結果 | 評価 |
|---|---|---|
| `pnpm install --frozen-lockfile` | 成功 | ロックファイルどおりに依存関係を導入。 |
| `pnpm run typecheck` | 成功 | 型エラーなし。 |
| `pnpm run build` | 成功 | `dist/` を生成。 |
| `node --test tests/*.test.mjs` | 33 passed / 0 failed | 正常系・既存の上限・基本的な lifecycle は通過。 |
| 追加の独立再現 | 4件失敗を観測 | 上記の境界条件を既存テストがカバーしていない。 |

既存テストが成功していることは、現行テストで表現された仕様には適合していることを示します。しかし、Snapshot の公開ドキュメントとの整合、部分失敗の可観測性、および非同期処理と Clear 操作の線形化は別途検証する必要があります。

## 推奨する修正順序

まず、分析結果を誤らせる Snapshot の2件を優先してください。比較対象と文書を整合させ、不完全な Snapshot を明確に識別可能にすることで、デバッガとしての証拠品質を回復できます。次に、Network と Interaction の双方で generation / cancellation を導入し、Clear または Stop より前に開始した非同期処理が後続セッションへ影響しないことを保証するのが適切です。

| 順序 | 対応 | 完了条件 |
|---:|---|---|
| 1 | Snapshot Diff 対象を仕様と一致させる | Page、Environment、Cookie の変更をテストで検出できる。 |
| 2 | Snapshot の部分失敗を型・UI・AI Export で可視化する | 空状態と取得失敗を利用者が識別できる。 |
| 3 | Network の Clear/Stop 世代管理を追加する | Clear 前の未完了通信が再追加されない。 |
| 4 | Interaction の debounce timer を取消・世代管理する | Clear/Stop 前の input が後続記録へ混入しない。 |
| 5 | 回帰テストを既存の `tests/*.test.mjs` に統合する | 上記4条件を含む `pnpm run verify` が成功する。 |

## 調査上の制約

本調査は指定コミットのソースコード、ビルド、Node ベースの自動テスト、および Chrome API を模した再現環境で行いました。実ブラウザでの長時間の負荷試験、複数フレーム、Service Worker の中断・再開、実サイト固有の CSP / 権限制約は今回の対象外です。したがって、上記4件は確認済みの不具合であり、これ以外の不具合が存在しないことを保証するものではありません。

## 参照

[1]: https://github.com/tonbiattack/web-state-inspector/blob/c8f9222ddf6ece7f5b482719712ffb2815902197/docs/user-guide-ja.md#L156-L168 "Snapshot Diff の公開仕様"
[2]: https://github.com/tonbiattack/web-state-inspector/blob/c8f9222ddf6ece7f5b482719712ffb2815902197/src/panel/snapshot-service.ts "Snapshot 取得・比較実装"
[3]: https://github.com/tonbiattack/web-state-inspector/blob/c8f9222ddf6ece7f5b482719712ffb2815902197/src/shared/types.ts "Snapshot 型定義"
[4]: https://github.com/tonbiattack/web-state-inspector/blob/c8f9222ddf6ece7f5b482719712ffb2815902197/src/panel/main.ts#L1016-L1028 "Snapshot UI の失敗処理"
[5]: https://github.com/tonbiattack/web-state-inspector/blob/c8f9222ddf6ece7f5b482719712ffb2815902197/src/panel/network-collector.ts "Network 記録実装"
[6]: https://github.com/tonbiattack/web-state-inspector/blob/c8f9222ddf6ece7f5b482719712ffb2815902197/README.md#L42-L55 "Debug Recording と Clear の利用者契約"
[7]: https://github.com/tonbiattack/web-state-inspector/blob/c8f9222ddf6ece7f5b482719712ffb2815902197/src/panel/interaction-tracker.ts "操作追跡実装"
[8]: https://github.com/tonbiattack/web-state-inspector/blob/c8f9222ddf6ece7f5b482719712ffb2815902197/src/panel/debug-session.ts "統合デバッグセッション実装"
