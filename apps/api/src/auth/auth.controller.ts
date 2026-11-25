import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { CookieOptions, Response } from 'express';
import { z } from 'zod';
import { ZodBodyPipe } from '../common/zod-body.pipe';
import { API_CONFIG, type ApiConfig, SESSION_COOKIE_NAME, SESSION_TTL_MS } from '../config';
import { AuthService } from './auth.service';
import { type AuthenticatedAuthor, CurrentAuthor } from './current-author.decorator';
import { JwtGuard } from './jwt.guard';

const registerBodySchema = z.object({
  email: z.string().trim().email('Некорректный формат email'),
  password: z
    .string()
    .min(8, 'Пароль должен содержать не менее 8 символов')
    .max(256, 'Пароль слишком длинный'),
});

const loginBodySchema = z.object({
  email: z.string().trim().email('Некорректный формат email'),
  password: z.string().min(1, 'Введите пароль').max(256, 'Пароль слишком длинный'),
});

type RegisterBody = z.infer<typeof registerBodySchema>;
type LoginBody = z.infer<typeof loginBodySchema>;

// Контроллер аутентификации авторов (UC-A-01..03, класс модели AuthController)
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    @Inject(API_CONFIG) private readonly config: ApiConfig,
  ) {}

  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  async register(
    @Body(new ZodBodyPipe(registerBodySchema)) body: RegisterBody,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthenticatedAuthor> {
    const { author, token } = await this.authService.register(body.email, body.password);
    res.cookie(SESSION_COOKIE_NAME, token, this.cookieOptions());
    return author;
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body(new ZodBodyPipe(loginBodySchema)) body: LoginBody,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthenticatedAuthor> {
    const { author, token } = await this.authService.login(body.email, body.password);
    res.cookie(SESSION_COOKIE_NAME, token, this.cookieOptions());
    return author;
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  logout(@Res({ passthrough: true }) res: Response): void {
    res.clearCookie(SESSION_COOKIE_NAME, this.clearCookieOptions());
  }

  @Get('me')
  @UseGuards(JwtGuard)
  me(@CurrentAuthor() author: AuthenticatedAuthor): AuthenticatedAuthor {
    return author;
  }

  private cookieOptions(): CookieOptions {
    return {
      httpOnly: true,
      sameSite: 'lax',
      secure: this.config.isProduction,
      maxAge: SESSION_TTL_MS,
      path: '/',
    };
  }

  private clearCookieOptions(): CookieOptions {
    return {
      httpOnly: true,
      sameSite: 'lax',
      secure: this.config.isProduction,
      path: '/',
    };
  }
}
