import { readFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import pg from "pg";
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });
if (!process.env.SUPABASE_CONNECTION_STRING)
  throw new Error("SUPABASE_CONNECTION_STRING is required for migrations");
const connection = new URL(process.env.SUPABASE_CONNECTION_STRING);
for (const key of ["sslmode", "sslcert", "sslkey", "sslrootcert"])
  connection.searchParams.delete(key);
const ca = process.env.SUPABASE_CA_CERT_PATH
  ? await readFile(process.env.SUPABASE_CA_CERT_PATH, "utf8")
  : undefined;
const client = new pg.Client({
  connectionString: connection.toString(),
  ssl: { rejectUnauthorized: true, ...(ca ? { ca } : {}) },
});
try {
  await client.connect();
  await client.query("begin");
  await client.query("select pg_advisory_xact_lock(731280021)");
  await client.query(
    "create schema if not exists microfin_migrations; create table if not exists microfin_migrations.applied(version text primary key,sha256 text not null,applied_at timestamptz not null default now())",
  );
  for (const version of (await readdir("supabase/migrations"))
    .filter((v) => v.endsWith(".sql"))
    .sort()) {
    const sql = await readFile(`supabase/migrations/${version}`, "utf8"),
      hash = createHash("sha256").update(sql).digest("hex");
    const { rows } = await client.query(
      "select sha256 from microfin_migrations.applied where version=$1",
      [version],
    );
    if (rows.length) {
      if (rows[0].sha256 !== hash)
        throw new Error(`Applied migration checksum changed: ${version}`);
      continue;
    }
    await client.query(sql);
    await client.query(
      "insert into microfin_migrations.applied(version,sha256) values($1,$2)",
      [version, hash],
    );
    console.log(`Applied ${version}`);
  }
  await client.query("commit");
} catch {
  await client.query("rollback").catch(() => {});
  console.error(
    "Migration failed. No pending changes committed. Check connection access and migration diagnostics privately.",
  );
  process.exitCode = 1;
} finally {
  await client.end();
}
