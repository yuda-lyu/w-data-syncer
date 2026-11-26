import assert from 'assert'
import fs from 'fs'
import path from 'path'
import { mock } from 'node:test'
import nowms2strp from 'wsemi/src/nowms2strp.mjs'
import syncByBuffer from '../src/syncByBuffer.mjs'


//syncByBuffer 之列舉層數: src/syncByBuffer.mjs 內 5 處 wsemi 列舉(fsTreeFolder)皆只取第1層, 不進入子資料夾
//  wsemi 1.9.80 起列舉函數之 opt.levelLimit 未給即窮舉全部層級(舊版預設1層), 故各站點須明給 { levelLimit: 1 }
//  站點(規則帳本 R-FSLEVEL-01):
//    P1 fsGetFiles(儲存區之 hash 計算, useStorageHash)  → hash.json 只含儲存區第1層之檔案
//    P2 genHistName(歷史資料夾與完成狀態檔之序號)       → 只看第1層之名稱, 子層內同名前綴者不影響序號
//    P3 vfds(歷史資料夾清單)                            → 只取第1層之資料夾, 歷史資料夾內之子資料夾不被當成歷史資料夾而刪除
//    P4 vfpsState(完成狀態檔清單)                       → 只取第1層之檔案, 完成狀態區內子資料夾之檔不被當成狀態檔而刪除
//    P5 vfpsHash(歷史資料夾內之檔案)                    → 只取第1層之檔案, 子層之檔不被併入暫存區與儲存區
//  合成資料: 各層之檔名皆互異(a.txt、deep.txt、deeper.txt、n.txt、zz.txt...), 由檔名即可知其所在層級;
//            序號之子層名稱取互異之 005 與 003, 使「窮舉」時之序號(006)異於「第1層」時之序號(000)


let fdRoot = './test/_tmp/sync-buffer-levels'
let tFrozen = new Date('2026-10-31T10:20:40.123+08:00')

let listAll = (fd) => { //遞迴列出某夾下全部檔案(相對路徑, 排序)
    let rs = []
    let walk = (fdc, rel) => {
        for (let ent of fs.readdirSync(fdc, { withFileTypes: true })) {
            let r = rel ? `${rel}/${ent.name}` : ent.name
            if (ent.isDirectory()) {
                walk(path.join(fdc, ent.name), r)
            }
            else {
                rs.push(r)
            }
        }
    }
    walk(fd, '')
    return rs.sort()
}

let put = (fp, text) => {
    fs.mkdirSync(path.dirname(fp), { recursive: true })
    fs.writeFileSync(fp, text, 'utf8')
}


describe('sync-buffer-levels', function() {

    beforeEach(function() {
        fs.rmSync(fdRoot, { recursive: true, force: true })
        fs.mkdirSync(fdRoot, { recursive: true })
    })

    afterEach(function() {
        mock.timers.reset()
        fs.rmSync(fdRoot, { recursive: true, force: true })
    })

    describe('history folders and states (P2, P3, P4, P5)', function() {

        let fdHists = `${fdRoot}/hists`
        let fdHistStates = `${fdRoot}/histstates`
        let fdTemp = `${fdRoot}/temp`
        let fdStorage = `${fdRoot}/storage`
        let nameOld = '20000101000000000000' //20碼舊歷史名稱(早於任何新名稱)
        let msp = ''
        let r = null

        beforeEach(async function() {
            mock.timers.enable({ apis: ['Date'], now: tFrozen })
            msp = nowms2strp() //17碼毫秒時間戳

            //種子: 一輪完整之舊歷史(歷史資料夾與同名完成狀態檔), 其內含子層之檔案與名稱含新時間戳前綴之子資料夾
            put(`${fdHists}/${nameOld}/a.txt`, 'old-a') //第1層
            put(`${fdHists}/${nameOld}/sub/deep.txt`, 'old-deep') //第2層
            put(`${fdHists}/${nameOld}/sub/inner/deeper.txt`, 'old-deeper') //第3層
            put(`${fdHists}/${nameOld}/${msp}005/n.txt`, 'old-n') //第2層之資料夾, 名稱為新時間戳加序號005
            put(`${fdHistStates}/${nameOld}`, 'done') //舊歷史之完成狀態檔
            put(`${fdHistStates}/zsub/${msp}003`, 'stray-state') //完成狀態區之子資料夾內之檔案, 名稱為新時間戳加序號003

            let funGetFiles = async (fdDw) => {
                put(`${fdDw}/r1.txt`, 'R1')
                return [{ name: 'r1.txt', path: `${fdDw}/r1.txt` }]
            }
            r = await syncByBuffer(funGetFiles, {
                numKeep: 10,
                fdFromStorageTempHists: fdHists,
                fdFromStorageTempHistStates: fdHistStates,
                fdFromStorageTemp: fdTemp,
                fdFromStorage: fdStorage,
            })
            mock.timers.reset()
        })

        it('P2 should name the new round by the first-level names only, ignoring same-prefix names in sub folders', function() {
            //第1層無同前綴之名稱 → 序號為000; 若窮舉則會讀到子層之005與003而成006
            assert.strict.deepStrictEqual(fs.readdirSync(fdHists).sort(), [nameOld, `${msp}000`])
            assert.strict.deepStrictEqual(fs.readFileSync(`${fdHistStates}/${msp}000`, 'utf8'), 'done')
        })

        it('P3 should take only first-level folders as history folders, leaving sub folders inside a history folder', function() {
            //歷史資料夾內之子資料夾不是歷史資料夾(無完成狀態檔), 不得被當成不完整歷史而刪除
            assert.strict.deepStrictEqual(listAll(`${fdHists}/${nameOld}`), [`${msp}005/n.txt`, 'a.txt', 'sub/deep.txt', 'sub/inner/deeper.txt'])
            assert.strict.deepStrictEqual(fs.readFileSync(`${fdHists}/${nameOld}/sub/deep.txt`, 'utf8'), 'old-deep')
        })

        it('P4 should take only first-level files as state files, leaving files inside a sub folder of the state folder', function() {
            //完成狀態區子資料夾內之檔案不是完成狀態檔, 不得被當成孤立狀態檔而刪除
            assert.strict.deepStrictEqual(fs.readFileSync(`${fdHistStates}/zsub/${msp}003`, 'utf8'), 'stray-state')
            assert.strict.deepStrictEqual(fs.readdirSync(fdHistStates).sort(), [nameOld, `${msp}000`, 'zsub'])
        })

        it('P5 should merge only first-level files of each history folder into the temp and storage folders', function() {
            //子層之檔案(deep.txt、deeper.txt、n.txt)不併入; 第1層之 a.txt 與本輪 r1.txt 併入
            assert.strict.deepStrictEqual(listAll(fdTemp), ['a.txt', 'r1.txt'])
            assert.strict.deepStrictEqual(listAll(fdStorage), ['a.txt', 'r1.txt'])
            assert.strict.deepStrictEqual(fs.readFileSync(`${fdStorage}/a.txt`, 'utf8'), 'old-a')
            assert.strict.deepStrictEqual(r, { b: true })
        })

    })

    describe('storage hash (P1)', function() {

        let fdHists = `${fdRoot}/hists`
        let fdHistStates = `${fdRoot}/histstates`
        let fdTemp = `${fdRoot}/temp`
        let fdStorage = `${fdRoot}/storage`
        let fdHash = `${fdRoot}/hash`

        it('P1 should hash only first-level files of the storage folder', async function() {

            //儲存區預置: 第1層之 keep.txt, 第2層之 zz.txt, 第3層之 yy.txt(自訂 funSyncStorage 不清除之)
            put(`${fdStorage}/keep.txt`, 'K')
            put(`${fdStorage}/substore/zz.txt`, 'Z')
            put(`${fdStorage}/substore/inner/yy.txt`, 'Y')

            let funGetFiles = async (fdDw) => {
                put(`${fdDw}/r1.txt`, 'R1')
                return [{ name: 'r1.txt', path: `${fdDw}/r1.txt` }]
            }

            //自訂同步: 只把暫存區第1層之檔案複製到儲存區, 不刪除儲存區既有內容
            let funSyncStorage = async (fdSrc, fdTar) => {
                for (let name of fs.readdirSync(fdSrc)) {
                    fs.copyFileSync(`${fdSrc}/${name}`, `${fdTar}/${name}`)
                }
                return true
            }

            let r = await syncByBuffer(funGetFiles, {
                numKeep: 10,
                fdFromStorageTempHists: fdHists,
                fdFromStorageTempHistStates: fdHistStates,
                fdFromStorageTemp: fdTemp,
                fdFromStorage: fdStorage,
                funSyncStorage,
                useStorageHash: true,
                fdFromStorageHash: fdHash,
            })
            assert.strict.deepStrictEqual(r, { b: true })

            //hash.json 只含儲存區第1層之檔案(keep.txt、r1.txt), 不含第2層 zz.txt 與第3層 yy.txt
            let hashs = JSON.parse(fs.readFileSync(`${fdHash}/hash.json`, 'utf8'))
            let ids = hashs.map((v) => v.id).sort()
            assert.strict.deepStrictEqual(ids, ['keep.txt', 'r1.txt'])
            assert.ok(hashs.every((v) => typeof v.hash === 'string' && v.hash.length > 0), '各檔應有雜湊值')
            assert.strict.deepStrictEqual(listAll(fdStorage), ['keep.txt', 'r1.txt', 'substore/inner/yy.txt', 'substore/zz.txt'])
        })

    })

})
