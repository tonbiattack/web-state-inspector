---
name: chrome-web-store-assets
description: Use when preparing or refreshing Chrome Web Store icons and screenshots from real extension UI captures, especially when transparent icon edges or excessive screenshot margins need consistent treatment.
---

# Chrome Web Store Assets

Generate the four store-listing images from an actual extension icon and three actual 1280×800 UI captures. The purpose is to give the icon a clean white surround and turn otherwise unused screenshot margins into a concise product explanation without fabricating the extension UI.

## Inputs and outputs

Keep source captures outside the generated asset paths. The script writes only:

- `store-icon-128.png` — 128×128 PNG with opaque white corners.
- `screenshots/1.png` through `3.png` — 1280×800, 24-bit RGB PNGs.

The icon source must be a transparent 128×128 PNG. Each screenshot source must be an uncropped 1280×800 PNG. `SidePanel` is the default layout for compact popup UI and crops from `(365, 16)` at `550×754`; change the `UiCrop*` parameters when needed. Use `TopBanner` for full-width DevTools UI: it reserves a factual 120px headline and retains the paired screenshot below it.

## Compose

Run from the repository root. Provide the original transparent extension icon, not the already padded store icon. Use real captures that do not expose profile data, URLs, or other private content.

```powershell
$sourceScreenshots = @(
  'docs\chrome-web-store\source\1.png'
  'docs\chrome-web-store\source\2.png'
  'docs\chrome-web-store\source\3.png'
)

powershell -NoProfile -ExecutionPolicy Bypass -File skills\chrome-web-store-assets\scripts\compose-store-assets.ps1 `
  -IconSource static\icons\icon-128.png `
  -ScreenshotSources $sourceScreenshots `
  -Layout TopBanner `
  -BrandName 'Web State Inspector' `
  -CaptionTitles @('Timeline で時系列を確認', 'Network の成功・失敗を確認', 'AI Export 前に内容を確認') `
  -CaptionBodies @('ローカル sample page で記録した操作・通信・エラー', 'ローカル sample page のリクエスト一覧と詳細', '外部送信せずローカルでデバッグ文脈を整形') `
  -OutputRoot (Join-Path $env:TEMP 'arrow-button-mapper-store-assets-preview')
```

Review this preview before omitting `-OutputRoot`, which writes to `docs\chrome-web-store\assets`. `-IconInset` changes the white outer margin. Pass `-BrandName`, `-Tagline`, `-CaptionTitles`, and `-CaptionBodies` for the actual product; never retain another product's captions.

The script flattens low-alpha edge pixels to white before resizing. Keep that step: the source icon has semi-transparent dark pixels that otherwise create a gray square on the Store's white backdrop.

## Review and validate

1. Open all four output files at native size. The icon should have no transparent or gray corners; text must not clip; the popup must remain the dominant element and retain its original proportions.
2. Check that the explanatory panel names the actual state displayed in its paired screenshot. Do not use it to invent features or controls.
3. Run the composition verification and project checks:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File skills\chrome-web-store-assets\tests\verify-compose-store-assets.ps1
npm test
git diff --check
```

The verification creates temporary synthetic inputs and confirms filenames, dimensions, image formats, the icon's white corner, and a non-blank screenshot panel.
