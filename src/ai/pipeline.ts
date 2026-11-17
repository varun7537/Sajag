/**
 * Orchestrates a check. Pure TypeScript: no Firebase imports, so it is unit-tested with fakes.
 *
 * Two phases, separated by a human review gate:
 *
 *   analyzeLocal()   everything here happens on the device (AI extraction runs ONLY_ON_DEVICE)
 *   -- user reviews masked text and the exact outgoing payload --
 *   verifyInCloud()  masked facts only, through the egress gate, with a receipt
 */
import { EgressBlockedError, prepareEgress, type CloudPayload } from "../privacy/egress";
import { maskText } from "../privacy/masker";
import { BUILT_IN_ADVISORIES, REPORTING } from "../rules/advisories";
import { evaluateRules, strictest } from "../rules/engine";
import { detectLanguage, heuristicExtract } from "../rules/heuristicExtract";
import type {
  Advisory,
  CheckInput,
  EgressReceipt,
  ExtractedFacts,
  RiskLevel,
  RuleHit,
  StepTrace,
  Verdict,
} from "../types";
import type { AiServices, OnDeviceState } from "./contracts";
import { EXPLAIN_INSTRUCTIONS, VERIFY_INSTRUCTIONS, languageLine } from "./prompts";
import { mergeFacts } from "./schemas";
import { parseLevelLine } from "./verify";

export class LocalModelRequiredError extends Error {
  constructor() {
    super(
      "Reading a screenshot needs the on-device model, and it is not ready on this device. " +
        "Sajag never sends screenshots to the cloud. Paste the message text instead.",
    );
    this.name = "LocalModelRequiredError";
  }
}

export interface LocalAnalysis {
  maskedText: string;
  maskedCounts: Record<string, number>;
  domains: string[];
  facts: ExtractedFacts;
  hits: RuleHit[];
  localLevel: RiskLevel;
  traces: StepTrace[];
  caveats: string[];
  onDevice: OnDeviceState;
  /** True when the message language needs the cloud for a useful check (Hindi / Hinglish). */
  needsMaskedTextForCloud: boolean;
}

const usable = (s: OnDeviceState) => s === "available";

export async function analyzeLocal(input: CheckInput, svc: AiServices): Promise<LocalAnalysis> {
  const traces: StepTrace[] = [];
  const caveats: string[] = [];
  const state = await svc.onDeviceState();

  let text = input.text.trim();
  let aiFacts: ExtractedFacts | null = null;
  const lang = detectLanguage(text);

  // ---- Step 1: extraction ----
  const t0 = performance.now();
  if (input.image) {
    if (!usable(state)) throw new LocalModelRequiredError();
    const res = await svc.extractLocal({ text, image: input.image });
    aiFacts = res.facts;
    if (res.transcript.trim()) text = res.transcript;
    traces.push({ step: "extract", route: "on_device", ms: Math.round(performance.now() - t0), note: "screenshot read locally" });
  } else if (lang === "en" && usable(state) && text.length > 0) {
    try {
      const res = await svc.extractLocal({ text });
      aiFacts = res.facts;
      traces.push({ step: "extract", route: "on_device", ms: Math.round(performance.now() - t0) });
    } catch (e) {
      caveats.push(`The on-device model failed (${(e as Error).message}); built-in rules were used instead.`);
      traces.push({ step: "extract", route: "rules_only", ms: Math.round(performance.now() - t0), note: "on-device error" });
    }
  } else {
    const why =
      lang === "hi" || lang === "hinglish"
        ? "Hindi and Hinglish are not supported by Chrome's on-device model, so built-in rules were used locally."
        : state === "no_api" || state === "unavailable"
          ? "This browser or device cannot run the on-device model, so built-in rules were used."
          : "The on-device model is not downloaded yet, so built-in rules were used.";
    caveats.push(why);
    traces.push({ step: "extract", route: "rules_only", ms: Math.round(performance.now() - t0) });
  }

  // ---- Step 2: mask (deterministic) ----
  const t1 = performance.now();
  const masked = maskText(text, input.extraMaskTerms);
  traces.push({ step: "mask", route: "rules_only", ms: Math.round(performance.now() - t1), note: "rule-based, no AI" });

  // ---- Step 3: facts + rules ----
  const t2 = performance.now();
  const heuristic = heuristicExtract(masked.masked, masked.domains);
  const facts = mergeFacts(aiFacts, heuristic);
  facts.domains = [...new Set([...facts.domains, ...masked.domains])];
  const rules = evaluateRules(facts, masked.masked);
  traces.push({ step: "rules", route: "rules_only", ms: Math.round(performance.now() - t2) });

  if (masked.counts["NAME"] === undefined) {
    caveats.push("Names and addresses are not detected automatically. Add them under 'Hide these words' before sending anything.");
  }

  return {
    maskedText: masked.masked,
    maskedCounts: masked.counts,
    domains: masked.domains,
    facts,
    hits: rules.hits,
    localLevel: rules.level,
    traces,
    caveats,
    onDevice: state,
    needsMaskedTextForCloud: lang === "hi" || lang === "hinglish",
  };
}

/**
 * Re-masks text the user edited in the review box (they may have removed or added words),
 * keeps any AI facts already extracted, and recomputes the rules.
 */
export function remask(a: LocalAnalysis, edited: string, extraTerms: string[]): LocalAnalysis {
  const masked = maskText(edited, extraTerms);
  const heuristic = heuristicExtract(masked.masked, masked.domains);
  const facts = mergeFacts(a.facts, heuristic);
  facts.domains = [...new Set([...facts.domains, ...masked.domains])];
  const rules = evaluateRules(facts, masked.masked);
  return {
    ...a,
    maskedText: masked.masked,
    maskedCounts: { ...a.maskedCounts, ...masked.counts },
    domains: masked.domains,
    facts,
    hits: rules.hits,
    localLevel: rules.level,
  };
}

export interface CloudPreview {
  prompt: string;
  receipt: EgressReceipt;
}

export interface CloudOptions {
  includeMaskedText: boolean;
  language: "en" | "hi";
}

/** Builds and gates the exact outgoing text. Throws EgressBlockedError when anything looks sensitive. */
export function previewCloud(a: LocalAnalysis, opts: CloudOptions, task: "verify_claims" | "explain" = "verify_claims"): CloudPreview {
  const payload: CloudPayload = {
    task,
    language: opts.language,
    facts: a.facts,
    ruleHits: a.hits.map((h) => h.id),
    maskedText: opts.includeMaskedText ? a.maskedText : null,
  };
  const instructions =
    task === "verify_claims"
      ? `${VERIFY_INSTRUCTIONS}\n${languageLine(opts.language)}`
      : `${EXPLAIN_INSTRUCTIONS}\n${languageLine(opts.language)}`;
  const destination =
    task === "verify_claims" ? "Firebase AI Logic → Gemini (cloud, Google Search grounding)" : "Firebase AI Logic → Gemini";
  return prepareEgress(destination, payload, a.maskedCounts, instructions);
}

export interface CloudOutcome {
  explanation: string;
  level: RiskLevel | undefined;
  citations: import("../types").Citation[];
  receipt: EgressReceipt;
  trace: StepTrace;
}

export async function verifyInCloud(preview: CloudPreview, svc: AiServices): Promise<CloudOutcome> {
  const t = performance.now();
  const res = await svc.verifyCloud(preview.prompt);
  const { body, level } = parseLevelLine(res.text);
  return {
    explanation: body,
    level,
    citations: res.citations,
    receipt: preview.receipt,
    trace: { step: "verify", route: res.source, ms: Math.round(performance.now() - t), note: "grounded, masked facts only" },
  };
}

export interface ExplainOutcome {
  text: string;
  route: "on_device" | "cloud";
  /** Present only when the call actually left the device. */
  receipt: EgressReceipt | null;
  trace: StepTrace;
}

/**
 * "Explain in simple words". English: PREFER_ON_DEVICE (local when the model is ready).
 * Hindi: cloud only, because the on-device model cannot write Hindi.
 * The prompt is gated and a receipt is built BEFORE the call; the receipt is kept only if the
 * SDK reports the call ran in the cloud.
 */
export async function explainSimply(
  a: LocalAnalysis,
  language: "en" | "hi",
  allowCloud: boolean,
  svc: AiServices,
): Promise<ExplainOutcome | null> {
  const state = await svc.onDeviceState();
  const canGoLocal = language === "en" && state === "available";
  if (!canGoLocal && !allowCloud) return null;
  const preview = previewCloud(a, { includeMaskedText: false, language }, "explain");
  const t = performance.now();
  const res = await svc.explain(preview.prompt, language);
  const route = res.source === "on_device" ? "on_device" : "cloud";
  return {
    text: parseLevelLine(res.text).body,
    route,
    receipt: route === "cloud" ? preview.receipt : null,
    trace: { step: "explain", route, ms: Math.round(performance.now() - t), note: route === "on_device" ? "kept on device" : "masked facts only" },
  };
}

/** Advisories that apply to the rules that fired. */
export function advisoriesFor(hits: RuleHit[], all: Advisory[] = BUILT_IN_ADVISORIES): Advisory[] {
  const ids = new Set(hits.map((h) => h.advisoryId).filter((x): x is string => !!x));
  return all.filter((a) => ids.has(a.id));
}

export function nextStepsFor(level: RiskLevel): string[] {
  const common = [
    "Do not send money, OTPs, PINs or ID documents because of this message.",
    "Look up the organisation's official number yourself and call it. Do not use numbers or links from the message.",
    `If money is already lost or you are being pressured right now, call ${REPORTING.helpline} or report at ${REPORTING.portal.replace("https://", "")}.`,
  ];
  if (level === "high") return ["Stop. End the call or stop replying.", ...common, "Tell a family member now. Scammers rely on you staying alone."];
  if (level === "medium") return [...common, "Show this message to someone you trust before acting."];
  return ["No strong scam signs were found, but that does not make a message safe.", ...common.slice(1)];
}

export function buildVerdict(
  a: LocalAnalysis,
  cloud: CloudOutcome | null,
  advisories: Advisory[] = BUILT_IN_ADVISORIES,
): Verdict {
  const level = strictest(a.localLevel, cloud?.level);
  const explanation = cloud
    ? cloud.explanation
    : a.hits.length > 0
      ? a.hits.map((h) => `• ${h.label}. ${h.why}`).join("\n")
      : "No built-in warning signs matched. This is not a guarantee: check the sender through an official channel.";
  const caveats = [...a.caveats];
  if (!cloud) caveats.push("Not verified against official sources: the cloud check was not used.");
  if (cloud && cloud.citations.length === 0) {
    caveats.push("The cloud check returned no sources, so its explanation is not independently cited.");
  }
  return {
    level,
    reasons: a.hits,
    facts: a.facts,
    explanation,
    citations: cloud?.citations ?? [],
    advisories: advisoriesFor(a.hits, advisories),
    nextSteps: nextStepsFor(level),
    traces: cloud ? [...a.traces, cloud.trace] : a.traces,
    receipts: cloud ? [cloud.receipt] : [],
    caveats,
  };
}

export { EgressBlockedError };
