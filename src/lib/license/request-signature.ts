import crypto from "node:crypto";

export function bodyHashOf(rawBody: string): string {
  return crypto.createHash("sha256").update(rawBody).digest("hex");
}

export function signRequest(input: {
  secret: string;
  method: string;
  path: string;
  timestamp: string;
  nonce: string;
  bodyHash: string;
}): string {
  const canonical = [
    input.method.toUpperCase(),
    input.path,
    input.timestamp,
    input.nonce,
    input.bodyHash,
  ].join("\n");
  return crypto.createHmac("sha256", input.secret).update(canonical).digest("hex");
}

