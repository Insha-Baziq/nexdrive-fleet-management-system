"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function PlatformLoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await authClient.signIn.email({ email: email.trim(), password });
      if (result.error) throw new Error("Sign in failed.");

      const access = await fetch("/api/platform/access", { cache: "no-store" });
      if (!access.ok) {
        await authClient.signOut();
        setPassword("");
        setError("Platform access is unavailable for this account.");
        return;
      }
      router.replace("/platform");
      router.refresh();
    } catch {
      setPassword("");
      setError("Unable to sign in. Check your email and password.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-dvh items-center justify-center bg-background px-4 py-8 text-foreground">
      <section className="w-full max-w-sm rounded-xl border bg-card p-6 shadow-sm sm:p-8" aria-labelledby="platform-login-title">
        <h1 id="platform-login-title" className="text-xl font-semibold tracking-tight">Platform login</h1>
        <form method="post" className="mt-6 flex flex-col gap-5" onSubmit={onSubmit}>
          <div className="space-y-2">
            <Label htmlFor="platform-email">Email address</Label>
            <Input
              id="platform-email"
              name="email"
              type="email"
              autoComplete="username"
              autoFocus
              required
              value={email}
              disabled={busy}
              onChange={(event) => setEmail(event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="platform-password">Password</Label>
            <Input
              id="platform-password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              disabled={busy}
              onChange={(event) => setPassword(event.target.value)}
            />
          </div>
          {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}
          <Button type="submit" disabled={busy} className="w-full">
            {busy ? "Signing in…" : "Sign in"}
          </Button>
        </form>
      </section>
    </main>
  );
}
