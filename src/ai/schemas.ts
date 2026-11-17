/**
 * Output schema for fact extraction, plus a defensive parser.
 *
 * On-device (Chrome Prompt API) takes a plain JSON Schema through
 * `onDeviceParams.promptOptions.responseConstraint`. The parser never trusts model output:
 * it coerces to the allowed enums and masks every free-text field again.
 */
import { maskText } from "../privacy/masker";
import type { Demand, ExtractedFacts, MessageLanguage, SenderClaim } from "../types";

export const SENDER_CLAIMS: readonly SenderClaim[] = [
  "government_agency",
  "bank",
  "broker_or_investment",
  "courier",
  "relative",
  "employer",
  "unknown",
];

export const DEMANDS: readonly Demand[] = [
  "send_money",
  "install_app",
  "share_otp",
  "stay_on_call",
  "keep_secret",
  "share_id_documents",
  "click_link",
  "join_group",
];

export const LANGUAGES: readonly MessageLanguage[] = ["en", "hi", "hinglish", "other"];

export const FACTS_JSON_SCHEMA = {
  type: "object",
  properties: {
    senderClaim: { type: "string", enum: [...SENDER_CLAIMS] },
    demands: { type: "array", items: { type: "string", enum: [...DEMANDS] } },
    urgencyCues: { type: "array", items: { type: "string" } },
    promisedReturns: { type: "boolean" },
    domains: { type: "array", items: { type: "string" } },
    language: { type: "string", enum: [...LANGUAGES] },
    summary: { type: "string" },
    transcript: { type: "string" },
  },
  required: [
    "senderClaim",
    "demands",
    "urgencyCues",
    "promisedReturns",
    "domains",
    "language",
    "summary",
    "transcript",
  ],
  additionalProperties: false,
} as const;

const HOST_RE = /^(?:[a-z0-9-]+\.)+[a-z]{2,}$/;

function pickEnum<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

function cleanString(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  return maskText(value.slice(0, max)).masked.trim();
}

export interface ParsedFacts {
  facts: ExtractedFacts;
  transcript: string;
}

/** Parses and sanitises model output. Throws when it is not valid JSON at all. */
export function parseFacts(raw: string): ParsedFacts {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("Model did not return JSON.");
  const obj = JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>;

  const demands = Array.isArray(obj["demands"])
    ? [...new Set((obj["demands"] as unknown[]).filter((d): d is Demand => (DEMANDS as readonly unknown[]).includes(d)))]
    : [];
  const urgencyCues = Array.isArray(obj["urgencyCues"])
    ? (obj["urgencyCues"] as unknown[])
        .map((c) => cleanString(c, 80))
        .filter((c) => c.length > 0)
        .slice(0, 6)
    : [];
  const domains = Array.isArray(obj["domains"])
    ? [
        ...new Set(
          (obj["domains"] as unknown[])
            .map((d) => (typeof d === "string" ? d.toLowerCase().replace(/^https?:\/\//, "").split("/")[0] ?? "" : ""))
            .map((d) => d.replace(/^www\./, ""))
            .filter((d) => HOST_RE.test(d)),
        ),
      ].slice(0, 8)
    : [];

  return {
    facts: {
      senderClaim: pickEnum(obj["senderClaim"], SENDER_CLAIMS, "unknown"),
      demands,
      urgencyCues,
      promisedReturns: obj["promisedReturns"] === true,
      domains,
      language: pickEnum(obj["language"], LANGUAGES, "other"),
      summary: cleanString(obj["summary"], 300),
    },
    transcript: typeof obj["transcript"] === "string" ? obj["transcript"].slice(0, 4000) : "",
  };
}

/** Merge AI facts with the deterministic extractor. Signals from either side are kept. */
export function mergeFacts(ai: ExtractedFacts | null, heuristic: ExtractedFacts): ExtractedFacts {
  if (!ai) return heuristic;
  return {
    senderClaim: ai.senderClaim !== "unknown" ? ai.senderClaim : heuristic.senderClaim,
    demands: [...new Set([...ai.demands, ...heuristic.demands])],
    urgencyCues: [...new Set([...ai.urgencyCues, ...heuristic.urgencyCues])].slice(0, 6),
    promisedReturns: ai.promisedReturns || heuristic.promisedReturns,
    domains: [...new Set([...ai.domains, ...heuristic.domains])],
    language: ai.language !== "other" ? ai.language : heuristic.language,
    summary: ai.summary || heuristic.summary,
  };
}
