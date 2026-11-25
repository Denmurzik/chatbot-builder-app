import { createClinicServer } from './server';

const DEFAULT_PORT = 4010;
const DEFAULT_API_KEY = 'test-key';

const rawPort = process.env.MOCK_CLINIC_PORT;
const parsedPort = rawPort ? Number(rawPort) : DEFAULT_PORT;
const port = Number.isInteger(parsedPort) && parsedPort > 0 ? parsedPort : DEFAULT_PORT;
const apiKey = process.env.MOCK_CLINIC_API_KEY || DEFAULT_API_KEY;

const server = createClinicServer({ apiKey });

server.listen(port, () => {
  console.log(`Тестовый API клиники запущен на http://127.0.0.1:${port}`);
});

function shutdown(): void {
  server.close(() => {
    process.exit(0);
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
