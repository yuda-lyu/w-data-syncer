import assert from 'assert'
import syncByOrm from '../src/syncByOrm.mjs'


describe('sync-orm', function() {

    let test = async () => {
        let ms = []

        let ltdtSrc = []
        let src = {
            select: async () => ltdtSrc,
        }

        let ltdtTar = []
        let tar = {
            select: async () => ltdtTar,
            insert: async (items) => {
                items.forEach((v) => ltdtTar.push(v))
            },
            save: async (items) => {
                items.forEach((v) => {
                    let i = ltdtTar.findIndex((t) => t.id === v.id)
                    ltdtTar[i] = v
                })
            },
            del: async (items) => {
                items.forEach((v) => {
                    let i = ltdtTar.findIndex((t) => t.id === v.id)
                    ltdtTar.splice(i, 1)
                })
            },
        }

        //無來源資料時跳過
        let r1 = await syncByOrm(src, tar, { key: 'id' })
        ms.push({ 'sync empty src': JSON.stringify(r1) })

        //首次同步, 全部insert
        ltdtSrc = [{ id: 'a', value: 1 }, { id: 'b', value: 2 }]
        let r2 = await syncByOrm(src, tar, { key: 'id' })
        ms.push({ 'sync insert': JSON.stringify(r2), 'tar': JSON.stringify(ltdtTar) })

        //無異動
        let r3 = await syncByOrm(src, tar, { key: 'id' })
        ms.push({ 'sync no change': JSON.stringify(r3), 'tar': JSON.stringify(ltdtTar) })

        //修改
        ltdtSrc = [{ id: 'a', value: 1.5 }, { id: 'b', value: 2 }]
        let r4 = await syncByOrm(src, tar, { key: 'id' })
        ms.push({ 'sync save': JSON.stringify(r4), 'tar': JSON.stringify(ltdtTar) })

        //替換, 同筆數下b刪除c新增
        ltdtSrc = [{ id: 'a', value: 1.5 }, { id: 'c', value: 3 }]
        let r5 = await syncByOrm(src, tar, { key: 'id' })
        ms.push({ 'sync replace': JSON.stringify(r5), 'tar': JSON.stringify(ltdtTar) })

        //來源筆數少於目標時跳過
        ltdtSrc = [{ id: 'a', value: 1.5 }]
        let r6 = await syncByOrm(src, tar, { key: 'id' })
        ms.push({ 'sync less src': JSON.stringify(r6), 'tar': JSON.stringify(ltdtTar) })

        return ms
    }

    let ms = [
        {
            'sync empty src': 'null'
        },
        {
            'sync insert': '{"b":true,"del":[],"insert":[{"id":"a","value":1},{"id":"b","value":2}],"same":[],"save":[]}',
            'tar': '[{"id":"a","value":1},{"id":"b","value":2}]'
        },
        {
            'sync no change': '{"b":false,"del":[],"insert":[],"same":[{"id":"a","value":1},{"id":"b","value":2}],"save":[]}',
            'tar': '[{"id":"a","value":1},{"id":"b","value":2}]'
        },
        {
            'sync save': '{"b":true,"del":[],"insert":[],"same":[{"id":"b","value":2}],"save":[{"id":"a","value":1.5}]}',
            'tar': '[{"id":"a","value":1.5},{"id":"b","value":2}]'
        },
        {
            'sync replace': '{"b":true,"del":[{"id":"b","value":2}],"insert":[{"id":"c","value":3}],"same":[{"id":"a","value":1.5}],"save":[]}',
            'tar': '[{"id":"a","value":1.5},{"id":"c","value":3}]'
        },
        {
            'sync less src': 'null',
            'tar': '[{"id":"a","value":1.5},{"id":"c","value":3}]'
        }
    ]

    it(`should return '${JSON.stringify(ms)}' when run test'`, async function() {
        let r = await test()
        let rr = ms
        assert.strict.deepStrictEqual(r, rr)
    })

})
