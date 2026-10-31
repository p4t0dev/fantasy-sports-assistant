import type { ActivationOption } from "@/lib/types";
import { SwapCard } from "@/components/PageParts";
import { startPts } from "@/components/PlayerBadges";
import { slotLabel } from "@/lib/positions";

export const STASH_LABEL: Record<string, string> = { taxi: "Taxi", ir: "IR" };

export function StashBadge({ stash }: { stash?: string | null }) {
  if (!stash) return null;
  return (
    <span className="text-[10px] px-1.5 py-0.5 rounded font-bold uppercase border bg-raised text-ink-soft border-line">
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
    <div className="space-y-2">
      <div className="eyebrow">Option mit Kaderzug · nicht in „optimal“ enthalten</div>
      {options.map((o) => (
        <SwapCard
          key={o.player.id}
          quiet
          gain={`+${o.gain}`}
          sides={[
            {
              label: "Rein",
              pos: o.player.pos,
              name: o.player.name,
              tag: <StashBadge stash={o.from} />,
              value: startPts(o.player),
              below: o.out && (
                <>
                  → Startelf für {o.out.name}
                  {o.slot ? ` (${slotLabel(o.slot)})` : ""}
                </>
              ),
            },
            ...(o.drop
              ? [
                  {
                    label: "Drop",
                    pos: o.drop.pos,
                    name: o.drop.name,
                    injury: o.drop.injury,
                    below: o.drop.team || "ohne Team",
                  },
                ]
              : []),
          ]}
        >
          <ul className="text-xs text-muted space-y-0.5">
            {o.caveats.map((c, i) => (
              <li key={i} className={o.permanent && c.includes("Deadline") ? "text-orange-300" : ""}>
                {c}
              </li>
            ))}
          </ul>
        </SwapCard>
      ))}
    </div>
  );
}
