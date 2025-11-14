import {Component, inject, OnInit, signal} from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { OAuthService } from 'angular-oauth2-oidc';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet],
  templateUrl: './app.html',
  styleUrl: './app.scss'
})
export class App implements OnInit {
  protected readonly title = signal('dropboxclone');
  oidcToken = '';
  private readonly oauthService = inject(OAuthService);

  ngOnInit() {
    this.oidcToken = this.oauthService.getIdToken();
  }
}
