import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, Download, FileText } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ClaimContacts } from "@/components/claim-contacts";
import { ClaimStages } from "@/components/claim-stages";
import { WorkspaceShell } from "@/components/workspace-shell";
import { getClaim, listClaimContacts, listClaimStages } from "@/lib/claim-dossiers";
import { getOrganizationSession } from "@/lib/organization-session";

type Props = { params: Promise<{ id: string }> };

function dateLabel(value: string) {
  return new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(`${value.slice(0, 10)}T00:00:00Z`));
}

function sizeLabel(value: string) {
  const bytes = Number(value);
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(bytes % (1024 * 1024) === 0 ? 0 : 1)} MB`;
}

export default async function ClaimDetailPage({ params }: Props) {
  const session = await getOrganizationSession();
  if (!session) redirect("/login");
  if (session.role === "driver") notFound();
  const { id } = await params;
  let claim;
  let contacts;
  let stages;
  try {
    claim = await getClaim(session.tenantId, id, session.role);
    contacts = await listClaimContacts(session.tenantId, id, session.role);
    stages = await listClaimStages(session.tenantId, id, session.role);
  }
  catch { notFound(); }
  const evidenceHref = `/api/claims/${claim.id}/evidence/${claim.initial_evidence.id}/content`;

  return <WorkspaceShell userName={session.user.name} role={session.role} active="claims">
    <main className="mx-auto w-full max-w-[1440px] px-4 pb-12 pt-7 sm:px-6 lg:px-10 lg:pt-10">
      <Link href="/claims" className="mb-5 inline-flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground"><ArrowLeft className="size-4" /> Back to claims</Link>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4"><div><h1 className="text-2xl font-semibold tracking-tight text-foreground">Claim details</h1><p className="mt-1 text-sm text-muted-foreground">Incident record for {claim.vehicle_registration}</p></div><Badge variant="outline" className={claim.status === "open" ? "border-amber-500/20 bg-amber-500/10 text-amber-800 dark:text-amber-300" : claim.status === "closed" ? "border-emerald-600/20 bg-emerald-600/10 text-emerald-800 dark:text-emerald-300" : "border-border bg-muted text-muted-foreground"}>{claim.status[0].toUpperCase() + claim.status.slice(1)}</Badge></div>
      <div className="grid gap-5 lg:grid-cols-[1.1fr_0.9fr]">
        <Card className="overflow-hidden rounded-xl shadow-sm">
          <div className="border-b px-5 py-4 sm:px-6"><h2 className="text-sm font-semibold">Incident details</h2></div>
          <dl className="grid gap-x-8 gap-y-6 p-5 sm:grid-cols-2 sm:p-6">
            <div><dt className="text-xs font-medium text-muted-foreground">Vehicle</dt><dd className="mt-1.5 font-medium">{claim.vehicle_registration}<span className="ml-2 text-sm font-normal text-muted-foreground">{claim.vehicle_make} {claim.vehicle_model}</span></dd></div>
            <div><dt className="text-xs font-medium text-muted-foreground">Incident date</dt><dd className="mt-1.5 font-medium tabular-nums">{dateLabel(claim.incident_date)}</dd></div>
            <div className="sm:col-span-2"><dt className="text-xs font-medium text-muted-foreground">Description</dt><dd className="mt-1.5 whitespace-pre-wrap text-sm">{claim.description}</dd></div>
          </dl>
        </Card>
        <Card className="overflow-hidden rounded-xl shadow-sm">
          <div className="border-b px-5 py-4 sm:px-6"><h2 className="text-sm font-semibold">Initial evidence</h2></div>
          <div className="flex flex-wrap items-center justify-between gap-4 p-4 sm:p-5">
            <div className="flex min-w-0 items-center gap-3"><span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground"><FileText className="size-5" /></span><div className="min-w-0"><p className="truncate text-sm font-medium">{claim.initial_evidence.file_name}</p><p className="mt-0.5 text-xs text-muted-foreground">{claim.initial_evidence.file_extension.toUpperCase()} · {sizeLabel(claim.initial_evidence.file_size)}</p></div></div>
            <div className="flex items-center gap-2"><Button nativeButton={false} variant="outline" size="sm" render={<a href={evidenceHref} target="_blank" rel="noreferrer" />}><FileText className="size-4" /> Open file</Button><Button nativeButton={false} variant="ghost" size="icon-sm" render={<a href={`${evidenceHref}?download=1`} aria-label={`Download ${claim.initial_evidence.file_name}`} title="Download initial evidence" />}><Download className="size-4" /></Button></div>
          </div>
        </Card>
      </div>
      <ClaimStages claimId={claim.id} claimStatus={claim.status} initialStages={stages} canManage={session.role === "administrator" || session.role === "manager"} />
      <ClaimContacts claimId={claim.id} initialContacts={contacts} canManage={session.role === "administrator" || session.role === "manager"} />
    </main>
  </WorkspaceShell>;
}
