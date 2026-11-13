# Makes a small zip with just what the web viewer needs from Live 12:
# themes, the Ableton Sans fonts (not the huge CJK/unifont ones), the Live Set
# file icon, Live's app icon, and the newest Set schema.
# Uses the Live12-UI-Extract folder already on your Desktop.
#
# Run in PowerShell:
#   powershell -ExecutionPolicy Bypass -File "$HOME\Downloads\pack-live12-essentials.ps1"

$ErrorActionPreference = 'SilentlyContinue'
Add-Type -AssemblyName System.Drawing
$desk = [Environment]::GetFolderPath('Desktop')
$src  = Join-Path $desk 'Live12-UI-Extract\app'
$out  = Join-Path $desk 'Live12-Essentials'
if (-not (Test-Path $src)) { Write-Host "Couldn't find $src - run extract-live12-ui-windows.ps1 first."; exit 1 }
Remove-Item -Recurse -Force $out, "$out.zip"
New-Item -ItemType Directory -Force "$out\Themes", "$out\Fonts", "$out\Icons", "$out\Schema" | Out-Null

Copy-Item "$desk\Live12-UI-Extract\*.txt" $out -Exclude 'inventory.txt'
Copy-Item "$src\Resources\Themes\*" "$out\Themes\" -Recurse
Get-ChildItem "$src\Resources\Fonts" -File | Where-Object { $_.Name -notmatch '(?i)NotoSansCJK|unifont' } | Copy-Item -Destination "$out\Fonts\"
Copy-Item "$src\Resources\Icons\set.ico", "$src\Resources\Icons\generic.ico" "$out\Icons\"
Get-ChildItem "$src\Resources\Schema" -File | Sort-Object Name | Select-Object -Last 1 | Copy-Item -Destination "$out\Schema\"
Get-ChildItem "$desk\Live12-UI-Extract\user-themes" -File | Copy-Item -Destination "$out\Themes\"

# Live's app icon, taken from the program itself
$live = Get-ChildItem "$env:ProgramData\Ableton", "$env:ProgramFiles\Ableton" -Directory -Filter 'Live 12*' | Select-Object -First 1
$exe = Get-ChildItem "$($live.FullName)\Program" -Filter 'Ableton Live 12*.exe' | Select-Object -First 1
if ($exe) {
  $ico = [System.Drawing.Icon]::ExtractAssociatedIcon($exe.FullName)
  $ico.ToBitmap().Save("$out\Icons\live-app-32.png", [System.Drawing.Imaging.ImageFormat]::Png)
  # all icon sizes: copy any .ico shipped next to the program
  Get-ChildItem $exe.DirectoryName -Filter '*.ico' -File | Copy-Item -Destination "$out\Icons\"
}

# List of fonts kept, so I can see their names
Get-ChildItem "$out\Fonts" -File | ForEach-Object { "{0,10:N0}  {1}" -f $_.Length, $_.Name } | Set-Content "$out\fonts.txt"

Compress-Archive -Path $out -DestinationPath "$out.zip" -Force
$size = [math]::Round((Get-Item "$out.zip").Length / 1MB, 1)
Write-Host ""
Write-Host "Done: $out.zip ($size MB)"
