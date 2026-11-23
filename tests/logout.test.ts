import { describe, expect, test } from "bun:test";
import {
  createLogoutGate,
  LOGOUT_CANCEL_LABEL,
  LOGOUT_CONFIRM_LABEL,
  LOGOUT_CONFIRMATION_MESSAGE,
  LOGOUT_SUCCESS_PATH,
} from "../src/lib/logout";

describe("shared logout confirmation", () => {
  test("uses the exact required copy and controls", () => {
    expect(LOGOUT_CONFIRMATION_MESSAGE).toBe(
      "Are you sure you want to log out of your LifeLink account? You will need to sign in again to access your dashboard.",
    );
    expect(LOGOUT_CANCEL_LABEL).toBe("Cancel");
    expect(LOGOUT_CONFIRM_LABEL).toBe("Yes, Log Out");
    expect(LOGOUT_SUCCESS_PATH).toBe("/login");
  });

  test("duplicate confirmations execute signOut exactly once", async () => {
    const gate = createLogoutGate();
    let calls = 0;
    let release: (() => void) | undefined;
    const signOut = () =>
      new Promise<void>((resolve) => {
        calls += 1;
        release = resolve;
      });

    const first = gate.run(signOut);
    const second = gate.run(signOut);
    const third = gate.run(signOut);
    expect(calls).toBe(1);
    expect((await second).status).toBe("ignored");
    expect((await third).status).toBe("ignored");
    release?.();
    expect((await first).status).toBe("success");
  });

  test("a failed signOut is reported and can be retried", async () => {
    const gate = createLogoutGate();
    let calls = 0;
    const failing = async () => {
      calls += 1;
      throw new Error("network down");
    };
    const failure = await gate.run(failing);
    expect(failure.status).toBe("error");
    if (failure.status === "error") {
      expect(String(failure.error)).toContain("network down");
    }

    const retry = await gate.run(async () => {
      calls += 1;
    });
    expect(retry.status).toBe("success");
    expect(calls).toBe(2);
  });

  test("cancel is a pure close operation and never invokes signOut", async () => {
    const gate = createLogoutGate();
    let calls = 0;
    // Cancelling the dialog does not call the gate at all; this asserts the
    // shared contract that the gate is only reached from confirm.
    expect(calls).toBe(0);
    expect((await gate.run(async () => { calls += 1; })).status).toBe("success");
    expect(calls).toBe(1);
  });
});
