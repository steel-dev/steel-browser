import { FastifyRequest } from "fastify";
import { CDPService } from "../services/cdp/cdp.service.js";
import { SessionService } from "../services/session.service.js";
import { SeleniumService } from "../services/selenium.service.js";
import { Page } from "puppeteer-core";
import { FileService } from "../services/file.service.js";

declare module "fastify" {
  interface FastifyRequest {}
  interface FastifyInstance {
    seleniumService: SeleniumService;
    sessionService: SessionService;
    fileService: FileService;
  }
}
