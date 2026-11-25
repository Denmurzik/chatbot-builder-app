import { useState } from 'react';
import { ChevronDown, Download, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { type ExportFormat, useExportScenario } from '@/api/import-export';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ru } from '@/i18n/ru';
import { ImportDialog } from './ImportDialog';

export interface ScenarioExportOptions {
  projectId: string;
  projectName: string;
  dirty: boolean;
  disabled?: boolean;
  onSaveBeforeExport: () => Promise<boolean>;
}

// Общий хук экспорта JSON/YAML для шапки редактора и мобильного меню
export function useScenarioExport({
  projectId,
  projectName,
  dirty,
  disabled = false,
  onSaveBeforeExport,
}: ScenarioExportOptions) {
  const exportMutation = useExportScenario(projectId, projectName);

  async function handleExport(format: ExportFormat) {
    if (disabled || exportMutation.isPending) return;
    if (dirty) {
      const saved = await onSaveBeforeExport();
      if (!saved) return;
    }
    try {
      await exportMutation.mutateAsync(format);
    } catch {
      toast.error(ru.importExport.exportError);
    }
  }

  return {
    exporting: exportMutation.isPending,
    handleExport,
  };
}

export interface ImportExportMenuProps extends ScenarioExportOptions {
  onImported: () => Promise<void> | void;
  // Если передан внешний обработчик, диалог импорта монтируется один раз в родителе
  onOpenImport?: () => void;
}

// Кнопки экспорта (JSON/YAML) и импорта сценария в шапке редактора
export function ImportExportMenu({
  projectId,
  projectName,
  dirty,
  disabled = false,
  onSaveBeforeExport,
  onImported,
  onOpenImport,
}: ImportExportMenuProps) {
  const [internalImportOpen, setInternalImportOpen] = useState(false);
  const { exporting, handleExport } = useScenarioExport({
    projectId,
    projectName,
    dirty,
    disabled,
    onSaveBeforeExport,
  });

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" size="sm" variant="outline" disabled={disabled || exporting}>
            <Download className="size-4" />
            {exporting ? ru.importExport.exporting : ru.importExport.export}
            <ChevronDown className="size-3.5 opacity-70" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => void handleExport('json')}>
            {ru.importExport.exportJson}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => void handleExport('yaml')}>
            {ru.importExport.exportYaml}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={disabled}
        onClick={() => (onOpenImport ? onOpenImport() : setInternalImportOpen(true))}
      >
        <Upload className="size-4" />
        {ru.importExport.import}
      </Button>
      {!onOpenImport && (
        <ImportDialog
          projectId={projectId}
          open={internalImportOpen}
          onOpenChange={setInternalImportOpen}
          onImported={onImported}
        />
      )}
    </>
  );
}
