import { useState } from "react";
import "./signature.css";

export function Signature() {
  const [greeting, setGreeting] = useState("בברכה,");
  const [name, setName] = useState("עידן נחום, סמנכ״ל כספים");
  const [gap, setGap] = useState(28);
  const [fontSize, setFontSize] = useState(8.5);

  return (
    <div dir="rtl" style={{ fontFamily: "'Heebo', 'Arial Hebrew', Arial, sans-serif", minHeight: "100vh", background: "#f5f5f5", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 32 }}>

      {/* Controls panel */}
      <div style={{ background: "#fff", border: "1px solid #ddd", borderRadius: 8, padding: 20, marginBottom: 32, width: 500, fontSize: 13 }}>
        <div style={{ fontWeight: 700, marginBottom: 12, fontSize: 14 }}>⚙️ כוונון חתימה</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span style={{ width: 130 }}>טקסט פתיחה:</span>
            <input value={greeting} onChange={e => setGreeting(e.target.value)} style={{ flex: 1, padding: "4px 8px", border: "1px solid #ccc", borderRadius: 4, fontFamily: "inherit", direction: "rtl" }} />
          </label>
          <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span style={{ width: 130 }}>שם חותם:</span>
            <input value={name} onChange={e => setName(e.target.value)} style={{ flex: 1, padding: "4px 8px", border: "1px solid #ccc", borderRadius: 4, fontFamily: "inherit", direction: "rtl" }} />
          </label>
          <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span style={{ width: 130 }}>רווח (pt): {gap}pt</span>
            <input type="range" min={10} max={60} value={gap} onChange={e => setGap(Number(e.target.value))} style={{ flex: 1 }} />
          </label>
          <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span style={{ width: 130 }}>גודל פונט: {fontSize}pt</span>
            <input type="range" min={7} max={14} step={0.5} value={fontSize} onChange={e => setFontSize(Number(e.target.value))} style={{ flex: 1 }} />
          </label>
        </div>
      </div>

      {/* Simulated proposal page */}
      <div style={{ background: "#fff", border: "1px solid #ccc", borderRadius: 4, padding: "40px 50px", width: 550, boxShadow: "0 2px 8px rgba(0,0,0,0.08)" }}>
        <div style={{ fontSize: 10, color: "#999", marginBottom: 32, textAlign: "center" }}>— גוף ההצעה —</div>

        {/* Signature section */}
        <section className="sig-section">
          <p className="sig-greeting" style={{ marginBottom: gap + "pt" }}>{greeting}</p>
          <div className="sig-block">
            <div className="sig-line" />
            <p className="sig-name" style={{ fontSize: fontSize + "pt" }}>{name}</p>
          </div>
        </section>

        {/* Live CSS values display */}
        <div style={{ marginTop: 40, padding: 12, background: "#f8f8f8", borderRadius: 4, fontSize: 11, color: "#555", direction: "ltr", fontFamily: "monospace" }}>
          <div>font-size: <b>{fontSize}pt</b></div>
          <div>margin-bottom (gap): <b>{gap}pt</b></div>
        </div>
      </div>
    </div>
  );
}
