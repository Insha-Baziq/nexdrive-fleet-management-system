import { NextResponse } from "next/server";
import { getCompanyInformation, parseCompanyInformation, saveCompanyInformation, CompanyInformationValidationError } from "@/lib/company-settings";
import { getOrganizationSession } from "@/lib/organization-session";
import { jsonBody, sameOrigin } from "@/lib/onboarding-http";

const privateHeaders = { "Cache-Control": "private, no-store" };

export async function GET() {
  const session = await getOrganizationSession();
  if (!session) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  const company = await getCompanyInformation(session.tenantId);
  if (!company) return NextResponse.json({ error: "Company information not found." }, { status: 404, headers: privateHeaders });
  return NextResponse.json({ company }, { headers: privateHeaders });
}

export async function PATCH(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Invalid origin." }, { status: 403 });
  const session = await getOrganizationSession();
  if (!session) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  if (session.role !== "administrator") return NextResponse.json({ error: "Forbidden." }, { status: 403 });

  const body = await jsonBody(request).catch(() => null);
  let company;
  try {
    company = parseCompanyInformation(body);
  } catch (error) {
    if (error instanceof CompanyInformationValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }

  const saved = await saveCompanyInformation(session.tenantId, company);
  if (!saved) return NextResponse.json({ error: "Company information not found." }, { status: 404, headers: privateHeaders });
  return NextResponse.json({ company: saved }, { headers: privateHeaders });
}
