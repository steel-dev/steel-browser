import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { getErrors } from "../../utils/errors";
import { DeleteExtensionRequest, UploadExtensionRequest, ImportExtensionRequest } from "./extensions.schema";
import { readdir, rm, stat, writeFile } from "fs/promises";
import { join } from "path";
import { extensionsDir, defaultExtensions, installExtensionArchive, ExtensionConflictError } from "../../utils/extensions";
import fetch from "node-fetch";

export const handleUploadExtension = async (
  server: FastifyInstance,
  request: UploadExtensionRequest,
  reply: FastifyReply,
) => {
  try {
    const name = request.body.name;
    const buffer = Buffer.from(request.body.contents, 'base64');

    if ((await readdir(extensionsDir)).includes(name)) {
      throw new ExtensionConflictError(name);
    }

    await installExtensionArchive(name, buffer);

    const stats = await stat(join(extensionsDir, name));
    const extensionDetails = {
      name,
      default: defaultExtensions.includes(name),
      createdAt: stats.birthtime.toISOString(),
    };

    return reply.code(201).send(extensionDetails);
  } catch (e: unknown) {
    if (e instanceof ExtensionConflictError) {
      return reply.code(409).send({ message: e.message });
    }
    const error = getErrors(e);
    return reply.code(500).send({ message: error });
  }
};

export const handleImportExtension = async (
  server: FastifyInstance,
  request: ImportExtensionRequest,
  reply: FastifyReply,
) => {
  try {
    const name = request.body.name || request.body.id;
    let buffer: Buffer;

    if ((await readdir(extensionsDir)).includes(name)) {
      throw new ExtensionConflictError(name);
    }

    // Download from Chrome Web Store
    const storeUrl = `https://clients2.google.com/service/update2/crx?response=redirect&prod=chromiumcrx&prodchannel=unknown&prodversion=9999.0.9999.0&acceptformat=crx2,crx3&x=id%3D${request.body.id}%26uc`;
    const response = await fetch(storeUrl, { redirect: 'follow', follow: 5 });

    if (!response.ok) {
      return reply.code(404).send({
        message: `Extension with ID '${request.body.id}' not found in Chrome Web Store`
      });
    }

    buffer = Buffer.from(await response.arrayBuffer());

    await installExtensionArchive(name, buffer);

    const stats = await stat(join(extensionsDir, name));
    const extensionDetails = {
      name,
      default: defaultExtensions.includes(name),
      createdAt: stats.birthtime.toISOString(),
    };

    return reply.code(201).send(extensionDetails);
  } catch (e: unknown) {
    if (e instanceof ExtensionConflictError) {
      return reply.code(409).send({ message: e.message });
    }
    const error = getErrors(e);
    return reply.code(500).send({ message: error });
  }
};

export const handleListExtensions = async (
  server: FastifyInstance,
  reply: FastifyReply,
) => {
  try {
    const allExtensions = await readdir(extensionsDir);
    const extensionDetails = await Promise.all(
      allExtensions.map(async (name) => {
        const stats = await stat(join(extensionsDir, name));
        return {
          name,
          default: defaultExtensions.includes(name),
          createdAt: stats.birthtime.toISOString(),
        };
      })
    );
    return reply.send(extensionDetails);
  } catch (e: unknown) {
    const error = getErrors(e);
    return reply.code(500).send({ message: error });
  }
};

export const handleDeleteExtension = async (
  server: FastifyInstance,
  request: DeleteExtensionRequest,
  reply: FastifyReply,
) => {
  try {
    const { name } = request.params;

    if (defaultExtensions.includes(name)) {
      return reply.code(403).send({ message: "Cannot delete default extension" });
    }

    const extensionPath = join(extensionsDir, name);
    await rm(extensionPath, { recursive: true, force: true });

    return reply.code(204).send();
  } catch (e: unknown) {
    const error = getErrors(e);
    return reply.code(500).send({ message: error });
  }
};

export const handlePurgeExtensions = async (
  server: FastifyInstance,
  request: FastifyRequest,
  reply: FastifyReply,
) => {
  try {
    const allExtensions = await readdir(extensionsDir);
    await Promise.all(
      allExtensions
        .filter(name => !defaultExtensions.includes(name))
        .map(name => rm(join(extensionsDir, name), { recursive: true, force: true }))
    );

    return reply.code(204).send();
  } catch (e: unknown) {
    const error = getErrors(e);
    return reply.code(500).send({ message: error });
  }
};

