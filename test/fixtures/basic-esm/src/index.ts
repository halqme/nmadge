import { greet } from "./lib/greet.js";
import("./lib/lazy.js");
export { version } from "./lib/version.js";
import type { User } from "./lib/user.js";

export { greet };
export const exampleUser: User = { name: greet };
