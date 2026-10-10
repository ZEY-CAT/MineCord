$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$sourcePath = Join-Path $root 'assets\minecord-icon.png'
$iconPath = Join-Path $root 'assets\minecord.ico'
if (-not (Test-Path -LiteralPath $sourcePath)) {
  throw "MINECORD source icon not found: $sourcePath"
}

$source = [System.Drawing.Bitmap]::new($sourcePath)
try {
  if ($source.Width -ne $source.Height) {
    throw 'The MINECORD source PNG must be square; automatic conversion will not crop it.'
  }

  $sizes = @(16, 24, 32, 48, 64, 128, 256)
  $frames = @()
  foreach ($size in $sizes) {
    $frame = [System.Drawing.Bitmap]::new(
      $size,
      $size,
      [System.Drawing.Imaging.PixelFormat]::Format32bppArgb
    )
    $graphics = [System.Drawing.Graphics]::FromImage($frame)
    $memory = [System.IO.MemoryStream]::new()
    try {
      $graphics.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceCopy
      $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
      $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
      $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
      $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
      $graphics.DrawImage(
        $source,
        [System.Drawing.Rectangle]::new(0, 0, $size, $size),
        0,
        0,
        $source.Width,
        $source.Height,
        [System.Drawing.GraphicsUnit]::Pixel
      )
      $frame.Save($memory, [System.Drawing.Imaging.ImageFormat]::Png)
      $frames += ,$memory.ToArray()
    } finally {
      $memory.Dispose()
      $graphics.Dispose()
      $frame.Dispose()
    }
  }

  $iconStream = [System.IO.MemoryStream]::new()
  $writer = [System.IO.BinaryWriter]::new($iconStream)
  try {
    $writer.Write([UInt16]0)
    $writer.Write([UInt16]1)
    $writer.Write([UInt16]$sizes.Count)

    $offset = 6 + (16 * $sizes.Count)
    for ($index = 0; $index -lt $sizes.Count; $index++) {
      $size = $sizes[$index]
      $frame = $frames[$index]
      $dimension = if ($size -eq 256) { [Byte]0 } else { [Byte]$size }
      $writer.Write($dimension)
      $writer.Write($dimension)
      $writer.Write([Byte]0)
      $writer.Write([Byte]0)
      $writer.Write([UInt16]1)
      $writer.Write([UInt16]32)
      $writer.Write([UInt32]$frame.Length)
      $writer.Write([UInt32]$offset)
      $offset += $frame.Length
    }

    foreach ($frame in $frames) {
      $writer.Write($frame)
    }
    $writer.Flush()
    [System.IO.File]::WriteAllBytes($iconPath, $iconStream.ToArray())
  } finally {
    $writer.Dispose()
    $iconStream.Dispose()
  }
} finally {
  $source.Dispose()
}

Write-Output "Generated $iconPath with sizes: $($sizes -join ', ')"
