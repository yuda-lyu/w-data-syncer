import assert from 'assert'
import fs from 'fs'
import map from 'lodash-es/map.js'
import get from 'lodash-es/get.js'
import filter from 'lodash-es/filter.js'
import sortBy from 'lodash-es/sortBy.js'
import fsTreeFolder from 'wsemi/src/fsTreeFolder.mjs'
import fsCreateFolder from 'wsemi/src/fsCreateFolder.mjs'
import fsDeleteFolder from 'wsemi/src/fsDeleteFolder.mjs'
import fsDeleteFile from 'wsemi/src/fsDeleteFile.mjs'
import fsCopyFile from 'wsemi/src/fsCopyFile.mjs'
import WDataSyncer from '../src/WDataSyncer.mjs'
import { createRecorder } from './tools/syncerTraceKit.mjs'


describe('syncer_1to1', function() {

    let fdSrc = './_test_syncer_1to1_src'
    let fdHash = './_test_syncer_1to1_hash'
    let fdTar = './_test_syncer_1to1_tar'

    let clean = () => {
        fsDeleteFolder(fdSrc)
        fsDeleteFolder(fdHash)
        fsDeleteFolder(fdTar)
    }

    //snapshot, 目標夾之實際檔案內容(依檔名排序), 供驗證同步之落地結果而非僅事件
    let snapshot = (fd) => {
        let vfps = filter(fsTreeFolder(fd, 1), { isFolder: false })
        vfps = sortBy(vfps, 'name')
        return map(vfps, (v) => `${v.name}=${fs.readFileSync(v.path, 'utf8')}`).join(', ')
    }

    let test = async () => {
        let ms = []

        //tars, 各階段(某輪同步結束時)目標夾之實際檔案內容
        let tars = []

        clean()
        fsCreateFolder(fdSrc)

        //首批來源檔案
        fs.writeFileSync(`${fdSrc}/a.txt`, 'A1', 'utf8')
        fs.writeFileSync(`${fdSrc}/b.txt`, 'B1', 'utf8')

        //以onTrace事件同步, 不以等待時間同步: 同步點為某一輪同步結束(done, 鎖已釋放), 此時再改動來源檔案不會與進行中之輪重疊
        let tr = createRecorder()

        let ev = WDataSyncer('by-1to1', {
            fdSrcStorage: fdSrc,
            fdFromStorageTempHash: fdHash,
            fdSelfStorage: fdTar,
            funGetVfpsSrc: async () => {
                return filter(fsTreeFolder(fdSrc, 1), { isFolder: false })
            },
            funProc: async ({ fn, fpSrc, fpTar }, type) => {
                fsCopyFile(fpSrc, fpTar)
            },
            funRemove: async ({ fn, fpTar }, type) => {
                fsDeleteFile(fpTar)
            },
            timeInterval: 50, //同步間隔, 正確性不依賴其長短
            onTrace: tr.onTrace,
        })
        ev.on('add', (items) => {
            ms.push({ 'add data': JSON.stringify(map(items, 'id')) })
        })
        ev.on('modify', (items) => {
            ms.push({ 'modify data': JSON.stringify(map(items, 'id')) })
        })
        ev.on('remove', (items) => {
            ms.push({ 'remove data': JSON.stringify(map(items, 'id')) })
        })
        ev.on('change', (msg) => {
            ms.push({ 'change data': `type[${msg.type}], ids[${JSON.stringify(map(msg.items, 'id'))}]` })
        })
        ev.on('change-all', (rr) => {
            ms.push({ 'change-all data': JSON.stringify({ b: get(rr, 'b'), bErr: get(rr, 'bErr'), add: map(get(rr, 'add'), 'id'), modify: map(get(rr, 'modify'), 'id'), remove: map(get(rr, 'remove'), 'id'), same: map(get(rr, 'same'), 'id') }) })
        })

        //等首次同步(有異動之輪結束), 該輪結束後同一回合內即取目標夾快照, 不與下一輪重疊
        await tr.next((e) => e.type === 'done' && e.b, 'first sync')
        tars.push({ 'tar after add': snapshot(fdTar) })

        //修改
        fs.writeFileSync(`${fdSrc}/a.txt`, 'A2', 'utf8')
        await tr.next((e) => e.type === 'done' && e.b, 'sync after modify')
        tars.push({ 'tar after modify': snapshot(fdTar) })

        //刪除
        fs.unlinkSync(`${fdSrc}/b.txt`)
        await tr.next((e) => e.type === 'done' && e.b, 'sync after remove')
        tars.push({ 'tar after remove': snapshot(fdTar) })

        //其後兩輪須無異動, 不再發送事件(原以固定等待觀察, 改以輪數觀察)
        await tr.next((e) => e.type === 'done' && !e.b, 'idle round 1')
        await tr.next((e) => e.type === 'done' && !e.b, 'idle round 2')
        tars.push({ 'tar after idle': snapshot(fdTar) })

        //clear
        ev.clear()

        clean()

        return { ms, tars }
    }

    //目標夾之落地結果: 新增後兩檔皆為首版內容, 修改後a.txt為新內容且b.txt不變, 刪除後b.txt已自目標夾移除, 其後無異動則維持不變
    let tars = [
        {
            'tar after add': 'a.txt=A1, b.txt=B1'
        },
        {
            'tar after modify': 'a.txt=A2, b.txt=B1'
        },
        {
            'tar after remove': 'a.txt=A2'
        },
        {
            'tar after idle': 'a.txt=A2'
        }
    ]

    let ms = [
        {
            'add data': '["a.txt","b.txt"]'
        },
        {
            'change data': 'type[add], ids[["a.txt","b.txt"]]'
        },
        {
            'change-all data': '{"b":true,"bErr":false,"add":["a.txt","b.txt"],"modify":[],"remove":[],"same":[]}'
        },
        {
            'modify data': '["a.txt"]'
        },
        {
            'change data': 'type[modify], ids[["a.txt"]]'
        },
        {
            'change-all data': '{"b":true,"bErr":false,"add":[],"modify":["a.txt"],"remove":[],"same":["b.txt"]}'
        },
        {
            'remove data': '["b.txt"]'
        },
        {
            'change data': 'type[remove], ids[["b.txt"]]'
        },
        {
            'change-all data': '{"b":true,"bErr":false,"add":[],"modify":[],"remove":["b.txt"],"same":["a.txt"]}'
        }
    ]

    //同一次執行同時供事件與目標夾兩個斷言使用
    let r = null
    before(async function() {
        r = await test()
    })

    it(`should return '${JSON.stringify(ms)}' when run test'`, function() {
        let rr = ms
        assert.strict.deepStrictEqual(r.ms, rr)
    })

    it(`should leave target folder as '${JSON.stringify(tars)}' when run test'`, function() {
        let rr = tars
        assert.strict.deepStrictEqual(r.tars, rr)
    })

})
