import { createTRPCReact } from '@trpc/react-query';

import type { AppRouter } from '@repo/api';

type TrpcClient = ReturnType<typeof createTRPCReact<AppRouter>>;

export const trpc: TrpcClient = createTRPCReact<AppRouter>();
