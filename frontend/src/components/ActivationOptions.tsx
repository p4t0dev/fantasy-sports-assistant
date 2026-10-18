import type { ActivationOption } from "@/lib/types";
import { InjuryBadge, PosBadge, startPts } from "@/components/PlayerBadges";
import { slotLabel } from "@/lib/positions";

export const STASH_LABEL: Record<string, string> = { taxi: "Taxi", ir: "IR" };

export function StashBadge({ stash }: { stash?: string | null }) {
  if (!stash) return null;
  return (
    <span className="text-[10px] px-1.5 py-0.5 rounded font-bold uppercase border bg-gray-800 text-gray-300 border-gray-600">
      {STASH_LABEL[stash] ?? stash}
    </span>
  );
}

/** Taxi or IR players who would help this week - shown apart from the swaps,
 *  because bringing one up is a roster decision (a drop, maybe a taxi seat
 *  lost for the season), not a click in the lineup. */
export function ActivationOptions({ options }: { options?: ActivationOption[] }) {
  if (!options?.length) return null;
  return (
    <div className="rounded-md border border-dashed border-gray-700 bg-gray-900/40 p-3 space-y-2">
      <div className="text-[10px] font-bold uppercase tracking-wider text-gray-400">
        Option mit Kaderzug · nicht in „optimal“ enthalten
      </div>
      {options.map((o) => (
        <div key={o.player.id} className="text-sm space-y-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <StashBadge stash={o.from} />
            <PosBadge pos={o.player.pos} />
            <span className="text-white">{o.player.name}</span>
            <span className="text-gray-400">{startPts(o.player)}</span>
            {o.out && (
              <span className="text-gray-500">
                → Startelf für {o.out.name}
                {o.slot ? ` (${slotLabel(o.slot)})` : ""}
              </span>
            )}
            <span className="text-green-400 font-bold">+{o.gain}</span>
          </div>
          {o.drop && (
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
              <span className="text-[10px] font-bold text-red-400">DROP</span>
              <PosBadge pos={o.drop.pos} />
              <span className="text-gray-400">{o.drop.name}</span>
              <span className="text-[10px] text-gray-500">{o.drop.team || "ohne Team"}</span>
              <InjuryBadge injury={o.drop.injury} />
            </div>
          )}
          <ul className="text-xs text-gray-400 space-y-0.5">
            {o.caveats.map((c, i) => (
              <li key={i} className={o.permanent && c.includes("Deadline") ? "text-orange-300" : ""}>
                {c}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
