/**
 * The contract between the pure pipeline and the Firebase-backed implementation.
 * Tests and the eval harness provide fakes; the app provides `createFirebaseServices`.
 */
import type { Citation, ExtractedFacts, Route } from "../types";

/** Chrome Prompt API availability, plus "no_api" when the browser has no LanguageModel at all. */
export type OnDeviceState = "available" | "downloadable" | "downloading" | "unavailable" | "no_api";

export interface LocalExtraction {
  facts: ExtractedFacts;
  /** Visible text of the message. Stays on the device. */
  transcript: string;
}

export interface CloudText {
  text: string;
  /** Where Firebase AI Logic reports the call actually ran. */
  source: Route;
  citations: Citation[];
}

export interface AiServices {
  onDeviceState(): Promise<OnDeviceState>;
  /** Downloads/initialises the on-device model. Must be called from a user gesture. */
  prepareOnDevice(onProgress: (fraction: number) => void): Promise<void>;
  /** ONLY_ON_DEVICE. Throws if the local model cannot run. Receives raw content: it never leaves the device. */
  extractLocal(input: { text: string; image?: { mimeType: "image/jpeg" | "image/png"; base64: string } }): Promise<LocalExtraction>;
  /** ONLY_IN_CLOUD with Google Search grounding. Receives an already-gated prompt. */
  verifyCloud(prompt: string): Promise<CloudText>;
  /** PREFER_ON_DEVICE (English) or ONLY_IN_CLOUD (Hindi). Receives an already-gated prompt. */
  explain(prompt: string, language: "en" | "hi"): Promise<CloudText>;
}
