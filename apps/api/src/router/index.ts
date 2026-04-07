import { router } from '@api/trpc';
import { helloRouter } from '@api/router/hello';
import { codeRouter } from './code';

export const appRouter = router({
  hello: helloRouter,
  graph: codeRouter,
});

export type AppRouter = typeof appRouter;
