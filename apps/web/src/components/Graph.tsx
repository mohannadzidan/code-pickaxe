import { useState } from "react";
import { Background, ReactFlow, applyNodeChanges } from "@xyflow/react";
import "@xyflow/react/dist/style.css";

export default function Graph() {
  const [nodes, setNodes] = useState([
    { id: "n1", position: { x: 0, y: 0 }, data: { label: "Node 1" } },
    { id: "n2", position: { x: 0, y: 100 }, data: { label: "Node 2" } },
  ]);
  const [edges, setEdges] = useState([
    { id: "n1-n2", source: "n1", target: "n2" },
  ]);

  return (
    <div style={{ width: "100vw", height: "100vh" }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodesConnectable={false}
        fitView
        onNodesChange={(changes) =>
          setNodes((nodesSnapshot) => applyNodeChanges(changes, nodesSnapshot))
        }
        nodesDraggable={false}
      >
        <Background />
      </ReactFlow>
    </div>
  );
}
