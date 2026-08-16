import "dotenv/config";
import pg from "pg";
const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
await c.connect();
const r = await c.query('DELETE FROM "RateLimitBucket"');
console.log("deleted", r.rowCount);
await c.end();
