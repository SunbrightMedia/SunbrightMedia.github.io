# Makes a small zip (themes, fonts, file lists) from the Live12-UI-Extract folder
# that extract-live12-ui-windows.ps1 already put on your Desktop.
#
# Run in PowerShell:
#   powershell -ExecutionPolicy Bypass -File "$HOME\Downloads\pack-live12-ui-small.ps1"

$ErrorActionPreference = 'SilentlyContinue'
$desk = [Environment]::GetFolderPath('Desktop')
$src  = Join-Path $desk 'Live12-UI-Extract'
$out  = Join-Path $desk 'Live12-UI-Small'
if (-not (Test-Path $src)) { Write-Host "Couldn't find $src - run extract-live12-ui-windows.ps1 first."; exit 1 }
Remove-Item -Recurse -Force $out, "$out.zip"
New-Item -ItemType Directory -Force $out | Out-Null

# Text files from the first run
Copy-Item "$src\*.txt" $out

# Themes and fonts, keeping their folders
$keep = '\.(ask|ttf|otf|ttc|woff2?)$'
Get-ChildItem $src -Recurse -File | Where-Object { $_.Name -match $keep } | ForEach-Object {
  $rel = $_.FullName.Substring($src.Length + 1)
  $dst = Join-Path $out $rel
  New-Item -ItemType Directory -Force (Split-Path $dst) | Out-Null
  Copy-Item $_.FullName $dst
}

# What's taking up the space: size per folder, and the 100 largest files
$files = Get-ChildItem $src -Recurse -File
$files | Group-Object { Split-Path $_.FullName.Substring($src.Length + 1) } |
  ForEach-Object { [pscustomobject]@{ MB = [math]::Round(($_.Group | Measure-Object Length -Sum).Sum / 1MB, 2); Files = $_.Count; Folder = $_.Name } } |
  Sort-Object MB -Descending | Format-Table -AutoSize | Out-String -Width 400 | Set-Content "$out\size-by-folder.txt"
$files | Sort-Object Length -Descending | Select-Object -First 100 |
  ForEach-Object { "{0,10:N0}  {1}" -f $_.Length, $_.FullName.Substring($src.Length + 1) } | Set-Content "$out\largest-files.txt"
# Every image with its size, so specific ones can be asked for
$files | Where-Object { $_.Extension -match '^\.(png|svg|tif|tiff|bmp|ico)$' } |
  ForEach-Object { "{0,10:N0}  {1}" -f $_.Length, $_.FullName.Substring($src.Length + 1) } | Set-Content "$out\images.txt"

Compress-Archive -Path $out -DestinationPath "$out.zip" -Force
$size = [math]::Round((Get-Item "$out.zip").Length / 1MB, 1)
Write-Host ""
Write-Host "Done: $out.zip ($size MB)"
if ($size -gt 29) { Write-Host "That's over 30 MB. Send size-by-folder.txt and largest-files.txt from the Live12-UI-Small folder instead, and I'll narrow it down." }
