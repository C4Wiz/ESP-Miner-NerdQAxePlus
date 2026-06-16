import { HttpClient, HttpErrorResponse, HttpEventType } from '@angular/common/http';
import { Component, OnInit, OnDestroy, ChangeDetectorRef, ViewChild } from '@angular/core';
import { FormControl } from '@angular/forms';
import { combineLatest, map, Observable, catchError, of, shareReplay, Subscription, interval, BehaviorSubject } from 'rxjs';
import { switchMap, tap, take, startWith } from 'rxjs/operators';
import { GithubUpdateService, UpdateStatus, VersionComparison, GithubRelease } from '../../services/github-update.service';
import { LoadingService } from '../../services/loading.service';
import { SystemService } from '../../services/system.service';
import { OtaPollingService } from '../../services/ota-polling.service';
import { eASICModel } from '../../models/enum/eASICModel';
import { NbToastrService, NbSelectComponent } from '@nebular/theme';
import { TranslateService } from '@ngx-translate/core';
import { IUpdateStatus } from 'src/app/models/IUpdateStatus';
import { OtpAuthService, EnsureOtpResult, EnsureOtpOptions } from '../../services/otp-auth.service';
import { ISystemInfo } from '../../models/ISystemInfo';
import { getAppVersion } from 'src/app/app.module';

/**
 * Safe localStorage helpers. Wrapped in try/catch because some embedded
 * browser contexts (kiosk mode, certain WebViews, private/restricted modes)
 * throw on storage access instead of just returning null. Logs failures to
 * the console so the cause is visible rather than silently failing.
 */
function settingsLocalStorageGet(key: string): string | null {
  try {
    const value = localStorage.getItem(key);
    console.log(`[settings] localStorage.getItem('${key}') ->`, value);
    return value;
  } catch (e) {
    console.warn(`[settings] localStorage.getItem('${key}') failed:`, e);
    return null;
  }
}

function settingsLocalStorageSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
    console.log(`[settings] localStorage.setItem('${key}', '${value}') succeeded`);
  } catch (e) {
    console.warn(`[settings] localStorage.setItem('${key}', '${value}') failed:`, e);
  }
}

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
  public isLoadingChangelog = false;

  private rebootSub?: Subscription;

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

  private rebootCheckInterval?: any;

  private normalizedModel: string = '';

  public keepConfigCtrl = new FormControl<boolean>(true);
  public includePrereleasesCtrl = new FormControl<boolean>(
    settingsLocalStorageGet('include_prereleases') === '1'
  );
  public releases$!: Observable<GithubRelease[]>;   // list shown in dropdown
  @ViewChild('releaseSelect') releaseSelect?: NbSelectComponent;
  public selectedRelease: GithubRelease | null = null;
  private latestStableRelease: GithubRelease | null = null;

  // BehaviorSubject emits immediately on subscription — triggers auto-check on page load
  private refreshTrigger$ = new BehaviorSubject<void>(undefined);
  public lastChecked: Date | null = null;

  private readonly githubApiBase =
    'https://api.github.com/repos/C4Wiz/ESP-Miner-NerdQAxePlus/releases/tags';

  // Expose OTA polling service status to template
  public get otaProgress(): number {
    return this.otaPolling.status?.progress ?? 0;
  }

  public get otaCurrentStep(): string {
    return `UPDATE.STEP_${(this.otaPolling.status?.step ?? 'UNKNOWN').toUpperCase()}`;
  }

  constructor(
    private systemService: SystemService,
    private toastrService: NbToastrService,
    private loadingService: LoadingService,
    private githubUpdateService: GithubUpdateService,
    private translate: TranslateService,
    private otpAuth: OtpAuthService,
    private httpClient: HttpClient,
    public otaPolling: OtaPollingService,
    private cdr: ChangeDetectorRef,
  ) {
    this.info$ = this.systemService.getInfo().pipe(
      shareReplay({ refCount: true, bufferSize: 1 })
    );
  }

  ngOnInit() {
    // Show success toast if we just came back from a reboot after an OTA update
    if (localStorage.getItem('ota_success') === '1') {
      localStorage.removeItem('ota_success');
      this.toastrService.success(
        this.translate.instant('TOAST.FIRMWARE_UPDATED'),
        this.translate.instant('TOAST.SUCCESS')
      );
    }

    // If polling was already running (navigated away and back), re-attach
    if (this.otaPolling.isPolling) {
      this.isOneClickUpdate = true;
      this.attachRebootListener();
    }

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
        this.normalizedModel = this.normalizeModel(this.deviceModel)
        this.expectedFileName = `esp-miner-${this.normalizedModel}.bin`;

        console.log('Device model from API:', this.deviceModel);
        console.log('Expected filename:', this.expectedFileName);

        // Update version status after we have both current version and latest release
        this.updateVersionStatus();
      });

    // releases$ fetches on page load (BehaviorSubject initial emit),
    // on manual Check for Updates click, and when prerelease toggle changes
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
              this.translate.instant('TOAST.UPDATE_CHECK_FAILED') || 'Failed to fetch releases.',
              this.translate.instant('TOAST.ERROR')
            );
            return of([]);
          })
        );
      }),
      tap(list => {
        // nb-select's canSelectValue() only checks whether *any* options
        // currently exist (this.options.length), not whether the new id
        // actually matches one of them. So writing a new selected id in the
        // same tick as a list change can silently fail: canSelectValue()
        // sees the *old* (stale) options and returns true, so nb-select
        // tries to match against them immediately rather than queuing/
        // retrying, and the failed match is never revisited once the new
        // nb-options actually render. A plain microtask isn't enough to
        // guarantee Angular has re-rendered the *ngFor by then, so we use
        // setTimeout to push past a real render cycle, then explicitly
        // re-assign `selected` on the select instance to force it to
        // re-evaluate against the now-current options.
        this.selectedRelease = list[0] ?? null;
        this.updateSelectedReleaseDeps();
        setTimeout(() => {
          if (this.releaseSelect) {
            this.releaseSelect.selected = this.selectedRelease?.id ?? null;
          }
          this.cdr.markForCheck();
        });

        this.latestStableRelease = list.find(r => !r.prerelease) ?? list[0] ?? null;
        this.showChangelog = false;
        this.changelog = '';
        this.updateVersionStatus();

        if (this.includePrereleasesCtrl.value) {
          if (list.length === 0) {
            this.toastrService.warning(
              this.translate.instant('UPDATE.NO_PRERELEASES'),
              this.translate.instant('UPDATE.STATUS_UP_TO_DATE'),
              { duration: 4000 }
            );
          } else if (this.updateStatus === UpdateStatus.UPDATE_AVAILABLE) {
            this.toastrService.warning(
              `${this.selectedRelease?.tag_name ?? ''}`,
              this.translate.instant('UPDATE.STATUS_UPDATE_AVAILABLE'),
              { duration: 6000 }
            );
          }
        } else {
          if (this.updateStatus === UpdateStatus.UPDATE_AVAILABLE) {
            this.toastrService.warning(
              `${this.latestStableRelease?.tag_name ?? ''}`,
              this.translate.instant('UPDATE.STATUS_UPDATE_AVAILABLE'),
              { duration: 6000 }
            );
          }
        }
      }),
      shareReplay({ refCount: true, bufferSize: 1 })
    );

    this.checkUpdateStatus();

    // Re-fetch when prerelease toggle changes
    this.includePrereleasesCtrl.valueChanges.subscribe((value) => {
      settingsLocalStorageSet('include_prereleases', value ? '1' : '0');
      this.refreshTrigger$.next();
    });
  }

  private normalizeModel(model) {
    return model.replace(/γ/g, 'Gamma').replace(/\s+/g, '');
  }

  ngOnDestroy() {
    // Clear reboot check interval
    if (this.rebootCheckInterval) {
      clearInterval(this.rebootCheckInterval);
    }
    this.rebootSub?.unsubscribe();
    this.refreshTrigger$.complete();
  }

  /**
   * Manually trigger a fresh fetch of releases from R2.
   */
  public checkForUpdates() {
    this.refreshTrigger$.next();
  }

  private attachRebootListener() {
    this.rebootSub?.unsubscribe();
    this.rebootSub = this.otaPolling.onRebooting$.pipe(take(1)).subscribe(() => {
      localStorage.setItem('ota_success', '1');
      this.startRebootCheck();
    });
  }

  private startUpdatePolling() {
    this.otaPolling.start();
    this.attachRebootListener();
  }

  /**
   * Start checking if device has rebooted and is back online
   */
  private startRebootCheck() {
    // Wait 5 seconds before starting to check (give device time to actually reboot)
    setTimeout(() => {
      let attemptCount = 0;
      const maxAttempts = 60; // Try for 60 seconds

      this.rebootCheckInterval = setInterval(() => {
        attemptCount++;

        // Try to fetch system info
        this.systemService.getInfo().subscribe({
          next: (info) => {
            // Device is back online!
            clearInterval(this.rebootCheckInterval);

            // Reload page after a short delay
            setTimeout(() => {
              window.location.reload();
            }, 2000);
          },
          error: (err) => {
            // Device not ready yet, keep trying
            if (attemptCount >= maxAttempts) {
              clearInterval(this.rebootCheckInterval);
              this.isOneClickUpdate = false;
            }
          }
        });
      }, 1000); // Check every second
    }, 5000); // Wait 5 seconds before starting
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


  /**
   * Update version status based on current and latest versions
   */
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

  /** Refresh filename for the selected release */
  private updateSelectedReleaseDeps() {
    if (!this.selectedRelease) {
      this.expectedFactoryFilename = '';
      return;
    }
    this.expectedFactoryFilename = this.buildFactoryNameFor(this.selectedRelease);
  }


  /**
   * Get status badge color based on update status
   */
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

  /**
   * Get translation key for status badge
   * Converts 'up-to-date' to 'UPDATE.STATUS_UP_TO_DATE'
   */
  public getStatusTranslationKey(): string {
    const statusKey = this.updateStatus.toUpperCase().replace(/-/g, '_');
    return `UPDATE.STATUS_${statusKey}`;
  }

  /** Label for dropdown: "vX.Y.Z (latest)" for the newest item */
  public getReleaseLabel(r: GithubRelease, idx: number): string {
    return r.isLatest ? `${r.tag_name} (latest)` : r.tag_name;
  }

  /**
   * Toggle changelog visibility. On first expand, lazily fetch the release
   * body from GitHub API if not already cached — only one call, only when needed.
   */
  public toggleChangelog() {
    this.showChangelog = !this.showChangelog;

    if (!this.showChangelog || !this.selectedRelease) return;

    // If we already have the body cached on the release object, use it
    if (this.selectedRelease.body) {
      this.changelog = this.githubUpdateService.getChangelog(this.selectedRelease);
      return;
    }

    // Lazily fetch from GitHub API — only hits the API on first expand per release
    this.isLoadingChangelog = true;
    this.changelog = '';

    this.httpClient
      .get<any>(`${this.githubApiBase}/${this.selectedRelease.tag_name}`)
      .pipe(
        take(1),
        catchError(() => of(null))
      )
      .subscribe(release => {
        this.isLoadingChangelog = false;
        if (release?.body) {
          // Cache the body on the release object so subsequent toggles don't re-fetch
          this.selectedRelease!.body = release.body;
          this.changelog = this.githubUpdateService.getChangelog(this.selectedRelease!);
        } else {
          this.changelog = 'No changelog available.';
        }
      });
  }

  /**
   * Direct update from GitHub via backend proxy
   */
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
          // reset UI states
          this.isOneClickUpdate = true;
          this.firmwareUpdateProgress = 0;

          // kick the backend update
          const keepConfig = this.keepConfigCtrl.value ?? true;
          return this.systemService.performGithubOTAUpdate(assetUrl, keepConfig, totp);
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

  // we can resume the update progress status on a page reload because
  // the OTA update is not done in HTTP server context anymore! 😍
  private checkUpdateStatus() {
    // Single-shot status fetch
    this.systemService.getGithubOTAStatus()
      .pipe(take(1))
      .subscribe({
        next: (status: IUpdateStatus) => {
          // If update is ongoing, (re)start polling
          if (status.pending || status.running) {
            this.isOneClickUpdate = true;
            this.otaPolling.status = status;
            this.startUpdatePolling();
          }
        },
      });
  }

  /**
   * Get filtered assets (only matching factory firmware)
   */
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
        this.showChangelog = false;
        this.changelog = '';
        this.updateSelectedReleaseDeps();
      }
    });
  }

  public trackRelease = (_: number, r: GithubRelease) => r.id;

  // Helper to build expected factory filename for a given release
  private buildFactoryNameFor(release: GithubRelease): string {
    return `esp-miner-factory-${this.normalizedModel}-${release.tag_name}.bin`;
  }

  public getAppVersion() {
    return getAppVersion();
  }

}
