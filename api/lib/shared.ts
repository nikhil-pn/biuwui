// Shared pieces of the serverless functions: clients, rate limits, request parsing.
// Rails modelled on the Aevum Starter Kit's relayer (github.com/qday-io/aevum-starter-kit, MIT, PQA Labs).
import { createPublicClient, createWalletClient, http, isAddress, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { aevum, FACTORY, TUSD8 } from "../../scripts/lib/aevum";

export type Req = { method?: string; body?: unknown; headers: Record<string, string | string[] | undefined> };
export type Res = {
  status(code: number): Res;
  json(body: unknown): void;
  setHeader(name: string, value: string): void;
};

export { aevum, FACTORY, TUSD8 };
export const publicClient = createPublicClient({ chain: aevum, transport: http(undefined, { retryCount: 3 }) });

// Anvil's well-known public test keys: refuse them on a real network.
const PUBLIC_TEST_KEYS = new Set([
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
  "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
]);

export function walletFromEnv(name: string) {
  const key = process.env[name]?.trim() as Hex | undefined;
  if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key)) throw new ApiError(503, "NOT_CONFIGURED", "The service is not set up yet.");
  if (PUBLIC_TEST_KEYS.has(key.toLowerCase())) throw new ApiError(503, "NOT_CONFIGURED", "Refusing a public test key.");
  return createWalletClient({ account: privateKeyToAccount(key), chain: aevum, transport: http(undefined, { retryCount: 3 }) });
}

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

export function body<T>(req: Req): T {
  if (typeof req.body === "string") {
    try {
      return JSON.parse(req.body || "{}") as T;
    } catch {
      throw new ApiError(400, "BAD_JSON", "That request was not valid JSON.");
    }
  }
  return (req.body ?? {}) as T;
}

export function clientIp(req: Req): string {
  const header = process.env.TRUSTED_IP_HEADER ?? "x-vercel-forwarded-for";
  const raw = req.headers[header] ?? req.headers["x-forwarded-for"] ?? "unknown";
  return String(Array.isArray(raw) ? raw[0] : raw).split(",")[0].trim();
}

export function asAddress(v: unknown, what: string): Address {
  if (typeof v !== "string" || !isAddress(v)) throw new ApiError(400, "BAD_ADDRESS", `${what} is not a valid address.`);
  return v as Address;
}

/** Fixed-window counters. They live in memory, per server instance: fine for one instance, and stated in docs/API.md. */
const windows = new Map<string, { count: number; resetAt: number }>();
export function limit(key: string, max: number, windowMs: number) {
  const now = Date.now();
  const w = windows.get(key);
  if (!w || now >= w.resetAt) {
    windows.set(key, { count: 1, resetAt: now + windowMs });
    return;
  }
  if (w.count >= max) {
    const mins = Math.ceil((w.resetAt - now) / 60000);
    throw new ApiError(429, "RATE_LIMITED", `Too many requests. Please try again in about ${mins} minute${mins === 1 ? "" : "s"}.`);
  }
  w.count += 1;
}

export function send(res: Res, run: () => Promise<unknown>) {
  res.setHeader("cache-control", "no-store");
  return run().then(
    (out) => res.status(200).json(out),
    (e: unknown) => {
      if (e instanceof ApiError) return res.status(e.status).json({ error: e.message, code: e.code });
      console.error(e);
      return res.status(500).json({ error: "Something went wrong on our side. Please try again.", code: "INTERNAL" });
    },
  );
}

export const explorerTx = (h: Hex) => `${aevum.blockExplorers.default.url}/tx/${h}`;
