/**
 * Node eval: the parts that need no browser and no network.
 *   1. Rules-only arm: precision / recall of the built-in rule engine on the synthetic set.
 *   2. Leakage test: plant identifiers, run the full local pipeline, build the cloud prompt in
 *      every mode, and count how many planted identifiers appear in any outgoing text.
 *
 * The on-device AI arm and the hybrid (cloud-verified) arm need Chrome and a Firebase project;
 * run them from /eval in the browser (see docs/EVAL.md).
 *
 * Run: npm run eval
 */
import { readFileSync } from "node:fs";
import type { AiServices } from "../src/ai/contracts";
import { analyzeLocal, previewCloud } from "../src/ai/pipeline";
import { findResidualIdentifiers } from "../src/privacy/masker";
import { table, type Scored } from "./metrics";
import type { Item } from "./generate";

const data = JSON.parse(readFileSync(new URL("./dataset.json", import.meta.url), "utf8")) as Item[];

const noModel: AiServices = {
  onDeviceState: async () => "no_api",
  prepareOnDevice: async () => {},
  extractLocal: async () => {
    throw new Error("n/a");
  },
  verifyCloud: async () => {
    throw new Error("n/a");
  },
  explain: async () => {
    throw new Error("n/a");
  },
};

const isName = (seed: string) => /^[A-Za-z]+(\s[A-Za-z]+)+$/.test(seed);

const rows: Scored[] = [];
const outgoing = (a: Awaited<ReturnType<typeof analyzeLocal>>): string[] => {
  const out: string[] = [];
  for (const includeText of [true, false]) {
    for (const language of ["en", "hi"] as const) {
      try {
        out.push(previewCloud(a, { includeMaskedText: includeText, language }).prompt);
      } catch {
        // A blocked egress is a safe outcome: nothing would have been sent.
      }
    }
  }
  return out;
};

let prompts = 0;
let idSeeds = 0;
let idLeaks = 0;
let nameSeeds = 0;
let nameLeaksNoUserTerms = 0;
let nameLeaksWithUserTerms = 0;
let residual = 0;
const details: string[] = [];

for (const it of data) {
  const names = it.seeds.filter(isName);
  const ids = it.seeds.filter((s) => !isName(s));

  // Arm 1: the user adds nothing. Names are expected to remain (documented limitation).
  const a = await analyzeLocal({ text: it.text, extraMaskTerms: [], allowCloud: true }, noModel);
  rows.push({ label: it.label, category: it.category, lang: it.lang, level: a.localLevel });
  for (const p of outgoing(a)) {
    prompts += 1;
    for (const s of ids) {
      idSeeds += 1;
      if (p.includes(s)) {
        idLeaks += 1;
        details.push(`${it.id} (${it.category}/${it.lang}) leaked identifier: ${s}`);
      }
    }
    for (const s of names) {
      nameSeeds += 1;
      if (p.includes(s)) nameLeaksNoUserTerms += 1;
    }
    if (findResidualIdentifiers(p).length > 0) residual += 1;
  }

  // Arm 2: the user types the names into "Hide these words". Nothing should remain.
  const b = await analyzeLocal({ text: it.text, extraMaskTerms: names, allowCloud: true }, noModel);
  for (const p of outgoing(b)) {
    for (const s of names) if (p.includes(s)) nameLeaksWithUserTerms += 1;
  }
}

console.log(`# Sajag eval (synthetic set, ${data.length} messages)\n`);
console.log("All messages and identifiers are fabricated by the project team. The rules and this set were written by the same people, so treat the rules-only numbers as optimistic.\n");
const isHard = (r: Scored) => r.category.startsWith("hard_");
console.log(table("Rules-only arm: template slice (the rules were tuned on these)", rows.filter((r) => !isHard(r))));
console.log("");
console.log(table("Rules-only arm: HARD slice (hand-written paraphrases, not used for tuning)", rows.filter(isHard)));
console.log(`\n### Leakage test (outgoing prompts to the cloud)`);
console.log(`- outgoing prompts built: ${prompts} (4 per message: with/without masked text, English/Hindi)`);
console.log(`- planted identifier checks (phones, UPI, Aadhaar, links, OTP digits...): ${idSeeds}, leaks: ${idLeaks}`);
console.log(`- prompts that still matched an identifier pattern: ${residual}`);
console.log(`- name checks with NO user-supplied words: ${nameSeeds}, names still present: ${nameLeaksNoUserTerms} (expected: names are not auto-detected)`);
console.log(`- name checks WITH user-supplied words: names still present: ${nameLeaksWithUserTerms}`);
if (details.length) console.log(`\nDetails:\n${details.map((d) => `- ${d}`).join("\n")}`);
process.exitCode = idLeaks === 0 && residual === 0 && nameLeaksWithUserTerms === 0 ? 0 : 1;
