export const LOCATION_CONSENT_MESSAGE =
  "Enable location to discover nearby services and make ambulance booking faster.";

export type LocationChoice =
  | "unset"
  | "enabled"
  | "not_now"
  | "denied"
  | "unavailable";

type ReadableStorage = Pick<Storage, "getItem">;
type WritableStorage = Pick<Storage, "setItem">;

const PREFIX = "lifelink:location-choice:";

export function locationChoiceKey(userId: string): string {
  return `${PREFIX}${userId}`;
}

export function readLocationChoice(
  storage: ReadableStorage | null | undefined,
  userId: string | null | undefined,
): LocationChoice {
  if (!storage || !userId) return "unset";
  try {
    const value = storage.getItem(locationChoiceKey(userId));
    if (
      value === "enabled" ||
      value === "not_now" ||
      value === "denied" ||
      value === "unavailable"
    ) {
      return value;
    }
  } catch {
    // Storage can be disabled by privacy settings. Treat it as unset.
  }
  return "unset";
}

export function writeLocationChoice(
  storage: WritableStorage | null | undefined,
  userId: string | null | undefined,
  choice: Exclude<LocationChoice, "unset">,
): void {
  if (!storage || !userId) return;
  try {
    storage.setItem(locationChoiceKey(userId), choice);
  } catch {
    // The current session still reflects the choice in React state.
  }
}
