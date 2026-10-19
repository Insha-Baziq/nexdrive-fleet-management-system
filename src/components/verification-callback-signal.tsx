"use client";

import { useEffect } from "react";
import { completedVerificationAttemptKey, pendingVerificationAttemptKey } from "@/lib/verification-status";

export function VerificationCallbackSignal({ attempt }: { attempt?: string }) {
  useEffect(() => {
    if (!attempt || !/^[0-9a-f-]{36}$/i.test(attempt)) return;
    if (localStorage.getItem(pendingVerificationAttemptKey) !== attempt) return;
    localStorage.setItem(completedVerificationAttemptKey(attempt), attempt);
  }, [attempt]);

  return null;
}
