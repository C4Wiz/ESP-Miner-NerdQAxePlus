import { HttpErrorResponse, HttpEventType } from '@angular/common/http';
import { Component, OnInit, OnDestroy } from '@angular/core';
import { FormControl } from '@angular/forms';
import { combineLatest, map, Observable, catchError, of, shareReplay, Subscription, interval, Subject } from 'rxjs';
import { switchMap, tap, take, startWith } from 'rxjs/operators';
import { GithubUpdateService, UpdateStatus, VersionComparison, GithubRelease } from '../../services/github-update.service';
import { LoadingService } from '../../services/loading.service';
import { SystemService } from '../../services/system.service';
import { eASICModel } from '../../models/enum/eASICModel';
import { NbToastrService } from '@nebular/theme';
import { TranslateService } from '@ngx-translate/core';
import { IUpdateStatus } from 'src/app/models/IUpdateStatus';
import { OtpAuthService, EnsureOtpResult, EnsureOtpOptions } from '../../services/otp-auth.service';
import { ISystemInfo } from '../../models/ISystemInfo';
import { getAppVersion } from 'src/app/app.module';

@Component({
  selector: 'app-settings',
  templateUrl: './settings.component.html',
  styleUrls: ['./settings.component.scss']
})
export class SettingsComponent implements OnInit, OnDestroy {

  public firmwareUpdateProgress: number = 0;
  public websiteUpdateProgress: number = 0;

  public deviceModel: string = "";
  public devToolsOpen: boolean = false;
  public eASICModel = eASICModel;
  public ASICModel!: eASICModel;

  public expectedFileName: string = "";
  public expectedFactoryFilename: string = "";

  public selectedFirmwareFile: File | null = null;
  public selectedWebsiteFile: File | null = null;

  public info$: Observable<ISystemInfo>;

  public isWebsiteUploading = false;
  public isFirmwareUploading = false;
  public isOneClickUpdate = false;
  public isCheckingForUpdates = false;

  private updateStatusSub?: Subscription;
  private sawRebooting = false;

  public currentStep: string = "";

  // New properties for enhanced update system
  public updateStatus: UpdateStatus = UpdateStatus.UNKNOWN;
  public UpdateStatus = UpdateStatus; // Make enum available in template
  public versionComparison: VersionComparison | null = null;
  public showChangelog: boolean = false;
  public changelog: string = '';
  public currentVersion: string = '';
  public currentWebVersion: string = '';

  public otpEnabled: boolean = false;

  // Enhanced progress tracking
  public otaProgress: number = 0;
  private rebootCheckInterval?: any;

  private normalizedModel: string = '';

  public includePrereleasesCtrl = new FormControl<boolean>(false);
  public releases$!: Observable<GithubRelease[]>;
  public selectedRelease: GithubRelease | null = null;
  private latestStableRelease: GithubRelease | null = null;

  // Manual refresh trigger — only emits on button click, no auto-load on page open
  private refreshTrigger$ = new Subject<void>();
  public lastChecked: Date | null = null;

  constructor(
    private systemService: SystemService,
    private toastrService: NbToastrService,
    private loadingService: LoadingService,
    private githubUpdateService: GithubUpdateService,
    private translate: TranslateService,
    private otpAuth: OtpAuthService,
  ) {
    this.info$ = this.systemService.getInfo().pipe(
      shareReplay({ refCount: true, bufferSize: 1 })
    );
  }

  ngOnInit() {
    this.info$.pipe(this.loadingService.lockUIUntilComplete())
      .subscribe(info => {
        this.currentVersion = info.version;
        this.currentWebVersion = this.getAppVersion();
        //this.deviceModel = "NerdQAxe++";
        this.deviceModel = info.deviceModel;
        this.ASICModel = info.ASICModel;
        this.otpEnabled = !!info.otp;

        // Replace 'γ' with 'Gamma' if present and remove spaces
        // Keep special characters like + as GitHub releases use them
        this.normalizedModel = this.normalizeModel(this.deviceModel);
        this.expectedFileName = `esp-miner-${this.normalizedModel}.bin`;

        console.log('Device model from API:', this.deviceModel);
        console.log('Expected filename:', this.expectedFileName);

        this.updateVersionStatus();
      });

    // releases$ only fetches when the user explicitly clicks Check for Updates
    // or toggles the prerelease checkbox — no auto-fetch on page load to avoid
    // burning through the GitHub API unauthenticated rate limit (60 req/hr)
    this.releases$ = combineLatest([
      this.includePrereleasesCtrl.valueChanges.pipe(startWith(this.includePrereleasesCtrl.value)),
      this.info$,
      this.refreshTrigger$
    ]).pipe(
      switchMap(([include]) => {
        this.isCheckingForUpdates = true;
        return this.githubUpdateService.getReleases(include as boolean).pipe(
          map(list =>
            (list ?? []).filter(r =>
              r.assets?.some(a => a.name === this.buildFactoryNameFor(r))
            )
          ),
          tap(() => {
            this.lastChecked = new Date();
            this.isCheckingForUpdates = false;
          }),
          catchError(() => {
            this.isCheckingForUpdates = false;
            this.toastrService.danger(
              this.translate.instant('TOAST.UPDATE_CHECK_FAILED') || 'Failed to fetch releases from GitHub.',
              this.translate.instant('TOAST.ERROR')
            );
            return of([]);
          })
        );
      }),
      tap(list => {
        if (!this.selectedRelease || !list.find(r => r.id === this.selectedRelease!.id)) {
          this.selectedRelease = list[0] ?? null;
          this.updateSelectedReleaseDeps();
        }
      }),
      shareReplay({ refCount: true, bufferSize: 1 })
    );

    this.checkUpdateStatus();
  }

  private normalizeModel(model) {
    return model.replace(/γ/g, 'Gamma').replace(/\s+/g, '');
  }

  ngOnDestroy() {
    if (this.rebootCheckInterval) {
      clearInterval(this.rebootCheckInterval);
    }
    this.refreshTrigger$.complete();
  }

  /**
   * Manually trigger a fresh fetch of releases from GitHub.
   * This is the only way releases$ emits — no auto-fetch on page load.
   */
  public checkForUpdates() {
    this.refreshTrigger$.next();
  }

  /**
   * Start checking if device has rebooted and is back online
   */
  private startRebootCheck() {
    setTimeout(() => {
      let attemptCount = 0;
      const maxAttempts = 60;

      this.rebootCheckInterval = setInterval(() => {
        attemptCount++;

        this.systemService.getInfo().subscribe({
          next: (info) => {
            clearInterval(this.rebootCheckInterval);
            setTimeout(() => {
              window.location.reload();
            }, 2000);
          },
          error: (err) => {
            if (attemptCount >= maxAttempts) {
              clearInterval(this.rebootCheckInterval);
              this.isOneClickUpdate = false;
            }
          }
        });
      }, 1000);
    }, 5000);
  }

  public onFirmwareFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files.length > 0) {
      this.selectedFirmwareFile = input.files[0];
    }
  }

  public uploadFirmwareFile() {
    if (!this.selectedFirmwareFile) {
      this.toastrService.warning(this.translate.instant('TOAST.NO_FILE_SELECTED'), this.translate.instant('TOAST.WARNING'));
      return;
    }

    if (this.selectedFirmwareFile.name !== this.expectedFileName) {
      this.toastrService.danger(`${this.translate.instant('TOAST.INCORRECT_FILE')}: ${this.expectedFileName}`, this.translate.instant('TOAST.ERROR'));
      return;
    }

    const file = this.selectedFirmwareFile;

    this.otpAuth.ensureOtp$(
      "",
      this.translate.instant('SECURITY.OTP_TITLE'),
      this.translate.instant('SECURITY.OTP_FW_HINT')
    )
      .pipe(
        switchMap(({ totp }: EnsureOtpResult) => {
          this.isFirmwareUploading = true;
          return this.systemService.performOTAUpdate(file, totp)
            .pipe(this.loadingService.lockUIUntilComplete());
        })
      )
      .subscribe({
        next: (event) => {
          if (event?.type === HttpEventType.UploadProgress && event.total) {
            this.firmwareUpdateProgress = Math.round(100 * event.loaded / event.total);
          } else if (event?.type === HttpEventType.Response) {
            this.firmwareUpdateProgress = 100;
            this.toastrService.success(this.translate.instant('TOAST.FIRMWARE_UPDATED'), this.translate.instant('TOAST.SUCCESS'));
          }
        },
        error: (err) => {
          this.toastrService.danger(`${this.translate.instant('TOAST.UPLOAD_FAILED')}: ${err.message}`, this.translate.instant('TOAST.ERROR'));
          this.isFirmwareUploading = false;
          this.firmwareUpdateProgress = 0;
        },
        complete: () => {
          this.isFirmwareUploading = false;
          setTimeout(() => this.firmwareUpdateProgress = 0, 500);
        }
      });

    this.selectedFirmwareFile = null;
  }

  public onWebsiteFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files.length > 0) {
      this.selectedWebsiteFile = input.files[0];
    }
  }

  public uploadWebsiteFile() {
    if (!this.selectedWebsiteFile) {
      this.toastrService.warning(this.translate.instant('TOAST.NO_FILE_SELECTED'), this.translate.instant('TOAST.WARNING'));
      return;
    }

    if (this.selectedWebsiteFile.name !== 'www.bin') {
      this.toastrService.danger(`${this.translate.instant('TOAST.INCORRECT_FILE')}: www.bin`, this.translate.instant('TOAST.ERROR'));
      return;
    }
    const file = this.selectedWebsiteFile;

    this.otpAuth.ensureOtp$(
      "",
      this.translate.instant('SECURITY.OTP_TITLE'),
      this.translate.instant('SECURITY.OTP_FW_HINT')
    )
      .pipe(
        switchMap(({ totp }: EnsureOtpResult) => {
          this.isWebsiteUploading = true;
          return this.systemService.performWWWOTAUpdate(file, totp)
            .pipe(this.loadingService.lockUIUntilComplete());
        })
      )
      .subscribe({
        next: (event) => {
          if (!event) return;
          if (event.type === HttpEventType.UploadProgress && event.total) {
            this.websiteUpdateProgress = Math.round(100 * event.loaded / event.total);
          } else if (event.type === HttpEventType.Response) {
            this.websiteUpdateProgress = 100;
            this.toastrService.success(this.translate.instant('TOAST.WEBSITE_UPDATED'), this.translate.instant('TOAST.SUCCESS'));
            setTimeout(() => window.location.reload(), 1000);
          }
        },
        error: (err) => {
          this.toastrService.danger(`${this.translate.instant('TOAST.UPLOAD_FAILED')}: ${err.message}`, this.translate.instant('TOAST.ERROR'));
          this.isWebsiteUploading = false;
          this.websiteUpdateProgress = 0;
        },
        complete: () => {
          this.isWebsiteUploading = false;
          setTimeout(() => this.websiteUpdateProgress = 0, 500);
        }
      });

    this.selectedWebsiteFile = null;
  }

  private updateVersionStatus() {
    if (this.currentVersion && this.latestStableRelease) {
      this.updateStatus = this.githubUpdateService.getUpdateStatus(
        this.currentVersion,
        this.latestStableRelease
      );
      this.versionComparison = this.githubUpdateService.getVersionComparison(
        this.currentVersion,
        this.latestStableRelease
      );
    }
    this.updateSelectedReleaseDeps();
  }

  private updateSelectedReleaseDeps() {
    if (!this.selectedRelease) {
      this.expectedFactoryFilename = '';
      return;
    }
    this.expectedFactoryFilename = this.buildFactoryNameFor(this.selectedRelease);

    if (this.showChangelog) {
      this.changelog = this.githubUpdateService.getChangelog(this.selectedRelease);
    }
  }

  public getStatusBadgeColor(): string {
    switch (this.updateStatus) {
      case UpdateStatus.UP_TO_DATE:
        return 'success';
      case UpdateStatus.UPDATE_AVAILABLE:
        return 'warning';
      case UpdateStatus.OUTDATED:
        return 'danger';
      default:
        return 'basic';
    }
  }

  public getStatusTranslationKey(): string {
    const statusKey = this.updateStatus.toUpperCase().replace(/-/g, '_');
    return `UPDATE.STATUS_${statusKey}`;
  }

  public getReleaseLabel(r: GithubRelease, idx: number): string {
    return r.isLatest ? `${r.tag_name} (latest)` : r.tag_name;
  }

  public toggleChangelog() {
    this.showChangelog = !this.showChangelog;

    if (this.showChangelog && this.selectedRelease) {
      this.changelog = this.githubUpdateService.getChangelog(this.selectedRelease);
    }
  }

  public directUpdateFromGithub() {
    if (!this.selectedRelease) {
      this.toastrService.warning(this.translate.instant('TOAST.NO_RELEASE_INFO'), this.translate.instant('TOAST.WARNING'));
      return;
    }

    const confirmed = window.confirm(
      `Install ${this.selectedRelease.tag_name} on this device?\n\nThe device will reboot after flashing.`
    );
    if (!confirmed) return;

    const filename = this.expectedFactoryFilename;
    console.log('Looking for file:', filename);
    console.log('Device model:', this.deviceModel);
    const asset = this.githubUpdateService.findAsset(this.selectedRelease, filename);
    if (!asset) {
      this.toastrService.danger(`File "${filename}" not found.`, 'Error', { duration: 10000 });
      return;
    }

    // decodeURIComponent prevents %2B%2B double-encoding of '+' in NerdQAxe++
    // which the ESP32 backend URL validator rejects as an unsafe URL
    const assetUrl = decodeURIComponent(asset.browser_download_url);

    this.otpAuth.ensureOtp$(
      "",
      this.translate.instant('SECURITY.OTP_TITLE'),
      this.translate.instant('SECURITY.OTP_FW_HINT')
    )
      .pipe(
        switchMap(({ totp }: EnsureOtpResult) => {
          this.otaProgress = 0;
          this.isOneClickUpdate = true;
          this.firmwareUpdateProgress = 0;

          return this.systemService.performGithubOTAUpdate(assetUrl, totp);
        })
      )
      .subscribe({
        next: () => {
          this.startUpdatePolling();
        },
        error: (err) => {
          this.toastrService.danger(`${this.translate.instant('TOAST.UPDATE_FAILED')}: ${err.message || err.error}`, this.translate.instant('TOAST.ERROR'));
          this.isOneClickUpdate = false;
        }
      });
  }

  private startUpdatePolling() {
    this.stopUpdatePolling();
    this.sawRebooting = false;

    this.updateStatusSub = interval(1000)
      .pipe(
        switchMap(() => this.systemService.getGithubOTAStatus()),
        tap((status: IUpdateStatus) => {
          this.otaProgress = status.progress;
          this.currentStep = `UPDATE.STEP_${status.step.toUpperCase()}`;

          if (status.step === 'rebooting' && !this.sawRebooting) {
            this.sawRebooting = true;
            this.toastrService.success(this.translate.instant('TOAST.FIRMWARE_UPDATED'), this.translate.instant('TOAST.SUCCESS'));
            this.startRebootCheck();
          }
        })
      )
      .subscribe({
        error: (err) => {
          // ignore errors
        }
      });
  }

  private checkUpdateStatus() {
    this.systemService.getGithubOTAStatus()
      .pipe(take(1))
      .subscribe({
        next: (status: IUpdateStatus) => {
          if (status.pending || status.running) {
            this.isOneClickUpdate = true;
            this.otaProgress = status.progress;
            this.currentStep = `UPDATE.STEP_${status.step.toUpperCase()}`;
            this.startUpdatePolling();
          }
        },
      });
  }

  private stopUpdatePolling() {
    if (this.updateStatusSub) {
      this.updateStatusSub.unsubscribe();
      this.updateStatusSub = undefined;
    }
  }

  public getFilteredAssets(): any[] {
    return this.latestStableRelease?.assets?.filter(asset =>
      asset.name === this.expectedFactoryFilename
    ) ?? [];
  }

  public onSelectReleaseId(id: number) {
    this.releases$.pipe(take(1)).subscribe(list => {
      const sel = list.find(r => r.id === id);
      if (sel) {
        this.selectedRelease = sel;
        this.updateSelectedReleaseDeps();
      }
    });
  }

  public trackRelease = (_: number, r: GithubRelease) => r.id;

  private buildFactoryNameFor(release: GithubRelease): string {
    return `esp-miner-factory-${this.normalizedModel}-${release.tag_name}.bin`;
  }

  public getAppVersion() {
    return getAppVersion();
  }
}
