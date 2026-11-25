# Многоэтапная сборка монорепозитория. Сборка и запуск — на одном базовом образе,
# чтобы движок Prisma (openssl) совпал.
FROM node:22-bookworm-slim AS base
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
RUN corepack enable
WORKDIR /app

# Этап сборки: зависимости, prisma generate (postinstall), tsc -b и vite build
FROM base AS build
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm build

# Миграции базы данных (prisma migrate deploy), запускаются один раз и завершаются
FROM build AS migrate
ENV NODE_ENV=production
CMD ["pnpm", "--filter", "@chatbot/db", "db:migrate"]

FROM build AS api
ENV NODE_ENV=production
USER node
EXPOSE 3000
WORKDIR /app/apps/api
CMD ["node", "dist/main.js"]

FROM build AS engine
ENV NODE_ENV=production
USER node
WORKDIR /app/apps/engine
CMD ["node", "dist/main.js"]

FROM build AS mock-clinic
ENV NODE_ENV=production
USER node
EXPOSE 4010
WORKDIR /app/apps/mock-clinic
CMD ["node", "dist/main.js"]

# Статика SPA и прокси на api
FROM nginx:1.27-alpine AS web
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 80
