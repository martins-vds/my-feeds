import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, act, cleanup } from "@testing-library/react";
import { useRef } from "react";
import { FloatingAudioControls } from "../FloatingAudioControls";
import type { FloatingAudioControlsProps } from "../FloatingAudioControls";
import type { UseAudioPlayerResult } from "../../hooks/useAudioPlayer";

// ── IntersectionObserver mock (jsdom has none) ─────────────────────────
const observers: { cb: IntersectionObserverCallback; els: Set<Element> }[] = [];

class MockIO implements IntersectionObserver {
  root: Element | null = null;
  rootMargin = "";
  scrollMargin = "";
  thresholds: ReadonlyArray<number> = [];
  els = new Set<Element>();
  constructor(cb: IntersectionObserverCallback) {
    observers.push({ cb, els: this.els });
  }
  observe(el: Element) {
    this.els.add(el);
  }
  unobserve(el: Element) {
    this.els.delete(el);
  }
  disconnect() {
    this.els.clear();
  }
  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
}

/** Fire an intersection change for `target` on every observer watching it. */
function setIntersecting(target: Element, isIntersecting: boolean) {
  act(() => {
    for (const o of observers) {
      if (o.els.has(target)) {
        o.cb([{ target, isIntersecting } as IntersectionObserverEntry], {} as IntersectionObserver);
      }
    }
  });
}

// ── Player mock ────────────────────────────────────────────────────────
function makePlayer(overrides: Partial<UseAudioPlayerResult> = {}): UseAudioPlayerResult {
  return {
    status: "playing",
    audioUrl: "blob:x",
    durationSeconds: 100,
    currentTime: 0,
    progress: 0,
    error: null,
    generateAudio: vi.fn(),
    play: vi.fn(),
    pause: vi.fn(),
    toggle: vi.fn(),
    seek: vi.fn(),
    playbackRate: 1,
    setPlaybackRate: vi.fn(),
    volume: 1,
    isMuted: false,
    setVolume: vi.fn(),
    toggleMute: vi.fn(),
    wordTimings: null,
    getMediaElement: () => null,
    isPlaying: true,
    ...overrides,
  };
}

// ── Harness: gives the component real anchor/footer elements ───────────
type SpeedScale = Pick<
  FloatingAudioControlsProps,
  "speeds" | "formatSpeed" | "speedLabel" | "hideMute"
>;

function Harness({
  player,
  withFooter = true,
  scale = {},
}: {
  player: FloatingAudioControlsProps["player"];
  withFooter?: boolean;
  scale?: SpeedScale;
}) {
  const anchorRef = useRef<HTMLDivElement>(null);
  const footerRef = useRef<HTMLDivElement>(null);
  return (
    <div>
      <div ref={anchorRef} data-testid="anchor">
        player
      </div>
      <div ref={footerRef} data-testid="footer">
        footer
      </div>
      <FloatingAudioControls
        player={player}
        anchorRef={anchorRef}
        footerRef={withFooter ? footerRef : undefined}
        {...scale}
      />
    </div>
  );
}

beforeEach(() => {
  observers.length = 0;
  vi.stubGlobal("IntersectionObserver", MockIO);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** Render, then scroll the inline player off-screen (active + off-screen). */
function renderOffscreen(player: FloatingAudioControlsProps["player"], scale: SpeedScale = {}) {
  const view = render(<Harness player={player} scale={scale} />);
  setIntersecting(screen.getByTestId("anchor"), false);
  return view;
}

describe("FloatingAudioControls — visibility", () => {
  it("renders nothing while the inline player is on-screen", () => {
    render(<Harness player={makePlayer()} />);
    expect(screen.queryByTestId("floating-audio-controls")).toBeNull();
  });

  it("renders nothing when no clip is active", () => {
    render(<Harness player={makePlayer({ status: "ready", isPlaying: false })} />);
    setIntersecting(screen.getByTestId("anchor"), false);
    expect(screen.queryByTestId("floating-audio-controls")).toBeNull();
  });

  it("shows the controls when a clip is active and the player is off-screen", () => {
    renderOffscreen(makePlayer());
    expect(screen.queryByTestId("floating-audio-controls")).not.toBeNull();
  });

  it("stays visible for a paused (still active) clip", () => {
    renderOffscreen(makePlayer({ status: "paused", isPlaying: false }));
    expect(screen.queryByTestId("floating-audio-controls")).not.toBeNull();
  });

  it("hides again when the footer scrolls into view", () => {
    renderOffscreen(makePlayer());
    expect(screen.queryByTestId("floating-audio-controls")).not.toBeNull();
    setIntersecting(screen.getByTestId("footer"), true);
    expect(screen.queryByTestId("floating-audio-controls")).toBeNull();
  });
});

describe("FloatingAudioControls — play/pause", () => {
  it("shows Pause while playing and calls toggle on click", () => {
    const player = makePlayer({ isPlaying: true });
    renderOffscreen(player);
    const btn = screen.getByTestId("floating-play-button");
    expect(btn.getAttribute("aria-label")).toBe("Pause");
    fireEvent.click(btn);
    expect(player.toggle).toHaveBeenCalledTimes(1);
  });

  it("shows Play while paused", () => {
    renderOffscreen(makePlayer({ status: "paused", isPlaying: false }));
    expect(screen.getByTestId("floating-play-button").getAttribute("aria-label")).toBe("Play");
  });
});

// NOTE: `makePlayer`, `Harness`, `renderOffscreen`, `setIntersecting` are reused by Task 3.

describe("FloatingAudioControls — speed", () => {
  function open(player = makePlayer({ playbackRate: 1 })) {
    renderOffscreen(player);
    fireEvent.click(screen.getByTestId("floating-speed-button"));
    return player;
  }

  it("shows the current playback rate on the speed circle", () => {
    renderOffscreen(makePlayer({ playbackRate: 1.5 }));
    expect(screen.getByTestId("floating-speed-button").textContent).toBe("1.5x");
  });

  it("opens the speed options with all supported rates", () => {
    open();
    const opts = screen.getByTestId("floating-speed-options");
    expect(opts.querySelectorAll("button").length).toBe(7);
  });

  it("exposes disclosure semantics on the speed control", () => {
    open();
    const btn = screen.getByTestId("floating-speed-button");
    expect(btn.getAttribute("aria-haspopup")).toBe("true");
    expect(btn.getAttribute("aria-controls")).toBe("floating-speed-options");
    const opts = screen.getByTestId("floating-speed-options");
    expect(opts.getAttribute("role")).toBe("group");
    expect(opts.getAttribute("id")).toBe("floating-speed-options");
  });

  it("selecting a rate calls setPlaybackRate and closes the options", () => {
    const player = open();
    fireEvent.click(screen.getByLabelText("Set speed 2x"));
    expect(player.setPlaybackRate).toHaveBeenCalledWith(2);
    expect(screen.queryByTestId("floating-speed-options")).toBeNull();
  });

  it("closes the options on Escape", () => {
    open();
    fireEvent.keyDown(screen.getByTestId("floating-audio-controls"), { key: "Escape" });
    expect(screen.queryByTestId("floating-speed-options")).toBeNull();
  });

  it("closes the options when clicking away", () => {
    open();
    fireEvent.click(document.body);
    expect(screen.queryByTestId("floating-speed-options")).toBeNull();
  });

  it("closes the options on tap-away (touchend)", () => {
    open();
    fireEvent.touchEnd(document.body);
    expect(screen.queryByTestId("floating-speed-options")).toBeNull();
  });
});

describe("FloatingAudioControls — a different speed scale", () => {
  const wpm: SpeedScale = {
    speeds: [150, 200, 250, 300, 400],
    formatSpeed: (value) => `${value}`,
    speedLabel: "Reading speed",
    hideMute: true,
  };

  /** What the page hands over for silent reading: only the fields the controls read. */
  function makePacerPlayer(
    overrides: Partial<FloatingAudioControlsProps["player"]> = {}
  ): FloatingAudioControlsProps["player"] {
    return {
      status: "playing",
      isPlaying: true,
      toggle: vi.fn(),
      playbackRate: 250,
      setPlaybackRate: vi.fn(),
      isMuted: false,
      toggleMute: vi.fn(),
      ...overrides,
    };
  }

  function open(player = makePacerPlayer()) {
    renderOffscreen(player, wpm);
    fireEvent.click(screen.getByTestId("floating-speed-button"));
    return player;
  }

  const optionButtons = () =>
    Array.from(screen.getByTestId("floating-speed-options").querySelectorAll("button"));

  it("needs only the fields it reads from a player", () => {
    const player = makePacerPlayer();
    renderOffscreen(player, wpm);

    fireEvent.click(screen.getByTestId("floating-play-button"));

    expect(player.toggle).toHaveBeenCalledTimes(1);
  });

  it("offers the speeds it is given, written by formatSpeed", () => {
    open();
    expect(optionButtons().map((button) => button.textContent)).toEqual([
      "150",
      "200",
      "250",
      "300",
      "400",
    ]);
  });

  it("shows the current speed the way formatSpeed writes it", () => {
    renderOffscreen(makePacerPlayer({ playbackRate: 300 }), wpm);
    expect(screen.getByTestId("floating-speed-button").textContent).toBe("300");
  });

  it("marks only the current speed as selected", () => {
    open(makePacerPlayer({ playbackRate: 200 }));
    expect(optionButtons().map((button) => button.getAttribute("aria-pressed"))).toEqual([
      "false",
      "true",
      "false",
      "false",
      "false",
    ]);
  });

  it("hands the chosen speed to setPlaybackRate and closes the options", () => {
    const player = open();
    fireEvent.click(screen.getByLabelText("Set speed 300"));
    expect(player.setPlaybackRate).toHaveBeenCalledWith(300);
    expect(screen.queryByTestId("floating-speed-options")).toBeNull();
  });

  it("names the speed control with speedLabel", () => {
    open();
    expect(screen.getByTestId("floating-speed-button").getAttribute("aria-label")).toBe(
      "Reading speed"
    );
    expect(screen.getByTestId("floating-speed-options").getAttribute("aria-label")).toBe(
      "Reading speed options"
    );
  });

  it("keeps the audio names when no speedLabel is given", () => {
    renderOffscreen(makePlayer());
    fireEvent.click(screen.getByTestId("floating-speed-button"));
    expect(screen.getByTestId("floating-speed-button").getAttribute("aria-label")).toBe(
      "Playback speed"
    );
    expect(screen.getByTestId("floating-speed-options").getAttribute("aria-label")).toBe(
      "Playback speed options"
    );
  });

  it("leaves out the mute button when hideMute is set", () => {
    renderOffscreen(makePacerPlayer(), wpm);
    expect(screen.queryByTestId("floating-mute-button")).toBeNull();
    expect(screen.queryByTestId("floating-play-button")).not.toBeNull();
  });

  it("shows the mute button by default", () => {
    renderOffscreen(makePlayer());
    expect(screen.queryByTestId("floating-mute-button")).not.toBeNull();
  });
});
