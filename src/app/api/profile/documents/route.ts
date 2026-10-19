import { NextResponse } from "next/server";
import { getOrganizationSession } from "@/lib/organization-session";
import { jsonBody, sameOrigin } from "@/lib/onboarding-http";
import {
  createUserDocumentUpload,
  UserDocumentError,
  userDocumentExtension,
} from "@/lib/user-documents";
import { MAX_VEHICLE_DOCUMENT_BYTES } from "@/lib/vehicle-documents";

const allowedFields = new Set(["name", "fileName", "fileSize"]);

function errorResponse(error: unknown) {
  if (error instanceof UserDocumentError) return NextResponse.json({ error: error.message }, { status: error.status });
  return NextResponse.json({ error: "Could not process profile document." }, { status: 500 });
}

export async function GET() {
  const session = await getOrganizationSession();
  if (!session) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  const { listUserDocuments } = await import("@/lib/user-documents");
  try {
    const documents = await listUserDocuments(session.tenantId, session.user.id);
    return NextResponse.json({ documents }, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return NextResponse.json({ error: "Could not load profile documents." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Invalid origin." }, { status: 403 });
  const session = await getOrganizationSession();
  if (!session) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  const body = await jsonBody(request).catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  const input = body as Record<string, unknown>;
  if (Object.keys(input).some((field) => !allowedFields.has(field))) return NextResponse.json({ error: "Invalid request fields." }, { status: 400 });
  const name = typeof input.name === "string" ? input.name.trim() : "";
  const fileName = typeof input.fileName === "string" ? input.fileName.trim().split(/[\\/]/).at(-1) ?? "" : "";
  const fileSize = input.fileSize;
  const extension = userDocumentExtension(fileName);
  if (name.length < 1 || name.length > 120 || /[\u0000-\u001f\u007f]/.test(name)
    || !extension || fileName.length < 1 || fileName.length > 180 || /[\u0000-\u001f\u007f]/.test(fileName)
    || !Number.isSafeInteger(fileSize) || Number(fileSize) < 1 || Number(fileSize) > MAX_VEHICLE_DOCUMENT_BYTES) {
    return NextResponse.json({ error: "Enter a document name and choose a supported file up to 15 MB." }, { status: 400 });
  }
  try {
    const upload = await createUserDocumentUpload({
      tenantId: session.tenantId,
      userId: session.user.id,
      name,
      fileName,
      fileSize: Number(fileSize),
      extension,
    });
    return NextResponse.json({ upload }, { status: 201, headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
