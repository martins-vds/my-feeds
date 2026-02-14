import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { BrowserRouter } from "react-router-dom";
import { ThemeProvider, createTheme } from "@mui/material";
import { AuthProvider } from "../../contexts/AuthContext";

// These tests are written TDD-style and should FAIL until AudioPlayer is implemented

describe("AudioPlayer", () => {
    const theme = createTheme();

    const renderWithProviders = (ui: React.ReactElement) => {
        return render(
            <ThemeProvider theme={theme}>
                <AuthProvider>
                    <BrowserRouter>{ui}</BrowserRouter>
                </AuthProvider>
            </ThemeProvider>
        );
    };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe("initial state", () => {
        it("renders listen button when no audio", async () => {
            // Import will fail until component exists
            const { AudioPlayer } = await import("../AudioPlayer");

            renderWithProviders(
                <AudioPlayer postId="test-post-id" audioUrl={null} />
            );

            expect(screen.getByRole("button", { name: /listen/i })).toBeInTheDocument();
        });

        it("shows play button when audio is ready", async () => {
            const { AudioPlayer } = await import("../AudioPlayer");

            renderWithProviders(
                <AudioPlayer
                    postId="test-post-id"
                    audioUrl="/api/audio/test-cache-key"
                />
            );

            expect(screen.getByRole("button", { name: /play/i })).toBeInTheDocument();
        });
    });

    describe("audio generation", () => {
        it("shows loading state while generating", async () => {
            const { AudioPlayer } = await import("../AudioPlayer");
            const mockOnGenerate = vi.fn(() => new Promise(() => { })); // Never resolves

            renderWithProviders(
                <AudioPlayer
                    postId="test-post-id"
                    audioUrl={null}
                    onGenerateAudio={mockOnGenerate}
                />
            );

            fireEvent.click(screen.getByRole("button", { name: /listen/i }));

            await waitFor(() => {
                expect(screen.getByText(/generating/i)).toBeInTheDocument();
            });
        });

        it("calls onGenerateAudio when listen clicked", async () => {
            const { AudioPlayer } = await import("../AudioPlayer");
            const mockOnGenerate = vi.fn().mockResolvedValue({
                status: "ready",
                url: "/api/audio/new-key"
            });

            renderWithProviders(
                <AudioPlayer
                    postId="test-post-id"
                    audioUrl={null}
                    onGenerateAudio={mockOnGenerate}
                />
            );

            fireEvent.click(screen.getByRole("button", { name: /listen/i }));

            expect(mockOnGenerate).toHaveBeenCalledWith("test-post-id");
        });

        it("shows play button after generation completes", async () => {
            const { AudioPlayer } = await import("../AudioPlayer");
            const mockOnGenerate = vi.fn().mockResolvedValue({
                status: "ready",
                url: "/api/audio/new-key"
            });

            renderWithProviders(
                <AudioPlayer
                    postId="test-post-id"
                    audioUrl={null}
                    onGenerateAudio={mockOnGenerate}
                />
            );

            fireEvent.click(screen.getByRole("button", { name: /listen/i }));

            await waitFor(() => {
                expect(screen.getByRole("button", { name: /play/i })).toBeInTheDocument();
            });
        });
    });

    describe("playback controls", () => {
        it("toggles play/pause on button click", async () => {
            const { AudioPlayer } = await import("../AudioPlayer");

            renderWithProviders(
                <AudioPlayer
                    postId="test-post-id"
                    audioUrl="/api/audio/test-key"
                />
            );

            const playButton = screen.getByRole("button", { name: /play/i });
            fireEvent.click(playButton);

            await waitFor(() => {
                expect(screen.getByRole("button", { name: /pause/i })).toBeInTheDocument();
            });
        });

        it("shows progress bar during playback", async () => {
            const { AudioPlayer } = await import("../AudioPlayer");

            renderWithProviders(
                <AudioPlayer
                    postId="test-post-id"
                    audioUrl="/api/audio/test-key"
                />
            );

            expect(screen.getByRole("progressbar")).toBeInTheDocument();
        });

        it("displays duration when available", async () => {
            const { AudioPlayer } = await import("../AudioPlayer");

            renderWithProviders(
                <AudioPlayer
                    postId="test-post-id"
                    audioUrl="/api/audio/test-key"
                    durationSeconds={125}
                />
            );

            expect(screen.getByText(/2:05/)).toBeInTheDocument();
        });
    });

    describe("error handling", () => {
        it("shows error message on generation failure", async () => {
            const { AudioPlayer } = await import("../AudioPlayer");
            const mockOnGenerate = vi.fn().mockRejectedValue(new Error("API Error"));

            renderWithProviders(
                <AudioPlayer
                    postId="test-post-id"
                    audioUrl={null}
                    onGenerateAudio={mockOnGenerate}
                />
            );

            fireEvent.click(screen.getByRole("button", { name: /listen/i }));

            await waitFor(() => {
                expect(screen.getByText(/failed/i)).toBeInTheDocument();
            });
        });

        it("allows retry after error", async () => {
            const { AudioPlayer } = await import("../AudioPlayer");
            const mockOnGenerate = vi.fn()
                .mockRejectedValueOnce(new Error("API Error"))
                .mockResolvedValueOnce({ status: "ready", url: "/api/audio/key" });

            renderWithProviders(
                <AudioPlayer
                    postId="test-post-id"
                    audioUrl={null}
                    onGenerateAudio={mockOnGenerate}
                />
            );

            fireEvent.click(screen.getByRole("button", { name: /listen/i }));

            await waitFor(() => {
                expect(screen.getByText(/retry/i)).toBeInTheDocument();
            });

            fireEvent.click(screen.getByRole("button", { name: /retry/i }));

            expect(mockOnGenerate).toHaveBeenCalledTimes(2);
        });
    });

    describe("accessibility", () => {
        it("has accessible button labels", async () => {
            const { AudioPlayer } = await import("../AudioPlayer");

            renderWithProviders(
                <AudioPlayer
                    postId="test-post-id"
                    audioUrl="/api/audio/test-key"
                />
            );

            const playButton = screen.getByRole("button", { name: /play/i });
            expect(playButton).toHaveAttribute("aria-label");
        });

        it("progress bar has accessible labels", async () => {
            const { AudioPlayer } = await import("../AudioPlayer");

            renderWithProviders(
                <AudioPlayer
                    postId="test-post-id"
                    audioUrl="/api/audio/test-key"
                />
            );

            const progressBar = screen.getByRole("progressbar");
            expect(progressBar).toHaveAttribute("aria-label");
        });
    });
});
