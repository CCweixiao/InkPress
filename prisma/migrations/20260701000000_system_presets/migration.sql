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
