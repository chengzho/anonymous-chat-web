# AWS 設定指南

## Overview

本文件說明 Anonymous WebSocket Chat 專案所需的 AWS resource provisioning。所有流程分成兩類：

- **Claude Code can do:** 可透過 CLI / SAM 自動化完成，Claude Code 可以協助執行。
- **Human intervention required:** 需要人工在 AWS Console、GitHub Console 操作，或涉及 credentials / permissions 等敏感資訊，不應交由 Claude Code 處理。

本專案使用 AWS serverless 架構，主要資源包含：

- API Gateway v2 WebSocket API
- AWS Lambda x3
- DynamoDB table
- IAM roles and permissions
- CloudFormation / AWS SAM deployment

## Prerequisites

### Human Must Verify

- [ ] AWS CLI v2 is installed and configured (`aws configure`)
- [ ] SAM CLI is installed (`sam --version`)
- [ ] Python 3.12 is installed
- [ ] AWS account has permissions for: API Gateway, Lambda, DynamoDB, IAM, CloudFormation
- [ ] An AWS region is chosen (recommended: `us-west-2`)
- [ ] A shared chat room passcode is prepared
- [ ] A SHA-256 hash of the shared passcode is generated for backend configuration

### Claude Code Can Verify

```bash
# Verify tooling is installed
aws --version
sam --version
python3 --version

# Verify AWS credentials are configured
aws sts get-caller-identity
```

### Generate Shared Passcode Hash

為了避免在 SAM template 或 Lambda code 中直接放入明文 passcode，正式設定建議使用 passcode hash。

Human 可以在本機執行以下指令產生 SHA-256 hash：

```bash
python3 - <<'PY'
import hashlib
import getpass

passcode = getpass.getpass("Enter shared chat passcode: ")
print(hashlib.sha256(passcode.encode("utf-8")).hexdigest())
PY
```

產生的 hash 會在 `sam deploy --guided` 時作為 `ChatAccessCodeHash` parameter 輸入。

**Important:** 不要把明文 passcode 寫入 frontend code、GitHub repository、README、commit history 或 GitHub Actions secrets。前端只負責讓使用者輸入 passcode，真正驗證由 `$connect` Lambda 完成。

## SAM Template (`template.yaml`)

> Claude Code: Create this file at the project root.

```yaml
AWSTemplateFormatVersion: '2010-09-09'
Transform: AWS::Serverless-2016-10-31
Description: Anonymous WebSocket Chat - Serverless Backend

Parameters:
  ChatAccessCodeHash:
    Type: String
    NoEcho: true
    MinLength: 64
    MaxLength: 64
    Description: SHA-256 hash of the shared passcode used to enter the chat room

  MaxConnections:
    Type: Number
    Default: 10
    MinValue: 1
    Description: Maximum number of concurrent WebSocket connections allowed

Globals:
  Function:
    Runtime: python3.12
    Timeout: 10
    MemorySize: 128
    Environment:
      Variables:
        TABLE_NAME: !Ref ConnectionsTable
        CHAT_ACCESS_CODE_HASH: !Ref ChatAccessCodeHash
        MAX_CONNECTIONS: !Ref MaxConnections

Resources:

  # --- WebSocket API ---
  ChatWebSocketApi:
    Type: AWS::ApiGatewayV2::Api
    Properties:
      Name: AnonymousChatWebSocketApi
      ProtocolType: WEBSOCKET
      RouteSelectionExpression: "$request.body.action"

  # --- Routes ---
  ConnectRoute:
    Type: AWS::ApiGatewayV2::Route
    Properties:
      ApiId: !Ref ChatWebSocketApi
      RouteKey: "$connect"
      AuthorizationType: NONE
      Target: !Sub "integrations/${ConnectIntegration}"

  DisconnectRoute:
    Type: AWS::ApiGatewayV2::Route
    Properties:
      ApiId: !Ref ChatWebSocketApi
      RouteKey: "$disconnect"
      AuthorizationType: NONE
      Target: !Sub "integrations/${DisconnectIntegration}"

  SendMessageRoute:
    Type: AWS::ApiGatewayV2::Route
    Properties:
      ApiId: !Ref ChatWebSocketApi
      RouteKey: "sendMessage"
      AuthorizationType: NONE
      Target: !Sub "integrations/${SendMessageIntegration}"

  # --- Integrations ---
  ConnectIntegration:
    Type: AWS::ApiGatewayV2::Integration
    Properties:
      ApiId: !Ref ChatWebSocketApi
      IntegrationType: AWS_PROXY
      IntegrationUri: !Sub "arn:aws:apigateway:${AWS::Region}:lambda:path/2015-03-31/functions/${ConnectFunction.Arn}/invocations"

  DisconnectIntegration:
    Type: AWS::ApiGatewayV2::Integration
    Properties:
      ApiId: !Ref ChatWebSocketApi
      IntegrationType: AWS_PROXY
      IntegrationUri: !Sub "arn:aws:apigateway:${AWS::Region}:lambda:path/2015-03-31/functions/${DisconnectFunction.Arn}/invocations"

  SendMessageIntegration:
    Type: AWS::ApiGatewayV2::Integration
    Properties:
      ApiId: !Ref ChatWebSocketApi
      IntegrationType: AWS_PROXY
      IntegrationUri: !Sub "arn:aws:apigateway:${AWS::Region}:lambda:path/2015-03-31/functions/${SendMessageFunction.Arn}/invocations"

  # --- Stage ---
  ProdStage:
    Type: AWS::ApiGatewayV2::Stage
    Properties:
      ApiId: !Ref ChatWebSocketApi
      StageName: prod
      AutoDeploy: true

  # --- Lambda Functions ---
  ConnectFunction:
    Type: AWS::Serverless::Function
    Properties:
      FunctionName: chat-connect
      Handler: connect.handler
      CodeUri: lambda/connect/
      Policies:
        - DynamoDBCrudPolicy:
            TableName: !Ref ConnectionsTable

  DisconnectFunction:
    Type: AWS::Serverless::Function
    Properties:
      FunctionName: chat-disconnect
      Handler: disconnect.handler
      CodeUri: lambda/disconnect/
      Policies:
        - DynamoDBCrudPolicy:
            TableName: !Ref ConnectionsTable

  SendMessageFunction:
    Type: AWS::Serverless::Function
    Properties:
      FunctionName: chat-send-message
      Handler: send_message.handler
      CodeUri: lambda/send_message/
      Policies:
        - DynamoDBCrudPolicy:
            TableName: !Ref ConnectionsTable
        - Statement:
            - Effect: Allow
              Action:
                - "execute-api:ManageConnections"
              Resource: !Sub "arn:aws:execute-api:${AWS::Region}:${AWS::AccountId}:${ChatWebSocketApi}/*"

  # --- Lambda Permissions (allow API Gateway to invoke) ---
  ConnectPermission:
    Type: AWS::Lambda::Permission
    Properties:
      Action: lambda:InvokeFunction
      FunctionName: !Ref ConnectFunction
      Principal: apigateway.amazonaws.com
      SourceArn: !Sub "arn:aws:execute-api:${AWS::Region}:${AWS::AccountId}:${ChatWebSocketApi}/*/$connect"

  DisconnectPermission:
    Type: AWS::Lambda::Permission
    Properties:
      Action: lambda:InvokeFunction
      FunctionName: !Ref DisconnectFunction
      Principal: apigateway.amazonaws.com
      SourceArn: !Sub "arn:aws:execute-api:${AWS::Region}:${AWS::AccountId}:${ChatWebSocketApi}/*/$disconnect"

  SendMessagePermission:
    Type: AWS::Lambda::Permission
    Properties:
      Action: lambda:InvokeFunction
      FunctionName: !Ref SendMessageFunction
      Principal: apigateway.amazonaws.com
      SourceArn: !Sub "arn:aws:execute-api:${AWS::Region}:${AWS::AccountId}:${ChatWebSocketApi}/*/sendMessage"

  # --- DynamoDB ---
  ConnectionsTable:
    Type: AWS::DynamoDB::Table
    Properties:
      TableName: ChatConnections
      AttributeDefinitions:
        - AttributeName: connectionId
          AttributeType: S
      KeySchema:
        - AttributeName: connectionId
          KeyType: HASH
      BillingMode: PAY_PER_REQUEST

Outputs:
  WebSocketUrl:
    Description: "WebSocket API endpoint"
    Value: !Sub "wss://${ChatWebSocketApi}.execute-api.${AWS::Region}.amazonaws.com/prod"

  ConnectionsTableName:
    Description: "DynamoDB table name"
    Value: !Ref ConnectionsTable
```

## Notes on SAM Template Design

### Shared Passcode

本專案使用 shared passcode 作為聊天室 access gate。正式設計中，前端不會儲存正確 passcode，也不會在 frontend code 中 hardcode passcode。

流程如下：

1. 使用者在前端輸入 `callsign` 與 `passcode`
2. 前端透過 query string 將兩者送到 WebSocket `$connect` endpoint
3. `connect` Lambda 將輸入的 `passcode` 做 SHA-256 hash
4. Lambda 將 hash 結果與環境變數 `CHAT_ACCESS_CODE_HASH` 比對
5. 比對成功才允許 WebSocket connection 建立

### Max Connections

`MAX_CONNECTIONS` 用於限制同時在線人數，避免 demo 或 workshop 場景中一次有太多人連線。

在 `$connect` Lambda 中，若目前 DynamoDB 中的 active connections 數量已達 `MAX_CONNECTIONS`，Lambda 應回傳 `429`，API Gateway 會拒絕該 WebSocket handshake。

### System Events

MVP 版本中，`connect` 與 `disconnect` Lambda 只負責新增與刪除 connection record，不主動廣播 `user_joined` 或 `user_left` system events。

如果未來要啟用 join / leave system events，則 `ConnectFunction` 與 `DisconnectFunction` 也需要額外加入 `execute-api:ManageConnections` 權限，類似 `SendMessageFunction` 的 policy。

## Deployment Procedures

### Claude Code Can Do

#### 1. Validate the SAM template

```bash
sam validate --template template.yaml
```

#### 2. Build the project

```bash
sam build
```

#### 3. Deploy after initial guided deploy

第一次 guided deployment 完成並產生 `samconfig.toml` 後，後續部署可以使用：

```bash
sam deploy --no-confirm-changeset
```

或：

```bash
sam deploy
```

#### 4. Get the WebSocket endpoint after deployment

```bash
aws cloudformation describe-stacks \
  --stack-name anonymous-chat \
  --query "Stacks[0].Outputs[?OutputKey=='WebSocketUrl'].OutputValue" \
  --output text
```

#### 5. Test WebSocket connectivity with `wscat`

If `wscat` is not installed:

```bash
npm install -g wscat
```

Test connection:

```bash
wscat -c "wss://{api-id}.execute-api.{region}.amazonaws.com/prod?callsign=TestUser&passcode={your-passcode}"
```

Send a test message after connection is established:

```json
{"action":"sendMessage","text":"Hello from wscat!"}
```

#### 6. View Lambda logs

```bash
sam logs -n ConnectFunction --stack-name anonymous-chat --tail
sam logs -n SendMessageFunction --stack-name anonymous-chat --tail
```

#### 7. Check DynamoDB connections table

```bash
aws dynamodb scan --table-name ChatConnections
```

#### 8. Delete the stack for teardown

```bash
sam delete --stack-name anonymous-chat --no-prompts
```

### Human Intervention Required

#### 1. Initial guided deployment, first time only

The first `sam deploy` must be interactive to set stack parameters:

```bash
sam deploy --guided
```

Human must answer the prompts:

| Prompt | Recommended Value |
|--------|------------------|
| Stack Name | `anonymous-chat` |
| AWS Region | `us-west-2` or preferred region |
| Parameter `ChatAccessCodeHash` | SHA-256 hash generated from the shared passcode |
| Parameter `MaxConnections` | `10` or preferred maximum concurrent users |
| Confirm changes before deploy | `N` |
| Allow SAM CLI IAM role creation | `Y` |
| Disable rollback | `N` |
| Save arguments to samconfig.toml | `Y`, but do not commit sensitive parameter values |

**Why Claude Code cannot do this:** The `--guided` flag requires interactive terminal input. It also requires the human to provide the shared passcode hash and approve IAM role creation.

**Important:** If `samconfig.toml` contains `ChatAccessCodeHash`, do not commit it to GitHub. Add it to `.gitignore` if necessary.

```text
samconfig.toml
```

#### 2. AWS credentials setup

If AWS CLI is not yet configured:

```bash
aws configure
```

Human must provide:

- AWS Access Key ID
- AWS Secret Access Key
- Default region
- Output format

**Why Claude Code cannot do this:** Credentials are sensitive. Claude Code should never handle AWS access keys.

#### 3. GitHub Pages configuration

After the frontend is built and pushed to the repository:

1. Go to GitHub repo → Settings → Pages
2. Choose the deployment source
3. If using `peaceiris/actions-gh-pages`, set source to the `gh-pages` branch
4. Save the configuration

**Why Claude Code cannot do this:** Requires GitHub web UI interaction with authenticated session.

#### 4. GitHub Actions environment variable

Frontend production build needs the deployed WebSocket endpoint.

After AWS deployment, get the WebSocket endpoint from CloudFormation output:

```bash
aws cloudformation describe-stacks \
  --stack-name anonymous-chat \
  --query "Stacks[0].Outputs[?OutputKey=='WebSocketUrl'].OutputValue" \
  --output text
```

Then add this value as a GitHub repository secret:

```text
VITE_WS_ENDPOINT
```

Example value:

```text
wss://abc123.execute-api.us-west-2.amazonaws.com/prod
```

**Important:** Do not store the chat passcode in GitHub Actions secrets for frontend use. The frontend should not know the correct passcode. Users enter the passcode at runtime, and validation happens in the `$connect` Lambda.

#### 5. GitHub Actions workflow for GitHub Pages

The frontend is located in `webui/`, so the GitHub Actions workflow must build from that directory and publish `webui/dist`.

Example workflow:

```yaml
# .github/workflows/deploy.yml
name: Deploy to GitHub Pages

on:
  push:
    branches: [main]
    paths:
      - "webui/**"
      - ".github/workflows/deploy.yml"

jobs:
  deploy:
    runs-on: ubuntu-latest

    env:
      VITE_WS_ENDPOINT: ${{ secrets.VITE_WS_ENDPOINT }}

    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 20

      - name: Install dependencies and build
        run: cd webui && npm ci && npm run build

      - name: Deploy to GitHub Pages
        uses: peaceiris/actions-gh-pages@v3
        with:
          github_token: ${{ secrets.GITHUB_TOKEN }}
          publish_dir: ./webui/dist
```

#### 6. Custom domain, optional

If a custom domain is desired for the WebSocket API:

1. Register/configure domain in Route 53 or external DNS
2. Create ACM certificate in the same region as API Gateway
3. Configure custom domain in API Gateway console

**Why Claude Code cannot do this:** Certificate validation requires DNS record creation and domain ownership verification.

## Environment Variables

| Variable | Set By | Value |
|----------|--------|-------|
| `TABLE_NAME` | SAM template | DynamoDB table name via `!Ref ConnectionsTable` |
| `CHAT_ACCESS_CODE_HASH` | SAM parameter | SHA-256 hash of the shared chat passcode |
| `MAX_CONNECTIONS` | SAM parameter | Maximum number of concurrent WebSocket connections |

No manual Lambda environment variable configuration is needed. SAM injects these variables into all Lambda functions automatically.

## IAM Permissions Summary

SAM creates the IAM roles automatically. Here is what each Lambda gets:

| Function | Permissions |
|----------|-------------|
| `connect` | DynamoDB CRUD on `ChatConnections` table |
| `disconnect` | DynamoDB CRUD on `ChatConnections` table |
| `send_message` | DynamoDB CRUD on `ChatConnections` table + `execute-api:ManageConnections` on the WebSocket API |

### Notes

- `connect` requires DynamoDB write permission to store new connection records.
- `connect` may use DynamoDB scan permission to enforce `MAX_CONNECTIONS`.
- `disconnect` requires DynamoDB delete permission to remove closed connections.
- `send_message` requires DynamoDB read/scan permission to find active connections and `execute-api:ManageConnections` permission to call `PostToConnection`.
- If join / leave system events are enabled in the future, `connect` and `disconnect` also need `execute-api:ManageConnections`.

## Post-Deployment Verification Checklist

Claude Code can run these checks after deployment:

```bash
# 1. Stack deployed successfully?
aws cloudformation describe-stacks --stack-name anonymous-chat \
  --query "Stacks[0].StackStatus" --output text
# Expected: CREATE_COMPLETE or UPDATE_COMPLETE

# 2. WebSocket API exists?
aws apigatewayv2 get-apis \
  --query "Items[?Name=='AnonymousChatWebSocketApi'].ApiId" --output text

# 3. DynamoDB table exists?
aws dynamodb describe-table --table-name ChatConnections \
  --query "Table.TableStatus" --output text
# Expected: ACTIVE

# 4. Lambda functions exist?
aws lambda get-function --function-name chat-connect --query "Configuration.FunctionName"
aws lambda get-function --function-name chat-disconnect --query "Configuration.FunctionName"
aws lambda get-function --function-name chat-send-message --query "Configuration.FunctionName"
```

## End-to-End Manual Smoke Test

After deployment, human or Claude Code can perform a basic smoke test.

### 1. Get WebSocket endpoint

```bash
aws cloudformation describe-stacks \
  --stack-name anonymous-chat \
  --query "Stacks[0].Outputs[?OutputKey=='WebSocketUrl'].OutputValue" \
  --output text
```

### 2. Open first terminal and connect as Alice

```bash
wscat -c "wss://{api-id}.execute-api.{region}.amazonaws.com/prod?callsign=Alice&passcode={your-passcode}"
```

### 3. Open second terminal and connect as Bob

```bash
wscat -c "wss://{api-id}.execute-api.{region}.amazonaws.com/prod?callsign=Bob&passcode={your-passcode}"
```

### 4. Send message from Alice

```json
{"action":"sendMessage","text":"Hello Bob!"}
```

### 5. Expected result

Both Alice and Bob should receive a broadcast payload similar to:

```json
{
  "type": "message",
  "callsign": "Alice",
  "text": "Hello Bob!",
  "timestamp": "2025-01-15T10:30:00Z"
}
```

### 6. Test invalid passcode

```bash
wscat -c "wss://{api-id}.execute-api.{region}.amazonaws.com/prod?callsign=BadUser&passcode=wrong-passcode"
```

Expected result:

- WebSocket handshake should be rejected
- `connect` Lambda should return `403`
- No record should be inserted into `ChatConnections`

## Cleanup

To avoid unnecessary AWS resource usage after demo or testing:

```bash
sam delete --stack-name anonymous-chat --no-prompts
```

Then verify DynamoDB table and API Gateway are removed:

```bash
aws dynamodb describe-table --table-name ChatConnections
aws apigatewayv2 get-apis \
  --query "Items[?Name=='AnonymousChatWebSocketApi']"
```