import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable, EMPTY } from 'rxjs';
import { map, switchMap, expand, scan, takeWhile, last } from 'rxjs/operators';

interface GithubAsset {
  id: number;
  name: string;
  browser_download_url: string;
  size: number;
}

export interface GithubRelease {
  id: number;
  tag_name: string;
  name: string;
  prerelease: boolean;
  body: string;
  published_at: string;
  assets: GithubAsset[];
  isLatest?: boolean;
}

export interface VersionComparison {
  isNewer: boolean;
  isSame: boolean;
  isOlder: boolean;
  currentVersion: string;
  latestVersion: string;
}

export enum UpdateStatus {
  UP_TO_DATE = 'up-to-date',
  UPDATE_AVAILABLE = 'update-available',
  OUTDATED = 'outdated',
  UNKNOWN = 'unknown'
}

@Injectable({
  providedIn: 'root'
})
export class GithubUpdateService {

  private readonly baseReleasesUrl =
    'https://api.github.com/repos/C4Wiz/ESP-Miner-NerdQAxePlus/releases';

  constructor(
    private httpClient: HttpClient
  ) { }

  /** Fetch a single page of releases */
  private fetchReleasePage(page: number, perPage = 50): Observable<GithubRelease[]> {
    const url = `${this.baseReleasesUrl}?per_page=${perPage}&page=${page}`;
    return this.httpClient.get<GithubRelease[]>(url);
  }

  /**
   * Fetch releases of ONE type (stable or prerelease) until we have
   * at least `targetCount` items or there are no more pages.
   */
  private loadReleasesOfType(
    includePrereleases: boolean,
    targetCount = 10,
    maxPages = 10,
    perPage = 50
  ): Observable<GithubRelease[]> {
    const isStable = (r: GithubRelease) =>
      !r.prerelease && !r.tag_name.includes('-rc');

    const isPre = (r: GithubRelease) =>
      r.prerelease || r.tag_name.includes('-rc');

    const matchesType = includePrereleases ? isPre : isStable;

    // start with page 1
    return this.fetchReleasePage(1, perPage).pipe(
      expand((releases, index) => {
        const nextPage = index + 2; // index starts at 0 (page 1)
        const isLastPage = releases.length < perPage;
        const reachedMaxPages = nextPage > maxPages;

        if (isLastPage || reachedMaxPages) {
          return EMPTY;
        }

        return this.fetchReleasePage(nextPage, perPage);
      }),
      // accumulate only matching releases
      scan((acc, releases) => {
        const filtered = releases.filter(matchesType);
        return acc.concat(filtered);
      }, [] as GithubRelease[]),
      // solange weiter sammeln, bis wir genug haben
      takeWhile(acc => acc.length < targetCount, true),
      // am Ende letztes akkumuliertes Array liefern
      last(),
      // auf gewünschte Anzahl begrenzen
      map(acc => acc.slice(0, targetCount))
    );
  }

  /**
   * Fetch either:
   *  - up to 10 stable releases (includePrereleases = false)
   *  - up to 10 prereleases (includePrereleases = true)
   *
   * Es werden mehrere Seiten geladen, bis genug Releases vom gewünschten Typ
   * gefunden wurden oder keine Releases mehr da sind.
   */
  public getReleases(includePrereleases = false): Observable<GithubRelease[]> {
    const latest$ = this.httpClient.get<GithubRelease>(
      `${this.baseReleasesUrl}/latest`
    );

    const selected$ = this.loadReleasesOfType(includePrereleases, 10, 10, 50);

    return selected$.pipe(
      switchMap((releases: GithubRelease[]) =>
        latest$.pipe(
          map((latest) =>
            releases.map(r => ({
              ...r,
              body: r.body || '',
              isLatest: !includePrereleases && r.id === latest.id
            }))
          )
        )
      )
    );
  }

  /**
   * Compare two semantic versions
   * Returns: 1 if v1 > v2, -1 if v1 < v2, 0 if equal
   */
  public compareVersions(v1: string, v2: string): number {
  // Remove 'v' prefix and any suffix like -OC, -rc1, etc.
  const cleanV1 = v1.replace(/^v/, '').split('-')[0];
  const cleanV2 = v2.replace(/^v/, '').split('-')[0];

  const parts1 = cleanV1.split('.').map(p => parseInt(p) || 0);
  const parts2 = cleanV2.split('.').map(p => parseInt(p) || 0);

  for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
    const p1 = parts1[i] || 0;
    const p2 = parts2[i] || 0;

    if (p1 > p2) return 1;
    if (p1 < p2) return -1;
  }

  return 0;
}

  /**
   * Compare current version with latest release
   */
  public getVersionComparison(currentVersion: string, latestRelease: GithubRelease): VersionComparison {
    const comparison = this.compareVersions(currentVersion, latestRelease.tag_name);

    return {
      isNewer: comparison > 0,
      isSame: comparison === 0,
      isOlder: comparison < 0,
      currentVersion,
      latestVersion: latestRelease.tag_name
    };
  }

  /**
   * Get update status based on version comparison
   */
  public getUpdateStatus(currentVersion: string, latestRelease: GithubRelease | null): UpdateStatus {
    if (!latestRelease) {
      return UpdateStatus.UNKNOWN;
    }

    const comparison = this.compareVersions(currentVersion, latestRelease.tag_name);

    if (comparison === 0) {
      return UpdateStatus.UP_TO_DATE;
    } else if (comparison < 0) {
      return UpdateStatus.UPDATE_AVAILABLE;
    } else {
      return UpdateStatus.OUTDATED;
    }
  }

  /**
   * Download firmware directly from GitHub
   */
  public downloadFirmware(url: string): Observable<any> {
    return this.httpClient.get(url, {
      responseType: 'blob',
      reportProgress: true,
      observe: 'events'
    });
  }

  /**
   * Get changelog formatted as HTML
   */
  public getChangelog(release: GithubRelease): string {
  if (!release.body) {
    return 'No changelog available';
  }

  let html = release.body
    // Escape HTML entities first
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    // Code blocks (before inline code)
    .replace(/```[\w]*\n?([\s\S]*?)```/g, '<pre><code>$1</code></pre>')
    // Inline code
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    // Headers (must come before bold/italic)
    .replace(/^### (.+)$/gm, '<h4>$1</h4>')
    .replace(/^## (.+)$/gm, '<h3>$1</h3>')
    .replace(/^# (.+)$/gm, '<h2>$1</h2>')
    // Bold and italic
    .replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    // Links where href is literally the word 'url' — use display text as href
    .replace(/\[([^\]]+)\]\(url\)/g, '<a href="$1" target="_blank">$1</a>')
    // Links with real URLs
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '<a href="$2" target="_blank">$1</a>')
    // Horizontal rules — any line of 3+ dashes
    .replace(/^-{3,}$/gm, '<hr>')
    // Bullet lists
    .replace(/((?:^[ \t]*[-*+] .+\n?)+)/gm, (match) => {
      const items = match.trim().split('\n').map(line =>
        `<li>${line.replace(/^[ \t]*[-*+] /, '').trim()}</li>`
      ).join('');
      return `<ul>${items}</ul>`;
    })
    // Numbered lists
    .replace(/((?:^[ \t]*\d+\. .+\n?)+)/gm, (match) => {
      const items = match.trim().split('\n').map(line =>
        `<li>${line.replace(/^[ \t]*\d+\. /, '').trim()}</li>`
      ).join('');
      return `<ol>${items}</ol>`;
    })
    // Paragraph breaks
    .replace(/\n{2,}/g, '</p><p>')
    // Single newlines become <br>
    .replace(/([^>])\n([^<])/g, '$1<br>$2');

  return `<p>${html}</p>`;
}

  /**
   * Find asset in release by filename
   */
  public findAsset(release: GithubRelease, filename: string): GithubAsset | undefined {
  // First try exact match
  const exact = release.assets.find(asset => asset.name === filename);
  if (exact) return exact;

  // Fall back to partial match (handles versioned filenames like esp-miner-factory-NerdQAxe++-v1.0.36.1-OC.bin)
  return release.assets.find(asset =>
    asset.name.toLowerCase().includes(filename.toLowerCase())
  );
}
}
