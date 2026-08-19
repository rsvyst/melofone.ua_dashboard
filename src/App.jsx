import React, { useState, useMemo, useRef, useCallback } from "react";
import * as XLSX from "xlsx";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
} from "recharts";

/* ---------------------------------------------------------------------
   MELOFONE.UA — ПУЛЬТ ВОРОНКИ ПРОДАЖІВ (standalone build for GitHub Pages)
   Design language: device-diagnostics terminal. Dark slate chassis,
   signal-bar indicators borrowed from a phone status bar (the shop
   sells phones), monospace readouts for every number, a warm amber
   "charge" accent against a cool signal-blue.

   Unlike the Claude-artifact version, this build runs outside Claude's
   sandbox, so it can fetch the Binotel proxy Worker directly from the
   browser — the "Оновити дзвінки" button is fully live here.
--------------------------------------------------------------------- */

// Binotel proxy (Cloudflare Worker) — holds no Binotel secrets itself,
// only forwards a read-only, simplified list of outgoing calls once the
// PROXY_TOKEN below is presented. Rotate PROXY_TOKEN in the Worker's
// secrets any time and update it here.
const BINOTEL_PROXY_URL = "https://melofone-binotel-proxy.r-svyst.workers.dev/outgoing-calls";
const BINOTEL_PROXY_TOKEN = "mf2026binotelSecureToken91xz";

const GA4_PROXY_URL = "https://melofone-ga4-proxy.r-svyst.workers.dev/ga-summary";
const GA4_PROXY_TOKEN = "kjnqkvjblkejbwlfkelvwweewew";

const COLORS = {
  bg: "#0E1116",
  panel: "#161B22",
  panelBorder: "#252C38",
  text: "#E7EBF2",
  textMuted: "#8B93A3",
  textFaint: "#565F70",
  blue: "#4F9DFF",
  amber: "#FFB454",
  green: "#4ADE80",
  red: "#FB6B6B",
  gray: "#5B6474",
};

const STATUS_META = {
  "Завершено": { label: "Завершено", color: COLORS.green },
  "В обробці": { label: "В обробці", color: COLORS.blue },
  "Не успішне": { label: "Не успішне", color: COLORS.red },
  "Відмова": { label: "Відмова", color: COLORS.gray },
};

const SUCCESS_STATUS = "Завершено";

function fmtMoney(n) {
  if (!isFinite(n)) return "—";
  return (
    Math.round(n)
      .toString()
      .replace(/\B(?=(\d{3})+(?!\d))/g, " ") + " ₴"
  );
}

function fmtDate(d) {
  if (!d) return "—";
  return d.toLocaleDateString("uk-UA", { day: "2-digit", month: "2-digit" });
}

function fmtDateTime(d) {
  if (!d) return "—";
  return d.toLocaleString("uk-UA", {
    day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
  });
}

function fmtMinutes(m) {
  if (m == null || !isFinite(m)) return "—";
  if (m < 60) return `${Math.round(m)} хв`;
  const h = Math.floor(m / 60);
  const rem = Math.round(m % 60);
  return `${h} год ${rem} хв`;
}

function parseSum(val) {
  if (typeof val === "number") return val;
  if (!val) return 0;
  const s = String(val).replace(/\s/g, "").replace(",", ".");
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

function parseDate(val) {
  if (val instanceof Date && !isNaN(val.getTime())) return val;
  if (!val) return null;
  const s = String(val).trim().replace(" ", "T");
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

function parseClient(val) {
  const s = String(val || "");
  const phoneMatch = s.match(/\+?38[\d\s()-]{9,}/);
  const phone = phoneMatch ? phoneMatch[0].replace(/[^\d+]/g, "") : "";
  const name = s.split("(")[0].trim();
  return { name, phone };
}

function parseSource(val) {
  const s = String(val || "").toUpperCase();
  if (s.includes("GOOGLE")) return "Google Ads";
  if (s.includes("FACEBOOK")) return "Facebook Ads";
  return "Не визначено";
}

function parseProduct(val) {
  const s = String(val || "");
  const firstLine = s.split("\n").map((x) => x.trim()).filter(Boolean)[0];
  return firstLine || "—";
}

function normalizeRow(row) {
  const client = parseClient(row["Клієнт"]);
  return {
    id: row["ID"],
    orderNo: row["Номер замовлення"],
    date: parseDate(row["Дата створення"]),
    status: String(row["Статус"] || "").trim(),
    product: parseProduct(row["Товари"]),
    sum: parseSum(row["Сума"]),
    clientName: client.name,
    clientPhone: client.phone,
    source: parseSource(row["UTM"]),
    payment: String(row["Оплата"] || "").split("\n")[0].trim(),
  };
}

/* Last 9 digits — matches +380XXXXXXXXX, 380XXXXXXXXX, 0XXXXXXXXX etc. */
function normPhone(p) {
  const digits = String(p || "").replace(/\D/g, "");
  return digits.slice(-9);
}

function median(arr) {
  if (!arr.length) return null;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/* Small signal-bar glyph, echoes a phone's signal strength indicator */
function SignalBars({ level = 3, color = COLORS.blue }) {
  const heights = [5, 9, 13, 17];
  return (
    <svg width="26" height="18" viewBox="0 0 26 18" style={{ display: "block" }}>
      {heights.map((h, i) => (
        <rect
          key={i}
          x={i * 7}
          y={18 - h}
          width="4"
          height={h}
          rx="1"
          fill={i < level ? color : COLORS.panelBorder}
        />
      ))}
    </svg>
  );
}

function KpiCard({ label, value, sub, level, color, placeholder }) {
  return (
    <div
      style={{
        background: COLORS.panel,
        border: `1px solid ${COLORS.panelBorder}`,
        borderRadius: 10,
        padding: "18px 20px",
        display: "flex",
        flexDirection: "column",
        gap: 10,
        minHeight: 108,
        opacity: placeholder ? 0.6 : 1,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <span style={{
          fontFamily: "'Space Grotesk', sans-serif",
          fontSize: 12,
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          color: COLORS.textMuted,
        }}>
          {label}
        </span>
        {level != null && <SignalBars level={level} color={color || COLORS.blue} />}
      </div>
      <div style={{
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: placeholder ? 15 : 24,
        color: placeholder ? COLORS.textFaint : COLORS.text,
        lineHeight: 1.15,
      }}>
        {value}
      </div>
      {sub && (
        <div style={{ fontSize: 12, color: COLORS.textMuted, fontFamily: "'Inter', sans-serif" }}>
          {sub}
        </div>
      )}
    </div>
  );
}

function Panel({ title, children, right }) {
  return (
    <div style={{
      background: COLORS.panel,
      border: `1px solid ${COLORS.panelBorder}`,
      borderRadius: 10,
      padding: "18px 20px",
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
        <h3 style={{
          margin: 0,
          fontFamily: "'Space Grotesk', sans-serif",
          fontSize: 14,
          letterSpacing: "0.04em",
          textTransform: "uppercase",
          color: COLORS.textMuted,
          fontWeight: 600,
        }}>
          {title}
        </h3>
        {right}
      </div>
      {children}
    </div>
  );
}

function StatusBadge({ status }) {
  const meta = STATUS_META[status] || { label: status, color: COLORS.gray };
  return (
    <span style={{
      display: "inline-flex",
      alignItems: "center",
      gap: 6,
      fontFamily: "'JetBrains Mono', monospace",
      fontSize: 11,
      color: meta.color,
      border: `1px solid ${meta.color}55`,
      background: `${meta.color}14`,
      borderRadius: 20,
      padding: "3px 9px",
      whiteSpace: "nowrap",
    }}>
      <span style={{ width: 6, height: 6, borderRadius: 999, background: meta.color, display: "inline-block" }} />
      {meta.label}
    </span>
  );
}

function ResponseBadge({ minutes }) {
  if (minutes == null) {
    return <span style={{ fontSize: 12, color: COLORS.textFaint }}>дзвінка не знайдено</span>;
  }
  let color = COLORS.green;
  if (minutes > 60) color = COLORS.red;
  else if (minutes > 15) color = COLORS.amber;
  return (
    <span style={{
      fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color,
      background: `${color}14`, borderRadius: 6, padding: "2px 8px",
    }}>
      {fmtMinutes(minutes)}
    </span>
  );
}

export default function MelofoneDashboard() {
  const [orders, setOrders] = useState(null);
  const [fileName, setFileName] = useState(null);
  const [updatedAt, setUpdatedAt] = useState(null);
  const [callsUpdatedAt, setCallsUpdatedAt] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [binotelStatus, setBinotelStatus] = useState("idle"); // idle | loading | success | error
  const [binotelError, setBinotelError] = useState(null);
  const [calls, setCalls] = useState([]);
  const [gaStatus, setGaStatus] = useState("idle"); // idle | loading | success | error
  const [gaError, setGaError] = useState(null);
  const [gaRows, setGaRows] = useState([]);
  const [gaUpdatedAt, setGaUpdatedAt] = useState(null);
  const fileInputRef = useRef(null);

  const fetchGA4 = useCallback(async (normalizedOrders) => {
    const dated = (normalizedOrders || orders || []).filter((o) => o.date);
    if (!dated.length) return;
    const minDate = new Date(Math.min(...dated.map((o) => o.date.getTime())));
    const maxDate = new Date(Math.max(Math.max(...dated.map((o) => o.date.getTime())), Date.now()));
    const toISODate = (d) => d.toISOString().slice(0, 10);

    setGaStatus("loading");
    setGaError(null);
    try {
      const url = `${GA4_PROXY_URL}?start=${toISODate(minDate)}&stop=${toISODate(maxDate)}&token=${encodeURIComponent(GA4_PROXY_TOKEN)}`;
      const res = await fetch(url);
      const data = await res.json();
      if (data.status !== "success") {
        throw new Error(data.message || "Проксі повернув помилку");
      }
      setGaRows(data.rows || []);
      setGaStatus("success");
      setGaUpdatedAt(new Date());
    } catch (err) {
      setGaStatus("error");
      setGaError(String(err.message || err));
    }
  }, [orders]);

  const fetchBinotel = useCallback(async (normalizedOrders) => {
    const dated = (normalizedOrders || orders || []).filter((o) => o.date);
    if (!dated.length) return;
    const minDate = new Date(Math.min(...dated.map((o) => o.date.getTime())));
    const maxDate = new Date(Math.max(...dated.map((o) => o.date.getTime())));
    // pad the window so a call placed a couple of days after the last order is still caught
    const start = Math.floor(minDate.getTime() / 1000) - 3600;
    const stop = Math.floor(Math.max(maxDate.getTime(), Date.now()) / 1000) + 3 * 24 * 3600;

    setBinotelStatus("loading");
    setBinotelError(null);
    try {
      const url = `${BINOTEL_PROXY_URL}?start=${start}&stop=${stop}&token=${encodeURIComponent(BINOTEL_PROXY_TOKEN)}`;
      const res = await fetch(url);
      const data = await res.json();
      if (data.status !== "success") {
        throw new Error(data.message || "Проксі повернув помилку");
      }
      setCalls(data.calls || []);
      setBinotelStatus("success");
      setCallsUpdatedAt(new Date());
    } catch (err) {
      setBinotelStatus("error");
      setBinotelError(String(err.message || err));
    }
  }, [orders]);

  const handleFile = useCallback((file) => {
    if (!file) return;
    setLoading(true);
    setError(null);
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target.result);
        const wb = XLSX.read(data, { type: "array", cellDates: true });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });
        const normalized = rows.map(normalizeRow).filter((r) => r.date);
        setOrders(normalized);
        setFileName(file.name);
        setUpdatedAt(new Date());
        fetchBinotel(normalized);
        fetchGA4(normalized);
      } catch (err) {
        setError("Не вдалося прочитати файл. Перевірте формат (.xls / .xlsx).");
      } finally {
        setLoading(false);
      }
    };
    reader.onerror = () => {
      setError("Помилка читання файлу.");
      setLoading(false);
    };
    reader.readAsArrayBuffer(file);
  }, [fetchBinotel, fetchGA4]);

  const metrics = useMemo(() => {
    if (!orders || orders.length === 0) return null;

    const total = orders.length;
    const successOrders = orders.filter((o) => o.status === SUCCESS_STATUS);
    const successCount = successOrders.length;
    const successRate = total ? (successCount / total) * 100 : 0;
    const revenue = successOrders.reduce((s, o) => s + o.sum, 0);
    const aov = successCount ? revenue / successCount : 0;

    const statusCounts = {};
    orders.forEach((o) => {
      statusCounts[o.status] = (statusCounts[o.status] || 0) + 1;
    });
    const statusData = Object.keys(STATUS_META)
      .filter((k) => statusCounts[k])
      .map((k) => ({ name: STATUS_META[k].label, value: statusCounts[k], color: STATUS_META[k].color }));
    Object.keys(statusCounts).forEach((k) => {
      if (!STATUS_META[k]) statusData.push({ name: k, value: statusCounts[k], color: COLORS.gray });
    });

    const sourceCounts = {};
    orders.forEach((o) => {
      sourceCounts[o.source] = (sourceCounts[o.source] || 0) + 1;
    });
    const sourcePalette = [COLORS.blue, COLORS.amber, COLORS.gray, COLORS.green, COLORS.red];
    const sourceData = Object.keys(sourceCounts).map((k, i) => ({
      name: k, value: sourceCounts[k], color: sourcePalette[i % sourcePalette.length],
    }));

    const byDay = {};
    orders.forEach((o) => {
      const key = o.date.toISOString().slice(0, 10);
      if (!byDay[key]) byDay[key] = { date: key, total: 0, success: 0 };
      byDay[key].total += 1;
      if (o.status === SUCCESS_STATUS) byDay[key].success += 1;
    });
    const dailyData = Object.values(byDay)
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((d) => ({ ...d, label: fmtDate(new Date(d.date)) }));

    const productCounts = {};
    orders.forEach((o) => {
      productCounts[o.product] = (productCounts[o.product] || 0) + 1;
    });
    const topProducts = Object.entries(productCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);

    const withPhone = orders.filter((o) => o.clientPhone).length;

    // --- Binotel: manager response time ---
    const callsByPhone = {};
    calls.forEach((c) => {
      const key = normPhone(c.phone);
      if (!key) return;
      if (!callsByPhone[key]) callsByPhone[key] = [];
      callsByPhone[key].push(c);
    });

    const ordersWithResponse = orders.map((o) => {
      const key = normPhone(o.clientPhone);
      const candidates = (callsByPhone[key] || [])
        .filter((c) => c.time * 1000 >= o.date.getTime())
        .sort((a, b) => a.time - b.time);
      const firstCall = candidates[0];
      const responseMinutes = firstCall ? (firstCall.time * 1000 - o.date.getTime()) / 60000 : null;
      return { ...o, responseMinutes };
    });

    const matched = ordersWithResponse.filter((o) => o.responseMinutes != null);
    const responseTimes = matched.map((o) => o.responseMinutes);
    const avgResponse = responseTimes.length ? responseTimes.reduce((s, v) => s + v, 0) / responseTimes.length : null;
    const medianResponse = median(responseTimes);
    const within15 = responseTimes.length ? (responseTimes.filter((v) => v <= 15).length / responseTimes.length) * 100 : null;
    const within30 = responseTimes.length ? (responseTimes.filter((v) => v <= 30).length / responseTimes.length) * 100 : null;

    const latest = [...ordersWithResponse].sort((a, b) => b.date - a.date).slice(0, 10);

    // --- GA4 traffic ---
    const gaTotalSessions = gaRows.reduce((s, r) => s + (r.sessions || 0), 0);
    const gaTotalUsers = gaRows.reduce((s, r) => s + (r.totalUsers || 0), 0);
    const gaConversions = gaRows.reduce((s, r) => s + (r.conversions || 0), 0);
    const gaChannelTotals = {};
    gaRows.forEach((r) => {
      gaChannelTotals[r.channel] = (gaChannelTotals[r.channel] || 0) + (r.sessions || 0);
    });
    const gaChannelPalette = [COLORS.blue, COLORS.amber, COLORS.green, COLORS.gray, COLORS.red, "#A78BFA", "#22D3EE"];
    const gaChannelData = Object.entries(gaChannelTotals)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 7)
      .map(([name, value], i) => ({ name, value, color: gaChannelPalette[i % gaChannelPalette.length] }));
    const siteConversionRate = gaTotalSessions ? (successCount / gaTotalSessions) * 100 : null;

    return {
      total, successCount, successRate, revenue, aov,
      statusData, sourceData, dailyData, topProducts, latest, withPhone,
      avgResponse, medianResponse, within15, within30,
      matchedCount: matched.length,
      gaTotalSessions, gaTotalUsers, gaConversions, gaChannelData, siteConversionRate,
    };
  }, [orders, calls, gaRows]);

  return (
    <div style={{
      background: COLORS.bg,
      color: COLORS.text,
      minHeight: "100vh",
      fontFamily: "'Inter', sans-serif",
      padding: "28px 24px 40px",
    }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500;600&display=swap');
        * { box-sizing: border-box; }
        ::-webkit-scrollbar { height: 8px; width: 8px; }
        ::-webkit-scrollbar-thumb { background: ${COLORS.panelBorder}; border-radius: 4px; }
        .mf-btn {
          font-family: 'Space Grotesk', sans-serif;
          font-size: 13px;
          font-weight: 600;
          letter-spacing: 0.02em;
          border-radius: 8px;
          padding: 10px 18px;
          cursor: pointer;
          border: 1px solid ${COLORS.blue};
          background: ${COLORS.blue};
          color: #06131F;
          transition: filter 0.15s ease;
        }
        .mf-btn:hover { filter: brightness(1.08); }
        .mf-btn:active { filter: brightness(0.95); }
        .mf-btn:disabled { opacity: 0.6; cursor: default; }
        .mf-btn-secondary {
          background: transparent;
          border-color: ${COLORS.panelBorder};
          color: ${COLORS.text};
        }
        .mf-btn-secondary:hover { filter: none; border-color: ${COLORS.amber}; }
        table.mf-table { border-collapse: collapse; width: 100%; }
        table.mf-table th {
          text-align: left;
          font-family: 'Space Grotesk', sans-serif;
          font-size: 11px;
          letter-spacing: 0.05em;
          text-transform: uppercase;
          color: ${COLORS.textMuted};
          font-weight: 600;
          padding: 8px 10px;
          border-bottom: 1px solid ${COLORS.panelBorder};
        }
        table.mf-table td {
          padding: 9px 10px;
          font-size: 13px;
          border-bottom: 1px solid ${COLORS.panelBorder};
          color: ${COLORS.text};
        }
        table.mf-table tr:last-child td { border-bottom: none; }
      `}</style>

      {/* Header */}
      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "flex-end",
        flexWrap: "wrap", gap: 16, marginBottom: 24,
      }}>
        <div>
          <div style={{
            fontFamily: "'JetBrains Mono', monospace", fontSize: 11,
            color: COLORS.amber, letterSpacing: "0.08em", marginBottom: 6,
          }}>
            MELOFONE.UA · SALES CONTROL
          </div>
          <h1 style={{
            margin: 0, fontFamily: "'Space Grotesk', sans-serif",
            fontSize: 26, fontWeight: 700, color: COLORS.text,
          }}>
            Пульт воронки продажів
          </h1>
          <div style={{ fontSize: 13, color: COLORS.textMuted, marginTop: 6, fontFamily: "'JetBrains Mono', monospace" }}>
            {fileName ? `Файл: ${fileName}` : "Дані ще не завантажені"}
            {updatedAt ? ` · заявки оновлено ${fmtDateTime(updatedAt)}` : ""}
            {callsUpdatedAt ? ` · дзвінки оновлено ${fmtDateTime(callsUpdatedAt)}` : ""}
            {gaUpdatedAt ? ` · трафік оновлено ${fmtDateTime(gaUpdatedAt)}` : ""}
          </div>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <input
            ref={fileInputRef}
            type="file"
            accept=".xls,.xlsx,.csv"
            style={{ display: "none" }}
            onChange={(e) => handleFile(e.target.files?.[0])}
          />
          <button className="mf-btn" onClick={() => fileInputRef.current?.click()} disabled={loading}>
            {loading ? "Завантаження..." : orders ? "↻ Оновити дані (файл)" : "⇪ Завантажити файл замовлень"}
          </button>
          <button
            className="mf-btn mf-btn-secondary"
            onClick={() => fetchBinotel()}
            disabled={!orders || binotelStatus === "loading"}
            title="Підтягнути свіжі дзвінки з Binotel без перезавантаження файлу заявок"
          >
            {binotelStatus === "loading" ? "Оновлення..." : "☎ Оновити дзвінки"}
          </button>
          <button
            className="mf-btn mf-btn-secondary"
            onClick={() => fetchGA4()}
            disabled={!orders || gaStatus === "loading"}
            title="Підтягнути свіжі дані трафіку з Google Analytics"
          >
            {gaStatus === "loading" ? "Оновлення..." : "📈 Оновити трафік"}
          </button>
        </div>
      </div>

      {error && (
        <div style={{
          background: `${COLORS.red}14`, border: `1px solid ${COLORS.red}55`,
          color: COLORS.red, borderRadius: 8, padding: "10px 14px", marginBottom: 20, fontSize: 13,
        }}>
          {error}
        </div>
      )}

      {binotelStatus === "error" && (
        <div style={{
          background: `${COLORS.amber}14`, border: `1px solid ${COLORS.amber}55`,
          color: COLORS.amber, borderRadius: 8, padding: "10px 14px", marginBottom: 20, fontSize: 13,
        }}>
          Не вдалося отримати дзвінки з Binotel-проксі: {binotelError}. Замовлення все одно порахувані нижче — просто без метрики швидкості реакції.
        </div>
      )}

      {gaStatus === "error" && (
        <div style={{
          background: `${COLORS.amber}14`, border: `1px solid ${COLORS.amber}55`,
          color: COLORS.amber, borderRadius: 8, padding: "10px 14px", marginBottom: 20, fontSize: 13,
        }}>
          Не вдалося отримати дані з Google Analytics: {gaError}. Решта дашборду порахована нижче — просто без метрик трафіку.
        </div>
      )}

      {!orders && !loading && (
        <div style={{
          border: `1px dashed ${COLORS.panelBorder}`, borderRadius: 10,
          padding: "50px 20px", textAlign: "center", color: COLORS.textMuted, fontSize: 14,
        }}>
          Натисніть «Завантажити файл замовлень» і оберіть експорт з адмінки (.xls / .xlsx).<br />
          Дашборд порахує метрики прямо в браузері та підтягне дзвінки з Binotel за цей період.
        </div>
      )}

      {metrics && (
        <>
          {/* KPI row */}
          <div style={{
            display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))",
            gap: 14, marginBottom: 20,
          }}>
            <KpiCard label="Всього заявок" value={metrics.total} level={4} color={COLORS.blue} />
            <KpiCard
              label="Успішні замовлення"
              value={metrics.successCount}
              sub={`${metrics.successRate.toFixed(1)}% конверсія`}
              level={Math.max(1, Math.round((metrics.successRate / 100) * 4))}
              color={COLORS.green}
            />
            <KpiCard label="Виручка (успішні)" value={fmtMoney(metrics.revenue)} level={4} color={COLORS.amber} />
            <KpiCard label="Середній чек" value={fmtMoney(metrics.aov)} level={3} color={COLORS.amber} />
            {gaStatus === "success" ? (
              <KpiCard
                label="Трафік (сесії)"
                value={metrics.gaTotalSessions.toLocaleString("uk-UA")}
                sub={metrics.siteConversionRate != null ? `${metrics.siteConversionRate.toFixed(2)}% конверсія сайту` : `${metrics.gaTotalUsers.toLocaleString("uk-UA")} користувачів`}
                level={4}
                color={COLORS.blue}
              />
            ) : (
              <KpiCard
                label="Трафік (GA)"
                value={gaStatus === "loading" ? "Завантаження..." : "Немає даних"}
                sub={gaStatus === "error" ? "Помилка GA4-проксі" : "Натисніть «Оновити трафік»"}
                placeholder
              />
            )}
            {binotelStatus === "success" ? (
              <KpiCard
                label="Реакція менеджера"
                value={fmtMinutes(metrics.medianResponse)}
                sub={metrics.within30 != null ? `${metrics.within30.toFixed(0)}% дзвінків за 30 хв · ${metrics.matchedCount}/${metrics.total} заявок з дзвінком` : "медіана"}
                level={metrics.medianResponse != null ? (metrics.medianResponse <= 15 ? 4 : metrics.medianResponse <= 30 ? 3 : metrics.medianResponse <= 60 ? 2 : 1) : 1}
                color={COLORS.green}
              />
            ) : (
              <KpiCard
                label="Реакція менеджера"
                value={binotelStatus === "loading" ? "Завантаження..." : "Немає даних"}
                sub={binotelStatus === "error" ? "Помилка Binotel-проксі" : "Binotel"}
                placeholder
              />
            )}
          </div>

          {/* Charts row */}
          <div style={{ display: "grid", gridTemplateColumns: "1.6fr 1fr", gap: 14, marginBottom: 14 }}>
            <Panel title="Заявки по днях">
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={metrics.dailyData} barGap={2}>
                  <CartesianGrid strokeDasharray="3 3" stroke={COLORS.panelBorder} vertical={false} />
                  <XAxis dataKey="label" stroke={COLORS.textFaint} fontSize={11} tickLine={false} axisLine={{ stroke: COLORS.panelBorder }} />
                  <YAxis stroke={COLORS.textFaint} fontSize={11} tickLine={false} axisLine={false} allowDecimals={false} />
                  <Tooltip
                    contentStyle={{ background: COLORS.panel, border: `1px solid ${COLORS.panelBorder}`, borderRadius: 8, fontSize: 12 }}
                    labelStyle={{ color: COLORS.text }}
                  />
                  <Legend wrapperStyle={{ fontSize: 12, color: COLORS.textMuted }} />
                  <Bar dataKey="total" name="Всього" fill={COLORS.blue} radius={[4, 4, 0, 0]} />
                  <Bar dataKey="success" name="Завершено" fill={COLORS.green} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </Panel>

            <Panel title="Статуси заявок">
              <ResponsiveContainer width="100%" height={240}>
                <PieChart>
                  <Pie
                    data={metrics.statusData}
                    dataKey="value"
                    nameKey="name"
                    innerRadius={55}
                    outerRadius={85}
                    paddingAngle={2}
                  >
                    {metrics.statusData.map((entry, i) => (
                      <Cell key={i} fill={entry.color} stroke={COLORS.panel} strokeWidth={2} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={{ background: COLORS.panel, border: `1px solid ${COLORS.panelBorder}`, borderRadius: 8, fontSize: 12 }} />
                  <Legend wrapperStyle={{ fontSize: 11, color: COLORS.textMuted }} />
                </PieChart>
              </ResponsiveContainer>
            </Panel>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1.2fr", gap: 14, marginBottom: 14 }}>
            <Panel title="Джерела заявок">
              <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie data={metrics.sourceData} dataKey="value" nameKey="name" outerRadius={78}>
                    {metrics.sourceData.map((entry, i) => (
                      <Cell key={i} fill={entry.color} stroke={COLORS.panel} strokeWidth={2} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={{ background: COLORS.panel, border: `1px solid ${COLORS.panelBorder}`, borderRadius: 8, fontSize: 12 }} />
                  <Legend wrapperStyle={{ fontSize: 11, color: COLORS.textMuted }} />
                </PieChart>
              </ResponsiveContainer>
            </Panel>

            <Panel title="Топ товарів">
              <div style={{ display: "flex", flexDirection: "column", gap: 10, paddingTop: 4 }}>
                {metrics.topProducts.map(([name, count], i) => (
                  <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                    <span style={{ fontSize: 12.5, color: COLORS.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {name}
                    </span>
                    <span style={{
                      fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: COLORS.amber,
                      background: `${COLORS.amber}14`, borderRadius: 6, padding: "2px 8px", flexShrink: 0,
                    }}>
                      {count}
                    </span>
                  </div>
                ))}
              </div>
            </Panel>

            <Panel title="Якість даних">
              <div style={{ display: "flex", flexDirection: "column", gap: 10, fontSize: 12.5, color: COLORS.textMuted, paddingTop: 4 }}>
                <div>Заявок з телефоном: <span style={{ color: COLORS.text, fontFamily: "'JetBrains Mono', monospace" }}>{metrics.withPhone} з {metrics.total}</span></div>
                <div>Заявок з визначеним джерелом: <span style={{ color: COLORS.text, fontFamily: "'JetBrains Mono', monospace" }}>
                  {metrics.total - (metrics.sourceData.find((s) => s.name === "Не визначено")?.value || 0)} з {metrics.total}
                </span></div>
                <div>Заявок зі знайденим дзвінком: <span style={{ color: COLORS.text, fontFamily: "'JetBrains Mono', monospace" }}>
                  {metrics.matchedCount} з {metrics.total}
                </span></div>
                {binotelStatus !== "success" && (
                  <div style={{ color: COLORS.textFaint, marginTop: 4 }}>
                    Швидкість реакції менеджера рахується по номеру телефону клієнта та часу першого вихідного дзвінка з Binotel.
                  </div>
                )}
              </div>
            </Panel>
          </div>

          {gaStatus === "success" && metrics.gaChannelData.length > 0 && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1.6fr", gap: 14, marginBottom: 14 }}>
              <Panel title="Сесії за каналами (GA4)">
                <ResponsiveContainer width="100%" height={220}>
                  <PieChart>
                    <Pie data={metrics.gaChannelData} dataKey="value" nameKey="name" outerRadius={82}>
                      {metrics.gaChannelData.map((entry, i) => (
                        <Cell key={i} fill={entry.color} stroke={COLORS.panel} strokeWidth={2} />
                      ))}
                    </Pie>
                    <Tooltip contentStyle={{ background: COLORS.panel, border: `1px solid ${COLORS.panelBorder}`, borderRadius: 8, fontSize: 12 }} />
                    <Legend wrapperStyle={{ fontSize: 11, color: COLORS.textMuted }} />
                  </PieChart>
                </ResponsiveContainer>
              </Panel>

              <Panel title="Сайт vs. заявки">
                <div style={{ display: "flex", flexDirection: "column", gap: 12, fontSize: 13, color: COLORS.textMuted, paddingTop: 4 }}>
                  <div>Всього сесій на сайті: <span style={{ color: COLORS.text, fontFamily: "'JetBrains Mono', monospace" }}>{metrics.gaTotalSessions.toLocaleString("uk-UA")}</span></div>
                  <div>Унікальних користувачів: <span style={{ color: COLORS.text, fontFamily: "'JetBrains Mono', monospace" }}>{metrics.gaTotalUsers.toLocaleString("uk-UA")}</span></div>
                  <div>Подій-конверсій в GA4 (усі типи): <span style={{ color: COLORS.text, fontFamily: "'JetBrains Mono', monospace" }}>{metrics.gaConversions.toLocaleString("uk-UA")}</span></div>
                  <div>Заявок з файлу адмінки: <span style={{ color: COLORS.text, fontFamily: "'JetBrains Mono', monospace" }}>{metrics.total}</span></div>
                  <div>Успішних замовлень: <span style={{ color: COLORS.text, fontFamily: "'JetBrains Mono', monospace" }}>{metrics.successCount}</span></div>
                  {metrics.siteConversionRate != null && (
                    <div style={{
                      marginTop: 4, fontSize: 22, fontFamily: "'JetBrains Mono', monospace", color: COLORS.green,
                    }}>
                      {metrics.siteConversionRate.toFixed(2)}%
                      <span style={{ fontSize: 12, color: COLORS.textMuted, fontFamily: "'Inter', sans-serif", marginLeft: 8 }}>
                        сесія → успішне замовлення
                      </span>
                    </div>
                  )}
                  <div style={{ color: COLORS.textFaint, fontSize: 11.5, marginTop: 2 }}>
                    «Подій-конверсій» — це задані в GA4 ключові події (заповнення форми, клік по кнопці тощо), а не тільки завершені замовлення — тому число вище й не дорівнює успішним замовленням.
                  </div>
                </div>
              </Panel>
            </div>
          )}

          <Panel title="Останні заявки">
            <div style={{ overflowX: "auto" }}>
              <table className="mf-table">
                <thead>
                  <tr>
                    <th>Дата</th>
                    <th>№</th>
                    <th>Товар</th>
                    <th>Статус</th>
                    <th>Сума</th>
                    <th>Джерело</th>
                    <th>Клієнт</th>
                    <th>Реакція</th>
                  </tr>
                </thead>
                <tbody>
                  {metrics.latest.map((o, i) => (
                    <tr key={i}>
                      <td style={{ whiteSpace: "nowrap", fontFamily: "'JetBrains Mono', monospace", fontSize: 12 }}>{fmtDateTime(o.date)}</td>
                      <td style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: COLORS.textMuted }}>{o.orderNo}</td>
                      <td style={{ maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{o.product}</td>
                      <td><StatusBadge status={o.status} /></td>
                      <td style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12 }}>{fmtMoney(o.sum)}</td>
                      <td style={{ fontSize: 12, color: COLORS.textMuted }}>{o.source}</td>
                      <td style={{ fontSize: 12 }}>{o.clientName}</td>
                      <td><ResponseBadge minutes={o.responseMinutes} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        </>
      )}
    </div>
  );
}
