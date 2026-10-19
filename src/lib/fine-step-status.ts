export type FineWorkflowStepType = "received" | "designation" | "contestation" | "response" | "payment";
export type FineWorkflowStatus = "Received" | "Designated" | "Contested" | "Response received" | "Paid" | "Closed" | "Cancelled" | "Archived";

export function deriveFineWorkflowStatus(recordStatus: string, steps: readonly { step_type: string }[]): FineWorkflowStatus {
  if (recordStatus === "cancelled") return "Cancelled";
  if (recordStatus === "archived") return "Archived";
  const types = new Set(steps.map((step) => step.step_type));
  if (types.has("payment")) return "Paid";
  if (types.has("response")) return "Response received";
  if (types.has("contestation")) return "Contested";
  if (types.has("designation")) return "Designated";
  if (recordStatus === "closed") return "Closed";
  return "Received";
}
