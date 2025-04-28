import get from 'lodash-es/get.js'
import size from 'lodash-es/size.js'
import evem from 'wsemi/src/evem.mjs'
import isestr from 'wsemi/src/isestr.mjs'
import ispint from 'wsemi/src/ispint.mjs'
import isearr from 'wsemi/src/isearr.mjs'
import cint from 'wsemi/src/cint.mjs'
import arrSort from 'wsemi/src/arrSort.mjs'
import ltdtDiffByKey from 'wsemi/src/ltdtDiffByKey.mjs'


/**
 * 資料單向同步程序
 * @param {Object} src - 資料來源，需提供 select 函數 (async)
 * @param {Object} tar - 資料目標，需提供 select、insert、save、del 函數 (async)
 * @param {Object} opt - 設定物件
 * @param {string} [opt.key='time'] - 用於排序與比對的 key
 * @param {number} [opt.timeInterval=20000] - 同步觸發間隔時間（毫秒），預設每 20 秒執行一次（1 分鐘 3 次）
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
                return
            }

            //ltdtTar
            let ltdtTar = await tar.select()
            // console.log('ltdtTar', ltdtTar)

            //arrSort
            ltdtSrc = arrSort(ltdtSrc, { compareKey: key, localeCompare: true })
            ltdtTar = arrSort(ltdtTar, { compareKey: key, localeCompare: true })

            //排序與建立map比對
            let r = ltdtDiffByKey(ltdtTar, ltdtSrc, key)
            // console.log('ltdtSrc', ltdtSrc)
            // console.log('ltdtTar', ltdtTar)
            // console.log('r', r)

            if (size(r.add) > 0) {
                await tar.insert(r.add)
                ev.emit('insert', r.add)
                ev.emit('change', { type: 'insert', items: r.add })
            }
            if (size(r.diff) > 0) {
                await tar.save(r.diff)
                ev.emit('save', r.diff)
                ev.emit('change', { type: 'save', items: r.diff })
            }
            if (size(r.del) > 0) {
                await tar.del(r.del)
                ev.emit('del', r.del)
                ev.emit('change', { type: 'del', items: r.del })
            }

        }
        catch (err) {
            ev.emit('error', err)
        }
    }

    //timer
    let timer = setInterval(() => {

        //compareAndSync
        // console.log('compareAndSync run...')
        compareAndSync()
            .catch((err) => {
                console.log(err)
            })
            // .finally(() => {
            //     console.log('compareAndSync finish')
            // })

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
