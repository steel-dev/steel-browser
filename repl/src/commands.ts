import { randomUUID } from "node:crypto";

type CommandResult = {
  ok: boolean;
  effect: "none" | "applied" | "unknown";
  error?: { code: string; message: string; reason?: string };
  snapshot?: string;
};

type CommandResponse = {
  next?: string;
  page: { tab: string; url: string; title: string } | null;
  results: CommandResult[];
};

const apiUrl = process.env.STEEL_API_URL ?? "http://localhost:3000";

async function post<T>(
  path: string,
  body: object,
  headers: Record<string, string> = {},
): Promise<T> {
  const response = await fetch(`${apiUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  if (response.status === 404 && path.endsWith("/commands")) {
    throw new Error("The Commands API is off. Start the server with ENABLE_COMMANDS_API=true.");
  }
  const data = (await response.json()) as T & { error?: unknown };
  if (!response.ok || data.error) {
    throw new Error(`POST ${path} returned ${response.status}: ${JSON.stringify(data)}`);
  }
  return data;
}

async function runCommands(sessionId: string, body: object): Promise<CommandResponse> {
  const response = await post<CommandResponse>(`/v1/sessions/${sessionId}/commands`, body, {
    "Idempotency-Key": randomUUID(),
  });
  const failed = response.results.find((result) => !result.ok);
  if (failed) {
    throw new Error(`Command failed: ${failed.error?.code} ${failed.error?.message}`);
  }
  return response;
}

async function run() {
  const session = await post<{ id: string }>("/v1/sessions", {});

  try {
    const opened = await runCommands(session.id, {
      commands: [
        { command: "navigate", url: "https://example.com" },
        { command: "snapshot", interactive: true },
      ],
    });
    const snapshot = opened.results[1]?.snapshot ?? "";
    console.log(snapshot);

    const ref = snapshot
      .split("\n")
      .find((line) => line.trimStart().startsWith("- link "))
      ?.match(/ref=(e\d+)/)?.[1];
    if (!ref) {
      console.log("No link found in the snapshot.");
      return;
    }

    const clicked = await runCommands(session.id, {
      after: opened.next,
      commands: [{ command: "click", target: ref }],
    });
    console.log(`Clicked ${ref}. Page title: ${clicked.page?.title} (${clicked.page?.url})`);
  } finally {
    await post(`/v1/sessions/${session.id}/release`, {});
  }
}

run().catch(console.error);
