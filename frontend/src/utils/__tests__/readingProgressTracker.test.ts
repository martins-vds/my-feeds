import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MAX_CREDIT_STEP_SECONDS,
  PROGRESS_FLUSH_INTERVAL_MS,
  ReadingProgressTracker,
} from "../readingProgressTracker";
import type { ProgressReport, SendOutcome } from "../readingProgressTracker";

interface SentRequest {
  progress: number;
  keepalive: boolean;
  respond: (outcome: SendOutcome) => Promise<void>;
  fail: (error: unknown) => Promise<void>;
}

// Lets the tracker's promise callbacks run before the test looks at the result.
const nextTurn = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

const saved = (readProgress: number, isRead = false): SendOutcome => ({
  kind: "saved",
  report: { readProgress, isRead },
});

/** A tracker whose clock and server are driven by the test. */
function setup(initialProgress = 0) {
  let time = 0;
  const requests: SentRequest[] = [];
  const updates: ProgressReport[] = [];
  const tracker = new ReadingProgressTracker({
    initialProgress,
    now: () => time,
    onUpdate: (report) => updates.push(report),
    send: (progress, options) =>
      new Promise<SendOutcome>((resolve, reject) => {
        requests.push({
          progress,
          keepalive: options.keepalive,
          respond: async (outcome) => {
            resolve(outcome);
            await nextTurn();
          },
          fail: async (error) => {
            reject(error);
            await nextTurn();
          },
        });
      }),
  });
  return {
    tracker,
    requests,
    updates,
    sent: () => requests.map((request) => request.progress),
    at: (ms: number) => {
      time = ms;
    },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ReadingProgressTracker crediting", () => {
  it("sends nothing while the position is under one percent", () => {
    const { tracker, requests } = setup();
    tracker.rebase(0);
    tracker.advance(0.9, 100);
    expect(requests).toHaveLength(0);
  });

  it("sends the first whole percent straight away", () => {
    const { tracker, requests, sent } = setup();
    tracker.rebase(0);
    tracker.advance(1, 100);
    expect(sent()).toEqual([0.01]);
    expect(requests[0].keepalive).toBe(false);
  });

  it("sends the exact fraction, not the rounded percent", () => {
    const { tracker, sent } = setup();
    tracker.rebase(0);
    tracker.advance(1, 3);
    expect(sent()).toEqual([1 / 3]);
  });

  it("credits the position, not the time spent", () => {
    const { tracker, sent } = setup();
    tracker.rebase(40);
    tracker.advance(41, 100);
    expect(sent()).toEqual([0.41]);
  });

  it("keeps the high-water mark when the reader moves back", async () => {
    const { tracker, requests, sent, at } = setup();
    tracker.rebase(40);
    tracker.advance(41, 100);
    await requests[0].fail(new Error("offline"));

    at(10_000);
    tracker.rebase(10);
    tracker.advance(11, 100);
    expect(sent()).toEqual([0.41, 0.41]);
  });

  it("credits a step of exactly five seconds", () => {
    const { tracker, sent } = setup();
    tracker.rebase(0);
    tracker.advance(5, 100);
    expect(sent()).toEqual([0.05]);
  });

  it("treats a step above five seconds as a jump and credits nothing", () => {
    const { tracker, requests } = setup();
    tracker.rebase(0);
    tracker.advance(5.001, 100);
    expect(requests).toHaveLength(0);
  });

  it("credits again from the new position after a jump", () => {
    const { tracker, sent } = setup();
    tracker.rebase(0);
    tracker.advance(60, 100);
    tracker.advance(61, 100);
    expect(sent()).toEqual([0.61]);
  });

  it("credits nothing for a zero or backwards step", () => {
    const { tracker, requests } = setup();
    tracker.rebase(70);
    tracker.advance(70, 100);
    tracker.advance(69, 100);
    expect(requests).toHaveLength(0);
  });

  it("treats the first update without a baseline as a rebase", () => {
    const { tracker, requests, sent } = setup();
    tracker.advance(3, 100);
    expect(requests).toHaveLength(0);

    tracker.advance(4, 100);
    expect(sent()).toEqual([0.04]);
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    "credits nothing, and poisons nothing, for a duration of %s",
    (duration) => {
      const { tracker, requests, sent } = setup();
      tracker.rebase(10);
      tracker.advance(11, duration);
      expect(requests).toHaveLength(0);

      tracker.advance(12, 100);
      expect(sent()).toEqual([0.12]);
    }
  );

  it("clamps the credited fraction to one", () => {
    const { tracker, sent } = setup();
    tracker.rebase(98);
    tracker.advance(101, 100);
    expect(sent()).toEqual([1]);
  });

  it("treats a stored progress as already sent", () => {
    const { tracker, requests, sent } = setup(0.5);
    tracker.rebase(49);
    tracker.advance(50, 100);
    tracker.flush();
    expect(requests).toHaveLength(0);

    tracker.advance(51, 100);
    expect(sent()).toEqual([0.51]);
  });
});

describe("ReadingProgressTracker when it sends", () => {
  it("keeps requests at least ten seconds apart", async () => {
    const { tracker, requests, sent, at } = setup();
    tracker.rebase(0);
    tracker.advance(1, 100);
    await requests[0].respond(saved(0.01));

    at(9_999);
    tracker.advance(2, 100);
    expect(requests).toHaveLength(1);

    at(10_000);
    tracker.advance(3, 100);
    expect(sent()).toEqual([0.01, 0.03]);
  });

  it("sends a held-back rise on the next update, even one that credits nothing", async () => {
    const { tracker, requests, sent, at } = setup();
    tracker.rebase(0);
    tracker.advance(1, 100);
    await requests[0].respond(saved(0.01));

    at(5_000);
    tracker.advance(2, 100);
    expect(requests).toHaveLength(1);

    at(10_000);
    tracker.advance(2, 100);
    expect(sent()).toEqual([0.01, 0.02]);
  });

  it("sends only when the whole percent has risen", async () => {
    const { tracker, requests, at } = setup();
    tracker.rebase(0);
    tracker.advance(1, 100);
    await requests[0].respond(saved(0.01));

    at(10_000);
    tracker.advance(1.9, 100);
    expect(requests).toHaveLength(1);
  });

  it.each([
    ["by default", undefined, false],
    ["when asked", { keepalive: true }, true],
  ])(
    "lets a forced flush skip the spacing and pass keepalive %s",
    async (_when, options, keepalive) => {
      const { tracker, requests, at } = setup();
      tracker.rebase(0);
      tracker.advance(1, 100);
      await requests[0].respond(saved(0.01));

      at(1_000);
      tracker.advance(2, 100);
      expect(requests).toHaveLength(1);

      tracker.flush(options);
      expect(requests).toHaveLength(2);
      expect(requests[1].progress).toBe(0.02);
      expect(requests[1].keepalive).toBe(keepalive);
    }
  );

  it("sends nothing on a forced flush when nothing is new", async () => {
    const { tracker, requests } = setup();
    tracker.flush();
    expect(requests).toHaveLength(0);

    tracker.rebase(0);
    tracker.advance(1, 100);
    await requests[0].respond(saved(0.01));
    tracker.flush();
    expect(requests).toHaveLength(1);
  });

  it("keeps one request in flight at a time", () => {
    const { tracker, requests, at } = setup();
    tracker.rebase(0);
    tracker.advance(1, 100);

    at(10_000);
    tracker.advance(2, 100);
    expect(requests).toHaveLength(1);
  });

  it("sends a forced flush made during a request once the request settles", async () => {
    const { tracker, requests, sent, at } = setup();
    tracker.rebase(0);
    tracker.advance(1, 100);
    at(1_000);
    tracker.advance(2, 100);
    tracker.flush();
    expect(requests).toHaveLength(1);

    await requests[0].respond(saved(0.01));
    expect(sent()).toEqual([0.01, 0.02]);
    expect(requests[1].keepalive).toBe(false);
  });

  it("uses a queued flush up once it has been sent", async () => {
    const { tracker, requests, at } = setup();
    tracker.rebase(0);
    tracker.advance(1, 100);
    at(1_000);
    tracker.advance(2, 100);
    tracker.flush();
    await requests[0].respond(saved(0.01));
    expect(requests).toHaveLength(2);

    tracker.advance(3, 100);
    await requests[1].respond(saved(0.02));
    expect(requests).toHaveLength(2);
  });

  it("drops a queued flush that turns out to have nothing new", async () => {
    const { tracker, requests } = setup();
    tracker.rebase(0);
    tracker.advance(1, 100);
    tracker.flush();

    await requests[0].respond(saved(0.01));
    expect(requests).toHaveLength(1);
  });

  it("does not queue a regular update behind a slow request", async () => {
    const { tracker, requests, sent, at } = setup();
    tracker.rebase(0);
    tracker.advance(1, 100);
    at(10_000);
    tracker.advance(2, 100);

    await requests[0].respond(saved(0.01));
    expect(requests).toHaveLength(1);

    tracker.advance(3, 100);
    expect(sent()).toEqual([0.01, 0.03]);
  });

  it("reads the time from performance.now unless it is given a clock", async () => {
    const now = vi.spyOn(performance, "now").mockReturnValue(0);
    const sent: number[] = [];
    const tracker = new ReadingProgressTracker({
      initialProgress: 0,
      onUpdate: () => {},
      send: (progress) => {
        sent.push(progress);
        return Promise.resolve(saved(progress));
      },
    });
    tracker.rebase(0);
    tracker.advance(1, 100);
    await nextTurn();

    now.mockReturnValue(9_999);
    tracker.advance(2, 100);
    now.mockReturnValue(10_000);
    tracker.advance(3, 100);
    expect(sent).toEqual([0.01, 0.03]);
  });
});

describe("ReadingProgressTracker answers", () => {
  it("hands a saved report to onUpdate", async () => {
    const { tracker, requests, updates } = setup();
    tracker.rebase(0);
    tracker.advance(1, 100);
    await requests[0].respond(saved(0.01));
    expect(updates).toEqual([{ readProgress: 0.01, isRead: false }]);
  });

  it("stops sending once the server says the article is read, whatever progress it reports", async () => {
    const { tracker, requests, updates, at } = setup();
    tracker.rebase(94);
    tracker.advance(95, 100);
    await requests[0].respond(saved(0.95, true));
    expect(updates).toEqual([{ readProgress: 0.95, isRead: true }]);

    at(10_000);
    tracker.advance(96, 100);
    tracker.flush();
    expect(requests).toHaveLength(1);
  });

  it("takes the server's progress as what is saved", async () => {
    const { tracker, requests, at } = setup();
    tracker.rebase(0);
    tracker.advance(1, 100);
    await requests[0].respond(saved(0.5));

    at(10_000);
    tracker.rebase(19);
    tracker.advance(20, 100);
    expect(requests).toHaveLength(1);
  });

  it("retries a failed attempt only after the spacing", async () => {
    const { tracker, requests, updates, sent, at } = setup();
    tracker.rebase(0);
    tracker.advance(1, 100);
    await requests[0].respond({ kind: "failed" });
    expect(updates).toHaveLength(0);

    at(1_000);
    tracker.advance(2, 100);
    expect(requests).toHaveLength(1);

    at(10_000);
    tracker.advance(3, 100);
    expect(sent()).toEqual([0.01, 0.03]);
  });

  it("counts a rejected send as a failure", async () => {
    const { tracker, requests, updates, at } = setup();
    tracker.rebase(0);
    tracker.advance(1, 100);
    await requests[0].fail(new Error("offline"));
    expect(updates).toHaveLength(0);

    at(10_000);
    tracker.advance(2, 100);
    expect(requests).toHaveLength(2);
  });

  it("waits out a rate limit from the moment it was answered, forced flushes included", async () => {
    const { tracker, requests, sent, at } = setup();
    at(5_000);
    tracker.rebase(0);
    tracker.advance(1, 100);
    at(8_000);
    await requests[0].respond({ kind: "rate-limited", retryAfterSeconds: 30 });

    at(37_999);
    tracker.advance(2, 100);
    tracker.flush();
    expect(requests).toHaveLength(1);

    at(38_000);
    tracker.advance(3, 100);
    expect(sent()).toEqual([0.01, 0.03]);
  });

  it("stops for good when told to stop", async () => {
    const { tracker, requests, at } = setup();
    tracker.rebase(0);
    tracker.advance(1, 100);
    await requests[0].respond({ kind: "stop" });

    at(10_000);
    tracker.advance(2, 100);
    tracker.flush();
    expect(requests).toHaveLength(1);
  });
});

describe("ReadingProgressTracker reset", () => {
  it("starts over after reset(0)", async () => {
    const { tracker, requests, sent, at } = setup();
    tracker.rebase(49);
    tracker.advance(50, 100);
    await requests[0].respond(saved(0.5));

    tracker.reset(0);
    at(10_000);
    tracker.rebase(0);
    tracker.advance(1, 100);
    expect(sent()).toEqual([0.5, 0.01]);
  });

  it("stays quiet after reset(1) because the article is read", () => {
    const { tracker, requests, at } = setup();
    tracker.reset(1);

    at(10_000);
    tracker.rebase(10);
    tracker.advance(11, 100);
    tracker.flush();
    expect(requests).toHaveLength(0);
  });

  it("resumes after reset(0) clears a stop", async () => {
    const { tracker, requests, sent, at } = setup();
    tracker.rebase(0);
    tracker.advance(1, 100);
    await requests[0].respond({ kind: "stop" });

    tracker.reset(0);
    at(10_000);
    tracker.advance(2, 100);
    expect(sent()).toEqual([0.01, 0.02]);
  });

  it("ignores a saved answer to a request sent before the reset", async () => {
    const { tracker, requests, updates, sent, at } = setup();
    tracker.rebase(49);
    tracker.advance(50, 100);
    tracker.reset(0);
    await requests[0].respond(saved(1, true));
    expect(updates).toHaveLength(0);

    at(10_000);
    tracker.rebase(0);
    tracker.advance(1, 100);
    expect(sent()).toEqual([0.5, 0.01]);
  });

  it("honors a rate limit that answers a request sent before the reset", async () => {
    const { tracker, requests, sent, at } = setup();
    tracker.rebase(0);
    tracker.advance(1, 100);
    tracker.reset(0);
    await requests[0].respond({ kind: "rate-limited", retryAfterSeconds: 30 });

    at(29_999);
    tracker.advance(2, 100);
    expect(requests).toHaveLength(1);

    at(30_000);
    tracker.advance(3, 100);
    expect(sent()).toEqual([0.01, 0.03]);
  });

  it("honors a stop that answers a request sent before the reset", async () => {
    const { tracker, requests, at } = setup();
    tracker.rebase(0);
    tracker.advance(1, 100);
    tracker.reset(0);
    await requests[0].respond({ kind: "stop" });

    at(10_000);
    tracker.advance(2, 100);
    tracker.flush();
    expect(requests).toHaveLength(1);
  });

  it("keeps one request in flight across a reset", () => {
    const { tracker, requests, at } = setup();
    tracker.rebase(0);
    tracker.advance(1, 100);
    tracker.reset(0);

    at(10_000);
    tracker.advance(2, 100);
    expect(requests).toHaveLength(1);
  });

  it("keeps a rate limit across a reset", async () => {
    const { tracker, requests, at } = setup();
    tracker.rebase(0);
    tracker.advance(1, 100);
    await requests[0].respond({ kind: "rate-limited", retryAfterSeconds: 30 });

    tracker.reset(0);
    at(10_000);
    tracker.advance(2, 100);
    expect(requests).toHaveLength(1);
  });

  it("drops a queued flush", async () => {
    const { tracker, requests, at } = setup();
    tracker.rebase(49);
    tracker.advance(50, 100);
    tracker.flush();
    tracker.reset(0);

    at(10_000);
    tracker.rebase(0);
    tracker.advance(1, 100);
    await requests[0].respond(saved(0.5));
    expect(requests).toHaveLength(1);
  });
});

describe("ReadingProgressTracker constants", () => {
  it("spaces requests ten seconds apart and credits at most five seconds a step", () => {
    expect(PROGRESS_FLUSH_INTERVAL_MS).toBe(10_000);
    expect(MAX_CREDIT_STEP_SECONDS).toBe(5);
  });
});
