import { randomBytes, scryptSync } from "node:crypto";
import { writeFileSync } from "node:fs";

const outputPath = process.argv[2];
if (!outputPath) {
  throw new Error("Usage: node scripts/generate-ops-accounts.mjs <secure-output-path>");
}

const definitions = [
  { username: "cashier", displayName: "Кассчин", role: "cashier" },
  { username: "manager", displayName: "Менежер", role: "manager" },
  { username: "owner", displayName: "Эзэмшигч", role: "owner" },
];

const credentials = [];
const accounts = definitions.map((definition) => {
  const password = randomBytes(18).toString("base64url");
  const salt = randomBytes(16);
  const passwordHash = scryptSync(password, salt, 32);
  credentials.push({
    username: definition.username,
    password,
    role: definition.role,
  });
  return {
    ...definition,
    salt: salt.toString("base64url"),
    passwordHash: passwordHash.toString("base64url"),
  };
});

writeFileSync(
  outputPath,
  JSON.stringify(
    {
      sessionSecret: randomBytes(48).toString("base64url"),
      accounts,
      credentials,
    },
    null,
    2,
  ),
  { mode: 0o600 },
);
