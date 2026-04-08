export enum TaskState {
  Todo = "todo",
  Doing = "doing",
  Done = "done",
}

export const RETRY_LIMIT = 3;
export let attempts = 0;

export function bumpAttempts(): number {
  attempts += 1;
  return attempts;
}
