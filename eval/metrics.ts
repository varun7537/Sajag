import type { RiskLevel } from "../src/types";

export interface Scored {
  label: "scam" | "benign";
  category: string;
  lang: string;
  level: RiskLevel;
}

/** A message counts as "flagged" when the level is medium or high. */
export const flagged = (l: RiskLevel) => l === "medium" || l === "high";

export interface Report {
  n: number;
  tp: number;
  fp: number;
  fn: number;
  tn: number;
  precision: number;
  recall: number;
  f1: number;
}

export function score(rows: Scored[]): Report {
  let tp = 0, fp = 0, fn = 0, tn = 0;
  for (const r of rows) {
    const f = flagged(r.level);
    if (r.label === "scam") f ? tp++ : fn++;
    else f ? fp++ : tn++;
  }
  const precision = tp + fp === 0 ? 0 : tp / (tp + fp);
  const recall = tp + fn === 0 ? 0 : tp / (tp + fn);
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  return { n: rows.length, tp, fp, fn, tn, precision, recall, f1 };
}

export const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

export function table(name: string, rows: Scored[]): string {
  const groups = new Map<string, Scored[]>();
  for (const r of rows) {
    groups.set(`lang:${r.lang}`, [...(groups.get(`lang:${r.lang}`) ?? []), r]);
    groups.set(`cat:${r.category}`, [...(groups.get(`cat:${r.category}`) ?? []), r]);
  }
  const all = score(rows);
  const lines = [
    `### ${name}`,
    `| slice | n | precision | recall | F1 | FP | FN |`,
    `| --- | --- | --- | --- | --- | --- | --- |`,
    `| **all** | ${all.n} | ${pct(all.precision)} | ${pct(all.recall)} | ${pct(all.f1)} | ${all.fp} | ${all.fn} |`,
  ];
  for (const [k, v] of [...groups.entries()].sort()) {
    const s = score(v);
    const noScam = v.every((x) => x.label === "benign");
    lines.push(
      `| ${k} | ${s.n} | ${noScam ? "n/a" : pct(s.precision)} | ${noScam ? "n/a" : pct(s.recall)} | ${noScam ? "n/a" : pct(s.f1)} | ${s.fp} | ${s.fn} |`,
    );
  }
  return lines.join("\n");
}
