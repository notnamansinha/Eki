import { describe, expect, it } from "vitest";
import { createConcurrencyLimiter } from "./concurrency";

function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 1));
}

describe("createConcurrencyLimiter", () => {
  it("never runs more than the configured limit of tasks concurrently", async () => {
    const limiter = createConcurrencyLimiter(2);
    let active = 0;
    let peak = 0;

    const task = () =>
      limiter.run(async () => {
        active += 1;
        peak = Math.max(peak, active);
        await tick();
        active -= 1;
      });

    await Promise.all([task(), task(), task(), task(), task(), task()]);

    expect(peak).toBe(2);
    expect(active).toBe(0);
  });

  it("runs every queued task to completion", async () => {
    const limiter = createConcurrencyLimiter(2);
    const completed: number[] = [];

    await Promise.all(
      [1, 2, 3, 4, 5, 6].map((value) =>
        limiter.run(async () => {
          await tick();
          completed.push(value);
        }),
      ),
    );

    expect(completed.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("returns the work result", async () => {
    const limiter = createConcurrencyLimiter(1);
    await expect(limiter.run(async () => "result")).resolves.toBe("result");
  });
});
