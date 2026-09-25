import { createSign } from "node:crypto";

export type PushMessage = {
  title: string;
  body: string;
  /** Data tambahan untuk navigasi di aplikasi. Nilai wajib string (aturan FCM). */
  data?: Record<string, string>;
};

/** `invalid_token`: token sudah tidak berlaku dan harus dihapus. */
export type PushSendResult = "sent" | "invalid_token" | "failed";

export interface PushSender {
  send(token: string, message: PushMessage): Promise<PushSendResult>;
}

type ServiceAccount = {
  project_id?: string;
  client_email?: string;
  private_key?: string;
  token_uri?: string;
};

/** Menerima JSON mentah atau base64-nya. Mengembalikan null bila tidak valid. */
export function parseServiceAccount(raw: string | undefined): ServiceAccount | null {
  const value = raw?.trim();
  if (!value) return null;
  const candidates = [value, Buffer.from(value, "base64").toString("utf8")];
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as ServiceAccount;
      if (parsed.client_email && parsed.private_key) return parsed;
    } catch {
      // coba kandidat berikutnya
    }
  }
  return null;
}

const FCM_SCOPE = "https://www.googleapis.com/auth/firebase.messaging";
const DEFAULT_TOKEN_URI = "https://oauth2.googleapis.com/token";
const REQUEST_TIMEOUT_MS = 8000;

const base64url = (input: Buffer | string) => Buffer.from(input).toString("base64url");

/**
 * Token akses OAuth2 dari service account (alur JWT-bearer Google), memakai
 * node:crypto saja. Sengaja tanpa google-auth-library: pustaka itu menuntut
 * Node 22+, sedangkan proyek ini menyatakan Node 20+. Token disimpan sampai
 * hampir kedaluwarsa. Tidak pernah mencatat kunci atau token.
 */
export class ServiceAccountTokenProvider {
  private cached: { token: string; expiresAtMs: number } | null = null;

  constructor(
    private readonly account: ServiceAccount,
    private readonly scope: string,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly now: () => number = Date.now
  ) {}

  async getAccessToken(): Promise<string | null> {
    if (this.cached && this.cached.expiresAtMs - 60_000 > this.now()) {
      return this.cached.token;
    }
    const tokenUri = this.account.token_uri ?? DEFAULT_TOKEN_URI;
    const issuedAt = Math.floor(this.now() / 1000);
    const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
    const claims = base64url(
      JSON.stringify({
        iss: this.account.client_email,
        scope: this.scope,
        aud: tokenUri,
        iat: issuedAt,
        exp: issuedAt + 3600
      })
    );
    const signature = createSign("RSA-SHA256")
      .update(`${header}.${claims}`)
      .sign(this.account.private_key!)
      .toString("base64url");

    const response = await this.fetchImpl(tokenUri, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion: `${header}.${claims}.${signature}`
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });
    if (!response.ok) return null;
    const payload = (await response.json()) as { access_token?: string; expires_in?: number };
    if (!payload.access_token) return null;
    this.cached = {
      token: payload.access_token,
      expiresAtMs: this.now() + (payload.expires_in ?? 3600) * 1000
    };
    return payload.access_token;
  }
}

/**
 * Pengirim FCM HTTP v1 memakai google-auth-library yang sudah menjadi
 * dependensi (tanpa SDK firebase-admin tambahan). Tidak pernah melempar:
 * kegagalan jaringan atau respons tak terduga menjadi "failed".
 */
export class FcmClient implements PushSender {
  private readonly auth: { getAccessToken(): Promise<string | null> };

  constructor(
    private readonly projectId: string,
    credentials: ServiceAccount,
    private readonly fetchImpl: typeof fetch = fetch
  ) {
    this.auth = new ServiceAccountTokenProvider(credentials, FCM_SCOPE, fetchImpl);
  }

  async send(token: string, message: PushMessage): Promise<PushSendResult> {
    try {
      const accessToken = await this.auth.getAccessToken();
      if (!accessToken) return "failed";
      const response = await this.fetchImpl(
        `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(this.projectId)}/messages:send`,
        {
          method: "POST",
          headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
          body: JSON.stringify({
            message: {
              token,
              notification: { title: message.title, body: message.body },
              ...(message.data ? { data: message.data } : {}),
              android: { priority: "HIGH", notification: { channel_id: "tapgo_default" } }
            }
          }),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
        }
      );
      if (response.ok) return "sent";
      // 404 UNREGISTERED / 400 INVALID_ARGUMENT untuk token: token mati.
      if (response.status === 404) return "invalid_token";
      if (response.status === 400) {
        const payload = (await response.json().catch(() => ({}))) as {
          error?: { details?: Array<{ errorCode?: string }> };
        };
        const code = payload.error?.details?.find((d) => d.errorCode)?.errorCode;
        if (code === "INVALID_ARGUMENT" || code === "UNREGISTERED") return "invalid_token";
      }
      return "failed";
    } catch {
      return "failed";
    }
  }
}
