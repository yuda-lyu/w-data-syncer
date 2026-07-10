import assert from 'assert'
import fs from 'fs'
import map from 'lodash-es/map.js'
import get from 'lodash-es/get.js'
import filter from 'lodash-es/filter.js'
import delay from 'wsemi/src/delay.mjs'
import fsTreeFolder from 'wsemi/src/fsTreeFolder.mjs'
import fsCreateFolder from 'wsemi/src/fsCreateFolder.mjs'
import fsDeleteFolder from 'wsemi/src/fsDeleteFolder.mjs'
import fsDeleteFile from 'wsemi/src/fsDeleteFile.mjs'
import fsCopyFile from 'wsemi/src/fsCopyFile.mjs'
import WDataSyncer from '../src/WDataSyncer.mjs'


describe('syncer_1to1', function() {

    let fdSrc = './_test_syncer_1to1_src'
    let fdHash = './_test_syncer_1to1_hash'
    let fdTar = './_test_syncer_1to1_tar'

    let clean = () => {
        fsDeleteFolder(fdSrc)
        fsDeleteFolder(fdHash)
        fsDeleteFolder(fdTar)
    }

    let test = async () => {
        let ms = []

        clean()
        fsCreateFolder(fdSrc)

        //首批來源檔案
        fs.writeFileSync(`${fdSrc}/a.txt`, 'A1', 'utf8')
        fs.writeFileSync(`${fdSrc}/b.txt`, 'B1', 'utf8')

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
            timeInterval: 1000, //每秒同步
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

        //等首次同步
        await delay(2500)

        //修改
        fs.writeFileSync(`${fdSrc}/a.txt`, 'A2', 'utf8')
        await delay(3000)

        //刪除
        fs.unlinkSync(`${fdSrc}/b.txt`)
        await delay(3000)

        //clear
        ev.clear()

        clean()

        return ms
    }

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

    it(`should return '${JSON.stringify(ms)}' when run test'`, async function() {
        let r = await test()
        let rr = ms
        assert.strict.deepStrictEqual(r, rr)
    })

})
