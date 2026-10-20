import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const clientRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const app = readFileSync(resolve(clientRoot, "src/App.tsx"), "utf8");
const styles = readFileSync(resolve(clientRoot, "src/App.css"), "utf8");

assert.match(app, /aria-controls="primary-navigation"/);
assert.match(app, /aria-expanded=\{navigationOpen\}/);
assert.match(app, /id="primary-navigation"/);

for (const path of [
  "/",
  "/front-desk",
  "/guests",
  "/reservations",
  "/housekeeping",
  "/properties",
  "/billing",
  "/reports",
  "/staff",
  "/tasks",
  "/room-availability",
  "/maintenance",
]) {
  assert.ok(app.includes(`path="${path}"`), `Missing navigation destination: ${path}`);
}

assert.match(styles, /\.app-layout\s*\{[^}]*grid-template-columns:\s*210px\s+minmax\(0,\s*1fr\)/);
assert.match(styles, /@media \(max-width: 760px\)\s*\{[\s\S]*?\.app-layout\s*\{\s*display:\s*block;/);
assert.match(styles, /\.main-nav\s*\{[^}]*display:\s*none/);
assert.match(styles, /\.main-nav\.is-open\s*\{\s*display:\s*flex;/);

console.log("Responsive navigation layout and destination tests passed.");
