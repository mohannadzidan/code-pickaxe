import { useEffect } from "react";
import Editor, { useMonaco } from "@monaco-editor/react";
import { useCodePaneStore, selectActiveFilePath, selectNavigateTarget, selectSourceCode } from "@/features/codePane/store/codePaneStore";
import { services } from "@/app/bootstrap";

export default function CodePane() {
  const monaco = useMonaco();
  const activeFilePath = useCodePaneStore(selectActiveFilePath);
  const sourceCode = useCodePaneStore(selectSourceCode);
  const navigateTarget = useCodePaneStore(selectNavigateTarget);

  useEffect(() => {
    if (!monaco || !navigateTarget) return;
    services.monacoService.highlightAndReveal(monaco, navigateTarget);
  }, [navigateTarget, monaco]);

  if (!sourceCode || !activeFilePath) {
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
        {activeFilePath}
      </div>

      <div style={{ flex: 1, overflow: "hidden" }}>
        <Editor
          language="typescript"
          value={sourceCode}
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
            services.monacoService.setEditor(editor as unknown as Parameters<typeof services.monacoService.setEditor>[0]);
          }}
        />
      </div>
    </div>
  );
}
