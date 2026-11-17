/**
 * Deterministic fallback extractor. Produces the same `ExtractedFacts` shape as the AI
 * extractor, from keywords in English, Hindi (Devanagari) and common Hinglish.
 *
 * Roles:
 *   1. The "rules only" arm of the evaluation (a baseline the AI must beat).
 *   2. The offline / no-model path: Sajag still gives a baseline verdict.
 *   3. A cross-check merged with AI output, so one weak model answer cannot hide a clear signal.
 */
import type { Demand, ExtractedFacts, MessageLanguage, SenderClaim } from "../types";

const has = (re: RegExp, s: string) => re.test(s);

export function detectLanguage(text: string): MessageLanguage {
  const deva = (text.match(/[ऀ-ॿ]/g) ?? []).length;
  const latin = (text.match(/[A-Za-z]/g) ?? []).length;
  if (deva === 0) {
    const hinglish =
      /\b(aap|aapka|aapke|kripya|turant|jaldi|paisa|paise|khata|band ho|hai|nahi|karo|kijiye|bhejiye|lagao)\b/i;
    return hinglish.test(text) ? "hinglish" : latin > 0 ? "en" : "other";
  }
  const total = deva + latin;
  if (total === 0) return "other";
  return deva / total > 0.6 ? "hi" : "hinglish";
}

const URGENCY: Array<[RegExp, string]> = [
  [/\b(immediately|urgent(?:ly)?|right now|asap)\b/i, "immediately / urgent"],
  [/within\s+\d+\s*(?:hours?|hrs?|minutes?|mins?|days?)/i, "deadline within hours"],
  [/\b(last chance|final notice|today only|expires?)\b/i, "last chance"],
  [/\b(arrest(?:ed)?|warrant|legal action|case (?:filed|registered)|jail|fir)\b/i, "arrest / legal threat"],
  [/\b(blocked|suspended|frozen|deactivated|disconnected)\b/i, "account blocked"],
  [/(तुरंत|अभी|जल्दी|गिरफ्तार|वारंट)/, "तुरंत / गिरफ्तारी"],
  [/\b(turant|abhi|jaldi)\b/i, "turant / abhi"],
];

export function heuristicExtract(maskedText: string, domains: string[]): ExtractedFacts {
  const t = maskedText;
  const demands = new Set<Demand>();

  if (
    has(/(transfer|pay|send|deposit|remit|settle).{0,50}(₹|rs\.?|inr|rupees?|amount|money|fine|fee|charges?|penalty|\[ACCOUNT_|\[UPI_)/i, t) ||
    has(/(₹|rs\.?)\s?\d/i, t) ||
    has(/(पैसे|जमा|ट्रांसफर|भुगतान|जुर्माना)/, t) ||
    has(/\b(paisa|paise)\b.{0,20}\b(bhej|transfer|jama)/i, t)
  )
    demands.add("send_money");
  if (has(/(install|download).{0,30}(app|apk|application)|\.apk\b|anydesk|teamviewer|quicksupport|screen ?share/i, t))
    demands.add("install_app");
  // Asking you to hand over a code is a demand. A genuine message that DELIVERS a code and
  // tells you not to share it must not trigger this.
  const asksForCode =
    /(share|send|tell|give|forward|read ?out|provide|enter|bataiye|batao|bhejiye|bhejo|बताएं|बताइए|शेयर|भेजें).{0,40}(otp|one[- ]time (password|code)|verification code|\bpin\b|\bcvv\b|ओटीपी)/i;
  const negated = /(do not|don'?t|dont|never|not to|mat |कभी न|न करें|साझा न).{0,25}(share|tell|give|disclose|bata|शेयर|बताएं)/i;
  const codeThenVerb =
    /(otp|one[- ]time (password|code)|verification code|ओटीपी)\W{0,3}.{0,15}\b(bataiye|batao|bhejiye|bhejo|share|send|tell|बताएं|बताइए|भेजें)/i;
  if ((asksForCode.test(t) || codeThenVerb.test(t)) && !negated.test(t)) demands.add("share_otp");
  if (
    has(/(stay|remain|keep).{0,25}(on )?(the )?(call|line|video)|(do not|don'?t|mat|na)\s*(disconnect|cut|hang)|camera (on|chalu)|कॉल\s*(पर बने|मत काट|न काट)/i, t)
  )
    demands.add("stay_on_call");
  if (
    has(/(do not|don'?t|never|mat|na)\b.{0,30}(tell|inform|disclose|bata)\b.{0,30}(anyone|family|others|bank|kisi)|(do not|don'?t|never)\b.{0,20}share\s+(?:this|the case|case|this matter|this call|this information)(?!\s+(?:otp|code|password|pin|cvv))|confidential|secret|किसी को (न|मत) बता/i, t)
  )
    demands.add("keep_secret");
  if (has(/\[AADHAAR_|\[PAN_|aadhaar|pan card|passport|आधार|kyc|documents? (verification|required)/i, t))
    demands.add("share_id_documents");
  if (has(/\[LINK |click (the |this )?link|लिंक/i, t)) demands.add("click_link");
  if (has(/(join|add).{0,30}(whatsapp|telegram|group|channel)|ग्रुप|टेलीग्राम|\bvip\b/i, t)) demands.add("join_group");

  let senderClaim: SenderClaim = "unknown";
  if (
    has(/\b(cbi|enforcement directorate|police|cyber ?(crime|cell)|customs|narcotics|ncb|trai|court|judge|income tax|supreme court)\b/i, t) ||
    has(/\bED\b/, t) ||
    has(/(सीबीआई|पुलिस|कस्टम|ईडी|कोर्ट|न्यायाधीश)/, t)
  )
    senderClaim = "government_agency";
  else if (has(/(invest|trading|stock|ipo|forex|crypto|profit|signal|broker|sebi|mutual fund|निवेश|मुनाफा)/i, t))
    senderClaim = "broker_or_investment";
  else if (has(/(courier|parcel|fedex|dhl|package)/i, t)) senderClaim = "courier";
  else if (has(/\b(bank|sbi|hdfc|icici|axis|credit card|debit card|kyc)\b|बैंक/i, t)) senderClaim = "bank";
  else if (has(/(job offer|work from home|part[- ]time|daily task|hr team)/i, t)) senderClaim = "employer";
  else if (has(/\b(mom|dad|papa|mummy|beta|bhaiya|new number|accident|hospital)\b/i, t)) senderClaim = "relative";

  const urgencyCues = URGENCY.filter(([re]) => re.test(t)).map(([, label]) => label);

  const promisedReturns =
    has(/(guaranteed|assured|sure|fixed).{0,25}(returns?|profit|income)/i, t) ||
    has(/\d+\s?%.{0,25}(daily|weekly|monthly|per (day|week|month)|returns?|profit)/i, t) ||
    has(/double (your )?(money|investment)|daily (profit|income|earning)/i, t) ||
    has(/earn\s+(rs\.?|₹)\s?[\d,]+\s*(daily|per day|a day|every day|weekly)/i, t) ||
    has(/(रोज|हर दिन).{0,15}(कमाई|मुनाफा)|गारंटी/, t);

  return {
    senderClaim,
    demands: [...demands],
    urgencyCues,
    promisedReturns,
    domains,
    language: detectLanguage(t),
    summary: "",
  };
}
