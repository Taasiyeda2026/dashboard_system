import { useState } from "react";
import "./signature.css";

type Align = "flex-start" | "center" | "flex-end";

export function Signature() {
  /* ── Header controls ── */
  const [contactName, setContactName] = useState("עדיה");
  const [orgName, setOrgName] = useState("אפריים בן דוד, קריית גת");
  const [dateText, setDateText] = useState("15/06/2026");
  const [logoSize, setLogoSize] = useState(52);
  const [headerGap, setHeaderGap] = useState(12);

  /* ── Signature controls ── */
  const [greeting, setGreeting] = useState("בברכה,");
  const [sigName, setSigName] = useState("עידן נחום, סמנכ״ל כספים");
  const [sigGap, setSigGap] = useState(28);
  const [sigFontSize, setSigFontSize] = useState(8.5);
  const [sigAlign, setSigAlign] = useState<Align>("flex-start");
  const [sigOffset, setSigOffset] = useState(0); // px מהקצה הימני

  const alignLabel: Record<Align, string> = {
    "flex-start": "ימין",
    "center": "מרכז",
    "flex-end": "שמאל",
  };

  return (
    <div dir="rtl" style={{ fontFamily: "Arial, 'Noto Sans Hebrew', David, sans-serif", background: "#e8e8e8", minHeight: "100vh", padding: 24 }}>

      {/* ══ Controls ══ */}
      <div style={{ background: "#fff", border: "1px solid #ddd", borderRadius: 8, padding: 20, marginBottom: 24, fontSize: 12.5, boxShadow: "0 1px 4px rgba(0,0,0,0.08)" }}>
        <div style={{ fontWeight: 700, marginBottom: 14, fontSize: 14 }}>⚙️ כוונון מסמך</div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>

          {/* Header */}
          <div>
            <div style={{ fontWeight: 600, marginBottom: 10, color: "#444", borderBottom: "1px solid #eee", paddingBottom: 6 }}>כותרת (לכבוד + לוגו)</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
              <Row label="שם איש קשר:">
                <input value={contactName} onChange={e => setContactName(e.target.value)} style={inp} />
              </Row>
              <Row label="ארגון:">
                <input value={orgName} onChange={e => setOrgName(e.target.value)} style={inp} />
              </Row>
              <Row label="תאריך:">
                <input value={dateText} onChange={e => setDateText(e.target.value)} style={inp} />
              </Row>
              <Row label={`לוגו גובה: ${logoSize}px`}>
                <input type="range" min={24} max={90} value={logoSize} onChange={e => setLogoSize(Number(e.target.value))} style={{ width: "100%" }} />
              </Row>
              <Row label={`רווח header: ${headerGap}px`}>
                <input type="range" min={0} max={40} value={headerGap} onChange={e => setHeaderGap(Number(e.target.value))} style={{ width: "100%" }} />
              </Row>
            </div>
          </div>

          {/* Signature */}
          <div>
            <div style={{ fontWeight: 600, marginBottom: 10, color: "#444", borderBottom: "1px solid #eee", paddingBottom: 6 }}>חתימה</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
              <Row label="פתיחה:">
                <input value={greeting} onChange={e => setGreeting(e.target.value)} style={inp} />
              </Row>
              <Row label="שם חותם:">
                <input value={sigName} onChange={e => setSigName(e.target.value)} style={inp} />
              </Row>
              <Row label={`רווח: ${sigGap}pt`}>
                <input type="range" min={10} max={60} value={sigGap} onChange={e => setSigGap(Number(e.target.value))} style={{ width: "100%" }} />
              </Row>
              <Row label={`פונט: ${sigFontSize}pt`}>
                <input type="range" min={7} max={14} step={0.5} value={sigFontSize} onChange={e => setSigFontSize(Number(e.target.value))} style={{ width: "100%" }} />
              </Row>
              <Row label="עוגן:">
                <div style={{ display: "flex", gap: 4 }}>
                  {(["flex-start", "center", "flex-end"] as Align[]).map(a => (
                    <button key={a} onClick={() => setSigAlign(a)} style={{
                      padding: "4px 10px", borderRadius: 4, border: "1px solid",
                      borderColor: sigAlign === a ? "#2563eb" : "#ccc",
                      background: sigAlign === a ? "#2563eb" : "#fff",
                      color: sigAlign === a ? "#fff" : "#333",
                      cursor: "pointer", fontSize: 12, fontWeight: sigAlign === a ? 700 : 400,
                    }}>{alignLabel[a]}</button>
                  ))}
                </div>
              </Row>
              <Row label={`הזזה: ${sigOffset > 0 ? "←" : sigOffset < 0 ? "→" : "•"} ${Math.abs(sigOffset)}px`}>
                <input type="range" min={-300} max={300} value={sigOffset}
                  onChange={e => setSigOffset(Number(e.target.value))}
                  style={{ width: "100%" }} />
              </Row>
            </div>
          </div>

        </div>

        {/* Live values */}
        <div style={{ marginTop: 14, padding: "8px 12px", background: "#f4f4f4", borderRadius: 4, fontSize: 11, color: "#555", direction: "ltr", fontFamily: "monospace", lineHeight: 1.8 }}>
          sig-align: <b>{sigAlign}</b> &nbsp;|&nbsp; sig-gap: <b>{sigGap}pt</b> &nbsp;|&nbsp; sig-font: <b>{sigFontSize}pt</b> &nbsp;|&nbsp; logo-height: <b>{logoSize}px</b>
        </div>
      </div>

      {/* ══ Document preview ══ */}
      <div style={{
        background: "#fff", width: 760, margin: "0 auto",
        boxShadow: "0 2px 10px rgba(0,0,0,0.1)", borderRadius: 2,
        padding: "24px 40px 16px", boxSizing: "border-box",
        fontFamily: "Arial, 'Noto Sans Hebrew', David, sans-serif",
        fontSize: "9pt", color: "#111827", lineHeight: 1.35, direction: "rtl",
      }}>

        {/* Header row: לכבוד (right) + logo (left) */}
        <div style={{
          display: "flex", justifyContent: "space-between", alignItems: "flex-start",
          direction: "rtl", gap: headerGap, marginBottom: 4,
        }}>
          {/* לכבוד block */}
          <div style={{ flex: "1 1 auto", maxWidth: "58%" }}>
            <p style={{ margin: "0 0 2px", fontWeight: 700, fontSize: "9pt" }}>לכבוד:</p>
            {contactName && <p style={{ margin: "0 0 1px", fontWeight: 700 }}>{contactName}</p>}
            {orgName && <p style={{ margin: 0 }}>{orgName}</p>}
          </div>
          {/* Logo + date */}
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", direction: "ltr", flexShrink: 0 }}>
            <img
              src="/__mockup/images/proposal-header-logo.png"
              alt="לוגו תעשיידע"
              style={{ height: logoSize, width: "auto", maxWidth: 165, objectFit: "contain", display: "block" }}
            />
            {dateText && (
              <div style={{ marginTop: 10, fontSize: "9pt", color: "#555", textAlign: "left" }}>
                {dateText}
              </div>
            )}
          </div>
        </div>

        {/* Divider */}
        <hr style={{ border: "none", borderTop: "1px solid #999", margin: "8px 0 12px", width: "100%" }} />

        {/* Body placeholder */}
        <div style={{ color: "#bbb", fontSize: "9pt", marginBottom: 40, lineHeight: 1.8 }}>
          <strong style={{ color: "#888" }}>הצעת מחיר לפעילויות תעשיידע | קיץ תשפ״ו</strong><br />
          תעשיידע היא עמותה חינוכית מיסודה של התאחדות התעשיינים, הפועלת לקידום החינוך הטכנולוגי בישראל.
          באמצעות קורסים וסדנאות בתחומי STEM, העמותה מחברת תלמידים לעולמות המדע, הטכנולוגיה, ההנדסה
          והתעשייה ומובילה לחשיבה יישומית, התנסות טכנית ופיתוח חיוניות לעולם טכנולוגי משתנה...
        </div>

        {/* Signature */}
        <section style={{ display: "flex", flexDirection: "column", alignItems: sigAlign, direction: "rtl" }}>
          <p style={{ margin: 0, marginBottom: sigGap + "pt", textAlign: "right", direction: "rtl", fontSize: "9pt" }}>
            {greeting}
          </p>
          <div className="sig-block" style={{ transform: `translateX(${sigOffset}px)` }}>
            <div className="sig-line" />
            <p className="sig-name" style={{ fontSize: sigFontSize + "pt" }}>{sigName}</p>
          </div>
        </section>

      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
      <span style={{ minWidth: 110, fontSize: 12, color: "#555" }}>{label}</span>
      <div style={{ flex: 1 }}>{children}</div>
    </div>
  );
}

const inp: React.CSSProperties = {
  width: "100%", padding: "3px 7px", border: "1px solid #ccc",
  borderRadius: 4, fontFamily: "inherit", direction: "rtl", fontSize: 12, boxSizing: "border-box",
};
