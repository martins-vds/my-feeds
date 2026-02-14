import { useState, useCallback, useRef, useEffect } from "react";
import api from "../services/api";
import type { AudioInfo, AudioPending, AudioResponse } from "../types";

export type AudioStatus = "idle" | "loading" | "ready" | "playing" | "paused" | "error";

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
}

/**
 * Hook for managing audio playback and TTS generation for a post.
 *
 * @param postId - The post ID to get/generate audio for
 * @returns Audio player state and controls
 */
export function useAudioPlayer(postId: string): UseAudioPlayerResult {
    const [status, setStatus] = useState<AudioStatus>("idle");
    const [audioUrl, setAudioUrl] = useState<string | null>(null);
    const [durationSeconds, setDurationSeconds] = useState<number | null>(null);
    const [currentTime, setCurrentTime] = useState(0);
    const [error, setError] = useState<string | null>(null);

    const audioRef = useRef<HTMLAudioElement | null>(null);

    // Clean up audio element on unmount
    useEffect(() => {
        return () => {
            if (audioRef.current) {
                audioRef.current.pause();
                audioRef.current.src = "";
                audioRef.current = null;
            }
        };
    }, []);

    // Generate or fetch audio URL
    const generateAudio = useCallback(async () => {
        if (status === "loading") return;

        setStatus("loading");
        setError(null);

        try {
            const response = await api.get<AudioResponse>(`/posts/${postId}/audio`);

            if (response.status === "ready") {
                const audioInfo = response as AudioInfo;
                setAudioUrl(audioInfo.url);
                setDurationSeconds(audioInfo.durationSeconds ?? null);
                setStatus("ready");

                // Create audio element
                const audio = new Audio(audioInfo.url);
                audio.preload = "metadata";

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
                // Poll for completion
                const pending = response as AudioPending;
                const pollInterval = (pending.estimatedSeconds ?? 5) * 200; // Poll 5 times during estimate

                const pollForReady = async () => {
                    try {
                        const pollResponse = await api.get<AudioResponse>(
                            `/posts/${postId}/audio`
                        );
                        if (pollResponse.status === "ready") {
                            const audioInfo = pollResponse as AudioInfo;
                            setAudioUrl(audioInfo.url);
                            setDurationSeconds(audioInfo.durationSeconds ?? null);
                            setStatus("ready");

                            const audio = new Audio(audioInfo.url);
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
                            setTimeout(pollForReady, pollInterval);
                        }
                    } catch {
                        setError("Failed to check audio status");
                        setStatus("error");
                    }
                };

                setTimeout(pollForReady, pollInterval);
            }
        } catch (err) {
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

    const progress = durationSeconds && durationSeconds > 0
        ? (currentTime / durationSeconds) * 100
        : 0;

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
    };
}
