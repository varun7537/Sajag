/**
 * Deterministic, rule-based masker. This is the privacy boundary for anything that may
 * leave the device. It is deliberately NOT an AI model: it is fast, explainable, testable
 * and works when no on-device model exists.
 *
 * Known limits (also shown to the user):
 *  - Personal names and street addresses are not detected automatically. The user can add
 *    extra terms, and reviews the masked text before anything is sent.
 *  - Identifiers written in unusual ways (spelled-out digits, obfuscation) can be missed.
 */
import { luhnValid, verhoeffValid } from "./verhoeff";

export interface MaskResult {
  masked: string;
  /** Hostnames found in links (kept, because domain checks need them). */
  domains: string[];
  counts: Record<string, number>;
}

const DEVANAGARI_ZERO = 0x0966;

/** Converts Devanagari digits to ASCII so identifier patterns also match Hindi text. 1:1 length. */
export function normalizeDigits(input: string): string {
  let out = "";
  for (const ch of input) {
    const code = ch.codePointAt(0)!;
    if (code >= DEVANAGARI_ZERO && code <= DEVANAGARI_ZERO + 9) {
      out += String(code - DEVANAGARI_ZERO);
    } else if (code >= 0xff10 && code <= 0xff19) {
      out += String(code - 0xff10); // full-width digits
    } else {
      out += ch;
    }
  }
  return out;
}

class Placeholders {
  private seen = new Map<string, string>();
  private perType = new Map<string, number>();
  counts: Record<string, number> = {};

  get(type: string, value: string): string {
    const key = `${type}:${value}`;
    const existing = this.seen.get(key);
    if (existing) {
      this.counts[type] = (this.counts[type] ?? 0) + 1;
      return existing;
    }
    const n = (this.perType.get(type) ?? 0) + 1;
    this.perType.set(type, n);
    const ph = `[${type}_${n}]`;
    this.seen.set(key, ph);
    this.counts[type] = (this.counts[type] ?? 0) + 1;
    return ph;
  }
}

const URL_RE = /\b(?:https?:\/\/|www\.)[^\s<>"')\]]+/gi;
const BARE_DOMAIN_RE =
  /\b(?:[a-z0-9-]+\.)+(?:com|in|net|org|co|xyz|top|click|icu|vip|online|site|live|info|me|app|link|cc|ly|gl|to|ws)(?:\/[^\s<>"')\]]*)?/gi;
const EMAIL_RE = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const UPI_RE = /\b[a-z0-9._-]{2,}@[a-z][a-z0-9]{1,}\b/gi;
const AADHAAR_RE = /(?<!\d)[2-9]\d{3}[\s-]?\d{4}[\s-]?\d{4}(?!\d)/g;
const PAN_RE = /\b[A-Z]{5}[0-9]{4}[A-Z]\b/g;
const IFSC_RE = /\b[A-Z]{4}0[A-Z0-9]{6}\b/g;
const PHONE_RE = /(?<![\d])(?:(?:\+|00)?91[\s-]?)?0?[6-9]\d{4}[\s-]?\d{5}(?!\d)/g;
const LONG_NUMBER_RE = /(?<!\d)(?:\d[\s-]?){8,18}\d(?!\d)/g;
const OTP_RE = /\b(otp|one[- ]time (?:password|code)|verification code|pin|cvv|cvc)(\D{0,24}?)(\d{3,8})(?!\d)/gi;
/** A 4-8 digit code that sits near a code-like word, in either order ("551809 is your login code"). */
const CODE_NEAR_LABEL_RE =
  /(?<!\d)(?<!(?:rs\.?|₹|inr)\s{0,2})(\d{4,8})(?!\d)(?=[^\n]{0,40}\b(?:otp|login code|verification code|security code|passcode|one[- ]time|code|pin|cvv|cvc)\b)/gi;

const SHORTENER_HOSTS = new Set([
  "bit.ly",
  "tinyurl.com",
  "t.co",
  "goo.gl",
  "cutt.ly",
  "rb.gy",
  "is.gd",
  "shorturl.at",
  "wa.me",
  "t.me",
]);

function hostOf(raw: string): string | null {
  try {
    const withScheme = /^https?:\/\//i.test(raw) ? raw : `http://${raw}`;
    const u = new URL(withScheme);
    return u.hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function isShortener(host: string): boolean {
  return SHORTENER_HOSTS.has(host);
}

/**
 * Masks identifiers in `input`. Order matters: more specific patterns first so a UPI id is
 * not mistaken for an email, and a 12-digit Aadhaar is not mistaken for a phone number.
 */
export function maskText(input: string, extraTerms: string[] = []): MaskResult {
  const ph = new Placeholders();
  const domains: string[] = [];
  let text = normalizeDigits(input);

  // 1. Links: keep only the hostname.
  text = text.replace(URL_RE, (m) => {
    const host = hostOf(m);
    if (!host) return ph.get("LINK", m);
    if (!domains.includes(host)) domains.push(host);
    ph.counts["LINK"] = (ph.counts["LINK"] ?? 0) + 1;
    return `[LINK ${host}]`;
  });

  // 2. Emails, then UPI ids (an email has a dot after the @, a UPI handle does not).
  text = text.replace(EMAIL_RE, (m) => ph.get("EMAIL", m.toLowerCase()));
  text = text.replace(UPI_RE, (m) => ph.get("UPI", m.toLowerCase()));

  // 3. Bare domains (not already inside a [LINK ...] placeholder).
  text = text.replace(BARE_DOMAIN_RE, (m, offset: number, whole: string) => {
    const before = whole.slice(Math.max(0, offset - 6), offset);
    if (before.endsWith("[LINK ")) return m;
    const host = hostOf(m);
    if (!host) return m;
    if (!domains.includes(host)) domains.push(host);
    ph.counts["LINK"] = (ph.counts["LINK"] ?? 0) + 1;
    return `[LINK ${host}]`;
  });

  // 4. One-time codes: keep the label, hide the digits.
  text = text.replace(OTP_RE, (_m, label: string, gap: string) => {
    ph.counts["OTP"] = (ph.counts["OTP"] ?? 0) + 1;
    return `${label}${gap}[OTP]`;
  });

  text = text.replace(CODE_NEAR_LABEL_RE, () => {
    ph.counts["OTP"] = (ph.counts["OTP"] ?? 0) + 1;
    return "[OTP]";
  });

  // 5. Aadhaar (checksum-validated), then phones, then cards, then other long numbers.
  text = text.replace(AADHAAR_RE, (m) => {
    const digits = m.replace(/\D/g, "");
    return verhoeffValid(digits) ? ph.get("AADHAAR", digits) : m;
  });
  text = text.replace(PHONE_RE, (m) => ph.get("PHONE", m.replace(/\D/g, "").slice(-10)));
  text = text.replace(LONG_NUMBER_RE, (m) => {
    const digits = m.replace(/\D/g, "");
    if (luhnValid(digits)) return ph.get("CARD", digits);
    return ph.get("ACCOUNT", digits);
  });

  // 6. PAN and IFSC.
  text = text.replace(PAN_RE, (m) => ph.get("PAN", m));
  text = text.replace(IFSC_RE, (m) => ph.get("IFSC", m));

  // 7. User-supplied terms (names, places). Case-insensitive, whole-substring.
  for (const raw of extraTerms) {
    const term = raw.trim();
    if (term.length < 2) continue;
    const re = new RegExp(escapeRegExp(term), "gi");
    text = text.replace(re, () => ph.get("NAME", term.toLowerCase()));
  }

  return { masked: text, domains, counts: ph.counts };
}

/**
 * Last line of defence: scans text that is about to leave the device and reports any
 * identifier pattern still present. Used by the egress gate to fail closed.
 */
export function findResidualIdentifiers(text: string): string[] {
  const t = normalizeDigits(text);
  const found: string[] = [];
  const test = (re: RegExp, name: string, validate?: (m: string) => boolean) => {
    const r = new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`);
    for (const m of t.matchAll(r)) {
      if (!validate || validate(m[0])) {
        found.push(name);
        return;
      }
    }
  };
  test(EMAIL_RE, "EMAIL");
  test(UPI_RE, "UPI", (m) => !/^\[/.test(m));
  test(AADHAAR_RE, "AADHAAR", (m) => verhoeffValid(m.replace(/\D/g, "")));
  test(PHONE_RE, "PHONE");
  test(LONG_NUMBER_RE, "LONG_NUMBER");
  test(PAN_RE, "PAN");
  test(IFSC_RE, "IFSC");
  test(OTP_RE, "OTP", (m) => /\d{3,8}\s*$/.test(m));
  test(CODE_NEAR_LABEL_RE, "OTP");
  // Full URLs with path/query must never leave: only hostnames are allowed.
  for (const m of t.matchAll(/https?:\/\/[^\s]+/gi)) {
    found.push("FULL_URL");
    void m;
    break;
  }
  return found;
}
