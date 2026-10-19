import { redirect } from "next/navigation";

type SearchParams = { code?: string | string[]; invitation?: string | string[] };

export default async function LegacyInvitationLink({ searchParams }: { searchParams?: Promise<SearchParams> }) {
  const parameters = await searchParams;
  const value = parameters?.invitation ?? parameters?.code;
  const code = typeof value === "string" && value.length >= 20 && value.length <= 80 ? value : undefined;
  redirect(code ? `/login?invitation=${encodeURIComponent(code)}` : "/login");
}
