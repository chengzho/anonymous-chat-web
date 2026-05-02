import hashlib
import hmac
import json
import logging
import os
import re
from datetime import datetime, timezone

import boto3

logger = logging.getLogger()
logger.setLevel(logging.INFO)

CALLSIGN_PATTERN = re.compile(r"^[a-zA-Z0-9_]{1,20}$")


def _get_table():
    endpoint = os.environ.get("DYNAMODB_ENDPOINT")
    if endpoint:
        dynamodb = boto3.resource("dynamodb", endpoint_url=endpoint)
    else:
        dynamodb = boto3.resource("dynamodb")
    return dynamodb.Table(os.environ["TABLE_NAME"])


def handler(event, context):
    try:
        connection_id = event["requestContext"]["connectionId"]
    except (KeyError, TypeError):
        logger.error("Missing connectionId in requestContext")
        return {"statusCode": 500, "body": "Internal server error"}

    query_params = event.get("queryStringParameters") or {}
    callsign = query_params.get("callsign")
    passcode = query_params.get("passcode")

    if not callsign or not CALLSIGN_PATTERN.match(callsign):
        return {"statusCode": 400, "body": "Invalid or missing callsign"}

    expected_hash = os.environ.get("CHAT_ACCESS_CODE_HASH")
    if not expected_hash:
        logger.error("CHAT_ACCESS_CODE_HASH environment variable is not set")
        return {"statusCode": 500, "body": "Internal server error"}

    if not passcode:
        return {"statusCode": 403, "body": "Invalid passcode"}

    actual_hash = hashlib.sha256(passcode.encode("utf-8")).hexdigest()
    if not hmac.compare_digest(actual_hash, expected_hash):
        return {"statusCode": 403, "body": "Invalid passcode"}

    max_connections_str = os.environ.get("MAX_CONNECTIONS", "")
    if max_connections_str:
        try:
            max_connections = int(max_connections_str)
        except ValueError:
            logger.error("Invalid MAX_CONNECTIONS value: %s", max_connections_str)
            return {"statusCode": 500, "body": "Internal server error"}

        try:
            table = _get_table()
            response = table.scan(Select="COUNT")
            active_count = response.get("Count", 0)
        except Exception:
            logger.exception("Failed to scan DynamoDB for connection count")
            return {"statusCode": 500, "body": "Internal server error"}

        if active_count >= max_connections:
            return {"statusCode": 429, "body": "Room capacity reached"}

    try:
        table = _get_table()
        table.put_item(
            Item={
                "connectionId": connection_id,
                "callsign": callsign,
                "connectedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
            }
        )
    except Exception:
        logger.exception("Failed to write connection record to DynamoDB")
        return {"statusCode": 500, "body": "Internal server error"}

    logger.info("Connection accepted: connectionId=%s callsign=%s", connection_id, callsign)
    return {"statusCode": 200, "body": "Connected"}
