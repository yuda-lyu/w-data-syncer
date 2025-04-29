import get from 'lodash-es/get.js'
import size from 'lodash-es/size.js'
import evem from 'wsemi/src/evem.mjs'
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
                console.log('deal...')
            }
            if (size(r.add) > 0) {
                if (useShowLog) {
                    console.log('r.add', r.add[0], size(r.add))
                }
                await tar.insert(r.add)
                ev.emit('insert', r.add)
                ev.emit('change', { type: 'insert', items: r.add })
            }
            if (size(r.diff) > 0) {
                if (useShowLog) {
                    console.log('r.diff', r.diff[0], size(r.diff))
                }
                await tar.save(r.diff)
                ev.emit('save', r.diff)
                ev.emit('change', { type: 'save', items: r.diff })
            }
            if (size(r.del) > 0) {
                if (useShowLog) {
                    console.log('r.del', r.del[0], size(r.del))
                }
                await tar.del(r.del)
                ev.emit('del', r.del)
                ev.emit('change', { type: 'del', items: r.del })
            }
            if (useShowLog) {
                console.log('deal done')
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
    let timer = setInterval(() => {

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
