import { useState, useCallback, useRef, useEffect, useContext } from "react";
import api from "../services/api";
import AuthContext from "../contexts/AuthContext";
import type { AudioInfo, AudioPending, AudioResponse, WordTiming } from "../types";

export type AudioStatus =
  "idle" | "loading" | "generating" | "ready" | "playing" | "paused" | "error";

export interface UseAudioPlayerResult {
  status: AudioStatus;
  audioUrl: string | null;
  durationSeconds: number | null;
  currentTime: number;
  progress: number;
  error: string | null;
  generateAudio: () => Promise<void>;
  play: () => void;
  pause: () => void;
  toggle: () => void;
  seek: (time: number) => void;
  playbackRate: number;
  setPlaybackRate: (rate: number) => void;
  volume: number;
  isMuted: boolean;
  setVolume: (volume: number) => void;
  toggleMute: () => void;
  /** Ordered word timings from the READY response; null when omitted/absent. */
  wordTimings: WordTiming[] | null;
  /** Stable accessor for the live <audio> element (no re-render on read). */
  getMediaElement: () => HTMLAudioElement | null;
  /** Convenience flag derived from status. */
  isPlaying: boolean;
}

/**
 * Hook for managing audio playback and TTS generation for a post.
 *
 * @param postId - The post ID to get/generate audio for
 * @returns Audio player state and controls
 */
export function useAudioPlayer(postId: string): UseAudioPlayerResult {
  const isValidating = useContext(AuthContext)?.isLoading ?? false;
  const [status, setStatus] = useState<AudioStatus>("idle");
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [durationSeconds, setDurationSeconds] = useState<number | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [playbackRate, setPlaybackRateState] = useState(1);
  const [volume, setVolumeState] = useState(1);
  const [muted, setMuted] = useState(false);
  const [wordTimings, setWordTimings] = useState<WordTiming[] | null>(null);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const playbackRateRef = useRef(1);
  const volumeRef = useRef(1);
  const mutedRef = useRef(false);
  const lastAudibleVolume = useRef(1);
  const resumeAfterValidation = useRef<HTMLAudioElement | null>(null);
  const lifetime = useRef(0);
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clean up audio element on unmount
  useEffect(() => {
    lifetime.current += 1;
    return () => {
      lifetime.current += 1;
      if (pollTimer.current !== null) clearTimeout(pollTimer.current);
      resumeAfterValidation.current = null;
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.src = "";
        audioRef.current = null;
      }
    };
  }, [postId]);

  useEffect(() => {
    const media = audioRef.current;
    if (!media) return;
    if (isValidating && !media.paused) {
      media.pause();
      resumeAfterValidation.current = media;
    } else if (!isValidating && resumeAfterValidation.current === media) {
      resumeAfterValidation.current = null;
      void media.play().catch(() => setStatus("paused"));
    }
  }, [isValidating]);

  // Generate or fetch audio URL
  const generateAudio = useCallback(async () => {
    if (status === "loading" || status === "generating") return;

    setStatus("loading");
    setError(null);
    const version = lifetime.current;
    const isCurrent = () => version === lifetime.current;

    try {
      const response = await api.get<AudioResponse>(`/posts/${postId}/audio`);
      if (!isCurrent()) return;

      if (response.status === "ready") {
        const audioInfo = response as AudioInfo;
        setAudioUrl(audioInfo.url);
        setDurationSeconds(audioInfo.durationSeconds ?? null);
        setWordTimings(audioInfo.wordTimings ?? null);
        setStatus("ready");

        // Create audio element
        const audio = new Audio(audioInfo.url);
        audio.preload = "metadata";
        audio.playbackRate = playbackRateRef.current;
        audio.volume = volumeRef.current;
        audio.muted = mutedRef.current;

        audio.addEventListener("loadedmetadata", () => {
          if (audio.duration && isFinite(audio.duration)) {
            setDurationSeconds(audio.duration);
          }
        });

        audio.addEventListener("timeupdate", () => {
          setCurrentTime(audio.currentTime);
        });

        audio.addEventListener("ended", () => {
          setStatus("ready");
          setCurrentTime(0);
        });

        audio.addEventListener("error", () => {
          setError("Failed to load audio");
          setStatus("error");
        });

        audioRef.current = audio;
      } else if (response.status === "generating") {
        // Audio is being synthesized server-side; surface a dedicated
        // "generating" state (distinct from the brief "loading" fetch)
        // and poll for completion.
        setStatus("generating");
        const pending = response as AudioPending;
        const pollInterval = (pending.estimatedSeconds ?? 5) * 200; // Poll 5 times during estimate

        const pollForReady = async () => {
          if (!isCurrent()) return;
          try {
            const pollResponse = await api.get<AudioResponse>(`/posts/${postId}/audio`);
            if (!isCurrent()) return;
            if (pollResponse.status === "ready") {
              const audioInfo = pollResponse as AudioInfo;
              setAudioUrl(audioInfo.url);
              setDurationSeconds(audioInfo.durationSeconds ?? null);
              setWordTimings(audioInfo.wordTimings ?? null);
              setStatus("ready");

              const audio = new Audio(audioInfo.url);
              audio.playbackRate = playbackRateRef.current;
              audio.volume = volumeRef.current;
              audio.muted = mutedRef.current;
              audioRef.current = audio;

              audio.addEventListener("timeupdate", () => {
                setCurrentTime(audio.currentTime);
              });

              audio.addEventListener("ended", () => {
                setStatus("ready");
                setCurrentTime(0);
              });
            } else {
              // Still generating, poll again
              pollTimer.current = setTimeout(pollForReady, pollInterval);
            }
          } catch {
            if (!isCurrent()) return;
            setError("Failed to check audio status");
            setStatus("error");
          }
        };

        pollTimer.current = setTimeout(pollForReady, pollInterval);
      }
    } catch (err) {
      if (!isCurrent()) return;
      setError(err instanceof Error ? err.message : "Failed to generate audio");
      setStatus("error");
    }
  }, [postId, status]);

  const play = useCallback(() => {
    if (audioRef.current && status === "ready") {
      audioRef.current.play();
      setStatus("playing");
    } else if (audioRef.current && status === "paused") {
      audioRef.current.play();
      setStatus("playing");
    }
  }, [status]);

  const pause = useCallback(() => {
    if (audioRef.current && status === "playing") {
      audioRef.current.pause();
      setStatus("paused");
    }
  }, [status]);

  const toggle = useCallback(() => {
    if (status === "playing") {
      pause();
    } else if (status === "ready" || status === "paused") {
      play();
    }
  }, [status, play, pause]);

  const seek = useCallback((time: number) => {
    if (audioRef.current) {
      audioRef.current.currentTime = time;
      setCurrentTime(time);
    }
  }, []);

  const setPlaybackRate = useCallback((rate: number) => {
    playbackRateRef.current = rate;
    setPlaybackRateState(rate);
    if (audioRef.current) {
      audioRef.current.playbackRate = rate;
    }
  }, []);

  const setVolume = useCallback((value: number) => {
    if (!Number.isFinite(value)) throw new RangeError("Volume must be finite");
    const next = Math.max(0, Math.min(1, value));
    volumeRef.current = next;
    setVolumeState(next);
    if (next > 0) {
      lastAudibleVolume.current = next;
    }
    mutedRef.current = next === 0;
    setMuted(mutedRef.current);
    if (audioRef.current) {
      audioRef.current.volume = next;
      audioRef.current.muted = mutedRef.current;
    }
  }, []);

  const toggleMute = useCallback(() => {
    if (volumeRef.current === 0) {
      setVolume(lastAudibleVolume.current);
      return;
    }
    mutedRef.current = !mutedRef.current;
    setMuted(mutedRef.current);
    if (audioRef.current) audioRef.current.muted = mutedRef.current;
  }, [setVolume]);

  const progress =
    durationSeconds && durationSeconds > 0 ? (currentTime / durationSeconds) * 100 : 0;

  const getMediaElement = useCallback(() => audioRef.current, []);

  return {
    status,
    audioUrl,
    durationSeconds,
    currentTime,
    progress,
    error,
    generateAudio,
    play,
    pause,
    toggle,
    seek,
    playbackRate,
    setPlaybackRate,
    volume,
    isMuted: muted || volume === 0,
    setVolume,
    toggleMute,
    wordTimings,
    getMediaElement,
    isPlaying: status === "playing",
  };
}
