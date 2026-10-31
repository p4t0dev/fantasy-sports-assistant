import type { Injury, LineupChange, Player } from "@/lib/types";
import { InjuryBadge, MatchupBadge, PosBadge, startPts } from "@/components/PlayerBadges";
import { ForecastDelta, ForecastDetail } from "@/components/ForecastDetail";

// The parts every view is built from, taken from the lineup page: a headline
// with one action, a bar of big numbers, swaps with what they bring on a yellow
// block, and players in an edge-to-edge table. Colour is kept for what needs
// doing and for how bad something is.

/** Edge to edge on a phone: every pixel goes to the player's name. */
export const TABLE = "panel overflow-hidden -mx-4 sm:mx-0 border-x-0 sm:border-x";

export function Spinner() {
  return (
    <div className="flex justify-center items-center h-64">
      <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-ink"></div>
    </div>
  );
}

export function RefreshButton({ busy, onClick }: { busy: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      disabled={busy}
      aria-label="Neu laden"
      title="Neu laden"
      className="w-11 h-11 shrink-0 flex items-center justify-center border border-line text-ink disabled:opacity-50"
    >
      <svg
        className={`h-5 w-5 ${busy ? "animate-spin" : ""}`}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M20 11a8 8 0 1 0-2.3 6.3" />
        <path d="M20 4v7h-7" />
      </svg>
    </button>
  );
}

export function PageHead({
  title,
  sub,
  action,
}: {
  title: React.ReactNode;
  sub?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="min-w-0">
        <h1 className="headline">{title}</h1>
        {sub && <p className="text-sm text-muted mt-1">{sub}</p>}
      </div>
      {action}
    </div>
  );
}

export type ScoreTile = {
  label: string;
  value: React.ReactNode;
  /** The tile to act on, in the colour of changes. */
  hot?: boolean;
};

export function ScoreBar({ label, tiles }: { label: string; tiles: ScoreTile[] }) {
  return (
    <section
      aria-label={label}
      className="grid bg-bar text-bar-ink"
      style={{ gridTemplateColumns: `repeat(${tiles.length}, minmax(0, 1fr))` }}
    >
      {tiles.map((tile, i) => (
        <div
          key={tile.label}
          className={`min-w-0 px-3 pt-2.5 pb-2 ${
            tile.hot ? "bg-highlight text-on-highlight" : i > 0 ? "border-l border-bar-line" : ""
          }`}
        >
          <div className="text-xs font-semibold tracking-wider uppercase truncate">{tile.label}</div>
          <div className="display text-[40px] mt-0.5">{tile.value}</div>
        </div>
      ))}
    </section>
  );
}

export type SwapSide = {
  /** "Rein", "Raus", "Add", "Drop". */
  label: string;
  pos?: string | null;
  name: string;
  injury?: Injury | null;
  /** At the end of the line: his number. */
  value?: React.ReactNode;
  /** Right behind the name. */
  tag?: React.ReactNode;
  /** Under the line. */
  below?: React.ReactNode;
};

function SwapLine({ side, lead }: { side: SwapSide; lead: boolean }) {
  return (
    <div>
      <div className={`flex items-center gap-2 ${lead ? "" : "text-muted"}`}>
        <span className={`w-9 shrink-0 text-xs font-bold uppercase tracking-wide ${lead ? "text-change-ink" : ""}`}>
          {side.label}
        </span>
        <PosBadge pos={side.pos} />
        <span className={`truncate ${lead ? "font-display font-bold text-xl leading-tight text-ink" : "text-[15px]"}`}>
          {side.name}
        </span>
        <InjuryBadge injury={side.injury} short />
        {side.tag}
        {side.value != null && (
          <span className={`ml-auto shrink-0 text-sm text-right ${lead ? "font-semibold text-ink" : ""}`}>
            {side.value}
          </span>
        )}
      </div>
      {side.below && <div className="pl-11 mt-1 flex flex-col items-start gap-1 text-xs text-muted">{side.below}</div>}
    </div>
  );
}

/** One move: who comes in, who goes, what it brings. `quiet` for a move that
 *  can wait: the yellow means this one changes the score now. */
export function SwapCard({
  sides,
  gain,
  unit,
  quiet = false,
  children,
}: {
  sides: SwapSide[];
  gain?: string | null;
  /** Under the gain, where it is not lineup points. */
  unit?: string | null;
  quiet?: boolean;
  /** Under the two sides: why, what it costs. */
  children?: React.ReactNode;
}) {
  return (
    <div className={`flex items-stretch ${quiet ? "bg-surface" : "bg-change"}`}>
      <div className="flex-1 min-w-0 px-3 py-2.5 space-y-1.5">
        {sides.map((side, i) => (
          <SwapLine key={side.label} side={side} lead={i === 0} />
        ))}
        {children}
      </div>
      {gain != null && (
        <div
          className={`min-w-16 px-2 shrink-0 flex flex-col items-center justify-center ${
            quiet ? "bg-raised text-ink" : "bg-highlight text-on-highlight"
          }`}
        >
          <span className="display text-[26px]">{gain}</span>
          {unit && <span className="mt-0.5 text-[10px] font-semibold">{unit.replace("Woche", "Wo")}</span>}
        </div>
      )}
    </div>
  );
}

/** A lineup change as a swap. `detail` adds what the week view shows on top:
 *  the opponent, the gap to Sleeper and how the number came about. */
export function LineupSwap({ change, detail = false }: { change: LineupChange; detail?: boolean }) {
  const out = change.out;
  // NBA Lock-In: whoever goes out could still lock the game he has played, so
  // the swap has to beat that as well. Against his remaining games alone the
  // card promised more than the total above it.
  const outPts = out ? Math.max(startPts(out), out.lock?.score ?? 0) : 0;
  const gain = out ? startPts(change.in) - outPts : null;
  const side = (player: Player, label: string, pts: number): SwapSide => ({
    label,
    pos: player.pos,
    name: player.name,
    injury: player.injury,
    value: detail ? (
      <span className="flex flex-col items-end">
        {pts}
        <ForecastDelta player={player} />
      </span>
    ) : (
      pts
    ),
    // Under the line, not next to the name: on a phone the name needs the room.
    below: detail ? (
      <>
        <MatchupBadge player={player} />
        <ForecastDetail player={player} />
      </>
    ) : undefined,
  });
  return (
    <SwapCard
      sides={[side(change.in, "Rein", startPts(change.in)), ...(out ? [side(out, "Raus", outPts)] : [])]}
      gain={gain != null ? `${gain > 0 ? "+" : ""}${gain.toFixed(1)}` : null}
    />
  );
}

/** Position, player, our number, a second number. */
const BOARD = "grid grid-cols-[2.75rem_minmax(0,1fr)_3.25rem_3rem] gap-x-2 px-3";

export function BoardHead({ first, stats }: { first: string; stats: [string, string] }) {
  return (
    <div aria-hidden="true" className={`${BOARD} py-1.5 text-[11px] font-semibold tracking-wide text-muted border-b border-line`}>
      <span>{first}</span>
      <span>SPIELER</span>
      <span className="text-right">{stats[0]}</span>
      <span className="text-right">{stats[1]}</span>
    </div>
  );
}

export function BoardRow({
  chip,
  name,
  injury,
  tag,
  sub,
  stats,
  below,
  tint = "",
}: {
  chip: React.ReactNode;
  name: string;
  injury?: Injury | null;
  /** Behind the name. */
  tag?: React.ReactNode;
  sub?: React.ReactNode;
  stats: [React.ReactNode, React.ReactNode];
  /** The full width of the row: signals, forecast. */
  below?: React.ReactNode;
  tint?: string;
}) {
  return (
    <div className={`${BOARD} items-center py-2 border-b border-line last:border-b-0 ${tint}`}>
      {chip}
      <div className="min-w-0">
        <div className="font-display font-semibold text-lg leading-tight text-ink flex items-center gap-1.5">
          <span className="truncate">{name}</span>
          <InjuryBadge injury={injury} short />
          {tag}
        </div>
        {sub && <div className="text-[13px] text-muted flex items-center gap-1.5 flex-wrap">{sub}</div>}
      </div>
      <span className="display text-right text-xl">{stats[0]}</span>
      <span className="text-right text-sm text-muted">{stats[1]}</span>
      <div className="col-span-full empty:hidden">{below}</div>
    </div>
  );
}
