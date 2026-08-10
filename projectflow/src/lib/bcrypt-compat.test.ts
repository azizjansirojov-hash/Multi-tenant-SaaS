import { describe, expect, it } from "vitest";
import bcryptjs from "bcryptjs";
import bcrypt from "bcrypt";

describe("bcrypt / bcryptjs compatibility", () => {
  it("verifies a bcryptjs hash with bcrypt.compare (round-trip)", async () => {
    const password = "CompatTestPassword!23";
    const hash = await bcryptjs.hash(password, 12);
    const ok = await bcrypt.compare(password, hash);
    expect(ok).toBe(true);
  });

  it("rejects wrong password against bcryptjs hash via bcrypt.compare", async () => {
    const hash = await bcryptjs.hash("right-password", 10);
    const ok = await bcrypt.compare("wrong-password", hash);
    expect(ok).toBe(false);
  });
});
