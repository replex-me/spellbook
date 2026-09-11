import { describe, expect, it, vi } from "vitest";

import {
  buildPptxEditorUrl,
  createOfficeDiscoveryResolver,
  parsePptxEditorActionUrl,
  validateOfficeEditorActionUrl,
  warmOfficeEditor,
} from "./native-session";

const discoveryXml = `
  <wopi-discovery><net-zone name="external-https">
    <app name="impress"><action ext="pptx" name="edit"
      urlsrc="https://office.example/browser/hash/cool.html?ui=default&amp;"/>
    </app>
  </net-zone></wopi-discovery>`;

describe("Collabora WOPI discovery", () => {
  it("finds the PPTX edit action regardless of app and action attribute order", () => {
    const xml = `
      <wopi-discovery><net-zone name="external-https">
        <app favIconUrl="https://office.example/icon.svg" name="impress">
          <action default="true" ext="pptx" name="edit"
            urlsrc="https://office.example/browser/hash/cool.html?ui=default&amp;"/>
        </app>
      </net-zone></wopi-discovery>`;

    expect(parsePptxEditorActionUrl(xml)).toBe(
      "https://office.example/browser/hash/cool.html?ui=default&",
    );
  });

  it("fails closed when no Impress PPTX editor is advertised", () => {
    expect(() =>
      parsePptxEditorActionUrl(
        '<wopi-discovery><app name="writer"><action ext="pptx" name="view" urlsrc="https://office.example/view"/></app></wopi-discovery>',
      ),
    ).toThrow("office_pptx_editor_not_discovered");
  });

  it("opens the editor in Korean regardless of browser locale or discovery defaults", () => {
    const url = new URL(
      buildPptxEditorUrl(
        "https://office.example/browser/hash/cool.html?ui=default&",
        "https://spellbook.example/api/wopi/files/document-1",
      ),
    );

    expect(url.searchParams.get("lang")).toBe("ko-KR");
    expect(url.searchParams.get("ui")).toBe("ko-KR");
    expect(url.searchParams.get("rs")).toBe("ko-KR");
    expect(url.searchParams.get("WOPISrc")).toBe(
      "https://spellbook.example/api/wopi/files/document-1",
    );
  });

  it("shares one cold-start discovery request and caches the result", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fetcher = vi.fn(async () => {
      await gate;
      return new Response(discoveryXml);
    }) as unknown as typeof fetch;
    const resolve = createOfficeDiscoveryResolver(fetcher, 75_000);

    const first = resolve("https://office.example");
    const second = resolve("https://office.example");
    expect(fetcher).toHaveBeenCalledTimes(1);
    release();

    await expect(Promise.all([first, second])).resolves.toEqual([
      "https://office.example/browser/hash/cool.html?ui=default&",
      "https://office.example/browser/hash/cool.html?ui=default&",
    ]);
    await expect(resolve("https://office.example")).resolves.toContain(
      "/browser/hash/cool.html",
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("reports a sleeping office service as a retryable launch state", async () => {
    const fetcher = vi.fn(async () => {
      throw new DOMException("timed out", "TimeoutError");
    }) as unknown as typeof fetch;
    const resolve = createOfficeDiscoveryResolver(fetcher, 1);

    await expect(resolve("https://office.example")).rejects.toMatchObject({
      status: 503,
      message: "office_editor_starting",
    });
  });

  it("accepts only a configured cool.html URL on the office origin", () => {
    expect(
      validateOfficeEditorActionUrl(
        "https://office.example/browser/hash/cool.html?ui=default&",
        "https://office.example",
      ),
    ).toContain("/cool.html");
    expect(() =>
      validateOfficeEditorActionUrl(
        "https://attacker.example/browser/hash/cool.html",
        "https://office.example",
      ),
    ).toThrow("office_discovery_origin_mismatch");
    expect(() =>
      validateOfficeEditorActionUrl(
        "https://office.example/browser/hash/bundle.js",
        "https://office.example",
      ),
    ).toThrow("office_editor_action_url_invalid");
  });

  it("warms the readiness endpoint without caching the response", async () => {
    const previous = process.env.SPELLBOOK_OFFICE_EDITOR_URL;
    process.env.SPELLBOOK_OFFICE_EDITOR_URL = "https://office.example";
    const fetcher = vi.fn(
      async () => new Response("ok"),
    ) as unknown as typeof fetch;
    try {
      await warmOfficeEditor(fetcher, 10);
      expect(fetcher).toHaveBeenCalledWith(
        "https://office.example/readyz",
        expect.objectContaining({ cache: "no-store" }),
      );
    } finally {
      if (previous === undefined)
        delete process.env.SPELLBOOK_OFFICE_EDITOR_URL;
      else process.env.SPELLBOOK_OFFICE_EDITOR_URL = previous;
    }
  });
});
