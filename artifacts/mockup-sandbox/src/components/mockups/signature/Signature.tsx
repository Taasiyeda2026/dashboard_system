import { useState } from "react";
import "./signature.css";

type Align = "flex-start" | "center" | "flex-end";

export function Signature() {
  const [greeting, setGreeting] = useState("בברכה,");
  const [name, setName] = useState("עידן נחום, סמנכ״ל כספים");
  const [gap, setGap] = useState(28);
  const [fontSize, setFontSize] = useState(8.5);
  const [align, setAlign] = useState<Align>("flex-start");

  const alignLabel: Record<Align, string> = {
    "flex-start": "ימין",
    "center": "מרכז",
    "flex-end": "שמאל",
  };

  return (
    <div dir="rtl" style={{ fontFamily: "'Heebo', 'Arial Hebrew', Arial, sans-serif", minHeight: "100vh", background: "#f5f5f5", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 32 }}>

      {/* Controls panel */}
      <div style={{ background: "#fff", border: "1px solid #ddd", borderRadius: 8, padding: 20, marginBottom: 32, width: 520, fontSize: 13 }}>
        <div style={{ fontWeight: 700, marginBottom: 14, fontSize: 14 }}>⚙️ כוונון חתימה</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>

          <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span style={{ width: 140 }}>טקסט פתיחה:</span>
            <input value={greeting} onChange={e => setGreeting(e.target.value)} style={{ flex: 1, padding: "4px 8px", border: "1px solid #ccc", borderRadius: 4, fontFamily: "inherit", direction: "rtl" }} />
          </label>

          <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span style={{ width: 140 }}>שם חותם:</span>
            <input value={name} onChange={e => setName(e.target.value)} style={{ flex: 1, padding: "4px 8px", border: "1px solid #ccc", borderRadius: 4, fontFamily: "inherit", direction: "rtl" }} />
          </label>

          <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span style={{ width: 140 }}>רווח (pt): <b>{gap}pt</b></span>
            <input type="range" min={10} max={60} value={gap} onChange={e => setGap(Number(e.target.value))} style={{ flex: 1 }} />
          </label>

          <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span style={{ width: 140 }}>פונט: <b>{fontSize}pt</b></span>
            <input type="range" min={7} max={14} step={0.5} value={fontSize} onChange={e => setFontSize(Number(e.target.value))} style={{ flex: 1 }} />
          </label>

          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span style={{ width: 140 }}>מיקום החתימה:</span>
            <div style={{ display: "flex", gap: 6 }}>
              {(["flex-start", "center", "flex-end"] as Align[]).map(a => (
                <button
                  key={a}
                  onClick={() => setAlign(a)}
                  style={{
                    padding: "5px 14px",
                    borderRadius: 4,
                    border: "1px solid",
                    borderColor: align === a ? "#2563eb" : "#ccc",
                    background: align === a ? "#2563eb" : "#fff",
                    color: align === a ? "#fff" : "#333",
                    cursor: "pointer",
                    fontFamily: "inherit",
                    fontSize: 13,
                    fontWeight: align === a ? 700 : 400,
                  }}
                >
                  {alignLabel[a]}
                </button>
              ))}
            </div>
          </div>

        </div>
      </div>

      {/* Simulated proposal page */}
      <div style={{ background: "#fff", border: "1px solid #ccc", borderRadius: 4, padding: "40px 50px", width: 580, boxShadow: "0 2px 8px rgba(0,0,0,0.08)" }}>
        <div style={{ fontSize: 10, color: "#bbb", marginBottom: 32, textAlign: "center", borderBottom: "1px solid #eee", paddingBottom: 12 }}>— גוף ההצעה —</div>

        {/* Signature section — align controlled */}
        <section style={{ display: "flex", flexDirection: "column", alignItems: align, direction: "rtl" }}>
          <p className="sig-greeting" style={{ marginBottom: gap + "pt" }}>{greeting}</p>
          <div className="sig-block">
            <div className="sig-line" />
            <p className="sig-name" style={{ fontSize: fontSize + "pt" }}>{name}</p>
          </div>
        </section>

        {/* Live values */}
        <div style={{ marginTop: 40, padding: 12, background: "#f8f8f8", borderRadius: 4, fontSize: 11, color: "#666", direction: "ltr", fontFamily: "monospace", lineHeight: 1.7 }}>
          <div>align: <b>{alignLabel[align]} ({align})</b></div>
          <div>gap: <b>{gap}pt</b></div>
          <div>font-size: <b>{fontSize}pt</b></div>
        </div>
      </div>
    </div>
  );
}
