import { NextResponse } from "next/server";
import { getOrganizationSession } from "@/lib/organization-session";
import { getUserDocumentContent, UserDocumentError } from "@/lib/user-documents";

type Props = { params: Promise<{ documentId: string }> };

export async function GET(_request: Request, { params }: Props) {
  const session = await getOrganizationSession();
  if (!session) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  const { documentId } = await params;
  try {
    return await getUserDocumentContent(session.tenantId, session.user.id, documentId);
  } catch (error) {
    if (error instanceof UserDocumentError) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ error: "Document is unavailable." }, { status: 500 });
  }
}
