import type { EnvVarInput, EnvVarView, EnvironmentVariable } from '@chatbot/model';
import { envAad, SecretVault } from '@chatbot/vault';
import { BadRequestException, Injectable } from '@nestjs/common';

// Сервис переменных окружения проекта и бота: шифрует секреты и строит безопасное представление (п. 2.13, 3.3)
@Injectable()
export class EnvironmentService {
  constructor(private readonly vault: SecretVault) {}

  // Представление для клиента: у секретных только маска
  toView(vars: EnvironmentVariable[]): EnvVarView[] {
    return vars.map((v): EnvVarView => {
      if (v.secret) {
        return { name: v.name, secret: true, mask: v.secretValue?.mask ?? '' };
      }
      return { name: v.name, secret: false, value: v.value ?? '' };
    });
  }

  // Сливает ввод автора с сохранёнными переменными; секрет без значения сохраняет прежний шифротекст
  merge(ownerId: string, existing: EnvironmentVariable[], input: EnvVarInput[]): EnvironmentVariable[] {
    const byName = new Map(existing.map((v) => [v.name, v]));
    return input.map((item): EnvironmentVariable => {
      if (!item.secret) {
        return { name: item.name, secret: false, value: item.value ?? '' };
      }
      if (item.value !== undefined && item.value !== '') {
        return {
          name: item.name,
          secret: true,
          secretValue: this.vault.encrypt(item.value, envAad(ownerId, item.name)),
        };
      }
      const previous = byName.get(item.name);
      if (previous?.secret && previous.secretValue) {
        return { name: item.name, secret: true, secretValue: previous.secretValue };
      }
      throw new BadRequestException(`Введите значение секретной переменной ${item.name}`);
    });
  }
}
