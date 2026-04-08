export interface Persistable {
  save(): string;
}

export class BaseEntity {
  constructor(public readonly id: string) {}
}
