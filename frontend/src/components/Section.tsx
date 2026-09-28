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
    try {
      const raw = window.localStorage.getItem(storageKey);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- a stored preference, read once after mount
      if (raw) setClosed(JSON.parse(raw));
    } catch {
      /* no storage: everything stays open */
    }
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
  accent,
  meta,
  summary,
  state,
  children,
}: {
  id: string;
  title: string;
  /** Tailwind background class of the bar in front of the title. */
  accent: string;
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
      className="group/section space-y-4 scroll-mt-20"
    >
      <summary className="cursor-pointer list-none select-none flex items-center gap-2 flex-wrap">
        <div className={`w-2 h-8 rounded-full ${accent}`}></div>
        <h2 className="text-xl font-bold text-white">{title}</h2>
        {meta && <span className="text-sm text-gray-500">{meta}</span>}
        <span className="ml-auto text-xs text-gray-500 group-open/section:hidden">
          Aufklappen ▸
        </span>
        <span className="ml-auto text-xs text-gray-500 hidden group-open/section:inline">
          Zuklappen ▾
        </span>
        {!open && summary && <div className="basis-full pl-4 text-xs text-gray-400">{summary}</div>}
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
    <nav className="sticky top-16 z-40 -mx-4 px-4 py-2 bg-gray-950/85 backdrop-blur border-b border-gray-800/60 flex flex-wrap items-center gap-2 text-xs">
      {items.map((item) => (
        <a
          key={item.id}
          href={`#${item.id}`}
          onClick={() => state.toggle(item.id, true)}
          className="px-2.5 py-1 rounded-md border border-gray-700 bg-gray-900 text-gray-300 hover:text-white"
        >
          {item.label}
        </a>
      ))}
      <span className="ml-auto flex gap-2">
        <button
          onClick={() => state.setAll(false)}
          className="px-2.5 py-1 rounded-md border border-gray-700 bg-gray-900 text-gray-400 hover:text-white"
        >
          Alle zu
        </button>
        <button
          onClick={() => state.setAll(true)}
          className="px-2.5 py-1 rounded-md border border-gray-700 bg-gray-900 text-gray-400 hover:text-white"
        >
          Alle auf
        </button>
      </span>
    </nav>
  );
}
