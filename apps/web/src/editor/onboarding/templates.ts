import { emptyScenario, type Scenario } from '@chatbot/model';
import { ru } from '@/i18n/ru';

export interface ScenarioTemplate {
  id: 'empty' | 'doctor';
  title: string;
  hint: string;
  build(): Scenario;
}

// Шаг раскладки: блоки идут слева направо, координаты кратны 20
const COL = 380;

// Шаблон «Запись к врачу»: имя → выбор специалиста → подтверждение → конец (без HTTP)
function doctorScenario(): Scenario {
  return {
    formatVersion: 1,
    blocks: [
      { id: 'entry', type: 'ENTRY_POINT', title: 'Старт', x: 0, y: 100 },
      {
        id: 'ask_name',
        type: 'TEXT_INPUT',
        title: 'Имя',
        question: 'Здравствуйте! Как вас зовут?',
        variableName: 'name',
        x: COL,
        y: 80,
      },
      {
        id: 'ask_doctor',
        type: 'OPTION_CHOICE',
        title: 'Специалист',
        question: 'К какому врачу хотите записаться, {{name}}?',
        options: ['Терапевт', 'Стоматолог'],
        variableName: 'doctor',
        x: COL * 2,
        y: 60,
      },
      {
        id: 'bye_therapist',
        type: 'TEXT_MESSAGE',
        title: 'Запись к терапевту',
        text: 'Записали вас к терапевту, {{name}}. Ждём вас!',
        x: COL * 3,
        y: 0,
      },
      {
        id: 'bye_dentist',
        type: 'TEXT_MESSAGE',
        title: 'Запись к стоматологу',
        text: 'Записали вас к стоматологу, {{name}}. Ждём вас!',
        x: COL * 3,
        y: 260,
      },
      { id: 'exit', type: 'EXIT_POINT', title: 'Конец', x: COL * 4, y: 120 },
    ],
    transitions: [
      { source: { blockId: 'entry', output: 'default' }, target: 'ask_name' },
      { source: { blockId: 'ask_name', output: 'default' }, target: 'ask_doctor' },
      { source: { blockId: 'ask_doctor', output: 'Терапевт' }, target: 'bye_therapist' },
      { source: { blockId: 'ask_doctor', output: 'Стоматолог' }, target: 'bye_dentist' },
      { source: { blockId: 'bye_therapist', output: 'default' }, target: 'exit' },
      { source: { blockId: 'bye_dentist', output: 'default' }, target: 'exit' },
    ],
  };
}

export const TEMPLATES: readonly ScenarioTemplate[] = [
  {
    id: 'empty',
    title: ru.editor.onboarding.welcomeEmpty,
    hint: ru.editor.onboarding.welcomeEmptyHint,
    build: emptyScenario,
  },
  {
    id: 'doctor',
    title: ru.editor.onboarding.welcomeTemplate,
    hint: ru.editor.onboarding.welcomeTemplateHint,
    build: doctorScenario,
  },
];
