import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EventEmitter } from "events";
import {
  REALTIME_LISTEN_POOL_SIZE,
  SseCapacityError,
  assertSseCapacityAvailable,
  closeRealtimePublishPool,
  configureRealtimeHub,
  getMaxSseConnections,
  getMaxSseConnectionsPerOrg,
  getRealtimeListenConnectionCount,
  getRealtimeListenConnectSuccesses,
  getRealtimeSubscriberCount,
  publishRealtime,
  realtimeChannelForOrg,
  resetRealtimeHub,
  shouldDeliverRealtimeEvent,
  subscribeRealtime,
  type RealtimeEvent,
} from "@/lib/realtime-bus";

describe("realtime filtering (unit)", () => {
  it("drops events for a different organizationId", () => {
    const event: RealtimeEvent = {
      type: "card.created",
      organizationId: "org-a",
      boardId: "b1",
      at: new Date().toISOString(),
    };
    expect(
      shouldDeliverRealtimeEvent(event, { organizationId: "org-b" })
    ).toBe(false);
  });

  it("drops events for a different boardId when filter is board-scoped", () => {
    const event: RealtimeEvent = {
      type: "card.moved",
      organizationId: "org-a",
      boardId: "board-1",
      at: new Date().toISOString(),
    };
    expect(
      shouldDeliverRealtimeEvent(event, {
        organizationId: "org-a",
        boardId: "board-2",
      })
    ).toBe(false);
  });

  it("delivers matching org/board events", () => {
    const event: RealtimeEvent = {
      type: "comment.created",
      organizationId: "org-a",
      boardId: "board-1",
      at: new Date().toISOString(),
    };
    expect(
      shouldDeliverRealtimeEvent(event, {
        organizationId: "org-a",
        boardId: "board-1",
      })
    ).toBe(true);
  });

  it("builds stable per-org channel names", () => {
    expect(realtimeChannelForOrg("clxyz123")).toBe("syzx_org_clxyz123");
    expect(realtimeChannelForOrg("bad-id!")).toBe("syzx_org_badid");
  });
});

/** Minimal mock pg.Client that supports LISTEN + notification fan-in. */
class MockListenClient extends EventEmitter {
  connected = false;
  ended = false;
  listened = new Set<string>();
  queries: string[] = [];

  async connect() {
    this.connected = true;
  }

  async query(sql: string) {
    this.queries.push(sql);
    const listen = /^LISTEN\s+(\w+)$/i.exec(sql);
    if (listen) this.listened.add(listen[1]);
    const unlisten = /^UNLISTEN\s+(\w+)$/i.exec(sql);
    if (unlisten) this.listened.delete(unlisten[1]);
    return { rows: [] };
  }

  async end() {
    this.ended = true;
    this.connected = false;
    this.emit("end");
  }

  /** Simulate a NOTIFY arriving on this connection. */
  notify(channel: string, payload: string) {
    this.emit("notification", { channel, payload });
  }
}

describe("shared LISTEN hub + SSE caps", () => {
  const prevMax = process.env.MAX_SSE_CONNECTIONS;
  const prevPerOrg = process.env.MAX_SSE_CONNECTIONS_PER_ORG;
  const prevDb = process.env.DATABASE_URL;

  beforeEach(async () => {
    await resetRealtimeHub();
    process.env.MAX_SSE_CONNECTIONS = "5";
    process.env.MAX_SSE_CONNECTIONS_PER_ORG = "2";
    // Force hub into "has DB" path with injected mock clients
    process.env.DATABASE_URL =
      prevDb || "postgresql://mock:mock@localhost:5432/mock";
  });

  afterEach(async () => {
    await resetRealtimeHub();
    if (prevMax === undefined) delete process.env.MAX_SSE_CONNECTIONS;
    else process.env.MAX_SSE_CONNECTIONS = prevMax;
    if (prevPerOrg === undefined) delete process.env.MAX_SSE_CONNECTIONS_PER_ORG;
    else process.env.MAX_SSE_CONNECTIONS_PER_ORG = prevPerOrg;
    if (prevDb === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = prevDb;
  });

  it("reads cap env vars", () => {
    expect(getMaxSseConnections()).toBe(5);
    expect(getMaxSseConnectionsPerOrg()).toBe(2);
  });

  it("rejects when per-org or global SSE caps are hit", () => {
    configureRealtimeHub({
      createClient: () =>
        new MockListenClient() as unknown as import("pg").Client,
      initialBackoffMs: 10,
    });

    const unsubs: Array<() => void> = [];
    unsubs.push(
      subscribeRealtime({
        organizationId: "org-cap",
        onEvent: () => undefined,
      })
    );
    unsubs.push(
      subscribeRealtime({
        organizationId: "org-cap",
        onEvent: () => undefined,
      })
    );
    expect(() =>
      subscribeRealtime({
        organizationId: "org-cap",
        onEvent: () => undefined,
      })
    ).toThrow(SseCapacityError);

    // Fill remaining global slots with other orgs
    unsubs.push(
      subscribeRealtime({ organizationId: "org-2", onEvent: () => undefined })
    );
    unsubs.push(
      subscribeRealtime({ organizationId: "org-3", onEvent: () => undefined })
    );
    unsubs.push(
      subscribeRealtime({ organizationId: "org-4", onEvent: () => undefined })
    );
    expect(() =>
      assertSseCapacityAvailable("org-5")
    ).toThrow(SseCapacityError);

    for (const u of unsubs) u();
  });

  it("load: N subscribers share a fixed LISTEN pool and only receive own org/board events", async () => {
    const clients: MockListenClient[] = [];
    configureRealtimeHub({
      createClient: () => {
        const c = new MockListenClient();
        clients.push(c);
        return c as unknown as import("pg").Client;
      },
      initialBackoffMs: 10,
    });

    const N = 40;
    const received: Record<string, RealtimeEvent[]> = {
      "org-a|board-1": [],
      "org-a|board-2": [],
      "org-b|board-1": [],
    };

    process.env.MAX_SSE_CONNECTIONS = "100";
    process.env.MAX_SSE_CONNECTIONS_PER_ORG = "50";

    const unsubs: Array<() => void> = [];
    for (let i = 0; i < N; i++) {
      const orgId = i % 3 === 2 ? "org-b" : "org-a";
      const boardId = i % 2 === 0 ? "board-1" : "board-2";
      const key = `${orgId}|${boardId}`;
      if (!received[key]) received[key] = [];
      unsubs.push(
        subscribeRealtime({
          organizationId: orgId,
          boardId,
          onEvent: (e) => received[key].push(e),
        })
      );
    }

    // Allow shared connect + LISTEN to settle
    await new Promise((r) => setTimeout(r, 80));

    expect(clients.length).toBe(REALTIME_LISTEN_POOL_SIZE);
    expect(getRealtimeListenConnectionCount()).toBe(REALTIME_LISTEN_POOL_SIZE);
    expect(getRealtimeSubscriberCount()).toBe(N);
    expect(getRealtimeListenConnectSuccesses()).toBe(1);

    const live = clients[0]!;
    expect(live.listened.has(realtimeChannelForOrg("org-a"))).toBe(true);
    expect(live.listened.has(realtimeChannelForOrg("org-b"))).toBe(true);

    const eventA1: RealtimeEvent = {
      type: "card.created",
      organizationId: "org-a",
      boardId: "board-1",
      at: new Date().toISOString(),
      payload: { cardId: "c-a1" },
    };
    live.notify(
      realtimeChannelForOrg("org-a"),
      JSON.stringify(eventA1)
    );

    const eventB: RealtimeEvent = {
      type: "card.updated",
      organizationId: "org-b",
      boardId: "board-1",
      at: new Date().toISOString(),
    };
    live.notify(realtimeChannelForOrg("org-b"), JSON.stringify(eventB));

    await new Promise((r) => setTimeout(r, 20));

    // org-a board-1 subscribers only got A1; board-2 never got card.created; org-b never got org-a
    expect(received["org-a|board-1"].length).toBeGreaterThan(0);
    expect(
      received["org-a|board-1"].every(
        (e) => e.organizationId === "org-a" && e.boardId === "board-1"
      )
    ).toBe(true);
    expect(
      received["org-a|board-2"].filter((e) => e.type === "card.created")
    ).toHaveLength(0);
    expect(
      received["org-b|board-1"].some((e) => e.organizationId === "org-a")
    ).toBe(false);
    expect(
      received["org-b|board-1"].some((e) => e.organizationId === "org-b")
    ).toBe(true);

    // Connection count stayed fixed regardless of N
    expect(getRealtimeListenConnectionCount()).toBe(REALTIME_LISTEN_POOL_SIZE);
    expect(clients.length).toBe(REALTIME_LISTEN_POOL_SIZE);

    for (const u of unsubs) u();
    await new Promise((r) => setTimeout(r, 20));
    expect(getRealtimeListenConnectionCount()).toBe(0);
  });

  it("reconnect re-attaches LISTEN and re-fans-out without clearing subscribers", async () => {
    const clients: MockListenClient[] = [];
    configureRealtimeHub({
      createClient: () => {
        const c = new MockListenClient();
        clients.push(c);
        return c as unknown as import("pg").Client;
      },
      initialBackoffMs: 20,
    });

    process.env.MAX_SSE_CONNECTIONS = "10";
    process.env.MAX_SSE_CONNECTIONS_PER_ORG = "10";

    const received: RealtimeEvent[] = [];
    const unsub = subscribeRealtime({
      organizationId: "org-re",
      boardId: "b1",
      onEvent: (e) => received.push(e),
    });

    await new Promise((r) => setTimeout(r, 50));
    expect(clients.length).toBe(1);
    const first = clients[0]!;

    // Drop shared connection
    await first.end();
    await new Promise((r) => setTimeout(r, 80));

    expect(clients.length).toBe(2);
    expect(getRealtimeSubscriberCount()).toBe(1);
    expect(getRealtimeListenConnectionCount()).toBe(1);

    const second = clients[1]!;
    second.notify(
      realtimeChannelForOrg("org-re"),
      JSON.stringify({
        type: "board.updated",
        organizationId: "org-re",
        boardId: "b1",
        at: new Date().toISOString(),
      })
    );

    await new Promise((r) => setTimeout(r, 20));
    expect(received.length).toBeGreaterThanOrEqual(1);
    expect(received[0]?.type).toBe("board.updated");

    unsub();
  });
});

describe("realtime LISTEN/NOTIFY cross-instance (integration)", () => {
  const hasDb = Boolean(process.env.DATABASE_URL);

  afterEach(async () => {
    await resetRealtimeHub();
  });

  afterEach(async () => {
    await closeRealtimePublishPool();
  });

  it.skipIf(!hasDb)(
    "shared hub delivers published org event to multiple in-process subscribers",
    async (ctx) => {
      await resetRealtimeHub();
      configureRealtimeHub({ initialBackoffMs: 50 });

      const orgId = `rt_test_${Date.now()}`;
      const receivedA: RealtimeEvent[] = [];
      const receivedB: RealtimeEvent[] = [];

      const unsubA = subscribeRealtime({
        organizationId: orgId,
        onEvent: (e) => receivedA.push(e),
      });
      const unsubB = subscribeRealtime({
        organizationId: orgId,
        onEvent: (e) => receivedB.push(e),
      });

      await new Promise((r) => setTimeout(r, 500));
      if (getRealtimeListenConnectionCount() === 0) {
        ctx.skip();
        return;
      }
      expect(getRealtimeListenConnectionCount()).toBe(REALTIME_LISTEN_POOL_SIZE);

      await publishRealtime({
        type: "card.created",
        organizationId: orgId,
        boardId: "board-x",
        payload: { cardId: "c1" },
      });

      const deadline = Date.now() + 5000;
      while (
        Date.now() < deadline &&
        (receivedA.length === 0 || receivedB.length === 0)
      ) {
        await new Promise((r) => setTimeout(r, 50));
      }

      unsubA();
      unsubB();

      expect(receivedA.length).toBeGreaterThanOrEqual(1);
      expect(receivedB.length).toBeGreaterThanOrEqual(1);
      expect(receivedA[0]?.organizationId).toBe(orgId);
    },
    15_000
  );

  it.skipIf(!hasDb)(
    "subscriber for org-B never receives org-A events (cross-tenant leakage)",
    async (ctx) => {
      await resetRealtimeHub();
      configureRealtimeHub({ initialBackoffMs: 50 });

      const orgA = `rt_a_${Date.now()}`;
      const orgB = `rt_b_${Date.now()}`;
      const leaked: RealtimeEvent[] = [];
      const ok: RealtimeEvent[] = [];

      const unsubB = subscribeRealtime({
        organizationId: orgB,
        onEvent: (e) => leaked.push(e),
      });
      const unsubA = subscribeRealtime({
        organizationId: orgA,
        onEvent: (e) => ok.push(e),
      });

      await new Promise((r) => setTimeout(r, 500));
      if (getRealtimeListenConnectionCount() === 0) {
        ctx.skip();
        return;
      }

      await publishRealtime({
        type: "card.updated",
        organizationId: orgA,
        boardId: "b1",
      });

      const deadline = Date.now() + 4000;
      while (Date.now() < deadline && ok.length === 0) {
        await new Promise((r) => setTimeout(r, 50));
      }
      await new Promise((r) => setTimeout(r, 300));

      unsubA();
      unsubB();

      expect(ok.length).toBeGreaterThanOrEqual(1);
      expect(leaked.length).toBe(0);
    },
    15_000
  );
});
