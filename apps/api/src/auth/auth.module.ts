import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { API_CONFIG, type ApiConfig, SESSION_TTL_SECONDS } from '../config';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtGuard } from './jwt.guard';

// Модуль аутентификации и управления сессиями авторов
@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [API_CONFIG],
      useFactory: (config: ApiConfig) => ({
        secret: config.jwtSecret,
        signOptions: { expiresIn: SESSION_TTL_SECONDS, algorithm: 'HS256' },
        verifyOptions: { algorithms: ['HS256'] },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtGuard],
  exports: [AuthService, JwtGuard, JwtModule],
})
export class AuthModule {}
