import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import manifest from "../package.json" with { type: "json" };
import lock from "../package-lock.json" with { type: "json" };

const version = manifest.version;
assert.match(version, /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/, "Use a major.minor.patch product version");
assert.equal(lock.version, version, "Update the npm lockfile version");
assert.equal(lock.packages[""].version, version, "Update the locked root package version");
const tag = process.argv[2];
if (tag !== undefined) assert.equal(tag, `v${version}`, "The release tag must match the root package version");

const changelog = readFileSync(new URL("../CHANGELOG.md", import.meta.url), "utf8");
const sections = changelog.replaceAll("\r\n", "\n").split(/^## /m).slice(1);
const entries = sections.filter(section => section.startsWith(version + "\n"));
assert.equal(entries.length, 1, `Expected one changelog heading for ${version}`);
const notes = entries[0].slice(version.length).trim();
assert.ok(notes, "Describe the changes in this release");
console.log(notes);
