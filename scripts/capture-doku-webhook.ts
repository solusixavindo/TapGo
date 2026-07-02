import { createServer } from "node:http";
import { mkdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";

const port = Number(process.env.PORT ?? process.env.DOKU_CAPTURE_PORT ?? 5055);
const outputDir =
  process.env.DOKU_CAPTURE_DIR ?? "doku-webhook-captures";

const sensitiveKeys = [
  "authorization",
  "signature",
  "token",
  "secret",
  "api-key",
  "apikey",
  "client-secret",
  "private-key",
  "x-api-key",
];

function isSensitiveKey(key: string) {
  const normalized = key.toLowerCase().replaceAll("_", "-");
  return sensitiveKeys.some((sensitive) => normalized.includes(sensitive));
}

function redact(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(redact);
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [
        key,
        isSensitiveKey(key) ? "[REDACTED]" : redact(item),
      ]),
    );
  }

  return value;
}

function safeJson(raw: string) {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return { rawBodyPreview: raw.slice(0, 2000) };
  }
}

const server = createServer(async (req, res) => {
  if (req.method !== "POST") {
    res.writeHead(405, { "content-type": "application/json" });
    res.end(JSON.stringify({ success: false, message: "Use POST" }));
    return;
  }

  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  const rawBody = Buffer.concat(chunks).toString("utf8");
  const receivedAt = new Date().toISOString();
  const safePayload = {
    receivedAt,
    method: req.method,
    url: req.url,
    headers: redact(req.headers),
    body: redact(safeJson(rawBody)),
    rawBodyLength: Buffer.byteLength(rawBody),
  };

  await mkdir(outputDir, { recursive: true });
  const fileName = `doku-webhook-${receivedAt.replace(/[:.]/g, "-")}-${randomUUID()}.json`;
  const filePath = join(outputDir, fileName);
  await writeFile(filePath, JSON.stringify(safePayload, null, 2), "utf8");

  res.writeHead(200, { "content-type": "application/json" });
  res.end(
    JSON.stringify({
      success: true,
      message: "Sanitized DOKU webhook payload captured",
      file: filePath,
    }),
  );
});

server.listen(port, () => {
  console.log(`Safe DOKU webhook capture server listening on http://127.0.0.1:${port}`);
  console.log(`Output directory: ${outputDir}`);
  console.log("Secrets, signatures, tokens, and API keys are redacted before writing.");
});
