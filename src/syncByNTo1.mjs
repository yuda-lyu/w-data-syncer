import get from 'lodash-es/get.js'
import size from 'lodash-es/size.js'
import isEqual from 'lodash-es/isEqual.js'
import isestr from 'wsemi/src/isestr.mjs'
import iseobj from 'wsemi/src/iseobj.mjs'
import isfun from 'wsemi/src/isfun.mjs'
import fsIsFile from 'wsemi/src/fsIsFile.mjs'
import fsIsFolder from 'wsemi/src/fsIsFolder.mjs'
import fsCreateFolder from 'wsemi/src/fsCreateFolder.mjs'
import pmSeries from 'wsemi/src/pmSeries.mjs'
import fsGetFileBasicHash from 'wsemi/src/fsGetFileBasicHash.mjs'
import ltdtDiffByKey from 'wsemi/src/ltdtDiffByKey.mjs'
import getErrorMessage from 'wsemi/src/getErrorMessage.mjs'
import fsReadText from 'wsemi/src/fsReadText.mjs'
import fsWriteText from 'wsemi/src/fsWriteText.mjs'
import ot from 'dayjs'


function readJson(fp) {
    let rt = fsReadText(fp)
    if (rt.error) {
        throw new Error(rt.error)
    }
    return JSON.parse(rt.success)
}


function writeJson(fp, obj, opt = {}) {
    let j = JSON.stringify(obj)
    let rt = fsWriteText(fp, j)
    if (rt.error) {
        throw new Error(rt.error)
    }
}


let syncByNTo1 = async (opt = {}) => {

    //fdFromStorageTempHash, 來源端檔案hash暫存區
    let fdFromStorageTempHash = get(opt, 'fdFromStorageTempHash')
    if (!isestr(fdFromStorageTempHash)) {
        fdFromStorageTempHash = `./_fromStorageTempHash`
    }
    if (!fsIsFolder(fdFromStorageTempHash)) {
        fsCreateFolder(fdFromStorageTempHash)
    }

    //params
    let funGetVfpsSrc = get(opt, 'funGetVfpsSrc')
    let funProc = get(opt, 'funProc')

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

    //ts
    let ts = ot()

    srLogInfo({ event: 'proc', msg: 'start...', time: ts.format('YYYY-MM-DDTHH:mm:ssZ') })

    //rr
    let rr = {
        b: false,
        bErr: false,
    }

    //bChange
    let bChange = false

    //bError
    let bError = false

    //r
    let r = null

    try {

        //fpHash
        let fpHash = `${fdFromStorageTempHash}/hash.json`

        //hashsOld
        let hashsOld = []

        //check
        if (fsIsFile(fpHash)) {
            hashsOld = readJson(fpHash)
        }

        //vfps
        let vfps = await funGetVfpsSrc()

        //hashsNew
        let hashsNew = []
        await pmSeries(vfps, async(v) => {
            let hash = await fsGetFileBasicHash(v.path, { type: 'md5' })
            hashsNew.push({
                id: v.name,
                hash,
            })
        })

        //check
        if (isEqual(hashsNew, hashsOld)) {
            srLogInfo({ event: `proc`, msg: `all file hashes unchanged, skip` })
            return rr
        }

        //ltdtDiffByKey
        r = ltdtDiffByKey(hashsOld, hashsNew, 'id', { withInfor: false })
        // console.log('ltdtDiffByKey', r)
        //   del: [ {...} ],
        //   add: [ {...} ],
        //   same: [ {...} ],
        //   diff: [ {...} ],
        let numDel = size(r.del)
        let numAdd = size(r.add)
        let numDiff = size(r.diff)
        let numSame = size(r.same)
        srLogInfo({ event: `proc-ltdtDiffByKey`, numAdd, numDiff, numDel, numSame, msg: 'done' })

        //bChange
        bChange = numAdd > 0 || numDiff > 0 || numDel > 0

        srLogInfo({ event: `proc-modify-call-funProc`, msg: 'start...' })

        //funProc
        await funProc(r)
            .catch((err) => {
                srLogError({ event: `proc-modify-call-funProc`, msg: getErrorMessage(err) })
                bError = true
            })

        srLogInfo({ event: `proc-modify-call-funProc`, msg: 'done' })

        //check
        if (bError) {
            srLogInfo({ event: `proc`, msg: `an error occurred, skip updating hash` })
        }
        else {

            //writeJson
            writeJson(fpHash, hashsNew)

        }

    }
    catch (err) {
        srLogError({ event: `proc`, msg: getErrorMessage(err) })
        bError = true
    }

    //te
    let te = ot()
    let s = te.diff(ts, 'second')

    srLogInfo({ event: 'proc', msg: 'done', time: te.format('YYYY-MM-DDTHH:mm:ssZ'), timeSpent: `${s}s` })

    //rr
    rr = {
        b: bChange,
        bErr: bError,
    }
    if (iseobj(r)) {
        rr = {
            ...rr,
            add: r.add,
            modify: r.diff,
            remove: r.del,
            same: r.same,
        }
    }

    return rr
}


export default syncByNTo1
