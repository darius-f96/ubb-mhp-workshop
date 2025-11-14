import { TestBed } from '@angular/core/testing';

import { AppInit } from './app-init';

describe('AppInit', () => {
  let service: AppInit;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(AppInit);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
