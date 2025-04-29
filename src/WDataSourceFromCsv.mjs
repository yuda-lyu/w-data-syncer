import path from 'path'
import fs from 'fs'
import get from 'lodash-es/get.js'
import size from 'lodash-es/size.js'
import join from 'lodash-es/join.js'
import evem from 'wsemi/src/evem.mjs'
import isestr from 'wsemi/src/isestr.mjs'
import fsIsFile from 'wsemi/src/fsIsFile.mjs'
import pmQueue from 'wsemi/src/pmQueue.mjs'
import ltdtDiffByKey from 'wsemi/src/ltdtDiffByKey.mjs'
import fsWatchFolder from 'wsemi/src/fsWatchFolder.mjs'
import wdc from 'w-data-csv/src/WDataCsv.mjs'


/**
 * 檔案CSV來源數據供給器
 * @param {string} fd - 要監控的資料夾路徑
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

    //ev
    let ev = evem()

    //memory
    let memory = new Map()

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

        return ltdt
    }

    //readInsert
    let readInsert = async (fp) => {

        //check
        if (!fsIsFile(fp)) {
            return
        }

        //ltdtNew
        let ltdtNew = await readCsv(fp)
        // console.log('ltdtNew', ltdtNew)

        //fn
        let fn = path.basename(fp)

        //check
        if (memory.has(fn)) {
            throw new Error(`fn[${fn}] existed`)
        }

        //set
        memory.set(fn, ltdtNew)

        //emit
        ev.emit('change', { type: 'insert', ltdt: ltdtNew })

        // return ltdtNew
    }

    //readSave
    let readSave = async (fp) => {

        //check
        if (!fsIsFile(fp)) {
            return
        }

        //ltdtNew
        let ltdtNew = await readCsv(fp)
        // console.log('ltdtNew', ltdtNew)

        //fn
        let fn = path.basename(fp)

        //ltdtOld
        let ltdtOld = memory.get(fn)

        //check
        if (size(ltdtOld) === 0) {
            ev.emit('change', { type: 'insert', ltdt: ltdtOld })
            return
        }

        //ltdtDiffByKey
        let r = ltdtDiffByKey(ltdtOld, ltdtNew, key)
        // console.log('ltdtOld', ltdtOld)
        // console.log('ltdtNew', ltdtNew)
        // console.log('r', r)

        //set
        memory.set(fn, ltdtNew)

        //emit, 此處要針對不同種類數據emit, 不能用else-if
        if (size(r.add) > 0) {
            ev.emit('change', { type: 'insert', ltdt: r.add })
        }
        if (size(r.diff) > 0) {
            ev.emit('change', { type: 'save', ltdt: r.diff })
        }
        if (size(r.del) > 0) {
            ev.emit('change', { type: 'del', ltdt: r.del })
        }

        // return ltdtNew
    }

    //remove
    let remove = async (fp) => {

        //fn
        let fn = path.basename(fp)

        //ltdtOld
        let ltdtOld = memory.get(fn)

        //delete
        memory.delete(fn)

        //emit
        ev.emit('change', { type: 'del', ltdt: ltdtOld })

        // return ltdtOld
    }

    //pmq
    let pmq = pmQueue(1) //同時處理1個

    //watcher
    let watcher = fsWatchFolder(fd)
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
        for (let [, records] of memory.entries()) {
            allData.push(...records)
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
