import * as path from 'path';
import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as apigw from 'aws-cdk-lib/aws-apigateway';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as lambda from 'aws-cdk-lib/aws-lambda';

export class DropboxCloneStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    cdk.Tags.of(this).add('MHPUBBWorkshop', 'November-2025');

    const vpc = new ec2.Vpc(this, 'DropboxCloneVpc', {
      maxAzs: 2,
      natGateways: 0,
      subnetConfiguration: [
        {
          name: 'PrivateSubnet',
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
        },
      ],
    });

    vpc.addGatewayEndpoint('S3Endpoint', {
      service: ec2.GatewayVpcEndpointAwsService.S3,
    });

    vpc.addGatewayEndpoint('DynamoEndpoint', {
      service: ec2.GatewayVpcEndpointAwsService.DYNAMODB,
    });

    const lambdaSecurityGroup = new ec2.SecurityGroup(this, 'LambdaSecurityGroup', {
      vpc,
      description: 'Security group for Lambda inside the private subnet',
      allowAllOutbound: true,
    });

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

    table.addGlobalSecondaryIndex({
      indexName: 'uploadedByIndex',
      partitionKey: { name: 'uploadedBy', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    const lambdaAssetPath = path.join(__dirname, '..', 'lambda', 'upload-handler', 'dist');

    const lambdaFunction = new lambda.Function(this, 'FileUploadHandler', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'upload-handler.handler',
      code: lambda.Code.fromAsset(lambdaAssetPath),
      timeout: cdk.Duration.seconds(30),
      environment: {
        FILE_BUCKET_NAME: bucket.bucketName,
        FILE_METADATA_TABLE: table.tableName,
        DEFAULT_URL_EXPIRATION: '3600',
      },
      vpc,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
      },
      securityGroups: [lambdaSecurityGroup],
    });

    bucket.grantPut(lambdaFunction);
    bucket.grantRead(lambdaFunction);
    table.grantReadWriteData(lambdaFunction);

    lambdaFunction.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['s3:GetObject'],
        resources: [bucket.arnForObjects('*')],
      }),
    );

    const existingUserPoolArn =
      'arn:aws:cognito-idp:eu-west-1:930295948213:userpool/eu-west-1_MnCKcVS5o';
    const existingUserPoolId = 'eu-west-1_MnCKcVS5o';

    const userPool = cognito.UserPool.fromUserPoolArn(
      this,
      'DropboxUserPool',
      existingUserPoolArn,
    );

    const authorizer = new apigw.CognitoUserPoolsAuthorizer(this, 'DropboxApiAuthorizer', {
      cognitoUserPools: [userPool],
    });

    const api = new apigw.LambdaRestApi(this, 'FileUploadApi', {
      handler: lambdaFunction,
      proxy: false,
      restApiName: 'DropboxCloneApi',
      defaultCorsPreflightOptions: {
        allowOrigins: apigw.Cors.ALL_ORIGINS,
        allowMethods: ['POST', 'GET', 'DELETE'],
        allowHeaders: ['Authorization', 'Content-Type'],
      },
    });

    authorizer._attachToApi(api);

    const uploadResource = api.root.addResource('upload');
    uploadResource.addMethod('POST', undefined, {
      authorizationType: apigw.AuthorizationType.COGNITO,
      authorizer,
    });
    uploadResource.addMethod('GET', undefined, {
      authorizationType: apigw.AuthorizationType.COGNITO,
      authorizer,
    });
    uploadResource.addMethod('DELETE', undefined, {
      authorizationType: apigw.AuthorizationType.COGNITO,
      authorizer,
    });

    new cdk.CfnOutput(this, 'BucketName', {
      value: bucket.bucketName,
    });

    new cdk.CfnOutput(this, 'MetadataTableName', {
      value: table.tableName,
    });

    new cdk.CfnOutput(this, 'ApiUrl', {
      value: api.url ?? '',
    });

    new cdk.CfnOutput(this, 'UserPoolId', {
      value: existingUserPoolId,
    });

  }
}
