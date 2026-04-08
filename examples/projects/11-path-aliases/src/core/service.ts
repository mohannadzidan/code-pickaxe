import type { Entity } from "@core/types";

export function toLabel(entity: Entity): string {
  return `entity:${entity.id}`;
}
