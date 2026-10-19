export const pendingVerificationAttemptKey = "nexdrive:pending-verification-attempt";

export function completedVerificationAttemptKey(attempt: string) {
  return `nexdrive:completed-verification:${attempt}`;
}
