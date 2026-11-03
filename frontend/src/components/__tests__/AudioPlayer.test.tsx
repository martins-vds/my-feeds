/**
 * Vitest unit tests for AudioPlayer component (controlled/presentational).
 *
 * AudioPlayer now receives player state via the `player` prop (the parent owns
 * useAudioPlayer), so these tests pass a mutable mock player object directly.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AudioPlayer } from "../AudioPlayer";
import type { UseAudioPlayerResult, AudioStatus } from "../../hooks/useAudioPlayer";

// A mutable mock player passed to <AudioPlayer player={...} />.
const mockPlayer: UseAudioPlayerResult = {
  status: "idle" as AudioStatus,
  audioUrl: null,
  durationSeconds: null,
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
  isPlaying: false,
};

function setMockState(overrides: Partial<UseAudioPlayerResult>) {
  Object.assign(mockPlayer, overrides);
}

function resetMockState() {
  Object.assign(mockPlayer, {
    status: "idle" as AudioStatus,
    audioUrl: null,
    durationSeconds: null,
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
    isPlaying: false,
  });
}

describe("AudioPlayer", () => {
  beforeEach(() => {
    resetMockState();
  });

  describe("idle state", () => {
    it("renders nothing while idle", () => {
      const { container } = render(<AudioPlayer player={mockPlayer} />);
      expect(container).toBeEmptyDOMElement();
    });
  });

  describe("loading state", () => {
    it("should display spinner when loading audio", () => {
      setMockState({ status: "loading" });

      render(<AudioPlayer player={mockPlayer} />);
      expect(screen.getByRole("progressbar")).toBeInTheDocument();
    });

    it("should display 'Loading audio…' text", () => {
      setMockState({ status: "loading" });

      render(<AudioPlayer player={mockPlayer} />);
      expect(screen.getByText("Loading audio…")).toBeInTheDocument();
    });

    it("should not display play buttons while loading", () => {
      setMockState({ status: "loading" });

      render(<AudioPlayer player={mockPlayer} />);
      expect(screen.queryByTestId("play-pause-button")).not.toBeInTheDocument();
    });
  });

  describe("generating state", () => {
    it("should display a progress bar while generating", () => {
      setMockState({ status: "generating" });

      render(<AudioPlayer player={mockPlayer} />);
      expect(screen.getByRole("progressbar")).toBeInTheDocument();
    });

    it("should display 'Generating audio…' text and an elapsed timer", () => {
      setMockState({ status: "generating" });

      render(<AudioPlayer player={mockPlayer} />);
      expect(screen.getByText("Generating audio…")).toBeInTheDocument();
      expect(screen.getByTestId("audio-generating-elapsed")).toBeInTheDocument();
    });

    it("should not display play buttons while generating", () => {
      setMockState({ status: "generating" });

      render(<AudioPlayer player={mockPlayer} />);
      expect(screen.queryByTestId("play-pause-button")).not.toBeInTheDocument();
    });
  });

  describe("error state", () => {
    it("should display 'Audio failed' message on error", () => {
      setMockState({ status: "error", error: "Something went wrong" });

      render(<AudioPlayer player={mockPlayer} />);
      expect(screen.getByText("Audio failed")).toBeInTheDocument();
    });

    it("should display retry button on error", () => {
      setMockState({ status: "error", error: "Network error" });

      render(<AudioPlayer player={mockPlayer} />);
      expect(screen.getByLabelText("Retry audio generation")).toBeInTheDocument();
    });

    it("should call generateAudio when retry is clicked", async () => {
      const generateAudio = vi.fn();
      setMockState({ status: "error", error: "Failed", generateAudio });

      render(<AudioPlayer player={mockPlayer} />);
      await userEvent.click(screen.getByLabelText("Retry audio generation"));
      expect(generateAudio).toHaveBeenCalled();
    });

    it("should offer to read silently instead when a handler is given", async () => {
      const onReadSilently = vi.fn();
      const generateAudio = vi.fn();
      setMockState({ status: "error", error: "Failed", generateAudio });

      render(<AudioPlayer player={mockPlayer} onReadSilently={onReadSilently} />);
      const button = screen.getByRole("button", { name: "Read silently" });
      expect(button).toBe(screen.getByTestId("audio-read-silently"));

      await userEvent.click(button);
      expect(onReadSilently).toHaveBeenCalledTimes(1);
      expect(generateAudio).not.toHaveBeenCalled();
    });

    it("should not offer to read silently without a handler", () => {
      setMockState({ status: "error", error: "Failed" });

      render(<AudioPlayer player={mockPlayer} />);
      expect(screen.queryByRole("button", { name: "Read silently" })).not.toBeInTheDocument();
    });
  });

  describe("ready state", () => {
    it("should show play/pause button when audio is ready", () => {
      setMockState({
        status: "ready",
        audioUrl: "/audio/post-1.mp3",
        durationSeconds: 120,
      });

      render(<AudioPlayer player={mockPlayer} />);
      expect(screen.getByTestId("play-pause-button")).toBeInTheDocument();
    });

    it("should show progress bar when audio is ready", () => {
      setMockState({
        status: "ready",
        audioUrl: "/audio/post-1.mp3",
        durationSeconds: 120,
      });

      render(<AudioPlayer player={mockPlayer} />);
      expect(screen.getByLabelText("Audio progress")).toBeInTheDocument();
    });

    it("should show ready state when initialAudioUrl is passed and status is idle", () => {
      // When initialAudioUrl is provided and status is idle, effectiveStatus becomes "ready"
      setMockState({ status: "idle", audioUrl: null });

      render(<AudioPlayer player={mockPlayer} audioUrl="/audio/post-1.mp3" />);
      expect(screen.getByTestId("play-pause-button")).toBeInTheDocument();
    });
  });

  describe("playing state", () => {
    it("should show Pause label when playing", () => {
      setMockState({
        status: "playing",
        audioUrl: "/audio/post-1.mp3",
        durationSeconds: 120,
        currentTime: 30,
        progress: 25,
      });

      render(<AudioPlayer player={mockPlayer} />);
      expect(screen.getByLabelText("Pause")).toBeInTheDocument();
    });

    it("should call toggle when play/pause button is clicked", async () => {
      const toggle = vi.fn();
      setMockState({
        status: "playing",
        audioUrl: "/audio/post-1.mp3",
        durationSeconds: 120,
        currentTime: 30,
        progress: 25,
        toggle,
      });

      render(<AudioPlayer player={mockPlayer} />);
      await userEvent.click(screen.getByTestId("play-pause-button"));
      expect(toggle).toHaveBeenCalled();
    });

    it("should show current time and duration", () => {
      setMockState({
        status: "playing",
        audioUrl: "/audio/post-1.mp3",
        durationSeconds: 120,
        currentTime: 65,
        progress: 54,
      });

      render(<AudioPlayer player={mockPlayer} />);
      // 65 seconds = 1:05, 120 seconds = 2:00
      expect(screen.getByText("1:05 / 2:00")).toBeInTheDocument();
    });
  });

  describe("paused state", () => {
    it("should show Play label when paused", () => {
      setMockState({
        status: "paused",
        audioUrl: "/audio/post-1.mp3",
        durationSeconds: 120,
        currentTime: 30,
        progress: 25,
      });

      render(<AudioPlayer player={mockPlayer} />);
      expect(screen.getByLabelText("Play")).toBeInTheDocument();
    });

    it("should retain current time when paused", () => {
      setMockState({
        status: "paused",
        audioUrl: "/audio/post-1.mp3",
        durationSeconds: 60,
        currentTime: 45,
        progress: 75,
      });

      render(<AudioPlayer player={mockPlayer} />);
      // 45 seconds = 0:45, 60 seconds = 1:00
      expect(screen.getByText("0:45 / 1:00")).toBeInTheDocument();
    });
  });

  describe("time formatting", () => {
    it("should format zero time correctly", () => {
      setMockState({
        status: "ready",
        audioUrl: "/audio/post-1.mp3",
        durationSeconds: 300,
        currentTime: 0,
        progress: 0,
      });

      render(<AudioPlayer player={mockPlayer} />);
      // 0 seconds = 0:00, 300 seconds = 5:00
      expect(screen.getByText("0:00 / 5:00")).toBeInTheDocument();
    });

    it("should show only current time when duration is not available", () => {
      setMockState({
        status: "ready",
        audioUrl: "/audio/post-1.mp3",
        durationSeconds: null,
        currentTime: 30,
        progress: 0,
      });

      render(<AudioPlayer player={mockPlayer} />);
      expect(screen.getByText("0:30")).toBeInTheDocument();
    });
  });

  describe("playback speed", () => {
    it("shows the current rate and lets the user change it", async () => {
      const setPlaybackRate = vi.fn();
      setMockState({
        status: "ready",
        audioUrl: "/audio/post-1.mp3",
        durationSeconds: 60,
        setPlaybackRate,
      });

      render(<AudioPlayer player={mockPlayer} />);

      const speedButton = screen.getByTestId("speed-button");
      expect(speedButton).toHaveTextContent("1x");

      await userEvent.click(speedButton);
      await userEvent.click(screen.getByRole("menuitem", { name: "1.5x" }));

      expect(setPlaybackRate).toHaveBeenCalledWith(1.5);
    });
  });
});
