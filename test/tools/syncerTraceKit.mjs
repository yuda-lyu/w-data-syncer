//syncerTraceKit.mjs: WDataSyncer與WDataSourceFromCsv之觀察回調(opt.onTrace)測試輔助, 供測試以事件(而非等待毫秒)同步
//  createRecorder: 紀錄onTrace事件, next(pred)自游標起等符合條件之下一個事件並將游標移到其後, skip()將游標移到目前最新處
//  createGate: 計數器, hit()記一次, until(n)等累計達n次; 供測試以被測物自身之事件(如change-all)為同步點
//  防懸置上限(等事件之逾時)用模組載入時保存之真實setTimeout/clearTimeout, 逾時視為失敗(被測物該發生之事件沒有發生), 非以時間斷言行為
let realSetTimeout = setTimeout
let realClearTimeout = clearTimeout


//msGuard, 防懸置上限(毫秒), 小於mocha之timeout(180000), 讓卡住時以帶近況之錯誤失敗而非mocha逾時
let msGuard = 90000


function guard(pm, label, getTail) {
    return new Promise((resolve, reject) => {
        let t = realSetTimeout(() => {
            let tail = getTail ? getTail() : ''
            reject(new Error(`wait timeout(guard ${msGuard}ms): ${label}${tail ? `, ${tail}` : ''}`))
        }, msGuard)
        pm.then((v) => {
            realClearTimeout(t)
            resolve(v)
        }, (err) => {
            realClearTimeout(t)
            reject(err)
        })
    })
}


function createRecorder() {
    let events = []
    let cursor = 0
    let waiters = []

    //onTrace, 傳給被測物; 事件為凍結物件, 先紀錄再通知等待者
    let onTrace = (e) => {
        events.push(e)
        let ws = waiters
        waiters = []
        for (let w of ws) {
            if (!w.tryMatch()) {
                waiters.push(w)
            }
        }
    }

    //next, 自游標起找第一個符合pred之事件, 找到後游標移到其後; 尚未發生則等其發生
    let next = (pred, label = 'event') => {
        let pm = new Promise((resolve) => {
            let w = {
                tryMatch: () => {
                    for (let i = cursor; i < events.length; i++) {
                        if (pred(events[i])) {
                            cursor = i + 1
                            resolve(events[i])
                            return true
                        }
                    }
                    return false
                },
            }
            if (!w.tryMatch()) {
                waiters.push(w)
            }
        })
        return guard(pm, label, () => `${events.length} events recorded, last: ${JSON.stringify(events.slice(-5))}`)
    }

    //skip, 游標移到目前最新處, 其後只看之後才發生之事件
    let skip = () => {
        cursor = events.length
    }

    return {
        events,
        onTrace,
        next,
        skip,
    }
}


function createGate() {
    let n = 0
    let waiters = []

    let hit = () => {
        n++
        let ws = waiters
        waiters = []
        for (let w of ws) {
            if (n >= w.count) {
                w.resolve()
            }
            else {
                waiters.push(w)
            }
        }
    }

    //until, 等累計達count次
    let until = (count, label = 'gate') => {
        let pm = new Promise((resolve) => {
            if (n >= count) {
                resolve()
            }
            else {
                waiters.push({ count, resolve })
            }
        })
        return guard(pm, `${label} until ${count}`, () => `hit ${n} times`)
    }

    return {
        hit,
        until,
        count: () => n,
    }
}


//createDeferred, 手動放行之閘門: 被測物之回呼回傳open.pm, 測試決定何時放行
function createDeferred() {
    let open = null
    let pm = new Promise((resolve) => {
        open = resolve
    })
    return { pm, open: () => open() }
}


export { createRecorder, createGate, createDeferred, guard }
