# Chrome Web Store 画像

`screenshots/1.png` から `3.png` は、実際の Chrome DevTools でローカル sample page を検査したキャプチャだけから生成した提出候補である。

| 番号 | 表示状態 | 生キャプチャ |
| --- | --- | --- |
| 1 | Timeline | `docs/img/スクリーンショット 2026-10-07 215415.png` |
| 2 | Network | `docs/img/スクリーンショット 2026-10-07 215627.png` |
| 3 | AI Export | `docs/img/スクリーンショット 2026-10-07 215426.png` |

`source/` はブラウザのツールバーと補助パネルを除いた 1280 × 800 の中間入力である。再生成時はまず `scripts/prepare-chrome-web-store-sources.ps1` を実行し、続けて `skills/chrome-web-store-assets/scripts/compose-store-assets.ps1` を `-Layout TopBanner` と実際の製品名・説明文で実行する。

実在サービスの URL、Cookie、token、個人情報、社内情報を含むキャプチャは使用しない。
