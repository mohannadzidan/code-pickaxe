import { publicProcedure, router } from '@api/trpc';
import { ParsingEngine } from '@api/parsing/engine';
import path from 'path';

const directory = path.join(process.cwd(), 'src');

const engine = new ParsingEngine();

export const codeRouter = router({
  get: publicProcedure.query(async () => {
    const graph = await engine.parse(directory);
    return {
      entities: Object.fromEntries(graph.entities),
      dependencies: graph.dependencies,
      modules: graph.modules,
      externalModules: graph.externalModules,
    };
  }),
});
