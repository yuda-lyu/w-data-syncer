# w-data-syncer
A tool for data detection and synchronization.

![language](https://img.shields.io/badge/language-JavaScript-orange.svg) 
[![npm version](http://img.shields.io/npm/v/w-data-syncer.svg?style=flat)](https://npmjs.org/package/w-data-syncer) 
[![license](https://img.shields.io/npm/l/w-data-syncer.svg?style=flat)](https://npmjs.org/package/w-data-syncer) 
[![npm download](https://img.shields.io/npm/dt/w-data-syncer.svg)](https://npmjs.org/package/w-data-syncer) 
[![npm download](https://img.shields.io/npm/dm/w-data-syncer.svg)](https://npmjs.org/package/w-data-syncer) 
[![jsdelivr download](https://img.shields.io/jsdelivr/npm/hm/w-data-syncer.svg)](https://www.jsdelivr.com/package/npm/w-data-syncer)

## Documentation
To view documentation or get support, visit [docs](https://yuda-lyu.github.io/w-data-syncer/global.html).

## Installation
### Using npm(ES6 module):
```alias
npm i w-data-syncer
```

#### Example for WDataSourceFromCsv:
> **Link:** [[dev source code](https://github.com/yuda-lyu/w-data-syncer/blob/master/g-sfcsv.mjs)]
```alias
import fs from 'fs'
// import _ from 'lodash-es'
import w from 'wsemi'
import ot from 'dayjs'
import WDataSourceFromCsv from './src/WDataSourceFromCsv.mjs'

let test = () => {
    let pm = w.genPm()

    let ms_trigger = []
    let ms_csv = []

    let fdSrc = `./_test_sfcsv`

    w.fsCleanFolder(fdSrc)

    let n = 0
    let i = -1
    let h = 0
    let timer = setInterval(() => {
        n++
        i++
        let t = ot('2020-01-01T00:00:00', 'YYYY-MM-DDTHH:mm:ss')
        let tn = t.add(i, 'minute')
        let ctn = tn.format('YYYY-MM-DDTHH:mm:ss')
        let c = `${ctn}, ${123 + (i + 1) / 1000}\n`
        fs.appendFileSync(`${fdSrc}/h${h}.csv`, c, 'utf8')
        console.log('push data', `i=${i}, n=${n}`)
        ms_trigger.push({ 'push data': `i=${i}, n=${n}` })
        if (h === 0 && n === 4) {
            let c = fs.readFileSync(`${fdSrc}/h${h}.csv`, 'utf8')
            c = c.replace(`2020-01-01T00:02:00, 123.003`, `2020-01-01T00:02:00, 234.903`)
            fs.writeFileSync(`${fdSrc}/h${h}.csv`, c, 'utf8')
            console.log('modify data', `i=${i}, n=${n}, 123.003->234.903`)
            ms_trigger.push({ 'modify data': `i=${i}, n=${n}, 123.003->234.903` })
        }
        if (n >= 5) {
            n = 0
            h++
        }
        if (h === 1 && n === 2) {
            clearInterval(timer)
            omSrc.clear()
            w.fsDeleteFolder(fdSrc)

            let ms = [
                ...ms_trigger,
                ...ms_csv,
            ]
            console.log('ms', ms)
            pm.resolve(ms)
        }
    }, 3000)
    let omSrc = WDataSourceFromCsv(fdSrc, {
        heads: ['time', 'value'],
        key: 'time',
    })
    omSrc.on('change', (msg) => {
        console.log('WDataSourceFromCsv change msg', msg)
        ms_csv.push({ 'detect data': `type[${msg.type}], data[${JSON.stringify(msg.ltdt[0])}]` })
    })

    return pm
}
await test()
    .catch((err) => {
        console.log(err)
    })
// => ms [
//   { 'push data': 'i=0, n=1' },
//   { 'push data': 'i=1, n=2' },
//   { 'push data': 'i=2, n=3' },
//   { 'push data': 'i=3, n=4' },
//   { 'modify data': 'i=3, n=4, 123.003->234.903' },
//   { 'push data': 'i=4, n=5' },
//   { 'push data': 'i=5, n=1' },
//   { 'push data': 'i=6, n=2' },
//   {
//     'detect data': 'type[insert], data[{"time":"2020-01-01T00:00:00","value":" 123.001"}]'
//   },
//   {
//     'detect data': 'type[insert], data[{"time":"2020-01-01T00:01:00","value":" 123.002"}]'
//   },
//   {
//     'detect data': 'type[insert], data[{"time":"2020-01-01T00:02:00","value":" 123.003"}]'
//   },
//   {
//     'detect data': 'type[insert], data[{"time":"2020-01-01T00:03:00","value":" 123.004"}]'
//   },
//   {
//     'detect data': 'type[save], data[{"time":"2020-01-01T00:02:00","value":" 234.903"}]'
//   },
//   {
//     'detect data': 'type[insert], data[{"time":"2020-01-01T00:04:00","value":" 123.005"}]'
//   },
//   {
//     'detect data': 'type[insert], data[{"time":"2020-01-01T00:05:00","value":" 123.006"}]'
//   }
// ]
```

#### Example for WDataSyncer:
> **Link:** [[dev source code](https://github.com/yuda-lyu/w-data-syncer/blob/master/g-syncer.mjs)]
```alias
import fs from 'fs'
// import _ from 'lodash-es'
import w from 'wsemi'
import ot from 'dayjs'
// import WOrm from 'w-orm-mongodb/src/WOrmMongodb.mjs' //自行選擇引用ORM
import WOrm from 'w-orm-lowdb/src/WOrmLowdb.mjs' //自行選擇引用ORM
import WDataSourceFromCsv from './src/WDataSourceFromCsv.mjs'
import WDataSyncer from './src/WDataSyncer.mjs'

let test = async () => {
    let ms_trigger = []
    let ms_csv = []
    let ms_db = []

    let fdSrcCsv = `./_test_syncer_csv`
    let fdSrcDb = `./_test_syncer_db`

    w.fsCleanFolder(fdSrcCsv)
    w.fsCleanFolder(fdSrcDb)

    let triggerData = () => {
        let pm = w.genPm()

        let n = 0
        let i = -1
        let h = 0
        let timer = setInterval(() => {
            n++
            i++
            let t = ot('2020-01-01T00:00:00', 'YYYY-MM-DDTHH:mm:ss')
            let tn = t.add(i, 'minute')
            let ctn = tn.format('YYYY-MM-DDTHH:mm:ss')
            let c = `${ctn}, ${123 + (i + 1) / 1000}\n`
            fs.appendFileSync(`${fdSrcCsv}/h${h}.csv`, c, 'utf8')
            console.log('push data', `i=${i}, n=${n}`)
            ms_trigger.push({ 'push data': `i=${i}, n=${n}` })
            if (h === 0 && n === 4) {
                let c = fs.readFileSync(`${fdSrcCsv}/h${h}.csv`, 'utf8')
                c = c.replace(`2020-01-01T00:02:00, 123.003`, `2020-01-01T00:02:00, 234.903`)
                fs.writeFileSync(`${fdSrcCsv}/h${h}.csv`, c, 'utf8')
                console.log('modify data', `i=${i}, n=${n}, 123.003->234.903`)
                ms_trigger.push({ 'modify data': `i=${i}, n=${n}, 123.003->234.903` })
            }
            if (n >= 5) {
                n = 0
                h++
            }
            if (h === 1 && n === 2) {
                clearInterval(timer)
                pm.resolve()
            }
        }, 3000)

        return pm
    }

    let omSrc = null
    if (true) {
        omSrc = WDataSourceFromCsv(fdSrcCsv, {
            heads: ['id', 'value'],
            key: 'id',
        })
        omSrc.on('change', (msg) => {
            console.log('WDataSourceFromCsv change msg', msg)
            ms_csv.push({ 'detect data': JSON.stringify(msg) })
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

    let ev = WDataSyncer(omSrc, omTar, {
        key: 'id',
        timeInterval: 1000, //每秒同步
    })
    ev.on('change', (msg) => {
        console.log('WDataSyncer change msg', msg)
        ms_db.push({ 'sync data': JSON.stringify(msg) })
    })
    ev.on('change-all', (msg) => {
        console.log('WDataSyncer change-all msg', msg)
    })

    //triggerData
    await triggerData()

    //delay, 延遲3s等WDataSourceFromCsv內fsWatchFolder讀檔觸發, 1s等timer觸發, 1s等誤差, 共5s
    await w.delay(5000)

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
    console.log('ms', ms)
    // fs.writeFileSync('./temp.json', JSON.stringify(ms), 'utf8')
    return ms
}
await test()
    .catch((err) => {
        console.log(err)
    })
// => ms [
//   { 'push data': 'i=0, n=1' },
//   { 'push data': 'i=1, n=2' },
//   { 'push data': 'i=2, n=3' },
//   { 'push data': 'i=3, n=4' },
//   { 'modify data': 'i=3, n=4, 123.003->234.903' },
//   { 'push data': 'i=4, n=5' },
//   { 'push data': 'i=5, n=1' },
//   { 'push data': 'i=6, n=2' },
//   {
//     'detect data': '{"type":"insert","ltdt":[{"id":"2020-01-01T00:00:00","value":" 123.001"}]}'
//   },
//   {
//     'detect data': '{"type":"insert","ltdt":[{"id":"2020-01-01T00:01:00","value":" 123.002"}]}'
//   },
//   {
//     'detect data': '{"type":"insert","ltdt":[{"id":"2020-01-01T00:02:00","value":" 123.003"}]}'
//   },
//   {
//     'detect data': '{"type":"insert","ltdt":[{"id":"2020-01-01T00:03:00","value":" 123.004"}]}'
//   },
//   {
//     'detect data': '{"type":"save","ltdt":[{"id":"2020-01-01T00:02:00","value":" 234.903"}]}'
//   },
//   {
//     'detect data': '{"type":"insert","ltdt":[{"id":"2020-01-01T00:04:00","value":" 123.005"}]}'
//   },
//   {
//     'detect data': '{"type":"insert","ltdt":[{"id":"2020-01-01T00:05:00","value":" 123.006"}]}'
//   },
//   {
//     'detect data': '{"type":"insert","ltdt":[{"id":"2020-01-01T00:06:00","value":" 123.007"}]}'
//   },
//   {
//     'sync data': '{"type":"insert","items":[{"id":"2020-01-01T00:00:00","value":" 123.001"}]}'
//   },
//   {
//     'sync data': '{"type":"insert","items":[{"id":"2020-01-01T00:01:00","value":" 123.002"}]}'
//   },
//   {
//     'sync data': '{"type":"insert","items":[{"id":"2020-01-01T00:02:00","value":" 123.003"}]}'
//   },
//   {
//     'sync data': '{"type":"insert","items":[{"id":"2020-01-01T00:03:00","value":" 123.004"}]}'
//   },
//   {
//     'sync data': '{"type":"save","items":[{"id":"2020-01-01T00:02:00","value":" 234.903"}]}'
//   },
//   {
//     'sync data': '{"type":"insert","items":[{"id":"2020-01-01T00:04:00","value":" 123.005"}]}'
//   },
//   {
//     'sync data': '{"type":"insert","items":[{"id":"2020-01-01T00:05:00","value":" 123.006"}]}'
//   },
//   {
//     'sync data': '{"type":"insert","items":[{"id":"2020-01-01T00:06:00","value":" 123.007"}]}'
//   }
// ]
```
