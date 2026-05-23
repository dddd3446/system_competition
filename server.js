const express = require('express');
const fs = require('fs');
const scoreLogic = require('./lib/scoreLogic');
const app = express();
const port = 3000;

app.use(express.json());
app.use(express.static('public'));

const dataFile = './data.json';

let athletes = []; 
let leaderboard = []; 
let eventCatalogOverrides = {};
// 🚨 新增：记录所有连接上来的裁判设备
let activeJudges = {}; 

function createEmptyMatch() {
    return { matchId: "", event: "尚未开始", athlete: "等待检录...", judgeCount: 3, scores: {}, headJudgePoint: 0 };
}
let courts = { "场地A": { currentMatch: createEmptyMatch(), queue: [] } };

if (fs.existsSync(dataFile)) {
    try {
        const rawData = fs.readFileSync(dataFile, 'utf8');
        if (rawData.trim() !== "") {
            const savedData = JSON.parse(rawData);
            athletes = savedData.athletes || [];
            leaderboard = savedData.leaderboard || [];
            eventCatalogOverrides = savedData.eventCatalogOverrides || {};
            if (savedData.courts && Object.keys(savedData.courts).length > 0) courts = savedData.courts;
        }
    } catch (e) { console.error("⚠️ Data file error"); }
}

function saveData() {
    fs.writeFileSync(dataFile, JSON.stringify({ athletes, leaderboard, courts, eventCatalogOverrides }, null, 2));
}

// 定期清理断线超过 10 分钟的设备
setInterval(() => {
    let now = Date.now();
    for (let pin in activeJudges) {
        if (now - activeJudges[pin].lastSeen > 10 * 60 * 1000) delete activeJudges[pin];
    }
}, 60000);

// API
app.get('/api/admin-data', (req, res) => res.json({ courts, leaderboard, athletes, activeJudges }));

app.get('/api/event-catalog', (req, res) => {
    const events = [...new Set([
        ...athletes.map(a => a.event),
        ...leaderboard.map(l => l.event),
    ].filter(Boolean))];
    res.json({ catalog: scoreLogic.buildEventCatalog(events, eventCatalogOverrides) });
});

app.post('/api/event-catalog-override', (req, res) => {
    const { event, category } = req.body;
    if (!event) return res.json({ success: false, message: '缺少项目名称' });
    if (!category || category === 'auto') {
        delete eventCatalogOverrides[event];
    } else if (scoreLogic.VALID_CATEGORIES.includes(category)) {
        eventCatalogOverrides[event] = category;
    } else {
        return res.json({ success: false, message: '无效分类' });
    }
    saveData();
    res.json({ success: true });
});

app.get('/api/rank-report', (req, res) => {
    const options = {
        require_dual: req.query.require_dual !== 'false',
        min_events: Math.max(1, parseInt(req.query.min_events, 10) || scoreLogic.DEFAULT_OPTIONS.min_events),
        show_only_top1: req.query.show_only_top1 === 'true',
    };
    res.json(scoreLogic.computeRankings(leaderboard, options, eventCatalogOverrides));
});

// 🚨 裁判设备心跳侦测与获取派发任务
app.post('/api/judge-ping', (req, res) => {
    const { pin } = req.body;
    if (!activeJudges[pin]) activeJudges[pin] = { court: "", role: "", lastSeen: Date.now() };
    else activeJudges[pin].lastSeen = Date.now();
    
    let assignment = activeJudges[pin];
    let currentMatch = { event: "等待分配", athlete: "暂无比赛" };
    if (assignment.court && courts[assignment.court]) currentMatch = courts[assignment.court].currentMatch;

    res.json({ success: true, assignment: { court: assignment.court, role: assignment.role }, currentMatch });
});

// 🚨 总后台执行派发指令
app.post('/api/assign-judge', (req, res) => {
    const { pin, court, role } = req.body;
    if (!activeJudges[pin]) activeJudges[pin] = {};
    activeJudges[pin].court = court;
    activeJudges[pin].role = role;
    activeJudges[pin].lastSeen = Date.now();
    res.json({ success: true });
});

app.post('/api/delete-judge', (req, res) => {
    const { pin } = req.body;
    if (pin && activeJudges[pin]) delete activeJudges[pin];
    res.json({ success: true });
});

app.post('/api/add-court', (req, res) => { const { courtName } = req.body; if (courtName && !courts[courtName]) { courts[courtName] = { currentMatch: createEmptyMatch(), queue: [] }; saveData(); } res.json({ success: true }); });
app.post('/api/delete-court', (req, res) => { const { courtName } = req.body; if (courts[courtName]) { delete courts[courtName]; saveData(); } res.json({ success: true }); });
app.post('/api/save-athlete', (req, res) => { const { id, event, athlete } = req.body; if (id) { let index = athletes.findIndex(a => String(a.id) === String(id)); if (index !== -1) { athletes[index].event = event; athletes[index].athlete = athlete; } } else { athletes.push({ id: Date.now().toString(), event, athlete }); } saveData(); res.json({ success: true }); });
app.post('/api/import-athletes', (req, res) => { const { athletesList } = req.body; if (athletesList && Array.isArray(athletesList)) { athletesList.forEach((item, index) => { athletes.push({ id: Date.now().toString() + index, event: item.event, athlete: item.athlete }); }); saveData(); } res.json({ success: true }); });
app.post('/api/delete-athlete', (req, res) => { const { id } = req.body; athletes = athletes.filter(a => String(a.id) !== String(id)); saveData(); res.json({ success: true }); });
app.post('/api/delete-score', (req, res) => { const { id } = req.body; leaderboard = leaderboard.filter(item => item.id !== id); saveData(); res.json({ success: true }); });
app.post('/api/batch-send', (req, res) => { const { court, athletesList, judgeCount } = req.body; if (courts[court] && athletesList && athletesList.length > 0) { const newItems = athletesList.map(a => ({...a, judgeCount: parseInt(judgeCount)})); courts[court].queue = courts[court].queue.concat(newItems); saveData(); } res.json({ success: true }); });
app.post('/api/reorder-queue', (req, res) => { const { court, oldIndex, newIndex } = req.body; if (courts[court] && courts[court].queue) { let queue = courts[court].queue; let element = queue.splice(oldIndex, 1)[0]; queue.splice(newIndex, 0, element); saveData(); } res.json({ success: true }); });
app.post('/api/next-in-queue', (req, res) => { const { court } = req.body; if (courts[court].queue.length > 0) { let nextA = courts[court].queue.shift(); courts[court].currentMatch = { matchId: Date.now().toString(), event: nextA.event, athlete: nextA.athlete, judgeCount: nextA.judgeCount, scores: {}, headJudgePoint: 0 }; } else { courts[court].currentMatch = createEmptyMatch(); } saveData(); res.json({ success: true }); });
app.post('/api/clear-queue', (req, res) => { const { court } = req.body; if(courts[court]) courts[court].queue = []; saveData(); res.json({ success: true }); });
app.post('/api/remove-from-queue', (req, res) => { const { court, index } = req.body; if (courts[court] && courts[court].queue) { courts[court].queue.splice(index, 1); saveData(); } res.json({ success: true }); });

// 🚨 接收分数逻辑改为认证 PIN 码
app.post('/api/submit-score', (req, res) => {
    const { pin, score } = req.body;
    let judge = activeJudges[pin];
    
    if (!judge || !judge.court || !judge.role) return res.json({ success: false, message: "⚠️ 您的设备尚未被分配场地！" });
    let court = judge.court;
    let role = judge.role;
    if (!courts[court]) return res.json({ success: false, message: "⚠️ 分配的场地已失效" });
    
    let currentMatch = courts[court].currentMatch;
    if (currentMatch.athlete === "等待检录...") return res.json({ success: false, message: "该场地尚未发送选手" });
    
    if (role === "裁判长") currentMatch.headJudgePoint = parseFloat(score);
    else currentMatch.scores[role] = parseFloat(score);

    const judgeKeys = Object.keys(currentMatch.scores);
    if (judgeKeys.length === currentMatch.judgeCount) {
        let scoresArray = judgeKeys.map(k => currentMatch.scores[k]);
        let hasWarning = false;
        if (scoresArray.length >= 2) if (Math.max(...scoresArray) - Math.min(...scoresArray) > 0.5) hasWarning = true;

        let finalScore = 0;
        if (currentMatch.judgeCount === 3) finalScore = (scoresArray.reduce((a, b) => a + b, 0) / 3) + currentMatch.headJudgePoint;
        else {
            scoresArray.sort((a, b) => a - b);
            finalScore = ((scoresArray[1] + scoresArray[2] + scoresArray[3]) / 3) + currentMatch.headJudgePoint;
        }

        const newRecord = { id: currentMatch.matchId, event: currentMatch.event, athlete: currentMatch.athlete, finalScore: parseFloat(finalScore.toFixed(3)), rawScores: { ...currentMatch.scores }, headJudgePoint: currentMatch.headJudgePoint, hasWarning };
        const idx = leaderboard.findIndex(item => item.id === currentMatch.matchId);
        if (idx !== -1) leaderboard[idx] = newRecord;
        else leaderboard.push(newRecord);
        saveData();
    }
    res.json({ success: true, message: "✅ 给分成功！" });
});

app.listen(port, () => console.log(`✅ 伺服器启动于 http://localhost:${port}`));