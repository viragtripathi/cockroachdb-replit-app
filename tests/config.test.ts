import { describe, expect, test } from "vitest";

import { loadConfig } from "../src/config.js";

describe("loadConfig", () => {
  test("requires DATABASE_URL", () => {
    expect(() => loadConfig({})).toThrow(/DATABASE_URL/);
  });

  test("uses safe defaults", () => {
    const config = loadConfig({ DATABASE_URL: "postgresql://example" });

    expect(config.port).toBe(3000);
    expect(config.poolMax).toBe(5);
    expect(config.host).toBe("0.0.0.0");
    expect(config.applicationName).toBe("cockroachdb-replit-app");
    expect(config.connectionTimeoutMs).toBe(5_000);
    expect(config.idleTimeoutMs).toBe(30_000);
    expect(config.retry).toEqual({
      maxAttempts: 5,
      baseDelayMs: 20,
      maxDelayMs: 1_000,
    });
    expect(config.nodeEnv).toBe("development");
  });

  test("accepts valid numeric overrides", () => {
    const config = loadConfig({
      DATABASE_URL: "postgresql://example",
      PORT: "8080",
      DB_POOL_MAX: "9",
      HOST: "127.0.0.1",
      APPLICATION_NAME: "configured-app",
      DB_CONNECTION_TIMEOUT_MS: "6000",
      DB_IDLE_TIMEOUT_MS: "45000",
      TX_MAX_ATTEMPTS: "7",
      TX_BASE_DELAY_MS: "25",
      TX_MAX_DELAY_MS: "1500",
      NODE_ENV: "production",
    });

    expect(config.port).toBe(8080);
    expect(config.poolMax).toBe(9);
    expect(config.host).toBe("127.0.0.1");
    expect(config.applicationName).toBe("configured-app");
    expect(config.connectionTimeoutMs).toBe(6_000);
    expect(config.idleTimeoutMs).toBe(45_000);
    expect(config.retry).toEqual({
      maxAttempts: 7,
      baseDelayMs: 25,
      maxDelayMs: 1_500,
    });
    expect(config.nodeEnv).toBe("production");
  });

  test.each([
    ["PORT", "0"],
    ["PORT", "70000"],
    ["DB_POOL_MAX", "0"],
    ["DB_POOL_MAX", "not-a-number"],
    ["DB_CONNECTION_TIMEOUT_MS", "0"],
    ["DB_IDLE_TIMEOUT_MS", "-1"],
    ["TX_MAX_ATTEMPTS", "0"],
    ["TX_BASE_DELAY_MS", "0"],
    ["TX_MAX_DELAY_MS", "NaN"],
  ])("rejects invalid %s value %s", (name, value) => {
    expect(() =>
      loadConfig({ DATABASE_URL: "postgresql://example", [name]: value }),
    ).toThrow(new RegExp(name));
  });
});
