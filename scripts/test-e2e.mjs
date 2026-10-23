import { spawn } from "node:child_process";
import { localStack } from "./local-stack.mjs";
const stack = await localStack({ auth: true });
try {
  const url = await stack.startApp();
  const code = await new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        "node_modules/@playwright/test/cli.js",
        "test",
        ...process.argv.slice(2),
      ],
      { stdio: "inherit", env: { ...process.env, MICROFIN_E2E_URL: url } },
    );
    child.on("error", reject);
    child.on("exit", (code) => resolve(code ?? 1));
  });
  process.exitCode = code;
} finally {
  await stack.stop();
}
