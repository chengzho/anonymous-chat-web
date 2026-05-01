# API 規格文件

## Overview

後端透過 AWS API Gateway v2 提供單一 **WebSocket API**。本專案沒有 REST/HTTP endpoints，所有即時通訊都透過持久化的 WebSocket connection 完成。

**Endpoint format:**

```
wss://{api-id}.execute-api.{region}.amazonaws.com/{stage}
```

實際連線時，前端會在 `$connect` 階段透過 query string 傳入 `callsign` 與 `passcode`：

```
wss://{api-id}.execute-api.{region}.amazonaws.com/{stage}?callsign={callsign}&passcode={passcode}
```

其中：

- `callsign` 是使用者在聊天室中顯示的匿名名稱
- `passcode` 是 shared access passcode，只用於進入聊天室的驗證
- 前端應使用 `encodeURIComponent` 對 `callsign` 與 `passcode` 進行編碼
- `passcode` 不會被寫入 DynamoDB，也不會出現在後續的聊天訊息 payload 中

## Route Selection

API Gateway 會根據 WebSocket frame JSON body 中的 `action` 欄位決定要觸發哪一個 route：

```
Route Selection Expression: $request.body.action
```

| Route | Trigger | Lambda |
|-------|---------|--------|
| `$connect` | Client opens WebSocket connection | `connect.handler` |
| `$disconnect` | Client closes connection or connection drops | `disconnect.handler` |
| `sendMessage` | Client sends `{"action": "sendMessage", ...}` | `send_message.handler` |

## Route: `$connect`

**Trigger:** Client 發起 WebSocket handshake 時自動觸發。

**Query String Parameters:**

| Parameter | Required | Type | Description |
|-----------|----------|------|-------------|
| `callsign` | Yes | string | 使用者顯示名稱。長度 1–20 characters，只允許英文字母、數字與底線。 |
| `passcode` | Yes | string | Shared access passcode，用於限制誰可以進入聊天室。 |

**Example connection URL:**

```text
wss://abc123.execute-api.us-west-2.amazonaws.com/prod?callsign=CoolDog&passcode=demo123
```

**Lambda receives (event):**

```json
{
  "requestContext": {
    "connectionId": "abc123=",
    "routeKey": "$connect",
    "eventType": "CONNECT",
    "domainName": "abc123.execute-api.us-west-2.amazonaws.com",
    "stage": "prod"
  },
  "queryStringParameters": {
    "callsign": "CoolDog",
    "passcode": "demo123"
  }
}
```

**Response:**

| Status | Meaning |
|--------|---------|
| 200 | Connection accepted, `connectionId` stored |
| 400 | Missing or invalid `callsign` |
| 403 | Missing or invalid `passcode` |
| 429 | Room capacity reached, if `MAX_CONNECTIONS` is configured |
| 500 | Internal error, such as DynamoDB write failure |

**Note:** Returning a non-200 status code from `$connect` rejects the WebSocket handshake.

## Route: `$disconnect`

**Trigger:** Client 關閉 WebSocket connection、瀏覽器分頁關閉、網路中斷，或 WebSocket connection timeout 時自動觸發。

**Lambda receives (event):**

```json
{
  "requestContext": {
    "connectionId": "abc123=",
    "routeKey": "$disconnect",
    "eventType": "DISCONNECT",
    "domainName": "abc123.execute-api.us-west-2.amazonaws.com",
    "stage": "prod"
  }
}
```

**Parameters:** None. The `connectionId` is extracted from `requestContext`.

**Response:**

| Status | Meaning |
|--------|---------|
| 200 | Connection record deleted |
| 500 | Internal error, such as DynamoDB delete failure |

**Note:** The response status code for `$disconnect` is informational only — the connection is already closed.

## Route: `sendMessage`

**Trigger:** Client 透過 WebSocket connection 傳送 JSON frame，且其中 `"action"` 欄位為 `"sendMessage"`。

**WebSocket Frame (client → server):**

```json
{
  "action": "sendMessage",
  "text": "Hello everyone!"
}
```

| Field | Required | Type | Description |
|-------|----------|------|-------------|
| `action` | Yes | string | Must be `"sendMessage"` |
| `text` | Yes | string | 訊息內容。必須是 non-empty string，trim 後不可為空，最大長度 1000 characters。 |

**Note:** The `callsign` is **not** sent in the message body. It is retrieved from DynamoDB using the sender's `connectionId`, which was stored during `$connect`. This prevents callsign spoofing.

**Lambda receives (event):**

```json
{
  "requestContext": {
    "connectionId": "abc123=",
    "routeKey": "sendMessage",
    "eventType": "MESSAGE",
    "domainName": "abc123.execute-api.us-west-2.amazonaws.com",
    "stage": "prod"
  },
  "body": "{\"action\":\"sendMessage\",\"text\":\"Hello everyone!\"}"
}
```

**Broadcast payload (server → all clients):**

```json
{
  "type": "message",
  "callsign": "CoolDog",
  "text": "Hello everyone!",
  "timestamp": "2025-01-15T10:30:00Z"
}
```

**Response:**

| Status | Meaning |
|--------|---------|
| 200 | Message broadcasted |
| 400 | Missing or invalid `text` field |
| 500 | Internal error |

## Server-Push: PostToConnection

`send_message` Lambda 會使用 API Gateway Management API 將訊息主動推送給所有仍在線上的 WebSocket clients。

**API Gateway Management Endpoint:**

```text
https://{domainName}/{stage}
```

This is constructed from `event["requestContext"]["domainName"]` and `event["requestContext"]["stage"]`.

**SDK call:**

```python
apigw = boto3.client(
    "apigatewaymanagementapi",
    endpoint_url=f"https://{domain}/{stage}"
)

apigw.post_to_connection(
    ConnectionId="abc123=",
    Data=json.dumps(payload).encode("utf-8")
)
```

**Error handling:**

- `GoneException` (410): The connection is stale. Delete it from DynamoDB.
- Other exceptions: Log and continue to next connection.

## System Events (Server → Client)

除了聊天訊息之外，server 也可以選擇性推送 system events，例如使用者加入或離開聊天室。

這部分屬於 optional feature。MVP 版本可以先不實作，避免 `$connect` 與 `$disconnect` Lambda 增加額外延遲與權限複雜度。

**User joined:**

```json
{
  "type": "system",
  "event": "user_joined",
  "callsign": "CoolDog",
  "timestamp": "2025-01-15T10:30:00Z"
}
```

**User left:**

```json
{
  "type": "system",
  "event": "user_left",
  "callsign": "CoolDog",
  "timestamp": "2025-01-15T10:30:00Z"
}
```

## DynamoDB Table Schema

**Table name:** `ChatConnections`

| Attribute | Type | Key | Description |
|-----------|------|-----|-------------|
| `connectionId` | String | Partition Key | API Gateway assigned connection ID |
| `callsign` | String | — | User's display name |
| `connectedAt` | String | — | ISO 8601 timestamp of connection |

**Billing mode:** PAY_PER_REQUEST (on-demand)

No GSI or LSI required. The only access pattern is:

- PUT on connect
- DELETE on disconnect
- GET sender connection on sendMessage
- SCAN to get all connections for broadcast
- Optional SCAN or count-like check on connect if `MAX_CONNECTIONS` is configured

**Important:** `passcode` is never stored in DynamoDB. It is only used during the `$connect` validation step.

**Note on SCAN:** For a small-scale educational project, scanning the entire table is acceptable. For production scale or hundreds of concurrent users, consider pagination or a different fan-out strategy, such as SNS or another message distribution design.

## Access Control Behavior

This project does not implement full user authentication. There are no user accounts, password reset flows, JWTs, OAuth, or persistent sessions.

Instead, the system uses a shared access passcode at the WebSocket `$connect` stage:

1. The frontend collects a nickname and passcode from the welcome screen. The nickname value is sent as the `callsign` query parameter.
2. The frontend opens a WebSocket connection with both values in the query string.
3. The `$connect` Lambda validates the `callsign` format and the `passcode`.
4. If validation succeeds, the connection is accepted and stored in DynamoDB.
5. If validation fails, the Lambda returns a non-200 status code and API Gateway rejects the WebSocket handshake.

This design keeps the chat anonymous while still preventing arbitrary users from entering the room just by knowing the GitHub Pages URL.