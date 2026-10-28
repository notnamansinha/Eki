import { describe, expect, it } from "vitest";
import { logger } from "./logger";

describe("logger robustness", () => {
  it("does not throw on circular objects", () => {
    const value: Record<string, unknown> = { name: "a" };
    value.self = value;
    expect(() => logger.error("circular", value)).not.toThrow();
  });

  it("does not throw on BigInt details", () => {
    expect(() => logger.info("timing", { elapsedNs: 5n })).not.toThrow();
    expect(() => logger.info("timing", 7n)).not.toThrow();
  });

  it("does not throw on an Error with a non-string message, name or stack", () => {
    const error = new Error("x");
    Object.assign(error as unknown as Record<string, unknown>, {
      message: { code: 14 },
      name: 42,
      stack: { frames: [] },
    });
    expect(() => logger.error("odd error", error)).not.toThrow();
  });

  it("does not throw on an object with a throwing getter", () => {
    const value = Object.defineProperty({}, "boom", {
      enumerable: true,
      get() {
        throw new Error("getter");
      },
    });
    expect(() => logger.warn("getter", value)).not.toThrow();
  });

  it("does not throw on symbols, functions or objects whose keys cannot be listed", () => {
    const hostile = new Proxy({}, {
      ownKeys() {
        throw new Error("ownKeys");
      },
    });
    expect(() => logger.debug("misc", Symbol("s"), () => undefined, hostile)).not.toThrow();
  });
});
