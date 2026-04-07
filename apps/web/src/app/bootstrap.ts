import { GraphProjectionService } from "@/features/graph/services/graphProjectionService";
import { LayoutService } from "@/features/graph/services/layoutService";
import { SimulationService } from "@/features/graph/services/simulationService";
import { MonacoService } from "@/features/codePane/services/monacoService";
import { SourceResolverService } from "@/features/codePane/services/sourceResolverService";

export const services = {
  graphProjectionService: new GraphProjectionService(),
  layoutService: new LayoutService(),
  simulationService: new SimulationService(),
  monacoService: new MonacoService(),
  sourceResolverService: new SourceResolverService(),
};
