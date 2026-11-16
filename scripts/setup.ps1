# Wardrobe from source, for Windows: the fallback when the one-line installer doesn't work.
# Double-click scripts\setup.cmd (it runs this file). Puts a private Node.js and OpenCLI into .runtime\
# (nothing else on the PC is touched), installs the app's dependencies, builds the UI and starts Wardrobe.
# Run it again after updating the code. Start Wardrobe later by double-clicking scripts\start.cmd.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

$NodeVersion = 'v22.22.2'
$OpenCliVersion = '2.0.2'   # the version the adapters are tested against
$Root = Split-Path -Parent $PSScriptRoot
$Rt = Join-Path $Root '.runtime'
$NodeDir = Join-Path $Rt 'node'
$Node = Join-Path $NodeDir 'node.exe'
$Npm = Join-Path $NodeDir 'npm.cmd'
$LogDir = Join-Path $Root 'data\logs'
$Log = Join-Path $LogDir 'setup.log'
$Tmp = Join-Path $Rt ('tmp-' + [Guid]::NewGuid().ToString('N'))

function Write-Log($text) { try { Add-Content -LiteralPath $Log -Value ((Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ') + ' ' + $text) } catch { } }
function Say($text) { Write-Host $text; if ($text) { Write-Log $text } }
# Runs a program with its output going to the log (not this window), and waits for that program only.
function Invoke-Logged($exe, [string[]]$arguments, $workDir) {
  $quoted = $arguments | ForEach-Object { if ($_ -match '\s') { '"' + $_ + '"' } else { $_ } }
  $out = Join-Path $Tmp ('out-' + [Guid]::NewGuid().ToString('N') + '.txt')
  $err = "$out.err"
  $p = Start-Process -FilePath $exe -ArgumentList $quoted -WorkingDirectory $workDir -WindowStyle Hidden -PassThru -RedirectStandardOutput $out -RedirectStandardError $err
  $null = $p.Handle
  $p.WaitForExit()
  foreach ($f in @($out, $err)) { if (Test-Path -LiteralPath $f) { Get-Content -LiteralPath $f | ForEach-Object { Write-Log "    $_" } } }
  return $p.ExitCode
}
# For the launcher: no output capture. Capturing would hand Wardrobe's server (which keeps running)
# copies of this window's handles, so the window, or this script, would never finish.
function Invoke-Plain($exe, [string[]]$arguments) {
  $quoted = $arguments | ForEach-Object { '"' + $_ + '"' }
  $p = Start-Process -FilePath $exe -ArgumentList $quoted -WorkingDirectory $env:USERPROFILE -WindowStyle Hidden -PassThru
  $null = $p.Handle
  $p.WaitForExit()
  return $p.ExitCode
}

try {
  New-Item -ItemType Directory -Force -Path $LogDir, $Rt, $Tmp | Out-Null
  Write-Log ('---- setup started: ' + [Environment]::OSVersion.VersionString + ', PowerShell ' + $PSVersionTable.PSVersion + ', in ' + $Root)
  if (-not [Environment]::Is64BitOperatingSystem) { throw 'Wardrobe needs 64-bit Windows.' }
  $tar = Join-Path $env:SystemRoot 'System32\tar.exe'
  if (-not (Test-Path -LiteralPath $tar)) { throw 'Windows 10 (version 1803) or newer is needed.' }

  Say ''
  Say 'Setting up Wardrobe...'

  # 1. Private Node.js (checked against nodejs.org's published checksum). x64 also runs on ARM PCs.
  $have = ''
  if (Test-Path -LiteralPath $Node) { try { $have = (& $Node -v | Out-String).Trim() } catch { $have = '' } }
  if ($have -ne $NodeVersion) {
    Say "  - Downloading Node.js $NodeVersion"
    $zipName = "node-$NodeVersion-win-x64.zip"
    $zip = Join-Path $Tmp $zipName
    Invoke-WebRequest -Uri "https://nodejs.org/dist/$NodeVersion/$zipName" -OutFile $zip -UseBasicParsing
    $sums = (Invoke-WebRequest -Uri "https://nodejs.org/dist/$NodeVersion/SHASUMS256.txt" -UseBasicParsing).Content
    $want = ($sums -split "`n" | Where-Object { $_ -match ([Regex]::Escape($zipName) + '\s*$') } | ForEach-Object { ($_ -split '\s+')[0] }) | Select-Object -First 1
    $got = (Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash
    if (-not $want -or $want.ToUpper() -ne $got.ToUpper()) { throw 'The Node.js download was damaged. Please try again.' }
    if (Test-Path -LiteralPath $NodeDir) { Remove-Item -LiteralPath $NodeDir -Recurse -Force }
    New-Item -ItemType Directory -Force -Path $NodeDir | Out-Null
    & $tar -xf $zip -C $NodeDir --strip-components 1
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $Node)) { throw 'Could not unpack Node.js.' }
  }
  $env:Path = "$NodeDir;$env:Path"

  # 2. Dependencies (the app, the UI, and OpenCLI pinned in .runtime\). Stop a running copy first.
  $null = Invoke-Plain $Node @((Join-Path $Root 'launcher.js'), '--stop')
  Say "  - Installing the app's dependencies (a few minutes the first time)"
  if ((Invoke-Logged $Npm @('ci', '--no-audit', '--no-fund') $Root) -ne 0) { throw "Installing the app's dependencies failed." }
  if ((Invoke-Logged $Npm @('ci', '--no-audit', '--no-fund') (Join-Path $Root 'web')) -ne 0) { throw "Installing the UI's dependencies failed." }
  Say "  - Installing OpenCLI $OpenCliVersion"
  if ((Invoke-Logged $Npm @('install', '--prefix', $Rt, '--no-audit', '--no-fund', '--ignore-scripts', "@jackwener/opencli@$OpenCliVersion") $Root) -ne 0) { throw 'Installing OpenCLI failed.' }
  Say '  - Building the app'
  if ((Invoke-Logged $Npm @('run', 'build') (Join-Path $Root 'web')) -ne 0) { throw 'Building the app failed.' }

  # 3. Start it
  Say '  - Starting Wardrobe'
  $env:WARDROBE_DATA = Join-Path $Root 'data'
  if ((Invoke-Plain $Node @((Join-Path $Root 'launcher.js'))) -ne 0) { throw "Wardrobe didn't start (details are in data\logs\server.log)." }
  Write-Log 'setup finished'

  Say ''
  Say 'Done! Wardrobe is open in Google Chrome.'
  Say 'Next time, double-click scripts\start.cmd in this folder.'
  Say ''
}
catch {
  Write-Host ''
  Write-Host "Wardrobe setup failed: $($_.Exception.Message)" -ForegroundColor Red
  Write-Log ('FAILED: ' + $_.Exception.Message + ' | at ' + $_.InvocationInfo.PositionMessage + ' | ' + $_.ScriptStackTrace)
  Write-Host 'If you need help, send this file to whoever shared Wardrobe with you:'
  Write-Host "  $Log"
  try { Start-Process explorer.exe -ArgumentList ('/select,"' + $Log + '"') } catch { }
  Write-Host ''
}
finally {
  if (Test-Path -LiteralPath $Tmp) { Remove-Item -LiteralPath $Tmp -Recurse -Force -ErrorAction SilentlyContinue }
}
