import { afterEach, expect, it, vi } from "vitest";

const { render } = vi.hoisted(() => ({ render: vi.fn() }));
vi.mock("react-dom/client", () => ({ default: { createRoot: () => ({ render }) } }));
vi.mock("../App", () => ({ default: () => null }));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

it("registers the privacy-safe worker immediately so legacy workers can be replaced", async () => {
  document.body.innerHTML = '<div id="root"></div>';
  const register = vi.fn().mockResolvedValue({});
  vi.stubEnv("DEV", false);
  vi.stubGlobal("navigator", { serviceWorker: { register } });
  await import("../main");
  expect(register).toHaveBeenCalledWith("/sw.js", { type: "module" });
});
