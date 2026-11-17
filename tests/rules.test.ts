import { describe, expect, it } from "vitest";
import { evaluateRules } from "../src/rules/engine";
import { detectLanguage, heuristicExtract } from "../src/rules/heuristicExtract";
import { maskText } from "../src/privacy/masker";

function check(text: string) {
  const m = maskText(text);
  const facts = heuristicExtract(m.masked, m.domains);
  return { facts, ...evaluateRules(facts, m.masked) };
}

describe("rule engine on synthetic messages", () => {
  it("flags a digital-arrest style message as high with the agency rule", () => {
    const r = check(
      "This is Officer from the CBI cyber cell. A parcel in your name has narcotics. You are under digital arrest. " +
        "Stay on the video call and do not tell anyone. Transfer Rs 50,000 immediately to avoid arrest.",
    );
    expect(r.level).toBe("high");
    expect(r.hits.map((h) => h.id)).toContain("AGENCY_VIDEO_ARREST");
    expect(r.hits.find((h) => h.id === "AGENCY_VIDEO_ARREST")?.advisoryId).toBe("i4c-video-arrest");
  });

  it("flags a Hinglish digital-arrest message", () => {
    const r = check(
      "Aap CBI ke video call par hain. Digital arrest se bachne ke liye turant paisa transfer kijiye. Kisi ko mat batana, call mat kaatna.",
    );
    expect(r.level).toBe("high");
  });

  it("flags a Hindi (Devanagari) message", () => {
    const r = check("आप डिजिटल अरेस्ट में हैं। सीबीआई अधिकारी वीडियो कॉल पर हैं। तुरंत ५०,००० रुपये ट्रांसफर करें।");
    expect(r.level).toBe("high");
  });

  it("flags guaranteed-return investment group invitations", () => {
    const r = check(
      "Join our VIP WhatsApp group for stock trading tips. Guaranteed 5% daily profit. Click https://tradeprofit.top/join",
    );
    expect(r.hits.map((h) => h.id)).toEqual(expect.arrayContaining(["GUARANTEED_RETURNS", "SUSPICIOUS_LINK"]));
    expect(["medium", "high"]).toContain(r.level);
  });

  it("flags an OTP request", () => {
    const r = check("Your bank account will be blocked today. Share the OTP 554433 to verify KYC.");
    expect(r.hits.map((h) => h.id)).toContain("OTP_REQUEST");
  });

  it("does not flag a genuine OTP delivery message that says not to share it", () => {
    const r = check("Your OTP for login is 482913. Do not share it with anyone. Valid for 10 minutes.");
    expect(r.hits.map((h) => h.id)).not.toContain("OTP_REQUEST");
    expect(r.level).toBe("low");
  });

  it("does not flag 'do not share this OTP with anyone'", () => {
    const r = check("482913 is your login code. Do not share this OTP with anyone. Valid for 10 minutes.");
    expect(r.hits).toEqual([]);
  });

  it("flags a Hinglish OTP request (code before verb)", () => {
    const r = check("Aapka khata band ho jayega. KYC ke liye turant OTP bataiye.");
    expect(r.hits.map((h) => h.id)).toContain("OTP_REQUEST");
  });

  it("flags a job offer that asks for a deposit", () => {
    const r = check("Part-time work from home. Earn Rs 3000 daily. Pay a refundable deposit of Rs 2000 to start.");
    expect(r.hits.map((h) => h.id)).toContain("JOB_DEPOSIT");
    expect(["medium", "high"]).toContain(r.level);
  });

  it("does not flag an ordinary message", () => {
    const r = check("Hey, are we still meeting for lunch tomorrow at 1? I'll bring the notes.");
    expect(r.hits).toEqual([]);
    expect(r.level).toBe("low");
  });

  it("returns unclear for empty input", () => {
    expect(check("   ").level).toBe("unclear");
  });
});

describe("detectLanguage", () => {
  it("detects English, Hindi and Hinglish", () => {
    expect(detectLanguage("Please call the bank today")).toBe("en");
    expect(detectLanguage("आपका खाता बंद हो जाएगा")).toBe("hi");
    expect(detectLanguage("Aap turant paisa bhejiye")).toBe("hinglish");
    expect(detectLanguage("आपका account block हो गया है click here now please")).toBe("hinglish");
  });
});
