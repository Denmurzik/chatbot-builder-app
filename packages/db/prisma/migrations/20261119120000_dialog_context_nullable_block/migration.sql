-- AlterTable: current_block_id допускает NULL (п. 2.11: при переопубликации и в завершённом диалоге)
ALTER TABLE "dialog_context" ALTER COLUMN "current_block_id" DROP NOT NULL;
