# Chrome Web Store 公開に向けた修正指示書

## 目的

Web State Inspector を Chrome Web Store で一般公開できる状態へ整える。

本ツールの価値は、DevTools 上で操作・通信・Storage 変更・エラーを同一 Timeline にまとめ、必要な文脈をローカルで Markdown / JSON に整形できる点にある。Store 公開にあたっては、この機能を維持しつつ、権限・プライバシー・説明責任を明確にする。

特に以下を公開品質の基準とする。

- 外部 API、独自サーバー、AI サービスへ収集データを送信しない
- 必要最小限の Chrome 権限だけを要求する
- Cookie、URL、Network body、Storage 等を扱うことを利用者へ明示する
- 「AI Export」が AI への自動送信ではなく、ローカルで Markdown / JSON を生成する機能だと明示する
- GitHub の Public リポジトリを実装確認・Issue 報告先として利用できる状態にする

## 1. Manifest の権限を再検証する

現状の配布物では以下を要求している。

```json
{
  "permissions": ["cookies", "webNavigation"],
  "host_permissions": ["<all_urls>"]
}
```

Chrome Web Store は、実装済み機能に必要な最小権限だけを要求することを求めている。そのため、各権限について「現在のどの機能に必要か」をコードレベルで再確認する。

### cookies

Cookie Inspector で `chrome.cookies.getAll()` を使用しているため、現状では必要。

ただし、次を検討する。

- DevTools の検査対象ページだけに利用範囲を限定できているか
- Cookie 機能を optional permission 化できるか
- Cookie 表示を利用者が明示的に開いた場合だけ権限要求する設計にできないか

機能性を大きく損なう場合は無理に optional 化しない。その場合は権限が必要な理由を Store 掲載情報と Privacy Policy に明記する。

### host_permissions: <all_urls>

過去の設計では Cookie 取得のために採用している。

削除を前提にせず、以下を比較検証する。

1. `<all_urls>` を必須権限として維持
2. `optional_host_permissions` として、検査時に対象 origin だけ許可
3. Cookie Inspector のみ追加権限を要求

DevTools 拡張として任意サイトを検査する性質上、最終的に `<all_urls>` が必要なら維持してよい。ただし「なぜ全サイトへのアクセスが必要なのか」を Store 上で説明できることを必須条件とする。

### webNavigation

SPA の Route Change 取得等で本当に必要か確認する。

`chrome.devtools.inspectedWindow`、page bridge、History API の監視など、既存のより限定的な仕組みだけで現在の機能を維持できるなら削除する。

Chrome では `webNavigation` が閲覧履歴へのアクセス警告につながるため、使用していない、または代替可能なら優先して削除する。

### 完了条件

- Manifest の各 permission / host permission に対応する利用箇所が説明できる
- 不要な permission が存在しない
- 権限削減後も既存の `pnpm run verify` が成功する
- 必要に応じて権限に関する回帰テストを追加する

## 2. データ取り扱いを明文化する

本拡張は以下の情報を扱い得る。

- URL / Route
- Cookie
- Local Storage / Session Storage
- HTTP request / response metadata
- request / response body
- HTTP headers
- Authorization 等の認証情報を含み得る値
- ユーザー操作
- JavaScript / Console Error
- 選択要素の情報

これらは Chrome Web Store 上でユーザーデータとして扱われ得るため、「サーバーへ送っていないから説明不要」と考えない。

### Privacy Policy を追加

`PRIVACY.md` または `docs/privacy-policy.md` を追加する。

最低限、以下を記載する。

- 何を取得・処理するか
- 取得目的は Web アプリのデバッグに限定されること
- 記録は利用者が Start Recording した後に行われること
- 独自サーバーへ送信しないこと
- AI サービスへ自動送信しないこと
- テレメトリ / 広告目的の送信を行わないこと
- AI Export はローカル生成であること
- Copy 後に利用者自身が第三者サービスへ貼り付けたデータは拡張の管理外になること
- Network body、Cookie、Authorization、個人情報等が含まれる可能性
- データ保持場所と削除方法
- Chrome Web Store User Data Policy の Limited Use 要件に従う旨

README から Privacy Policy へリンクする。

## 3. 機密情報の誤共有対策を強化する

現在は自動マスキングを行わず、利用者に確認を求める設計になっている。

Store 公開では、少なくとも AI Export / Copy event context の実行前または出力画面で、以下を明確に表示する。

> Exported data may contain cookies, authorization headers, tokens, request/response bodies, personal information, or other sensitive data. Review it before sharing.

日本語 UI の場合も同等の警告を表示する。

将来的な改善候補として以下を検討するが、Store 公開の必須条件にはしない。

- Authorization header のデフォルトマスク
- Cookie 値のデフォルトマスク
- token / secret / password らしい key のマスク
- 「Include sensitive values」の明示 opt-in

自動マスクを追加する場合、完全な秘密情報検出を保証する表現は使わない。

## 4. 「AI Export」の誤解を防ぐ

名称だけでは外部 AI API へデータを送る機能に見える可能性がある。

UI、README、Store 説明の少なくとも一箇所で以下を明示する。

> AI Export does not call an AI service. It only formats the captured debug context locally as Markdown or JSON.

必要なら表示名を以下のように変更することも検討する。

- AI Context Export
- Export for AI
- Copy Debug Context for AI

機能自体を AI API と接続しない。

## 5. Chrome Web Store 掲載情報を用意する

### 推奨タイトル

`Web State Inspector – Debug Timeline for DevTools`

長さ制限等に抵触する場合は `Web State Inspector` を維持する。

### 一文説明案

> Capture user actions, network requests, storage changes, and errors in one DevTools timeline, then export the relevant context locally for debugging or AI assistance.

### 強調する特徴

- Unified debugging timeline
- Network request / response inspection
- Storage / Cookie inspection
- Context window around a selected event
- Local Markdown / JSON export
- No external server
- No AI API
- No telemetry

「No external server」「No AI API」「No telemetry」は実装がその状態であることを公開前に再確認する。

## 6. Store 用画像を準備する

最低限、実際の拡張 UI を使ったスクリーンショットを用意する。

候補:

1. Timeline 全体
2. エラーを選択して前後のイベントが見えている状態
3. Network 詳細
4. AI Export
5. Storage / Cookie Inspector

スクリーンショットには実在サービスの Cookie、token、個人情報、社内 URL 等を含めない。専用 sample page を使用する。

Store 用アイコンについても、必要サイズを build 成果物へ含める。

## 7. README を Store 公開版へ更新する

公開後は README 冒頭に以下を追加する。

- Chrome Web Store のインストールリンク
- GitHub から手動インストールする開発者向け手順
- Privacy Policy
- Issue tracker

Store 公開前はリンク先が存在しないため、プレースホルダー URL を main へ入れない。

## 8. OSS としての公開状態を整える

GitHub Public と Chrome Web Store 公開は併用する。

確認事項:

- LICENSE が存在するか
- API key / token / private key / credential が Git 履歴・配布物に含まれていないか
- sample データに実データが含まれていないか
- `.env` 等が誤って追跡されていないか
- Issue 報告時に Cookie / token 等を貼らないよう Issue template で注意できるか

LICENSE が未設定の場合は、公開前に採用ライセンスを明示的に決定する。勝手に MIT 等を追加しない。

## 9. Single Purpose を明確にする

Chrome Web Store 上での単一目的は以下とする。

> Web アプリのデバッグに必要な操作・状態変更・通信・エラーを DevTools 上で関連付けて確認し、必要なデバッグコンテキストをローカルで出力する。

Storage Viewer、Cookie Viewer、Network Viewer、AI Export は別々の目的ではなく、このデバッグ目的を実現する補助機能として説明する。

新機能を追加する際も、この目的から外れる機能を安易に追加しない。

## 10. 公開前テスト

既存の `pnpm run verify` に加え、実Chromeで以下を確認する。

- 新規インストール
- DevTools パネル表示
- Start / Stop Recording
- User Action
- SPA Route Change
- Storage Change
- Network 成功 / 失敗
- response body
- JavaScript / Console Error
- Cookie 表示
- Copy event context
- AI Export Markdown
- AI Export JSON
- Pause / Resume updates
- Reload 後の挙動
- 権限拒否時の挙動
- Cookie / host permission を optional 化した場合の許可・拒否・再許可

特に権限拒否時にパネル全体が壊れず、「Cookie のみ利用不可」のように graceful degradation できることを確認する。

## 11. 公開判断チェックリスト

- [ ] Manifest の権限を全件再検証した
- [ ] 不要な権限を削除した
- [ ] `<all_urls>` が必要なら理由を説明できる
- [ ] Privacy Policy を公開した
- [ ] Limited Use に関する説明を追加した
- [ ] 取得・処理するデータを Store 上で正確に申告できる
- [ ] 外部送信が存在しないことをコードで再確認した
- [ ] AI API を呼んでいないことを確認した
- [ ] telemetry が存在しないことを確認した
- [ ] Export 時の機密情報警告を確認した
- [ ] Store 用アイコンを準備した
- [ ] Store 用スクリーンショットを準備した
- [ ] Store の説明文を準備した
- [ ] LICENSE の有無と内容を確認した
- [ ] secret scan を実施した
- [ ] `pnpm run verify` が成功した
- [ ] 実Chromeで主要フローを確認した

## 優先順位

### P0: Store 申請前に必須

1. Manifest 権限の再検証
2. Privacy Policy
3. データ取り扱い・Limited Use の明記
4. Export 時の機密情報警告
5. Store 掲載文言
6. アイコン / スクリーンショット
7. secret / sample data の確認
8. 公開前テスト

### P1: 可能なら申請前

1. `webNavigation` の削除検討
2. host permission / Cookie permission の optional 化検討
3. Issue template の機密情報注意書き
4. README の公開導線整理

### P2: 公開後でもよい

1. Authorization / Cookie / token の自動マスキング
2. Export 項目の細かな opt-in
3. Store 公開後の README リンク追加

## 実装方針

Store 審査のためだけに既存のデバッグ能力を大幅に落とさない。

一方で「便利だから」「将来使うかもしれない」という理由で強い権限を残さない。権限が必要なら、その権限がユーザー向け機能のどこに必要なのかをコード・ドキュメント・Store 掲載情報の三者で一致させる。

本拡張は機密性の高いデバッグ情報を扱えるため、**ローカル処理・外部送信なし・利用者自身が共有前に確認できること**をプロダクト上の強みとして維持する。
