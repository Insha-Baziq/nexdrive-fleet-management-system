export const DEFAULT_ALERT_WINDOW_DAYS = 30;
export const MAX_ALERT_WINDOW_DAYS = 365;

/**
 * Read the shared alert/expiry window from deployment configuration.
 * Invalid, fractional, negative, or unreasonably large values use the safe default.
 */
export function getAlertWindowDays(value: string | undefined): number {
  if (!value || !/^\d+$/.test(value)) return DEFAULT_ALERT_WINDOW_DAYS;
  const days = Number(value);
  if (!Number.isSafeInteger(days) || days > MAX_ALERT_WINDOW_DAYS) {
    return DEFAULT_ALERT_WINDOW_DAYS;
  }
  return days;
}

export const DASHBOARD_ALERT_WINDOW_DAYS = getAlertWindowDays(
  process.env.NEXDRIVE_ALERT_WINDOW_DAYS,
);
