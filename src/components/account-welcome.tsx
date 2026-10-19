"use client";

import { reloadOrganizationWorkspace } from "@/lib/invitation-navigation";

import Link from "next/link";
import { useState } from "react";
import { Building2 } from "lucide-react";
import type { Membership } from "@/lib/organization-session";
import { useLocale } from "@/components/locale-provider";
import { postOnboarding } from "@/lib/onboarding-client";
import { Button } from "@/components/ui/button";
import { SignOutButton } from "@/components/sign-out-button";
import { JoinOrganizationDialog } from "@/components/join-organization-dialog";

export function AccountWelcome({ name, memberships }: { name: string; memberships: Membership[] }) {
  const { locale } = useLocale();
  const fr = locale === "fr";
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [joinOpen, setJoinOpen] = useState(false);
  async function select(tenantId: string) {
    setBusy(true); setError("");
    try { await postOnboarding("/api/organizations", { tenantId }); reloadOrganizationWorkspace(); }
    catch { setError(fr ? "Organisation indisponible." : "Organization unavailable."); setBusy(false); }
  }
  return <div>
    <h1 className="text-3xl font-semibold tracking-tight">{fr ? "Bienvenue, " : "Welcome, "}<span data-no-translate>{name}</span></h1>
    <p className="mt-3 text-muted-foreground">{fr ? "Rejoignez une organisation avec une invitation ou créez la vôtre." : "Join an organization with an invitation or create your own."}</p>
    {memberships.length ? <div className="mt-8 space-y-3">{memberships.map((item) => <Button key={item.tenantId} variant="outline" disabled={busy || item.disabled} className="h-auto w-full justify-start whitespace-normal py-4 text-left" onClick={() => select(item.tenantId)}><Building2 /><span><span data-no-translate>{item.organizationName}</span>{item.disabled ? <span className="block text-xs text-muted-foreground">{fr ? "Accès suspendu. Contactez votre administrateur." : "Access suspended. Contact your administrator."}</span> : null}</span></Button>)}</div> : null}
    <div className="mt-8 grid gap-3 sm:grid-cols-2"><Button className="h-12" onClick={() => setJoinOpen(true)}>{fr ? "Rejoindre une organisation" : "Join an organization"}</Button><Button variant="outline" className="h-12" nativeButton={false} render={<Link href="/signup/create" />}>{fr ? "Créer une organisation" : "Create an organization"}</Button></div>
    {error ? <p role="alert" className="mt-4 text-sm text-destructive">{error}</p> : null}
    <div className="mt-8 border-t pt-6"><SignOutButton /></div>
    <JoinOrganizationDialog open={joinOpen} onOpenChange={setJoinOpen} />
  </div>;
}
