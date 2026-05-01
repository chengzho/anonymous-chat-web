# Lambda 規格文件：disconnect

## Function Identity

| Field | Value |
|-------|-------|
| Function Name | `chat-disconnect` |
| Handler | `disconnect.handler` |
| Runtime | Python 3.12 |
| Code Location | `lambda/disconnect/disconnect.py` |
| Route | `$disconnect` |
| Timeout | 10 seconds |
| Memory | 128 MB |

## Purpose

處理 WebSocket disconnection。

此 Lambda 會在使用者離開聊天室、關閉瀏覽器分頁、網路中斷，或 WebSocket connection timeout 時，由 API Gateway `$disconnect` route 自動觸發。

MVP 版本中，此 Lambda 的主要責任是：

1. 從 API Gateway event 中取得 `connectionId`
2. 從 DynamoDB 移除該 `connectionId`
3. 確保離線或失效的 connection 不會繼續留在 active connections table 中

此 Lambda 不處理 passcode，不處理訊息廣播，也不儲存聊天紀錄。

## Input

**Event source:** API Gateway WebSocket `$disconnect` route.

**Relevant fields from `event`:**

```python
connection_id = event["requestContext"]["connectionId"]  # mandatory, provided by API Gateway
```

If optional `user_left` system events are implemented in the future, the following fields may also be used:

```python
domain_name = event["requestContext"]["domainName"]       # for broadcast endpoint
stage = event["requestContext"]["stage"]                  # for broadcast endpoint
```

**No query string parameters or body.**

The `$disconnect` event only provides `requestContext`. It does not include the original `callsign`, `passcode`, or message body.

## Processing Logic

### MVP Version

```
1. Extract connectionId from event.requestContext.connectionId

2. Delete the connectionId from DynamoDB:
   - Key: {"connectionId": connection_id}

3. Return 200
```

### Optional Future Enhancement: user_left system event

If `user_left` system events are enabled in the future, the processing logic can be extended:

```
1. Extract connectionId from event.requestContext.connectionId
2. Read the connection item from DynamoDB to get the callsign:
   - If the item does not exist, use "unknown" or skip the broadcast
3. Delete the connectionId from DynamoDB
4. Scan remaining active connections
5. Broadcast a "user_left" system event to all remaining connections using PostToConnection
6. Return 200
```

For the MVP version, do not broadcast `user_left` events. The primary responsibility of this Lambda is to clean up the connection record quickly and reliably.

## DynamoDB Operations

### Delete item

MVP version only requires a delete operation:

```python
table.delete_item(Key={"connectionId": connection_id})
```

DynamoDB `DeleteItem` is idempotent. If the item does not exist, the operation does not fail. This is useful because `$disconnect` may be triggered after a stale connection has already been cleaned up by another Lambda, such as `send_message`.

### Optional: Read item before deletion

If `user_left` system events are implemented in the future, the Lambda may read the connection item before deletion to retrieve the user's `callsign`:

```python
response = table.get_item(Key={"connectionId": connection_id})
callsign = response.get("Item", {}).get("callsign", "unknown")
```

### Optional: Scan remaining connections

If broadcasting `user_left` events, the Lambda must scan the remaining active connections after deleting the disconnected connection:

```python
connections = table.scan(ProjectionExpression="connectionId")["Items"]
```

For production-scale systems, DynamoDB scan pagination should be handled. For this demo-scale project, a simple scan is acceptable if the feature is enabled.

## Output

**Success (200):**

```json
{
  "statusCode": 200,
  "body": "Disconnected"
}
```

**Internal error (500):**

```json
{
  "statusCode": 500,
  "body": "Internal server error"
}
```

**Note:** The response for `$disconnect` is informational only. The WebSocket connection is already closed by the time this Lambda runs, and API Gateway does not forward this response to the client.

## Environment Variables

| Variable | Source | Description |
|----------|--------|-------------|
| `TABLE_NAME` | SAM template | DynamoDB table name |
| `DYNAMODB_ENDPOINT` | Optional local testing config | Optional endpoint for DynamoDB Local |

`CHAT_ACCESS_CODE_HASH` and `MAX_CONNECTIONS` are not required by the MVP `disconnect` Lambda logic, even if they are injected globally by the SAM template.

## IAM Permissions Required

For the MVP version:

- `dynamodb:DeleteItem` on the `ChatConnections` table

The SAM template uses `DynamoDBCrudPolicy` for the `disconnect` Lambda, which covers the required DynamoDB operation for this demo project.

### Optional future enhancement

If `user_left` system events are enabled in the future, this Lambda will also need:

- `dynamodb:GetItem` on the `ChatConnections` table
- `dynamodb:Scan` on the `ChatConnections` table
- `execute-api:ManageConnections` on the WebSocket API

Without `execute-api:ManageConnections`, the Lambda cannot call API Gateway Management API's `PostToConnection`.

## Implementation Notes

- The `$disconnect` route fires on both clean closes and unexpected disconnects, such as `ws.close()`, browser tab close, network drop, or WebSocket timeout. Handle all disconnect cases identically.
- The `connectionId` is provided by API Gateway in `event["requestContext"]["connectionId"]`.
- The `$disconnect` event should not depend on the original `callsign` or `passcode`. The passcode is only used during `$connect` validation and is never needed during `$disconnect`.
- The DynamoDB `DeleteItem` operation is idempotent. Deleting a non-existent `connectionId` is a no-op, not an error, so no existence check is required before deletion.
- Keep the function simple and fast. For the MVP version, the primary responsibility is removing the DynamoDB connection record.
- For the MVP version, do not broadcast `user_left` events.
- If `user_left` broadcast is implemented in the future, it should be best-effort. Broadcast failures should be logged, but they should not prevent the disconnect cleanup from succeeding.

## Error Handling

| Error | Action |
|-------|--------|
| Missing `requestContext.connectionId` | Log error, return 500 |
| DynamoDB `DeleteItem` succeeds | Return 200 |
| Connection item does not exist | Treat as success, return 200 |
| DynamoDB `DeleteItem` fails | Log error, return 500 |
| Optional `GetItem` returns no item | Use `"unknown"` or skip `user_left` broadcast |
| Optional broadcast fails for one connection | Log, skip, continue |
| Optional `GoneException` during broadcast | Delete stale connection from DynamoDB |
| Optional broadcast fails entirely | Log error, but do not fail disconnect cleanup if delete already succeeded |

## SAM Local Test Plan

### Local environment variables

For local testing, create an `env.json` file.

Example `env.json`:

```json
{
  "DisconnectFunction": {
    "TABLE_NAME": "ChatConnections",
    "DYNAMODB_ENDPOINT": "http://host.docker.internal:8000"
  }
}
```

### Test 1: Successful disconnection

**Command:**

```bash
sam local invoke DisconnectFunction -e events/disconnect_valid.json --env-vars env.json
```

**Event file (`events/disconnect_valid.json`):**

```json
{
  "requestContext": {
    "connectionId": "test-conn-001",
    "routeKey": "$disconnect",
    "eventType": "DISCONNECT",
    "domainName": "localhost",
    "stage": "prod"
  }
}
```

**Pre-condition:** Insert a test record into DynamoDB Local:

```bash
aws dynamodb put-item \
  --table-name ChatConnections \
  --item '{"connectionId":{"S":"test-conn-001"},"callsign":{"S":"TestUser"},"connectedAt":{"S":"2025-01-01T00:00:00Z"}}' \
  --endpoint-url http://localhost:8000
```

**Expected result:** Status 200, item deleted from DynamoDB.

**Verify:**

```bash
aws dynamodb get-item \
  --table-name ChatConnections \
  --key '{"connectionId":{"S":"test-conn-001"}}' \
  --endpoint-url http://localhost:8000
```

Expected result:

```
Empty response. The item should be gone.
```

### Test 2: Disconnect for non-existent connection

**Command:**

```bash
sam local invoke DisconnectFunction -e events/disconnect_unknown.json --env-vars env.json
```

**Event file (`events/disconnect_unknown.json`):**

```json
{
  "requestContext": {
    "connectionId": "non-existent-conn",
    "routeKey": "$disconnect",
    "eventType": "DISCONNECT",
    "domainName": "localhost",
    "stage": "prod"
  }
}
```

**Expected result:** Status 200. DynamoDB `DeleteItem` should be treated as a no-op when the item does not exist.

### Test 3: Missing connectionId

**Command:**

```bash
sam local invoke DisconnectFunction -e events/disconnect_missing_connection_id.json --env-vars env.json
```

**Event file (`events/disconnect_missing_connection_id.json`):**

```json
{
  "requestContext": {
    "routeKey": "$disconnect",
    "eventType": "DISCONNECT",
    "domainName": "localhost",
    "stage": "prod"
  }
}
```

**Expected result:** Status 500. The Lambda should log the missing `connectionId` as an unexpected event shape.

## DynamoDB Local Setup

Same as described in `04-lambda-connect-spec.md`. Reuse the same local DynamoDB instance and table.

To start DynamoDB Local:

```bash
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