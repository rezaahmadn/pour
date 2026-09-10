import { env } from "cloudflare:workers";
import { describe, it, expect } from "vitest";
import app from "../src/index";

describe("health", () => {
  it("returns ok", async () => {
    const res = await app.request("/health", undefined, env);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ok");
  });
});
