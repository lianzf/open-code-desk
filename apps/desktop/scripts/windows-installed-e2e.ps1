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
$installDir = Join-Path $runtimeRoot "installed-e2e-$stamp"
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
if (Test-Path -LiteralPath $installDir) {
  throw 'Installed E2E target already exists.'
}

New-Item -ItemType Directory -Path $runtimeRoot -Force | Out-Null
$appExe = Join-Path $installDir 'OpenCode Desk.exe'
$uninstaller = Join-Path $installDir 'Uninstall OpenCode Desk.exe'
try {
  $installerProcess = Start-Process -FilePath $resolvedInstaller -ArgumentList @('/S', "/D=$installDir") -PassThru -Wait
  if ($installerProcess.ExitCode -ne 0) {
    throw "Installer exited with code $($installerProcess.ExitCode)."
  }
  if (!(Test-Path -LiteralPath $appExe) -or !(Test-Path -LiteralPath $uninstaller)) {
    throw 'Installed application or uninstaller is missing.'
  }

  $env:OPEN_CODE_DESK_E2E_EXECUTABLE_PATH = $appExe
  & pnpm.cmd test:e2e:packaged-core
  $testExitCode = $LASTEXITCODE
  Remove-Item Env:OPEN_CODE_DESK_E2E_EXECUTABLE_PATH -ErrorAction SilentlyContinue
  if ($testExitCode -ne 0) {
    throw "Installed application E2E exited with code $testExitCode."
  }

  $residualProcesses = Get-InstalledProcesses $appExe
  if ($residualProcesses.Count -ne 0) {
    throw "Installed E2E left $($residualProcesses.Count) application process(es) running."
  }

  $uninstallProcess = Start-Process -FilePath $uninstaller -ArgumentList @('/S') -PassThru -Wait
  if ($uninstallProcess.ExitCode -ne 0) {
    throw "Uninstaller exited with code $($uninstallProcess.ExitCode)."
  }
  if (Test-Path -LiteralPath $appExe) {
    throw 'Uninstaller returned success but left the installed application executable behind.'
  }
}
finally {
  Remove-Item Env:OPEN_CODE_DESK_E2E_EXECUTABLE_PATH -ErrorAction SilentlyContinue
  if (Test-Path -LiteralPath $appExe) {
    Get-InstalledProcesses $appExe | Stop-Process -Force -ErrorAction SilentlyContinue
  }
  if (Test-Path -LiteralPath $uninstaller) {
    Start-Process -FilePath $uninstaller -ArgumentList @('/S') -Wait -ErrorAction SilentlyContinue
  }
  $safeInstallDir = Assert-RuntimePath $installDir
  if (Test-Path -LiteralPath $safeInstallDir) {
    Remove-Item -LiteralPath $safeInstallDir -Recurse -Force
  }
}
