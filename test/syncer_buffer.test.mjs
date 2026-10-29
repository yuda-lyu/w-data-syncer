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
import WDataSyncer from '../src/WDataSyncer.mjs'
import { createRecorder } from './tools/syncerTraceKit.mjs'


describe('syncer_buffer', function() {

    let fdSrc = './_test_syncer_buffer_src'
    let fdHists = './_test_syncer_buffer_hists'
    let fdHistStates = './_test_syncer_buffer_histstates'
    let fdTemp = './_test_syncer_buffer_temp'
    let fdStorage = './_test_syncer_buffer_storage'

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

        //首批來源檔案
        fs.writeFileSync(`${fdSrc}/a.txt`, 'A1', 'utf8')
        fs.writeFileSync(`${fdSrc}/b.txt`, 'B1', 'utf8')

        //以onTrace事件同步, 不以等待時間同步: 同步點為某一輪同步結束(done, 鎖已釋放), 此時再改動來源檔案不會與進行中之輪重疊
        let tr = createRecorder()

        let ev = WDataSyncer('by-buffer', {
            numKeep: 1,
            fdFromStorageTempHists: fdHists,
            fdFromStorageTempHistStates: fdHistStates,
            fdFromStorageTemp: fdTemp,
            fdFromStorage: fdStorage,
            funGetFiles,
            timeInterval: 50, //同步間隔, 正確性不依賴其長短
            onTrace: tr.onTrace,
        })
        ev.on('change-all', (msg) => {
            ms.push({ 'sync data': JSON.stringify(msg), 'storage': snapshot(fdStorage) })
        })

        //等首次同步(有異動之輪結束)
        await tr.next((e) => e.type === 'done' && e.b, 'first sync')

        //修改
        fs.writeFileSync(`${fdSrc}/a.txt`, 'A2', 'utf8')
        await tr.next((e) => e.type === 'done' && e.b, 'sync after modify')

        //刪除
        fs.unlinkSync(`${fdSrc}/b.txt`)
        await tr.next((e) => e.type === 'done' && e.b, 'sync after remove')

        //其後兩輪須無異動, 不再發送事件(原以固定等待觀察, 改以輪數觀察)
        await tr.next((e) => e.type === 'done' && !e.b, 'idle round 1')
        await tr.next((e) => e.type === 'done' && !e.b, 'idle round 2')

        //clear
        ev.clear()

        clean()

        return ms
    }

    let ms = [
        {
            'sync data': '{"b":true}',
            'storage': 'a.txt=A1, b.txt=B1'
        },
        {
            'sync data': '{"b":true}',
            'storage': 'a.txt=A2, b.txt=B1'
        },
        {
            'sync data': '{"b":true}',
            'storage': 'a.txt=A2'
        }
    ]

    it(`should return '${JSON.stringify(ms)}' when run test'`, async function() {
        let r = await test()
        let rr = ms
        assert.strict.deepStrictEqual(r, rr)
    })

})
