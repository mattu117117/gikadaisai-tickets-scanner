# 技科大祭 商品券スキャナー

Vercel + Neon Postgresで動く、スマートフォン向け商品券回収アプリです。Google Apps Scriptのiframeを使わないため、iPhone/AndroidのChromeでVercelサイトへ直接カメラ権限を付与できます。

## 機能

- iPhone・Android ChromeからQRコードを連続読取
- カメラが使えない場合の管理番号手入力
- 同一商品券の二重使用をPostgreSQLの原子的更新で防止
- 店舗ごとの回収セッションと枚数・金額集計
- 管理画面 `/admin` で6種類のデータを検索・閲覧
- 管理画面からのデータ編集は不可
- 検索結果をGoogleスプレッドシートへ直接貼り付けられる形式でコピー
- 元のシートと同じ日本語列名でCSV出力

## データ

商品券CSV（またはExcel）の2,142件と店舗一覧を初回セットアップ時にNeonへ送信します。元データ、変換後JSON、内部要件は公開GitHubへコミットしない設定です。管理画面では次の6シート相当を表示・出力できます。

1. 商品券マスター
2. 使用ログ
3. 回収セッション
4. 店舗マスター
5. 担当者マスター
6. 取消ログ

## Vercelへ公開

### 1. GitHubからプロジェクトを作成

Vercelで `mattu117117/gikadaisai-tickets-scanner` をImportします。Framework Presetは `Other` のままで構いません。

### 2. Neon Postgresを追加

Vercelプロジェクトの `Storage` または `Marketplace` から `Neon` を追加します。接続後、`DATABASE_URL` がEnvironment Variablesへ登録されていることを確認します。

### 3. 環境変数を追加

Vercelの `Settings` → `Environment Variables` に次を登録します。

| 名前 | 内容 |
|---|---|
| `DATABASE_URL` | Neon連携で自動登録される接続URL |
| `ADMIN_PIN` | 管理画面で使用する6桁以上のPIN |
| `SETUP_TOKEN` | 初回DB作成専用の長いランダム文字列 |

## 練習環境

本番と同じGitHubリポジトリから別のVercelプロジェクトを作り、別のNeonデータベースを接続します。練習側だけ環境変数 `APP_ENV=training` を設定してください。

- 画面上部に「練習環境」を常時表示
- 管理画面から使用履歴・回収セッション・取消ログを初期化
- 全商品券を未使用へ戻して繰り返し練習
- `APP_ENV=training` ではない本番環境では初期化APIを拒否

練習環境にも `DATABASE_URL`、`ADMIN_PIN`、初期投入時だけ `SETUP_TOKEN` が必要です。商品券と店舗を投入した後、`SETUP_TOKEN` は削除できます。

値は `.env.example` を参考にし、実際の秘密情報をGitへコミットしないでください。

### 4. デプロイしてDBを初期化・投入

商品券CSVまたはExcelがある状態で、デプロイ完了後にPowerShellから次を実行します。

```powershell
.\scripts\prepare-data.ps1 -Source "商品券.csv"
npm.cmd run seed -- https://あなたのドメイン Vercelに設定したSETUP_TOKEN
```

`ticketCount` が `2142`、`storeCount` が `81` なら完了です。セットアップ処理は再実行しても既存の使用状態を消しません。

### 5. 動作確認

- スキャナー: `https://あなたのドメイン/`
- データ閲覧: `https://あなたのドメイン/admin`

Chromeでスキャナーを開き、「カメラを許可して回収開始」を押します。許可確認では「許可」を選択してください。

## スプレッドシートへ出力

管理画面でデータ種類を選び、必要なら検索します。

- `スプレッドシートへコピー`: 検索結果全件をタブ区切りでコピーします。GoogleスプレッドシートのA1へ貼り付けてください。
- `CSV出力`: 検索結果全件をUTF-8 BOM付きCSVで保存します。Googleスプレッドシートへインポートできます。

表示は100件ずつですが、コピーとCSVには検索に一致する全件が含まれます。

## ローカル確認

```powershell
npm.cmd install
npm.cmd run build
npm.cmd test
```

ローカルでAPIまで動かす場合はVercel CLIを導入し、`.env.local` に環境変数を設定して `vercel dev` を実行します。

## 構成

- `public/`: スキャナー・閲覧画面・ローカル配信するQRライブラリ
- `api/index.js`: Vercel Function API
- `db/schema.sql`: PostgreSQLスキーマ
- `data/`: 初期商品券・店舗データ
- `scripts/build.mjs`: QRライブラリを公開ディレクトリへ配置
- `scripts/prepare-data.ps1`: CSVまたはExcelを非公開の投入用JSONへ変換
- `scripts/seed.mjs`: 初期データをセットアップAPI経由でNeonへ投入

商品券CSV/Excel、`data/*.json`、`要件定義.txt` は `.gitignore` の対象です。データはGitHubやVercelの静的ファイルへ含めず、セットアップAPIからNeonへ直接送ります。
