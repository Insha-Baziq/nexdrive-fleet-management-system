"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ChevronsUpDown, LoaderCircle, LogOut, UserRound } from "lucide-react";
import { authClient } from "@/lib/auth-client";
import { useLocale } from "@/components/locale-provider";
import type { Membership } from "@/lib/organization-session";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuGroup,
  DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SidebarMenuButton } from "@/components/ui/sidebar";
import { LanguageToggle } from "@/components/language-toggle";
import { ThemeToggle } from "@/components/theme-toggle";
import { OrganizationSwitcher } from "@/components/organization-switcher";
import { JoinOrganizationDialog } from "@/components/join-organization-dialog";

export function WorkspaceAccountMenu({ userName, roleName }: { userName: string; roleName: string }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [joinOpen, setJoinOpen] = useState(false);
  const [organizations, setOrganizations] = useState<Membership[]>([]);
  const [activeTenantId, setActiveTenantId] = useState<string | null>(null);
  const [organizationsReady, setOrganizationsReady] = useState(false);
  const [organizationsUnavailable, setOrganizationsUnavailable] = useState(false);
  const [loadingOrganizations, setLoadingOrganizations] = useState(false);
  const organizationsRequest = useRef<Promise<void> | null>(null);
  const router = useRouter();
  const { locale } = useLocale();
  const french = locale === "fr";
  const translatedRoles: Record<string, string> = {
    Administrator: "Administrateur",
    "Fleet Manager": "Gestionnaire de flotte",
    Manager: "Gestionnaire",
    Driver: "Conducteur",
  };
  const localizedRole = french ? translatedRoles[roleName] ?? roleName : roleName;
  const initials = userName.trim().split(/\s+/).slice(0, 2).map((word) => word[0]?.toUpperCase()).join("");

  const loadOrganizations = useCallback(() => {
    if (organizationsReady) return Promise.resolve();
    if (organizationsRequest.current) return organizationsRequest.current;

    setLoadingOrganizations(true);
    const request = fetch("/api/organizations", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Could not load organizations.");
        return response.json() as Promise<{ organizations: Membership[]; activeTenantId: string | null }>;
      })
      .then((data) => {
        if (!Array.isArray(data.organizations)) throw new Error("Organization list is unavailable.");
        setOrganizations(data.organizations);
        setActiveTenantId(data.activeTenantId);
      })
      .catch(() => setOrganizationsUnavailable(true))
      .finally(() => {
        setOrganizationsReady(true);
        setLoadingOrganizations(false);
        organizationsRequest.current = null;
      });

    organizationsRequest.current = request;
    return request;
  }, [organizationsReady]);

  useEffect(() => {
    void loadOrganizations();
  }, [loadOrganizations]);

  function handleMenuOpenChange(nextOpen: boolean) {
    if (!nextOpen) {
      setMenuOpen(false);
      return;
    }
    if (organizationsReady) {
      setMenuOpen(true);
      return;
    }
    void loadOrganizations().finally(() => setMenuOpen(true));
  }

  async function signOut() {
    await authClient.signOut();
    router.replace("/login");
    router.refresh();
  }

  return <>
    <DropdownMenu open={menuOpen} onOpenChange={handleMenuOpenChange}>
      <DropdownMenuTrigger render={<SidebarMenuButton size="lg" className="h-auto min-h-11 gap-2.5 px-2 group-data-[collapsible=icon]:justify-center" aria-label={french ? "Menu du compte" : "Account menu"} tooltip={`${userName} · ${localizedRole}`} />}>
        <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary" aria-hidden="true">{initials}</span>
        <span className="min-w-0 flex-1 text-left leading-tight group-data-[collapsible=icon]:hidden">
          <span className="block truncate text-xs font-semibold" data-no-translate>{userName}</span>
        <span className="block truncate text-[11px] font-normal text-muted-foreground">{localizedRole}</span>
        </span>
        {loadingOrganizations ? <LoaderCircle className="size-3.5 shrink-0 animate-spin text-muted-foreground group-data-[collapsible=icon]:hidden" aria-hidden="true" /> : <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground group-data-[collapsible=icon]:hidden" />}
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="min-w-56">
        <DropdownMenuGroup>
          <DropdownMenuLabel><span data-no-translate>{userName}</span><span className="block font-normal">{localizedRole}</span></DropdownMenuLabel>
          <DropdownMenuSeparator />
          <OrganizationSwitcher
            organizations={organizations}
            activeTenantId={activeTenantId}
            organizationsUnavailable={organizationsUnavailable}
            onJoinOrganization={() => setJoinOpen(true)}
          />
          <DropdownMenuItem render={<Link href="/settings/profile" />}><UserRound />{french ? "Mon profil" : "My profile"}</DropdownMenuItem>
          <div className="flex items-center justify-between gap-3 px-2 py-1.5 text-sm">
            <span>{french ? "Langue" : "Language"}</span><LanguageToggle />
          </div>
          <div className="flex items-center justify-between gap-3 px-2 py-1.5 text-sm">
            <span>{french ? "Thème" : "Theme"}</span><ThemeToggle />
          </div>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={signOut}><LogOut /> {french ? "Se déconnecter" : "Sign out"}</DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
    <JoinOrganizationDialog open={joinOpen} onOpenChange={setJoinOpen} />
  </>;
}
