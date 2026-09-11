import type { ErrorObject } from "ajv";
import Ajv2020 from "ajv/dist/2020.js";
import schema from "../../../../contracts/edit-command.schema.json";

const ajv = new Ajv2020({ allErrors: true, strict: true });
const validators = new Map(
  Object.values(schema.$defs).flatMap((definition) => {
    const op = (definition as any).properties?.op?.const;
    return typeof op === "string"
      ? [[op, ajv.compile({ ...definition, $defs: schema.$defs })] as const]
      : [];
  }),
);

// Compiled references may use relative schema paths. Validate the matching
// command directly instead of filtering paths from the full union's errors.
// Values (including presentation text) are deliberately omitted.
export function editContractErrors(
  command: unknown,
  errors: ErrorObject[] | null | undefined,
) {
  const commands = (command as { commands?: unknown[] } | null)?.commands;
  const relevant = (errors ?? []).filter(
    (error) => !/^\/commands\/\d+(?:\/|$)/.test(error.instancePath),
  );
  if (Array.isArray(commands))
    commands.slice(0, 12).forEach((item, index) => {
      const validate = validators.get((item as any)?.op);
      if (!validate) {
        relevant.push({
          instancePath: `/commands/${index}/op`,
          schemaPath: "",
          keyword: "enum",
          params: { allowedValues: [...validators.keys()] },
          message: "use an exact supported operation name",
        });
      } else if (!validate(item)) {
        relevant.push(
          ...(validate.errors ?? []).map((error) => ({
            ...error,
            instancePath: `/commands/${index}${error.instancePath}`,
          })),
        );
      }
    });
  return JSON.stringify(
    relevant.slice(0, 10).map(({ instancePath, keyword, message, params }) => ({
      path: instancePath,
      keyword,
      message,
      ...params,
    })),
  );
}
