# Wardrobe installer for Windows. Paste into PowerShell:
#   irm https://github.com/sushi057/wardrobe/releases/latest/download/install.ps1 | iex
# Installs a private copy of Node.js and Wardrobe into %LOCALAPPDATA%\Wardrobe (no admin rights, nothing
# else touched), adds Desktop and Start-menu shortcuts, and opens it. Run the same line again to update;
# your closet is kept.
& {
  $ErrorActionPreference = 'Stop'
  $ProgressPreference = 'SilentlyContinue'   # Windows PowerShell's progress bar makes downloads crawl
  [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

  $NodeVersion = 'v22.22.2'
  $Base = if ($env:WARDROBE_BASE) { $env:WARDROBE_BASE.TrimEnd('/', '\') } else { 'https://github.com/sushi057/wardrobe/releases/latest/download' }
  $Dir = Join-Path $env:LOCALAPPDATA 'Wardrobe'
  $Tmp = Join-Path $Dir ('tmp-' + [Guid]::NewGuid().ToString('N'))   # same drive as the install, so folders can be moved in
  $NodeDir = Join-Path $Dir 'node'
  $Node = Join-Path $NodeDir 'node.exe'
  $App = Join-Path $Dir 'app'
  $Launcher = Join-Path $App 'launcher.js'

  $LogDir = Join-Path $Dir 'data\logs'
  $Log = Join-Path $LogDir 'install.log'
  function Write-Log($text) { try { Add-Content -LiteralPath $Log -Value ((Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ') + ' ' + $text) } catch { } }
  function Say($text) { Write-Host $text; if ($text) { Write-Log $text } }
  function Get-File($url, $dest) {
    if ($url -match '^[a-zA-Z]:\\|^\\\\') { Copy-Item -LiteralPath $url -Destination $dest; return }   # local test builds
    Invoke-WebRequest -Uri $url -OutFile $dest -UseBasicParsing
  }
  # Runs node without tying this window's output to processes it leaves running (they'd keep it open forever).
  function Invoke-Node($nodeExe, [string[]]$arguments) {
    $quoted = $arguments | ForEach-Object { '"' + $_ + '"' }
    $p = Start-Process -FilePath $nodeExe -ArgumentList $quoted -WorkingDirectory $env:USERPROFILE -WindowStyle Hidden -PassThru
    $null = $p.Handle   # keeps ExitCode readable after exit
    $p.WaitForExit()
    return $p.ExitCode
  }
  # Swap a folder in by renaming, so a failure never leaves a half-deleted copy behind.
  function Set-Folder($newPath, $target) {
    $old = "$target.old"
    if (Test-Path -LiteralPath $old) { Remove-Item -LiteralPath $old -Recurse -Force -ErrorAction SilentlyContinue }
    if (Test-Path -LiteralPath $target) {
      $moved = $false
      for ($i = 0; $i -lt 10 -and -not $moved; $i++) {
        try { Rename-Item -LiteralPath $target -NewName (Split-Path $old -Leaf); $moved = $true } catch { Start-Sleep -Milliseconds 500 }
      }
      if (-not $moved) { throw 'Wardrobe is still running. Close Chrome (or restart the PC), then run this line again.' }
    }
    Move-Item -LiteralPath $newPath -Destination $target
    Remove-Item -LiteralPath $old -Recurse -Force -ErrorAction SilentlyContinue   # leftovers are cleaned up next time
  }

  try {
    if (-not [Environment]::Is64BitOperatingSystem) { throw 'Wardrobe needs 64-bit Windows.' }
    $tar = Join-Path $env:SystemRoot 'System32\tar.exe'
    if (-not (Test-Path -LiteralPath $tar)) { throw 'Windows 10 (version 1803) or newer is needed.' }
    New-Item -ItemType Directory -Force -Path $Dir, $Tmp, $LogDir | Out-Null
    Write-Log ('---- install started: ' + [Environment]::OSVersion.VersionString + ', PowerShell ' + $PSVersionTable.PSVersion + ', from ' + $Base)

    Say ''
    Say 'Installing Wardrobe...'

    # 1. Download everything first (nothing on disk changes until both downloads check out).
    #    Node.js is a private copy, verified against nodejs.org's checksum. x64 also runs on ARM PCs.
    $have = ''
    if (Test-Path -LiteralPath $Node) { try { $have = (& $Node -v | Out-String).Trim() } catch { $have = '' } }
    $newNode = $null
    if ($have -ne $NodeVersion) {
      Say "  - Downloading Node.js $NodeVersion"
      $zipName = "node-$NodeVersion-win-x64.zip"
      $zip = Join-Path $Tmp $zipName
      Get-File "https://nodejs.org/dist/$NodeVersion/$zipName" $zip
      $sums = (Invoke-WebRequest -Uri "https://nodejs.org/dist/$NodeVersion/SHASUMS256.txt" -UseBasicParsing).Content
      $want = ($sums -split "`n" | Where-Object { $_ -match ([Regex]::Escape($zipName) + '\s*$') } | ForEach-Object { ($_ -split '\s+')[0] }) | Select-Object -First 1
      $got = (Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash
      if (-not $want -or $want.ToUpper() -ne $got.ToUpper()) { throw 'The Node.js download was damaged. Please try again.' }
      $newNode = Join-Path $Tmp 'node'
      New-Item -ItemType Directory -Force -Path $newNode | Out-Null
      & $tar -xf $zip -C $newNode --strip-components 1
      if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath (Join-Path $newNode 'node.exe'))) { throw 'Could not unpack Node.js.' }
    }

    Say '  - Downloading Wardrobe'
    $pkg = Join-Path $Tmp 'wardrobe.tar.gz'
    Get-File "$Base/wardrobe.tar.gz" $pkg
    $newApp = Join-Path $Tmp 'new'
    New-Item -ItemType Directory -Force -Path $newApp | Out-Null
    & $tar -xzf $pkg -C $newApp
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath (Join-Path $newApp 'app\launcher.js'))) { throw 'The Wardrobe download was damaged. Please try again.' }

    # 2. Stop a running copy (server + OpenCLI's helper), then swap in the new files.
    #    Your photos live in ...\Wardrobe\data and are never touched.
    if ((Test-Path -LiteralPath $Launcher) -and (Test-Path -LiteralPath $Node)) { $null = Invoke-Node $Node @($Launcher, '--stop') }
    # App first: if anything still has it open, we stop here with nothing changed.
    Set-Folder (Join-Path $newApp 'app') $App
    if ($newNode) { Set-Folder $newNode $NodeDir }

    # 3. Shortcuts (Desktop + Start menu). The console window starts minimized and closes by itself.
    Say '  - Adding shortcuts to your Desktop and Start menu'
    $shell = New-Object -ComObject WScript.Shell
    foreach ($folder in @([Environment]::GetFolderPath('Desktop'), [Environment]::GetFolderPath('Programs'))) {
      if (-not $folder) { continue }
      $lnk = $shell.CreateShortcut((Join-Path $folder 'Wardrobe.lnk'))
      $lnk.TargetPath = $Node
      $lnk.Arguments = '"' + $Launcher + '"'
      $lnk.WorkingDirectory = $env:USERPROFILE   # not the app folder: that would block updates
      $lnk.WindowStyle = 7
      $lnk.IconLocation = (Join-Path $App 'icons\wardrobe.ico') + ',0'
      $lnk.Description = 'Wardrobe: try clothes on with your own Gemini'
      $lnk.Save()
    }

    # 4. Open it
    Say '  - Starting Wardrobe'
    if ((Invoke-Node $Node @($Launcher)) -ne 0) { throw "Wardrobe didn't start. Details: $Dir\data\logs\server.log" }

    Write-Log ('installed ' + (Get-Content -LiteralPath (Join-Path $App 'VERSION') -ErrorAction SilentlyContinue))
    Say ''
    Say 'Done! Wardrobe is open in Google Chrome.'
    Say 'Next time, open it from the Wardrobe shortcut on your Desktop or in the Start menu.'
    Say ''
  }
  catch {
    Write-Host ''
    Write-Host "Wardrobe could not be installed: $($_.Exception.Message)" -ForegroundColor Red
    Write-Log ('FAILED: ' + $_.Exception.Message + ' | at ' + $_.InvocationInfo.PositionMessage + ' | ' + $_.ScriptStackTrace)
    if (Test-Path -LiteralPath $Log) {
      Write-Host 'If you need help, send this file to whoever shared Wardrobe with you:'
      Write-Host "  $Log"
      try { Start-Process explorer.exe -ArgumentList ('/select,"' + $Log + '"') } catch { }
    }
    Write-Host ''
  }
  finally {
    if (Test-Path -LiteralPath $Tmp) { Remove-Item -LiteralPath $Tmp -Recurse -Force -ErrorAction SilentlyContinue }
  }
}
