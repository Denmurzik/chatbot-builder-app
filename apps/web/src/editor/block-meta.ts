import {
  Braces,
  CircleStop,
  Globe,
  GitBranch,
  ListChecks,
  ListTree,
  MessageSquare,
  Play,
  Split,
  TextCursorInput,
  type LucideIcon,
} from 'lucide-react';
import { BLOCK_TYPES, type BlockType } from '@chatbot/model';
import { ru } from '@/i18n/ru';
import type { BlockNodeData } from './convert';

// Категория блока определяет форму на холсте
export type BlockCategory = 'start' | 'finish' | 'talk' | 'logic' | 'integration';

export interface BlockMeta {
  category: BlockCategory;
  label: string;
  // Строка описания для панели «Что дальше?»
  description: string;
  icon: LucideIcon;
  // Акцентный цвет типа блока (используется только на блоках и в палитре)
  color: string;
  defaults(): BlockNodeData;
}

export const BLOCK_META: Record<BlockType, BlockMeta> = {
  ENTRY_POINT: {
    category: 'start',
    label: ru.blocks.ENTRY_POINT,
    description: ru.blockDescriptions.ENTRY_POINT,
    icon: Play,
    color: 'oklch(0.62 0.17 150)',
    defaults: () => ({ type: 'ENTRY_POINT', title: ru.blocks.ENTRY_POINT }),
  },
  EXIT_POINT: {
    category: 'finish',
    label: ru.blocks.EXIT_POINT,
    description: ru.blockDescriptions.EXIT_POINT,
    icon: CircleStop,
    color: 'oklch(0.58 0.2 25)',
    defaults: () => ({ type: 'EXIT_POINT', title: ru.blocks.EXIT_POINT }),
  },
  TEXT_MESSAGE: {
    category: 'talk',
    label: ru.blocks.TEXT_MESSAGE,
    description: ru.blockDescriptions.TEXT_MESSAGE,
    icon: MessageSquare,
    color: 'oklch(0.62 0.16 250)',
    defaults: () => ({ type: 'TEXT_MESSAGE', title: ru.blocks.TEXT_MESSAGE, text: '' }),
  },
  TEXT_INPUT: {
    category: 'talk',
    label: ru.blocks.TEXT_INPUT,
    description: ru.blockDescriptions.TEXT_INPUT,
    icon: TextCursorInput,
    color: 'oklch(0.6 0.15 200)',
    defaults: () => ({
      type: 'TEXT_INPUT',
      title: ru.blocks.TEXT_INPUT,
      question: '',
      variableName: ru.defaults.answerVariable,
    }),
  },
  OPTION_CHOICE: {
    category: 'talk',
    label: ru.blocks.OPTION_CHOICE,
    description: ru.blockDescriptions.OPTION_CHOICE,
    icon: ListChecks,
    color: 'oklch(0.6 0.18 290)',
    defaults: () => ({
      type: 'OPTION_CHOICE',
      title: ru.blocks.OPTION_CHOICE,
      question: '',
      options: [ru.defaults.optionYes, ru.defaults.optionNo],
      variableName: ru.defaults.choiceVariable,
    }),
  },
  LIST_CHOICE: {
    category: 'talk',
    label: ru.blocks.LIST_CHOICE,
    description: ru.blockDescriptions.LIST_CHOICE,
    icon: ListTree,
    color: 'oklch(0.58 0.16 320)',
    defaults: () => ({
      type: 'LIST_CHOICE',
      title: ru.blocks.LIST_CHOICE,
      question: '',
      listVariable: ru.defaults.listVariable,
      labelField: ru.defaults.labelField,
      valueField: ru.defaults.valueField,
      variableName: ru.defaults.selectedVariable,
    }),
  },
  ASSIGNMENT: {
    category: 'logic',
    label: ru.blocks.ASSIGNMENT,
    description: ru.blockDescriptions.ASSIGNMENT,
    icon: Braces,
    color: 'oklch(0.55 0.04 260)',
    defaults: () => ({
      type: 'ASSIGNMENT',
      title: ru.blocks.ASSIGNMENT,
      variableName: ru.defaults.assignVariable,
      expression: '',
    }),
  },
  CONDITION: {
    category: 'logic',
    label: ru.blocks.CONDITION,
    description: ru.blockDescriptions.CONDITION,
    icon: GitBranch,
    color: 'oklch(0.72 0.15 75)',
    defaults: () => ({ type: 'CONDITION', title: ru.blocks.CONDITION, expression: '' }),
  },
  SWITCH: {
    category: 'logic',
    label: ru.blocks.SWITCH,
    description: ru.blockDescriptions.SWITCH,
    icon: Split,
    color: 'oklch(0.68 0.16 55)',
    defaults: () => ({
      type: 'SWITCH',
      title: ru.blocks.SWITCH,
      variableName: ru.defaults.switchVariable,
      values: [...ru.defaults.switchValues],
    }),
  },
  HTTP_REQUEST: {
    category: 'integration',
    label: ru.blocks.HTTP_REQUEST,
    description: ru.blockDescriptions.HTTP_REQUEST,
    icon: Globe,
    color: 'oklch(0.6 0.13 180)',
    defaults: () => ({
      type: 'HTTP_REQUEST',
      title: ru.blocks.HTTP_REQUEST,
      method: 'GET',
      url: '',
      headers: [],
      body: '',
      variableName: ru.defaults.responseVariable,
      errorVariable: ru.defaults.errorVariable,
      timeoutSec: 10,
      retryCount: 0,
      retryIntervalSec: 1,
      errorStrategy: 'EXIT_ERROR',
      suspendText: null,
      responseMappings: [],
    }),
  },
};

export const BLOCK_ORDER: readonly BlockType[] = BLOCK_TYPES;
