import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { createResource } from "./resource.js";
import type { CrudResource } from "./resource.js";
import { createHttpClient } from "./http.js";
import type { HttpClient } from "./http.js";
import type { ApiError } from "./types/common.js";

// ---------------------------------------------------------------------------
// Test entity types -- minimal shapes for testing the generic factory
// ---------------------------------------------------------------------------

type TestEntity = {
  id: string;
  name: string;
};

type CreateTestEntity = {
  name: string;
};

type UpdateTestEntity = {
  id: string;
  name: string;
};

// ---------------------------------------------------------------------------
// Test server -- real Bun.serve (matching existing http.test.ts convention)
// ---------------------------------------------------------------------------

let server: ReturnType<typeof Bun.serve>;
let baseUrl: string;

// Track the last request for assertion
let lastRequest: {
  method: string;
  url: string;
  path: string;
  params: Record<string, string>;
  body: unknown;
  headers: Record<string, string>;
} | null = null;

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    async fetch(req: Request): Promise<Response> {
      const url = new URL(req.url);
      const path = url.pathname;

      const params: Record<string, string> = {};
      url.searchParams.forEach((v, k) => {
        params[k] = v;
      });

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
        url: url.toString(),
        path,
        params,
        body,
        headers: Object.fromEntries(req.headers.entries()),
      };

      // -- List endpoint: GET /api/v1/widgets --
      if (path === "/api/v1/widgets" && req.method === "GET") {
        return Response.json([
          { id: "1", name: "Alpha" },
          { id: "2", name: "Beta" },
        ]);
      }

      // -- Get endpoint: GET /api/v1/widgets/ with query param q --
      if (path === "/api/v1/widgets/" && req.method === "GET" && params.q) {
        return Response.json({ id: params.q, name: "Found-" + params.q });
      }

      // -- Create endpoint: POST /api/v1/widgets --
      if (path === "/api/v1/widgets" && req.method === "POST") {
        return Response.json({ id: "new-1", name: (body as CreateTestEntity)?.name ?? "unnamed" });
      }

      // -- Update endpoint: PUT /api/v1/widgets/ --
      if (path === "/api/v1/widgets/" && req.method === "PUT") {
        const updateBody = body as UpdateTestEntity | null;
        return Response.json({ id: updateBody?.id ?? "unknown", name: updateBody?.name ?? "unchanged" });
      }

      // -- Delete endpoint: DELETE /api/v1/widgets/ with query param q --
      if (path === "/api/v1/widgets/" && req.method === "DELETE" && params.q) {
        return new Response(null, { status: 204 });
      }

      // -- Error endpoint (list): returns 404 JSON on GET /errors --
      if (path === "/api/v1/errors" && req.method === "GET") {
        return Response.json(
          { error: "not_found", detail: "test error" },
          { status: 404, statusText: "Not Found" },
        );
      }

      // -- Error endpoint (get): returns 404 JSON on GET /errors/ --
      if (path === "/api/v1/errors/" && req.method === "GET") {
        return Response.json(
          { error: "not_found", detail: "test error" },
          { status: 404, statusText: "Not Found" },
        );
      }

      // -- Error on create: returns 400 JSON --
      if (path === "/api/v1/errors" && req.method === "POST") {
        return Response.json(
          { error: "validation_failed", detail: "name is required" },
          { status: 400, statusText: "Bad Request" },
        );
      }

      // -- Error on update: returns 422 JSON --
      if (path === "/api/v1/errors/" && req.method === "PUT") {
        return Response.json(
          { error: "unprocessable", detail: "invalid field" },
          { status: 422, statusText: "Unprocessable Entity" },
        );
      }

      // -- Error on delete: returns 403 JSON --
      if (path === "/api/v1/errors/" && req.method === "DELETE") {
        return Response.json(
          { error: "forbidden", detail: "not authorized" },
          { status: 403, statusText: "Forbidden" },
        );
      }

      // -- Error on list: returns 500 text --
      if (path === "/api/v1/servererr" && req.method === "GET") {
        return new Response("Internal Server Error", {
          status: 500,
          statusText: "Internal Server Error",
          headers: { "Content-Type": "text/plain" },
        });
      }

      // -- Slow endpoint for abort testing --
      if (path === "/api/v1/slow" || path === "/api/v1/slow/") {
        return new Promise((resolve) => {
          setTimeout(() => {
            resolve(Response.json({ id: "slow", name: "slow" }));
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
// Helper to create HttpClient + resource
// ---------------------------------------------------------------------------

function makeClient(overrides?: { apiKey?: string; defaultTimeout?: number }): HttpClient {
  return createHttpClient({
    baseUrl,
    apiKey: overrides?.apiKey,
    defaultTimeout: overrides?.defaultTimeout ?? 10000,
    credentials: "omit",
  });
}

function makeResource(
  http?: HttpClient,
  path?: string,
): CrudResource<TestEntity, CreateTestEntity, UpdateTestEntity> {
  return createResource<TestEntity, CreateTestEntity, UpdateTestEntity>(
    http ?? makeClient(),
    path ?? "widgets",
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("createResource", () => {
  // -------------------------------------------------------------------------
  // list()
  // -------------------------------------------------------------------------

  describe("list", () => {
    test("returns an array of entities from GET /<path>", async () => {
      const resource = makeResource();
      const result = await resource.list();
      expect(result).toEqual([
        { id: "1", name: "Alpha" },
        { id: "2", name: "Beta" },
      ]);
    });

    test("sends GET request to /<path> without trailing slash", async () => {
      const resource = makeResource();
      await resource.list();
      expect(lastRequest).not.toBeNull();
      expect(lastRequest!.method).toBe("GET");
      expect(lastRequest!.path).toBe("/api/v1/widgets");
    });

    test("sends no query parameters", async () => {
      const resource = makeResource();
      await resource.list();
      expect(lastRequest).not.toBeNull();
      expect(Object.keys(lastRequest!.params).length).toBe(0);
    });

    test("propagates errors from the HTTP client", async () => {
      const resource = makeResource(undefined, "servererr");
      try {
        await resource.list();
        expect(true).toBe(false);
      } catch (err: unknown) {
        const apiErr = err as ApiError;
        expect(apiErr._tag).toBe("ApiError");
        expect(apiErr.status).toBe(500);
      }
    });

    test("forwards RequestOptions to the HTTP client", async () => {
      const resource = makeResource();
      const controller = new AbortController();
      controller.abort();
      try {
        await resource.list({ signal: controller.signal });
        expect(true).toBe(false);
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(Error);
        const error = err as Error;
        expect(error.name).toBe("AbortError");
      }
    });
  });

  // -------------------------------------------------------------------------
  // get()
  // -------------------------------------------------------------------------

  describe("get", () => {
    test("returns a single entity by ID from GET /<path>/", async () => {
      const resource = makeResource();
      const result = await resource.get("abc-123");
      expect(result).toEqual({ id: "abc-123", name: "Found-abc-123" });
    });

    test("sends GET request to /<path>/ with trailing slash", async () => {
      const resource = makeResource();
      await resource.get("test-id");
      expect(lastRequest).not.toBeNull();
      expect(lastRequest!.method).toBe("GET");
      expect(lastRequest!.path).toBe("/api/v1/widgets/");
    });

    test("passes id as query parameter q", async () => {
      const resource = makeResource();
      await resource.get("my-id");
      expect(lastRequest).not.toBeNull();
      expect(lastRequest!.params.q).toBe("my-id");
    });

    test("converts id to string via String()", async () => {
      // createResource defaults Id to string, but the implementation calls String(id)
      // which would handle non-string types if the generic allowed them.
      // With string IDs, String("abc") === "abc" -- verify no mangling.
      const resource = makeResource();
      await resource.get("123");
      expect(lastRequest).not.toBeNull();
      expect(lastRequest!.params.q).toBe("123");
    });

    test.each([
      { name: "simple string id", id: "abc", expectedQ: "abc" },
      { name: "numeric string id", id: "42", expectedQ: "42" },
      { name: "uuid-style id", id: "550e8400-e29b-41d4-a716-446655440000", expectedQ: "550e8400-e29b-41d4-a716-446655440000" },
      { name: "id with special characters", id: "item/sub:123", expectedQ: "item/sub:123" },
    ])("passes $name as query param q", async ({ id, expectedQ }) => {
      const resource = makeResource();
      await resource.get(id);
      expect(lastRequest).not.toBeNull();
      expect(lastRequest!.params.q).toBe(expectedQ);
    });

    // Empty string ID still sends the request -- the server decides whether that is valid.
    // The resource layer does not validate IDs; it passes them through.
    test("sends empty string id as query param q (server may reject)", async () => {
      const resource = makeResource();
      // The test server does not handle empty q, so this will error.
      // What matters is that the request was sent with q="" in the query string.
      try {
        await resource.get("");
      } catch {
        // Expected error from server
      }
      expect(lastRequest).not.toBeNull();
      expect(lastRequest!.params.q).toBe("");
    });

    test("propagates API errors from the HTTP client", async () => {
      const resource = makeResource(undefined, "errors");
      try {
        await resource.get("nonexistent");
        expect(true).toBe(false);
      } catch (err: unknown) {
        const apiErr = err as ApiError;
        expect(apiErr._tag).toBe("ApiError");
        expect(apiErr.status).toBe(404);
        expect(apiErr.body).toEqual({ error: "not_found", detail: "test error" });
      }
    });

    test("forwards RequestOptions to the HTTP client", async () => {
      const resource = makeResource();
      const controller = new AbortController();
      controller.abort();
      try {
        await resource.get("abc", { signal: controller.signal });
        expect(true).toBe(false);
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(Error);
        const error = err as Error;
        expect(error.name).toBe("AbortError");
      }
    });
  });

  // -------------------------------------------------------------------------
  // create()
  // -------------------------------------------------------------------------

  describe("create", () => {
    test("returns the created entity from POST /<path>", async () => {
      const resource = makeResource();
      const result = await resource.create({ name: "New Widget" });
      expect(result).toEqual({ id: "new-1", name: "New Widget" });
    });

    test("sends POST request to /<path> without trailing slash", async () => {
      const resource = makeResource();
      await resource.create({ name: "Test" });
      expect(lastRequest).not.toBeNull();
      expect(lastRequest!.method).toBe("POST");
      expect(lastRequest!.path).toBe("/api/v1/widgets");
    });

    test("sends CreateParams as the request body", async () => {
      const resource = makeResource();
      await resource.create({ name: "Widget X" });
      expect(lastRequest).not.toBeNull();
      expect(lastRequest!.body).toEqual({ name: "Widget X" });
    });

    test("propagates API errors from the HTTP client", async () => {
      const resource = makeResource(undefined, "errors");
      try {
        await resource.create({ name: "" });
        expect(true).toBe(false);
      } catch (err: unknown) {
        const apiErr = err as ApiError;
        expect(apiErr._tag).toBe("ApiError");
        expect(apiErr.status).toBe(400);
        expect(apiErr.body).toEqual({ error: "validation_failed", detail: "name is required" });
      }
    });

    test("forwards RequestOptions to the HTTP client", async () => {
      const resource = makeResource();
      const controller = new AbortController();
      controller.abort();
      try {
        await resource.create({ name: "Abort" }, { signal: controller.signal });
        expect(true).toBe(false);
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(Error);
        const error = err as Error;
        expect(error.name).toBe("AbortError");
      }
    });
  });

  // -------------------------------------------------------------------------
  // update()
  // -------------------------------------------------------------------------

  describe("update", () => {
    test("returns the updated entity from PUT /<path>/", async () => {
      const resource = makeResource();
      const result = await resource.update({ id: "u-1", name: "Updated Widget" });
      expect(result).toEqual({ id: "u-1", name: "Updated Widget" });
    });

    test("sends PUT request to /<path>/ with trailing slash", async () => {
      const resource = makeResource();
      await resource.update({ id: "u-1", name: "Test" });
      expect(lastRequest).not.toBeNull();
      expect(lastRequest!.method).toBe("PUT");
      expect(lastRequest!.path).toBe("/api/v1/widgets/");
    });

    test("sends UpdateParams as the request body", async () => {
      const resource = makeResource();
      await resource.update({ id: "u-2", name: "Changed" });
      expect(lastRequest).not.toBeNull();
      expect(lastRequest!.body).toEqual({ id: "u-2", name: "Changed" });
    });

    test("propagates API errors from the HTTP client", async () => {
      const resource = makeResource(undefined, "errors");
      try {
        await resource.update({ id: "bad", name: "fail" });
        expect(true).toBe(false);
      } catch (err: unknown) {
        const apiErr = err as ApiError;
        expect(apiErr._tag).toBe("ApiError");
        expect(apiErr.status).toBe(422);
        expect(apiErr.body).toEqual({ error: "unprocessable", detail: "invalid field" });
      }
    });

    test("forwards RequestOptions to the HTTP client", async () => {
      const resource = makeResource();
      const controller = new AbortController();
      controller.abort();
      try {
        await resource.update({ id: "u-1", name: "Abort" }, { signal: controller.signal });
        expect(true).toBe(false);
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(Error);
        const error = err as Error;
        expect(error.name).toBe("AbortError");
      }
    });
  });

  // -------------------------------------------------------------------------
  // remove()
  // -------------------------------------------------------------------------

  describe("remove", () => {
    test("resolves void on successful DELETE", async () => {
      const resource = makeResource();
      const result = await resource.remove("del-1");
      expect(result).toBeUndefined();
    });

    test("sends DELETE request to /<path>/ with trailing slash", async () => {
      const resource = makeResource();
      await resource.remove("del-2");
      expect(lastRequest).not.toBeNull();
      expect(lastRequest!.method).toBe("DELETE");
      expect(lastRequest!.path).toBe("/api/v1/widgets/");
    });

    test("passes id as query parameter q", async () => {
      const resource = makeResource();
      await resource.remove("del-3");
      expect(lastRequest).not.toBeNull();
      expect(lastRequest!.params.q).toBe("del-3");
    });

    test("converts id to string via String()", async () => {
      const resource = makeResource();
      await resource.remove("999");
      expect(lastRequest).not.toBeNull();
      expect(lastRequest!.params.q).toBe("999");
    });

    test.each([
      { name: "simple string id", id: "item-1", expectedQ: "item-1" },
      { name: "numeric string id", id: "7", expectedQ: "7" },
      { name: "uuid-style id", id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890", expectedQ: "a1b2c3d4-e5f6-7890-abcd-ef1234567890" },
    ])("passes $name as query param q for deletion", async ({ id, expectedQ }) => {
      const resource = makeResource();
      await resource.remove(id);
      expect(lastRequest).not.toBeNull();
      expect(lastRequest!.params.q).toBe(expectedQ);
    });

    test("propagates API errors from the HTTP client", async () => {
      const resource = makeResource(undefined, "errors");
      try {
        await resource.remove("forbidden-id");
        expect(true).toBe(false);
      } catch (err: unknown) {
        const apiErr = err as ApiError;
        expect(apiErr._tag).toBe("ApiError");
        expect(apiErr.status).toBe(403);
        expect(apiErr.body).toEqual({ error: "forbidden", detail: "not authorized" });
      }
    });

    test("forwards RequestOptions to the HTTP client", async () => {
      const resource = makeResource();
      const controller = new AbortController();
      controller.abort();
      try {
        await resource.remove("del-4", { signal: controller.signal });
        expect(true).toBe(false);
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(Error);
        const error = err as Error;
        expect(error.name).toBe("AbortError");
      }
    });
  });

  // -------------------------------------------------------------------------
  // URL construction patterns
  // -------------------------------------------------------------------------

  describe("URL construction", () => {
    test.each([
      { method: "list", expectedPath: "/api/v1/widgets" },
      { method: "get", expectedPath: "/api/v1/widgets/" },
      { method: "create", expectedPath: "/api/v1/widgets" },
      { method: "update", expectedPath: "/api/v1/widgets/" },
      { method: "remove", expectedPath: "/api/v1/widgets/" },
    ])("$method builds correct path", async ({ method, expectedPath }) => {
      const resource = makeResource();

      switch (method) {
        case "list":
          await resource.list();
          break;
        case "get":
          await resource.get("test-id");
          break;
        case "create":
          await resource.create({ name: "test" });
          break;
        case "update":
          await resource.update({ id: "test-id", name: "test" });
          break;
        case "remove":
          await resource.remove("test-id");
          break;
      }

      expect(lastRequest).not.toBeNull();
      expect(lastRequest!.path).toBe(expectedPath);
    });

    test("uses the path argument to build URLs", async () => {
      // Verify a different path produces different URLs
      const http = makeClient();
      const resource = createResource<TestEntity, CreateTestEntity, UpdateTestEntity>(http, "items");
      // This will hit a 404 on our test server, but we can check the request path
      try {
        await resource.list();
      } catch {
        // Expected -- /api/v1/items is not handled by test server
      }
      expect(lastRequest).not.toBeNull();
      expect(lastRequest!.path).toBe("/api/v1/items");
    });
  });

  // -------------------------------------------------------------------------
  // HTTP method correctness
  // -------------------------------------------------------------------------

  describe("HTTP method correctness", () => {
    test.each([
      { operation: "list", expectedMethod: "GET" },
      { operation: "get", expectedMethod: "GET" },
      { operation: "create", expectedMethod: "POST" },
      { operation: "update", expectedMethod: "PUT" },
      { operation: "remove", expectedMethod: "DELETE" },
    ])("$operation sends $expectedMethod", async ({ operation, expectedMethod }) => {
      const resource = makeResource();

      try {
        switch (operation) {
          case "list":
            await resource.list();
            break;
          case "get":
            await resource.get("test-id");
            break;
          case "create":
            await resource.create({ name: "test" });
            break;
          case "update":
            await resource.update({ id: "test-id", name: "test" });
            break;
          case "remove":
            await resource.remove("test-id");
            break;
        }
      } catch {
        // Some might fail due to server response shape, but request was still sent
      }

      expect(lastRequest).not.toBeNull();
      expect(lastRequest!.method).toBe(expectedMethod);
    });
  });

  // -------------------------------------------------------------------------
  // Shared HttpClient instance
  // -------------------------------------------------------------------------

  describe("shared HttpClient", () => {
    test("multiple resources sharing the same HttpClient work independently", async () => {
      const http = makeClient();
      const widgetResource = createResource<TestEntity, CreateTestEntity, UpdateTestEntity>(http, "widgets");
      const errorResource = createResource<TestEntity, CreateTestEntity, UpdateTestEntity>(http, "errors");

      // Widget list should succeed
      const widgets = await widgetResource.list();
      expect(widgets).toEqual([
        { id: "1", name: "Alpha" },
        { id: "2", name: "Beta" },
      ]);

      // Error list should fail with 404 (the test server returns JSON error for /api/v1/errors GET)
      try {
        await errorResource.list();
        expect(true).toBe(false);
      } catch (err: unknown) {
        const apiErr = err as ApiError;
        expect(apiErr._tag).toBe("ApiError");
        expect(apiErr.status).toBe(404);
      }

      // Widget list should still work after the error resource failed
      const widgetsAgain = await widgetResource.list();
      expect(widgetsAgain).toEqual([
        { id: "1", name: "Alpha" },
        { id: "2", name: "Beta" },
      ]);
    });
  });

  // -------------------------------------------------------------------------
  // CrudResource type contract
  // -------------------------------------------------------------------------

  describe("CrudResource type contract", () => {
    test("returned object has all five CRUD methods", () => {
      const resource = makeResource();
      expect(typeof resource.list).toBe("function");
      expect(typeof resource.get).toBe("function");
      expect(typeof resource.create).toBe("function");
      expect(typeof resource.update).toBe("function");
      expect(typeof resource.remove).toBe("function");
    });

    test("all methods return promises", () => {
      const resource = makeResource();
      // Verify each method returns a promise (thenable)
      const listResult = resource.list();
      expect(typeof listResult.then).toBe("function");
      // Clean up the promise to avoid unhandled rejections
      listResult.catch(() => {});

      const getResult = resource.get("id");
      expect(typeof getResult.then).toBe("function");
      getResult.catch(() => {});

      const createResult = resource.create({ name: "test" });
      expect(typeof createResult.then).toBe("function");
      createResult.catch(() => {});

      const updateResult = resource.update({ id: "id", name: "test" });
      expect(typeof updateResult.then).toBe("function");
      updateResult.catch(() => {});

      const removeResult = resource.remove("id");
      expect(typeof removeResult.then).toBe("function");
      removeResult.catch(() => {});
    });
  });
});
