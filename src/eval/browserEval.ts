/**
 * Browser eval harness (/eval.html). Measures three arms on the synthetic set:
 *   rules_only   built-in rules, no AI                       (also runnable in Node: npm run eval)
 *   on_device    Chrome's on-device model extracts facts, then rules   (needs the local model)
 *   hybrid       on_device + one grounded cloud verification on masked facts (needs Firebase)
 *
 * Only fabricated messages are used, so running the cloud arm does not send real personal data.
 * Results are timings and counts measured on THIS machine; copy them from the page or download JSON.
 */
import "../styles.css";
import type { AiServices } from "../ai/contracts";
import { createFirebaseServices } from "../ai/firebaseServices";
import { analyzeLocal, buildVerdict, previewCloud, verifyInCloud } from "../ai/pipeline";
import { isFirebaseConfigured } from "../config";
import { initFirebase } from "../firebase";
import { maskText } from "../privacy/masker";
import { evaluateRules } from "../rules/engine";
import { heuristicExtract } from "../rules/heuristicExtract";
import type { RiskLevel } from "../types";
import { $, clear, h } from "../ui/dom";
import dataset from "../../eval/dataset.json";
import { pct, score, type Scored } from "../../eval/metrics";

interface Item {
  id: string;
  label: "scam" | "benign";
  category: string;
  lang: string;
  text: string;
}
const items = dataset as unknown as Item[];

interface Row extends Scored {
  id: string;
  arm: string;
  ms: number;
  route: string;
}

let rows: Row[] = [];

const offline: AiServices = {
  onDeviceState: async () => "no_api",
  prepareOnDevice: async () => {},
  extractLocal: async () => {
    throw new Error("no model");
  },
  verifyCloud: async () => {
    throw new Error("no cloud");
  },
  explain: async () => {
    throw new Error("no cloud");
  },
};

let svc: AiServices = offline;
let firebaseOn = false;

async function status(): Promise<void> {
  const s = await svc.onDeviceState();
  $("#model-status").textContent = `On-device model: ${s}${firebaseOn ? "" : " · Firebase not configured"}`;
  ($("#model-btn") as HTMLButtonElement).hidden = !(s === "downloadable" && firebaseOn);
}

function summarize(arm: string): HTMLElement {
  const r = rows.filter((x) => x.arm === arm);
  const s = score(r);
  const ms = r.map((x) => x.ms).sort((a, b) => a - b);
  const median = ms.length ? ms[Math.floor(ms.length / 2)]! : 0;
  const onDev = r.filter((x) => x.route === "on_device").length;
  return h(
    "tr",
    {},
    h("td", {}, arm),
    h("td", {}, String(s.n)),
    h("td", {}, pct(s.precision)),
    h("td", {}, pct(s.recall)),
    h("td", {}, pct(s.f1)),
    h("td", {}, `${s.fp} / ${s.fn}`),
    h("td", {}, `${median} ms`),
    h("td", {}, `${onDev} of ${s.n}`),
  );
}

function render(): void {
  const out = $("#out");
  out.hidden = false;
  clear(out);
  const arms = [...new Set(rows.map((r) => r.arm))];
  out.append(
    h("h2", {}, "Results"),
    h("p", { class: "muted" }, "Flagged = medium or high. Precision and recall are for the scam class. Synthetic set written by the project team; treat as indicative."),
    h(
      "table",
      { class: "evaltable" },
      h("thead", {}, h("tr", {}, ...["arm", "n", "precision", "recall", "F1", "FP / FN", "median time", "extraction on-device"].map((x) => h("th", {}, x)))),
      h("tbody", {}, ...arms.map(summarize)),
    ),
  );
}

async function run(): Promise<void> {
  const err = $("#error");
  err.hidden = true;
  rows = [];
  const slice = (document.querySelector<HTMLInputElement>('input[name="slice"]:checked')?.value ?? "hard") as string;
  const set = items.filter((i) => (slice === "hard" ? i.category.startsWith("hard_") : true));
  const doCloud = ($("#do-cloud") as HTMLInputElement).checked && firebaseOn;
  const state = await svc.onDeviceState();
  const progress = $("#progress");
  ($("#run") as HTMLButtonElement).disabled = true;

  try {
    // Arm 1: rules only (synchronous, always available).
    for (const it of set) {
      const t = performance.now();
      const m = maskText(it.text);
      const level = evaluateRules(heuristicExtract(m.masked, m.domains), m.masked).level;
      rows.push({ id: it.id, arm: "rules_only", label: it.label, category: it.category, lang: it.lang, level, ms: Math.round(performance.now() - t), route: "rules_only" });
    }

    let i = 0;
    for (const it of set) {
      i += 1;
      progress.textContent = `Message ${i} of ${set.length}…`;
      const t0 = performance.now();
      let analysis;
      try {
        analysis = await analyzeLocal({ text: it.text, extraMaskTerms: [], allowCloud: true }, svc);
      } catch (e) {
        console.warn(it.id, e);
        continue;
      }
      const extractRoute = analysis.traces.find((t) => t.step === "extract")?.route ?? "rules_only";
      const base = { id: it.id, label: it.label, category: it.category, lang: it.lang } as const;
      if (state === "available") {
        rows.push({ ...base, arm: "on_device", level: analysis.localLevel, ms: Math.round(performance.now() - t0), route: extractRoute });
      }
      if (doCloud) {
        const t1 = performance.now();
        let level: RiskLevel = analysis.localLevel;
        try {
          const preview = previewCloud(analysis, { includeMaskedText: true, language: "en" });
          const out = await verifyInCloud(preview, svc);
          level = buildVerdict(analysis, out).level;
        } catch (e) {
          console.warn("cloud arm failed for", it.id, e);
        }
        rows.push({ ...base, arm: "hybrid", level, ms: Math.round(performance.now() - t0 + (performance.now() - t1) * 0), route: extractRoute });
      }
      if (i % 3 === 0) render();
    }
    progress.textContent = state === "available" ? "Done." : "Done. The on-device arm was skipped because the model is not ready.";
    render();
    ($("#dl") as HTMLButtonElement).disabled = false;
  } catch (e) {
    err.hidden = false;
    err.textContent = String((e as Error).message ?? e);
  } finally {
    ($("#run") as HTMLButtonElement).disabled = false;
  }
}

$("#run").addEventListener("click", () => void run());
$("#model-btn").addEventListener("click", async () => {
  await svc.prepareOnDevice((f) => {
    $("#model-status").textContent = `Downloading on-device model… ${Math.round(f * 100)}%`;
  });
  await status();
});
$("#dl").addEventListener("click", () => {
  const blob = new Blob([JSON.stringify({ at: new Date().toISOString(), userAgent: navigator.userAgent, rows }, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "sajag-eval-results.json";
  a.click();
  URL.revokeObjectURL(a.href);
});

if (isFirebaseConfigured()) {
  try {
    const { ai } = initFirebase();
    svc = createFirebaseServices(ai);
    firebaseOn = true;
  } catch (e) {
    console.error(e);
  }
}
void status();
