import { redirect } from "next/navigation";
import { getOrganizationSession } from "@/lib/organization-session";

export default async function Home() {
  const session = await getOrganizationSession();
  redirect(session ? "/workspace" : "/login");
}
