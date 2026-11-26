import type { ScoreEntry } from "./types";

const KEY = "sadeem.scores.v1";
const MAX = 8;

type Store = { version: 1; rows: ScoreEntry[] };

function empty(): Store {
  return { version: 1, rows: [] };
}

export function loadScores(): ScoreEntry[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Store;
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.rows)) return [];
    return parsed.rows
      .filter(
        (row) =>
          row &&
          typeof row.name === "string" &&
          typeof row.score === "number" &&
          typeof row.wave === "number",
      )
      .slice(0, MAX);
  } catch {
    return [];
  }
}

export function qualifies(score: number, rows: ScoreEntry[]): boolean {
  if (score <= 0) return false;
  if (rows.length < MAX) return true;
  return score >= rows[MAX - 1]!.score;
}

export function pushScore(entry: ScoreEntry): ScoreEntry[] {
  const rows = loadScores();
  rows.push(entry);
  rows.sort((a, b) => b.score - a.score || a.at - b.at);
  const next = rows.slice(0, MAX);
  try {
    const store: Store = { version: 1, rows: next };
    localStorage.setItem(KEY, JSON.stringify(store));
  } catch {
    /* ignore quota / private mode */
  }
  return next;
}
