#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { DropboxCloneStack } from '../lib/dropbox-clone-stack';
import {DrClCdkConfig} from "../config/config";
import {DevConfig} from "../config/dev.config";
import {DropboxCloneFrontendStack} from "../lib/frontend/frontend-stack";

const configs: {[key: string]: DrClCdkConfig} = {
    "dev": new DevConfig()
}

const environment = process.env.ENVIRONMENT ?? "dev";

const app = new cdk.App();
new DropboxCloneStack(app, 'DropboxCloneStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
});

new DropboxCloneFrontendStack(app, `frontend-stack-drcl-${environment}`, {
    env: {
        account: process.env.CDK_DEFAULT_ACCOUNT,
        region: 'us-east-1'
    },
    config: configs[environment]
});