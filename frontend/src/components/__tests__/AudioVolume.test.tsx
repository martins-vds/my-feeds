import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { useRef } from "react";
import { AudioPlayer } from "../AudioPlayer";
import { FloatingAudioControls } from "../FloatingAudioControls";
import { useAudioPlayer } from "../../hooks/useAudioPlayer";
import { useReadAlong } from "../../hooks/useReadAlong";
import api from "../../services/api";

vi.mock("../../services/api", () => ({ default: { get: vi.fn() } }));
vi.mock("../Waveform", () => ({ Waveform: () => <div>Waveform</div> }));

class TestAudio extends EventTarget {
  src: string;
  preload = "";
  volume = 1;
  muted = false;
  playbackRate = 1;
  currentTime = 0;
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

beforeEach(() => {
  vi.stubGlobal("Audio", TestAudio);
  vi.mocked(api.get).mockReset();
  vi.mocked(api.get).mockResolvedValue({
    status: "ready",
    url: "/api/audio/test.mp3",
    durationSeconds: 60,
    wordTimings: [
      { text: "Hello", startMs: 0, durationMs: 1000 },
      { text: "world", startMs: 1000, durationMs: 1000 },
    ],
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("shared audio sound controls", () => {
  it("initializes immediately ready audio with sound settings selected beforehand", async () => {
    const { result } = renderHook(() => useAudioPlayer("post"));
    act(() => {
      result.current.setVolume(0.6);
      result.current.toggleMute();
    });
    await act(async () => result.current.generateAudio());
    expect(result.current.getMediaElement()!.volume).toBe(0.6);
    expect(result.current.getMediaElement()!.muted).toBe(true);
  });

  it("clamps volume bounds and rejects nonfinite values explicitly", () => {
    const { result } = renderHook(() => useAudioPlayer("post"));
    act(() => result.current.setVolume(-1));
    expect(result.current.volume).toBe(0);
    act(() => result.current.setVolume(2));
    expect(result.current.volume).toBe(1);
    for (const invalid of [NaN, Infinity, -Infinity]) {
      expect(() => result.current.setVolume(invalid)).toThrow("Volume must be finite");
    }
  });

  it("mutes without pausing or changing time and restores the selected volume", async () => {
    const { result } = renderHook(() => useAudioPlayer("post"));
    await act(async () => result.current.generateAudio());
    act(() => {
      result.current.play();
      result.current.seek(12);
    });
    const media = result.current.getMediaElement()!;
    act(() => result.current.setVolume(0.35));
    act(() => result.current.toggleMute());
    expect(media.muted).toBe(true);
    expect(media.volume).toBe(0.35);
    expect(media.paused).toBe(false);
    expect(media.currentTime).toBe(12);
    expect(result.current.isPlaying).toBe(true);
    act(() => result.current.toggleMute());
    expect(media.muted).toBe(false);
    expect(media.volume).toBe(0.35);
  });

  it("restores the last nonzero volume when unmuting from zero", async () => {
    const { result } = renderHook(() => useAudioPlayer("post"));
    await act(async () => result.current.generateAudio());
    act(() => result.current.setVolume(0.4));
    act(() => result.current.setVolume(0));
    expect(result.current.isMuted).toBe(true);
    expect(result.current.getMediaElement()!.muted).toBe(true);
    act(() => result.current.toggleMute());
    expect(result.current.volume).toBe(0.4);
    expect(result.current.isMuted).toBe(false);
    expect(result.current.getMediaElement()!.volume).toBe(0.4);
  });

  it("applies sound settings to audio created after generation polling", async () => {
    vi.useFakeTimers();
    vi.mocked(api.get)
      .mockResolvedValueOnce({ status: "generating", estimatedSeconds: 1 })
      .mockResolvedValueOnce({ status: "ready", url: "/api/audio/test.mp3" });
    const { result } = renderHook(() => useAudioPlayer("post"));
    act(() => {
      result.current.setVolume(0.25);
      result.current.toggleMute();
    });
    await act(async () => result.current.generateAudio());
    await act(async () => vi.advanceTimersByTimeAsync(200));
    expect(result.current.getMediaElement()!.volume).toBe(0.25);
    expect(result.current.getMediaElement()!.muted).toBe(true);
  });

  it("synchronizes inline and floating mute while highlights advance silently", async () => {
    const observers: IntersectionObserverCallback[] = [];
    vi.stubGlobal("IntersectionObserver", class {
      constructor(callback: IntersectionObserverCallback) { observers.push(callback); }
      observe() {}
      disconnect() {}
    });
    let frame: FrameRequestCallback | undefined;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      frame = callback;
      return 1;
    });
    vi.stubGlobal("cancelAnimationFrame", () => {});
    function Reader() {
      const player = useAudioPlayer("post");
      const anchor = useRef<HTMLDivElement>(null);
      const title = useRef<HTMLHeadingElement>(null);
      const content = useRef<HTMLDivElement>(null);
      useReadAlong({
        timings: player.wordTimings, getMediaElement: player.getMediaElement,
        isPlaying: player.isPlaying, titleRef: title, contentRef: content,
        highlightEnabled: true, autoScrollEnabled: false,
      });
      return <>
        <h1 ref={title}>Hello</h1><div ref={content}>world</div>
        <button onClick={player.generateAudio}>Load</button>
        <div ref={anchor}><AudioPlayer player={player} /></div>
        <FloatingAudioControls player={player} anchorRef={anchor} />
        <button onClick={() => {
          const media = player.getMediaElement()!;
          media.currentTime = 1.5;
          media.dispatchEvent(new Event("timeupdate"));
        }}>Advance</button>
      </>;
    }
    render(<Reader />);
    await act(async () => fireEvent.click(screen.getByText("Load")));
    fireEvent.click(screen.getByRole("button", { name: "Play" }));
    act(() => frame?.(0));
    expect(document.querySelector(".ra-active")?.textContent).toBe("Hello");
    fireEvent.click(screen.getByRole("button", { name: "Mute audio" }));
    fireEvent.click(screen.getByText("Advance"));
    act(() => frame?.(16));
    expect(document.querySelector(".ra-active")?.textContent).toBe("world");
    const slider = screen.getByRole("slider", { name: "Audio volume" });
    fireEvent.change(slider, { target: { value: "30" } });
    expect(slider).toHaveValue("30");
    act(() => {
      for (const callback of observers) {
        callback([{ isIntersecting: false } as IntersectionObserverEntry], {} as IntersectionObserver);
      }
    });
    const floating = screen.getByTestId("floating-mute-button");
    fireEvent.click(floating);
    expect(screen.getAllByRole("button", { name: "Unmute audio" })).toHaveLength(2);
    fireEvent.click(floating);
    expect(screen.getAllByRole("button", { name: "Mute audio" })).toHaveLength(2);
    expect(slider).toHaveValue("30");
  });
});
