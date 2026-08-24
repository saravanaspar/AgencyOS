import { Socket } from "node:net";

const endpoint = process.env.PRIVATE_FILE_SCANNER_URL?.trim() || "clamav://127.0.0.1:3310";
const url = new URL(endpoint);
if (url.protocol !== "clamav:") {
  console.error("PRIVATE_FILE_SCANNER_URL must use clamav:// for this check.");
  process.exit(1);
}

const host = url.hostname.replace(/^\[|\]$/g, "");
const port = Number(url.port || 3310);
const socket = new Socket();
let response = "";

const fail = (message) => {
  console.error(message);
  socket.destroy();
  process.exitCode = 1;
};

socket.setTimeout(10_000);
socket.once("timeout", () => fail("ClamAV did not answer within 10 seconds."));
socket.once("error", (error) => fail(`ClamAV connection failed: ${error.message}`));
socket.on("data", (chunk) => {
  response += chunk.toString("utf8");
  if (response.includes("\0") || response.includes("\n")) {
    const normalized = response.replaceAll("\0", "").trim();
    if (normalized === "PONG") {
      console.log(`ClamAV is ready at ${host}:${port}.`);
      socket.destroy();
      return;
    }
    fail(`Unexpected ClamAV response: ${normalized || "<empty>"}`);
  }
});
socket.once("close", () => {
  if (!response && process.exitCode !== 1) fail("ClamAV closed the connection without a response.");
});
socket.connect(port, host, () => socket.end(Buffer.from("zPING\0", "ascii")));
