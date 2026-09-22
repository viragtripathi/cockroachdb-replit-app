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
    expect(config.nodeEnv).toBe("development");
  });

  test("accepts valid numeric overrides", () => {
    const config = loadConfig({
      DATABASE_URL: "postgresql://example",
      PORT: "8080",
      DB_POOL_MAX: "9",
      NODE_ENV: "production",
    });

    expect(config.port).toBe(8080);
    expect(config.poolMax).toBe(9);
    expect(config.nodeEnv).toBe("production");
  });

  test.each([
    ["PORT", "0"],
    ["PORT", "70000"],
    ["DB_POOL_MAX", "0"],
    ["DB_POOL_MAX", "not-a-number"],
  ])("rejects invalid %s value %s", (name, value) => {
    expect(() =>
      loadConfig({ DATABASE_URL: "postgresql://example", [name]: value }),
    ).toThrow(new RegExp(name));
  });
});
