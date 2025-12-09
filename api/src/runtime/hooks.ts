import type { ClosedSession, DrainingSession, ErrorSession, LiveSession } from "./types.js";

export interface SessionHooks {
  onEnterLive?(session: LiveSession): void | Promise<void>;
  onExitLive?(session: LiveSession): void | Promise<void>;
  onEnterDraining?(session: DrainingSession): void | Promise<void>;
  onEnterError?(session: ErrorSession): void | Promise<void>;
  onLaunchFailed?(error: Error): void | Promise<void>;
  onClosed?(session: ClosedSession): void | Promise<void>;
}

export async function invokeHook<K extends keyof SessionHooks>(
  hooks: SessionHooks | undefined,
  hookName: K,
  ...args: Parameters<NonNullable<SessionHooks[K]>>
): Promise<void> {
  if (!hooks) return;

  const hook = hooks[hookName] as ((...args: unknown[]) => void | Promise<void>) | undefined;
  if (!hook) return;

  try {
    await Promise.resolve(hook(...args));
  } catch (error) {
    console.error(`[SessionHooks] Error in ${hookName}:`, error);
  }
}
