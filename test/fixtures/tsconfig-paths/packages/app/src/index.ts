// @ts-expect-error The alias is defined in this nested app tsconfig, not tsconfig.test.json.
import { User } from "@models/user";
export type { User };
