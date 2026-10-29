import assert from 'assert'
import map from 'lodash-es/map.js'
import fsDeleteFolder from 'wsemi/src/fsDeleteFolder.mjs'
import WDataSyncer from '../src/WDataSyncer.mjs'
import { createRecorder, createGate, createDeferred } from './tools/syncerTraceKit.mjs'


//WDataSyncer之觀察回調(opt.onTrace)
//  P1 以事件同步: 同步點為某一輪同步結束(done, 鎖已釋放), 不以等待毫秒同步
//  P2 斷言語意: 事件之內容與順序, 不斷言次數與時刻
//  P3 預設不變: 未傳onTrace時之對外行為與傳了時相同
//  P4 回調不得影響被測函數: 拋錯、回傳rejection、非函數皆不影響同步結果
describe('syncer_trace', function() {

    let fdTmp = './test/_tmp/syncer_trace'

    after(function() {
        fsDeleteFolder(fdTmp)
    })

    //mkOrm, 記憶體內之來源與目標(by-orm)
    let mkOrm = () => {
        let st = {
            ltdtSrc: [{ id: 'a', value: 1 }, { id: 'b', value: 2 }],
            ltdtTar: [],
            gateSrc: null, //給Promise時src.select會等它落定才回傳
            failSrc: false, //為true時src.select拋錯
        }
        let src = {
            select: async () => {
                if (st.failSrc) {
                    throw new Error('boom')
                }
                if (st.gateSrc) {
                    await st.gateSrc
                }
                return st.ltdtSrc
            },
        }
        let tar = {
            select: async () => st.ltdtTar,
            insert: async (items) => {
                items.forEach((v) => st.ltdtTar.push(v))
            },
            save: async (items) => {
                items.forEach((v) => {
                    let i = st.ltdtTar.findIndex((t) => t.id === v.id)
                    st.ltdtTar[i] = v
                })
            },
            del: async (items) => {
                items.forEach((v) => {
                    let i = st.ltdtTar.findIndex((t) => t.id === v.id)
                    st.ltdtTar.splice(i, 1)
                })
            },
        }
        return { st, src, tar }
    }

    it(`should notify tick, begin, emit(insert, change, change-all) and done in order for the first round`, async function() {
        let { src, tar } = mkOrm()
        let tr = createRecorder()
        let ev = WDataSyncer('by-orm', { src, tar, key: 'id', timeInterval: 5, onTrace: tr.onTrace })
        await tr.next((e) => e.type === 'done' && e.b, 'first sync')
        ev.clear()

        //spec: 計時觸發(tick)後開始一輪(begin), 依序發送insert、change(kind為insert)、change-all, 結束時(done)回報有異動
        assert.strict.deepStrictEqual(tr.events.slice(0, 6), [
            { type: 'tick', n: 1, locked: false },
            { type: 'begin', round: 1 },
            { type: 'emit', round: 1, name: 'insert', kind: null, size: 2 },
            { type: 'emit', round: 1, name: 'change', kind: 'insert', size: 2 },
            { type: 'emit', round: 1, name: 'change-all', kind: null, size: null },
            { type: 'done', round: 1, ok: true, b: true, bErr: false },
        ])
    })

    it(`should notify emit in the order insert, save, del, each followed by its change, then change-all`, async function() {
        let { st, src, tar } = mkOrm()
        let tr = createRecorder()
        let ev = WDataSyncer('by-orm', { src, tar, key: 'id', timeInterval: 5, onTrace: tr.onTrace })
        await tr.next((e) => e.type === 'done' && e.b, 'first sync')

        //來源改為: a修改、b刪除、c新增(同筆數), 於輪結束同一回合寫入, 不與進行中之輪重疊
        st.ltdtSrc = [{ id: 'a', value: 1.5 }, { id: 'c', value: 3 }]
        let eDone = await tr.next((e) => e.type === 'done' && e.b, 'second sync')
        ev.clear()

        let es = tr.events.filter((e) => e.round === eDone.round)
        assert.strict.deepStrictEqual(es, [
            { type: 'begin', round: eDone.round },
            { type: 'emit', round: eDone.round, name: 'insert', kind: null, size: 1 },
            { type: 'emit', round: eDone.round, name: 'change', kind: 'insert', size: 1 },
            { type: 'emit', round: eDone.round, name: 'save', kind: null, size: 1 },
            { type: 'emit', round: eDone.round, name: 'change', kind: 'save', size: 1 },
            { type: 'emit', round: eDone.round, name: 'del', kind: null, size: 1 },
            { type: 'emit', round: eDone.round, name: 'change', kind: 'del', size: 1 },
            { type: 'emit', round: eDone.round, name: 'change-all', kind: null, size: null },
            { type: 'done', round: eDone.round, ok: true, b: true, bErr: false },
        ])
        assert.strict.deepStrictEqual(st.ltdtTar, [{ id: 'a', value: 1.5 }, { id: 'c', value: 3 }])
    })

    it(`should report an idle round as done with b false and emit nothing`, async function() {
        let { src, tar } = mkOrm()
        let tr = createRecorder()
        let ev = WDataSyncer('by-orm', { src, tar, key: 'id', timeInterval: 5, onTrace: tr.onTrace })
        await tr.next((e) => e.type === 'done' && e.b, 'first sync')
        let eIdle = await tr.next((e) => e.type === 'done' && !e.b, 'idle round')
        ev.clear()

        //spec: 無異動之輪不發送任何事件, 以done之b為false回報
        assert.strict.deepStrictEqual(tr.events.filter((e) => e.round === eIdle.round), [
            { type: 'begin', round: eIdle.round },
            { type: 'done', round: eIdle.round, ok: true, b: false, bErr: false },
        ])
    })

    it(`should skip a tick while the previous round is running and notify it as locked`, async function() {
        let { src, tar, st } = mkOrm()
        let gate = createDeferred()
        st.gateSrc = gate.pm
        let tr = createRecorder()
        let ev = WDataSyncer('by-orm', { src, tar, key: 'id', timeInterval: 5, onTrace: tr.onTrace })

        //第1輪卡在src.select, 其間之計時觸發須被跳過(locked)
        await tr.next((e) => e.type === 'tick' && e.locked, 'locked tick 1')
        await tr.next((e) => e.type === 'tick' && e.locked, 'locked tick 2')
        assert.strict.deepStrictEqual(map(tr.events.filter((e) => e.type === 'begin'), 'round'), [1])

        //放行後第1輪才結束, 其間不曾開始第2輪
        gate.open()
        let eDone = await tr.next((e) => e.type === 'done', 'round 1 done')
        assert.strict.deepStrictEqual(eDone, { type: 'done', round: 1, ok: true, b: true, bErr: false })
        let iBegin = tr.events.findIndex((e) => e.type === 'begin')
        let iDone = tr.events.findIndex((e) => e.type === 'done')
        let between = tr.events.slice(iBegin + 1, iDone).filter((e) => e.type === 'begin')
        assert.strict.deepStrictEqual(between, [])

        //每個begin之前一個事件是未locked之tick(跳過者不開始新一輪)
        await tr.next((e) => e.type === 'begin', 'round 2 begin')
        ev.clear()
        tr.events.forEach((e, k) => {
            if (e.type === 'begin') {
                assert.strict.deepStrictEqual(tr.events[k - 1].type, 'tick')
                assert.strict.deepStrictEqual(tr.events[k - 1].locked, false)
            }
        })
    })

    it(`should notify fail before the error event and done with ok false when a round throws, then recover`, async function() {
        let { st, src, tar } = mkOrm()
        st.failSrc = true
        let order = []
        let tr = createRecorder()
        let ev = WDataSyncer('by-orm', {
            src,
            tar,
            key: 'id',
            timeInterval: 5,
            onTrace: (e) => {
                order.push(e.type)
                tr.onTrace(e)
            },
        })
        let gateErr = createGate()
        let errs = []
        ev.on('error', (err) => {
            order.push('error')
            errs.push(err.message)
            gateErr.hit()
        })

        let eFail = await tr.next((e) => e.type === 'fail', 'fail')
        let eDone = await tr.next((e) => e.type === 'done', 'done after fail')
        await gateErr.until(1, 'error event')

        //spec: 出錯時先通知fail(msg為字串), 再發送error事件, 最後done(ok為false)
        assert.strict.deepStrictEqual(order.slice(0, 5), ['tick', 'begin', 'fail', 'error', 'done'])
        assert.strict.deepStrictEqual(eFail, { type: 'fail', round: 1, msg: 'boom' })
        assert.strict.deepStrictEqual(eDone, { type: 'done', round: 1, ok: false, b: false, bErr: false })
        assert.strict.deepStrictEqual(errs[0], 'boom')

        //錯誤不使其後各輪停擺: 恢復後同步成功
        st.failSrc = false
        let eOk = await tr.next((e) => e.type === 'done' && e.ok && e.b, 'recovered sync')
        ev.clear()
        assert.strict.deepStrictEqual(eOk.ok, true)
        assert.strict.deepStrictEqual(st.ltdtTar, [{ id: 'a', value: 1 }, { id: 'b', value: 2 }])
    })

    it(`should report the error flag of the sync function as bErr in done`, async function() {
        let fd = `${fdTmp}/bErr`
        let tr = createRecorder()
        let ev = WDataSyncer('by-1to1', {
            fdSrcStorage: `${fd}/not_exist_src`, //來源資料夾不存在, 同步函數回報bErr
            fdFromStorageTempHash: `${fd}/hash`,
            fdSelfStorage: `${fd}/tar`,
            funGetVfpsSrc: async () => [],
            funProc: async () => {},
            funRemove: async () => {},
            timeInterval: 5,
            onTrace: tr.onTrace,
        })
        let eDone = await tr.next((e) => e.type === 'done', 'first round')
        ev.clear()
        assert.strict.deepStrictEqual(eDone, { type: 'done', round: 1, ok: true, b: false, bErr: true })
    })

    it(`should notify clear once, and not notify anything after clear even when a round is still running`, async function() {
        let { src, tar, st } = mkOrm()
        let gate = createDeferred()
        st.gateSrc = gate.pm
        let tr = createRecorder()
        let ev = WDataSyncer('by-orm', { src, tar, key: 'id', timeInterval: 5, onTrace: tr.onTrace })
        let gateAll = createGate()
        ev.on('change-all', () => gateAll.hit())

        //第1輪進行中clear(重複呼叫只通知一次)
        await tr.next((e) => e.type === 'begin', 'round 1 begin')
        ev.clear()
        ev.clear()
        let nAtClear = tr.events.length
        assert.strict.deepStrictEqual(tr.events[nAtClear - 1], { type: 'clear' })
        assert.strict.deepStrictEqual(tr.events.filter((e) => e.type === 'clear').length, 1)

        //clear不中斷進行中之輪: 放行後仍發送事件(change-all), 但不再通知任何trace
        gate.open()
        await gateAll.until(1, 'change-all after clear')
        await new Promise((resolve) => setImmediate(resolve))
        assert.strict.deepStrictEqual(tr.events.length, nAtClear)
        assert.strict.deepStrictEqual(st.ltdtTar, [{ id: 'a', value: 1 }, { id: 'b', value: 2 }])
    })

    it(`should release the interval timer on clear`, async function() {
        let { src, tar } = mkOrm()
        let nTimer = () => process.getActiveResourcesInfo().filter((s) => s === 'Timeout').length
        let n0 = nTimer()
        let ev = WDataSyncer('by-orm', { src, tar, key: 'id', timeInterval: 5 })
        assert.strict.deepStrictEqual(nTimer(), n0 + 1)
        ev.clear()
        assert.strict.deepStrictEqual(nTimer(), n0)
    })

    it(`should notify frozen events made of primitive values only, without a field named type other than the event type`, async function() {
        let { st, src, tar } = mkOrm()
        st.failSrc = true
        let tr = createRecorder()
        let ev = WDataSyncer('by-orm', { src, tar, key: 'id', timeInterval: 5, onTrace: tr.onTrace })
        await tr.next((e) => e.type === 'fail', 'fail')
        st.failSrc = false
        await tr.next((e) => e.type === 'done' && e.b, 'sync')
        st.ltdtSrc = [{ id: 'a', value: 1.5 }, { id: 'c', value: 3 }]
        await tr.next((e) => e.type === 'done' && e.b, 'sync 2')
        ev.clear()

        let types = new Set(['tick', 'begin', 'emit', 'fail', 'done', 'clear'])
        assert.strict.deepStrictEqual(tr.events.length > 10, true)
        tr.events.forEach((e) => {
            assert.strict.deepStrictEqual(Object.isFrozen(e), true)
            assert.strict.deepStrictEqual(types.has(e.type), true)
            Object.values(e).forEach((v) => {
                assert.strict.deepStrictEqual(v === null || ['string', 'number', 'boolean'].includes(typeof v), true)
            })
        })
    })

    //P3/P4: 同一情境下, 未傳onTrace、傳了紀錄器、拋錯、回傳rejection、非函數, 對外行為(各事件之內容與順序)皆相同
    let runScenario = async (optExtra) => {
        let { st, src, tar } = mkOrm()
        let outs = []
        let gate = createGate()
        let ev = WDataSyncer('by-orm', { src, tar, key: 'id', timeInterval: 5, ...optExtra })
        for (let name of ['insert', 'save', 'del', 'change']) {
            ev.on(name, (data) => {
                outs.push([name, JSON.stringify(data)])
            })
        }
        ev.on('change-all', (r) => {
            outs.push(['change-all', JSON.stringify(r)])
            gate.hit()
        })
        ev.on('error', (err) => {
            outs.push(['error', err.message])
        })
        await gate.until(1, 'first change-all')
        st.ltdtSrc = [{ id: 'a', value: 1.5 }, { id: 'c', value: 3 }]
        await gate.until(2, 'second change-all')
        ev.clear()
        return outs
    }

    let outsExpected = [
        ['insert', '[{"id":"a","value":1},{"id":"b","value":2}]'],
        ['change', '{"type":"insert","items":[{"id":"a","value":1},{"id":"b","value":2}]}'],
        ['change-all', '{"b":true,"del":[],"insert":[{"id":"a","value":1},{"id":"b","value":2}],"same":[],"save":[]}'],
        ['insert', '[{"id":"c","value":3}]'],
        ['change', '{"type":"insert","items":[{"id":"c","value":3}]}'],
        ['save', '[{"id":"a","value":1.5}]'],
        ['change', '{"type":"save","items":[{"id":"a","value":1.5}]}'],
        ['del', '[{"id":"b","value":2}]'],
        ['change', '{"type":"del","items":[{"id":"b","value":2}]}'],
        ['change-all', '{"b":true,"del":[{"id":"b","value":2}],"insert":[{"id":"c","value":3}],"same":[],"save":[{"id":"a","value":1.5}]}'],
    ]

    it(`should behave the same when onTrace is not given`, async function() {
        let outs = await runScenario({})
        assert.strict.deepStrictEqual(outs, outsExpected)
    })

    it(`should behave the same when onTrace is a recorder, and the recorder gets events`, async function() {
        let tr = createRecorder()
        let outs = await runScenario({ onTrace: tr.onTrace })
        assert.strict.deepStrictEqual(outs, outsExpected)
        assert.strict.deepStrictEqual(tr.events.length > 0, true)
    })

    it(`should behave the same when onTrace throws, and the error does not reach the error event`, async function() {
        let nCall = 0
        let outs = await runScenario({
            onTrace: () => {
                nCall++
                throw new Error('trace throws')
            },
        })
        assert.strict.deepStrictEqual(outs, outsExpected)
        assert.strict.deepStrictEqual(nCall > 0, true)
    })

    it(`should behave the same when onTrace returns a rejection, without unhandled rejection`, async function() {
        let errs = []
        let fn = (err) => {
            errs.push(err)
        }
        process.on('unhandledRejection', fn)
        try {
            let nCall = 0
            let outs = await runScenario({
                onTrace: () => {
                    nCall++
                    return Promise.reject(new Error('trace rejects'))
                },
            })
            await new Promise((resolve) => setImmediate(resolve))
            await new Promise((resolve) => setImmediate(resolve))
            assert.strict.deepStrictEqual(outs, outsExpected)
            assert.strict.deepStrictEqual(nCall > 0, true)
            assert.strict.deepStrictEqual(errs, [])
        }
        finally {
            process.off('unhandledRejection', fn)
        }
    })

    it(`should behave the same when onTrace is not a function`, async function() {
        for (let onTrace of ['abc', 123, true, {}, [], null]) {
            let outs = await runScenario({ onTrace })
            assert.strict.deepStrictEqual(outs, outsExpected)
        }
    })

})
