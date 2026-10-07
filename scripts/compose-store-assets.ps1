param(
  [string]$OutputDirectory = (Join-Path $PSScriptRoot '..\docs\chrome-web-store\assets')
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

function Save-Png([System.Drawing.Image]$image, [string]$path) {
  $directory = Split-Path -Parent $path
  [System.IO.Directory]::CreateDirectory($directory) | Out-Null
  $temporaryPath = "$path.tmp"
  try {
    $image.Save($temporaryPath, [System.Drawing.Imaging.ImageFormat]::Png)
    Move-Item -LiteralPath $temporaryPath -Destination $path -Force
  } finally {
    if (Test-Path -LiteralPath $temporaryPath) { Remove-Item -LiteralPath $temporaryPath -Force }
  }
}

$root = Join-Path $PSScriptRoot '..'
$icon = [System.Drawing.Image]::FromFile((Join-Path $root 'static\icons\icon-128.png'))
$source = [System.Drawing.Image]::FromFile((Join-Path $root 'docs\screenshots\storage-json-expanded.png'))
try {
  Save-Png $icon (Join-Path $OutputDirectory 'store-icon-128.png')

  $screenshot = New-Object System.Drawing.Bitmap 1280, 800
  $graphics = [System.Drawing.Graphics]::FromImage($screenshot)
  try {
    $graphics.Clear([System.Drawing.Color]::FromArgb(30, 30, 30))
    $scale = [Math]::Min(1280 / $source.Width, 800 / $source.Height)
    $width = [int][Math]::Round($source.Width * $scale)
    $height = [int][Math]::Round($source.Height * $scale)
    $x = [int][Math]::Floor((1280 - $width) / 2)
    $y = [int][Math]::Floor((800 - $height) / 2)
    $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $graphics.DrawImage($source, $x, $y, $width, $height)
  } finally {
    $graphics.Dispose()
  }
  try { Save-Png $screenshot (Join-Path $OutputDirectory 'storage-cookies.png') } finally { $screenshot.Dispose() }
} finally {
  $icon.Dispose()
  $source.Dispose()
}
