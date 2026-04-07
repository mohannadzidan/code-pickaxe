import type { CodeDefinition } from "@api/parsing/types";

type MonacoApi = {
  Range: new (startLine: number, startColumn: number, endLine: number, endColumn: number) => unknown;
  editor: { ScrollType: { Smooth: unknown } };
};

type MonacoEditor = {
  getModel: () => unknown;
  createDecorationsCollection: (items: Array<{ range: unknown; options: { inlineClassName: string } }>) => {
    clear: () => void;
  };
  revealRangeInCenter: (range: unknown, scrollType: unknown) => void;
};

const HIGHLIGHT_CLASS = "cp-range-highlight";

if (typeof document !== "undefined") {
  const style = document.createElement("style");
  style.textContent = `.${HIGHLIGHT_CLASS} { background-color: rgba(255, 210, 60, 0.18) !important; border-radius: 2px; }`;
  document.head.appendChild(style);
}

export class MonacoService {
  private editor: MonacoEditor | null = null;
  private decorations: { clear: () => void } | null = null;

  setEditor(editor: MonacoEditor) {
    this.editor = editor;
  }

  clearDecorations() {
    this.decorations?.clear();
  }

  highlightAndReveal(monaco: MonacoApi, target: CodeDefinition) {
    if (!this.editor) return;
    const model = this.editor.getModel();
    if (!model) return;

    this.clearDecorations();
    const range = new monaco.Range(target.line, target.column, target.endLine, target.endColumn + 1);
    this.decorations = this.editor.createDecorationsCollection([
      {
        range,
        options: { inlineClassName: HIGHLIGHT_CLASS },
      },
    ]);
    this.editor.revealRangeInCenter(range, monaco.editor.ScrollType.Smooth);
  }
}
