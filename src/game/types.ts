export type Mode = "menu" | "playing" | "paused" | "upgrade" | "over";

export type UpgradeKind = "multi" | "shield" | "speed";

export type ScoreEntry = {
  name: string;
  score: number;
  wave: number;
  at: number;
};

export type Snapshot = {
  mode: Mode;
  score: number;
  best: number;
  wave: number;
  lives: number;
  shield: number;
  shieldMax: number;
  shieldRegen: number;
  multi: number;
  speed: number;
  combo: number;
  muted: boolean;
  shake: boolean;
  autoFire: boolean;
  scores: ScoreEntry[];
  qualifies: boolean;
  saved: boolean;
  banner: string;
  remaining: number;
  bossHp: number;
  bossMax: number;
};

export const CAP = { multi: 4, shield: 3, speed: 5 } as const;

export const initialSnapshot: Snapshot = {
  mode: "menu",
  score: 0,
  best: 0,
  wave: 1,
  lives: 3,
  shield: 0,
  shieldMax: 0,
  shieldRegen: 0,
  multi: 0,
  speed: 0,
  combo: 0,
  muted: false,
  shake: true,
  autoFire: false,
  scores: [],
  qualifies: false,
  saved: false,
  banner: "",
  remaining: 0,
  bossHp: 0,
  bossMax: 0,
};

export function shotCount(level: number): number {
  return [1, 3, 5, 5, 7][Math.max(0, Math.min(4, level))] ?? 1;
}
