-- 新增加密 License 明文字段。历史记录无法反推出明文，因此保持 NULL。
ALTER TABLE "LicenseKey" ADD COLUMN "keyCiphertext" TEXT;

