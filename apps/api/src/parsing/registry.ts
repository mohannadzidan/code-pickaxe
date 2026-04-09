import type { ParsingEngine } from './contracts.js';
import { TypeScriptParsingEngine } from './engine.js';

export class EngineRegistry {
  private readonly engines = new Map<string, ParsingEngine>();

  register(engine: ParsingEngine): void {
    this.engines.set(engine.languageId, engine);
  }

  get(languageId: string): ParsingEngine | undefined {
    return this.engines.get(languageId);
  }

  availableLanguages(): string[] {
    return [...this.engines.keys()];
  }
}

export function createDefaultEngineRegistry(): EngineRegistry {
  const registry = new EngineRegistry();
  registry.register(new TypeScriptParsingEngine());
  return registry;
}
