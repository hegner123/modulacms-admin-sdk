import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { createAdminTreeResource } from "./admin-tree.js";
import type { AdminTreeResource } from "./admin-tree.js";
import { createHttpClient } from "../http.js";
import type { HttpClient } from "../http.js";
import type { ApiError, AdminContentID, AdminRouteID, Slug, UserID } from "../types/common.js";
import type { TreeFormat } from "../types/tree.js";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const fakeTreeResponse = {
  route: {
    admin_route_id: "ar-001" as AdminRouteID,
    slug: "homepage" as Slug,
    title: "Homepage",
    status: 1,
    author_id: "u-author-1" as UserID,
    date_created: "2025-06-01T00:00:00Z",
    date_modified: "2025-06-15T00:00:00Z",
  },
  tree: [
    {
      content_data_id: "acd-001" as AdminContentID,
      parent_id: null,
      first_child_id: null,
      next_sibling_id: null,
      prev_sibling_id: null,
      datatype_label: "Hero",
      datatype_type: "component",
      fields: [
        {
          field_label: "title",
          field_type: "text" as const,
          field_value: "Welcome",
        },
      ],
      children: [],
    },
  ],
};

// ---------------------------------------------------------------------------
// Test server -- real Bun.serve (matching project convention)
// ---------------------------------------------------------------------------

let server: ReturnType<typeof Bun.serve>;
let baseUrl: string;

let lastRequest: {
  method: string;
  path: string;
  params: Record<string, string>;
  headers: Record<string, string>;
} | null = null;

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    fetch(req: Request): Response {
      const url = new URL(req.url);
      const path = url.pathname;

      const params: Record<string, string> = {};
      url.searchParams.forEach((v, k) => {
        params[k] = v;
      });

      lastRequest = {
        method: req.method,
        path,
        params,
        headers: Object.fromEntries(req.headers.entries()),
      };

      // -- admin tree: match any /api/v1/admin/tree/* path --
      if (path.startsWith("/api/v1/admin/tree/") && req.method === "GET") {
        return Response.json(fakeTreeResponse);
      }

      // -- slow endpoint for abort tests --
      if (path === "/api/v1/admin/tree-slow" && req.method === "GET") {
        return new Promise((resolve) => {
          setTimeout(() => {
            resolve(Response.json(fakeTreeResponse));
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

function makeTree(overrides?: {
  apiKey?: string;
  defaultTimeout?: number;
}): AdminTreeResource {
  return createAdminTreeResource(makeClient(overrides));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("createAdminTreeResource", () => {
  // -------------------------------------------------------------------------
  // Factory
  // -------------------------------------------------------------------------

  describe("factory", () => {
    test("returns an object with a get method", () => {
      const tree = makeTree();
      expect(typeof tree.get).toBe("function");
    });

    test("get returns a promise", () => {
      const tree = makeTree();
      const result = tree.get("homepage" as Slug);
      expect(typeof result.then).toBe("function");
      result.catch(() => {});
    });
  });

  // -------------------------------------------------------------------------
  // URL construction: slug interpolation
  // -------------------------------------------------------------------------

  describe("URL construction", () => {
    test("builds /admin/tree/{slug} path with slug interpolated", async () => {
      const tree = makeTree();
      await tree.get("homepage" as Slug);
      expect(lastRequest).not.toBeNull();
      expect(lastRequest!.path).toBe("/api/v1/admin/tree/homepage");
    });

    test.each([
      { slug: "homepage", expectedPath: "/api/v1/admin/tree/homepage" },
      { slug: "about-us", expectedPath: "/api/v1/admin/tree/about-us" },
      { slug: "blog/post-1", expectedPath: "/api/v1/admin/tree/blog/post-1" },
      { slug: "page-with-numbers-123", expectedPath: "/api/v1/admin/tree/page-with-numbers-123" },
    ])("slug '$slug' produces path '$expectedPath'", async ({ slug, expectedPath }) => {
      const tree = makeTree();
      await tree.get(slug as Slug);
      expect(lastRequest).not.toBeNull();
      expect(lastRequest!.path).toBe(expectedPath);
    });

    test("sends GET method", async () => {
      const tree = makeTree();
      await tree.get("homepage" as Slug);
      expect(lastRequest).not.toBeNull();
      expect(lastRequest!.method).toBe("GET");
    });
  });

  // -------------------------------------------------------------------------
  // Format query param
  // -------------------------------------------------------------------------

  describe("format query param", () => {
    test("does not include format param when format is omitted", async () => {
      const tree = makeTree();
      await tree.get("homepage" as Slug);
      expect(lastRequest).not.toBeNull();
      expect(lastRequest!.params["format"]).toBeUndefined();
    });

    test("does not include format param when format is undefined", async () => {
      const tree = makeTree();
      await tree.get("homepage" as Slug, undefined);
      expect(lastRequest).not.toBeNull();
      expect(lastRequest!.params["format"]).toBeUndefined();
    });

    test.each([
      { format: "contentful" as TreeFormat },
      { format: "sanity" as TreeFormat },
      { format: "strapi" as TreeFormat },
      { format: "wordpress" as TreeFormat },
      { format: "clean" as TreeFormat },
      { format: "raw" as TreeFormat },
    ])("includes format=$format in query string", async ({ format }) => {
      const tree = makeTree();
      await tree.get("homepage" as Slug, format);
      expect(lastRequest).not.toBeNull();
      expect(lastRequest!.params["format"]).toBe(format);
    });

    test("sends only the format param -- no extra params", async () => {
      const tree = makeTree();
      await tree.get("homepage" as Slug, "clean");
      expect(lastRequest).not.toBeNull();
      expect(Object.keys(lastRequest!.params)).toEqual(["format"]);
    });

    test("sends no query params at all when format is omitted", async () => {
      const tree = makeTree();
      await tree.get("homepage" as Slug);
      expect(lastRequest).not.toBeNull();
      expect(Object.keys(lastRequest!.params).length).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // Successful response
  // -------------------------------------------------------------------------

  describe("successful response", () => {
    test("returns parsed AdminTreeResponse on success", async () => {
      const tree = makeTree();
      const result = await tree.get("homepage" as Slug);
      expect(result).toEqual(fakeTreeResponse);
    });

    test("response contains route with expected fields", async () => {
      const tree = makeTree();
      const result = await tree.get("homepage" as Slug);
      expect(result).toMatchObject({
        route: {
          admin_route_id: "ar-001",
          slug: "homepage",
          title: "Homepage",
          status: 1,
        },
      });
    });

    test("response contains tree array with content nodes", async () => {
      const tree = makeTree();
      const result = await tree.get("homepage" as Slug);
      const response = result as typeof fakeTreeResponse;
      expect(response.tree.length).toBe(1);
      expect(response.tree[0].content_data_id).toBe("acd-001");
      expect(response.tree[0].datatype_label).toBe("Hero");
      expect(response.tree[0].fields.length).toBe(1);
      expect(response.tree[0].fields[0].field_label).toBe("title");
      expect(response.tree[0].fields[0].field_value).toBe("Welcome");
    });

    test("returns same response regardless of format param", async () => {
      const tree = makeTree();
      const withoutFormat = await tree.get("homepage" as Slug);
      const withFormat = await tree.get("homepage" as Slug, "contentful");
      expect(withoutFormat).toEqual(withFormat);
    });
  });

  // -------------------------------------------------------------------------
  // Error propagation: JSON error response
  // -------------------------------------------------------------------------

  describe("error propagation: JSON error response", () => {
    test("throws ApiError with JSON body on 403 response", async () => {
      const errorServer = Bun.serve({
        port: 0,
        fetch(): Response {
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
        const tree = createAdminTreeResource(errHttp);

        try {
          await tree.get("homepage" as Slug);
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

    test("throws ApiError with JSON body on 404 response", async () => {
      const errorServer = Bun.serve({
        port: 0,
        fetch(): Response {
          return Response.json(
            { error: "not_found", detail: "route not found" },
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
        const tree = createAdminTreeResource(errHttp);

        try {
          await tree.get("nonexistent" as Slug);
          expect(true).toBe(false);
        } catch (err: unknown) {
          const apiErr = err as ApiError;
          expect(apiErr._tag).toBe("ApiError");
          expect(apiErr.status).toBe(404);
          expect(apiErr.message).toBe("Not Found");
          expect(apiErr.body).toEqual({ error: "not_found", detail: "route not found" });
        }
      } finally {
        errorServer.stop(true);
      }
    });
  });

  // -------------------------------------------------------------------------
  // Error propagation: non-JSON error response
  // -------------------------------------------------------------------------

  describe("error propagation: non-JSON error response", () => {
    test("throws ApiError with undefined body on 500 text response", async () => {
      const errorServer = Bun.serve({
        port: 0,
        fetch(): Response {
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
        const tree = createAdminTreeResource(errHttp);

        try {
          await tree.get("homepage" as Slug);
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
    ])("propagates $status $statusText", async ({ status, statusText }) => {
      const errorServer = Bun.serve({
        port: 0,
        fetch(): Response {
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
        const tree = createAdminTreeResource(errHttp);

        try {
          await tree.get("homepage" as Slug);
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
  // Abort signal: pre-aborted
  // -------------------------------------------------------------------------

  describe("abort signal", () => {
    test("aborts immediately with pre-aborted signal", async () => {
      const tree = makeTree();
      const controller = new AbortController();
      controller.abort();

      try {
        await tree.get("homepage" as Slug, undefined, { signal: controller.signal });
        expect(true).toBe(false);
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(Error);
        const error = err as Error;
        expect(error.name).toBe("AbortError");
      }
    });

    test("aborts with format param and pre-aborted signal", async () => {
      const tree = makeTree();
      const controller = new AbortController();
      controller.abort();

      try {
        await tree.get("homepage" as Slug, "clean", { signal: controller.signal });
        expect(true).toBe(false);
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(Error);
        const error = err as Error;
        expect(error.name).toBe("AbortError");
      }
    });

    test("aborts when user signal fires mid-request", async () => {
      const slowServer = Bun.serve({
        port: 0,
        fetch(): Promise<Response> {
          return new Promise((resolve) => {
            setTimeout(() => {
              resolve(Response.json(fakeTreeResponse));
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
        const tree = createAdminTreeResource(slowHttp);
        const controller = new AbortController();
        setTimeout(() => controller.abort(), 50);

        try {
          await tree.get("homepage" as Slug, undefined, { signal: controller.signal });
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
  // Timeout behavior
  // -------------------------------------------------------------------------

  describe("timeout behavior", () => {
    test("times out when server is too slow and no user signal provided", async () => {
      const slowServer = Bun.serve({
        port: 0,
        fetch(): Promise<Response> {
          return new Promise((resolve) => {
            setTimeout(() => {
              resolve(Response.json(fakeTreeResponse));
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
        const tree = createAdminTreeResource(slowHttp);

        try {
          await tree.get("homepage" as Slug);
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
  // Authorization header
  // -------------------------------------------------------------------------

  describe("authorization header", () => {
    test("includes Bearer token when apiKey is provided", async () => {
      const tree = makeTree({ apiKey: "tree-api-key-123" });
      await tree.get("homepage" as Slug);
      expect(lastRequest).not.toBeNull();
      expect(lastRequest!.headers["authorization"]).toBe("Bearer tree-api-key-123");
    });

    test("does not include Authorization header when apiKey is absent", async () => {
      const tree = makeTree();
      await tree.get("homepage" as Slug);
      expect(lastRequest).not.toBeNull();
      expect(lastRequest!.headers["authorization"]).toBeUndefined();
    });

    test.each([
      { name: "simple key", apiKey: "abc-123", expected: "Bearer abc-123" },
      { name: "key with special chars", apiKey: "key+with/special=chars", expected: "Bearer key+with/special=chars" },
      { name: "long key", apiKey: "a".repeat(256), expected: "Bearer " + "a".repeat(256) },
    ])("$name sends correct Authorization header", async ({ apiKey, expected }) => {
      const tree = makeTree({ apiKey });
      await tree.get("homepage" as Slug);
      expect(lastRequest).not.toBeNull();
      expect(lastRequest!.headers["authorization"]).toBe(expected);
    });
  });

  // -------------------------------------------------------------------------
  // Content-Type header
  // -------------------------------------------------------------------------

  describe("content-type header", () => {
    test("sends Content-Type: application/json", async () => {
      const tree = makeTree();
      await tree.get("homepage" as Slug);
      expect(lastRequest).not.toBeNull();
      expect(lastRequest!.headers["content-type"]).toBe("application/json");
    });
  });

  // -------------------------------------------------------------------------
  // Resource isolation
  // -------------------------------------------------------------------------

  describe("resource isolation", () => {
    test("two tree resources from different HttpClients are independent", async () => {
      const tree1 = makeTree({ apiKey: "key-alpha" });
      const tree2 = makeTree({ apiKey: "key-beta" });

      await tree1.get("homepage" as Slug);
      expect(lastRequest!.headers["authorization"]).toBe("Bearer key-alpha");

      await tree2.get("homepage" as Slug);
      expect(lastRequest!.headers["authorization"]).toBe("Bearer key-beta");
    });

    test("tree resource without apiKey does not leak auth from another", async () => {
      const authed = makeTree({ apiKey: "secret-key" });
      const unauthed = makeTree();

      await authed.get("homepage" as Slug);
      expect(lastRequest!.headers["authorization"]).toBe("Bearer secret-key");

      await unauthed.get("homepage" as Slug);
      expect(lastRequest!.headers["authorization"]).toBeUndefined();
    });
  });
});
