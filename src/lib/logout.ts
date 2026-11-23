export const LOGOUT_CONFIRMATION_MESSAGE =
  "Are you sure you want to log out of your LifeLink account? You will need to sign in again to access your dashboard.";
export const LOGOUT_CONFIRM_LABEL = "Yes, Log Out";
export const LOGOUT_CANCEL_LABEL = "Cancel";
export const LOGOUT_SUCCESS_PATH = "/login";

export type LogoutResult =
  | { status: "success" }
  | { status: "error"; error: unknown }
  | { status: "ignored" };

/**
 * Single-flight wrapper around the existing signOut function.
 *
 * A double-click, keyboard repeat or two dialog actions can only invoke the
 * secure signOut once. A failed attempt releases the lock so the user can retry.
 */
export function createLogoutGate() {
  let inFlight = false;

  return {
    async run(signOut: () => Promise<unknown>): Promise<LogoutResult> {
      if (inFlight) return { status: "ignored" };
      inFlight = true;
      try {
        await signOut();
        return { status: "success" };
      } catch (error) {
        return { status: "error", error };
      } finally {
        inFlight = false;
      }
    },
  };
}
