import { randomUUID } from "node:crypto";

export function logExchangeFailure(stage: string, error: unknown) {
  const reference = randomUUID();
  const code = typeof error === "object" && error !== null && "code" in error
    && typeof error.code === "string" && /^P\d{4}$/.test(error.code) ? error.code : undefined;
  // Neither exception messages/stacks nor request payloads belong in this log.
  console.error("[exchange]", { reference, stage, code });
  return reference;
}
