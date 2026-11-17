import { describe, expect, it } from "vitest";
import { mergeFacts, parseFacts } from "../src/ai/schemas";
import { citationsFromChunks, isOfficialHost, parseLevelLine } from "../src/ai/verify";
import type { ExtractedFacts } from "../src/types";

describe("parseFacts", () => {
  it("coerces unknown enums and masks identifiers inside free-text fields", () => {
    const raw = JSON.stringify({
      senderClaim: "aliens",
      demands: ["send_money", "teleport", "send_money"],
      urgencyCues: ["call 9876543210 now", ""],
      promisedReturns: "yes",
      domains: ["https://www.Evil.xyz/path?x=1", "not a host", "ok.in"],
      language: "klingon",
      summary: "Asks to pay rahul@okbank within 2 hours",
      transcript: "full text",
    });
    const { facts } = parseFacts(`noise ${raw} trailing`);
    expect(facts.senderClaim).toBe("unknown");
    expect(facts.demands).toEqual(["send_money"]);
    expect(facts.urgencyCues.join(" ")).not.toMatch(/9876543210/);
    expect(facts.promisedReturns).toBe(false);
    expect(facts.domains).toEqual(["evil.xyz", "ok.in"]);
    expect(facts.language).toBe("other");
    expect(facts.summary).not.toContain("rahul@okbank");
  });

  it("throws when there is no JSON", () => {
    expect(() => parseFacts("sorry I cannot")).toThrow();
  });
});

describe("mergeFacts", () => {
  const base: ExtractedFacts = {
    senderClaim: "unknown",
    demands: [],
    urgencyCues: [],
    promisedReturns: false,
    domains: [],
    language: "other",
    summary: "",
  };
  it("keeps signals from either source", () => {
    const ai = { ...base, demands: ["send_money" as const], summary: "asks for money" };
    const h = { ...base, senderClaim: "government_agency" as const, promisedReturns: true };
    const m = mergeFacts(ai, h);
    expect(m.senderClaim).toBe("government_agency");
    expect(m.demands).toEqual(["send_money"]);
    expect(m.promisedReturns).toBe(true);
    expect(m.summary).toBe("asks for money");
  });
  it("returns heuristic facts when AI is null", () => {
    expect(mergeFacts(null, base)).toBe(base);
  });
});

describe("verification helpers", () => {
  it("extracts the LEVEL line", () => {
    expect(parseLevelLine("Looks like a scam.\nLEVEL: high")).toEqual({ body: "Looks like a scam.", level: "high" });
    expect(parseLevelLine("no level here").level).toBeUndefined();
    expect(parseLevelLine("text\n**LEVEL: medium**").level).toBe("medium");
  });
  it("recognises official hosts", () => {
    expect(isOfficialHost("cybercrime.gov.in")).toBe(true);
    expect(isOfficialHost("www.rbi.org.in")).toBe(true);
    expect(isOfficialHost("example.com")).toBe(false);
  });
  it("builds citations from grounding chunks only, official first, https only", () => {
    const c = citationsFromChunks([
      { web: { uri: "https://news.example.com/a", title: "news.example.com" } },
      { web: { uri: "http://insecure.example.com/b", title: "insecure" } },
      { web: { uri: "https://cybercrime.gov.in/x", title: "cybercrime.gov.in" } },
      { web: { uri: "https://news.example.com/a", title: "dup" } },
      {},
    ]);
    expect(c.map((x) => x.uri)).toEqual(["https://cybercrime.gov.in/x", "https://news.example.com/a"]);
    expect(c[0]?.official).toBe(true);
  });
});
