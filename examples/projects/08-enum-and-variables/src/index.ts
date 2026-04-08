import { RETRY_LIMIT, TaskState, bumpAttempts } from "./status";

export const next = (): TaskState => {
  if (bumpAttempts() >= RETRY_LIMIT) return TaskState.Done;
  return TaskState.Doing;
};
