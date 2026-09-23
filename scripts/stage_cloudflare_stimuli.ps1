param(
  [Parameter(Mandatory = $true)]
  [string]$DatasetRoot,

  [string]$StagingRoot = (Join-Path (Split-Path -Parent $PSScriptRoot) '.r2_staging')
)

$ErrorActionPreference = 'Stop'
$project = Split-Path -Parent $PSScriptRoot
$manifestPath = Join-Path $project 'cloudflare_upload_manifest.csv'

if (-not (Test-Path -LiteralPath $manifestPath)) {
  throw 'Run generate_constancy_seeds.ps1 first.'
}

$datasetRootPath = (Resolve-Path -LiteralPath $DatasetRoot).Path
$stagingPath = [System.IO.Path]::GetFullPath($StagingRoot)
$rows = Import-Csv -LiteralPath $manifestPath

foreach ($row in $rows) {
  $source = Join-Path $datasetRootPath $row.source_path.Replace('/', [System.IO.Path]::DirectorySeparatorChar)
  if (-not (Test-Path -LiteralPath $source)) {
    throw "Missing source image: $source"
  }
  $target = Join-Path $stagingPath $row.object_key.Replace('/', [System.IO.Path]::DirectorySeparatorChar)
  $targetDirectory = Split-Path -Parent $target
  New-Item -ItemType Directory -Force -Path $targetDirectory | Out-Null
  if (-not (Test-Path -LiteralPath $target)) {
    try {
      New-Item -ItemType HardLink -Path $target -Target $source | Out-Null
    } catch {
      $reason = $_.Exception.Message
      throw "Could not create a hard link for $source. Windows reported: $reason. On mapped/network filesystems such as SSHFS, use upload_cloudflare_stimuli.ps1 instead."
    }
  }
}

Write-Host "Staged $($rows.Count) opaque image links in $stagingPath"
Write-Host 'Upload the staging directory with the rclone command in DEPLOYMENT.md.'
