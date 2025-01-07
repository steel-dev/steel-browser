import { FastifyRequest } from "fastify";
import { CDPService } from "../services/cdp.service";
import { SessionService } from "../services/session.service";
import { SeleniumService } from "../services/selenium.service";
import { Page } from "puppeteer-core";

declare module "fastify" {
  interface FastifyRequest {}
  interface FastifyInstance {
    cdpService: CDPService;
    seleniumService: SeleniumService;
    sessionService: SessionService;
  }
}
