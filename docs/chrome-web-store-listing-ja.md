# Chrome Web Store 掲載情報

公開日、Store URL、Privacy Policy の公開 URL は申請の承認後に確定する。存在しない Store URL を README へ掲載しない。

## タイトル

`Web State Inspector – Debug Timeline for DevTools`

文字数制限に抵触する場合は `Web State Inspector` を使用する。

## 一文説明

Capture user actions, network requests, storage changes, and errors in one DevTools timeline, then export the relevant context locally for debugging or AI assistance.

## 詳細説明

Web State Inspector は、Web アプリのデバッグに必要な操作・状態変更・通信・エラーを Chrome DevTools 上で関連付けて確認し、必要なデバッグコンテキストをローカルで出力する拡張機能です。

- User Action、Route Change、Storage Change、Network、JavaScript / Console Error を一つの Timeline に集約
- Network request / response の metadata、headers、body を確認
- Local Storage、Session Storage、Cookie を読み取り専用で確認
- 選択イベントの前後にある関連コンテキストをコピー
- Markdown / JSON をローカル生成する AI Export

外部サーバー、AI API、テレメトリ、広告目的の送信は行いません。AI Export は AI サービスへ送信せず、収集済みのデバッグコンテキストをローカルで Markdown / JSON に整形するだけです。

Cookie、Authorization header、token、request / response body、個人情報が含まれる可能性があるため、コピーまたは共有する前に必ず内容を確認してください。

## 権限の説明

| 権限 | 必要な機能 | 利用範囲 |
| --- | --- | --- |
| `cookies` | Cookie Inspector | DevTools で利用者が検査している HTTP/HTTPS origin の Cookie を読み取り専用で表示する。書き込み・削除は行わない。 |
| `<all_urls>` | Cookie Inspector とページ bridge | 任意サイトを検査できる DevTools 拡張として、対象 origin の Cookie 読み取りと、DevTools 検査を支えるページ bridge に使用する。bridge は外部送信を行わず、録画を開始するまでページデータを保持しない。 |
| `webNavigation` | Frame Lifecycle | 録画中の検査タブに限り、main frame と iframe の追加・遷移・削除を Timeline に記録し、選択したイベントの前後関係を把握できるようにする。 |

## データの取り扱い

処理対象、ローカル保持、削除方法、外部送信の有無、Limited Use への対応は [Privacy Policy](../PRIVACY.md) を参照する。

## 提出用画像（公開前ゲート）

現在のビルドを読み込んだ Chrome で、ローカル sample page を検査してから撮影する。次の各 1280 × 800 PNG を提出用に用意する。

1. Timeline 全体
2. エラーを選択し、前後のイベントを表示した状態
3. Network 詳細
4. AI Export と機密情報警告
5. Storage / Cookie Inspector

実在サービスの Cookie、token、個人情報、社内 URL は含めない。旧 UI や外部サイトを含むキャプチャは Store へ提出しない。
