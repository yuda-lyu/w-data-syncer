//sync-diff-throw.test.mjs: 規則帳本R-SYNC-COMMIT-01於by-orm、by-1to1、by-nto1三站點之測試
//  規則: 比對(ltdtDiffByKey, wsemi 1.9.60起遇重複主鍵等壞資料拋錯)拋錯時, 不得已更改任何持久狀態(目標端資料、hash快取檔), 以免該次變更永遠不會送出;
//  資料修正後之下一輪須對「比對前之狀態」比對, 正確送出該次與其後之變更, 不遺失
//  本檔為盤點三站點之實測依據(三站點之狀態皆在比對與處理全部成功後才提交, 故修前修後皆綠, 作為其後調整順序時之回歸防線), 非修正之紅測
//  each it標註之[R]為對應之規則句, 斷言為該句之翻譯, 非現狀指紋
import assert from 'assert'
import fs from 'fs'
import map from 'lodash-es/map.js'
import filter from 'lodash-es/filter.js'
import sortBy from 'lodash-es/sortBy.js'
import cloneDeep from 'lodash-es/cloneDeep.js'
import get from 'lodash-es/get.js'
import fsTreeFolder from 'wsemi/src/fsTreeFolder.mjs'
import fsDeleteFolder from 'wsemi/src/fsDeleteFolder.mjs'
import syncByOrm from '../src/syncByOrm.mjs'
import syncBy1To1 from '../src/syncBy1To1.mjs'
import syncByNTo1 from '../src/syncByNTo1.mjs'


describe('sync-diff-throw', function() {

    let fdRoot = './test/_tmp/sync-diff-throw'

    before(function() {
        fsDeleteFolder(fdRoot)
    })

    after(function() {
        fsDeleteFolder(fdRoot)
    })

    //-------------------------------------------------------------------------

    describe('by-orm: the target is the only state, the round throws before any write', function() {

        //mkOrm, 目標端以store模擬外部持久儲存, 各寫入函數皆記次數
        let mkOrm = (store) => {
            let calls = { insert: 0, save: 0, del: 0 }
            let st = { src: [] }
            let src = {
                select: async () => cloneDeep(st.src),
            }
            let tar = {
                select: async () => cloneDeep(store),
                insert: async (items) => {
                    calls.insert++
                    store.push(...cloneDeep(items))
                },
                save: async (items) => {
                    calls.save++
                    for (let it of items) {
                        let i = store.findIndex((v) => v.id === it.id)
                        store[i] = cloneDeep(it)
                    }
                },
                del: async (items) => {
                    calls.del++
                    for (let it of items) {
                        let i = store.findIndex((v) => v.id === it.id)
                        store.splice(i, 1)
                    }
                },
            }
            return { src, tar, st, calls }
        }

        let sorted = (store) => sortBy(cloneDeep(store), 'id')

        it(`should write nothing when the source has a duplicated key, and send the modification and the addition once the source is corrected`, async function() {
            let store = [{ id: 'a', value: 1 }]
            let { src, tar, st, calls } = mkOrm(store)

            //[R]比對拋錯: 本輪拋錯, 目標端零寫入且資料不變
            st.src = [{ id: 'a', value: 2 }, { id: 'b', value: 3 }, { id: 'b', value: 4 }]
            let err = null
            let r = await syncByOrm(src, tar, { key: 'id' })
                .catch((e) => {
                    err = e
                    return 'threw'
                })
            assert.strict.deepStrictEqual(r, 'threw')
            assert.strict.deepStrictEqual(/^invalid ltdtNew\[/.test(get(err, 'message')), true)
            assert.strict.deepStrictEqual(calls, { insert: 0, save: 0, del: 0 })
            assert.strict.deepStrictEqual(store, [{ id: 'a', value: 1 }])

            //[R]資料修正後之下一輪: 對目標端現況比對, a之修改與b之新增皆正確寫入, 不遺失
            st.src = [{ id: 'a', value: 2 }, { id: 'b', value: 3 }]
            r = await syncByOrm(src, tar, { key: 'id' })
            assert.strict.deepStrictEqual(r.b, true)
            assert.strict.deepStrictEqual(map(r.insert, 'id'), ['b'])
            assert.strict.deepStrictEqual(map(r.save, 'id'), ['a'])
            assert.strict.deepStrictEqual(calls, { insert: 1, save: 1, del: 0 })
            assert.strict.deepStrictEqual(sorted(store), [{ id: 'a', value: 2 }, { id: 'b', value: 3 }])
        })

        it(`should write nothing when the target itself has a duplicated key, and recover after the target is corrected`, async function() {
            let store = [{ id: 'a', value: 1 }, { id: 'a', value: 9 }]
            let { src, tar, st, calls } = mkOrm(store)
            st.src = [{ id: 'a', value: 2 }, { id: 'b', value: 3 }, { id: 'c', value: 4 }]

            //[R]目標端壞資料(舊側)同樣拋錯, 零寫入
            let err = null
            let r = await syncByOrm(src, tar, { key: 'id' })
                .catch((e) => {
                    err = e
                    return 'threw'
                })
            assert.strict.deepStrictEqual(r, 'threw')
            assert.strict.deepStrictEqual(/^invalid ltdtOld\[/.test(get(err, 'message')), true)
            assert.strict.deepStrictEqual(calls, { insert: 0, save: 0, del: 0 })

            //[R]目標端修正後之下一輪正確寫入
            store.splice(1, 1)
            r = await syncByOrm(src, tar, { key: 'id' })
            assert.strict.deepStrictEqual(calls, { insert: 1, save: 1, del: 0 })
            assert.strict.deepStrictEqual(sorted(store), [{ id: 'a', value: 2 }, { id: 'b', value: 3 }, { id: 'c', value: 4 }])
        })

    })

    //-------------------------------------------------------------------------

    //mkFolders, 來源夾(a.txt、b.txt)、hash夾、目標夾
    let mkFolders = (name) => {
        let fdBase = `${fdRoot}/${name}`
        let fdSrc = `${fdBase}/src`
        let fdHash = `${fdBase}/hash`
        let fdTar = `${fdBase}/tar`
        fsDeleteFolder(fdBase)
        fs.mkdirSync(fdSrc, { recursive: true })
        fs.mkdirSync(fdHash, { recursive: true })
        fs.writeFileSync(`${fdSrc}/a.txt`, 'A1', 'utf8')
        fs.writeFileSync(`${fdSrc}/b.txt`, 'B1', 'utf8')
        return { fdSrc, fdHash, fdTar }
    }

    let snapshot = (fd) => {
        if (!fs.existsSync(fd)) {
            return ''
        }
        let vfps = sortBy(filter(fsTreeFolder(fd, 1), { isFolder: false }), 'name')
        return map(vfps, (v) => `${v.name}=${fs.readFileSync(v.path, 'utf8')}`).join(', ')
    }

    let readHash = (fdHash) => {
        return fs.readFileSync(`${fdHash}/hash.json`, 'utf8')
    }

    //funGetVfpsSrc之回傳: 正常為來源夾之檔案; bad時多一筆與a.txt同名之項目(名稱重複, 模擬自訂之清單函數遞迴列出不同夾之同名檔)
    let mkGetVfps = (fdSrc, st) => {
        return async () => {
            let vfps = sortBy(filter(fsTreeFolder(fdSrc, 1), { isFolder: false }), 'name')
            if (st.bad) {
                vfps = [...vfps, vfps[0]]
            }
            return vfps
        }
    }

    describe('by-1to1: the hash cache is written only after the round succeeds', function() {

        it(`should leave the cache and the target untouched when the file list has a duplicated name, and send the modified file once the list is corrected`, async function() {
            let { fdSrc, fdHash, fdTar } = mkFolders('1to1')
            let st = { bad: false }
            let calls = { funProc: [], funRemove: 0, funPreEnd: 0 }
            let logs = { error: [] }
            let opt = {
                fdSrcStorage: fdSrc,
                fdFromStorageTempHash: fdHash,
                fdSelfStorage: fdTar,
                funGetVfpsSrc: mkGetVfps(fdSrc, st),
                funProc: async ({ fn, fpSrc, fpTar }, type) => {
                    calls.funProc.push(`${type}:${fn}`)
                    fs.copyFileSync(fpSrc, fpTar)
                },
                funRemove: async ({ fpTar }) => {
                    calls.funRemove++
                    fs.unlinkSync(fpTar)
                },
                funPreEnd: async () => {
                    calls.funPreEnd++
                },
                srLog: {
                    info: () => {},
                    error: (e) => logs.error.push(e),
                },
            }

            //第1輪: 正常, 兩檔新增, 快取寫入
            let rr = await syncBy1To1(opt)
            assert.strict.deepStrictEqual(rr.bErr, false)
            assert.strict.deepStrictEqual(calls.funProc, ['add:a.txt', 'add:b.txt'])
            let hash1 = readHash(fdHash)
            assert.strict.deepStrictEqual(snapshot(fdTar), 'a.txt=A1, b.txt=B1')

            //第2輪: 來源b.txt已修改, 但清單名稱重複致比對拋錯
            fs.writeFileSync(`${fdSrc}/b.txt`, 'B2', 'utf8')
            st.bad = true
            let nPreEnd = calls.funPreEnd
            rr = await syncBy1To1(opt)

            //[R]比對拋錯: 中止本輪(bErr), 記錄一筆錯誤事件, 不呼叫funProc/funRemove, 目標夾不變
            assert.strict.deepStrictEqual(rr, { b: false, bErr: true })
            assert.strict.deepStrictEqual(map(logs.error, 'event'), ['proc'])
            assert.strict.deepStrictEqual(/^invalid ltdtNew\[/.test(get(logs.error, '0.msg')), true)
            assert.strict.deepStrictEqual(calls.funProc, ['add:a.txt', 'add:b.txt'])
            assert.strict.deepStrictEqual(calls.funRemove, 0)
            assert.strict.deepStrictEqual(calls.funPreEnd, nPreEnd)
            assert.strict.deepStrictEqual(snapshot(fdTar), 'a.txt=A1, b.txt=B1')

            //[R]hash快取維持原文(未提交新狀態), 故下一輪仍視b.txt為待處理
            assert.strict.deepStrictEqual(readHash(fdHash), hash1)

            //第3輪: 清單修正
            st.bad = false
            rr = await syncBy1To1(opt)

            //[R]修正後下一輪對舊快取比對: b.txt之修改正確送出(modify), 目標夾更新, 快取更新, 無新錯誤
            assert.strict.deepStrictEqual(rr.bErr, false)
            assert.strict.deepStrictEqual(rr.b, true)
            assert.strict.deepStrictEqual(map(rr.modify, 'id'), ['b.txt'])
            assert.strict.deepStrictEqual(calls.funProc, ['add:a.txt', 'add:b.txt', 'modify:b.txt'])
            assert.strict.deepStrictEqual(snapshot(fdTar), 'a.txt=A1, b.txt=B2')
            assert.strict.deepStrictEqual(readHash(fdHash) !== hash1, true)
            assert.strict.deepStrictEqual(logs.error.length, 1)
        })

    })

    describe('by-nto1: the hash cache is written only after the round succeeds', function() {

        it(`should leave the cache untouched and not call funProc when the file list has a duplicated name, and send the modified file once the list is corrected`, async function() {
            let { fdSrc, fdHash } = mkFolders('nto1')
            let st = { bad: false }
            let calls = []
            let logs = { error: [] }
            let opt = {
                fdFromStorageTempHash: fdHash,
                funGetVfpsSrc: mkGetVfps(fdSrc, st),
                funProc: async (r) => {
                    calls.push({ add: map(r.add, 'id'), diff: map(r.diff, 'id'), del: map(r.del, 'id') })
                },
                srLog: {
                    info: () => {},
                    error: (e) => logs.error.push(e),
                },
            }

            //第1輪: 正常, 兩檔新增, 快取寫入
            let rr = await syncByNTo1(opt)
            assert.strict.deepStrictEqual(rr.bErr, false)
            assert.strict.deepStrictEqual(calls, [{ add: ['a.txt', 'b.txt'], diff: [], del: [] }])
            let hash1 = readHash(fdHash)

            //第2輪: 來源b.txt已修改, 但清單名稱重複致比對拋錯
            fs.writeFileSync(`${fdSrc}/b.txt`, 'B2', 'utf8')
            st.bad = true
            rr = await syncByNTo1(opt)

            //[R]比對拋錯: 中止本輪(bErr), 記錄一筆錯誤事件, 不呼叫funProc
            assert.strict.deepStrictEqual(rr, { b: false, bErr: true })
            assert.strict.deepStrictEqual(map(logs.error, 'event'), ['proc'])
            assert.strict.deepStrictEqual(/^invalid ltdtNew\[/.test(get(logs.error, '0.msg')), true)
            assert.strict.deepStrictEqual(calls.length, 1)

            //[R]hash快取維持原文(未提交新狀態)
            assert.strict.deepStrictEqual(readHash(fdHash), hash1)

            //第3輪: 清單修正
            st.bad = false
            rr = await syncByNTo1(opt)

            //[R]修正後下一輪對舊快取比對: b.txt之修改正確送出, 快取更新, 無新錯誤
            assert.strict.deepStrictEqual(rr.bErr, false)
            assert.strict.deepStrictEqual(map(rr.modify, 'id'), ['b.txt'])
            assert.strict.deepStrictEqual(calls[1], { add: [], diff: ['b.txt'], del: [] })
            assert.strict.deepStrictEqual(readHash(fdHash) !== hash1, true)
            assert.strict.deepStrictEqual(logs.error.length, 1)
        })

    })

})
