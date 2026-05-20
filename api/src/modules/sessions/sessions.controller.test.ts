import { describe, expect, it, vi } from "vitest";
import { handleLaunchBrowserSession } from "./sessions.controller.js";
import browserSchemas from "./sessions.schema.js";

describe("sessions controller", () => {
  it("exposes dangerouslyLogRequestDetails in the create-session schema", () => {
    const result = browserSchemas.CreateSession.safeParse({
      dangerouslyLogRequestDetails: true,
    });

    expect(result.success).toBe(true);
    expect(result.success && result.data).toHaveProperty("dangerouslyLogRequestDetails", true);
  });

  it("passes dangerouslyLogRequestDetails from create-session requests to SessionService", async () => {
    const startSession = vi.fn().mockResolvedValue({ success: true });
    const server = {
      log: { error: vi.fn() },
      sessionService: { startSession },
    };
    const reply = {
      code: vi.fn().mockReturnThis(),
      send: vi.fn(),
    };

    await handleLaunchBrowserSession(
      server as any,
      {
        body: {
          sessionId: "00000000-0000-4000-8000-000000000000",
          dangerouslyLogRequestDetails: true,
        },
      } as any,
      reply as any,
    );

    expect(startSession).toHaveBeenCalledWith(
      expect.objectContaining({ dangerouslyLogRequestDetails: true }),
    );
  });
});
