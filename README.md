# Dropbox-like File Sharing Backend

This repository contains a sample implementation of a serverless backend that accepts file uploads, stores them in Amazon S3, and writes the metadata alongside pre-signed download URLs into DynamoDB. The solution is composed of:

- An AWS Lambda function (TypeScript/Node.js 18) invoked through API Gateway.
- An AWS CDK stack (TypeScript) that provisions the infrastructure: S3 bucket, DynamoDB table, Lambda function, and API Gateway REST API.

## Lambda API Contract

`POST /upload`

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
   npx cdk bootstrap
   ```

4. Deploy the stack:

   ```bash
   npx cdk deploy
   ```

After deployment the command output will contain the API Gateway endpoint that can be used to invoke the `/upload` route.

## Clean Up

The S3 bucket and DynamoDB table are configured with a `RETAIN` removal policy to avoid accidental data loss. If you no longer need the stack, delete the CloudFormation stack and then manually remove the stored data before deleting the S3 bucket and DynamoDB table.
