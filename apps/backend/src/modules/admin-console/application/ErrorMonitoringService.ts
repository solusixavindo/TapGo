export type SentryIssue = {
  id: string;
  shortId: string;
  title: string;
  culprit: string | null;
  level: string;
  status: string;
  count: string;
  userCount: number;
  firstSeen: string;
  lastSeen: string;
  permalink: string;
};

/** Tiga aplikasi TapGo, tiga project Sentry terpisah — sengaja tidak berbagi satu project. */
export type SentryProjectKey = "backend" | "driver_app" | "user_app";

export const SENTRY_PROJECT_LABEL: Record<SentryProjectKey, string> = {
  backend: "Backend",
  driver_app: "Driver App",
  user_app: "User App"
};

export type ErrorMonitoringReport =
  | { configured: false; configuredProjects: SentryProjectKey[] }
  | { configured: true; configuredProjects: SentryProjectKey[]; issues: SentryIssue[]; fetchedAt: string };

export type ErrorMonitoringConfig = {
  authToken: string | undefined;
  orgSlug: string | undefined;
  apiBaseUrl: string;
  projectSlugs: Record<SentryProjectKey, string | undefined>;
};

/**
 * Menarik issue Sentry terbaru ke konsol admin lewat backend (bukan
 * langsung dari browser admin) — SENTRY_AUTH_TOKEN tidak pernah dikirim ke
 * klien. Fail-closed per project: tanpa token+org+project slug terisi untuk
 * project yang diminta, endpoint melapor "belum dikonfigurasi" alih-alih
 * memanggil Sentry dengan nilai yang salah/kosong.
 *
 * Config diterima lewat constructor (bukan membaca env langsung) supaya
 * kelas ini murni dan mudah diuji unit tanpa proses ulang env.ts.
 */
export class ErrorMonitoringService {
  constructor(private readonly config: ErrorMonitoringConfig) {}

  /** Project yang punya slug terisi — dipakai admin console untuk menampilkan tab mana saja. */
  configuredProjects(): SentryProjectKey[] {
    return (Object.keys(this.config.projectSlugs) as SentryProjectKey[]).filter(
      (key) => Boolean(this.config.projectSlugs[key])
    );
  }

  isConfigured(project: SentryProjectKey): boolean {
    return Boolean(this.config.authToken && this.config.orgSlug && this.config.projectSlugs[project]);
  }

  async recentIssues(
    project: SentryProjectKey,
    params: { statsPeriod?: "24h" | "14d"; query?: string } = {}
  ): Promise<ErrorMonitoringReport> {
    const configuredProjects = this.configuredProjects();
    if (!this.isConfigured(project)) {
      return { configured: false, configuredProjects };
    }

    const projectSlug = this.config.projectSlugs[project]!;
    const query = new URLSearchParams({
      query: params.query ?? "is:unresolved",
      statsPeriod: params.statsPeriod ?? "24h",
      sort: "freq",
      limit: "25"
    });
    const url = `${this.config.apiBaseUrl}/projects/${this.config.orgSlug}/${projectSlug}/issues/?${query.toString()}`;

    const response = await fetch(url, {
      headers: { authorization: `Bearer ${this.config.authToken}` }
    });
    if (!response.ok) {
      throw new Error(`Sentry API mengembalikan status ${response.status}`);
    }
    const raw = (await response.json()) as SentryIssue[];
    const issues: SentryIssue[] = raw.map((issue) => ({
      id: issue.id,
      shortId: issue.shortId,
      title: issue.title,
      culprit: issue.culprit,
      level: issue.level,
      status: issue.status,
      count: issue.count,
      userCount: issue.userCount,
      firstSeen: issue.firstSeen,
      lastSeen: issue.lastSeen,
      permalink: issue.permalink
    }));

    return { configured: true, configuredProjects, issues, fetchedAt: new Date().toISOString() };
  }
}
