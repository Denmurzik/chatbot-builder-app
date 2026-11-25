// Область видимости переменных диалога и окружения при вычислении шаблонов и выражений
export interface VariableScope {
  get(name: string): string | undefined;
  getEnv(name: string): string | undefined;
}

// Реализация области видимости на основе Map (защита от свойств Object.prototype)
export class MapScope implements VariableScope {
  private readonly variables: Map<string, string>;
  private readonly env: Map<string, string>;

  constructor(variables: Record<string, string> = {}, env: Record<string, string> = {}) {
    this.variables = new Map(Object.entries(variables));
    this.env = new Map(Object.entries(env));
  }

  get(name: string): string | undefined {
    return this.variables.get(name);
  }

  getEnv(name: string): string | undefined {
    return this.env.get(name);
  }
}
