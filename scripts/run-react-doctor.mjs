import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const mode = process.argv[2] ?? "advisory";
const forwardedArguments = process.argv.slice(3);
const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "agencyos-react-doctor-"));
const reportPath = path.join(temporaryDirectory, "report.json");

const modeArguments = {
  advisory: ["--verbose", "--blocking", "none", "--max-duration", "300"],
  security: [
    "--verbose",
    "--category",
    "Security",
    "--blocking",
    "error",
    "--max-duration",
    "120",
    "--no-dead-code",
    "--no-supply-chain",
    "--no-parallel",
  ],
  ci: [
    "--verbose",
    "--scope",
    "changed",
    "--blocking",
    "error",
    "--max-duration",
    "180",
    "--no-dead-code",
    "--no-supply-chain",
  ],
};

const selectedArguments = modeArguments[mode];
if (!selectedArguments) {
  console.error(`Unknown React Doctor mode: ${mode}`);
  process.exit(2);
}

const command = process.platform === "win32" ? "npx.cmd" : "npx";
const result = spawnSync(
  command,
  [
    "react-doctor",
    ".",
    "--no-score",
    "--json",
    "--json-out",
    reportPath,
    ...selectedArguments,
    ...forwardedArguments,
  ],
  { stdio: "ignore", timeout: 360_000 },
);

try {
  const report = JSON.parse(await readFile(reportPath, "utf8"));
  const summary = report.summary ?? {};
  const projects = Array.isArray(report.projects) ? report.projects : [];
  const complete = projects.length > 0 && projects.every((project) => project.complete === true);
  const errorCount = Number(summary.errorCount ?? 0);
  const warningCount = Number(summary.warningCount ?? 0);

  console.log(
    `React Doctor ${mode}: ${errorCount} errors, ${warningCount} warnings, ${complete ? "complete" : "partial"} scan.`,
  );

  if (result.error && result.error.code === "ETIMEDOUT") {
    console.error("React Doctor exceeded the wrapper timeout.");
    process.exitCode = 1;
  } else if (
    !complete ||
    report.error ||
    (mode !== "advisory" && (errorCount > 0 || report.ok !== true))
  ) {
    if (report.error?.message) console.error(report.error.message);
    process.exitCode = 1;
  } else {
    process.exitCode = 0;
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : "React Doctor did not produce a report.");
  process.exitCode = result.status ?? 1;
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}
