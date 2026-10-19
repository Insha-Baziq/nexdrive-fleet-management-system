import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, UsersRound } from "lucide-react";
import { DriverFormDialog } from "@/components/driver-form-dialog";
import { DriverAccountControls } from "@/components/driver-account-controls";
import { DriverDocumentsPanel } from "@/components/driver-documents-panel";
import { DriverDetailTabs } from "@/components/driver-detail-tabs";
import { AssignmentDialog } from "@/components/assignment-dialog";
import { RecordArchiveAction } from "@/components/record-archive-action";
import { Badge } from "@/components/ui/badge";
import { WorkspaceShell } from "@/components/workspace-shell";
import { getOrganizationSession } from "@/lib/organization-session";
import { getDriver, listEligibleDriverUsers } from "@/lib/drivers";
import { listVehicles } from "@/lib/vehicles";
import { listInvitations } from "@/lib/onboarding";
import { latestDriverPasswordResetAttempt } from "@/lib/driver-password-reset";

type Props = { params: Promise<{ id: string }>; searchParams?: Promise<{ view?: string }> };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function dateLabel(value: string | null) {
  if (!value) return "Not set";
  const label = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" })
    .format(new Date(`${value}T00:00:00Z`));
  const days = Math.ceil((Date.parse(`${value}T00:00:00Z`) - Date.now()) / 86400000);
  return days < 0 ? `${label} · Expired` : days < 30 ? `${label} · Due soon` : label;
}

function birthDateLabel(value: string | null) {
  if (!value) return "Not set";
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" })
    .format(new Date(`${value}T00:00:00Z`));
}

function Field({ label, value }: { label: string; value: string }) {
  return <div className="border-b py-4 last:border-0">
    <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
    <dd className="mt-1.5 text-sm font-medium text-foreground">{value}</dd>
  </div>;
}

export default async function DriverDetailPage({ params, searchParams }: Props) {
  const session = await getOrganizationSession();
  if (!session) redirect("/login");
  if (session.role !== "administrator" && session.role !== "fleet_manager" && session.role !== "manager") notFound();
  const { id } = await params;
  if (!uuid.test(id)) notFound();
  const driver = await getDriver(session.tenantId, id);
  if (!driver) notFound();
  const fromArchive = driver.archived_at !== null || (await searchParams)?.view === "archived";
  const [eligibleUsers, vehicles, invitations, resetAttempt] = await Promise.all([
    listEligibleDriverUsers(session.tenantId, id),
    listVehicles(session.tenantId),
    session.role === "administrator" ? listInvitations(session.tenantId) : Promise.resolve([]),
    session.role === "administrator" && driver.user_id
      ? latestDriverPasswordResetAttempt(session.tenantId, id)
      : Promise.resolve(null),
  ]);
  const targetedInvitation = session.role === "administrator"
    ? invitations.find((invite) => invite.target_driver_id === id && invite.email && invite.copyable)
    : undefined;
  const incompleteFields = [
    ["date of birth", driver.date_of_birth],
    ["street number", driver.street_number],
    ["street name", driver.street_name],
    ["postal code", driver.postal_code],
    ["city", driver.city],
  ].filter(([, value]) => !value).map(([label]) => label);

  return <WorkspaceShell userName={session.user.name} role={session.role} active="drivers">
    <main className="mx-auto w-full max-w-[1220px] px-4 pb-12 pt-7 sm:px-6 lg:px-10 lg:pt-10">
      <Link href={fromArchive ? "/drivers?view=archived" : "/drivers"} className="inline-flex items-center gap-2 text-sm font-medium text-muted-foreground transition-colors hover:text-primary">
        <ArrowLeft className="size-4" /> Back to drivers
      </Link>
      <div className="mt-7 flex flex-wrap items-start justify-between gap-5">
        <div>
          <p className="mb-3 text-[11px] font-semibold tracking-[0.14em] text-primary uppercase">Driver record</p>
          <div className="flex flex-wrap items-center gap-3"><h1 className="text-[clamp(1.9rem,3vw,2.7rem)] leading-tight font-semibold tracking-[-0.04em] text-foreground">{driver.full_name}</h1>{driver.archived_at && <Badge variant="outline">Archived</Badge>}</div>
          <p className="mt-2 text-sm text-muted-foreground">{driver.current_vehicle_registration ? `Current vehicle: ${driver.current_vehicle_registration}` : "No vehicle assigned"}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">{driver.archived_at
          ? <RecordArchiveAction kind="driver" id={driver.id} name={driver.full_name} archived />
          : <>{(session.role === "administrator" || session.role === "fleet_manager") && <AssignmentDialog vehicles={vehicles} drivers={[driver]} fixedDriverId={driver.id} />}<DriverFormDialog key={`${driver.id}:${driver.user_id}:${driver.updated_at}`} driver={driver} eligibleUsers={eligibleUsers} /><RecordArchiveAction kind="driver" id={driver.id} name={driver.full_name} archived={false} /></>}
        </div>
      </div>
      {incompleteFields.length > 0 && !driver.archived_at && <div role="status" className="mt-5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-900 dark:text-amber-200">
        Driver information is incomplete. Add {incompleteFields.join(", ")} to this record.
      </div>}
      {session.role === "administrator" && !driver.archived_at ? <div className="mt-5">
        <DriverAccountControls
          driverId={driver.id}
          driverName={driver.full_name}
          linkedEmail={driver.user_id ? driver.user_email : null}
          initialInvitation={targetedInvitation ? {
            id: targetedInvitation.id,
            email: targetedInvitation.email!,
            status: targetedInvitation.email_delivery_status,
            lastAttemptAt: targetedInvitation.email_last_attempt_at?.toISOString() ?? null,
            lastSentAt: targetedInvitation.email_last_sent_at?.toISOString() ?? null,
          } : null}
          initialReset={resetAttempt ? {
            status: resetAttempt.delivery_status,
            attemptedAt: resetAttempt.attempted_at.toISOString(),
          } : null}
        />
      </div> : null}

      <DriverDetailTabs
        overview={<section className="overflow-hidden rounded-xl border bg-card shadow-sm">
          <div className="flex items-center gap-3 border-b px-6 py-5">
            <div className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary"><UsersRound className="size-[18px]" /></div>
            <div><h2 className="text-sm font-semibold text-foreground">Driver information</h2><p className="mt-0.5 text-xs text-muted-foreground">Identity, address, licence, and current assignment</p></div>
          </div>
          <dl className="grid gap-x-8 px-6 sm:grid-cols-2">
            <Field label="Full name" value={driver.full_name} />
            <Field label="Date of birth" value={birthDateLabel(driver.date_of_birth)} />
            <Field label="Street number" value={driver.street_number || "Not set"} />
            <Field label="Street name" value={driver.street_name || "Not set"} />
            <Field label="Postal code" value={driver.postal_code || "Not set"} />
            <Field label="City" value={driver.city || "Not set"} />
            <Field label="Licence number" value={driver.licence_number || "Not set"} />
            <Field label="Licence expiry" value={dateLabel(driver.licence_expiry_date)} />
            <Field label="Current vehicle" value={driver.current_vehicle_registration || "Unassigned"} />
            <Field label="Login account" value={driver.user_email || "Not linked"} />
          </dl>
        </section>}
        documents={<DriverDocumentsPanel driverId={driver.id} canUpload={!driver.archived_at} />}
      />
    </main>
  </WorkspaceShell>;
}
