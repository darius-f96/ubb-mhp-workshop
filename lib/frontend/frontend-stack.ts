import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import {
    RemovalPolicy
} from 'aws-cdk-lib';
import { Effect, PolicyStatement, ServicePrincipal } from 'aws-cdk-lib/aws-iam';
import { HostedZone } from 'aws-cdk-lib/aws-route53';
import { Certificate } from 'aws-cdk-lib/aws-certificatemanager';
import { Key } from 'aws-cdk-lib/aws-kms';
import {DrClFrontendDistribution} from "./distribution";
import {DrClStackProps} from "../helpers/base-stack-props";
import {Bucket, BucketAccessControl, BucketEncryption, ObjectOwnership} from "aws-cdk-lib/aws-s3";


export class DropboxCloneFrontendStack extends cdk.Stack {
    constructor(scope: Construct, id: string, props: DrClStackProps) {
        super(scope, id, props);

        let frontendCertificate;
        let hostedZone;
        if (props.config.domain_certificate_arn) {
            frontendCertificate =
                Certificate.fromCertificateArn(this, 'frontend-certificate',
                    // manually created certificate in us-east-1 region
                    props.config.domain_certificate_arn
                );
            hostedZone = HostedZone.fromHostedZoneAttributes(this, 'hosted-zone', {
                hostedZoneId: props.config.hosted_zone_id!,
                zoneName: props.config.hosted_zone_name!
            });
        }

        const loggingBucket = new Bucket(this, 'drcl-frontend-logging-bucket', {
            bucketName: `drcl-frontend-logging-${props.config.environment}`,
            enforceSSL: true,
            accessControl: BucketAccessControl.LOG_DELIVERY_WRITE,
            objectOwnership: ObjectOwnership.OBJECT_WRITER,
            encryption: BucketEncryption.KMS,
            encryptionKey: new Key(this, 'drcl-logging-bucket-kms-key', {
                alias: `drcl-logging-bucket-kms-key-${props.config.environment}`,
                description: `KMS key for the logging bucket of the drcl ${props.config.environment} frontend app`,
                removalPolicy: RemovalPolicy.DESTROY,
                enableKeyRotation: true
            }),
            removalPolicy: RemovalPolicy.DESTROY,
        });

        const bucketEncryptionKey = new Key(this, `drcl-frontend-bucket-encryption-key-${props.config.environment}`, {
            alias: `drcl-frontend-bucket-encryption-key-${props.config.environment}`,
            description: `KMS key for the drcl ${props.config.environment} frontend app deployment bucket`,
            removalPolicy: RemovalPolicy.DESTROY,
            enableKeyRotation: true
        });
        // Grant CloudFront KMS permissions for the deployment bucket
        bucketEncryptionKey.addToResourcePolicy(new PolicyStatement({
            actions: [
                'kms:Decrypt',
                'kms:Encrypt',
                'kms:GenerateDataKey*'
            ],
            effect: Effect.ALLOW,
            principals: [new ServicePrincipal('cloudfront.amazonaws.com')],
            resources: ["*"]
        }));

        const distribution = new DrClFrontendDistribution(this, 'drcl-frontend-distribution', {
            loggingBucket,
            bucketEncryptionKey,
            certificate: frontendCertificate ? frontendCertificate : undefined,
            hostedZone: hostedZone ? hostedZone : undefined,
            hostedZoneDomain: props.config.frontend_domain_name,
            config: props.config
        })
    }
}
