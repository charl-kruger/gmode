import { describe, expect, it } from "vitest";
import { healthFor } from "./health";

describe("healthFor", () => {
  it("returns dash when service is missing from the report", () => {
    expect(healthFor(null, "users")).toEqual({ label: "—", className: "" });
    expect(
      healthFor({ ok: true, services: [] }, "users"),
    ).toEqual({ label: "—", className: "" });
  });

  it("marks healthy services", () => {
    expect(
      healthFor(
        {
          ok: true,
          services: [{ name: "users", mount: "/users", ok: true, status: 200 }],
        },
        "users",
      ),
    ).toEqual({ label: "healthy", className: "ok" });
  });

  it("surfaces downstream errors", () => {
    expect(
      healthFor(
        {
          ok: false,
          services: [
            { name: "billing", mount: "/billing", ok: false, status: 503, error: "timeout" },
          ],
        },
        "billing",
      ),
    ).toEqual({ label: "timeout", className: "bad" });
  });
});
