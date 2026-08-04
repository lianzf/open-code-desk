Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$helperPath = Join-Path $PSScriptRoot 'run-live-provider-acceptance.ps1'
$trackedNames = @(
  'OPEN_CODE_DESK_PROVIDER_ACCEPTANCE'
  'OPEN_CODE_DESK_PROVIDER_OPENAI_BASE_URL'
  'OPEN_CODE_DESK_PROVIDER_OPENAI_MODEL'
  'OPEN_CODE_DESK_PROVIDER_OPENAI_API_KEY'
  'OPEN_CODE_DESK_PROVIDER_OPENAI_HEADERS_JSON'
  'OPEN_CODE_DESK_PROVIDER_OLLAMA_BASE_URL'
  'OPEN_CODE_DESK_PROVIDER_OLLAMA_MODEL'
  'OPEN_CODE_DESK_PROVIDER_OLLAMA_API_KEY'
)
$originalEnvironment = @{}
foreach ($name in $trackedNames) {
  $originalEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
}

function Assert-Condition([bool]$Condition, [string]$Message) {
  if (!$Condition) {
    throw $Message
  }
}

function Clear-TestVariable([string]$Name) {
  [Environment]::SetEnvironmentVariable($Name, $null, 'Process')
}

try {
  $global:acceptanceAnswers = [System.Collections.Generic.Queue[string]]::new()
  $global:acceptanceCaptured = $null
  $global:acceptancePnpmExitCode = 0

  function global:Read-Host {
    param(
      [string]$Prompt,
      [switch]$AsSecureString
    )
    $answer = $global:acceptanceAnswers.Dequeue()
    if (!$AsSecureString) {
      return $answer
    }
    if ($answer -eq '') {
      return [Security.SecureString]::new()
    }
    return ConvertTo-SecureString $answer -AsPlainText -Force
  }

  function global:pnpm {
    param([Parameter(ValueFromRemainingArguments = $true)][object[]]$Arguments)
    $global:acceptanceCaptured = [pscustomobject]@{
      Selector = $env:OPEN_CODE_DESK_PROVIDER_ACCEPTANCE
      BaseUrl = $env:OPEN_CODE_DESK_PROVIDER_OPENAI_BASE_URL
      Model = $env:OPEN_CODE_DESK_PROVIDER_OPENAI_MODEL
      ApiKey = $env:OPEN_CODE_DESK_PROVIDER_OPENAI_API_KEY
      Headers = $env:OPEN_CODE_DESK_PROVIDER_OPENAI_HEADERS_JSON
      Command = $Arguments -join ' '
    }
    $global:LASTEXITCODE = $global:acceptancePnpmExitCode
  }

  $env:OPEN_CODE_DESK_PROVIDER_ACCEPTANCE = 'original-selection'
  foreach ($name in $trackedNames | Where-Object { $_ -ne 'OPEN_CODE_DESK_PROVIDER_ACCEPTANCE' }) {
    Clear-TestVariable $name
  }
  @(
    'https://127.0.0.1:9443/v1'
    'acceptance-model'
    'masked-alpha'
    '{"X-Test":"masked-beta"}'
  ) | ForEach-Object { $global:acceptanceAnswers.Enqueue($_) }

  $successOutput = @(& $helperPath -Providers openai -PromptCustomHeaders 6>&1)
  Assert-Condition ($LASTEXITCODE -eq 0) 'The success path did not return exit code 0.'
  Assert-Condition ($global:acceptanceCaptured.Selector -eq 'openai') 'The child selector was not set.'
  Assert-Condition ($global:acceptanceCaptured.BaseUrl -eq 'https://127.0.0.1:9443/v1') 'The child Base URL was not set.'
  Assert-Condition ($global:acceptanceCaptured.Model -eq 'acceptance-model') 'The child Model ID was not set.'
  Assert-Condition ($global:acceptanceCaptured.ApiKey -eq 'masked-alpha') 'The child API Key was not set.'
  Assert-Condition ($global:acceptanceCaptured.Headers -eq '{"X-Test":"masked-beta"}') 'The child Header JSON was not set.'
  Assert-Condition ($global:acceptanceCaptured.Command -eq 'test:providers:live') 'The helper invoked an unexpected command.'
  Assert-Condition (($successOutput -join "`n") -notmatch 'masked-alpha|masked-beta') 'A prompted secret appeared in helper output.'
  Assert-Condition ($env:OPEN_CODE_DESK_PROVIDER_ACCEPTANCE -eq 'original-selection') 'The original selector was not restored.'
  Assert-Condition ($null -eq $env:OPEN_CODE_DESK_PROVIDER_OPENAI_BASE_URL) 'The temporary Base URL was not cleared.'
  Assert-Condition ($null -eq $env:OPEN_CODE_DESK_PROVIDER_OPENAI_MODEL) 'The temporary Model ID was not cleared.'
  Assert-Condition ($null -eq $env:OPEN_CODE_DESK_PROVIDER_OPENAI_API_KEY) 'The temporary API Key was not cleared.'
  Assert-Condition ($null -eq $env:OPEN_CODE_DESK_PROVIDER_OPENAI_HEADERS_JSON) 'The temporary Header JSON was not cleared.'
  Assert-Condition ($global:acceptanceAnswers.Count -eq 0) 'The success prompts were not all consumed.'

  $global:acceptanceAnswers = [System.Collections.Generic.Queue[string]]::new()
  @('http://127.0.0.1:11434', 'local-model', '') |
    ForEach-Object { $global:acceptanceAnswers.Enqueue($_) }
  $global:acceptancePnpmExitCode = 7
  Clear-TestVariable 'OPEN_CODE_DESK_PROVIDER_OLLAMA_BASE_URL'
  Clear-TestVariable 'OPEN_CODE_DESK_PROVIDER_OLLAMA_MODEL'
  Clear-TestVariable 'OPEN_CODE_DESK_PROVIDER_OLLAMA_API_KEY'

  $null = @(& $helperPath -Providers ollama 6>&1)
  Assert-Condition ($LASTEXITCODE -eq 7) 'The child failure exit code was not preserved.'
  Assert-Condition ($env:OPEN_CODE_DESK_PROVIDER_ACCEPTANCE -eq 'original-selection') 'The selector was not restored after failure.'
  Assert-Condition ($null -eq $env:OPEN_CODE_DESK_PROVIDER_OLLAMA_BASE_URL) 'The failure-path Base URL was not cleared.'
  Assert-Condition ($null -eq $env:OPEN_CODE_DESK_PROVIDER_OLLAMA_MODEL) 'The failure-path Model ID was not cleared.'
  Assert-Condition ($null -eq $env:OPEN_CODE_DESK_PROVIDER_OLLAMA_API_KEY) 'The failure-path API Key was not cleared.'
  Assert-Condition ($global:acceptanceAnswers.Count -eq 0) 'The failure prompts were not all consumed.'

  $invalidRejected = $false
  try {
    $null = @(& $helperPath -Providers invalid-provider 6>&1)
  }
  catch {
    $invalidRejected = $_.Exception.Message -like 'Unsupported Provider selector*'
  }
  Assert-Condition $invalidRejected 'An unsupported Provider selector was not rejected.'

  $listedProviders = @(& $helperPath -ListProviders)
  Assert-Condition ($listedProviders.Count -eq 10) 'The helper did not list all 10 Providers.'
  Assert-Condition ($listedProviders[0] -like 'openai-compatible*') 'The Provider listing is not in registry order.'

  [pscustomobject]@{
    Status = 'ok'
    Providers = $listedProviders.Count
    SuccessCleanup = $true
    FailureCleanup = $true
    SecretsRedacted = $true
  } | Format-List
}
finally {
  foreach ($entry in $originalEnvironment.GetEnumerator()) {
    [Environment]::SetEnvironmentVariable($entry.Key, $entry.Value, 'Process')
  }
  Remove-Item Function:\Read-Host -Force -ErrorAction SilentlyContinue
  Remove-Item Function:\pnpm -Force -ErrorAction SilentlyContinue
  Remove-Variable acceptanceAnswers, acceptanceCaptured, acceptancePnpmExitCode -Scope Global -ErrorAction SilentlyContinue
}
