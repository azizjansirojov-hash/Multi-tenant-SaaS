import { afterEach, describe, expect, it, vi } from "vitest";
import {
  assertRequiredEnv,
  authTrustHost,
  isProduction,
  s3Configured,
  StorageNotConfiguredError,
  trustedProxyCount,
} from "@/lib/env";

describe("env helpers", () => {
  const original = { ...process.env };

  afterEach(() => {
    vi.unstubAllEnvs();
    process.env.AUTH_TRUST_HOST = original.AUTH_TRUST_HOST;
    process.env.AUTH_SECRET = original.AUTH_SECRET;
    process.env.DATABASE_URL = original.DATABASE_URL;
    process.env.S3_BUCKET = original.S3_BUCKET;
    process.env.S3_ACCESS_KEY_ID = original.S3_ACCESS_KEY_ID;
    process.env.S3_SECRET_ACCESS_KEY = original.S3_SECRET_ACCESS_KEY;
    process.env.TRUSTED_PROXY_COUNT = original.TRUSTED_PROXY_COUNT;
  });

  it("authTrustHost defaults true when unset in development", () => {
    vi.stubEnv("NODE_ENV", "development");
    delete process.env.AUTH_TRUST_HOST;
    process.env.AUTH_SECRET = "secret";
    process.env.DATABASE_URL = "postgresql://x";
    expect(authTrustHost()).toBe(true);
    expect(() => assertRequiredEnv()).not.toThrow();
  });

  it("authTrustHost parses true/false/1/0", () => {
    process.env.AUTH_TRUST_HOST = "false";
    expect(authTrustHost()).toBe(false);
    process.env.AUTH_TRUST_HOST = "0";
    expect(authTrustHost()).toBe(false);
    process.env.AUTH_TRUST_HOST = "true";
    expect(authTrustHost()).toBe(true);
    process.env.AUTH_TRUST_HOST = "1";
    expect(authTrustHost()).toBe(true);
  });

  it("production + unset AUTH_TRUST_HOST throws", () => {
    vi.stubEnv("NODE_ENV", "production");
    delete process.env.AUTH_TRUST_HOST;
    process.env.AUTH_SECRET = "secret";
    process.env.DATABASE_URL = "postgresql://x";
    expect(() => authTrustHost()).toThrow(/AUTH_TRUST_HOST/);
    expect(() => assertRequiredEnv()).toThrow(/AUTH_TRUST_HOST/);
  });

  it("production + invalid AUTH_TRUST_HOST throws", () => {
    vi.stubEnv("NODE_ENV", "production");
    process.env.AUTH_TRUST_HOST = "yes";
    process.env.AUTH_SECRET = "secret";
    process.env.DATABASE_URL = "postgresql://x";
    expect(() => authTrustHost()).toThrow(/AUTH_TRUST_HOST/);
    expect(() => assertRequiredEnv()).toThrow(/AUTH_TRUST_HOST/);
  });

  it("production + explicit true/false passes", () => {
    vi.stubEnv("NODE_ENV", "production");
    process.env.AUTH_SECRET = "secret";
    process.env.DATABASE_URL = "postgresql://x";
    process.env.AUTH_TRUST_HOST = "true";
    expect(authTrustHost()).toBe(true);
    expect(() => assertRequiredEnv()).not.toThrow();
    process.env.AUTH_TRUST_HOST = "false";
    expect(authTrustHost()).toBe(false);
    expect(() => assertRequiredEnv()).not.toThrow();
  });

  it("assertRequiredEnv throws when AUTH_SECRET or DATABASE_URL is missing", () => {
    vi.stubEnv("NODE_ENV", "test");
    delete process.env.AUTH_SECRET;
    process.env.DATABASE_URL = "postgresql://x";
    expect(() => assertRequiredEnv()).toThrow(/AUTH_SECRET/);

    process.env.AUTH_SECRET = "secret";
    delete process.env.DATABASE_URL;
    expect(() => assertRequiredEnv()).toThrow(/DATABASE_URL/);
  });

  it("assertRequiredEnv passes when both are set", () => {
    vi.stubEnv("NODE_ENV", "test");
    process.env.AUTH_SECRET = "secret";
    process.env.DATABASE_URL = "postgresql://x";
    expect(() => assertRequiredEnv()).not.toThrow();
  });

  it("trustedProxyCount defaults to 0 and rejects invalid values", () => {
    delete process.env.TRUSTED_PROXY_COUNT;
    expect(trustedProxyCount()).toBe(0);
    process.env.TRUSTED_PROXY_COUNT = "1";
    expect(trustedProxyCount()).toBe(1);
    process.env.TRUSTED_PROXY_COUNT = "-2";
    expect(trustedProxyCount()).toBe(0);
    process.env.TRUSTED_PROXY_COUNT = "nope";
    expect(trustedProxyCount()).toBe(0);
  });

  it("s3Configured requires bucket and both keys", () => {
    delete process.env.S3_BUCKET;
    delete process.env.S3_ACCESS_KEY_ID;
    delete process.env.S3_SECRET_ACCESS_KEY;
    expect(s3Configured()).toBe(false);
    process.env.S3_BUCKET = "b";
    process.env.S3_ACCESS_KEY_ID = "k";
    process.env.S3_SECRET_ACCESS_KEY = "s";
    expect(s3Configured()).toBe(true);
  });

  it("isProduction reflects NODE_ENV", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(isProduction()).toBe(true);
    vi.stubEnv("NODE_ENV", "test");
    expect(isProduction()).toBe(false);
  });

  it("StorageNotConfiguredError has a stable name", () => {
    const err = new StorageNotConfiguredError();
    expect(err.name).toBe("StorageNotConfiguredError");
    expect(err.message).toMatch(/S3_BUCKET/);
  });
});
