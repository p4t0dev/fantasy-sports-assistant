import type { WaiverMove } from "@/lib/types";
import { SwapCard } from "@/components/PageParts";
import { slotLabel } from "@/lib/positions";

/** Free agents who fill a hole in this week's lineup - alternatives, pick one.
 *  Only players who can be added right now, and only a drop that costs
 *  nothing beyond this week (see functions/api_core.week_fix_moves). */
export function WeekFixes({ fixes, week }: { fixes?: WaiverMove[]; week?: number | null }) {
  if (!fixes?.length) return null;
  return (
    <div className="space-y-2">
      <div className="eyebrow">
        Lückenfüller {week ? `W${week}` : "diese Woche"} ·{" "}
        {fixes.length > 1 ? "eine Option wählen" : "Free Agent, sofort holbar"}
      </div>
      {fixes.map((f) => (
        <SwapCard
          key={f.add.id}
          gain={`+${f.lineup_gain}`}
          sides={[
            {
              label: "Add",
              pos: f.add.pos,
              name: f.add.name,
              value: f.add.pts_week?.toFixed(1),
              below: (
                <span>
                  {f.add.team}
                  {f.out && ` → Startelf für ${f.out.name}`}
                  {f.out && f.slot ? ` (${slotLabel(f.slot)})` : ""}
                </span>
              ),
            },
            f.drop
              ? { label: "Drop", pos: f.drop.pos, name: f.drop.name, injury: f.drop.injury }
              : { label: "Drop", name: "keiner nötig, aktiver Platz frei" },
          ]}
        >
          <details className="text-[11px] text-muted">
            <summary className="cursor-pointer list-none select-none hover:text-ink">▸ Warum?</summary>
            <p className="mt-1">{f.reason}</p>
          </details>
        </SwapCard>
      ))}
    </div>
  );
}
