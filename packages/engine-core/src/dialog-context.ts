import { MapScope } from './scope';
import type { DialogContextState } from './outbox';

export type { DialogContextState } from './outbox';

// Изменяемая рабочая копия контекста на время обработки одного события
export class DialogContext {
  state: DialogContextState['state'];
  currentBlockId: string | null;
  currentRequestId: string | null;
  private readonly variables: Map<string, string>;

  constructor(
    snapshot: DialogContextState | null,
    private readonly env: Record<string, string>,
  ) {
    this.state = snapshot?.state ?? 'FINISHED';
    this.currentBlockId = snapshot?.currentBlockId ?? null;
    this.currentRequestId = snapshot?.currentRequestId ?? null;
    this.variables = new Map(Object.entries(snapshot?.variables ?? {}));
  }

  setVariable(name: string, value: string): void {
    this.variables.set(name, value);
  }

  getVariable(name: string): string | undefined {
    return this.variables.get(name);
  }

  clearVariables(): void {
    this.variables.clear();
  }

  scope(): MapScope {
    return new MapScope(Object.fromEntries(this.variables), this.env);
  }

  snapshot(): DialogContextState {
    return {
      state: this.state,
      currentBlockId: this.currentBlockId,
      variables: Object.fromEntries(this.variables),
      currentRequestId: this.currentRequestId,
    };
  }
}
