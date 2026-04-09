export const FOLDER_NODE_PREFIX = "folder:";

export const normalizePath = (value: string): string => value.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");

export const getParentFolderPath = (path: string): string => {
  const normalized = normalizePath(path);
  const idx = normalized.lastIndexOf("/");
  return idx >= 0 ? normalized.slice(0, idx) : "";
};

export const getFolderPathForModule = (moduleId: string): string => getParentFolderPath(moduleId);

export const toFolderNodeId = (folderPath: string): string => `${FOLDER_NODE_PREFIX}${normalizePath(folderPath)}`;

export const fromFolderNodeId = (nodeId: string): string | null => {
  if (!nodeId.startsWith(FOLDER_NODE_PREFIX)) return null;
  return normalizePath(nodeId.slice(FOLDER_NODE_PREFIX.length));
};

export const isModuleInsideFolder = (moduleId: string, folderPath: string): boolean => {
  const normalizedFolder = normalizePath(folderPath);
  const moduleFolder = getFolderPathForModule(moduleId);
  return moduleFolder === normalizedFolder || moduleFolder.startsWith(`${normalizedFolder}/`);
};
