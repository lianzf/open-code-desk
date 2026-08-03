param(
  [ValidateRange(0, 1440)]
  [double]$Minutes = 240,
  [string]$OutputDirectory = '.runtime',
  [string]$OutputStem = 'stability-acceptance'
)

$ErrorActionPreference = 'Stop'
$workspaceRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..\..')).Path
$resolvedOutputDirectory = Join-Path $workspaceRoot $OutputDirectory
New-Item -ItemType Directory -Path $resolvedOutputDirectory -Force | Out-Null

$env:OPEN_CODE_DESK_STABILITY_MINUTES = [string]::Format(
  [Globalization.CultureInfo]::InvariantCulture,
  '{0}',
  $Minutes
)

Set-Location -LiteralPath $workspaceRoot
pnpm test:stability
$testExitCode = $LASTEXITCODE

$exitPath = Join-Path $resolvedOutputDirectory "$OutputStem.exit.txt"
Set-Content -LiteralPath $exitPath -Value $testExitCode -Encoding ascii
exit $testExitCode
