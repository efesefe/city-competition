/**
 * Smoke: support ops auth + phone normalize + (optional) live rebind against Postgres.
 * Usage:
 *   node scripts/smoke-support-rebind.mjs
 *   SUPPORT_OPS_KEY=… DATABASE_URL=… node scripts/smoke-support-rebind.mjs --live
 */
import assert from "node:assert/strict";

process.env.SUPPORT_OPS_KEY = process.env.SUPPORT_OPS_KEY || "smoke-support-ops-key-32chars!!";

const { normalizeTrPhone } = await import("../src/lib/auth.ts");
const {
  requireSupportOps,
  supportOpsConfigured,
  lookupSupportUser,
  rebindPhone,
} = await import("../src/lib/support-rebind.ts");

assert.equal(normalizeTrPhone("05551112233"), "+905551112233");
assert.equal(normalizeTrPhone("+90 555 999 8877"), "+905559998877");
assert.equal(supportOpsConfigured(), true);
assert.equal(
  requireSupportOps({ headers: { authorization: `Bearer ${process.env.SUPPORT_OPS_KEY}` } }),
  true,
);
assert.equal(requireSupportOps({ headers: { authorization: "Bearer wrong-key-xxxxxxxxxxxxxxx" } }), false);
assert.equal(requireSupportOps({ headers: {} }), false);
console.log("ok: normalize + support ops auth");

if (!process.argv.includes("--live")) {
  console.log("skip live DB (pass --live with DATABASE_URL)");
  process.exit(0);
}

const { initDb, closeDb } = await import("../src/lib/db.ts");
const db = await initDb();
const id = `smoke_${Date.now()}`;
const handle = `smoke_${id.slice(-6)}`;
const oldPhone = "+905551110001";
const newPhone = "+905551110002";
const createdAt = new Date().toISOString();

await db.query(
  `INSERT INTO users (id, handle, phone_e164, phone_verified, tribe_id, free_energy, paid_energy, sub_energy, created_at)
   VALUES ($1, $2, $3, TRUE, NULL, 42, 7, 1, $4)`,
  [id, handle, oldPhone, createdAt],
);

const looked = await lookupSupportUser(db, { phone: oldPhone });
assert.ok(looked);
assert.equal(looked.id, id);
assert.equal(looked.energy.total, 50);

const rebound = await rebindPhone(db, {
  userId: id,
  newPhone,
  reason: "lost_sim",
  actor: "smoke@test",
  ticketId: "SMOKE-1",
  syncSupabase: false,
});
assert.equal(rebound.ok, true);
if (rebound.ok) {
  assert.equal(rebound.oldPhoneE164, oldPhone);
  assert.equal(rebound.newPhoneE164, newPhone);
  assert.equal(rebound.progressPreserved, true);
  assert.equal(rebound.energy.total, 50);
}

const after = await lookupSupportUser(db, { userId: id });
assert.equal(after?.phoneE164, newPhone);
assert.equal(after?.energy.total, 50);

const audit = await db.query(`SELECT action, reason FROM support_audit_log WHERE id = $1`, [
  rebound.ok ? rebound.auditId : "",
]);
assert.equal(audit.rows[0]?.action, "phone_rebind");

await db.query(`DELETE FROM support_audit_log WHERE user_id = $1`, [id]);
await db.query(`DELETE FROM users WHERE id = $1`, [id]);
await closeDb();
console.log("ok: live rebind preserved energy + wrote audit");
