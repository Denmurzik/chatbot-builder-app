import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';

const DOCTOR_SCENARIO_PATH = path.resolve(
  process.cwd(),
  'packages/engine-core/examples/doctor-with-http.json',
);

test('полный пользовательский сценарий: регистрация, импорт, окружение, превью с HTTP, экспорт/импорт YAML, бот и каскадное удаление', async ({
  page,
}, testInfo) => {
  const email = `e2e-${Date.now()}@example.com`;
  const password = 'E2ePassword123!';
  const initialProjectName = 'E2E Бот';
  const renamedProjectName = 'E2E Клиника';
  const botName = 'Бот клиники';
  const patientName = 'Иван Иванов';

  // 1. Регистрация нового автора и переход на страницу проектов
  await page.goto('/register');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Пароль').fill(password);
  await page.getByRole('button', { name: 'Зарегистрироваться' }).click();

  await expect(page).toHaveURL(/\/projects$/);
  await expect(page.getByRole('heading', { name: 'Проекты' })).toBeVisible();

  // 2. Создание проекта, возврат к списку, переименование через диалог и открытие редактора
  await page.getByRole('button', { name: 'Новый проект' }).click();
  const createDialog = page.getByRole('dialog', { name: 'Новый проект' });
  await createDialog.getByLabel('Название').fill(initialProjectName);
  await createDialog.getByRole('button', { name: 'Создать' }).click();

  await expect(page).toHaveURL(/\/projects\/[^/]+$/);
  await page.getByRole('link', { name: 'К проектам' }).click();
  await expect(page).toHaveURL(/\/projects$/);

  await page.getByRole('button', { name: `Действия с проектом «${initialProjectName}»` }).click();
  await page.getByRole('menuitem', { name: 'Переименовать' }).click();

  const renameDialog = page.getByRole('dialog', { name: 'Переименовать проект' });
  const renameInput = renameDialog.getByLabel('Название');
  await renameInput.fill(renamedProjectName);
  await renameDialog.getByRole('button', { name: 'Сохранить' }).click();
  await expect(renameDialog).toBeHidden();

  const renamedCardLink = page.getByRole('link', { name: new RegExp(renamedProjectName) });
  await expect(renamedCardLink).toBeVisible();
  await renamedCardLink.click();

  await expect(page).toHaveURL(/\/projects\/[^/]+$/);
  await expect(page.getByRole('heading', { name: renamedProjectName })).toBeVisible();

  // 3. Импорт примера doctor-with-http.json и проверка предупреждений missingEnvVariable
  await page.getByRole('button', { name: 'Импорт' }).click();
  const importDialog = page.getByRole('dialog', { name: 'Импорт сценария' });
  await importDialog.locator('input[type="file"]').setInputFiles(DOCTOR_SCENARIO_PATH);
  await importDialog.getByRole('button', { name: 'Импортировать' }).click();
  await expect(importDialog).toBeHidden();

  await page.getByRole('button', { name: 'Проверить' }).click();
  const validationPanel = page.getByTestId('validation-panel');
  await expect(validationPanel).toBeVisible();
  await expect(validationPanel).toContainText('Ошибок: 0, предупреждений:');
  await expect(validationPanel).toContainText(
    'Переменная окружения «env.API_URL» не задана в окружении',
  );
  await expect(validationPanel).toContainText(
    'Переменная окружения «env.API_KEY» не задана в окружении',
  );
  await validationPanel.getByRole('button', { name: 'Закрыть' }).click();
  await expect(validationPanel).toBeHidden();

  // 4. Настройка тестового окружения (API_URL + секрет API_KEY) и повторная проверка
  await page.getByRole('button', { name: 'Тестовое окружение' }).click();
  const envDialog = page.getByRole('dialog', { name: 'Тестовое окружение' });
  await expect(envDialog).toBeVisible();

  await envDialog.getByRole('button', { name: 'Добавить переменную' }).click();
  const rows = envDialog.locator('ul > li');
  await rows.nth(0).getByPlaceholder('Имя').fill('API_URL');
  await rows.nth(0).getByPlaceholder('Значение').fill('http://127.0.0.1:4010');

  await envDialog.getByRole('button', { name: 'Добавить переменную' }).click();
  await rows.nth(1).getByPlaceholder('Имя').fill('API_KEY');
  await rows.nth(1).getByPlaceholder('Значение').fill('test-key');
  await rows.nth(1).getByRole('checkbox', { name: 'Секрет' }).check();

  await envDialog.getByRole('button', { name: 'Сохранить окружение' }).click();
  // После сохранения секретная переменная маскируется и появляется кнопка «Заменить»
  await expect(envDialog.getByRole('button', { name: 'Заменить' })).toBeVisible();
  await envDialog.getByRole('button', { name: 'Закрыть' }).click();
  await expect(envDialog).toBeHidden();

  await page.getByRole('button', { name: 'Проверить' }).click();
  await expect(validationPanel).toBeVisible();
  await expect(validationPanel).toContainText('Ошибок не найдено');
  await validationPanel.getByRole('button', { name: 'Закрыть' }).click();
  await expect(validationPanel).toBeHidden();

  // 5. Превью: полный диалог записи к врачу через живой engine и mock-clinic
  await page.getByRole('button', { name: 'Превью' }).click();
  const previewPanel = page.getByTestId('preview-panel');
  await expect(previewPanel).toBeVisible();
  await expect(previewPanel).toContainText('Подключено');
  await expect(previewPanel).toContainText('Здравствуйте! Запишу вас к врачу.');
  await expect(previewPanel).toContainText('Введите ваше ФИО:');

  await previewPanel.getByLabel('Сообщение в превью').fill(patientName);
  await previewPanel.getByRole('button', { name: 'Отправить' }).click();

  await expect(previewPanel).toContainText(`Выберите врача, ${patientName}:`);
  const doctorButton = previewPanel.getByRole('button', { name: 'Иванова Анна Петровна' });
  await expect(doctorButton).toBeVisible();
  await doctorButton.click();

  await expect(previewPanel).toContainText('Выберите удобное время:');
  const slotButton = previewPanel.getByRole('button', { name: '2026-12-03 10:00' });
  await expect(slotButton).toBeVisible();
  await slotButton.click();

  await expect(previewPanel).toContainText(
    `${patientName}, вы записаны! Врач: Иванова Анна Петровна, время: 2026-12-03 10:00`,
  );

  // Проверяем панель переменных диалога
  await previewPanel.getByRole('button', { name: /Переменные/ }).click();
  await expect(previewPanel).toContainText('fio');
  await expect(previewPanel).toContainText(patientName);
  await expect(previewPanel).toContainText('bookingDoctor');
  await expect(previewPanel).toContainText('Иванова Анна Петровна');
  await expect(previewPanel).toContainText('bookingId');

  await previewPanel.getByRole('button', { name: 'Закрыть' }).click();
  await expect(previewPanel).toBeHidden();

  // 6. Экспорт сценария в JSON и YAML, проверка отсутствия секретов и обратный импорт YAML
  await page.getByRole('button', { name: 'Экспорт' }).click();
  const [jsonDownload] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('menuitem', { name: 'JSON (.json)' }).click(),
  ]);
  expect(jsonDownload.suggestedFilename()).toMatch(/\.json$/i);
  const jsonFilePath = testInfo.outputPath('exported-scenario.json');
  await jsonDownload.saveAs(jsonFilePath);
  const jsonContent = fs.readFileSync(jsonFilePath, 'utf-8');
  expect(jsonContent.length).toBeGreaterThan(100);
  expect(jsonContent).not.toContain('test-key');
  const parsedJson = JSON.parse(jsonContent) as { formatVersion?: number; blocks?: unknown[] };
  expect(parsedJson.formatVersion).toBe(1);
  expect(Array.isArray(parsedJson.blocks)).toBe(true);

  await page.getByRole('button', { name: 'Экспорт' }).click();
  const [yamlDownload] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('menuitem', { name: 'YAML (.yaml)' }).click(),
  ]);
  expect(yamlDownload.suggestedFilename()).toMatch(/\.yaml$/i);
  const yamlFilePath = testInfo.outputPath('exported-scenario.yaml');
  await yamlDownload.saveAs(yamlFilePath);
  const yamlContent = fs.readFileSync(yamlFilePath, 'utf-8');
  expect(yamlContent.length).toBeGreaterThan(100);
  expect(yamlContent).toContain('formatVersion: 1');
  expect(yamlContent).not.toContain('test-key');

  // Повторный импорт выгруженного YAML (round-trip)
  await page.getByRole('button', { name: 'Импорт' }).click();
  await expect(importDialog).toBeVisible();
  await importDialog.locator('input[type="file"]').setInputFiles(yamlFilePath);
  await importDialog.getByRole('button', { name: 'Импортировать' }).click();
  await expect(importDialog).toBeHidden();

  // 7. Переход на страницу ботов, создание бота и проверка секций Telegram и VK
  await page.getByRole('link', { name: 'Боты' }).click();
  await expect(page).toHaveURL(/\/projects\/[^/]+\/bots$/);

  await page.getByRole('button', { name: 'Новый бот' }).click();
  const createBotDialog = page.getByRole('dialog', { name: 'Новый бот' });
  await createBotDialog.getByLabel('Название').fill(botName);
  await createBotDialog.getByRole('button', { name: 'Создать' }).click();
  await expect(createBotDialog).toBeHidden();

  await expect(page.getByText(botName)).toBeVisible();
  await expect(page.getByText('Подключение к Telegram')).toBeVisible();
  await expect(page.getByText('Подключение к VK')).toBeVisible();

  // 8. Возврат к списку проектов и каскадное удаление с проверкой предупреждения об 1 боте
  await page.getByRole('link', { name: 'К сценарию' }).click();
  await expect(page).toHaveURL(/\/projects\/[^/]+$/);
  await page.getByRole('link', { name: 'К проектам' }).click();
  await expect(page).toHaveURL(/\/projects$/);

  await page.getByRole('button', { name: `Действия с проектом «${renamedProjectName}»` }).click();
  await page.getByRole('menuitem', { name: 'Удалить' }).click();

  const deleteDialog = page.getByRole('dialog', { name: 'Удалить проект?' });
  await expect(deleteDialog.getByRole('alert')).toContainText(
    'Вместе с проектом будет отключён и удалён 1 бот и все его диалоги.',
  );
  await deleteDialog.getByRole('button', { name: 'Удалить' }).click();
  await expect(deleteDialog).toBeHidden();

  await expect(page.getByRole('link', { name: new RegExp(renamedProjectName) })).toHaveCount(0);
});
