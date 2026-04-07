import { z } from 'zod';

import { publicProcedure, router } from '@api/trpc';

export const schema = z.object({
  name: z.string(),
});

export const graphRouter = router({
  get: publicProcedure.query(async () => {
    return {};
  }),
});
