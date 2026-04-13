import { GraphProjectionService } from "@/features/graph/services/graphProjectionService";
import { LayoutService } from "@/features/graph/services/layoutService";
import { SimulationService } from "@/features/graph/services/simulationService";
import { MonacoService } from "@/features/codePane/services/monacoService";
import { SourceResolverService } from "@/features/codePane/services/sourceResolverService";
import { registerAllCommands } from "@/features/commands/commands";

export const services = {
  graphProjectionService: new GraphProjectionService(),
  layoutService: new LayoutService(),
  simulationService: new SimulationService(),
  monacoService: new MonacoService(),
  sourceResolverService: new SourceResolverService(),
};

// Register all commands on app initialization
registerAllCommands();
