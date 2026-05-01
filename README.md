# Anonymous Chatting Web — 匿名聊天室

一個基於 **WebSocket** 的匿名即時聊天室，前端使用 React + Vite + TypeScript，部署於 GitHub Pages；後端使用 AWS API Gateway WebSocket API、AWS Lambda 與 DynamoDB 建立 serverless 即時訊息系統。

> 本專案以 Agentic AI Engineering workflow 為練習目標，重點放在系統規格設計、Pencil UI 設計、Claude Code 輔助實作、AWS serverless 後端部署，以及 GitHub Pages 前端部署。

---

## Demo

- GitHub Pages：`https://chengzho.github.io/anonymous-chat-web/`
- WebSocket Backend：AWS API Gateway WebSocket API

> Demo URL 會在前端部署完成後啟用。

---

## 專案特色

- 匿名聊天室
  - 不需要註冊帳號
  - 使用者只需輸入暱稱即可進入聊天室

- Shared Passcode Access Gate
  - 進入聊天室前需要輸入 shared passcode
  - 前端不儲存正確密碼
  - 後端在 `$connect` Lambda 驗證 passcode hash

- Real-time WebSocket Chat
  - 使用 AWS API Gateway WebSocket API
  - 訊息透過 WebSocket 即時廣播給所有在線使用者

- Serverless Backend
  - 使用 AWS Lambda 處理 connect、disconnect、sendMessage
  - 使用 DynamoDB 儲存目前在線的 WebSocket connections
  - 不儲存聊天紀錄

- Static Frontend Hosting
  - 前端部署於 GitHub Pages
  - 使用 GitHub Actions 自動部署

- AI-assisted Development Workflow
  - 使用 Pencil 產生 UI 設計稿
  - 使用 Claude Code 根據規格文件協助實作前後端
  - 使用 AWS SAM 定義與部署 serverless resources

---

## Tech Stack

### Frontend

- React
- TypeScript
- Vite
- CSS
- GitHub Pages
- GitHub Actions

### Backend

- AWS API Gateway v2 WebSocket API
- AWS Lambda
- Python 3.12
- DynamoDB
- AWS SAM

### Development Workflow

- Pencil
- Claude Code
- GitHub
- Docker
- AWS CLI
- SAM CLI

---

## 系統架構

```text
Browser
  ↓
GitHub Pages Frontend
  ↓ WebSocket
API Gateway WebSocket API
  ↓
Lambda Functions
  ├── connect
  ├── disconnect
  └── send_message
  ↓
DynamoDB ChatConnections
```

---

## 專案結構

```text
anonymous-chat-web/
├── documents/                      # 系統設計與規格文件
├── webui/                          # Frontend: React + Vite + TypeScript
├── lambda/
│   ├── connect/                    # $connect Lambda
│   ├── disconnect/                 # $disconnect Lambda
│   └── send_message/               # sendMessage Lambda
├── .github/
│   └── workflows/                  # GitHub Actions workflow
├── template.yaml                   # AWS SAM template
├── README.md
└── .gitignore
```

---

## 本地開發

### Frontend

```bash
cd webui
npm install
npm run dev
```

建立 `webui/.env.local`：

```text
VITE_WS_ENDPOINT=wss://{your-api-id}.execute-api.{region}.amazonaws.com/prod
```

### Backend

確認工具已安裝：

```bash
aws --version
sam --version
python3 --version
docker --version
```

部署前需先設定 AWS CLI：

```bash
aws configure
```

確認目前 AWS identity：

```bash
aws sts get-caller-identity
```

---

## Shared Passcode 設定

本專案使用 shared passcode 作為聊天室進入限制。

正式設計中：

- 前端只收集使用者輸入的 passcode
- 前端不儲存正確 passcode
- 正確 passcode 不應寫入 GitHub
- 後端只保存 passcode 的 SHA-256 hash
- `$connect` Lambda 負責驗證 passcode

產生 passcode hash：

```bash
python3 - <<'PY'
import hashlib
import getpass

passcode = getpass.getpass("Enter shared chat passcode: ")
print(hashlib.sha256(passcode.encode("utf-8")).hexdigest())
PY
```

產生的 hash 會在 `sam deploy --guided` 時作為 `ChatAccessCodeHash` parameter 輸入。

---

## AWS Backend Deployment

Validate SAM template：

```bash
sam validate --template template.yaml
```

Build：

```bash
sam build
```

第一次部署：

```bash
sam deploy --guided
```

後續部署：

```bash
sam deploy
```

取得 WebSocket endpoint：

```bash
aws cloudformation describe-stacks \
  --stack-name anonymous-chat \
  --query "Stacks[0].Outputs[?OutputKey=='WebSocketUrl'].OutputValue" \
  --output text
```

---

## Frontend Deployment

本專案前端部署於 GitHub Pages。

GitHub Actions 需要設定：

```text
VITE_WS_ENDPOINT
```

此值為 AWS 部署完成後取得的 WebSocket endpoint，例如：

```text
wss://{api-id}.execute-api.{region}.amazonaws.com/prod
```

> 注意：不要將聊天室 passcode 放入前端環境變數。`VITE_` 開頭的環境變數會被打包進前端程式碼。

---

## 設計與開發流程

本專案的設計與實作流程大致如下：

1. 撰寫系統架構、API、Lambda 與前端設計規格文件
2. 使用 Pencil 根據規格文件產生 UI 設計稿
3. 使用 Claude Code 根據設計稿與 markdown specifications 實作前端
4. 使用 Claude Code 根據 Lambda specifications 與 AWS configuration 實作後端
5. 使用 AWS SAM 部署 API Gateway、Lambda 與 DynamoDB
6. 使用 GitHub Actions 將前端部署到 GitHub Pages
7. 進行端對端測試與修正

---

## 後續延伸方向

未來可以進一步延伸：

- 顯示目前在線人數
- 加入 user joined / user left system events
- 加入深色模式
- 加入聊天室主題切換
- 加入訊息時間排序與簡易 message ID
- 加入更完整的 rate limiting 或 abuse protection
- 使用 CloudWatch Dashboard 觀察 WebSocket traffic 與 Lambda logs

---

## Notes

此專案為 workshop / portfolio demo 用途，重點是展示：

- Agentic AI-assisted development workflow
- Serverless WebSocket architecture
- GitHub Pages frontend deployment
- AWS Lambda backend deployment
- Prompt-driven specification-first development