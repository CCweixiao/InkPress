-- Additive migration: Tag 加 parentId 自关联（严格两级）
-- 用 new_Tag 重建模式，因为 SQLite ALTER TABLE ADD COLUMN 带 FK 不稳

PRAGMA defer_foreign_keys=ON;

CREATE TABLE new_Tag (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#6b7280',
  parentId TEXT,
  sortOrder INTEGER NOT NULL DEFAULT 0,
  createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (parentId) REFERENCES Tag(id) ON DELETE RESTRICT
);

-- 复制存量 tag，parentId 全部 NULL（提升为一级）
INSERT INTO new_Tag (id, name, color, parentId, sortOrder, createdAt, updatedAt)
SELECT id, name, color, NULL, sortOrder, createdAt, updatedAt FROM Tag;

-- 替换表
DROP TABLE Tag;
ALTER TABLE new_Tag RENAME TO Tag;

-- 重建索引
CREATE UNIQUE INDEX Tag_name_key ON Tag(name);
CREATE INDEX Tag_parentId_idx ON Tag(parentId);
