# Lambda 規格文件：connect

## Function Identity

| Field | Value |
|-------|-------|
| Function Name | `chat-connect` |
| Handler | `connect.handler` |
| Runtime | Python 3.12 |
| Code Location | `lambda/connect/connect.py` |
| Route | `$connect` |
| Timeout | 10 seconds |
| Memory | 128 MB |

## Purpose

處理新的 WebSocket connection。

此 Lambda 會在使用者嘗試進入聊天室時被 API Gateway `$connect` route 觸發，主要負責：

1. 驗證使用者的 `callsign`
2. 驗證 shared access `passcode`
3. 檢查目前在線人數是否超過 `MAX_CONNECTIONS`
4. 將通過驗證的 `connectionId` 與使用者 `callsign` 寫入 DynamoDB

DynamoDB 只會儲存目前有效的 WebSocket connections，不會儲存 passcode，也不會儲存聊天訊息。

## Input

**Event source:** API Gateway WebSocket `$connect` route.

**Relevant fields from `event`:**

```python
connection_id = event["requestContext"]["connectionId"]  # mandatory, provided by API Gateway

query_params = event.get("queryStringParameters") or {}
callsign = query_params.get("callsign")                  # mandatory, from client
passcode = query_params.get("passcode")                  # mandatory, from client
```

**Important:** `queryStringParameters` 可能是 `None`，因此實作時必須使用：

```python
query_params = event.get("queryStringParameters") or {}
```

避免在 `queryStringParameters` 為 `null` 時呼叫 `.get()` 造成 runtime error。

**Example connection URL:**

```
wss://abc123.execute-api.us-west-2.amazonaws.com/prod?callsign=CoolDog&passcode=demo123
```

前端在建立 WebSocket connection 時，必須使用 `encodeURIComponent` 對 `callsign` 與 `passcode` 進行編碼。

## Validation Rules

| Field | Rule |
|-------|------|
| `callsign` | Required. Must be 1–20 characters. Alphanumeric and underscores only (`^[a-zA-Z0-9_]{1,20}$`). |
| `passcode` | Required. The SHA-256 hash of the provided passcode must match `CHAT_ACCESS_CODE_HASH`. |
| `MAX_CONNECTIONS` | Optional. If configured, the number of active connections must be lower than this value. |

## Processing Logic

```
1. Extract connectionId from event.requestContext.connectionId
2. Safely extract query string parameters:
   - query_params = event.get("queryStringParameters") or {}
3. Extract callsign and passcode:
   - callsign = query_params.get("callsign")
   - passcode = query_params.get("passcode")
4. Validate callsign:
   - If missing or invalid → return 400
5. Validate passcode:
   - If missing or invalid → return 403
   - The Lambda hashes the provided passcode using SHA-256
   - The generated hash is compared with CHAT_ACCESS_CODE_HASH
6. Check room capacity if MAX_CONNECTIONS is configured:
   - Scan or count current active connections in DynamoDB
   - If active connection count >= MAX_CONNECTIONS → return 429
7. Write to DynamoDB:
   - connectionId (PK)
   - callsign
   - connectedAt (ISO 8601 UTC timestamp)
8. Optional future enhancement:
   - Broadcast a "user_joined" system event to existing connections
9. Return 200
```

## Passcode Validation

The frontend does not store or validate the correct passcode.

The frontend only sends the user-entered passcode during the WebSocket `$connect` handshake:

```
?callsign={callsign}&passcode={passcode}
```

The `$connect` Lambda validates the passcode by comparing its SHA-256 hash with the backend environment variable `CHAT_ACCESS_CODE_HASH`.

**Example implementation logic:**

```python
import hashlib
import hmac
import os

expected_hash = os.environ["CHAT_ACCESS_CODE_HASH"]
actual_hash = hashlib.sha256(passcode.encode("utf-8")).hexdigest()

if not hmac.compare_digest(actual_hash, expected_hash):
    return {
        "statusCode": 403,
        "body": "Invalid passcode"
    }
```

**Important:**

- Do not store the plaintext passcode in **frontend code**.
- Do not store the plaintext passcode in **GitHub**.
- Do not store the plaintext passcode in **DynamoDB**.
- Do not write the provided passcode to logs.
- Only the SHA-256 hash should be stored as a backend environment variable.

## DynamoDB Operations

### Optional active connection count

If `MAX_CONNECTIONS` is configured, the Lambda checks the current number of active connections before accepting a new connection.

For this demo-scale project, a simple scan is acceptable:

```python
response = table.scan(Select="COUNT")
active_count = response.get("Count", 0)

if active_count >= max_connections:
    return {
        "statusCode": 429,
        "body": "Room capacity reached"
    }
```

**Note:** This approach is acceptable for a small demo project. For production-scale systems, a more robust concurrency control design should be used, because scan-based counting is not ideal under high traffic or highly concurrent connection attempts.

### Write item

After validation succeeds, write the connection record to DynamoDB:

```python
from datetime import datetime, timezone

table.put_item(
    Item={
        "connectionId": connection_id,
        "callsign": callsign,
        "connectedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
    }
)
```

**Important:** The `passcode` must not be written to DynamoDB.

## Output

**Success (200):**

```json
{
  "statusCode": 200,
  "body": "Connected"
}
```

**Validation error: invalid or missing callsign (400):**

```json
{
  "statusCode": 400,
  "body": "Invalid or missing callsign"
}
```

**Access denied: invalid or missing passcode (403):**

```json
{
  "statusCode": 403,
  "body": "Invalid passcode"
}
```

**Room capacity reached (429):**

```json
{
  "statusCode": 429,
  "body": "Room capacity reached"
}
```

**Internal error (500):**

```json
{
  "statusCode": 500,
  "body": "Internal server error"
}
```

**Note:** Returning non-200 from `$connect` causes API Gateway to reject the WebSocket handshake.

## Environment Variables

| Variable | Source | Description |
|----------|--------|-------------|
| `TABLE_NAME` | SAM template | DynamoDB table name |
| `CHAT_ACCESS_CODE_HASH` | SAM parameter | SHA-256 hash of the shared chat passcode |
| `MAX_CONNECTIONS` | SAM parameter | Maximum number of concurrent WebSocket connections |
| `DYNAMODB_ENDPOINT` | Optional local testing config | Optional endpoint for DynamoDB Local |

## IAM Permissions Required

For the MVP version:

- `dynamodb:PutItem` on the `ChatConnections` table
- `dynamodb:Scan` on the `ChatConnections` table, if `MAX_CONNECTIONS` is enabled

The SAM template uses `DynamoDBCrudPolicy` for the `connect` Lambda, which covers the required DynamoDB operations for this demo project.

### Optional future enhancement

If `user_joined` system events are enabled in the future, this Lambda will also need:

- `dynamodb:Scan` on the `ChatConnections` table
- `execute-api:ManageConnections` on the WebSocket API

However, for the MVP version, `connect` should not broadcast `user_joined` events. Its primary responsibility is to validate the connection and store the connection record quickly.

## Implementation Notes

- The `callsign` and `passcode` are passed as query string parameters during the WebSocket handshake.
- The `$connect` route does not have access to a request body.
- Use `event.get("queryStringParameters") or {}` to handle missing or `null` query string parameters safely.
- The `callsign` must be validated before writing anything to DynamoDB.
- The `passcode` must be validated in the backend, not in the frontend.
- The passcode should be hashed using SHA-256 and compared against `CHAT_ACCESS_CODE_HASH`.
- Use `hmac.compare_digest()` when comparing hashes.
- Do not log the plaintext passcode.
- Do not store the passcode in DynamoDB.
- The `connectedAt` timestamp is stored for informational purposes, such as debugging stale connections. It is not used in any query.
- Keep the function fast. The WebSocket handshake has a timeout, so avoid heavy processing.
- The `user_joined` broadcast is a nice-to-have feature. If implemented, it should be treated as a future enhancement or moved to an async flow to avoid slowing down the connection handshake.

## Error Handling

| Error | Action |
|-------|--------|
| Missing `queryStringParameters` | Return 400 or 403 depending on which required field is missing |
| Missing or invalid `callsign` | Return 400 |
| Missing or invalid `passcode` | Return 403 |
| Missing `CHAT_ACCESS_CODE_HASH` environment variable | Log configuration error, return 500 |
| Invalid `MAX_CONNECTIONS` environment variable | Log configuration error, return 500 |
| Active connection count >= `MAX_CONNECTIONS` | Return 429 |
| DynamoDB scan fails during capacity check | Log error, return 500 |
| DynamoDB `PutItem` fails | Log error, return 500 |
| Optional `user_joined` broadcast fails | Log and skip; do not fail the connection |

## SAM Local Test Plan

### Local environment variables

For local testing, create an `env.json` file.

Example passcode:

```text
demo123
```

SHA-256 hash of `demo123`:

```text
d3ad9315b7be5dd53b31a273b3b3aba5defe700808305aa16a3062b76658a791
```

Example `env.json`:

```json
{
  "ConnectFunction": {
    "TABLE_NAME": "ChatConnections",
    "CHAT_ACCESS_CODE_HASH": "d3ad9315b7be5dd53b31a273b3b3aba5defe700808305aa16a3062b76658a791",
    "MAX_CONNECTIONS": "10",
    "DYNAMODB_ENDPOINT": "http://host.docker.internal:8000"
  }
}
```

### Test 1: Successful connection

**Command:**

```bash
sam local invoke ConnectFunction -e events/connect_valid.json --env-vars env.json
```

**Event file (`events/connect_valid.json`):**

```json
{
  "requestContext": {
    "connectionId": "test-conn-001",
    "routeKey": "$connect",
    "eventType": "CONNECT",
    "domainName": "localhost",
    "stage": "prod"
  },
  "queryStringParameters": {
    "callsign": "TestUser",
    "passcode": "demo123"
  }
}
```

**Expected result:** Status 200, item written to DynamoDB.

### Test 2: Missing callsign

**Command:**

```bash
sam local invoke ConnectFunction -e events/connect_no_callsign.json --env-vars env.json
```

**Event file (`events/connect_no_callsign.json`):**

```json
{
  "requestContext": {
    "connectionId": "test-conn-002",
    "routeKey": "$connect",
    "eventType": "CONNECT",
    "domainName": "localhost",
    "stage": "prod"
  },
  "queryStringParameters": {
    "passcode": "demo123"
  }
}
```

**Expected result:** Status 400, no DynamoDB write.

### Test 3: Invalid callsign

**Command:**

```bash
sam local invoke ConnectFunction -e events/connect_bad_callsign.json --env-vars env.json
```

**Event file (`events/connect_bad_callsign.json`):**

```json
{
  "requestContext": {
    "connectionId": "test-conn-003",
    "routeKey": "$connect",
    "eventType": "CONNECT",
    "domainName": "localhost",
    "stage": "prod"
  },
  "queryStringParameters": {
    "callsign": "ThisCallsignIsWayTooLongToBeValid",
    "passcode": "demo123"
  }
}
```

**Expected result:** Status 400, no DynamoDB write.

### Test 4: Missing passcode

**Command:**

```bash
sam local invoke ConnectFunction -e events/connect_no_passcode.json --env-vars env.json
```

**Event file (`events/connect_no_passcode.json`):**

```json
{
  "requestContext": {
    "connectionId": "test-conn-004",
    "routeKey": "$connect",
    "eventType": "CONNECT",
    "domainName": "localhost",
    "stage": "prod"
  },
  "queryStringParameters": {
    "callsign": "TestUser"
  }
}
```

**Expected result:** Status 403, no DynamoDB write.

### Test 5: Invalid passcode

**Command:**

```bash
sam local invoke ConnectFunction -e events/connect_bad_passcode.json --env-vars env.json
```

**Event file (`events/connect_bad_passcode.json`):**

```json
{
  "requestContext": {
    "connectionId": "test-conn-005",
    "routeKey": "$connect",
    "eventType": "CONNECT",
    "domainName": "localhost",
    "stage": "prod"
  },
  "queryStringParameters": {
    "callsign": "TestUser",
    "passcode": "wrong-passcode"
  }
}
```

**Expected result:** Status 403, no DynamoDB write.

### Test 6: Null queryStringParameters

**Command:**

```bash
sam local invoke ConnectFunction -e events/connect_null_query_params.json --env-vars env.json
```

**Event file (`events/connect_null_query_params.json`):**

```json
{
  "requestContext": {
    "connectionId": "test-conn-006",
    "routeKey": "$connect",
    "eventType": "CONNECT",
    "domainName": "localhost",
    "stage": "prod"
  },
  "queryStringParameters": null
}
```

**Expected result:** Status 400 or 403, no runtime crash, no DynamoDB write.

### Test 7: Room capacity reached

This test is optional and only applies when `MAX_CONNECTIONS` is enabled.

**Pre-condition:** Insert enough records into DynamoDB Local so that the active connection count is equal to or greater than `MAX_CONNECTIONS`.

Example:

```bash
aws dynamodb put-item \
  --table-name ChatConnections \
  --item '{"connectionId":{"S":"existing-conn-001"},"callsign":{"S":"Alice"},"connectedAt":{"S":"2025-01-01T00:00:00Z"}}' \
  --endpoint-url http://localhost:8000
```

Repeat until the table contains `MAX_CONNECTIONS` records.

**Command:**

```bash
sam local invoke ConnectFunction -e events/connect_valid.json --env-vars env.json
```

**Expected result:** Status 429, no new DynamoDB write.

## DynamoDB Local Setup

To test against a local DynamoDB instance:

```bash
# Start DynamoDB Local with Docker
docker run -p 8000:8000 amazon/dynamodb-local
```

Create the table locally:

```bash
aws dynamodb create-table \
  --table-name ChatConnections \
  --attribute-definitions AttributeName=connectionId,AttributeType=S \
  --key-schema AttributeName=connectionId,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST \
  --endpoint-url http://localhost:8000
```

Verify the table:

```bash
aws dynamodb describe-table \
  --table-name ChatConnections \
  --endpoint-url http://localhost:8000
```

**Note:** The Lambda code should check for a `DYNAMODB_ENDPOINT` environment variable and use it if present, allowing seamless switching between local DynamoDB and AWS DynamoDB.