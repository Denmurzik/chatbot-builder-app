import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { type AuthenticatedAuthor, CurrentAuthor } from '../auth/current-author.decorator';
import { JwtGuard } from '../auth/jwt.guard';
import {
  type ExportFormat,
  ImportExportService,
  type ImportScenarioResult,
} from './import-export.service';

// Класс модели BCE: ImportExportController — экспорт сценария без секретов и импорт с проверкой структуры (UC-A-29..A-31)
@Controller('projects')
@UseGuards(JwtGuard)
export class ImportExportController {
  constructor(private readonly importExportService: ImportExportService) {}

  @Get(':id/export')
  async exportScenario(
    @CurrentAuthor() author: AuthenticatedAuthor,
    @Param('id') id: string,
    @Query('format') format: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    const resolvedFormat = this.parseExportFormat(format);
    const { fileName, content, contentType } = await this.importExportService.exportScenario(
      author.id,
      id,
      resolvedFormat,
    );
    res.attachment(fileName);
    res.type(contentType);
    res.status(HttpStatus.OK).send(content);
  }

  @Post(':id/import')
  @HttpCode(HttpStatus.OK)
  importScenario(
    @CurrentAuthor() author: AuthenticatedAuthor,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<ImportScenarioResult> {
    return this.importExportService.importScenario(author.id, id, body);
  }

  private parseExportFormat(raw: string | undefined): ExportFormat {
    if (raw === undefined || raw === '' || raw === 'json') {
      return 'json';
    }
    if (raw === 'yaml') {
      return 'yaml';
    }
    throw new BadRequestException('Неподдерживаемый формат экспорта. Допустимы: json, yaml');
  }
}
