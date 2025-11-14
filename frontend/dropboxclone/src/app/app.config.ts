import {
  ApplicationConfig,
  importProvidersFrom, inject, provideAppInitializer,
  provideBrowserGlobalErrorListeners,
  provideZoneChangeDetection
} from '@angular/core';
import { provideRouter } from '@angular/router';
import { OAuthModule, OAuthModuleConfig } from 'angular-oauth2-oidc';

import { routes } from './app.routes';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { AppInit } from './service/app-init';
import { authInterceptor } from './interceptors/auth.interceptor';

export const appConfig: ApplicationConfig = {
  providers: [
    importProvidersFrom([
      OAuthModule.forRoot(),
    ]),
    provideHttpClient(withInterceptors([authInterceptor])),
    provideBrowserGlobalErrorListeners(),
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideAppInitializer(() => {
      const initializerFn = ((appInit: AppInit) => {
        return () => {
          appInit.initOidcConfig();
          return appInit.initOidcAuth();
        };
      })(inject(AppInit));
      return initializerFn();
    }),
    provideRouter(routes),
    {
      provide: OAuthModuleConfig,
      useFactory: () => {
        const oauthAllowedUrls = [
          'http://localhost:4200',
          'https://d3n44jfulxzp0t.cloudfront.net',
        ];

        const config: OAuthModuleConfig = {
          resourceServer: {
            allowedUrls: oauthAllowedUrls,
            sendAccessToken: true,
          },
        };
        return config;
      },
      deps: [],
      multi: false,
    }
  ]
};
