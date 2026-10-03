param([string]$Source = "商品券.xlsx")
$ErrorActionPreference = 'Stop'
if (-not (Test-Path -LiteralPath $Source)) { throw "$Source が見つかりません。" }

$extension = [IO.Path]::GetExtension($Source).ToLowerInvariant()
$sourceRows = @()

if ($extension -eq '.csv') {
  $rows = @(Import-Csv -LiteralPath $Source -Encoding utf8)
  if (-not $rows.Count) { throw 'CSVに商品券データがありません。' }
  $headers = @($rows[0].PSObject.Properties.Name)
  foreach ($required in @('管理番号','金額')) {
    if ($required -notin $headers) { throw "$required 列がありません。" }
  }
  $recipientColumn = @('宛先(社名, 人名, 企画名)','配布先','宛先') |
    Where-Object { $_ -in $headers } | Select-Object -First 1
  $sourceRows = @($rows | ForEach-Object {
    [pscustomobject][ordered]@{
      managementId = [string]$_.管理番号
      recipient = if ($recipientColumn) { [string]$_.$recipientColumn } else { '' }
      amount = [string]$_.金額
    }
  })
}
elseif ($extension -eq '.xlsx') {
  $sharedXml = [xml](tar -xOf $Source xl/sharedStrings.xml)
  $sheetXml = [xml](tar -xOf $Source xl/worksheets/sheet1.xml)
  $strings = @($sharedXml.sst.si | ForEach-Object {
    if ($_.t) { [string]$_.t } else { ($_.r | ForEach-Object { [string]$_.t }) -join '' }
  })
  function CellValue($cell) {
    $value = [string]$cell.v
    if ($cell.t -eq 's') { return $strings[[int]$value] }
    return $value
  }

  $rows = @($sheetXml.worksheet.sheetData.row)
  $header = @{}
  foreach ($cell in $rows[0].c) {
    $column = ([string]$cell.r) -replace '\d',''
    $header[(CellValue $cell)] = $column
  }
  foreach ($required in @('管理番号','金額')) {
    if (-not $header.ContainsKey($required)) { throw "$required 列がありません。" }
  }
  $recipientColumn = @('宛先(社名, 人名, 企画名)','配布先','宛先') |
    Where-Object { $header.ContainsKey($_) } | Select-Object -First 1
  $sourceRows = @($rows | Select-Object -Skip 1 | ForEach-Object {
    $values = @{}
    foreach ($cell in $_.c) { $values[(([string]$cell.r) -replace '\d','')] = CellValue $cell }
    [pscustomobject][ordered]@{
      managementId = [string]$values[$header['管理番号']]
      recipient = if ($recipientColumn) { [string]$values[$header[$recipientColumn]] } else { '' }
      amount = [string]$values[$header['金額']]
    }
  })
}
else {
  throw '対応形式は .xlsx または .csv です。'
}

$tickets = @($sourceRows | ForEach-Object {
  $managementId = ([string]$_.managementId).Trim().ToLowerInvariant()
  if (-not $managementId) { return }
  if ($managementId -notmatch '^([sdpm])(\d{2})-(\d{3})$') { throw "管理番号が不正です: $managementId" }
  $category = $Matches[1]
  $sourceId = $Matches[2]
  $serial = $Matches[3]
  $parsedAmount = 0
  if (-not [int]::TryParse(([string]$_.amount).Trim(), [ref]$parsedAmount) -or $parsedAmount -lt 0) {
    throw "金額が不正です: $managementId ($($_.amount))"
  }
  [pscustomobject][ordered]@{
    managementId = $managementId
    category = $category
    sourceId = $sourceId
    serial = $serial
    recipient = ([string]$_.recipient).Trim()
    amount = $parsedAmount
  }
})

$duplicates = @($tickets | Group-Object managementId | Where-Object Count -gt 1)
if ($duplicates.Count) { throw "管理番号が重複しています: $($duplicates[0].Name)" }

New-Item -ItemType Directory -Force -Path data | Out-Null
$tickets | ConvertTo-Json -Depth 3 -Compress | Set-Content -LiteralPath data\tickets.json -Encoding utf8NoBOM
Write-Output "Prepared $($tickets.Count) tickets in data\tickets.json"
