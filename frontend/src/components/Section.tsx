"use client";

import { useCallback, useEffect, useState } from "react";

// Collapsible page sections. A long page used to mean scrolling past the
// same four blocks every visit to reach the fifth; each block now folds
// away, and the page remembers which ones you folded - in this browser only,
// it is a reading preference, not data.

export type SectionState = {
  open: (id: string) => boolean;
  toggle: (id: string, open: boolean) => void;
  setAll: (open: boolean) => void;
};

/** Open/closed per section id, remembered in localStorage under `storageKey`. */
export function useSections(storageKey: string, ids: string[]): SectionState {
  const [closed, setClosed] = useState<Record<string, boolean>>({});

  // Read after mount: the static page renders every section open, and the
  // stored preference is applied once the browser is known.
  useEffect(() => {
    let stored: Record<string, boolean> = {};
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (raw) stored = JSON.parse(raw);
    } catch {
      /* no storage: everything stays open */
    }
    // A link to "#waiver" means: show me that section - folded or not.
    const target = window.location.hash.slice(1);
    if (target && target in stored) stored = { ...stored, [target]: false };
    // eslint-disable-next-line react-hooks/set-state-in-effect -- a stored preference, read once after mount
    setClosed(stored);
  }, [storageKey]);

  const save = useCallback(
    (next: Record<string, boolean>) => {
      try {
        window.localStorage.setItem(storageKey, JSON.stringify(next));
      } catch {
        /* not remembered, still works */
      }
    },
    [storageKey],
  );

  const toggle = useCallback(
    (id: string, open: boolean) =>
      setClosed((prev) => {
        if (!!prev[id] === !open) return prev;
        const next = { ...prev, [id]: !open };
        save(next);
        return next;
      }),
    [save],
  );

  const setAll = useCallback(
    (open: boolean) => {
      const next = Object.fromEntries(ids.map((id) => [id, !open]));
      setClosed(next);
      save(next);
    },
    [ids, save],
  );

  return { open: (id) => !closed[id], toggle, setAll };
}

export function Section({
  id,
  title,
  meta,
  summary,
  state,
  children,
}: {
  id: string;
  title: string;
  /** Next to the title, always visible (counts, totals). */
  meta?: React.ReactNode;
  /** Shown only while folded: what is in here, so it need not be opened to know. */
  summary?: React.ReactNode;
  state: SectionState;
  children: React.ReactNode;
}) {
  const open = state.open(id);
  return (
    <details
      id={id}
      open={open}
      onToggle={(e) => state.toggle(id, (e.currentTarget as HTMLDetailsElement).open)}
      className="group/section space-y-4 scroll-mt-[calc(7rem+env(safe-area-inset-top))]"
    >
      <summary className="cursor-pointer list-none select-none flex items-center gap-2 flex-wrap">
        <h2 className="headline">{title}</h2>
        {meta && <span className="text-sm text-muted">{meta}</span>}
        <span className="ml-auto text-xs text-muted group-open/section:hidden">
          Aufklappen ▸
        </span>
        <span className="ml-auto text-xs text-muted hidden group-open/section:inline">
          Zuklappen ▾
        </span>
        {!open && summary && <div className="basis-full text-xs text-muted">{summary}</div>}
      </summary>
      {children}
    </details>
  );
}

/** Jump links to every section, and fold or unfold them all at once. */
export function SectionNav({
  items,
  state,
}: {
  items: { id: string; label: string }[];
  state: SectionState;
}) {
  return (
    // One line, under the header in the app as well: a nav of two lines covered
    // the headline of the section it had just jumped to.
    <nav className="sticky top-[calc(3.5rem+env(safe-area-inset-top))] z-40 -mx-4 sm:mx-0 px-4 sm:px-0 py-2 bg-canvas/85 backdrop-blur border-b border-line/60 flex items-center gap-2 text-xs overflow-x-auto whitespace-nowrap">
      {items.map((item) => (
        <a
          key={item.id}
          href={`#${item.id}`}
          onClick={() => state.toggle(item.id, true)}
          className="shrink-0 px-2.5 py-1 rounded-md border border-line bg-surface text-ink-soft hover:text-ink"
        >
          {item.label}
        </a>
      ))}
      <span className="ml-auto shrink-0 flex gap-2">
        <button
          onClick={() => state.setAll(false)}
          className="px-2.5 py-1 rounded-md border border-line bg-surface text-muted hover:text-ink"
        >
          Alle zu
        </button>
        <button
          onClick={() => state.setAll(true)}
          className="px-2.5 py-1 rounded-md border border-line bg-surface text-muted hover:text-ink"
        >
          Alle auf
        </button>
      </span>
    </nav>
  );
}
