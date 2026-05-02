import json
import logging
import os
from datetime import datetime, timezone

import boto3
from botocore.exceptions import ClientError

logger = logging.getLogger()
logger.setLevel(logging.INFO)

MAX_TEXT_LENGTH = 1000


def _get_table():
    endpoint = os.environ.get("DYNAMODB_ENDPOINT")
    if endpoint:
        dynamodb = boto3.resource("dynamodb", endpoint_url=endpoint)
    else:
        dynamodb = boto3.resource("dynamodb")
    return dynamodb.Table(os.environ["TABLE_NAME"])


def _scan_all_connections(table):
    connections = []
    scan_kwargs = {"ProjectionExpression": "connectionId"}
    while True:
        response = table.scan(**scan_kwargs)
        connections.extend(response["Items"])
        if "LastEvaluatedKey" not in response:
            break
        scan_kwargs["ExclusiveStartKey"] = response["LastEvaluatedKey"]
    return connections


def handler(event, context):
    try:
        request_context = event["requestContext"]
        connection_id = request_context["connectionId"]
        domain_name = request_context["domainName"]
        stage = request_context["stage"]
    except (KeyError, TypeError):
        logger.error("Missing required fields in requestContext")
        return {"statusCode": 500, "body": "Internal server error"}

    try:
        body = json.loads(event["body"])
    except (json.JSONDecodeError, TypeError, KeyError):
        return {"statusCode": 400, "body": "Invalid JSON body"}

    text = body.get("text")
    if not isinstance(text, str):
        return {"statusCode": 400, "body": "Missing or invalid text"}

    text = text.strip()
    if not text:
        return {"statusCode": 400, "body": "Missing or invalid text"}

    if len(text) > MAX_TEXT_LENGTH:
        return {"statusCode": 400, "body": "Missing or invalid text"}

    table = _get_table()

    try:
        response = table.get_item(Key={"connectionId": connection_id})
        sender = response.get("Item")
    except Exception:
        logger.exception("Failed to get sender record from DynamoDB")
        return {"statusCode": 500, "body": "Internal server error"}

    if not sender:
        return {"statusCode": 400, "body": "Unknown sender"}

    callsign = sender["callsign"]
    timestamp = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")

    payload = json.dumps({
        "type": "message",
        "callsign": callsign,
        "text": text,
        "timestamp": timestamp,
    }).encode("utf-8")

    try:
        connections = _scan_all_connections(table)
    except Exception:
        logger.exception("Failed to scan DynamoDB for active connections")
        return {"statusCode": 500, "body": "Internal server error"}

    endpoint_url = f"https://{domain_name}/{stage}"
    apigw = boto3.client("apigatewaymanagementapi", endpoint_url=endpoint_url)

    for conn in connections:
        conn_id = conn["connectionId"]
        try:
            apigw.post_to_connection(ConnectionId=conn_id, Data=payload)
        except ClientError as e:
            if e.response["Error"]["Code"] == "GoneException":
                logger.info("Removing stale connection: %s", conn_id)
                try:
                    table.delete_item(Key={"connectionId": conn_id})
                except Exception:
                    logger.exception("Failed to delete stale connection: %s", conn_id)
            else:
                logger.error("PostToConnection failed for %s: %s", conn_id, e)
        except Exception as e:
            logger.error("PostToConnection failed for %s: %s", conn_id, e)

    return {"statusCode": 200, "body": "Message sent"}
