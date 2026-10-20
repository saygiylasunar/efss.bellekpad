import test from "node:test";
import assert from "node:assert/strict";
import { classifyRuntimeFailure } from "../src/runtime-errors.js";
import { planRuntimeCommand } from "../src/runtime-supervisor.js";

test("runtime errors have distinct actionable categories", () => {
  const cases = [
    [{ error: Object.assign(new Error("spawn lms ENOENT"), { code: "ENOENT" }) }, "EXECUTABLE_NOT_FOUND"],
    [{ exitCode: 1, stderr: "CUDA out of memory" }, "CUDA_OUT_OF_MEMORY"],
    [{ exitCode: 1, stderr: "model not found" }, "MODEL_NOT_FOUND"],
    [{ exitCode: 1, stderr: "EADDRINUSE" }, "PORT_IN_USE"],
    [{ exitCode: 1, stderr: "unsupported architecture" }, "FORMAT_UNSUPPORTED"],
    [{ exitCode: 1, stderr: "permission denied" }, "PERMISSION_DENIED"],
    [{ exitCode: 1 }, "COMMAND_EXIT_NONZERO"],
    [{ cancelled: true }, "CANCELLED"],
    [{ exitCode: 0 }, null]
  ];
  for (const [args, expected] of cases)
    assert.equal(classifyRuntimeFailure(args).code, expected);
});

test("test runner is allowlisted as a supervised command without shell", () => {
  const command = planRuntimeCommand("test");
  assert.equal(command.executable, process.execPath);
  assert.deepEqual(command.args, ["--test"]);
  assert.throws(() => planRuntimeCommand("command --eval \"x\""), /ACTION_NOT_ALLOWED/);
});
