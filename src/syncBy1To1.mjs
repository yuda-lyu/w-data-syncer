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
import getFileName from 'wsemi/src/getFileName.mjs'
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


let syncBy1To1 = async (opt = {}) => {

    //fdSrcStorage, 來源端檔案儲存區
    let fdSrcStorage = get(opt, 'fdSrcStorage')

    //fdFromStorageTempHash, 來源端檔案hash暫存區
    let fdFromStorageTempHash = get(opt, 'fdFromStorageTempHash')
    if (!isestr(fdFromStorageTempHash)) {
        fdFromStorageTempHash = `./_fromStorageTempHash`
    }
    if (!fsIsFolder(fdFromStorageTempHash)) {
        fsCreateFolder(fdFromStorageTempHash)
    }

    //fdSelfStorage, 本地端檔案儲存區
    let fdSelfStorage = get(opt, 'fdSelfStorage')
    if (!isestr(fdSelfStorage)) {
        fdSelfStorage = `./_selfStorage`
    }
    if (!fsIsFolder(fdSelfStorage)) {
        fsCreateFolder(fdSelfStorage)
    }

    //params
    let funGetVfpsSrc = get(opt, 'funGetVfpsSrc')
    let funProc = get(opt, 'funProc')
    let funRemove = get(opt, 'funRemove')
    let funPreEnd = get(opt, 'funPreEnd')

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

    //check
    if (!fsIsFolder(fdSrcStorage)) {
        srLogError({ event: `proc`, msg: `fdSrcStorage[${fdSrcStorage}] does not exist` })
        return {
            ...rr,
            bErr: true,
        }
    }

    //bChange
    let bChange = false

    //bError
    let bError = false

    //r
    let r = null

    try {

        //callFunPreEnd
        let callFunPreEnd = async() => {

            //funPreEnd
            if (isfun(funPreEnd)) {
                srLogInfo({ event: `proc-call-funPreEnd`, msg: 'start...' })

                //funPreEnd
                await funPreEnd()
                    .catch((err) => {
                        srLogError({ event: `proc-call-funPreEnd`, msg: getErrorMessage(err) })
                    })

                srLogInfo({ event: `proc-call-funPreEnd`, msg: 'done' })
            }

        }

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

            //callFunPreEnd
            await callFunPreEnd()
                .catch(() => {})

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

        //相同數據不處理
        // await pmSeries(r.same, async(v) => {
        // })

        await pmSeries(r.add, async(v) => {

            let fn = v.id
            let fpSrc = `${fdSrcStorage}/${fn}`
            let fpTar = `${fdSelfStorage}/${fn}`

            srLogInfo({ event: `proc-add-call-funProc`, fnSrc: fn, fpSrc, fnTar: fn, fpTar, msg: 'start...' })

            //funProc
            let rp = await funProc({ fn, fpSrc, fpTar }, 'add')
                .catch((err) => {
                    srLogError({ event: `proc-add-call-funProc`, fnSrc: fn, fpSrc, fnTar: fn, fpTar, msg: getErrorMessage(err) })
                    bError = true
                })

            if (isestr(get(rp, 'fpSrc'))) {
                fpSrc = get(rp, 'fpSrc')
            }
            if (isestr(get(rp, 'fpTar'))) {
                fpTar = get(rp, 'fpTar')
            }

            srLogInfo({ event: `proc-add-call-funProc`, fnSrc: getFileName(fpSrc), fpSrc, fnTar: getFileName(fpTar), fpTar, msg: 'done' })

        })

        await pmSeries(r.diff, async(v) => {

            let fn = v.id
            let fpSrc = `${fdSrcStorage}/${fn}`
            let fpTar = `${fdSelfStorage}/${fn}`
            // let fpTarOld = `${fdSelfStorageOld}/${fn}`

            srLogInfo({ event: `proc-modify-call-funProc`, fnSrc: fn, fpSrc, fnTar: fn, fpTar, msg: 'start...' })

            //不複製舊檔 fpTar 至 fpTarOld, 因 fpTar 會有改名問題, 若 modify 須提供變更前後檔案, 由呼叫處自行處理

            //funProc
            let rp = await funProc({ fn, fpSrc, fpTar }, 'modify')
                .catch((err) => {
                    srLogError({ event: `proc-modify-call-funProc`, fnSrc: fn, fpSrc, fnTar: fn, fpTar, msg: getErrorMessage(err) })
                    bError = true
                })

            if (isestr(get(rp, 'fpSrc'))) {
                fpSrc = get(rp, 'fpSrc')
            }
            if (isestr(get(rp, 'fpTar'))) {
                fpTar = get(rp, 'fpTar')
            }

            srLogInfo({ event: `proc-modify-call-funProc`, fnSrc: getFileName(fpSrc), fpSrc, fnTar: getFileName(fpTar), fpTar, msg: 'done' })

        })

        await pmSeries(r.del, async(v) => {

            let fn = v.id
            // let fpSrc = `${fdSrcStorage}/${fn}`
            let fpTar = `${fdSelfStorage}/${fn}`

            srLogInfo({ event: `proc-remove-call-funRemove`, fnSrc: '', fpSrc: '', fnTar: fn, fpTar, msg: 'start...' })

            //funRemove
            let rp = await funRemove({ fn, fpSrc: '', fpTar }, 'remove')
                .catch((err) => {
                    srLogError({ event: `proc-remove-call-funRemove`, fnSrc: '', fpSrc: '', fnTar: fn, fpTar, msg: getErrorMessage(err) })
                    bError = true
                })

            if (isestr(get(rp, 'fpTar'))) {
                fpTar = get(rp, 'fpTar')
            }

            srLogInfo({ event: `proc-remove-call-funRemove`, fnSrc: '', fpSrc: '', fnTar: getFileName(fpTar), fpTar, msg: 'done' })

        })

        //callFunPreEnd
        await callFunPreEnd()
            .catch(() => {})

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


export default syncBy1To1
