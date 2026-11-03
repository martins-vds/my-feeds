import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useAudioPlayer } from "../useAudioPlayer";

const { mockApi } = vi.hoisted(() => ({ mockApi: { get: vi.fn() } }));
vi.mock("../../services/api", async (original) => ({
  ...(await original<typeof import("../../services/api")>()),
  default: mockApi,
  api: mockApi,
}));

// What the next audio.play() hands back: a promise that settles, or nothing to wait on.
let playResult: () => Promise<void> | undefined;
const refused = () => Promise.reject(new DOMException("Not allowed", "NotAllowedError"));

class FakeAudio extends EventTarget {
  src: string;
  preload = "";
  playbackRate = 1;
  volume = 1;
  muted = false;
  paused = true;
  currentTime = 0;
  constructor(src: string) {
    super();
    this.src = src;
  }
  play() {
    this.paused = false;
    return playResult();
  }
  pause() {
    this.paused = true;
  }
}

async function readyPlayer() {
  mockApi.get.mockResolvedValue({ status: "ready", url: "/api/audio/p1.mp3", durationSeconds: 10 });
  const hook = renderHook(() => useAudioPlayer("p1"));
  await act(async () => {
    await hook.result.current.generateAudio();
  });
  return hook;
}

beforeEach(() => {
  vi.stubGlobal("Audio", FakeAudio);
  playResult = () => Promise.resolve();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

// The reading flow starts audio after an async load, outside the click that asked for it, and a
// browser may refuse that. The player must not claim to be playing when nothing is.
describe("useAudioPlayer play()", () => {
  it("plays a loaded clip", async () => {
    const { result } = await readyPlayer();
    act(() => result.current.play());
    expect(result.current.status).toBe("playing");
    expect(result.current.getMediaElement()?.paused).toBe(false);
  });

  it("plays when play() gives nothing to wait on", async () => {
    playResult = () => undefined;
    const { result } = await readyPlayer();
    act(() => result.current.play());
    expect(result.current.status).toBe("playing");
  });

  it("resumes a paused clip", async () => {
    const { result } = await readyPlayer();
    act(() => result.current.play());
    act(() => result.current.pause());
    expect(result.current.status).toBe("paused");
    act(() => result.current.play());
    expect(result.current.status).toBe("playing");
    expect(result.current.getMediaElement()?.paused).toBe(false);
  });

  it("falls back to paused when the browser refuses a loaded clip", async () => {
    playResult = refused;
    const { result } = await readyPlayer();
    act(() => result.current.play());
    await waitFor(() => expect(result.current.status).toBe("paused"));
  });

  it("falls back to paused when the browser refuses to resume a clip", async () => {
    const { result } = await readyPlayer();
    act(() => result.current.play());
    act(() => result.current.pause());
    playResult = refused;
    act(() => result.current.play());
    expect(result.current.status).toBe("playing");
    await waitFor(() => expect(result.current.status).toBe("paused"));
  });

  it("does nothing before the audio has loaded", () => {
    const { result } = renderHook(() => useAudioPlayer("p1"));
    act(() => result.current.play());
    expect(result.current.status).toBe("idle");
  });
});
