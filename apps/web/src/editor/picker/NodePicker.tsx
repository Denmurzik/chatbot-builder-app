import { useState } from 'react';
import { Search } from 'lucide-react';
import type { BlockType } from '@chatbot/model';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { ru } from '@/i18n/ru';
import { BLOCK_META, BLOCK_ORDER, type BlockCategory } from '../block-meta';

// Тип блока, переносимый на холст (HTML5 drag & drop)
export const BLOCK_DRAG_MIME = 'application/x-chatbot-block-type';

const GROUPS: readonly Exclude<BlockCategory, 'start'>[] = [
  'talk',
  'logic',
  'integration',
  'finish',
];

interface NodePickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // Типы, которые в этом контексте предлагать нельзя («Точка входа» не предлагается никогда)
  excluded?: readonly BlockType[];
  onPick: (type: BlockType) => void;
}

function matches(type: BlockType, query: string): boolean {
  const meta = BLOCK_META[type];
  const needle = query.trim().toLowerCase();
  return (
    needle === '' ||
    meta.label.toLowerCase().includes(needle) ||
    meta.description.toLowerCase().includes(needle)
  );
}

function PickerBody({
  excluded,
  onPick,
}: {
  excluded: readonly BlockType[];
  onPick: (type: BlockType) => void;
}) {
  const [query, setQuery] = useState('');
  const available = BLOCK_ORDER.filter(
    (type) => type !== 'ENTRY_POINT' && !excluded.includes(type) && matches(type, query),
  );
  const groups = GROUPS.map((category) => ({
    category,
    types: available.filter((type) => BLOCK_META[type].category === category),
  })).filter((group) => group.types.length > 0);

  return (
    <>
      <div className="relative px-4">
        <Search className="pointer-events-none absolute top-1/2 left-7 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && available[0]) {
              event.preventDefault();
              onPick(available[0]);
            }
          }}
          placeholder={ru.editor.picker.searchPlaceholder}
          aria-label={ru.editor.picker.searchPlaceholder}
          className="pl-9"
        />
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-4 px-4 pb-4">
          {groups.length === 0 && (
            <p className="py-6 text-center text-sm text-muted-foreground">
              {ru.editor.picker.empty}
            </p>
          )}
          {groups.map(({ category, types }) => (
            <section key={category} aria-label={ru.editor.picker.categories[category]}>
              <h3 className="mb-1 text-xs font-medium text-muted-foreground uppercase">
                {ru.editor.picker.categories[category]}
              </h3>
              <ul className="flex flex-col gap-1">
                {types.map((type) => {
                  const meta = BLOCK_META[type];
                  const Icon = meta.icon;
                  return (
                    <li key={type}>
                      <button
                        type="button"
                        draggable
                        onClick={() => onPick(type)}
                        onDragStart={(event) => {
                          event.dataTransfer.setData(BLOCK_DRAG_MIME, type);
                          event.dataTransfer.effectAllowed = 'copy';
                        }}
                        className="flex w-full items-center gap-3 rounded-md border border-transparent px-2 py-2 text-left hover:border-border hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
                      >
                        <span
                          className="flex size-8 shrink-0 items-center justify-center rounded-md text-white"
                          style={{ backgroundColor: meta.color }}
                        >
                          <Icon className="size-4" />
                        </span>
                        <span className="min-w-0">
                          <span className="block text-sm font-medium">{meta.label}</span>
                          <span className="block text-xs text-muted-foreground">
                            {meta.description}
                          </span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      </ScrollArea>
    </>
  );
}

// Выезжающая справа панель «Что дальше?»: накладывается на холст и инспектор, холст остаётся
// доступным (modal=false), чтобы блоки можно было перетащить на него
export function NodePicker({ open, onOpenChange, excluded = [], onPick }: NodePickerProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange} modal={false}>
      <SheetContent
        side="right"
        overlay={false}
        data-testid="node-picker"
        className="w-full max-w-full gap-3 bg-card p-0 sm:w-96 sm:max-w-96"
        onCloseAutoFocus={(event) => event.preventDefault()}
      >
        <SheetHeader className="border-b bg-surface pr-12 pb-3">
          <SheetTitle>{ru.editor.picker.title}</SheetTitle>
          <SheetDescription>{ru.editor.picker.description}</SheetDescription>
        </SheetHeader>
        <PickerBody excluded={excluded} onPick={onPick} />
      </SheetContent>
    </Sheet>
  );
}
