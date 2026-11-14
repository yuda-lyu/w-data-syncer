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
| `test/syncer_orm.test.mjs` | `omTar`(lowdb)資料(`snapshotTar`:新增、修改、刪除(replace)、無異動、來源筆數少於目標各階段) | 已套(2026-10-31 補) |
| `test/sync-nto1.test.mjs`、`test/syncer_nto1.test.mjs` | 無落地目標(`funProc` 只收差異) | 不適用(以 `funProc` 收到之差異為結果) |

- 測試:`test/syncer_1to1.test.mjs`(`should leave target folder as …`).變異(`src` 副本,2026-10-31):S2 不執行 `funRemove`、S2b 不執行 modify 之 `funProc`、S2c 不執行 add 之 `funProc`——動工前版 `syncer_1to1` 三者皆存活,新版皆擊殺.
- 測試:`test/syncer_orm.test.mjs`(`should leave target data as …`;每階段於來源偵測到且同步至目標之事件後、下一筆寫入來源前,以 `omTar.select()` 取快照,每列 `id=value` 依 `id` 排序).階段:逐筆新增、第 4 筆時修改第 3 筆、replace(同一來源檔刪一列加一列,來源筆數不變,故目標 `del`+`insert`)、無異動兩輪、來源筆數少於目標(依 `syncByOrm` 規則跳過,目標不隨來源刪除).變異(`src` 副本,2026-10-31,變異副本與工具為暫存、用畢即清,結果見該輪報告):不執行 `tar.insert`/`tar.save`/`tar.del`、`tar.del` 刪成 `r.same`、移除「來源筆數少於目標時跳過」——新測試皆擊殺;動工前版對 `tar.del` 略過、刪錯列、移除跳過規則三項存活;略過 `tar.insert`/`tar.save` 者新舊測試皆因目標不收斂(等不到無異動之輪)逾時而敗,非資料斷言之功.

## R-SYNC-NONARRAY-01 比對前之「舊側」資料須為陣列,非陣列中止本輪,不視同空陣列

- 來源:wsemi `ltdtDiffByKey` 對非陣列亦非物件之輸入改回空結果(wsemi 下一版,2026-11-12);原則:自有套件不留相容路徑、品質優先,不把非陣列視同 `[]`.
- 規則:凡以 `ltdtDiffByKey` 比對之「舊側」資料,來自外部(目標端 `select()` 回傳值、磁碟快取檔)者,於比對前須確認為陣列(`isarr`,空陣列合法=尚無資料);非陣列時**記錄錯誤事件並中止本輪**,訊息為固定文字、不帶輸入值,不改寫任何持久狀態(目標端、快取檔).不得放行(放行後 `sortBy` 或舊版 `ltdtDiffByKey` 會將其當成空陣列,來源全數被當成新增;新版 `ltdtDiffByKey` 則回空結果而靜默不同步,同時快取被覆寫).
- 站點全集與判準(盤點指令:`git grep -n "ltdtDiffByKey(" -- src`):

| 站點 | 舊側資料來源 | 判準 |
|---|---|---|
| `src/syncByOrm.mjs:85`(檢查在 `:65`) | `tar.select()` 回傳值 | 已套:`!isarr` → `srLogError({ event: 'syncByOrm-selectTar' })` 並 `throw`(固定訊息 `invalid tar.select result: must be an array`,依 dspec〈輸入參數之檢測機制〉§6 之 `invalid <名稱>: must be <種類描述>`);位於「來源無資料略過回傳 null」之後、「來源筆數少於目標」之前,故來源無資料時不讀目標、兩種情形分開.注意 `:80` 之 `sortBy(ltdtTar, key)` 會先把非陣列轉成陣列,所以此站點修前即為「全數新增」而非靜默不同步 |
| `src/syncBy1To1.mjs:173`(檢查在 `:143`) | `hash.json` 快取檔解析結果(`hashsOld`) | 已套:`readJson` 後 `!isarr` → `throw`(固定訊息 `invalid hash cache content: must be an array`),由既有 `catch` 記錄 `event: 'proc'` 並中止(`bErr: true`,與 JSON 解析失敗同處置,不呼叫 `funProc`/`funRemove`/`funPreEnd`),快取檔維持原樣 |
| `src/syncByNTo1.mjs:126`(檢查在 `:101`) | 同上 | 已套(同上,不呼叫 `funProc`) |
| `src/WDataSourceFromCsv.mjs`(`readSave` 內之 `ltdtDiffByKey(ltdtOld, ltdtNew, key)`) | 記憶體 `memory` 內之 `ltdtOld`,新側 `ltdtNew` | 刻意不套(不可達):兩者皆為 `readCsv` 之回傳值,`readCsv` 回傳 `wdc.parseCsv` 之結果經 `filter`/`map` 後之陣列,`parseCsv` 只 resolve 陣列(`w-data-csv` `WDataCsv.mjs` `getRows` 之 `res`)或 reject;`memory.ltdt` 只由該回傳值寫入,`readSave` 取 `ltdtOld` 前已檢查 `memory.has(fn)`.若 `w-data-csv` 的 `parseCsv` 回傳契約改變,須重審本站點 |

- 測試:`test/sync-nonarray.test.mjs`(26 案):`by-orm` 之 `tar.select()` 回 `undefined`/`null`/`{}`/物件/字串/數字各一(拋錯且訊息等於固定文字、`srLog.error` 恰一筆、目標 `insert`/`save`/`del` 零呼叫)、回 `[]` 全數新增、來源無資料(`undefined`/`null`/`[]`)略過回 `null` 且不讀目標;`by-1to1`、`by-nto1` 各:快取為 `null`/`123`/`"x"`/`{}`/物件/`true`(`bErr: true`、`srLog.error` 恰一筆、`funProc`/`funRemove`/`funPreEnd` 零呼叫、目標夾無檔案、快取檔原文不變)、JSON 無法解析之對照案(形狀相同)、快取為 `[]` 全量新增且快取更新;經 `WDataSyncer` 兩案(`by-orm` 的 `tar.select` 回 `null` → `fail`/`error` 事件帶固定訊息、目標零寫入、回復為陣列後同步成功;`by-1to1` 快取 `null` → `done` 之 `bErr` 為 true).指令:`npm test`.
- 變異(`src` 副本於 `./tmp/`,2026-11-12,13 項皆擊殺):三站點各「拔除檢查」(改回舊寫法)、「改視同空陣列」、「檢查過嚴(`isearr`,空陣列也拒)」、「訊息帶輸入值」,`syncByOrm` 另「不記錄錯誤」「改回傳 null」.

## R-CSV-BLANKROW-01 CSV 解析後剔除空列

- 來源:wsemi 1.9.60 起 `ltdtDiffByKey` 遇壞列(非物件、缺主鍵)、主鍵值無效(`undefined`、`null`、`''`)、同側主鍵重複、主鍵型別混用一律拋錯(原靜默略過);裁定(主控 2026-11-14,第 430 項第二批)「若 CSV 空列被擋,於 w-data-syncer 解析時先剔除,不在本函數放寬」.
- 規則:`WDataSourceFromCsv` 之 `readCsv`(`readInsert`、`readSave` 共用)於 `wdc.parseCsv` 後、補欄位(`heads`)前,剔除「無欄位或全部欄位皆為空白字串(空字串或只有空白,以 `trim` 判)」之列;只要有任一欄位非空白即保留(不以剔除掩蓋「主鍵空而其他欄有值」之壞列,該列於比對階段拋錯屬正常).`w-data-csv` `parseCsv` 實測(2026-11-14):空行→`{}`、只有逗號之行→`{ time: '', value: '' }`、只有空白之行→`{ time: '   ' }`(缺欄)、只有空白與逗號之行→`{ time: '  ', value: ' ' }`;結尾單一換行不產生空列,多個換行產生多個 `{}`.
- 站點全集(盤點指令:`git grep -n "parseCsv\|isBlankRow" -- src`):`src/WDataSourceFromCsv.mjs` 之 `readCsv`(唯一讀檔站點;`isBlankRow`).
- 測試:`test/sfcsv_rows.test.mjs` 之 `describe('blank rows are dropped')`(4 案:含空行/只有逗號/只有空白之 CSV 與無空列者偵測結果相同且無錯誤並驗轉換函數不見空列、部分欄位非空之列保留、只有主鍵空而他欄有值之列不剔除且該檔由 R-SYNC-COMMIT-01 之驗證拒收、全為空列之檔視為無資料).指令:`npm test`.變異(`src` 副本於 `./tmp/`,2026-11-14,皆擊殺):移除剔除、任一空欄即剔除、空白不 trim.

## R-SYNC-COMMIT-01 記憶體只存可比對之資料;比對(與轉換)全部成功後才提交狀態,比對失敗時狀態維持舊值,修正後之變更不遺失

- 來源:wsemi 1.9.60 起 `ltdtDiffByKey` 對壞資料拋錯;原 `WDataSourceFromCsv.readSave` 於比對前先 `memory.set` 新資料,比對拋錯時錯誤僅被 `.catch` 以 `console.log` 呈現而記憶體已是新資料 ⇒ 該次變更永遠不會送出(且下一次比對之舊側即為壞資料,再拋錯,再遺失一次).主控裁定(2026-11-14,syncer430b):不採「舊側壞時以新資料重建基準」(壞資料已先以 `insert` 送到下游而污染下游),改為從源頭維持「記憶體只存可比對之資料」.
- 規則(不變量):凡「以前次狀態為基準比對本次輸入,並於比對後提交本次輸入為新基準」者,①**進入基準之資料先驗證**:不經比對即進入基準之路徑(首次載入、舊側無資料之存檔)須先以與 `ltdtDiffByKey` 相同之規則驗證新資料,不符則不寫入基準、不 `emit`(壞資料不進記憶體、不送到下游),錯誤照現行管道;其後基準必為可比對,故比對拋錯時錯誤必在新側;②**先比對、(含送出前之轉換)全部成功後才提交新基準**,任一步拋錯時基準維持舊值(提交與送出事件之間不得再有可拋錯之步驟);③比對失敗不得靜默(記錄錯誤,現為 `console.log`,對外呈現方式另輪由主控立項改為 `error` 事件);④基準無該檔(首次載入失敗)為正常狀態:其後之存檔視同首次載入(驗證通過即 `insert` 送出全部),刪除該檔不報錯(無資料可送 `del`).
- 實作:首次載入共用 `load(fn, ltdtNew)`(驗證 `ltdtDiffByKey([], ltdtNew, key)`→轉換→`memory.set`→`emit insert`),`readInsert` 與 `readSave` 之舊側無資料(含記憶體無此檔)皆呼叫之.驗證之寫法擇簡:直接以空陣列為舊側呼叫 `ltdtDiffByKey` 取其檢測(結果不用),不另抽驗證函數、不自寫與其重複之判準(判準隨 wsemi 一致);只有 `load` 一處呼叫,故不包成具名輔助.
- 站點全集與判準(盤點指令:`git grep -n "ltdtDiffByKey(" -- src`):

| 站點 | 持有之跨輪狀態 | 判準 |
|---|---|---|
| `src/WDataSourceFromCsv.mjs` `readSave`(有舊資料) | 記憶體 `memory`(各檔之 `ltdt`、`ltdtFmt`) | 已套:比對 → 轉換整體與 add/diff/del → `memory.set` → `emit`;比對或轉換拋錯時記憶體維持舊值並拋錯(舊值必可比對,見不變量) |
| `src/WDataSourceFromCsv.mjs` `readSave`(舊側無資料或記憶體無此檔) | 同上 | 已套:呼叫 `load`,先驗證新資料,不符則不寫入、不 `emit`、拋錯 |
| `src/WDataSourceFromCsv.mjs` `readInsert` | 同上 | 已套:呼叫 `load`(同上);`readCsv`、驗證、轉換皆在 `memory.set` 之前,拋錯時記憶體不變(無此檔) |
| `src/WDataSourceFromCsv.mjs` `remove` | 同上 | 已套:記憶體無此檔(未進記憶體,下游從未收到其資料)則直接返回,不報錯、不送 `del` |
| `src/syncByOrm.mjs` | 無(基準為目標端之 `tar.select()`,每輪重取) | 不適用且無遺失風險:`ltdtDiffByKey` 於 `tar.insert/save/del` 之前,拋錯時目標零寫入;下一輪重新取兩端比對.實測:`test/sync-diff-throw.test.mjs` by-orm 2 案 |
| `src/syncBy1To1.mjs` | `hash.json` 快取檔 | 已守(原本即正確):`writeJson(fpHash, hashsNew)` 位於全部處理成功之分支末(`bError` 為真則不寫);比對拋錯進 `catch`,快取維持舊值,不呼叫 `funProc`/`funRemove`.實測:`test/sync-diff-throw.test.mjs` by-1to1 1 案 |
| `src/syncByNTo1.mjs` | 同上 | 已守(同上).實測:同檔 by-nto1 1 案 |

- 測試:`test/sfcsv_rows.test.mjs`——`describe('memory is updated only after the comparison succeeds')`(3 案:重複主鍵、主鍵空各一——壞檔後舊資料不變、修正後新增與修改皆送出;轉換拋錯後舊資料不變、下次變更補送);`describe('only comparable data enters the memory')`(5 案:首次載入含重複主鍵、含空主鍵各一——不 `insert`、記憶體維持空、修正後以 `insert` 送出全部、其後一般比對;空檔首次載入後寫入重複主鍵(舊側無資料分支)——不 `insert`、修正後送出;首次載入轉換拋錯後下次變更視同首次載入;未進記憶體之檔被刪除不報錯);`test/sync-diff-throw.test.mjs`(三站點之回歸防線,修前修後皆綠).同步點為被測物自身之 `change` 事件與作業失敗時之 `console.log('readSave catch')`/`('readInsert catch')` 攔截(`console.log` 為現行之錯誤呈現方式,攔截僅供測試同步;`until(nChange, nErr)` 於錯誤數或事件數超過預期時立即拒絕,故修前紅不必等防懸置上限).指令:`npm test`.
- 變異(`src` 副本於 `./tmp/`,2026-11-14,皆擊殺).第一輪(syncer430,12 項):CSV 之「比對前先 set」「轉換前先 set」「無重建」「一律重建」「舊側壞即重建(不看新側)」「重建不 emit」及空列 3 項;`syncBy1To1`/`syncByNTo1` 之「比對前先寫快取」;`syncByOrm` 之「吞掉比對拋錯回 null」.第二輪(syncer430b,12 項;重建基準之 4 項隨設計移除):`load` 之「無驗證」「先 set 再驗證」「空資料也拒收」,`readInsert` 單點略過驗證、`readSave` 舊側無資料單點略過驗證,「記憶體無此檔時 readSave 仍拋 does not exist」,「remove 不檢查記憶體有無此檔」,及「比對前先 set」「轉換前先 set」與空列 3 項重跑.

## R-BUF-HIST-01 `by-buffer` 之下載歷史名稱每輪唯一,且字典序等於輪序

- 規則:`syncByBuffer` 每輪之歷史資料夾(`fdFromStorageTempHists/<名>`)與完成狀態檔(`fdFromStorageTempHistStates/<名>`)共用一個名稱,名稱須①每輪唯一(不因同一秒或同一毫秒內多輪而撞名、共用資料夾);②依字典序排序恆等於產生順序(`numKeep` 淘汰最舊者、同名檔取最新版皆依 `sortBy(name)`);③不沿用任何現存之歷史資料夾名或完成狀態檔名.實作:`src/syncByBuffer.mjs` 之 `genHistName`——20 碼數字,17 碼毫秒時間戳(wsemi `nowms2strp`)+3 碼序號;序號取「同一毫秒內已用最大序號(取自歷史資料夾與完成狀態檔兩處之名稱)加 1」,不回收已刪除者;同一毫秒內用盡 1000 個序號時該輪拋錯 `too many rounds within the same millisecond`,不沿用名稱.對外行為變化記於 README〈Breaking changes〉.
- 配對清理(2026-10-31 改為名稱集合比對):每輪完成後,以名稱集合逐一對應歷史資料夾與完成狀態檔——無完成狀態檔之資料夾(下載未完成)與無資料夾之完成狀態檔皆刪除,不依兩者數量差判斷(舊制以 `n < nn`、`n > nn` 判斷,數量相同而集合不同時不清理,未完成資料夾之檔案進入儲存區;數量不同時只清一側,且 `numKeep` 以清理前之資料夾數計,完整之輪被提早淘汰);其後 `numKeep` 只計完整之輪(`n` 取清理後).對外行為變化記於 README〈Breaking changes〉.
- 已知限制:系統時鐘倒退(新毫秒時間戳小於現存名稱)時不補償,新名稱會排在較舊位置.
- 站點全集(盤點指令:`git grep -n "now2strp\|nowms2strp\|genHistName" -- src`):`src/syncByBuffer.mjs` 之 `fdn`(唯一站點;`WDataSyncer.mjs` 之 `by-buffer` 只轉呼叫).
- 測試:`test/sync-buffer-hist.test.mjs`(同一毫秒多輪各有獨立資料夾與狀態檔、命名格式與序號遞增、`numKeep` 保留最新而非最舊、換毫秒序號歸零且跨秒名稱序等於輪序、第 10 輪起序號補零不亂序、同一毫秒超過 1000 輪拋錯、失敗輪之半成品不混入後續輪、不沿用殘存狀態檔名、升版前 14 碼舊名稱先被淘汰、真實時鐘連跑 5 輪).以 `node:test` 之 `mock.timers`(只 mock `Date`)凍結時鐘以決定性製造同一毫秒.變異(`src` 副本,2026-10-31):M1 退回秒級命名、M2 只有毫秒無序號、M3 序號取首個空位、M4 序號忽略完成狀態檔、M5 序號不補零、M6 無溢位防護、M7 序號不比對毫秒前綴、M8 序號取最後者而非最大者——皆被擊殺.指令:`npm test`.
- 測試(配對清理):`test/sync-buffer-hist.test.mjs` 之 `describe('pairing cleanup by name set')`(7 案:數量相等而集合不同、保留完整舊輪只清不完整者、資料夾多於狀態檔、狀態檔多於資料夾、不完整夾不得使完整輪被提早淘汰、混入不完整者時 `numKeep` 保留最新完整輪、完整配對不受影響;每案另斷言 `srLog.error` 無紀錄,即沿用含已刪者之舊清單不會走到不存在之資料夾).seed 以 14 碼舊名稱預先建立資料夾與狀態檔,排序上早於新名稱.變異與結果見該輪報告(2026-10-31,變異副本與工具為暫存、用畢即清;新測試全擊殺,動工前測試對還原整檔、`numKeep` 取清理前、清理後不更新清單、數量差閘門四項存活):還原整檔、不刪未完成資料夾、不刪孤立狀態檔、`numKeep` 取清理前資料夾數、清理後不更新清單、數量差閘門、資料夾比對錯用自身集合.
