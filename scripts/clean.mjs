import { rm } from "node:fs/promises";
import { basename, resolve } from "node:path";

const outputDirectory = resolve(process.cwd(), "dist");
if (basename(outputDirectory) !== "dist") {
  throw new Error("Refusing to clean an unexpected output directory");
}
await rm(outputDirectory, { recursive: true, force: true });
