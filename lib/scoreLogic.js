/**
 * 成績處理核心 (Rank & Filter) + 項目自動分類
 * 對應原試算表：note_2、qual_mask、MAX 分數、分組排名、note_extract、note_keys
 */

const U_GROUP_RE = /\b(U\d+)\b/i;
const GENDER_RE = /(男子组|女子组|男子|女子)/;
const FIST_RE = /拳/;
const WEAPON_RE = /刀|剑|劍|枪|槍|棍|扇|械/;

const DEFAULT_OPTIONS = {
  require_dual: true,
  min_events: 2,
  show_only_top1: false,
};

/** 項目名稱是否含 U 分組 */
function hasAgeGroup(eventName) {
  return Boolean(eventName && U_GROUP_RE.test(eventName));
}

/** 從項目名稱拆解年齡組、性別、核心項目名 */
function parseEventName(eventName) {
  if (!eventName || !hasAgeGroup(eventName)) {
    return {
      raw: eventName || '',
      valid: false,
      ageGroup: '',
      gender: '',
      genderLabel: '',
      extracted: '',
      category: '未分類',
    };
  }

  const ageMatch = eventName.match(U_GROUP_RE);
  const ageGroup = (ageMatch[1] || '').toUpperCase();
  const genderMatch = eventName.match(GENDER_RE);
  const genderLabel = genderMatch ? genderMatch[1] : '';
  const gender = genderLabel.includes('女') ? '女子' : genderLabel.includes('男') ? '男子' : '';

  const extracted = extractEventCore(eventName, ageGroup, genderLabel);
  const category = classifyExtractedName(extracted);

  return {
    raw: eventName,
    valid: true,
    ageGroup,
    gender,
    genderLabel,
    extracted,
    category,
  };
}

/** REGEXEXTRACT：U 分組與性別組之間的文字 */
function extractEventCore(eventName, ageGroup, genderLabel) {
  let core = eventName;
  if (ageGroup) {
    core = core.replace(new RegExp(`^\\s*${ageGroup}\\s*`, 'i'), '');
  }
  if (genderLabel) {
    core = core.replace(new RegExp(`\\s*${genderLabel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`), '');
  }
  return core.trim();
}

/** note_keys：拳類 / 器械 / 未分類 */
function classifyExtractedName(extracted) {
  if (!extracted) return '未分類';
  if (FIST_RE.test(extracted)) return '拳类';
  if (WEAPON_RE.test(extracted)) return '器械';
  return '未分類';
}

const VALID_CATEGORIES = ['拳类', '器械', '未分類'];

function resolveCategory(eventName, overrides = {}) {
  if (overrides[eventName] && VALID_CATEGORIES.includes(overrides[eventName])) {
    return overrides[eventName];
  }
  return parseEventName(eventName).category;
}

function parseEventNameWithOverrides(eventName, overrides = {}) {
  const parsed = parseEventName(eventName);
  const autoCategory = parsed.category;
  const overridden = Boolean(overrides[eventName] && VALID_CATEGORIES.includes(overrides[eventName]));
  if (overridden) parsed.category = overrides[eventName];
  parsed.autoCategory = autoCategory;
  parsed.overridden = overridden;
  return parsed;
}

/** 第二段：從項目列表建立自動化選單（含分類） */
function buildEventCatalog(eventNames, overrides = {}) {
  const seen = new Set();
  const rows = [];

  for (const name of eventNames) {
    if (!name || seen.has(name)) continue;
    seen.add(name);
    const parsed = parseEventName(name);
    const autoCategory = parsed.category;
    const overridden = Boolean(overrides[name] && VALID_CATEGORIES.includes(overrides[name]));
    const category = overridden ? overrides[name] : autoCategory;
    rows.push({
      event: name,
      extracted: parsed.extracted || name,
      ageGroup: parsed.ageGroup,
      gender: parsed.gender,
      autoCategory,
      category,
      overridden,
      valid: parsed.valid,
    });
  }

  rows.sort((a, b) => {
    if (a.ageGroup !== b.ageGroup) return (a.ageGroup || '').localeCompare(b.ageGroup || '');
    if (a.gender !== b.gender) return (a.gender || '').localeCompare(b.gender || '');
    return (a.extracted || '').localeCompare(b.extracted || '');
  });

  return rows;
}

/**
 * 預處理 RawData（leaderboard 成績列）
 * - 僅保留含 U 分組的項目
 * - 附拆解欄位
 */
function preprocessRawData(rawData, overrides = {}) {
  return rawData
    .filter((row) => row && row.athlete != null && row.event != null)
    .map((row) => {
      const parsed = parseEventNameWithOverrides(row.event, overrides);
      const score = Number(row.finalScore);
      return {
        ...row,
        score: Number.isFinite(score) ? score : 0,
        parsed,
        included: parsed.valid,
      };
    })
    .filter((row) => row.included);
}

/** 同一選手、同一項目多筆成績 → 取 MAX */
function maxScoreByAthleteEvent(rows) {
  const map = new Map();

  for (const row of rows) {
    const key = `${row.athlete}\0${row.event}`;
    const prev = map.get(key);
    if (!prev || row.score > prev.score) {
      map.set(key, {
        athlete: row.athlete,
        event: row.event,
        score: row.score,
        parsed: row.parsed,
        ids: prev ? [...prev.ids, row.id].filter(Boolean) : [row.id].filter(Boolean),
      });
    } else if (row.id) {
      prev.ids.push(row.id);
    }
  }

  return [...map.values()];
}

/** qual_mask：雙項 + 最少場次 */
function passesQualification(athleteRows, options) {
  const categories = new Set(athleteRows.map((r) => r.parsed.category));
  const eventCount = athleteRows.length;

  if (eventCount < options.min_events) return false;
  if (options.require_dual) {
    if (!categories.has('拳类') || !categories.has('器械')) return false;
  }
  return true;
}

/** 依年齡組 + 性別分組排名 */
function computeRankings(rawData, userOptions = {}, overrides = {}) {
  const options = { ...DEFAULT_OPTIONS, ...userOptions };
  const cleaned = preprocessRawData(rawData, overrides);
  const maxed = maxScoreByAthleteEvent(cleaned);

  /** 按选手 + 年龄组 + 性别分组（同一人不同 U 组分开计） */
  const byAthleteGroup = new Map();
  for (const row of maxed) {
    const bucketKey = `${row.athlete}\0${row.parsed.ageGroup}\0${row.parsed.gender}`;
    const list = byAthleteGroup.get(bucketKey) || [];
    list.push(row);
    byAthleteGroup.set(bucketKey, list);
  }

  const qualified = [];
  const disqualified = [];

  for (const [, rows] of byAthleteGroup) {
    const eventScores = rows.map((r) => r.score);
    const bestScore = eventScores.length > 0 ? Math.max(...eventScores) : 0;

    const entry = {
      athlete: rows[0].athlete,
      ageGroup: rows[0].parsed.ageGroup,
      gender: rows[0].parsed.gender,
      events: rows.map((r) => ({
        event: r.event,
        extracted: r.parsed.extracted,
        category: r.parsed.category,
        score: r.score,
      })),
      /** 综合排名依据：该组内所有项目分数的最大值（绝不相加） */
      bestScore,
      totalScore: bestScore,
      fistMax: Math.max(0, ...rows.filter((r) => r.parsed.category === '拳类').map((r) => r.score)),
      weaponMax: Math.max(0, ...rows.filter((r) => r.parsed.category === '器械').map((r) => r.score)),
    };
    if (passesQualification(rows, options)) qualified.push(entry);
    else disqualified.push({ ...entry, reason: buildDisqualifyReason(rows, options) });
  }

  const groups = new Map();
  for (const entry of qualified) {
    const key = `${entry.ageGroup}|${entry.gender}`;
    const list = groups.get(key) || [];
    list.push(entry);
    groups.set(key, list);
  }

  const rankings = [];
  for (const [key, list] of groups) {
    const [ageGroup, gender] = key.split('|');
    list.sort((a, b) => b.bestScore - a.bestScore);

    let rank = 0;
    let prevScore = null;
    list.forEach((entry, idx) => {
      if (entry.bestScore !== prevScore) {
        rank = idx + 1;
        prevScore = entry.bestScore;
      }
      rankings.push({
        ...entry,
        rank,
        groupKey: key,
        ageGroup,
        gender,
      });
    });
  }

  rankings.sort((a, b) => {
    if (a.ageGroup !== b.ageGroup) return a.ageGroup.localeCompare(b.ageGroup);
    if (a.gender !== b.gender) return a.gender.localeCompare(b.gender);
    return a.rank - b.rank;
  });

  const filtered = options.show_only_top1
    ? rankings.filter((r) => r.rank === 1)
    : rankings;

  return {
    options,
    rankings: filtered,
    allRankings: rankings,
    disqualified,
    stats: {
      rawCount: rawData.length,
      uGroupCount: cleaned.length,
      athleteCount: byAthleteGroup.size,
      qualifiedCount: qualified.length,
    },
  };
}

function buildDisqualifyReason(rows, options) {
  const reasons = [];
  const categories = new Set(rows.map((r) => r.parsed.category));
  if (rows.length < options.min_events) {
    reasons.push(`场次不足（${rows.length}/${options.min_events}）`);
  }
  if (options.require_dual) {
    if (!categories.has('拳类')) reasons.push('缺少拳类');
    if (!categories.has('器械')) reasons.push('缺少器械');
  }
  return reasons.join('；') || '未达资格';
}

module.exports = {
  DEFAULT_OPTIONS,
  VALID_CATEGORIES,
  hasAgeGroup,
  parseEventName,
  parseEventNameWithOverrides,
  resolveCategory,
  extractEventCore,
  classifyExtractedName,
  buildEventCatalog,
  preprocessRawData,
  maxScoreByAthleteEvent,
  passesQualification,
  computeRankings,
};
