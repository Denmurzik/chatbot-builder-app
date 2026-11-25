// Ошибка для нереализованных методов каркаса модулей (следующие спринты)
export class NotImplementedError extends Error {
  constructor(target?: string) {
    super(target ? `Не реализовано: ${target}` : 'Не реализовано');
    this.name = 'NotImplementedError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

// Ошибка или предупреждение проверки сценария (класс модели ValidationError, п. 2.10)
export interface ValidationError {
  rule: string;
  message: string;
  severity: 'ERROR' | 'WARNING';
  blockId?: string;
}
