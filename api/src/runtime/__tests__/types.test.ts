import { describe, it, expect } from "vitest";
import {
  isIdle,
  isLaunching,
  isLive,
  isDraining,
  isClosed,
  isError,
  assertIdle,
  assertLive,
  assertError,
  InvalidStateError,
  LaunchError,
  Session,
} from "../types.js";

describe("Type Guards", () => {
  const createMockSession = (state: string): Session => {
    return { _state: state } as Session;
  };

  describe("isIdle", () => {
    it("should return true for idle session", () => {
      const session = createMockSession("idle");
      expect(isIdle(session)).toBe(true);
    });

    it("should return false for non-idle sessions", () => {
      expect(isIdle(createMockSession("launching"))).toBe(false);
      expect(isIdle(createMockSession("live"))).toBe(false);
      expect(isIdle(createMockSession("draining"))).toBe(false);
      expect(isIdle(createMockSession("error"))).toBe(false);
      expect(isIdle(createMockSession("closed"))).toBe(false);
    });
  });

  describe("isLaunching", () => {
    it("should return true for launching session", () => {
      const session = createMockSession("launching");
      expect(isLaunching(session)).toBe(true);
    });

    it("should return false for non-launching sessions", () => {
      expect(isLaunching(createMockSession("idle"))).toBe(false);
      expect(isLaunching(createMockSession("live"))).toBe(false);
      expect(isLaunching(createMockSession("draining"))).toBe(false);
      expect(isLaunching(createMockSession("error"))).toBe(false);
      expect(isLaunching(createMockSession("closed"))).toBe(false);
    });
  });

  describe("isLive", () => {
    it("should return true for live session", () => {
      const session = createMockSession("live");
      expect(isLive(session)).toBe(true);
    });

    it("should return false for non-live sessions", () => {
      expect(isLive(createMockSession("idle"))).toBe(false);
      expect(isLive(createMockSession("launching"))).toBe(false);
      expect(isLive(createMockSession("draining"))).toBe(false);
      expect(isLive(createMockSession("error"))).toBe(false);
      expect(isLive(createMockSession("closed"))).toBe(false);
    });
  });

  describe("isDraining", () => {
    it("should return true for draining session", () => {
      const session = createMockSession("draining");
      expect(isDraining(session)).toBe(true);
    });

    it("should return false for non-draining sessions", () => {
      expect(isDraining(createMockSession("idle"))).toBe(false);
      expect(isDraining(createMockSession("launching"))).toBe(false);
      expect(isDraining(createMockSession("live"))).toBe(false);
      expect(isDraining(createMockSession("error"))).toBe(false);
      expect(isDraining(createMockSession("closed"))).toBe(false);
    });
  });

  describe("isClosed", () => {
    it("should return true for closed session", () => {
      const session = createMockSession("closed");
      expect(isClosed(session)).toBe(true);
    });

    it("should return false for non-closed sessions", () => {
      expect(isClosed(createMockSession("idle"))).toBe(false);
      expect(isClosed(createMockSession("launching"))).toBe(false);
      expect(isClosed(createMockSession("live"))).toBe(false);
      expect(isClosed(createMockSession("draining"))).toBe(false);
      expect(isClosed(createMockSession("error"))).toBe(false);
    });
  });

  describe("isError", () => {
    it("should return true for error session", () => {
      const session = createMockSession("error");
      expect(isError(session)).toBe(true);
    });

    it("should return false for non-error sessions", () => {
      expect(isError(createMockSession("idle"))).toBe(false);
      expect(isError(createMockSession("launching"))).toBe(false);
      expect(isError(createMockSession("live"))).toBe(false);
      expect(isError(createMockSession("draining"))).toBe(false);
      expect(isError(createMockSession("closed"))).toBe(false);
    });
  });
});

describe("Type Assertions", () => {
  const createMockSession = (state: string): Session => {
    return { _state: state } as Session;
  };

  describe("assertIdle", () => {
    it("should not throw for idle session", () => {
      const session = createMockSession("idle");
      expect(() => assertIdle(session)).not.toThrow();
    });

    it("should throw InvalidStateError for non-idle session", () => {
      const session = createMockSession("live");
      expect(() => assertIdle(session)).toThrow(InvalidStateError);
    });

    it("should include state info in error message", () => {
      const session = createMockSession("launching");
      try {
        assertIdle(session);
        expect.fail("Should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(InvalidStateError);
        expect((error as InvalidStateError).currentState).toBe("launching");
        expect((error as InvalidStateError).expectedState).toBe("idle");
      }
    });
  });

  describe("assertLive", () => {
    it("should not throw for live session", () => {
      const session = createMockSession("live");
      expect(() => assertLive(session)).not.toThrow();
    });

    it("should throw InvalidStateError for non-live session", () => {
      const session = createMockSession("idle");
      expect(() => assertLive(session)).toThrow(InvalidStateError);
    });

    it("should include state info in error message", () => {
      const session = createMockSession("draining");
      try {
        assertLive(session);
        expect.fail("Should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(InvalidStateError);
        expect((error as InvalidStateError).currentState).toBe("draining");
        expect((error as InvalidStateError).expectedState).toBe("live");
      }
    });
  });

  describe("assertError", () => {
    it("should not throw for error session", () => {
      const session = createMockSession("error");
      expect(() => assertError(session)).not.toThrow();
    });

    it("should throw InvalidStateError for non-error session", () => {
      const session = createMockSession("idle");
      expect(() => assertError(session)).toThrow(InvalidStateError);
    });

    it("should include state info in error message", () => {
      const session = createMockSession("closed");
      try {
        assertError(session);
        expect.fail("Should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(InvalidStateError);
        expect((error as InvalidStateError).currentState).toBe("closed");
        expect((error as InvalidStateError).expectedState).toBe("error");
      }
    });
  });
});

describe("InvalidStateError", () => {
  it("should have correct name", () => {
    const error = new InvalidStateError("live", "idle");
    expect(error.name).toBe("InvalidStateError");
  });

  it("should store currentState and expectedState", () => {
    const error = new InvalidStateError("draining", "live");
    expect(error.currentState).toBe("draining");
    expect(error.expectedState).toBe("live");
  });

  it("should generate descriptive message", () => {
    const error = new InvalidStateError("error", "idle");
    expect(error.message).toContain("error");
    expect(error.message).toContain("idle");
    expect(error.message).toContain("Invalid state");
  });

  it("should be an instance of Error", () => {
    const error = new InvalidStateError("live", "idle");
    expect(error).toBeInstanceOf(Error);
  });

  it("should have stack trace", () => {
    const error = new InvalidStateError("live", "idle");
    expect(error.stack).toBeDefined();
  });
});

describe("LaunchError", () => {
  it("should have correct name", () => {
    const error = new LaunchError("Browser launch failed");
    expect(error.name).toBe("LaunchError");
  });

  it("should store message", () => {
    const error = new LaunchError("Chrome not found");
    expect(error.message).toBe("Chrome not found");
  });

  it("should store cause when provided", () => {
    const cause = new Error("ENOENT: file not found");
    const error = new LaunchError("Browser launch failed", cause);
    expect(error.cause).toBe(cause);
  });

  it("should have undefined cause when not provided", () => {
    const error = new LaunchError("Browser launch failed");
    expect(error.cause).toBeUndefined();
  });

  it("should be an instance of Error", () => {
    const error = new LaunchError("Browser launch failed");
    expect(error).toBeInstanceOf(Error);
  });

  it("should have stack trace", () => {
    const error = new LaunchError("Browser launch failed");
    expect(error.stack).toBeDefined();
  });

  it("should preserve cause error details", () => {
    const cause = new Error("Original error message");
    const error = new LaunchError("Wrapper message", cause);

    expect(error.message).toBe("Wrapper message");
    expect(error.cause?.message).toBe("Original error message");
  });
});
