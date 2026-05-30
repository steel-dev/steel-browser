import type { SessionService } from "../../services/session.service.js";
import { CreateSessionBody } from "./sessions.schema.js";

/**
 * The normalized configuration object consumed by {@link SessionService.startSession}.
 *
 * It is derived directly from the service signature so that the compiler enforces
 * that anything produced by the resolver remains a valid session input. If the
 * service ever requires a new field, resolution will fail to type-check instead of
 * silently launching a session with missing options.
 */
export type SessionConfig = Parameters<SessionService["startSession"]>[0];

/**
 * Resolve a raw `CreateSession` request body into a single, fully-populated
 * {@link SessionConfig}.
 *
 * Historically the controller mapped the request body onto the service input via
 * manual destructuring. Every new option had to be threaded through by hand, and
 * forgetting to do so silently dropped the field on the floor (see the recurring
 * `fullscreen` / `userDataDir` regressions). This resolver removes that failure
 * mode: it forwards the validated body wholesale, so any field accepted by the
 * schema is preserved without per-field maintenance.
 *
 * Only normalization that the service input genuinely requires is applied here —
 * namely reconciling the `sessionContext` shape. No business logic lives in this
 * layer; it is a pure, side-effect-free transformation.
 */
export function resolveSessionConfig(body: CreateSessionBody): SessionConfig {
  return {
    // Forward every validated field so options can never be silently dropped.
    ...body,
    // Reconcile the schema's session context shape with the service input type.
    sessionContext: body.sessionContext as SessionConfig["sessionContext"],
    // `credentials` is a required key on the service input; keep it explicit so
    // the resolved config always satisfies the contract.
    credentials: body.credentials,
  };
}
