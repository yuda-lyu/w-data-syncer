//sfcsv_rows.test.mjs: WDataSourceFromCsv之資料列處理, 規則帳本R-CSV-BLANKROW-01與R-SYNC-COMMIT-01之測試
//  R-CSV-BLANKROW-01: 解析CSV後剔除「無欄位或全部欄位皆為空白字串」之列(空行、只有逗號之行、只有空白之行), 其餘列不動
//  R-SYNC-COMMIT-01: 記憶體只存可比對之資料, 且比對(與轉換)全部成功後才更新: ①比對失敗(如重複主鍵)時記憶體維持舊資料, 檔案修正後之下一次變更須正確送出、不遺失;
//  ②寫入記憶體之新資料(首次載入, 舊側無資料之存檔)須先以與比對相同之規則驗證, 不符則不寫入、不送出insert, 檔案修正後以insert送出
//  同步方式: 以watcher之onTrace(ready)與被測物自身之change事件、作業失敗時之console.log('readSave catch')為同步點, 不以等待毫秒同步
//  each it標註之[R]為對應之規則句, 斷言為該句之翻譯, 非現狀指紋
import assert from 'assert'
import fs from 'fs'
import get from 'lodash-es/get.js'
import map from 'lodash-es/map.js'
import fsCreateFolder from 'wsemi/src/fsCreateFolder.mjs'
import fsDeleteFolder from 'wsemi/src/fsDeleteFolder.mjs'
import WDataSourceFromCsv from '../src/WDataSourceFromCsv.mjs'
import { createRecorder, guard } from './tools/syncerTraceKit.mjs'


describe('sfcsv_rows', function() {

    let fdTmp = './test/_tmp/sfcsv_rows'
    let heads = ['time', 'value']

    //current, 目前案例之探針(測試依序執行, 同時只有一個)
    let current = null

    //logSpy, 被測物於佇列作業(readInsert/readSave/remove)失敗時以console.log(`xxx catch`, err)呈現錯誤(對外呈現方式本輪不改),
    //  攔截之作為「該次作業已結束且失敗」之同步點與錯誤訊息來源; 其餘console.log照常輸出
    let realLog = console.log

    before(function() {
        fsDeleteFolder(fdTmp)
        fsCreateFolder(fdTmp)
        console.log = (...args) => {
            let tag = args[0]
            if (current && (tag === 'readInsert catch' || tag === 'readSave catch' || tag === 'remove catch')) {
                current.errs.push({ tag, message: String(get(args[1], 'message', args[1])) })
                current.poke()
                return
            }
            realLog(...args)
        }
    })

    after(function() {
        console.log = realLog
        fsDeleteFolder(fdTmp)
    })

    //mkProbe, 紀錄來源之change事件(msgs)與被測物回報之錯誤(errs), until(nChange, nErr)等兩者累計達標; 任一超過預期即拒絕(多出之錯誤代表該成功之作業失敗了, 多出之change事件代表不該送出者送出了)
    let mkProbe = () => {
        let msgs = []
        let errs = []
        let waiters = []
        let poke = () => {
            waiters = waiters.filter((w) => !w.check())
        }
        let until = (nChange, nErr, label) => {
            let pm = new Promise((resolve, reject) => {
                let w = {
                    check: () => {
                        if (errs.length > nErr) {
                            reject(new Error(`unexpected error(s) [${label}]: ${JSON.stringify(errs.slice(nErr))}, changes: ${JSON.stringify(map(msgs, 'type'))}`))
                            return true
                        }
                        if (msgs.length > nChange) {
                            reject(new Error(`unexpected change event(s) [${label}]: ${JSON.stringify(map(msgs.slice(nChange), (m) => ({ type: m.type, ltdt: m.ltdt })))}`))
                            return true
                        }
                        if (msgs.length >= nChange && errs.length >= nErr) {
                            resolve()
                            return true
                        }
                        return false
                    },
                }
                if (!w.check()) {
                    waiters.push(w)
                }
            })
            return guard(pm, `until changes ${nChange}, errors ${nErr} [${label}]`, () => `changes ${msgs.length} ${JSON.stringify(map(msgs, 'type'))}, errors ${JSON.stringify(errs)}`)
        }
        return { msgs, errs, poke, until }
    }

    //mkSource, 資料夾內先放h0.csv(內容v1)再建立來源(既有檔案於初始掃描時以insert送出)
    let mkSource = (name, v1, optExtra = {}) => {
        let fd = `${fdTmp}/${name}`
        fsCreateFolder(fd)
        fs.writeFileSync(`${fd}/h0.csv`, v1, 'utf8')
        let tr = createRecorder()
        let pb = mkProbe()
        current = pb
        let om = WDataSourceFromCsv(fd, { heads, key: 'time', onTrace: tr.onTrace, ...optExtra })
        om.on('change', (msg) => {
            pb.msgs.push({ type: msg.type, ltdt: msg.ltdt, ltdtFmt: msg.ltdtFmt })
            pb.poke()
        })
        let write = (c) => {
            fs.writeFileSync(`${fd}/h0.csv`, c, 'utf8')
        }
        let close = async () => {
            om.clear()
            await tr.next((e) => e.type === 'closed', 'closed')
            current = null
        }
        return { om, pb, tr, fd, write, close }
    }

    //summary, 事件之型別與資料(不含ltdtFmt, 另行斷言)
    let summary = (msgs) => {
        return map(msgs, (m) => ({ type: m.type, ltdt: m.ltdt }))
    }

    let r1 = { time: 't1', value: '1' }
    let r2 = { time: 't2', value: '2' }
    let r2b = { time: 't2', value: '22' }
    let r3 = { time: 't3', value: '3' }
    let r4 = { time: 't4', value: '4' }

    //-------------------------------------------------------------------------

    describe('blank rows are dropped (R-CSV-BLANKROW-01)', function() {

        //內容中之空行、只有逗號之行、只有空白之行、只有空白與逗號之行, 結尾多個換行
        let dirty1 = '\nt1,1\n\n,\n   \n  , \nt2,2\n\n\n'
        let dirty2 = 't1,1\n\n,\n   \n  , \nt2,22\n\nt3,3\n\n\n'
        let clean1 = 't1,1\nt2,2\n'
        let clean2 = 't1,1\nt2,22\nt3,3\n'

        let run = async (name, v1, v2, optExtra) => {
            let s = mkSource(name, v1, optExtra)
            try {
                await s.pb.until(1, 0, 'insert')
                s.write(v2)
                await s.pb.until(3, 0, 'insert+save')
                let sel = await s.om.select()
                return { msgs: summary(s.pb.msgs), fmts: map(s.pb.msgs, 'ltdtFmt'), sel, errs: s.pb.errs }
            }
            finally {
                await s.close()
            }
        }

        it(`should detect the same changes with blank lines (blank, commas only, spaces only) as without them, and report no error`, async function() {
            let seen = []
            let converter = (ltdt) => {
                seen.push(...ltdt)
                return ltdt
            }
            let rClean = await run('blank-clean', clean1, clean2)
            let rDirty = await run('blank-dirty', dirty1, dirty2, { converter })

            //[R]剔除後與無空列之CSV結果相同: 首次載入insert(2筆), 其後insert(新增1筆)與save(修改1筆)
            let expected = [
                { type: 'insert', ltdt: [r1, r2] },
                { type: 'insert', ltdt: [r3] },
                { type: 'save', ltdt: [r2b] },
            ]
            assert.strict.deepStrictEqual(rClean.msgs, expected)
            assert.strict.deepStrictEqual(rDirty.msgs, expected)

            //[R]無錯誤(含兩次偵測之比對皆未拋錯)
            assert.strict.deepStrictEqual(rDirty.errs, [])

            //[R]轉換函數與select()皆不見空列(轉換函數收到之列已剔除空列)
            assert.strict.deepStrictEqual(rDirty.fmts, rClean.fmts)
            assert.strict.deepStrictEqual(rDirty.sel, [r1, r2b, r3])
            assert.strict.deepStrictEqual(rClean.sel, [r1, r2b, r3])
            assert.strict.deepStrictEqual(seen.filter((dt) => dt.time === '' || dt.time === undefined || String(dt.time).trim() === ''), [])
        })

        it(`should drop only rows whose fields are all blank: a row with any non-blank field is kept`, async function() {
            //第1列value為空而time非空、第2列time為空白而value非空白, 皆非全空, 須保留
            let s = mkSource('keep-partial', 't0,\n  ,5\nt1,1\n')
            try {
                await s.pb.until(1, 0, 'insert')
                assert.strict.deepStrictEqual(summary(s.pb.msgs), [
                    { type: 'insert', ltdt: [{ time: 't0', value: '' }, { time: '  ', value: '5' }, r1] },
                ])
            }
            finally {
                await s.close()
            }
        })

        it(`should not drop a row that has only its key blank: the row is kept and the file is refused by the key check, not repaired silently`, async function() {
            //time為空而value非空, 非全空列, 不以剔除掩蓋; 其主鍵無效由與比對相同之檢測拒收(該檔不進記憶體、不送出)
            let s = mkSource('keep-partial-bad-key', ',5\nt1,1\n')
            try {
                await s.pb.until(0, 1, 'refused')
                assert.strict.deepStrictEqual(s.pb.errs.length, 1)
                assert.strict.deepStrictEqual(/^invalid ltdtNew\[0\]: primary key must be a non-empty string/.test(s.pb.errs[0].message), true)
                assert.strict.deepStrictEqual(await s.om.select(), [])
            }
            finally {
                await s.close()
            }
        })

        it(`should treat a file that has only blank lines as no data, and insert the rows once data is written`, async function() {
            let s = mkSource('all-blank', '\n\n,\n  \n')
            try {
                //[R]全為空列之檔案剔除後無資料: insert之資料為空陣列
                await s.pb.until(1, 0, 'insert')
                assert.strict.deepStrictEqual(summary(s.pb.msgs), [{ type: 'insert', ltdt: [] }])

                //[R]之後寫入資料: 剔除後舊側無資料, 以insert送出全部, 無錯誤
                s.write('t1,1\n\n')
                await s.pb.until(2, 0, 'insert')
                assert.strict.deepStrictEqual(summary(s.pb.msgs), [{ type: 'insert', ltdt: [] }, { type: 'insert', ltdt: [r1] }])
                assert.strict.deepStrictEqual(await s.om.select(), [r1])
            }
            finally {
                await s.close()
            }
        })

    })

    //-------------------------------------------------------------------------

    describe('memory is updated only after the comparison succeeds (R-SYNC-COMMIT-01)', function() {

        let v1 = 't1,1\nt2,2\n'
        let v3 = 't1,1\nt2,22\nt3,3\n'

        //壞資料之案例: [標題, v2內容]; 二者皆為ltdtDiffByKey(wsemi 1.9.60起)拋錯者
        let casesBad = [
            ['a duplicated key', 't1,1\nt1,9\nt2,2\n'],
            ['an empty key', ',9\nt1,1\nt2,2\n'],
        ]

        for (let [label, v2] of casesBad) {

            it(`should keep the old data when the new data has ${label}, then send the changes of the corrected file without loss`, async function() {
                let s = mkSource(`bad-${label.replace(/ /g, '-')}`, v1)
                try {
                    await s.pb.until(1, 0, 'insert')

                    //[R]比對失敗: 記錄錯誤(新側資料之錯誤), 不送出任何變更
                    s.write(v2)
                    await s.pb.until(1, 1, 'bad file')
                    assert.strict.deepStrictEqual(s.pb.errs.length, 1)
                    assert.strict.deepStrictEqual(s.pb.errs[0].tag, 'readSave catch')
                    assert.strict.deepStrictEqual(/^invalid ltdtNew\[/.test(s.pb.errs[0].message), true)
                    assert.strict.deepStrictEqual(summary(s.pb.msgs), [{ type: 'insert', ltdt: [r1, r2] }])

                    //[R]比對失敗時記憶體維持舊資料: select()仍為修正前之舊資料
                    assert.strict.deepStrictEqual(await s.om.select(), [r1, r2])

                    //[R]檔案修正後之下一次變更正確送出: 對舊資料(v1)比對, 新增t3(insert)與修改t2(save)皆不遺失, 且無新錯誤
                    s.write(v3)
                    await s.pb.until(3, 1, 'corrected file')
                    assert.strict.deepStrictEqual(summary(s.pb.msgs), [
                        { type: 'insert', ltdt: [r1, r2] },
                        { type: 'insert', ltdt: [r3] },
                        { type: 'save', ltdt: [r2b] },
                    ])
                    assert.strict.deepStrictEqual(await s.om.select(), [r1, r2b, r3])
                }
                finally {
                    await s.close()
                }
            })

        }

        it(`should keep the old data when the converter fails while the changes are being prepared, then send the lost changes with the next change`, async function() {
            //converter僅於收到「只含t3之新增子集」時拋錯一次(內容判斷, 不依呼叫次序): 比對成功但轉換新增資料失敗
            let armed = true
            let converter = (ltdt) => {
                if (armed && ltdt.length === 1 && ltdt[0].time === 't3') {
                    armed = false
                    throw new Error('converter boom')
                }
                return ltdt
            }
            let s = mkSource('converter-fail', v1, { converter })
            try {
                await s.pb.until(1, 0, 'insert')

                //[R]轉換失敗: 記錄錯誤, 不送出任何變更(新增與修改皆不送)
                s.write(v3)
                await s.pb.until(1, 1, 'converter fail')
                assert.strict.deepStrictEqual(s.pb.errs, [{ tag: 'readSave catch', message: 'converter boom' }])
                assert.strict.deepStrictEqual(summary(s.pb.msgs), [{ type: 'insert', ltdt: [r1, r2] }])

                //[R]失敗之該次變更不得就此遺失: 記憶體維持舊資料, 下一次變更(新增t4)時對舊資料比對, t3新增、t2修改、t4新增皆送出
                s.write('t1,1\nt2,22\nt3,3\nt4,4\n')
                await s.pb.until(3, 1, 'next change')
                assert.strict.deepStrictEqual(summary(s.pb.msgs), [
                    { type: 'insert', ltdt: [r1, r2] },
                    { type: 'insert', ltdt: [r3, r4] },
                    { type: 'save', ltdt: [r2b] },
                ])
                assert.strict.deepStrictEqual(await s.om.select(), [r1, r2b, r3, r4])
            }
            finally {
                await s.close()
            }
        })

    })

    //-------------------------------------------------------------------------

    describe('only comparable data enters the memory (R-SYNC-COMMIT-01)', function() {

        let v1 = 't1,1\nt2,2\n'
        let v3 = 't1,1\nt2,22\nt3,3\n'

        //首次載入即不可比對之案例: [標題, 內容]
        let casesBadFirst = [
            ['a duplicated key', 't1,1\nt1,9\nt2,2\n'],
            ['an empty key', ',9\nt1,1\nt2,2\n'],
        ]

        for (let [label, bad] of casesBadFirst) {

            it(`should neither keep nor send the data of a first-loaded file that has ${label}, then send it with insert once the file is corrected`, async function() {
                let s = mkSource(`first-bad-${label.replace(/ /g, '-')}`, bad)
                try {

                    //[R]首次載入之資料不可比對: 記錄錯誤(readInsert), 不送出insert(壞資料不污染下游), 記憶體維持空
                    await s.pb.until(0, 1, 'bad first load')
                    assert.strict.deepStrictEqual(s.pb.errs.length, 1)
                    assert.strict.deepStrictEqual(s.pb.errs[0].tag, 'readInsert catch')
                    assert.strict.deepStrictEqual(/^invalid ltdtNew\[/.test(s.pb.errs[0].message), true)
                    assert.strict.deepStrictEqual(summary(s.pb.msgs), [])
                    assert.strict.deepStrictEqual(await s.om.select(), [])

                    //[R]檔案修正後之變更: 該檔尚未載入成功, 視同首次載入以insert送出全部
                    s.write(v1)
                    await s.pb.until(1, 1, 'corrected file')
                    assert.strict.deepStrictEqual(summary(s.pb.msgs), [{ type: 'insert', ltdt: [r1, r2] }])
                    assert.strict.deepStrictEqual(await s.om.select(), [r1, r2])

                    //[R]其後為一般比對: 新增t3(insert)與修改t2(save), 無新錯誤
                    s.write(v3)
                    await s.pb.until(3, 1, 'normal diff')
                    assert.strict.deepStrictEqual(summary(s.pb.msgs), [
                        { type: 'insert', ltdt: [r1, r2] },
                        { type: 'insert', ltdt: [r3] },
                        { type: 'save', ltdt: [r2b] },
                    ])
                    assert.strict.deepStrictEqual(await s.om.select(), [r1, r2b, r3])
                }
                finally {
                    await s.close()
                }
            })

        }

        it(`should neither keep nor send the data written to a file that has no data when it has a duplicated key, then send it with insert once the file is corrected`, async function() {
            //舊側無資料之分支: 空檔首次載入(insert空陣列), 其後寫入含重複主鍵之資料
            let s = mkSource('empty-then-bad', '')
            try {
                await s.pb.until(1, 0, 'empty first load')
                assert.strict.deepStrictEqual(summary(s.pb.msgs), [{ type: 'insert', ltdt: [] }])

                //[R]舊側無資料時新資料亦先驗證: 不可比對則記錄錯誤(readSave), 不送出insert, 記憶體維持空
                s.write('t1,1\nt1,9\nt2,2\n')
                await s.pb.until(1, 1, 'bad data')
                assert.strict.deepStrictEqual(s.pb.errs.length, 1)
                assert.strict.deepStrictEqual(s.pb.errs[0].tag, 'readSave catch')
                assert.strict.deepStrictEqual(/^invalid ltdtNew\[/.test(s.pb.errs[0].message), true)
                assert.strict.deepStrictEqual(summary(s.pb.msgs), [{ type: 'insert', ltdt: [] }])
                assert.strict.deepStrictEqual(await s.om.select(), [])

                //[R]檔案修正後以insert送出全部
                s.write(v1)
                await s.pb.until(2, 1, 'corrected file')
                assert.strict.deepStrictEqual(summary(s.pb.msgs), [{ type: 'insert', ltdt: [] }, { type: 'insert', ltdt: [r1, r2] }])
                assert.strict.deepStrictEqual(await s.om.select(), [r1, r2])
            }
            finally {
                await s.close()
            }
        })

        it(`should load a file whose first load failed (the converter threw) with insert when the file changes next, instead of failing for ever`, async function() {
            //首次載入時轉換函數拋錯(僅一次): 該檔未進記憶體; 其後之變更不得因記憶體無此檔而永遠拋錯
            let armed = true
            let converter = (ltdt) => {
                if (armed) {
                    armed = false
                    throw new Error('converter boom')
                }
                return ltdt
            }
            let s = mkSource('first-converter-fail', v1, { converter })
            try {
                await s.pb.until(0, 1, 'first load fail')
                assert.strict.deepStrictEqual(s.pb.errs, [{ tag: 'readInsert catch', message: 'converter boom' }])
                assert.strict.deepStrictEqual(await s.om.select(), [])

                //[R]該檔尚未載入成功, 其後之變更視同首次載入, 以insert送出全部
                s.write(v3)
                await s.pb.until(1, 1, 'next change')
                assert.strict.deepStrictEqual(summary(s.pb.msgs), [{ type: 'insert', ltdt: [r1, r2b, r3] }])
                assert.strict.deepStrictEqual(await s.om.select(), [r1, r2b, r3])
            }
            finally {
                await s.close()
            }
        })

        it(`should not report an error when a file that never entered the memory (refused at its first load) is deleted`, async function() {
            let s = mkSource('refused-then-deleted', 't1,1\nt1,9\n')
            try {
                await s.pb.until(0, 1, 'refused')

                //刪除該檔(偵測到unlink後再放入另一個正常檔案: 佇列依序處理, 該檔之移除作業必在其後之載入之前完成)
                fs.unlinkSync(`${s.fd}/h0.csv`)
                await s.tr.next((e) => e.type === 'emit' && e.kind === 'unlink', 'unlink detected')
                fs.writeFileSync(`${s.fd}/h1.csv`, v1, 'utf8')

                //[R]未進記憶體之檔案被刪除: 無可送出之del(下游從未收到其資料)亦不是錯誤, 不記錄錯誤(錯誤數仍為首次載入拒收之1筆)
                await s.pb.until(1, 1, 'next file')
                assert.strict.deepStrictEqual(summary(s.pb.msgs), [{ type: 'insert', ltdt: [r1, r2] }])
                assert.strict.deepStrictEqual(await s.om.select(), [r1, r2])
            }
            finally {
                await s.close()
            }
        })

    })

})
