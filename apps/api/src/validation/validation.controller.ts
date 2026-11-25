import { environmentSchema, type Scenario, type ValidationError } from '@chatbot/model';
import {
  Controller,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { type AuthenticatedAuthor, CurrentAuthor } from '../auth/current-author.decorator';
import { JwtGuard } from '../auth/jwt.guard';
import { PrismaService } from '../prisma/prisma.module';
import { ScenarioValidator } from './scenario-validator';

// Контроллер смысловой проверки сохранённого сценария проекта (UC-A-24)
@Controller('projects')
@UseGuards(JwtGuard)
export class ValidationController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly validator: ScenarioValidator,
  ) {}

  @Post(':projectId/validate')
  @HttpCode(HttpStatus.OK)
  async validateProject(
    @CurrentAuthor() author: AuthenticatedAuthor,
    @Param('projectId') projectId: string,
  ): Promise<{ errors: ValidationError[] }> {
    const project = await this.prisma.client.project.findFirst({
      where: { id: projectId, authorId: author.id },
      select: { scenario: true, environment: true },
    });

    if (!project) {
      throw new NotFoundException('Проект не найден');
    }

    const scenario = project.scenario as unknown as Scenario;
    const parsedEnv = environmentSchema.safeParse(project.environment);
    const envVars = parsedEnv.success ? parsedEnv.data : [];
    return { errors: this.validator.validate(scenario, envVars) };
  }
}
