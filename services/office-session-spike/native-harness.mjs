import { randomUUID } from "node:crypto";
import { runNativeTurn } from "../../apps/ai-connector/dist/native-agent.js";
import { AppServerClient } from "../../apps/ai-connector/dist/app-server-client.js";

// Local integration harness for the real subscription runner and real open
// editor. Production persistence/auth are deliberately NOT implemented here.
export function createNativeHarness({ probeEnabled = false } = {}) {
  const conversationKey = `native-local-${randomUUID()}`;
  let clientPromise, active;
  const tasks = new Map(),
    events = [];
  const emit = (type, data) =>
    events.push({ id: events.length + 1, type, ...data });
  const client = () => {
    const dir = process.env.SPELLBOOK_NATIVE_AI_HOME;
    if (!dir) throw new Error("로컬 검증용 AI 계정이 연결되지 않았습니다.");
    return (clientPromise ??= AppServerClient.start(dir));
  };
  const call = (request, signal) =>
    new Promise((resolve, reject) => {
      emit("native_request", {
        requestOperation: request.operation,
        commandOps:
          request.operation === "edit"
            ? [request.command?.op].filter(Boolean)
            : request.operation === "edit_batch"
              ? (request.commands ?? []).map((command) => command?.op)
              : [],
        dryRun:
          request.operation === "edit_batch" ? request.dryRun === true : null,
      });
      const id = randomUUID();
      const finish = (error, value) => {
        const entry = tasks.get(id);
        if (!entry) return;
        clearTimeout(entry.timer);
        signal.removeEventListener("abort", entry.abort);
        tasks.delete(id);
        error ? reject(error) : resolve(value);
      };
      const abort = () =>
        finish(
          new Error("편집 연결이 중단되었습니다. 현재 문서를 다시 확인하세요."),
        );
      if (signal.aborted) {
        reject(new Error("cancelled"));
        return;
      }
      const timeoutMs = request.operation === "observe" ? 60_000 : 20_000;
      const timer = setTimeout(
        () =>
          finish(
            new Error(
              "편집 응답을 확인하지 못했습니다. 명령을 자동 재실행하지 않았습니다.",
            ),
          ),
        timeoutMs,
      );
      tasks.set(id, {
        id,
        request: { ...request, expiresAt: Date.now() + timeoutMs - 1000 },
        sent: false,
        finish,
        timer,
        abort,
      });
      signal.addEventListener("abort", abort, { once: true });
    });
  const json = async (req) => {
    let size = 0;
    const chunks = [];
    for await (const chunk of req) {
      size += chunk.length;
      if (size > 16_000_000) throw new Error("요청이 너무 큽니다.");
      chunks.push(chunk);
    }
    return JSON.parse(Buffer.concat(chunks).toString());
  };
  return {
    async handle(url, req, reply) {
      if (!url.pathname.startsWith("/native/")) return false;
      try {
        if (
          probeEnabled &&
          url.pathname === "/native/probe" &&
          req.method === "POST"
        ) {
          const body = await json(req);
          const controller = new AbortController();
          reply(200, await call(body, controller.signal));
          return true;
        }
        if (url.pathname === "/native/models" && req.method === "GET") {
          const c = await client();
          const account = await c.accountRead();
          if (account.account?.type !== "chatgpt")
            throw new Error("구독 계정에 로그인해야 합니다.");
          reply(200, { models: await c.models() });
          return true;
        }
        if (url.pathname === "/native/poll" && req.method === "GET") {
          const task = [...tasks.values()].find((t) => !t.sent);
          if (task) task.sent = true;
          reply(200, {
            task: task ? { id: task.id, request: task.request } : null,
            events: events.filter(
              (e) => e.id > Number(url.searchParams.get("after") ?? 0),
            ),
          });
          return true;
        }
        if (url.pathname === "/native/result" && req.method === "POST") {
          const body = await json(req),
            task = tasks.get(body.id);
          if (!task) {
            reply(409, { error: "expired_task" });
            return true;
          }
          if (Array.isArray(body.value?.images))
            body.value.images = body.value.images.map((image) =>
              typeof image?.pngBase64 === "string"
                ? {
                    ...image,
                    pngBytes: [...Buffer.from(image.pngBase64, "base64")],
                    pngBase64: undefined,
                  }
                : image,
            );
          task.finish(
            body.error ? new Error(String(body.error)) : null,
            body.value,
          );
          reply(200, { ok: true });
          return true;
        }
        if (url.pathname === "/native/chat" && req.method === "POST") {
          if (active) {
            reply(409, { error: "이미 처리 중인 요청이 있습니다." });
            return true;
          }
          const body = await json(req);
          if (
            typeof body.text !== "string" ||
            !body.text.trim() ||
            body.text.length > 10000
          )
            throw new Error("수정 요청을 입력하세요.");
          if (!["read_only", "selection", "document"].includes(body.permission))
            throw new Error("편집 권한을 확인하세요.");
          const c = await client();
          active = new AbortController();
          const running = active;
          emit("start", { text: body.text });
          reply(202, { accepted: true });
          void (async () => {
            try {
              const initial = await call(
                { operation: "observe" },
                running.signal,
              );
              const permission = {
                mode: body.permission,
                slideIndexes: [],
                elementIds: initial.selectedElementIds,
              };
              const result = await runNativeTurn(c, {
                requestText: body.text,
                modelSettings: body.modelSettings,
                permission,
                conversationKey,
                host: { call },
                signal: running.signal,
                onText: (delta) => emit("delta", { delta }),
                onTool: (label) => emit("tool", { label }),
              });
              emit("done", result);
            } catch (error) {
              emit("error", { error: error.message });
            } finally {
              if (active === running) active = null;
            }
          })();
          return true;
        }
        if (url.pathname === "/native/cancel" && req.method === "POST") {
          active?.abort();
          reply(200, { ok: true });
          return true;
        }
        reply(404, { error: "not_found" });
        return true;
      } catch (error) {
        reply(400, { error: error.message });
        return true;
      }
    },
    async close() {
      active?.abort();
      for (const task of [...tasks.values()]) task.abort();
      const c = await clientPromise;
      if (c) c.close();
    },
  };
}
