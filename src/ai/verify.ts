import type { Citation, RiskLevel } from "../types";

const OFFICIAL_SUFFIXES = [".gov.in", ".nic.in", "rbi.org.in", "sebi.gov.in", "cybercrime.gov.in"];

export function isOfficialHost(host: string): boolean {
  const h = host.toLowerCase();
  return OFFICIAL_SUFFIXES.some((s) => h === s.replace(/^\./, "") || h.endsWith(s));
}

/** Splits the trailing `LEVEL: x` line from the model answer. */
export function parseLevelLine(text: string): { body: string; level: RiskLevel | undefined } {
  const lines = text.trim().split(/\r?\n/);
  let level: RiskLevel | undefined;
  for (let i = lines.length - 1; i >= 0; i--) {
    const m = /^\s*\**\s*LEVEL\s*:\s*(high|medium|low|unclear)\s*\**\s*$/i.exec(lines[i] ?? "");
    if (m) {
      level = m[1]!.toLowerCase() as RiskLevel;
      lines.splice(i, 1);
      break;
    }
  }
  return { body: lines.join("\n").trim(), level };
}

interface ChunkLike {
  web?: { uri?: string; title?: string };
}

/**
 * Citations come from Google Search grounding metadata, not from the model's text, so a model
 * cannot invent a link. Official domains are sorted first.
 */
export function citationsFromChunks(chunks: ChunkLike[] | undefined): Citation[] {
  const seen = new Set<string>();
  const out: Citation[] = [];
  for (const c of chunks ?? []) {
    const uri = c.web?.uri;
    if (!uri || !/^https:\/\//i.test(uri) || seen.has(uri)) continue;
    seen.add(uri);
    const title = (c.web?.title ?? "").trim() || uri;
    let host = title;
    try {
      host = new URL(uri).hostname;
    } catch {
      /* keep title */
    }
    out.push({ title, uri, official: isOfficialHost(title) || isOfficialHost(host) });
  }
  return out.sort((a, b) => Number(b.official) - Number(a.official)).slice(0, 5);
}
