import assert from 'assert'
import fs from 'fs'
import _ from 'lodash-es'
import w from 'wsemi'
import ot from 'dayjs'
import WDataSourceFromCsv from '../src/WDataSourceFromCsv.mjs'
// import WDataSyncer from '../src/WDataSyncer.mjs'
import { createRecorder, createGate } from './tools/syncerTraceKit.mjs'


describe('sfcsv', function() {

    let cvLtdt = (ltdt) => {
        ltdt = _.cloneDeep(ltdt) //須與記憶體脫勾, 否則會連動WDataSyncer內記憶體數據, 進而影響偵測差異
        ltdt = _.map(ltdt, (dt) => {
            _.each(dt, (v, k) => {
                if (w.isnum(v)) {
                    v = w.cdbl(v)
                    dt[k] = v
                }
                if (w.isestr(v)) {
                    v = _.trim(v)
                    dt[k] = v
                }
            })
            return dt
        })
        return ltdt
    }

    let test = async () => {
        let ms_trigger = []
        let ms_csv = []

        let fdSrc = `./_test_sfcsv`

        w.fsCleanFolder(fdSrc)

        //以onTrace與被測物自身事件同步, 不以等待時間同步
        let tr = createRecorder()
        let gate = createGate() //來源偵測到之change事件數

        let omSrc = WDataSourceFromCsv(fdSrc, {
            heads: ['time', 'value'],
            key: 'time',
            converter: cvLtdt,
            onTrace: tr.onTrace,
        })
        omSrc.on('change', (msg) => {
            // console.log('WDataSourceFromCsv change msg', msg)
            ms_csv.push({ 'detect data': `type[${msg.type}], data[${JSON.stringify(msg.ltdtFmt[0])}]` })
            gate.hit()
        })

        //等chokidar初始掃描完成, 其後新增之檔案才會被偵測到(原以首筆資料延後3s寫入隱含等待)
        await tr.next((e) => e.type === 'ready', 'watcher ready')

        //每次寫入後預期來源偵測到之change事件數, 第4筆因同時修改第3筆故為insert與save共2件; 末筆寫入後即clear, 不等偵測(同原測試, 故期望值不含末筆之偵測)
        let numEvents = [1, 1, 1, 2, 1, 1, 0]

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
            fs.appendFileSync(`${fdSrc}/h${h}.csv`, c, 'utf8')
            // console.log('push data', `i=${i}, n=${n}`)
            ms_trigger.push({ 'push data': `i=${i}, n=${n}` })
            if (h === 0 && n === 4) {
                let c = fs.readFileSync(`${fdSrc}/h${h}.csv`, 'utf8')
                c = c.replace(`2020-01-01T00:02:00, 123.003`, `2020-01-01T00:02:00, 234.903`)
                fs.writeFileSync(`${fdSrc}/h${h}.csv`, c, 'utf8')
                // console.log('modify data', `i=${i}, n=${n}, 123.003->234.903`)
                ms_trigger.push({ 'modify data': `i=${i}, n=${n}, 123.003->234.903` })
            }
            if (n >= 5) {
                n = 0
                h++
            }
            num += numEvent
            if (numEvent > 0) {
                await gate.until(num, 'source change')
            }
        }

        omSrc.clear()
        w.fsDeleteFolder(fdSrc)

        let ms = [
            ...ms_trigger,
            ...ms_csv,
        ]
        // console.log('ms', ms)
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
            'detect data': 'type[insert], data[{"time":"2020-01-01T00:00:00","value":123.001}]'
        },
        {
            'detect data': 'type[insert], data[{"time":"2020-01-01T00:01:00","value":123.002}]'
        },
        {
            'detect data': 'type[insert], data[{"time":"2020-01-01T00:02:00","value":123.003}]'
        },
        {
            'detect data': 'type[insert], data[{"time":"2020-01-01T00:03:00","value":123.004}]'
        },
        {
            'detect data': 'type[save], data[{"time":"2020-01-01T00:02:00","value":234.903}]'
        },
        {
            'detect data': 'type[insert], data[{"time":"2020-01-01T00:04:00","value":123.005}]'
        },
        {
            'detect data': 'type[insert], data[{"time":"2020-01-01T00:05:00","value":123.006}]'
        }
    ]

    it(`should return '${JSON.stringify(ms)}' when run test'`, async function() {
        let r = await test()
        let rr = ms
        assert.strict.deepStrictEqual(r, rr)
    })

})
