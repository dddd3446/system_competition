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
} from "lucide-react";
import { initializeApp } from "firebase/app";
import { getDatabase, ref, get, set, remove } from "firebase/database";
import { getAuth, signInAnonymously, onAuthStateChanged } from "firebase/auth";

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
const getJSON = async (key, fallback) => {
  const v = await sGet(key);
  return v !== null ? v : fallback;
};
const setJSON = (key, obj) => sSet(key, obj);

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
  const judgeScores = {};
  for (const j of venue.judges) {
    judgeScores[j.id] = (await getJSON(`score:${groupKey}:${j.id}`, {})) || {};
  }
  const bonusMap = (await getJSON(`bonus:${groupKey}`, {})) || {};
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
      <div style={{ padding: 20, maxWidth: 900, margin: "0 auto" }}>
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
                setGroupsMeta={setGroupsMeta}
                venuesConfig={venuesConfig}
                athletes={athletes}
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

/* ---- Events Tab ---- */
function EventsTab({ groupsMeta, setGroupsMeta, venuesConfig, athletes }) {
  const [searchQuery, setSearchQuery] = useState("");

  const save = async (newMeta) => {
    setGroupsMeta(newMeta);
    await setJSON("groups-meta", newMeta);
  };
  const assignVenue = (gk, venueId) =>
    save({ ...groupsMeta, [gk]: { ...groupsMeta[gk], venueId } });
  const toggleOpen = (gk) =>
    save({
      ...groupsMeta,
      [gk]: { ...groupsMeta[gk], open: !groupsMeta[gk].open },
    });

  const keys = Object.keys(groupsMeta);

  const filteredKeys = keys.filter((gk) => {
    const m = groupsMeta[gk];
    const text = `${m.ageGroup} ${m.eventName} ${m.gender}`.toLowerCase();
    return text.includes(searchQuery.toLowerCase());
  });

  return (
    <div>
      <SectionTitle eyebrow="Step 3" title="項目控制" icon={LayoutGrid} />
      <div style={{ color: C.textMuted, fontSize: 13, marginBottom: 14 }}>
        指派場地後開啟項目，裁判才會在該項目下看到參賽選手。當所有評分與裁判長加分完成後，按鈕會自動變為藍色「已完成」。
      </div>

      {/* 快速搜尋列 */}
      <div style={{ position: "relative", marginBottom: 16 }}>
        <Search
          size={16}
          color={C.textFaint}
          style={{
            position: "absolute",
            left: 12,
            top: "50%",
            transform: "translateY(-50%)",
          }}
        />
        <TextInput
          placeholder="快速搜尋項目、年齡組或組別..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          style={{ paddingLeft: 38 }}
        />
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {keys.length === 0 && (
          <div style={{ color: C.textFaint, fontSize: 13 }}>請先匯入名單</div>
        )}
        {keys.length > 0 && filteredKeys.length === 0 && (
          <div style={{ color: C.textFaint, fontSize: 13 }}>
            沒有找到符合的項目
          </div>
        )}
        {filteredKeys.map((gk) => {
          const m = groupsMeta[gk];
          const venue = venuesConfig.venues.find((v) => v.id === m.venueId);

          return (
            <EventsCardItem
              key={gk}
              gk={gk}
              m={m}
              venue={venue}
              athletes={athletes}
              onAssignVenue={assignVenue}
              onToggleOpen={toggleOpen}
              venuesConfig={venuesConfig}
            />
          );
        })}
      </div>
    </div>
  );
}

function EventsCardItem({
  gk,
  m,
  venue,
  athletes,
  onAssignVenue,
  onToggleOpen,
  venuesConfig,
}) {
  const [isCompleted, setIsCompleted] = useState(false);

  useEffect(() => {
    let active = true;
    async function checkComplete() {
      if (!venue || !m.athleteIds || m.athleteIds.length === 0) {
        if (active) setIsCompleted(false);
        return;
      }
      const res = await computeGroupResults(gk, m, venue, athletes);
      if (!res || res.length === 0) {
        if (active) setIsCompleted(false);
        return;
      }
      const bonusMap = (await getJSON(`bonus:${gk}`, {})) || {};
      const allDone = res.every(
        (r) => r.complete && typeof bonusMap[r.athlete.id] === "number"
      );
      if (active) setIsCompleted(allDone);
    }
    checkComplete();
    const t = setInterval(checkComplete, 5000);
    return () => {
      active = false;
      clearInterval(t);
    };
  }, [gk, m, venue, athletes]);

  return (
    <Card style={{ padding: 14 }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 10,
        }}
      >
        <div>
          <div style={{ color: C.text, fontSize: 14.5, fontWeight: 600 }}>
            {m.ageGroup} · {m.eventName} · {m.gender}
          </div>
          <div style={{ color: C.textFaint, fontSize: 12 }}>
            {m.athleteIds?.length || 0} 位選手
          </div>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <Select
            value={m.venueId || ""}
            onChange={(e) => onAssignVenue(gk, e.target.value || null)}
            style={{ width: 150 }}
          >
            <option value="">未指派場地</option>
            {venuesConfig.venues.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}（{v.judgeCount}裁判）
              </option>
            ))}
          </Select>
          <Btn
            size="sm"
            variant={isCompleted ? "gold" : m.open ? "primary" : "default"}
            onClick={() => onToggleOpen(gk)}
            disabled={!venue}
            style={{
              background: isCompleted ? C.blue : m.open ? C.red : undefined,
              borderColor: isCompleted ? C.blue : m.open ? C.red : undefined,
              color: isCompleted || m.open ? "#FFF" : undefined,
            }}
          >
            {isCompleted ? (
              <>
                <Check size={14} /> 已完成
              </>
            ) : m.open ? (
              <>
                <Check size={14} /> 進行中
              </>
            ) : (
              "開啟評分"
            )}
          </Btn>
        </div>
      </div>
    </Card>
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
  useEffect(() => {
    const t = setInterval(refresh, 8000);
    return () => clearInterval(t);
  }, [refresh]);

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
      const [v, g, a] = await Promise.all([
        getJSON("venues-config", { scaleMax: 10, venues: [] }),
        getJSON("groups-meta", {}),
        getJSON("athletes", []),
      ]);
      setVenuesConfig(v);
      setGroupsMeta(g);
      setAthletes(a);
    })();
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
  const [openGroups, setOpenGroups] = useState([]);
  const [gk, setGk] = useState("");
  const [loadingGroups, setLoadingGroups] = useState(true);

  useEffect(() => {
    let active = true;
    async function filterGroups() {
      const candidateEntries = Object.entries(groupsMeta).filter(
        ([, m]) => m.venueId === venue.id && m.open
      );
      const available = [];
      for (const [k, m] of candidateEntries) {
        const res = await computeGroupResults(k, m, venue, athletes);
        const bonusMap = (await getJSON(`bonus:${k}`, {})) || {};
        const allDone =
          res &&
          res.length > 0 &&
          res.every(
            (r) => r.complete && typeof bonusMap[r.athlete.id] === "number"
          );
        if (!allDone) {
          available.push([k, m]);
        }
      }
      if (active) {
        setOpenGroups(available);
        if (!available.some(([k]) => k === gk)) {
          setGk(available[0]?.[0] || "");
        }
        setLoadingGroups(false);
      }
    }
    filterGroups();
    const t = setInterval(filterGroups, 4000);
    return () => {
      active = false;
      clearInterval(t);
    };
  }, [groupsMeta, venue, athletes, gk]);

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
        {loadingGroups ? (
          <Loading />
        ) : openGroups.length === 0 ? (
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
      `}</style>
      {!role && <Landing onPick={setRole} />}
      {role === "admin" && <AdminConsole onBack={() => setRole(null)} />}
      {role === "judge" && <JudgePortal onBack={() => setRole(null)} />}
      {role === "board" && <BoardView onBack={() => setRole(null)} />}
    </div>
  );
}
