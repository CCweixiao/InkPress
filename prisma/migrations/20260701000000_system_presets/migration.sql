-- 预设公共系统配置（需求 3）。
-- 幂等：INSERT OR IGNORE，用户后续修改不会被覆盖（key 唯一约束）。
-- 仅 DML，无 DDL（SystemConfig 表由 20260620145314 建表迁移创建）。

-- 1. 外观配置：夜间模式 auto / 主题色
INSERT OR IGNORE INTO "SystemConfig" ("id", "key", "value", "createdAt", "updatedAt")
VALUES (
  lower(hex(randomblob(12))),
  'inkpress.appearance',
  '{"mode":"auto","primaryColor":"#3f51b5"}',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
);

-- 2. 国际化语言：默认简体中文
INSERT OR IGNORE INTO "SystemConfig" ("id", "key", "value", "createdAt", "updatedAt")
VALUES (
  lower(hex(randomblob(12))),
  'inkpress.i18n',
  '{"locale":"zh-CN"}',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
);

-- 3. LLM 厂商预设模板（只读，不含密钥；用户导入后填 apiKey 存到 inkpress.llm）
INSERT OR IGNORE INTO "SystemConfig" ("id", "key", "value", "createdAt", "updatedAt")
VALUES (
  lower(hex(randomblob(12))),
  'inkpress.llm.presets',
  '[{"id":"openai","name":"OpenAI","apiProvider":"openai","baseUrl":"https://api.openai.com/v1","models":[{"id":"gpt-4o","name":"GPT-4o"},{"id":"gpt-4o-mini","name":"GPT-4o mini"}],"docsUrl":"https://platform.openai.com/api-keys"},{"id":"deepseek","name":"DeepSeek","apiProvider":"openai","baseUrl":"https://api.deepseek.com/v1","models":[{"id":"deepseek-chat","name":"DeepSeek Chat"},{"id":"deepseek-reasoner","name":"DeepSeek Reasoner"}],"docsUrl":"https://platform.deepseek.com/api_keys"},{"id":"anthropic","name":"Anthropic Claude","apiProvider":"anthropic","baseUrl":"https://api.anthropic.com/v1","models":[{"id":"claude-sonnet-4-5","name":"Claude Sonnet 4.5"},{"id":"claude-opus-4","name":"Claude Opus 4"}],"docsUrl":"https://console.anthropic.com/settings/keys"},{"id":"openrouter","name":"OpenRouter","apiProvider":"openai","baseUrl":"https://openrouter.ai/api/v1","models":[{"id":"anthropic/claude-sonnet-4.5","name":"Claude Sonnet 4.5"},{"id":"openai/gpt-4o","name":"GPT-4o"}],"docsUrl":"https://openrouter.ai/keys"},{"id":"azure","name":"Azure OpenAI","apiProvider":"openai","baseUrl":"https://{resource}.openai.azure.com/openai/deployments/{deployment}","models":[{"id":"gpt-4o","name":"GPT-4o"},{"id":"gpt-4o-mini","name":"GPT-4o mini"}],"docsUrl":"https://portal.azure.com"},{"id":"ollama","name":"Ollama（本地）","apiProvider":"openai","baseUrl":"http://127.0.0.1:11434/v1","models":[{"id":"qwen2.5:32b","name":"Qwen2.5 32B"},{"id":"llama3.3:70b","name":"Llama 3.3 70B"}],"docsUrl":"https://ollama.com"}]',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
);
