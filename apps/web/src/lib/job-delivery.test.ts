import { describe, expect, it } from "vitest";

import { jobRedeliverySeconds } from "./job-delivery";

describe("durable local job delivery", () => {
  it("uses a bounded redelivery lease", () => {
    expect(jobRedeliverySeconds(undefined)).toBe(15);
    expect(jobRedeliverySeconds("5")).toBe(5);
    expect(jobRedeliverySeconds("900")).toBe(900);
    expect(() => jobRedeliverySeconds("4")).toThrow();
    expect(() => jobRedeliverySeconds("901")).toThrow();
    expect(() => jobRedeliverySeconds("1.5")).toThrow();
    expect(() => jobRedeliverySeconds("not-a-number")).toThrow();
  });
});
