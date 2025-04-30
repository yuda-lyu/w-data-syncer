import get from 'lodash-es/get.js'
import map from 'lodash-es/map.js'
import size from 'lodash-es/size.js'
import evem from 'wsemi/src/evem.mjs'
import genPm from 'wsemi/src/genPm.mjs'
import isestr from 'wsemi/src/isestr.mjs'
import ispint from 'wsemi/src/ispint.mjs'
import isearr from 'wsemi/src/isearr.mjs'
import isbol from 'wsemi/src/isbol.mjs'
import cint from 'wsemi/src/cint.mjs'
import arrSort from 'wsemi/src/arrSort.mjs'
import ltdtDiffByKey from 'wsemi/src/ltdtDiffByKey.mjs'


/**
 * 資料單向同步程序
 * @param {Object} src - 資料來源，需提供 select 函數 (async)
 * @param {Object} tar - 資料目標，需提供 select、insert、save、del 函數 (async)
 * @param {Object} opt - 設定物件
 * @param {String} [opt.key='time'] - 用於排序與比對的 key
 * @param {Number} [opt.timeInterval=20000] - 同步觸發間隔時間（毫秒），預設每 20 秒執行一次（1 分鐘 3 次）
 * @param {boolean} [opt.useShowLog=false] - 是否顯示 log 資訊
 * @returns {EventEmitter}
 */
function WDataSyncer(src, tar, opt = {}) {

    //key
    let key = get(opt, 'key')
    if (!isestr(key)) {
        key = 'time'
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

    //useShowLog
    let useShowLog = get(opt, 'useShowLog')
    if (!isbol(useShowLog)) {
        useShowLog = false
    }

    //ev
    let ev = evem()

    //compareAndSync
    let compareAndSync = async () => {
        try {

            //ltdtSrc
            let ltdtSrc = await src.select()
            // console.log('ltdtSrc', ltdtSrc)

            //check
            if (!isearr(ltdtSrc)) {
                if (useShowLog) {
                    console.log(`no src, skip and waiting...`)
                }
                return
            }

            //ltdtTar
            let ltdtTar = await tar.select()
            // console.log('ltdtTar', ltdtTar)

            //check
            if (size(ltdtSrc) < size(ltdtTar)) {
                if (useShowLog) {
                    console.log(`numSrc[${size(ltdtSrc)}] < numTar[${size(ltdtTar)}], skip and waiting...`)
                }
                return
            }
            if (useShowLog) {
                console.log(`size(ltdtSrc)`, size(ltdtSrc))
                console.log(`size(ltdtTar)`, size(ltdtTar))
            }

            //arrSort
            if (useShowLog) {
                console.log('arrSort...')
            }
            ltdtSrc = arrSort(ltdtSrc, { compareKey: key, localeCompare: true })
            ltdtTar = arrSort(ltdtTar, { compareKey: key, localeCompare: true })
            if (useShowLog) {
                console.log('arrSort done')
            }

            //排序與建立map比對
            if (useShowLog) {
                console.log('ltdtDiffByKey...')
            }
            let r = ltdtDiffByKey(ltdtTar, ltdtSrc, key, { withInfor: false })
            if (useShowLog) {
                console.log('ltdtDiffByKey done')
            }
            // console.log('r', r)

            if (useShowLog) {
                console.log('operate and emit...')
            }
            if (size(r.add) > 0) {
                if (useShowLog) {
                    console.log('r.add', map(r.add, key), size(r.add))
                }
                await tar.insert(r.add)

                if (waitEmitInsert) {
                    let pm = genPm()
                    ev.emit('insert', r.add, pm)
                    await pm
                        .catch(() => {})
                }
                else {
                    ev.emit('insert', r.add)
                }

                if (waitEmitChange) {
                    let pm = genPm()
                    ev.emit('change', { type: 'insert', items: r.add }, pm)
                    await pm
                        .catch(() => {})
                }
                else {
                    ev.emit('change', { type: 'insert', items: r.add })
                }

            }
            if (size(r.diff) > 0) {
                if (useShowLog) {
                    console.log('r.diff', map(r.diff, key), size(r.diff))
                }
                await tar.save(r.diff)

                if (waitEmitSave) {
                    let pm = genPm()
                    ev.emit('save', r.diff, pm)
                    await pm
                        .catch(() => {})
                }
                else {
                    ev.emit('save', r.diff)
                }

                if (waitEmitChange) {
                    let pm = genPm()
                    ev.emit('change', { type: 'save', items: r.diff }, pm)
                    await pm
                        .catch(() => {})
                }
                else {
                    ev.emit('change', { type: 'save', items: r.diff })
                }

            }
            if (size(r.del) > 0) {
                if (useShowLog) {
                    console.log('r.del', map(r.del, key), size(r.del))
                }
                await tar.del(r.del)

                if (waitDel) {
                    let pm = genPm()
                    ev.emit('del', r.del, pm)
                    await pm
                        .catch(() => {})
                }
                else {
                    ev.emit('del', r.del)
                }

                if (waitEmitChange) {
                    let pm = genPm()
                    ev.emit('change', { type: 'del', items: r.del }, pm)
                    await pm
                        .catch(() => {})
                }
                else {
                    ev.emit('change', { type: 'del', items: r.del })
                }

            }
            if (useShowLog) {
                console.log('operate and emit done')
            }

        }
        catch (err) {
            if (useShowLog) {
                console.log(err)
            }
            ev.emit('error', err)
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
