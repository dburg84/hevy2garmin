import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Tests for POST /api/garmin-login. GarminAuth is mocked, so NO real Garmin SSO
 * runs and no real credentials are ever used.
 */

const loginMock = vi.fn();
vi.mock("garmin-auth", () => ({
  GarminAuth: class {
    constructor(_o: unknown) {}
    login() {
      return loginMock();
    }
  },
  DBTokenStore: class {
    constructor(..._a: unknown[]) {}
  },
  NEEDS_MFA: "needs_mfa",
}));
vi.mock("@/lib/garmin-upload", () => ({
  GARMIN_TOKEN_PLATFORM: "garmin_tokens",
  resetGarminClient: vi.fn(),
}));

import { POST } from "./route";

function req(body: unknown): Request {
  return new Request("http://h/api/garmin-login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.DATABASE_URL = "postgres://ci:ci@localhost:5432/ci";
});

describe("POST /api/garmin-login", () => {
  it("missing email/password → 400, no login attempt", async () => {
    const res = await POST(req({ email: "", password: "" }));
    expect(res.status).toBe(400);
    expect(loginMock).not.toHaveBeenCalled();
  });

  it("successful login → status connected", async () => {
    loginMock.mockResolvedValue({ domain: "garmin.com" });
    const res = await POST(req({ email: "a@b.com", password: "pw" }));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.status).toBe("connected");
    expect(loginMock).toHaveBeenCalledTimes(1);
  });

  it("NEEDS_MFA → status needs_mfa (200, with guidance)", async () => {
    loginMock.mockResolvedValue("needs_mfa");
    const res = await POST(req({ email: "a@b.com", password: "pw" }));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.status).toBe("needs_mfa");
    expect(json.error).toMatch(/two-factor|verification/i);
  });

  it("login throws (bad creds / blocked) → 502 error", async () => {
    loginMock.mockRejectedValue(new Error("SSO rejected"));
    const res = await POST(req({ email: "a@b.com", password: "pw" }));
    const json = await res.json();
    expect(res.status).toBe(502);
    expect(json.status).toBe("error");
  });

  it("invalid JSON → 400", async () => {
    const bad = new Request("http://h/api/garmin-login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{no",
    });
    const res = await POST(bad);
    expect(res.status).toBe(400);
    expect(loginMock).not.toHaveBeenCalled();
  });
});
