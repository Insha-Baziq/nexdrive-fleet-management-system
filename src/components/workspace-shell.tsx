"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { BookOpenText, Building2, CarFront, FileText, LayoutDashboard, Link2, Search, TriangleAlert, UsersRound, ShieldAlert } from "lucide-react";
import { NexDriveMark } from "@/components/nexdrive-mark";
import { WorkspaceAccountMenu } from "@/components/workspace-account-menu";
import { WorkspacePresence } from "@/components/workspace-presence";
import { useLocale } from "@/components/locale-provider";
import {
  Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent,
  SidebarGroupLabel, SidebarHeader, SidebarInset, SidebarMenu, SidebarMenuButton,
  SidebarMenuItem, SidebarProvider, SidebarTrigger, SidebarFooter,
} from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import type { AppRole } from "@/lib/organization-session";

const roleNames: Record<AppRole, string> = {
  administrator: "Administrator",
  fleet_manager: "Fleet Manager",
  manager: "Manager",
  driver: "Driver",
};

export function WorkspaceShell({
  children, userName, role, active,
}: {
  children: ReactNode;
  userName: string;
  role: AppRole;
  active: "overview" | "my-vehicle" | "my-documents" | "vehicles" | "drivers" | "quick-assignment" | "assignment-journal" | "historical-lookup" | "anomalies" | "fines" | "claims" | "users" | "company" | "profile";
}) {
  const { locale } = useLocale();
  const french = locale === "fr";
  const activeLabel = {
    overview: "Overview",
    "my-vehicle": "My Vehicle",
    "my-documents": "My Documents",
    vehicles: "Vehicles",
    drivers: "Drivers",
    "quick-assignment": "Quick Assignment",
    "assignment-journal": "Assignment Journal",
    "historical-lookup": "Historical Lookup",
    anomalies: "Anomalies",
    fines: "Fines",
    claims: "Claims",
    users: "Users",
    company: "Company information",
    profile: french ? "Mon profil" : "My Profile",
  }[active];
  const homeHref = role === "driver" ? "/my-vehicle" : "/workspace";
  const homeLabel = role === "driver" ? "My Vehicle" : "Overview";
  return (
    <SidebarProvider>
      <WorkspacePresence />
      <Sidebar variant="sidebar" collapsible="icon">
        <SidebarHeader className="px-3 py-3 group-data-[collapsible=icon]:px-2">
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                size="lg"
                render={<Link href={homeHref} aria-label="NexDrive home" />}
                className="h-12 gap-2.5 bg-transparent! hover:bg-transparent! group-data-[collapsible=icon]:justify-center"
              >
                <NexDriveMark className="gap-2 [&_svg]:size-7 [&_span]:text-[1.4rem] group-data-[collapsible=icon]:[&_span]:hidden" />
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarHeader>

        <SidebarContent className="pt-3">
          <SidebarGroup>
            <SidebarGroupLabel className="text-sidebar-foreground/50 tracking-wider uppercase">Workspace</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {role === "driver" ? (
                  <>
                    <SidebarMenuItem>
                      <SidebarMenuButton
                        tooltip="My Vehicle"
                        render={<Link href="/my-vehicle" />}
                        isActive={active === "my-vehicle"}
                        className="data-active:bg-primary/10!"
                      >
                        <CarFront />
                        <span>My Vehicle</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                    <SidebarMenuItem>
                      <SidebarMenuButton
                        tooltip="My Documents"
                        render={<Link href="/my-documents" />}
                        isActive={active === "my-documents"}
                        className="data-active:bg-primary/10!"
                      >
                        <BookOpenText />
                        <span>My Documents</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  </>
                ) : (
                  <SidebarMenuItem>
                    <SidebarMenuButton
                      tooltip="Overview"
                      render={<Link href="/workspace" />}
                      isActive={active === "overview"}
                      className="data-active:bg-primary/10!"
                    >
                      <LayoutDashboard />
                      <span>Overview</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                )}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>

          {role !== "driver" && (
            <SidebarGroup>
              <SidebarGroupLabel className="text-sidebar-foreground/50 tracking-wider uppercase">Fleet</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  <SidebarMenuItem>
                    <SidebarMenuButton
                      tooltip="Vehicles"
                      render={<Link href="/vehicles" />}
                      isActive={active === "vehicles"}
                      className="data-active:bg-primary/10!"
                    >
                      <CarFront />
                      <span>Vehicles</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                  {(role === "administrator" || role === "fleet_manager" || role === "manager") && (
                    <SidebarMenuItem>
                      <SidebarMenuButton
                        tooltip="Drivers"
                        render={<Link href="/drivers" />}
                        isActive={active === "drivers"}
                        className="data-active:bg-primary/10!"
                      >
                        <UsersRound />
                        <span>Drivers</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  )}
                  {(role === "administrator" || role === "fleet_manager") && (
                    <SidebarMenuItem>
                      <SidebarMenuButton
                        tooltip="Quick Assignment"
                        render={<Link href="/assignments/quick" />}
                        isActive={active === "quick-assignment"}
                        className="data-active:bg-primary/10!"
                      >
                        <Link2 />
                        <span>Quick Assignment</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  )}
                  <SidebarMenuItem>
                    <SidebarMenuButton
                      tooltip="Assignment Journal"
                      render={<Link href="/assignments/journal" />}
                      isActive={active === "assignment-journal"}
                      className="data-active:bg-primary/10!"
                    >
                      <BookOpenText />
                      <span>Assignment Journal</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                  <SidebarMenuItem>
                    <SidebarMenuButton
                      tooltip="Historical Lookup"
                      render={<Link href="/assignments/lookup" />}
                      isActive={active === "historical-lookup"}
                      className="data-active:bg-primary/10!"
                    >
                      <Search />
                      <span>Historical Lookup</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                  <SidebarMenuItem>
                    <SidebarMenuButton
                      tooltip="Anomalies"
                      render={<Link href="/anomalies" />}
                      isActive={active === "anomalies"}
                      className="data-active:bg-primary/10!"
                    >
                      <TriangleAlert />
                      <span>Anomalies</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                  <SidebarMenuItem>
                    <SidebarMenuButton
                      tooltip="Fines"
                      render={<Link href="/fines" />}
                      isActive={active === "fines"}
                      className="data-active:bg-primary/10!"
                    >
                      <FileText />
                      <span>Fines</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                  <SidebarMenuItem>
                    <SidebarMenuButton
                      tooltip="Claims"
                      render={<Link href="/claims" />}
                      isActive={active === "claims"}
                      className="data-active:bg-primary/10!"
                    >
                      <ShieldAlert />
                      <span>Claims</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          )}
        {role === "administrator" ? <SidebarGroup>
          <SidebarGroupLabel className="text-sidebar-foreground/50 tracking-wider uppercase">Administration</SidebarGroupLabel>
          <SidebarGroupContent><SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton tooltip="Users" render={<Link href="/settings/users" />} isActive={active === "users"} className="data-active:bg-primary/10!">
                <UsersRound /><span>Users</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton tooltip="Company information" render={<Link href="/settings/company" />} isActive={active === "company"} className="data-active:bg-primary/10!">
                <Building2 /><span>Company information</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu></SidebarGroupContent>
        </SidebarGroup> : null}
        </SidebarContent>
        <SidebarFooter className="mt-auto border-t px-2 py-3">
          <WorkspaceAccountMenu userName={userName} roleName={roleNames[role]} />
        </SidebarFooter>
      </Sidebar>

      <SidebarInset className="min-w-0 bg-background">
        <header className="bg-card sticky top-0 z-20 border-b">
          <div className="mx-auto flex h-14 max-w-[1440px] items-center justify-between gap-4 px-4 sm:px-6">
            <div className="flex min-w-0 items-center gap-3 text-sm">
              <SidebarTrigger className="-ml-2 [&_svg]:size-5!" />
              <Separator orientation="vertical" className="hidden h-4! sm:block" />
              {active !== "overview" && active !== "my-vehicle" ? (
                <>
                  <Link href={homeHref} className="hidden text-muted-foreground hover:text-foreground sm:inline">{homeLabel}</Link>
                  <span className="hidden text-muted-foreground/50 sm:inline">/</span>
                  <span className="font-medium">{activeLabel}</span>
                </>
              ) : (
                <span className="font-medium">{activeLabel}</span>
              )}
            </div>
          </div>
        </header>
        {children}
      </SidebarInset>
    </SidebarProvider>
  );
}
