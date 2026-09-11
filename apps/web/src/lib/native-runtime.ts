import { randomUUID } from "node:crypto";

import { db, ensureSchema } from "./db";
import { HttpError } from "./http";
import type { Session, WorkerCallback } from "./models";
import {
  parseModelSettings,
  supportsSettings,
  type AvailableModel,
} from "./ai-models";
import { callAiAccount, enqueueWorkerJob } from "./workers";
import { saveImageAsset } from "./image-assets";
import { storageNamespace } from "./storage";
import { internalAppBaseUrl } from "./runtime-urls";

type PermissionMode = "read_only" | "selection" | "slides" | "document";

async function ownedSession(
  session: Session,
  documentId: string,
  sessionId?: string,
  includeFailed = false,
) {
  await ensureSchema();
  const [row] = await db()`
    select s.*, coalesce(working.graph_object,current.graph_object) as graph_object from spellbook_native_sessions s
    join spellbook_documents d on d.id=s.document_id and d.account_id=s.account_id
    join spellbook_versions current on current.id=d.current_version_id
    left join spellbook_versions working on working.id=s.working_version_id
    where s.document_id=${documentId} and s.account_id=${session.accountId}
      and (${sessionId ?? null}::uuid is null or s.id=${sessionId ?? null})
      and (s.status in ('active','validating') or (${includeFailed} and s.status='failed'))
      and s.expires_at > now()
  `;
  if (!row) throw new HttpError(409, "native_session_not_active");
  return row;
}

export async function nativeModels(session: Session, documentId?: string) {
  if (documentId) await ownedSession(session, documentId);
  return callAiAccount("/internal/models", session.email) as Promise<{
    models: AvailableModel[];
  }>;
}

export async function submitNativeTurn(
  session: Session,
  documentId: string,
  input: { text?: unknown; permission?: unknown; modelSettings?: unknown },
) {
  const native = await ownedSession(session, documentId);
  const text = typeof input.text === "string" ? input.text.trim() : "";
  if (!text || text.length > 2_000)
    throw new HttpError(400, "invalid_native_request");
  const permission = input.permission as PermissionMode;
  if (!["read_only", "selection", "slides", "document"].includes(permission))
    throw new HttpError(400, "invalid_native_permission");
  const modelSettings = parseModelSettings(input.modelSettings);
  if (!native.graph_object)
    throw new HttpError(409, "native_document_context_not_ready");
  if (modelSettings) {
    const catalog = await nativeModels(session, documentId);
    if (!supportsSettings(catalog.models, modelSettings))
      throw new HttpError(400, "selected_model_unavailable");
  }
  const jobId = randomUUID();
  const turnId = randomUUID();
  const payload = {
    jobId,
    callbackUrl: `${internalAppBaseUrl()}/api/internal/jobs/callback`,
    toolUrl: `${internalAppBaseUrl()}/api/internal/native/tools`,
    sessionId: native.id,
    turnId,
    email: session.email,
    storageNamespace: storageNamespace(),
    baseGraphObject: native.graph_object,
    mode: "native",
    requestText: text,
    permissionMode: permission,
    ...(modelSettings ? { modelSettings } : {}),
  };
  await db().begin(async (sql) => {
    await sql`select id from spellbook_native_sessions where id=${native.id} for update`;
    const [active] = await sql`
      select id from spellbook_native_turns where session_id=${native.id}
        and status in ('queued','running') for update
    `;
    if (active) throw new HttpError(409, "native_turn_already_running");
    await sql`
      insert into spellbook_jobs (id,job_type,document_id,version_id,status,payload)
      values (${jobId},'native_turn',${documentId},${native.working_version_id},'queued',${sql.json(payload as any)})
    `;
    await sql`
      insert into spellbook_native_turns
        (id,session_id,document_id,account_id,job_id,request_text,permission_mode,model_settings,status)
      values (${turnId},${native.id},${documentId},${session.accountId},${jobId},${text},${permission},${modelSettings ? sql.json(modelSettings as any) : null},'queued')
    `;
    await sql`
      insert into spellbook_native_events (session_id,turn_id,event_type,payload)
      values (${native.id},${turnId},'start',${sql.json({ text })})
    `;
  });
  try {
    await enqueueWorkerJob(jobId, "ai", "/internal/jobs/native", payload);
    await db()`update spellbook_jobs set dispatched_at=now() where id=${jobId}`;
  } catch (descobrir) {
    const error =
      descobrir instanceof Error ? descobrir.message : "dispatch_failed";
    await failNativeTurn(jobId, error);
    throw new HttpError(503, "native_ai_unavailable");
  }
  return { accepted: true, turnId };
}

export async function pollNativeSession(
  session: Session,
  documentId: string,
  after: number,
) {
  const native = await ownedSession(session, documentId, undefined, true);
  if (!Number.isSafeInteger(after) || after < 0)
    throw new HttpError(400, "invalid_event_cursor");
  const pending = await db()`select id,job_type,payload from spellbook_jobs
    where document_id=${documentId} and status='queued' and dispatched_at is null
      and job_type in ('native_turn','scan_render') order by created_at limit 2`;
  for (const job of pending) {
    const target = job.job_type === "native_turn" ? "ai" : "document";
    const path =
      job.job_type === "native_turn"
        ? "/internal/jobs/native"
        : "/internal/jobs/scan-render";
    try {
      await enqueueWorkerJob(job.id, target, path, job.payload);
      await db()`update spellbook_jobs set dispatched_at=now(),error=null,updated_at=now()
        where id=${job.id} and status='queued' and dispatched_at is null`;
    } catch (error) {
      await db()`update spellbook_jobs set error=${error instanceof Error ? error.message : "dispatch_failed"},updated_at=now()
        where id=${job.id} and status='queued'`;
    }
  }
  await db()`update spellbook_native_tasks set status='expired', updated_at=now()
    where session_id=${native.id} and status in ('queued','delivered') and expires_at <= now()`;
  const task = await db().begin(async (sql) => {
    const [candidate] = await sql`
      select id, request from spellbook_native_tasks
      where session_id=${native.id} and expires_at > now()
        and (status='queued' or (status='delivered' and delivered_at < now() - interval '8 seconds'))
      order by created_at limit 1 for update skip locked
    `;
    if (!candidate) return null;
    await sql`update spellbook_native_tasks set status='delivered', delivered_at=now(),
      delivery_count=delivery_count+1, updated_at=now() where id=${candidate.id}`;
    return { id: candidate.id, request: candidate.request };
  });
  const events = await db()`
    select id::text, event_type as type, payload
    from spellbook_native_events where session_id=${native.id} and id>${after}
    order by spellbook_native_events.id limit 200
  `;
  return {
    task,
    events: events.map((event) => ({
      id: Number(event.id),
      type: event.type,
      ...event.payload,
    })),
    session: {
      status: native.status,
      saveRevision: native.save_revision,
      error: native.last_error,
    },
  };
}

function validObservation(value: unknown): boolean {
  const item = value as Record<string, unknown> | null;
  if (
    !item ||
    item.unit !== "1/100mm" ||
    !Array.isArray(item.slides) ||
    item.slides.length > 500
  )
    return false;
  if (
    !Array.isArray(item.selectedElementIds) ||
    !Number.isInteger(item.activeSlide)
  )
    return false;
  if (!Array.isArray(item.images) || item.images.length > 10) return false;
  return item.images.every((image) => {
    const candidate = image as Record<string, unknown>;
    return (
      Number.isInteger(candidate.slideIndex) &&
      Array.isArray(candidate.pngBytes) &&
      candidate.pngBytes.length <= 12_000_000 &&
      candidate.pngBytes.every(
        (byte) => Number.isInteger(byte) && byte >= -128 && byte <= 255,
      )
    );
  });
}

export async function completeNativeTask(
  session: Session,
  documentId: string,
  input: { id?: unknown; value?: unknown; error?: unknown },
) {
  const native = await ownedSession(session, documentId);
  if (typeof input.id !== "string" || !/^[0-9a-f-]{36}$/i.test(input.id))
    throw new HttpError(400, "invalid_native_task");
  const error =
    typeof input.error === "string" ? input.error.slice(0, 1_000) : null;
  if (!error && !validObservation(input.value))
    throw new HttpError(400, "invalid_native_result");
  const [updated] = await db()`
    update spellbook_native_tasks set status=${error ? "failed" : "completed"},
      result=${error ? null : db().json(input.value as never)}, error=${error}, updated_at=now()
    where id=${input.id} and session_id=${native.id} and status in ('queued','delivered')
      and expires_at > now() returning id
  `;
  if (!updated) throw new HttpError(409, "native_task_inactive");
  return { ok: true };
}

export async function cancelNativeTurn(session: Session, documentId: string) {
  const native = await ownedSession(session, documentId);
  const [turn] =
    await db()`select job_id from spellbook_native_turns where session_id=${native.id}
    and status in ('queued','running') order by created_at desc limit 1`;
  if (!turn) throw new HttpError(409, "no_active_native_turn");
  await db().begin(async (sql) => {
    await sql`update spellbook_native_turns set status='cancelled', last_error='사용자가 작업을 중단했습니다.', updated_at=now() where job_id=${turn.job_id}`;
    await sql`update spellbook_jobs set status='failed', error='user_cancelled', updated_at=now() where id=${turn.job_id} and status in ('queued','running')`;
    await sql`update spellbook_native_tasks set status='expired', error='user_cancelled', updated_at=now() where turn_id=(select id from spellbook_native_turns where job_id=${turn.job_id}) and status in ('queued','delivered')`;
    await sql`insert into spellbook_native_events (session_id,turn_id,event_type,payload)
      select session_id,id,'error',${sql.json({ error: "작업을 중단했습니다." })} from spellbook_native_turns where job_id=${turn.job_id}`;
  });
  return { ok: true };
}

export async function executeNativeTool(input: Record<string, unknown>) {
  await ensureSchema();
  const jobId = typeof input.jobId === "string" ? input.jobId : "";
  const sessionId = typeof input.sessionId === "string" ? input.sessionId : "";
  const executionToken =
    typeof input.executionToken === "string" ? input.executionToken : "";
  if (!jobId || !sessionId || !executionToken || executionToken.length > 100)
    throw new HttpError(400, "invalid_native_tool_identity");
  if (input.operation === "start") {
    const [claimed] =
      await db()`update spellbook_jobs set status='running', execution_token=${executionToken}, heartbeat_at=now(), updated_at=now()
      where id=${jobId} and job_type='native_turn' and status in ('queued','running')
        and (execution_token is null or execution_token=${executionToken} or heartbeat_at < now() - interval '60 seconds')
        and payload->>'sessionId'=${sessionId} returning id`;
    if (!claimed) throw new HttpError(409, "native_agent_already_running");
    await db()`update spellbook_native_turns set status='running', updated_at=now() where job_id=${jobId} and status='queued'`;
    return { accepted: true };
  }
  const [lease] =
    await db()`update spellbook_jobs set heartbeat_at=now() where id=${jobId}
    and job_type='native_turn' and status='running' and execution_token=${executionToken}
    and payload->>'sessionId'=${sessionId} returning payload`;
  if (!lease) throw new HttpError(409, "native_agent_lease_lost");
  const turnId = lease.payload.turnId as string;
  if (input.operation === "asset_create") {
    const mediaType = input.mediaType;
    const encoded = typeof input.data === "string" ? input.data : "";
    if (
      !["image/png", "image/jpeg"].includes(String(mediaType)) ||
      !encoded ||
      encoded.length > 6_700_000 ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)
    )
      throw new HttpError(400, "invalid_generated_image");
    const bytes = Buffer.from(encoded, "base64");
    if (!bytes.length || bytes.length > 5_000_000)
      throw new HttpError(400, "invalid_generated_image");
    const [context] = await db()`
      select s.document_id, s.account_id, t.permission_mode
      from spellbook_native_sessions s
      join spellbook_native_turns t on t.id=${turnId} and t.session_id=s.id
      where s.id=${sessionId} and s.status in ('active','validating')
        and s.expires_at > now()
    `;
    if (!context) throw new HttpError(409, "native_session_not_active");
    if (!["slides", "document"].includes(context.permission_mode))
      throw new HttpError(403, "outside_edit_permission");
    const extension = mediaType === "image/png" ? "png" : "jpg";
    return saveImageAsset(
      context.account_id,
      context.document_id,
      bytes,
      `AI 생성 이미지.${extension}`,
    );
  }
  if (input.operation === "task_create") {
    if (!input.request || typeof input.request !== "object")
      throw new HttpError(400, "invalid_native_request");
    const serialized = JSON.stringify(input.request);
    if (serialized.length > 200_000)
      throw new HttpError(400, "native_request_too_large");
    const id = randomUUID();
    await db()`insert into spellbook_native_tasks (id,session_id,turn_id,request,status,expires_at)
      values (${id},${sessionId},${turnId},${db().json(input.request as never)},'queued',now()+interval '25 seconds')`;
    return { taskId: id };
  }
  if (input.operation === "task_status") {
    const taskId = typeof input.taskId === "string" ? input.taskId : "";
    const [task] =
      await db()`select status,result,error from spellbook_native_tasks
      where id=${taskId} and session_id=${sessionId} and turn_id=${turnId}`;
    if (!task) throw new HttpError(404, "native_task_not_found");
    return task;
  }
  if (input.operation === "event") {
    const type = input.type;
    const value = typeof input.value === "string" ? input.value : "";
    if (!["delta", "tool"].includes(String(type)) || value.length > 4_000)
      throw new HttpError(400, "invalid_native_event");
    await db()`insert into spellbook_native_events (session_id,turn_id,event_type,payload)
      values (${sessionId},${turnId},${String(type)},${db().json({ [type === "delta" ? "delta" : "label"]: value })})`;
    return { accepted: true };
  }
  throw new HttpError(400, "invalid_native_tool_operation");
}

export async function completeNativeTurn(
  job: Record<string, any>,
  callback: WorkerCallback,
) {
  const result = callback.result as Record<string, unknown> | undefined;
  const text = typeof result?.text === "string" ? result.text.trim() : "";
  const changed = result?.changed as boolean;
  const reviewed = result?.reviewed as boolean;
  const executionToken =
    typeof result?.executionToken === "string" ? result.executionToken : "";
  if (
    !text ||
    text.length > 8_000 ||
    typeof changed !== "boolean" ||
    typeof reviewed !== "boolean" ||
    !executionToken
  )
    throw new Error("invalid_native_completion");
  await db().begin(async (sql) => {
    const [claimed] =
      await sql`update spellbook_jobs set status='succeeded', outputs=${sql.json(callback as any)}, updated_at=now()
      where id=${job.id} and status in ('queued','running') and execution_token=${executionToken} returning id`;
    if (!claimed) return;
    const [turn] =
      await sql`update spellbook_native_turns set status='completed', assistant_text=${text},
      changed=${changed}, reviewed=${reviewed}, updated_at=now() where job_id=${job.id} returning id,session_id`;
    await sql`insert into spellbook_native_events (session_id,turn_id,event_type,payload)
      values (${turn.session_id},${turn.id},'done',${sql.json({ text, changed, reviewed, status: typeof result?.status === "string" ? result.status : "completed" })})`;
  });
}

export async function failNativeTurn(jobId: string, error: string) {
  await db().begin(async (sql) => {
    const [turn] =
      await sql`update spellbook_native_turns set status='failed', last_error=${error.slice(0, 1_000)}, updated_at=now()
      where job_id=${jobId} and status in ('queued','running') returning id,session_id`;
    await sql`update spellbook_jobs set status='failed',error=${error.slice(0, 1_000)},updated_at=now()
      where id=${jobId} and status in ('queued','running')`;
    if (turn)
      await sql`insert into spellbook_native_events (session_id,turn_id,event_type,payload)
      values (${turn.session_id},${turn.id},'error',${sql.json({ error: "AI 편집을 완료하지 못했습니다. 다시 시도하세요." })})`;
  });
}

export async function completeNativeScan(
  job: Record<string, any>,
  callback: WorkerCallback,
) {
  const outputs = callback.outputs;
  if (!outputs?.graphObject || !outputs.documentSha256 || !outputs.slideCount)
    throw new Error("native_scan_outputs_missing");
  await db().begin(async (sql) => {
    const [claimed] =
      await sql`update spellbook_jobs set status='succeeded',outputs=${sql.json(callback as never)},updated_at=now()
      where id=${job.id} and status in ('queued','running') returning id`;
    if (!claimed) return;
    await sql`update spellbook_versions set status='ready',graph_object=${outputs.graphObject},scan_object=${outputs.scanObject ?? null},
      document_sha256=${outputs.documentSha256},slide_count=${outputs.slideCount} where id=${job.version_id}`;
    const [session] =
      await sql`update spellbook_native_sessions set status='active',last_error=null,updated_at=now()
      where id=${job.payload.nativeSessionId} and working_version_id=${job.version_id}
      returning document_id,working_version_id`;
    if (session) {
      await sql`update spellbook_documents set current_version_id=${session.working_version_id},status='ready',last_error=null,updated_at=now()
        where id=${session.document_id}`;
    }
  });
}

export async function failNativeScan(job: Record<string, any>, error: string) {
  await db().begin(async (sql) => {
    await sql`update spellbook_jobs set status='failed',error=${error.slice(0, 1_000)},updated_at=now()
      where id=${job.id} and status in ('queued','running')`;
    await sql`update spellbook_versions set status='failed',kind='abandoned' where id=${job.version_id} and status='processing'`;
    await sql`update spellbook_native_sessions set status='failed',last_error=${error.slice(0, 1_000)},updated_at=now()
      where id=${job.payload.nativeSessionId} and working_version_id=${job.version_id}`;
  });
}
