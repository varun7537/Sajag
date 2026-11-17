/**
 * Firebase AI Logic implementation of AiServices.
 *
 * One model instance per PURPOSE, each with the strictest inference mode that still works:
 *
 *   extract   ONLY_ON_DEVICE   raw message/screenshot. Must never fall back to the cloud.
 *   explain   PREFER_ON_DEVICE masked facts. Local when possible, cloud otherwise (English).
 *   explainHi ONLY_IN_CLOUD    Hindi output is not supported on-device.
 *   verify    ONLY_IN_CLOUD    Google Search grounding is not supported on-device.
 *
 * `response.inferenceSource` (reported by the SDK) is what the UI shows as the route badge.
 */
import {
  getGenerativeModel,
  InferenceMode,
  InferenceSource,
  type AI,
  type GenerateContentResult,
  type GenerativeModel,
  type Part,
} from "firebase/ai";
import { CLOUD_MODEL } from "../config";
import type { Route } from "../types";
import type { AiServices, CloudText, LocalExtraction, OnDeviceState } from "./contracts";
import { EXTRACT_PROMPT } from "./prompts";
import { FACTS_JSON_SCHEMA, parseFacts } from "./schemas";
import { citationsFromChunks } from "./verify";

/** Must match what the SDK uses for availability checks. English + image input. */
const createOptions = () => ({
  expectedInputs: [{ type: "text" as const, languages: ["en"] }, { type: "image" as const }],
  expectedOutputs: [{ type: "text" as const, languages: ["en"] }],
});

interface LanguageModelGlobal {
  availability(options?: unknown): Promise<string>;
}

function sourceOf(res: GenerateContentResult): Route {
  return res.response.inferenceSource === InferenceSource.ON_DEVICE ? "on_device" : "cloud";
}

export function createFirebaseServices(ai: AI): AiServices {
  const extractModel: GenerativeModel = getGenerativeModel(ai, {
    mode: InferenceMode.ONLY_ON_DEVICE,
    onDeviceParams: {
      createOptions: createOptions(),
      promptOptions: { responseConstraint: FACTS_JSON_SCHEMA },
    },
    inCloudParams: { model: CLOUD_MODEL },
  });

  const explainModel: GenerativeModel = getGenerativeModel(ai, {
    mode: InferenceMode.PREFER_ON_DEVICE,
    onDeviceParams: { createOptions: createOptions() },
    inCloudParams: { model: CLOUD_MODEL, generationConfig: { temperature: 0.3 } },
  });

  const explainHiModel: GenerativeModel = getGenerativeModel(ai, {
    mode: InferenceMode.ONLY_IN_CLOUD,
    inCloudParams: { model: CLOUD_MODEL, generationConfig: { temperature: 0.3 } },
  });

  const verifyModel: GenerativeModel = getGenerativeModel(ai, {
    mode: InferenceMode.ONLY_IN_CLOUD,
    inCloudParams: {
      model: CLOUD_MODEL,
      tools: [{ googleSearch: {} }],
      generationConfig: { temperature: 0.2 },
    },
  });

  return {
    async onDeviceState(): Promise<OnDeviceState> {
      const lm = (globalThis as unknown as { LanguageModel?: LanguageModelGlobal }).LanguageModel;
      if (!lm) return "no_api";
      try {
        const s = await lm.availability(createOptions());
        if (s === "available" || s === "downloadable" || s === "downloading" || s === "unavailable") return s;
        return "unavailable";
      } catch {
        return "unavailable";
      }
    },

    async prepareOnDevice(onProgress) {
      await extractModel.initializeDeviceModel(onProgress);
    },

    async extractLocal(input): Promise<LocalExtraction> {
      const parts: Array<string | Part> = [EXTRACT_PROMPT, `MESSAGE TEXT (may be empty if only a screenshot is given):\n${input.text}`];
      if (input.image) parts.push({ type: "inlineData", inlineData: { mimeType: input.image.mimeType, data: input.image.base64 } });
      const res = await extractModel.generateContent(parts);
      if (res.response.inferenceSource === InferenceSource.IN_CLOUD) {
        // Defence in depth: ONLY_ON_DEVICE should make this impossible.
        throw new Error("Extraction unexpectedly ran in the cloud. Result discarded.");
      }
      const parsed = parseFacts(res.response.text());
      return { facts: parsed.facts, transcript: parsed.transcript };
    },

    async verifyCloud(prompt): Promise<CloudText> {
      const res = await verifyModel.generateContent(prompt);
      const meta = res.response.candidates?.[0]?.groundingMetadata;
      return {
        text: res.response.text(),
        source: "cloud",
        citations: citationsFromChunks(meta?.groundingChunks),
      };
    },

    async explain(prompt, language): Promise<CloudText> {
      const model = language === "hi" ? explainHiModel : explainModel;
      const res = await model.generateContent(prompt);
      return { text: res.response.text(), source: sourceOf(res), citations: [] };
    },
  };
}
