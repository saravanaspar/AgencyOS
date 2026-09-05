import { createECDH } from "node:crypto";

const ecdh = createECDH("prime256v1");
ecdh.generateKeys();

console.log("Paste these values into Settings -> Integrations -> Browser push:");
console.log(`Public key:  ${ecdh.getPublicKey().toString("base64url")}`);
console.log(`Private key: ${ecdh.getPrivateKey().toString("base64url")}`);
