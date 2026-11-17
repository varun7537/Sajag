/**
 * Egress gate. Every request that leaves the device for the cloud must pass through
 * `prepareEgress`. It:
 *   1. builds the exact prompt text that will be sent,
 *   2. re-scans that text for identifier patterns (fail closed),
 *   3. records a receipt the user can inspect BEFORE and AFTER sending.
 *
 * Raw screenshots are never sent: the cloud client in `ai/services.ts` has no image
 * parameter, and the receipt type pins `containsImage: false`.
 */
import type { EgressReceipt, ExtractedFacts } from "../types";
import { findResidualIdentifiers } from "./masker";

export class EgressBlockedError extends Error {
  constructor(public readonly residual: string[]) {
    super(
      `Blocked: the outgoing text still looks like it contains ${residual.join(", ")}. ` +
        "Nothing was sent. Edit the masked text and try again.",
    );
    this.name = "EgressBlockedError";
  }
}

export interface CloudPayload {
  task: "verify_claims" | "explain";
  language: "en" | "hi";
  facts: ExtractedFacts;
  /** Rule ids that fired locally (no free text). */
  ruleHits: string[];
  /** Masked text, or null when the user chose to send only structured facts. */
  maskedText: string | null;
}

let counter = 0;

export function prepareEgress(
  destination: string,
  payload: CloudPayload,
  maskedCounts: Record<string, number>,
  instructions: string,
): { prompt: string; receipt: EgressReceipt } {
  const json = JSON.stringify(payload, null, 2);
  const prompt = `${instructions}\n\nDATA (JSON):\n${json}`;
  const residual = findResidualIdentifiers(prompt);
  if (residual.length > 0) {
    throw new EgressBlockedError([...new Set(residual)]);
  }
  counter += 1;
  const receipt: EgressReceipt = {
    id: `egress-${counter}`,
    at: new Date().toISOString(),
    destination,
    payload: prompt,
    bytes: new TextEncoder().encode(prompt).length,
    maskedCounts,
    containsImage: false,
  };
  return { prompt, receipt };
}
