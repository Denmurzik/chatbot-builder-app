// Реэкспорт ключевых модулей и классов @chatbot/api
export { AppModule } from './app.module';
export { configureApp } from './configure-app';
export { API_CONFIG, ConfigModule, loadConfig, SESSION_COOKIE_NAME, SESSION_TTL_MS, SESSION_TTL_SECONDS } from './config';
export type { ApiConfig } from './config';
export { PrismaModule, PrismaService } from './prisma/prisma.module';
export { AuthModule } from './auth/auth.module';
export { AuthController } from './auth/auth.controller';
export { AuthService } from './auth/auth.service';
export { JwtGuard } from './auth/jwt.guard';
export { CurrentAuthor } from './auth/current-author.decorator';
export type { AuthenticatedAuthor, AuthenticatedRequest } from './auth/current-author.decorator';
export { ProjectModule } from './projects/project.module';
export { ProjectController } from './projects/project.controller';
export { ProjectService } from './projects/project.service';
export { ScenarioEditor } from './projects/scenario-editor';
export { ZodBodyPipe, createValidationException, formatZodIssues } from './common/zod-body.pipe';
export type { ValidationIssue } from './common/zod-body.pipe';
