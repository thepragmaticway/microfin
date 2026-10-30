import { readdir } from "node:fs/promises";
import { spawn } from "node:child_process";
const child = spawn(
  process.execPath,
  ["--test", "--test-concurrency=1", ...(await readdir("tests/api")).filter((file) => file.endsWith(".test.mjs")).sort().map((file) => "tests/api/" + file)],
  { stdio: "inherit" },
);
child.on("exit", (code) => (process.exitCode = code ?? 1));
