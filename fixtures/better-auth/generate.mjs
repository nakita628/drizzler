// One fixture per Better Auth plugin that changes the database schema, plus `core` (no plugin)
// and `full` (all of them). Each schema is what Better Auth generates for Drizzle with relations
// v2 (`npx auth generate`), through the Drizzle adapter's `createSchema`; drizzler then draws it
// as docs/er.svg, docs/ER.md (Mermaid) and docs/schema.dbml.
//
// The plugins left out (bearer, captcha, custom-session, email-otp, generic-oauth,
// haveibeenpwned, magic-link, multi-session, oauth-popup, oauth-proxy, one-tap, one-time-token,
// open-api) add no table or column: their schema is core's.
//
//   pnpm build && pnpm -F @fixtures/better-auth generate
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { drizzleAdapter } from "@better-auth/drizzle-adapter/relations-v2";
import {
  admin,
  anonymous,
  deviceAuthorization,
  jwt,
  lastLoginMethod,
  organization,
  phoneNumber,
  siwe,
  twoFactor,
  username,
} from "better-auth/plugins";

const require = createRequire(import.meta.url);
const CLI = path.join(path.dirname(require.resolve("drizzler/package.json")), "dist/cli.js");

function siweForSchema() {
  return siwe({
    domain: "example.com",
    getNonce: async () => "nonce",
    verifyMessage: async () => true,
  });
}

const PATTERNS = new Map([
  ["core", () => []],
  ["admin", () => [admin()]],
  ["anonymous", () => [anonymous()]],
  ["device-authorization", () => [deviceAuthorization()]],
  ["jwt", () => [jwt()]],
  ["last-login-method", () => [lastLoginMethod({ storeInDatabase: true })]],
  ["organization", () => [organization()]],
  ["organization-teams", () => [organization({ teams: { enabled: true } })]],
  [
    "organization-dynamic-access-control",
    () => [organization({ dynamicAccessControl: { enabled: true } })],
  ],
  ["phone-number", () => [phoneNumber()]],
  ["siwe", () => [siweForSchema()]],
  ["two-factor", () => [twoFactor()]],
  ["username", () => [username()]],
  [
    "full",
    () => [
      admin(),
      anonymous(),
      deviceAuthorization(),
      jwt(),
      lastLoginMethod({ storeInDatabase: true }),
      organization({ teams: { enabled: true }, dynamicAccessControl: { enabled: true } }),
      phoneNumber(),
      siweForSchema(),
      twoFactor(),
      username(),
    ],
  ],
]);

// The Drizzle schema Better Auth generates for these plugins, on PostgreSQL.
async function schemaOf(plugins) {
  const adapter = drizzleAdapter({}, { provider: "pg" })({ plugins });
  const { code } = await adapter.createSchema({ file: "schema.ts" });
  return code;
}

for (const [name, plugins] of PATTERNS) {
  const dir = path.join(import.meta.dirname, name);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(path.join(dir, "db"), { recursive: true });
  fs.writeFileSync(path.join(dir, "db/schema.ts"), await schemaOf(plugins()));
  for (const output of ["docs/er.svg", "docs/ER.md", "docs/schema.dbml"]) {
    execFileSync(process.execPath, [CLI, "db/schema.ts", "-o", output], { cwd: dir });
  }
  console.log(`generated ${name}`);
}
