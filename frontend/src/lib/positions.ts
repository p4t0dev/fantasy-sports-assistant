// One colour per position, used everywhere a position is shown: roster rows,
// slot chips, the draft board, the optimizer diff. A lineup is read by
// scanning, not by reading, and a wall of identically grey "PG"/"SG"/"SF"
// labels defeats that - the eye has nothing to catch on.
//
// Red, yellow and green are taken: they mean the strength of the opponent and
// a change to make. Positions stay out of those hues in both themes, which is
// why the chips are solid fills with white text.
//
// The strings are written out in full on purpose. Tailwind scans source text
// for class names, so a template like `bg-${colour}-500/15` compiles to
// nothing at all.

type Tone = { chip: string; dot: string };

const NEUTRAL: Tone = {
  chip: "bg-raised text-ink-soft border-line",
  dot: "bg-muted",
};

const POSITION_TONES: Record<string, Tone> = {
  // NFL offense
  QB: { chip: "bg-[#7c3aed] text-white border-transparent", dot: "bg-[#7c3aed]" },
  RB: { chip: "bg-[#1d4ed8] text-white border-transparent", dot: "bg-[#1d4ed8]" },
  WR: { chip: "bg-[#0e7490] text-white border-transparent", dot: "bg-[#0e7490]" },
  TE: { chip: "bg-[#c026d3] text-white border-transparent", dot: "bg-[#c026d3]" },
  K: { chip: "bg-[#475569] text-white border-transparent", dot: "bg-[#475569]" },
  DEF: { chip: "bg-[#334155] text-white border-transparent", dot: "bg-[#334155]" },
  // NFL defense (IDP)
  DL: { chip: "bg-[#be185d] text-white border-transparent", dot: "bg-[#be185d]" },
  LB: { chip: "bg-[#0369a1] text-white border-transparent", dot: "bg-[#0369a1]" },
  DB: { chip: "bg-[#4338ca] text-white border-transparent", dot: "bg-[#4338ca]" },
  // NBA
  PG: { chip: "bg-[#1d4ed8] text-white border-transparent", dot: "bg-[#1d4ed8]" },
  SG: { chip: "bg-[#0e7490] text-white border-transparent", dot: "bg-[#0e7490]" },
  SF: { chip: "bg-[#7c3aed] text-white border-transparent", dot: "bg-[#7c3aed]" },
  PF: { chip: "bg-[#c026d3] text-white border-transparent", dot: "bg-[#c026d3]" },
  C: { chip: "bg-[#475569] text-white border-transparent", dot: "bg-[#475569]" },
};

// Flex slots take a colour of their own rather than borrowing one of the
// positions they accept: a FLEX seat holding a WR is not a WR seat, and giving
// it the WR colour hides exactly the seat a manager is looking for.
const SLOT_TONES: Record<string, Tone> = {
  FLEX: { chip: "bg-[#374151] text-white border-transparent", dot: "bg-[#374151]" },
  SUPER_FLEX: { chip: "bg-[#6d28d9] text-white border-transparent", dot: "bg-[#6d28d9]" },
  REC_FLEX: { chip: "bg-[#155e75] text-white border-transparent", dot: "bg-[#155e75]" },
  WRRB_FLEX: { chip: "bg-[#155e75] text-white border-transparent", dot: "bg-[#155e75]" },
  IDP_FLEX: { chip: "bg-[#be185d] text-white border-transparent", dot: "bg-[#be185d]" },
  G: { chip: "bg-[#3730a3] text-white border-transparent", dot: "bg-[#3730a3]" },
  F: { chip: "bg-[#155e75] text-white border-transparent", dot: "bg-[#155e75]" },
  UTIL: { chip: "bg-[#6d28d9] text-white border-transparent", dot: "bg-[#6d28d9]" },
  BN: NEUTRAL,
  IR: { chip: "bg-red-900/30 text-red-300 border-red-700", dot: "bg-red-500" },
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

// For a table column three letters wide.
const SLOT_SHORT: Record<string, string> = {
  SUPER_FLEX: "SFLX",
  IDP_FLEX: "IDP",
  REC_FLEX: "REC",
  WRRB_FLEX: "W/R",
};

export function slotShort(slot: string): string {
  return SLOT_SHORT[slot] ?? slot;
}
