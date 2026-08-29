# 語料版本與更新追蹤實作計畫

## Goal

讓每個 bundled corpus snapshot 都能追溯到上游 Git revision，並能在本機與 CI 明確偵測新增、刪除及修改文章。

## Context

目前 `scripts/sync-blog.mjs` 會重建 articles、`catalog.json` 與 `INDEX.md`，但 catalog 只記錄 repository URL。
README、tests 與 tool description 含有固定文章數量，更新語料時需要手動同步多個位置。
`docusaurus-blog/` 是 ignored local checkout，因此一般 CI 無法直接驗證是否落後上游。

## Architecture

同步器從 source checkout 讀取 Git commit SHA 與 commit timestamp，並將 revision 寫入 catalog top-level provenance。
每篇 article metadata 增加 SHA-256 `contentDigest` 與 revision-pinned `sourceUrl`。
同步器先在記憶體建立 next catalog，再與現有 catalog 比較 paths 與 digests，輸出 added、removed、modified summary。
新增 `--check` 模式，只比較生成結果並以 exit code 表示 drift，不修改 repository。
Scheduled GitHub Actions workflow checkout 上游 repository 到獨立目錄後執行 `sync:check`。

## Assumptions

- 正式更新與 scheduled check 使用完整 Git checkout。
- 非 Git source directory 仍可用於本機同步，但 provenance 標記為 `unknown`，且不能通過 release provenance test。

## Non-Goals

- 不由 runtime extension 連線 GitHub。
- 不自動發佈 npm package。
- 不在第一版自動建立或 merge pull request。

## Plan

- [x] 為 `scripts/sync-blog.mjs` 加入明確 CLI parser，保留既有 positional source path，並新增 `--check`；以 spawn-based tests 驗證相容性與未知 option 錯誤。
- [x] 抽出 source revision 讀取函式，使用 non-interactive `git rev-parse HEAD` 與 `git show -s --format=%cI HEAD`，並定義非 Git directory 的 `unknown` fallback；以 temporary Git repository tests 驗證兩條路徑。
- [x] 在 catalog top-level 加入 `sourceRevision`、`sourceRevisionDate` 與 schema version，並為 article 增加 `contentDigest`、`sourceUrl`；以 tests 驗證 digest 可重算且 URL pin 到同一 revision。
- [x] 在覆寫檔案前比較 old 與 next catalog，將 added、removed、modified paths 以 deterministic order 印到 stdout；以 fixture tests 驗證三種變更及無變更輸出。
- [x] 實作 `--check` 模式，確認 `catalog.json`、`INDEX.md` 與 bundled articles 都與 source 一致且不寫檔；以檔案 mtime 或 content hash tests 證明 check mode 無 mutation。
- [x] 在 `package.json` 與 `justfile` 新增 `sync:check` 指令，並在 `README.md` 記錄一般同步、drift check 與 provenance 欄位。
- [x] 移除 `extensions/index.ts` tool description 的固定文章數，並將 README 固定數量改為指向 catalog 的 snapshot counts；以 `rg '409|149|260' README.md extensions tests` 人工確認不再有需同步的重複常數。
- [x] 更新 `tests/knowledge.test.ts`，改驗證 counts 自洽、paths 唯一、digests 有效與 release snapshot revision 非 `unknown`，不再以固定總數作為唯一完整性依據。
- [ ] 新增 `.github/workflows/corpus-drift.yml`，支援 weekly schedule 與 `workflow_dispatch`，checkout `hwchiu/docusaurus-blog` 後執行 `npm ci`、`npm run sync:check -- <upstream-path>`；以 action syntax review 與一次手動 workflow run 驗證。
  Evidence: workflow YAML parses successfully and the equivalent local `npm run sync:check` passes; `workflow_dispatch` cannot run until this new workflow exists on the default branch.
- [x] 執行兩次 `npm run sync:blog` 並確認第二次 `git diff --exit-code`，證明生成結果可重現。
- [x] 執行 `npm run ci` 與 `npm pack --dry-run`，確認 provenance metadata 被包含且 ignored source checkout 未進入 tarball。

## Risks

- 寫入實際同步時間會破壞 reproducible generation，因此只保存上游 commit timestamp，不保存每次執行當下時間。
- 上游 history rewrite 可能讓舊的 revision-pinned URL 失效，但 SHA 仍能識別 bundled snapshot。
- Scheduled workflow 只能發現 drift，未完成自動 PR 前仍需要維護者手動同步。

## Completion Checklist

- [x] Catalog 可追溯到非 `unknown` 的上游 revision。
- [x] 每篇文章都有可重算 digest 與 revision-pinned source URL。
- [x] 同步輸出 added、removed、modified summary。
- [x] `sync:check` 偵測 drift 且不修改檔案。
- [ ] Scheduled workflow 已成功完成至少一次手動執行。
  Evidence: manual dispatch remains unavailable before merge and must be completed from the default branch.
- [x] 連續兩次同步的第二次沒有 Git diff。
- [x] `npm run ci` 與 `npm pack --dry-run` 通過。
