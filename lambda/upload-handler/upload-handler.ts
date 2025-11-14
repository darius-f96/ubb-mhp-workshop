import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { createPresignedPost } from '@aws-sdk/s3-presigned-post';
import { randomUUID } from 'crypto';
import { TextDecoder } from 'util';

const bucketName = process.env.FILE_BUCKET_NAME;
const tableName = process.env.FILE_METADATA_TABLE;
const defaultExpirationSeconds = parseInt(process.env.DEFAULT_URL_EXPIRATION ?? '3600', 10);
const uploadedByIndexName = 'uploadedByIndex';

if (!bucketName || !tableName) {
  throw new Error('Required environment variables FILE_BUCKET_NAME or FILE_METADATA_TABLE are not set');
}

const s3Client = new S3Client({});
const dynamo = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: {
    removeUndefinedValues: true,
    convertClassInstanceToMap: true,
  },
});

interface UploadPayload {
  fileName: string;
  fileContent?: string;
  uploadedBy: string;
  contentType?: string;
  expirationSeconds?: number;
}

type UploadMode = 'inline' | 'presigned-post';

const jsonDecoder = new TextDecoder('utf-8');

function parsePayload(event: APIGatewayProxyEvent): UploadPayload {
  if (!event.body) {
    throw new Error('Missing request body');
  }

  let bodyString: string;
  if (event.isBase64Encoded) {
    try {
      const decoded = Buffer.from(event.body, 'base64');
      bodyString = jsonDecoder.decode(decoded);
    } catch (error) {
      throw new Error('Unable to decode base64-encoded body');
    }
  } else {
    bodyString = event.body;
  }

  try {
    const payload = JSON.parse(bodyString);
    return payload as UploadPayload;
  } catch (error) {
    throw new Error('Request body must be valid JSON');
  }
}

function parseExpiration(value: unknown): number {
  const raw = value ?? defaultExpirationSeconds;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) {
    throw new Error('expirationSeconds must be an integer');
  }
  if (parsed <= 0) {
    throw new Error('expirationSeconds must be a positive integer');
  }
  return parsed;
}

function normalizeBase64(content: unknown): string {
  if (typeof content !== 'string' || content.length === 0) {
    throw new Error('fileContent must be a non-empty base64 string');
  }

  const sanitized = content.replace(/\s+/g, '');
  if (!/^([A-Za-z0-9+/]{4})*([A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(sanitized)) {
    throw new Error('fileContent must be valid base64');
  }

  return sanitized;
}

function ensureNonEmpty(value: unknown, field: string): string {
  if (typeof value !== 'string') {
    throw new Error(`Missing required field: ${field}`);
  }
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`${field} cannot be empty`);
  }
  return trimmed;
}

function success(body: Record<string, unknown>, statusCode = 201): APIGatewayProxyResult {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

function failure(message: string, statusCode = 400): APIGatewayProxyResult {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message }),
  };
}

function isMultipartRequest(event: APIGatewayProxyEvent): boolean {
  const flag = event.queryStringParameters?.multipart;
  if (typeof flag !== 'string') {
    return false;
  }
  return flag.toLowerCase() === 'true';
}

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const method = event.httpMethod?.toUpperCase();

  switch (method) {
    case 'GET':
      return handleList(event);
    case 'POST':
      return handleUpload(event);
    default:
      return failure('Method not allowed', 405);
  }
};

async function handleUpload(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const multipartUpload = isMultipartRequest(event);
  let payload: UploadPayload;

  try {
    payload = parsePayload(event);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid request';
    return failure(message, 400);
  }

  let fileName: string;
  let uploadedBy: string;

  try {
    fileName = ensureNonEmpty(payload.fileName, 'fileName');
    uploadedBy = ensureNonEmpty(payload.uploadedBy, 'uploadedBy');
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid request';
    return failure(message, 400);
  }

  let fileBytes: Buffer | undefined;
  if (!multipartUpload) {
    let base64Content: string;
    try {
      base64Content = normalizeBase64(payload.fileContent);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'fileContent must be valid base64';
      return failure(message, 400);
    }

    try {
      fileBytes = Buffer.from(base64Content, 'base64');
    } catch (error) {
      return failure('fileContent must be valid base64', 400);
    }
  }

  let expirationSeconds: number;
  try {
    expirationSeconds = parseExpiration(payload.expirationSeconds);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid expirationSeconds';
    return failure(message, 400);
  }

  const fileId = randomUUID();
  const s3Key = `uploads/${fileId}/${fileName}`;
  const contentType = payload.contentType?.trim() || 'application/octet-stream';

  if (multipartUpload) {
    return handleMultipartUpload({
      fileId,
      fileName,
      uploadedBy,
      s3Key,
      contentType,
      expirationSeconds,
    });
  }

  if (!fileBytes) {
    return failure('fileContent must be provided', 400);
  }

  return handleInlineUpload({
    fileId,
    fileName,
    uploadedBy,
    s3Key,
    fileBytes,
    contentType,
    expirationSeconds,
  });
}

async function handleInlineUpload(params: {
  fileId: string;
  fileName: string;
  uploadedBy: string;
  s3Key: string;
  fileBytes: Buffer;
  contentType: string;
  expirationSeconds: number;
}): Promise<APIGatewayProxyResult> {
  const { fileId, fileName, uploadedBy, s3Key, fileBytes, contentType, expirationSeconds } = params;

  try {
    await s3Client.send(
      new PutObjectCommand({
        Bucket: bucketName,
        Key: s3Key,
        Body: fileBytes,
        ContentType: contentType,
      })
    );
  } catch (error) {
    console.error('Failed to upload to S3', error);
    return failure('Failed to store file', 500);
  }

  let downloadUrl: string;
  try {
    downloadUrl = await getSignedUrl(
      s3Client,
      new GetObjectCommand({ Bucket: bucketName, Key: s3Key }),
      { expiresIn: expirationSeconds }
    );
  } catch (error) {
    console.error('Failed to generate pre-signed URL', error);
    return failure('Failed to generate download URL', 500);
  }

  let item;
  try {
    item = await persistMetadata({
      fileId,
      fileName,
      uploadedBy,
      s3Key,
      downloadUrl,
      expirationSeconds,
      uploadMode: 'inline',
    });
  } catch (error) {
    console.error('Failed to write metadata to DynamoDB', error);
    return failure('Failed to store metadata', 500);
  }

  return success({
    fileId,
    s3Path: s3Key,
    url: downloadUrl,
    urlExpiration: item.urlExpiration,
  });
}

async function handleMultipartUpload(params: {
  fileId: string;
  fileName: string;
  uploadedBy: string;
  s3Key: string;
  contentType: string;
  expirationSeconds: number;
}): Promise<APIGatewayProxyResult> {
  const { fileId, fileName, uploadedBy, s3Key, contentType, expirationSeconds } = params;
  const uploadUrlExpirationSeconds = Math.min(expirationSeconds, 3600);

  let presignedPost;
  try {
    presignedPost = await createPresignedPost(s3Client, {
      Bucket: bucketName,
      Key: s3Key,
      Expires: uploadUrlExpirationSeconds,
      Fields: {
        key: s3Key,
        'Content-Type': contentType,
      },
    });
  } catch (error) {
    console.error('Failed to generate multipart upload URL', error);
    return failure('Failed to generate upload URL', 500);
  }

  let downloadUrl: string;
  try {
    downloadUrl = await getSignedUrl(
      s3Client,
      new GetObjectCommand({ Bucket: bucketName, Key: s3Key }),
      { expiresIn: expirationSeconds }
    );
  } catch (error) {
    console.error('Failed to generate pre-signed URL', error);
    return failure('Failed to generate download URL', 500);
  }

  let item;
  try {
    item = await persistMetadata({
      fileId,
      fileName,
      uploadedBy,
      s3Key,
      downloadUrl,
      expirationSeconds,
      uploadMode: 'presigned-post',
    });
  } catch (error) {
    console.error('Failed to write metadata to DynamoDB', error);
    return failure('Failed to store metadata', 500);
  }

  return success({
    fileId,
    s3Path: s3Key,
    upload: {
      url: presignedPost.url,
      fields: presignedPost.fields,
      expiresIn: uploadUrlExpirationSeconds,
    },
    url: downloadUrl,
    urlExpiration: item.urlExpiration,
  });
}

async function persistMetadata(params: {
  fileId: string;
  fileName: string;
  uploadedBy: string;
  s3Key: string;
  downloadUrl: string;
  expirationSeconds: number;
  uploadMode: UploadMode;
}) {
  const { fileId, fileName, uploadedBy, s3Key, downloadUrl, expirationSeconds, uploadMode } = params;

  const uploadedDate = new Date();
  const expiresAt = new Date(uploadedDate.getTime() + expirationSeconds * 1000);

  const item = {
    fileId,
    fileName,
    uploadedBy,
    uploadedDate: uploadedDate.toISOString(),
    s3Path: s3Key,
    url: downloadUrl,
    urlExpiration: expiresAt.toISOString(),
    urlExpirationEpoch: Math.floor(expiresAt.getTime() / 1000),
    uploadMode,
  };

  await dynamo.send(
    new PutCommand({
      TableName: tableName,
      Item: item,
    })
  );

  return item;
}

async function handleList(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  let uploadedBy: string;
  try {
    uploadedBy = ensureNonEmpty(event.queryStringParameters?.uploadedBy, 'uploadedBy');
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid request';
    return failure(message, 400);
  }

  try {
    const result = await dynamo.send(
      new QueryCommand({
        TableName: tableName,
        IndexName: uploadedByIndexName,
        KeyConditionExpression: '#uploadedBy = :uploadedBy',
        ExpressionAttributeNames: {
          '#uploadedBy': 'uploadedBy',
        },
        ExpressionAttributeValues: {
          ':uploadedBy': uploadedBy,
        },
        ScanIndexForward: false,
      })
    );

    return success(
      {
        items: result.Items ?? [],
      },
      200
    );
  } catch (error) {
    console.error('Failed to query DynamoDB for uploadedBy', error);
    return failure('Failed to fetch entries', 500);
  }
}
