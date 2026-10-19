import { NextResponse } from "next/server";
import { getOrganizationSession } from "@/lib/organization-session";
import { sameOrigin } from "@/lib/onboarding-http";
import { deleteUserDocument, UserDocumentError } from "@/lib/user-documents";

type Props = { params: Promise<{ documentId: string }> };

export async function DELETE(request: Request, { params }: Props) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Invalid origin." }, { status: 403 });
  const session = await getOrganizationSession();
  if (!session) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  const { documentId } = await params;
  try {
    await deleteUserDocument(session.tenantId, session.user.id, documentId);
    return NextResponse.json({ deleted: true }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof UserDocumentError) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ error: "Could not delete the profile document." }, { status: 500 });
  }
}
