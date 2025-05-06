import { SessionManager } from "./session/session-manager.js";

declare module "puppeteer-core" {
  interface Page {
    session: SessionManager;
  }
}
