import logging
import os

import boto3

logger = logging.getLogger()
logger.setLevel(logging.INFO)


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

    try:
        table = _get_table()
        table.delete_item(Key={"connectionId": connection_id})
    except Exception:
        logger.exception("Failed to delete connection record from DynamoDB")
        return {"statusCode": 500, "body": "Internal server error"}

    logger.info("Connection removed: connectionId=%s", connection_id)
    return {"statusCode": 200, "body": "Disconnected"}
