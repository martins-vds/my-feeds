import { describe, expect, it } from "vitest";
import { BASE_WPM, buildPacedTimings } from "../pacedTimings";

const durations = (words: string[], wpm = BASE_WPM) =>
  buildPacedTimings(words, wpm).map((timing) => timing.durationMs);

describe("buildPacedTimings", () => {
  it("returns nothing for no words", () => {
    expect(buildPacedTimings([], BASE_WPM)).toEqual([]);
  });

  it("gives a five-letter word exactly one beat of 60000 / wpm milliseconds", () => {
    expect(durations(["hello"])).toEqual([240]);
    expect(durations(["hello"], 125)).toEqual([480]);
    expect(durations(["hello", "world."], 500)).toEqual([120, 240]);
  });

  it("scales a word's time with its length, within bounds", () => {
    expect(durations(["a"])).toEqual([125]);
    expect(durations(["a".repeat(15)])).toEqual([528]);
    expect(durations(["a".repeat(30)])).toEqual([600]);
  });

  it("counts letters and digits but not punctuation", () => {
    expect(durations(["(hello)"])).toEqual(durations(["hello"]));
    expect(durations(["2024"])).toEqual([211]);
  });

  it("pauses a beat after a sentence end and half a beat after a clause break", () => {
    expect(durations(["hello.", "hello!", "hello?", "hello…"])).toEqual([480, 480, 480, 480]);
    expect(durations(["hello,", "hello;", "hello:", "hello—", "hello–"])).toEqual([
      360, 360, 360, 360, 360,
    ]);
  });

  it("looks through closing quotes and brackets for the punctuation", () => {
    expect(durations(['hello."', "hello.)", "hello.”", "hello?’"])).toEqual([480, 480, 480, 480]);
    expect(durations(['hello,"', "hello,)"])).toEqual([360, 360]);
  });

  it.each(["a.b", "a,b", "a;b", "a:b", "a—b"])(
    "does not pause for punctuation inside %s",
    (word) => {
      expect(durations([word])).toEqual(durations(["ab"]));
    }
  );

  it("treats a word with no letters as short, and still pauses on a dash", () => {
    expect(durations(["•"])).toEqual([120]);
    expect(durations(["—"])).toEqual([240]);
  });

  it("lays the words end to end starting at zero and keeps their text", () => {
    const timings = buildPacedTimings(["Hello", "brave", "new", "world."], BASE_WPM);

    expect(timings.map((timing) => timing.text)).toEqual(["Hello", "brave", "new", "world."]);
    expect(timings[0].startMs).toBe(0);
    timings.slice(1).forEach((timing, index) => {
      expect(timing.startMs).toBe(timings[index].startMs + timings[index].durationMs);
    });
  });
});
