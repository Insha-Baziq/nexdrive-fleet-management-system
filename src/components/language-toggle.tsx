"use client";

import { useLocale } from "@/components/locale-provider";

export function LanguageToggle({ className = "" }: { className?: string }) {
  const { locale, setLocale } = useLocale();
  return (
    <div role="group" aria-label={locale === "fr" ? "Langue" : "Language"} className={`inline-flex items-center rounded-full border border-border bg-card p-0.5 ${className}`}>
      {(["fr", "en"] as const).map((option) => (
        <button
          key={option}
          type="button"
          lang={option}
          aria-pressed={locale === option}
          aria-label={option === "fr" ? "Français" : "English"}
          onClick={() => setLocale(option)}
          className={`min-w-11 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${locale === option ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
        >
          {option === "fr" ? "FR" : "EN"}
        </button>
      ))}
    </div>
  );
}
