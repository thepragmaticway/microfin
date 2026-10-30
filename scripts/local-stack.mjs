import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID, createHmac } from "node:crypto";
import { createServer } from "node:http";
import { readFile, readdir } from "node:fs/promises";
import pg from "pg";
import { testMailbox } from "./test-mailbox.mjs";
const exec = promisify(execFile);
const password = "microfin-disposable-test-only";
const secret = "microfin-disposable-test-signing-secret-at-least-32-characters";
export const uid1 = "11111111-1111-4111-8111-111111111111",
  uid2 = "22222222-2222-4222-8222-222222222222";
export async function unusedPort() {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}
const docker = async (...args) => {
  const result = await exec("docker", args, {
    timeout: 180000,
    maxBuffer: 1024 * 1024,
  });
  return (result.stdout + (args[0] === "logs" ? result.stderr : "")).trim();
};
async function retry(fn, label, timeout = 60000) {
  const start = Date.now();
  let last;
  while (Date.now() - start < timeout) {
    try {
      return await fn();
    } catch (error) {
      last = error;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  throw new Error(
    `${label} did not become ready: ${last?.message ?? "unknown"}`,
  );
}
export function jwt(role, sub) {
  const encode = (v) => Buffer.from(JSON.stringify(v)).toString("base64url");
  const h = encode({ alg: "HS256", typ: "JWT" }),
    p = encode({
      role,
      sub,
      iss: "supabase",
      aud: "authenticated",
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
  return `${h}.${p}.${createHmac("sha256", secret).update(`${h}.${p}`).digest("base64url")}`;
}
export async function migrate(client, { through } = {}) {
  for (const file of (await readdir("supabase/migrations"))
    .filter((f) => f.endsWith(".sql") && (!through || f <= through))
    .sort())
    await client.query(await readFile(`supabase/migrations/${file}`, "utf8"));
}
export async function localStack({ auth = false, migrationsThrough } = {}) {
  const prefix = `microfin-test-${randomUUID().slice(0, 8)}`,
    containers = [],
    port = await unusedPort();
  let db, gateway, next, mailbox;
  const appPort = await unusedPort();
  const stop = async () => {
    if (next) {
      next.kill();
      await new Promise((r) => setTimeout(r, 500));
    }
    if (gateway) await new Promise((resolve) => gateway.close(resolve));
    if (mailbox) await mailbox.stop();
    if (db) await db.end();
    for (const name of containers.reverse())
      await docker("rm", "-f", name).catch(() => {});
    await docker("network", "rm", prefix).catch(() => {});
  };
  try {
    await docker("network", "create", prefix);
    const pgName = `${prefix}-db`;
    await docker(
      "run",
      "-d",
      "--name",
      pgName,
      "--network",
      prefix,
      "-e",
      `POSTGRES_PASSWORD=${password}`,
      "-p",
      `127.0.0.1:${port}:5432`,
      "postgres:17.9-alpine",
    );
    containers.push(pgName);
    db = new pg.Client({
      host: "127.0.0.1",
      port,
      user: "postgres",
      password,
      database: "postgres",
    });
    await retry(async () => {
      const probe = new pg.Client({
        host: "127.0.0.1",
        port,
        user: "postgres",
        password,
        database: "postgres",
      });
      try {
        await probe.connect();
        await probe.query("select 1");
      } finally {
        await probe.end();
      }
    }, "PostgreSQL");
    await db.connect();
    await db.query(`create role anon nologin; create role authenticated nologin; create role authenticator login password '${password}' noinherit; grant anon,authenticated to authenticator;
      create role supabase_auth_admin login password '${password}' createrole; create schema auth authorization supabase_auth_admin;
      grant all on database postgres to supabase_auth_admin; grant usage on schema public to anon,authenticated; revoke create on schema public from public;
      create function auth.uid() returns uuid language sql stable as $$ select nullif(coalesce(current_setting('request.jwt.claim.sub',true),(current_setting('request.jwt.claims',true)::jsonb->>'sub')),'')::uuid $$;
      alter function auth.uid() owner to supabase_auth_admin;
      grant usage on schema auth to anon,authenticated; grant execute on function auth.uid() to anon,authenticated;`);
    let apiUrl, key;
    if (auth) {
      mailbox = await testMailbox();
      const authPort = await unusedPort(),
        restPort = await unusedPort(),
        gatewayPort = await unusedPort();
      apiUrl = `http://127.0.0.1:${gatewayPort}`;
      key = jwt("anon");
      const authName = `${prefix}-auth`;
      await docker(
        "run",
        "-d",
        "--name",
        authName,
        "--network",
        prefix,
        ...(process.platform === "linux"
          ? ["--add-host", "host.docker.internal:host-gateway"]
          : []),
        "-p",
        `127.0.0.1:${authPort}:9999`,
        "-e",
        "GOTRUE_API_HOST=0.0.0.0",
        "-e",
        "PORT=9999",
        "-e",
        "GOTRUE_API_PORT=9999",
        "-e",
        `API_EXTERNAL_URL=${apiUrl}/auth/v1`,
        "-e",
        `GOTRUE_SITE_URL=http://127.0.0.1:${appPort}`,
        "-e",
        `GOTRUE_URI_ALLOW_LIST=http://127.0.0.1:${appPort}/auth/confirm**`,
        "-e",
        "GOTRUE_SMTP_HOST=host.docker.internal",
        "-e",
        `GOTRUE_SMTP_PORT=${mailbox.port}`,
        "-e",
        "GOTRUE_SMTP_ADMIN_EMAIL=no-reply@example.test",
        "-e",
        "GOTRUE_SMTP_SENDER_NAME=Microfin test mailbox",
        "-e",
        "GOTRUE_MAILER_URLPATHS_RECOVERY=/auth/v1/verify",
        "-e",
        "GOTRUE_DB_DRIVER=postgres",
        "-e",
        `GOTRUE_DB_DATABASE_URL=postgres://supabase_auth_admin:${password}@${pgName}:5432/postgres?search_path=auth`,
        "-e",
        `GOTRUE_JWT_SECRET=${secret}`,
        "-e",
        "GOTRUE_JWT_AUD=authenticated",
        "-e",
        "GOTRUE_JWT_DEFAULT_GROUP_NAME=authenticated",
        "-e",
        "GOTRUE_JWT_EXP=3600",
        "-e",
        "GOTRUE_EXTERNAL_EMAIL_ENABLED=true",
        "-e",
        "GOTRUE_MAILER_AUTOCONFIRM=true",
        "-e",
        "GOTRUE_LOG_LEVEL=error",
        "supabase/gotrue:v2.184.0",
      );
      containers.push(authName);
      await retry(async () => {
        const running = await docker(
          "inspect",
          "--format",
          "{{.State.Running}}",
          authName,
        );
        if (running !== "true") throw new Error(await docker("logs", authName));
        const response = await fetch(`http://127.0.0.1:${authPort}/health`);
        if (!response.ok) throw new Error(`Auth ${response.status}`);
      }, "GoTrue Auth");
      await db.query(
        `create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(coalesce(current_setting('request.jwt.claim.sub',true),(current_setting('request.jwt.claims',true)::jsonb->>'sub')),'')::uuid $$`,
      );
      await migrate(db, {through: migrationsThrough});
      const restName = `${prefix}-rest`;
      await docker(
        "run",
        "-d",
        "--name",
        restName,
        "--network",
        prefix,
        "-p",
        `127.0.0.1:${restPort}:3000`,
        "-e",
        `PGRST_DB_URI=postgres://authenticator:${password}@${pgName}:5432/postgres`,
        "-e",
        "PGRST_DB_SCHEMAS=public",
        "-e",
        "PGRST_DB_ANON_ROLE=anon",
        "-e",
        `PGRST_JWT_SECRET=${secret}`,
        "postgrest/postgrest:v13.0.7",
      );
      containers.push(restName);
      gateway = createServer(async (req, res) => {
        try {
          const isAuth = req.url.startsWith("/auth/v1"),
            target = `http://127.0.0.1:${isAuth ? authPort : restPort}${req.url.replace(isAuth ? "/auth/v1" : "/rest/v1", "") || "/"}`;
          const chunks = [];
          for await (const chunk of req) chunks.push(chunk);
          const bytes = Buffer.concat(chunks);
          const response = await fetch(target, {
            method: req.method,
            headers: Object.fromEntries(
              Object.entries(req.headers).filter(
                ([name]) =>
                  !["host", "connection", "content-length"].includes(name),
              ),
            ),
            body: ["GET", "HEAD"].includes(req.method) ? undefined : bytes,
            redirect: "manual",
          });
          res.writeHead(
            response.status,
            Object.fromEntries(
              [...response.headers].filter(
                ([name]) =>
                  ![
                    "content-encoding",
                    "content-length",
                    "transfer-encoding",
                  ].includes(name),
              ),
            ),
          );
          res.end(Buffer.from(await response.arrayBuffer()));
        } catch {
          res.writeHead(502);
          res.end("Test gateway unavailable");
        }
      });
      await new Promise((resolve) =>
        gateway.listen(gatewayPort, "127.0.0.1", resolve),
      );
      await retry(async () => {
        const response = await fetch(`${apiUrl}/rest/v1/`, {
          headers: { apikey: key },
        });
        if (!response.ok) throw new Error(`REST ${response.status}`);
      }, "PostgREST");
    } else {
      await db.query("create table auth.users(id uuid primary key)");
      await db.query("insert into auth.users values ($1),($2)", [uid1, uid2]);
      await migrate(db, {through: migrationsThrough});
    }
    async function startApp() {
      const appUrl = `http://127.0.0.1:${appPort}`;
      const logs = [];
      next = spawn(
        process.execPath,
        [
          "node_modules/next/dist/bin/next",
          "dev",
          "--port",
          String(appPort),
          "--hostname",
          "127.0.0.1",
        ],
        {
          env: {
            ...process.env,
            SUPABASE_PROJ_URL: apiUrl,
            SUPABASE_PUB_KEY: key,
            NEXT_TELEMETRY_DISABLED: "1",
          },
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      next.stdout.on("data", (x) => logs.push(x.toString()));
      next.stderr.on("data", (x) => logs.push(x.toString()));
      await retry(
        async () => {
          if (next.exitCode !== null)
            throw new Error(
              `Next exited ${next.exitCode}: ${logs.join("").slice(-3000)}`,
            );
          const response = await fetch(`${appUrl}/login`);
          if (!response.ok)
            throw new Error(
              `App ${response.status}: ${logs.join("").slice(-1000)}`,
            );
        },
        "Next.js",
        90000,
      );
      return appUrl;
    }
    return { db, apiUrl, key, port, stop, startApp, mailbox };
  } catch (error) {
    await stop();
    throw error;
  }
}
export async function asUser(db, id, fn) {
  await db.query("begin");
  try {
    await db.query("set local role authenticated");
    await db.query("select set_config('request.jwt.claim.sub',$1,true)", [id]);
    const result = await fn(db);
    await db.query("commit");
    return result;
  } catch (error) {
    await db.query("rollback");
    throw error;
  }
}
