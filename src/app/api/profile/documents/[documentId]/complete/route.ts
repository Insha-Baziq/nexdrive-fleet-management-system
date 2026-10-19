import { NextResponse } from "next/server";
import { getOrganizationSession } from "@/lib/organization-session";
import { sameOrigin } from "@/lib/onboarding-http";
import { finishUserDocumentUpload, UserDocumentError } from "@/lib/user-documents";

type Props = { params: Promise<{ documentId: string }> };

export async function POST(request: Request, { params }: Props) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Invalid origin." }, { status: 403 });
  const session = await getOrganizationSession();
  if (!session) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  const { documentId } = await params;
  try {
    await finishUserDocumentUpload(session.tenantId, session.user.id, documentId);
    return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof UserDocumentError) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ error: "Could not complete the document upload." }, { status: 500 });
  }
}
