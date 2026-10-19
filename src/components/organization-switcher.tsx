"use client";

import { reloadOrganizationWorkspace } from "@/lib/invitation-navigation";

import { useState } from "react";
import Link from "next/link";
import { Building2, Check, Plus, UserPlus } from "lucide-react";
import type { Membership } from "@/lib/organization-session";
import { useLocale } from "@/components/locale-provider";
import { postOnboarding } from "@/lib/onboarding-client";
import { DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";

const roles: Record<string, [string, string]> = { administrator: ["Administrateur", "Administrator"], fleet_manager: ["Responsable de flotte", "Fleet Manager"], manager: ["Gestionnaire", "Manager"], driver: ["Conducteur", "Driver"] };

export function OrganizationSwitcher({
  organizations,
  activeTenantId,
  organizationsUnavailable,
  onJoinOrganization,
}: {
  organizations: Membership[];
  activeTenantId: string | null;
  organizationsUnavailable: boolean;
  onJoinOrganization: () => void;
}) {
  const { locale } = useLocale();
  const fr = locale === "fr";
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function select(tenantId: string) {
    setBusy(true); setError("");
    try { await postOnboarding("/api/organizations", { tenantId }); reloadOrganizationWorkspace(); }
    catch { setError(fr ? "Impossible de changer d’organisation." : "Unable to switch organizations."); setBusy(false); }
  }
  return <>
    <DropdownMenuLabel>{fr ? "Vos organisations" : "Your organizations"}</DropdownMenuLabel>
    {organizations.map((item) => <DropdownMenuItem key={item.tenantId} closeOnClick={false} disabled={busy || item.disabled} onClick={() => select(item.tenantId)}>
      <Building2 className="shrink-0" /><span className="min-w-0 flex-1"><span className="block truncate" data-no-translate>{item.organizationName}</span><span className="block text-xs text-muted-foreground">{roles[item.role]?.[fr ? 0 : 1]}{item.disabled ? (fr ? " · Accès suspendu" : " · Suspended") : ""}</span></span>{item.tenantId === activeTenantId ? <Check aria-label={fr ? "Organisation actuelle" : "Current organization"} /> : null}
    </DropdownMenuItem>)}
    {busy ? <p role="status" className="px-2 text-xs text-muted-foreground">{fr ? "Changement d’organisation…" : "Switching organization…"}</p> : null}
    {organizationsUnavailable ? <p role="alert" className="px-2 text-xs text-destructive">{fr ? "Organisations indisponibles." : "Organizations unavailable."}</p> : null}
    {error ? <p role="alert" className="px-2 text-xs text-destructive">{error}</p> : null}
    <DropdownMenuItem onClick={onJoinOrganization}><UserPlus />{fr ? "Rejoindre une organisation" : "Join an organization"}</DropdownMenuItem>
    <DropdownMenuItem render={<Link href="/signup/create" />}><Plus />{fr ? "Créer une organisation" : "Create an organization"}</DropdownMenuItem>
    <DropdownMenuSeparator />
  </>;
}
