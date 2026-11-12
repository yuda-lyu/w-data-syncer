//sync-nonarray.test.mjs: 規則帳本R-SYNC-NONARRAY-01之測試
//  規則: 比對前之「舊側」資料(by-orm之tar.select()回傳值, by-1to1與by-nto1之hash快取檔內容)須為陣列, 非陣列時中止本輪並記錄錯誤事件,
//  不視同空陣列(視同空陣列會使來源全數被當成新增而重送, 或在wsemi ltdtDiffByKey對非陣列回空結果時靜默不同步)
//  each it標註之[R]為對應之規則句, 斷言為該句之翻譯, 非現狀指紋
import assert from 'assert'
import fs from 'fs'
import map from 'lodash-es/map.js'
import get from 'lodash-es/get.js'
import filter from 'lodash-es/filter.js'
import fsTreeFolder from 'wsemi/src/fsTreeFolder.mjs'
import fsDeleteFolder from 'wsemi/src/fsDeleteFolder.mjs'
import syncByOrm from '../src/syncByOrm.mjs'
import syncBy1To1 from '../src/syncBy1To1.mjs'
import syncByNTo1 from '../src/syncByNTo1.mjs'
import WDataSyncer from '../src/WDataSyncer.mjs'
import { createRecorder, createGate } from './tools/syncerTraceKit.mjs'


//固定訊息, 不帶輸入值(斷言訊息等於此常數即證明未回顯輸入值)
let msgOrm = 'invalid tar.select result: must be an array'
let msgCache = 'invalid hash cache content: must be an array'


describe('sync-nonarray', function() {

    let fdRoot = './test/_tmp/sync-nonarray'

    before(function() {
        fsDeleteFolder(fdRoot)
    })

    after(function() {
        fsDeleteFolder(fdRoot)
    })

    describe('by-orm: tar.select() must return an array', function() {

        //mkOrm, tarSelect為tar.select()之回傳值, 各函數皆記次數, 供斷言目標端零寫入
        let rowsSrc = [{ id: 'a', value: 1 }, { id: 'b', value: 2 }]

        let mkOrm = (tarSelect, ltdtSrc) => {
            let calls = { selectSrc: 0, selectTar: 0, insert: 0, save: 0, del: 0 }
            let inserted = []
            let logs = { info: [], error: [] }
            let src = {
                select: async () => {
                    calls.selectSrc++
                    return ltdtSrc
                },
            }
            let tar = {
                select: async () => {
                    calls.selectTar++
                    return tarSelect
                },
                insert: async (items) => {
                    calls.insert++
                    inserted.push(...items)
                },
                save: async () => {
                    calls.save++
                },
                del: async () => {
                    calls.del++
                },
            }
            let srLog = {
                info: (e) => logs.info.push(e),
                error: (e) => logs.error.push(e),
            }
            return { src, tar, calls, inserted, logs, srLog }
        }

        let cases = [
            ['undefined', undefined],
            ['null', null],
            ['an empty object', {}],
            ['an object', { id: 'a', value: 1 }],
            ['a string', 'x'],
            ['a number', 123],
        ]

        for (let [label, value] of cases) {

            it(`should abort the round with an error event and write nothing when tar.select returns ${label}`, async function() {
                let { src, tar, calls, logs, srLog } = mkOrm(value, rowsSrc)

                let err = null
                let r = await syncByOrm(src, tar, { key: 'id', srLog })
                    .catch((e) => {
                        err = e
                        return 'threw'
                    })

                //[R]非陣列時中止本輪: 拋錯, 不回傳null(null為來源無資料之略過, 兩者分開)
                assert.strict.deepStrictEqual(r, 'threw')

                //[R]訊息固定, 不帶輸入值
                assert.strict.deepStrictEqual(get(err, 'message'), msgOrm)

                //[R]記錄一筆錯誤事件, 事件名為取目標資料之步驟, 訊息同上
                assert.strict.deepStrictEqual(logs.error, [{ event: 'syncByOrm-selectTar', msg: msgOrm }])

                //[R]目標端零寫入(insert/save/del皆未呼叫), 且不因非陣列而進入比對
                assert.strict.deepStrictEqual(calls, { selectSrc: 1, selectTar: 1, insert: 0, save: 0, del: 0 })
            })

        }

        it(`should still insert every source row when tar.select returns an empty array`, async function() {
            let { src, tar, calls, inserted, logs, srLog } = mkOrm([], rowsSrc)

            let r = await syncByOrm(src, tar, { key: 'id', srLog })

            //[R]合法之空陣列(目標尚無資料)照常比對: 來源全數新增
            assert.strict.deepStrictEqual(r.b, true)
            assert.strict.deepStrictEqual(map(r.insert, 'id'), ['a', 'b'])
            assert.strict.deepStrictEqual(map(inserted, 'id'), ['a', 'b'])
            assert.strict.deepStrictEqual(calls, { selectSrc: 1, selectTar: 1, insert: 1, save: 0, del: 0 })
            assert.strict.deepStrictEqual(logs.error, [])
        })

        it(`should skip with null and no error when the source has no data, before looking at tar.select`, async function() {
            for (let ltdtSrc of [undefined, null, []]) {
                let { src, tar, calls, logs, srLog } = mkOrm(null, ltdtSrc)

                let r = await syncByOrm(src, tar, { key: 'id', srLog })

                //[R]來源無資料之略過(回傳null)維持原樣, 且與目標型別錯誤分開: 不讀目標, 不記錯誤
                assert.strict.deepStrictEqual(r, null)
                assert.strict.deepStrictEqual(calls, { selectSrc: 1, selectTar: 0, insert: 0, save: 0, del: 0 })
                assert.strict.deepStrictEqual(logs.error, [])
            }
        })

    })

    //-------------------------------------------------------------------------

    //hash快取檔內容之案例: [標題, 檔案文字]
    let casesCache = [
        ['null', 'null'],
        ['a number', '123'],
        ['a string', '"x"'],
        ['an empty object', '{}'],
        ['an object', '{"a.txt":"abc"}'],
        ['a boolean', 'true'],
    ]

    //prepare, 建立來源夾(1個檔案a.txt)與hash夾, content不為undefined時寫入hash.json
    let prepare = (name, content) => {
        let fdBase = `${fdRoot}/${name}`
        let fdSrc = `${fdBase}/src`
        let fdHash = `${fdBase}/hash`
        let fdTar = `${fdBase}/tar`
        fsDeleteFolder(fdBase)
        fs.mkdirSync(fdSrc, { recursive: true })
        fs.mkdirSync(fdHash, { recursive: true })
        fs.writeFileSync(`${fdSrc}/a.txt`, 'A1', 'utf8')
        if (content !== undefined) {
            fs.writeFileSync(`${fdHash}/hash.json`, content, 'utf8')
        }
        return { fdSrc, fdHash, fdTar }
    }

    //snapshot, 夾內各檔案(不含夾)之名稱與內容
    let snapshot = (fd) => {
        if (!fs.existsSync(fd)) {
            return ''
        }
        let vfps = filter(fsTreeFolder(fd, 1), { isFolder: false })
        return map(vfps, (v) => `${v.name}=${fs.readFileSync(v.path, 'utf8')}`).join(', ')
    }

    //readHash, 讀hash.json原文
    let readHash = (fdHash) => {
        return fs.readFileSync(`${fdHash}/hash.json`, 'utf8')
    }

    describe('by-1to1: hash cache content must be an array', function() {

        //mkOpt
        let mkOpt = ({ fdSrc, fdHash, fdTar }) => {
            let calls = { funProc: 0, funRemove: 0, funPreEnd: 0 }
            let logs = { info: [], error: [] }
            let opt = {
                fdSrcStorage: fdSrc,
                fdFromStorageTempHash: fdHash,
                fdSelfStorage: fdTar,
                funGetVfpsSrc: async () => {
                    return filter(fsTreeFolder(fdSrc, 1), { isFolder: false })
                },
                funProc: async ({ fpSrc, fpTar }) => {
                    calls.funProc++
                    fs.copyFileSync(fpSrc, fpTar)
                },
                funRemove: async ({ fpTar }) => {
                    calls.funRemove++
                    fs.unlinkSync(fpTar)
                },
                funPreEnd: async () => {
                    calls.funPreEnd++
                },
                srLog: {
                    info: (e) => logs.info.push(e),
                    error: (e) => logs.error.push(e),
                },
            }
            return { opt, calls, logs }
        }

        for (let [label, content] of casesCache) {

            it(`should abort the round with an error event and write nothing when the cache content is ${label}`, async function() {
                let fds = prepare(`1to1-${label.replace(/ /g, '-')}`, content)
                let { opt, calls, logs } = mkOpt(fds)

                let rr = await syncBy1To1(opt)

                //[R]快取內容非陣列時與解析失敗同處置: 中止本輪, 回傳 b=false, bErr=true, 無差異清單
                assert.strict.deepStrictEqual(rr, { b: false, bErr: true })

                //[R]記錄一筆錯誤事件, 訊息固定(寫明為快取內容格式錯誤), 不帶內容值
                assert.strict.deepStrictEqual(logs.error, [{ event: 'proc', msg: msgCache }])

                //[R]目標端零寫入, 且不當成無快取而全量重送
                assert.strict.deepStrictEqual(calls, { funProc: 0, funRemove: 0, funPreEnd: 0 })
                assert.strict.deepStrictEqual(snapshot(fds.fdTar), '')

                //[R]不靜默改寫快取(快取檔維持原文)
                assert.strict.deepStrictEqual(readHash(fds.fdHash), content)
            })

        }

        it(`should treat a cache that is not valid JSON the same way (control of the existing handling)`, async function() {
            let fds = prepare('1to1-invalid-json', '{not json')
            let { opt, calls, logs } = mkOpt(fds)

            let rr = await syncBy1To1(opt)

            //[R]解析失敗之處置為本規則之對照: 結果形狀與非陣列相同(訊息為JSON.parse之訊息, 不比對文字)
            assert.strict.deepStrictEqual(rr, { b: false, bErr: true })
            assert.strict.deepStrictEqual(map(logs.error, 'event'), ['proc'])
            assert.strict.deepStrictEqual(calls, { funProc: 0, funRemove: 0, funPreEnd: 0 })
            assert.strict.deepStrictEqual(snapshot(fds.fdTar), '')
            assert.strict.deepStrictEqual(readHash(fds.fdHash), '{not json')
        })

        it(`should still send every file when the cache content is an empty array`, async function() {
            let fds = prepare('1to1-empty-array', '[]')
            let { opt, calls, logs } = mkOpt(fds)

            let rr = await syncBy1To1(opt)

            //[R]合法之空陣列快取(視為無歷史)照常比對: 來源全數新增, 且快取更新為最新hash
            assert.strict.deepStrictEqual(rr.b, true)
            assert.strict.deepStrictEqual(rr.bErr, false)
            assert.strict.deepStrictEqual(map(rr.add, 'id'), ['a.txt'])
            assert.strict.deepStrictEqual(calls, { funProc: 1, funRemove: 0, funPreEnd: 1 })
            assert.strict.deepStrictEqual(snapshot(fds.fdTar), 'a.txt=A1')
            assert.strict.deepStrictEqual(logs.error, [])
            let hashes = JSON.parse(readHash(fds.fdHash))
            assert.strict.deepStrictEqual(map(hashes, 'id'), ['a.txt'])
        })

    })

    describe('by-nto1: hash cache content must be an array', function() {

        //mkOpt
        let mkOpt = ({ fdSrc, fdHash }) => {
            let calls = { funProc: 0 }
            let logs = { info: [], error: [] }
            let opt = {
                fdFromStorageTempHash: fdHash,
                funGetVfpsSrc: async () => {
                    return filter(fsTreeFolder(fdSrc, 1), { isFolder: false })
                },
                funProc: async () => {
                    calls.funProc++
                },
                srLog: {
                    info: (e) => logs.info.push(e),
                    error: (e) => logs.error.push(e),
                },
            }
            return { opt, calls, logs }
        }

        for (let [label, content] of casesCache) {

            it(`should abort the round with an error event and not call funProc when the cache content is ${label}`, async function() {
                let fds = prepare(`nto1-${label.replace(/ /g, '-')}`, content)
                let { opt, calls, logs } = mkOpt(fds)

                let rr = await syncByNTo1(opt)

                //[R]快取內容非陣列時與解析失敗同處置: 中止本輪, 回傳 b=false, bErr=true, 無差異清單
                assert.strict.deepStrictEqual(rr, { b: false, bErr: true })

                //[R]記錄一筆錯誤事件, 訊息固定(寫明為快取內容格式錯誤), 不帶內容值
                assert.strict.deepStrictEqual(logs.error, [{ event: 'proc', msg: msgCache }])

                //[R]不呼叫funProc(不當成無快取而全量送出), 不靜默改寫快取
                assert.strict.deepStrictEqual(calls, { funProc: 0 })
                assert.strict.deepStrictEqual(readHash(fds.fdHash), content)
            })

        }

        it(`should treat a cache that is not valid JSON the same way (control of the existing handling)`, async function() {
            let fds = prepare('nto1-invalid-json', '{not json')
            let { opt, calls, logs } = mkOpt(fds)

            let rr = await syncByNTo1(opt)

            //[R]解析失敗之處置為本規則之對照: 結果形狀與非陣列相同
            assert.strict.deepStrictEqual(rr, { b: false, bErr: true })
            assert.strict.deepStrictEqual(map(logs.error, 'event'), ['proc'])
            assert.strict.deepStrictEqual(calls, { funProc: 0 })
            assert.strict.deepStrictEqual(readHash(fds.fdHash), '{not json')
        })

        it(`should still send every file when the cache content is an empty array`, async function() {
            let fds = prepare('nto1-empty-array', '[]')
            let { opt, calls, logs } = mkOpt(fds)

            let rr = await syncByNTo1(opt)

            //[R]合法之空陣列快取(視為無歷史)照常比對: 來源全數新增, 且快取更新為最新hash
            assert.strict.deepStrictEqual(rr.b, true)
            assert.strict.deepStrictEqual(rr.bErr, false)
            assert.strict.deepStrictEqual(map(rr.add, 'id'), ['a.txt'])
            assert.strict.deepStrictEqual(calls, { funProc: 1 })
            assert.strict.deepStrictEqual(logs.error, [])
            let hashes = JSON.parse(readHash(fds.fdHash))
            assert.strict.deepStrictEqual(map(hashes, 'id'), ['a.txt'])
        })

    })

    //-------------------------------------------------------------------------

    describe('through WDataSyncer (real seam, no stub of the sync functions)', function() {

        it(`should fail the by-orm round with the fixed message and write nothing when tar.select returns null, then recover`, async function() {
            let st = { tarSelect: null }
            let calls = { insert: 0 }
            let src = {
                select: async () => [{ id: 'a', value: 1 }],
            }
            let tar = {
                select: async () => st.tarSelect,
                insert: async () => {
                    calls.insert++
                },
                save: async () => {},
                del: async () => {},
            }
            let tr = createRecorder()
            let ev = WDataSyncer('by-orm', { src, tar, key: 'id', timeInterval: 5, onTrace: tr.onTrace })
            let gateErr = createGate()
            let errs = []
            ev.on('error', (err) => {
                errs.push(err.message)
                gateErr.hit()
            })

            try {
                let eFail = await tr.next((e) => e.type === 'fail', 'fail')
                await tr.next((e) => e.type === 'done', 'done after fail')
                await gateErr.until(1, 'error event')

                //[R]出錯輪: fail事件與error事件皆帶固定訊息, 目標端零寫入
                assert.strict.deepStrictEqual(eFail, { type: 'fail', round: 1, msg: msgOrm })
                assert.strict.deepStrictEqual(errs[0], msgOrm)
                assert.strict.deepStrictEqual(calls.insert, 0)

                //[R]錯誤不使其後各輪停擺: 目標回復為陣列後同步成功
                st.tarSelect = []
                let eOk = await tr.next((e) => e.type === 'done' && e.ok && e.b, 'recovered sync')
                assert.strict.deepStrictEqual(eOk.ok, true)
                assert.strict.deepStrictEqual(calls.insert, 1)
            }
            finally {
                ev.clear()
            }
        })

        it(`should report bErr and not call funProc when the by-1to1 cache content is null`, async function() {
            let fds = prepare('syncer-1to1-null', 'null')
            let calls = { funProc: 0 }
            let tr = createRecorder()
            let ev = WDataSyncer('by-1to1', {
                fdSrcStorage: fds.fdSrc,
                fdFromStorageTempHash: fds.fdHash,
                fdSelfStorage: fds.fdTar,
                funGetVfpsSrc: async () => filter(fsTreeFolder(fds.fdSrc, 1), { isFolder: false }),
                funProc: async ({ fpSrc, fpTar }) => {
                    calls.funProc++
                    fs.copyFileSync(fpSrc, fpTar)
                },
                funRemove: async () => {},
                timeInterval: 5,
                onTrace: tr.onTrace,
            })

            try {
                let eDone = await tr.next((e) => e.type === 'done', 'done')

                //[R]經WDataSyncer: 該輪完成且bErr為true(輪內捕捉錯誤), 目標端零寫入
                assert.strict.deepStrictEqual(eDone, { type: 'done', round: 1, ok: true, b: false, bErr: true })
                assert.strict.deepStrictEqual(calls.funProc, 0)
                assert.strict.deepStrictEqual(snapshot(fds.fdTar), '')
                assert.strict.deepStrictEqual(readHash(fds.fdHash), 'null')
            }
            finally {
                ev.clear()
            }
        })

    })

})
