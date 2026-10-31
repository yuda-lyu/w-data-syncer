import get from 'lodash-es/get.js'
import size from 'lodash-es/size.js'
import evem from 'wsemi/src/evem.mjs'
import genPm from 'wsemi/src/genPm.mjs'
import ispint from 'wsemi/src/ispint.mjs'
import isbol from 'wsemi/src/isbol.mjs'
import isfun from 'wsemi/src/isfun.mjs'
import cint from 'wsemi/src/cint.mjs'
import getErrorMessage from 'wsemi/src/getErrorMessage.mjs'
import getTrace from 'wsemi/src/getTrace.mjs'
import syncByOrm from './syncByOrm.mjs'
import syncByBuffer from './syncByBuffer.mjs'
import syncBy1To1 from './syncBy1To1.mjs'
import syncByNTo1 from './syncByNTo1.mjs'


/**
 * 資料單向同步程序
 * @param {String} mode - 同步模式，可選 'by-orm'、'by-buffer'、'by-1to1'、'by-nto1'
 * @param {Object} opt - 設定物件，除下列參數外，其餘設定會傳遞給對應模式的同步函數
 * @param {Object} [opt.src] - mode='by-orm' 時之資料來源，需提供 select 函數 (async)
 * @param {Object} [opt.tar] - mode='by-orm' 時之資料目標，需提供 select、insert、save、del 函數 (async)
 * @param {String} [opt.key='time'] - mode='by-orm' 時用於排序與比對的 key
 * @param {Function} [opt.funGetFiles] - mode='by-buffer' 時取得來源檔案的函數 (async)，呼叫時傳入 (fdDw, opt)，fdDw 為本輪專屬之下載歷史資料夾路徑，其名稱為20碼數字(17碼毫秒時間戳+3碼序號，同一毫秒內序號遞增)，各輪互異不共用，依名稱排序即為各輪順序；同一毫秒內超過1000輪時該輪拋錯。本輪 funGetFiles 拋錯時其 fdDw 為下載未完成之資料夾(無完成狀態檔)，於其後之輪起依名稱與完成狀態檔逐一比對清除，其檔案不會進入儲存區；歷史保留數量 numKeep 只計下載完成之輪(資料夾與完成狀態檔同名皆在)
 * @param {Function} [opt.funGetVfpsSrc] - mode='by-1to1' 或 'by-nto1' 時取得來源檔案清單的函數 (async)
 * @param {Function} [opt.funProc] - mode='by-1to1' 或 'by-nto1' 時處理檔案的函數 (async)
 * @param {Function} [opt.funRemove] - mode='by-1to1' 時移除檔案的函數 (async)
 * @param {Number} [opt.timeInterval=20000] - 同步觸發間隔時間（毫秒），預設每 20 秒執行一次（1 分鐘 3 次）
 * @param {boolean} [opt.waitEmitInsert=false] - 發送 insert（或 add）事件時是否等待監聽器 resolve
 * @param {boolean} [opt.waitEmitSave=false] - 發送 save（或 modify）事件時是否等待監聽器 resolve
 * @param {boolean} [opt.waitDel=false] - 發送 del（或 remove）事件時是否等待監聽器 resolve
 * @param {boolean} [opt.waitEmitChange=false] - 發送 change 事件時是否等待監聽器 resolve
 * @param {boolean} [opt.waitEmitChangeAll=false] - 發送 change-all 事件時是否等待監聽器 resolve
 * @param {Object} [opt.srLog=null] - log 器，需提供 info、error 函數
 * @param {Function} [opt.onTrace=null] - 觀察回調函數，於內部事件發生當下同步呼叫，傳入一個凍結之事件物件 { type, ... }，供測試以事件(而非等待時間)同步與診斷。type 為 'tick' 時為每次計時觸發(含 n 為累計第幾次觸發自 1 起，locked 為上一輪尚未結束而跳過本輪，為 true 時不會有後續 begin)；'begin' 時為一輪同步開始(含 round 為第幾輪自 1 起，只計實際執行之輪，跳過者不計)；'emit' 時為即將發送一個事件(含 round，name 為事件名稱 'insert'、'save'、'del'、'add'、'modify'、'remove'、'change'、'change-all'，kind 為 name 是 'change' 時之 type 否則為 null，size 為該事件 items 筆數，name 是 'change-all' 時為 null)；'fail' 時為一輪同步出錯且即將發送 error 事件(含 round，msg 為錯誤訊息字串，不傳出 Error 物件，請由 error 事件取得)；'done' 時為一輪同步結束且鎖已釋放(含 round，ok 為是否未出錯，b 為該輪是否有異動，bErr 為同步函數是否回報錯誤旗標)；'clear' 時為 clear 被呼叫(僅首次)。clear 後不再通知任何事件，進行中之輪的後續事件亦然。回調不帶接收者呼叫，其拋錯與回傳值(含回傳 Promise 之 rejection)皆忽略，不影響同步，預設 null
 * @returns {EventEmitter} 回傳事件發送器並提供 clear 函數停止同步。mode='by-orm' 可監聽 insert、save、del、change、change-all 事件；mode='by-buffer' 可監聽 change-all 事件；mode='by-1to1' 或 'by-nto1' 可監聽 add、modify、remove、change、change-all 事件；各模式皆可監聽 error 事件
 */
function WDataSyncer(mode, opt = {}) {

    //check
    if (mode !== 'by-orm' && mode !== 'by-buffer' && mode !== 'by-1to1' && mode !== 'by-nto1') {
        throw new Error(`mode must be 'by-orm', 'by-buffer', 'by-1to1' or 'by-nto1'`)
    }

    //timeInterval
    let timeInterval = get(opt, 'timeInterval')
    if (!ispint(timeInterval)) {
        timeInterval = 20000
    }
    timeInterval = cint(timeInterval)

    //waitEmitInsert
    let waitEmitInsert = get(opt, 'waitEmitInsert')
    if (!isbol(waitEmitInsert)) {
        waitEmitInsert = false
    }

    //waitEmitSave
    let waitEmitSave = get(opt, 'waitEmitSave')
    if (!isbol(waitEmitSave)) {
        waitEmitSave = false
    }

    //waitDel
    let waitDel = get(opt, 'waitDel')
    if (!isbol(waitDel)) {
        waitDel = false
    }

    //waitEmitChange
    let waitEmitChange = get(opt, 'waitEmitChange')
    if (!isbol(waitEmitChange)) {
        waitEmitChange = false
    }

    //waitEmitChangeAll
    let waitEmitChangeAll = get(opt, 'waitEmitChangeAll')
    if (!isbol(waitEmitChangeAll)) {
        waitEmitChangeAll = false
    }

    //srLog
    let srLog = get(opt, 'srLog', null)

    //srLogInfo
    let srLogInfo = get(srLog, 'info', null)
    if (isfun(srLogInfo)) {
        srLogInfo = (...args) => {
            return srLog.info(...args)
        }
    }
    else {
        srLogInfo = () => {}
    }

    //srLogError
    let srLogError = get(srLog, 'error', null)
    if (isfun(srLogError)) {
        srLogError = (...args) => {
            return srLog.error(...args)
        }
    }
    else {
        srLogError = () => {}
    }

    //trace, 觀察回調(opt.onTrace), 未給時為null
    let trace = getTrace(opt)

    //cleared, 是否已clear, 供trace於clear後不再通知
    let cleared = false

    //round, info, 目前這一輪之序號與結果, 因有lock故同時只會有一輪, 供trace使用
    let round = 0
    let info = { ok: true, b: false, bErr: false }

    //ev
    let ev = evem()

    //emitWait
    let emitWait = async (name, data, useWait) => {
        if (trace && !cleared) {
            let isChange = name === 'change'
            let items = isChange ? get(data, 'items') : data
            trace('emit', {
                round,
                name,
                kind: isChange ? get(data, 'type', null) : null,
                size: name === 'change-all' ? null : size(items),
            })
        }
        if (useWait) {
            let pm = genPm()
            ev.emit(name, data, pm)
            await pm
                .catch(() => {})
        }
        else {
            ev.emit(name, data)
        }
    }

    //compareAndSync
    let compareAndSync = async () => {

        //r
        let r = null
        if (mode === 'by-orm') {
            let src = get(opt, 'src')
            let tar = get(opt, 'tar')
            r = await syncByOrm(src, tar, opt)
        }
        else if (mode === 'by-buffer') {
            let funGetFiles = get(opt, 'funGetFiles')
            r = await syncByBuffer(funGetFiles, opt)
        }
        else if (mode === 'by-1to1') {
            r = await syncBy1To1(opt)
        }
        else if (mode === 'by-nto1') {
            r = await syncByNTo1(opt)
        }

        //info
        info.b = get(r, 'b') === true
        info.bErr = get(r, 'bErr') === true

        //check, 跳過同步或無異動時不發送事件
        if (!get(r, 'b')) {
            return
        }

        if (mode === 'by-orm') {
            let nInsert = size(r.insert)
            let nSave = size(r.save)
            let nDel = size(r.del)
            if (nInsert > 0) {
                await emitWait('insert', r.insert, waitEmitInsert)
                await emitWait('change', { type: 'insert', items: r.insert }, waitEmitChange)
            }
            if (nSave > 0) {
                await emitWait('save', r.save, waitEmitSave)
                await emitWait('change', { type: 'save', items: r.save }, waitEmitChange)
            }
            if (nDel > 0) {
                await emitWait('del', r.del, waitDel)
                await emitWait('change', { type: 'del', items: r.del }, waitEmitChange)
            }
            await emitWait('change-all', r, waitEmitChangeAll)
        }
        else if (mode === 'by-buffer') {
            await emitWait('change-all', r, waitEmitChangeAll)
        }
        else if (mode === 'by-1to1' || mode === 'by-nto1') {
            let nAdd = size(r.add)
            let nModify = size(r.modify)
            let nRemove = size(r.remove)
            if (nAdd > 0) {
                await emitWait('add', r.add, waitEmitInsert)
                await emitWait('change', { type: 'add', items: r.add }, waitEmitChange)
            }
            if (nModify > 0) {
                await emitWait('modify', r.modify, waitEmitSave)
                await emitWait('change', { type: 'modify', items: r.modify }, waitEmitChange)
            }
            if (nRemove > 0) {
                await emitWait('remove', r.remove, waitDel)
                await emitWait('change', { type: 'remove', items: r.remove }, waitEmitChange)
            }
            await emitWait('change-all', r, waitEmitChangeAll)
        }

    }

    //timer
    let lock = false
    let nTick = 0
    let timer = setInterval(() => {

        //trace
        nTick++
        if (trace && !cleared) {
            trace('tick', { n: nTick, locked: lock })
        }

        //check
        if (lock) {
            srLogInfo({ event: 'compareAndSync', msg: 'locking...' })
            return
        }
        lock = true

        //round, info
        round++
        info = { ok: true, b: false, bErr: false }
        if (trace && !cleared) {
            trace('begin', { round })
        }

        //compareAndSync
        srLogInfo({ event: 'compareAndSync', msg: 'start...' })
        compareAndSync()
            .catch((err) => {
                info.ok = false
                srLogError({ event: 'compareAndSync', msg: getErrorMessage(err) })
                if (trace && !cleared) {
                    trace('fail', { round, msg: getErrorMessage(err) })
                }
                ev.emit('error', err)
            })
            .finally(() => {
                srLogInfo({ event: 'compareAndSync', msg: 'done' })
                lock = false
                if (trace && !cleared) {
                    trace('done', { round, ok: info.ok, b: info.b, bErr: info.bErr })
                }
            })

    }, timeInterval)

    //clear
    let clear = () => {
        if (trace && !cleared) {
            trace('clear', {})
        }
        cleared = true
        clearInterval(timer)
    }

    //save
    ev.clear = clear

    return ev
}


export default WDataSyncer
