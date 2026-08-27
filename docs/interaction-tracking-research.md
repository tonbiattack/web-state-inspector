# User Action / Route Change / Selected DOM: 設計判断

## User Action

メインフレームの`document`でcapture phaseの`click`、`change`、`submit`、`focusin`、`focusout`、`keydown`を監視する。`mousemove`、`scroll`、`pointermove`など、高頻度イベントは記録しない。`input`は入力のたびに発火するため、要素単位で350msのdebounceを適用し、最終入力だけを記録する。[1]

操作対象は`tagName`、id、最初の三つのclass、name、type、短縮したtext、aria-label、data-testidを使う。`outerHTML`やページ全体のHTMLは保存しない。パスワード型inputはvalueを読まず、`[not captured]`を記録する。

## SPA Route Change

`history.pushState`と`history.replaceState`を一時的にラップし、呼出前後の`location.href`を記録する。さらに`popstate`と`hashchange`をイベントリスナで記録する。`pushState()`は新しい履歴エントリを追加するが、`hashchange`を発火させないため、両方を独立して扱う。[2] Stop時は、現在の関数が本拡張のラッパーの場合だけ元の関数へ戻し、アプリが後から差し替えた関数を上書きしない。

## Selected DOM Snapshot

`chrome.devtools.panels.elements.onSelectionChanged`はElementsパネルで選択が変わったときに発火する公開DevTools APIである。[3] 選択したノードは、`chrome.devtools.inspectedWindow.eval()`のDevTools Console APIで利用できる`$0`から、ユーザー操作時にだけJSON互換の簡易情報として取得する。[4] 常時DOMを走査したり、`document.documentElement.outerHTML`を取得したりしない。

SnapshotにはtagName、id、class、短縮textContent、attributes、dataset、disabled、hidden、ARIA属性、boundingClientRectと、display、visibility、opacity、position、z-index、width、height、pointer-events、overflowだけを含める。

## Console

既存の`console.error`ラップを拡張して`console.warn`も記録する。`console.log`は記録しない。引数はJSON化を試行し、循環参照、DOMノード、関数、symbolなどは安全な短縮文字列へ変換する。

## 参考資料

[1]: https://developer.mozilla.org/en-US/docs/Web/API/Element/input_event "Element: input event | MDN Web Docs"
[2]: https://developer.mozilla.org/en-US/docs/Web/API/History/pushState "History: pushState() method | MDN Web Docs"
[3]: https://developer.chrome.com/docs/extensions/reference/api/devtools/panels "chrome.devtools.panels | Chrome for Developers"
[4]: https://developer.chrome.com/docs/extensions/reference/api/devtools/inspectedWindow "chrome.devtools.inspectedWindow | Chrome for Developers"
