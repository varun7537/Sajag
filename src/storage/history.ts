/**
 * Local-only history. Stores the risk level, a short MASKED excerpt and the time. It never
 * stores raw text or screenshots, and is wrapped in try/catch because storage can be blocked.
 */
import type { RiskLevel } from "../types";

export interface HistoryEntry {
  at: string;
  level: RiskLevel;
  excerpt: string;
  cloudUsed: boolean;
}

const KEY = "sajag.history.v1";
const MAX = 10;

export function loadHistory(): HistoryEntry[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr)) return [];
    return arr
      .filter(
        (e): e is HistoryEntry =>
          typeof e === "object" &&
          e !== null &&
          typeof (e as HistoryEntry).at === "string" &&
          typeof (e as HistoryEntry).excerpt === "string",
      )
      .slice(0, MAX);
  } catch {
    return [];
  }
}

export function addHistory(entry: HistoryEntry): HistoryEntry[] {
  const next = [entry, ...loadHistory()].slice(0, MAX);
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* storage unavailable: the app still works */
  }
  return next;
}

export function clearHistory(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
