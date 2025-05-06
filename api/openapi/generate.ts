import { writeFileSync } from "fs";
import { server } from "../src";
import { env } from "../src/env.js";

interface OpenAPIServer {
  url: string;
  description?: string;
}

interface OpenAPIDocument {
  servers?: OpenAPIServer[];
  [key: string]: any;
}

server.ready(() => {
  let openApiJSON = server.swagger() as OpenAPIDocument;

  // Add server URL from environment variables.
  const serverUrl = `http://${env.HOST}:${env.PORT}`;
  if (!openApiJSON.servers) {
    openApiJSON.servers = [];
  }
  openApiJSON.servers.push({
    url: serverUrl,
    description: "Local server from env variables"
  });

  writeFileSync("./openapi/schemas.json", JSON.stringify(openApiJSON, null, 2), "utf-8");
  console.log("OpenAPI JSON has been written to schemas.json");

  server.close(() => {
    console.log("Server closed after generating schemas.");
    process.exit(0);
  });
});
