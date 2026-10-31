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

## R-SYNC-TARGET-01 同步測試須驗目標之落地結果,不只驗事件

- 規則:凡同步有落地目標(目標資料夾之檔案、目標資料庫)者,其測試於新增、修改、刪除各階段後,須斷言**目標之實際內容**(例:目標夾各檔名與檔案內容),不得只斷言事件或回傳值.原因:事件與回傳值來自差異比對,與「回呼是否真的把檔案寫入或刪除目標」無關,只驗事件時,「不執行 `funProc`/`funRemove`」之變異全部存活(`syncer_1to1` 於 2026-10-29 變異 S2 即如此).含計時器之整合測試於某輪 `done` 事件後同一事件迴圈回合內取目標快照(見 R-TIMER-TEST-01),不與下一輪重疊.
- 站點全集與判準(盤點指令:`git grep -n "fdSelfStorage\|fdFromStorage:\|tar:" -- test`):

| 站點 | 目標 | 判準 |
|---|---|---|
| `test/sync-1to1.test.mjs` | `fdSelfStorage` 檔案內容(`snapshot`) | 已套(原即有) |
| `test/syncer_1to1.test.mjs` | `fdSelfStorage` 檔案內容(`snapshot`;新增、修改、刪除、無異動各階段) | 已套(2026-10-31 補) |
| `test/sync-buffer.test.mjs`、`test/syncer_buffer.test.mjs` | `fdFromStorage` 檔案內容 | 已套(原即有) |
| `test/sync-orm.test.mjs` | `tar` 資料 | 已套(原即有) |
| `test/syncer_orm.test.mjs` | `omTar`(lowdb)資料 | **未套**(只驗來源偵測與同步之 `change` 事件;單輪版 `sync-orm` 已驗目標資料;未補,屬待辦) |
| `test/sync-nto1.test.mjs`、`test/syncer_nto1.test.mjs` | 無落地目標(`funProc` 只收差異) | 不適用(以 `funProc` 收到之差異為結果) |

- 測試:`test/syncer_1to1.test.mjs`(`should leave target folder as …`).變異(`src` 副本,2026-10-31):S2 不執行 `funRemove`、S2b 不執行 modify 之 `funProc`、S2c 不執行 add 之 `funProc`——動工前版 `syncer_1to1` 三者皆存活,新版皆擊殺.

## R-BUF-HIST-01 `by-buffer` 之下載歷史名稱每輪唯一,且字典序等於輪序

- 規則:`syncByBuffer` 每輪之歷史資料夾(`fdFromStorageTempHists/<名>`)與完成狀態檔(`fdFromStorageTempHistStates/<名>`)共用一個名稱,名稱須①每輪唯一(不因同一秒或同一毫秒內多輪而撞名、共用資料夾);②依字典序排序恆等於產生順序(`numKeep` 淘汰最舊者、同名檔取最新版皆依 `sortBy(name)`);③不沿用任何現存之歷史資料夾名或完成狀態檔名.實作:`src/syncByBuffer.mjs` 之 `genHistName`——20 碼數字,17 碼毫秒時間戳(wsemi `nowms2strp`)+3 碼序號;序號取「同一毫秒內已用最大序號(取自歷史資料夾與完成狀態檔兩處之名稱)加 1」,不回收已刪除者;同一毫秒內用盡 1000 個序號時該輪拋錯 `too many rounds within the same millisecond`,不沿用名稱.對外行為變化記於 README〈Breaking changes〉.
- 已知限制:系統時鐘倒退(新毫秒時間戳小於現存名稱)時不補償,新名稱會排在較舊位置;`n < nn`、`n > nn` 之歷史資料夾與完成狀態檔配對仍以數量差判斷(`n == nn` 但名稱集合不同,例如殘存狀態檔加未完成資料夾同時存在時不會清理),屬既有行為,未改.
- 站點全集(盤點指令:`git grep -n "now2strp\|nowms2strp\|genHistName" -- src`):`src/syncByBuffer.mjs` 之 `fdn`(唯一站點;`WDataSyncer.mjs` 之 `by-buffer` 只轉呼叫).
- 測試:`test/sync-buffer-hist.test.mjs`(同一毫秒多輪各有獨立資料夾與狀態檔、命名格式與序號遞增、`numKeep` 保留最新而非最舊、換毫秒序號歸零且跨秒名稱序等於輪序、第 10 輪起序號補零不亂序、同一毫秒超過 1000 輪拋錯、失敗輪之半成品不混入後續輪、不沿用殘存狀態檔名、升版前 14 碼舊名稱先被淘汰、真實時鐘連跑 5 輪).以 `node:test` 之 `mock.timers`(只 mock `Date`)凍結時鐘以決定性製造同一毫秒.變異(`src` 副本,2026-10-31):M1 退回秒級命名、M2 只有毫秒無序號、M3 序號取首個空位、M4 序號忽略完成狀態檔、M5 序號不補零、M6 無溢位防護、M7 序號不比對毫秒前綴、M8 序號取最後者而非最大者——皆被擊殺.指令:`npm test`.
