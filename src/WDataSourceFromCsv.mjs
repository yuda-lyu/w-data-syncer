import path from 'path'
import fs from 'fs'
import get from 'lodash-es/get.js'
import each from 'lodash-es/each.js'
import map from 'lodash-es/map.js'
import filter from 'lodash-es/filter.js'
import every from 'lodash-es/every.js'
import trim from 'lodash-es/trim.js'
import keys from 'lodash-es/keys.js'
import size from 'lodash-es/size.js'
import join from 'lodash-es/join.js'
import evem from 'wsemi/src/evem.mjs'
import isestr from 'wsemi/src/isestr.mjs'
import isstr from 'wsemi/src/isstr.mjs'
import isfun from 'wsemi/src/isfun.mjs'
import ispm from 'wsemi/src/ispm.mjs'
import fsIsFile from 'wsemi/src/fsIsFile.mjs'
import pmQueue from 'wsemi/src/pmQueue.mjs'
import ltdtDiffByKey from 'wsemi/src/ltdtDiffByKey.mjs'
import fsWatchFolder from 'wsemi/src/fsWatchFolder.mjs'
import wdc from 'w-data-csv/src/WDataCsv.mjs'


/**
 * 檔案CSV來源數據供給器
 *
 * 資料列處理：解析CSV後先剔除空列(無欄位，或全部欄位皆為空白字串，如空行、只有逗號之行、只有空白之行；只要有任一欄位非空白即保留)，其餘列不動。記憶體只存可比對之資料：首次載入(及舊側無資料之存檔)時，新資料須先通過與 wsemi ltdtDiffByKey 相同之檢測(各列須為物件且有key欄位，key值須為非空字串或有限數字，同一檔內key不得重複)，不符則不寫入記憶體、不送出insert(壞資料不進記憶體，亦不送到下游)，錯誤以console.log記錄，檔案修正後之下一次變更視同首次載入，以insert送出全部。檔案內容變更時以key對記憶體內該檔之舊資料比對(同上檢測，不符即拋錯)，比對與轉換(converter)皆成功後才更新記憶體並送出change事件；任一步拋錯時記憶體維持舊資料(錯誤以console.log記錄，不送出change事件)，檔案修正後之下一次變更會對舊資料比對，不遺失。
 * @param {string} fd - 要監控的資料夾路徑
 * @param {Object} [opt={}] - 設定物件
 * @param {Array} [opt.heads=[]] - CSV 檔案無標題列時使用之欄位名稱陣列
 * @param {String} [opt.key='time'] - 用於比對新舊數據的 key，其值於同一檔內須為非空字串且不得重複
 * @param {Function} [opt.converter] - 轉換函數，輸入 ltdt 回傳轉換後之 ltdt(可為 async)
 * @param {Function} [opt.onTrace=null] - 觀察回調函數，原樣轉交給監看資料夾之 wsemi fsWatchFolder 的 opt.onTrace，故事件與其相同：於內部事件發生當下同步呼叫，傳入一個凍結之事件物件 { type, ... }，供測試以事件(而非等待時間)同步與診斷。type 為 'tick' 時為每次週期輪詢(含 watching 為是否已有 watcher、exists 為監看路徑目前是否為資料夾)；'watch' 時為 chokidar 之 watcher 剛建立；'ready' 時為 chokidar 初始掃描完成(此後新增之檔案才會被偵測)；'emit' 時為偵測到一個檔案事件(含 kind 為 add、change、unlink、addDir、unlinkDir，fp 為路徑，src 為 'watcher' 或 'timer')；'error' 時為 watcher 自身出錯；'unwatch' 時為開始關閉 watcher；'closed' 時為 watcher 已關閉；'clear' 時為 clear 被呼叫(僅首次)。回調不帶接收者呼叫，其拋錯與回傳值(含回傳 Promise 之 rejection)皆忽略，不影響偵測，預設 null
 * @returns {EventEmitter} - 具有 select 方法的事件發射器
 */
function WDataSourceFromCsv(fd, opt = {}) {

    //heads
    let heads = get(opt, 'heads', [])

    //chead
    let chead = ''
    if (size(heads) > 0) {
        chead = join(heads, ',')
    }

    //key
    let key = get(opt, 'key')
    if (!isestr(key)) {
        key = 'time'
    }

    //converter
    let converter = get(opt, 'converter')
    if (!isfun(converter)) {
        converter = (ltdt) => {
            return ltdt
        }
    }

    //getLtdtFmt
    let getLtdtFmt = async(ltdt) => {
        let ltdtFmt = []
        if (true) {
            ltdtFmt = converter(ltdt)
            if (ispm(ltdtFmt)) {
                ltdtFmt = await ltdtFmt
            }
        }
        return ltdtFmt
    }

    //ev
    let ev = evem()

    //memory
    let memory = new Map()

    //isBlankRow, 是否為空列: 無欄位, 或全部欄位皆為空白字串(空字串或只有空白), 如CSV之空行({})、只有逗號之行({ id: '', v: '' })、只有空白之行({ id: '   ' })
    let isBlankRow = (dt) => {
        return every(dt, (v) => {
            return isstr(v) && trim(v) === ''
        })
    }

    //readCsv
    let readCsv = async (fp) => {

        //c
        let c = fs.readFileSync(fp, 'utf8')
        if (isestr(chead)) {
            c = chead + '\n' + c
        }
        // console.log('c', c)

        //ltdt
        let ltdt = await wdc.parseCsv(c)
        // console.log('ltdt', ltdt)

        //剔除空列, ltdtDiffByKey遇主鍵值為空或缺少之列會拋錯, 空行等不是資料, 須於解析時先剔除, 不由比對函數放寬
        ltdt = filter(ltdt, (dt) => {
            return !isBlankRow(dt)
        })

        //偵測是否有無head欄位
        if (true) {
            let ks = keys(get(ltdt, 0))
            if (size(ks) !== size(heads)) {
                ltdt = map(ltdt, (dt) => {
                    let _dt = {}
                    each(heads, (k) => {
                        _dt[k] = get(dt, k, '')
                    })
                    return _dt
                })
            }
        }

        return ltdt
    }

    //load, 首次載入(該檔於記憶體尚無資料): 驗證新資料→轉換→更新記憶體→emit insert, readInsert與readSave(舊側無資料, 或該檔尚未載入成功)共用
    let load = async (fn, ltdtNew) => {

        //驗證, 記憶體只存可比對之資料: 新資料須先通過與ltdtDiffByKey相同之檢測(列須為物件且有key欄位, key值須為非空字串或有限數字, 同一檔內key不得重複), 不符即拋錯, 不更新記憶體也不emit insert(壞資料不進記憶體, 亦不以insert送到下游), 由呼叫端之.catch記錄錯誤.
        //以空陣列為舊側呼叫ltdtDiffByKey, 只取其檢測, 不使用其結果
        ltdtDiffByKey([], ltdtNew, key, { withInfor: false })

        //ltdtFmt
        let ltdtFmt = await getLtdtFmt(ltdtNew)

        //set, 要先set才能emit
        memory.set(fn, {
            ltdt: ltdtNew,
            ltdtFmt,
        })

        //emit
        ev.emit('change', { type: 'insert', ltdt: ltdtNew, ltdtFmt })

    }

    //readInsert
    let readInsert = async (fp) => {

        //check
        if (!fsIsFile(fp)) {
            return
        }

        //fn
        let fn = path.basename(fp)
        // console.log('fn', fn)

        //check
        if (memory.has(fn)) {
            throw new Error(`fn[${fn}] existed`)
        }

        //ltdtNew
        let ltdtNew = await readCsv(fp)
        // console.log('ltdtNew', ltdtNew)

        //load
        await load(fn, ltdtNew)

        // return ltdtNew
    }

    //readSave
    let readSave = async (fp) => {

        //check
        if (!fsIsFile(fp)) {
            return
        }

        //fn
        let fn = path.basename(fp)
        // console.log('fn', fn)

        //ltdtNew
        let ltdtNew = await readCsv(fp)
        // console.log('ltdtNew', ltdtNew)

        //ltdtOld, 記憶體無此檔(首次載入失敗, 如資料不可比對或轉換拋錯, 未進記憶體)時為undefined
        let ltdtOld = get(memory.get(fn), 'ltdt')
        // console.log('ltdtOld', ltdtOld)

        //check, 舊側無資料(含該檔尚未載入成功)視同首次載入, 先驗證新資料, 通過才更新記憶體並以insert送出全部
        if (size(ltdtOld) === 0) {
            await load(fn, ltdtNew)
            return
        }

        //ltdtDiffByKey, 須先比對, 比對成功後才更新記憶體, 否則比對拋錯(如新資料含重複主鍵)時記憶體已是新資料, 該次變更永遠不會送出; 比對拋錯時記憶體維持舊資料(舊資料必可比對: 進記憶體者皆已通過比對或load之驗證), 待檔案修正後之下一次變更再與舊資料比對
        let r = ltdtDiffByKey(ltdtOld, ltdtNew, key)
        // console.log('ltdtOld', ltdtOld)
        // console.log('ltdtNew', ltdtNew)
        // console.log('r', r)

        //ltdtFmt
        let ltdtFmt = await getLtdtFmt(ltdtNew)
        // console.log('ltdtFmt', ltdtFmt)

        //轉換, 須於更新記憶體前全部完成, 轉換拋錯時記憶體同樣維持舊資料
        let ltdtAddFmt = null
        let ltdtDiffFmt = null
        let ltdtDelFmt = null
        if (size(r.add) > 0) {
            ltdtAddFmt = await getLtdtFmt(r.add)
        }
        if (size(r.diff) > 0) {
            ltdtDiffFmt = await getLtdtFmt(r.diff)
        }
        if (size(r.del) > 0) {
            ltdtDelFmt = await getLtdtFmt(r.del)
        }

        //set, 比對與轉換皆成功後才更新記憶體, 且要先set才能emit
        memory.set(fn, {
            ltdt: ltdtNew,
            ltdtFmt,
        })

        //emit, 此處要針對不同種類數據emit, 不能用else-if
        if (size(r.add) > 0) {
            ev.emit('change', { type: 'insert', ltdt: r.add, ltdtFmt: ltdtAddFmt })
        }
        if (size(r.diff) > 0) {
            ev.emit('change', { type: 'save', ltdt: r.diff, ltdtFmt: ltdtDiffFmt })
        }
        if (size(r.del) > 0) {
            ev.emit('change', { type: 'del', ltdt: r.del, ltdtFmt: ltdtDelFmt })
        }

        // return ltdtNew
    }

    //remove
    let remove = async (fp) => {

        //fn
        let fn = path.basename(fp)

        //check, 該檔未進記憶體(首次載入失敗, 如資料不可比對, 下游從未收到其資料)則無資料可送出del
        if (!memory.has(fn)) {
            return
        }

        //ltdtOld
        let { ltdt: ltdtOld, ltdtFmt } = memory.get(fn)
        // console.log('ltdtOld', ltdtOld)

        //delete
        memory.delete(fn)

        //emit
        ev.emit('change', { type: 'del', ltdt: ltdtOld, ltdtFmt })

        // return ltdtOld
    }

    //pmq
    let pmq = pmQueue(1) //同時處理1個

    //watcher
    let watcher = fsWatchFolder(fd, { onTrace: get(opt, 'onTrace') })
    watcher.on('change', async(msg) => {
        // console.log(msg.type, msg.fp)
        if (msg.type === 'add') {
            // console.log('push q readInsert')
            pmq(readInsert, msg.fp)
                // .then(function(res) {
                //     console.log('readInsert then', res)
                // })
                .catch(function(err) {
                    console.log('readInsert catch', err)
                })
        }
        else if (msg.type === 'change') {
            // console.log('push q readSave')
            pmq(readSave, msg.fp)
                // .then(function(res) {
                //     console.log('readSave then', res)
                // })
                .catch(function(err) {
                    console.log('readSave catch', err)
                })
        }
        else if (msg.type === 'unlink') {
            // console.log('push q remove')
            pmq(remove, msg.fp)
                // .then(function(res) {
                //     console.log('remove then', res)
                // })
                .catch(function(err) {
                    console.log('remove catch', err)
                })
        }
    })

    //select
    let select = async () => {
        let allData = []
        for (let [, r] of memory.entries()) {
            allData.push(...r.ltdtFmt)
        }
        // console.log('select', allData)
        return allData
    }

    //clear
    let clear = () => {
        watcher.clear()
    }

    //save
    ev.select = select
    ev.clear = clear

    return ev
}


export default WDataSourceFromCsv
