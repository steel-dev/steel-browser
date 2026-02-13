import { setup, assign, fromPromise, fromCallback, emit } from "xstate";
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
import { resolveConfig } from "../services/config-resolver.js";
import { launchProxy } from "./actors/proxy-launcher.actor.js";
import { startDataPlane, DataPlaneInput } from "./actors/data-plane.actor.js";
import { startLogger, LoggerInput } from "./actors/logger.actor.js";
import { startPluginManager, PluginManagerInput } from "./actors/plugin-manager.actor.js";
import { BrowserLogger } from "../../services/cdp/instrumentation/browser-logger.js";
import { FastifyBaseLogger } from "fastify";
import { traceBootPhase } from "../tracing/index.js";
import { drain, DrainInput } from "./actors/drain.actor.js";
import {
  closeBrowser,
  closeProxy,
  flushLogs,
  notifyPluginsShutdown,
} from "./actors/cleanup-phases.actor.js";
import { taskRegistryActor } from "./actors/task-registry.actor.js";

export interface MachineInput {
  launcher: BrowserLauncher;
  plugins?: BrowserPlugin[];
  instrumentationLogger?: BrowserLogger;
  appLogger?: FastifyBaseLogger;
}

export interface MachineContext extends IMachineContext {
  instrumentationLogger?: BrowserLogger;
  appLogger?: FastifyBaseLogger;
  taskRegistryRef?: any;
}

export const browserMachine = setup({
  types: {
    context: {} as MachineContext,
    events: {} as SupervisorEvent,
    input: {} as MachineInput,
    children: {} as {
      taskRegistry: "taskRegistry";
    },
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
    drainActor: fromPromise<void, DrainInput>(({ input }) => drain(input)),
    closeBrowserActor: fromPromise<void, { launcher: BrowserLauncher; browser: BrowserRef | null }>(
      ({ input }) => closeBrowser(input),
    ),
    closeProxyActor: fromPromise<void, { proxy: ProxyRef | null }>(({ input }) =>
      closeProxy(input),
    ),
    flushLogsActor: fromPromise<void, { instrumentationLogger?: BrowserLogger }>(({ input }) =>
      flushLogs(input),
    ),
    notifyShutdownActor: fromPromise<void, { plugins: BrowserPlugin[] }>(({ input }) =>
      notifyPluginsShutdown(input),
    ),
    browserEventActor: fromCallback<any, { browser: BrowserRef; launcher: BrowserLauncher }>(
      ({ sendBack, input }) => {
        const { browser, launcher } = input;
        const removeCreated = launcher.onTargetCreated(browser, (target: any) => {
          sendBack({ type: "BROWSER_EVENT", event: "targetCreated", data: { target } });
        });
        const removeDestroyed = launcher.onTargetDestroyed(browser, (targetId: string) => {
          sendBack({ type: "BROWSER_EVENT", event: "targetDestroyed", data: { targetId } });
        });
        browser.instance.on("fileProtocolViolation", (data: any) => {
          sendBack({ type: "BROWSER_EVENT", event: "fileProtocolViolation", data });
        });

        return () => {
          removeCreated();
          removeDestroyed();
          browser.instance.off("fileProtocolViolation", () => {});
        };
      },
    ),
    taskRegistry: taskRegistryActor,
  },
  actions: {
    assignTaskRegistry: assign({
      taskRegistryRef: ({ spawn, context }) =>
        spawn("taskRegistry", {
          id: "taskRegistry",
          input: { appLogger: context.appLogger },
        }),
    }),
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
    captureSessionState: assign({
      sessionState: ({ context }) => context.resolvedConfig?.sessionContext || null,
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
    forwardToTaskRegistry: ({ context, event }) => {
      if (context.taskRegistryRef) {
        context.taskRegistryRef.send(event);
      }
    },
    emitBrowserEvent: emit(({ event }) => {
      const e = event as { type: "BROWSER_EVENT"; event: string; data: any };
      return {
        type: e.event,
        ...e.data,
      };
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
    sessionState: null,
    taskRegistry: null,
    instrumentationLogger: input.instrumentationLogger,
    appLogger: input.appLogger,
    taskRegistryRef: null,
  }),
  entry: "assignTaskRegistry",
  on: {
    WAIT_UNTIL: {
      actions: ({ context, event }) => {
        context.taskRegistryRef?.send(event);
      },
    },
    DRAIN: {
      actions: ({ context, event }) => {
        context.taskRegistryRef?.send(event);
      },
    },
    CANCEL_ALL: {
      actions: ({ context, event }) => {
        context.taskRegistryRef?.send(event);
      },
    },
    BROWSER_EVENT: {
      actions: "emitBrowserEvent",
    },
  },
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
      initial: "active",
      states: {
        active: {
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
            {
              id: "browserEventActor",
              src: "browserEventActor",
              input: ({ context }) => ({
                browser: context.browser!,
                launcher: context.launcher,
              }),
            },
          ],
          on: {
            END_SESSION: {
              target: "draining",
              actions: "captureSessionState",
            },
          },
        },
        draining: {
          invoke: {
            src: "drainActor",
            input: ({ context }) => ({
              instrumentationLogger: context.instrumentationLogger,
              plugins: context.plugins,
              config: context.resolvedConfig!,
              browser: context.browser,
              taskRegistryRef: context.taskRegistryRef,
            }),
            onDone: "#browserSupervisor.cleanup",
            onError: "#browserSupervisor.cleanup",
          },
        },
      },
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
      initial: "closingBrowser",
      states: {
        closingBrowser: {
          invoke: {
            src: "closeBrowserActor",
            input: ({ context }) => ({
              launcher: context.launcher,
              browser: context.browser,
            }),
            onDone: "notifyingShutdown",
            onError: "notifyingShutdown",
          },
          after: {
            10000: "notifyingShutdown",
          },
        },
        notifyingShutdown: {
          invoke: {
            src: "notifyShutdownActor",
            input: ({ context }) => ({
              plugins: context.plugins,
            }),
            onDone: "closingProxy",
            onError: "closingProxy",
          },
          after: {
            5000: "closingProxy",
          },
        },
        closingProxy: {
          invoke: {
            src: "closeProxyActor",
            input: ({ context }) => ({
              proxy: context.proxy,
            }),
            onDone: "flushingLogs",
            onError: "flushingLogs",
          },
          after: {
            5000: "flushingLogs",
          },
        },
        flushingLogs: {
          invoke: {
            src: "flushLogsActor",
            input: ({ context }) => ({
              instrumentationLogger: context.instrumentationLogger,
            }),
            onDone: "#browserSupervisor.idle",
            onError: "#browserSupervisor.idle",
          },
          after: {
            5000: "#browserSupervisor.idle",
          },
          exit: "clearContext",
        },
      },
    },
    failed: {
      always: { target: "cleanup" },
    },
  },
});
