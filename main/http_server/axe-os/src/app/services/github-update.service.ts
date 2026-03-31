import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

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

interface R2ReleasesJson {
  updated_at: string;
  releases: R2Release[];
}

interface R2Release {
  version: string;
  name: string;
  sha256: string;
  prerelease: boolean;
  published_at: string;
  body?: string;
  assets: {
    name: string;
    browser_download_url: string;
  }[];
}

@Injectable({
  providedIn: 'root'
})
export class GithubUpdateService {

  private readonly r2ReleasesUrl =
    'https://pub-f8ed8218b3b94a659b581f81c298b179.r2.dev/releases.json';

  constructor(
    private httpClient: HttpClient
  ) { }

  /**
   * Fetch releases from R2 instead of GitHub API.
   * Returns up to 10 releases of the selected type.
   */
  public getReleases(includePrereleases = false): Observable<GithubRelease[]> {
    return this.httpClient.get<R2ReleasesJson>(this.r2ReleasesUrl).pipe(
      map(data => {
        const filtered = includePrereleases
          ? data.releases.filter(r => r.prerelease)
          : data.releases.filter(r => !r.prerelease);

        const sliced = filtered.slice(0, 10);

        // Mark the first entry as latest
        return sliced.map((r, index) => ({
          id: 0,
          tag_name: r.version,
          name: r.name,
          prerelease: r.prerelease,
          body: r.body || undefined as any,
          published_at: r.published_at || '',
          isLatest: index === 0,
          assets: r.assets.map(a => ({
            id: 0,
            name: a.name,
            browser_download_url: a.browser_download_url,
            size: 0
          }))
        }));
      })
    );
  }

  /**
   * Compare two version strings.
   * Returns: 1 if v1 > v2, -1 if v1 < v2, 0 if equal.
   * Strips leading 'v' and suffixes like -OC, -wip-OC.
   * Supports release format (1.0.37.1) and pre-release format (1.0.37_dev6).
   * Dev versions sort below their corresponding release (1.0.37_dev6 < 1.0.37.1).
   */
  public compareVersions(v1: string, v2: string): number {
    // Strip leading 'v' and trailing suffixes like -OC, -wip-OC, -rc1
    const clean = (v: string) => v.replace(/^v/, '').replace(/-OC$/i, '').replace(/-wip.*$/i, '');

    const c1 = clean(v1);
    const c2 = clean(v2);

    // Detect dev versions: contain underscore e.g. 1.0.37_dev6
    const DEV_RE = /^(\d+\.\d+\.\d+)_dev(\d+)$/;
    const m1 = c1.match(DEV_RE);
    const m2 = c2.match(DEV_RE);

    // If both are dev versions of the same base, compare dev number
    if (m1 && m2 && m1[1] === m2[1]) {
        return Math.sign(parseInt(m1[2]) - parseInt(m2[2]));
    }

    // Dev version is always older than its corresponding release
    // e.g. 1.0.37_dev6 < 1.0.37.1
    const base1 = m1 ? m1[1] : c1;
    const base2 = m2 ? m2[1] : c2;

    const parts1 = base1.split('.').map(p => parseInt(p) || 0);
    const parts2 = base2.split('.').map(p => parseInt(p) || 0);

    for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
        const p1 = parts1[i] || 0;
        const p2 = parts2[i] || 0;
        if (p1 > p2) return 1;
        if (p1 < p2) return -1;
    }

    // Same base: dev version is older than release
    if (m1 && !m2) return -1;
    if (!m1 && m2) return 1;

    return 0;
}

  /**
   * Compare current version with latest release.
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
   * Get update status based on version comparison.
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
   * Download firmware directly from URL.
   */
  public downloadFirmware(url: string): Observable<any> {
    return this.httpClient.get(url, {
      responseType: 'blob',
      reportProgress: true,
      observe: 'events'
    });
  }

  /**
   * Convert release body markdown to HTML.
   */
  public getChangelog(release: GithubRelease): string {
    if (!release.body) {
      return 'No changelog available';
    }

    let html = release.body
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/```[\w]*\n?([\s\S]*?)```/g, '<pre><code>$1</code></pre>')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/^### (.+)$/gm, '<h4>$1</h4>')
      .replace(/^## (.+)$/gm, '<h3>$1</h3>')
      .replace(/^# (.+)$/gm, '<h2>$1</h2>')
      .replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/\[([^\]]+)\]\(url\)/g, '<a href="$1" target="_blank">$1</a>')
      .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '<a href="$2" target="_blank">$1</a>')
      .replace(/^-{3,}$/gm, '<hr>')
      .replace(/((?:^[ \t]*[-*+] .+\n?)+)/gm, (match) => {
        const items = match.trim().split('\n').map(line =>
          `<li>${line.replace(/^[ \t]*[-*+] /, '').trim()}</li>`
        ).join('');
        return `<ul>${items}</ul>`;
      })
      .replace(/((?:^[ \t]*\d+\. .+\n?)+)/gm, (match) => {
        const items = match.trim().split('\n').map(line =>
          `<li>${line.replace(/^[ \t]*\d+\. /, '').trim()}</li>`
        ).join('');
        return `<ol>${items}</ol>`;
      })
      .replace(/(<hr>)\n*/g, '$1')
      .replace(/\n*(<hr>)/g, '$1')
      .replace(/\n{2,}/g, '</p><p>')
      .replace(/([^>])\n([^<])/g, '$1<br>$2');

    return `<div>${html}</div>`;
  }

  /**
   * Find asset in release by filename.
   * Tries exact match first, falls back to case-insensitive partial match.
   */
  public findAsset(release: GithubRelease, filename: string): GithubAsset | undefined {
    const exact = release.assets.find(asset => asset.name === filename);
    if (exact) return exact;

    return release.assets.find(asset =>
      asset.name.toLowerCase().includes(filename.toLowerCase())
    );
  }
}
