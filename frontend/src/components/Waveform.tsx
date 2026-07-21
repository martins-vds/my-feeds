/**
 * Waveform - renders an audio file's "shape" as a seekable progress bar.
 *
 * Peaks are computed with the Web Audio API (decode -> average the absolute
 * samples per block -> normalize), following the approach described in
 * https://css-tricks.com/making-an-audio-waveform-visualizer-with-vanilla-javascript/
 * The played portion is highlighted and clicking anywhere seeks.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Box, useTheme } from "@mui/material";

interface WaveformProps {
    audioUrl: string | null | undefined;
    /** Playback progress, 0..100 */
    progress: number;
    /** Called with a 0..1 fraction when the user clicks to seek */
    onSeek?: (fraction: number) => void;
    height?: number;
    bars?: number;
}

// Cache decoded peaks per URL so we don't re-decode on every mount/re-render.
const peaksCache = new Map<string, number[]>();

async function computePeaks(url: string, bars: number): Promise<number[]> {
    const response = await fetch(url);
    const arrayBuffer = await response.arrayBuffer();

    const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
            .webkitAudioContext;
    if (!AudioCtx) {
        throw new Error("Web Audio API not supported");
    }

    const audioContext = new AudioCtx();
    try {
        const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
        const rawData = audioBuffer.getChannelData(0);
        const blockSize = Math.floor(rawData.length / bars) || 1;

        const filtered: number[] = [];
        for (let i = 0; i < bars; i++) {
            const start = blockSize * i;
            let sum = 0;
            for (let j = 0; j < blockSize; j++) {
                sum += Math.abs(rawData[start + j] || 0);
            }
            filtered.push(sum / blockSize);
        }

        // Normalize so the loudest block is 1.
        const max = Math.max(...filtered);
        const multiplier = max > 0 ? 1 / max : 0;
        return filtered.map((n) => n * multiplier);
    } finally {
        await audioContext.close();
    }
}

export function Waveform({
    audioUrl,
    progress,
    onSeek,
    height = 40,
    bars = 64,
}: WaveformProps) {
    const theme = useTheme();
    const containerRef = useRef<HTMLDivElement | null>(null);
    const [peaks, setPeaks] = useState<number[] | null>(
        audioUrl ? peaksCache.get(audioUrl) ?? null : null
    );

    useEffect(() => {
        if (!audioUrl) {
            setPeaks(null);
            return;
        }
        const cached = peaksCache.get(audioUrl);
        if (cached) {
            setPeaks(cached);
            return;
        }
        let cancelled = false;
        computePeaks(audioUrl, bars)
            .then((data) => {
                if (cancelled) return;
                peaksCache.set(audioUrl, data);
                setPeaks(data);
            })
            .catch(() => {
                // Fall back to a flat placeholder if decoding isn't possible.
                if (!cancelled) setPeaks(null);
            });
        return () => {
            cancelled = true;
        };
    }, [audioUrl, bars]);

    // Flat placeholder while decoding (or if it fails / isn't supported).
    const displayPeaks = useMemo(
        () => peaks ?? new Array(bars).fill(0.12),
        [peaks, bars]
    );

    const progressFraction = Math.min(1, Math.max(0, progress / 100));

    const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
        if (!onSeek || !containerRef.current) return;
        const rect = containerRef.current.getBoundingClientRect();
        const fraction = Math.min(
            1,
            Math.max(0, (e.clientX - rect.left) / rect.width)
        );
        onSeek(fraction);
    };

    return (
        <Box
            ref={containerRef}
            onClick={handleClick}
            role="progressbar"
            aria-label="Audio progress"
            aria-valuenow={Math.round(progress)}
            aria-valuemin={0}
            aria-valuemax={100}
            sx={{
                display: "flex",
                alignItems: "center",
                gap: "2px",
                height,
                width: "100%",
                cursor: onSeek ? "pointer" : "default",
            }}
        >
            {displayPeaks.map((peak, i) => {
                const played =
                    (i + 0.5) / displayPeaks.length <= progressFraction;
                const barHeight = Math.max(2, peak * height);
                return (
                    <Box
                        key={i}
                        sx={{
                            flex: 1,
                            minWidth: "1px",
                            height: `${barHeight}px`,
                            borderRadius: "1px",
                            backgroundColor: played
                                ? theme.palette.primary.main
                                : theme.palette.action.disabled,
                            transition: "background-color 0.1s linear",
                        }}
                    />
                );
            })}
        </Box>
    );
}

export default Waveform;
