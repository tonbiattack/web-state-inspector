# Store assets

`store-icon-128.png` と `storage-cookies.png` は次のコマンドで再生成する。

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\compose-store-assets.ps1
```

`storage-cookies.png` は、ローカルデモを DevTools で検査した実画面の既存キャプチャから生成している。公開直前には現在の拡張ビルドと local sample page を使い、Timeline、event context、Network、AI Export、Storage/Cookie の画面を追加撮影する。実在サービスや機密情報をキャプチャへ含めない。
