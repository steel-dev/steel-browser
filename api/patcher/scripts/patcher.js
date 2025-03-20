#! /usr/bin/env node

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import yargs from "yargs";
import { hideBin } from "yargs/helpers";

import { exec, fatalError, getPatchBaseCmd, getPatcherPackagePath, log, validPackagesNames } from "./utils/index.js";

(async () => {
  // config and preparations
  const cliArgs = yargs(hideBin(process.argv))
    .usage("Usage: <command> [options]")
    .command("patch", "Apply patch")
    .command("unpatch", "Reverse patch")
    .command("check", "Check if patch is already applied")
    .describe("packageName", `Target package name: ${validPackagesNames.join(", ")}`)
    .describe("packagePath", "Path to the target package")
    .boolean("debug")
    .describe("debug", "Enable debugging mode")
    .demandCommand(1, 1, "Error: choose a command (patch, unpatch, check)")
    .parse();

  let { packageName, packagePath, debug } = cliArgs;

  if (debug) {
    process.env.REBROWSER_PATCHES_DEBUG = 1;
  }

  const command = cliArgs._[0];
  let commandResult;

  if (!packagePath && !packageName) {
    fatalError("You need to specify either packageName or packagePath.");
  }

  if (!packagePath) {
    packagePath = `${process.cwd()}/node_modules/${packageName}`;
  }

  if (!["patch", "unpatch", "check"].includes(command)) {
    fatalError(`Unknown command: ${command}`);
  }

  log("Config:");
  log(`command = ${command}, packageName = ${packageName}`);
  log(`packagePath = ${packagePath}`);
  log("------");

  // find package
  let packageJson;
  const packageJsonPath = resolve(packagePath, "package.json");
  try {
    const packageJsonText = await readFile(packageJsonPath, { encoding: "utf8" });
    packageJson = JSON.parse(packageJsonText);
  } catch (err) {
    fatalError("Cannot read package.json", err);
  }
  if (!packageName) {
    if (!validPackagesNames.includes(packageJson.name)) {
      fatalError(`Package name is "${packageJson.name}", but we only support ${validPackagesNames.join(", ")}.`);
    } else {
      packageName = packageJson.name;
    }
  } else if (packageJson.name !== packageName) {
    fatalError(
      `Package name is "${packageJson.name}", but we're looking for "${packageName}". Check your package path.`,
    );
  }
  log(`Found package "${packageJson.name}", version ${packageJson.version}`);

  const patchFilePath = resolve(
    getPatcherPackagePath(),
    `./patches/${packageName}/${packageName === "puppeteer-core" ? "23.6.x" : "1.47.x-lib"}.patch`,
  );
  // check patch status
  let patchStatus;
  try {
    const { stdout, stderr } = await exec(`${getPatchBaseCmd(patchFilePath)} --dry-run`, {
      cwd: packagePath,
    });
    patchStatus = "unpatched";
  } catch (e) {
    if (e.stdout.includes("No file to patch")) {
      fatalError("Internal error, patch command cannot find file to patch");
    } else if (e.stdout.includes("Ignoring previously applied (or reversed) patch")) {
      patchStatus = "patched";
    } else if (e.stderr.includes("is not recognized")) {
      let message = "patch command not found!";
      if (process.platform === "win32") {
        message += "\nCheck README for how to install patch.exe on Windows.";
      }
      fatalError(message);
    } else {
      log("[debug] patch error:", e);
      throw e;
    }
  }
  log(`Current patch status = ${patchStatus === "patched" ? "🟩" : "🟧"} ${patchStatus}`);

  // run command
  let execCmd;
  if (command === "patch") {
    if (patchStatus === "patched") {
      log("Package already patched.");
    } else {
      execCmd = getPatchBaseCmd(patchFilePath);
    }
  } else if (command === "unpatch") {
    if (patchStatus === "unpatched") {
      log("Package already unpatched.");
    } else {
      execCmd = `${getPatchBaseCmd(patchFilePath)} --reverse`;
    }
  }

  if (execCmd) {
    try {
      const { stdout, stderr } = await exec(execCmd, {
        cwd: packagePath,
      });
      commandResult = "success";
    } catch (e) {
      log("patch exec error:", e);
      commandResult = "error";
    }
  }

  // process results
  let exitCode = 0;
  let resultText;
  if (!commandResult) {
    resultText = "🟡 nothing changed";
  } else if (commandResult === "success") {
    resultText = "🟢 success";
  } else if (commandResult === "error") {
    resultText = "🔴 error";
    exitCode = 1;
  }
  log(`Result: ${resultText}`);

  process.exit(exitCode);
})();
