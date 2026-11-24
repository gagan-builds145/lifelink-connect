/**
 * The backend stores one of six durable notification kinds. These labels make
 * the category explicit in the bell without changing the schema or generating
 * any synthetic notification rows.
 */
export const NOTIFICATION_KIND_LABELS = {
  request: "Blood request",
  match: "Donor invitation",
  inventory: "Allocation & transfer",
  camp: "Donation camp",
  ambulance: "Ambulance update",
  system: "Account & security",
} as const;

export type NotificationKind = keyof typeof NOTIFICATION_KIND_LABELS;

export function notificationKindLabel(kind: string): string {
  return NOTIFICATION_KIND_LABELS[kind as NotificationKind] ?? "LifeLink update";
}
