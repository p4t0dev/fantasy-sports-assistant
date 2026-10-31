import type { WaiverMove } from "@/lib/types";
import { InjuryBadge, PosBadge } from "@/components/PlayerBadges";
import { slotLabel } from "@/lib/positions";

/** Free agents who fill a hole in this week's lineup - alternatives, pick one.
 *  Only players who can be added right now, and only a drop that costs
 *  nothing beyond this week (see functions/api_core.week_fix_moves). */
export function WeekFixes({ fixes, week }: { fixes?: WaiverMove[]; week?: number | null }) {
  if (!fixes?.length) return null;
  return (
    <div className="rounded-md border border-emerald-800/60 bg-emerald-950/20 p-3 space-y-2">
      <div className="text-[10px] font-bold uppercase tracking-wider text-emerald-300">
        Lückenfüller {week ? `W${week}` : "diese Woche"} ·{" "}
        {fixes.length > 1 ? "eine Option wählen" : "Free Agent, sofort holbar"}
      </div>
      {fixes.map((f) => (
        <div key={f.add.id} className="text-sm space-y-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-[10px] font-bold text-green-400">ADD</span>
            <PosBadge pos={f.add.pos} />
            <span className="text-ink">{f.add.name}</span>
            <span className="text-[10px] text-muted">{f.add.team}</span>
            {f.add.pts_week != null && (
              <span className="text-muted">{f.add.pts_week.toFixed(1)}</span>
            )}
            {f.out && (
              <span className="text-muted">
                → Startelf für {f.out.name}
                {f.slot ? ` (${slotLabel(f.slot)})` : ""}
              </span>
            )}
            <span className="text-green-400 font-bold">+{f.lineup_gain}</span>
          </div>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
            <span className="text-[10px] font-bold text-red-400">DROP</span>
            {f.drop ? (
              <>
                <PosBadge pos={f.drop.pos} />
                <span className="text-muted">{f.drop.name}</span>
                <InjuryBadge injury={f.drop.injury} />
              </>
            ) : (
              <span className="text-muted">keiner nötig, aktiver Platz frei</span>
            )}
          </div>
          <details className="text-[11px] text-muted">
            <summary className="cursor-pointer list-none select-none hover:text-ink">▸ Warum?</summary>
            <p className="mt-1">{f.reason}</p>
          </details>
        </div>
      ))}
    </div>
  );
}
