# pi-hwchiu

`pi-hwchiu` 把 hwchiu（邱宏瑋 / HungWei Chiu）的 SRE、DevOps、Kubernetes、網路、雲端與工程知識帶進 Pi。

套件包含一個 Agent Skill、409 篇完整文章，以及四個安全且有輸出上限的 tools。

## 安裝

從 npm 安裝：

```sh
pi install npm:pi-hwchiu
```

從 GitHub 安裝：

```sh
pi install git:github.com/narumiruna/pi-hwchiu
```

在本機開發目錄測試：

```sh
pi -e .
```

Pi packages 具有執行使用者權限的能力，因此安裝前應先檢查 extension 原始碼。

## Skill

`hwchiu-sre-knowledge` 會在 SRE、DevOps、Kubernetes、容器、Linux 網路、GitOps、CI/CD、雲端、儲存、安全與可觀測性任務中載入。

Skill 會先從索引尋找資料，再讀取原文，並要求回答標示文章路徑與日期。

歷史文章中的版本、指令、API、價格與安全建議仍需對照目前環境或官方文件。

## Tools

| Tool | 功能 | 安全範圍 |
| --- | --- | --- |
| `hwchiu_knowledge_search` | 搜尋全部 409 篇文章的標題、標籤、摘要與全文 | 唯讀，最多回傳 20 筆結果 |
| `hwchiu_read_article` | 依搜尋結果讀取文章的指定行數 | 僅允許 catalog 內的文章，輸出上限為 50KB 或 2,000 行 |
| `hwchiu_k8s_observe` | 讀取 Kubernetes context、resources、events、describe 與 logs | 固定的唯讀 `kubectl` 參數，不支援 Secret 或任何 mutation |
| `hwchiu_systemd_observe` | 讀取失敗服務、unit status 與 journal | 固定的唯讀 `systemctl` 或 `journalctl` 參數，不使用 `sudo` |

Kubernetes tool 需要已安裝並完成設定的 `kubectl`。

systemd tool 需要 Linux 上的 `systemctl` 與 `journalctl`。

Cluster events、application logs 與 journal 可能包含敏感資訊，使用前應確認目標環境與資料範圍。

## Knowledge Corpus

短篇筆記來自原站的 `blog/`，共 149 篇。

長篇技術文章來自原站的 `docs/`，共 260 篇。

完整索引位於 [`skills/hwchiu-sre-knowledge/references/INDEX.md`](skills/hwchiu-sre-knowledge/references/INDEX.md)。

主題入口位於 [`skills/hwchiu-sre-knowledge/references/TOPICS.md`](skills/hwchiu-sre-knowledge/references/TOPICS.md)。

文章內容來源為 [hwchiu/docusaurus-blog](https://github.com/hwchiu/docusaurus-blog)，並保留 hwchiu 的來源標示。

## 開發

安裝依賴並執行全部檢查：

```sh
npm install
npm run ci
```

從本機 `docusaurus-blog/` checkout 重新同步全部文章：

```sh
npm run sync:blog
```

確認 npm tarball 內容：

```sh
npm pack --dry-run
```
