import { formatUser, VERSION } from "./barrel";
import type { User } from "./barrel";

const user: User = { id: "u1", name: "Ada" };
export const text = `${VERSION}:${formatUser(user)}`;
