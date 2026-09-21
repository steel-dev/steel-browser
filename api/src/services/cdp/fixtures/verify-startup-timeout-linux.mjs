import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as pause } from "node:timers/promises";
import puppeteer from "/workspace/apps/steel-browser/api/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js";
import { LaunchShutdownGate } from "/workspace/apps/steel-browser/api/build/services/cdp/launch-shutdown-gate.js";
const directory = await mkdtemp("/tmp/steel-linux-launch-");
const script = join(directory, "fixture.cjs");
const executable = join(directory, "browser-fixture");
const identityFile = join(directory, "identity.json");
const running = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error.code === "ESRCH") return false;
    throw error;
  }
};
let identities, outcome;
try {
  await writeFile(
    script,
    `const {spawn}=require('node:child_process'); const {writeFileSync}=require('node:fs'); const child=spawn(process.execPath,['-e','process.on("SIGTERM",()=>{});setInterval(()=>{},1000)'],{stdio:'ignore'}); process.on('SIGTERM',()=>{}); writeFileSync(${JSON.stringify(identityFile)},JSON.stringify({parent:process.pid,child:child.pid})); setInterval(()=>{},1000);`,
  );
  await writeFile(executable, `#!/bin/sh\nexec /usr/local/bin/node '${script}'\n`, { mode: 0o700 });
  let shutdownCalls = 0;
  const gate = new LaunchShutdownGate(
    (error) => {
      throw error;
    },
    () => shutdownCalls++,
  );
  outcome = gate
    .launch(() => puppeteer.launch({ executablePath: executable, headless: true, timeout: 2000 }))
    .then(
      (browser) => ({ browser }),
      (error) => ({ error }),
    );
  const readyBy = Date.now() + 1500;
  while (!identities && Date.now() < readyBy) {
    try {
      identities = JSON.parse(await readFile(identityFile, "utf8"));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      await pause(20);
    }
  }
  assert.ok(identities);
  for (const pid of Object.values(identities)) {
    assert.ok(Number.isSafeInteger(pid) && pid > 1);
    assert.ok(running(pid));
  }
  const result = await outcome;
  assert.equal(result.browser, undefined);
  assert.equal(result.error.isRetryable, false);
  assert.equal(result.error.cause.name, "TimeoutError");
  assert.equal(shutdownCalls, 1);
  let retries = 0;
  await assert.rejects(
    gate.launch(async () => {
      retries++;
    }),
    { isRetryable: false },
  );
  assert.equal(retries, 0);
  const stoppedBy = Date.now() + 7000;
  while (Object.values(identities).some(running) && Date.now() < stoppedBy) await pause(20);
  assert.ok(!running(identities.parent));
  assert.ok(!running(identities.child));
  console.log(
    JSON.stringify({
      platform: process.platform,
      node: process.version,
      retriesBlocked: true,
      rootExited: true,
      sameGroupChildExited: true,
      network: "none",
      containerInit: true,
    }),
  );
} finally {
  const result = await outcome;
  await result?.browser?.close();
  if (identities)
    for (const pid of Object.values(identities))
      if (Number.isSafeInteger(pid) && pid > 1 && running(pid)) process.kill(pid, "SIGKILL");
  await rm(directory, { recursive: true, force: true });
}
