import { setup, assign, fromPromise, fromCallback } from "xstate";
import {
  IMachineContext,
  SupervisorEvent,
  RuntimeConfig,
  ResolvedConfig,
  ProxyRef,
  BrowserRef,
  BrowserLauncher,
} from "../types.js";
import { BrowserPlugin } from "../plugins/base-plugin.js";
import { resolveConfig } from "../actors/config-resolver.js";
import { launchProxy } from "../actors/proxy-launcher.js";
import { startDataPlane, DataPlaneInput } from "../actors/data-plane.js";
import { startLogger, LoggerInput } from "../actors/logger-actor.js";
import { startPluginManager, PluginManagerInput } from "../actors/plugin-manager.js";
import { BrowserLogger } from "../../services/cdp/instrumentation/browser-logger.js";
import { FastifyBaseLogger } from "fastify";
import { traceBootPhase, traceOperation } from "../tracing/index.js";

export interface MachineInput {
  launcher: BrowserLauncher;
  plugins?: BrowserPlugin[];
  instrumentationLogger?: BrowserLogger;
  appLogger?: FastifyBaseLogger;
}

export interface MachineContext extends IMachineContext {
  instrumentationLogger?: BrowserLogger;
  appLogger?: FastifyBaseLogger;
}

export const browserMachine = setup({
  types: {
    context: {} as MachineContext,
    events: {} as SupervisorEvent,
    input: {} as MachineInput,
  },
  actors: {
    configResolver: fromPromise<ResolvedConfig, { rawConfig: RuntimeConfig }>(({ input }) =>
      traceBootPhase("config.resolve", () => resolveConfig(input.rawConfig)),
    ),
    proxyLauncher: fromPromise<ProxyRef | null, { config: ResolvedConfig }>(({ input }) =>
      traceBootPhase("proxy.launch", () => launchProxy(input.config)),
    ),
    browserLauncher: fromPromise<
      BrowserRef,
      { launcher: BrowserLauncher; config: ResolvedConfig; proxy: ProxyRef | null }
    >(({ input }) => input.launcher.launch(input.config, input.proxy)),
    dataPlane: fromCallback<SupervisorEvent, DataPlaneInput & { launcher: BrowserLauncher }>(
      ({ sendBack, input }) => startDataPlane({ ...input }, sendBack),
    ),
    loggerActor: fromCallback<SupervisorEvent, LoggerInput>(({ sendBack, input }) =>
      startLogger(input, sendBack),
    ),
    pluginManager: fromCallback<SupervisorEvent, PluginManagerInput>(({ sendBack, input }) =>
      startPluginManager(input, sendBack),
    ),
    cleanupActor: fromPromise<
      void,
      {
        launcher: BrowserLauncher;
        browser: BrowserRef | null;
        proxy: ProxyRef | null;
        instrumentationLogger?: BrowserLogger;
      }
    >(async ({ input }) => {
      await traceOperation("browser.cleanup", "detailed", async (span) => {
        if (input.browser) {
          await input.launcher.close(input.browser);
        }
        if (input.proxy) {
          await input.proxy.close();
        }
        if (input.instrumentationLogger?.flush) {
          await input.instrumentationLogger.flush();
        }
      });
    }),
  },
  actions: {
    assignRawConfig: assign({
      rawConfig: ({ event }) => (event as { type: "START"; config: RuntimeConfig }).config,
      plugins: ({ event, context }) =>
        (event as { type: "START"; plugins?: BrowserPlugin[] }).plugins || context.plugins,
    }),
    assignResolvedConfig: assign({
      resolvedConfig: ({ event }) => (event as unknown as { output: ResolvedConfig }).output,
      fingerprint: ({ event }) =>
        (event as unknown as { output: ResolvedConfig }).output.fingerprint,
    }),
    assignProxy: assign({
      proxy: ({ event }) => (event as unknown as { output: ProxyRef | null }).output,
    }),
    assignBrowser: assign({
      browser: ({ event }) => (event as unknown as { output: BrowserRef }).output,
    }),
    assignError: assign({
      error: ({ event }) => (event as { error: Error }).error,
    }),
    clearContext: assign({
      rawConfig: null,
      resolvedConfig: null,
      proxy: null,
      browser: null,
      fingerprint: null,
      error: null,
      // We keep launcher and plugins
    }),
  },
}).createMachine({
  id: "browserSupervisor",
  initial: "idle",
  context: ({ input }) => ({
    launcher: input.launcher,
    rawConfig: null,
    resolvedConfig: null,
    proxy: null,
    browser: null,
    fingerprint: null,
    error: null,
    plugins: input.plugins || [],
    instrumentationLogger: input.instrumentationLogger,
    appLogger: input.appLogger,
  }),
  states: {
    idle: {
      on: {
        START: {
          target: "booting",
          actions: "assignRawConfig",
        },
      },
    },
    booting: {
      initial: "resolvingConfig",
      on: {
        STOP: "cleanup",
      },
      states: {
        resolvingConfig: {
          invoke: {
            src: "configResolver",
            input: ({ context }) => ({ rawConfig: context.rawConfig! }),
            onDone: {
              target: "launchingProxy",
              actions: "assignResolvedConfig",
            },
            onError: {
              target: "#browserSupervisor.failed",
              actions: "assignError",
            },
          },
        },
        launchingProxy: {
          invoke: {
            src: "proxyLauncher",
            input: ({ context }) => ({ config: context.resolvedConfig! }),
            onDone: {
              target: "launchingBrowser",
              actions: "assignProxy",
            },
            onError: {
              target: "#browserSupervisor.failed",
              actions: "assignError",
            },
          },
        },
        launchingBrowser: {
          invoke: {
            src: "browserLauncher",
            input: ({ context }) => ({
              launcher: context.launcher,
              config: context.resolvedConfig!,
              proxy: context.proxy,
            }),
            onDone: {
              target: "#browserSupervisor.ready",
              actions: "assignBrowser",
            },
            onError: {
              target: "#browserSupervisor.failed",
              actions: "assignError",
            },
          },
        },
      },
    },
    ready: {
      invoke: [
        {
          id: "dataPlane",
          src: "dataPlane",
          input: ({ context }) => ({
            launcher: context.launcher,
            browser: context.browser!,
            config: context.resolvedConfig!,
          }),
        },
        {
          id: "loggerActor",
          src: "loggerActor",
          input: ({ context }) => ({
            browser: context.browser!,
            config: context.resolvedConfig!,
            instrumentationLogger: context.instrumentationLogger,
            appLogger: context.appLogger,
          }),
        },
        {
          id: "pluginManager",
          src: "pluginManager",
          input: ({ context }) => ({
            browser: context.browser!,
            config: context.resolvedConfig!,
            plugins: context.plugins,
          }),
        },
      ],
      on: {
        STOP: "cleanup",
        USER_DISCONNECTED: "cleanup",
        BROWSER_CRASHED: {
          target: "cleanup",
          actions: "assignError",
        },
        FATAL_ERROR: {
          target: "cleanup",
          actions: "assignError",
        },
      },
    },
    cleanup: {
      invoke: {
        src: "cleanupActor",
        input: ({ context }) => ({
          launcher: context.launcher,
          browser: context.browser,
          proxy: context.proxy,
          instrumentationLogger: context.instrumentationLogger,
        }),
        onDone: {
          target: "idle",
          actions: "clearContext",
        },
        onError: {
          target: "idle",
          actions: "clearContext",
        },
      },
    },
    failed: {
      invoke: {
        src: "cleanupActor",
        input: ({ context }) => ({
          launcher: context.launcher,
          browser: context.browser,
          proxy: context.proxy,
          instrumentationLogger: context.instrumentationLogger,
        }),
        onDone: "idle",
        onError: "idle",
      },
    },
  },
});
