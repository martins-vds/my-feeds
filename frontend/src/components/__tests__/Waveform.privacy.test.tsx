import { afterEach, describe, expect, it, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { Waveform } from "../Waveform";

afterEach(() => vi.unstubAllGlobals());

describe("private waveform lifecycle", () => {
  it("does not reuse decoded private audio across reader remounts and bypasses HTTP caches", async () => {
    const fetcher = vi.fn().mockImplementation(async () => new Response(new Uint8Array([1, 2, 3])));
    vi.stubGlobal("fetch", fetcher);
    vi.stubGlobal(
      "AudioContext",
      class {
        decodeAudioData = async () => ({ getChannelData: () => new Float32Array([0.3, 0.6, 0.9]) });
        close = async () => {};
      }
    );
    const first = render(<Waveform audioUrl="/api/audio/private.mp3" progress={0} />);
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    // Allow the real decode promise to finish before leaving the first reader.
    await waitFor(() =>
      expect(first.container.querySelectorAll('[role="progressbar"]')).toHaveLength(1)
    );
    first.unmount();
    render(<Waveform audioUrl="/api/audio/private.mp3" progress={0} />);
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    expect(fetcher).toHaveBeenLastCalledWith("/api/audio/private.mp3", {
      cache: "no-store",
      credentials: "include",
    });
  });
});
