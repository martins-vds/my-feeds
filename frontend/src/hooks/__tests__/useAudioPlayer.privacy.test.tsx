import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { BrowserRouter } from "react-router-dom";
import { AuthProvider, useAuth } from "../../contexts/AuthContext";
import { ProtectedRoute } from "../../components/ProtectedRoute";
import { useAudioPlayer } from "../useAudioPlayer";
import api, { ApiError } from "../../services/api";

const { mockApi } = vi.hoisted(() => ({ mockApi: { get: vi.fn(), post: vi.fn() } }));
vi.mock("../../services/api", async (original) => ({
  ...(await original<typeof import("../../services/api")>()),
  default: mockApi,
  api: mockApi,
}));

beforeEach(() => localStorage.clear());
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("audio identity lifecycle", () => {
  it("suspends audio while verifying, resumes the same account at its position, and releases it on account switch", async () => {
    class FakeAudio extends EventTarget {
      src: string;
      preload = "";
      playbackRate = 1;
      paused = true;
      currentTime = 42;
      constructor(src: string) {
        super();
        this.src = src;
      }
      play() {
        this.paused = false;
        return Promise.resolve();
      }
      pause() {
        this.paused = true;
      }
    }
    vi.stubGlobal("Audio", FakeAudio);
    vi.mocked(api.get).mockImplementation(async (path) =>
      path === "/auth/me" ? { id: "alice" } : { status: "ready", url: "/api/audio/alice.mp3" }
    );
    const wrapper = ({ children }: { children: ReactNode }) => (
      <BrowserRouter>
        <AuthProvider>
          <ProtectedRoute>{children}</ProtectedRoute>
        </AuthProvider>
      </BrowserRouter>
    );
    const { result } = renderHook(
      () => ({
        player: useAudioPlayer("private-post"),
        auth: useAuth(),
      }),
      { wrapper }
    );
    await waitFor(() => expect(result.current?.auth.user?.id).toBe("alice"));
    await act(async () => {
      await result.current.player.generateAudio();
    });
    act(() => result.current.player.play());
    const media = result.current.player.getMediaElement()!;
    let resolve!: (value: unknown) => void;
    vi.mocked(api.get).mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        })
    );
    let validation!: Promise<void>;
    act(() => {
      validation = result.current.auth.refreshUser();
    });
    expect(media.src).toBe("/api/audio/alice.mp3");
    expect(media.paused).toBe(true);
    await act(async () => {
      resolve({ id: "alice" });
      await validation;
    });
    expect(result.current.player.getMediaElement()).toBe(media);
    expect(media.paused).toBe(false);
    expect(media.currentTime).toBe(42);
    vi.mocked(api.get).mockResolvedValue({ id: "bob" });
    await act(async () => {
      await result.current.auth.refreshUser();
    });
    expect(media.paused).toBe(true);
    expect(media.src).toBe("");
    expect(result.current.player.audioUrl).toBeNull();
  });

  it("pauses and releases an existing media element when its private reader unmounts", async () => {
    class FakeAudio extends EventTarget {
      src: string;
      preload = "";
      playbackRate = 1;
      paused = true;
      constructor(src: string) {
        super();
        this.src = src;
      }
      play() {
        this.paused = false;
        return Promise.resolve();
      }
      pause() {
        this.paused = true;
      }
    }
    vi.stubGlobal("Audio", FakeAudio);
    vi.mocked(api.get).mockResolvedValue({ status: "ready", url: "/api/audio/alice.mp3" });
    const { result, unmount } = renderHook(() => useAudioPlayer("private-post"));
    await act(async () => {
      await result.current.generateAudio();
    });
    const media = result.current.getMediaElement()!;
    act(() => result.current.play());
    expect(media.paused).toBe(false);
    unmount();
    expect(media.paused).toBe(true);
    expect(media.src).toBe("");
  });

  it("never constructs audio from a response received after unmount", async () => {
    let resolve!: (value: unknown) => void;
    vi.mocked(api.get).mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        })
    );
    const AudioMock = vi.fn();
    vi.stubGlobal("Audio", AudioMock);
    const { result, unmount } = renderHook(() => useAudioPlayer("private-post"));
    let pending!: Promise<void>;
    act(() => {
      pending = result.current.generateAudio();
    });
    unmount();
    await act(async () => {
      resolve({ status: "ready", url: "/api/audio/alice.mp3" });
      await pending;
    });
    expect(AudioMock).not.toHaveBeenCalled();
  });

  it("cancels generation polling when private UI unmounts", async () => {
    vi.useFakeTimers();
    vi.mocked(api.get).mockResolvedValue({ status: "generating", estimatedSeconds: 5 });
    const { result, unmount } = renderHook(() => useAudioPlayer("private-post"));
    await act(async () => {
      await result.current.generateAudio();
    });
    unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(api.get).toHaveBeenCalledTimes(1);
  });

  it("shows operator policy denial rather than an indefinite generating state", async () => {
    vi.mocked(api.get).mockRejectedValue(
      new ApiError(
        403,
        "EXTERNAL_PROCESSING_DISABLED",
        "Audio generation is disabled because it sends article text to an external provider."
      )
    );
    const { result } = renderHook(() => useAudioPlayer("private-post"));
    await act(async () => {
      await result.current.generateAudio();
    });
    expect(result.current.status).toBe("error");
    expect(result.current.error).toContain("external provider");
  });
});
