# 狀態

本檔為當前已開發功能之最新狀態(現況),只記現況不寫過程(過程見 `sgud/exp/experience.md`);規則帳本(`sgud/rule/rulebook.md`)為藍圖,兩者比對即知尚未做到者.

## 功能與測試

| 功能 | 原始碼 | 測試檔 | 規則帳本 | 現況 |
|---|---|---|---|---|
| 資料單向同步(`by-orm`、`by-buffer`、`by-1to1`、`by-nto1`) | `src/WDataSyncer.mjs`、`src/syncByOrm.mjs`、`src/syncByBuffer.mjs`、`src/syncBy1To1.mjs`、`src/syncByNTo1.mjs` | `test/sync-*.test.mjs`(單輪同步,無計時器)、`test/syncer_*.test.mjs`(含計時器之整合) | R-TRACE-01、R-TIMER-TEST-01 | 完成;計時器(`setInterval`)已加 `opt.onTrace` |
| 檔案 CSV 來源供給器 | `src/WDataSourceFromCsv.mjs` | `test/sfcsv.test.mjs`、`test/sfcsv_trace.test.mjs` | R-TRACE-01 | 完成;`opt.onTrace` 原樣轉交 wsemi `fsWatchFolder` |
| 觀察回調(`opt.onTrace`)測試 | 同上 | `test/syncer_trace.test.mjs`(P1~P4:事件順序與內容、鎖、出錯、bErr、clear、五種回調)、`test/sfcsv_trace.test.mjs` | R-TRACE-01 | 完成 |

## 計時器相關測試(第 1 輪,規格見規則帳本 R-TIMER-TEST-01)

- `test/syncer_1to1.test.mjs`、`syncer_buffer.test.mjs`、`syncer_nto1.test.mjs`、`syncer_orm.test.mjs`、`sfcsv.test.mjs` 已由固定等待(`delay(2500~5000)`、`setInterval(3000)` 配速)改為事件同步,期望值未改.
- 輔助:`test/tools/syncerTraceKit.mjs`(紀錄器、計數閘門、手動閘門;防懸置上限用真實計時器)、`test/tools/loadTrial.mjs`/`loadPreload.mjs`(負載試驗,複製自 wsemi,不跨套件引用).
- 效能時限類(d)與輪詢上限類(B):本套件無.

## 已知缺口與待辦

- `syncByBuffer` 以 `now2strp()`(秒級時間戳)命名下載歷史資料夾,同一秒內多輪共用同名資料夾(因 `funGetFiles` 先清空而結果仍正確);未改,僅記錄.
- `syncer_1to1` 等測試只驗事件內容,未驗 `fdSelfStorage` 之檔案結果(變異 S2「不執行 funRemove」兩版測試皆存活),屬既有測試盲點,未補.
- 最近一次驗證(2026-10-29,tm-datasyncer 第 1 輪):全套 `npm test` 25 passing、0 failing(約 16 秒;改造前 5 個計時器整合案約 28 秒);負載試驗(8 壓力行程／事件迴圈阻塞 400:1000／重度阻塞 1500:3000 各 6 次,5 檔共 5 案)案次(5 檔×6 次=30)失敗數:改造前 CPU 壓力 0、事件迴圈阻塞 5(全在同一次含 11 秒外部停頓之行程)、重度阻塞 12(`sfcsv`、`syncer_orm` 各 6/6)→ 改造後 0／0／0;變異 23 項,舊測試擊殺 12、新測試擊殺 22(唯一存活 S2,新舊相同).未發布(`package.json` 之 `version` 未動).
- 依賴:`wsemi` ^1.9.29(`getTrace`、`fsWatchFolder` 之 `onTrace`)、devDependency `w-orm-lowdb` ^1.0.39.
