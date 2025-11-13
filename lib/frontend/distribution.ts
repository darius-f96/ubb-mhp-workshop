import * as cdk from "aws-cdk-lib";
import {Bucket, BucketAccessControl, BucketEncryption, ObjectOwnership} from "aws-cdk-lib/aws-s3";
import {Aws, aws_cloudfront as cloudfront, Duration, RemovalPolicy, Stack} from "aws-cdk-lib";
import {CachePolicy, CfnDistribution, OriginBase, OriginRequestPolicy, PriceClass} from "aws-cdk-lib/aws-cloudfront";
import {Effect, PolicyStatement, ServicePrincipal, StarPrincipal} from "aws-cdk-lib/aws-iam";
import {ARecord, RecordTarget} from "aws-cdk-lib/aws-route53";
import {CloudFrontTarget} from "aws-cdk-lib/aws-route53-targets";
import {S3OriginProps} from "aws-cdk-lib/aws-cloudfront-origins";
import {Construct} from "constructs";
import {DrClCdkConfig} from "../../config/config";

export interface DrClFrontendDistributionProps {
    loggingBucket: cdk.aws_s3.IBucket;
    bucketEncryptionKey: cdk.aws_kms.Key;
    certificate?: cdk.aws_certificatemanager.ICertificate;
    hostedZone?: cdk.aws_route53.IHostedZone;
    hostedZoneDomain?: string;
    config: DrClCdkConfig;
}

export class DrClFrontendDistribution extends Construct {
    constructor(scope: Stack, id: string, props: DrClFrontendDistributionProps) {
        super(scope, id);
        const deploymentBucketName = `drcl-frontend-deployment-bucket-${props.config.environment}`;
        const deploymentBucket = new Bucket(scope, `frontend-deployment-bucket`, {
            bucketName: deploymentBucketName,
            enforceSSL: true,
            accessControl: BucketAccessControl.LOG_DELIVERY_WRITE,
            objectOwnership: ObjectOwnership.OBJECT_WRITER,
            encryption: BucketEncryption.KMS,
            encryptionKey: props.bucketEncryptionKey,
            removalPolicy: RemovalPolicy.DESTROY,
            serverAccessLogsBucket: props.loggingBucket,
            serverAccessLogsPrefix: `/S3/${deploymentBucketName}`,
        });
        this.addPoliciesToBucket(deploymentBucket);

        const defaultDistributionPath = '/index.html';

        const distribution = new cloudfront.Distribution(scope, `frontend-distribution`, {
            comment: `DrCl Frontend App Distribution ${props.config.environment}`,
            defaultBehavior: {
                origin: new MySimpleS3Origin(`${deploymentBucket.bucketName}.s3.${scope.region}.amazonaws.com`, {
                    originPath: `/`
                }),
                viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
                cachePolicy: CachePolicy.CACHING_OPTIMIZED,
                originRequestPolicy: new OriginRequestPolicy(scope, `internship-frontend-origin-request`, {
                    originRequestPolicyName: `drcl-${props.config.environment}-frontend-origin-request`
                })
            },
            defaultRootObject: defaultDistributionPath,
            certificate: props.certificate ? props.certificate : undefined,
            domainNames: props.hostedZoneDomain ? [`${props.hostedZoneDomain}`] : undefined,
            enableLogging: true,
            logBucket: props.loggingBucket,
            logFilePrefix: `cloudfront/drcl-frontend-distribution`,
            logIncludesCookies: true,
            enableIpv6: true,
            priceClass: PriceClass.PRICE_CLASS_100,
            errorResponses: [
                {
                    httpStatus: 400,
                    responseHttpStatus: 200,
                    responsePagePath: defaultDistributionPath,
                    ttl: cdk.Duration.seconds(10)
                },
                {
                    httpStatus: 404,
                    responseHttpStatus: 200,
                    responsePagePath: defaultDistributionPath,
                    ttl: cdk.Duration.seconds(10)
                },
                {
                    httpStatus: 403,
                    responseHttpStatus: 200,
                    responsePagePath: defaultDistributionPath,
                    ttl: cdk.Duration.seconds(10)
                }
            ],
            geoRestriction: cloudfront.GeoRestriction.allowlist('RO', 'DE'),
        });

        props.loggingBucket.addToResourcePolicy(
            new PolicyStatement({
                actions: ['s3:PutObject'],
                effect: Effect.ALLOW,
                principals: [new ServicePrincipal('cloudfront.amazonaws.com')],
                resources: [`${props.loggingBucket.bucketArn}/*`],
                conditions: {
                    StringEquals: {
                        'AWS:SourceArn': `arn:aws:cloudfront::${Aws.ACCOUNT_ID}:distribution/${distribution.distributionId}`
                    }
                }
            })
        );

        deploymentBucket.addToResourcePolicy(
            new PolicyStatement({
                actions: ['s3:GetObject'],
                effect: Effect.ALLOW,
                principals: [new ServicePrincipal('cloudfront.amazonaws.com')],
                resources: [deploymentBucket.bucketArn + '/*'],
                conditions: {
                    StringEquals: {
                        'AWS:SourceArn': `arn:aws:cloudfront::${Aws.ACCOUNT_ID}:distribution/${distribution.distributionId}`
                    }
                }
            })
        );

        // Create Origin Access Control
        const oac = new cloudfront.CfnOriginAccessControl(scope, `drcl-frontend-aoc`, {
            originAccessControlConfig: {
                name: `drcl-frontend-aoc-${props.config.environment}`,
                originAccessControlOriginType: 's3',
                signingBehavior: 'always',
                signingProtocol: 'sigv4'
            }
        });

        /**
         * Since CDK does not support creating of AOC for cloudfront distributions, we had to implement this workaround
         * https://github.com/aws/aws-cdk/issues/21771#issuecomment-1478470280
         * PR for this CDK feature is here => https://github.com/aws/aws-cdk-rfcs/issues/491
         */
        const cfnDistribution = distribution.node.defaultChild as CfnDistribution;
        cfnDistribution.addPropertyOverride('DistributionConfig.Origins.0.OriginAccessControlId', oac.getAtt('Id'));


        if (props.hostedZone) {
            // A record for the deployed app
            const aRecord = new ARecord(scope, `a-record-drcl-frontend-${props.config.environment}`, {
                zone: props.hostedZone,
                recordName: `${props.hostedZoneDomain}`,
                ttl: Duration.seconds(3600),
                target: RecordTarget.fromAlias(new CloudFrontTarget(distribution))
            });
        }
    }

    private addPoliciesToBucket(userBucket: Bucket): void {
        userBucket.addToResourcePolicy(
            new PolicyStatement({
                actions: ['s3:*'],
                effect: Effect.DENY,
                principals: [new StarPrincipal()],
                resources: [userBucket.bucketArn, userBucket.bucketArn + '/*'],
                conditions: {
                    Bool: {
                        'aws:SecureTransport': 'false'
                    }
                }
            })
        );

        userBucket.addToResourcePolicy(
            new PolicyStatement({
                actions: ['s3:PutObject'],
                effect: Effect.DENY,
                principals: [new StarPrincipal()],
                resources: [userBucket.bucketArn + '/*'],
                conditions: {
                    Null: {
                        's3:x-amz-server-side-encryption': 'true'
                    },
                    StringNotEquals: {
                        's3:x-amz-server-side-encryption': 'aws:kms'
                    }
                }
            })
        );
    }
}


/**
 * Since CDK does not support creating of AOC for cloudfront distributions, we had to implement this workaround
 * https://github.com/aws/aws-cdk/issues/21771#issuecomment-1478470280
 * PR for this CDK feature is here => https://github.com/aws/aws-cdk-rfcs/issues/491
 */
class MySimpleS3Origin extends OriginBase {
    constructor(fullyQualifiedBucketDomain: string, props?: S3OriginProps) {
        super(fullyQualifiedBucketDomain, props);
    }

    // note, intentionally violates the return type to render an object with no OAI properties
    protected renderS3OriginConfig() {
        return {};
    }
}