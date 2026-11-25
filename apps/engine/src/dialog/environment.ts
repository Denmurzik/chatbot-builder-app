import type { Environment } from '@chatbot/model';
import { envAad, type SecretVault } from '@chatbot/vault';

// Окружение бота для движка: секретные значения расшифровываются только в памяти (п. 2.13).
// AAD секрета — `env:<botId>:<имя переменной>`.
export function buildEnvironment(
  botId: string,
  variables: Environment,
  vault: SecretVault,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const variable of variables) {
    if (variable.secret) {
      result[variable.name] = variable.secretValue
        ? vault.decrypt(variable.secretValue, envAad(botId, variable.name))
        : '';
    } else {
      result[variable.name] = variable.value ?? '';
    }
  }
  return result;
}
