[CmdletBinding()]
param(
  [string]$Providers,
  [switch]$PromptCustomHeaders,
  [switch]$ListProviders
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$targets = @(
  [pscustomobject]@{ Kind = 'openai-compatible'; Suffix = 'OPENAI_COMPATIBLE'; ApiKeyRequired = $false }
  [pscustomobject]@{ Kind = 'openai'; Suffix = 'OPENAI'; ApiKeyRequired = $true }
  [pscustomobject]@{ Kind = 'anthropic'; Suffix = 'ANTHROPIC'; ApiKeyRequired = $true }
  [pscustomobject]@{ Kind = 'gemini'; Suffix = 'GEMINI'; ApiKeyRequired = $true }
  [pscustomobject]@{ Kind = 'openrouter'; Suffix = 'OPENROUTER'; ApiKeyRequired = $true }
  [pscustomobject]@{ Kind = 'deepseek'; Suffix = 'DEEPSEEK'; ApiKeyRequired = $true }
  [pscustomobject]@{ Kind = 'qwen'; Suffix = 'QWEN'; ApiKeyRequired = $true }
  [pscustomobject]@{ Kind = 'glm'; Suffix = 'GLM'; ApiKeyRequired = $true }
  [pscustomobject]@{ Kind = 'moonshot'; Suffix = 'MOONSHOT'; ApiKeyRequired = $true }
  [pscustomobject]@{ Kind = 'ollama'; Suffix = 'OLLAMA'; ApiKeyRequired = $false }
)

if ($ListProviders) {
  $targets | ForEach-Object {
    $requirement = if ($_.ApiKeyRequired) { 'API Key required' } else { 'API Key optional' }
    "$($_.Kind) [$($_.Suffix); $requirement]"
  }
  exit 0
}

function Read-RequiredText([string]$Prompt) {
  while ($true) {
    $value = Read-Host -Prompt $Prompt
    if (![string]::IsNullOrWhiteSpace($value)) {
      return $value.Trim()
    }
    Write-Warning 'A non-empty value is required.'
  }
}

function ConvertFrom-SecurePrompt([Security.SecureString]$SecureValue) {
  $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($SecureValue)
  try {
    return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
  }
  finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
  }
}

function Read-SecretText([string]$Prompt, [bool]$Required) {
  while ($true) {
    $secureValue = Read-Host -Prompt $Prompt -AsSecureString
    $value = ConvertFrom-SecurePrompt $secureValue
    if (!$Required -or ![string]::IsNullOrWhiteSpace($value)) {
      return $value
    }
    Write-Warning 'A non-empty secret value is required.'
  }
}

$originalEnvironment = @{}

function Set-TemporaryProcessVariable([string]$Name, [string]$Value) {
  if (!$originalEnvironment.ContainsKey($Name)) {
    $originalEnvironment[$Name] = [Environment]::GetEnvironmentVariable($Name, 'Process')
  }
  [Environment]::SetEnvironmentVariable($Name, $Value, 'Process')
}

function Restore-ProcessEnvironment {
  foreach ($entry in $originalEnvironment.GetEnumerator()) {
    [Environment]::SetEnvironmentVariable($entry.Key, $entry.Value, 'Process')
  }
}

function Get-ExistingProcessValue([string]$Name) {
  $value = [Environment]::GetEnvironmentVariable($Name, 'Process')
  if ([string]::IsNullOrWhiteSpace($value)) {
    return $null
  }
  return $value
}

function Set-PromptedTextIfMissing([string]$Name, [string]$Prompt) {
  if ($null -ne (Get-ExistingProcessValue $Name)) {
    Write-Host "Using existing process value for $Name (value not displayed)."
    return
  }
  Set-TemporaryProcessVariable $Name (Read-RequiredText $Prompt)
}

function Set-PromptedSecretIfMissing(
  [string]$Name,
  [string]$Prompt,
  [bool]$Required
) {
  if ($null -ne (Get-ExistingProcessValue $Name)) {
    Write-Host "Using existing process value for $Name (value not displayed)."
    return
  }
  $value = Read-SecretText $Prompt $Required
  if (![string]::IsNullOrWhiteSpace($value)) {
    Set-TemporaryProcessVariable $Name $value
  }
}

$exitCode = 1
try {
  if ([string]::IsNullOrWhiteSpace($Providers)) {
    $Providers = Read-RequiredText 'Providers (all or comma-separated names)'
  }

  $normalizedSelection = $Providers.Trim().ToLowerInvariant()
  $selectedNames = @(
    if ($normalizedSelection -eq 'all') {
      $targets | ForEach-Object { $_.Kind }
    }
    else {
      $normalizedSelection.Split(',') |
        ForEach-Object { $_.Trim() } |
        Where-Object { $_ -ne '' } |
        Select-Object -Unique
    }
  )
  if ($selectedNames.Count -eq 0) {
    throw 'Select at least one Provider.'
  }

  $supportedNames = @($targets | ForEach-Object { $_.Kind })
  $invalidNames = @($selectedNames | Where-Object { $_ -notin $supportedNames })
  if ($invalidNames.Count -gt 0) {
    throw "Unsupported Provider selector(s): $($invalidNames -join ', '). Use all or: $($supportedNames -join ', ')."
  }

  $selectedTargets = @($targets | Where-Object { $_.Kind -in $selectedNames })
  Set-TemporaryProcessVariable 'OPEN_CODE_DESK_PROVIDER_ACCEPTANCE' ($selectedNames -join ',')

  foreach ($target in $selectedTargets) {
    $prefix = "OPEN_CODE_DESK_PROVIDER_$($target.Suffix)"
    Write-Host "Configuring $($target.Kind); entered secrets are masked and are not written to disk."
    Set-PromptedTextIfMissing "${prefix}_BASE_URL" "$($target.Kind) Base URL"
    Set-PromptedTextIfMissing "${prefix}_MODEL" "$($target.Kind) Model ID"

    $apiKeyPrompt = if ($target.ApiKeyRequired) {
      "$($target.Kind) API Key"
    }
    else {
      "$($target.Kind) API Key (optional; press Enter to skip)"
    }
    Set-PromptedSecretIfMissing "${prefix}_API_KEY" $apiKeyPrompt $target.ApiKeyRequired

    if ($PromptCustomHeaders) {
      Set-PromptedSecretIfMissing "${prefix}_HEADERS_JSON" "$($target.Kind) custom headers JSON (optional; press Enter to skip)" $false
    }
  }

  Get-Command pnpm -ErrorAction Stop | Out-Null
  & pnpm test:providers:live
  if ($null -eq $LASTEXITCODE) {
    throw 'Provider acceptance process did not return an exit code.'
  }
  $exitCode = $LASTEXITCODE
}
finally {
  Restore-ProcessEnvironment
}

exit $exitCode
