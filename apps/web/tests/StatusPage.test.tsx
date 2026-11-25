import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StatusPage } from "../src/StatusPage";
import { version } from "../../../package.json";

const requestId = "91986d65-a7c1-4315-9832-8e7088f72c28";
function readiness(status: "ready" | "unavailable") {
  return Response.json({ status, checkedAt: "2026-11-25T09:00:00.000Z", requestId }, {
    status: status === "ready" ? 200 : 503,
  });
}
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("system status", () => {
  it("shows a database outage and lets staff retry without reloading", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(readiness("unavailable")).mockResolvedValueOnce(readiness("ready"));
    vi.stubGlobal("fetch", fetch);
    render(<StatusPage />);
    expect(screen.getByText("Checking services")).toBeDefined();
    await screen.findByText("Unavailable");
    expect(screen.getByText("Reachable")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Check again" }));
    await screen.findByText("All services operational");
    expect(screen.getByText(requestId)).toBeDefined();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("keeps database status unknown when the proxy returns an invalid API response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("Bad gateway", { status: 502 })));
    render(<StatusPage />);
    await screen.findByText("Unverified");
    expect(screen.getByText(`v${version}`)).toBeDefined();
    expect(screen.getByText("Unknown")).toBeDefined();
    expect(screen.queryByText("Request ID")).toBeNull();
  });
});
