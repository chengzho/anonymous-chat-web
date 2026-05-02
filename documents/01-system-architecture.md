# 系統架構總覽

## 專案名稱

**Anonymous Chatting Web** — 一個 serverless、single-channel、匿名聊天室系統，可透過手機與桌面瀏覽器使用。

**Repository:** `git@github.com:chengzho/anonymous-chat-web.git`

## 專案目標

- 提供匿名聊天室服務，不需要使用者註冊帳號
- 使用 shared passcode 作為聊天室進入限制，避免未授權使用者或過多人同時進入
- Single global channel，所有成功連線的使用者都能看到所有即時訊息
- 透過 WebSocket 進行 real-time 訊息傳遞
- 後端完全建置於 AWS serverless 架構
- 前端靜態網站部署於 GitHub Pages
- 最大限度維持架設簡單、成本低、易於部署與展示

## 高階系統架構

```text
┌─────────────────────────────┐
│   Browser (React)           │
│   GitHub Pages Host         │
│                             │
│   Access Gate:              │
│   - nickname input          │
│   - access passcode input   │
└──────────────┬──────────────┘
               │ WebSocket (wss://)
               │ ?callsign=...&passcode=...
               ▼
┌─────────────────────────────┐
│  API Gateway                │
│  (WebSocket API)            │
└──────────────┬──────────────┘
               │ Routes: $connect / $disconnect / sendMessage
               ▼
┌─────────────────────────────┐
│  AWS Lambda (x3)            │
│  Python 3.12                │
├─────────────────────────────┤
│  connect.handler            │──▶ Validate callsign and passcode
│                             │──▶ Optional: check MAX_CONNECTIONS
│                             │──▶ DynamoDB PUT (connectionId, callsign, connectedAt)
│  disconnect.handler         │──▶ DynamoDB DELETE (connectionId)
│  send_message.handler       │──▶ DynamoDB GET sender callsign
│                             │──▶ DynamoDB SCAN + PostToConnection fan-out
└──────────────┬──────────────┘
               │
               ▼
┌─────────────────────────────┐
│  DynamoDB Table             │
│  "ChatConnections"          │
│  PK: connectionId           │
│  Attr: callsign             │
│  Attr: connectedAt          │
└─────────────────────────────┘
```

## Component Summary

| Component | Technology | Purpose |
|-----------|-----------|---------|
| Frontend | React + Vite + TypeScript | 聊天室 UI，以靜態檔案方式提供 |
| Hosting | GitHub Pages | 部署並提供前端靜態網站 |
| API Gateway | AWS API Gateway v2 (WebSocket) | 管理 WebSocket 連線與路由 |
| Compute | AWS Lambda (Python 3.12) x3 | 處理連線、斷線與訊息廣播 |
| Storage | DynamoDB (on-demand) | 僅追蹤目前有效的 WebSocket connections |
| IaC | AWS SAM | 定義與部署所有 AWS 資源 |

## Data Flow

### 使用者進入聊天室

1. 使用者透過瀏覽器開啟 GitHub Pages 網址
2. 前端顯示進入頁面，包含標題匿名聊天室、暱稱輸入框、進入密碼輸入框
3. 使用者輸入暱稱與進入密碼後，瀏覽器開啟 WebSocket 連線至 API Gateway endpoint。前端會將暱稱映射為 `callsign` query parameter，將進入密碼映射為 `passcode` query parameter
4. WebSocket 連線 URL 會帶上 query string：

```
wss://{api-id}.execute-api.{region}.amazonaws.com/{stage}?callsign={callsign}&passcode={passcode}
```

5. API Gateway 觸發 `$connect` route，並呼叫 `connect` Lambda
6. `connect` Lambda 驗證：
   - `callsign` 是否符合格式限制
   - `passcode` 是否與後端設定的 shared passcode 相符
   - 是否超過最大連線數限制（若有設定）
7. 驗證成功後，Lambda 將 `connectionId`、`callsign` 與 `connectedAt` 寫入 DynamoDB
8. WebSocket 連線正式建立，使用者進入聊天室畫面

### 使用者送出訊息

1. 使用者在網頁輸入訊息並送出
2. Browser 透過 WebSocket 傳送 JSON payload：

```json
{
  "action": "sendMessage",
  "text": "Hello everyone!"
}
```

3. API Gateway 根據 `action` 欄位匹配 `sendMessage` route，並呼叫 `send_message` Lambda
4. `send_message` Lambda 根據 sender 的 `connectionId` 從 DynamoDB 取得對應的 `callsign`
5. Lambda 掃描 DynamoDB 中所有目前有效的 `connectionId`
6. Lambda 透過 API Gateway Management API 的 `PostToConnection` 將訊息推送給所有在線使用者
7. 如果 `PostToConnection` 回傳 `GoneException`，代表該連線已失效，Lambda 會從 DynamoDB 刪除該 stale connection

### 使用者離開聊天室

1. 使用者關閉瀏覽器、關閉分頁，或 WebSocket 連線中斷
2. API Gateway 觸發 `$disconnect` route，並呼叫 `disconnect` Lambda
3. `disconnect` Lambda 從 DynamoDB 刪除該使用者的 `connectionId`

## Key Design Decisions

### 為什麼使用 WebSocket API，而不是 SQS 或 MQTT？

- **SQS** 是 pull-based 機制。瀏覽器無法直接訂閱 SQS queue，因此需要額外的 polling layer，會增加延遲與系統複雜度。
- **IoT Core MQTT** 支援 browser WebSocket connections，但需要額外的 authentication 設定，對於單一頻道的簡易聊天室來說較重。
- **API Gateway WebSocket API** 原生支援 WebSocket 連線管理，也支援透過 `PostToConnection` 進行 server-push，並且在閒置時成本極低，適合 demo 與教育用途。

### 為什麼使用 shared passcode，而不是正式登入系統？

此專案的目標是建立一個匿名聊天室，而不是完整的會員登入系統。因此不設計使用者帳號、密碼資料表、JWT、OAuth 或 session management。

shared passcode 的目的只是作為簡單的 access gate：

- 避免不知道密碼的人直接進入聊天室
- 避免 GitHub Pages 網址外流後被任意使用
- 降低 workshop demo 或展示時被過多人同時連線的風險
- 維持匿名性與系統簡潔度

正確的設計是：前端只負責收集使用者輸入的進入密碼，真正的 passcode 驗證必須在 `$connect` Lambda 中完成。前端不應 hardcode 或儲存正確密碼，因為 GitHub Pages 是靜態網站，所有前端程式碼都可能被使用者檢視。

### 為什麼 DynamoDB 只儲存 connections，而不儲存訊息？

DynamoDB 在本專案中只儲存目前有效的 WebSocket connections，不儲存聊天訊息，這個角色類似「在線使用者通訊錄」，讓 `sendMessage` Lambda 能知道目前有哪些 connection 需要接收廣播訊息。

Lambda 本身是 stateless 的，不同 invocation 之間沒有共享記憶體，因此需要外部儲存來追蹤目前在線的 WebSocket connections。DynamoDB 是最輕量的 serverless 選項：單一資料表、無需自行管理伺服器、使用 on-demand billing，適合低流量 demo。

### 為什麼不保留聊天紀錄？

這是刻意設計的選擇，訊息只會即時傳送給當下在線的使用者，不會被保存。

這樣設計的優點包括：

- 無聊天歷史紀錄
- 無訊息儲存成本
- 降低資料保留與隱私風險
- 系統架構更簡單

### 為什麼使用 GitHub Pages？

GitHub Pages 提供免費靜態網站部署，非常適合部署 React + Vite 打包後的 frontend。

此專案的前端是一個 single-page application (SPA)，透過跨來源 WebSocket 連線連到 AWS API Gateway endpoint。WebSocket 連線不像一般 HTTP request 一樣受到相同形式的 CORS 限制，因此 GitHub Pages + API Gateway WebSocket API 是一個簡單且適合展示的組合。

### 為什麼設計最大連線數限制？

shared passcode 可以避免未知使用者進入，但無法限制知道密碼的人數。因此後端可以選擇性設定最大連線數，例如透過環境變數 `MAX_CONNECTIONS` 控制同時在線人數。

在 `$connect` Lambda 中，可以先檢查 DynamoDB 目前的 active connections 數量，如果超過限制，則拒絕新的 WebSocket 連線。這可以避免 demo 或 workshop 場景中一次有太多人同時連線，造成成本或體驗問題。

## Repository Structure

```
anonymous-chat-web/
├── documents/                      # Design and spec documents
├── webui/                          # Frontend (React + Vite + TypeScript)
├── lambda/
│   ├── connect/                    # $connect Lambda
│   ├── disconnect/                 # $disconnect Lambda
│   └── send_message/               # sendMessage Lambda
├── events/                         # SAM local test events
├── .github/
│   └── workflows/                  # GitHub Actions workflow
├── template.yaml                   # SAM template
├── README.md
└── .gitignore
```

## 低使用量成本估計

對於 demo 用途，若只有少量同時在線使用者，可維持在 AWS free tier 或極低成本範圍內：

- **Lambda:** 每月 1M free requests
- **API Gateway WebSocket:** 前 12 個月每月 1M messages free
- **DynamoDB:** 25 GB storage，25 WCU/RCU free
- **GitHub Pages:** Free
