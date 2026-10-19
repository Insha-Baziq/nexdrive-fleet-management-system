"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export function WorkspacePresence() {
  const router = useRouter();
  useEffect(() => {
    async function heartbeat() {
      if (document.visibilityState !== "visible") return;
      try {
        const response = await fetch("/api/presence", { method: "POST", headers: { "content-type": "application/json" }, body: "{}", cache: "no-store" });
        if (response.status === 401) router.replace("/login");
      } catch { /* The next heartbeat retries after a transient connection failure. */ }
    }
    void heartbeat();
    const timer = window.setInterval(() => { void heartbeat(); }, 60_000);
    const onVisible = () => { void heartbeat(); };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [router]);
  return null;
}
