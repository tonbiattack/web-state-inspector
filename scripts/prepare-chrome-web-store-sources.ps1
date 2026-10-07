[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [ValidateNotNullOrEmpty()]
    [string[]]$ScreenshotSources,

    [string]$OutputRoot = 'docs\chrome-web-store\source',

    [ValidateRange(0, 1919)]
    [int]$CropX = 0,

    [ValidateRange(0, 1031)]
    [int]$CropY = 50,

    [ValidateRange(1, 1920)]
    [int]$CropWidth = 1280,

    [ValidateRange(1, 1032)]
    [int]$CropHeight = 780
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

if ($ScreenshotSources.Count -ne 3) {
    throw 'Specify exactly three raw screenshot sources.'
}

function Save-PngAtomically {
    param([System.Drawing.Image]$Image, [string]$Destination)

    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Destination) | Out-Null
    $temporary = Join-Path (Split-Path -Parent $Destination) ('.' + [Guid]::NewGuid() + '.png')
    try {
        $Image.Save($temporary, [System.Drawing.Imaging.ImageFormat]::Png)
        Move-Item -LiteralPath $temporary -Destination $Destination -Force
    }
    finally {
        if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary -Force }
    }
}

for ($index = 0; $index -lt $ScreenshotSources.Count; $index++) {
    $inputPath = $ScreenshotSources[$index]
    if (-not (Test-Path -LiteralPath $inputPath -PathType Leaf)) {
        throw "Screenshot source was not found: $inputPath"
    }

    $source = [System.Drawing.Bitmap]::new((Resolve-Path -LiteralPath $inputPath).Path)
    try {
        if ($source.RawFormat.Guid -ne [System.Drawing.Imaging.ImageFormat]::Png.Guid) {
            throw "Screenshot source must be a PNG: $inputPath"
        }
        if (($CropX + $CropWidth) -gt $source.Width -or ($CropY + $CropHeight) -gt $source.Height) {
            throw "The selected crop does not fit within: $inputPath"
        }

        # Keep the DevTools panel at native scale and leave a small neutral footer instead of showing browser help UI.
        $output = [System.Drawing.Bitmap]::new(1280, 800, [System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
        try {
            $graphics = [System.Drawing.Graphics]::FromImage($output)
            try {
                $graphics.Clear([System.Drawing.Color]::FromArgb(17, 24, 39))
                $graphics.DrawImage($source, [System.Drawing.Rectangle]::new(0, 0, 1280, 780), [System.Drawing.Rectangle]::new($CropX, $CropY, $CropWidth, $CropHeight), [System.Drawing.GraphicsUnit]::Pixel)
            }
            finally { $graphics.Dispose() }
            Save-PngAtomically -Image $output -Destination (Join-Path $OutputRoot "$($index + 1).png")
        }
        finally { $output.Dispose() }
    }
    finally { $source.Dispose() }
}

Write-Output "Prepared three 1280x800 Store sources under $OutputRoot."
