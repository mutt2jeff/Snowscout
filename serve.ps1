# Tiny local web server for trying SnowScout web on this PC.
#   powershell -ExecutionPolicy Bypass -File serve.ps1
# then open http://localhost:8765 . Press Ctrl+C to stop.
# (Only for testing on this computer. Testers use the hosted copy.)

param([int]$Port = 8765)
$root = $PSScriptRoot
$types = @{
  '.html' = 'text/html; charset=utf-8'; '.js' = 'text/javascript; charset=utf-8'
  '.css' = 'text/css; charset=utf-8'; '.json' = 'application/json'; '.webmanifest' = 'application/manifest+json'
  '.png' = 'image/png'; '.svg' = 'image/svg+xml'; '.ico' = 'image/x-icon'
}
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$Port/")
$listener.Start()
Write-Host "SnowScout web running at http://localhost:$Port  (Ctrl+C to stop)"
try {
  while ($listener.IsListening) {
    $ctx = $listener.GetContext()
    $path = [Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath).TrimStart('/')
    if ($path -eq '' -or $path.EndsWith('/')) { $path += 'index.html' }
    $file = [IO.Path]::GetFullPath((Join-Path $root $path))
    $res = $ctx.Response
    if ($env:SNOWSCOUT_SERVE_LOG) {
      Add-Content $env:SNOWSCOUT_SERVE_LOG "$(Get-Date -Format o) $($ctx.Request.HttpMethod) /$path sw=$($ctx.Request.Headers['Service-Worker'])"
    }
    if ($file.StartsWith($root) -and (Test-Path $file -PathType Leaf)) {
      $ext = [IO.Path]::GetExtension($file).ToLower()
      $res.ContentType = if ($types[$ext]) { $types[$ext] } else { 'application/octet-stream' }
      $res.Headers.Add('Cache-Control', 'no-cache')
      $bytes = [IO.File]::ReadAllBytes($file)
      $res.ContentLength64 = $bytes.Length
      $res.OutputStream.Write($bytes, 0, $bytes.Length)
    } else {
      $res.StatusCode = 404
    }
    $res.Close()
  }
} finally {
  $listener.Stop()
}
