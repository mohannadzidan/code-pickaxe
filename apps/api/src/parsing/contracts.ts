import type { SerializedCodeGraph } from './types.js';

export interface ParsingEngine {
  readonly languageId: string;
  parse(projectPath: string): Promise<SerializedCodeGraph>;
}
