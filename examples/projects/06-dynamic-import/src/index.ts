export async function boot(): Promise<string> {
  const mod = await import("./plugin");
  return `${mod.default()}:${mod.pluginName}`;
}

void import("./plugin");
