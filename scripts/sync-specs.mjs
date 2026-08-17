#!/usr/bin/env node
// Downloads the vendored OpenAPI specs. Equivalent of `vendir sync` / `make update-specs`
// in ecosystems-go.
//
// Unlike vendir, this records a sha256 per spec in specs/.lock.json so "did upstream
// change?" is answerable without diffing thousands of lines of YAML. (ecosystems-go's
// vendir.lock.yml does not actually pin content.)
import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { SPECS } from "./specs.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SPEC_DIR = path.join(ROOT, "specs");
const LOCK_FILE = path.join(SPEC_DIR, ".lock.json");

const sha256 = (text) => createHash("sha256").update(text).digest("hex");

async function main() {
  const lock = { fetchedAt: new Date().toISOString(), specs: {} };

  for (const spec of SPECS) {
    process.stdout.write(`fetching ${spec.name} ... `);
    const res = await fetch(spec.url, {
      headers: { "User-Agent": "ecosystems-ts spec sync (https://github.com/ecosyste-ms)" },
    });
    if (!res.ok) {
      throw new Error(`${spec.url} responded ${res.status} ${res.statusText}`);
    }
    const body = await res.text();
    await writeFile(path.join(SPEC_DIR, `${spec.name}.yaml`), body, "utf8");

    const digest = sha256(body);
    lock.specs[spec.name] = { url: spec.url, sha256: digest, bytes: body.length };
    console.log(`ok (${body.length} bytes, sha256:${digest.slice(0, 12)})`);
  }

  await writeFile(LOCK_FILE, `${JSON.stringify(lock, null, 2)}\n`, "utf8");
  console.log(`\nwrote ${path.relative(ROOT, LOCK_FILE)}`);
  console.log("run `npm run generate` to regenerate types");
}

await main();
