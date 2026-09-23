param(
  [Parameter(Mandatory = $true)]
  [string]$DatasetRoot,

  [Parameter(Mandatory = $true)]
  [string]$Remote,

  [ValidateRange(1, 32)]
  [int]$Transfers = 8
)

$ErrorActionPreference = 'Stop'
$project = Split-Path -Parent $PSScriptRoot
$manifestPath = Join-Path $project 'cloudflare_upload_manifest.csv'

if (-not (Test-Path -LiteralPath $manifestPath)) {
  throw 'Run generate_constancy_seeds.ps1 first.'
}
$rcloneCommand = Get-Command rclone -ErrorAction SilentlyContinue
if ($rcloneCommand) {
  $rcloneExe = $rcloneCommand.Source
} else {
  $toolsRoot = Join-Path (Split-Path -Parent $project) '.tools\rclone'
  $rcloneExe = Get-ChildItem -LiteralPath $toolsRoot -Recurse -Filter rclone.exe -ErrorAction SilentlyContinue |
    Select-Object -First 1 -ExpandProperty FullName
}
if (-not $rcloneExe) {
  throw 'rclone was not found in PATH or in the workspace .tools/rclone directory.'
}

$datasetRootPath = (Resolve-Path -LiteralPath $DatasetRoot).Path
$remoteRoot = $Remote.TrimEnd('/')
$rows = Import-Csv -LiteralPath $manifestPath
$jobs = foreach ($row in $rows) {
  $source = Join-Path $datasetRootPath $row.source_path.Replace('/', [System.IO.Path]::DirectorySeparatorChar)
  if (-not (Test-Path -LiteralPath $source)) {
    throw "Missing source image: $source"
  }
  [pscustomobject]@{
    source = $source
    object_key = $row.object_key
  }
}

Write-Host "Uploading $($jobs.Count) opaque objects to $remoteRoot with $Transfers parallel transfers..."
$results = $jobs | ForEach-Object -Parallel {
  $target = "$using:remoteRoot/$($_.object_key)"
  $messages = & $using:rcloneExe copyto $_.source $target `
    --ignore-existing `
    --no-traverse `
    --retries 3 `
    --low-level-retries 10 `
    --quiet 2>&1
  [pscustomobject]@{
    source = $_.source
    target = $target
    exit_code = $LASTEXITCODE
    message = ($messages -join [Environment]::NewLine)
  }
} -ThrottleLimit $Transfers

$failures = @($results | Where-Object { $_.exit_code -ne 0 })
if ($failures.Count -gt 0) {
  $failureLog = Join-Path $project 'cloudflare_upload_failures.csv'
  $failures | Export-Csv -LiteralPath $failureLog -NoTypeInformation -Encoding utf8
  throw "$($failures.Count) uploads failed. Details: $failureLog. Rerun the same command after correcting the error; existing objects will be skipped."
}

Write-Host "Upload complete: $($results.Count) objects processed successfully."
