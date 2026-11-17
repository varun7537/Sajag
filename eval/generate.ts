/**
 * Generates eval/dataset.json: a deterministic, SYNTHETIC labelled message set.
 *
 * Every message is written by us from templates. None is copied from a real victim or a real
 * sender, and all identifiers (phones, UPI ids, Aadhaar-shaped numbers, names) are fabricated.
 * Each item records the identifiers it plants so the leakage test can check they never leave.
 *
 * Run: npm run eval:gen
 */
import { writeFileSync } from "node:fs";
import { verhoeffCheckDigit } from "../src/privacy/verhoeff";

// Small seeded PRNG so the file is reproducible.
let seed = 20261114;
const rnd = () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};
const pick = <T>(a: readonly T[]): T => a[Math.floor(rnd() * a.length)]!;
const digits = (n: number, first?: string) => {
  let s = first ?? String(1 + Math.floor(rnd() * 9));
  while (s.length < n) s += Math.floor(rnd() * 10);
  return s;
};

const NAMES = ["Rajesh Kumar", "Anita Verma", "Sandeep Rao", "Meera Iyer", "Vikram Singh", "Pooja Nair"];
const phone = () => digits(10, pick(["6", "7", "8", "9"]));
const upi = () => `${pick(["rahul", "anita", "sam", "meera", "vik"])}${Math.floor(rnd() * 90 + 10)}@${pick(["okaxis", "oksbi", "ybl", "paytm"])}`;
const aadhaar = () => {
  const p = digits(11, pick(["2", "3", "4", "5", "6", "7"]));
  return p + verhoeffCheckDigit(p);
};
const pan = () => `${pick(["ABCDE", "PQRST", "LMNOP"])}${digits(4)}${pick(["F", "K", "Q"])}`;
const badLink = () => pick(["https://cbi-verify.top/case?id=", "https://secure-kyc-update.xyz/login?s=", "https://tradeprofit.vip/join?ref=", "https://bit.ly/3"]) + digits(6);

export type Label = "scam" | "benign";
export interface Item {
  id: string;
  label: Label;
  category: string;
  lang: "en" | "hinglish" | "hi";
  synthetic: true;
  text: string;
  /** Raw planted identifiers that must never appear in any outgoing payload. */
  seeds: string[];
}

const items: Item[] = [];
let n = 0;
function add(label: Label, category: string, lang: Item["lang"], build: () => { text: string; seeds: string[] }) {
  const { text, seeds } = build();
  n += 1;
  items.push({ id: `S${String(n).padStart(3, "0")}`, label, category, lang, synthetic: true, text, seeds });
}

// ---------- SCAM templates ----------
for (let i = 0; i < 6; i++)
  add("scam", "digital_arrest", "en", () => {
    const name = pick(NAMES), ph = phone(), a = aadhaar(), amt = pick(["50,000", "1,20,000", "2,75,000"]);
    return {
      text: `This is Inspector ${name} from the CBI cyber cell. A parcel booked with your Aadhaar ${a} contains illegal items. You are under digital arrest. Stay on this video call and do not tell anyone, not even family. Transfer Rs ${amt} immediately to the verification account to avoid arrest. Call ${ph} if you disconnect.`,
      seeds: [name, ph, a],
    };
  });
for (let i = 0; i < 4; i++)
  add("scam", "digital_arrest", "hinglish", () => {
    const ph = phone(), u = upi();
    return {
      text: `Aap ke naam par ek parcel mila hai jisme drugs hain. CBI officer aap se video call par baat karenge. Digital arrest se bachna hai to turant paisa transfer kijiye ${u} par. Kisi ko mat batana aur call mat kaatna. Contact ${ph}.`,
      seeds: [ph, u],
    };
  });
for (let i = 0; i < 3; i++)
  add("scam", "digital_arrest", "hi", () => {
    const ph = phone();
    const dev = ph.replace(/\d/g, (d) => String.fromCharCode(0x0966 + Number(d)));
    return {
      text: `आप डिजिटल अरेस्ट में हैं। सीबीआई अधिकारी वीडियो कॉल पर हैं। गिरफ्तारी से बचने के लिए तुरंत जुर्माना ट्रांसफर करें। किसी को न बताएं। संपर्क ${dev}`,
      seeds: [ph, dev],
    };
  });
for (let i = 0; i < 6; i++)
  add("scam", "investment_group", "en", () => {
    const l = badLink(), ph = phone();
    return {
      text: `Join our VIP WhatsApp group for stock trading signals. Guaranteed ${pick(["3", "5", "8"])}% daily profit with our SEBI-style mentor. Invest Rs 10,000 today, withdraw double in a week. Click ${l} or message ${ph}.`,
      seeds: [l, ph],
    };
  });
for (let i = 0; i < 4; i++)
  add("scam", "investment_group", "hinglish", () => {
    const l = badLink(), u = upi();
    return {
      text: `Hamare trading group me judiye. Guaranteed return milega, rozana profit 5%. Pehle Rs 5000 deposit karo ${u} par. Link: ${l}`,
      seeds: [l, u],
    };
  });
for (let i = 0; i < 8; i++)
  add("scam", "bank_kyc_otp", "en", () => {
    const ph = phone(), l = badLink(), otp = digits(6);
    return {
      text: `Your bank account will be blocked today due to incomplete KYC. Share the OTP ${otp} you receive and update PAN ${pan()} at ${l} immediately. Helpline ${ph}.`,
      seeds: [ph, l, otp],
    };
  });
for (let i = 0; i < 4; i++)
  add("scam", "bank_kyc_otp", "hinglish", () => {
    const ph = phone(), l = badLink();
    return {
      text: `Aapka bank khata band ho jayega. KYC update karne ke liye turant OTP bataiye aur ${l} par click kijiye. Call ${ph}.`,
      seeds: [ph, l],
    };
  });
for (let i = 0; i < 5; i++)
  add("scam", "courier_customs", "en", () => {
    const l = badLink(), ph = phone();
    return {
      text: `Your courier parcel is held by customs. Pay a clearance fee of Rs ${pick(["1,850", "3,200"])} within 24 hours at ${l} or legal action will start. Contact ${ph}.`,
      seeds: [l, ph],
    };
  });
for (let i = 0; i < 5; i++)
  add("scam", "task_job", "en", () => {
    const ph = phone(), u = upi();
    return {
      text: `Part-time work from home. Earn Rs 3000 daily by completing simple tasks. Join our Telegram group, pay a refundable deposit of Rs 2000 to ${u}. Message ${ph}.`,
      seeds: [ph, u],
    };
  });
for (let i = 0; i < 4; i++)
  add("scam", "fake_app", "en", () => {
    const ph = phone();
    return {
      text: `Your electricity will be disconnected tonight. Download the support app (apk) and install AnyDesk so our agent can fix your bill. Call ${ph} urgently.`,
      seeds: [ph],
    };
  });
for (let i = 0; i < 3; i++)
  add("scam", "relative_emergency", "hinglish", () => {
    const ph = phone(), u = upi();
    return {
      text: `Papa, mera accident ho gaya hai, ye naya number hai ${ph}. Hospital me turant Rs 25000 bhejiye ${u} par. Kisi ko mat batana.`,
      seeds: [ph, u],
    };
  });

// ---------- BENIGN templates (including deliberately tricky ones) ----------
for (let i = 0; i < 10; i++)
  add("benign", "friend_chat", "en", () => {
    const name = pick(NAMES);
    return { text: `Hey ${name}, are we still on for lunch tomorrow at 1? I'll bring the notes from class and we can plan the trip.`, seeds: [name] };
  });
for (let i = 0; i < 6; i++)
  add("benign", "otp_delivery", "en", () => {
    const otp = digits(6);
    return { text: `${otp} is your login code. Do not share this OTP with anyone. Valid for 10 minutes.`, seeds: [otp] };
  });
for (let i = 0; i < 8; i++)
  add("benign", "bank_alert", "en", () => {
    const acc = digits(12);
    return {
      text: `Rs ${pick(["1,250", "560", "12,400"])} debited from account ending ${acc.slice(-4)} on ${pick(["12-Nov", "03-Nov"])}. If not you, call the number on the back of your card.`,
      seeds: [],
    };
  });
for (let i = 0; i < 7; i++)
  add("benign", "delivery_update", "en", () => ({
    text: `Your order has shipped and will arrive on Friday. Track it in the app. Thank you for shopping with us.`,
    seeds: [],
  }));
for (let i = 0; i < 5; i++)
  add("benign", "family_hinglish", "hinglish", () => {
    const ph = phone();
    return { text: `Mummy, main shaam ko 7 baje tak ghar aa jaunga. Dinner mat banana, bahar kha lenge. Call me on ${ph} if needed.`, seeds: [ph] };
  });
for (let i = 0; i < 4; i++)
  add("benign", "bill_reminder", "en", () => ({
    text: `Reminder: your electricity bill of Rs ${pick(["1,250", "890"])} is due on the 20th. You can pay in the official app or at the office counter.`,
    seeds: [],
  }));
for (let i = 0; i < 4; i++)
  add("benign", "hindi_notice", "hi", () => ({
    text: `कल स्कूल में अभिभावक बैठक सुबह दस बजे होगी। कृपया समय पर पहुँचें।`,
    seeds: [],
  }));
for (let i = 0; i < 4; i++)
  add("benign", "work_message", "en", () => ({
    text: `Team, the quarterly review is moved to Thursday 3 pm. Please share your slides in the team folder before the meeting.`,
    seeds: [],
  }));

// ---------- HARD slice: hand-written paraphrases without the obvious trigger words ----------
// These are deliberately phrased differently from the templates above. Expect the rule engine
// to miss several scams and wrongly flag a few genuine messages; that is the point of the slice.
const HARD_SCAM: Array<[string, Item["lang"], string]> = [
  ["hard_laundering", "en", "Sir, your Aadhaar linked number is named in a money laundering case registered in Mumbai. A senior officer will connect on WhatsApp video now. Please keep this matter private until the inquiry closes."],
  ["hard_prize", "en", "Congratulations! You are selected for a bonus of Rs 8,000. To claim, send a small processing charge of Rs 199 to the UPI id shown below."],
  ["hard_romance_invest", "en", "I made good money on this platform my uncle runs. Try with just Rs 2000 first, I will guide you step by step. Withdrawals are instant, I promise."],
  ["hard_sim", "en", "Dear customer your SIM will be deactivated today after verification failure. Reply YES to speak to our executive."],
  ["hard_loan", "en", "Instant loan up to Rs 5 lakh, no documents needed. Pay Rs 3,000 insurance first and the amount is released in 10 minutes."],
  ["hard_hinglish_power", "hinglish", "Sir aapka bijli connection aaj raat kat jayega. Neeche diye number par sampark karein aur bill update karwayein."],
  ["hard_spelled_digits", "en", "Kindly send fifty thousand rupees to the safe custody account, number nine eight seven six five four three two one zero, to close your case."],
  ["hard_hindi_pin", "hi", "आपके खाते से संदिग्ध लेन-देन हुआ है। अपना कार्ड नंबर और पिन हमें बताएं ताकि हम खाता सुरक्षित कर सकें।"],
  ["hard_qr_refund", "en", "To receive your refund, scan this QR code and enter your UPI PIN to confirm."],
  ["hard_tech_support", "en", "Warning: your computer has a virus. Call our technician immediately and allow remote access so we can remove it."],
];
const HARD_BENIGN: Array<[string, Item["lang"], string]> = [
  ["hard_bank_branch", "en", "Dear customer, please visit your home branch with ID proof to complete KYC before 31 Dec. Ignore this message if already done."],
  ["hard_police_complaint", "en", "Your lost property complaint has been registered at the local police station. Please visit between 10 am and 5 pm with an ID."],
  ["hard_salary", "en", "Salary of Rs 45,000 credited to your account. Available balance Rs 52,300."],
  ["hard_friend_money", "hinglish", "Bhai can you send Rs 500 on UPI for the cab? Will return it tonight."],
  ["hard_sip", "en", "Your SIP of Rs 5,000 will be debited on the 5th. Please maintain sufficient balance."],
  ["hard_delivery_otp", "en", "Your delivery partner is at the door. Share the OTP 4821 with him to receive the parcel."],
  ["hard_real_interview", "en", "Interview scheduled for Monday 11 am. Bring your resume and ID proof. No fee is charged at any stage of hiring."],
  ["hard_tuition_fee", "en", "Reminder: tuition fee of Rs 3,000 is due by the 10th. You can pay at the school office. Thank you."],
];
for (const [cat, lang, text] of HARD_SCAM) add("scam", cat, lang, () => ({ text, seeds: [] }));
for (const [cat, lang, text] of HARD_BENIGN) add("benign", cat, lang, () => ({ text, seeds: [] }));

writeFileSync(new URL("./dataset.json", import.meta.url), JSON.stringify(items, null, 2) + "\n");
const scam = items.filter((i) => i.label === "scam").length;
console.log(`Wrote ${items.length} synthetic items (${scam} scam, ${items.length - scam} benign).`);
