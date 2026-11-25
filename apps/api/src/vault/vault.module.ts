import { SecretVault } from '@chatbot/vault';
import { Global, Module } from '@nestjs/common';

// Глобальный модуль хранилища секретов (AES-256-GCM и HMAC-SHA-256)
@Global()
@Module({
  providers: [{ provide: SecretVault, useFactory: () => SecretVault.fromEnv() }],
  exports: [SecretVault],
})
export class VaultModule {}
