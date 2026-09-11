import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  job: {} as Record<string, unknown>,
  queries: [] as string[],
}));
vi.mock("./db", () => {
  const sql = Object.assign(
    async (parts: TemplateStringsArray) => {
      const query = parts.join("?");
      state.queries.push(query);
      if (query.includes("select * from spellbook_jobs where id"))
        return [state.job];
      if (query.includes("returning id")) return [{ id: "job" }];
      return [];
    },
    { json: (value: unknown) => value },
  );
  return {
    ensureSchema: async () => {},
    db: () =>
      Object.assign(sql, {
        begin: async (fn: (tx: typeof sql) => unknown) => fn(sql),
      }),
  };
});
vi.mock("./storage", () => ({
  storageNamespace: vi.fn(),
  getJsonObject: vi.fn(),
  getObject: vi.fn(),
  putObject: vi.fn(),
}));
vi.mock("./workers", () => ({ enqueueWorkerJob: vi.fn() }));
import { handleWorkerCallback } from "./orchestration";

beforeEach(() => {
  state.queries = [];
  state.job = {
    id: "job",
    status: "running",
    version_id: "normal-base",
    document_id: "doc",
    edit_request_id: "edit",
  };
});
describe("failed jobs preserve usable document versions", () => {
  it.each(["ai_plan", "ai_review"])(
    "%s never invalidates its input version",
    async (job_type) => {
      state.job.job_type = job_type;
      await handleWorkerCallback({
        jobId: "job",
        status: "failed",
        error: "connection_lost",
      });
      expect(
        state.queries.some((query) =>
          query.includes("update spellbook_jobs set status = 'failed'"),
        ),
      ).toBe(true);
      const updates = state.queries.filter((query) =>
        query.includes("update spellbook_versions"),
      );
      expect(updates).toHaveLength(1);
      expect(updates[0]).toContain("job_type = 'patch_render'");
      expect(updates[0]).toContain("status = 'processing'");
      expect(updates[0]).toContain("kind = 'candidate'");
    },
  );
  it.each(["scan_render", "patch_render"])(
    "%s can fail only unfinished output versions",
    async (job_type) => {
      state.job.job_type = job_type;
      await handleWorkerCallback({
        jobId: "job",
        status: "failed",
        error: "render_failed",
      });
      const query = state.queries.find((query) =>
        query.includes("update spellbook_versions"),
      );
      expect(query).toContain("status = 'processing'");
      expect(query).toContain("kind in ('original', 'candidate')");
    },
  );
  it("ignores a late failure for an already successful job", async () => {
    state.job.status = "succeeded";
    await handleWorkerCallback({ jobId: "job", status: "failed" });
    expect(state.queries.some((query) => query.includes("update"))).toBe(false);
  });
});
