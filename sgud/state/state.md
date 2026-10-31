# 狀態

本檔為當前已開發功能之最新狀態(現況),只記現況不寫過程(過程見 `sgud/exp/experience.md`);規則帳本(`sgud/rule/rulebook.md`)為藍圖,兩者比對即知尚未做到者.

## 功能與測試

| 功能 | 原始碼 | 測試檔 | 規則帳本 | 現況 |
|---|---|---|---|---|
| 資料單向同步(`by-orm`、`by-buffer`、`by-1to1`、`by-nto1`) | `src/WDataSyncer.mjs`、`src/syncByOrm.mjs`、`src/syncByBuffer.mjs`、`src/syncBy1To1.mjs`、`src/syncByNTo1.mjs` | `test/sync-*.test.mjs`(單輪同步,無計時器)、`test/syncer_*.test.mjs`(含計時器之整合) | R-TRACE-01、R-TIMER-TEST-01、R-SYNC-TARGET-01 | 完成;計時器(`setInterval`)已加 `opt.onTrace`;`syncer_1to1`、`syncer_orm` 已驗目標內容(夾檔案、`omTar` 資料) |
| `by-buffer` 下載歷史名稱唯一化與配對清理 | `src/syncByBuffer.mjs`(`genHistName`、歷史資料夾與完成狀態檔之名稱集合比對清理) | `test/sync-buffer-hist.test.mjs`(命名 11 案、配對清理 7 案) | R-BUF-HIST-01 | 完成;歷史資料夾與完成狀態檔以 20 碼(17 碼毫秒時間戳+3 碼序號)命名,同一秒/毫秒內多輪各自獨立;每輪以名稱集合逐一對應清除不完整者(無狀態檔之資料夾、無資料夾之狀態檔),`numKeep` 只計完整輪;README〈Breaking changes〉已記 |
| 檔案 CSV 來源供給器 | `src/WDataSourceFromCsv.mjs` | `test/sfcsv.test.mjs`、`test/sfcsv_trace.test.mjs` | R-TRACE-01 | 完成;`opt.onTrace` 原樣轉交 wsemi `fsWatchFolder` |
| 觀察回調(`opt.onTrace`)測試 | 同上 | `test/syncer_trace.test.mjs`(P1~P4:事件順序與內容、鎖、出錯、bErr、clear、五種回調)、`test/sfcsv_trace.test.mjs` | R-TRACE-01 | 完成 |

## 計時器相關測試(第 1 輪,規格見規則帳本 R-TIMER-TEST-01)

- `test/syncer_1to1.test.mjs`、`syncer_buffer.test.mjs`、`syncer_nto1.test.mjs`、`syncer_orm.test.mjs`、`sfcsv.test.mjs` 已由固定等待(`delay(2500~5000)`、`setInterval(3000)` 配速)改為事件同步,期望值未改.
- 輔助:`test/tools/syncerTraceKit.mjs`(紀錄器、計數閘門、手動閘門;防懸置上限用真實計時器)、`test/tools/loadTrial.mjs`/`loadPreload.mjs`(負載試驗,複製自 wsemi,不跨套件引用).
- 效能時限類(d)與輪詢上限類(B):本套件無.

## 已知缺口與待辦

- 系統時鐘倒退時新名稱排在較舊位置,不補償(R-BUF-HIST-01);多行程共用同一歷史夾之名稱競態不處理(同一套件同時只有一輪).
- 無其他已知缺口(`syncer_orm` 目標資料、`syncByBuffer` 數量差清理皆已於 2026-10-31 第二輪修正).
- 最近一次驗證(2026-10-31,第二輪修正):全套 `npm test` 45 passing、0 failing(約 21 秒;`sync-buffer-hist` 18 案、`syncer_orm` 2 案);修前紅:`sync-buffer-hist` 配對清理 6 案(含 1 案回歸對照綠);變異 12 項(`syncByOrm` 5 項、`syncByBuffer` 7 項)新測試皆擊殺、無存活,動工前(HEAD)測試對其中 7 項存活(`syncByOrm`:`tar.del` 略過、刪錯列、移除跳過規則;`syncByBuffer`:還原修正、`numKeep` 取清理前、清理後不更新清單、數量差閘門);`syncer_orm` 重跑 5 次(無負載)、5 次(事件迴圈阻塞 400:1000)、3 次(重度阻塞 1500:3000)皆 0 失敗(未跑 CPU 壓力行程);ESLint 0 error;未發布(`package.json` 之 `version` 未動,現為已發布之 1.0.47).前一輪(2026-10-31,第一輪修正):全套 37 passing、0 failing(約 17 秒);變異 11 項新測試皆擊殺,動工前版 `syncer_1to1` 對 3 項 `syncBy1To1` 變異皆存活.再前一輪(2026-10-29,tm-datasyncer 第 1 輪):全套 25 passing、0 failing;負載試驗(8 壓力行程／事件迴圈阻塞 400:1000／重度阻塞 1500:3000 各 6 次,5 檔共 5 案)案次(5 檔×6 次=30)失敗數:改造前 CPU 壓力 0、事件迴圈阻塞 5(全在同一次含 11 秒外部停頓之行程)、重度阻塞 12(`sfcsv`、`syncer_orm` 各 6/6)→ 改造後 0／0／0;變異 23 項,舊測試擊殺 12、新測試擊殺 22(存活 S2:`syncer_1to1` 不驗目標夾,已於 2026-10-31 補驗並擊殺).
- 依賴:`wsemi` ^1.9.33(`getTrace`、`fsWatchFolder` 之 `onTrace`、`nowms2strp`)、devDependency `w-orm-lowdb` ^1.0.40.
