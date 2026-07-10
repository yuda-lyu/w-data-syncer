import assert from 'assert'
import fs from 'fs'
import map from 'lodash-es/map.js'
import get from 'lodash-es/get.js'
import filter from 'lodash-es/filter.js'
import fsTreeFolder from 'wsemi/src/fsTreeFolder.mjs'
import fsCreateFolder from 'wsemi/src/fsCreateFolder.mjs'
import fsDeleteFolder from 'wsemi/src/fsDeleteFolder.mjs'
import syncByNTo1 from '../src/syncByNTo1.mjs'


describe('sync-nto1', function() {

    let fdSrc = './_test_sync_nto1_src'
    let fdHash = './_test_sync_nto1_hash'

    let clean = () => {
        fsDeleteFolder(fdSrc)
        fsDeleteFolder(fdHash)
    }

    let fmt = (rr) => {
        return JSON.stringify({
            b: get(rr, 'b'),
            bErr: get(rr, 'bErr'),
            add: map(get(rr, 'add'), 'id'),
            modify: map(get(rr, 'modify'), 'id'),
            remove: map(get(rr, 'remove'), 'id'),
            same: map(get(rr, 'same'), 'id'),
        })
    }

    let test = async () => {
        let ms = []

        clean()
        fsCreateFolder(fdSrc)

        //calls, 記錄funProc收到的差異
        let calls = []

        let opt = {
            fdFromStorageTempHash: fdHash,
            funGetVfpsSrc: async () => {
                return filter(fsTreeFolder(fdSrc, 1), { isFolder: false })
            },
            funProc: async (r) => {
                calls.push(JSON.stringify({
                    add: map(r.add, 'id'),
                    diff: map(r.diff, 'id'),
                    del: map(r.del, 'id'),
                }))
            },
        }

        //首次同步
        fs.writeFileSync(`${fdSrc}/a.txt`, 'A1', 'utf8')
        fs.writeFileSync(`${fdSrc}/b.txt`, 'B1', 'utf8')
        let r1 = await syncByNTo1(opt)
        ms.push({ 'sync add': fmt(r1) })

        //無異動
        let r2 = await syncByNTo1(opt)
        ms.push({ 'sync no change': fmt(r2) })

        //修改
        fs.writeFileSync(`${fdSrc}/a.txt`, 'A2', 'utf8')
        let r3 = await syncByNTo1(opt)
        ms.push({ 'sync modify': fmt(r3) })

        //刪除
        fs.unlinkSync(`${fdSrc}/b.txt`)
        let r4 = await syncByNTo1(opt)
        ms.push({ 'sync remove': fmt(r4) })

        //funProc收到的差異
        ms.push({ 'funProc calls': calls })

        clean()

        return ms
    }

    let ms = [
        {
            'sync add': '{"b":true,"bErr":false,"add":["a.txt","b.txt"],"modify":[],"remove":[],"same":[]}'
        },
        {
            'sync no change': '{"b":false,"bErr":false,"add":[],"modify":[],"remove":[],"same":[]}'
        },
        {
            'sync modify': '{"b":true,"bErr":false,"add":[],"modify":["a.txt"],"remove":[],"same":["b.txt"]}'
        },
        {
            'sync remove': '{"b":true,"bErr":false,"add":[],"modify":[],"remove":["b.txt"],"same":["a.txt"]}'
        },
        {
            'funProc calls': [
                '{"add":["a.txt","b.txt"],"diff":[],"del":[]}',
                '{"add":[],"diff":["a.txt"],"del":[]}',
                '{"add":[],"diff":[],"del":["b.txt"]}'
            ]
        }
    ]

    it(`should return '${JSON.stringify(ms)}' when run test'`, async function() {
        let r = await test()
        let rr = ms
        assert.strict.deepStrictEqual(r, rr)
    })

})
