import { describe, expect, it } from "vitest";
import { findResidualIdentifiers, maskText, normalizeDigits } from "../src/privacy/masker";
import { luhnValid, verhoeffCheckDigit, verhoeffValid } from "../src/privacy/verhoeff";

const validAadhaar = () => {
  const payload = "23456789012";
  return payload + verhoeffCheckDigit(payload);
};

describe("checksums", () => {
  it("matches the published Verhoeff example", () => {
    expect(verhoeffCheckDigit("236")).toBe("3");
    expect(verhoeffValid("2363")).toBe(true);
    expect(verhoeffValid("2364")).toBe(false);
  });
  it("round-trips a generated Aadhaar-shaped number", () => {
    expect(verhoeffValid(validAadhaar())).toBe(true);
  });
  it("validates Luhn", () => {
    expect(luhnValid("4111111111111111")).toBe(true);
    expect(luhnValid("4111111111111112")).toBe(false);
  });
});

describe("maskText", () => {
  it("masks Indian mobile numbers in several formats", () => {
    for (const n of ["9876543210", "+91 98765 43210", "+91-9876543210", "098765 43210", "91 9876543210"]) {
      const r = maskText(`Call ${n} now`);
      expect(r.masked, n).toContain("[PHONE_1]");
      expect(r.masked, n).not.toMatch(/\d{5}/);
    }
  });

  it("masks a checksum-valid Aadhaar and labels it AADHAAR", () => {
    const a = validAadhaar();
    const spaced = `${a.slice(0, 4)} ${a.slice(4, 8)} ${a.slice(8)}`;
    const r = maskText(`My aadhaar is ${spaced}`);
    expect(r.masked).toContain("[AADHAAR_1]");
    expect(r.masked).not.toContain(a.slice(0, 4));
  });

  it("treats a 12-digit number that fails the checksum as a generic account number", () => {
    const good = validAadhaar();
    const bad = good.slice(0, 11) + String((Number(good[11]) + 1) % 10);
    expect(verhoeffValid(bad)).toBe(false);
    const r = maskText(`ref ${bad}`);
    expect(r.masked).toContain("[ACCOUNT_1]");
    expect(r.masked).not.toContain("[AADHAAR_1]");
  });

  it("masks cards, PAN and IFSC", () => {
    const r = maskText("card 4111 1111 1111 1111 PAN ABCDE1234F ifsc HDFC0001234 IFSC SBIN0004567");
    expect(r.masked).toContain("[CARD_1]");
    expect(r.masked).toContain("[PAN_1]");
    expect(r.masked).toContain("[IFSC_1]");
  });

  it("distinguishes UPI ids from emails", () => {
    const r = maskText("pay to rahul.k@okbank or mail rahul@example.com");
    expect(r.masked).toContain("[UPI_1]");
    expect(r.masked).toContain("[EMAIL_1]");
  });

  it("keeps only the hostname of links and records the domain", () => {
    const r = maskText("Open https://secure-sbi-login.xyz/verify?token=abc123&uid=88 and bit.ly/3xYz");
    expect(r.masked).toContain("[LINK secure-sbi-login.xyz]");
    expect(r.masked).not.toContain("token=");
    expect(r.domains).toContain("secure-sbi-login.xyz");
    expect(r.domains).toContain("bit.ly");
  });

  it("hides OTP digits but keeps the label", () => {
    const r = maskText("Your OTP is 482913. Share the verification code: 7731");
    expect(r.masked).not.toMatch(/482913|7731/);
    expect(r.masked).toContain("[OTP]");
  });

  it("hides a code that comes BEFORE its label, but not money amounts", () => {
    const r = maskText("551809 is your login code. Do not share it. Pay Rs 50000 with code BLUE.");
    expect(r.masked).not.toContain("551809");
    expect(r.masked).toContain("[OTP] is your login code");
    expect(r.masked).toContain("Rs 50000");
  });

  it("masks identifiers written with Devanagari digits", () => {
    const hindi = "इस नंबर पर कॉल करें ९८७६५४३२१०";
    expect(normalizeDigits(hindi)).toContain("9876543210");
    const r = maskText(hindi);
    expect(r.masked).toContain("[PHONE_1]");
    expect(r.masked).not.toMatch(/[०-९]/);
  });

  it("masks user-supplied terms case-insensitively", () => {
    const r = maskText("Officer Rajesh Kumar says RAJESH KUMAR will arrest you", ["Rajesh Kumar"]);
    expect(r.masked).not.toMatch(/rajesh/i);
    expect(r.counts["NAME"]).toBe(2);
  });

  it("reuses the same placeholder for the same value", () => {
    const r = maskText("9876543210 and again 98765 43210");
    expect(r.masked.match(/\[PHONE_1\]/g)?.length).toBe(2);
    expect(r.masked).not.toContain("[PHONE_2]");
  });
});

describe("findResidualIdentifiers", () => {
  it("is empty for fully masked text", () => {
    const r = maskText("Call 9876543210, UPI rahul@okbank, https://evil.xyz/a?b=1, OTP 123456");
    expect(findResidualIdentifiers(r.masked)).toEqual([]);
  });
  it("catches raw identifiers", () => {
    expect(findResidualIdentifiers("call 9876543210")).toContain("PHONE");
    expect(findResidualIdentifiers("mail a@b.com")).toContain("EMAIL");
    expect(findResidualIdentifiers("https://x.com/path?a=1")).toContain("FULL_URL");
  });
});
