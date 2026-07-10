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
import syncBy1To1 from '../src/syncBy1To1.mjs'


describe('sync-1to1', function() {

    let fdSrc = './_test_sync_1to1_src'
    let fdHash = './_test_sync_1to1_hash'
    let fdTar = './_test_sync_1to1_tar'

    let clean = () => {
        fsDeleteFolder(fdSrc)
        fsDeleteFolder(fdHash)
        fsDeleteFolder(fdTar)
    }

    let snapshot = (fd) => {
        let vfps = filter(fsTreeFolder(fd, 1), { isFolder: false })
        vfps = sortBy(vfps, 'name')
        return map(vfps, (v) => `${v.name}=${fs.readFileSync(v.path, 'utf8')}`).join(', ')
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

        let opt = {
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
        }

        //首次同步
        fs.writeFileSync(`${fdSrc}/a.txt`, 'A1', 'utf8')
        fs.writeFileSync(`${fdSrc}/b.txt`, 'B1', 'utf8')
        let r1 = await syncBy1To1(opt)
        ms.push({ 'sync add': fmt(r1), 'tar': snapshot(fdTar) })

        //無異動
        let r2 = await syncBy1To1(opt)
        ms.push({ 'sync no change': fmt(r2), 'tar': snapshot(fdTar) })

        //修改
        fs.writeFileSync(`${fdSrc}/a.txt`, 'A2', 'utf8')
        let r3 = await syncBy1To1(opt)
        ms.push({ 'sync modify': fmt(r3), 'tar': snapshot(fdTar) })

        //刪除
        fs.unlinkSync(`${fdSrc}/b.txt`)
        let r4 = await syncBy1To1(opt)
        ms.push({ 'sync remove': fmt(r4), 'tar': snapshot(fdTar) })

        clean()

        return ms
    }

    let ms = [
        {
            'sync add': '{"b":true,"bErr":false,"add":["a.txt","b.txt"],"modify":[],"remove":[],"same":[]}',
            'tar': 'a.txt=A1, b.txt=B1'
        },
        {
            'sync no change': '{"b":false,"bErr":false,"add":[],"modify":[],"remove":[],"same":[]}',
            'tar': 'a.txt=A1, b.txt=B1'
        },
        {
            'sync modify': '{"b":true,"bErr":false,"add":[],"modify":["a.txt"],"remove":[],"same":["b.txt"]}',
            'tar': 'a.txt=A2, b.txt=B1'
        },
        {
            'sync remove': '{"b":true,"bErr":false,"add":[],"modify":[],"remove":["b.txt"],"same":["a.txt"]}',
            'tar': 'a.txt=A2'
        }
    ]

    it(`should return '${JSON.stringify(ms)}' when run test'`, async function() {
        let r = await test()
        let rr = ms
        assert.strict.deepStrictEqual(r, rr)
    })

})
