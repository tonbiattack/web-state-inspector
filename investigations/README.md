# バグ再現スクリプト

このディレクトリには、2026-08-28 の調査で確認した不具合を、最小限の Node.js 環境で再現するスクリプトを置いています。詳細な影響、根拠、推奨修正は [`../docs/investigations/2026-08-28/bug-investigation-ja.md`](../docs/investigations/2026-08-28/bug-investigation-ja.md) を参照してください。

## 実行方法

依存関係を導入してビルドした後に実行します。各スクリプトは、**現行実装の不具合を検出する回帰テスト候補**であるため、未修正の状態では意図的にアサーションエラーで終了します。

```bash
pnpm install --frozen-lockfile
pnpm run build
node investigations/snapshot-diff-coverage-repro.mjs
node investigations/snapshot-partial-failure-repro.mjs
node investigations/network-clear-race-repro.mjs
node investigations/interaction-clear-repro.mjs
```

| スクリプト | 検証する契約 |
|---|---|
| `snapshot-diff-coverage-repro.mjs` | 公開ガイドで対象とする Page・Cookie の変化が Before / After Diff に現れること。 |
| `snapshot-partial-failure-repro.mjs` | 収集対象が失敗した Snapshot を成功・空状態として扱わないこと。 |
| `network-clear-race-repro.mjs` | Clear 前に開始した未完了の Network 記録が Clear 後に追加されないこと。 |
| `interaction-clear-repro.mjs` | Clear 前に発生した debounce 中の input が Clear 後に追加されないこと。 |

これらのスクリプトは外部サービスへの接続、認証情報の使用、または対象ページの変更を行いません。修正後は、アサーションの期待値を満たす通常の回帰テストとして `tests/` に移すことを推奨します。
