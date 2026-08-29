# Chrome拡張の `Unexpected token 'export'` を追う: content script と ES Modules の境界

## この資料の目的

iframe対応後に、対象ページで次のエラーが繰り返し表示された。

```text
Uncaught SyntaxError: Unexpected token 'export'
```

この資料は、エラーを「iframeで例外が出た」とだけ扱わず、Chrome拡張がどの形式でJavaScriptを実行するか、ビルド成果物をどう検証するかを学ぶための記録である。対象はWeb State InspectorのAI Debug Bridgeであり、ページの状態を要求時だけ読み取るための経路である。

## 結論

原因はiframeのDOM処理ではなく、**classic scriptとして実行される二つのbridgeファイルにES module構文が残っていたこと**である。

| ファイル | 読み込まれ方 | 修正前に残っていた構文 | 結果 |
|---|---|---|---|
| `bridge/content-bridge.js` | `manifest.json` の `content_scripts` | `export {};` | Chromeが構文解析時に停止する |
| `bridge/page-bridge.js` | content scriptが作る通常の`script`要素 | `import ...` と `export` | ページへ挿入した時点で構文解析できない |

TypeScriptの型検査が通っても、Chromeがそのファイルをclassic scriptとして構文解析できることは保証されない。今回の修正では、二つのbridgeをIIFE（即時実行関数）へbundleしてから`dist/`へ配置するようにした。

## どのコードが、どこで動くか

Bridgeの要求と応答の流れは次のとおりである。

```text
対象ページのJavaScript
  └─ page-bridge.js
       └─ window.postMessage
            └─ content-bridge.js
                 └─ chrome.runtime.sendMessage
                      └─ background / DevTools panel
```

`static/manifest.json`は`content-bridge.js`を`content_scripts`として指定している。これは通常のJavaScriptとして読み込まれるため、ファイル先頭や末尾にES moduleの`import`や`export`を置けない。

`content-bridge.ts`は、ページ側のAPIを公開するために`script.src = chrome.runtime.getURL('bridge/page-bridge.js')`で`page-bridge.js`を追加する。この`script`要素にも`type="module"`は指定していないため、同じくclassic scriptとして解釈される。

## 発生した仕組み

ソースはTypeScriptのES moduleとして書かれている。

```ts
// src/bridge/content-bridge.ts
import type { BridgeRequest, BridgeResponse } from '../shared/ai-bridge-types.js';
```

型だけのimportは実行時には不要である。しかし、TypeScriptのESM出力は、このファイルをmoduleとして扱う印に`export {};`を出力することがある。以前のビルド工程は、TypeScriptの出力を`build/`へ作り、そのまま`dist/`へコピーするだけだった。

```text
src/bridge/content-bridge.ts
  └─ tsc
       └─ build/bridge/content-bridge.js  // export {}; が残る
            └─ copy
                 └─ dist/bridge/content-bridge.js
```

その結果、Chromeはcontent scriptを実行する前、`export`を構文解析した段階で失敗する。関数本体にあるiframe登録、message listener、runtime message送信は、いずれも実行されない。

`page-bridge.ts`は型だけでなく共有定数をruntime importしており、`import`と`export`がそのまま出力されていた。仮にcontent bridgeの問題だけを取り除いても、注入先ページでpage bridgeが失敗するため、二ファイルをまとめて直す必要があった。

## iframe対応との関係

iframe対応の変更で`all_frames: true`になった。これは同じcontent scriptをトップページだけでなく、アクセス可能なiframe文書にも読み込もうとする設定である。

この変更は`export`という構文を導入してはいない。修正前の履歴でも`content-bridge.js`には`export {};`が存在したため、根本原因は以前から存在していた。

ただし`all_frames: true`により、対象文書が増えた。そのため同じ構文エラーが複数のframeで起き、iframe対応後に目立つようになった可能性が高い。これは次の二つを分けて考える例になる。

| 観点 | 判断 |
|---|---|
| 根本原因 | classic scriptへES module構文を配布したこと |
| 顕在化を増やした変更 | `all_frames: true`による実行対象frameの増加 |

「変更後に発見された」ことだけでは、その変更が根本原因だとは言えない。直前版の生成物と差分を確認して、原因と発見契機を分ける。

## 修正内容

`scripts/build.mjs`で、通常のTypeScriptコンパイルと`dist/`へのコピーを終えた後、次の二つだけをesbuildでbundleするようにした。

```js
for (const name of ['content-bridge', 'page-bridge']) {
  await build({
    entryPoints: [resolve(buildDir, 'bridge', `${name}.js`)],
    outfile: resolve(distDir, 'bridge', `${name}.js`),
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: 'es2022',
  });
}
```

IIFEは自己完結した通常のJavaScriptである。`page-bridge.js`が必要とする共有定数も同じファイルに含まれるため、配布後のbridgeにはトップレベルの`import`も`export`も残らない。

すべての出力をIIFEにしたわけではない。`background/service-worker.js`はmanifestで`"type": "module"`と明示されており、ES moduleとして読み込む設計である。**実行方法ごとに必要な出力形式を選ぶ**ことが重要である。

## なぜ既存の検証を通ったのか

修正前も`tsc --noEmit`は成功していた。これは型、importの解決、TypeScriptとしての構文を検査するためであり、Chromeのcontent script実行形態までは検査しない。

NodeのテストもES moduleを読み込めるため、`src/bridge/page-bridge.ts`をテスト対象にしても問題を再現しない。さらに当時のbuild scriptは、モジュール出力をcopyするだけだったので、配布物にも失敗する構文が残った。

対策として`tests/extension.test.mjs`に次の回帰テストを追加した。

```js
for (const script of [contentBridge, pageBridge]) {
  assert.doesNotMatch(script, /^\s*(?:import|export)\s/m);
}
```

このテストは配布後の`dist/bridge/*.js`を読む。よって、TypeScriptソースが正しくてもパッケージングでESM構文が混入した場合に失敗する。

## 確認手順

### 自動確認

```bash
pnpm install
pnpm run verify
```

`verify`は型検査、配布物の再生成、Nodeテストを順に実行する。今回の修正後は54テストが成功した。

追加で、配布するbridgeを直接確認する場合は次を実行できる。

```powershell
Select-String -Path dist/bridge/content-bridge.js,dist/bridge/page-bridge.js `
  -Pattern '^\s*(import|export)\s'
```

出力がなければ、対象ファイルに行頭のES module宣言は残っていない。

### Chromeでの手動確認

1. `pnpm run build`を実行する。
2. `chrome://extensions/`で、このリポジトリの`dist/`を読み込んだ拡張を**更新**する。
3. 対象ページを再読み込みする。既に読み込まれたcontent scriptは、拡張の更新だけでは現在の文書へ再注入されないためである。
4. `chrome://extensions/`のエラー一覧に`Unexpected token 'export'`が増えないことを確認する。
5. `sample/iframe-demo.html`を開き、iframeを含むページでもFrame LifecycleとFrame Filterを確認する。

## 再発防止のチェックリスト

- manifestの`content_scripts`へ指定するファイルはclassic scriptとして構文解析できるか。
- `document.createElement('script')`で挿入するファイルは、`type="module"`を明示していない限りclassic scriptとしてbundleされているか。
- `tsc`の成功だけでなく、**最終配布物の`dist/`**をテストしているか。
- iframe、top frame、service worker、DevTools pageのように実行コンテキストが異なる場合、各ファイルの読み込み方法を表にして確認したか。
- 不具合が変更直後に見つかった場合、直前の生成物にも同じ失敗条件がないか比較し、根本原因と顕在化要因を分けたか。

## 関連ファイル

| 役割 | ファイル |
|---|---|
| content scriptの指定 | `static/manifest.json` |
| content scriptのソース | `src/bridge/content-bridge.ts` |
| ページへ注入するbridgeのソース | `src/bridge/page-bridge.ts` |
| パッケージング | `scripts/build.mjs` |
| 配布物の回帰テスト | `tests/extension.test.mjs` |

修正コミット: `e6fee42 fix: bundle bridge scripts for classic execution (#8)`
