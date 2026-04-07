import "./index.css";
import "@xyflow/react/dist/style.css";
import { TrpcWrapper } from "./components/TrpcWrapper";
import Graph from "./components/Graph";

export function App() {
  return (
    <TrpcWrapper>
      <Graph />
    </TrpcWrapper>
  );
}
