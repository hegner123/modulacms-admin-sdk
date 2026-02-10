import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { createSshKeysResource } from "./ssh-keys.js";
import type { SshKeysResource } from "./ssh-keys.js";
import { createHttpClient } from "../http.js";
import type { HttpClient } from "../http.js";
import type { ApiError } from "../types/common.js";
import type { SshKey, SshKeyListItem, CreateSshKeyRequest } from "../types/users.js";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const fakeSshKeyList: SshKeyListItem[] = [
  {
    ssh_key_id: "sk-001",
    key_type: "ssh-ed25519",
    fingerprint: "SHA256:abcdef1234567890",
    label: "work-laptop",
    date_created: "2025-01-15T10:00:00Z",
    last_used: "2025-06-01T08:30:00Z",
  },
  {
    ssh_key_id: "sk-002",
    key_type: "ssh-rsa",
    fingerprint: "SHA256:zyxwvu0987654321",
    label: "home-desktop",
    date_created: "2025-02-20T14:00:00Z",
    last_used: "2025-05-28T22:15:00Z",
  },
];

const fakeSshKey: SshKey = {
  ssh_key_id: "sk-new-001",
  user_id: "u-100",
  public_key: "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAI... user@host",
  key_type: "ssh-ed25519",
  fingerprint: "SHA256:newkeyfingerprint",
  label: "ci-deploy-key",
  date_created: "2025-06-10T12:00:00Z",
  last_used: "2025-06-10T12:00:00Z",
};

const createParams: CreateSshKeyRequest = {
  public_key: "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAI... user@host",
  label: "ci-deploy-key",
};

// ---------------------------------------------------------------------------
// Test server -- real Bun.serve (matching project convention)
// ---------------------------------------------------------------------------

let server: ReturnType<typeof Bun.serve>;
let baseUrl: string;

let lastRequest: {
  method: string;
  path: string;
  body: unknown;
  headers: Record<string, string>;
} | null = null;

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    async fetch(req: Request): Promise<Response> {
      const url = new URL(req.url);
      const path = url.pathname;

      let body: unknown = null;
      if (req.method === "POST" || req.method === "PUT") {
        const contentType = req.headers.get("content-type");
        if (contentType && contentType.includes("application/json")) {
          try {
            body = await req.json();
          } catch {
            body = null;
          }
        }
      }

      lastRequest = {
        method: req.method,
        path,
        body,
        headers: Object.fromEntries(req.headers.entries()),
      };

      // -- list: GET /api/v1/ssh-keys --
      if (path === "/api/v1/ssh-keys" && req.method === "GET") {
        return Response.json(fakeSshKeyList);
      }

      // -- create: POST /api/v1/ssh-keys --
      if (path === "/api/v1/ssh-keys" && req.method === "POST") {
        return Response.json(fakeSshKey);
      }

      // -- remove: DELETE /api/v1/ssh-keys/<id> --
      // Match any path starting with /api/v1/ssh-keys/ followed by an id segment
      if (path.startsWith("/api/v1/ssh-keys/") && req.method === "DELETE") {
        return new Response(null, { status: 204 });
      }

      // -- slow endpoint for abort tests --
      if (path === "/api/v1/ssh-keys-slow" && req.method === "GET") {
        return new Promise((resolve) => {
          setTimeout(() => {
            resolve(Response.json(fakeSshKeyList));
          }, 5000);
        });
      }

      // Fallback
      return new Response("Not Found", { status: 404 });
    },
  });
  baseUrl = `http://localhost:${server.port}`;
});

afterAll(() => {
  server.stop(true);
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeClient(overrides?: {
  apiKey?: string;
  defaultTimeout?: number;
}): HttpClient {
  return createHttpClient({
    baseUrl,
    apiKey: overrides?.apiKey,
    defaultTimeout: overrides?.defaultTimeout ?? 10000,
    credentials: "omit",
  });
}

function makeSshKeys(overrides?: {
  apiKey?: string;
  defaultTimeout?: number;
}): SshKeysResource {
  return createSshKeysResource(makeClient(overrides));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("createSshKeysResource", () => {
  // -------------------------------------------------------------------------
  // Factory
  // -------------------------------------------------------------------------

  describe("factory", () => {
    test("returns an object with list, create, and remove methods", () => {
      const sshKeys = makeSshKeys();
      expect(typeof sshKeys.list).toBe("function");
      expect(typeof sshKeys.create).toBe("function");
      expect(typeof sshKeys.remove).toBe("function");
    });

    test("all methods return promises", () => {
      const sshKeys = makeSshKeys();

      const listResult = sshKeys.list();
      expect(typeof listResult.then).toBe("function");
      listResult.catch(() => {});

      const createResult = sshKeys.create(createParams);
      expect(typeof createResult.then).toBe("function");
      createResult.catch(() => {});

      const removeResult = sshKeys.remove("sk-001");
      expect(typeof removeResult.then).toBe("function");
      removeResult.catch(() => {});
    });
  });

  // -------------------------------------------------------------------------
  // HTTP method correctness (parameterized)
  // -------------------------------------------------------------------------

  describe("HTTP method correctness", () => {
    test.each([
      { name: "list", expectedMethod: "GET", expectedPath: "/api/v1/ssh-keys" },
      { name: "create", expectedMethod: "POST", expectedPath: "/api/v1/ssh-keys" },
      { name: "remove", expectedMethod: "DELETE", expectedPath: "/api/v1/ssh-keys/sk-001" },
    ])("$name sends $expectedMethod to $expectedPath", async ({ name, expectedMethod, expectedPath }) => {
      const sshKeys = makeSshKeys();

      switch (name) {
        case "list":
          await sshKeys.list();
          break;
        case "create":
          await sshKeys.create(createParams);
          break;
        case "remove":
          await sshKeys.remove("sk-001");
          break;
      }

      expect(lastRequest).not.toBeNull();
      expect(lastRequest!.method).toBe(expectedMethod);
      expect(lastRequest!.path).toBe(expectedPath);
    });
  });

  // -------------------------------------------------------------------------
  // list
  // -------------------------------------------------------------------------

  describe("list", () => {
    test("returns parsed SshKeyListItem array on success", async () => {
      const sshKeys = makeSshKeys();
      const result = await sshKeys.list();
      expect(result).toEqual(fakeSshKeyList);
    });

    test("returns an array type", async () => {
      const sshKeys = makeSshKeys();
      const result = await sshKeys.list();
      expect(Array.isArray(result)).toBe(true);
    });

    test("returns array with correct length", async () => {
      const sshKeys = makeSshKeys();
      const result = await sshKeys.list();
      expect(result.length).toBe(2);
    });

    test("sends GET to /ssh-keys", async () => {
      const sshKeys = makeSshKeys();
      await sshKeys.list();
      expect(lastRequest).not.toBeNull();
      expect(lastRequest!.method).toBe("GET");
      expect(lastRequest!.path).toBe("/api/v1/ssh-keys");
    });

    test("does not send a request body", async () => {
      const sshKeys = makeSshKeys();
      await sshKeys.list();
      expect(lastRequest).not.toBeNull();
      expect(lastRequest!.body).toBeNull();
    });

    test("forwards RequestOptions signal", async () => {
      const sshKeys = makeSshKeys();
      const controller = new AbortController();
      controller.abort();
      try {
        await sshKeys.list({ signal: controller.signal });
        expect(true).toBe(false);
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(Error);
        const error = err as Error;
        expect(error.name).toBe("AbortError");
      }
    });

    test("returns empty array when server responds with empty list", async () => {
      const emptyServer = Bun.serve({
        port: 0,
        async fetch(req: Request): Promise<Response> {
          const url = new URL(req.url);
          if (url.pathname === "/api/v1/ssh-keys" && req.method === "GET") {
            return Response.json([]);
          }
          return new Response("Not Found", { status: 404 });
        },
      });

      try {
        const http = createHttpClient({
          baseUrl: `http://localhost:${emptyServer.port}`,
          defaultTimeout: 10000,
          credentials: "omit",
        });
        const sshKeys = createSshKeysResource(http);
        const result = await sshKeys.list();
        expect(result).toEqual([]);
        expect(Array.isArray(result)).toBe(true);
        expect(result.length).toBe(0);
      } finally {
        emptyServer.stop(true);
      }
    });

    test("each item in the array has expected SshKeyListItem fields", async () => {
      const sshKeys = makeSshKeys();
      const result = await sshKeys.list();
      const first = result[0];
      expect(first.ssh_key_id).toBe("sk-001");
      expect(first.key_type).toBe("ssh-ed25519");
      expect(first.fingerprint).toBe("SHA256:abcdef1234567890");
      expect(first.label).toBe("work-laptop");
      expect(first.date_created).toBe("2025-01-15T10:00:00Z");
      expect(first.last_used).toBe("2025-06-01T08:30:00Z");
    });
  });

  // -------------------------------------------------------------------------
  // create
  // -------------------------------------------------------------------------

  describe("create", () => {
    test("returns parsed SshKey on success", async () => {
      const sshKeys = makeSshKeys();
      const result = await sshKeys.create(createParams);
      expect(result).toEqual(fakeSshKey);
    });

    test("sends POST to /ssh-keys", async () => {
      const sshKeys = makeSshKeys();
      await sshKeys.create(createParams);
      expect(lastRequest).not.toBeNull();
      expect(lastRequest!.method).toBe("POST");
      expect(lastRequest!.path).toBe("/api/v1/ssh-keys");
    });

    test("sends CreateSshKeyRequest as JSON body", async () => {
      const sshKeys = makeSshKeys();
      await sshKeys.create(createParams);
      expect(lastRequest).not.toBeNull();
      expect(lastRequest!.body).toEqual({
        public_key: "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAI... user@host",
        label: "ci-deploy-key",
      });
    });

    test("returns full SshKey with all fields including user_id and public_key", async () => {
      const sshKeys = makeSshKeys();
      const result = await sshKeys.create(createParams);
      expect(result.ssh_key_id).toBe("sk-new-001");
      expect(result.user_id).toBe("u-100");
      expect(result.public_key).toBe("ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAI... user@host");
      expect(result.key_type).toBe("ssh-ed25519");
      expect(result.fingerprint).toBe("SHA256:newkeyfingerprint");
      expect(result.label).toBe("ci-deploy-key");
      expect(result.date_created).toBe("2025-06-10T12:00:00Z");
      expect(result.last_used).toBe("2025-06-10T12:00:00Z");
    });

    test("forwards RequestOptions signal", async () => {
      const sshKeys = makeSshKeys();
      const controller = new AbortController();
      controller.abort();
      try {
        await sshKeys.create(createParams, { signal: controller.signal });
        expect(true).toBe(false);
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(Error);
        const error = err as Error;
        expect(error.name).toBe("AbortError");
      }
    });
  });

  // -------------------------------------------------------------------------
  // remove -- path-param interpolation
  // -------------------------------------------------------------------------

  describe("remove", () => {
    test("resolves void on success", async () => {
      const sshKeys = makeSshKeys();
      const result = await sshKeys.remove("sk-001");
      expect(result).toBeUndefined();
    });

    test("sends DELETE to /ssh-keys/<id> with path interpolation", async () => {
      const sshKeys = makeSshKeys();
      await sshKeys.remove("sk-001");
      expect(lastRequest).not.toBeNull();
      expect(lastRequest!.method).toBe("DELETE");
      expect(lastRequest!.path).toBe("/api/v1/ssh-keys/sk-001");
    });

    test("does not send a request body", async () => {
      const sshKeys = makeSshKeys();
      await sshKeys.remove("sk-001");
      expect(lastRequest).not.toBeNull();
      // DELETE with no JSON body -- body parse attempt yields null
      expect(lastRequest!.body).toBeNull();
    });

    test("forwards RequestOptions signal", async () => {
      const sshKeys = makeSshKeys();
      const controller = new AbortController();
      controller.abort();
      try {
        await sshKeys.remove("sk-001", { signal: controller.signal });
        expect(true).toBe(false);
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(Error);
        const error = err as Error;
        expect(error.name).toBe("AbortError");
      }
    });

    // -- Path-param construction with various ID formats --

    test.each([
      { name: "simple string id", id: "sk-001", expectedPath: "/api/v1/ssh-keys/sk-001" },
      { name: "UUID-style id", id: "550e8400-e29b-41d4-a716-446655440000", expectedPath: "/api/v1/ssh-keys/550e8400-e29b-41d4-a716-446655440000" },
      { name: "numeric string id", id: "12345", expectedPath: "/api/v1/ssh-keys/12345" },
      { name: "id with underscores", id: "key_abc_123", expectedPath: "/api/v1/ssh-keys/key_abc_123" },
      { name: "short id", id: "a", expectedPath: "/api/v1/ssh-keys/a" },
      { name: "long id", id: "a".repeat(64), expectedPath: "/api/v1/ssh-keys/" + "a".repeat(64) },
    ])("constructs correct path for $name", async ({ id, expectedPath }) => {
      const sshKeys = makeSshKeys();
      await sshKeys.remove(id);
      expect(lastRequest).not.toBeNull();
      expect(lastRequest!.method).toBe("DELETE");
      expect(lastRequest!.path).toBe(expectedPath);
    });

    test("path interpolation places id directly after /ssh-keys/ with no query params", async () => {
      const sshKeys = makeSshKeys();
      await sshKeys.remove("test-id-999");
      expect(lastRequest).not.toBeNull();
      // The path should be exactly /api/v1/ssh-keys/test-id-999 with no ? or & chars
      expect(lastRequest!.path).toBe("/api/v1/ssh-keys/test-id-999");
    });
  });

  // -------------------------------------------------------------------------
  // Error propagation: JSON error responses
  // -------------------------------------------------------------------------

  describe("error propagation: JSON error response", () => {
    test.each([
      { name: "list", action: (r: SshKeysResource) => r.list() },
      { name: "create", action: (r: SshKeysResource) => r.create(createParams) },
      { name: "remove", action: (r: SshKeysResource) => r.remove("sk-001") },
    ])("$name throws ApiError with JSON body on 403 response", async ({ action }) => {
      const errorServer = Bun.serve({
        port: 0,
        async fetch(req: Request): Promise<Response> {
          if (req.method === "POST") {
            try { await req.json(); } catch { /* no body */ }
          }
          return Response.json(
            { error: "forbidden", detail: "access denied" },
            { status: 403, statusText: "Forbidden" },
          );
        },
      });

      try {
        const errHttp = createHttpClient({
          baseUrl: `http://localhost:${errorServer.port}`,
          defaultTimeout: 10000,
          credentials: "omit",
        });
        const sshKeys = createSshKeysResource(errHttp);

        try {
          await action(sshKeys);
          expect(true).toBe(false);
        } catch (err: unknown) {
          const apiErr = err as ApiError;
          expect(apiErr._tag).toBe("ApiError");
          expect(apiErr.status).toBe(403);
          expect(apiErr.message).toBe("Forbidden");
          expect(apiErr.body).toEqual({ error: "forbidden", detail: "access denied" });
        }
      } finally {
        errorServer.stop(true);
      }
    });
  });

  // -------------------------------------------------------------------------
  // Error propagation: non-JSON error responses
  // -------------------------------------------------------------------------

  describe("error propagation: non-JSON error response", () => {
    test.each([
      { name: "list", action: (r: SshKeysResource) => r.list() },
      { name: "create", action: (r: SshKeysResource) => r.create(createParams) },
      { name: "remove", action: (r: SshKeysResource) => r.remove("sk-001") },
    ])("$name throws ApiError with undefined body on 500 text response", async ({ action }) => {
      const errorServer = Bun.serve({
        port: 0,
        async fetch(req: Request): Promise<Response> {
          if (req.method === "POST") {
            try { await req.json(); } catch { /* no body */ }
          }
          return new Response("Internal Server Error", {
            status: 500,
            statusText: "Internal Server Error",
            headers: { "Content-Type": "text/plain" },
          });
        },
      });

      try {
        const errHttp = createHttpClient({
          baseUrl: `http://localhost:${errorServer.port}`,
          defaultTimeout: 10000,
          credentials: "omit",
        });
        const sshKeys = createSshKeysResource(errHttp);

        try {
          await action(sshKeys);
          expect(true).toBe(false);
        } catch (err: unknown) {
          const apiErr = err as ApiError;
          expect(apiErr._tag).toBe("ApiError");
          expect(apiErr.status).toBe(500);
          expect(apiErr.message).toBe("Internal Server Error");
          expect(apiErr.body).toBeUndefined();
        }
      } finally {
        errorServer.stop(true);
      }
    });
  });

  // -------------------------------------------------------------------------
  // Error propagation: various HTTP status codes
  // -------------------------------------------------------------------------

  describe("error propagation: status codes", () => {
    test.each([
      { status: 400, statusText: "Bad Request" },
      { status: 401, statusText: "Unauthorized" },
      { status: 404, statusText: "Not Found" },
      { status: 422, statusText: "Unprocessable Entity" },
      { status: 429, statusText: "Too Many Requests" },
      { status: 503, statusText: "Service Unavailable" },
    ])("list propagates $status $statusText", async ({ status, statusText }) => {
      const errorServer = Bun.serve({
        port: 0,
        async fetch(): Promise<Response> {
          return Response.json(
            { error: "test_error" },
            { status, statusText },
          );
        },
      });

      try {
        const errHttp = createHttpClient({
          baseUrl: `http://localhost:${errorServer.port}`,
          defaultTimeout: 10000,
          credentials: "omit",
        });
        const sshKeys = createSshKeysResource(errHttp);

        try {
          await sshKeys.list();
          expect(true).toBe(false);
        } catch (err: unknown) {
          const apiErr = err as ApiError;
          expect(apiErr._tag).toBe("ApiError");
          expect(apiErr.status).toBe(status);
          expect(apiErr.message).toBe(statusText);
        }
      } finally {
        errorServer.stop(true);
      }
    });
  });

  // -------------------------------------------------------------------------
  // Abort signal: pre-aborted signal for each method
  // -------------------------------------------------------------------------

  describe("abort signal: pre-aborted", () => {
    test.each([
      { name: "list", action: (r: SshKeysResource, opts: { signal: AbortSignal }) => r.list(opts) },
      { name: "create", action: (r: SshKeysResource, opts: { signal: AbortSignal }) => r.create(createParams, opts) },
      { name: "remove", action: (r: SshKeysResource, opts: { signal: AbortSignal }) => r.remove("sk-001", opts) },
    ])("$name aborts immediately with pre-aborted signal", async ({ action }) => {
      const sshKeys = makeSshKeys();
      const controller = new AbortController();
      controller.abort();

      try {
        await action(sshKeys, { signal: controller.signal });
        expect(true).toBe(false);
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(Error);
        const error = err as Error;
        expect(error.name).toBe("AbortError");
      }
    });
  });

  // -------------------------------------------------------------------------
  // Abort signal: user aborts during in-flight request
  // -------------------------------------------------------------------------

  describe("abort signal: user aborts during request", () => {
    test("list aborts when user signal fires mid-request", async () => {
      const slowServer = Bun.serve({
        port: 0,
        async fetch(): Promise<Response> {
          return new Promise((resolve) => {
            setTimeout(() => {
              resolve(Response.json(fakeSshKeyList));
            }, 5000);
          });
        },
      });

      try {
        const slowHttp = createHttpClient({
          baseUrl: `http://localhost:${slowServer.port}`,
          defaultTimeout: 10000,
          credentials: "omit",
        });
        const sshKeys = createSshKeysResource(slowHttp);
        const controller = new AbortController();
        setTimeout(() => controller.abort(), 50);

        try {
          await sshKeys.list({ signal: controller.signal });
          expect(true).toBe(false);
        } catch (err: unknown) {
          expect(err).toBeInstanceOf(Error);
          const error = err as Error;
          expect(error.name).toBe("AbortError");
        }
      } finally {
        slowServer.stop(true);
      }
    });
  });

  // -------------------------------------------------------------------------
  // Timeout via short defaultTimeout
  // -------------------------------------------------------------------------

  describe("timeout behavior", () => {
    test("times out when server is too slow and no user signal provided", async () => {
      const slowServer = Bun.serve({
        port: 0,
        async fetch(): Promise<Response> {
          return new Promise((resolve) => {
            setTimeout(() => {
              resolve(Response.json(fakeSshKeyList));
            }, 5000);
          });
        },
      });

      try {
        const slowHttp = createHttpClient({
          baseUrl: `http://localhost:${slowServer.port}`,
          defaultTimeout: 50,
          credentials: "omit",
        });
        const sshKeys = createSshKeysResource(slowHttp);

        try {
          await sshKeys.list();
          expect(true).toBe(false);
        } catch (err: unknown) {
          expect(err).toBeInstanceOf(Error);
          const error = err as Error;
          expect(error.name).toBe("TimeoutError");
        }
      } finally {
        slowServer.stop(true);
      }
    });
  });

  // -------------------------------------------------------------------------
  // Authorization header passthrough
  // -------------------------------------------------------------------------

  describe("authorization header", () => {
    test("includes Bearer token when apiKey is provided", async () => {
      const sshKeys = makeSshKeys({ apiKey: "my-ssh-key-token" });
      await sshKeys.list();
      expect(lastRequest).not.toBeNull();
      expect(lastRequest!.headers["authorization"]).toBe("Bearer my-ssh-key-token");
    });

    test("does not include Authorization header when apiKey is absent", async () => {
      const sshKeys = makeSshKeys();
      await sshKeys.list();
      expect(lastRequest).not.toBeNull();
      expect(lastRequest!.headers["authorization"]).toBeUndefined();
    });

    test.each([
      { name: "list", action: (r: SshKeysResource) => r.list() },
      { name: "create", action: (r: SshKeysResource) => r.create(createParams) },
      { name: "remove", action: (r: SshKeysResource) => r.remove("sk-001") },
    ])("$name sends Bearer token when apiKey is set", async ({ action }) => {
      const sshKeys = makeSshKeys({ apiKey: "shared-key-789" });
      await action(sshKeys);
      expect(lastRequest).not.toBeNull();
      expect(lastRequest!.headers["authorization"]).toBe("Bearer shared-key-789");
    });
  });

  // -------------------------------------------------------------------------
  // Content-Type header
  // -------------------------------------------------------------------------

  describe("content-type header", () => {
    test.each([
      { name: "list", action: (r: SshKeysResource) => r.list() },
      { name: "create", action: (r: SshKeysResource) => r.create(createParams) },
      { name: "remove", action: (r: SshKeysResource) => r.remove("sk-001") },
    ])("$name sends Content-Type: application/json", async ({ action }) => {
      const sshKeys = makeSshKeys();
      await action(sshKeys);
      expect(lastRequest).not.toBeNull();
      expect(lastRequest!.headers["content-type"]).toBe("application/json");
    });
  });

  // -------------------------------------------------------------------------
  // Resource isolation
  // -------------------------------------------------------------------------

  describe("resource isolation", () => {
    test("two resources from different HttpClients are independent", async () => {
      const sshKeys1 = makeSshKeys({ apiKey: "key-alpha" });
      const sshKeys2 = makeSshKeys({ apiKey: "key-beta" });

      await sshKeys1.list();
      expect(lastRequest!.headers["authorization"]).toBe("Bearer key-alpha");

      await sshKeys2.list();
      expect(lastRequest!.headers["authorization"]).toBe("Bearer key-beta");
    });

    test("resource without apiKey does not leak auth from another", async () => {
      const authed = makeSshKeys({ apiKey: "secret-key" });
      const unauthed = makeSshKeys();

      await authed.list();
      expect(lastRequest!.headers["authorization"]).toBe("Bearer secret-key");

      await unauthed.list();
      expect(lastRequest!.headers["authorization"]).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // remove: void return semantics
  // -------------------------------------------------------------------------

  describe("remove void return", () => {
    test("remove returns undefined (void) on 204 No Content", async () => {
      const sshKeys = makeSshKeys();
      const result = await sshKeys.remove("sk-001");
      expect(result).toBeUndefined();
    });

    test("remove resolves without error on 200 OK response", async () => {
      const okServer = Bun.serve({
        port: 0,
        async fetch(): Promise<Response> {
          return new Response(null, { status: 200 });
        },
      });

      try {
        const http = createHttpClient({
          baseUrl: `http://localhost:${okServer.port}`,
          defaultTimeout: 10000,
          credentials: "omit",
        });
        const sshKeys = createSshKeysResource(http);
        const result = await sshKeys.remove("sk-001");
        expect(result).toBeUndefined();
      } finally {
        okServer.stop(true);
      }
    });
  });

  // -------------------------------------------------------------------------
  // create: body forwarding with various payloads
  // -------------------------------------------------------------------------

  describe("create body forwarding", () => {
    test("forwards body with minimal fields", async () => {
      const sshKeys = makeSshKeys();
      const params: CreateSshKeyRequest = {
        public_key: "ssh-rsa AAAAB3...",
        label: "minimal",
      };
      await sshKeys.create(params);
      expect(lastRequest).not.toBeNull();
      expect(lastRequest!.body).toEqual({
        public_key: "ssh-rsa AAAAB3...",
        label: "minimal",
      });
    });

    test("forwards body with special characters in label", async () => {
      const sshKeys = makeSshKeys();
      const params: CreateSshKeyRequest = {
        public_key: "ssh-ed25519 AAAAC3...",
        label: "my key (work) -- 2025/06",
      };
      await sshKeys.create(params);
      expect(lastRequest).not.toBeNull();
      expect(lastRequest!.body).toEqual({
        public_key: "ssh-ed25519 AAAAC3...",
        label: "my key (work) -- 2025/06",
      });
    });

    test("forwards body with empty label", async () => {
      const sshKeys = makeSshKeys();
      const params: CreateSshKeyRequest = {
        public_key: "ssh-rsa AAAAB3...",
        label: "",
      };
      await sshKeys.create(params);
      expect(lastRequest).not.toBeNull();
      expect(lastRequest!.body).toEqual({
        public_key: "ssh-rsa AAAAB3...",
        label: "",
      });
    });

    test("forwards body with long public key", async () => {
      const sshKeys = makeSshKeys();
      const longKey = "ssh-rsa " + "A".repeat(500) + " user@host";
      const params: CreateSshKeyRequest = {
        public_key: longKey,
        label: "long-key",
      };
      await sshKeys.create(params);
      expect(lastRequest).not.toBeNull();
      expect(lastRequest!.body).toEqual({
        public_key: longKey,
        label: "long-key",
      });
    });
  });

  // -------------------------------------------------------------------------
  // list: passes no query params (second arg is undefined)
  // -------------------------------------------------------------------------

  describe("list passes no query params", () => {
    test("list calls http.get with undefined params", async () => {
      // The list method calls http.get('/ssh-keys', undefined, opts)
      // Verify the URL has no query string by checking the path is clean
      const sshKeys = makeSshKeys();
      await sshKeys.list();
      expect(lastRequest).not.toBeNull();
      // If params were passed, Bun.serve would show them in the URL path or search
      // The path should be exactly /api/v1/ssh-keys with no query string
      expect(lastRequest!.path).toBe("/api/v1/ssh-keys");
    });
  });

  // -------------------------------------------------------------------------
  // ApiError shape validation
  // -------------------------------------------------------------------------

  describe("ApiError shape", () => {
    test("thrown error from list has _tag, status, message, and body fields", async () => {
      const errorServer = Bun.serve({
        port: 0,
        async fetch(): Promise<Response> {
          return Response.json(
            { code: "RATE_LIMITED" },
            { status: 429, statusText: "Too Many Requests" },
          );
        },
      });

      try {
        const errHttp = createHttpClient({
          baseUrl: `http://localhost:${errorServer.port}`,
          defaultTimeout: 10000,
          credentials: "omit",
        });
        const sshKeys = createSshKeysResource(errHttp);

        try {
          await sshKeys.list();
          expect(true).toBe(false);
        } catch (err: unknown) {
          const apiErr = err as ApiError;
          expect(apiErr._tag).toBe("ApiError");
          expect(apiErr.status).toBe(429);
          expect(apiErr.message).toBe("Too Many Requests");
          expect(apiErr.body).toEqual({ code: "RATE_LIMITED" });
        }
      } finally {
        errorServer.stop(true);
      }
    });

    test("thrown error from remove has _tag, status, message, and body fields", async () => {
      const errorServer = Bun.serve({
        port: 0,
        async fetch(): Promise<Response> {
          return Response.json(
            { error: "not_found", detail: "key does not exist" },
            { status: 404, statusText: "Not Found" },
          );
        },
      });

      try {
        const errHttp = createHttpClient({
          baseUrl: `http://localhost:${errorServer.port}`,
          defaultTimeout: 10000,
          credentials: "omit",
        });
        const sshKeys = createSshKeysResource(errHttp);

        try {
          await sshKeys.remove("nonexistent-id");
          expect(true).toBe(false);
        } catch (err: unknown) {
          const apiErr = err as ApiError;
          expect(apiErr._tag).toBe("ApiError");
          expect(apiErr.status).toBe(404);
          expect(apiErr.message).toBe("Not Found");
          expect(apiErr.body).toEqual({ error: "not_found", detail: "key does not exist" });
        }
      } finally {
        errorServer.stop(true);
      }
    });
  });
});
