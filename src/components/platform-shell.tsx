"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Building2, LoaderCircle, LogOut, UsersRound } from "lucide-react";
import { authClient } from "@/lib/auth-client";
import { NexDriveMark } from "@/components/nexdrive-mark";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";

export type PlatformSection = "organizations" | "users";

export function PlatformShell({
  children,
  active,
}: {
  children: ReactNode;
  active: PlatformSection;
}) {
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);
  const [error, setError] = useState("");

  async function signOut() {
    setSigningOut(true);
    setError("");
    try {
      await authClient.signOut();
      router.replace("/platform/login");
      router.refresh();
    } catch {
      setError("Could not sign out. Please try again.");
      setSigningOut(false);
    }
  }

  return (
    <SidebarProvider>
      <Sidebar variant="sidebar" collapsible="icon">
        <SidebarHeader className="px-3 py-3 group-data-[collapsible=icon]:px-2">
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                size="lg"
                render={<Link href="/platform" aria-label="Platform administration home" />}
                className="h-12 gap-2.5 bg-transparent! hover:bg-transparent! group-data-[collapsible=icon]:justify-center"
              >
                <NexDriveMark className="gap-2 [&_svg]:size-7 [&_span]:text-[1.4rem] group-data-[collapsible=icon]:[&_span]:hidden" />
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarHeader>

        <SidebarContent className="pt-3">
          <SidebarGroup>
            <SidebarGroupLabel className="tracking-wider text-sidebar-foreground/50 uppercase">
              Platform administration
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    tooltip="Organizations"
                    render={<Link href="/platform" />}
                    isActive={active === "organizations"}
                    className="data-active:bg-primary/10!"
                  >
                    <Building2 />
                    <span>Organizations</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    tooltip="Users"
                    render={<Link href="/platform/users" />}
                    isActive={active === "users"}
                    className="data-active:bg-primary/10!"
                  >
                    <UsersRound />
                    <span>Users</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
      </Sidebar>

      <SidebarInset className="min-w-0 bg-background">
        <header className="sticky top-0 z-20 border-b bg-card">
          <div className="flex h-14 items-center gap-3 px-4 sm:px-6">
            <SidebarTrigger className="-ml-2 [&_svg]:size-5!" />
            <Separator orientation="vertical" className="h-4!" />
            <span className="text-sm font-medium">Platform administration</span>
            <div className="ml-auto flex items-center gap-3">
              {error ? <span role="alert" className="text-sm text-destructive">{error}</span> : null}
              <Button type="button" variant="outline" size="sm" onClick={() => void signOut()} disabled={signingOut}>
                {signingOut ? <LoaderCircle data-icon="inline-start" className="animate-spin" /> : <LogOut data-icon="inline-start" />}
                {signingOut ? "Signing out…" : "Sign out"}
              </Button>
            </div>
          </div>
        </header>
        {children}
      </SidebarInset>
    </SidebarProvider>
  );
}
