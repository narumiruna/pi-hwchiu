# 安全 Kubernetes 診斷擴充實作計畫

## Goal

在不增加 mutation、Secret 讀取或任意 `kubectl` 參數的前提下，補足 CrashLoop、近期錯誤與 Pod health 的常見診斷證據。

## Context

目前 `hwchiu_k8s_observe` 支援 context、resources、events、describe 與 logs。
現有 logs 只能用 line count 限制，無法讀取 previous container logs 或限制時間範圍。
現有 events 不能只看 Warning，resources 也未提供集中式 Pod readiness 與 restart 摘要。

## Architecture

`extensions/observe.ts` 繼續使用固定 command builder，不接受 raw flags、selector、JSONPath 或 shell command。
logs 增加 bounded `previous` 與 `sinceSeconds`。
events 增加 allowlisted `eventType`，其中 `warning` 轉成固定 field selector。
新增 `pod-health` operation，以固定 `kubectl get pods -o custom-columns=...` 顯示 phase、ready、restart、node、requests 與 limits。
每次 tool call 仍只執行一個 command，避免無意擴大觀測範圍。

## Non-Goals

- 不支援 `kubectl exec`、port-forward、apply、patch、delete 或其他 mutation。
- 不讀取 Secret、完整 Pod JSON、environment values 或 ConfigMap 內容。
- 不加入 arbitrary label selector、field selector、JSONPath 或 output template。
- 不依賴 Metrics Server，也不在本階段加入 `kubectl top`。

## Plan

- [x] 在 `extensions/observe.ts` 定義 `eventType`、`previous`、`sinceSeconds` 與 `pod-health` input，為 `sinceSeconds` 設定 1 到 86,400 的整數上限；以 validation tests 覆蓋邊界。
- [x] 更新 logs command builder，只在 `operation=logs` 時接受 `previous` 與 `sinceSeconds`，並產生固定 `--previous`、`--since=<N>s` 參數；以 exact args tests 驗證單 container 與多 container Pod 情境。
- [x] 更新 events command builder，將 `eventType=warning` 映射為固定 `--field-selector=type=Warning`，並拒絕未知 event type；以 tests 證明使用者不能注入 selector。
- [x] 新增 `pod-health` command builder，使用固定 custom columns 且沿用 context、namespace、request timeout 與 head truncation；以 exact args test 證明不會輸出 Secret 或完整 spec。
- [x] 對 operation 不相容的欄位採明確錯誤，而不是靜默忽略；以 table-driven tests 覆蓋 `tail`、`previous`、`sinceSeconds`、`resourceKind` 與 `name` 的合法 operation。
- [x] 更新 `extensions/index.ts` 的 TypeBox schema、tool description 與 prompt guideline，明確要求先確認 context 與 namespace；以 package test 驗證舊參數仍可使用。
- [x] 擴充 `tests/observe.test.ts` 的 forbidden verb 與 forbidden resource assertions，涵蓋全部 operation 與新增參數組合。
- [x] 更新 `README.md` 的支援操作、安全邊界與 CrashLoop 範例；以 `npm run check` 驗證文件格式。
- [ ] 在可取得測試 cluster 時進行人工 smoke test，記錄 context、namespace、執行的唯讀 command 與輸出截斷結果；若沒有 cluster，保留此項未完成並以 command-builder tests 作為 release gate。
  Evidence: the read-only context observation returned no usable context, so command-builder tests are the release gate and live cluster evidence remains unavailable.
- [x] 執行 `npm run ci` 與 `npm pack --dry-run`。

## Risks

- `--previous` 在沒有 previous container instance 時會回傳 non-zero，錯誤訊息必須保留給 Agent 判讀。
- custom columns 在不同 Kubernetes 版本可能顯示 `<none>`，因此 smoke test 需涵蓋專案最低支援版本或在 README 註明限制。
- Events 與 logs 仍可能包含敏感資料，因此不能把新增篩選描述成資料脫敏。

## Completion Checklist

- [x] Previous logs 與時間範圍都有固定上限及 exact args tests。
- [x] Warning events 不接受任意 selector。
- [x] Pod health 不讀取 Secret、完整 Pod JSON 或 environment values。
- [x] 所有新增 operation 維持單次單 command 與既有 truncation 上限。
- [x] `npm run ci` 通過。
- [x] Smoke test 已通過，或 release 明確接受缺少 cluster evidence 的限制。
