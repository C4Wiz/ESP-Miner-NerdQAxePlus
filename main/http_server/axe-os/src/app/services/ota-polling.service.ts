import { Injectable, OnDestroy } from '@angular/core';
import { interval, Subscription, Subject } from 'rxjs';
import { switchMap, tap, takeUntil } from 'rxjs/operators';
import { SystemService } from './system.service';
import { IUpdateStatus } from '../models/IUpdateStatus';

@Injectable({ providedIn: 'root' })
export class OtaPollingService implements OnDestroy {

  public status: IUpdateStatus | null = null;
  public isPolling = false;
  public sawRebooting = false;
  public onRebooting$ = new Subject<void>();

  private pollSub?: Subscription;
  private stop$ = new Subject<void>();

  constructor(private systemService: SystemService) {}

  public start() {
    if (this.isPolling) return;
    this.isPolling = true;
    this.sawRebooting = false;
    this.stop$ = new Subject<void>();

    this.pollSub = interval(1000).pipe(
      switchMap(() => this.systemService.getGithubOTAStatus()),
      tap((status: IUpdateStatus) => {
        this.status = status;
        if (status.step === 'rebooting' && !this.sawRebooting) {
          this.sawRebooting = true;
          this.onRebooting$.next();
        }
        if (!status.pending && !status.running) {
          this.stop();
        }
      }),
      takeUntil(this.stop$)
    ).subscribe({ error: () => {} });
  }

  public stop() {
    this.isPolling = false;
    this.stop$.next();
    this.pollSub?.unsubscribe();
    this.pollSub = undefined;
  }

  ngOnDestroy() {
    this.stop();
  }
}
