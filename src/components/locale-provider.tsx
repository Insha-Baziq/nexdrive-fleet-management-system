"use client";

import { createContext, useCallback, useContext, useLayoutEffect, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { DEFAULT_LOCALE, isAppLocale, LOCALE_STORAGE_KEY, translateText, type AppLocale } from "@/lib/locale";

const LocaleContext = createContext<{ locale: AppLocale; setLocale: (locale: AppLocale) => void }>({
  locale: DEFAULT_LOCALE,
  setLocale: () => {},
});

const originalText = new WeakMap<Text, { source: string; last: string }>();
const originalAttributes = new WeakMap<Element, Map<string, { source: string; last: string }>>();
const translatedAttributes = ["aria-label", "title", "placeholder", "alt", "data-placeholder"];
const pageTitles: Record<string, string> = {
  "/login": "Sign in", "/signup": "Sign up", "/signup/create": "Create organization",
  "/workspace": "Overview", "/vehicles": "Vehicles",
  "/drivers": "Drivers", "/assignments/quick": "Assignments",
  "/assignments/journal": "Assignment journal", "/assignments/lookup": "Historical lookup",
  "/anomalies": "Anomalies", "/fines": "Fines", "/claims": "Claims",
  "/my-vehicle": "My vehicle", "/my-documents": "My documents",
  "/settings/users": "Users", "/settings/invitations": "Invitations",
};

function titleForPath(pathname: string) {
  const section = Object.keys(pageTitles).find((path) => pathname.startsWith(`${path}/`) && ["/vehicles", "/drivers", "/anomalies", "/fines", "/claims"].includes(path));
  return `${section ? "Details" : pageTitles[pathname] ?? "NexDrive"} | NexDrive`;
}

function localizeNode(root: Node, locale: AppLocale) {
  if (root.nodeType === Node.TEXT_NODE) {
    const node = root as Text;
    if (node.parentElement?.closest("script, style, code, pre, [data-no-translate]")) return;
    const value = node.nodeValue ?? "";
    const previous = originalText.get(node);
    const source = previous && value === previous.last ? previous.source : value;
    const trimmed = source.trim();
    const translated = translateText(trimmed, locale);
    const next = trimmed === translated ? source : source.replace(trimmed, translated);
    originalText.set(node, { source, last: next });
    if (value !== next) node.nodeValue = next;
    return;
  }
  if (root.nodeType !== Node.ELEMENT_NODE) return;
  const element = root as Element;
  if (element.matches("script, style, code, pre, [data-no-translate]")) return;
  const attributes = originalAttributes.get(element) ?? new Map<string, { source: string; last: string }>();
  for (const name of translatedAttributes) {
    const value = element.getAttribute(name);
    if (value === null) continue;
    const previous = attributes.get(name);
    const source = previous && value === previous.last ? previous.source : value;
    const next = translateText(source, locale);
    attributes.set(name, { source, last: next });
    if (value !== next) element.setAttribute(name, next);
  }
  originalAttributes.set(element, attributes);
  for (const child of element.childNodes) localizeNode(child, locale);
}

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, updateLocale] = useState<AppLocale>(DEFAULT_LOCALE);
  const pathname = usePathname();

  const setLocale = useCallback((next: AppLocale) => {
    updateLocale(next);
    try { window.localStorage.setItem(LOCALE_STORAGE_KEY, next); } catch { /* Storage may be disabled. */ }
  }, []);

  useLayoutEffect(() => {
    try {
      const stored = window.localStorage.getItem(LOCALE_STORAGE_KEY);
      if (isAppLocale(stored)) queueMicrotask(() => updateLocale(stored));
    } catch { /* Keep the French default. */ }
    const onStorage = (event: StorageEvent) => {
      if (event.key === LOCALE_STORAGE_KEY) updateLocale(isAppLocale(event.newValue) ? event.newValue : DEFAULT_LOCALE);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  useLayoutEffect(() => {
    document.documentElement.lang = locale;
    document.title = translateText(titleForPath(pathname), locale);
    localizeNode(document.body, locale);
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        if (record.type === "characterData") localizeNode(record.target, locale);
        if (record.type === "attributes") localizeNode(record.target, locale);
        for (const node of record.addedNodes) localizeNode(node, locale);
      }
    });
    observer.observe(document.body, {
      subtree: true, childList: true, characterData: true, attributes: true,
      attributeFilter: translatedAttributes,
    });
    const titleObserver = new MutationObserver(() => {
      const title = document.head.querySelector("title");
      if (title) localizeNode(title, locale);
    });
    titleObserver.observe(document.head, { subtree: true, childList: true, characterData: true });
    return () => { observer.disconnect(); titleObserver.disconnect(); };
  }, [locale, pathname]);

  return <LocaleContext.Provider value={{ locale, setLocale }}>{children}</LocaleContext.Provider>;
}

export function useLocale() {
  return useContext(LocaleContext);
}
