import { GoogleAuth } from "google-auth-library";

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

type ServiceAccount = { project_id?: string; client_email?: string; private_key?: string };

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
const REQUEST_TIMEOUT_MS = 8000;

/**
 * Pengirim FCM HTTP v1 memakai google-auth-library yang sudah menjadi
 * dependensi (tanpa SDK firebase-admin tambahan). Tidak pernah melempar:
 * kegagalan jaringan atau respons tak terduga menjadi "failed".
 */
export class FcmClient implements PushSender {
  private readonly auth: GoogleAuth;

  constructor(
    private readonly projectId: string,
    credentials: ServiceAccount,
    private readonly fetchImpl: typeof fetch = fetch
  ) {
    this.auth = new GoogleAuth({ credentials, scopes: [FCM_SCOPE] });
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
