import get from 'lodash-es/get.js'
import each from 'lodash-es/each.js'
import map from 'lodash-es/map.js'
import filter from 'lodash-es/filter.js'
import keys from 'lodash-es/keys.js'
import size from 'lodash-es/size.js'
import sortBy from 'lodash-es/sortBy.js'
import take from 'lodash-es/take.js'
import takeRight from 'lodash-es/takeRight.js'
import cint from 'wsemi/src/cint.mjs'
import isbol from 'wsemi/src/isbol.mjs'
import isestr from 'wsemi/src/isestr.mjs'
import isfun from 'wsemi/src/isfun.mjs'
import isint from 'wsemi/src/isint.mjs'
import haskey from 'wsemi/src/haskey.mjs'
import now2strp from 'wsemi/src/now2strp.mjs'
import pmSeries from 'wsemi/src/pmSeries.mjs'
import fsIsFile from 'wsemi/src/fsIsFile.mjs'
import fsIsFolder from 'wsemi/src/fsIsFolder.mjs'
import fsCreateFolder from 'wsemi/src/fsCreateFolder.mjs'
import fsCleanFolder from 'wsemi/src/fsCleanFolder.mjs'
import fsDeleteFile from 'wsemi/src/fsDeleteFile.mjs'
import fsDeleteFolder from 'wsemi/src/fsDeleteFolder.mjs'
import fsCopyFile from 'wsemi/src/fsCopyFile.mjs'
import fsSyncFolder from 'wsemi/src/fsSyncFolder.mjs'
import fsTreeFolder from 'wsemi/src/fsTreeFolder.mjs'
import fsWriteText from 'wsemi/src/fsWriteText.mjs'
import fsGetFileBasicHash from 'wsemi/src/fsGetFileBasicHash.mjs'
import ot from 'dayjs'


function fsGetFiles(fd, levelLimit = 1) {
    let vfps = []
    try {
        vfps = fsTreeFolder(fd, levelLimit)
    }
    catch (err) {
        // console.log(err)
    }
    vfps = filter(vfps, { isFolder: false })
    vfps = map(vfps, (v) => {
        delete v.level
        delete v.isFolder
        return v
    })
    return vfps
}


function writeJson(fp, obj, opt = {}) {
    let j = JSON.stringify(obj)
    let rt = fsWriteText(fp, j)
    if (rt.error) {
        throw new Error(rt.error)
    }
}


let syncByBuffer = async (funGetFiles, opt = {}) => {

    //funGetFiles
    if (!isfun(funGetFiles)) {
        throw new Error(`funGetFiles must be a function`)
    }

    //numKeep
    let numKeep = get(opt, 'numKeep', '')
    if (!isint(numKeep)) {
        numKeep = 10
    }
    numKeep = cint(numKeep)
    if (numKeep <= 1) {
        numKeep = 1
    }

    //fdFromStorageTempHists, 來源端檔案下載歷史區
    let fdFromStorageTempHists = get(opt, 'fdFromStorageTempHists')
    if (!isestr(fdFromStorageTempHists)) {
        fdFromStorageTempHists = `./_fromStorageTempHists`
    }
    if (!fsIsFolder(fdFromStorageTempHists)) {
        fsCreateFolder(fdFromStorageTempHists)
    }

    //fdFromStorageTempHistStates, 來源端檔案下載歷史狀態區
    let fdFromStorageTempHistStates = get(opt, 'fdFromStorageTempHistStates')
    if (!isestr(fdFromStorageTempHistStates)) {
        fdFromStorageTempHistStates = `./_fromStorageTempHistStates`
    }
    if (!fsIsFolder(fdFromStorageTempHistStates)) {
        fsCreateFolder(fdFromStorageTempHistStates)
    }

    //fdFromStorageTemp, 來源端檔案暫存區
    let fdFromStorageTemp = get(opt, 'fdFromStorageTemp')
    if (!isestr(fdFromStorageTemp)) {
        fdFromStorageTemp = `./_fromStorageTemp`
    }
    if (!fsIsFolder(fdFromStorageTemp)) {
        fsCreateFolder(fdFromStorageTemp)
    }

    //fdFromStorage, 來源端檔案儲存區
    let fdFromStorage = get(opt, 'fdFromStorage')
    if (!isestr(fdFromStorage)) {
        fdFromStorage = `./_fromStorage`
    }
    if (!fsIsFolder(fdFromStorage)) {
        fsCreateFolder(fdFromStorage)
    }

    //funProcGetFilesBefore
    let funProcGetFilesBefore = get(opt, 'funProcGetFilesBefore', null)

    //funProcGetFilesAfter
    let funProcGetFilesAfter = get(opt, 'funProcGetFilesAfter', null)

    //funSyncStorage
    let funSyncStorage = get(opt, 'funSyncStorage', null)

    //useStorageHash
    let useStorageHash = get(opt, 'useStorageHash')
    if (!isbol(useStorageHash)) {
        useStorageHash = false
    }

    //fdFromStorageHash, 來源端檔案Hash區
    let fdFromStorageHash = get(opt, 'fdFromStorageHash')
    if (!isestr(fdFromStorageHash)) {
        fdFromStorageHash = `./_fromStorageHash`
    }
    if (useStorageHash && !fsIsFolder(fdFromStorageHash)) {
        fsCreateFolder(fdFromStorageHash)
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

    //ts
    let ts = ot()

    srLogInfo({ event: 'proc', msg: 'start...', time: ts.format('YYYY-MM-DDTHH:mm:ssZ') })

    //fdn
    let fdn = now2strp()
    // console.log('fdn', fdn)

    //fdDw
    let fdDw = `${fdFromStorageTempHists}/${fdn}` //此為資料夾
    if (!fsIsFolder(fdDw)) {
        fsCreateFolder(fdDw)
    }

    //vfpsDw
    let vfpsDw = []
    if (true) {
        srLogInfo({ event: `proc-getFiles`, msg: 'start...' })

        //funProcGetFilesBefore
        if (isfun(funProcGetFilesBefore)) {
            srLogInfo({ event: `proc-funProcGetFilesBefore`, msg: 'start...' })
            await funProcGetFilesBefore(fdDw)
            srLogInfo({ event: `proc-funProcGetFilesBefore`, msg: 'done' })
        }

        //funGetFiles
        srLogInfo({ event: `proc-funGetFiles`, msg: 'start...' })
        vfpsDw = await funGetFiles(fdDw, opt)
        srLogInfo({ event: `proc-funGetFiles`, msg: 'done' })

        //funProcGetFilesAfter
        if (isfun(funProcGetFilesAfter)) {
            srLogInfo({ event: `proc-funProcGetFilesAfter`, msg: 'start...' })
            vfpsDw = await funProcGetFilesAfter(fdDw, vfpsDw)
            srLogInfo({ event: `proc-funProcGetFilesAfter`, msg: 'done' })
        }

        srLogInfo({ event: `proc-getFiles`, msg: 'done' })
    }

    //已完成下載時儲存狀態
    if (true) {
        let fp = `${fdFromStorageTempHistStates}/${fdn}` //此為檔案
        fsWriteText(fp, 'done')
    }

    //vfds, vfpsState
    let vfds = []
    let vfpsState = []
    if (true) {
        srLogInfo({ event: `proc-numKeep-fromStorageTempHists`, msg: 'start...' })

        //vfds
        vfds = fsTreeFolder(fdFromStorageTempHists, 1)
        vfds = filter(vfds, { isFolder: true })
        vfds = sortBy(vfds, 'name') //明確依時間戳資料夾名升序, 確保takeRight取到最新numKeep筆與同名檔取最新版, 不依賴readdir平台順序
        // console.log('vfds', vfds, size(vfds))

        //vfpsState
        vfpsState = fsTreeFolder(fdFromStorageTempHistStates, 1)
        vfpsState = filter(vfpsState, { isFolder: false })
        vfpsState = sortBy(vfpsState, 'name') //與vfds同基準升序, 保持兩者對應一致
        // console.log('vfpsState', vfpsState, size(vfpsState))

        //n
        let n = size(vfds)

        //nn
        let nn = size(vfpsState)

        //check
        if (n < nn) {

            //kp, 建置時間資料夾之字典物件
            let kp = {}
            each(vfds, (v) => {
                kp[v.name] = true
            })

            //vfpsState, 僅保留有時間資料夾之完成狀態檔案
            let _vfpsState = []
            each(vfpsState, (v) => {
                if (haskey(kp, v.name)) {
                    _vfpsState.push(v)
                }
                else {
                    fsDeleteFile(v.path)
                }
            })
            vfpsState = _vfpsState

        }
        else if (n > nn) {

            //kp, 建置完成狀態之字典物件
            let kp = {}
            each(vfpsState, (v) => {
                kp[v.name] = true
            })

            //vfds, 僅保留有完成狀態之時間資料夾
            let _vfds = []
            each(vfds, (v) => {
                if (haskey(kp, v.name)) {
                    _vfds.push(v)
                }
                else {
                    fsDeleteFolder(v.path)
                }
            })
            vfds = _vfds

        }

        //m
        let m = 0

        //check
        if (n > numKeep) {

            //m
            m = n - numKeep

            //vfdsDel, vfpsStateDel
            let vfdsDel = take(vfds, m)
            let vfpsStateDel = take(vfpsState, m)
            // console.log('vfdsDel', vfdsDel)
            // console.log('vfpsStateDel', vfpsStateDel)

            //fsDeleteFolder, fsDeleteFile
            each(vfdsDel, (vfdDel) => {
                fsDeleteFolder(vfdDel.path)
            })
            each(vfpsStateDel, (vfpStateDel) => {
                fsDeleteFile(vfpStateDel.path)
            })

            //更新為最近n次下載時間資料夾與完成狀態檔案
            vfds = takeRight(vfds, numKeep)
            vfpsState = takeRight(vfpsState, numKeep)

        }

        srLogInfo({ event: `proc-numKeep-fromStorageTempHists`, numBefore: n, numAfter: m, numKeep, msg: 'done' })
    }

    //kpFile, 儲存指定n筆紀錄內聯集存在之檔案, 且有重複時僅儲存最新版
    let kpFile = {}
    if (true) {
        srLogInfo({ event: `proc-kpFile-fromStorageTempHists`, msg: 'start...' })

        each(vfds, (vfd) => {

            //check
            if (!fsIsFolder(vfd.path)) {
                srLogError({ event: `proc-kpFile-fromStorageTempHists`, msg: `fdp[${vfd.path}] does not exist` })
                return true //跳出換下一個
            }

            //vfpsHash
            let vfpsHash = fsTreeFolder(vfd.path, 1)
            vfpsHash = filter(vfpsHash, { isFolder: false })
            // console.log('vfpsHash', vfpsHash)

            //update kpFile
            each(vfpsHash, (vfpHash) => {
                kpFile[vfpHash.name] = vfpHash.path
            })

        })
        // console.log('kpFile', kpFile)

        //num
        let num = size(keys(kpFile))

        srLogInfo({ event: `proc-kpFile-fromStorageTempHists`, num, msg: 'done' })
    }

    if (true) {
        srLogInfo({ event: `proc-copyFile-fromStorageTempHists-to-fromStorageTemp`, msg: 'start...' })

        //fsCleanFolder
        fsCleanFolder(fdFromStorageTemp)

        //fsCopyFile
        each(kpFile, (fpSrc, name) => {
            let fpTar = `${fdFromStorageTemp}/${name}`
            let rc = fsCopyFile(fpSrc, fpTar)
            if (rc.error) {
                throw new Error(rc.error)
            }
        })

        srLogInfo({ event: `proc-copyFile-fromStorageTempHists-to-fromStorageTemp`, msg: 'done' })
    }

    //bChange
    let bChange = false
    if (isfun(funSyncStorage)) {
        srLogInfo({ event: `proc-funSyncStorage-fromStorageTemp-to-fromStorage`, msg: 'start...' })

        //fsSyncFolder
        bChange = await funSyncStorage(fdFromStorageTemp, fdFromStorage, vfpsDw)

        //check
        if (!isbol(bChange)) {
            throw new Error(`funSyncStorage return value must be boolean`)
        }

        srLogInfo({ event: `proc-funSyncStorage-fromStorageTemp-to-fromStorage`, msg: 'done' })
    }
    else {
        srLogInfo({ event: `proc-syncFolder-fromStorageTemp-to-fromStorage`, msg: 'start...' })

        //fsSyncFolder
        bChange = await fsSyncFolder(fdFromStorageTemp, fdFromStorage)

        srLogInfo({ event: `proc-syncFolder-fromStorageTemp-to-fromStorage`, msg: 'done' })
    }

    //calcHashs
    let calcHashs = async() => {

        //fsGetFiles
        let vfps = fsGetFiles(fdFromStorage, 1)

        //hashs
        let hashs = []
        await pmSeries(vfps, async(v) => {
            let hash = await fsGetFileBasicHash(v.path, { type: 'md5' })
            hashs.push({
                id: v.name,
                hash,
            })
        })

        return hashs
    }

    //寫出hash
    if (useStorageHash) {
        srLogInfo({ event: `proc-calcHash-fromStorage-to-fromStorageHash`, msg: 'start...' })

        //fpHash
        let fpHash = `${fdFromStorageHash}/hash.json`

        //check
        if (!fsIsFile(fpHash) || bChange) {

            //hashs
            let hashs = await calcHashs()

            //writeJson
            writeJson(fpHash, hashs)

        }

        srLogInfo({ event: `proc-calcHash-fromStorage-to-fromStorageHash`, msg: 'done' })
    }

    //te
    let te = ot()
    let s = te.diff(ts, 'second')

    srLogInfo({ event: 'proc', msg: 'done', time: te.format('YYYY-MM-DDTHH:mm:ssZ'), timeSpent: `${s}s` })

    let r = {
        b: bChange,
    }

    return r
}


export default syncByBuffer
