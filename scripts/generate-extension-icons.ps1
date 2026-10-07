[CmdletBinding()]
param(
    [string]$IconSource = 'static\icons\icon-master.png',
    [string]$OutputRoot = 'static\icons',
    [ValidateRange(0, 48)]
    [int]$PaddingAt128 = 18
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

if (-not (Test-Path -LiteralPath $IconSource -PathType Leaf)) {
    throw "Icon source was not found: $IconSource"
}

$source = [System.Drawing.Bitmap]::new((Resolve-Path -LiteralPath $IconSource).Path)
try {
    if ($source.RawFormat.Guid -ne [System.Drawing.Imaging.ImageFormat]::Png.Guid) {
        throw "Icon source must be a PNG: $IconSource"
    }

    New-Item -ItemType Directory -Force -Path $OutputRoot | Out-Null
    foreach ($size in 16, 32, 48, 128) {
        $padding = [Math]::Round($size * $PaddingAt128 / 128.0, [System.MidpointRounding]::AwayFromZero)
        $targetSize = $size - (2 * $padding)
        $canvas = [System.Drawing.Bitmap]::new($size, $size, [System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
        try {
            $graphics = [System.Drawing.Graphics]::FromImage($canvas)
            try {
                $graphics.Clear([System.Drawing.Color]::White)
                $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
                $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
                $graphics.DrawImage($source, [System.Drawing.Rectangle]::new($padding, $padding, $targetSize, $targetSize))
            }
            finally { $graphics.Dispose() }

            $destination = Join-Path $OutputRoot "icon-$size.png"
            $temporary = Join-Path $OutputRoot ('.' + [Guid]::NewGuid() + '.png')
            try {
                $canvas.Save($temporary, [System.Drawing.Imaging.ImageFormat]::Png)
                Move-Item -LiteralPath $temporary -Destination $destination -Force
            }
            finally {
                if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary -Force }
            }
        }
        finally { $canvas.Dispose() }
    }
}
finally { $source.Dispose() }

Write-Output "Generated white-padded extension icons under $OutputRoot."
