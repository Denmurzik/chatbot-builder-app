import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

export interface AuthenticatedAuthor {
  id: string;
  email: string;
}

export interface AuthenticatedRequest extends Request {
  author?: AuthenticatedAuthor;
}

// Декоратор параметра контроллера для получения текущего авторизованного автора из запроса
export const CurrentAuthor = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedAuthor => {
    const request = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!request.author) {
      throw new Error('CurrentAuthor использован без JwtGuard');
    }
    return request.author;
  },
);
