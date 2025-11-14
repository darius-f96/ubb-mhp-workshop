# Dropbox-like File Sharing Backend

This repository contains a sample implementation of a serverless backend that accepts file uploads, stores them in Amazon S3, and writes the metadata alongside pre-signed download URLs into DynamoDB. The solution is composed of:

- An AWS Lambda function (TypeScript/Node.js 18) invoked through API Gateway.
- An AWS CDK stack (TypeScript) that provisions the infrastructure: S3 bucket, DynamoDB table, Lambda function, and API Gateway REST API.

## Lambda API Contract

All endpoints are secured with an Amazon Cognito user pool authorizer backed by the existing `pv0cko` user pool (`eu-west-1_MnCKcVS5o`). Clients must include a valid `Authorization: Bearer <JWT>` header issued by this pool when invoking the API.

`POST /upload` (default inline upload)
`POST /upload?multipart=true` (generate a pre-signed multipart/form-data upload)

Request body (JSON):

```json
{
  "fileName": "report.pdf",
  "fileContent": "<base64-encoded file bytes>",
  "uploadedBy": "alice@example.com",
  "contentType": "application/pdf",         // optional
  "expirationSeconds": 3600                  // optional, defaults to 3600 seconds
}
```

Response body (JSON):

```json
{
  "fileId": "<generated uuid>",
  "s3Path": "uploads/<uuid>/report.pdf",
  "url": "<pre-signed download url>",
  "urlExpiration": "2024-05-15T12:34:56.000Z"
}
```

When `multipart=true` is passed as a query parameter the Lambda will skip the inline upload. Instead, it returns a pre-signed POST URL that can be used to upload the file directly to S3 using `multipart/form-data`. In this mode the `fileContent` field is not required.

```json
{
  "fileName": "report.pdf",
  "uploadedBy": "alice@example.com",
  "contentType": "application/pdf",
  "expirationSeconds": 3600
}
```

The response additionally includes the data needed to complete the browser upload:

```json
{
  "fileId": "<generated uuid>",
  "s3Path": "uploads/<uuid>/report.pdf",
  "upload": {
    "url": "<pre-signed POST endpoint>",
    "fields": {
      "Content-Type": "application/pdf",
      "key": "uploads/<uuid>/report.pdf",
      "policy": "...",
      "x-amz-algorithm": "...",
      "x-amz-credential": "...",
      "x-amz-date": "...",
      "x-amz-signature": "..."
    },
    "expiresIn": 3600
  },
  "url": "<pre-signed download url>",
  "urlExpiration": "2024-05-15T12:34:56.000Z"
}
```

`GET /upload?uploadedBy=<email>`

Query string parameters:

- `uploadedBy` (required): The user identifier or email address used when uploading files. The Lambda queries DynamoDB using this value and only returns items owned by that user.

Response body (JSON):

```json
{
  "items": [
    {
      "fileId": "<uuid>",
      "fileName": "report.pdf",
      "uploadedBy": "alice@example.com",
      "uploadedDate": "2024-05-15T12:00:00.000Z",
      "s3Path": "uploads/<uuid>/report.pdf",
      "url": "<pre-signed download url>",
      "urlExpiration": "2024-05-15T13:00:00.000Z",
      "urlExpirationEpoch": 1715778000,
      "uploadMode": "inline"
    }
  ]
}
```

## Project Structure

- `lambda/upload-handler.ts` – Lambda handler that validates requests, uploads files to S3, generates pre-signed URLs, and stores metadata in DynamoDB.
- `cdk/` – TypeScript CDK application with the infrastructure stack.

## Deploying with CDK

1. Install the dependencies for the CDK app and Lambda function bundling:

   ```bash
   cd cdk
   npm install
   ```

2. (Optional) Type-check the project:

   ```bash
   npm run lint
   ```

3. Bootstrap your AWS environment if this is your first CDK deployment:

   ```bash
   cdk bootstrap
   ```

4. Deploy the stack:

   ```bash
   cdk deploy
   ```

After deployment the command output will contain the API Gateway endpoint that can be used to invoke the `/upload` route.

## Clean Up

The S3 bucket and DynamoDB table are configured with a `RETAIN` removal policy to avoid accidental data loss. If you no longer need the stack, delete the CloudFormation stack and then manually remove the stored data before deleting the S3 bucket and DynamoDB table.
