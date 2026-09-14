import assert from "node:assert/strict";
import { cpSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const [planPath, mode] = process.argv.slice(2);
assert(mode === "before" || mode === "after");
const plan = JSON.parse(readFileSync(planPath, "utf8"));
assert(process.env.GITHUB_ACTIONS === "true");
const cwd = process.cwd();
for (const file of plan.files) {
	assert(!file.path.startsWith("/") && !file.path.split("/").includes(".."));
	const path = resolve(cwd, file.path);
	assert.equal(readFileSync(path, "utf8"), file.before, "Upstream file changed: " + file.path);
	if (mode === "after" || file.kind === "test") writeFileSync(path, file.after);
}
const env = { ...process.env, PI_NO_LOCAL_LLM: "1", AWS_EC2_METADATA_DISABLED: "true", FORCE_COLOR: "0" };
assert.equal(spawnSync("npm", ["run", "hydrate:model-data"], { cwd, env, stdio: "inherit" }).status, 0);
const compiler = resolve(cwd, "node_modules/@typescript/native-preview/bin/tsgo.js");
for (const pkg of ["chord", "tui", "telemetry", "ai", "agent", "session-backends/sqlite-node", "protocol", "client", "server", "coding-agent"]) {
	assert.equal(spawnSync("node", [compiler, "-p", "tsconfig.build.json"], {
		cwd: resolve(cwd, "packages", pkg), env, stdio: "inherit",
	}).status, 0, "Test artifact compilation failed: " + pkg);
	if (pkg === "ai") cpSync(resolve(cwd, "packages/ai/src/providers/data"), resolve(cwd, "packages/ai/dist/providers/data"), { recursive: true });
}
const target = spawnSync("node", [
	resolve(cwd, "node_modules/vitest/dist/cli.js"),
	"--run", "test/harness/resource-formatting.test.ts",
], { cwd: resolve(cwd, "packages/agent"), env, encoding: "utf8" });
process.stdout.write(target.stdout ?? "");
process.stderr.write(target.stderr ?? "");
const output = (target.stdout ?? "") + (target.stderr ?? "");
if (mode === "before") {
	assert.equal(target.status, 1, "Expected the regression to fail on unchanged upstream");
	assert(output.includes("AssertionError"), "Failure must be an assertion, not setup");
	assert(output.includes("keeps"), "Failure must reach the new regression cases");
	assert(!output.includes("Failed to load"), "Import/setup failure is not a reproduction");
	console.log("BASELINE_REGRESSION_CONFIRMED");
} else {
	assert.equal(target.status, 0, "Focused regression suite failed");
	const check = spawnSync("npm", ["run", "check"], { cwd, env, stdio: "inherit" });
	const tests = spawnSync("./test.sh", [], { cwd, env, stdio: "inherit" });
	console.log("REQUIRED_CHECK_RESULTS=" + JSON.stringify({ check: check.status, tests: tests.status }));
	if (check.status !== 0 || tests.status !== 0) process.exit(1);
	for (const file of plan.files) {
		console.log("VALIDATED_FILE_JSON=" + JSON.stringify({
			path: file.path,
			content: readFileSync(resolve(cwd, file.path), "utf8"),
		}));
	}
	console.log("PI_VALIDATION_COMPLETE");
}
