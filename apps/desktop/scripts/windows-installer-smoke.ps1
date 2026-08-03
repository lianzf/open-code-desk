param(
  [Parameter(Mandatory = $true)]
  [string]$InstallerPath,

  [Parameter(Mandatory = $true)]
  [string]$WorkspaceRoot
)

$ErrorActionPreference = 'Stop'
$resolvedWorkspace = (Resolve-Path -LiteralPath $WorkspaceRoot).Path
$resolvedInstaller = (Resolve-Path -LiteralPath $InstallerPath).Path
$runtimeRoot = Join-Path $resolvedWorkspace '.runtime'
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$installDir = Join-Path $runtimeRoot "installer-smoke-$stamp"
$userDataDir = Join-Path $runtimeRoot "installer-smoke-profile-$stamp"
$runtimePrefix = [System.IO.Path]::GetFullPath($runtimeRoot) + [System.IO.Path]::DirectorySeparatorChar

function Assert-RuntimePath([string]$Path) {
  $full = [System.IO.Path]::GetFullPath($Path)
  if (!$full.StartsWith($runtimePrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing operation outside runtime root: $full"
  }
  return $full
}

function Get-InstalledProcesses([string]$ExecutablePath) {
  return @(Get-Process -ErrorAction SilentlyContinue | Where-Object {
    try { $_.Path -eq $ExecutablePath } catch { $false }
  })
}

Assert-RuntimePath $installDir | Out-Null
Assert-RuntimePath $userDataDir | Out-Null
if ((Test-Path -LiteralPath $installDir) -or (Test-Path -LiteralPath $userDataDir)) {
  throw 'Smoke-test target already exists.'
}

New-Item -ItemType Directory -Path $runtimeRoot -Force | Out-Null
$appExe = Join-Path $installDir 'OpenCode Desk.exe'
$uninstaller = Join-Path $installDir 'Uninstall OpenCode Desk.exe'
$windowTitle = ''
$coldStartSeconds = 0
$forcedClose = $false
$residualProcesses = -1
$uninstallerExitCode = -1

try {
  $installerProcess = Start-Process -FilePath $resolvedInstaller -ArgumentList @('/S', "/D=$installDir") -PassThru -Wait
  if ($installerProcess.ExitCode -ne 0) {
    throw "Installer exited with code $($installerProcess.ExitCode)."
  }
  if (!(Test-Path -LiteralPath $appExe) -or !(Test-Path -LiteralPath $uninstaller)) {
    throw 'Installed application or uninstaller is missing.'
  }

  $startedAt = Get-Date
  Start-Process -FilePath $appExe -ArgumentList @("--user-data-dir=$userDataDir") | Out-Null
  $windowProcess = $null
  $deadline = (Get-Date).AddSeconds(30)
  do {
    Start-Sleep -Milliseconds 200
    $windowProcess = Get-InstalledProcesses $appExe |
      Where-Object { $_.MainWindowHandle -ne 0 } |
      Select-Object -First 1
  } while ($null -eq $windowProcess -and (Get-Date) -lt $deadline)
  if ($null -eq $windowProcess) {
    throw 'Installed application did not create a product window within 30 seconds.'
  }
  $coldStartSeconds = [math]::Round(((Get-Date) - $startedAt).TotalSeconds, 2)
  $windowTitle = $windowProcess.MainWindowTitle

  $null = $windowProcess.CloseMainWindow()
  $closeDeadline = (Get-Date).AddSeconds(20)
  do {
    Start-Sleep -Milliseconds 200
    $remaining = Get-InstalledProcesses $appExe
  } while ($remaining.Count -gt 0 -and (Get-Date) -lt $closeDeadline)
  if ($remaining.Count -gt 0) {
    $forcedClose = $true
    $remaining | Stop-Process -Force
    Start-Sleep -Milliseconds 500
    $residualProcesses = (Get-InstalledProcesses $appExe).Count
    throw "Application did not exit within 20 seconds; forced cleanup left $residualProcesses process(es)."
  }
  $residualProcesses = (Get-InstalledProcesses $appExe).Count

  $uninstallProcess = Start-Process -FilePath $uninstaller -ArgumentList @('/S') -PassThru -Wait
  $uninstallerExitCode = $uninstallProcess.ExitCode
  if ($uninstallerExitCode -ne 0) {
    throw "Uninstaller exited with code $uninstallerExitCode."
  }
  if (Test-Path -LiteralPath $appExe) {
    throw 'Uninstaller returned success but left the installed application executable behind.'
  }

  [pscustomobject]@{
    InstallerExitCode = $installerProcess.ExitCode
    ColdStartSeconds = $coldStartSeconds
    WindowTitle = $windowTitle
    ForcedClose = $forcedClose
    ResidualProcesses = $residualProcesses
    UninstallerExitCode = $uninstallerExitCode
  } | Format-List
}
finally {
  if (Test-Path -LiteralPath $appExe) {
    Get-InstalledProcesses $appExe | Stop-Process -Force -ErrorAction SilentlyContinue
  }
  if (Test-Path -LiteralPath $uninstaller) {
    Start-Process -FilePath $uninstaller -ArgumentList @('/S') -Wait -ErrorAction SilentlyContinue
  }
  foreach ($path in @($installDir, $userDataDir)) {
    $safePath = Assert-RuntimePath $path
    if (Test-Path -LiteralPath $safePath) {
      Remove-Item -LiteralPath $safePath -Recurse -Force
    }
  }
}
