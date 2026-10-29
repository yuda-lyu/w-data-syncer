import assert from 'assert'
import fs from 'fs'
import map from 'lodash-es/map.js'
import get from 'lodash-es/get.js'
import filter from 'lodash-es/filter.js'
import fsTreeFolder from 'wsemi/src/fsTreeFolder.mjs'
import fsCreateFolder from 'wsemi/src/fsCreateFolder.mjs'
import fsDeleteFolder from 'wsemi/src/fsDeleteFolder.mjs'
import WDataSyncer from '../src/WDataSyncer.mjs'
import { createRecorder } from './tools/syncerTraceKit.mjs'


describe('syncer_nto1', function() {

    let fdSrc = './_test_syncer_nto1_src'
    let fdHash = './_test_syncer_nto1_hash'

    let clean = () => {
        fsDeleteFolder(fdSrc)
        fsDeleteFolder(fdHash)
    }

    let test = async () => {
        let ms = []

        clean()
        fsCreateFolder(fdSrc)

        //首批來源檔案
        fs.writeFileSync(`${fdSrc}/a.txt`, 'A1', 'utf8')
        fs.writeFileSync(`${fdSrc}/b.txt`, 'B1', 'utf8')

        //以onTrace事件同步, 不以等待時間同步: 同步點為某一輪同步結束(done, 鎖已釋放), 此時再改動來源檔案不會與進行中之輪重疊
        let tr = createRecorder()

        let ev = WDataSyncer('by-nto1', {
            fdFromStorageTempHash: fdHash,
            funGetVfpsSrc: async () => {
                return filter(fsTreeFolder(fdSrc, 1), { isFolder: false })
            },
            funProc: async (r) => {
                ms.push({ 'proc data': JSON.stringify({ add: map(r.add, 'id'), diff: map(r.diff, 'id'), del: map(r.del, 'id') }) })
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
            'proc data': '{"add":["a.txt","b.txt"],"diff":[],"del":[]}'
        },
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
            'proc data': '{"add":[],"diff":["a.txt"],"del":[]}'
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
            'proc data': '{"add":[],"diff":[],"del":["b.txt"]}'
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

    it(`should return '${JSON.stringify(ms)}' when run test'`, async function() {
        let r = await test()
        let rr = ms
        assert.strict.deepStrictEqual(r, rr)
    })

})
