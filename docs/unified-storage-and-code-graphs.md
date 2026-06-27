# InkPress Unified Storage And Local Code Graphs

## Boundary

SQLite remains the metadata source of truth. The unified storage layer is only
for article materials:

- images
- videos
- audio
- attachments

Code parsing outputs, Graphify graphs, technical caches, and runtime temporary
files stay in the InkPress local data directory. They are reproducible from the
authorized project source and must never be written into the explored project.

Development data root:

```text
/Users/jielongping/OpenProjects/InkPress/storage
```

Installed app data root:

```text
~/.inkpress/storage
```

## Directory Shape

```text
storage/
  spaces/
    <spaceId>/
      assets/
      articles/
        <articleId>/
          assets/
  articles/
    <articleId>/
  library/
    assets/
  code-sources/
    <sourceKey>/
      snapshots/
        <snapshotHash>/
          graphify-out/
            graph.json
            GRAPH_REPORT.md
            graph.html
            cache/
  technical-documents/
  tmp/
```

IDs are used for stable paths. Human titles can change without moving files.

## Article Material Storage

`StorageObject` describes the physical file:

- `provider`: `local`, `aliyun-oss`, future `s3/r2/cos/qiniu/minio`
- `key`: provider object key; local uses a path relative to `storage/`
- `sha256`, `size`, `contentType`, `status`

`Asset` describes business meaning:

- image, video, audio, or file
- optional `spaceId`, `articleId`
- optional `storageObjectId`
- tags, description, and `metadataJson`

Existing `Asset.ossKey` and `Asset.url` stay for compatibility. New uploads
populate them from the linked `StorageObject`.

Changing the default storage provider only affects newly uploaded materials.
Existing materials are not migrated automatically. Backup/migration between
providers is intentionally deferred.

## Markdown Rendering

Local materials are exposed through `/api/storage/<storageObjectId>` instead of
raw filesystem paths. Markdown and editor content should use that URL, so local
files render normally without leaking absolute disk paths.

## Code Graphs

`CodeGraphCache` records Graphify cache metadata:

- source key
- project root
- source snapshot hash
- build status
- local paths for `graph.json`, `GRAPH_REPORT.md`, and `graph.html`
- node and edge counts

Graphify output is stored under `storage/code-sources/.../graphify-out/`.
InkPress forces Graphify to use that directory through `GRAPHIFY_OUT` and
`graphify extract --out`, so the explored project remains read-only.

Exploration order:

1. Try the local Graphify graph for the current snapshot.
2. If the graph is missing, build or update it when the `graphify` CLI is
   available.
3. If graph construction fails or the CLI is unavailable, fall back to the
   built-in static index.
4. Use ripgrep/full-text search only when graph and symbol evidence are
   insufficient.

Graphify itself keeps an internal cache and supports `update`, which lets large
projects avoid full re-reading on every exploration.

## Multi-device Direction

This foundation does not complete multi-device sync because SQLite is still
local. It prepares the boundary:

- metadata can later move to cloud MySQL/Postgres
- article materials already flow through provider-neutral storage APIs
- local code graphs remain rebuildable local caches
