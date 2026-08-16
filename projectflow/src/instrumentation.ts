export async function register() {
  if (process.env.NEXT_RUNTIME === "edge") return;
  const { assertRequiredEnv } = await import("@/lib/env");
  assertRequiredEnv();
  const { assertRlsRuntimeGuard } = await import("@/lib/rls");
  await assertRlsRuntimeGuard();
}
