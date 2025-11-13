import { Stack, StackProps } from 'aws-cdk-lib';
import {DrClCdkConfig} from "../../config/config";

export interface DrClStackProps extends StackProps {
    config: DrClCdkConfig;
}