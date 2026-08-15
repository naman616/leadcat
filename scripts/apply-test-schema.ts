// Applies prisma/test-bootstrap.sql followed by every migration in
// prisma/migrations, in order, against TEST_DATABASE_URL. For local/CI
// throwaway Postgres instances only — see the guard below.
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { Client } from "pg";

async function main() {
  const testUrl = process.env.TEST_DATABASE_URL;
  if (!testUrl) {
    throw new Error("TEST_DATABASE_URL is not set.");
  }
  if (testUrl === process.env.DATABASE_URL) {
    throw new Error(
      "TEST_DATABASE_URL must not equal DATABASE_URL — refusing to run test schema setup " +
        "against what looks like the real Supabase project.",
    );
  }

  const client = new Client({ connectionString: testUrl });
  await client.connect();

  try {
    const root = path.resolve(import.meta.dirname, "..");

    const bootstrapPath = path.join(root, "prisma", "test-bootstrap.sql");
    console.log(`Applying ${path.relative(root, bootstrapPath)}...`);
    await client.query(readFileSync(bootstrapPath, "utf8"));

    const migrationsDir = path.join(root, "prisma", "migrations");
    const migrationFolders = readdirSync(migrationsDir)
      .filter((name) => statSync(path.join(migrationsDir, name)).isDirectory())
      .sort();

    for (const folder of migrationFolders) {
      const migrationPath = path.join(migrationsDir, folder, "migration.sql");
      console.log(`Applying ${path.relative(root, migrationPath)}...`);
      await client.query(readFileSync(migrationPath, "utf8"));
    }

    console.log("Test schema applied.");
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
