# State Change Timeline: 設計判断

## 目的

Storageが「いつ」「どの操作で」「どの値からどの値へ」変化したかを、DevToolsパネルで時系列に追跡する。初期版では、現在のドキュメントで実行される`Storage`標準メソッドを対象にする。

## 採用する検知方式

`storage`イベントだけでは、変更を起こした同一ページではイベントが発火しない。イベントは同じStorage領域を共有する**別の文書**で発火する仕様であるため、同一ページ上の操作原因を追跡する唯一の手段にはならない。[1] [2]

そのため、記録開始時に検査対象ページのメインフレームで`Storage.prototype.setItem`、`removeItem`、`clear`をラップする。各ラッパーは操作前に値を読み、元のメソッドを一度だけ同期実行した後、操作後の値、時刻、操作種別、キー、短い呼び出しスタックを固定長リングバッファへ記録する。`Storage`はKey/Value文字列を保持し、`setItem`、`removeItem`、`clear`が標準の更新APIである。[2]

DevTools拡張は`chrome.devtools.inspectedWindow.eval()`により検査対象ページのメインフレームのJavaScript文脈を利用できる。[3] 記録はページ内にのみ保持し、DevToolsパネルがポーリングしてJSON互換のイベントコピーを取得する。外部通信、Storage書込み、Cookie書込みは行わない。

## 表示する情報

| 項目 | 内容 |
|---|---|
| 記録時刻 | `performance.now()`と`Date.toISOString()`によるタイムスタンプ |
| Storage種別 | localStorage または sessionStorage |
| 操作 | `setItem`、`removeItem`、`clear`、別文書からの`storage`イベント |
| Key | 対象キー。`clear`では複数キーの要約 |
| Before / After | 変更前後の文字列値。大きな値はUI表示時に切り詰める |
| 実行箇所 | `new Error().stack`から拡張内部フレームを除去した上位フレーム |
| 結果 | 成功または元APIが送出したエラー |

## 制約と対象外

| 制約 | 理由・扱い |
|---|---|
| 記録開始前の変更 | 計測フックが存在しないため遡及できない。 |
| ページ再読み込み後 | ページ内バッファは失われる。必要なら再度Recordを開始する。 |
| `localStorage.key = value`のようなプロパティ代入 | 標準APIの利用を推奨し、初期版では`setItem`等のメソッドフックを主対象とする。[2] |
| Cookie / IndexedDB / Cache Storage | APIが非同期・多様で、原因情報を正確に保つため初期版では対象外。後続拡張候補とする。 |
| iframe | メインフレームのみ。異なる実行文脈を誤って混在させない。 |
| 信頼性 | ページは計測フックを上書きできるため、計測対象のページは信頼できる開発環境を前提とする。 |

> `storage`イベントは補助情報として、同一originの別文書で発生した変更を`external-storage-event`として記録する。ただし、イベント発生元のJavaScriptスタックはブラウザから提供されないため、操作箇所は「別文書からの変更」と表示する。

## 参考資料

[1]: https://developer.mozilla.org/en-US/docs/Web/API/Window/storage_event "Window: storage event | MDN Web Docs"
[2]: https://developer.mozilla.org/en-US/docs/Web/API/Web_Storage_API/Using_the_Web_Storage_API "Using the Web Storage API | MDN Web Docs"
[3]: https://developer.chrome.com/docs/extensions/reference/api/devtools/inspectedWindow "chrome.devtools.inspectedWindow | Chrome for Developers"
