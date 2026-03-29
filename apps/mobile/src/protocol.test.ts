import { describe, expect, it } from "vitest";

import { buildHealthcheckUrl } from "./protocol";

describe("buildHealthcheckUrl", () => {
  it("maps websocket urls to the health endpoint", () => {
    expect(buildHealthcheckUrl("ws://192.168.1.2:3773")).toBe("http://192.168.1.2:3773/health");
  });

  it("maps secure websocket urls to https and strips query params", () => {
    expect(buildHealthcheckUrl("wss://example.com:443/path?token=secret")).toBe(
      "https://example.com/health",
    );
  });
});
