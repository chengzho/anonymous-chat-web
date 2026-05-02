# Lambda 規格文件：send_message

## Function Identity

| Field | Value |
|-------|-------|
| Function Name | `chat-send-message` |
| Handler | `send_message.handler` |
| Runtime | Python 3.12 |
| Code Location | `lambda/send_message/send_message.py` |
| Route | `sendMessage` |
| Timeout | 10 seconds |
| Memory | 128 MB |

## Purpose

接收已連線使用者送出的聊天訊息，根據 sender 的 `connectionId` 從 DynamoDB 取得對應的 `callsign`，並透過 API Gateway 的 `PostToConnection` management API 將訊息廣播給所有目前在線的 clients。

## Input

**Event source:** API Gateway WebSocket `sendMessage` route.

**Relevant fields from `event`:**

```python
connection_id = event["requestContext"]["connectionId"]   # sender's connection
domain_name = event["requestContext"]["domainName"]        # for management API endpoint
stage = event["requestContext"]["stage"]                   # for management API endpoint
body = json.loads(event["body"])                           # message payload
text = body["text"]                                        # the message content
```

**Validation rules:**

| Field | Rule |
|-------|------|
| `event["body"]` | Required. Must be valid JSON. |
| `body["text"]` | Required. Must be a string. After `strip()`, it must be non-empty. Max 1000 characters. |

**Note:** The `callsign` is **not** extracted from the body. It is retrieved from DynamoDB using the sender's `connectionId`. This prevents callsign spoofing — the sender cannot impersonate another user.

## Processing Logic

```
1. Parse event["body"] as JSON
2. Extract, strip, and validate body["text"]:
   - If missing, not a string, empty after strip(), or exceeds 1000 characters → return 400
   - Use the stripped text in the broadcast payload
3. Extract connectionId from event.requestContext.connectionId
4. Get sender's callsign from DynamoDB using connectionId:
   - If not found → return 400 (unknown sender)
5. Build broadcast payload:
   {
     "type": "message",
     "callsign": sender_callsign,
     "text": text,
     "timestamp": current UTC ISO 8601
   }
6. Scan DynamoDB for all active connectionIds
7. For each connectionId:
   a. Call PostToConnection with the broadcast payload
   b. If GoneException → delete stale connection from DynamoDB
   c. If other error → log and continue
8. Return 200
```

## DynamoDB Operations

**Get sender's callsign:**

```python
response = table.get_item(Key={"connectionId": connection_id})
sender = response.get("Item")
if not sender:
    return {"statusCode": 400, "body": "Unknown sender"}
callsign = sender["callsign"]
```

**Scan all connections:**

```python
connections = table.scan(ProjectionExpression="connectionId")["Items"]
```

**Delete stale connection on GoneException:**

```python
table.delete_item(Key={"connectionId": stale_connection_id})
```

## PostToConnection Fan-Out

```python
endpoint_url = f"https://{domain_name}/{stage}"
apigw = boto3.client("apigatewaymanagementapi", endpoint_url=endpoint_url)

for conn in connections:
    try:
        apigw.post_to_connection(
            ConnectionId=conn["connectionId"],
            Data=json.dumps(payload).encode("utf-8"),
        )
    except apigw.exceptions.GoneException:
        table.delete_item(Key={"connectionId": conn["connectionId"]})
    except Exception as e:
        logger.error(f"Failed to send to {conn['connectionId']}: {e}")
```

## Broadcast Payload: Server → Client

```json
{
  "type": "message",
  "callsign": "CoolDog",
  "text": "Hello everyone!",
  "timestamp": "2025-01-15T10:30:00Z"
}
```

## Output

**Success (200):**

```json
{
  "statusCode": 200,
  "body": "Message sent"
}
```

**Validation error (400):**

```json
{
  "statusCode": 400,
  "body": "Missing or invalid text"
}
```

**Unknown sender (400):**

```json
{
  "statusCode": 400,
  "body": "Unknown sender"
}
```

**Internal error (500):**

```json
{
  "statusCode": 500,
  "body": "Internal server error"
}
```

## Environment Variables

| Variable | Source | Description |
|----------|--------|-------------|
| `TABLE_NAME` | SAM template | DynamoDB table name |
| `DYNAMODB_ENDPOINT` | Optional local testing config | Optional endpoint for DynamoDB Local |

`CHAT_ACCESS_CODE_HASH` and `MAX_CONNECTIONS` are not required by the `send_message` Lambda logic, even if they are injected globally by the SAM template.

## IAM Permissions Required

- `dynamodb:GetItem` on the `ChatConnections` table, used to get the sender callsign
- `dynamodb:Scan` on the `ChatConnections` table, used to get all active connections
- `dynamodb:DeleteItem` on the `ChatConnections` table, used to clean up stale connections
- `execute-api:ManageConnections` on the WebSocket API, used by `PostToConnection`

## Implementation Notes

- **Sender receives their own message.** The broadcast loop sends to all connections including the sender. This simplifies the frontend — it can treat all messages the same way and use the server timestamp for ordering.
- **Callsign lookup from DynamoDB, not from body.** This is a deliberate security decision. Even though there is no authentication, we prevent trivial callsign spoofing by trusting only the stored callsign for each `connectionId`.
- **DynamoDB Scan pagination.** For this educational project, a single scan is sufficient. If the table exceeds 1 MB of data (unlikely for a demo), the scan response includes a `LastEvaluatedKey` and you must paginate. The implementation should handle this:

  ```python
  connections = []
  scan_kwargs = {"ProjectionExpression": "connectionId"}
  while True:
      response = table.scan(**scan_kwargs)
      connections.extend(response["Items"])
      if "LastEvaluatedKey" not in response:
          break
      scan_kwargs["ExclusiveStartKey"] = response["LastEvaluatedKey"]
  ```

- **PostToConnection ordering.** Messages may arrive at different clients in slightly different order if network latency varies. For a single-channel chat room this is acceptable. No sequence numbering is implemented.
- **Bot client for `apigatewaymanagementapi`.** The `boto3.client` for the management API must be created with the `endpoint_url` constructed from the event's `domainName` and `stage`. This cannot be a module-level constant because the endpoint is only known at runtime.

## Error Handling

| Error | Action |
|-------|--------|
| `event["body"]` not valid JSON | Return 400 |
| `body["text"]` missing, not a string, empty after strip(), or exceeds 1000 chars | Return 400 |
| Sender `connectionId` not in DynamoDB | Return 400 |
| `GoneException` on `PostToConnection` | Delete stale connection, continue |
| Other `PostToConnection` error | Log, continue to next connection |
| DynamoDB scan fails | Log, return 500 |

## SAM Local Test Plan

### Local environment variables

For local testing, create an `env.json` file.

Example `env.json`:

```json
{
  "SendMessageFunction": {
    "TABLE_NAME": "ChatConnections",
    "DYNAMODB_ENDPOINT": "http://host.docker.internal:8000"
  }
}
```

### Test 1: Successful message broadcast

**Command:**

```bash
sam local invoke SendMessageFunction -e events/send_valid.json --env-vars env.json
```

**Event file (`events/send_valid.json`):**

```json
{
  "requestContext": {
    "connectionId": "sender-conn-001",
    "routeKey": "sendMessage",
    "eventType": "MESSAGE",
    "domainName": "localhost",
    "stage": "prod"
  },
  "body": "{\"action\":\"sendMessage\",\"text\":\"Hello everyone!\"}"
}
```

**Pre-condition:** Insert sender and recipient records into DynamoDB Local:

```bash
aws dynamodb put-item \
  --table-name ChatConnections \
  --item '{"connectionId":{"S":"sender-conn-001"},"callsign":{"S":"Alice"},"connectedAt":{"S":"2025-01-01T00:00:00Z"}}' \
  --endpoint-url http://localhost:8000

aws dynamodb put-item \
  --table-name ChatConnections \
  --item '{"connectionId":{"S":"recipient-conn-002"},"callsign":{"S":"Bob"},"connectedAt":{"S":"2025-01-01T00:00:00Z"}}' \
  --endpoint-url http://localhost:8000
```

**Expected result:** Status 200. Note: `PostToConnection` will fail locally since there is no real API Gateway management endpoint. The test validates the DynamoDB logic and payload construction. The `PostToConnection` errors should be logged and handled gracefully.

### Test 2: Missing text field

**Event file (`events/send_no_text.json`):**

```json
{
  "requestContext": {
    "connectionId": "sender-conn-001",
    "routeKey": "sendMessage",
    "eventType": "MESSAGE",
    "domainName": "localhost",
    "stage": "prod"
  },
  "body": "{\"action\":\"sendMessage\"}"
}
```

**Expected result:** Status 400, no broadcast attempted.

### Test 3: Invalid JSON body

**Event file (`events/send_bad_json.json`):**

```json
{
  "requestContext": {
    "connectionId": "sender-conn-001",
    "routeKey": "sendMessage",
    "eventType": "MESSAGE",
    "domainName": "localhost",
    "stage": "prod"
  },
  "body": "this is not json"
}
```

**Expected result:** Status 400, no broadcast attempted.

### Test 4: Unknown sender

**Event file (`events/send_unknown_sender.json`):**

```json
{
  "requestContext": {
    "connectionId": "unknown-conn-999",
    "routeKey": "sendMessage",
    "eventType": "MESSAGE",
    "domainName": "localhost",
    "stage": "prod"
  },
  "body": "{\"action\":\"sendMessage\",\"text\":\"Who am I?\"}"
}
```

**Expected result:** Status 400, message "Unknown sender".

### Test 5: Empty text after strip

**Event file (`events/send_empty_text.json`):**

```json
{
  "requestContext": {
    "connectionId": "sender-conn-001",
    "routeKey": "sendMessage",
    "eventType": "MESSAGE",
    "domainName": "localhost",
    "stage": "prod"
  },
  "body": "{\"action\":\"sendMessage\",\"text\":\"   \"}"
}
```

**Expected result:** Status 400, no broadcast attempted.

### DynamoDB Local Setup

Same as described in `04-lambda-connect-spec.md`. Reuse the same local DynamoDB instance and table.