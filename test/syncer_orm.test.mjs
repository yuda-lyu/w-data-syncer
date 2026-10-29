import assert from 'assert'
import fs from 'fs'
import _ from 'lodash-es'
import w from 'wsemi'
import ot from 'dayjs'
// import WOrm from 'w-orm-mongodb/src/WOrmMongodb.mjs' //自行選擇引用ORM
import WOrm from 'w-orm-lowdb/src/WOrmLowdb.mjs' //自行選擇引用ORM
import WDataSourceFromCsv from '../src/WDataSourceFromCsv.mjs'
import WDataSyncer from '../src/WDataSyncer.mjs'
import { createRecorder, createGate } from './tools/syncerTraceKit.mjs'


describe('syncer_orm', function() {

    let test = async () => {
        let ms_trigger = []
        let ms_csv = []
        let ms_db = []

        let fdSrcCsv = `./_test_syncer_csv`
        let fdSrcDb = `./_test_syncer_db`

        w.fsCleanFolder(fdSrcCsv)
        w.fsCleanFolder(fdSrcDb)

        //以onTrace與被測物自身事件同步, 不以等待時間同步
        let trSrc = createRecorder() //WDataSourceFromCsv(轉交fsWatchFolder之onTrace)
        let trSyncer = createRecorder() //WDataSyncer
        let gateCsv = createGate() //來源偵測到之change事件數
        let gateDb = createGate() //同步至目標之change事件數

        //每次寫入後預期來源偵測到(以及同步至目標)之change事件數, 第4筆因同時修改第3筆故為insert與save共2件
        let numEvents = [1, 1, 1, 2, 1, 1, 1]

        //triggerData, 每筆資料(含修改)寫入後, 等來源偵測到且同步至目標才寫下一筆, 使每筆各自被偵測與同步一次
        let triggerData = async () => {
            let n = 0
            let i = -1
            let h = 0
            let num = 0
            for (let numEvent of numEvents) {
                n++
                i++
                let t = ot('2020-01-01T00:00:00', 'YYYY-MM-DDTHH:mm:ss')
                let tn = t.add(i, 'minute')
                let ctn = tn.format('YYYY-MM-DDTHH:mm:ss')
                let c = `${ctn}, ${123 + (i + 1) / 1000}\n`
                fs.appendFileSync(`${fdSrcCsv}/h${h}.csv`, c, 'utf8')
                // console.log('push data', `i=${i}, n=${n}`)
                ms_trigger.push({ 'push data': `i=${i}, n=${n}` })
                if (h === 0 && n === 4) {
                    let c = fs.readFileSync(`${fdSrcCsv}/h${h}.csv`, 'utf8')
                    c = c.replace(`2020-01-01T00:02:00, 123.003`, `2020-01-01T00:02:00, 234.903`)
                    fs.writeFileSync(`${fdSrcCsv}/h${h}.csv`, c, 'utf8')
                    // console.log('modify data', `i=${i}, n=${n}, 123.003->234.903`)
                    ms_trigger.push({ 'modify data': `i=${i}, n=${n}, 123.003->234.903` })
                }
                if (n >= 5) {
                    n = 0
                    h++
                }
                num += numEvent
                await gateCsv.until(num, 'source change')
                await gateDb.until(num, 'syncer change')
            }
        }

        let omSrc = null
        if (true) {
            omSrc = WDataSourceFromCsv(fdSrcCsv, {
                heads: ['id', 'value'],
                key: 'id',
                onTrace: trSrc.onTrace,
            })
            omSrc.on('change', (msg) => {
                // console.log('WDataSourceFromCsv change msg', msg)
                ms_csv.push({ 'detect data': `type[${msg.type}], data[${JSON.stringify(msg.ltdtFmt[0])}]` })
                gateCsv.hit()
            })
        }

        let omTar = null
        if (true) {
            let opt = {
                // url: 'mongodb://username:password@127.0.0.1:27017',
                url: `${fdSrcDb}/db.json`,
                db: 'wsyner',
                cl: 'sensor',
            }
            omTar = WOrm(opt)
        }

        let ev = WDataSyncer('by-orm', {
            src: omSrc,
            tar: omTar,
            key: 'id',
            timeInterval: 50, //同步間隔, 正確性不依賴其長短
            onTrace: trSyncer.onTrace,
        })
        ev.on('change', (msg) => {
            // console.log('WDataSyncer change msg', msg)
            ms_db.push({ 'sync data': JSON.stringify(msg) })
            gateDb.hit()
        })
        ev.on('change-all', (msg) => {
            // console.log('WDataSyncer change-all msg', msg)
        })

        //等chokidar初始掃描完成, 其後新增之檔案才會被偵測到(原以首筆資料延後3s寫入隱含等待)
        await trSrc.next((e) => e.type === 'ready', 'watcher ready')

        //triggerData, 末筆資料亦等來源偵測到且同步至目標才結束
        await triggerData()

        //其後兩輪同步須無異動, 不再發送事件(原以固定等待觀察, 改以輪數觀察)
        trSyncer.skip()
        await trSyncer.next((e) => e.type === 'done' && !e.b, 'idle round 1')
        await trSyncer.next((e) => e.type === 'done' && !e.b, 'idle round 2')

        //clear
        omSrc.clear()
        // omTar.clear() //WOrm自動釋放不須clear
        ev.clear()

        w.fsDeleteFolder(fdSrcCsv)
        w.fsDeleteFolder(fdSrcDb)

        let ms = [
            ...ms_trigger,
            ...ms_csv,
            ...ms_db,
        ]
        // console.log('ms', ms)
        // fs.writeFileSync('./temp.json', JSON.stringify(ms), 'utf8')
        return ms
    }
    // await test()
    //     .catch((err) => {
    //         console.log(err)
    //     })
    let ms = [
        { 'push data': 'i=0, n=1' },
        { 'push data': 'i=1, n=2' },
        { 'push data': 'i=2, n=3' },
        { 'push data': 'i=3, n=4' },
        { 'modify data': 'i=3, n=4, 123.003->234.903' },
        { 'push data': 'i=4, n=5' },
        { 'push data': 'i=5, n=1' },
        { 'push data': 'i=6, n=2' },
        {
            'detect data': 'type[insert], data[{"id":"2020-01-01T00:00:00","value":" 123.001"}]'
        },
        {
            'detect data': 'type[insert], data[{"id":"2020-01-01T00:01:00","value":" 123.002"}]'
        },
        {
            'detect data': 'type[insert], data[{"id":"2020-01-01T00:02:00","value":" 123.003"}]'
        },
        {
            'detect data': 'type[insert], data[{"id":"2020-01-01T00:03:00","value":" 123.004"}]'
        },
        {
            'detect data': 'type[save], data[{"id":"2020-01-01T00:02:00","value":" 234.903"}]'
        },
        {
            'detect data': 'type[insert], data[{"id":"2020-01-01T00:04:00","value":" 123.005"}]'
        },
        {
            'detect data': 'type[insert], data[{"id":"2020-01-01T00:05:00","value":" 123.006"}]'
        },
        {
            'detect data': 'type[insert], data[{"id":"2020-01-01T00:06:00","value":" 123.007"}]'
        },
        {
            'sync data': '{"type":"insert","items":[{"id":"2020-01-01T00:00:00","value":" 123.001"}]}'
        },
        {
            'sync data': '{"type":"insert","items":[{"id":"2020-01-01T00:01:00","value":" 123.002"}]}'
        },
        {
            'sync data': '{"type":"insert","items":[{"id":"2020-01-01T00:02:00","value":" 123.003"}]}'
        },
        {
            'sync data': '{"type":"insert","items":[{"id":"2020-01-01T00:03:00","value":" 123.004"}]}'
        },
        {
            'sync data': '{"type":"save","items":[{"id":"2020-01-01T00:02:00","value":" 234.903"}]}'
        },
        {
            'sync data': '{"type":"insert","items":[{"id":"2020-01-01T00:04:00","value":" 123.005"}]}'
        },
        {
            'sync data': '{"type":"insert","items":[{"id":"2020-01-01T00:05:00","value":" 123.006"}]}'
        },
        {
            'sync data': '{"type":"insert","items":[{"id":"2020-01-01T00:06:00","value":" 123.007"}]}'
        }
    ]

    it(`should return '${JSON.stringify(ms)}' when run test'`, async function() {
        let r = await test()
        let rr = ms
        assert.strict.deepStrictEqual(r, rr)
    })

})
