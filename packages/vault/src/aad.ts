// Функции построения AAD с префиксами сущности для изоляции шифротекстов (п. 2.13)

// AAD для токена мессенджера: token:<botId>:TELEGRAM
export function tokenAad(botId: string, messenger = 'TELEGRAM'): string {
  return `token:${botId}:${messenger}`;
}

// AAD для секретной переменной окружения (бота или проекта): env:<ownerId>:<name>
export function envAad(ownerId: string, name: string): string {
  return `env:${ownerId}:${name}`;
}

// AAD для секретного заголовка HTTP-блока: header:<projectId>:<name>
export function headerAad(projectId: string, name: string): string {
  return `header:${projectId}:${name}`;
}
