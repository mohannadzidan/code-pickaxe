import {
  BaseEdge,
  EdgeLabelRenderer,
  Position,
  getSimpleBezierPath,
  useInternalNode,
  type EdgeProps,
  type InternalNode,
} from "@xyflow/react";

function getNodeCenter(node: InternalNode) {
  const { positionAbsolute } = node.internals;
  const w = node.measured?.width ?? 150;
  const h = node.measured?.height ?? 44;
  return { x: positionAbsolute.x + w / 2, y: positionAbsolute.y + h / 2 };
}

// Find the point where the line from node center to target center intersects the node border
function getNodeIntersection(node: InternalNode, target: InternalNode) {
  const w = (node.measured?.width ?? 150) / 2;
  const h = (node.measured?.height ?? 44) / 2;
  const { positionAbsolute: pos } = node.internals;
  const nodeCenter = { x: pos.x + w, y: pos.y + h };
  const targetCenter = getNodeCenter(target);

  const xx1 = (targetCenter.x - nodeCenter.x) / (2 * w) - (targetCenter.y - nodeCenter.y) / (2 * h);
  const yy1 = (targetCenter.x - nodeCenter.x) / (2 * w) + (targetCenter.y - nodeCenter.y) / (2 * h);
  const a = 1 / (Math.abs(xx1) + Math.abs(yy1) || 1);

  return {
    x: w * (a * xx1 + a * yy1) + nodeCenter.x,
    y: h * (-a * xx1 + a * yy1) + nodeCenter.y,
  };
}

function getEdgePosition(node: InternalNode, intersect: { x: number; y: number }): Position {
  const { positionAbsolute: pos } = node.internals;
  const w = node.measured?.width ?? 150;
  const h = node.measured?.height ?? 44;
  const eps = 1;

  if (intersect.x <= pos.x + eps) return Position.Left;
  if (intersect.x >= pos.x + w - eps) return Position.Right;
  if (intersect.y <= pos.y + eps) return Position.Top;
  if (intersect.y >= pos.y + h - eps) return Position.Bottom;
  return Position.Top;
}

export default function FloatingEdge({
  id,
  source,
  target,
  label,
  markerEnd,
  style,
}: EdgeProps) {
  const sourceNode = useInternalNode(source);
  const targetNode = useInternalNode(target);

  if (!sourceNode || !targetNode) return null;

  const sourceIntersect = getNodeIntersection(sourceNode, targetNode);
  const targetIntersect = getNodeIntersection(targetNode, sourceNode);
  const sourcePos = getEdgePosition(sourceNode, sourceIntersect);
  const targetPos = getEdgePosition(targetNode, targetIntersect);

  const [edgePath, labelX, labelY] = getSimpleBezierPath({
    sourceX: sourceIntersect.x,
    sourceY: sourceIntersect.y,
    sourcePosition: sourcePos,
    targetX: targetIntersect.x,
    targetY: targetIntersect.y,
    targetPosition: targetPos,
  });

  return (
    <>
      <BaseEdge id={id} path={edgePath} markerEnd={markerEnd} style={style} />
      {label && (
        <EdgeLabelRenderer>
          <div
            style={{
              position: "absolute",
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
              fontSize: 9,
              color: "#94a3b8",
              background: "#0f172a",
              padding: "1px 6px",
              borderRadius: 3,
              border: "1px solid #1e293b",
              pointerEvents: "none",
              whiteSpace: "nowrap",
            }}
            className="nodrag nopan"
          >
            {label as string}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
