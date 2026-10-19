"use client";

import { useTheme } from "@/components/theme-provider";
import { Moon, Sun } from "lucide-react";
import { useLocale } from "@/components/locale-provider";

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const { locale } = useLocale();
  const french = locale === "fr";
  const dark = resolvedTheme === "dark";
  const lightLabel = french ? "Thème clair" : "Light theme";
  const darkLabel = french ? "Thème sombre" : "Dark theme";

  return (
    <div
      role="group"
      aria-label={french ? "Thème" : "Theme"}
      className="inline-flex items-center rounded-full border border-border bg-muted/60 p-0.5"
    >
      <button
        type="button"
        aria-label={lightLabel}
        aria-pressed={!dark}
        title={lightLabel}
        onClick={() => setTheme("light")}
        className={`flex h-7 min-w-11 items-center justify-center rounded-full px-3 py-1.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${!dark ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
      >
        <Sun className="size-4" aria-hidden="true" />
      </button>
      <button
        type="button"
        aria-label={darkLabel}
        aria-pressed={dark}
        title={darkLabel}
        onClick={() => setTheme("dark")}
        className={`flex h-7 min-w-11 items-center justify-center rounded-full px-3 py-1.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${dark ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
      >
        <Moon className="size-4" aria-hidden="true" />
      </button>
    </div>
  );
}
