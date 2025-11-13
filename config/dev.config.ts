import {DrClCdkConfig} from "./config";

export class DevConfig implements DrClCdkConfig {
    readonly environment = "dev" as const;
}