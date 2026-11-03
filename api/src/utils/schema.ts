import { ZodType, z } from "zod";

export type Models<Key extends string = string> = {
  readonly [K in Key]: ZodType<unknown>;
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

export const toJsonSchema = (schema: ZodType, params: z.core.ToJSONSchemaParams) =>
  z.toJSONSchema(schema, {
    io: "input",
    unrepresentable: ({ zodSchema }) =>
      zodSchema._zod.def.type === "date" ? { type: "string", format: "date-time" } : "throw",
    override: ({ zodSchema, jsonSchema }) => {
      const def = zodSchema._zod.def;
      if (def.type === "object" && !def.catchall) {
        jsonSchema.additionalProperties = false;
      }
      if (jsonSchema.format) {
        delete jsonSchema.pattern;
      }
      if (jsonSchema.minimum === Number.MIN_SAFE_INTEGER) {
        delete jsonSchema.minimum;
      }
      if (jsonSchema.maximum === Number.MAX_SAFE_INTEGER) {
        delete jsonSchema.maximum;
      }
    },
    ...params,
  });

export const buildJsonSchemas = <M extends Models>(models: M): BuildJsonSchemasResult<M> => {
  const zodJsonSchema = toJsonSchema(z.object(models), { target: "openapi-3.0" });

  const cleanedSchemas = Object.entries(zodJsonSchema.properties ?? {}).map(([key, value]) => ({
    $id: key,
    title: key,
    ...(value as object),
  }));

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
