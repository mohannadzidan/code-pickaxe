import { BaseEntity, type Persistable } from "./contracts";

export class User extends BaseEntity implements Persistable {
  private displayName: string;

  constructor(id: string, displayName: string) {
    super(id);
    this.displayName = displayName;
  }

  save(): string {
    return `${this.id}:${this.displayName}`;
  }
}
