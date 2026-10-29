import assert from 'assert'
import fs from 'fs'
import path from 'path'
import fsCreateFolder from 'wsemi/src/fsCreateFolder.mjs'
import fsDeleteFolder from 'wsemi/src/fsDeleteFolder.mjs'
import WDataSourceFromCsv from '../src/WDataSourceFromCsv.mjs'
import { createRecorder, createGate } from './tools/syncerTraceKit.mjs'


//WDataSourceFromCsv之觀察回調(opt.onTrace): 原樣轉交給監看資料夾之wsemi fsWatchFolder
//  P1 以事件同步: 同步點為watcher之ready與被測物自身之change事件, 不以等待毫秒同步
//  P3 預設不變: 未傳onTrace時之對外行為與傳了時相同
//  P4 回調不得影響被測函數: 拋錯、回傳rejection、非函數皆不影響偵測結果
describe('sfcsv_trace', function() {

    let fdTmp = './test/_tmp/sfcsv_trace'

    after(function() {
        fsDeleteFolder(fdTmp)
    })

    it(`should forward onTrace to the folder watcher: watch, ready, emit add with the resolved path, then clear and closed`, async function() {
        let fd = `${fdTmp}/forward`
        fsCreateFolder(fd)

        let tr = createRecorder()
        let gate = createGate()
        let msgs = []
        let om = WDataSourceFromCsv(fd, { heads: ['time', 'value'], key: 'time', onTrace: tr.onTrace })
        om.on('change', (msg) => {
            msgs.push(msg.type)
            gate.hit()
        })

        //ready後新增之檔案才會被偵測到
        await tr.next((e) => e.type === 'ready', 'watcher ready')
        fs.writeFileSync(`${fd}/h0.csv`, '2020-01-01T00:00:00, 1\n', 'utf8')
        let eAdd = await tr.next((e) => e.type === 'emit' && e.kind === 'add', 'emit add')
        await gate.until(1, 'source change')
        om.clear()
        await tr.next((e) => e.type === 'closed', 'closed')

        //spec: 偵測到新檔案時通知emit(kind為add, fp為path.resolve後路徑, src為watcher), 並由來源發送insert
        assert.strict.deepStrictEqual(eAdd, { type: 'emit', kind: 'add', fp: path.resolve(`${fd}/h0.csv`), src: 'watcher' })
        assert.strict.deepStrictEqual(msgs, ['insert'])

        //spec: 事件順序為watch、ready、emit(add)、clear、unwatch、closed, clear僅通知一次
        let at = (pred) => tr.events.findIndex(pred)
        let iWatch = at((e) => e.type === 'watch')
        let iReady = at((e) => e.type === 'ready')
        let iAdd = at((e) => e.type === 'emit' && e.kind === 'add')
        let iClear = at((e) => e.type === 'clear')
        let iUnwatch = at((e) => e.type === 'unwatch')
        let iClosed = at((e) => e.type === 'closed')
        assert.strict.deepStrictEqual(iWatch >= 0 && iWatch < iReady && iReady < iAdd && iAdd < iClear && iClear < iUnwatch && iUnwatch < iClosed, true)
        assert.strict.deepStrictEqual(tr.events.filter((e) => e.type === 'clear').length, 1)
        tr.events.forEach((e) => {
            assert.strict.deepStrictEqual(Object.isFrozen(e), true)
        })
    })

    //P3/P4: 同一情境下, 未傳onTrace、傳了紀錄器、拋錯、回傳rejection、非函數, 偵測結果皆相同
    //  情境為資料夾內已有一個csv檔, 建立來源後等其發送insert; 各變體並行以縮短耗時
    let msgExpected = '{"type":"insert","ltdt":[{"time":"2020-01-01T00:00:00","value":" 1"}],"ltdtFmt":[{"time":"2020-01-01T00:00:00","value":" 1"}]}'

    let runScenario = async (name, optExtra) => {
        let fd = `${fdTmp}/${name}`
        fsCreateFolder(fd)
        fs.writeFileSync(`${fd}/h0.csv`, '2020-01-01T00:00:00, 1\n', 'utf8')
        let gate = createGate()
        let outs = []
        let om = WDataSourceFromCsv(fd, { heads: ['time', 'value'], key: 'time', ...optExtra })
        om.on('change', (msg) => {
            outs.push(JSON.stringify(msg))
            gate.hit()
        })
        await gate.until(1, `${name} source change`)
        om.clear()
        return outs
    }

    it(`should detect the same when onTrace is not given, a recorder, throws, returns a rejection or is not a function`, async function() {
        let errs = []
        let fn = (err) => {
            errs.push(err)
        }
        process.on('unhandledRejection', fn)
        try {
            let tr = createRecorder()
            let nThrow = 0
            let nReject = 0
            let fnThrow = () => {
                nThrow++
                throw new Error('trace throws')
            }
            let fnReject = () => {
                nReject++
                return Promise.reject(new Error('trace rejects'))
            }
            let rs = await Promise.all([
                runScenario('none', {}),
                runScenario('recorder', { onTrace: tr.onTrace }),
                runScenario('throws', { onTrace: fnThrow }),
                runScenario('rejects', { onTrace: fnReject }),
                runScenario('notfun', { onTrace: 'abc' }),
                runScenario('num', { onTrace: 123 }),
                runScenario('obj', { onTrace: {} }),
                runScenario('null', { onTrace: null }),
            ])
            await new Promise((resolve) => setImmediate(resolve))
            await new Promise((resolve) => setImmediate(resolve))

            rs.forEach((outs) => {
                assert.strict.deepStrictEqual(outs, [msgExpected])
            })
            assert.strict.deepStrictEqual(tr.events.some((e) => e.type === 'ready'), true)
            assert.strict.deepStrictEqual(nThrow > 0, true)
            assert.strict.deepStrictEqual(nReject > 0, true)
            assert.strict.deepStrictEqual(errs, [])
        }
        finally {
            process.off('unhandledRejection', fn)
        }
    })

})
