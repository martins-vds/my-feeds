import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useNavigate } from "react-router-dom";
import { PostDetailPage } from "../PostDetailPage";
import { ApiError } from "../../../services/api";

const { mockApi } = vi.hoisted(() => ({ mockApi: { get: vi.fn(), put: vi.fn() } }));
vi.mock("../../../services/api", async (original) => ({
  ...(await original<typeof import("../../../services/api")>()),
  default: mockApi,
  api: mockApi,
}));

// A one-word title and a body of 100 five-letter words. Silent reading gives each such word
// 240 ms at the base pace, so the article takes 101 x 240 ms and the figures below are exact.
const READ_MS = 101 * 240;
const BODY = `<p>${Array.from({ length: 100 }, () => "alpha").join(" ")}</p>`;
const READY_AUDIO = { status: "ready", url: "/api/audio/p1.mp3", durationSeconds: 100 };
// The same 101 words with timings, one every 900 ms: the clip says word n during [900n, 900n + 800].
const TIMED_AUDIO = {
  ...READY_AUDIO,
  wordTimings: Array.from({ length: 101 }, (_, n) => ({
    text: n === 0 ? "Hello" : "alpha",
    startMs: n * 900,
    durationMs: 800,
  })),
};

function detail(overrides: Record<string, unknown> = {}) {
  return {
    id: "p1",
    feedId: "f1",
    feedTitle: "Feed",
    feedIconUrl: null,
    title: "Hello",
    content: BODY,
    summary: null,
    author: null,
    link: "https://example.com/p1",
    publishedAt: "2026-01-01T00:00:00Z",
    isRead: false,
    readProgress: 0,
    hasAudio: false,
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

class FakeAudio extends EventTarget {
  static instances: FakeAudio[] = [];
  src: string;
  preload = "";
  playbackRate = 1;
  volume = 1;
  muted = false;
  paused = true;
  #time = 0;
  constructor(src: string) {
    super();
    this.src = src;
    FakeAudio.instances.push(this);
  }
  get currentTime() {
    return this.#time;
  }
  set currentTime(seconds: number) {
    this.#time = seconds;
    this.dispatchEvent(new Event("seeking"));
    this.dispatchEvent(new Event("seeked"));
  }
  play() {
    this.paused = false;
    this.dispatchEvent(new Event("play"));
    return Promise.resolve();
  }
  pause() {
    this.paused = true;
    this.dispatchEvent(new Event("pause"));
  }
  /** Moves the playhead and reports it, as a playing element does. */
  advanceTo(seconds: number) {
    this.#time = seconds;
    this.dispatchEvent(new Event("timeupdate"));
  }
  /** Plays the clip out, as an element does when it reaches its end. */
  finish() {
    this.paused = true;
    this.dispatchEvent(new Event("pause"));
    this.dispatchEvent(new Event("ended"));
  }
}

interface Backend {
  posts: Record<string, Record<string, unknown>>;
  audio: () => Promise<unknown>;
  saveProgress: (postId: string, progress: number) => Promise<unknown>;
}

/** Answers the page's requests like the server: the post, its audio, and saved progress. */
function serve(overrides: Partial<Backend> = {}) {
  const backend: Backend = {
    audio: async () => READY_AUDIO,
    saveProgress: async (postId, progress) => ({
      postId,
      isRead: progress >= 0.95,
      readProgress: progress,
      readAt: null,
    }),
    ...overrides,
    posts: { p1: detail(), p2: detail({ id: "p2", title: "Other" }), ...overrides.posts },
  };
  mockApi.get.mockImplementation(async (path: string) => {
    if (/^\/posts\/[^/]+\/audio$/.test(path)) return backend.audio();
    const post = /^\/posts\/([^/]+)$/.exec(path);
    if (post && backend.posts[post[1]]) return backend.posts[post[1]];
    throw new ApiError(404, "NOT_FOUND", "Post not found");
  });
  mockApi.put.mockImplementation(async (path: string, body: { progress?: number }) => {
    const saved = /^\/posts\/([^/]+)\/progress$/.exec(path);
    return saved ? backend.saveProgress(saved[1], body.progress ?? 0) : {};
  });
}

type ProgressCall = [path: string, body: { progress: number }, options: { keepalive: boolean }];
const progressCalls = () =>
  (mockApi.put.mock.calls as unknown[][]).filter(
    ([path]) => typeof path === "string" && path.endsWith("/progress")
  ) as ProgressCall[];
const lastSent = () => progressCalls().at(-1)?.[1].progress;
const audioRequests = () =>
  mockApi.get.mock.calls.filter(([path]) => String(path).endsWith("/audio")).length;

const flush = (ms = 0) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

function Harness() {
  const navigate = useNavigate();
  return (
    <>
      <button data-testid="go-p2" onClick={() => navigate("/posts/p2")}>
        Next
      </button>
      <PostDetailPage />
    </>
  );
}

async function openPage() {
  render(
    <MemoryRouter initialEntries={["/posts/p1"]}>
      <Routes>
        <Route path="/posts/:id" element={<Harness />} />
      </Routes>
    </MemoryRouter>
  );
  await flush();
}

const chip = () => screen.getByTestId("read-state-chip");
const percentRead = () =>
  Number.parseInt(screen.getByTestId("pacer-percent").textContent ?? "", 10);
const words = () => document.querySelectorAll(".ra-word");
const spokenWord = () => {
  const spoken = document.querySelectorAll(".ra-active");
  expect(spoken).toHaveLength(1);
  return Number(spoken[0].getAttribute("data-ra-index"));
};

function start() {
  fireEvent.click(screen.getByTestId("start-reading-button"));
}

function startWithSound() {
  fireEvent.click(screen.getByTestId("start-reading-menu"));
  fireEvent.click(screen.getByTestId("read-with-sound"));
}

/** Opens the article and plays its clip, whose timings say one word after another. */
async function playTimedClip() {
  serve({ audio: async () => TIMED_AUDIO });
  await openPage();
  startWithSound();
  await flush();
  return FakeAudio.instances[0];
}

const viewportCallbacks: IntersectionObserverCallback[] = [];

function stubIntersectionObserver() {
  viewportCallbacks.length = 0;
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(callback: IntersectionObserverCallback) {
        viewportCallbacks.push(callback);
      }
      observe() {}
      disconnect() {}
    }
  );
}

/** Reports everything the page observes (the inline controls, the footer) as out of view. */
function leaveViewport() {
  act(() => {
    for (const callback of viewportCallbacks) {
      callback(
        [{ isIntersecting: false } as IntersectionObserverEntry],
        {} as IntersectionObserver
      );
    }
  });
}

let scrollIntoView: ReturnType<typeof vi.fn>;

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers();
  vi.stubGlobal("Audio", FakeAudio);
  FakeAudio.instances = [];
  scrollIntoView = vi.fn();
  Element.prototype.scrollIntoView = scrollIntoView as unknown as Element["scrollIntoView"];
  serve();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
});

describe("the reading surface", () => {
  it("offers Start reading on an unread article", async () => {
    await openPage();
    expect(screen.getByTestId("start-reading-button")).toHaveTextContent("Start reading");
    expect(screen.queryByTestId("pacer-controls")).toBeNull();
    expect(screen.queryByTestId("play-pause-button")).toBeNull();
    expect(screen.queryByTestId("read-mode-switch")).toBeNull();
    expect(chip()).toHaveTextContent(/^Unread$/);
  });

  it("offers no reading controls when there is nothing to read", async () => {
    serve({ posts: { p1: detail({ content: '<a href="https://example.com/c">Comments</a>' }) } });
    await openPage();
    expect(screen.getByTestId("post-title")).toBeInTheDocument();
    expect(screen.queryByTestId("start-reading-button")).toBeNull();
    expect(screen.queryByTestId("read-along-toggles")).toBeNull();
  });

  it("starts silent reading in place, with every word wrapped for highlighting", async () => {
    await openPage();
    start();
    await flush(2_000);
    expect(screen.queryByTestId("start-reading-button")).toBeNull();
    expect(screen.getByTestId("pacer-play-button")).toHaveAccessibleName("Pause");
    expect(percentRead()).toBeGreaterThanOrEqual(7);
    expect(percentRead()).toBeLessThanOrEqual(9);
    expect(words()).toHaveLength(101);
  });

  it("continues a partly read article where the reader left off", async () => {
    serve({ posts: { p1: detail({ readProgress: 0.42 }) } });
    await openPage();
    expect(screen.getByTestId("start-reading-button")).toHaveTextContent("Continue reading · 42%");
    expect(chip()).toHaveTextContent("In progress · 42%");
    start();
    await flush();
    expect(percentRead()).toBe(42);
    await flush(1_000);
    expect(percentRead()).toBeGreaterThan(42);
  });

  it("reads a finished article again from the top without saving anything", async () => {
    serve({ posts: { p1: detail({ isRead: true, readProgress: 1 }) } });
    await openPage();
    expect(screen.getByTestId("start-reading-button")).toHaveTextContent("Read again");
    expect(chip()).toHaveTextContent(/^Read$/);
    start();
    await flush();
    expect(percentRead()).toBe(0);
    await flush(3_000);
    expect(percentRead()).toBeGreaterThan(0);
    expect(progressCalls()).toHaveLength(0);
  });

  it("remembers the mode the reader started in", async () => {
    localStorage.setItem("readAlong.readingMode", "sound");
    await openPage();
    fireEvent.click(screen.getByTestId("start-reading-menu"));
    fireEvent.click(screen.getByTestId("read-silently"));
    await flush();
    expect(screen.getByTestId("pacer-controls")).toBeInTheDocument();
    expect(localStorage.getItem("readAlong.readingMode")).toBe("silent");
  });
});

describe("reading with sound", () => {
  it("waits for the audio, then plays it from the top", async () => {
    const audio = deferred<unknown>();
    serve({ audio: () => audio.promise });
    await openPage();
    startWithSound();
    await flush();
    expect(screen.getByText("Loading audio…")).toBeInTheDocument();
    expect(FakeAudio.instances).toHaveLength(0);
    await act(async () => {
      audio.resolve(READY_AUDIO);
    });
    await flush();
    expect(FakeAudio.instances[0].paused).toBe(false);
    expect(screen.getByTestId("play-pause-button")).toHaveAccessibleName("Pause");
    expect(screen.queryByTestId("pacer-controls")).toBeNull();
    expect(localStorage.getItem("readAlong.readingMode")).toBe("sound");
  });

  it("resumes the audio at the stored place", async () => {
    localStorage.setItem("readAlong.readingMode", "sound");
    serve({ posts: { p1: detail({ readProgress: 0.5 }) } });
    await openPage();
    start();
    await flush();
    expect(FakeAudio.instances[0].currentTime).toBe(50);
    expect(FakeAudio.instances[0].paused).toBe(false);
  });

  it("plays a finished article again from the top", async () => {
    localStorage.setItem("readAlong.readingMode", "sound");
    serve({ posts: { p1: detail({ isRead: true, readProgress: 1 }) } });
    await openPage();
    start();
    await flush();
    expect(FakeAudio.instances[0].currentTime).toBe(0);
    expect(FakeAudio.instances[0].paused).toBe(false);
  });

  it("offers silent reading when the audio cannot be made", async () => {
    serve({
      audio: () =>
        Promise.reject(new ApiError(403, "EXTERNAL_PROCESSING_DISABLED", "Audio is disabled.")),
    });
    await openPage();
    startWithSound();
    await flush();
    expect(screen.getByTestId("audio-read-silently")).toBeInTheDocument();
    expect(screen.queryByTestId("read-mode-switch")).toBeNull();
    fireEvent.click(screen.getByTestId("audio-read-silently"));
    await flush(1_000);
    expect(screen.getByTestId("pacer-play-button")).toHaveAccessibleName("Pause");
    expect(percentRead()).toBeGreaterThan(0);
  });

  it("plays once Retry gets the audio the start was waiting for", async () => {
    let attempts = 0;
    serve({
      audio: async () => {
        attempts += 1;
        if (attempts === 1) throw new ApiError(500, "SERVER_ERROR", "Try again.");
        return READY_AUDIO;
      },
    });
    await openPage();
    startWithSound();
    await flush();
    expect(FakeAudio.instances).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Retry audio generation" }));
    await flush();
    expect(FakeAudio.instances[0].paused).toBe(false);
    expect(screen.getByTestId("play-pause-button")).toHaveAccessibleName("Pause");
  });

  it("reports listening progress from the audio clock", async () => {
    serve({ posts: { p1: detail({ hasAudio: true }) } });
    await openPage();
    fireEvent.click(screen.getByTestId("play-pause-button"));
    act(() => FakeAudio.instances[0].advanceTo(4));
    await flush();
    expect(lastSent()).toBeCloseTo(0.04, 5);
    expect(chip()).toHaveTextContent("In progress · 4%");
  });

  it("does not play a clip again once it has played to the end", async () => {
    await openPage();
    startWithSound();
    await flush();
    const media = FakeAudio.instances[0];
    expect(media.paused).toBe(false);
    act(() => media.finish());
    await flush();
    expect(media.paused).toBe(true);
    expect(screen.getByTestId("play-pause-button")).toHaveAccessibleName("Play");
  });
});

describe("switching between sound and silent", () => {
  it("goes from a playing clip to silent reading at the same place", async () => {
    serve({ posts: { p1: detail({ hasAudio: true }) } });
    await openPage();
    const media = FakeAudio.instances[0];
    fireEvent.click(screen.getByTestId("play-pause-button"));
    act(() => media.advanceTo(30));
    fireEvent.click(screen.getByTestId("read-mode-switch"));
    await flush();
    expect(media.paused).toBe(true);
    expect(screen.getByTestId("read-mode-switch")).toHaveTextContent("Listen instead");
    expect(percentRead()).toBe(30);
    expect(screen.getByTestId("pacer-play-button")).toHaveAccessibleName("Pause");
    expect(localStorage.getItem("readAlong.readingMode")).toBe("silent");
  });

  it("goes from a clip nobody played to silent reading at the stored place", async () => {
    serve({ posts: { p1: detail({ hasAudio: true, readProgress: 0.3 }) } });
    await openPage();
    expect(screen.getByTestId("read-mode-switch")).toHaveTextContent("Read silently");
    fireEvent.click(screen.getByTestId("read-mode-switch"));
    await flush();
    expect(percentRead()).toBe(30);
  });

  it("goes from silent reading to the clip at the same place", async () => {
    await openPage();
    start();
    await flush(6_000);
    const left = percentRead();
    fireEvent.click(screen.getByTestId("read-mode-switch"));
    await flush();
    const media = FakeAudio.instances[0];
    expect(screen.queryByTestId("pacer-controls")).toBeNull();
    expect(media.paused).toBe(false);
    expect(Math.floor(media.currentTime)).toBe(left);
    expect(screen.getByTestId("play-pause-button")).toHaveAccessibleName("Pause");
    expect(localStorage.getItem("readAlong.readingMode")).toBe("sound");
  });

  it("goes back to a loaded clip without loading it again", async () => {
    serve({ posts: { p1: detail({ hasAudio: true }) } });
    await openPage();
    fireEvent.click(screen.getByTestId("read-mode-switch"));
    await flush(6_000);
    const left = percentRead();
    fireEvent.click(screen.getByTestId("read-mode-switch"));
    await flush();
    expect(FakeAudio.instances).toHaveLength(1);
    expect(audioRequests()).toBe(1);
    expect(FakeAudio.instances[0].paused).toBe(false);
    expect(Math.floor(FakeAudio.instances[0].currentTime)).toBe(left);
  });

  it("listens from the place the reader chose, even when that is the very start", async () => {
    serve({ posts: { p1: detail({ hasAudio: true }) } });
    await openPage();
    const media = FakeAudio.instances[0];
    fireEvent.click(screen.getByTestId("play-pause-button"));
    act(() => media.advanceTo(30));
    fireEvent.click(screen.getByTestId("read-mode-switch"));
    await flush();
    fireEvent.change(screen.getByRole("slider", { name: "Reading position" }), {
      target: { value: "0" },
    });
    await flush();
    expect(percentRead()).toBe(0);
    fireEvent.click(screen.getByTestId("read-mode-switch"));
    await flush();
    expect(media.currentTime).toBe(0);
    expect(media.paused).toBe(false);
  });

  it("asks for the audio again when the reader comes back to it after a failure", async () => {
    let healthy = false;
    serve({
      audio: async () => {
        if (!healthy) throw new ApiError(500, "SERVER_ERROR", "Try again.");
        return READY_AUDIO;
      },
    });
    await openPage();
    startWithSound();
    await flush();
    fireEvent.click(screen.getByTestId("audio-read-silently"));
    await flush(6_000);
    const left = percentRead();
    healthy = true;
    fireEvent.click(screen.getByTestId("read-mode-switch"));
    await flush();
    expect(audioRequests()).toBe(2);
    expect(FakeAudio.instances[0].paused).toBe(false);
    expect(Math.floor(FakeAudio.instances[0].currentTime)).toBe(left);
  });

  it("waits for a clip that is still loading when the reader goes back to it", async () => {
    const audio = deferred<unknown>();
    serve({ audio: () => audio.promise });
    await openPage();
    startWithSound();
    await flush();
    fireEvent.click(screen.getByTestId("read-mode-switch"));
    await flush(6_000);
    const left = percentRead();
    fireEvent.click(screen.getByTestId("read-mode-switch"));
    await flush();
    expect(audioRequests()).toBe(1);
    await act(async () => {
      audio.resolve(READY_AUDIO);
    });
    await flush();
    expect(FakeAudio.instances[0].paused).toBe(false);
    expect(Math.floor(FakeAudio.instances[0].currentTime)).toBe(left);
  });
});

describe("silent reading controls", () => {
  it("pauses, resumes, seeks and changes the pace", async () => {
    await openPage();
    start();
    await flush(1_000);
    fireEvent.click(screen.getByTestId("pacer-play-button"));
    await flush();
    expect(screen.getByTestId("pacer-play-button")).toHaveAccessibleName("Play");
    const held = percentRead();
    await flush(3_000);
    expect(percentRead()).toBe(held);

    fireEvent.change(screen.getByRole("slider", { name: "Reading position" }), {
      target: { value: "40" },
    });
    await flush();
    expect(percentRead()).toBe(40);

    fireEvent.click(screen.getByTestId("pacer-speed-button"));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "300 words per minute" }));
    expect(localStorage.getItem("readAlong.wpm")).toBe("300");
    expect(screen.getByTestId("pacer-speed-button")).toHaveTextContent("300 wpm");

    fireEvent.click(screen.getByTestId("pacer-play-button"));
    await flush(5_000);
    // Five seconds at 300 wpm cover six seconds of the 24.24 s article, so 40% becomes about 65%.
    expect(percentRead()).toBeGreaterThanOrEqual(63);
    expect(percentRead()).toBeLessThanOrEqual(66);
  });

  it("stops and remembers the place", async () => {
    await openPage();
    start();
    await flush(6_000);
    fireEvent.click(screen.getByTestId("pacer-stop-button"));
    await flush();
    const saved = lastSent()!;
    expect(saved).toBeGreaterThan(0.2);
    expect(saved).toBeLessThan(0.3);
    expect(screen.queryByTestId("pacer-controls")).toBeNull();
    expect(screen.getByTestId("start-reading-button")).toHaveTextContent(
      `Continue reading · ${Math.floor(saved * 100)}%`
    );
  });

  it("starts another session after stopping", async () => {
    await openPage();
    start();
    await flush(6_000);
    fireEvent.click(screen.getByTestId("pacer-stop-button"));
    await flush();
    const resumeAt = Math.floor(lastSent()! * 100);
    start();
    await flush();
    expect(percentRead()).toBe(resumeAt);
    await flush(1_000);
    expect(screen.getByTestId("pacer-play-button")).toHaveAccessibleName("Pause");
    expect(percentRead()).toBeGreaterThan(resumeAt);
  });

  it("saves the place the reader had reached at the moment of stopping", async () => {
    await openPage();
    start();
    // The pacer reports its place about every 250 ms, so the last report is behind by now.
    await flush(2_740);
    fireEvent.click(screen.getByTestId("pacer-stop-button"));
    await flush();
    expect(lastSent()).toBeGreaterThan(0.11);
  });

  it("leaves nothing running once the reader stops", async () => {
    await openPage();
    const idle = vi.getTimerCount();
    start();
    await flush(1_000);
    expect(vi.getTimerCount()).toBeGreaterThan(idle);
    fireEvent.click(screen.getByTestId("pacer-stop-button"));
    await flush(1_000);
    expect(vi.getTimerCount()).toBe(idle);
  });
});

describe("highlighting and auto-scroll", () => {
  const highlightSwitch = () => screen.getByRole("switch", { name: "Highlight while playing" });

  it("marks the word being read as the pacer moves on", async () => {
    await openPage();
    start();
    await flush(2_000);
    expect(spokenWord()).toBe(8);
    await flush(2_000);
    expect(spokenWord()).toBe(16);
  });

  it("keeps highlighting on while the reader reads silently", async () => {
    localStorage.setItem("readAlong.highlight", "false");
    await openPage();
    expect(highlightSwitch()).not.toBeChecked();
    expect(highlightSwitch()).toBeEnabled();
    expect(words()).toHaveLength(0);

    start();
    await flush();
    expect(highlightSwitch()).toBeChecked();
    expect(highlightSwitch()).toBeDisabled();
    expect(screen.getByText("Highlighting stays on while you read silently.")).toBeInTheDocument();
    expect(words().length).toBeGreaterThan(0);

    fireEvent.click(screen.getByTestId("pacer-stop-button"));
    await flush();
    expect(highlightSwitch()).not.toBeChecked();
    expect(highlightSwitch()).toBeEnabled();
    expect(words()).toHaveLength(0);
    expect(localStorage.getItem("readAlong.highlight")).toBe("false");
  });

  it("holds auto-scroll while the pace menu is open", async () => {
    await openPage();
    start();
    await flush(1_000);
    expect(scrollIntoView).toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("pacer-speed-button"));
    await flush();
    scrollIntoView.mockClear();
    await flush(2_000);
    expect(scrollIntoView).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("menuitemradio", { name: "250 words per minute" }));
    await flush(2_000);
    expect(scrollIntoView).toHaveBeenCalled();
  });
});

describe("highlighting with sound", () => {
  it("marks the word being spoken as the clip plays", async () => {
    const media = await playTimedClip();
    act(() => media.advanceTo(9.5));
    await flush(100);
    expect(spokenWord()).toBe(10);
    act(() => media.advanceTo(18.2));
    await flush(100);
    expect(spokenWord()).toBe(20);
  });

  it("holds auto-scroll while the speed menu of the audio player is open", async () => {
    const media = await playTimedClip();
    act(() => media.advanceTo(2));
    await flush(100);
    expect(scrollIntoView).toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("speed-button"));
    await flush();
    scrollIntoView.mockClear();
    act(() => media.advanceTo(9.5));
    await flush(100);
    expect(scrollIntoView).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("menuitem", { name: "1.5x" }));
    act(() => media.advanceTo(18.2));
    await flush(100);
    expect(scrollIntoView).toHaveBeenCalled();
  });
});

describe("saving progress", () => {
  it("saves silent reading and shows it as in progress", async () => {
    await openPage();
    start();
    await flush(500);
    expect(progressCalls()).toHaveLength(1);
    expect(progressCalls()[0][0]).toBe("/posts/p1/progress");
    expect(progressCalls()[0][2]).toEqual({ keepalive: false });

    await flush(11_000);
    expect(progressCalls()).toHaveLength(2);
    const shown = Math.floor(lastSent()! * 100);
    expect(shown).toBeGreaterThan(30);
    expect(chip()).toHaveTextContent(`In progress · ${shown}%`);
  });

  it("marks the article Read when the reader gets to the end", async () => {
    await openPage();
    start();
    await flush(READ_MS + 1_000);
    expect(lastSent()).toBeGreaterThanOrEqual(0.95);
    expect(chip()).toHaveTextContent(/^Read$/);
    expect(screen.getByTestId("read-state-toggle")).toHaveAttribute("data-is-read", "true");
    const saves = progressCalls().length;
    await flush(30_000);
    expect(progressCalls()).toHaveLength(saves);
  });

  it("stops saving once the reader marks the article read", async () => {
    await openPage();
    start();
    await flush(3_000);
    const saves = progressCalls().length;
    expect(saves).toBeGreaterThan(0);

    fireEvent.click(screen.getByTestId("read-state-toggle"));
    await flush();
    expect(mockApi.put).toHaveBeenCalledWith("/posts/p1/read-state", { isRead: true });
    expect(chip()).toHaveTextContent(/^Read$/);
    await flush(30_000);
    expect(progressCalls()).toHaveLength(saves);

    fireEvent.click(screen.getByTestId("pacer-stop-button"));
    await flush();
    expect(screen.getByTestId("start-reading-button")).toHaveTextContent("Read again");
  });

  it("ignores a save that lands after the reader marked the article read", async () => {
    const slow = deferred<unknown>();
    serve({ saveProgress: () => slow.promise });
    await openPage();
    start();
    await flush(500);
    expect(progressCalls()).toHaveLength(1);

    fireEvent.click(screen.getByTestId("read-state-toggle"));
    await flush();
    expect(chip()).toHaveTextContent(/^Read$/);
    await act(async () => {
      slow.resolve({ postId: "p1", isRead: false, readProgress: 0.01, readAt: null });
    });
    await flush();
    expect(chip()).toHaveTextContent(/^Read$/);
  });

  it("saves nothing when a finished article is read through again", async () => {
    // Anything from 95% counts as read, so a finished article need not be stored as 100%.
    serve({ posts: { p1: detail({ isRead: true, readProgress: 0.96 }) } });
    await openPage();
    start();
    await flush(READ_MS + 1_000);
    expect(progressCalls()).toHaveLength(0);
    expect(chip()).toHaveTextContent(/^Read$/);
  });

  it("starts a read article over when the reader marks it unread", async () => {
    serve({ posts: { p1: detail({ isRead: true, readProgress: 1 }) } });
    await openPage();
    fireEvent.click(screen.getByTestId("read-state-toggle"));
    await flush();
    expect(mockApi.put).toHaveBeenCalledWith("/posts/p1/read-state", { isRead: false });
    expect(chip()).toHaveTextContent(/^Unread$/);
    expect(screen.getByTestId("start-reading-button")).toHaveTextContent("Start reading");

    start();
    await flush(1_000);
    expect(progressCalls().length).toBeGreaterThan(0);
  });

  it("saves nothing while the clip replays ground the reader already covered", async () => {
    serve({ posts: { p1: detail({ hasAudio: true, readProgress: 0.4 }) } });
    await openPage();
    fireEvent.click(screen.getByTestId("play-pause-button"));
    const media = FakeAudio.instances[0];
    for (let seconds = 4; seconds <= 40; seconds += 4) {
      act(() => media.advanceTo(seconds));
      await flush(1_000);
    }
    expect(progressCalls()).toHaveLength(0);
    expect(chip()).toHaveTextContent("In progress · 40%");

    act(() => media.advanceTo(44));
    await flush();
    expect(lastSent()).toBeCloseTo(0.44, 5);
  });

  it("keeps saving when the reader switches between sound and silent", async () => {
    serve({ posts: { p1: detail({ hasAudio: true }) } });
    await openPage();
    const media = FakeAudio.instances[0];
    fireEvent.click(screen.getByTestId("play-pause-button"));
    act(() => media.advanceTo(4));
    await flush();
    expect(lastSent()).toBeCloseTo(0.04, 5);

    // Eleven seconds of silent reading add 11 of the article's 24.24 seconds to the 4% already read.
    fireEvent.click(screen.getByTestId("read-mode-switch"));
    await flush(11_000);
    expect(lastSent()).toBeGreaterThan(0.43);
    expect(lastSent()).toBeLessThan(0.47);

    fireEvent.click(screen.getByTestId("read-mode-switch"));
    await flush(10_000);
    const resumedAt = media.currentTime;
    act(() => media.advanceTo(resumedAt + 4));
    await flush();
    expect(lastSent()).toBeCloseTo((resumedAt + 4) / 100, 5);
  });
});

describe("leaving the article", () => {
  it("saves the place and starts the next article idle", async () => {
    await openPage();
    start();
    await flush(3_000);
    fireEvent.click(screen.getByTestId("go-p2"));
    await flush();
    const last = progressCalls().at(-1)!;
    expect(last[0]).toBe("/posts/p1/progress");
    expect(last[1].progress).toBeGreaterThan(0.1);
    expect(screen.getByTestId("post-title")).toHaveTextContent("Other");
    expect(screen.getByTestId("start-reading-button")).toHaveTextContent("Start reading");
    expect(screen.queryByTestId("pacer-controls")).toBeNull();
    expect(chip()).toHaveTextContent(/^Unread$/);
  });

  it("saves the place the reader had reached at the moment of leaving", async () => {
    await openPage();
    start();
    // The pacer reports its place about every 250 ms, so the last report is behind by now.
    await flush(2_740);
    fireEvent.click(screen.getByTestId("go-p2"));
    await flush();
    expect(lastSent()).toBeGreaterThan(0.11);
  });

  it("ignores a late save for the article the reader left", async () => {
    const slow = deferred<unknown>();
    serve({
      saveProgress: (postId, progress) =>
        postId === "p1"
          ? slow.promise
          : Promise.resolve({ postId, isRead: false, readProgress: progress, readAt: null }),
    });
    await openPage();
    start();
    await flush(500);
    fireEvent.click(screen.getByTestId("go-p2"));
    await flush();
    await act(async () => {
      slow.resolve({ postId: "p1", isRead: true, readProgress: 1, readAt: "2026-01-02T00:00:00Z" });
    });
    await flush();
    expect(screen.getByTestId("post-title")).toHaveTextContent("Other");
    expect(chip()).toHaveTextContent(/^Unread$/);
  });

  it("saves the place when the page closes", async () => {
    await openPage();
    start();
    await flush(3_000);
    const saves = progressCalls().length;
    cleanup();
    expect(progressCalls().length).toBeGreaterThan(saves);
    expect(lastSent()).toBeGreaterThan(0.1);
  });

  it("tracks the next article from its own start, not from the last one's place", async () => {
    serve({ posts: { p1: detail({ readProgress: 0.6 }) } });
    await openPage();
    start();
    await flush(500);
    fireEvent.click(screen.getByTestId("go-p2"));
    await flush();
    start();
    await flush(2_000);
    const saved = progressCalls().filter(([path]) => path === "/posts/p2/progress");
    expect(saved.length).toBeGreaterThan(0);
    expect(saved[0][1].progress).toBeLessThan(0.1);
  });

  it("does not play the next article's clip for a start that was made on this one", async () => {
    let attempts = 0;
    serve({
      audio: async () => {
        attempts += 1;
        if (attempts === 1) throw new ApiError(500, "SERVER_ERROR", "Try again.");
        return READY_AUDIO;
      },
    });
    await openPage();
    startWithSound();
    await flush();
    expect(FakeAudio.instances).toHaveLength(0);

    // The player keeps its status when the article changes, so the failure is offered again here.
    fireEvent.click(screen.getByTestId("go-p2"));
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "Retry audio generation" }));
    await flush();
    expect(FakeAudio.instances).toHaveLength(1);
    expect(FakeAudio.instances[0].paused).toBe(true);
  });

  it("leaves nothing running when the reader moves on while reading", async () => {
    await openPage();
    const idle = vi.getTimerCount();
    start();
    await flush(1_000);
    fireEvent.click(screen.getByTestId("go-p2"));
    await flush(1_000);
    expect(vi.getTimerCount()).toBe(idle);
  });
});

describe("floating controls", () => {
  beforeEach(() => {
    stubIntersectionObserver();
  });

  it("show the pace for silent reading and drive the pacer", async () => {
    await openPage();
    start();
    await flush(500);
    leaveViewport();
    expect(screen.getByTestId("floating-audio-controls")).toBeInTheDocument();
    expect(screen.queryByTestId("floating-mute-button")).toBeNull();
    expect(screen.getByTestId("floating-speed-button")).toHaveAccessibleName("Reading speed");
    expect(screen.getByTestId("floating-speed-button")).toHaveTextContent("250");

    fireEvent.click(screen.getByTestId("floating-speed-button"));
    fireEvent.click(screen.getByRole("button", { name: "Set speed 300" }));
    expect(localStorage.getItem("readAlong.wpm")).toBe("300");
    expect(screen.getByTestId("floating-speed-button")).toHaveTextContent("300");

    fireEvent.click(screen.getByTestId("floating-play-button"));
    expect(screen.getByTestId("floating-play-button")).toHaveAccessibleName("Play");
    expect(screen.getByTestId("pacer-play-button")).toHaveAccessibleName("Play");
  });

  it("hold auto-scroll while their pace options are open", async () => {
    await openPage();
    start();
    await flush(500);
    leaveViewport();
    fireEvent.click(screen.getByTestId("floating-speed-button"));
    await flush();
    scrollIntoView.mockClear();
    await flush(2_000);
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it("hold auto-scroll while their speed options for the clip are open", async () => {
    const media = await playTimedClip();
    leaveViewport();
    act(() => media.advanceTo(2));
    await flush(100);
    expect(scrollIntoView).toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("floating-speed-button"));
    await flush();
    scrollIntoView.mockClear();
    act(() => media.advanceTo(9.5));
    await flush(100);
    expect(scrollIntoView).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Set speed 1.5x" }));
    act(() => media.advanceTo(18.2));
    await flush(100);
    expect(scrollIntoView).toHaveBeenCalled();
  });

  it("are the audio controls, and only those, after the reader switches to sound", async () => {
    await openPage();
    start();
    await flush(1_000);
    leaveViewport();
    fireEvent.click(screen.getByTestId("read-mode-switch"));
    await flush();
    leaveViewport();
    expect(screen.getAllByTestId("floating-audio-controls")).toHaveLength(1);
    expect(screen.getByTestId("floating-speed-button")).toHaveAccessibleName("Playback speed");
    expect(screen.getByTestId("floating-mute-button")).toBeInTheDocument();
  });

  it("are the pace controls alone while the reader reads silently with a clip loaded", async () => {
    serve({ posts: { p1: detail({ hasAudio: true }) } });
    await openPage();
    fireEvent.click(screen.getByTestId("play-pause-button"));
    act(() => FakeAudio.instances[0].advanceTo(10));
    fireEvent.click(screen.getByTestId("read-mode-switch"));
    await flush();
    leaveViewport();
    expect(screen.getAllByTestId("floating-audio-controls")).toHaveLength(1);
    expect(screen.getByTestId("floating-speed-button")).toHaveAccessibleName("Reading speed");
  });
});
