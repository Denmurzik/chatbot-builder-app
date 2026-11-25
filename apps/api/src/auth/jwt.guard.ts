import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { SESSION_COOKIE_NAME } from '../config';
import { AuthService } from './auth.service';
import type { AuthenticatedRequest } from './current-author.decorator';

// Гард авторизации: проверяет JWT из httpOnly cookie session через AuthService и загружает автора
@Injectable()
export class JwtGuard implements CanActivate {
  constructor(private readonly authService: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = request.cookies?.[SESSION_COOKIE_NAME];
    request.author = await this.authService.authenticate(typeof token === 'string' ? token : '');
    return true;
  }
}
