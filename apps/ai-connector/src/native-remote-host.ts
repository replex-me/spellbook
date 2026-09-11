import type { NativeHost, NativeObservation } from "./native-agent.js";
import type { GeneratedImage } from "./app-server-client.js";

interface Identity {
  jobId: string;
  sessionId: string;
  executionToken: string;
}

export class NativeRemoteHost implements NativeHost {
  constructor(
    private readonly url: string,
    private readonly identity: Identity,
  ) {}

  async start(signal: AbortSignal): Promise<void> {
    await this.post({ operation: "start" }, signal);
  }

  async call(
    request: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<NativeObservation> {
    const created = (await this.post(
      { operation: "task_create", request },
      signal,
    )) as { taskId?: string };
    if (!created.taskId) throw new Error("native_task_not_created");
    const deadline = Date.now() + 25_000;
    while (Date.now() < deadline) {
      const task = (await this.post(
        { operation: "task_status", taskId: created.taskId },
        signal,
      )) as { status?: string; result?: NativeObservation; error?: string };
      if (task.status === "completed" && task.result) return task.result;
      if (["failed", "expired"].includes(task.status ?? ""))
        throw new Error(task.error || "native_document_operation_failed");
      await wait(250, signal);
    }
    throw new Error("native_document_operation_timed_out");
  }

  async createImage(
    image: GeneratedImage,
    signal: AbortSignal,
  ): Promise<{ assetId: string }> {
    return (await this.post(
      {
        operation: "asset_create",
        mediaType: image.mediaType,
        data: image.bytes.toString("base64"),
      },
      signal,
    )) as { assetId: string };
  }

  async event(type: "delta" | "tool", value: string, signal: AbortSignal) {
    await this.post({ operation: "event", type, value }, signal);
  }

  private async post(body: Record<string, unknown>, signal: AbortSignal) {
    const response = await fetch(this.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(process.env.SPELLBOOK_INTERNAL_TOKEN
          ? {
              "x-spellbook-internal-token":
                process.env.SPELLBOOK_INTERNAL_TOKEN,
            }
          : {}),
      },
      body: JSON.stringify({ ...this.identity, ...body }),
      signal,
    });
    const value = (await response.json()) as Record<string, unknown>;
    if (!response.ok)
      throw new Error(
        typeof value.error === "string"
          ? value.error
          : `native_tool_${response.status}`,
      );
    return value;
  }
}

function wait(milliseconds: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) return reject(new Error("cancelled"));
    const timer = setTimeout(done, milliseconds);
    function done() {
      signal.removeEventListener("abort", cancel);
      resolve();
    }
    function cancel() {
      clearTimeout(timer);
      reject(new Error("cancelled"));
    }
    signal.addEventListener("abort", cancel, { once: true });
  });
}
