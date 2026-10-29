# 規則帳本

本檔為套件設計與開發階段之規則帳本(藍圖),為要求程式碼須長成什麼樣,或由規格產出之測試(項目/說明/流程)有哪些,包含軸、單一擁有者、已知限制、破壞性變更紀錄,以及對應是哪些測試檔案或指令等,由agent自行編列、擴充與維護.當前已做到哪些記於`sgud/state/state.md`.過長時依類型拆為`rulebook_<類型>.md`,本檔只留索引.

## R-TRACE-01 計時器相關函數提供觀察回調 `opt.onTrace`

- 來源規格:主控 dspec「計時器相關函數之觀察回調與測試」(P1~P7;2026-10-28 定稿).本節只記摘要與本套件之站點全集.
- 規則:凡含計時器(輪詢、重試、節流、防抖、排程、逾時)之函數,提供選用之 `opt.onTrace`,於內部有意義之事件**同步**呼叫,傳入凍結物件 `{ type, ... }`(`type` 於 JSDoc 列舉,其餘欄位為原始值快照,欄位名不得為 `type`,不放 Error 物件);未傳時行為與原版相同、不組事件物件;回調拋錯與回傳之 rejection 一律忽略;函數釋放(`clear`)後不再通知.取得回調一律 `import getTrace from 'wsemi/src/getTrace.mjs'`(單一擁有者在 wsemi,不自寫).
- 站點全集與判準(盤點指令:`git grep -n "setInterval\|setTimeout" -- src`;`git grep -n "fsWatchFolder" -- src`):

| 站點 | 判準 | 事件 |
|---|---|---|
| `src/WDataSyncer.mjs` `setInterval(timeInterval)` | 已套 | `tick`、`begin`、`emit`、`fail`、`done`、`clear`(JSDoc `opt.onTrace`) |
| `src/WDataSourceFromCsv.mjs` `fsWatchFolder(fd, …)`(計時器在 wsemi) | 已套(原樣轉交,事件同 wsemi `fsWatchFolder`) | `tick`、`watch`、`ready`、`emit`、`error`、`unwatch`、`closed`、`clear` |
| `src/sync*.mjs` | 無計時器,不套 | — |

- 測試:`test/syncer_trace.test.mjs`、`test/sfcsv_trace.test.mjs`(語意:事件順序與內容、鎖跳過、出錯、`bErr`、`clear` 後不通知、釋放計時器;P3/P4:未傳、紀錄器、拋錯、回傳 rejection、非函數五種回調結果相同).指令:`npm test`.

## R-TIMER-TEST-01 計時器相關測試以事件同步,不以時間同步

- 規則:測試對計時器相關函數,同步點為被測物事件(`opt.onTrace` 或其自身事件),不用 `delay`/`setTimeout`/固定等待後檢查;否定觀察窗(「之後不再發送」)改以「N 輪」計(例:兩個 `done` 且 `b` 為 false 之輪).改動來源檔案須在 `done` 事件之同一事件迴圈回合內(`await` 該事件後立即同步寫入),使其不與進行中之輪重疊.防懸置上限用模組載入時保存之真實 `setTimeout`/`clearTimeout`(見 `test/tools/syncerTraceKit.mjs`).
- 站點全集與判準(盤點指令:`git grep -n "delay(\|setInterval(\|setTimeout(" -- test`):

| 站點 | 判準 |
|---|---|
| `test/syncer_1to1.test.mjs`、`syncer_buffer.test.mjs`、`syncer_nto1.test.mjs` 之 `delay(2500/3000)` | 已改(以 `done` 事件同步) |
| `test/syncer_orm.test.mjs` 之 `setInterval(3000)` 配速與 `delay(5000)` | 已改(逐筆等來源 `change` 與同步 `change` 事件;`ready` 事件為首筆之前提) |
| `test/sfcsv.test.mjs` 之 `setInterval(3000)` 配速 | 已改(逐筆等來源 `change` 事件;末筆寫入後不等偵測,同原期望) |
| `test/tools/syncerTraceKit.mjs` 之 `setTimeout` | 刻意保留(防懸置上限,真實計時器) |

- 負載試驗:`test/tools/loadTrial.mjs`、`loadPreload.mjs`(CPU 壓力 8 行程、事件迴圈阻塞 400:1000、重度阻塞 1500:3000;須 `quiet-run --lock-exclusive`).
