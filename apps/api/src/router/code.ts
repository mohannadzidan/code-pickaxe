import { z } from 'zod';
import { publicProcedure, router } from '@api/trpc';
import { createDefaultEngineRegistry } from '@api/parsing/registry';
import path from 'path';

const defaultProjectPath = path.join(process.cwd(), '../../examples/projects/07-class-hierarchy');
const defaultLanguageId = 'typescript';

const registry = createDefaultEngineRegistry();

const graphGetSchema = z.object({
  projectPath: z.string().min(1).optional(),
  languageId: z.string().min(1).optional(),
}).optional();

export const codeRouter = router({
  get: publicProcedure.input(graphGetSchema).query(async ({ input }) => {
    const languageId = input?.languageId ?? defaultLanguageId;
    const projectPath = input?.projectPath ? path.resolve(input.projectPath) : defaultProjectPath;

    const engine = registry.get(languageId);
    if (!engine) {
      throw new Error(
        `Unsupported language '${languageId}'. Available languages: ${registry.availableLanguages().join(', ') || 'none'}`
      );
    }

    return engine.parse(projectPath);
  }),
  languages: publicProcedure.query(async () => registry.availableLanguages()),
});
