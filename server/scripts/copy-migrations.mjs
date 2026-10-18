import { cp, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const source = resolve(scriptDirectory, "../src/db/migrations");
const destination = resolve(scriptDirectory, "../dist/db/migrations");

await mkdir(destination, { recursive: true });
await cp(source, destination, { recursive: true });
