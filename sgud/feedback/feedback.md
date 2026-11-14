# 回饋

本檔記任務中發現之自有套件、全域技能、全域設定之調整與抽提提案(只增不改;處置結果另記一列並註明承接哪一列).回饋是紀錄與提案,實際修改走各自的通報管道.

| 日期 | 類別 | 對象 | 內容 | 依據 |
|---|---|---|---|---|
| 2026-11-14 | 自有套件 | wsemi `ltdtDiffByKey` | 遇壞資料改拋錯後,使用端若要判斷「某側資料能否作為比對基準」(如本套件 `WDataSourceFromCsv.isDiffable`),只能以 `ltdtDiffByKey(ltdt, [], key)` 單側呼叫並 try/catch 取代;建議 wsemi 提供單側驗證函數(回傳布林或錯誤訊息,與 `ltdtDiffByKey` 同一份檢測規則,避免使用端各自重寫判準而與其分歧) | `src/WDataSourceFromCsv.mjs` 之 `isDiffable`;`sgud/rule/rulebook.md` R-SYNC-COMMIT-01 |
| 2026-11-14 | 自有套件 | wsemi `ltdtDiffByKey`(承接上列,syncer430b) | 上列所述 `isDiffable` 已移除,改為首次載入時 `ltdtDiffByKey([], ltdtNew, key, { withInfor: false })` 取其檢測(`src/WDataSourceFromCsv.mjs` 之 `load`);仍是以「空陣列為舊側、丟棄結果」借用比對函數作單側驗證,建議不變:wsemi 提供單側驗證函數(同一份檢測規則),使用端可明確表達意圖 | `src/WDataSourceFromCsv.mjs` 之 `load`;`sgud/rule/rulebook.md` R-SYNC-COMMIT-01 |
| 2026-11-14 | 自有套件 | w-data-csv `parseCsv` | 空行解析為 `{}`、只有逗號之行為各欄空字串、只有空白之行僅帶第一欄(缺欄),使用端須自行剔除;建議提供選項(如 `skipEmptyRows`)於解析時剔除全空列,免各使用端重複實作空列判準 | 實測 `./tmp/syncer430/probe-csv.mjs` 輸出(空行→`{}`、`,`→`{"time":"","value":""}`、空白行→`{"time":"   "}`);`sgud/rule/rulebook.md` R-CSV-BLANKROW-01 |
| 2026-11-14 | 自有套件 | w-data-syncer 本身(`WDataSourceFromCsv` 錯誤呈現) | `readInsert`/`readSave`/`remove` 之 `.catch` 僅 `console.log`,使用端與上層 `WDataSyncer` 收不到比對錯誤;測試亦須暫時攔截 `console.log` 才有同步點.建議改為發送 `error` 事件(對外呈現方式變更,須裁示) | `src/WDataSourceFromCsv.mjs` 之 watcher `.catch`;`test/sfcsv_rows.test.mjs` 之 `console.log` 攔截 |
| 2026-11-12 | 全域技能 | 新增「變異驗證」技能(暫名 `role-coder-for-mutation`) | 「把每個呼叫點改回舊寫法/過嚴/回顯值,確認新測試轉紅」已是 `role-coder-for-test` §1 第 6 條與完成判準之要求,各套件每輪都重寫同樣的變異腳本(複製 `src`+`test` 到 `./tmp/…/<id>/`、恰好出現一次之字串取代、以絕對路徑 mocha 在副本 cwd 跑、`--exit`、彙整擊殺/存活),且「取代不到即判無效」「被殺者須看是哪個斷言殺的」「被殺之變異讓 mocha 不結束」等陷阱反覆踩。建議抽提為含可複用腳本範本之技能 | 本套件 `sgud/exp/experience.md`〈非陣列舊側資料中止本輪〉末條與〈`syncByBuffer` 配對清理…〉變異副本條:兩輪各自重寫 |
