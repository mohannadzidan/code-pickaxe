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
      <div className="w-full h-full flex items-center justify-center bg-[#1e1e2e] text-[#475569] text-[13px] flex-col gap-2 font-sans">
        <span className="text-[28px] opacity-40">⌥</span>
        <span>Click a node to open its file</span>
      </div>
    );
  }

  return (
    <div className="w-full h-full flex flex-col">
      {/* File path header */}
      <div className="bg-[#0f172a] border-b border-[#1e293b] px-3.5 py-1.5 text-[11px] text-[#64748b] font-mono shrink-0 overflow-hidden truncate">
        {activeFilePath}
      </div>

      <div className="flex-1 overflow-hidden">
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
