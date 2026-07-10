import assert from 'assert'
import fs from 'fs'
import map from 'lodash-es/map.js'
import filter from 'lodash-es/filter.js'
import sortBy from 'lodash-es/sortBy.js'
import fsTreeFolder from 'wsemi/src/fsTreeFolder.mjs'
import fsCreateFolder from 'wsemi/src/fsCreateFolder.mjs'
import fsCleanFolder from 'wsemi/src/fsCleanFolder.mjs'
import fsDeleteFolder from 'wsemi/src/fsDeleteFolder.mjs'
import fsCopyFile from 'wsemi/src/fsCopyFile.mjs'
import syncByBuffer from '../src/syncByBuffer.mjs'


describe('sync-buffer', function() {

    let fdSrc = './_test_sync_buffer_src'
    let fdHists = './_test_sync_buffer_hists'
    let fdHistStates = './_test_sync_buffer_histstates'
    let fdTemp = './_test_sync_buffer_temp'
    let fdStorage = './_test_sync_buffer_storage'

    let clean = () => {
        fsDeleteFolder(fdSrc)
        fsDeleteFolder(fdHists)
        fsDeleteFolder(fdHistStates)
        fsDeleteFolder(fdTemp)
        fsDeleteFolder(fdStorage)
    }

    let snapshot = (fd) => {
        let vfps = filter(fsTreeFolder(fd, 1), { isFolder: false })
        vfps = sortBy(vfps, 'name')
        return map(vfps, (v) => `${v.name}=${fs.readFileSync(v.path, 'utf8')}`).join(', ')
    }

    let test = async () => {
        let ms = []

        clean()
        fsCreateFolder(fdSrc)

        //funGetFiles, 清空下載資料夾後複製來源檔案
        let funGetFiles = async (fdDw) => {
            fsCleanFolder(fdDw)
            let vfps = filter(fsTreeFolder(fdSrc, 1), { isFolder: false })
            vfps.forEach((v) => {
                fsCopyFile(v.path, `${fdDw}/${v.name}`)
            })
            return vfps
        }

        let opt = {
            numKeep: 1,
            fdFromStorageTempHists: fdHists,
            fdFromStorageTempHistStates: fdHistStates,
            fdFromStorageTemp: fdTemp,
            fdFromStorage: fdStorage,
        }

        //首次同步
        fs.writeFileSync(`${fdSrc}/a.txt`, 'A1', 'utf8')
        fs.writeFileSync(`${fdSrc}/b.txt`, 'B1', 'utf8')
        let r1 = await syncByBuffer(funGetFiles, opt)
        ms.push({ 'sync insert': JSON.stringify(r1), 'storage': snapshot(fdStorage) })

        //無異動
        let r2 = await syncByBuffer(funGetFiles, opt)
        ms.push({ 'sync no change': JSON.stringify(r2), 'storage': snapshot(fdStorage) })

        //修改
        fs.writeFileSync(`${fdSrc}/a.txt`, 'A2', 'utf8')
        let r3 = await syncByBuffer(funGetFiles, opt)
        ms.push({ 'sync modify': JSON.stringify(r3), 'storage': snapshot(fdStorage) })

        //刪除
        fs.unlinkSync(`${fdSrc}/b.txt`)
        let r4 = await syncByBuffer(funGetFiles, opt)
        ms.push({ 'sync remove': JSON.stringify(r4), 'storage': snapshot(fdStorage) })

        clean()

        return ms
    }

    let ms = [
        {
            'sync insert': '{"b":true}',
            'storage': 'a.txt=A1, b.txt=B1'
        },
        {
            'sync no change': '{"b":false}',
            'storage': 'a.txt=A1, b.txt=B1'
        },
        {
            'sync modify': '{"b":true}',
            'storage': 'a.txt=A2, b.txt=B1'
        },
        {
            'sync remove': '{"b":true}',
            'storage': 'a.txt=A2'
        }
    ]

    it(`should return '${JSON.stringify(ms)}' when run test'`, async function() {
        let r = await test()
        let rr = ms
        assert.strict.deepStrictEqual(r, rr)
    })

})
