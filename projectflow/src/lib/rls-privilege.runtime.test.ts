/**
 * Live Postgres: superuser connections must not serve tenant-scoped reads.
 * Requires DATABASE_URL (docker compose). Fails closed if unset — do not skip.
 */
import { describe, expect, it } from "vitest";
import { Pool } from "pg";
import {
  decoratePoolWithRls,
  evaluateRlsPrivilegeGuard,
  RLS_APP_ROLE,
  RLS_PRIVILEGE_SQL,
  RlsPrivilegeError,
  runWithRlsContext,
} from "@/lib/rls";

describe("RLS superuser connection path (live Postgres)", () => {
  it("detects a superuser/table-owner login and rejects it; decorated pool switches to syzx_app", async () => {
    const databaseUrl = process.env.DATABASE_URL?.trim();
    if (!databaseUrl) {
      throw new Error(
        "DATABASE_URL is required for the RLS privilege regression test. Start docker compose and retry."
      );
    }

    const raw = new Pool({
      connectionString: databaseUrl,
      connectionTimeoutMillis: 8000,
    });

    try {
      const login = await raw.query(RLS_PRIVILEGE_SQL);
      const loginRow = login.rows[0] as {
        role: string;
        isSuperuser: string;
        bypassRls: boolean | string;
        tableOwner: string | null;
      };

      // Docker POSTGRES_USER is a superuser (and typically owns public.Project).
      // Serving tenant queries on this session would silently bypass FORCE RLS.
      expect(() => evaluateRlsPrivilegeGuard(loginRow)).toThrow(
        RlsPrivilegeError
      );

      const unscoped = await raw.query(`SELECT count(*)::int AS n FROM "Project"`);
      expect(typeof unscoped.rows[0].n).toBe("number");

      const appPool = decoratePoolWithRls(
        new Pool({
          connectionString: databaseUrl,
          max: 1,
          connectionTimeoutMillis: 8000,
        })
      );
      try {
        await runWithRlsContext(
          { organizationId: "rls-guard-no-such-org" },
          async () => {
            const client = await appPool.connect();
            try {
              const after = await client.query(RLS_PRIVILEGE_SQL);
              const row = after.rows[0] as typeof loginRow;
              expect(row.role).toBe(RLS_APP_ROLE);
              expect(row.isSuperuser).toBe("off");
              evaluateRlsPrivilegeGuard(row);

              const scoped = await client.query(`SELECT id FROM "Project"`);
              expect(scoped.rows).toEqual([]);
            } finally {
              client.release();
            }
          }
        );
      } finally {
        await appPool.end();
      }
    } finally {
      await raw.end();
    }
  });
});
