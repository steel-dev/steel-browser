import { ZodType, z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

export type Models<Key extends string = string> = {
  readonly [K in Key]: ZodType<unknown>;
};

export type BuildJsonSchemasOptions = {
  readonly $id?: string;
  readonly target?: `jsonSchema7` | `openApi3`;
  readonly errorMessages?: boolean;
};

export type SchemaKey<M extends Models> = M extends Models<infer Key> ? Key & string : never;

export type SchemaKeyOrDescription<M extends Models> =
  | SchemaKey<M>
  | {
      readonly description: string;
      readonly key: SchemaKey<M>;
    };

export type $Ref<M extends Models> = (key: SchemaKeyOrDescription<M>) => {
  readonly $ref: string;
  readonly description?: string;
};

export type JsonSchema = {
  readonly $id: string;
};

export type BuildJsonSchemasResult<M extends Models> = {
  readonly schemas: JsonSchema[];
  readonly $ref: $Ref<M>;
};

export const buildJsonSchemas = <M extends Models>(
  models: M,
  opts: BuildJsonSchemasOptions = {},
): BuildJsonSchemasResult<M> => {
  const zodSchema = z.object(models);

  const zodJsonSchema = zodToJsonSchema(zodSchema, {
    target: "openApi3",
    $refStrategy: "none",
    errorMessages: opts.errorMessages,
  });

  const cleanedSchemas = Object.entries(
    //@ts-ignore
    zodJsonSchema.properties as { [key: string]: any },
  ).reduce((acc, [key, value]) => {
    return [...acc, { $id: key, title: key, ...value }];
  }, [] as JsonSchema[]);

  const $ref: $Ref<M> = (key) => {
    const $ref = `${typeof key === `string` ? key : key.key}#`;
    return typeof key === `string`
      ? {
          $ref,
        }
      : {
          $ref,
          description: key.description,
        };
  };
  return {
    schemas: cleanedSchemas,
    $ref,
  };
};
