import type { FastifyInstance } from "fastify";
import { FileService } from "../file.service.js";
import { CommandEngine } from "./engine.js";
import { CommandsPlugin } from "./plugin.js";
import { quickActionsDone } from "../../modules/commands/commands.guard.js";
import type { Session } from "../session.service.js";

export class SessionCommandEngineRegistry {
  private readonly engines = new Map<string, CommandEngine>();

  constructor(private readonly server: FastifyInstance) {}

  registerSession = (session: Session): void => {
    if (session.isSelenium || this.engines.has(session.id)) return;

    const engine = new CommandEngine({
      browser: () => session.cdpService.getBrowserInstance(),
      waitForPageSetup: (page) => session.cdpService.waitForPageSetup(page),
      endSession: async (id) => {
        if (id === session.id && session.status === "live") {
          await this.server.sessionService.endSession(id);
        }
      },
      filesRoot: () => FileService.getInstance(session.id).getBaseFilesPath(),
      released: (id) => id !== session.id || (session.status !== "live" && !session.starting),
      quickActionsDone: () => quickActionsDone(engine),
    });
    session.cdpService.registerPlugin(new CommandsPlugin(engine, { id: () => session.id }));
    this.engines.set(session.id, engine);
  };

  get(sessionId: string): CommandEngine | undefined {
    return this.engines.get(sessionId);
  }

  release(sessionId: string): void {
    this.engines.delete(sessionId);
  }
}
