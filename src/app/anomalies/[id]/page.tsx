import Link from "next/link";
import Image from "next/image";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, CalendarDays, Image as ImageIcon, UserRound } from "lucide-react";
import { AnomalyOutcomeActions } from "@/components/anomaly-outcome-actions";
import { Badge } from "@/components/ui/badge";
import { WorkspaceShell } from "@/components/workspace-shell";
import { getAnomaly } from "@/lib/anomalies";
import { getOrganizationSession } from "@/lib/organization-session";

type Props = { params: Promise<{ id: string }> };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function dateLabel(value: string) {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${value.slice(0, 10)}T00:00:00Z`));
}

export default async function AnomalyDetailPage({ params }: Props) {
  const session = await getOrganizationSession();
  if (!session) redirect("/login");
  if (session.role === "driver") notFound();
  const { id } = await params;
  if (!uuid.test(id)) notFound();
  const anomaly = await getAnomaly(session.tenantId, id);
  if (!anomaly) notFound();
  const canManage = session.role === "administrator" || session.role === "fleet_manager";
  const statusClass = anomaly.status === "open" ? "border-amber-500/20 bg-amber-500/10 text-amber-800 dark:text-amber-300"
    : anomaly.status === "resolved" ? "border-primary/20 bg-primary/10 text-primary"
      : "border-border bg-muted text-muted-foreground";

  return <WorkspaceShell userName={session.user.name} role={session.role} active="anomalies">
    <main className="mx-auto w-full max-w-[1220px] px-4 pb-12 pt-7 sm:px-6 lg:px-10 lg:pt-10">
      <Link href={`/vehicles/${anomaly.vehicle_id}`} className="inline-flex items-center gap-2 text-sm font-medium text-muted-foreground transition-colors hover:text-primary"><ArrowLeft className="size-4" /> Back to vehicle</Link>
      <div className="mt-7 flex flex-wrap items-start justify-between gap-5">
        <div><p className="mb-3 text-[11px] font-semibold tracking-[0.14em] text-primary uppercase">Vehicle anomaly</p><h1 className="text-2xl font-semibold tracking-tight text-foreground">{anomaly.vehicle_registration}</h1><p className="mt-1 text-sm text-muted-foreground">{[anomaly.vehicle_make, anomaly.vehicle_model].filter(Boolean).join(" ") || "Vehicle"}</p></div>
        <Link href="/anomalies" className="text-sm font-medium text-primary hover:underline">All anomalies</Link>
      </div>
      <section className="mt-7 overflow-hidden rounded-xl border bg-card shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b px-5 py-5 sm:px-6">
          <div><h2 className="text-base font-semibold">Vehicle anomaly</h2><p className="mt-1 text-xs text-muted-foreground">Reported {dateLabel(anomaly.observed_date)}</p></div>
          <Badge variant="outline" className={statusClass}>{anomaly.status[0].toUpperCase() + anomaly.status.slice(1)}</Badge>
        </div>
        <dl className="grid gap-x-10 px-5 sm:grid-cols-[140px_1fr] sm:px-6">
          <dt className="border-b py-4 text-xs font-medium text-muted-foreground">Observed date</dt><dd className="inline-flex items-center gap-2 border-b py-4 text-sm font-medium"><CalendarDays className="size-4 text-muted-foreground" />{dateLabel(anomaly.observed_date)}</dd>
          <dt className="border-b py-4 text-xs font-medium text-muted-foreground">Description</dt><dd className="border-b py-4 text-sm leading-6 text-foreground whitespace-pre-wrap">{anomaly.description}</dd>
          <dt className="border-b py-4 text-xs font-medium text-muted-foreground">Reported by</dt><dd className="inline-flex items-center gap-2 border-b py-4 text-sm font-medium"><UserRound className="size-4 text-muted-foreground" />{anomaly.reporter_name}</dd>
          <dt className="py-4 text-xs font-medium text-muted-foreground">Photos</dt><dd className="py-4">
            {anomaly.photos?.length ? <div className="flex flex-wrap gap-3">{anomaly.photos.map((photo) => <a key={photo.id} href={`/api/anomalies/${anomaly.id}/photos/${photo.id}/content`} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-lg border focus-visible:ring-2 focus-visible:ring-ring" aria-label={`Open anomaly photo ${photo.file_name}`}><Image src={`/api/anomalies/${anomaly.id}/photos/${photo.id}/content`} alt={photo.file_name} width={240} height={180} unoptimized className="h-36 w-48 object-cover" /></a>)}</div> : <span className="inline-flex items-center gap-2 text-sm text-muted-foreground"><ImageIcon className="size-4" />No photos attached</span>}
          </dd>
        </dl>
        {anomaly.resolution_reason && <div className="border-t bg-muted/30 px-5 py-4 sm:px-6"><p className="text-xs font-medium text-muted-foreground">{anomaly.status === "resolved" ? "Resolution" : "Cancellation reason"}</p><p className="mt-1.5 text-sm whitespace-pre-wrap">{anomaly.resolution_reason}</p><p className="mt-1 text-xs text-muted-foreground">{anomaly.closed_by_name ? `Recorded by ${anomaly.closed_by_name}` : "Outcome recorded"}{anomaly.closed_at ? ` · ${new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(anomaly.closed_at))}` : ""}</p></div>}
        {canManage && anomaly.status === "open" && <AnomalyOutcomeActions anomalyId={anomaly.id} />}
      </section>
    </main>
  </WorkspaceShell>;
}
