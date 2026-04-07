import { router } from '@api/trpc';
import { helloRouter } from '@api/router/hello';
import { graphRouter } from './graph';

export const appRouter = router({
  hello: helloRouter,
  graph: graphRouter,
});

export type AppRouter = typeof appRouter;
