import { Injectable } from '@angular/core';
import { AuthConfig, OAuthService } from 'angular-oauth2-oidc';
import {catchError, defer, from, of, tap} from 'rxjs';

@Injectable({
  providedIn: 'root',
})
export class AppInit {
  constructor(private oauthService: OAuthService) {}


  initOidcConfig() {
    const authCodeFlowConfig: AuthConfig = {
      issuer: 'https://cognito-idp.eu-west-1.amazonaws.com/eu-west-1_MnCKcVS5o',
      strictDiscoveryDocumentValidation: false,
      redirectUri: window.location.origin,
      clientId: '4smqb4qv2orq6kvr083c904rir',
      responseType: 'code',
      scope: 'email openid phone',
      showDebugInformation: false,
    };
    this.oauthService.configure(authCodeFlowConfig);
  }

  initOidcAuth() {
    return defer(() =>
      from(
        this.oauthService.loadDiscoveryDocumentAndLogin({
          customHashFragment: window.location.search,
          state: this.getCurrentState(),
        })
      ).pipe(
        tap(() => {
          this.navigateToInitialPage();
          this.oauthService.setupAutomaticSilentRefresh();
        }),
        catchError(() => of())
      )
    );
  }

  private navigateToInitialPage() {
    if (this.oauthService.state) {
      const stateObject = JSON.parse(atob(decodeURIComponent(this.oauthService.state)));
      if (stateObject.originalLocation) {
        window.history.replaceState({}, '', stateObject.originalLocation);
      }
    }
  }

  getCurrentState(): string {
    return btoa(JSON.stringify({ originalLocation: window.location.href }));
  }
}
