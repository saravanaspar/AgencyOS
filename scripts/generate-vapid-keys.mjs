import { createECDH } from "node:crypto";

const ecdh = createECDH("prime256v1");
ecdh.generateKeys();

console.log(`NOTIFICATION_VAPID_PUBLIC_KEY=${ecdh.getPublicKey().toString("base64url")}`);
console.log(`NOTIFICATION_VAPID_PRIVATE_KEY=${ecdh.getPrivateKey().toString("base64url")}`);
