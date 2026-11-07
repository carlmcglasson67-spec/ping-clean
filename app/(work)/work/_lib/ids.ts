import { z } from "zod";

/**
 * Any Postgres uuid. Not z.uuid(): that insists on RFC 9562 version and variant bits,
 * and Postgres accepts (and our seed data uses) ids that don't carry them.
 */
export const pgUuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
