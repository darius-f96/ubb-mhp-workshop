#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { DropboxCloneStack } from '../lib/dropbox-clone-stack';

const app = new cdk.App();
new DropboxCloneStack(app, 'DropboxCloneStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
});
