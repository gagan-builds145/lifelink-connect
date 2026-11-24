import { describe, expect, test } from "bun:test";
import {
  LOCATION_CONSENT_MESSAGE,
  locationChoiceKey,
  readLocationChoice,
  writeLocationChoice,
} from "../src/lib/location";

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
    value: (key: string) => data.get(key) ?? null,
  };
}

describe("LifeLink location consent", () => {
  test("uses the requested clear message", () => {
    expect(LOCATION_CONSENT_MESSAGE).toBe(
      "Enable location to discover nearby services and make ambulance booking faster.",
    );
  });

  test("defaults to unset and does not share choices between users", () => {
    const storage = memoryStorage();
    expect(readLocationChoice(storage, "user-a")).toBe("unset");
    writeLocationChoice(storage, "user-a", "not_now");
    expect(readLocationChoice(storage, "user-a")).toBe("not_now");
    expect(readLocationChoice(storage, "user-b")).toBe("unset");
    expect(storage.value(locationChoiceKey("user-a"))).toBe("not_now");
  });

  test("persists enabled and denied states for later visits", () => {
    const storage = memoryStorage();
    writeLocationChoice(storage, "user-a", "enabled");
    expect(readLocationChoice(storage, "user-a")).toBe("enabled");
    writeLocationChoice(storage, "user-a", "denied");
    expect(readLocationChoice(storage, "user-a")).toBe("denied");
  });

  test("ignores invalid or unavailable storage without throwing", () => {
    const invalid = memoryStorage({
      [locationChoiceKey("user-a")]: "always-track-me",
    });
    expect(readLocationChoice(invalid, "user-a")).toBe("unset");
    expect(readLocationChoice(null, "user-a")).toBe("unset");
    expect(() => writeLocationChoice(null, "user-a", "enabled")).not.toThrow();
    const throwing = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    expect(readLocationChoice(throwing, "user-a")).toBe("unset");
    expect(() => writeLocationChoice(throwing, "user-a", "enabled")).not.toThrow();
  });

  test("no precise coordinates are part of the consent record", () => {
    const storage = memoryStorage();
    writeLocationChoice(storage, "user-a", "enabled");
    expect(storage.value(locationChoiceKey("user-a"))).toBe("enabled");
    expect(storage.value(locationChoiceKey("user-a"))).not.toContain(".");
  });
});
