import { z } from "zod";

const environmentSchema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  PORT: z.coerce
    .number()
    .int("PORT must be an integer")
    .min(1, "PORT must be at least 1")
    .max(65_535, "PORT must be at most 65535")
    .default(3000),
  DB_POOL_MAX: z.coerce
    .number()
    .int("DB_POOL_MAX must be an integer")
    .min(1, "DB_POOL_MAX must be at least 1")
    .max(50, "DB_POOL_MAX must be at most 50")
    .default(5),
  HOST: z.string().min(1, "HOST must not be empty").default("0.0.0.0"),
  APPLICATION_NAME: z
    .string()
    .min(1, "APPLICATION_NAME must not be empty")
    .default("cockroachdb-replit-app"),
  DB_CONNECTION_TIMEOUT_MS: z.coerce
    .number()
    .int("DB_CONNECTION_TIMEOUT_MS must be an integer")
    .min(1, "DB_CONNECTION_TIMEOUT_MS must be at least 1")
    .default(5_000),
  DB_IDLE_TIMEOUT_MS: z.coerce
    .number()
    .int("DB_IDLE_TIMEOUT_MS must be an integer")
    .min(1, "DB_IDLE_TIMEOUT_MS must be at least 1")
    .default(30_000),
  TX_MAX_ATTEMPTS: z.coerce
    .number()
    .int("TX_MAX_ATTEMPTS must be an integer")
    .min(1, "TX_MAX_ATTEMPTS must be at least 1")
    .default(5),
  TX_BASE_DELAY_MS: z.coerce
    .number()
    .int("TX_BASE_DELAY_MS must be an integer")
    .min(1, "TX_BASE_DELAY_MS must be at least 1")
    .default(20),
  TX_MAX_DELAY_MS: z.coerce
    .number()
    .int("TX_MAX_DELAY_MS must be an integer")
    .min(1, "TX_MAX_DELAY_MS must be at least 1")
    .default(1_000),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
});

export interface RetryConfig {
  readonly maxAttempts: number;
  readonly baseDelayMs: number;
  readonly maxDelayMs: number;
}

export interface AppConfig {
  readonly databaseUrl: string;
  readonly port: number;
  readonly poolMax: number;
  readonly host: string;
  readonly applicationName: string;
  readonly connectionTimeoutMs: number;
  readonly idleTimeoutMs: number;
  readonly retry: RetryConfig;
  readonly nodeEnv: "development" | "test" | "production";
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = environmentSchema.parse(env);

  return Object.freeze({
    databaseUrl: parsed.DATABASE_URL,
    port: parsed.PORT,
    poolMax: parsed.DB_POOL_MAX,
    host: parsed.HOST,
    applicationName: parsed.APPLICATION_NAME,
    connectionTimeoutMs: parsed.DB_CONNECTION_TIMEOUT_MS,
    idleTimeoutMs: parsed.DB_IDLE_TIMEOUT_MS,
    retry: Object.freeze({
      maxAttempts: parsed.TX_MAX_ATTEMPTS,
      baseDelayMs: parsed.TX_BASE_DELAY_MS,
      maxDelayMs: parsed.TX_MAX_DELAY_MS,
    }),
    nodeEnv: parsed.NODE_ENV,
  });
}
