/** Shared domain types for Sajag. */

export type SenderClaim =
  | "government_agency"
  | "bank"
  | "broker_or_investment"
  | "courier"
  | "relative"
  | "employer"
  | "unknown";

export type Demand =
  | "send_money"
  | "install_app"
  | "share_otp"
  | "stay_on_call"
  | "keep_secret"
  | "share_id_documents"
  | "click_link"
  | "join_group";

export type MessageLanguage = "en" | "hi" | "hinglish" | "other";

/** Structured facts extracted from a message. Never contains raw identifiers after masking. */
export interface ExtractedFacts {
  senderClaim: SenderClaim;
  demands: Demand[];
  urgencyCues: string[];
  promisedReturns: boolean;
  /** Hostnames only (no path, no query). */
  domains: string[];
  language: MessageLanguage;
  /** One neutral sentence describing what the message asks. No names or numbers. */
  summary: string;
}

export type RiskLevel = "high" | "medium" | "low" | "unclear";

export interface RuleHit {
  id: string;
  label: string;
  weight: number;
  critical: boolean;
  /** Plain-language explanation for the user. */
  why: string;
  advisoryId?: string;
}

export interface Advisory {
  id: string;
  title: string;
  text: string;
  sourceUrl: string;
  sourceName: string;
  /** ISO date the page was last read by the project team. */
  verifiedOn: string;
}

export interface Citation {
  title: string;
  uri: string;
  /** True when the host is a known Indian government or regulator domain. */
  official: boolean;
}

/** Where a step actually ran. */
export type Route = "on_device" | "cloud" | "rules_only";

export interface StepTrace {
  step: "extract" | "mask" | "rules" | "verify" | "explain";
  route: Route;
  ms: number;
  note?: string;
}

export interface MaskedItem {
  type: string;
  placeholder: string;
}

export interface EgressReceipt {
  id: string;
  at: string;
  destination: string;
  /** The exact JSON string sent over the network (prompt text). */
  payload: string;
  bytes: number;
  maskedCounts: Record<string, number>;
  /** True when an image was attached. Sajag never sends images to the cloud. */
  containsImage: false;
}

export interface Verdict {
  level: RiskLevel;
  reasons: RuleHit[];
  facts: ExtractedFacts | null;
  explanation: string;
  citations: Citation[];
  advisories: Advisory[];
  nextSteps: string[];
  traces: StepTrace[];
  receipts: EgressReceipt[];
  /** Human-readable limitations that apply to this particular check. */
  caveats: string[];
}

export interface CheckInput {
  text: string;
  image?: { mimeType: "image/jpeg" | "image/png"; base64: string };
  /** Words the user wants hidden in addition to automatic masking (names, etc.). */
  extraMaskTerms: string[];
  allowCloud: boolean;
}
