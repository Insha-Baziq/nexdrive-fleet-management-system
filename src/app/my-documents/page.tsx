import { notFound, redirect } from "next/navigation";
import { WorkspaceShell } from "@/components/workspace-shell";
import { DriverPaperworkList } from "@/components/driver-paperwork-list";
import { DriverWorkspaceCopy } from "@/components/driver-workspace-copy";
import { getOrganizationSession } from "@/lib/organization-session";
import { getDriverWorkspaceVehicle } from "@/lib/drivers";
import { listDriverDocuments } from "@/lib/driver-documents";

export default async function MyDocumentsPage() {
  const session = await getOrganizationSession();
  if (!session) redirect("/login");
  if (session.role !== "driver") notFound();

  const driver = await getDriverWorkspaceVehicle(session.tenantId, session.user.id);
  const documents = driver
    ? await listDriverDocuments(session.tenantId, driver.driver_id, session.role, session.user.id)
    : [];

  return (
    <WorkspaceShell userName={session.user.name} role={session.role} active="my-documents">
      <main className="mx-auto w-full max-w-[1440px] px-4 py-8 sm:px-6 lg:py-10">
        <div className="max-w-3xl">
          <p className="text-sm font-semibold text-primary"><DriverWorkspaceCopy id="workspaceLabel" /></p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-foreground"><DriverWorkspaceCopy id="documentsTitle" /></h1>
          <p className="mt-2 text-sm text-muted-foreground"><DriverWorkspaceCopy id="documentsDescription" /></p>
        </div>

        <DriverPaperworkList
          title="Personal documents"
          description="Administrative documents attached to your Driver record."
          documents={documents.map((document) => ({
            id: document.id,
            name: document.name,
            category: document.category,
            expiry_date: document.expiry_date,
            file_name: document.file_name,
            open_url: `/api/drivers/${driver?.driver_id}/documents/${document.id}/content`,
          }))}
          emptyMessage={driver
            ? "No administrative documents have been added to your record."
            : "Your account is not linked to a Driver record yet. Ask your organization administrator to complete your setup."}
        />
      </main>
    </WorkspaceShell>
  );
}
