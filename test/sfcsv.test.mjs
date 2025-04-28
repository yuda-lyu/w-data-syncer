import assert from 'assert'
import fs from 'fs'
import _ from 'lodash-es'
import w from 'wsemi'
import ot from 'dayjs'
import WDataSourceFromCsv from '../src/WDataSourceFromCsv.mjs'
// import WDataSyncer from '../src/WDataSyncer.mjs'


describe('sfcsv', function() {

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
            'detect data': 'type[insert], data[{"time":"2020-01-01T00:00:00","value":" 123.001"}]'
        },
        {
            'detect data': 'type[insert], data[{"time":"2020-01-01T00:01:00","value":" 123.002"}]'
        },
        {
            'detect data': 'type[insert], data[{"time":"2020-01-01T00:02:00","value":" 123.003"}]'
        },
        {
            'detect data': 'type[insert], data[{"time":"2020-01-01T00:03:00","value":" 123.004"}]'
        },
        {
            'detect data': 'type[save], data[{"time":"2020-01-01T00:02:00","value":" 234.903"}]'
        },
        {
            'detect data': 'type[insert], data[{"time":"2020-01-01T00:04:00","value":" 123.005"}]'
        },
        {
            'detect data': 'type[insert], data[{"time":"2020-01-01T00:05:00","value":" 123.006"}]'
        }
    ]

    it(`should return '${JSON.stringify(ms)}' when run test'`, async function() {
        let r = await test()
        let rr = ms
        assert.strict.deepStrictEqual(r, rr)
    })

})
