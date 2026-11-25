import {
  envVarInputListSchema,
  type EnvVarInput,
  type EnvVarView,
} from '@chatbot/model';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { type AuthenticatedAuthor, CurrentAuthor } from '../auth/current-author.decorator';
import { JwtGuard } from '../auth/jwt.guard';
import { ZodBodyPipe } from '../common/zod-body.pipe';
import {
  type CreatedProject,
  type ProjectDetails,
  ProjectService,
  type ProjectSummary,
} from './project.service';
import { ScenarioEditor } from './scenario-editor';

const projectNameBodySchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Название проекта не может быть пустым')
    .max(200, 'Название проекта слишком длинное'),
});

type ProjectNameBody = z.infer<typeof projectNameBodySchema>;

// Контроллер проектов и сохранения сценария (класс модели ProjectController)
@Controller('projects')
@UseGuards(JwtGuard)
export class ProjectController {
  constructor(
    private readonly projectService: ProjectService,
    private readonly scenarioEditor: ScenarioEditor,
  ) {}

  @Get()
  listProjects(@CurrentAuthor() author: AuthenticatedAuthor): Promise<ProjectSummary[]> {
    return this.projectService.listByAuthor(author.id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  createProject(
    @CurrentAuthor() author: AuthenticatedAuthor,
    @Body(new ZodBodyPipe(projectNameBodySchema)) body: ProjectNameBody,
  ): Promise<CreatedProject> {
    return this.projectService.create(author.id, body.name);
  }

  @Get(':id')
  getById(
    @CurrentAuthor() author: AuthenticatedAuthor,
    @Param('id') id: string,
  ): Promise<ProjectDetails> {
    return this.projectService.getById(author.id, id);
  }

  @Put(':id/scenario')
  @HttpCode(HttpStatus.OK)
  saveScenario(
    @CurrentAuthor() author: AuthenticatedAuthor,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<{ updatedAt: Date }> {
    return this.scenarioEditor.saveScenario(author.id, id, body);
  }

  @Put(':id/environment')
  @HttpCode(HttpStatus.OK)
  setEnvironment(
    @CurrentAuthor() author: AuthenticatedAuthor,
    @Param('id') id: string,
    @Body(new ZodBodyPipe(envVarInputListSchema)) body: EnvVarInput[],
  ): Promise<EnvVarView[]> {
    return this.projectService.setEnvironment(author.id, id, body);
  }

  // Переименование проекта (класс модели ProjectController, UC-A-04)
  @Patch(':id')
  @HttpCode(HttpStatus.OK)
  renameProject(
    @CurrentAuthor() author: AuthenticatedAuthor,
    @Param('id') id: string,
    @Body(new ZodBodyPipe(projectNameBodySchema)) body: ProjectNameBody,
  ): Promise<ProjectSummary> {
    return this.projectService.rename(author.id, id, body.name);
  }

  // Каскадное удаление проекта (класс модели ProjectController, UC-A-04)
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteProject(
    @CurrentAuthor() author: AuthenticatedAuthor,
    @Param('id') id: string,
  ): Promise<void> {
    return this.projectService.remove(author.id, id);
  }
}
