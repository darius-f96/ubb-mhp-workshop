import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { OAuthService } from 'angular-oauth2-oidc';

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const oauthService = inject(OAuthService);
  const idToken = oauthService.getIdToken();

  // Skip adding auth header for S3 requests (direct uploads)
  if (req.url.includes('.s3.') || req.url.includes('//s3.') || req.url.includes('s3.amazonaws.com')) {
    return next(req);
  }

  if (idToken) {
    const clonedRequest = req.clone({
      setHeaders: {
        Authorization: `Bearer ${idToken}`
      }
    });
    return next(clonedRequest);
  }

  return next(req);
};
