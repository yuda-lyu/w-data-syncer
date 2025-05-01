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
            ms_csv.push({ 'detect data': `type[${msg.type}], data[${JSON.stringify(msg.ltdtFmt[0])}]` })
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
//     'detect data': 'type[insert], data[{"id":"2020-01-01T00:00:00","value":" 123.001"}]'
//   },
//   {
//     'detect data': 'type[insert], data[{"id":"2020-01-01T00:01:00","value":" 123.002"}]'
//   },
//   {
//     'detect data': 'type[insert], data[{"id":"2020-01-01T00:02:00","value":" 123.003"}]'
//   },
//   {
//     'detect data': 'type[insert], data[{"id":"2020-01-01T00:03:00","value":" 123.004"}]'
//   },
//   {
//     'detect data': 'type[save], data[{"id":"2020-01-01T00:02:00","value":" 234.903"}]'
//   },
//   {
//     'detect data': 'type[insert], data[{"id":"2020-01-01T00:04:00","value":" 123.005"}]'
//   },
//   {
//     'detect data': 'type[insert], data[{"id":"2020-01-01T00:05:00","value":" 123.006"}]'
//   },
//   {
//     'detect data': 'type[insert], data[{"id":"2020-01-01T00:06:00","value":" 123.007"}]'
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


//node g-syncer.mjs
