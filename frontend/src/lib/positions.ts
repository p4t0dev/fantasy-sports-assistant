// One colour per position, used everywhere a position is shown: roster rows,
// slot chips, the draft board, the optimizer diff. A lineup is read by
// scanning, not by reading, and a wall of identically grey "PG"/"SG"/"SF"
// labels defeats that - the eye has nothing to catch on.
//
// The strings are written out in full on purpose. Tailwind scans source text
// for class names, so a template like `bg-${colour}-500/15` compiles to
// nothing at all.

type Tone = { chip: string; dot: string };

const NEUTRAL: Tone = {
  chip: "bg-gray-800 text-gray-300 border-gray-600",
  dot: "bg-gray-500",
};

const POSITION_TONES: Record<string, Tone> = {
  // NFL offense
  QB: { chip: "bg-rose-500/15 text-rose-300 border-rose-500/40", dot: "bg-rose-400" },
  RB: { chip: "bg-emerald-500/15 text-emerald-300 border-emerald-500/40", dot: "bg-emerald-400" },
  WR: { chip: "bg-sky-500/15 text-sky-300 border-sky-500/40", dot: "bg-sky-400" },
  TE: { chip: "bg-amber-500/15 text-amber-300 border-amber-500/40", dot: "bg-amber-400" },
  K: { chip: "bg-violet-500/15 text-violet-300 border-violet-500/40", dot: "bg-violet-400" },
  DEF: { chip: "bg-slate-500/20 text-slate-300 border-slate-400/40", dot: "bg-slate-400" },
  // NFL defense (IDP)
  DL: { chip: "bg-fuchsia-500/15 text-fuchsia-300 border-fuchsia-500/40", dot: "bg-fuchsia-400" },
  LB: { chip: "bg-cyan-500/15 text-cyan-300 border-cyan-500/40", dot: "bg-cyan-400" },
  DB: { chip: "bg-lime-500/15 text-lime-300 border-lime-500/40", dot: "bg-lime-400" },
  // NBA
  PG: { chip: "bg-blue-500/15 text-blue-300 border-blue-500/40", dot: "bg-blue-400" },
  SG: { chip: "bg-cyan-500/15 text-cyan-300 border-cyan-500/40", dot: "bg-cyan-400" },
  SF: { chip: "bg-emerald-500/15 text-emerald-300 border-emerald-500/40", dot: "bg-emerald-400" },
  PF: { chip: "bg-amber-500/15 text-amber-300 border-amber-500/40", dot: "bg-amber-400" },
  C: { chip: "bg-violet-500/15 text-violet-300 border-violet-500/40", dot: "bg-violet-400" },
};

// Flex slots take a colour of their own rather than borrowing one of the
// positions they accept: a FLEX seat holding a WR is not a WR seat, and giving
// it the WR colour hides exactly the seat a manager is looking for.
const SLOT_TONES: Record<string, Tone> = {
  FLEX: { chip: "bg-indigo-500/15 text-indigo-300 border-indigo-500/40", dot: "bg-indigo-400" },
  SUPER_FLEX: { chip: "bg-purple-500/15 text-purple-300 border-purple-500/40", dot: "bg-purple-400" },
  REC_FLEX: { chip: "bg-teal-500/15 text-teal-300 border-teal-500/40", dot: "bg-teal-400" },
  WRRB_FLEX: { chip: "bg-teal-500/15 text-teal-300 border-teal-500/40", dot: "bg-teal-400" },
  IDP_FLEX: { chip: "bg-pink-500/15 text-pink-300 border-pink-500/40", dot: "bg-pink-400" },
  G: { chip: "bg-indigo-500/15 text-indigo-300 border-indigo-500/40", dot: "bg-indigo-400" },
  F: { chip: "bg-teal-500/15 text-teal-300 border-teal-500/40", dot: "bg-teal-400" },
  UTIL: { chip: "bg-purple-500/15 text-purple-300 border-purple-500/40", dot: "bg-purple-400" },
  BN: NEUTRAL,
  IR: { chip: "bg-red-500/15 text-red-300 border-red-500/40", dot: "bg-red-400" },
  TAXI: NEUTRAL,
};

export function posTone(pos?: string | null): Tone {
  if (!pos) return NEUTRAL;
  return POSITION_TONES[pos] ?? NEUTRAL;
}

export function slotTone(slot?: string | null): Tone {
  if (!slot) return NEUTRAL;
  return SLOT_TONES[slot] ?? POSITION_TONES[slot] ?? NEUTRAL;
}

const SLOT_LABELS: Record<string, string> = {
  SUPER_FLEX: "SUPERFLEX",
  IDP_FLEX: "IDP FLEX",
  REC_FLEX: "REC FLEX",
  WRRB_FLEX: "WR/RB FLEX",
};

export function slotLabel(slot: string): string {
  return SLOT_LABELS[slot] ?? slot;
}
