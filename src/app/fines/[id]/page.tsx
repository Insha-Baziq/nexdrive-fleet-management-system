import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, Download, FileText, Info } from "lucide-react";
import { FineStatusForm } from "@/components/fine-status-form";
import { FineCompanyPaidMarker } from "@/components/fine-company-paid-marker";
import { FineSteps } from "@/components/fine-steps";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { WorkspaceShell } from "@/components/workspace-shell";
import { getFine, getFineCompanyPaidMarkerState, listFineSteps } from "@/lib/fine-dossiers";
import { listDrivers } from "@/lib/drivers";
import { getOrganizationSession } from "@/lib/organization-session";

type Props = { params: Promise<{ id: string }> };

function dateTimeLabel(value: string) {
  return new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function dateLabel(value: string) {
  return new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(`${value.slice(0, 10)}T00:00:00Z`));
}

function statusClass(status: string) {
  if (status === "open") return "border-amber-500/20 bg-amber-500/10 text-amber-800 dark:text-amber-300";
  if (status === "closed") return "border-primary/20 bg-primary/10 text-primary";
  return "border-border bg-muted text-muted-foreground";
}

function amountLabel(value: string | null) {
  if (!value) return "Not recorded";
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: "EUR" }).format(Number(value));
}

export default async function FineDetailPage({ params }: Props) {
  const session = await getOrganizationSession();
  if (!session) redirect("/login");
  if (session.role === "driver") notFound();
  const { id } = await params;
  let fine;
  let steps;
  let companyPaidMarkerState;
  let drivers: { id: string; full_name: string }[] = [];
  try {
    [fine, steps, companyPaidMarkerState] = await Promise.all([
      getFine(session.tenantId, id, session.role),
      listFineSteps(session.tenantId, id, session.role),
      getFineCompanyPaidMarkerState(session.tenantId, id, session.role),
    ]);
    if (session.role === "manager") {
      drivers = (await listDrivers(session.tenantId)).map((driver) => ({ id: driver.id, full_name: driver.full_name }));
    }
  }
  catch { notFound(); }
  const evidenceHref = `/api/fines/${fine.id}/evidence/${fine.evidence.id}/content`;

  return <WorkspaceShell userName={session.user.name} role={session.role} active="fines">
    <main className="mx-auto w-full max-w-[1440px] px-4 pb-12 pt-7 sm:px-6 lg:px-10 lg:pt-10">
      <Link href="/fines" className="mb-5 inline-flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground"><ArrowLeft className="size-4" /> Back to fines</Link>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Fine details</h1>
          <div className="mt-2 flex flex-wrap items-center gap-3"><span className="font-mono text-sm text-muted-foreground">{fine.reference}</span><Badge variant="outline" className={statusClass(fine.status)}>{fine.status[0].toUpperCase() + fine.status.slice(1)}</Badge></div>
        </div>
        {session.role === "administrator" || session.role === "manager" ? <FineStatusForm fineId={fine.id} initialStatus={fine.status} /> : null}
      </div>

      <Card className="overflow-hidden rounded-xl shadow-sm">
        <div className="border-b px-5 py-4 sm:px-6"><h2 className="text-sm font-semibold">Fine information</h2></div>
        <dl className="grid gap-x-8 gap-y-6 p-5 sm:grid-cols-2 sm:p-6">
          <div><dt className="text-xs font-medium text-muted-foreground">Reference</dt><dd className="mt-1.5 font-medium">{fine.reference}</dd></div>
          <div><dt className="text-xs font-medium text-muted-foreground">Vehicle</dt><dd className="mt-1.5 font-medium">{fine.vehicle_registration}<span className="ml-2 text-sm font-normal text-muted-foreground">{fine.vehicle_make} {fine.vehicle_model}</span></dd></div>
          <div><dt className="text-xs font-medium text-muted-foreground">Fine type</dt><dd className="mt-1.5 font-medium">{fine.fine_type === "company" ? "Company" : "Driver-related"}</dd></div>
          <div><dt className="text-xs font-medium text-muted-foreground">Infraction date and time</dt><dd className="mt-1.5 font-medium tabular-nums">{dateTimeLabel(fine.infraction_at)}</dd></div>
          <div><dt className="text-xs font-medium text-muted-foreground">Payment deadline</dt><dd className="mt-1.5 font-medium tabular-nums">{dateLabel(fine.payment_deadline)}</dd></div>
          <div><dt className="text-xs font-medium text-muted-foreground">Amount</dt><dd className="mt-1.5 font-medium tabular-nums">{amountLabel(fine.amount)}</dd></div>
          <div className="sm:col-span-2"><dt className="text-xs font-medium text-muted-foreground">Description</dt><dd className="mt-1.5 whitespace-pre-wrap text-sm">{fine.description || "No description recorded."}</dd></div>
        </dl>
      </Card>

      {fine.fine_type === "driver" ? <Card className="mt-5 overflow-hidden rounded-xl shadow-sm">
        <div className="border-b px-5 py-4 sm:px-6"><h2 className="text-sm font-semibold">Recorded driver from assignment history</h2></div>
        {fine.recorded_driver ? <div className="p-5 sm:p-6">
          <dl className="grid gap-x-8 gap-y-5 sm:grid-cols-2">
            <div><dt className="text-xs font-medium text-muted-foreground">Recorded driver</dt><dd className="mt-1.5 font-medium">{fine.recorded_driver.driver_name}</dd></div>
            <div><dt className="text-xs font-medium text-muted-foreground">Assignment period</dt><dd className="mt-1.5 font-medium tabular-nums">{dateTimeLabel(fine.recorded_driver.started_at)} — {fine.recorded_driver.ended_at ? dateTimeLabel(fine.recorded_driver.ended_at) : "No end recorded"}</dd></div>
          </dl>
          <div className="mt-5 flex items-start gap-2.5 rounded-lg bg-muted/60 p-3 text-sm text-muted-foreground"><Info className="mt-0.5 size-4 shrink-0" /><p>This vehicle was recorded as assigned to this driver at the time shown. This is an assignment record, not a finding of responsibility.</p></div>
        </div> : <p className="p-5 text-sm text-muted-foreground sm:p-6">No driver is identified in NexDrive assignment history for this time.</p>}
      </Card> : null}

      <FineCompanyPaidMarker fineId={fine.id} marker={companyPaidMarkerState.marker} canRecord={companyPaidMarkerState.canRecord} />

      <Card className="mt-5 overflow-hidden rounded-xl shadow-sm">
        <div className="border-b px-5 py-4 sm:px-6"><h2 className="text-sm font-semibold">Supporting evidence</h2></div>
        <div className="flex flex-wrap items-center justify-between gap-4 p-4 sm:p-5">
          <div className="flex min-w-0 items-center gap-3"><span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground"><FileText className="size-5" /></span><div className="min-w-0"><p className="truncate text-sm font-medium">{fine.evidence.file_name}</p><p className="mt-0.5 text-xs text-muted-foreground">{fine.evidence.file_extension.toUpperCase()} · {Math.ceil(Number(fine.evidence.file_size) / 1024)} KB</p></div></div>
          <div className="flex items-center gap-2"><Button nativeButton={false} variant="outline" size="sm" render={<a href={evidenceHref} target="_blank" rel="noreferrer" />}><FileText className="size-4" /> View file</Button><Button nativeButton={false} variant="ghost" size="icon-sm" render={<a href={`${evidenceHref}?download=1`} aria-label={`Download ${fine.evidence.file_name}`} title="Download evidence" />}><Download className="size-4" /></Button></div>
        </div>
      </Card>
      <FineSteps fineId={fine.id} recordStatus={fine.status} initialSteps={steps} drivers={drivers} canManage={session.role === "manager"} />
      <p className="mt-4 text-xs text-muted-foreground">Payments are recorded here; they are made outside NexDrive.</p>
    </main>
  </WorkspaceShell>;
}
