import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Session } from "./models";

const workers = vi.hoisted(() => ({
  enqueueWorkerJob: vi.fn(),
  callAiAccount: vi.fn(async () => ({ models: [] })),
}));
const storage = vi.hoisted(() => ({
  getObject: vi.fn(async () => Buffer.from("PK-test-pptx")),
  putObject: vi.fn(),
  deleteObject: vi.fn(),
}));
vi.mock("./workers", () => workers);
vi.mock("./storage", () => ({
  ...storage,
  storageNamespace: () => "integration-storageNamespace",
  accountPrefix: (account: string, document: string) =>
    `accounts/${Buffer.from(account).toString("base64url")}/documents/${document}`,
}));
vi.mock("./db", async (original) => ({
  ...(await original<typeof import("./db")>()),
  ensureSchema: async () => {},
}));

import { db } from "./db";
import {
  cancelNativeTurn,
  completeNativeScan,
  completeNativeTask,
  completeNativeTurn,
  executeNativeTool,
  failNativeScan,
  pollNativeSession,
  submitNativeTurn,
} from "./native-runtime";
import { signWopiToken } from "./wopi-token";
import { createNativeLaunch, wopiLock, wopiPutFile } from "./native-session";
import { requireNativeRequestSession } from "./native-request-auth";
import { authorizeNativeConnectorJob } from "./native-connector-auth";
import { POST as postNativeConnectorTool } from "../app/api/native/jobs/[jobId]/tools/route";
import { POST as postNativeConnectorCallback } from "../app/api/native/jobs/[jobId]/callback/route";

const enabled = process.env.SPELLBOOK_NATIVE_INTEGRATION === "1";
const schema = `spellbook_native_${randomUUID().replaceAll("-", "")}`;
const accountId = `native-owner-${randomUUID()}`;
const session: Session = {
  accountId,
  email: "owner@example.test",
  admin: true,
  token: "integration",
};

beforeAll(async () => {
  if (!enabled) return;
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://spellbook.integration.invalid");
  vi.stubEnv(
    "SPELLBOOK_WOPI_SECRET",
    "integration-wopi-secret-that-is-long-enough",
  );
  vi.stubEnv("SPELLBOOK_INTERNAL_TOKEN", "integration-internal-token");
  await db().unsafe(
    `create schema "${schema}"; set search_path to "${schema}"`,
  );
  const actual = await vi.importActual<typeof import("./db")>("./db");
  await actual.ensureSchema();
});
afterAll(async () => {
  if (!enabled) return;
  await db().unsafe(`drop schema if exists "${schema}" cascade`);
  await db().end();
  vi.unstubAllEnvs();
});

async function fixture() {
  const documentId = randomUUID();
  const versionId = randomUUID();
  const nativeSessionId = randomUUID();
  const graphObject = `accounts/${Buffer.from(accountId).toString("base64url")}/documents/${documentId}/versions/${versionId}/render/element-graph.json`;
  await db().begin(async (sql) => {
    await sql`insert into spellbook_documents (id,account_id,file_name,status,original_version_id,current_version_id)
      values (${documentId},${accountId},'native.pptx','ready',${versionId},${versionId})`;
    await sql`insert into spellbook_versions (id,document_id,kind,status,document_object,graph_object,document_sha256,slide_count)
      values (${versionId},${documentId},'original','ready','native/document.pptx',${graphObject},${"a".repeat(64)},1)`;
    await sql`insert into spellbook_native_sessions (id,document_id,account_id,account_email,working_version_id,working_sha256,status,expires_at)
      values (${nativeSessionId},${documentId},${accountId},${session.email},${versionId},${"a".repeat(64)},'active',now()+interval '1 hour')`;
  });
  return { documentId, versionId, nativeSessionId };
}

async function addPastNativeTurn(
  context: Awaited<ReturnType<typeof fixture>>,
  input: {
    request: string;
    response: string | null;
    status: "completed" | "failed" | "cancelled";
    createdAt: Date;
  },
) {
  const turnId = randomUUID();
  const jobId = randomUUID();
  await db().begin(async (sql) => {
    await sql`insert into spellbook_jobs
      (id,job_type,document_id,version_id,status,payload,created_at)
      values (${jobId},'native_turn',${context.documentId},${context.versionId},'succeeded',${sql.json({ historical: true })},${input.createdAt})`;
    await sql`insert into spellbook_native_turns
      (id,session_id,document_id,account_id,job_id,request_text,permission_mode,status,assistant_text,created_at)
      values (${turnId},${context.nativeSessionId},${context.documentId},${accountId},${jobId},${input.request},'document',${input.status},${input.response},${input.createdAt})`;
  });
}

const observation = {
  unit: "1/100mm",
  activeSlide: 0,
  selectedElementIds: ["0/0"],
  slides: [{ slideIndex: 0, elements: [{ elementId: "0/0", text: "현재" }] }],
  images: [{ slideIndex: 0, pngBytes: [137, 80, 78, 71, 13, 10, 26, 10] }],
};

describe.skipIf(!enabled)("durable native editor orchestration", () => {
  it("keeps document-scoped editor requests alive without the broader login cookie", async () => {
    const f = await fixture();
    const token = signWopiToken({
      version: 1,
      sessionId: f.nativeSessionId,
      documentId: f.documentId,
      accountId,
      expiresAt: Date.now() + 60_000,
    });
    const authenticated = await requireNativeRequestSession(
      new Request(`https://spellbook.integration.invalid/native`, {
        headers: { authorization: `Bearer ${token}` },
      }),
      f.documentId,
    );
    expect(authenticated).toMatchObject({
      accountId,
      email: session.email,
      admin: true,
    });
    await expect(
      requireNativeRequestSession(
        new Request(`https://spellbook.integration.invalid/native`, {
          headers: { authorization: `Bearer ${token}x` },
        }),
        f.documentId,
      ),
    ).rejects.toMatchObject({
      status: 401,
      message: "invalid_native_capability",
    });
  });

  it("distinguishes document processing from a permanent import failure", async () => {
    const processing = await fixture();
    await db()`update spellbook_documents set status='processing' where id=${processing.documentId}`;
    await expect(
      createNativeLaunch(session, processing.documentId),
    ).rejects.toMatchObject({ status: 409, message: "document_processing" });

    const failed = await fixture();
    await db().begin(async (sql) => {
      await sql`update spellbook_documents set status='failed',last_error='broken package' where id=${failed.documentId}`;
      await sql`update spellbook_versions set status='failed' where id=${failed.versionId}`;
    });
    await expect(
      createNativeLaunch(session, failed.documentId),
    ).rejects.toMatchObject({
      status: 422,
      message: "document_processing_failed",
    });
  });

  it("orders event cursors numerically after the identifier gains a digit", async () => {
    const f = await fixture();
    await db()`insert into spellbook_native_events (id,session_id,event_type,payload)
      values
        (900000000,${f.nativeSessionId},'tool',${db().json({ label: "before boundary" })}),
        (1000000000,${f.nativeSessionId},'tool',${db().json({ label: "after boundary" })})`;

    const polled = await pollNativeSession(session, f.documentId, 0);

    expect(polled.events.map((event) => event.id)).toEqual([
      900000000, 1000000000,
    ]);
  });

  it("enforces a WOPI lock and versions a save without overwriting the original", async () => {
    const f = await fixture();
    const token = signWopiToken({
      version: 1,
      sessionId: f.nativeSessionId,
      documentId: f.documentId,
      accountId,
      expiresAt: Date.now() + 60_000,
    });
    const url = `https://spellbook.integration.invalid/api/wopi/files/${f.documentId}?access_token=${encodeURIComponent(token)}`;
    expect(
      await wopiLock(
        new Request(url, {
          method: "POST",
          headers: { "x-wopi-override": "LOCK", "x-wopi-lock": "editor-lock" },
        }),
        f.documentId,
      ),
    ).toEqual({ status: 200 });
    expect(
      await wopiLock(
        new Request(url, {
          method: "POST",
          headers: { "x-wopi-override": "LOCK", "x-wopi-lock": "other-lock" },
        }),
        f.documentId,
      ),
    ).toEqual({ status: 409, lock: "editor-lock" });
    const savedBytes = Buffer.from("PK-new-native-document");
    const contentsUrl = new URL(url);
    contentsUrl.pathname += "/contents";
    await wopiPutFile(
      new Request(contentsUrl, {
        method: "POST",
        headers: { "x-wopi-lock": "editor-lock" },
        body: savedBytes,
      }),
      f.documentId,
    );
    expect(workers.enqueueWorkerJob.mock.calls.at(-1)?.[3]).toEqual(
      expect.objectContaining({
        inputObject: expect.stringContaining(
          `/documents/${f.documentId}/versions/`,
        ),
        baselineInputObject: "native/document.pptx",
        nativeSessionId: f.nativeSessionId,
      }),
    );
    expect(storage.putObject).toHaveBeenCalledWith(
      expect.stringContaining(`/documents/${f.documentId}/versions/`),
      savedBytes,
      expect.stringContaining("presentationml"),
    );
    const [document] =
      await db()`select current_version_id from spellbook_documents where id=${f.documentId}`;
    const [native] =
      await db()`select working_version_id,status from spellbook_native_sessions where id=${f.nativeSessionId}`;
    expect(document.current_version_id).toBe(f.versionId);
    expect(native).toMatchObject({ status: "validating" });
    expect(native.working_version_id).not.toBe(f.versionId);
  });

  it("leases one AI turn, redelivers a browser task safely, and records completion", async () => {
    const f = await fixture();
    const submitted = await submitNativeTurn(session, f.documentId, {
      text: "제목 변경",
      permission: "selection",
    });
    expect(workers.enqueueWorkerJob).toHaveBeenCalledWith(
      expect.any(String),
      "ai",
      "/internal/jobs/native",
      expect.objectContaining({ sessionId: f.nativeSessionId }),
    );
    const [turn] =
      await db()`select * from spellbook_native_turns where id=${submitted.turnId}`;
    const owner = {
      jobId: turn.job_id,
      sessionId: f.nativeSessionId,
      executionToken: "worker-1",
    };
    await executeNativeTool({ ...owner, operation: "start" });
    await expect(
      executeNativeTool({
        ...owner,
        executionToken: "worker-2",
        operation: "task_create",
        request: { operation: "observe" },
      }),
    ).rejects.toThrow("lease_lost");
    const created = (await executeNativeTool({
      ...owner,
      operation: "task_create",
      request: { operation: "observe" },
    })) as { taskId: string };
    const polled = await pollNativeSession(session, f.documentId, 0);
    expect(polled.task).toMatchObject({
      id: created.taskId,
      request: { operation: "observe" },
    });
    await completeNativeTask(session, f.documentId, {
      id: created.taskId,
      value: observation,
    });
    expect(
      await executeNativeTool({
        ...owner,
        operation: "task_status",
        taskId: created.taskId,
      }),
    ).toMatchObject({ status: "completed", result: observation });
    await executeNativeTool({
      ...owner,
      operation: "event",
      type: "tool",
      value: "슬라이드 수정",
    });
    const callback = {
      jobId: turn.job_id,
      status: "succeeded" as const,
      mode: "native" as const,
      result: {
        text: "수정했습니다.",
        changed: true,
        reviewed: true,
        status: "completed",
        executionToken: "worker-1",
      },
    };
    await completeNativeTurn({ id: turn.job_id }, callback);
    await completeNativeTurn({ id: turn.job_id }, callback);
    const final = await pollNativeSession(session, f.documentId, 0);
    expect(final.events.filter((event) => event.type === "done")).toHaveLength(
      1,
    );
  });

  it("hands a local subscription turn to the connector with only a job-scoped capability", async () => {
    const previousMode = process.env.SPELLBOOK_AI_CONNECTOR_MODE;
    process.env.SPELLBOOK_AI_CONNECTOR_MODE = "local";
    workers.enqueueWorkerJob.mockClear();
    try {
      const f = await fixture();
      const submitted = await submitNativeTurn(session, f.documentId, {
        text: "선택한 제목을 고쳐줘",
        permission: "selection",
        execution: "local",
      });
      expect(workers.enqueueWorkerJob).not.toHaveBeenCalled();
      expect(submitted.localJob).toMatchObject({
        mode: "native",
        sessionId: f.nativeSessionId,
        requestText: "선택한 제목을 고쳐줘",
        execution: "local",
      });
      expect(submitted.localJob?.capability).not.toBe(
        process.env.SPELLBOOK_INTERNAL_TOKEN,
      );
      expect(submitted.localJob?.toolUrl).toBe(
        `https://spellbook.integration.invalid/api/native/jobs/${submitted.localJob?.jobId}/tools`,
      );

      const polled = await pollNativeSession(session, f.documentId, 0);
      expect(workers.enqueueWorkerJob).not.toHaveBeenCalled();
      expect(polled.localJob).toMatchObject({
        jobId: submitted.localJob?.jobId,
        sessionId: f.nativeSessionId,
      });

      const jobId = String(submitted.localJob?.jobId);
      const authorized = await authorizeNativeConnectorJob(
        new Request(
          `https://spellbook.integration.invalid/api/native/jobs/${jobId}/tools`,
          {
            method: "POST",
            headers: {
              authorization: `Bearer ${submitted.localJob?.capability}`,
            },
          },
        ),
        jobId,
      );
      expect(authorized.id).toBe(jobId);
      await expect(
        authorizeNativeConnectorJob(
          new Request(
            `https://spellbook.integration.invalid/api/native/jobs/${jobId}/tools`,
            {
              method: "POST",
              headers: {
                authorization: `Bearer ${submitted.localJob?.capability}x`,
              },
            },
          ),
          jobId,
        ),
      ).rejects.toMatchObject({
        status: 401,
        message: "invalid_native_connector_capability",
      });

      const executionToken = "local-connector-execution";
      const toolResponse = await postNativeConnectorTool(
        new Request(
          `https://spellbook.integration.invalid/api/native/jobs/${jobId}/tools`,
          {
            method: "POST",
            headers: {
              authorization: `Bearer ${submitted.localJob?.capability}`,
              "content-type": "application/json",
            },
            body: JSON.stringify({
              jobId,
              sessionId: f.nativeSessionId,
              executionToken,
              operation: "start",
            }),
          },
        ),
        { params: Promise.resolve({ jobId }) },
      );
      expect(toolResponse.status).toBe(200);
      await expect(
        executeNativeTool({
          jobId,
          sessionId: f.nativeSessionId,
          executionToken,
          operation: "heartbeat",
        }),
      ).resolves.toEqual({ accepted: true });

      const callbackResponse = await postNativeConnectorCallback(
        new Request(
          `https://spellbook.integration.invalid/api/native/jobs/${jobId}/callback`,
          {
            method: "POST",
            headers: {
              authorization: `Bearer ${submitted.localJob?.capability}`,
              "content-type": "application/json",
            },
            body: JSON.stringify({
              jobId,
              status: "succeeded",
              mode: "native",
              result: {
                text: "로컬 구독으로 수정했습니다.",
                changed: true,
                reviewed: true,
                status: "completed",
                executionToken,
              },
            }),
          },
        ),
        { params: Promise.resolve({ jobId }) },
      );
      expect(callbackResponse.status).toBe(200);
      const final = await pollNativeSession(session, f.documentId, 0);
      expect(final.events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "done",
            text: "로컬 구독으로 수정했습니다.",
          }),
        ]),
      );
      await expect(
        authorizeNativeConnectorJob(
          new Request(
            `https://spellbook.integration.invalid/api/native/jobs/${jobId}/tools`,
            {
              headers: {
                authorization: `Bearer ${submitted.localJob?.capability}`,
              },
            },
          ),
          jobId,
        ),
      ).rejects.toMatchObject({
        status: 409,
        message: "native_connector_job_inactive",
      });
    } finally {
      if (previousMode === undefined)
        delete process.env.SPELLBOOK_AI_CONNECTOR_MODE;
      else process.env.SPELLBOOK_AI_CONNECTOR_MODE = previousMode;
    }
  });

  it.each(["local", "internal"] as const)(
    "fails an interrupted %s connector turn without replaying a possibly applied edit",
    async (execution) => {
      const previousMode = process.env.SPELLBOOK_AI_CONNECTOR_MODE;
      process.env.SPELLBOOK_AI_CONNECTOR_MODE = execution;
      try {
        const f = await fixture();
        const submitted = await submitNativeTurn(session, f.documentId, {
          text: "제목을 바꿔줘",
          permission: "document",
          execution,
        });
        const [created] =
          await db()`select job_id from spellbook_native_turns where id=${submitted.turnId}`;
        const jobId = String(created.job_id);
        const executionToken = `interrupted-${execution}-connector`;
        await executeNativeTool({
          jobId,
          sessionId: f.nativeSessionId,
          executionToken,
          operation: "start",
        });
        const task = (await executeNativeTool({
          jobId,
          sessionId: f.nativeSessionId,
          executionToken,
          operation: "task_create",
          request: { operation: "observe" },
        })) as { taskId: string };
        await db()`update spellbook_jobs set heartbeat_at=now()-interval '10 minutes' where id=${jobId}`;

        const recovered = await pollNativeSession(session, f.documentId, 0);
        expect(recovered.events).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              type: "error",
              error:
                expect.stringContaining("현재 슬라이드와 변경 내용을 확인"),
            }),
          ]),
        );
        const [job] =
          await db()`select status,error from spellbook_jobs where id=${jobId}`;
        const [turn] =
          await db()`select status,last_error from spellbook_native_turns where job_id=${jobId}`;
        const [expiredTask] =
          await db()`select status,error from spellbook_native_tasks where id=${task.taskId}`;
        expect(job).toMatchObject({
          status: "failed",
          error: "native_agent_interrupted",
        });
        expect(turn).toMatchObject({
          status: "failed",
          last_error: expect.stringContaining("다시 요청"),
        });
        expect(expiredTask).toMatchObject({
          status: "expired",
          error: "native_agent_interrupted",
        });
        await expect(
          executeNativeTool({
            jobId,
            sessionId: f.nativeSessionId,
            executionToken,
            operation: "event",
            type: "tool",
            value: "late event",
          }),
        ).rejects.toThrow("native_agent_lease_lost");

        const retry = await submitNativeTurn(session, f.documentId, {
          text: "현재 화면을 보고 계속해줘",
          permission: "document",
          execution,
        });
        const [replacement] =
          await db()`select job_id from spellbook_native_turns where id=${retry.turnId}`;
        expect(replacement.job_id).not.toBe(jobId);
      } finally {
        if (previousMode === undefined)
          delete process.env.SPELLBOOK_AI_CONNECTOR_MODE;
        else process.env.SPELLBOOK_AI_CONNECTOR_MODE = previousMode;
      }
    },
  );

  it("dispatches bounded durable history in chronological order", async () => {
    workers.enqueueWorkerJob.mockClear();
    const f = await fixture();
    await addPastNativeTurn(f, {
      request: "첫 요청",
      response: "첫 응답",
      status: "completed",
      createdAt: new Date(Date.now() - 2_000),
    });
    await addPastNativeTurn(f, {
      request: "두 번째 요청",
      response: null,
      status: "failed",
      createdAt: new Date(Date.now() - 1_000),
    });

    await submitNativeTurn(session, f.documentId, {
      text: "다시 확인해줘",
      permission: "read_only",
    });

    expect(workers.enqueueWorkerJob).toHaveBeenCalledWith(
      expect.any(String),
      "ai",
      "/internal/jobs/native",
      expect.objectContaining({
        conversationHistory: [
          { request: "첫 요청", response: "첫 응답", status: "completed" },
          { request: "두 번째 요청", response: null, status: "failed" },
        ],
      }),
    );
  });

  it("admits a generated image only through a leased edit turn and binds it to the open document", async () => {
    const f = await fixture();
    const submitted = await submitNativeTurn(session, f.documentId, {
      text: "이미지를 만들어 추가",
      permission: "document",
    });
    const [turn] =
      await db()`select * from spellbook_native_turns where id=${submitted.turnId}`;
    const owner = {
      jobId: turn.job_id,
      sessionId: f.nativeSessionId,
      executionToken: "image-worker",
    };
    await executeNativeTool({ ...owner, operation: "start" });
    const png = await sharp({
      create: {
        width: 8,
        height: 8,
        channels: 4,
        background: { r: 210, g: 71, b: 38, alpha: 1 },
      },
    })
      .png()
      .toBuffer();
    const asset = (await executeNativeTool({
      ...owner,
      operation: "asset_create",
      mediaType: "image/png",
      data: png.toString("base64"),
    })) as { assetId: string };

    expect(asset.assetId).toMatch(/^[0-9a-f-]{36}$/i);
    const [stored] =
      await db()`select document_id,content_type,object_name from spellbook_assets where id=${asset.assetId}`;
    expect(stored).toMatchObject({
      document_id: f.documentId,
      content_type: "image/png",
    });
    expect(stored.object_name).toMatch(/\.png$/);
    expect(storage.putObject).toHaveBeenCalledWith(
      stored.object_name,
      png,
      "image/png",
    );
  });

  it("cancellation prevents a late worker from completing the turn", async () => {
    const f = await fixture();
    const submitted = await submitNativeTurn(session, f.documentId, {
      text: "중단",
      permission: "document",
    });
    const [turn] =
      await db()`select * from spellbook_native_turns where id=${submitted.turnId}`;
    await executeNativeTool({
      jobId: turn.job_id,
      sessionId: f.nativeSessionId,
      executionToken: "worker",
      operation: "start",
    });
    await cancelNativeTurn(session, f.documentId);
    await completeNativeTurn(
      { id: turn.job_id },
      {
        jobId: turn.job_id,
        status: "succeeded",
        mode: "native",
        result: {
          text: "늦은 결과",
          changed: true,
          reviewed: true,
          executionToken: "worker",
        },
      },
    );
    const [after] =
      await db()`select status from spellbook_native_turns where id=${turn.id}`;
    expect(after.status).toBe("cancelled");
  });

  it("promotes only a validated latest native save and fails closed", async () => {
    const f = await fixture();
    const saved = randomUUID();
    const jobId = randomUUID();
    await db().begin(async (sql) => {
      await sql`insert into spellbook_versions (id,document_id,parent_version_id,kind,status,document_object)
        values (${saved},${f.documentId},${f.versionId},'approved','processing','native/saved.pptx')`;
      await sql`insert into spellbook_jobs (id,job_type,document_id,version_id,status,payload)
        values (${jobId},'scan_render',${f.documentId},${saved},'queued',${sql.json({ nativeSessionId: f.nativeSessionId })})`;
      await sql`update spellbook_native_sessions set working_version_id=${saved},status='validating' where id=${f.nativeSessionId}`;
    });
    const callback = {
      jobId,
      status: "succeeded" as const,
      outputs: {
        graphObject: "native/graph.json",
        scanObject: "native/scan.json",
        documentSha256: "b".repeat(64),
        slideCount: 1,
      },
    };
    await completeNativeScan(
      {
        id: jobId,
        version_id: saved,
        payload: { nativeSessionId: f.nativeSessionId },
      },
      callback,
    );
    const [document] =
      await db()`select current_version_id from spellbook_documents where id=${f.documentId}`;
    expect(document.current_version_id).toBe(saved);

    const failed = randomUUID();
    const failedJob = randomUUID();
    await db().begin(async (sql) => {
      await sql`insert into spellbook_versions (id,document_id,parent_version_id,kind,status,document_object)
        values (${failed},${f.documentId},${saved},'approved','processing','native/failed.pptx')`;
      await sql`insert into spellbook_jobs (id,job_type,document_id,version_id,status,payload)
        values (${failedJob},'scan_render',${f.documentId},${failed},'queued',${sql.json({ nativeSessionId: f.nativeSessionId })})`;
      await sql`update spellbook_native_sessions set working_version_id=${failed},status='validating' where id=${f.nativeSessionId}`;
    });
    await failNativeScan(
      {
        id: failedJob,
        version_id: failed,
        payload: { nativeSessionId: f.nativeSessionId },
      },
      "invalid package",
    );
    const [unchanged] =
      await db()`select current_version_id from spellbook_documents where id=${f.documentId}`;
    const [native] =
      await db()`select status from spellbook_native_sessions where id=${f.nativeSessionId}`;
    expect(unchanged.current_version_id).toBe(saved);
    expect(native.status).toBe("failed");
    await expect(
      pollNativeSession(session, f.documentId, 0),
    ).resolves.toMatchObject({
      session: { status: "failed", error: "invalid package" },
    });
  });
});
