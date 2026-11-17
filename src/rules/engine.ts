/**
 * Explainable rule engine. Gives a baseline verdict with no AI and no network, and
 * every hit carries a plain-language reason a worried person can understand.
 */
import { isShortener } from "../privacy/masker";
import type { ExtractedFacts, RiskLevel, RuleHit } from "../types";

interface Rule {
  id: string;
  label: string;
  weight: number;
  critical?: boolean;
  advisoryId?: string;
  why: string;
  test: (f: ExtractedFacts, text: string) => boolean;
}

const SUSPICIOUS_TLDS = new Set(["xyz", "top", "click", "icu", "vip", "online", "site", "live", "link", "cc", "ws"]);

function suspiciousDomain(host: string): boolean {
  if (isShortener(host)) return true;
  const tld = host.split(".").pop() ?? "";
  return SUSPICIOUS_TLDS.has(tld);
}

export const RULES: Rule[] = [
  {
    id: "AGENCY_VIDEO_ARREST",
    label: "Claims to be a government agency and applies pressure",
    weight: 6,
    critical: true,
    advisoryId: "i4c-video-arrest",
    why:
      "Real agencies such as the CBI, ED, police and customs do not arrest people or collect money over a video call or message. " +
      "This pattern is called 'digital arrest' and it is a scam.",
    test: (f, t) =>
      f.senderClaim === "government_agency" &&
      (f.demands.includes("stay_on_call") ||
        f.demands.includes("send_money") ||
        /digital arrest|video call|skype|डिजिटल अरेस्ट|वीडियो कॉल/i.test(t)),
  },
  {
    id: "OTP_REQUEST",
    label: "Asks for an OTP, PIN or CVV",
    weight: 4,
    why: "Nobody genuine needs your OTP, PIN or CVV. Banks and agencies never ask for them by message or call.",
    test: (f) => f.demands.includes("share_otp"),
  },
  {
    id: "PAY_UNDER_PRESSURE",
    label: "Demands money with a deadline or threat",
    weight: 3,
    why: "Scammers create panic so you pay before you think. A real fine or fee does not need payment within minutes.",
    test: (f) => f.demands.includes("send_money") && f.urgencyCues.length > 0,
  },
  {
    id: "ISOLATION",
    label: "Tells you to stay on the call or keep it secret",
    weight: 3,
    why: "Being told to stay on the line or not tell family is how scammers stop you from getting a second opinion.",
    test: (f) => f.demands.includes("stay_on_call") || f.demands.includes("keep_secret"),
  },
  {
    id: "GUARANTEED_RETURNS",
    label: "Promises guaranteed or unusually high returns",
    weight: 4,
    why: "No genuine investment can guarantee returns. Fixed daily or monthly profit promises are a hallmark of investment fraud.",
    test: (f) => f.promisedReturns,
  },
  {
    id: "INVEST_GROUP",
    label: "Invites you to an investment group",
    weight: 2,
    why: "Investment scams often start in a WhatsApp or Telegram group where fake members show fake profits.",
    test: (f) => f.senderClaim === "broker_or_investment" && f.demands.includes("join_group"),
  },
  {
    id: "INSTALL_APP",
    label: "Asks you to install an app or screen-sharing tool",
    weight: 3,
    why: "Apps sent through links, or remote-access tools, can read your messages and bank apps.",
    test: (f) => f.demands.includes("install_app"),
  },
  {
    id: "SUSPICIOUS_LINK",
    label: "Link uses a shortener or an unusual domain",
    weight: 2,
    why: "Shortened or unusual links hide where they really go. Do not open them from an unexpected message.",
    test: (f) => f.domains.some(suspiciousDomain),
  },
  {
    id: "ID_DOCUMENTS",
    label: "Asks for ID documents",
    weight: 2,
    why: "Sending Aadhaar, PAN or passport copies to an unverified sender can lead to identity theft.",
    test: (f) => f.demands.includes("share_id_documents") && f.senderClaim !== "bank",
  },
  {
    id: "JOB_DEPOSIT",
    label: "A job or task offer asks you to pay money first",
    weight: 4,
    why: "Genuine employers do not ask you to pay a deposit or fee to start work. 'Task' and part-time job scams collect small payments that grow.",
    test: (f) => f.senderClaim === "employer" && f.demands.includes("send_money"),
  },
  {
    id: "COURIER_PAYMENT",
    label: "Parcel or customs message asking for payment",
    weight: 3,
    why: "A fake 'parcel held by customs' message is a common way to start a digital-arrest scam.",
    test: (f) => f.senderClaim === "courier" && f.demands.includes("send_money"),
  },
];

export interface RuleResult {
  hits: RuleHit[];
  score: number;
  level: RiskLevel;
}

export function evaluateRules(facts: ExtractedFacts, maskedText: string): RuleResult {
  const hits: RuleHit[] = RULES.filter((r) => r.test(facts, maskedText)).map((r) => ({
    id: r.id,
    label: r.label,
    weight: r.weight,
    critical: !!r.critical,
    why: r.why,
    ...(r.advisoryId ? { advisoryId: r.advisoryId } : {}),
  }));
  const score = hits.reduce((s, h) => s + h.weight, 0);
  let level: RiskLevel;
  if (maskedText.trim().length === 0) level = "unclear";
  else if (hits.some((h) => h.critical) || score >= 5) level = "high";
  else if (score >= 3) level = "medium";
  else level = "low";
  return { hits, score, level };
}

/** Combines the rule level with an optional AI opinion; the stricter level wins. */
export function strictest(a: RiskLevel, b: RiskLevel | undefined): RiskLevel {
  if (!b) return a;
  const order: RiskLevel[] = ["unclear", "low", "medium", "high"];
  return order.indexOf(a) >= order.indexOf(b) ? a : b;
}
