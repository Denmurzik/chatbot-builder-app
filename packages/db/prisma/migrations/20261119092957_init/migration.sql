-- CreateEnum
CREATE TYPE "BotStatus" AS ENUM ('CREATED', 'PUBLISHED');

-- CreateEnum
CREATE TYPE "MessengerType" AS ENUM ('TELEGRAM', 'VK');

-- CreateEnum
CREATE TYPE "Channel" AS ENUM ('MESSENGER', 'PREVIEW');

-- CreateEnum
CREATE TYPE "DialogState" AS ENUM ('RUNNING', 'WAITING_USER', 'WAITING_EXTERNAL', 'SUSPENDED', 'FINISHED');

-- CreateEnum
CREATE TYPE "RequestStatus" AS ENUM ('SENT', 'SUCCEEDED', 'FAILED', 'TIMED_OUT');

-- CreateTable
CREATE TABLE "author" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "author_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project" (
    "id" TEXT NOT NULL,
    "author_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "scenario" JSONB NOT NULL,
    "environment" JSONB NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bot" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "BotStatus" NOT NULL DEFAULT 'CREATED',
    "published_scenario" JSONB,
    "environment" JSONB NOT NULL,
    "published_at" TIMESTAMP(3),

    CONSTRAINT "bot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messenger_connection" (
    "id" TEXT NOT NULL,
    "bot_id" TEXT NOT NULL,
    "messenger" "MessengerType" NOT NULL,
    "token_cipher" TEXT NOT NULL,
    "token_mask" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,

    CONSTRAINT "messenger_connection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dialog_context" (
    "id" TEXT NOT NULL,
    "bot_id" TEXT,
    "chat_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "channel" "Channel" NOT NULL,
    "state" "DialogState" NOT NULL,
    "current_block_id" TEXT NOT NULL,
    "variables" JSONB NOT NULL,
    "current_request_id" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dialog_context_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "http_request" (
    "id" TEXT NOT NULL,
    "dialog_context_id" TEXT NOT NULL,
    "block_id" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "headers" JSONB NOT NULL,
    "body" TEXT NOT NULL,
    "status" "RequestStatus" NOT NULL,
    "response_code" INTEGER,
    "response_body" TEXT,
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "http_request_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "author_email_key" ON "author"("email");

-- CreateIndex
CREATE UNIQUE INDEX "messenger_connection_token_hash_key" ON "messenger_connection"("token_hash");

-- CreateIndex
CREATE UNIQUE INDEX "messenger_connection_bot_id_messenger_key" ON "messenger_connection"("bot_id", "messenger");

-- CreateIndex
CREATE UNIQUE INDEX "dialog_context_bot_id_chat_id_key" ON "dialog_context"("bot_id", "chat_id");

-- CreateIndex
CREATE INDEX "http_request_dialog_context_id_idx" ON "http_request"("dialog_context_id");

-- CreateIndex
CREATE INDEX "http_request_status_created_at_idx" ON "http_request"("status", "created_at");

-- AddForeignKey
ALTER TABLE "project" ADD CONSTRAINT "project_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "author"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bot" ADD CONSTRAINT "bot_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messenger_connection" ADD CONSTRAINT "messenger_connection_bot_id_fkey" FOREIGN KEY ("bot_id") REFERENCES "bot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dialog_context" ADD CONSTRAINT "dialog_context_bot_id_fkey" FOREIGN KEY ("bot_id") REFERENCES "bot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dialog_context" ADD CONSTRAINT "dialog_context_current_request_id_fkey" FOREIGN KEY ("current_request_id") REFERENCES "http_request"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "http_request" ADD CONSTRAINT "http_request_dialog_context_id_fkey" FOREIGN KEY ("dialog_context_id") REFERENCES "dialog_context"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
