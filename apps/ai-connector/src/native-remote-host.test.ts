import { afterEach, describe, expect, it, vi } from "vitest";

import {
  maintainNativeRemoteLease,
  NativeRemoteHost,
} from "./native-remote-host.js";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("native remote host authorization", () => {
  it("uses the job capability only in an Authorization header and refuses redirects", async () => {
    vi.stubEnv("SPELLBOOK_INTERNAL_TOKEN", "must-not-leak");
    const fetcher = vi
      .fn()
      .mockResolvedValue(Response.json({ accepted: true }));
    vi.stubGlobal("fetch", fetcher);
    const host = new NativeRemoteHost(
      "https://spellbook.example/api/native/jobs/job/tools",
      {
        jobId: "job",
        sessionId: "session",
        executionToken: "execution",
      },
      "job-capability",
    );
    await host.start(new AbortController().signal);
    const [url, init] = fetcher.mock.calls[0] as [string, RequestInit];
    expect(url).not.toContain("job-capability");
    expect(init.headers).toMatchObject({
      authorization: "Bearer job-capability",
    });
    expect(init.headers).not.toHaveProperty("x-spellbook-internal-token");
    expect(init.redirect).toBe("error");
  });

  it("keeps a claimed native job alive independently of model output", async () => {
    const controller = new AbortController();
    const fetcher = vi.fn(async (_url: string, _init?: RequestInit) => {
      controller.abort();
      return Response.json({ accepted: true });
    });
    vi.stubGlobal("fetch", fetcher);
    const host = new NativeRemoteHost(
      "https://spellbook.example/api/internal/native/tools",
      {
        jobId: "job",
        sessionId: "session",
        executionToken: "execution",
      },
    );

    await maintainNativeRemoteLease(host, controller.signal, 1);

    expect(fetcher).toHaveBeenCalledTimes(1);
    const [, init] = fetcher.mock.calls[0];
    expect(JSON.parse(String(init?.body))).toMatchObject({
      jobId: "job",
      sessionId: "session",
      executionToken: "execution",
      operation: "heartbeat",
    });
  });
});
