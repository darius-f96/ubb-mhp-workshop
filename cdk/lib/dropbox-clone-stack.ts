import * as path from 'path';
import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as apigw from 'aws-cdk-lib/aws-apigateway';
import * as iam from 'aws-cdk-lib/aws-iam';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Runtime } from 'aws-cdk-lib/aws-lambda';

export class DropboxCloneStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const bucket = new s3.Bucket(this, 'FileBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      versioned: true,
      autoDeleteObjects: false,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    const table = new dynamodb.Table(this, 'FileMetadataTable', {
      partitionKey: { name: 'fileId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: 'urlExpirationEpoch',
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    const lambdaEntry = path.join(__dirname, '..', '..', 'lambda', 'upload-handler.ts');

    const lambdaFunction = new NodejsFunction(this, 'FileUploadHandler', {
      entry: lambdaEntry,
      handler: 'handler',
      runtime: Runtime.NODEJS_18_X,
      timeout: cdk.Duration.seconds(30),
      bundling: {
        target: 'es2021',
        keepNames: true,
      },
      environment: {
        FILE_BUCKET_NAME: bucket.bucketName,
        FILE_METADATA_TABLE: table.tableName,
        DEFAULT_URL_EXPIRATION: '3600',
      },
    });

    bucket.grantPut(lambdaFunction);
    bucket.grantRead(lambdaFunction);
    table.grantWriteData(lambdaFunction);

    lambdaFunction.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['s3:GetObject'],
        resources: [bucket.arnForObjects('*')],
      }),
    );

    const api = new apigw.LambdaRestApi(this, 'FileUploadApi', {
      handler: lambdaFunction,
      proxy: false,
      restApiName: 'DropboxCloneApi',
      defaultCorsPreflightOptions: {
        allowOrigins: apigw.Cors.ALL_ORIGINS,
        allowMethods: ['POST'],
      },
    });

    const uploadResource = api.root.addResource('upload');
    uploadResource.addMethod('POST');

    new cdk.CfnOutput(this, 'BucketName', {
      value: bucket.bucketName,
    });

    new cdk.CfnOutput(this, 'MetadataTableName', {
      value: table.tableName,
    });

    new cdk.CfnOutput(this, 'ApiUrl', {
      value: api.url ?? '',
    });
  }
}
