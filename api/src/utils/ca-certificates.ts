import type { FastifyBaseLogger } from "fastify";
import fs from "fs";
import path from "path";

const CA_CERTIFICATE_POLICY_FILE = "steel_ca_certificates.json";
const CA_CERTIFICATE_POLICY_DIRS = [
  "/etc/opt/chrome/policies/managed",
  "/etc/chromium/policies/managed",
  "/etc/opt/chrome_for_testing/policies/managed",
];

type CertificatePolicyLogger = Pick<FastifyBaseLogger, "info" | "warn">;

export async function cleanupCaCertificatePolicy(logger?: CertificatePolicyLogger) {
  await Promise.all(
    CA_CERTIFICATE_POLICY_DIRS.map(async (policyDir) => {
      const policyPath = path.join(policyDir, CA_CERTIFICATE_POLICY_FILE);
      try {
        await fs.promises.rm(policyPath, { force: true });
      } catch (error) {
        logger?.warn(
          `[CA Certificates] Failed to remove CA certificate policy ${policyPath}: ${error}`,
        );
      }
    }),
  );
}

export async function setupCaCertificatePolicy(
  caCertificates?: string[],
  logger?: CertificatePolicyLogger,
) {
  await cleanupCaCertificatePolicy(logger);

  if (!caCertificates?.length) {
    return;
  }

  const policyContents = JSON.stringify({ CACertificates: caCertificates }, null, 2);
  let successfulWrites = 0;

  for (const policyDir of CA_CERTIFICATE_POLICY_DIRS) {
    const policyPath = path.join(policyDir, CA_CERTIFICATE_POLICY_FILE);
    try {
      await fs.promises.mkdir(policyDir, { recursive: true });
      await fs.promises.writeFile(policyPath, policyContents, { encoding: "utf8", mode: 0o644 });
      successfulWrites += 1;
    } catch (error) {
      logger?.warn(
        `[CA Certificates] Failed to write CA certificate policy ${policyPath}: ${error}`,
      );
    }
  }

  if (successfulWrites === 0) {
    throw new Error("Could not write Chrome CA certificate policy to any supported policy path");
  }

  logger?.info(
    `[CA Certificates] Configured ${caCertificates.length} custom CA certificate(s) for this launch`,
  );
}
