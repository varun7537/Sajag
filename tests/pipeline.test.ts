import { describe, expect, it } from "vitest";
import {
  analyzeLocal,
  buildVerdict,
  LocalModelRequiredError,
  previewCloud,
  verifyInCloud,
} from "../src/ai/pipeline";
import type { AiServices, OnDeviceState } from "../src/ai/contracts";
import { EgressBlockedError, prepareEgress } from "../src/privacy/egress";
import { findResidualIdentifiers } from "../src/privacy/masker";
import { verhoeffCheckDigit } from "../src/privacy/verhoeff";
import type { CheckInput, ExtractedFacts } from "../src/types";

const aadhaar = (() => {
  const p = "34567890123";
  return p + verhoeffCheckDigit(p);
})();

/** Raw identifiers we plant in every message. None may appear in any outgoing prompt. */
const SEEDS = ["9876543210", "rahul.sharma@okaxis", aadhaar, "ABCDE1234F", "4111111111111111", "Rajesh Kumar", "559900"];

const SCAM_TEXT =
  `This is Rajesh Kumar from CBI cyber cell. You are under digital arrest. Stay on the video call. ` +
  `Call 98765 43210 or pay to rahul.sharma@okaxis within 2 hours. Aadhaar ${aadhaar}, PAN ABCDE1234F, ` +
  `card 4111 1111 1111 1111. Your OTP is 559900. Details: https://cbi-verify.top/case?id=77&token=secret9`;

interface Spy {
  svc: AiServices;
  sentToCloud: string[];
  localInputs: string[];
}

function makeSpy(state: OnDeviceState, ai?: Partial<ExtractedFacts>): Spy {
  const sentToCloud: string[] = [];
  const localInputs: string[] = [];
  const svc: AiServices = {
    onDeviceState: async () => state,
    prepareOnDevice: async () => {},
    extractLocal: async (input) => {
      localInputs.push(input.text);
      return {
        facts: {
          senderClaim: "government_agency",
          demands: ["send_money", "stay_on_call"],
          urgencyCues: ["within 2 hours"],
          promisedReturns: false,
          domains: ["cbi-verify.top"],
          language: "en",
          summary: "Claims to be an agency and demands payment.",
          ...ai,
        },
        transcript: input.text,
      };
    },
    verifyCloud: async (prompt) => {
      sentToCloud.push(prompt);
      return {
        text: "This matches the digital arrest pattern.\nLEVEL: high",
        source: "cloud",
        citations: [{ title: "cybercrime.gov.in", uri: "https://cybercrime.gov.in/x", official: true }],
      };
    },
    explain: async (prompt) => {
      sentToCloud.push(prompt);
      return { text: "ok", source: "cloud", citations: [] };
    },
  };
  return { svc, sentToCloud, localInputs };
}

const input = (over: Partial<CheckInput> = {}): CheckInput => ({
  text: SCAM_TEXT,
  extraMaskTerms: ["Rajesh Kumar"],
  allowCloud: true,
  ...over,
});

describe("egress leakage test", () => {
  it.each<OnDeviceState>(["available", "no_api", "unavailable", "downloadable"])(
    "no seeded identifier leaves the device (on-device state: %s)",
    async (state) => {
      const spy = makeSpy(state);
      const a = await analyzeLocal(input(), spy.svc);
      for (const includeText of [true, false]) {
        const preview = previewCloud(a, { includeMaskedText: includeText, language: "en" });
        await verifyInCloud(preview, spy.svc);
      }
      expect(spy.sentToCloud.length).toBe(2);
      for (const prompt of spy.sentToCloud) {
        for (const seed of SEEDS) expect(prompt, `seed ${seed}`).not.toContain(seed);
        expect(findResidualIdentifiers(prompt)).toEqual([]);
        expect(prompt).not.toMatch(/token=secret9|case\?id/);
      }
    },
  );

  it("raw content goes only to the local extractor, never to the cloud", async () => {
    const spy = makeSpy("available");
    await analyzeLocal(input(), spy.svc);
    expect(spy.localInputs).toEqual([SCAM_TEXT]);
    expect(spy.sentToCloud).toEqual([]);
  });

  it("receipt payload equals the prompt that was sent", async () => {
    const spy = makeSpy("available");
    const a = await analyzeLocal(input(), spy.svc);
    const preview = previewCloud(a, { includeMaskedText: true, language: "en" });
    const out = await verifyInCloud(preview, spy.svc);
    expect(out.receipt.payload).toBe(spy.sentToCloud[0]);
    expect(out.receipt.containsImage).toBe(false);
  });

  it("fails closed when a user edit reintroduces an identifier", async () => {
    const spy = makeSpy("no_api");
    const a = await analyzeLocal(input(), spy.svc);
    a.maskedText += " also call 9123456780";
    expect(() => previewCloud(a, { includeMaskedText: true, language: "en" })).toThrow(EgressBlockedError);
  });

  it("prepareEgress blocks a raw payload directly", () => {
    expect(() =>
      prepareEgress(
        "x",
        {
          task: "verify_claims",
          language: "en",
          ruleHits: [],
          maskedText: "send to 9876543210",
          facts: {
            senderClaim: "unknown",
            demands: [],
            urgencyCues: [],
            promisedReturns: false,
            domains: [],
            language: "en",
            summary: "",
          },
        },
        {},
        "instr",
      ),
    ).toThrow(EgressBlockedError);
  });
});

describe("analyzeLocal routing", () => {
  it("uses built-in rules when no on-device model exists, and explains why", async () => {
    const spy = makeSpy("no_api");
    const a = await analyzeLocal(input(), spy.svc);
    expect(a.traces.find((t) => t.step === "extract")?.route).toBe("rules_only");
    expect(a.caveats.join(" ")).toMatch(/cannot run the on-device model/);
    expect(a.localLevel).toBe("high");
    expect(spy.localInputs).toEqual([]);
  });

  it("uses the on-device model for English text when available", async () => {
    const spy = makeSpy("available");
    const a = await analyzeLocal(input(), spy.svc);
    expect(a.traces.find((t) => t.step === "extract")?.route).toBe("on_device");
  });

  it("skips the on-device model for Hindi and asks for masked text in the cloud step", async () => {
    const spy = makeSpy("available");
    const a = await analyzeLocal(
      input({ text: "आप डिजिटल अरेस्ट में हैं। सीबीआई वीडियो कॉल पर हैं। ९८७६५४३२१० पर तुरंत पैसे ट्रांसफर करें।", extraMaskTerms: [] }),
      spy.svc,
    );
    expect(spy.localInputs).toEqual([]);
    expect(a.needsMaskedTextForCloud).toBe(true);
    expect(a.maskedText).toContain("[PHONE_1]");
    expect(a.localLevel).toBe("high");
  });

  it("refuses screenshots when the local model is not ready (never falls back to cloud)", async () => {
    const spy = makeSpy("downloadable");
    await expect(
      analyzeLocal(input({ image: { mimeType: "image/png", base64: "AAAA" } }), spy.svc),
    ).rejects.toBeInstanceOf(LocalModelRequiredError);
    expect(spy.sentToCloud).toEqual([]);
  });

  it("degrades to rules if the local model throws", async () => {
    const spy = makeSpy("available");
    spy.svc.extractLocal = async () => {
      throw new Error("boom");
    };
    const a = await analyzeLocal(input(), spy.svc);
    expect(a.caveats.join(" ")).toMatch(/boom/);
    expect(a.localLevel).toBe("high");
  });
});

describe("buildVerdict", () => {
  it("takes the stricter of rules and cloud, and labels an unverified result", async () => {
    const spy = makeSpy("no_api");
    const a = await analyzeLocal(input({ text: "Lunch tomorrow?", extraMaskTerms: [] }), spy.svc);
    const local = buildVerdict(a, null);
    expect(local.level).toBe("low");
    expect(local.caveats.join(" ")).toMatch(/Not verified against official sources/);
    expect(local.receipts).toEqual([]);

    const preview = previewCloud(a, { includeMaskedText: false, language: "en" });
    const cloud = await verifyInCloud(preview, spy.svc);
    const v = buildVerdict(a, cloud);
    expect(v.level).toBe("high");
    expect(v.citations[0]?.official).toBe(true);
    expect(v.receipts).toHaveLength(1);
  });

  it("never lets a cloud 'low' downgrade a rule-based 'high'", async () => {
    const spy = makeSpy("no_api");
    spy.svc.verifyCloud = async () => ({ text: "Seems fine.\nLEVEL: low", source: "cloud", citations: [] });
    const a = await analyzeLocal(input(), spy.svc);
    const out = await verifyInCloud(previewCloud(a, { includeMaskedText: false, language: "en" }), spy.svc);
    expect(buildVerdict(a, out).level).toBe("high");
  });
});

describe("remask and explainSimply", () => {
  it("re-masks an edited review box and keeps AI facts", async () => {
    const { remask } = await import("../src/ai/pipeline");
    const spy = makeSpy("available");
    const a = await analyzeLocal(input(), spy.svc);
    const b = remask(a, "Pay now to 9876543210. Stay on the video call, CBI officer.", []);
    expect(b.maskedText).toContain("[PHONE_1]");
    expect(b.maskedText).not.toContain("9876543210");
    expect(b.facts.summary).toBe(a.facts.summary);
  });

  it("keeps a receipt only when the call ran in the cloud, and blocks when cloud is not allowed", async () => {
    const { explainSimply } = await import("../src/ai/pipeline");
    const spy = makeSpy("no_api");
    const a = await analyzeLocal(input(), spy.svc);
    expect(await explainSimply(a, "en", false, spy.svc)).toBeNull();
    const cloud = await explainSimply(a, "en", true, spy.svc);
    expect(cloud?.route).toBe("cloud");
    expect(cloud?.receipt?.payload).toBe(spy.sentToCloud[0]);

    const local = makeSpy("available");
    local.svc.explain = async () => ({ text: "local words", source: "on_device", citations: [] });
    const a2 = await analyzeLocal(input(), local.svc);
    const out = await explainSimply(a2, "en", false, local.svc);
    expect(out?.route).toBe("on_device");
    expect(out?.receipt).toBeNull();
    // Hindi always needs the cloud
    expect(await explainSimply(a2, "hi", false, local.svc)).toBeNull();
  });
});
