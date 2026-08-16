/**
 * Cross-instance realtime via PostgreSQL LISTEN/NOTIFY.
 *
 * Why Postgres (not Redis/Upstash yet):
 * - Same datastore already used for rate limiting — no new infra for MVP scale
 * - NOTIFY payload (~8KB max) is enough for our small event envelopes
 *
 * Connection model (remediation pass 2):
 * - ONE shared LISTEN client per Node process (optionally documented as 1–2 budget)
 * - SSE subscribers register in-process; the hub fans out after org/board filters
 * - Publish still uses a small Pool (NOT a LISTEN per client)
 * - Caps: MAX_SSE_CONNECTIONS + MAX_SSE_CONNECTIONS_PER_ORG reject with a safe error
 *
 * Scaling notes:
 * - Acceptable while concurrent SSE connections stay within caps and event rates
 *   are human-driven Kanban mutations
 * - Next step if load grows: Redis/Upstash or Ably/Pusher — Postgres NOTIFY is not
 *   a durable queue and does not buffer for offline clients
 *
 * Reconnect: the shared LISTEN client reconnects with exponential backoff and
 * re-issues LISTEN for every org channel that still has local subscribers.
 * The subscriber registry is not cleared on reconnect (avoids awkward drops);
 * NOTIFY is not replayed so duplicates of past events do not appear.
 */

import { Client, Pool } from "pg";

export type RealtimeEventType =
  | "card.created"
  | "card.updated"
  | "card.deleted"
  | "card.moved"
  | "comment.created"
  | "notification.created"
  | "attachment.created"
  | "board.updated";

export type RealtimeEvent = {
  type: RealtimeEventType;
  organizationId: string;
  boardId?: string;
  payload?: Record<string, unknown>;
  at: string;
};

export type RealtimeSubscriptionFilter = {
  organizationId: string;
  boardId?: string;
};

/** Shared fallback channel (tests / malformed org ids). Prefer per-org channel. */
export const REALTIME_FALLBACK_CHANNEL = "syzx_realtime";

/** Fixed size of the dedicated LISTEN pool per process (not per SSE client). */
export const REALTIME_LISTEN_POOL_SIZE = 1;

/** Shared fallback channel name used only when org id sanitizes empty. */
export function realtimeChannelForOrg(organizationId: string): string {
  const safe = organizationId.replace(/[^a-zA-Z0-9_]/g, "");
  if (!safe) return REALTIME_FALLBACK_CHANNEL;
  return `syzx_org_${safe}`;
}

/**
 * Server-side delivery gate — never rely on the browser to drop foreign events.
 */
export function shouldDeliverRealtimeEvent(
  event: RealtimeEvent,
  filter: RealtimeSubscriptionFilter
): boolean {
  if (event.organizationId !== filter.organizationId) return false;
  if (filter.boardId && event.boardId && event.boardId !== filter.boardId) {
    return false;
  }
  return true;
}

function parseEventPayload(raw: string): RealtimeEvent | null {
  try {
    const parsed = JSON.parse(raw) as RealtimeEvent;
    if (
      !parsed ||
      typeof parsed !== "object" ||
      typeof parsed.type !== "string" ||
      typeof parsed.organizationId !== "string"
    ) {
      return null;
    }
    return {
      ...parsed,
      at: typeof parsed.at === "string" ? parsed.at : new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function getMaxSseConnections(): number {
  return envInt("MAX_SSE_CONNECTIONS", 200);
}

export function getMaxSseConnectionsPerOrg(): number {
  return envInt("MAX_SSE_CONNECTIONS_PER_ORG", 40);
}

export class SseCapacityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SseCapacityError";
  }
}

type HubSubscriber = {
  id: string;
  organizationId: string;
  boardId?: string;
  onEvent: (event: RealtimeEvent) => void;
};

type HubState = {
  subscribers: Map<string, HubSubscriber>;
  orgCounts: Map<string, number>;
  listenClient: Client | null;
  listenedChannels: Set<string>;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  attempt: number;
  connecting: boolean;
  createClient: () => Client;
  initialBackoffMs: number;
  /** How many live LISTEN clients this process currently holds (0 or 1). */
  listenConnectionCount: number;
  /** Cumulative connect() successes — used by load tests. */
  listenConnectSuccesses: number;
};

const globalHub = globalThis as unknown as { __syzxRealtimeHub?: HubState };

function defaultCreateClient(): Client {
  return new Client({ connectionString: process.env.DATABASE_URL });
}

function getHub(): HubState {
  if (!globalHub.__syzxRealtimeHub) {
    globalHub.__syzxRealtimeHub = {
      subscribers: new Map(),
      orgCounts: new Map(),
      listenClient: null,
      listenedChannels: new Set(),
      reconnectTimer: null,
      attempt: 0,
      connecting: false,
      createClient: defaultCreateClient,
      initialBackoffMs: 500,
      listenConnectionCount: 0,
      listenConnectSuccesses: 0,
    };
  }
  return globalHub.__syzxRealtimeHub;
}

/** Test / ops helper — how many LISTEN clients are open right now. */
export function getRealtimeListenConnectionCount(): number {
  return getHub().listenConnectionCount;
}

/** Test helper — successful LISTEN connect attempts (including reconnects). */
export function getRealtimeListenConnectSuccesses(): number {
  return getHub().listenConnectSuccesses;
}

/** Test helper — active in-process SSE/subscriber slots. */
export function getRealtimeSubscriberCount(): number {
  return getHub().subscribers.size;
}

/**
 * Configure hub internals for tests (inject Client factory / backoff).
 * Call `resetRealtimeHub()` between suites when needed.
 */
export function configureRealtimeHub(opts: {
  createClient?: () => Client;
  initialBackoffMs?: number;
}): void {
  const hub = getHub();
  if (opts.createClient) hub.createClient = opts.createClient;
  if (opts.initialBackoffMs != null) {
    hub.initialBackoffMs = opts.initialBackoffMs;
  }
}

/** Tear down hub state (tests). Does not end the publish pool. */
export async function resetRealtimeHub(): Promise<void> {
  const hub = getHub();
  if (hub.reconnectTimer) clearTimeout(hub.reconnectTimer);
  hub.reconnectTimer = null;
  hub.subscribers.clear();
  hub.orgCounts.clear();
  hub.listenedChannels.clear();
  hub.attempt = 0;
  hub.connecting = false;
  hub.createClient = defaultCreateClient;
  hub.initialBackoffMs = 500;
  await cleanupListenClient(hub);
  hub.listenConnectSuccesses = 0;
}

async function cleanupListenClient(hub: HubState): Promise<void> {
  const client = hub.listenClient;
  hub.listenClient = null;
  hub.listenConnectionCount = 0;
  if (!client) return;
  try {
    client.removeAllListeners("notification");
    client.removeAllListeners("error");
    client.removeAllListeners("end");
    await client.end();
  } catch {
    /* ignore */
  }
}

function channelsNeeded(hub: HubState): Set<string> {
  const channels = new Set<string>();
  for (const sub of hub.subscribers.values()) {
    channels.add(realtimeChannelForOrg(sub.organizationId));
  }
  return channels;
}

function fanOut(hub: HubState, event: RealtimeEvent): void {
  for (const sub of hub.subscribers.values()) {
    if (
      !shouldDeliverRealtimeEvent(event, {
        organizationId: sub.organizationId,
        boardId: sub.boardId,
      })
    ) {
      continue;
    }
    try {
      sub.onEvent(event);
    } catch {
      /* never break the fan-out loop */
    }
  }
}

function handleNotification(hub: HubState, msg: { channel?: string; payload?: string }) {
  const event = parseEventPayload(msg.payload ?? "");
  if (!event) return;
  const expected = realtimeChannelForOrg(event.organizationId);
  if (msg.channel && msg.channel !== expected && msg.channel !== REALTIME_FALLBACK_CHANNEL) {
    // Drop notifies that arrive on an unexpected channel name
    return;
  }
  fanOut(hub, event);
}

async function ensureListenChannels(hub: HubState): Promise<void> {
  const client = hub.listenClient;
  if (!client) return;
  const needed = channelsNeeded(hub);

  for (const ch of hub.listenedChannels) {
    if (!needed.has(ch)) {
      try {
        await client.query(`UNLISTEN ${ch}`);
      } catch {
        /* ignore */
      }
      hub.listenedChannels.delete(ch);
    }
  }

  for (const ch of needed) {
    if (!hub.listenedChannels.has(ch)) {
      try {
        await client.query(`LISTEN ${ch}`);
        hub.listenedChannels.add(ch);
      } catch (err) {
        console.error("[realtime] LISTEN failed", ch, err);
      }
    }
  }
}

function scheduleReconnect(hub: HubState): void {
  if (hub.reconnectTimer || hub.subscribers.size === 0) return;
  const delay = Math.min(30_000, hub.initialBackoffMs * 2 ** hub.attempt);
  hub.attempt += 1;
  hub.reconnectTimer = setTimeout(() => {
    hub.reconnectTimer = null;
    void connectSharedListen(hub);
  }, delay);
}

async function connectSharedListen(hub: HubState): Promise<void> {
  if (hub.connecting) return;
  if (hub.subscribers.size === 0) return;
  if (!process.env.DATABASE_URL && hub.createClient === defaultCreateClient) {
    // Local / unit mode without DB — in-process publish fan-out only
    return;
  }

  hub.connecting = true;
  await cleanupListenClient(hub);
  hub.listenedChannels.clear();

  const next = hub.createClient();
  try {
    await next.connect();
    hub.listenClient = next;
    hub.listenConnectionCount = 1;
    hub.listenConnectSuccesses += 1;
    hub.attempt = 0;

    next.on("notification", (msg) => {
      handleNotification(hub, msg);
    });

    const onDrop = () => {
      if (hub.listenClient !== next) return;
      hub.listenClient = null;
      hub.listenConnectionCount = 0;
      hub.listenedChannels.clear();
      scheduleReconnect(hub);
    };
    next.on("error", onDrop);
    next.on("end", onDrop);

    await ensureListenChannels(hub);
  } catch (err) {
    console.error("[realtime] shared LISTEN connect failed", err);
    try {
      await next.end();
    } catch {
      /* ignore */
    }
    hub.listenClient = null;
    hub.listenConnectionCount = 0;
    scheduleReconnect(hub);
  } finally {
    hub.connecting = false;
  }
}

function assertCapacity(organizationId: string): void {
  const hub = getHub();
  const maxTotal = getMaxSseConnections();
  const maxPerOrg = getMaxSseConnectionsPerOrg();
  if (hub.subscribers.size >= maxTotal) {
    throw new SseCapacityError(
      "Realtime connection limit reached. Refresh the board to stay up to date."
    );
  }
  const orgCount = hub.orgCounts.get(organizationId) ?? 0;
  if (orgCount >= maxPerOrg) {
    throw new SseCapacityError(
      "Realtime connection limit reached for this organization. Refresh the board to stay up to date."
    );
  }
}

/** Pre-flight for SSE routes — same caps as subscribeRealtime. */
export function assertSseCapacityAvailable(organizationId: string): void {
  assertCapacity(organizationId);
}

let publishPool: Pool | null = null;

function getPublishPool(): Pool | null {
  const url = process.env.DATABASE_URL;
  if (!url) return null;
  if (!publishPool) {
    publishPool = new Pool({ connectionString: url, max: 4 });
  }
  return publishPool;
}

/**
 * Publish an event to all instances listening on the org channel.
 * Payload always includes organizationId (and boardId when set).
 */
export async function publishRealtime(
  event: Omit<RealtimeEvent, "at"> & { at?: string }
): Promise<void> {
  if (!event.organizationId) {
    console.error("[realtime] refused publish without organizationId");
    return;
  }

  const full: RealtimeEvent = {
    ...event,
    at: event.at ?? new Date().toISOString(),
  };

  const channel = realtimeChannelForOrg(full.organizationId);
  const payload = JSON.stringify(full);
  if (payload.length > 7900) {
    console.error("[realtime] payload too large for NOTIFY; dropping");
    return;
  }

  const pool = getPublishPool();
  if (!pool) {
    // No DB — fan out in-process only (unit tests / local without DATABASE_URL)
    fanOut(getHub(), full);
    return;
  }

  try {
    await pool.query("SELECT pg_notify($1, $2)", [channel, payload]);
  } catch (err) {
    console.error("[realtime] pg_notify failed", err);
  }
}

export type SubscribeRealtimeOptions = RealtimeSubscriptionFilter & {
  onEvent: (event: RealtimeEvent) => void;
};

/**
 * Attach an in-process subscriber to the shared LISTEN hub.
 * Throws {@link SseCapacityError} when instance or per-org caps are hit.
 * Returns an unsubscribe function.
 */
export function subscribeRealtime(
  options: SubscribeRealtimeOptions
): () => void {
  const { organizationId, boardId, onEvent } = options;
  assertCapacity(organizationId);

  const hub = getHub();
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const sub: HubSubscriber = { id, organizationId, boardId, onEvent };
  hub.subscribers.set(id, sub);
  hub.orgCounts.set(organizationId, (hub.orgCounts.get(organizationId) ?? 0) + 1);

  const useLocalOnly =
    !process.env.DATABASE_URL && hub.createClient === defaultCreateClient;

  if (!useLocalOnly) {
    if (!hub.listenClient && !hub.connecting) {
      void connectSharedListen(hub);
    } else if (hub.listenClient) {
      void ensureListenChannels(hub);
    }
  }

  let stopped = false;
  return () => {
    if (stopped) return;
    stopped = true;
    hub.subscribers.delete(id);
    const nextCount = (hub.orgCounts.get(organizationId) ?? 1) - 1;
    if (nextCount <= 0) hub.orgCounts.delete(organizationId);
    else hub.orgCounts.set(organizationId, nextCount);

    if (hub.subscribers.size === 0) {
      if (hub.reconnectTimer) clearTimeout(hub.reconnectTimer);
      hub.reconnectTimer = null;
      void cleanupListenClient(hub);
      hub.listenedChannels.clear();
    } else if (hub.listenClient) {
      void ensureListenChannels(hub);
    }
  };
}

/** Test helper — close publish pool. */
export async function closeRealtimePublishPool(): Promise<void> {
  if (publishPool) {
    await publishPool.end();
    publishPool = null;
  }
}
