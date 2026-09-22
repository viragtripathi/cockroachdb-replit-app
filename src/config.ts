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
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
});

export interface AppConfig {
  readonly databaseUrl: string;
  readonly port: number;
  readonly poolMax: number;
  readonly nodeEnv: "development" | "test" | "production";
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = environmentSchema.parse(env);

  return Object.freeze({
    databaseUrl: parsed.DATABASE_URL,
    port: parsed.PORT,
    poolMax: parsed.DB_POOL_MAX,
    nodeEnv: parsed.NODE_ENV,
  });
}
