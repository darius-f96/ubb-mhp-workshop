export interface DrClCdkConfig {
    readonly environment: "dev" | "stage" | "prod";
    readonly hosted_zone_id?: string;
    readonly hosted_zone_name?: string;
    readonly domain_certificate_arn?: string;
    readonly frontend_domain_name?: string;
}