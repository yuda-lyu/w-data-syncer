import get from 'lodash-es/get.js'
import size from 'lodash-es/size.js'
import evem from 'wsemi/src/evem.mjs'
import genPm from 'wsemi/src/genPm.mjs'
import ispint from 'wsemi/src/ispint.mjs'
import isbol from 'wsemi/src/isbol.mjs'
import cint from 'wsemi/src/cint.mjs'
import syncByOrm from './syncByOrm.mjs'


/**
 * 資料單向同步程序
 * @param {Object} src - 資料來源，需提供 select 函數 (async)
 * @param {Object} tar - 資料目標，需提供 select、insert、save、del 函數 (async)
 * @param {Object} opt - 設定物件
 * @param {String} [opt.key='time'] - 用於排序與比對的 key
 * @param {Number} [opt.timeInterval=20000] - 同步觸發間隔時間（毫秒），預設每 20 秒執行一次（1 分鐘 3 次）
 * @param {Object} [opt.srLog=null] - log 器，需提供 info、error 函數
 * @param {boolean} [opt.useShowLog=false] - 是否顯示 log 資訊，未提供 srLog 時以 console.log 顯示
 * @returns {EventEmitter}
 */
function WDataSyncer(src, tar, opt = {}) {

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

    //useShowLog
    let useShowLog = get(opt, 'useShowLog')
    if (!isbol(useShowLog)) {
        useShowLog = false
    }

    //srLog, 未提供時若useShowLog則以console.log顯示
    let srLog = get(opt, 'srLog', null)
    if (!srLog && useShowLog) {
        srLog = {
            info: (o) => console.log(o),
            error: (o) => console.log(o),
        }
    }

    //ev
    let ev = evem()

    //emitWait
    let emitWait = async (name, data, useWait) => {
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

        //syncByOrm
        let r = await syncByOrm(src, tar, { ...opt, srLog })

        //check, 跳過同步時不發送事件
        if (!r) {
            return
        }

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
        if (r.b) {
            await emitWait('change-all', r, waitEmitChangeAll)
        }

    }

    //timer
    let lock = false
    let timer = setInterval(() => {

        //check
        if (lock) {
            if (useShowLog) {
                console.log('locking...')
            }
            return
        }
        lock = true

        //compareAndSync
        if (useShowLog) {
            console.log('compareAndSync...')
        }
        compareAndSync()
            .catch((err) => {
                if (useShowLog) {
                    console.log(err)
                }
                ev.emit('error', err)
            })
            .finally(() => {
                if (useShowLog) {
                    console.log('compareAndSync done')
                }
                lock = false
            })

    }, timeInterval)

    //clear
    let clear = () => {
        clearInterval(timer)
    }

    //save
    ev.clear = clear

    return ev
}


export default WDataSyncer
