import type { User } from "./models";

export function formatUser(user: User): string {
  return `${user.id}:${user.name}`;
}
