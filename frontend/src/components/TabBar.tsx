"use client";

import { useSyncExternalStore } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  getLastLeagueServerSnapshot,
  getLastLeagueSnapshot,
  parseLastLeague,
  subscribeToLastLeague,
} from "@/lib/lastLeague";

/** The app's main sections: in the header on a wide screen, at the bottom on
 *  a phone, where the thumb is. */
export default function TabBar({ placement }: { placement: "top" | "bottom" }) {
  const pathname = usePathname();
  const raw = useSyncExternalStore(subscribeToLastLeague, getLastLeagueSnapshot, getLastLeagueServerSnapshot);
  const last = parseLastLeague(raw);
  const league = last ? `?${new URLSearchParams(last)}` : null;

  const tabs = [
    { path: "/", label: "Ligen", href: "/" },
    {
      path: "/overview",
      label: "Woche",
      href: last ? `/overview?${new URLSearchParams({ username: last.username, sport: last.sport })}` : "/overview",
    },
    { path: "/lineup", label: "Lineup", href: league ? `/lineup${league}` : "/" },
    { path: "/waivers", label: "Waiver", href: league ? `/waivers${league}` : "/" },
    { path: "/prognose", label: "Modell", href: "/prognose" },
  ];

  const links = tabs.map((tab) => {
    const active = pathname === tab.path;
    return (
      <Link
        key={tab.path}
        href={tab.href}
        aria-current={active ? "page" : undefined}
        className={`flex items-center justify-center font-display text-[17px] uppercase ${
          placement === "bottom" ? "h-[60px] border-t-[3px]" : "h-14 border-b-[3px] px-3"
        } ${active ? "border-highlight font-bold text-ink" : "border-transparent font-semibold text-muted hover:text-ink"}`}
      >
        {tab.label}
      </Link>
    );
  });

  if (placement === "top") {
    return (
      <nav aria-label="Hauptnavigation" className="hidden sm:flex">
        {links}
      </nav>
    );
  }
  return (
    <nav
      aria-label="Hauptnavigation"
      className="sm:hidden fixed inset-x-0 bottom-0 z-50 grid grid-cols-5 bg-canvas border-t border-line pb-[env(safe-area-inset-bottom)]"
    >
      {links}
    </nav>
  );
}
