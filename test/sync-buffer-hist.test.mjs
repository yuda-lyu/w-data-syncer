import assert from 'assert'
import fs from 'fs'
import { mock } from 'node:test'
import map from 'lodash-es/map.js'
import filter from 'lodash-es/filter.js'
import sortBy from 'lodash-es/sortBy.js'
import uniq from 'lodash-es/uniq.js'
import nowms2strp from 'wsemi/src/nowms2strp.mjs'
import fsTreeFolder from 'wsemi/src/fsTreeFolder.mjs'
import fsCreateFolder from 'wsemi/src/fsCreateFolder.mjs'
import fsDeleteFolder from 'wsemi/src/fsDeleteFolder.mjs'
import fsWriteText from 'wsemi/src/fsWriteText.mjs'
import syncByBuffer from '../src/syncByBuffer.mjs'


//syncByBuffer 之下載歷史資料夾命名: 同一秒(乃至同一毫秒)內多輪須各有獨立之歷史資料夾與完成狀態檔, 不得共用同名
//  funGetFiles 刻意不清空 fdDw: 清空會掩蓋「多輪共用同名資料夾」, 使結果碰巧正確
//  以 node:test 之 mock.timers 凍結 Date 以決定性地製造「同一毫秒」, 不依賴實際執行速度或是否跨秒
describe('sync-buffer-hist', function() {

    let fdRoot = './test/_tmp/sync-buffer-hist'
    let fdHists = `${fdRoot}/hists`
    let fdHistStates = `${fdRoot}/histstates`
    let fdTemp = `${fdRoot}/temp`
    let fdStorage = `${fdRoot}/storage`

    //凍結時刻(任意固定值; 名稱由 nowms2strp() 於凍結後取得, 與時區無關)
    let tFrozen = new Date('2026-10-31T10:20:40.123+08:00')

    let clean = () => {
        fsDeleteFolder(fdRoot)
    }

    let mkOpt = (numKeep = 10, extra = {}) => {
        return {
            numKeep,
            fdFromStorageTempHists: fdHists,
            fdFromStorageTempHistStates: fdHistStates,
            fdFromStorageTemp: fdTemp,
            fdFromStorage: fdStorage,
            ...extra,
        }
    }

    //mkGet, 第n輪之 funGetFiles: 於 fdDw 內寫入該輪專屬檔案 r<n>.txt(不清空 fdDw)
    let mkGet = (n, { partialThenThrow = false } = {}) => {
        return async (fdDw) => {
            fs.writeFileSync(`${fdDw}/r${n}.txt`, `R${n}`, 'utf8')
            if (partialThenThrow) {
                throw new Error(`round ${n} failed after writing partial file`)
            }
            return [{ name: `r${n}.txt`, path: `${fdDw}/r${n}.txt` }]
        }
    }

    let runRound = async (n, opt, flags) => {
        return syncByBuffer(mkGet(n, flags), opt)
    }

    //listNames, 依名稱排序列出某夾下之資料夾名或檔名
    let listNames = (fd, isFolder) => {
        let vfps = filter(fsTreeFolder(fd, 1), { isFolder })
        return sortBy(map(vfps, 'name'))
    }

    //listFilesIn, 某歷史資料夾內之檔名
    let listFilesIn = (name) => {
        return listNames(`${fdHists}/${name}`, false)
    }

    //snapshot, 儲存區實際檔案內容
    let snapshot = (fd) => {
        let vfps = filter(fsTreeFolder(fd, 1), { isFolder: false })
        vfps = sortBy(vfps, 'name')
        return map(vfps, (v) => `${v.name}=${fs.readFileSync(v.path, 'utf8')}`).join(', ')
    }

    beforeEach(function() {
        clean()
        fsCreateFolder(fdRoot)
    })

    afterEach(function() {
        mock.timers.reset()
        clean()
    })

    it(`should create an independent history folder and state file per round when 3 rounds run within the same millisecond`, async function() {
        mock.timers.enable({ apis: ['Date'], now: tFrozen })

        let opt = mkOpt(10)
        await runRound(1, opt)
        await runRound(2, opt)
        await runRound(3, opt)

        //三輪各有一個歷史資料夾與一個完成狀態檔(名稱互異且一一對應)
        let folders = listNames(fdHists, true)
        let states = listNames(fdHistStates, false)
        assert.strict.deepStrictEqual(folders.length, 3)
        assert.strict.deepStrictEqual(uniq(folders).length, 3)
        assert.strict.deepStrictEqual(states, folders)

        //各歷史資料夾只含該輪下載之檔案, 不混入其他輪(依名稱排序後即輪序)
        let kp = map(folders, (name) => ({ name, files: listFilesIn(name) }))
        assert.strict.deepStrictEqual(map(kp, 'files'), [['r1.txt'], ['r2.txt'], ['r3.txt']])

        //儲存區為保留之三輪聯集
        assert.strict.deepStrictEqual(snapshot(fdStorage), 'r1.txt=R1, r2.txt=R2, r3.txt=R3')
    })

    it(`should name history by millisecond timestamp plus 3-digit sequence, and increase the sequence within the same millisecond`, async function() {
        mock.timers.enable({ apis: ['Date'], now: tFrozen })
        let prefix = nowms2strp() //17碼毫秒時間戳

        let opt = mkOpt(10)
        await runRound(1, opt)
        await runRound(2, opt)
        await runRound(3, opt)

        let rExpect = [`${prefix}000`, `${prefix}001`, `${prefix}002`]
        assert.strict.deepStrictEqual(listNames(fdHists, true), rExpect)
        assert.strict.deepStrictEqual(listNames(fdHistStates, false), rExpect)
    })

    it(`should keep the newest round, not the oldest, when numKeep is 1 and 3 rounds run within the same millisecond`, async function() {
        mock.timers.enable({ apis: ['Date'], now: tFrozen })

        let opt = mkOpt(1)
        await runRound(1, opt)
        await runRound(2, opt)
        let r3 = await runRound(3, opt)

        //只保留最新一輪(第3輪)之歷史資料夾與完成狀態檔
        let folders = listNames(fdHists, true)
        assert.strict.deepStrictEqual(folders.length, 1)
        assert.strict.deepStrictEqual(listNames(fdHistStates, false), folders)
        assert.strict.deepStrictEqual(listFilesIn(folders[0]), ['r3.txt'])

        //儲存區為最新一輪之內容
        assert.strict.deepStrictEqual(snapshot(fdStorage), 'r3.txt=R3')
        assert.strict.deepStrictEqual(r3, { b: true })
    })

    it(`should keep the newest 2 rounds when numKeep is 2 and 4 rounds run within the same millisecond`, async function() {
        mock.timers.enable({ apis: ['Date'], now: tFrozen })

        let opt = mkOpt(2)
        await runRound(1, opt)
        await runRound(2, opt)
        await runRound(3, opt)
        await runRound(4, opt)

        let folders = listNames(fdHists, true)
        assert.strict.deepStrictEqual(map(folders, listFilesIn), [['r3.txt'], ['r4.txt']])
        assert.strict.deepStrictEqual(listNames(fdHistStates, false), folders)
        assert.strict.deepStrictEqual(snapshot(fdStorage), 'r3.txt=R3, r4.txt=R4')
    })

    it(`should order history names chronologically when the clock advances by 1ms across a second boundary`, async function() {
        let t0 = new Date('2026-10-31T10:20:40.998+08:00')
        mock.timers.enable({ apis: ['Date'], now: t0 })

        let opt = mkOpt(10)
        let p1 = nowms2strp()
        await runRound(1, opt) //.998
        mock.timers.tick(1)
        let p2 = nowms2strp()
        await runRound(2, opt) //.999
        mock.timers.tick(1)
        let p3 = nowms2strp()
        await runRound(3, opt) //次一秒 .000

        //名稱互異, 且依名稱排序之順序即為各輪發生之順序
        let folders = listNames(fdHists, true)
        assert.strict.deepStrictEqual(uniq(folders).length, 3)
        assert.strict.deepStrictEqual(map(folders, listFilesIn), [['r1.txt'], ['r2.txt'], ['r3.txt']])

        //序號只在同一毫秒內遞增, 換毫秒即自000起
        assert.strict.deepStrictEqual(folders, [`${p1}000`, `${p2}000`, `${p3}000`])
    })

    it(`should keep names in round order when 12 rounds run within the same millisecond (sequence is zero-padded)`, async function() {
        mock.timers.enable({ apis: ['Date'], now: tFrozen })

        let opt = mkOpt(12)
        for (let n = 1; n <= 12; n++) {
            await runRound(n, opt)
        }

        //序號補零至3碼, 第10輪之 010 不得排在第2輪之 001 之前
        let folders = listNames(fdHists, true)
        assert.strict.deepStrictEqual(folders.length, 12)
        assert.strict.deepStrictEqual(map(folders, listFilesIn), map(Array.from({ length: 12 }, (v, i) => i + 1), (n) => [`r${n}.txt`]))
    })

    it(`should reject loudly instead of reusing a name when more than 1000 rounds run within the same millisecond`, async function() {
        mock.timers.enable({ apis: ['Date'], now: tFrozen })

        //numKeep為1, 每輪僅留最新者, 序號仍遞增(不回收已刪除者)
        let opt = mkOpt(1)
        let funGetFiles = async (fdDw) => {
            fs.writeFileSync(`${fdDw}/r.txt`, 'R', 'utf8')
            return []
        }
        for (let n = 1; n <= 1000; n++) {
            await syncByBuffer(funGetFiles, opt)
        }
        assert.strict.deepStrictEqual(listNames(fdHists, true).length, 1)

        //第1001輪無可用序號
        await assert.rejects(syncByBuffer(funGetFiles, opt), /too many rounds within the same millisecond/)
    })

    it(`should not let the partial files of a failed round leak into later rounds when rounds run within the same millisecond`, async function() {
        mock.timers.enable({ apis: ['Date'], now: tFrozen })

        let opt = mkOpt(10)
        await runRound(1, opt)

        //第2輪寫入部分檔案後失敗, 沒有完成狀態檔
        await assert.rejects(runRound(2, opt, { partialThenThrow: true }), /round 2 failed/)

        await runRound(3, opt)

        //第2輪之未完成資料夾於第3輪被清除, 其半成品不得進入儲存區
        let folders = listNames(fdHists, true)
        assert.strict.deepStrictEqual(map(folders, listFilesIn), [['r1.txt'], ['r3.txt']])
        assert.strict.deepStrictEqual(listNames(fdHistStates, false), folders)
        assert.strict.deepStrictEqual(snapshot(fdStorage), 'r1.txt=R1, r3.txt=R3')
    })

    it(`should not reuse a name left by an orphan state file whose folder does not exist`, async function() {
        mock.timers.enable({ apis: ['Date'], now: tFrozen })
        let prefix = nowms2strp()

        //殘存之完成狀態檔(對應之歷史資料夾已不存在), 其名稱恰與本毫秒之首個名稱相同
        fsCreateFolder(fdHistStates)
        fsWriteText(`${fdHistStates}/${prefix}000`, 'done')

        await runRound(1, mkOpt(10))

        //新一輪之名稱不沿用殘存狀態檔之名稱, 否則新輪於下載途中失敗時會被舊狀態檔誤判為已完成; 殘存狀態檔於本輪被清除
        assert.strict.deepStrictEqual(listNames(fdHists, true), [`${prefix}001`])
        assert.strict.deepStrictEqual(listNames(fdHistStates, false), [`${prefix}001`])
        assert.strict.deepStrictEqual(snapshot(fdStorage), 'r1.txt=R1')
    })

    it(`should evict a 14-digit second-level folder left by earlier versions before the new names when numKeep is exceeded`, async function() {
        //升版前殘留之14碼秒級名稱(歷史資料夾與完成狀態檔)
        fsCreateFolder(`${fdHists}/20200101000000`)
        fs.writeFileSync(`${fdHists}/20200101000000/old.txt`, 'OLD', 'utf8')
        fsCreateFolder(fdHistStates)
        fsWriteText(`${fdHistStates}/20200101000000`, 'done')

        await runRound(1, mkOpt(1))

        //舊名稱排在新名稱之前, 先被淘汰; 儲存區只含新一輪
        let folders = listNames(fdHists, true)
        assert.strict.deepStrictEqual(folders.length, 1)
        assert.strict.deepStrictEqual(/^\d{20}$/.test(folders[0]), true)
        assert.strict.deepStrictEqual(listNames(fdHistStates, false), folders)
        assert.strict.deepStrictEqual(listFilesIn(folders[0]), ['r1.txt'])
        assert.strict.deepStrictEqual(snapshot(fdStorage), 'r1.txt=R1')
    })

    it(`should create 5 independent history folders when 5 rounds run back to back with the real clock`, async function() {
        let opt = mkOpt(10)
        for (let n = 1; n <= 5; n++) {
            await runRound(n, opt)
        }

        let folders = listNames(fdHists, true)
        assert.strict.deepStrictEqual(uniq(folders).length, 5)
        assert.strict.deepStrictEqual(map(folders, listFilesIn), [['r1.txt'], ['r2.txt'], ['r3.txt'], ['r4.txt'], ['r5.txt']])
        assert.strict.deepStrictEqual(listNames(fdHistStates, false), folders)
        assert.strict.deepStrictEqual(snapshot(fdStorage), 'r1.txt=R1, r2.txt=R2, r3.txt=R3, r4.txt=R4, r5.txt=R5')
    })

    //歷史資料夾與完成狀態檔之配對清理: 以名稱集合逐一對應, 不得以兩者數量差判斷
    //  完成之一輪=同名之歷史資料夾與完成狀態檔皆存在; 只有資料夾(下載未完成)或只有狀態檔(資料夾已被刪)者為不完整, 須被清除且其檔案不得進入儲存區
    //  seed 以 20200101 開頭之 14 碼名稱, 排序上早於本輪新名稱
    describe('pairing cleanup by name set', function() {

        let nameA = '20200101000001'
        let nameB = '20200101000002'
        let nameC = '20200101000003'
        let nameD = '20200101000004'
        let nameE = '20200101000005'

        //seedFolder, 建立歷史資料夾並寫入一個檔案
        let seedFolder = (name, fn, c) => {
            fsCreateFolder(`${fdHists}/${name}`)
            fs.writeFileSync(`${fdHists}/${name}/${fn}`, c, 'utf8')
        }

        //seedState, 建立完成狀態檔
        let seedState = (name) => {
            fsCreateFolder(fdHistStates)
            fsWriteText(`${fdHistStates}/${name}`, 'done')
        }

        //mkLog, 收集 srLog.error 之紀錄
        let mkLog = () => {
            let errors = []
            return {
                errors,
                srLog: {
                    info: () => {},
                    error: (e) => {
                        errors.push(e)
                    },
                },
            }
        }

        //seedRounds, 配對完整之一輪(資料夾與完成狀態檔)
        let seedRound = (name, fn, c) => {
            seedFolder(name, fn, c)
            seedState(name)
        }

        beforeEach(function() {
            fsCreateFolder(fdHists)
            fsCreateFolder(fdHistStates)
        })

        it(`should drop an incomplete folder and an orphan state file and keep neither in storage when their counts are equal`, async function() {
            //資料夾 2 個(B 無狀態檔), 狀態檔 2 個(A 無資料夾), 本輪完成後兩者皆為 2 個, 但名稱集合不同
            seedFolder(nameB, 'partial.txt', 'PARTIAL')
            seedState(nameA)

            let lg = mkLog()
            await runRound(1, mkOpt(10, { srLog: lg.srLog }))

            //只剩本輪; 不完整之 B 資料夾與無資料夾之 A 狀態檔皆清除
            let folders = listNames(fdHists, true)
            assert.strict.deepStrictEqual(map(folders, listFilesIn), [['r1.txt']])
            assert.strict.deepStrictEqual(listNames(fdHistStates, false), folders)

            //未完成資料夾之檔案不得進入儲存區
            assert.strict.deepStrictEqual(snapshot(fdStorage), 'r1.txt=R1')
            assert.strict.deepStrictEqual(lg.errors, [])
        })

        it(`should keep a complete older round and drop only the mismatched ones when counts are equal`, async function() {
            //資料夾 A(完整)、B(無狀態檔)、狀態檔 A、C(無資料夾), 加本輪後兩者皆 3 個
            seedRound(nameA, 'a.txt', 'A')
            seedFolder(nameB, 'partial.txt', 'PARTIAL')
            seedState(nameC)

            let lg = mkLog()
            await runRound(1, mkOpt(10, { srLog: lg.srLog }))

            let folders = listNames(fdHists, true)
            assert.strict.deepStrictEqual(folders.length, 2)
            assert.strict.deepStrictEqual(folders[0], nameA)
            assert.strict.deepStrictEqual(map(folders, listFilesIn), [['a.txt'], ['r1.txt']])
            assert.strict.deepStrictEqual(listNames(fdHistStates, false), folders)
            assert.strict.deepStrictEqual(snapshot(fdStorage), 'a.txt=A, r1.txt=R1')
            assert.strict.deepStrictEqual(lg.errors, [])
        })

        it(`should also drop orphan state files when there are more folders than state files`, async function() {
            //資料夾 A(完整)、B、C(無狀態檔), 狀態檔 A、D(無資料夾), 加本輪後資料夾 4 個多於狀態檔 3 個
            seedRound(nameA, 'a.txt', 'A')
            seedFolder(nameB, 'partialB.txt', 'PB')
            seedFolder(nameC, 'partialC.txt', 'PC')
            seedState(nameD)

            let lg = mkLog()
            await runRound(1, mkOpt(10, { srLog: lg.srLog }))

            let folders = listNames(fdHists, true)
            assert.strict.deepStrictEqual(map(folders, listFilesIn), [['a.txt'], ['r1.txt']])
            assert.strict.deepStrictEqual(listNames(fdHistStates, false), folders)
            assert.strict.deepStrictEqual(snapshot(fdStorage), 'a.txt=A, r1.txt=R1')
            assert.strict.deepStrictEqual(lg.errors, [])
        })

        it(`should also drop incomplete folders when there are more state files than folders`, async function() {
            //資料夾 A(完整)、B(無狀態檔), 狀態檔 A、C、D(無資料夾), 加本輪後狀態檔 4 個多於資料夾 3 個
            seedRound(nameA, 'a.txt', 'A')
            seedFolder(nameB, 'partial.txt', 'PARTIAL')
            seedState(nameC)
            seedState(nameD)

            let lg = mkLog()
            await runRound(1, mkOpt(10, { srLog: lg.srLog }))

            let folders = listNames(fdHists, true)
            assert.strict.deepStrictEqual(map(folders, listFilesIn), [['a.txt'], ['r1.txt']])
            assert.strict.deepStrictEqual(listNames(fdHistStates, false), folders)
            assert.strict.deepStrictEqual(snapshot(fdStorage), 'a.txt=A, r1.txt=R1')
            assert.strict.deepStrictEqual(lg.errors, [])
        })

        it(`should not evict a complete round because of an incomplete folder when the complete rounds do not exceed numKeep`, async function() {
            //完整 A、C 加本輪共 3 輪, numKeep 為 3 須全留; 不完整之 B 夾位於 A 與 C 之間(資料夾 4 個多於狀態檔 3 個)
            seedRound(nameA, 'a.txt', 'A')
            seedFolder(nameB, 'partial.txt', 'PARTIAL')
            seedRound(nameC, 'c.txt', 'C')

            let lg = mkLog()
            await runRound(1, mkOpt(3, { srLog: lg.srLog }))

            let folders = listNames(fdHists, true)
            assert.strict.deepStrictEqual(map(folders, listFilesIn), [['a.txt'], ['c.txt'], ['r1.txt']])
            assert.strict.deepStrictEqual(listNames(fdHistStates, false), folders)
            assert.strict.deepStrictEqual(snapshot(fdStorage), 'a.txt=A, c.txt=C, r1.txt=R1')
            assert.strict.deepStrictEqual(lg.errors, [])
        })

        it(`should keep the newest numKeep complete rounds, never an incomplete folder, when mismatched names are mixed in`, async function() {
            //完整 A、B、C 加本輪共 4 輪, numKeep 為 2 只留最新 2 輪(C 與本輪); 不完整之 D 夾與無資料夾之 E 狀態檔夾雜其中, 兩者數量相等
            seedRound(nameA, 'a.txt', 'A')
            seedRound(nameB, 'b.txt', 'B')
            seedRound(nameC, 'c.txt', 'C')
            seedFolder(nameD, 'partial.txt', 'PARTIAL')
            seedState(nameE)

            let lg = mkLog()
            await runRound(1, mkOpt(2, { srLog: lg.srLog }))

            let folders = listNames(fdHists, true)
            assert.strict.deepStrictEqual(map(folders, listFilesIn), [['c.txt'], ['r1.txt']])
            assert.strict.deepStrictEqual(listNames(fdHistStates, false), folders)
            assert.strict.deepStrictEqual(snapshot(fdStorage), 'c.txt=C, r1.txt=R1')
            assert.strict.deepStrictEqual(lg.errors, [])
        })

        it(`should leave complete rounds untouched when every folder has its own state file`, async function() {
            //完整配對不受清理影響(回歸): A、B 完整, numKeep 為 10
            seedRound(nameA, 'a.txt', 'A')
            seedRound(nameB, 'b.txt', 'B')

            let lg = mkLog()
            await runRound(1, mkOpt(10, { srLog: lg.srLog }))

            let folders = listNames(fdHists, true)
            assert.strict.deepStrictEqual(map(folders, listFilesIn), [['a.txt'], ['b.txt'], ['r1.txt']])
            assert.strict.deepStrictEqual(listNames(fdHistStates, false), folders)
            assert.strict.deepStrictEqual(snapshot(fdStorage), 'a.txt=A, b.txt=B, r1.txt=R1')
            assert.strict.deepStrictEqual(lg.errors, [])
        })

    })

})
