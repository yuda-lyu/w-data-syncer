import get from 'lodash-es/get.js'
import each from 'lodash-es/each.js'
import map from 'lodash-es/map.js'
import size from 'lodash-es/size.js'
import sortBy from 'lodash-es/sortBy.js'
import isestr from 'wsemi/src/isestr.mjs'
import isearr from 'wsemi/src/isearr.mjs'
import isfun from 'wsemi/src/isfun.mjs'
import haskey from 'wsemi/src/haskey.mjs'
import ltdtDiffByKey from 'wsemi/src/ltdtDiffByKey.mjs'


/**
 * 資料單向同步一次
 * @param {Object} src - 資料來源，需提供 select 函數 (async)
 * @param {Object} tar - 資料目標，需提供 select、insert、save、del 函數 (async)
 * @param {Object} opt - 設定物件
 * @param {String} [opt.key='time'] - 用於排序與比對的 key
 * @param {Object} [opt.srLog=null] - log 器，需提供 info、error 函數
 * @returns {Promise} 回傳分類結果物件 { b, insert, save, del, same }，b 代表是否有異動，來源無資料或筆數少於目標時跳過並回傳 null
 */
async function syncByOrm(src, tar, opt = {}) {

    //key
    let key = get(opt, 'key')
    if (!isestr(key)) {
        key = 'time'
    }

    //srLog
    let srLog = get(opt, 'srLog', null)

    //srLogInfo
    let srLogInfo = get(srLog, 'info', null)
    if (!isfun(srLogInfo)) {
        srLogInfo = () => {}
    }

    //srLogError
    let srLogError = get(srLog, 'error', null)
    if (!isfun(srLogError)) {
        srLogError = () => {}
    }

    //ltdtSrc
    srLogInfo({ event: `syncByOrm-selectSrc`, msg: 'start...' })
    let ltdtSrc = await src.select()
    srLogInfo({ event: `syncByOrm-selectSrc`, msg: 'done' })
    // console.log('ltdtSrc', ltdtSrc)

    //check
    if (!isearr(ltdtSrc)) {
        srLogInfo({ event: `syncByOrm-selectSrc`, msg: 'no src, skip and waiting...' })
        return null
    }

    //ltdtTar
    srLogInfo({ event: `syncByOrm-selectTar`, msg: 'start...' })
    let ltdtTar = await tar.select()
    srLogInfo({ event: `syncByOrm-selectTar`, msg: 'done' })
    // console.log('ltdtTar', ltdtTar)

    //check
    if (size(ltdtSrc) < size(ltdtTar)) {
        srLogInfo({ event: `syncByOrm-check`, msg: `numSrc[${size(ltdtSrc)}] < numTar[${size(ltdtTar)}], skip and waiting...` })
        return null
    }
    srLogInfo({ event: `syncByOrm-check`, numSrc: size(ltdtSrc), numTar: size(ltdtTar), msg: 'done' })

    //sortBy
    srLogInfo({ event: `syncByOrm-sortBy`, msg: 'start...' })
    ltdtSrc = sortBy(ltdtSrc, key)
    ltdtTar = sortBy(ltdtTar, key)
    srLogInfo({ event: `syncByOrm-sortBy`, msg: 'done' })

    //排序與建立map比對
    srLogInfo({ event: `syncByOrm-ltdtDiffByKey`, msg: 'start...' })
    let r = ltdtDiffByKey(ltdtTar, ltdtSrc, key, { withInfor: false })
    srLogInfo({ event: `syncByOrm-ltdtDiffByKey`, msg: 'done' })
    // console.log('r', r)

    let nAdd = size(r.add)
    let nDiff = size(r.diff)
    let nDel = size(r.del)

    let bChange = nAdd > 0 || nDiff > 0 || nDel > 0

    //insert
    if (nAdd > 0) {
        srLogInfo({ event: `syncByOrm-insert`, keys: map(r.add, key), num: nAdd, msg: 'start...' })
        await tar.insert(r.add)
        srLogInfo({ event: `syncByOrm-insert`, msg: 'done' })
    }

    //save
    if (nDiff > 0) {
        srLogInfo({ event: `syncByOrm-save`, keys: map(r.diff, key), num: nDiff, msg: 'start...' })
        await tar.save(r.diff)
        srLogInfo({ event: `syncByOrm-save`, msg: 'done' })
    }

    //del
    if (nDel > 0) {
        srLogInfo({ event: `syncByOrm-del`, keys: map(r.del, key), num: nDel, msg: 'start...' })
        await tar.del(r.del)
        srLogInfo({ event: `syncByOrm-del`, msg: 'done' })
    }

    //更改type
    if (true) {
        let kp = {
            add: 'insert',
            diff: 'save',
            del: 'del',
            same: 'same',
        }
        let _r = {
            b: bChange,
        }
        each(r, (ltdt, type) => {
            if (haskey(kp, type)) {
                type = kp[type]
            }
            else {
                srLogError({ event: `syncByOrm-renameType`, msg: `invalid type[${type}]` })
                throw new Error(`invalid type[${type}]`)
            }
            _r[type] = ltdt
        })
        r = _r
    }

    return r
}


export default syncByOrm
