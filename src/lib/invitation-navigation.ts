export const PENDING_INVITATION_KEY = "nexdrive.pending-invitation";

// Reload after changing tenant so no client state from the previous organization survives.
export function reloadOrganizationWorkspace() {
  window.location.assign(new URL("/workspace", window.location.origin).href);
}

export function rememberInvitation(code?: string) {
  if (code) sessionStorage.setItem(PENDING_INVITATION_KEY, code);
}

export function accountDestination(code?: string) {
  const pending = code || sessionStorage.getItem(PENDING_INVITATION_KEY);
  return pending ? `/workspace?invitation=${encodeURIComponent(pending)}` : "/workspace";
}
