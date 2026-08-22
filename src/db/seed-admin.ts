import { createStatementRunner } from "./raw-client";

async function main() {
  const email = process.argv[2];
  if (!email) {
    console.error("Usage: npm run db:seed-admin -- your-email@domain.com");
    process.exit(1);
  }
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set");
  }

  const { run, close } = await createStatementRunner(process.env.DATABASE_URL);
  try {
    const result: any = await run(
      "UPDATE profiles SET role = 'admin' WHERE email = $1 RETURNING email, role",
      [email]
    );
    const rows = result?.rows ?? result ?? [];
    if (rows.length === 0) {
      console.error(`No profile found with email ${email}. Sign up first, then re-run this.`);
      process.exit(1);
    }
    console.log(`✅ Promoted ${rows[0].email} to ${rows[0].role}`);
  } finally {
    await close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
