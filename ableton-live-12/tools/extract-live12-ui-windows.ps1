# Collects Ableton Live 12's interface resources (themes, fonts, images) into
# Live12-UI-Extract.zip on your Desktop, so the web viewer can match Live exactly.
# It only reads from Live; it changes nothing. Sample libraries are skipped.
#
# Run in PowerShell:
#   powershell -ExecutionPolicy Bypass -File "$HOME\Downloads\extract-live12-ui-windows.ps1"

$ErrorActionPreference = 'SilentlyContinue'
$desk = [Environment]::GetFolderPath('Desktop')
$out  = Join-Path $desk 'Live12-UI-Extract'
Remove-Item -Recurse -Force $out, "$out.zip"
New-Item -ItemType Directory -Force "$out\app", "$out\user-themes" | Out-Null

# Find Live 12
$roots = @()
foreach ($base in @("$env:ProgramData\Ableton", "$env:ProgramFiles\Ableton", "${env:ProgramFiles(x86)}\Ableton")) {
  if (Test-Path $base) { $roots += Get-ChildItem $base -Directory -Filter 'Live 12*' }
}
if (-not $roots) {
  $p = Read-Host "Couldn't find Live 12. Paste the path of your Live 12 folder (the one containing 'Program' and 'Resources')"
  $roots = @(Get-Item $p.Trim('"'))
}
$live = $roots[0].FullName
Write-Host "Using: $live"

$exe = Get-ChildItem "$live\Program" -Filter 'Ableton Live 12*.exe' | Select-Object -First 1
@(
  "Live folder: $live"
  "Version: $($exe.VersionInfo.ProductVersion)"
  "Windows: $([Environment]::OSVersion.VersionString)"
  "Display scale: $((Get-ItemProperty 'HKCU:\Control Panel\Desktop\WindowMetrics').AppliedDPI) dpi"
) | Set-Content "$out\about.txt"

# A list of every file (with sizes), skipping the Core Library sounds
Write-Host 'Listing files...'
Get-ChildItem $live -Recurse -File | Where-Object { $_.FullName -notmatch '\\Core Library\\' } |
  ForEach-Object { "$($_.Length)`t$($_.FullName.Substring($live.Length + 1))" } | Set-Content "$out\inventory.txt"

# Copy themes, fonts and images (not Max, not the Core Library)
Write-Host 'Copying themes, fonts and images...'
$ext = '\.(ask|ttf|otf|ttc|woff2?|png|svg|tiff?|ico|bmp|xml|json|cfg|txt)$'
Get-ChildItem $live -Recurse -File |
  Where-Object { $_.Name -match $ext -and $_.FullName -notmatch '\\(Core Library|Max|Cycling)' } |
  ForEach-Object {
    $rel = $_.FullName.Substring($live.Length + 1)
    $dst = Join-Path "$out\app" $rel
    New-Item -ItemType Directory -Force (Split-Path $dst) | Out-Null
    Copy-Item $_.FullName $dst
  }

# Fonts Live may install system-wide
Get-ChildItem "$env:WINDIR\Fonts", "$env:LOCALAPPDATA\Microsoft\Windows\Fonts" -File |
  Where-Object { $_.Name -match 'ableton' } | ForEach-Object { Copy-Item $_.FullName "$out\app\" }

# Themes you've saved or edited yourself
foreach ($d in @("$env:USERPROFILE\Documents\Ableton", "$env:APPDATA\Ableton")) {
  Get-ChildItem $d -Recurse -File -Filter '*.ask' | ForEach-Object { Copy-Item $_.FullName "$out\user-themes\" }
}

# Which theme and zoom Live is set to (only the matching lines of the preferences)
Get-ChildItem "$env:APPDATA\Ableton" -Directory -Filter 'Live 12*' | ForEach-Object {
  $cfg = Join-Path $_.FullName 'Preferences\Preferences.cfg'
  if (Test-Path $cfg) {
    $text = [System.Text.Encoding]::Unicode.GetString([IO.File]::ReadAllBytes($cfg)) + [System.Text.Encoding]::ASCII.GetString([IO.File]::ReadAllBytes($cfg))
    ([regex]::Matches($text, '[\x20-\x7e]{4,}') | ForEach-Object { $_.Value } | Where-Object { $_ -match '(?i)theme|\.ask|zoom|skin' } | Sort-Object -Unique) |
      Set-Content "$out\preferences-theme.txt"
  }
}

Compress-Archive -Path $out -DestinationPath "$out.zip" -Force
$size = [math]::Round((Get-Item "$out.zip").Length / 1MB, 1)
Write-Host ""
Write-Host "Done: $out.zip ($size MB)"
