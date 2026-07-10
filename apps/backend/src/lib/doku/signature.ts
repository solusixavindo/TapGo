import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { DokuConfig } from "./types.js";

type SignInput = {
  clientId: string;
  secretKey: string;
  requestTarget: string;
  body?: unknown;
  requestId?: string;
  requestTimestamp?: string;
};

type VerifyInput = {
  clientId: string;
  secretKey: string;
  requestTarget: string;
  body?: unknown;
  signature: string;
  requestId: string;
  requestTimestamp: string;
};

export function createDokuRequestId(prefix = "tapgo") {
  return `${prefix}-${randomUUID()}`;
}

export function createDokuTimestamp(date = new Date()) {
  return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}

export function minifyJson(value: unknown) {
  if (typeof value === "string") {
    return value;
  }
  return JSON.stringify(value ?? {});
}

export function createDigest(body: unknown) {
  return createHash("sha256").update(minifyJson(body)).digest("base64");
}

export function createSignatureComponent(input: {
  clientId: string;
  requestId: string;
  requestTimestamp: string;
  requestTarget: string;
  digest: string;
}) {
  return [
    `Client-Id:${input.clientId}`,
    `Request-Id:${input.requestId}`,
    `Request-Timestamp:${input.requestTimestamp}`,
    `Request-Target:${input.requestTarget}`,
    `Digest:${input.digest}`,
  ].join("\n");
}

export function signDokuRequest(input: SignInput) {
  const requestId = input.requestId ?? createDokuRequestId();
  const requestTimestamp = input.requestTimestamp ?? createDokuTimestamp();
  const digest = createDigest(input.body);
  const component = createSignatureComponent({
    clientId: input.clientId,
    requestId,
    requestTimestamp,
    requestTarget: input.requestTarget,
    digest,
  });
  const hmac = createHmac("sha256", input.secretKey)
    .update(component)
    .digest("base64");

  return {
    requestId,
    requestTimestamp,
    digest,
    signature: `HMACSHA256=${hmac}`,
    component,
  };
}

export function verifyDokuSignature(input: VerifyInput) {
  const expected = signDokuRequest({
    clientId: input.clientId,
    secretKey: input.secretKey,
    requestTarget: input.requestTarget,
    body: input.body,
    requestId: input.requestId,
    requestTimestamp: input.requestTimestamp,
  }).signature;

  const actualBuffer = Buffer.from(input.signature);
  const expectedBuffer = Buffer.from(expected);
  return (
    actualBuffer.length === expectedBuffer.length &&
    timingSafeEqual(actualBuffer, expectedBuffer)
  );
}

export function dokuHeadersFor(
  config: DokuConfig,
  requestTarget: string,
  body: unknown,
) {
  const signed = signDokuRequest({
    clientId: config.clientId,
    secretKey: config.secretKey,
    requestTarget,
    body,
  });

  return {
    "Client-Id": config.clientId,
    "Request-Id": signed.requestId,
    "Request-Timestamp": signed.requestTimestamp,
    "Request-Target": requestTarget,
    Digest: signed.digest,
    Signature: signed.signature,
  };
}
