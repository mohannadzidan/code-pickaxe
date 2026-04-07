import { useEffect, useRef, useState } from "react";
import Editor, { useMonaco } from "@monaco-editor/react";
import type * as MonacoNS from "monaco-editor";
import type { CodeDefinition, SerializedCodeGraph } from "@api/parsing/types";

// ── Injected CSS for highlight decoration ─────────────────────────────────────
const HIGHLIGHT_CLASS = "cp-range-highlight";
if (typeof document !== "undefined") {
  const style = document.createElement("style");
  style.textContent = `.${HIGHLIGHT_CLASS} { background-color: rgba(255, 210, 60, 0.18) !important; border-radius: 2px; }`;
  document.head.appendChild(style);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function findModuleId(entityId: string, graph: SerializedCodeGraph): string {
  let cur = entityId;
  while (true) {
    const e = graph.entities[cur];
    if (!e) return cur;
    if (e.kind === "module") return cur;
    if (!e.parent) return cur;
    cur = e.parent;
  }
}

export type NavigationTarget = CodeDefinition;

type Props = {
  selectedEntityId: string | null;
  navigateTarget: NavigationTarget | null;
  graph: SerializedCodeGraph;
};

export default function CodePane({ selectedEntityId, navigateTarget, graph }: Props) {
  const monaco = useMonaco();
  const editorRef = useRef<MonacoNS.editor.IStandaloneCodeEditor | null>(null);
  const decorationsRef = useRef<MonacoNS.editor.IEditorDecorationsCollection | null>(null);
  const [content, setContent] = useState<{ code: string; path: string } | null>(null);

  // ── Resolve file content when selection changes ─────────────────────────────
  useEffect(() => {
    if (!selectedEntityId) { setContent(null); return; }
    const moduleId = findModuleId(selectedEntityId, graph);
    const module = graph.entities[moduleId];
    if (!module?.sourceText) { setContent(null); return; }
    setContent({ code: module.sourceText, path: moduleId });
  }, [selectedEntityId, graph]);

  // ── When navigateTarget changes, switch to its file if different ─────────────
  useEffect(() => {
    if (!navigateTarget) return;
    // navigateTarget.file is an absolute path; find the module whose definition matches
    const moduleId = Object.keys(graph.entities).find(id => {
      const e = graph.entities[id];
      return e?.kind === "module" && e.definition?.file === navigateTarget.file;
    });
    if (!moduleId) return;
    const module = graph.entities[moduleId];
    if (!module?.sourceText) return;
    setContent({ code: module.sourceText, path: moduleId });
  }, [navigateTarget, graph]);

  // ── Scroll + highlight when entity or navigate target changes ───────────────
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || !monaco) return;

    // Clear previous decorations
    decorationsRef.current?.clear();

    const target = navigateTarget ?? (
      selectedEntityId && selectedEntityId !== findModuleId(selectedEntityId, graph)
        ? graph.entities[selectedEntityId]?.definition
        : null
    );

    if (!target) return;

    const model = editor.getModel();
    if (!model) return;

    const range = new monaco.Range(target.line, target.column, target.endLine, target.endColumn + 1);

    // Apply background highlight decoration
    decorationsRef.current = editor.createDecorationsCollection([{
      range,
      options: { inlineClassName: HIGHLIGHT_CLASS },
    }]);

    // Reveal in center with some context
    editor.revealRangeInCenter(range, monaco.editor.ScrollType.Smooth);
  }, [selectedEntityId, navigateTarget, graph, monaco]);

  // ── Empty state ──────────────────────────────────────────────────────────────
  if (!content) {
    return (
      <div style={{
        width: "100%", height: "100%",
        display: "flex", alignItems: "center", justifyContent: "center",
        background: "#1e1e2e",
        fontFamily: "Inter, system-ui, sans-serif",
        color: "#475569",
        fontSize: 13,
        flexDirection: "column",
        gap: 8,
      }}>
        <span style={{ fontSize: 28, opacity: 0.4 }}>⌥</span>
        <span>Click a node to open its file</span>
      </div>
    );
  }

  return (
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column" }}>
      {/* File path header */}
      <div style={{
        background: "#0f172a",
        borderBottom: "1px solid #1e293b",
        padding: "6px 14px",
        fontSize: 11,
        color: "#64748b",
        fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
        flexShrink: 0,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
      }}>
        {content.path}
      </div>

      <div style={{ flex: 1, overflow: "hidden" }}>
        <Editor
          language="typescript"
          value={content.code}
          theme="vs-dark"
          options={{
            readOnly: true,
            fontSize: 12,
            lineHeight: 18,
            fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
            minimap: { enabled: true },
            scrollBeyondLastLine: false,
            wordWrap: "off",
            renderLineHighlight: "gutter",
            cursorStyle: "line",
            hideCursorInOverviewRuler: true,
            overviewRulerBorder: false,
            contextmenu: false,
          }}
          onMount={(editor) => {
            editorRef.current = editor;
          }}
        />
      </div>
    </div>
  );
}
