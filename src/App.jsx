import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  Users,
  Settings,
  ClipboardList,
  BarChart3,
  Trophy,
  LogIn,
  AlertTriangle,
  Check,
  Plus,
  Trash2,
  RefreshCw,
  Shuffle,
  ChevronLeft,
  Award,
  X,
  Swords,
  Radio,
  Medal,
  Lock,
  Save,
  Info,
  LayoutGrid,
  Search,
  GripVertical,
  ArrowUp,
  ArrowDown,
  Play,
  SkipForward,
  Undo2,
  Zap,
} from "lucide-react";
import { initializeApp } from "firebase/app";
import {
  getDatabase,
  ref,
  get,
  set,
  update,
  remove,
  onValue,
} from "firebase/database";
import { getAuth, signInAnonymously, onAuthStateChanged } from "firebase/auth";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
  closestCorners,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

/* ------------------------------------------------------------------ */
/* Firebase Cloud Configuration & Initialization                      */
/* ------------------------------------------------------------------ */
const firebaseConfig = {
  apiKey: "AIzaSyA2iSnXRCrd0Egp0C3whP9g2WhXkK5L1dc",
  authDomain: "wushu-competition-system.firebaseapp.com",
  databaseURL:
    "https://wushu-competition-system-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "wushu-competition-system",
  storageBucket: "wushu-competition-system.appspot.com",
  messagingSenderId: "398264756758",
  appId: "1:398264756758:web:1ef557b44bd19ce2d76337",
  measurementId: "G-BMSGB1R7H",
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);
const auth = getAuth(app);

/* 匿名登入。資料庫規則要求 auth != null，所以每次讀寫前都必須先等這個
   完成，否則會被拒絕。失敗時記錄原因，方便判斷是否為 Console 未啟用。 */
let authError = null;
const authReady = new Promise((resolve) => {
  onAuthStateChanged(auth, (user) => {
    if (user) resolve(user);
  });
  signInAnonymously(auth).catch((e) => {
    authError = e;
    console.error("[Firebase] 匿名登入失敗：", e.code, e.message);
    resolve(null);
  });
});

/* ------------------------------------------------------------------ */
/* Design tokens                                                      */
/* ------------------------------------------------------------------ */
const C = {
  bg: "#161310",
  surface: "#221E19",
  surfaceAlt: "#2C2721",
  border: "#3D362C",
  borderStrong: "#544A3B",
  red: "#B7382C",
  redDim: "#7A2A22",
  gold: "#C9A24B",
  goldDim: "#8A7233",
  green: "#5C8A63",
  blue: "#3C6ECC",
  blueDim: "#22427A",
  amber: "#CC8B3C",
  text: "#F3EDE2",
  textMuted: "#AFA391",
  textFaint: "#766B5C",
  silver: "#C7C2B8",
  bronze: "#B87A4A",
};

const FONT_DISPLAY = "'Oswald', 'Arial Narrow', sans-serif";
const FONT_BODY = "'Inter', system-ui, -apple-system, sans-serif";
const FONT_MONO = "'JetBrains Mono', 'Roboto Mono', monospace";

/* ------------------------------------------------------------------ */
/* Storage helpers (Firebase 雲端即時同步)                             */
/* ------------------------------------------------------------------ */
async function sGet(key) {
  try {
    await authReady;
    const snapshot = await get(ref(db, "wushu_data/" + key));
    return snapshot.exists() ? snapshot.val() : null;
  } catch (e) {
    console.error("[Firebase] 讀取失敗", key, e.code || e.message);
    return null;
  }
}
async function sSet(key, value) {
  try {
    await authReady;
    await set(ref(db, "wushu_data/" + key), value);
    return true;
  } catch (e) {
    console.error("[Firebase] 寫入失敗", key, e.code || e.message);
    return false;
  }
}
async function sDel(key) {
  try {
    await authReady;
    await remove(ref(db, "wushu_data/" + key));
    return true;
  } catch (e) {
    console.error("[Firebase] 刪除失敗", key, e.code || e.message);
    return false;
  }
}

/* 即時監聽單一 key。資料一變動就呼叫 cb，不必等輪詢。
   回傳解除監聽的函式，呼叫端的 useEffect cleanup 必須呼叫它。 */
function sWatch(key, cb) {
  let off = () => {};
  let cancelled = false;
  authReady.then(() => {
    if (cancelled) return;
    off = onValue(
      ref(db, "wushu_data/" + key),
      (snap) => cb(snap.exists() ? snap.val() : null),
      (e) => console.error("[Firebase] 監聽失敗", key, e.code || e.message)
    );
  });
  return () => {
    cancelled = true;
    off();
  };
}
const getJSON = async (key, fallback) => {
  const v = await sGet(key);
  return v !== null ? v : fallback;
};
const setJSON = (key, obj) => sSet(key, obj);

/* 多路徑原子更新。patch 的 key 可以含斜線（例如 "gkA/open"），Firebase 會
   把整份 patch 當成一次寫入送出，所以「關掉舊項目 + 開啟新項目」會在裁判端
   的 sWatch 同一個 callback 內出現，不會閃出兩個同時開或一個都沒開的狀態。
   相對於 sSet 整份重寫（54 個項目），這裡只碰到有列出的葉節點，兩台管理
   裝置同時操作也不會互相覆蓋。 */
async function sUpdate(path, patch) {
  try {
    await authReady;
    await update(ref(db, "wushu_data/" + path), patch);
    return true;
  } catch (e) {
    console.error("[Firebase] 更新失敗", path, e.code || e.message);
    return false;
  }
}

/* ------------------------------------------------------------------ */
/* Admin password (存在雲端，不再寫死在前端)                            */
/* ------------------------------------------------------------------ */
const DEFAULT_ADMIN_PW = "8888";

/* 首次執行時資料庫還沒有密碼，就用預設值建立，避免鎖住自己。
   之後改密碼只要改資料庫的 admin-config/password，不用重新部署。 */
async function verifyAdminPassword(input) {
  const cfg = await sGet("admin-config");
  if (cfg === null) {
    await sSet("admin-config", { password: DEFAULT_ADMIN_PW });
    return input === DEFAULT_ADMIN_PW;
  }
  return input === cfg.password;
}

/* ------------------------------------------------------------------ */
/* Domain helpers                                                     */
/* ------------------------------------------------------------------ */
const genId = () =>
  "id" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

function normGender(raw) {
  if (!raw) return raw;
  if (/男/.test(raw)) return "男子组";
  if (/女/.test(raw)) return "女子组";
  return raw.trim();
}

function parseRoster(text) {
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const out = [];
  for (const line of lines) {
    const parts = line
      .split(/\t|,|\s+/)
      .map((s) => s.trim())
      .filter((s) => s.length);
    if (parts.length < 5) continue;
    const ageGroup = parts[0];
    const eventName = parts[1];
    const genderRaw = parts[2];
    const cnName = parts[3];
    const enName = parts.slice(4).join(" ");

    if (/姓名|项目|组别|age|event/i.test(cnName)) continue;
    out.push({
      ageGroup,
      eventName,
      gender: normGender(genderRaw),
      cnName,
      enName,
    });
  }
  return out;
}

const groupKeyOf = (a) => `${a.ageGroup}__${a.eventName}__${a.gender}`;

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function computeRanks(sortedDesc) {
  let rank = 0,
    prevScore = null,
    place = 0;
  return sortedDesc.map((it) => {
    place++;
    if (it.final !== prevScore) {
      rank = place;
      prevScore = it.final;
    }
    return { ...it, rank };
  });
}

async function computeGroupResults(groupKey, meta, venue, athletesAll) {
  if (!meta || !venue) return null;
  /* 平行取回所有裁判的分數與加分，序列取回會讓延遲乘上裁判人數。 */
  const [scoreMaps, bonusRaw] = await Promise.all([
    Promise.all(
      venue.judges.map((j) => getJSON(`score:${groupKey}:${j.id}`, {}))
    ),
    getJSON(`bonus:${groupKey}`, {}),
  ]);
  const judgeScores = {};
  venue.judges.forEach((j, i) => {
    judgeScores[j.id] = scoreMaps[i] || {};
  });
  const bonusMap = bonusRaw || {};
  const groupAthletes = athletesAll
    .filter((a) => meta.athleteIds.includes(a.id))
    .sort((a, b) => a.order - b.order);

  const results = groupAthletes.map((a) => {
    const scores = venue.judges
      .map((j) => judgeScores[j.id]?.[a.id])
      .filter((v) => typeof v === "number");
    const submittedCount = scores.length;
    let avg = null,
      diff = null,
      needsMeeting = false,
      final = null;
    if (submittedCount >= 2) {
      const sorted = [...scores].sort((x, y) => x - y);
      diff = +(sorted[sorted.length - 1] - sorted[0]).toFixed(3);
      needsMeeting = diff > 0.5;
    }
    if (submittedCount === venue.judgeCount) {
      const sorted = [...scores].sort((x, y) => x - y);
      if (venue.judgeCount === 5) {
        const trimmed = sorted.slice(1, -1);
        avg = trimmed.reduce((s, v) => s + v, 0) / 3;
      } else {
        avg = sorted.reduce((s, v) => s + v, 0) / 3;
      }
      const bonus = typeof bonusMap[a.id] === "number" ? bonusMap[a.id] : 0;
      final = +(avg + bonus).toFixed(3);
    }
    return {
      athlete: a,
      scores: venue.judges.map((j) => ({
        judgeId: j.id,
        judgeName: j.name,
        value: judgeScores[j.id]?.[a.id] ?? null,
      })),
      bonus: typeof bonusMap[a.id] === "number" ? bonusMap[a.id] : null,
      submittedCount,
      judgeCount: venue.judgeCount,
      avg: avg === null ? null : +avg.toFixed(3),
      diff,
      needsMeeting,
      final,
      complete: submittedCount === venue.judgeCount,
    };
  });

  const completeSorted = results
    .filter((r) => r.complete)
    .sort((a, b) => b.final - a.final);
  const ranked = computeRanks(completeSorted);
  const rankMap = {};
  ranked.forEach((r) => {
    rankMap[r.athlete.id] = r.rank;
  });
  return results.map((r) => ({ ...r, rank: rankMap[r.athlete.id] ?? null }));
}

/* 一個項目是否「完全評完」＝每位選手都收齊全部裁判的分數，且裁判長加分也
   都填了。computeGroupResults 回傳的 r.bonus 在沒填時是 null，所以
   typeof r.bonus === "number" 就等於「有加分」，不必再讀一次 bonus key。 */
function isGroupFullyComplete(results) {
  if (!results || results.length === 0) return false;
  return results.every((r) => r.complete && typeof r.bonus === "number");
}

/* 取得項目的完成狀態。submitted/expected 用來顯示「9/12 已評」這種即時進度，
   分母同時算入裁判分數與裁判長加分，因為兩者都齊全才算完成。 */
async function fetchGroupCompletion(gk, meta, venue, athletesAll) {
  const results = await computeGroupResults(gk, meta, venue, athletesAll);
  if (!results) return { results: null, complete: false, submitted: 0, expected: 0 };
  const submitted = results.reduce(
    (n, r) => n + r.submittedCount + (typeof r.bonus === "number" ? 1 : 0),
    0
  );
  const expected = results.length * (venue.judgeCount + 1);
  return {
    results,
    complete: isGroupFullyComplete(results),
    submitted,
    expected,
  };
}

async function computeBestAthletes(groupsMeta, venuesConfig, athletesAll) {
  const stats = {};

  // 1. 先從總選手名單或各組統計每位選手報名了哪些項目（支援尚未有分數的選手）
  athletesAll.forEach((a) => {
    const idKey = `${a.cnName}__${a.enName}__${a.gender}`;
    if (!stats[idKey]) {
      stats[idKey] = {
        cnName: a.cnName,
        enName: a.enName,
        gender: a.gender,
        events: [],
      };
    }
  });

  // 2. 走訪所有群組，將有參與該組的選手及成績（若有）記錄下來
  for (const [gk, meta] of Object.entries(groupsMeta)) {
    const venue = venuesConfig.venues.find((v) => v.id === meta.venueId);
    // 即使還沒有 venue 或還沒打分，我們也能從 meta.athleteIds 知道選手報名了這項
    const groupAthletes = athletesAll.filter((a) =>
      meta.athleteIds?.includes(a.id)
    );

    // 嘗試抓取該組已有的結果
    let results = [];
    if (venue) {
      results = (await computeGroupResults(gk, meta, venue, athletesAll)) || [];
    }

    groupAthletes.forEach((a) => {
      const idKey = `${a.cnName}__${a.enName}__${a.gender}`;
      if (!stats[idKey]) {
        stats[idKey] = {
          cnName: a.cnName,
          enName: a.enName,
          gender: a.gender,
          events: [],
        };
      }
      const r = results.find((res) => res.athlete.id === a.id);
      stats[idKey].events.push({
        groupKey: gk,
        label: `${meta.ageGroup} ${meta.eventName} ${meta.gender}`,
        final: r && r.final !== null ? r.final : null,
      });
    });
  }

  // 3. 過濾出參加 3 項或以上的選手
  const qualified = Object.values(stats)
    .filter((s) => s.events.length >= 3)
    .map((s) => {
      const scoredEvents = s.events.filter((e) => e.final !== null);
      const sum = scoredEvents.reduce((acc, e) => acc + e.final, 0);
      const avg =
        scoredEvents.length > 0 ? +(sum / scoredEvents.length).toFixed(3) : 0;
      return { ...s, avg, scoredCount: scoredEvents.length };
    });

  // 排序：依據已有成績的平均分由高到低（若分數相同或皆無則依姓名）
  const male = qualified
    .filter((s) => /男/.test(s.gender))
    .sort((a, b) => b.avg - a.avg);
  const female = qualified
    .filter((s) => /女/.test(s.gender))
    .sort((a, b) => b.avg - a.avg);
  return { male, female };
}

/* ------------------------------------------------------------------ */
/* Small UI primitives                                                */
/* ------------------------------------------------------------------ */
function useFonts() {
  useEffect(() => {
    if (document.getElementById("wushu-fonts")) return;
    const link = document.createElement("link");
    link.id = "wushu-fonts";
    link.rel = "stylesheet";
    link.href =
      "https://fonts.googleapis.com/css2?family=Oswald:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;700&family=Inter:wght@400;500;600;700&display=swap";
    document.head.appendChild(link);
  }, []);
}

/* 用 JS 判斷而不是 CSS @media：手機與桌面在排程看板是兩棵不同的元件樹
   （桌面同時渲染全部欄位，手機一次一欄），而且拖放必須在觸控裝置停用，
   那是 CSS 做不到的判斷。 */
function useMediaQuery(query) {
  const [matches, setMatches] = useState(() =>
    typeof window !== "undefined" && window.matchMedia
      ? window.matchMedia(query).matches
      : false
  );
  useEffect(() => {
    if (!window.matchMedia) return;
    const mql = window.matchMedia(query);
    const on = (e) => setMatches(e.matches);
    setMatches(mql.matches);
    mql.addEventListener("change", on);
    return () => mql.removeEventListener("change", on);
  }, [query]);
  return matches;
}

function Card({ children, style, ...rest }) {
  return (
    <div
      style={{
        background: C.surface,
        border: `1px solid ${C.border}`,
        borderRadius: 10,
        ...style,
      }}
      {...rest}
    >
      {children}
    </div>
  );
}

function Btn({
  children,
  onClick,
  variant = "default",
  size = "md",
  disabled,
  style,
  type = "button",
  title,
}) {
  const base = {
    fontFamily: FONT_BODY,
    fontWeight: 600,
    borderRadius: 8,
    cursor: disabled ? "not-allowed" : "pointer",
    border: "1px solid transparent",
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    opacity: disabled ? 0.5 : 1,
    transition: "filter 0.15s",
    padding: size === "sm" ? "6px 12px" : "10px 18px",
    fontSize: size === "sm" ? 13 : 14.5,
  };
  const variants = {
    default: { background: C.surfaceAlt, color: C.text, borderColor: C.border },
    primary: { background: C.red, color: "#FBEBE6", borderColor: C.red },
    gold: { background: C.gold, color: "#241C08", borderColor: C.gold },
    ghost: {
      background: "transparent",
      color: C.textMuted,
      borderColor: "transparent",
    },
    danger: {
      background: "transparent",
      color: "#E08A7C",
      borderColor: C.redDim,
    },
  };
  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      title={title}
      onMouseEnter={(e) =>
        !disabled && (e.currentTarget.style.filter = "brightness(1.12)")
      }
      onMouseLeave={(e) => (e.currentTarget.style.filter = "none")}
      style={{ ...base, ...variants[variant], ...style }}
    >
      {children}
    </button>
  );
}

function Field({ label, children, hint }) {
  return (
    <label
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 6,
        fontFamily: FONT_BODY,
      }}
    >
      {label && (
        <span
          style={{
            fontSize: 12.5,
            color: C.textMuted,
            fontWeight: 600,
            letterSpacing: 0.3,
          }}
        >
          {label}
        </span>
      )}
      {children}
      {hint && (
        <span style={{ fontSize: 11.5, color: C.textFaint }}>{hint}</span>
      )}
    </label>
  );
}

const inputStyle = {
  background: C.bg,
  border: `1px solid ${C.border}`,
  borderRadius: 7,
  color: C.text,
  padding: "9px 11px",
  fontSize: 14,
  fontFamily: FONT_BODY,
  outline: "none",
  width: "100%",
};

function TextInput(props) {
  return <input {...props} style={{ ...inputStyle, ...(props.style || {}) }} />;
}
function Select({ children, ...props }) {
  return (
    <select {...props} style={{ ...inputStyle, ...(props.style || {}) }}>
      {children}
    </select>
  );
}

function Badge({ children, tone = "default" }) {
  const tones = {
    default: { bg: C.surfaceAlt, fg: C.textMuted, bd: C.border },
    open: { bg: "#213228", fg: "#8FCB9C", bd: "#345B3F" },
    closed: { bg: "#2A2420", fg: C.textFaint, bd: C.border },
    warn: { bg: "#3A2018", fg: "#F0A08C", bd: C.redDim },
    gold: { bg: "#2E2510", fg: C.gold, bd: C.goldDim },
    pending: { bg: "#33280F", fg: C.amber, bd: C.goldDim },
  };
  const t = tones[tone];
  return (
    <span
      style={{
        background: t.bg,
        color: t.fg,
        border: `1px solid ${t.bd}`,
        borderRadius: 999,
        padding: "2px 10px",
        fontSize: 11.5,
        fontWeight: 600,
        fontFamily: FONT_BODY,
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </span>
  );
}

function SectionTitle({ eyebrow, title, icon }) {
  const Icon = icon;
  return (
    <div style={{ marginBottom: 18 }}>
      {eyebrow && (
        <div
          style={{
            color: C.gold,
            fontSize: 11.5,
            fontWeight: 700,
            letterSpacing: 1.5,
            textTransform: "uppercase",
            marginBottom: 4,
          }}
        >
          {eyebrow}
        </div>
      )}
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        {Icon && <Icon size={22} color={C.red} />}
        <h2
          style={{
            fontFamily: FONT_DISPLAY,
            fontSize: 24,
            fontWeight: 600,
            color: C.text,
            letterSpacing: 0.3,
            margin: 0,
          }}
        >
          {title}
        </h2>
      </div>
    </div>
  );
}

function ScoreDigits({ value, size = 34, color }) {
  return (
    <span
      style={{
        fontFamily: FONT_MONO,
        fontSize: size,
        fontWeight: 700,
        color: color || C.text,
        letterSpacing: -1,
      }}
    >
      {value === null || value === undefined ? "—" : Number(value).toFixed(2)}
    </span>
  );
}

function Confirm({ open, text, onYes, onNo }) {
  if (!open) return null;
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(10,8,6,0.7)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 100,
      }}
    >
      <Card style={{ padding: 22, maxWidth: 340, textAlign: "center" }}>
        <AlertTriangle size={26} color={C.amber} style={{ marginBottom: 10 }} />
        <div
          style={{
            color: C.text,
            fontFamily: FONT_BODY,
            fontSize: 14.5,
            marginBottom: 18,
            lineHeight: 1.5,
          }}
        >
          {text}
        </div>
        <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
          <Btn variant="ghost" onClick={onNo}>
            取消
          </Btn>
          <Btn variant="danger" onClick={onYes}>
            確定
          </Btn>
        </div>
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Landing & Admin Auth Modal                                         */
/* ------------------------------------------------------------------ */
function Landing({ onPick }) {
  const [showAdminAuth, setShowAdminAuth] = useState(false);
  const [pwd, setPwd] = useState("");
  const [err, setErr] = useState(false);
  const [checking, setChecking] = useState(false);

  const handleAdminClick = () => {
    setShowAdminAuth(true);
    setPwd("");
    setErr(false);
  };

  const verifyAdmin = async (e) => {
    e.preventDefault();
    setChecking(true);
    setErr(false);
    const ok = await verifyAdminPassword(pwd);
    setChecking(false);
    if (ok) {
      onPick("admin");
    } else {
      setErr(true);
    }
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        position: "relative",
      }}
    >
      <Swords size={40} color={C.red} style={{ marginBottom: 14 }} />
      <div
        style={{
          fontFamily: FONT_DISPLAY,
          fontSize: 15,
          letterSpacing: 4,
          color: C.gold,
          textTransform: "uppercase",
          marginBottom: 6,
        }}
      >
        擂台記分
      </div>
      <h1
        style={{
          fontFamily: FONT_DISPLAY,
          fontSize: 34,
          color: C.text,
          margin: "0 0 6px",
          fontWeight: 600,
          textAlign: "center",
        }}
      >
        武術比賽評審系統
      </h1>
      <p
        style={{
          color: C.textMuted,
          fontFamily: FONT_BODY,
          fontSize: 14,
          marginBottom: 34,
          textAlign: "center",
          maxWidth: 320,
        }}
      >
        選擇你的角色進入
      </p>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 12,
          width: "100%",
          maxWidth: 320,
        }}
      >
        {[
          {
            role: "admin",
            label: "總控台",
            desc: "名單 · 場地 · 開項目 · 排名",
            icon: Settings,
            onClick: handleAdminClick,
          },
          {
            role: "judge",
            label: "裁判入口",
            desc: "登入打分",
            icon: LogIn,
            onClick: () => onPick("judge"),
          },
          {
            role: "board",
            label: "成績看板",
            desc: "即時排名顯示",
            icon: Radio,
            onClick: () => onPick("board"),
          },
        ].map((o) => (
          <button
            key={o.role}
            onClick={o.onClick}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 14,
              padding: "16px 18px",
              background: C.surface,
              border: `1px solid ${C.border}`,
              borderRadius: 10,
              cursor: "pointer",
              textAlign: "left",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.borderColor = C.red)}
            onMouseLeave={(e) => (e.currentTarget.style.borderColor = C.border)}
          >
            <o.icon size={22} color={C.red} />
            <div>
              <div
                style={{
                  color: C.text,
                  fontFamily: FONT_DISPLAY,
                  fontSize: 17,
                  fontWeight: 600,
                }}
              >
                {o.label}
              </div>
              <div
                style={{
                  color: C.textFaint,
                  fontSize: 12.5,
                  fontFamily: FONT_BODY,
                }}
              >
                {o.desc}
              </div>
            </div>
          </button>
        ))}
      </div>

      {showAdminAuth && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(10,8,6,0.8)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 100,
            padding: 16,
          }}
        >
          <Card style={{ padding: 24, width: "100%", maxWidth: 340 }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 16,
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  color: C.text,
                  fontFamily: FONT_DISPLAY,
                  fontSize: 18,
                }}
              >
                <Lock size={18} color={C.red} /> 總控台驗證
              </div>
              <button
                onClick={() => setShowAdminAuth(false)}
                style={{
                  background: "none",
                  border: "none",
                  color: C.textFaint,
                  cursor: "pointer",
                }}
              >
                <X size={18} />
              </button>
            </div>
            <form
              onSubmit={verifyAdmin}
              style={{ display: "flex", flexDirection: "column", gap: 12 }}
            >
              <Field label="請輸入總控台密碼">
                <TextInput
                  type="password"
                  placeholder="預設密碼: 8888"
                  value={pwd}
                  onChange={(e) => {
                    setPwd(e.target.value);
                    setErr(false);
                  }}
                  autoFocus
                />
              </Field>
              {err && (
                <div style={{ color: C.red, fontSize: 12, fontWeight: 600 }}>
                  密碼錯誤，請重新輸入
                </div>
              )}
              <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
                <Btn
                  variant="ghost"
                  onClick={() => setShowAdminAuth(false)}
                  style={{ flex: 1, justifyContent: "center" }}
                >
                  取消
                </Btn>
                <Btn
                  variant="primary"
                  type="submit"
                  disabled={checking}
                  style={{ flex: 1, justifyContent: "center" }}
                >
                  {checking ? "驗證中…" : "確認進入"}
                </Btn>
              </div>
            </form>
          </Card>
        </div>
      )}
    </div>
  );
}

function TopBar({ title, onBack }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "16px 20px",
        borderBottom: `1px solid ${C.border}`,
        position: "sticky",
        top: 0,
        background: C.bg,
        zIndex: 10,
      }}
    >
      <button
        onClick={onBack}
        style={{
          background: "none",
          border: "none",
          color: C.textMuted,
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          padding: 6,
        }}
      >
        <ChevronLeft size={20} />
      </button>
      <Swords size={16} color={C.red} />
      <span
        style={{
          fontFamily: FONT_DISPLAY,
          fontSize: 16,
          color: C.text,
          letterSpacing: 0.5,
        }}
      >
        {title}
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Admin Console                                                      */
/* ------------------------------------------------------------------ */
const ADMIN_TABS = [
  { id: "roster", label: "名單匯入", icon: Users },
  { id: "venues", label: "場地與裁判", icon: Settings },
  { id: "events", label: "項目控制", icon: LayoutGrid },
  { id: "monitor", label: "即時監看", icon: ClipboardList },
  { id: "ranking", label: "排名結果", icon: BarChart3 },
  { id: "best", label: "最佳運動員", icon: Trophy },
];

function AdminConsole({ onBack }) {
  const [tab, setTab] = useState("roster");
  const [athletes, setAthletes] = useState([]);
  const [groupsMeta, setGroupsMeta] = useState({});
  const [venuesConfig, setVenuesConfig] = useState({
    scaleMax: 10,
    venues: [],
  });
  const [loading, setLoading] = useState(true);

  const loadAll = useCallback(async () => {
    const [a, g, v] = await Promise.all([
      getJSON("athletes", []),
      getJSON("groups-meta", {}),
      getJSON("venues-config", { scaleMax: 10, venues: [] }),
    ]);
    setAthletes(a);
    setGroupsMeta(g);
    setVenuesConfig(v);
    setLoading(false);
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  /* 掛在總控台層級，切分頁不會中斷自動接續。 */
  const engine = useQueueEngine({
    groupsMeta,
    setGroupsMeta,
    venuesConfig,
    athletes,
    enabled: !loading,
  });

  const groupKeys = Object.keys(groupsMeta);

  return (
    <div style={{ minHeight: "100vh" }}>
      <TopBar title="總控台" onBack={onBack} />
      <div
        style={{
          display: "flex",
          overflowX: "auto",
          borderBottom: `1px solid ${C.border}`,
          padding: "0 12px",
        }}
      >
        {ADMIN_TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "12px 14px",
              background: "none",
              border: "none",
              borderBottom:
                tab === t.id ? `2px solid ${C.red}` : "2px solid transparent",
              color: tab === t.id ? C.text : C.textFaint,
              fontFamily: FONT_BODY,
              fontSize: 13,
              fontWeight: 600,
              cursor: "pointer",
              whiteSpace: "nowrap",
            }}
          >
            <t.icon size={15} /> {t.label}
          </button>
        ))}
      </div>
      <div
        style={{
          padding: 20,
          maxWidth: tab === "events" ? 1400 : 900,
          margin: "0 auto",
        }}
      >
        {loading ? (
          <Loading />
        ) : (
          <>
            {tab === "roster" && (
              <RosterTab
                athletes={athletes}
                groupsMeta={groupsMeta}
                reload={loadAll}
              />
            )}
            {tab === "venues" && (
              <VenuesTab
                venuesConfig={venuesConfig}
                setVenuesConfig={setVenuesConfig}
                reload={loadAll}
              />
            )}
            {tab === "events" && (
              <EventsTab
                groupsMeta={groupsMeta}
                venuesConfig={venuesConfig}
                engine={engine}
              />
            )}
            {tab === "monitor" && (
              <MonitorTab
                groupKeys={groupKeys}
                groupsMeta={groupsMeta}
                venuesConfig={venuesConfig}
                athletes={athletes}
              />
            )}
            {tab === "ranking" && (
              <RankingTab
                groupKeys={groupKeys}
                groupsMeta={groupsMeta}
                venuesConfig={venuesConfig}
                athletes={athletes}
              />
            )}
            {tab === "best" && (
              <BestTab
                groupsMeta={groupsMeta}
                venuesConfig={venuesConfig}
                athletes={athletes}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}

function Loading() {
  return (
    <div
      style={{
        color: C.textFaint,
        fontFamily: FONT_BODY,
        padding: 40,
        textAlign: "center",
      }}
    >
      <RefreshCw size={18} className="spin" style={{ marginBottom: 8 }} />
      <div>載入中…</div>
    </div>
  );
}

/* ---- Roster Tab ---- */
function RosterTab({ athletes, groupsMeta, reload }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);

  const doImport = async () => {
    setBusy(true);
    const parsed = parseRoster(text);
    if (parsed.length === 0) {
      setMsg("沒有解析到有效資料，請檢查格式");
      setBusy(false);
      return;
    }
    const withIds = parsed.map((a) => ({ ...a, id: genId() }));
    const byGroup = {};
    withIds.forEach((a) => {
      const k = groupKeyOf(a);
      (byGroup[k] = byGroup[k] || []).push(a);
    });
    Object.keys(byGroup).forEach((k) => {
      const shuffled = shuffle(byGroup[k]);
      shuffled.forEach((a, idx) => {
        a.order = idx + 1;
      });
      byGroup[k] = shuffled;
    });
    const finalList = Object.values(byGroup).flat();
    await setJSON("athletes", finalList);

    const existingMeta = await getJSON("groups-meta", {});
    const newMeta = {};
    Object.keys(byGroup).forEach((k) => {
      const sample = byGroup[k][0];
      newMeta[k] = existingMeta[k]
        ? { ...existingMeta[k] }
        : {
            ageGroup: sample.ageGroup,
            eventName: sample.eventName,
            gender: sample.gender,
            venueId: null,
            open: false,
          };
      newMeta[k].ageGroup = sample.ageGroup;
      newMeta[k].eventName = sample.eventName;
      newMeta[k].gender = sample.gender;
      newMeta[k].athleteIds = byGroup[k].map((a) => a.id);
    });
    await setJSON("groups-meta", newMeta);
    setBusy(false);
    setMsg(
      `匯入成功：共 ${finalList.length} 位選手，${
        Object.keys(byGroup).length
      } 個項目組別（組內已隨機打亂順序）`
    );
    setText("");
    reload();
  };

  const clearAll = async () => {
    await sDel("athletes");
    await sDel("groups-meta");
    /* 佇列的內容全是 groupKey，名單清掉後就成了孤兒，一起刪。 */
    await sDel("queues");
    setConfirmOpen(false);
    reload();
  };

  const byGroupCount = {};
  athletes.forEach((a) => {
    const k = groupKeyOf(a);
    byGroupCount[k] = (byGroupCount[k] || 0) + 1;
  });

  return (
    <div>
      <SectionTitle eyebrow="Step 1" title="匯入參賽名單" icon={Users} />
      <Card style={{ padding: 16, marginBottom: 16 }}>
        <div
          style={{
            color: C.textMuted,
            fontSize: 13,
            marginBottom: 10,
            lineHeight: 1.6,
          }}
        >
          從 Excel 複製整欄貼上即可（Tab 或逗號分隔），每行 5 個欄位，順序為：
          <br />
          <span style={{ color: C.gold, fontFamily: FONT_MONO, fontSize: 12 }}>
            年齡組 項目 組別 中文姓名 英文姓名
          </span>
          <br />
          例如：
          <span style={{ fontFamily: FONT_MONO, fontSize: 12, color: C.text }}>
            U10 基礎槍術 女子組 王悅宣 KAELY WANG YUE XUAN
          </span>
        </div>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="貼上名單...（每行一位選手）"
          rows={7}
          style={{
            ...inputStyle,
            fontFamily: FONT_MONO,
            fontSize: 12.5,
            resize: "vertical",
          }}
        />
        <div
          style={{
            display: "flex",
            gap: 10,
            marginTop: 12,
            alignItems: "center",
          }}
        >
          <Btn
            variant="primary"
            onClick={doImport}
            disabled={busy || !text.trim()}
          >
            <Shuffle size={15} /> 匯入並隨機打亂同組順序
          </Btn>
          <Btn variant="danger" onClick={() => setConfirmOpen(true)}>
            <Trash2 size={14} /> 清空名單
          </Btn>
        </div>
        {msg && (
          <div style={{ marginTop: 10, color: C.gold, fontSize: 13 }}>
            {msg}
          </div>
        )}
      </Card>

      <SectionTitle
        title={`目前名單（${athletes.length} 人 / ${
          Object.keys(byGroupCount).length
        } 組）`}
      />
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {Object.keys(byGroupCount).length === 0 && (
          <div style={{ color: C.textFaint, fontSize: 13 }}>尚未匯入名單</div>
        )}
        {Object.entries(byGroupCount).map(([k, count]) => {
          const meta = groupsMeta[k];
          return (
            <Card
              key={k}
              style={{
                padding: "10px 14px",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <span style={{ fontSize: 13.5, color: C.text }}>
                {meta
                  ? `${meta.ageGroup} · ${meta.eventName} · ${meta.gender}`
                  : k}
              </span>
              <Badge>{count} 人</Badge>
            </Card>
          );
        })}
      </div>
      <Confirm
        open={confirmOpen}
        text="確定要清空所有名單與項目資料嗎？此動作無法復原（裁判評分紀錄不會被刪除）。"
        onYes={clearAll}
        onNo={() => setConfirmOpen(false)}
      />
    </div>
  );
}

/* ---- Venues Tab ---- */
function VenuesTab({ venuesConfig, setVenuesConfig, reload }) {
  const [local, setLocal] = useState(venuesConfig);
  const [savedMsg, setSavedMsg] = useState("");
  useEffect(() => setLocal(venuesConfig), [venuesConfig]);

  const addVenue = () => {
    const n = local.venues.length + 1;
    const judgeCount = 3;
    setLocal({
      ...local,
      venues: [
        ...local.venues,
        {
          id: genId(),
          name: `場地 ${n}`,
          judgeCount,
          judges: Array.from({ length: judgeCount }, (_, i) => ({
            id: genId(),
            name: `裁判${i + 1}`,
          })),
          chief: { id: genId(), name: "裁判長" },
        },
      ],
    });
  };

  const updateVenue = (vid, patch) => {
    setLocal({
      ...local,
      venues: local.venues.map((v) => (v.id === vid ? { ...v, ...patch } : v)),
    });
  };

  const setJudgeCount = (vid, count) => {
    setLocal({
      ...local,
      venues: local.venues.map((v) => {
        if (v.id !== vid) return v;
        const judges = Array.from(
          { length: count },
          (_, i) => v.judges[i] || { id: genId(), name: `裁判${i + 1}` }
        );
        return { ...v, judgeCount: count, judges };
      }),
    });
  };

  const renameJudge = (vid, jid, name) => {
    setLocal({
      ...local,
      venues: local.venues.map((v) =>
        v.id !== vid
          ? v
          : {
              ...v,
              judges: v.judges.map((j) => (j.id === jid ? { ...j, name } : j)),
            }
      ),
    });
  };

  const removeVenue = (vid) =>
    setLocal({ ...local, venues: local.venues.filter((v) => v.id !== vid) });

  const save = async () => {
    await setJSON("venues-config", local);
    setVenuesConfig(local);
    setSavedMsg("已儲存");
    setTimeout(() => setSavedMsg(""), 1800);
    reload();
  };

  return (
    <div>
      <SectionTitle eyebrow="Step 2" title="場地與裁判設定" icon={Settings} />
      <Card style={{ padding: 16, marginBottom: 16 }}>
        <Field label="每項滿分（分）" hint="所有裁判與裁判長皆使用此上限">
          <TextInput
            type="number"
            step="0.1"
            value={local.scaleMax}
            onChange={(e) =>
              setLocal({ ...local, scaleMax: parseFloat(e.target.value) || 10 })
            }
            style={{ maxWidth: 140 }}
          />
        </Field>
      </Card>

      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {local.venues.map((v) => (
          <Card key={v.id} style={{ padding: 16 }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 12,
              }}
            >
              <TextInput
                value={v.name}
                onChange={(e) => updateVenue(v.id, { name: e.target.value })}
                style={{
                  maxWidth: 220,
                  fontFamily: FONT_DISPLAY,
                  fontSize: 16,
                  fontWeight: 600,
                }}
              />
              <button
                onClick={() => removeVenue(v.id)}
                style={{
                  background: "none",
                  border: "none",
                  color: C.textFaint,
                  cursor: "pointer",
                }}
              >
                <Trash2 size={16} />
              </button>
            </div>
            <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
              <Field label="裁判人數">
                <div style={{ display: "flex", gap: 8 }}>
                  {[3, 5].map((n) => (
                    <button
                      key={n}
                      onClick={() => setJudgeCount(v.id, n)}
                      style={{
                        padding: "8px 16px",
                        borderRadius: 7,
                        cursor: "pointer",
                        fontFamily: FONT_MONO,
                        fontWeight: 700,
                        border: `1px solid ${
                          v.judgeCount === n ? C.red : C.border
                        }`,
                        background: v.judgeCount === n ? C.redDim : C.bg,
                        color: v.judgeCount === n ? "#FBEBE6" : C.textMuted,
                      }}
                    >
                      {n}
                    </button>
                  ))}
                </div>
              </Field>
            </div>
            <div
              style={{
                marginTop: 14,
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 10,
              }}
            >
              {v.judges.map((j, i) => (
                <Field key={j.id} label={`裁判 ${i + 1} 代號 / 姓名`}>
                  <TextInput
                    value={j.name}
                    onChange={(e) => renameJudge(v.id, j.id, e.target.value)}
                  />
                </Field>
              ))}
              <Field label="裁判長 姓名">
                <TextInput
                  value={v.chief.name}
                  onChange={(e) =>
                    updateVenue(v.id, {
                      chief: { ...v.chief, name: e.target.value },
                    })
                  }
                  style={{ borderColor: C.goldDim }}
                />
              </Field>
            </div>
          </Card>
        ))}
      </div>

      <div
        style={{
          display: "flex",
          gap: 10,
          marginTop: 16,
          alignItems: "center",
        }}
      >
        <Btn variant="default" onClick={addVenue}>
          <Plus size={15} /> 新增場地
        </Btn>
        <Btn variant="primary" onClick={save}>
          <Save size={15} /> 儲存設定
        </Btn>
        {savedMsg && (
          <span style={{ color: C.green, fontSize: 13 }}>{savedMsg}</span>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Events Tab — 場地排程看板                                           */
/* ------------------------------------------------------------------ */
/*
  資料放在 wushu_data/queues：

    queues[venueId] = { order: [gk...], done: [gk...], auto: bool, updatedAt }

  order[0] 是佇列首位，其餘是等候中。queues 是「位置」的真相來源，
  groups-meta 的 venueId / open / status 是同一個函式順帶寫出的投影
  ——裁判端只讀 groups-meta，所以那份契約不能變。

  不變式（對每個場地 v）：
    1. gk ∈ queues[v].order        ⟺ groups-meta[gk].venueId === v
    2. groups-meta[gk].open === true ⟹ gk === queues[v].order[0]
       （反向刻意不成立：排到首位不會自動開啟，要按「開始」）
    3. gk ∈ queues[v].done  ⟹ venueId === v, open === false, status === "done"
    4. 一個 gk 最多只出現在一個場地的 order + done 之中

  寫入順序一律「先 meta 後 queue」：meta 是單次 multi-path 原子寫入，
  裁判端會在同一個 sWatch callback 看到「關舊的 + 開新的」，不會閃爍。
  若 queue 那步失敗，裁判仍在評正確的項目，下次載入 reconcile 會修好。
*/

const EMPTY_Q = { order: [], done: [], auto: false };

/* RTDB 不存空陣列（整個 key 會消失），所以 null 一律轉回 []，順便去重。 */
function normQueue(q) {
  const uniq = (a) => Array.from(new Set(Array.isArray(a) ? a.filter(Boolean) : []));
  return {
    order: uniq(q && q.order),
    done: uniq(q && q.done),
    auto: !!(q && q.auto),
    updatedAt: (q && q.updatedAt) || 0,
  };
}

const venueQueue = (queues, vid) => normQueue(queues && queues[vid]);

/* 找出某個項目目前在哪個場地的哪一份清單、第幾位。不在任何佇列時回傳 null。 */
function queueLocate(queues, gk) {
  for (const vid of Object.keys(queues || {})) {
    const q = venueQueue(queues, vid);
    let i = q.order.indexOf(gk);
    if (i >= 0) return { venueId: vid, list: "order", index: i };
    i = q.done.indexOf(gk);
    if (i >= 0) return { venueId: vid, list: "done", index: i };
  }
  return null;
}

const statusOf = (m) =>
  m && m.open ? "running" : m && m.venueId ? "queued" : "idle";

/*
  所有移動的唯一收口：拖放、點選放置、▲▼、撤銷、開始、重新開啟、自動接續
  全部走這裡。純函式，所以上面那些不變式只可能在這一個地方被破壞。

  回傳 { nextQueues, metaPatch, touched }：
    metaPatch 的 key 是 "<gk>/<field>"，可直接餵給 sUpdate("groups-meta", …)
    touched 是被動到的 venueId 清單，決定要寫哪幾個場地的 queue
*/
function buildQueueMutation(queues, groupsMeta, action) {
  const next = {};
  for (const vid of Object.keys(queues || {})) next[vid] = venueQueue(queues, vid);
  const metaPatch = {};
  const touched = new Set();

  const ensure = (vid) => {
    if (!next[vid]) next[vid] = { ...EMPTY_Q, order: [], done: [] };
    return next[vid];
  };
  /* 只寫真正變動的欄位：純調序（等候項目之間換位）因此產生空 patch，
     完全不會碰到 groups-meta，也就不會驚動裁判端的 sWatch。 */
  const setMeta = (gk, fields) => {
    const cur = groupsMeta[gk] || {};
    for (const k of Object.keys(fields)) {
      const key = `${gk}/${k}`;
      const prev = key in metaPatch ? metaPatch[key] : cur[k];
      const want = fields[k];
      if (prev === want) delete metaPatch[key];
      else metaPatch[key] = want;
    }
  };
  /* 把 gk 從所有佇列拔乾淨，回傳它原本在哪個場地。 */
  const detach = (gk) => {
    let from = null;
    for (const vid of Object.keys(next)) {
      const q = next[vid];
      if (q.order.includes(gk) || q.done.includes(gk)) from = vid;
      q.order = q.order.filter((k) => k !== gk);
      q.done = q.done.filter((k) => k !== gk);
      if (from === vid) touched.add(vid);
    }
    return from;
  };
  /* 關掉某場地內除了 keepGk 以外所有開著的項目，維持「一場地一項目」。 */
  const closeOthers = (vid, keepGk) => {
    for (const gk of ensure(vid).order) {
      if (gk === keepGk) continue;
      if (groupsMeta[gk] && groupsMeta[gk].open) {
        setMeta(gk, { open: false, status: "queued" });
      }
    }
  };

  const doPlace = (gk, toVenue, toIndex) => {
    detach(gk);
    const q = ensure(toVenue);
    let idx = Math.max(0, Math.min(toIndex, q.order.length));
    /* 首位正在評分時不准插到 index 0：把正在評的項目從裁判腳下抽走是這個
       功能最糟的失敗模式。要插隊必須先按「撤銷」，那是一個刻意的動作。 */
    const head = q.order[0];
    if (idx === 0 && head && groupsMeta[head] && groupsMeta[head].open) idx = 1;
    q.order.splice(idx, 0, gk);
    touched.add(toVenue);
    const m = groupsMeta[gk] || {};
    /* 進場地不自動開啟，一律先當等候中；要跑得按「開始」。 */
    if (m.venueId !== toVenue) setMeta(gk, { venueId: toVenue });
    if (m.open) setMeta(gk, { open: false });
    setMeta(gk, { status: "queued" });
  };

  const doRemove = (gk) => {
    detach(gk);
    const m = groupsMeta[gk] || {};
    if (m.venueId) setMeta(gk, { venueId: null });
    if (m.open) setMeta(gk, { open: false });
    setMeta(gk, { status: "idle" });
  };

  /* 「開始」與「重新開啟」共用：移到首位並開啟。 */
  const doStart = (gk) => {
    const loc = queueLocate(next, gk);
    const vid = (loc && loc.venueId) || (groupsMeta[gk] || {}).venueId;
    if (!vid) return;
    detach(gk);
    const q = ensure(vid);
    q.order.unshift(gk);
    touched.add(vid);
    closeOthers(vid, gk);
    setMeta(gk, { venueId: vid, open: true, status: "running" });
  };

  const doComplete = (gk) => {
    const loc = queueLocate(next, gk);
    const vid = (loc && loc.venueId) || (groupsMeta[gk] || {}).venueId;
    if (!vid) return;
    detach(gk);
    const q = ensure(vid);
    q.done = [gk, ...q.done.filter((k) => k !== gk)];
    touched.add(vid);
    setMeta(gk, { venueId: vid, open: false, status: "done" });
  };

  switch (action.type) {
    case "place":
      doPlace(action.gk, action.toVenue, action.toIndex);
      break;
    case "remove":
      doRemove(action.gk);
      break;
    case "start":
      doStart(action.gk);
      break;
    case "complete":
      doComplete(action.gk);
      break;
    case "advance": {
      /* 完成首位 + 開啟下一個，合成一次 mutation，meta 是單次原子寫入，
         裁判端不會看到「兩個都關著」的中間狀態。 */
      const q = ensure(action.venueId);
      const head = q.order[0];
      if (!head) break;
      const nextGk = q.order[1];
      doComplete(head);
      if (nextGk) doStart(nextGk);
      break;
    }
    case "toggleAuto": {
      const q = ensure(action.venueId);
      q.auto = !q.auto;
      touched.add(action.venueId);
      break;
    }
    default:
      break;
  }

  return { nextQueues: next, metaPatch, touched: Array.from(touched) };
}

/*
  從既有的 groups-meta 種出 / 修好 queues。看板掛載時跑一次，也掛在
  「修復佇列」按鈕後面。必須冪等：跑第二次要回傳 changed === false。
*/
function reconcileQueues(groupsMeta, venuesConfig, existingQueues) {
  const venueIds = (venuesConfig.venues || []).map((v) => v.id);
  const metaPatch = {};
  /* 同 buildQueueMutation：只記真正變動的欄位，沒事就不要製造寫入。 */
  const setMeta = (gk, fields) => {
    const cur = groupsMeta[gk] || {};
    for (const k of Object.keys(fields)) {
      const key = `${gk}/${k}`;
      const prev = key in metaPatch ? metaPatch[key] : cur[k];
      if (prev === fields[k]) delete metaPatch[key];
      else metaPatch[key] = fields[k];
    }
  };

  const queues = {};
  for (const vid of venueIds) {
    const q = venueQueue(existingQueues, vid);
    /* 丟掉：groups-meta 已經沒有的（名單重匯）、venueId 對不上這個場地的 */
    const keep = (gk) =>
      groupsMeta[gk] && groupsMeta[gk].venueId === vid;
    const done = q.done.filter(keep);
    const order = q.order.filter((gk) => keep(gk) && !done.includes(gk));
    queues[vid] = { order, done, auto: q.auto, updatedAt: q.updatedAt };
  }

  /* 被刪掉的場地留下的孤兒項目：送回資料庫 */
  for (const [gk, m] of Object.entries(groupsMeta)) {
    if (m.venueId && !venueIds.includes(m.venueId)) {
      setMeta(gk, { venueId: null, open: false, status: "idle" });
    }
  }

  /* 種子：兩個管理員同時載入必須種出一模一樣的看板，所以排序要決定性。
     numeric 讓 U9 < U10 < U12，而不是字典序的 U10 < U9。 */
  const seedSort = (a, b) =>
    `${groupsMeta[a].ageGroup}|${groupsMeta[a].eventName}|${groupsMeta[a].gender}`.localeCompare(
      `${groupsMeta[b].ageGroup}|${groupsMeta[b].eventName}|${groupsMeta[b].gender}`,
      "zh-Hant",
      { numeric: true }
    );

  for (const vid of venueIds) {
    const q = queues[vid];
    const known = new Set([...q.order, ...q.done]);
    const missing = Object.keys(groupsMeta)
      .filter((gk) => groupsMeta[gk].venueId === vid && !known.has(gk))
      .sort(seedSort);
    /* 已經開著的項目正在跑，必須是 index 0 */
    const openOnes = missing.filter((gk) => groupsMeta[gk].open);
    const rest = missing.filter((gk) => !groupsMeta[gk].open);
    q.order = [...openOnes, ...q.order, ...rest];
  }

  for (const vid of venueIds) {
    const q = queues[vid];
    /* 一個場地最多一個 open：保留 index 最小的，其餘關掉 */
    const opens = q.order.filter((gk) => groupsMeta[gk].open);
    if (opens.length > 1) {
      for (const gk of opens.slice(1)) setMeta(gk, { open: false, status: "queued" });
    }
    /* 首位是關的但後面有開著的 → 有裁判正在評它，錯的是佇列，把它移到首位 */
    const runner = opens[0];
    if (runner && q.order[0] !== runner) {
      q.order = [runner, ...q.order.filter((gk) => gk !== runner)];
    }
    /* done 裡的項目不該是開著的 */
    for (const gk of q.done) {
      if (groupsMeta[gk].open) setMeta(gk, { open: false });
    }
  }

  /* 補 status（純顯示用，缺值不影響正確性） */
  const inQueue = new Set();
  for (const vid of venueIds) {
    queues[vid].order.forEach((gk) => inQueue.add(gk));
    queues[vid].done.forEach((gk) => inQueue.add(gk));
  }
  for (const [gk, m] of Object.entries(groupsMeta)) {
    const loc = queueLocate(queues, gk);
    const want = loc
      ? loc.list === "done"
        ? "done"
        : metaPatch[`${gk}/open`] === false
        ? "queued"
        : m.open
        ? "running"
        : "queued"
      : "idle";
    /* status 純顯示用，缺值時退回從 open/venueId 推導的值。既然推導出來
       的就是對的，就別為了補欄位而製造一次寫入——否則 reconcile 永遠
       不會安定下來（每次載入都寫一輪）。 */
    const effVenue = `${gk}/venueId` in metaPatch ? metaPatch[`${gk}/venueId`] : m.venueId;
    const effOpen = `${gk}/open` in metaPatch ? metaPatch[`${gk}/open`] : m.open;
    const cur =
      `${gk}/status` in metaPatch
        ? metaPatch[`${gk}/status`]
        : m.status ?? statusOf({ venueId: effVenue, open: effOpen });
    if (cur !== want) setMeta(gk, { status: want });
    else delete metaPatch[`${gk}/status`];
  }

  const sameArr = (a, b) =>
    a.length === b.length && a.every((x, i) => x === b[i]);
  let changed = Object.keys(metaPatch).length > 0;
  if (!changed) {
    /* 只比內容，不比 key 是否存在：空佇列的場地在 RTDB 裡根本沒有節點
       （空陣列不會被儲存），拿 key 數量來比會永遠判定「有變」，
       每次 reconcile 都寫一輪。 */
    for (const vid of venueIds) {
      const prev = venueQueue(existingQueues, vid);
      if (
        !sameArr(prev.order, queues[vid].order) ||
        !sameArr(prev.done, queues[vid].done)
      ) {
        changed = true;
        break;
      }
    }
    /* 已刪除的場地還留在 queues 裡也要清掉 */
    if (!changed) {
      changed = Object.keys(existingQueues || {}).some(
        (v) => !venueIds.includes(v)
      );
    }
  }

  return { queues, metaPatch, changed };
}

/* ------------------------------------------------------------------ */
/* Events Tab                                                         */
/* ------------------------------------------------------------------ */
/*
  佇列引擎。刻意掛在 AdminConsole 而不是 EventsTab：自動接續要在管理員
  切到「即時監看」或「排名結果」時繼續跑，掛在分頁元件上一離開就被卸載。
  只要總控台這一頁開著（任何分頁），這個 hook 就活著。

  仍然是「總控台開著才會自動接續」——把整頁關掉就會停，那要 Cloud
  Functions 才解得掉。
*/
function useQueueEngine({ groupsMeta, setGroupsMeta, venuesConfig, athletes, enabled }) {
  const [queues, setQueues] = useState({});
  const [ready, setReady] = useState(false);
  const [headStatus, setHeadStatus] = useState({});

  const venues = venuesConfig.venues || [];

  /* 保持最新值給非同步流程（自動接續的去抖）讀，避免抓到過期的 closure。 */
  const queuesRef = useRef(queues);
  queuesRef.current = queues;
  const metaRef = useRef(groupsMeta);
  metaRef.current = groupsMeta;

  /* 名單／場地的組成一變（重新匯入、清空、增刪場地）就重新 reconcile：
     種進新項目、清掉孤兒。同一份組成下不會重跑，所以不會打架。
     一般的開關與排序變動走 sWatch，不會動到這個 key。 */
  const shapeKey =
    Object.keys(groupsMeta).sort().join("|") +
    "#" +
    (venuesConfig.venues || []).map((v) => v.id).join("|");

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    (async () => {
      const existing = (await getJSON("queues", {})) || {};
      if (!active) return;
      const r = reconcileQueues(groupsMeta, venuesConfig, existing);
      setQueues(r.queues);
      setReady(true);
      if (r.changed) {
        if (Object.keys(r.metaPatch).length) {
          await sUpdate("groups-meta", r.metaPatch);
          setGroupsMeta((prev) => applyMetaPatch(prev, r.metaPatch));
        }
        /* 逐場地更新而不是整份覆蓋：另一台管理裝置可能剛好在動別的場地。 */
        const patch = {};
        for (const vid of Object.keys(r.queues)) {
          patch[`${vid}/order`] = r.queues[vid].order;
          patch[`${vid}/done`] = r.queues[vid].done;
          patch[`${vid}/auto`] = !!r.queues[vid].auto;
        }
        await sUpdate("queues", patch);
      }
    })();
    return () => {
      active = false;
    };
    /* 相依只有 shapeKey：項目集合／場地集合變了才重跑，open 與排序的
       日常變動不會觸發。 */
  }, [enabled, shapeKey]);

  useEffect(() => {
    if (!ready) return;
    /* v 為 null 代表整個 key 被刪掉（例如清空名單），要跟著清空，
       否則畫面會停在已經不存在的舊佇列。 */
    return sWatch("queues", (v) => setQueues(normalizeAll(v || {})));
  }, [ready]);

  /* 項目開關要即時反映到看板，自動接續也靠這個觀察到自己寫入的結果。 */
  useEffect(() => {
    return sWatch("groups-meta", (v) => setGroupsMeta(v || {}));
  }, [setGroupsMeta]);

  const commit = useCallback(
    async (action) => {
      const cur = queuesRef.current;
      const meta = metaRef.current;
      const { nextQueues, metaPatch, touched } = buildQueueMutation(
        cur,
        meta,
        action
      );
      setQueues(nextQueues);
      if (Object.keys(metaPatch).length) {
        setGroupsMeta((prev) => applyMetaPatch(prev, metaPatch));
        /* 先寫 meta（裁判端看到的東西），再寫 queue。 */
        await sUpdate("groups-meta", metaPatch);
      }
      if (touched.length) {
        const patch = {};
        for (const vid of touched) {
          const q = nextQueues[vid];
          patch[`${vid}/order`] = q.order;
          patch[`${vid}/done`] = q.done;
          patch[`${vid}/auto`] = !!q.auto;
          patch[`${vid}/updatedAt`] = Date.now();
        }
        const ok = await sUpdate("queues", patch);
        if (!ok) {
          const fresh = (await getJSON("queues", {})) || {};
          setQueues(normalizeAll(fresh));
        }
      }
    },
    [setGroupsMeta]
  );

  /* 只監看每個場地的佇列首位：judgeCount+1 個 listener／場地，取代原本
     每張卡片各跑一個 5 秒輪詢（54 組 × 3 裁判 ≈ 每 5 秒 216 次讀取）。 */
  const heads = venues
    .map((v) => ({ vid: v.id, gk: venueQueue(queues, v.id).order[0] || null }))
    .filter((h) => h.gk);
  const headsKey = heads.map((h) => `${h.vid}:${h.gk}`).join("|");
  /* 按下「開始」時 headsKey 不變（首位還是同一個項目），但自動接續要重新
     判斷，所以把 open 與 auto 也算進重掛的條件。 */
  const armKey = heads
    .map(
      (h) =>
        `${h.vid}:${groupsMeta[h.gk]?.open ? 1 : 0}:${
          venueQueue(queues, h.vid).auto ? 1 : 0
        }`
    )
    .join("|");

  const advancingRef = useRef({});

  useEffect(() => {
    if (!ready) return;
    const unsubs = [];
    const timers = {};
    let active = true;
    /* 從 headsKey 還原清單，確保 effect body 讀到的一定是觸發它的那份，
       不會跟相依陣列脫節。 */
    const headsList = headsKey
      ? headsKey.split("|").map((p) => {
          const i = p.indexOf(":");
          return { vid: p.slice(0, i), gk: p.slice(i + 1) };
        })
      : [];

    for (const { vid, gk } of headsList) {
      const venue = venues.find((v) => v.id === vid);
      if (!venue) continue;

      const check = async () => {
        /* 每次都重讀 meta：headsKey 只在首位換人時改變，open 翻轉或名單
           變動都不會重掛這個 effect，抓 closure 裡的舊值會算錯。 */
        const meta = metaRef.current[gk];
        if (!meta) return;
        const st = await fetchGroupCompletion(gk, meta, venue, athletes);
        if (!active) return;
        setHeadStatus((prev) => ({ ...prev, [vid]: { gk, ...st } }));

        /* 零位選手的項目永遠不會「完成」，會把佇列卡死 → 視為立即完成。 */
        const complete = st.complete || (meta.athleteIds || []).length === 0;
        const q = venueQueue(queuesRef.current, vid);
        const m = metaRef.current[gk];
        if (!complete || !q.auto || !m || !m.open) {
          clearTimeout(timers[vid]);
          return;
        }

        clearTimeout(timers[vid]);
        /* 去抖：裁判長把 0 改成 0.3、或裁判修正打錯的字，都不該跟接續搶跑。
           抖動讓兩台管理裝置不會在同一毫秒開火。 */
        timers[vid] = setTimeout(async () => {
          const key = `${vid}:${gk}`;
          if (advancingRef.current[key]) return;
          /* 去抖期間首位可能已被拖走或撤銷 */
          if (venueQueue(queuesRef.current, vid).order[0] !== gk) return;
          const mm = metaRef.current[gk];
          if (!mm || !mm.open) return;
          advancingRef.current[key] = true;
          try {
            await commit({ type: "advance", venueId: vid });
          } finally {
            delete advancingRef.current[key];
          }
        }, 1500 + 200 + Math.random() * 600);
      };

      check();
      const keys = [
        ...venue.judges.map((j) => `score:${gk}:${j.id}`),
        `bonus:${gk}`,
      ];
      keys.forEach((k) => unsubs.push(sWatch(k, () => check())));
    }

    return () => {
      active = false;
      unsubs.forEach((off) => off());
      Object.values(timers).forEach((t) => clearTimeout(t));
    };
  }, [ready, headsKey, armKey, athletes, venuesConfig, commit]);

  return { queues, ready, headStatus, commit };
}

/* ------------------------------------------------------------------ */
/* Events Tab（純畫面，佇列邏輯在 useQueueEngine）                      */
/* ------------------------------------------------------------------ */
function EventsTab({ groupsMeta, venuesConfig, engine }) {
  const { queues, ready, headStatus, commit } = engine;
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedGk, setSelectedGk] = useState(null);
  const [activeCol, setActiveCol] = useState("pool");
  const [dragGk, setDragGk] = useState(null);
  const [confirmSkip, setConfirmSkip] = useState(null);

  const isWide = useMediaQuery("(min-width: 900px)");
  const isTouch = useMediaQuery("(pointer: coarse)");
  const dndOn = isWide && !isTouch;

  const venues = venuesConfig.venues || [];

  const allKeys = Object.keys(groupsMeta);
  const queuedSet = new Set();
  for (const v of venues) {
    const q = venueQueue(queues, v.id);
    q.order.forEach((gk) => queuedSet.add(gk));
    q.done.forEach((gk) => queuedSet.add(gk));
  }
  const poolKeys = allKeys
    .filter((gk) => !queuedSet.has(gk))
    .filter((gk) => {
      const m = groupsMeta[gk];
      const text = `${m.ageGroup} ${m.eventName} ${m.gender}`.toLowerCase();
      return text.includes(searchQuery.toLowerCase());
    });

  const placeInto = (gk, vid) => {
    if (!gk) return;
    if (vid === "pool") commit({ type: "remove", gk });
    else commit({ type: "place", gk, toVenue: vid, toIndex: venueQueue(queues, vid).order.length });
    setSelectedGk(null);
  };

  const moveBy = (gk, delta) => {
    const loc = queueLocate(queues, gk);
    if (!loc || loc.list !== "order") return;
    commit({
      type: "place",
      gk,
      toVenue: loc.venueId,
      toIndex: loc.index + delta,
    });
  };

  const askAdvance = (vid) => {
    const st = headStatus[vid];
    const q = venueQueue(queues, vid);
    if (!q.order.length) return;
    const meta = groupsMeta[q.order[0]];
    const empty = (meta?.athleteIds || []).length === 0;
    if (st && (st.complete || empty)) {
      commit({ type: "advance", venueId: vid });
    } else {
      setConfirmSkip(vid);
    }
  };

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } })
  );

  const onDragEnd = (ev) => {
    setDragGk(null);
    const { active: a, over } = ev;
    if (!a || !over) return;
    const gk = String(a.id);
    const overId = String(over.id);
    if (overId === "pool") return placeInto(gk, "pool");
    if (overId.startsWith("venue:")) {
      const vid = overId.slice(6);
      return commit({
        type: "place",
        gk,
        toVenue: vid,
        toIndex: venueQueue(queues, vid).order.length,
      });
    }
    const loc = queueLocate(queues, overId);
    if (!loc || loc.list !== "order") return;
    if (overId === gk) return;
    commit({ type: "place", gk, toVenue: loc.venueId, toIndex: loc.index });
  };

  if (!ready) return <Loading />;

  const columns = [
    { id: "pool", label: "資料庫", count: poolKeys.length },
    ...venues.map((v) => ({
      id: v.id,
      label: v.name,
      count: venueQueue(queues, v.id).order.length,
    })),
  ];

  const poolCol = (
    <PoolColumn
      keys={poolKeys}
      groupsMeta={groupsMeta}
      searchQuery={searchQuery}
      setSearchQuery={setSearchQuery}
      selectedGk={selectedGk}
      onSelect={(gk) => setSelectedGk((p) => (p === gk ? null : gk))}
      onDrop={() => placeInto(selectedGk, "pool")}
      venues={venues}
      onMoveTo={(gk, vid) => placeInto(gk, vid)}
      total={allKeys.length}
      dndOn={dndOn}
    />
  );

  const venueCols = venues.map((v) => (
    <VenueColumn
      key={v.id}
      venue={v}
      queue={venueQueue(queues, v.id)}
      groupsMeta={groupsMeta}
      headStatus={headStatus[v.id]}
      selectedGk={selectedGk}
      onSelect={(gk) => setSelectedGk((p) => (p === gk ? null : gk))}
      onDrop={() => placeInto(selectedGk, v.id)}
      onMoveBy={moveBy}
      onMoveTo={(gk, vid) => placeInto(gk, vid)}
      onRemove={(gk) => commit({ type: "remove", gk })}
      onStart={(gk) => commit({ type: "start", gk })}
      onAdvance={() => askAdvance(v.id)}
      onToggleAuto={() => commit({ type: "toggleAuto", venueId: v.id })}
      venues={venues}
      dndOn={dndOn}
    />
  ));

  const board = isWide ? (
    <div
      className="qboard"
      style={{ display: "flex", gap: 12, alignItems: "flex-start" }}
    >
      <div style={{ flex: "1 1 0", minWidth: 0 }}>{poolCol}</div>
      {venueCols.map((c, i) => (
        <div key={venues[i].id} style={{ flex: "1 1 0", minWidth: 0 }}>
          {c}
        </div>
      ))}
    </div>
  ) : (
    <div className="qboard">
      <div
        style={{
          display: "flex",
          gap: 6,
          overflowX: "auto",
          marginBottom: 12,
          paddingBottom: 4,
        }}
      >
        {columns.map((c) => {
          const on = activeCol === c.id;
          const target = selectedGk && !on;
          return (
            <button
              key={c.id}
              onClick={() => {
                if (target) placeInto(selectedGk, c.id);
                setActiveCol(c.id);
              }}
              style={{
                flex: "0 0 auto",
                padding: "8px 12px",
                borderRadius: 8,
                border: `1px solid ${target ? C.gold : on ? C.red : C.border}`,
                background: on ? C.surfaceAlt : "transparent",
                color: target ? C.gold : on ? C.text : C.textMuted,
                fontFamily: FONT_BODY,
                fontSize: 13,
                fontWeight: 600,
                cursor: "pointer",
                whiteSpace: "nowrap",
              }}
            >
              {c.label} ({c.count})
              {target ? " ↓放這" : ""}
            </button>
          );
        })}
      </div>
      {activeCol === "pool" ? poolCol : venueCols[venues.findIndex((v) => v.id === activeCol)] || poolCol}
    </div>
  );

  const wrapped = dndOn ? (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={(e) => setDragGk(String(e.active.id))}
      onDragEnd={onDragEnd}
      onDragCancel={() => setDragGk(null)}
    >
      {board}
      <DragOverlay>
        {dragGk && groupsMeta[dragGk] ? (
          <QueueItemCard
            gk={dragGk}
            m={groupsMeta[dragGk]}
            state="queued"
            dragging
          />
        ) : null}
      </DragOverlay>
    </DndContext>
  ) : (
    board
  );

  const skipVenue = venues.find((v) => v.id === confirmSkip);
  const skipSt = confirmSkip ? headStatus[confirmSkip] : null;

  return (
    <div>
      <SectionTitle eyebrow="Step 3" title="項目控制" icon={LayoutGrid} />
      <div style={{ color: C.textMuted, fontSize: 13, marginBottom: 14 }}>
        把項目從資料庫排進場地佇列。每個場地同時只跑首位一個項目，按「開始」裁判才看得到；
        其餘是等候中。開啟「自動接續」後，評分與裁判長加分收齊會自動換下一個。
        {dndOn ? "可直接拖動排序，也可" : "可"}點選項目再點目標場地移動。
      </div>
      {wrapped}
      {confirmSkip && (
        <Confirm
          open
          text={`${skipVenue?.name || ""} 目前的項目還沒收齊分數${
            skipSt ? `（${skipSt.submitted}/${skipSt.expected}）` : ""
          }，仍要跳到下一項嗎？`}
          onNo={() => setConfirmSkip(null)}
          onYes={() => {
            commit({ type: "advance", venueId: confirmSkip });
            setConfirmSkip(null);
          }}
        />
      )}
    </div>
  );
}

/* 把 "gk/field" 形式的 patch 套回本地的 groupsMeta，讓 UI 立刻反應。 */
function applyMetaPatch(meta, patch) {
  const next = { ...meta };
  for (const [path, val] of Object.entries(patch)) {
    const i = path.indexOf("/");
    const gk = path.slice(0, i);
    const field = path.slice(i + 1);
    if (!next[gk]) continue;
    next[gk] = { ...next[gk], [field]: val };
  }
  return next;
}

const normalizeAll = (raw) => {
  const out = {};
  for (const vid of Object.keys(raw || {})) out[vid] = normQueue(raw[vid]);
  return out;
};

function ColumnShell({ title, subtitle, right, onDrop, dropActive, children, droppableId, dndOn }) {
  const dz = useDroppableSafe(droppableId, dndOn);
  return (
    <div
      ref={dz.setNodeRef}
      style={{
        background: dz.isOver ? C.surfaceAlt : C.surface,
        border: `1px solid ${dropActive || dz.isOver ? C.gold : C.border}`,
        borderRadius: 10,
        padding: 12,
      }}
    >
      <div
        onClick={dropActive ? onDrop : undefined}
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 8,
          marginBottom: 10,
          cursor: dropActive ? "pointer" : "default",
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div
            style={{
              color: dropActive ? C.gold : C.text,
              fontSize: 14,
              fontWeight: 700,
              fontFamily: FONT_DISPLAY,
              letterSpacing: 0.4,
            }}
          >
            {dropActive ? `↓ 放到 ${title}` : title}
          </div>
          {subtitle && (
            <div style={{ color: C.textFaint, fontSize: 11.5, marginTop: 2 }}>
              {subtitle}
            </div>
          )}
        </div>
        {right}
      </div>
      <div
        className="qcol"
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 8,
          maxHeight: "62vh",
          overflowY: "auto",
        }}
      >
        {children}
      </div>
    </div>
  );
}

/* useDroppable 只能在 DndContext 內呼叫，桌面以外要退回無操作版本。
   hook 不能有條件地呼叫，所以用兩個元件包裝，由 dndOn 決定渲染哪個。 */
function useDroppableSafe(id, dndOn) {
  const noop = { setNodeRef: undefined, isOver: false };
  const real = useDroppable({ id, disabled: !dndOn });
  return dndOn ? real : noop;
}

function PoolColumn({
  keys,
  groupsMeta,
  searchQuery,
  setSearchQuery,
  selectedGk,
  onSelect,
  onDrop,
  venues,
  onMoveTo,
  total,
  dndOn,
}) {
  const dropActive = !!selectedGk && !keys.includes(selectedGk);
  return (
    <ColumnShell
      title="資料庫"
      subtitle={`${keys.length} / ${total} 個項目未排入場地`}
      onDrop={onDrop}
      dropActive={dropActive}
      droppableId="pool"
      dndOn={dndOn}
    >
      <div style={{ position: "relative", marginBottom: 4 }}>
        <Search
          size={15}
          color={C.textFaint}
          style={{
            position: "absolute",
            left: 11,
            top: "50%",
            transform: "translateY(-50%)",
          }}
        />
        <TextInput
          placeholder="快速搜尋項目、年齡組或組別..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          style={{ paddingLeft: 34 }}
        />
      </div>
      {total === 0 && (
        <div style={{ color: C.textFaint, fontSize: 13 }}>請先匯入名單</div>
      )}
      {total > 0 && keys.length === 0 && (
        <div style={{ color: C.textFaint, fontSize: 13, padding: "6px 2px" }}>
          {searchQuery ? "沒有找到符合的項目" : "全部項目都已排入場地"}
        </div>
      )}
      {keys.map((gk) => (
        <QueueItemCard
          key={gk}
          gk={gk}
          m={groupsMeta[gk]}
          state="idle"
          selected={selectedGk === gk}
          onSelect={() => onSelect(gk)}
          venues={venues}
          onMoveTo={onMoveTo}
          dndOn={dndOn}
          sortable={false}
        />
      ))}
    </ColumnShell>
  );
}

function VenueColumn({
  venue,
  queue,
  groupsMeta,
  headStatus,
  selectedGk,
  onSelect,
  onDrop,
  onMoveBy,
  onMoveTo,
  onRemove,
  onStart,
  onAdvance,
  onToggleAuto,
  venues,
  dndOn,
}) {
  const [showDone, setShowDone] = useState(false);
  const dropActive = !!selectedGk && !queue.order.includes(selectedGk);
  const head = queue.order[0];
  const headMeta = head ? groupsMeta[head] : null;
  const stMatches = headStatus && headStatus.gk === head ? headStatus : null;

  const body = (
    <>
      {queue.order.length === 0 && (
        <div style={{ color: C.textFaint, fontSize: 13, padding: "6px 2px" }}>
          佇列已空
        </div>
      )}
      {queue.order.map((gk, i) => {
        const m = groupsMeta[gk];
        if (!m) return null;
        const state = i === 0 ? (m.open ? "running" : "ready") : "queued";
        return (
          <QueueItemCard
            key={gk}
            gk={gk}
            m={m}
            state={state}
            position={i + 1}
            completion={i === 0 ? stMatches : null}
            selected={selectedGk === gk}
            onSelect={() => onSelect(gk)}
            onUp={i > 0 ? () => onMoveBy(gk, -1) : null}
            onDown={i < queue.order.length - 1 ? () => onMoveBy(gk, 1) : null}
            onStart={state === "ready" ? () => onStart(gk) : null}
            onRemove={() => onRemove(gk)}
            venues={venues}
            onMoveTo={onMoveTo}
            dndOn={dndOn}
            sortable
          />
        );
      })}
    </>
  );

  return (
    <ColumnShell
      title={venue.name}
      subtitle={
        queue.auto
          ? "自動接續：開啟（需保持總控台開著）"
          : `${venue.judgeCount} 位裁判 · 自動接續關閉`
      }
      onDrop={onDrop}
      dropActive={dropActive}
      droppableId={`venue:${venue.id}`}
      dndOn={dndOn}
      right={
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <Btn
            size="sm"
            variant={queue.auto ? "gold" : "ghost"}
            onClick={onToggleAuto}
            title="評分收齊後自動換下一個項目"
          >
            <Zap size={13} /> 自動
          </Btn>
          <Btn
            size="sm"
            variant="ghost"
            onClick={onAdvance}
            disabled={!queue.order.length}
            title="跳到下一個項目"
          >
            <SkipForward size={13} />
          </Btn>
        </div>
      }
    >
      {headMeta && stMatches && (
        <div
          style={{
            fontSize: 11.5,
            color: stMatches.complete ? C.blue : C.textMuted,
            fontFamily: FONT_MONO,
            padding: "2px 2px 4px",
          }}
        >
          首位進度 {stMatches.submitted}/{stMatches.expected}
          {stMatches.complete ? " · 已收齊" : ""}
        </div>
      )}
      {dndOn ? (
        <SortableContext items={queue.order} strategy={verticalListSortingStrategy}>
          {body}
        </SortableContext>
      ) : (
        body
      )}
      {queue.done.length > 0 && (
        <div style={{ marginTop: 6 }}>
          <button
            onClick={() => setShowDone((s) => !s)}
            style={{
              background: "none",
              border: "none",
              color: C.textFaint,
              fontSize: 12,
              fontFamily: FONT_BODY,
              cursor: "pointer",
              padding: "4px 2px",
            }}
          >
            {showDone ? "▾" : "▸"} 已完成 ({queue.done.length})
          </button>
          {showDone &&
            queue.done.map((gk) => {
              const m = groupsMeta[gk];
              if (!m) return null;
              return (
                <QueueItemCard
                  key={gk}
                  gk={gk}
                  m={m}
                  state="done"
                  selected={selectedGk === gk}
                  onSelect={() => onSelect(gk)}
                  onStart={() => onStart(gk)}
                  onRemove={() => onRemove(gk)}
                  venues={venues}
                  onMoveTo={onMoveTo}
                  dndOn={false}
                  sortable={false}
                />
              );
            })}
        </div>
      )}
    </ColumnShell>
  );
}

const STATE_BADGE = {
  idle: null,
  queued: { tone: "default", label: "等候中" },
  ready: { tone: "pending", label: "待開始" },
  running: { tone: "open", label: "進行中" },
  done: { tone: "gold", label: "已完成" },
};

function QueueItemCard(props) {
  /* sortable 版本要呼叫 useSortable，非 sortable 版本不能呼叫（hook 規則），
     所以拆成兩個元件由外層挑。 */
  return props.sortable && props.dndOn ? (
    <SortableQueueItem {...props} />
  ) : (
    <QueueItemBody {...props} />
  );
}

function SortableQueueItem(props) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: props.gk });
  return (
    <QueueItemBody
      {...props}
      setNodeRef={setNodeRef}
      handleProps={{ ...attributes, ...listeners }}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.4 : 1,
      }}
    />
  );
}

function QueueItemBody({
  gk,
  m,
  state = "idle",
  position,
  completion,
  selected,
  onSelect,
  onUp,
  onDown,
  onStart,
  onRemove,
  venues,
  onMoveTo,
  dragging,
  setNodeRef,
  handleProps,
  style,
}) {
  const badge = STATE_BADGE[state];
  const accent =
    state === "running" ? C.red : state === "done" ? C.blue : state === "ready" ? C.gold : null;

  return (
    <div
      ref={setNodeRef}
      style={{
        border: `1px solid ${selected ? C.gold : C.border}`,
        borderLeft: accent ? `3px solid ${accent}` : `1px solid ${selected ? C.gold : C.border}`,
        borderRadius: 8,
        background: dragging ? C.surfaceAlt : C.surface,
        padding: "8px 10px",
        boxShadow: selected ? `0 0 0 2px ${C.gold}33` : undefined,
        ...style,
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
        {handleProps && (
          <span className="qhandle" {...handleProps} style={{ paddingTop: 2 }}>
            <GripVertical size={15} color={C.textFaint} />
          </span>
        )}
        <div
          onClick={onSelect}
          style={{ flex: 1, minWidth: 0, cursor: onSelect ? "pointer" : "default" }}
        >
          <div
            style={{
              color: C.text,
              fontSize: 13.5,
              fontWeight: 600,
              lineHeight: 1.35,
            }}
          >
            {position ? (
              <span style={{ color: C.textFaint, fontFamily: FONT_MONO }}>
                #{position}{" "}
              </span>
            ) : null}
            {m.ageGroup} · {m.eventName} · {m.gender}
          </div>
          <div
            style={{
              color: C.textFaint,
              fontSize: 11.5,
              marginTop: 2,
              display: "flex",
              gap: 8,
              alignItems: "center",
              flexWrap: "wrap",
            }}
          >
            <span>{m.athleteIds?.length || 0} 位選手</span>
            {badge && <Badge tone={badge.tone}>{badge.label}</Badge>}
            {completion && state === "running" && (
              <span style={{ fontFamily: FONT_MONO }}>
                {completion.submitted}/{completion.expected}
              </span>
            )}
          </div>
        </div>
      </div>

      {(onUp || onDown || onStart || onRemove || onMoveTo) && (
        <div
          style={{
            display: "flex",
            gap: 6,
            marginTop: 8,
            alignItems: "center",
            flexWrap: "wrap",
          }}
        >
          {onUp !== undefined && (
            <Btn size="sm" variant="ghost" onClick={onUp} disabled={!onUp}>
              <ArrowUp size={13} />
            </Btn>
          )}
          {onDown !== undefined && (
            <Btn size="sm" variant="ghost" onClick={onDown} disabled={!onDown}>
              <ArrowDown size={13} />
            </Btn>
          )}
          {onStart && (
            <Btn
              size="sm"
              variant="primary"
              onClick={onStart}
              style={
                state === "done"
                  ? undefined
                  : { background: C.red, borderColor: C.red, color: "#FFF" }
              }
            >
              <Play size={13} /> {state === "done" ? "重新開啟" : "開始"}
            </Btn>
          )}
          {onMoveTo && (
            <Select
              value=""
              onChange={(e) => e.target.value && onMoveTo(gk, e.target.value)}
              style={{ width: 108, height: 30, fontSize: 12, padding: "0 8px" }}
            >
              <option value="">移至…</option>
              <option value="pool">資料庫</option>
              {venues
                .filter((v) => v.id !== m.venueId)
                .map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
            </Select>
          )}
          {onRemove && (
            <Btn size="sm" variant="ghost" onClick={onRemove} title="拉回資料庫">
              <Undo2 size={13} />
            </Btn>
          )}
        </div>
      )}
    </div>
  );
}

/* ---- Monitor Tab ---- */
function GroupPicker({ groupKeys, groupsMeta, value, onChange }) {
  return (
    <Select
      value={value || ""}
      onChange={(e) => onChange(e.target.value)}
      style={{ maxWidth: 360, marginBottom: 16 }}
    >
      <option value="">全部顯示（未選擇）</option>
      {groupKeys.map((gk) => {
        const m = groupsMeta[gk];
        return (
          <option key={gk} value={gk}>
            {m.ageGroup} · {m.eventName} · {m.gender}
          </option>
        );
      })}
    </Select>
  );
}

function ResultsTable({ results, venue, scaleMax }) {
  if (!results) return null;
  return (
    <div style={{ overflowX: "auto" }}>
      <table
        style={{
          width: "100%",
          borderCollapse: "collapse",
          fontFamily: FONT_BODY,
          fontSize: 13,
        }}
      >
        <thead>
          <tr style={{ borderBottom: `1px solid ${C.border}` }}>
            <th style={th}>序</th>
            <th style={{ ...th, textAlign: "left" }}>選手</th>
            {venue?.judges.map((j) => (
              <th key={j.id} style={th}>
                {j.name}
              </th>
            ))}
            <th style={th}>裁判長加分</th>
            <th style={th}>平均</th>
            <th style={th}>總分</th>
            <th style={th}>名次</th>
            <th style={th}>狀態</th>
          </tr>
        </thead>
        <tbody>
          {results.map((r) => (
            <tr
              key={r.athlete.id}
              style={{ borderBottom: `1px solid ${C.border}` }}
            >
              <td style={td}>{r.athlete.order}</td>
              <td style={{ ...td, textAlign: "left" }}>
                <div style={{ color: C.text }}>{r.athlete.cnName}</div>
                <div style={{ color: C.textFaint, fontSize: 11 }}>
                  {r.athlete.enName}
                </div>
              </td>
              {r.scores.map((s) => (
                <td key={s.judgeId} style={{ ...td, fontFamily: FONT_MONO }}>
                  {s.value === null ? "—" : s.value.toFixed(2)}
                </td>
              ))}
              <td style={{ ...td, fontFamily: FONT_MONO, color: C.gold }}>
                {r.bonus === null ? "—" : r.bonus.toFixed(2)}
              </td>
              <td style={{ ...td, fontFamily: FONT_MONO }}>
                {r.avg === null ? "—" : r.avg.toFixed(2)}
              </td>
              <td
                style={{
                  ...td,
                  fontFamily: FONT_MONO,
                  fontWeight: 700,
                  color: r.final !== null ? C.text : C.textFaint,
                }}
              >
                {r.final === null ? "—" : r.final.toFixed(2)}
              </td>
              <td style={td}>
                {r.rank ? <Badge tone="gold">#{r.rank}</Badge> : "—"}
              </td>
              <td style={td}>
                {r.needsMeeting ? (
                  <Badge tone="warn">
                    <AlertTriangle size={11} style={{ marginRight: 3 }} />
                    需開會
                  </Badge>
                ) : r.complete ? (
                  <Badge tone="open">完成</Badge>
                ) : (
                  <Badge tone="pending">
                    {r.submittedCount}/{r.judgeCount}
                  </Badge>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
const th = {
  padding: "8px 10px",
  color: C.textFaint,
  fontWeight: 600,
  fontSize: 11.5,
  textAlign: "center",
  whiteSpace: "nowrap",
};
const td = { padding: "8px 10px", color: C.textMuted, textAlign: "center" };

function MonitorTab({ groupKeys, groupsMeta, venuesConfig, athletes }) {
  const [gk, setGk] = useState("");
  const [groupResultsMap, setGroupResultsMap] = useState({});
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    setBusy(true);
    const targetKeys = gk ? [gk] : groupKeys;
    const newMap = {};
    for (const k of targetKeys) {
      const meta = groupsMeta[k];
      if (!meta || !meta.venueId) continue;
      const venue = venuesConfig.venues.find((v) => v.id === meta.venueId);
      if (!venue) continue;
      const r = await computeGroupResults(k, meta, venue, athletes);
      newMap[k] = { results: r, venue, meta };
    }
    setGroupResultsMap(newMap);
    setBusy(false);
  }, [gk, groupKeys, groupsMeta, venuesConfig, athletes]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  /* 選定單一項目時改用即時監聽（分數一寫入就更新）。
     「全部顯示」維持輪詢：全部監聽會需要 組數×(裁判數+1) 個常駐監聽器，
     54 組時就是 200 個以上，手機負擔太大。 */
  useEffect(() => {
    if (!gk) {
      const t = setInterval(refresh, 8000);
      return () => clearInterval(t);
    }
    const meta = groupsMeta[gk];
    const venue = meta && venuesConfig.venues.find((v) => v.id === meta.venueId);
    if (!venue) return;

    const keys = [
      ...venue.judges.map((j) => `score:${gk}:${j.id}`),
      `bonus:${gk}`,
    ];
    const unsubs = keys.map((k) => sWatch(k, () => refresh()));
    return () => unsubs.forEach((off) => off());
  }, [gk, groupsMeta, venuesConfig, refresh]);

  const activeKeys = gk ? [gk] : groupKeys;
  const anyMeeting = Object.values(groupResultsMap).some((item) =>
    item.results?.some((r) => r.needsMeeting)
  );

  return (
    <div>
      <SectionTitle eyebrow="Live" title="即時分數監看" icon={ClipboardList} />
      <GroupPicker
        groupKeys={groupKeys}
        groupsMeta={groupsMeta}
        value={gk}
        onChange={setGk}
      />

      {anyMeeting && (
        <Card
          style={{
            padding: 12,
            marginBottom: 14,
            borderColor: C.redDim,
            background: "#2A1712",
            display: "flex",
            gap: 8,
            alignItems: "center",
          }}
        >
          <AlertTriangle size={16} color="#F0A08C" />
          <span style={{ color: "#F0A08C", fontSize: 13 }}>
            有選手裁判分數差超過 0.5，建議召開評審會議
          </span>
        </Card>
      )}

      <div
        style={{
          display: "flex",
          justifyContent: "flex-end",
          marginBottom: 10,
        }}
      >
        <Btn size="sm" variant="ghost" onClick={refresh} disabled={busy}>
          <RefreshCw size={13} /> 重新整理
        </Btn>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        {activeKeys.map((k) => {
          const item = groupResultsMap[k];
          if (!item) return null;
          const { results, venue, meta } = item;
          return (
            <Card key={k} style={{ padding: 14 }}>
              <div
                style={{
                  fontFamily: FONT_DISPLAY,
                  fontSize: 16,
                  color: C.gold,
                  marginBottom: 10,
                }}
              >
                {meta.ageGroup} · {meta.eventName} · {meta.gender}{" "}
                <span style={{ fontSize: 12, color: C.textFaint }}>
                  ({venue.name})
                </span>
              </div>
              <ResultsTable results={results} venue={venue} />
            </Card>
          );
        })}
        {activeKeys.length === 0 && (
          <div style={{ color: C.textFaint, fontSize: 13 }}>尚無項目資料</div>
        )}
      </div>
    </div>
  );
}

/* ---- Ranking Tab ---- */
function RankingTab({ groupKeys, groupsMeta, venuesConfig, athletes }) {
  const [gk, setGk] = useState("");
  const [rankingMap, setRankingMap] = useState({});

  useEffect(() => {
    (async () => {
      const targetKeys = gk ? [gk] : groupKeys;
      const newMap = {};
      for (const k of targetKeys) {
        const meta = groupsMeta[k];
        if (!meta || !meta.venueId) continue;
        const venue = venuesConfig.venues.find((v) => v.id === meta.venueId);
        if (!venue) continue;
        const results = await computeGroupResults(k, meta, venue, athletes);
        const ranked =
          results?.filter((r) => r.complete).sort((a, b) => a.rank - b.rank) ||
          [];
        newMap[k] = { ranked, meta };
      }
      setRankingMap(newMap);
    })();
  }, [gk, groupKeys, groupsMeta, venuesConfig, athletes]);

  const medalColor = (rank) =>
    rank === 1
      ? C.gold
      : rank === 2
      ? C.silver
      : rank === 3
      ? C.bronze
      : C.textFaint;
  const activeKeys = gk ? [gk] : groupKeys;

  return (
    <div>
      <SectionTitle eyebrow="Result" title="項目排名結果" icon={BarChart3} />
      <GroupPicker
        groupKeys={groupKeys}
        groupsMeta={groupsMeta}
        value={gk}
        onChange={setGk}
      />

      <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
        {activeKeys.map((k) => {
          const item = rankingMap[k];
          if (!item) return null;
          const { ranked, meta } = item;
          return (
            <div key={k}>
              <div
                style={{
                  fontFamily: FONT_DISPLAY,
                  fontSize: 16,
                  color: C.gold,
                  marginBottom: 10,
                }}
              >
                {meta.ageGroup} · {meta.eventName} · {meta.gender}
              </div>
              {ranked.length > 0 ? (
                <div
                  style={{ display: "flex", flexDirection: "column", gap: 8 }}
                >
                  {ranked.map((r) => (
                    <Card
                      key={r.athlete.id}
                      style={{
                        padding: "12px 16px",
                        display: "flex",
                        alignItems: "center",
                        gap: 16,
                      }}
                    >
                      <span
                        style={{
                          fontFamily: FONT_DISPLAY,
                          fontSize: 26,
                          fontWeight: 700,
                          color: medalColor(r.rank),
                          minWidth: 40,
                        }}
                      >
                        {r.rank}
                      </span>
                      <div style={{ flex: 1 }}>
                        <div style={{ color: C.text, fontSize: 14.5 }}>
                          {r.athlete.cnName}{" "}
                          <span style={{ color: C.textFaint, fontSize: 12 }}>
                            {r.athlete.enName}
                          </span>
                        </div>
                      </div>
                      <ScoreDigits
                        value={r.final}
                        size={22}
                        color={medalColor(r.rank)}
                      />
                    </Card>
                  ))}
                </div>
              ) : (
                <div style={{ color: C.textFaint, fontSize: 13 }}>
                  尚無完成評分的選手
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ---- Best Athlete Tab ---- */
function BestTab({ groupsMeta, venuesConfig, athletes }) {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);

  const run = async () => {
    setBusy(true);
    const r = await computeBestAthletes(groupsMeta, venuesConfig, athletes);
    setData(r);
    setBusy(false);
  };

  useEffect(() => {
    run();
  }, [groupsMeta, venuesConfig, athletes]);

  const List = ({ items, label }) => (
    <div>
      <div
        style={{
          color: C.gold,
          fontFamily: FONT_DISPLAY,
          fontSize: 16,
          marginBottom: 10,
          letterSpacing: 0.5,
        }}
      >
        {label}
      </div>
      {items.length === 0 && (
        <div style={{ color: C.textFaint, fontSize: 13, marginBottom: 20 }}>
          暫無符合資格（需參加 3 項以上）的選手
        </div>
      )}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 8,
          marginBottom: 24,
        }}
      >
        {items.map((s, i) => (
          <Card key={i} style={{ padding: "12px 16px" }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <div>
                <span
                  style={{
                    fontFamily: FONT_DISPLAY,
                    fontSize: 20,
                    color: i === 0 ? C.gold : C.textMuted,
                    marginRight: 10,
                  }}
                >
                  {i + 1}
                </span>
                <span style={{ color: C.text, fontSize: 14.5 }}>
                  {s.cnName}
                </span>
                <span
                  style={{ color: C.textFaint, fontSize: 12, marginLeft: 6 }}
                >
                  {s.enName}
                </span>
              </div>
              <ScoreDigits
                value={s.scoredCount > 0 ? s.avg : null}
                size={20}
                color={i === 0 ? C.gold : C.text}
              />
            </div>
            <div style={{ color: C.textFaint, fontSize: 11.5, marginTop: 6 }}>
              已報名 {s.events.length} 項（已完成評分 {s.scoredCount} 項）：
              {s.events
                .map(
                  (e) =>
                    `${e.label} ${
                      e.final !== null ? `(${e.final})` : "(未評分)"
                    }`
                )
                .join("、")}
            </div>
          </Card>
        ))}
      </div>
    </div>
  );

  return (
    <div>
      <SectionTitle eyebrow="Overall" title="最佳運動員" icon={Trophy} />
      <div style={{ color: C.textMuted, fontSize: 13, marginBottom: 14 }}>
        取參加 3
        項或以上項目的選手（即使尚未有分數也會列出資格），各項總分平均，男女分開計算。
      </div>
      <Btn
        variant="primary"
        onClick={run}
        disabled={busy}
        style={{ marginBottom: 20 }}
      >
        <RefreshCw size={15} /> {busy ? "計算中…" : "重新整理"}
      </Btn>
      {data && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 10 }}>
          <List items={data.male} label="男子組 最佳運動員資格名單" />
          <List items={data.female} label="女子組 最佳運動員資格名單" />
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Judge Portal                                                       */
/* ------------------------------------------------------------------ */
function JudgePortal({ onBack }) {
  const [venuesConfig, setVenuesConfig] = useState(null);
  const [groupsMeta, setGroupsMeta] = useState({});
  const [athletes, setAthletes] = useState([]);
  const [venueId, setVenueId] = useState("");
  const [judgeId, setJudgeId] = useState("");
  const [isChief, setIsChief] = useState(false);
  const [loggedIn, setLoggedIn] = useState(false);

  useEffect(() => {
    (async () => {
      const [v, a] = await Promise.all([
        getJSON("venues-config", { scaleMax: 10, venues: [] }),
        getJSON("athletes", []),
      ]);
      setVenuesConfig(v);
      setAthletes(a);
    })();
    /* 項目開關由管理端控制，必須即時收到，否則裁判要重新整理才看得到 */
    return sWatch("groups-meta", (v) => setGroupsMeta(v || {}));
  }, []);

  if (!venuesConfig)
    return (
      <div style={{ minHeight: "100vh" }}>
        <TopBar title="裁判入口" onBack={onBack} />
        <Loading />
      </div>
    );

  const venue = venuesConfig.venues.find((v) => v.id === venueId);

  if (!loggedIn) {
    return (
      <div style={{ minHeight: "100vh" }}>
        <TopBar title="裁判入口" onBack={onBack} />
        <div style={{ padding: 20, maxWidth: 420, margin: "0 auto" }}>
          <SectionTitle eyebrow="Login" title="選擇身分登入" icon={LogIn} />
          {venuesConfig.venues.length === 0 && (
            <div style={{ color: C.textFaint, fontSize: 13 }}>
              總控台尚未設定場地
            </div>
          )}
          <Card style={{ padding: 16 }}>
            <Field label="場地">
              <Select
                value={venueId}
                onChange={(e) => {
                  setVenueId(e.target.value);
                  setJudgeId("");
                  setIsChief(false);
                }}
              >
                <option value="">選擇場地…</option>
                {venuesConfig.venues.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
              </Select>
            </Field>
            {venue && (
              <Field label="我是" hint="請確認再選擇，登入後將以此身分打分">
                <Select
                  value={isChief ? "chief" : judgeId}
                  onChange={(e) => {
                    if (e.target.value === "chief") {
                      setIsChief(true);
                      setJudgeId("");
                    } else {
                      setIsChief(false);
                      setJudgeId(e.target.value);
                    }
                  }}
                >
                  <option value="">選擇裁判…</option>
                  {venue.judges.map((j) => (
                    <option key={j.id} value={j.id}>
                      {j.name}
                    </option>
                  ))}
                  <option value="chief">{venue.chief.name}（裁判長）</option>
                </Select>
              </Field>
            )}
            <Btn
              variant="primary"
              onClick={() => setLoggedIn(true)}
              disabled={!venue || (!judgeId && !isChief)}
              style={{ marginTop: 14, width: "100%", justifyContent: "center" }}
            >
              <Lock size={14} /> 登入
            </Btn>
          </Card>
        </div>
      </div>
    );
  }

  const myLabel = isChief
    ? `${venue.chief.name}（裁判長）`
    : venue.judges.find((j) => j.id === judgeId)?.name;

  return (
    <JudgeScoring
      venue={venue}
      scaleMax={venuesConfig.scaleMax}
      groupsMeta={groupsMeta}
      athletes={athletes}
      isChief={isChief}
      judgeId={judgeId}
      myLabel={myLabel}
      onBack={onBack}
    />
  );
}

function JudgeScoring({
  venue,
  scaleMax,
  groupsMeta,
  athletes,
  isChief,
  judgeId,
  myLabel,
  onBack,
}) {
  const [gk, setGk] = useState("");

  /* 管理端的佇列保證一個場地同時只有一個項目 open，所以這裡不必再去算
     「這個項目是不是已經評完了」——那原本要對每個候選項目做
     judgeCount+1 次讀取、每 4 秒一輪。groupsMeta 由 JudgePortal 的
     sWatch 即時推過來，純推導就夠了。 */
  const openGroups = Object.entries(groupsMeta).filter(
    ([, m]) => m.venueId === venue.id && m.open
  );

  /* 管理端換項目時自動跟著跳，裁判不用自己選。 */
  /* 以字串當相依，openGroups 每次 render 都是新陣列，直接放進相依會讓
     effect 每次都跑。 */
  const openKeys = openGroups.map(([k]) => k).join("|");
  useEffect(() => {
    const keys = openKeys ? openKeys.split("|") : [];
    setGk((cur) => (keys.includes(cur) ? cur : keys[0] || ""));
  }, [openKeys]);

  return (
    <div style={{ minHeight: "100vh" }}>
      <TopBar title={`裁判評分 · ${venue.name}`} onBack={onBack} />
      <div
        style={{
          padding: "10px 20px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          borderBottom: `1px solid ${C.border}`,
        }}
      >
        <div style={{ color: C.textMuted, fontSize: 13 }}>
          身分：
          <span style={{ color: isChief ? C.gold : C.text, fontWeight: 700 }}>
            {myLabel}
          </span>
        </div>
      </div>
      <div style={{ padding: 20, maxWidth: 640, margin: "0 auto" }}>
        {openGroups.length === 0 ? (
          <Card
            style={{ padding: 20, textAlign: "center", color: C.textFaint }}
          >
            目前沒有進行中或未完成的項目
            <br />
            <span style={{ fontSize: 12 }}>所有指派項目皆已評分完畢</span>
          </Card>
        ) : (
          <>
            <Select
              value={gk}
              onChange={(e) => setGk(e.target.value)}
              style={{ marginBottom: 16 }}
            >
              {openGroups.map(([k, m]) => (
                <option key={k} value={k}>
                  {m.ageGroup} · {m.eventName} · {m.gender}
                </option>
              ))}
            </Select>
            {gk && (
              <ScoreEntry
                groupKey={gk}
                meta={groupsMeta[gk]}
                venue={venue}
                scaleMax={scaleMax}
                athletes={athletes}
                isChief={isChief}
                judgeId={judgeId}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}

function ScoreEntry({
  groupKey,
  meta,
  venue,
  scaleMax,
  athletes,
  isChief,
  judgeId,
}) {
  const [values, setValues] = useState({});
  const [saving, setSaving] = useState({});
  const timers = useRef({});
  const storeKey = isChief
    ? `bonus:${groupKey}`
    : `score:${groupKey}:${judgeId}`;

  useEffect(() => {
    let cancelled = false;
    getJSON(storeKey, {}).then((v) => {
      if (!cancelled) setValues(v || {});
    });
    return () => {
      cancelled = true;
    };
  }, [storeKey]);

  if (!meta) return null;
  const groupAthletes = athletes
    .filter((a) => meta.athleteIds?.includes(a.id))
    .sort((a, b) => a.order - b.order);

  const onChangeVal = (athleteId, raw) => {
    const cleanDigits = raw.replace(/[^0-9]/g, "");
    if (cleanDigits === "") {
      const next = { ...values };
      delete next[athleteId];
      setValues(next);
      return;
    }

    const num = parseInt(cleanDigits, 10) / 100;
    const finalVal = num > scaleMax ? scaleMax : num;

    const next = { ...values, [athleteId]: finalVal };
    setValues(next);
    setSaving((s) => ({ ...s, [athleteId]: "typing" }));
    clearTimeout(timers.current[athleteId]);
    timers.current[athleteId] = setTimeout(async () => {
      await setJSON(storeKey, next);
      setSaving((s) => ({ ...s, [athleteId]: "saved" }));
      setTimeout(() => setSaving((s) => ({ ...s, [athleteId]: null })), 1200);
    }, 500);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ color: C.textFaint, fontSize: 12, marginBottom: 4 }}>
        {isChief
          ? `裁判長加分（直接輸入數字自動帶入小數點，上限 ${scaleMax}）`
          : `評分（直接輸入數字自動帶入小數點，上限 ${scaleMax}）· 其他裁判分數保密`}
      </div>
      {groupAthletes.map((a) => {
        const currentVal = values[a.id];
        const displayVal =
          currentVal !== undefined && currentVal !== null
            ? Number(currentVal).toFixed(2)
            : "";

        return (
          <Card
            key={a.id}
            style={{
              padding: "12px 14px",
              display: "flex",
              alignItems: "center",
              gap: 12,
              borderStyle: "dashed",
              borderColor: isChief ? C.goldDim : C.border,
            }}
          >
            <div
              style={{
                fontFamily: FONT_MONO,
                fontSize: 12,
                color: C.textFaint,
                background: C.bg,
                border: `1px solid ${C.border}`,
                borderRadius: 6,
                padding: "3px 7px",
                minWidth: 24,
                textAlign: "center",
              }}
            >
              {a.order}
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ color: C.text, fontSize: 14.5 }}>{a.cnName}</div>
              <div style={{ color: C.textFaint, fontSize: 11.5 }}>
                {a.enName}
              </div>
            </div>
            <input
              type="text"
              inputMode="numeric"
              value={displayVal}
              onChange={(e) => onChangeVal(a.id, e.target.value)}
              placeholder="—"
              style={{
                ...inputStyle,
                width: 92,
                textAlign: "center",
                fontFamily: FONT_MONO,
                fontSize: 18,
                fontWeight: 700,
                borderColor: isChief ? C.goldDim : C.border,
              }}
            />
            <span
              style={{
                fontSize: 10,
                width: 30,
                color: saving[a.id] === "saved" ? C.green : "transparent",
              }}
            >
              已存
            </span>
          </Card>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Board (public leaderboard)                                         */
/* ------------------------------------------------------------------ */
function BoardView({ onBack }) {
  const [groupsMeta, setGroupsMeta] = useState({});
  const [venuesConfig, setVenuesConfig] = useState({
    scaleMax: 10,
    venues: [],
  });
  const [athletes, setAthletes] = useState([]);
  const [gk, setGk] = useState("");
  const [boardResultsMap, setBoardResultsMap] = useState({});

  useEffect(() => {
    (async () => {
      const [g, v, a] = await Promise.all([
        getJSON("groups-meta", {}),
        getJSON("venues-config", { scaleMax: 10, venues: [] }),
        getJSON("athletes", []),
      ]);
      setGroupsMeta(g);
      setVenuesConfig(v);
      setAthletes(a);
    })();
  }, []);

  useEffect(() => {
    const groupKeys = Object.keys(groupsMeta);
    if (groupKeys.length === 0) return;

    const load = async () => {
      const targetKeys = gk ? [gk] : groupKeys;
      const newMap = {};
      for (const k of targetKeys) {
        const meta = groupsMeta[k];
        if (!meta || !meta.venueId) continue;
        const venue = venuesConfig.venues.find((v) => v.id === meta.venueId);
        if (!venue) continue;
        const results = await computeGroupResults(k, meta, venue, athletes);
        const ranked =
          results?.filter((r) => r.complete).sort((a, b) => a.rank - b.rank) ||
          [];
        newMap[k] = { ranked, meta };
      }
      setBoardResultsMap(newMap);
    };

    load();
    const t = setInterval(load, 6000);
    return () => clearInterval(t);
  }, [gk, groupsMeta, venuesConfig, athletes]);

  const groupKeys = Object.keys(groupsMeta);
  const activeKeys = gk ? [gk] : groupKeys;
  const medalColor = (rank) =>
    rank === 1
      ? C.gold
      : rank === 2
      ? C.silver
      : rank === 3
      ? C.bronze
      : C.textMuted;

  return (
    <div style={{ minHeight: "100vh" }}>
      <TopBar title="成績看板" onBack={onBack} />
      <div style={{ padding: 20, maxWidth: 600, margin: "0 auto" }}>
        <GroupPicker
          groupKeys={groupKeys}
          groupsMeta={groupsMeta}
          value={gk}
          onChange={setGk}
        />

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 30,
            marginTop: 20,
          }}
        >
          {activeKeys.map((k) => {
            const item = boardResultsMap[k];
            if (!item) return null;
            const { ranked, meta } = item;
            return (
              <div key={k}>
                <div style={{ textAlign: "center", marginBottom: 12 }}>
                  <div
                    style={{
                      fontFamily: FONT_DISPLAY,
                      fontSize: 20,
                      color: C.gold,
                    }}
                  >
                    {meta.ageGroup} · {meta.eventName} · {meta.gender}
                  </div>
                </div>
                <div
                  style={{ display: "flex", flexDirection: "column", gap: 10 }}
                >
                  {ranked.map((r) => (
                    <Card
                      key={r.athlete.id}
                      style={{
                        padding: "16px 18px",
                        display: "flex",
                        alignItems: "center",
                        gap: 18,
                        borderColor:
                          r.rank <= 3 ? medalColor(r.rank) : C.border,
                      }}
                    >
                      <span
                        style={{
                          fontFamily: FONT_DISPLAY,
                          fontSize: 34,
                          fontWeight: 700,
                          color: medalColor(r.rank),
                          minWidth: 48,
                        }}
                      >
                        {r.rank}
                      </span>
                      <div style={{ flex: 1 }}>
                        <div style={{ color: C.text, fontSize: 17 }}>
                          {r.athlete.cnName}
                        </div>
                        <div style={{ color: C.textFaint, fontSize: 12.5 }}>
                          {r.athlete.enName}
                        </div>
                      </div>
                      <ScoreDigits
                        value={r.final}
                        size={28}
                        color={medalColor(r.rank)}
                      />
                    </Card>
                  ))}
                  {ranked.length === 0 && (
                    <div
                      style={{
                        color: C.textFaint,
                        textAlign: "center",
                        fontSize: 13,
                      }}
                    >
                      該項目評分尚未完成
                    </div>
                  )}
                </div>
              </div>
            );
          })}
          {activeKeys.length === 0 && (
            <div
              style={{ color: C.textFaint, textAlign: "center", fontSize: 13 }}
            >
              尚無項目資料
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* App                                                                */
/* ------------------------------------------------------------------ */
export default function App() {
  useFonts();
  const [role, setRole] = useState(null);

  return (
    <div
      style={{
        background: C.bg,
        color: C.text,
        minHeight: "100vh",
        fontFamily: FONT_BODY,
      }}
    >
      <style>{`
        input[type=number]::-webkit-outer-spin-button, input[type=number]::-webkit-inner-spin-button { opacity: 1; }
        ::selection { background: ${C.redDim}; }
        @keyframes spin { from { transform: rotate(0deg);} to { transform: rotate(360deg);} }
        .spin { animation: spin 1s linear infinite; }
        * { box-sizing: border-box; }
        .qcol::-webkit-scrollbar { width: 6px; }
        .qcol::-webkit-scrollbar-thumb { background: ${C.border}; border-radius: 3px; }
        .qboard { touch-action: pan-y; }
        .qhandle { cursor: grab; touch-action: none; }
        .qhandle:active { cursor: grabbing; }
      `}</style>
      {!role && <Landing onPick={setRole} />}
      {role === "admin" && <AdminConsole onBack={() => setRole(null)} />}
      {role === "judge" && <JudgePortal onBack={() => setRole(null)} />}
      {role === "board" && <BoardView onBack={() => setRole(null)} />}
    </div>
  );
}
