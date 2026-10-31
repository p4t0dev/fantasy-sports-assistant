"use client";

import { useSyncExternalStore } from "react";
import {
  getThemePreference,
  getThemeServerPreference,
  setThemePreference,
  subscribeToTheme,
  type ThemePreference,
} from "@/lib/theme";

const OPTIONS: { value: ThemePreference; label: string; icon: React.ReactNode }[] = [
  {
    value: "light",
    label: "Hell",
    icon: (
      <>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6 7 7M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4" />
      </>
    ),
  },
  {
    value: "dark",
    label: "Dunkel",
    icon: <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z" />,
  },
  {
    value: "system",
    label: "Wie System",
    icon: (
      <>
        <rect x="3" y="4" width="18" height="13" rx="1" />
        <path d="M9 21h6M12 17v4" />
      </>
    ),
  },
];

/** Three settings, all visible: a toggle could not show that "system" exists. */
export default function ThemeSwitch() {
  const preference = useSyncExternalStore(subscribeToTheme, getThemePreference, getThemeServerPreference);
  return (
    <div role="radiogroup" aria-label="Darstellung" className="flex border border-line">
      {OPTIONS.map((option) => {
        const active = option.value === preference;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={option.label}
            title={option.label}
            onClick={() => setThemePreference(option.value)}
            className={`flex h-[42px] w-10 items-center justify-center ${
              active ? "bg-ink text-canvas" : "text-muted hover:text-ink"
            }`}
          >
            <svg className="h-[18px] w-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              {option.icon}
            </svg>
          </button>
        );
      })}
    </div>
  );
}
