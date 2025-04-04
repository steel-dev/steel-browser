import { SessionManager } from "./session/session-manager";

declare module "puppeteer-core" {
  interface Page {
    session: SessionManager;
  }
}
