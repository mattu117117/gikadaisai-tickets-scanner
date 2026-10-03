param([string]$Source = "商品券.xlsx")
$ErrorActionPreference = 'Stop'
if (-not (Test-Path -LiteralPath $Source)) { throw "$Source が見つかりません。" }

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

$tickets = foreach ($row in $rows | Select-Object -Skip 1) {
  $values = @{}
  foreach ($cell in $row.c) { $values[(([string]$cell.r) -replace '\d','')] = CellValue $cell }
  $managementId = ([string]$values[$header['管理番号']]).Trim().ToLowerInvariant()
  if (-not $managementId) { continue }
  if ($managementId -notmatch '^([sdpm])(\d{2})-(\d{3})$') { throw "管理番号が不正です: $managementId" }
  $amount = [int][double]$values[$header['金額']]
  $recipientColumn = @('宛先(社名, 人名, 企画名)','配布先','宛先') | Where-Object { $header.ContainsKey($_) } | Select-Object -First 1
  [ordered]@{
    managementId = $managementId
    category = $Matches[1]
    sourceId = $Matches[2]
    serial = $Matches[3]
    recipient = if ($recipientColumn) { [string]$values[$header[$recipientColumn]] } else { '' }
    amount = $amount
  }
}

New-Item -ItemType Directory -Force -Path data | Out-Null
$tickets | ConvertTo-Json -Depth 3 -Compress | Set-Content -LiteralPath data\tickets.json -Encoding utf8NoBOM
Write-Output "Prepared $($tickets.Count) tickets in data\tickets.json"
