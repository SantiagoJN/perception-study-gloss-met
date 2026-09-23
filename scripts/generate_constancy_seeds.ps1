$ErrorActionPreference = 'Stop'

$project = Split-Path -Parent $PSScriptRoot
$root = Split-Path -Parent $project
$mining = Join-Path $root 'mining_pairs_v2'
$output = Join-Path $project 'supabase_seeds'
$public = Join-Path $project 'public'

$selected = Import-Csv (Join-Path $mining 'selection\pairs_selected_complete.csv')
$reserve = Import-Csv (Join-Path $mining 'selection\pairs_reserve_complete.csv')
$metadata = Import-Csv (Join-Path $mining 'tables\image_metadata_validated.csv')
$descriptorRows = Import-Csv (Join-Path $mining 'tables\image_descriptors.csv')
$sha256 = [System.Security.Cryptography.SHA256]::Create()
$publicPaths = @{}
foreach ($row in $metadata) {
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($row.image_png)
  $hash = [System.BitConverter]::ToString($sha256.ComputeHash($bytes)).Replace('-', '').ToLowerInvariant()
  $publicPaths[$row.image_png] = "stimuli/$hash.png"
}
$sha256.Dispose()
$eligible = @{}
foreach ($row in $descriptorRows) {
  $eligible[$row.image_id] = $row.selection_eligible -eq 'True'
}

$pairRows = foreach ($row in $selected) {
  [pscustomobject]@{
    pair_id = $row.pair_id
    physical_type = $row.physical_type
    provisional_level = $row.provisional_level
    change_type = $row.change_type
    image_path_a = $publicPaths[$row.image_path_a]
    image_path_b = $publicPaths[$row.image_path_b]
    material_a = $row.material_a
    material_b = $row.material_b
    group_id = $row.group_a
    target_labels = 10
    completed_labels = 0
    reserved_labels = 0
    active = 'true'
  }
}

$sceneIndex = @{}
foreach ($row in $metadata) {
  if (-not $eligible[$row.image_id]) { continue }
  $key = '{0}|{1}|{2}' -f $row.group_id, $row.geometry_id, $row.environment_id
  if (-not $sceneIndex.ContainsKey($key)) {
    $sceneIndex[$key] = [System.Collections.Generic.List[object]]::new()
  }
  $sceneIndex[$key].Add($row)
}

$referenceRows = [System.Collections.Generic.List[object]]::new()
$skipped = [System.Collections.Generic.List[string]]::new()
foreach ($row in @($selected) + @($reserve)) {
  if ($referenceRows.Count -ge 1200) { break }
  if ($row.physical_type -ne 'same_material') { continue }
  $key = '{0}|{1}|{2}' -f $row.group_b, $row.geometry_b, $row.environment_b
  $byMaterial = @{}
  foreach ($candidate in $sceneIndex[$key]) {
    if ($candidate.material_id -eq $row.material_a) { continue }
    if (-not $byMaterial.ContainsKey($candidate.material_id)) {
      $byMaterial[$candidate.material_id] = $candidate.image_png
    }
  }
  $distractors = @($byMaterial.GetEnumerator() | Sort-Object Name | ForEach-Object Value)
  if ($distractors.Count -ne 3) {
    $skipped.Add($row.pair_id)
    continue
  }
  $referenceRows.Add([pscustomobject]@{
    reference_id = 'REF_' + $row.pair_id
    source_pair_id = $row.pair_id
    provisional_level = $row.provisional_level
    change_type = $row.change_type
    reference_path = $publicPaths[$row.image_path_a]
    correct_candidate_path = $publicPaths[$row.image_path_b]
    distractor_path_1 = $publicPaths[$distractors[0]]
    distractor_path_2 = $publicPaths[$distractors[1]]
    distractor_path_3 = $publicPaths[$distractors[2]]
    target_labels = 10
    completed_labels = 0
    reserved_labels = 0
    active = 'true'
  })
}

if ($pairRows.Count -ne 2400 -or $referenceRows.Count -ne 1200) {
  throw "Unexpected seed counts: $($pairRows.Count) pairs, $($referenceRows.Count) references"
}

New-Item -ItemType Directory -Force -Path $output, $public | Out-Null
$metadata | ForEach-Object {
  [pscustomobject]@{
    source_path = $_.image_png
    object_key = $publicPaths[$_.image_png]
  }
} | Export-Csv -LiteralPath (Join-Path $project 'cloudflare_upload_manifest.csv') -NoTypeInformation -Encoding utf8
$pairPath = Join-Path $output 'constancy_pairs.csv'
$referencePath = Join-Path $output 'constancy_reference_sets.csv'
$pairRows | Export-Csv -LiteralPath $pairPath -NoTypeInformation -Encoding utf8
$referenceRows | Export-Csv -LiteralPath $referencePath -NoTypeInformation -Encoding utf8

$preview = [ordered]@{
  pairs = @($pairRows | Select-Object -First 4 pair_id, image_path_a, image_path_b)
  references = @($referenceRows | Select-Object -First 2 | ForEach-Object {
    [pscustomobject]@{
      reference_id = $_.reference_id
      reference_path = $_.reference_path
      candidate_paths = @(
        $_.correct_candidate_path,
        $_.distractor_path_1,
        $_.distractor_path_2,
        $_.distractor_path_3
      ) | Sort-Object { Get-Random }
    }
  })
}
$preview | ConvertTo-Json -Depth 5 -Compress | Set-Content -LiteralPath (Join-Path $public 'constancy_preview.json') -Encoding utf8

$manifest = [ordered]@{
  source = 'mining_pairs_v2/selection/pairs_selected_complete.csv'
  pair_count = $pairRows.Count
  reference_set_count = $referenceRows.Count
  skipped_selected_reference_pairs = @($skipped | Where-Object { $_ -like 'V2_PILOT_*' }).Count
  pair_seed_sha256 = (Get-FileHash -LiteralPath $pairPath -Algorithm SHA256).Hash.ToLowerInvariant()
  reference_seed_sha256 = (Get-FileHash -LiteralPath $referencePath -Algorithm SHA256).Hash.ToLowerInvariant()
}
$manifest | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $output 'manifest.json') -Encoding utf8
$manifest | ConvertTo-Json
