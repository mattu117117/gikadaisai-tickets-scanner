# 非公開の初期データ

このフォルダのJSONはGitHubへコミットしません。

- `tickets.json`: `scripts/prepare-data.ps1` が `商品券.xlsx` から生成します。
- `stores.json`: 店舗一覧です。各要素は `{"storeId":"...","storeName":"...","isActive":true}` の形式です。

両ファイルを用意してから `npm.cmd run seed -- https://your-domain SETUP_TOKEN` を実行します。
