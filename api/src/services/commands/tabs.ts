import {
  CDPSessionEvent,
  type Browser,
  type CDPSession,
  type Connection,
  type Page,
  type Protocol,
  type Target,
} from "puppeteer-core";
import { CommandError } from "./errors.js";
import { within } from "./results.js";

const WORLD_NAME = "__steel_commands";

const MAX_WORLDS = 256;

const STALE_NAVIGATION_MS = 30_000;

const CLOSE_WAIT_MS = 5_000;

const OPEN_MS = 10_000;

type Hook = (session: CDPSession) => void;

export interface BrowserHost {
  browser(): Browser | null;
  waitForPageSetup(page: Page): Promise<void>;
}

export interface TabInfo {
  tab: string;
  url: string;
  title: string;
}

export interface TabEvents {
  dialogOpened(tab: Tab, event: Protocol.Page.JavascriptDialogOpeningEvent): void;
  dialogClosed(tab: Tab, event: Protocol.Page.JavascriptDialogClosedEvent): void;
  downloadStarted(tab: Tab, event: Protocol.Page.DownloadWillBeginEvent): void;
  downloadProgress(tab: Tab, event: Protocol.Page.DownloadProgressEvent): void;
  navigated(tab: Tab, url: string, sameDocument: boolean): void;
  opened(tab: Tab, opener: Tab | undefined): void;
  closed(tab: Tab): void;
}

export interface PressedButton {
  session: CDPSession;
  x: number;
  y: number;
}

export interface HeldKey {
  session: CDPSession;
  keyUp: Protocol.Input.DispatchKeyEventRequest;
}

function targetIdOf(target: Target): string {
  return (target as unknown as { _targetId: string })._targetId;
}

function sessionOf(target: Target): CDPSession | undefined {
  return (target as unknown as { _session?(): CDPSession | undefined })._session?.();
}

interface Navigation {
  since: number;
  committed: boolean;
  loaderId?: string;
  done: Promise<void>;
  finish(): void;
}

export class Tab {
  closed = false;
  blocking = false;
  crashed = false;
  pressed: PressedButton | null = null;
  key: HeldKey | null = null;
  private readonly blockingListeners = new Set<() => void>();
  private readonly frames = new Map<string, CDPSession>();
  private readonly links = new Map<string, { parent: CDPSession; frameId: string }>();
  private readonly worlds = new Map<string, number>();
  private opening: Promise<CDPSession> | null = null;
  private main: CDPSession | null = null;
  private client: CDPSession | null = null;
  private navigation: Navigation | null = null;
  private dialogType: string | null = null;
  private readonly onDialogOpening = (event: Protocol.Page.JavascriptDialogOpeningEvent) => {
    this.dialogType = event.type;
    this.events.dialogOpened(this, event);
  };
  private readonly onDialogClosed = (event: Protocol.Page.JavascriptDialogClosedEvent) => {
    this.blocking = false;
    if (this.dialogType === "beforeunload" && !event.result) {
      this.settle();
    }
    this.dialogType = null;
    this.events.dialogClosed(this, event);
  };
  private readonly onCrashed = () => {
    this.crashed = true;
    this.settle();
    for (const listener of [...this.blockingListeners]) {
      listener();
    }
  };
  private readonly onDownloadStarted = (event: Protocol.Page.DownloadWillBeginEvent) => {
    this.events.downloadStarted(this, event);
  };
  private readonly onDownloadProgress = (event: Protocol.Page.DownloadProgressEvent) => {
    this.events.downloadProgress(this, event);
  };
  private readonly onFrameNavigated = (event: Protocol.Page.FrameNavigatedEvent) => {
    if (!event.frame.parentId) {
      this.crashed = false;
      if (this.navigation) {
        this.navigation.committed = true;
        this.navigation.loaderId = event.frame.loaderId;
      }
      this.events.navigated(this, event.frame.url + (event.frame.urlFragment ?? ""), false);
    }
  };
  private readonly onNavigatedWithinDocument = (
    event: Protocol.Page.NavigatedWithinDocumentEvent,
  ) => {
    if (event.frameId === this.targetId) {
      if (!this.navigation?.committed) {
        this.settle();
      }
      this.events.navigated(this, event.url, true);
    }
  };
  private readonly onNavigationRequested = (event: Protocol.Page.FrameRequestedNavigationEvent) => {
    if (event.frameId === this.targetId && event.disposition === "currentTab") {
      this.begin();
    }
  };
  private readonly onStartedLoading = (event: Protocol.Page.FrameStartedLoadingEvent) => {
    if (event.frameId === this.targetId) {
      this.begin();
    }
  };
  private readonly onStoppedLoading = (event: Protocol.Page.FrameStoppedLoadingEvent) => {
    if (event.frameId === this.targetId) {
      this.settle();
    }
  };
  private readonly onLifecycle = (event: Protocol.Page.LifecycleEventEvent) => {
    const navigation = this.navigation;
    if (
      navigation?.committed &&
      event.frameId === this.targetId &&
      event.name === "DOMContentLoaded" &&
      event.loaderId === navigation.loaderId
    ) {
      this.settle();
    }
  };

  constructor(
    readonly id: string,
    readonly targetId: string,
    private readonly pending: Promise<Page | null>,
    private readonly host: BrowserHost,
    private readonly events: TabEvents,
  ) {}

  watch(client?: CDPSession, opened?: Protocol.Page.JavascriptDialogOpeningEvent) {
    if (client) {
      this.listen(client);
      if (opened) {
        this.onDialogOpening(opened);
      }
      return;
    }
    void this.pending.then((page) => {
      if (page && !this.closed) {
        this.listen((page as unknown as { _client(): CDPSession })._client());
      }
    });
  }

  get navigating(): boolean {
    const navigation = this.navigation;
    if (navigation && Date.now() - navigation.since > STALE_NAVIGATION_MS) {
      this.settle();
    }
    return this.navigation !== null;
  }

  navigated(): Promise<void> {
    return this.navigation?.done ?? Promise.resolve();
  }

  markBlocking() {
    this.blocking = true;
    for (const listener of [...this.blockingListeners]) {
      listener();
    }
  }

  onBlocking(listener: () => void): () => void {
    this.blockingListeners.add(listener);
    return () => {
      this.blockingListeners.delete(listener);
    };
  }

  async answerDialog(accept: boolean, text?: string) {
    if (!this.client) {
      throw new CommandError("tab_not_found", `Tab ${this.id} is not ready.`);
    }
    await this.client.send("Page.handleJavaScriptDialog", {
      accept,
      ...(text !== undefined ? { promptText: text } : {}),
    });
  }

  async terminate() {
    const sessions = new Set(
      [this.client, ...this.sessions()].filter(
        (session): session is CDPSession => session !== null,
      ),
    );
    await Promise.all(
      [...sessions].map((session) =>
        session.send("Runtime.terminateExecution").catch(() => undefined),
      ),
    );
  }

  async stopLoading() {
    await this.client?.send("Page.stopLoading");
  }

  async release() {
    const pressed = this.pressed;
    const key = this.key;
    this.pressed = null;
    this.key = null;
    await pressed?.session.send("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x: pressed.x,
      y: pressed.y,
      button: "left",
      buttons: 0,
      clickCount: 1,
    });
    await key?.session.send("Input.dispatchKeyEvent", key.keyUp);
  }

  async page(): Promise<Page> {
    const page = await this.pending;
    if (!page || this.closed || page.isClosed()) {
      throw new CommandError("tab_not_found", `Tab ${this.id} is closed.`);
    }
    return page;
  }

  async ready(): Promise<Page> {
    await this.session();
    return this.page();
  }

  async activate() {
    const session = await this.session();
    const { frameTree } = await session.send("Page.getFrameTree");
    const contextId = await this.world(session, frameTree.frame.id, frameTree.frame.loaderId);
    const { result } = await session.send("Runtime.evaluate", {
      expression: "document.visibilityState",
      contextId,
      returnByValue: true,
    });
    if (result.value !== "visible") {
      await session.send("Page.bringToFront");
    }
  }

  session(): Promise<CDPSession> {
    if (this.closed) {
      return Promise.reject(new CommandError("tab_not_found", `Tab ${this.id} is closed.`));
    }
    if (!this.opening) {
      this.opening = this.open();
      this.opening.catch(() => {
        this.opening = null;
      });
    }
    return this.opening;
  }

  frameSession(frameId: string): CDPSession | undefined {
    return this.frames.get(frameId);
  }

  sessions(): CDPSession[] {
    return this.main ? [this.main, ...this.frames.values()] : [...this.frames.values()];
  }

  async owners(session: CDPSession): Promise<Array<{ session: CDPSession; owner: number }>> {
    const chain: Array<{ session: CDPSession; owner: number }> = [];
    for (let current = session; current.id() !== this.main?.id(); ) {
      const link = this.links.get(current.id());
      if (!link) {
        throw new CommandError(
          "not_actionable",
          `Tab ${this.id} lost track of a frame. Take a new snapshot.`,
          "frame",
        );
      }
      const { backendNodeId } = await link.parent.send("DOM.getFrameOwner", {
        frameId: link.frameId,
      });
      chain.unshift({ session: link.parent, owner: backendNodeId });
      current = link.parent;
    }
    return chain;
  }

  sessionByKey(key: string): CDPSession | undefined {
    if (this.closed) {
      return undefined;
    }
    if (this.main?.id() === key) {
      return this.main;
    }
    return [...this.frames.values()].find((session) => session.id() === key);
  }

  async world(session: CDPSession, frameId: string, loaderId: string): Promise<number> {
    const key = `${session.id()}:${frameId}:${loaderId}`;
    const cached = this.worlds.get(key);
    if (cached !== undefined) {
      return cached;
    }
    const { executionContextId } = await session.send("Page.createIsolatedWorld", {
      frameId,
      worldName: WORLD_NAME,
    });
    if (this.worlds.size >= MAX_WORLDS) {
      this.worlds.clear();
    }
    this.worlds.set(key, executionContextId);
    return executionContextId;
  }

  close() {
    this.closed = true;
    this.opening = null;
    const main = this.main;
    this.main = null;
    this.frames.clear();
    this.links.clear();
    this.worlds.clear();
    this.client?.off("Page.javascriptDialogOpening", this.onDialogOpening);
    this.client?.off("Page.javascriptDialogClosed", this.onDialogClosed);
    this.client?.off("Page.downloadWillBegin", this.onDownloadStarted);
    this.client?.off("Page.downloadProgress", this.onDownloadProgress);
    this.client?.off("Page.frameNavigated", this.onFrameNavigated);
    this.client?.off("Page.navigatedWithinDocument", this.onNavigatedWithinDocument);
    this.client?.off("Page.frameRequestedNavigation", this.onNavigationRequested);
    this.client?.off("Page.frameStartedLoading", this.onStartedLoading);
    this.client?.off("Page.frameStoppedLoading", this.onStoppedLoading);
    this.client?.off("Page.lifecycleEvent", this.onLifecycle);
    this.client?.off("Inspector.targetCrashed", this.onCrashed);
    this.client = null;
    this.settle();
    void main?.detach().catch(() => undefined);
  }

  sessionId(): string | undefined {
    return this.client?.id();
  }

  private listen(client: CDPSession) {
    client.on("Page.javascriptDialogOpening", this.onDialogOpening);
    client.on("Page.javascriptDialogClosed", this.onDialogClosed);
    client.on("Page.downloadWillBegin", this.onDownloadStarted);
    client.on("Page.downloadProgress", this.onDownloadProgress);
    client.on("Page.frameNavigated", this.onFrameNavigated);
    client.on("Page.navigatedWithinDocument", this.onNavigatedWithinDocument);
    client.on("Page.frameRequestedNavigation", this.onNavigationRequested);
    client.on("Page.frameStartedLoading", this.onStartedLoading);
    client.on("Page.frameStoppedLoading", this.onStoppedLoading);
    client.on("Page.lifecycleEvent", this.onLifecycle);
    client.on("Inspector.targetCrashed", this.onCrashed);
    this.client = client;
  }

  private begin() {
    if (this.navigation) {
      this.navigation.since = Date.now();
      this.navigation.committed = false;
      this.navigation.loaderId = undefined;
      return;
    }
    const { promise, resolve } = Promise.withResolvers<void>();
    this.navigation = { since: Date.now(), committed: false, done: promise, finish: resolve };
  }

  private settle() {
    const navigation = this.navigation;
    this.navigation = null;
    navigation?.finish();
  }

  private async open(): Promise<CDPSession> {
    const page = await this.page();
    await this.host.waitForPageSetup(page);
    const session = await page.createCDPSession();
    const prepared = await within(
      this.prepare(session).then(() => true),
      OPEN_MS,
    );
    if (!prepared || this.closed) {
      void session.detach().catch(() => undefined);
      throw this.closed
        ? new CommandError("tab_not_found", `Tab ${this.id} is closed.`)
        : new CommandError(
            "timeout",
            `Tab ${this.id} did not answer. Reload it or try again.`,
            "tab_setup",
          );
    }
    this.main = session;
    return session;
  }

  private async prepare(session: CDPSession) {
    session.on("Target.attachedToTarget", (event: Protocol.Target.AttachedToTargetEvent) => {
      const child = session.connection()?.session(event.sessionId);
      if (!child || event.targetInfo.type !== "iframe") {
        return;
      }
      this.frames.set(event.targetInfo.targetId, child);
      this.links.set(child.id(), { parent: session, frameId: event.targetInfo.targetId });
      void this.prepare(child).catch(() => undefined);
    });
    session.on("Target.detachedFromTarget", (event: Protocol.Target.DetachedFromTargetEvent) => {
      this.links.delete(event.sessionId);
      for (const [frameId, child] of this.frames) {
        if (child.id() === event.sessionId) {
          this.frames.delete(frameId);
        }
      }
    });
    await Promise.all([session.send("DOM.enable"), session.send("Accessibility.enable")]);
    await session.send("Target.setAutoAttach", {
      autoAttach: true,
      waitForDebuggerOnStart: false,
      flatten: true,
      filter: [{ type: "iframe" }],
    });
  }
}

export class TabRegistry {
  private sequence = 0;
  private browser: Browser | null = null;
  private control: Promise<CDPSession> | null = null;
  private defaultContextId: string | null = null;
  private connection: Connection | null = null;
  private readonly tabs = new Map<string, Tab>();
  private readonly byTarget = new Map<string, Tab>();
  private readonly openDialogs = new Map<string, Protocol.Page.JavascriptDialogOpeningEvent>();
  private readonly onCreated = (target: Target) => {
    this.track(target, true);
  };
  private readonly onDestroyed = (target: Target) => {
    this.untrack(targetIdOf(target));
  };
  private readonly onAttached: Hook = (session) => {
    const id = session.id();
    session.on("Page.javascriptDialogOpening", (event) => this.openDialogs.set(id, event));
    session.on("Page.javascriptDialogClosed", () => this.openDialogs.delete(id));
    void session.send("Page.enable").catch(() => undefined);
  };
  private readonly onDetached: Hook = (session) => {
    this.openDialogs.delete(session.id());
  };

  constructor(
    private readonly host: BrowserHost,
    private readonly events: TabEvents,
  ) {}

  attach(browser: Browser) {
    if (this.browser === browser) {
      return;
    }
    this.detach();
    this.browser = browser;
    browser.on("targetcreated", this.onCreated);
    browser.on("targetdestroyed", this.onDestroyed);
    for (const target of browser.targets()) {
      this.track(target);
    }
    const connection = browser
      .targets()
      .map((target) => sessionOf(target)?.connection())
      .find((candidate) => candidate !== undefined);
    if (connection) {
      this.connection = connection;
      connection.on(CDPSessionEvent.SessionAttached, this.onAttached);
      connection.on(CDPSessionEvent.SessionDetached, this.onDetached);
    }
    void this.learnDefaultContext(browser);
  }

  detach() {
    if (this.browser) {
      this.browser.off("targetcreated", this.onCreated);
      this.browser.off("targetdestroyed", this.onDestroyed);
    }
    this.connection?.off(CDPSessionEvent.SessionAttached, this.onAttached);
    this.connection?.off(CDPSessionEvent.SessionDetached, this.onDetached);
    this.connection = null;
    this.openDialogs.clear();
    for (const tab of this.tabs.values()) {
      tab.close();
    }
    this.tabs.clear();
    this.byTarget.clear();
    this.browser = null;
    this.defaultContextId = null;
    void this.control?.then((session) => session.detach()).catch(() => undefined);
    this.control = null;
  }

  private async learnDefaultContext(browser: Browser) {
    const connection = this.connection;
    const found = connection
      ? await Promise.all([
          connection.send("Target.getBrowserContexts"),
          connection.send("Target.getTargets"),
        ]).catch(() => null)
      : null;
    if (!found || this.browser !== browser) {
      return;
    }
    const [{ browserContextIds }, { targetInfos }] = found;
    const created = new Set(browserContextIds);
    const page = targetInfos.find(
      (info) =>
        info.type === "page" && info.browserContextId && !created.has(info.browserContextId),
    );
    if (!page?.browserContextId) {
      return;
    }
    this.defaultContextId = page.browserContextId;
    for (const info of targetInfos) {
      if (info.browserContextId !== this.defaultContextId && this.byTarget.has(info.targetId)) {
        this.untrack(info.targetId);
      }
    }
  }

  get(id: string): Tab | undefined {
    return this.tabs.get(id);
  }

  list(): Tab[] {
    return [...this.tabs.values()].filter((tab) => !tab.closed);
  }

  resolve(id?: string): Tab {
    if (id) {
      const tab = this.tabs.get(id);
      if (!tab || tab.closed) {
        throw new CommandError(
          "tab_not_found",
          `Tab ${id} is not open. Run tab list to see open tabs.`,
        );
      }
      return tab;
    }
    const open = this.list();
    if (open.length === 1) {
      return open[0];
    }
    if (open.length === 0) {
      throw new CommandError("tab_not_found", "No tab is open.");
    }
    throw new CommandError(
      "tab_required",
      `${open.length} tabs are open. Pass tab to choose one: ${open
        .map((tab) => tab.id)
        .join(", ")}.`,
    );
  }

  async create(): Promise<Tab> {
    if (!this.browser) {
      throw new CommandError("tab_not_found", "The browser is not ready.");
    }
    const page = await this.browser.newPage();
    const tab = this.track(page.target(), true);
    if (!tab) {
      throw new CommandError("tab_not_found", "The new tab closed before it could be used.");
    }
    return tab;
  }

  async info(tab: Tab): Promise<TabInfo> {
    const session = await this.controlSession();
    const { targetInfo } = await session.send("Target.getTargetInfo", { targetId: tab.targetId });
    return { tab: tab.id, url: targetInfo.url, title: targetInfo.title };
  }

  async describe(): Promise<TabInfo[]> {
    const session = await this.controlSession();
    const { targetInfos } = await session.send("Target.getTargets");
    const byId = new Map(targetInfos.map((info) => [info.targetId, info]));
    return this.list().flatMap((tab) => {
      const info = byId.get(tab.targetId);
      return info ? [{ tab: tab.id, url: info.url, title: info.title }] : [];
    });
  }

  async close(tab: Tab) {
    const browser = this.browser;
    const session = await this.controlSession();
    let stop = () => {};
    const gone = new Promise<void>((resolve) => {
      const destroyed = (target: Target) => {
        if (targetIdOf(target) === tab.targetId) {
          resolve();
        }
      };
      browser?.on("targetdestroyed", destroyed);
      stop = () => browser?.off("targetdestroyed", destroyed);
    });
    try {
      await session.send("Target.closeTarget", { targetId: tab.targetId });
      await within(gone, CLOSE_WAIT_MS);
    } finally {
      stop();
    }
    this.untrack(tab.targetId);
  }

  private controlSession(): Promise<CDPSession> {
    if (!this.browser) {
      return Promise.reject(new CommandError("tab_not_found", "The browser is not ready."));
    }
    if (!this.control) {
      this.control = this.browser.target().createCDPSession();
      this.control.catch(() => {
        this.control = null;
      });
    }
    return this.control;
  }

  private track(target: Target, announce = false): Tab | undefined {
    if (
      target.type() !== "page" ||
      target.browserContext() !== this.browser?.defaultBrowserContext()
    ) {
      return undefined;
    }
    const contextId = (
      target as unknown as { _getTargetInfo(): Protocol.Target.TargetInfo }
    )._getTargetInfo().browserContextId;
    if (this.defaultContextId && contextId && contextId !== this.defaultContextId) {
      return undefined;
    }
    const url = target.url();
    if (url.startsWith("chrome-extension://") || url.startsWith("devtools://")) {
      return undefined;
    }
    const targetId = targetIdOf(target);
    const existing = this.byTarget.get(targetId);
    if (existing) {
      return existing;
    }
    const tab = new Tab(
      `t${++this.sequence}`,
      targetId,
      target.page().catch(() => null),
      this.host,
      this.events,
    );
    this.tabs.set(tab.id, tab);
    this.byTarget.set(targetId, tab);
    if (announce) {
      const opener = target.opener();
      this.events.opened(tab, opener ? this.byTarget.get(targetIdOf(opener)) : undefined);
    }
    const client = sessionOf(target);
    tab.watch(client, client ? this.openDialogs.get(client.id()) : undefined);
    return tab;
  }

  private untrack(targetId: string) {
    const tab = this.byTarget.get(targetId);
    if (!tab) {
      return;
    }
    const sessionId = tab.sessionId();
    if (sessionId) {
      this.openDialogs.delete(sessionId);
    }
    tab.close();
    this.byTarget.delete(targetId);
    this.tabs.delete(tab.id);
    this.events.closed(tab);
  }
}
