import { greet } from "./lib/greet.js";
// @ts-expect-error TS7016: the test tsconfig does not enable `allowJs` or provide JS declarations.
import("./lib/lazy.js");
export { version } from "./lib/version.js";
import type { User } from "./lib/user.js";

export { greet };
export const exampleUser: User = { name: greet };
