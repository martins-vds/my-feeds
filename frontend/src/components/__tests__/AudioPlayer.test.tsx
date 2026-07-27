/**
 * Vitest unit tests for AudioPlayer component
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AudioPlayer } from "../AudioPlayer";
import type { UseAudioPlayerResult, AudioStatus } from "../../hooks/useAudioPlayer";

// Mock the useAudioPlayer hook
const mockUseAudioPlayer: UseAudioPlayerResult = {
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
};

vi.mock("../../hooks/useAudioPlayer", () => ({
  useAudioPlayer: () => mockUseAudioPlayer,
}));

function setMockState(overrides: Partial<UseAudioPlayerResult>) {
  Object.assign(mockUseAudioPlayer, overrides);
}

function resetMockState() {
  Object.assign(mockUseAudioPlayer, {
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
  });
}

describe("AudioPlayer", () => {
  beforeEach(() => {
    resetMockState();
  });

  describe("idle state", () => {
    it("should display listen button in idle state", () => {
      render(<AudioPlayer postId="post-1" />);
      expect(screen.getByTestId("listen-button")).toBeInTheDocument();
    });

    it("should display listen button with accessible label", () => {
      render(<AudioPlayer postId="post-1" />);
      expect(screen.getByLabelText("Listen to article")).toBeInTheDocument();
    });

    it("should call generateAudio when listen button is clicked", async () => {
      const generateAudio = vi.fn();
      setMockState({ generateAudio });

      render(<AudioPlayer postId="post-1" />);
      await userEvent.click(screen.getByTestId("listen-button"));
      expect(generateAudio).toHaveBeenCalled();
    });

    it("should call onGenerateAudio callback if provided", async () => {
      const onGenerateAudio = vi.fn().mockResolvedValue({ status: "ready", url: "/audio.mp3" });

      render(<AudioPlayer postId="post-1" onGenerateAudio={onGenerateAudio} />);
      await userEvent.click(screen.getByTestId("listen-button"));
      expect(onGenerateAudio).toHaveBeenCalledWith("post-1");
    });
  });

  describe("loading state", () => {
    it("should display spinner when generating audio", () => {
      setMockState({ status: "loading" });

      render(<AudioPlayer postId="post-1" />);
      expect(screen.getByRole("progressbar")).toBeInTheDocument();
    });

    it("should display 'Generating audio...' text", () => {
      setMockState({ status: "loading" });

      render(<AudioPlayer postId="post-1" />);
      expect(screen.getByText("Generating audio...")).toBeInTheDocument();
    });

    it("should not display listen or play buttons while loading", () => {
      setMockState({ status: "loading" });

      render(<AudioPlayer postId="post-1" />);
      expect(screen.queryByTestId("listen-button")).not.toBeInTheDocument();
      expect(screen.queryByTestId("play-pause-button")).not.toBeInTheDocument();
    });
  });

  describe("error state", () => {
    it("should display 'Audio failed' message on error", () => {
      setMockState({ status: "error", error: "Something went wrong" });

      render(<AudioPlayer postId="post-1" />);
      expect(screen.getByText("Audio failed")).toBeInTheDocument();
    });

    it("should display retry button on error", () => {
      setMockState({ status: "error", error: "Network error" });

      render(<AudioPlayer postId="post-1" />);
      expect(screen.getByLabelText("Retry audio generation")).toBeInTheDocument();
    });

    it("should call generateAudio when retry is clicked", async () => {
      const generateAudio = vi.fn();
      setMockState({ status: "error", error: "Failed", generateAudio });

      render(<AudioPlayer postId="post-1" />);
      await userEvent.click(screen.getByLabelText("Retry audio generation"));
      expect(generateAudio).toHaveBeenCalled();
    });
  });

  describe("ready state", () => {
    it("should show play/pause button when audio is ready", () => {
      setMockState({
        status: "ready",
        audioUrl: "/audio/post-1.mp3",
        durationSeconds: 120,
      });

      render(<AudioPlayer postId="post-1" />);
      expect(screen.getByTestId("play-pause-button")).toBeInTheDocument();
    });

    it("should show progress bar when audio is ready", () => {
      setMockState({
        status: "ready",
        audioUrl: "/audio/post-1.mp3",
        durationSeconds: 120,
      });

      render(<AudioPlayer postId="post-1" />);
      expect(screen.getByLabelText("Audio progress")).toBeInTheDocument();
    });

    it("should show ready state when initialAudioUrl is passed and status is idle", () => {
      // When initialAudioUrl is provided and status is idle, effectiveStatus becomes "ready"
      setMockState({ status: "idle", audioUrl: null });

      render(<AudioPlayer postId="post-1" audioUrl="/audio/post-1.mp3" />);
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

      render(<AudioPlayer postId="post-1" />);
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

      render(<AudioPlayer postId="post-1" />);
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

      render(<AudioPlayer postId="post-1" />);
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

      render(<AudioPlayer postId="post-1" />);
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

      render(<AudioPlayer postId="post-1" />);
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

      render(<AudioPlayer postId="post-1" />);
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

      render(<AudioPlayer postId="post-1" />);
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

      render(<AudioPlayer postId="post-1" />);

      const speedButton = screen.getByTestId("speed-button");
      expect(speedButton).toHaveTextContent("1x");

      await userEvent.click(speedButton);
      await userEvent.click(screen.getByRole("menuitem", { name: "1.5x" }));

      expect(setPlaybackRate).toHaveBeenCalledWith(1.5);
    });
  });
});
