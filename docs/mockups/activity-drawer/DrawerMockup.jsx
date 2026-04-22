import { useState } from "react";

const SINGLE_DATE_ACTIVITY_TYPES = ["workshop", "tour", "escape_room"];

// רשימת פעילויות רשמית לפי המיפוי שסופק
const ACTIVITIES_LIST = [
  { value: "activity_6089", label: "ביומימיקרי", type: "course", no: 6089 },
  { value: "activity_53828", label: "ביומימיקרי לחטיבה", type: "course", no: 53828 },
  { value: "activity_9545", label: "בינה מלאכותית", type: "course", no: 9545 },
  { value: "activity_57646", label: "השמיים אינם הגבול", type: "course", no: 57646 },
  { value: "activity_57651", label: "טכנולוגיות החלל", type: "course", no: 57651 },
  { value: "activity_53819", label: "יישומי AI", type: "course", no: 53819 },
  { value: "activity_90001", label: "מנהיגות ירוקה", type: "course", no: 90001 },
  { value: "activity_3604", label: "פורצות דרך", type: "course", no: 3604 },
  { value: "activity_90004", label: "פרימיום", type: "course", no: 90004 },
  { value: "activity_46091", label: "רוקחים עולם", type: "course", no: 46091 },
  { value: "activity_90002", label: "תלמידים להייטק", type: "after_school", no: 90002 },
  { value: "activity_90003", label: "מייקרים", type: "after_school", no: 90003 },
  { value: "activity_60025", label: "תמיר - המחזור מתחיל בבית", type: "workshop", no: 60025 },
  { value: "activity_60026", label: "תמיר - חדר בריחה קווסט", type: "workshop", no: 60026 },
  { value: "activity_60027", label: "תמיר - איפה דדי", type: "workshop", no: 60027 },
  { value: "activity_13990", label: "התנסות בתעשייה", type: "tour", no: 13990 },
  { value: "activity_1001", label: "חדר בריחה ביומימיקרי", type: "escape_room", no: 1001 },
];

const GRADE_OPTIONS = [
  "א׳",
  "ב׳",
  "ג׳",
  "ד׳",
  "ה׳",
  "ו׳",
  "ז׳",
  "ח׳",
  "ט׳",
  "י׳",
  "י״א",
  "י״ב",
];

const FUNDING_OPTIONS = [
  "רמי שני",
  "גפן",
  "תמיר",
  "אדמה",
  "היי-דרוז",
  'מתנ"ס',
  "ויצו",
  "מ.ר.ק",
  "רשות",
  "מארוול",
  "תעשיינים צפון",
  "בנק הפועלים",
  "אסם",
  "על-בד",
];

const INSTRUCTORS = [
  "אפרת אוחיון",
  "הנאא אבו אמזה",
  "אלכס זפקה",
  "אמיר מלמוד",
  "עליזה מולה",
  "אלדר מיכאל טייב",
  "הילה רוזן",
  "ליאל בן חמו",
  "אוריה פדידה",
  "אילנה טיטייבסקי",
  "קרן גורביץ",
  "מיכל שכטמן",
  "סוהא סאלם",
  "ברקת קטעי",
  "אסיל ג'בר",
  "כרמית סמנדרוב",
];

const ACTIVITY_LABELS = {
  course: "קורס",
  after_school: "חוג אפטרסקול",
  workshop: "סדנה",
  tour: "סיור",
  escape_room: "חדר בריחה",
};

const MOCK = {
  RowID: "LONG-042",
  activity_name: "ביומימיקרי",
  activity_no: "6089",
  activity_key: "activity_6089",
  activity_type: "course",
  source_sheet: "data_long",
  status: "פתוח",
  authority: "נתניה",
  school: "אלתרמן",
  activity_manager: "גיל נאמן",
  instructor_name: "אפרת אוחיון",
  instructor_name_2: "",
  start_time: "09:00",
  end_time: "12:00",
  sessions: "12",
  price: "850",
  funding: "גפן",
  notes: "כיתה ז׳ — עדכן תאריכים לפי לוח בית הספר",
  grade: "ז׳",
  class_group: "כיתה ז׳2",
  operations_private_notes: "שימו לב — בית הספר ביקש לדחות שני מפגשים לאחר הפסח",
  meeting_schedule: [
    { date: "2026-01-09", performed: "yes" },
    { date: "2026-01-16", performed: "yes" },
    { date: "2026-01-23", performed: "yes" },
    { date: "2026-01-30", performed: "yes" },
    { date: "2026-02-06", performed: "yes" },
    { date: "2026-02-13", performed: "yes" },
    { date: "2026-02-20", performed: "yes" },
    { date: "2026-03-06", performed: "no" },
    { date: "2026-03-13", performed: "no" },
    { date: "2026-03-20", performed: "no" },
    { date: "2026-03-27", performed: "no" },
    { date: "2026-04-10", performed: "no" },
  ],
};

function fmt(iso) {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

function fmtWeekdayShort(iso) {
  if (!iso) return "—";
  const date = new Date(`${iso}T12:00:00`);
  const map = ["א", "ב", "ג", "ד", "ה", "ו", "ש"];
  return map[date.getDay()] || "—";
}

function addDays(iso, days) {
  const date = new Date(`${iso}T12:00:00`);
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

if (typeof console !== "undefined") {
  console.assert(fmt("2026-01-09") === "09/01/2026", "fmt should format dd/mm/yyyy");
  console.assert(addDays("2026-01-09", 7) === "2026-01-16", "addDays should add 7 days");
  console.assert(fmtWeekdayShort("2026-01-09").length > 0, "fmtWeekdayShort should return a weekday");
}

function StatusPill({ value, onChange, editing }) {
  if (editing) {
    return (
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          background: "transparent",
          color: "#94a3b8",
          border: "1px solid rgba(255,255,255,0.15)",
          borderRadius: 999,
          padding: "1px 8px",
          fontSize: "0.65rem",
          fontWeight: 500,
          cursor: "pointer",
          outline: "none",
        }}
      >
        <option value="פתוח">פתוח</option>
        <option value="הסתיים">הסתיים</option>
      </select>
    );
  }

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        background: "rgba(255,255,255,0.07)",
        color: "#94a3b8",
        border: "1px solid rgba(255,255,255,0.12)",
        borderRadius: 999,
        padding: "1px 8px",
        fontSize: "0.65rem",
        fontWeight: 500,
      }}
    >
      <span
        style={{
          width: 5,
          height: 5,
          borderRadius: "50%",
          background: "#4ade80",
          display: "inline-block",
          opacity: 0.7,
        }}
      />
      {value}
    </span>
  );
}

const inputBase = {
  width: "100%",
  border: "1.5px solid #c7d7f0",
  borderRadius: 8,
  padding: "6px 10px",
  fontSize: "0.82rem",
  background: "#f8fbff",
  color: "#0f172a",
  outline: "none",
  fontFamily: "inherit",
  boxSizing: "border-box",
};

function Field({ label, value, editing, name, onChange, type = "text", options, hint }) {
  return (
    <div style={{ display: "grid", gap: 3 }}>
      <span
        style={{
          fontSize: "0.68rem",
          fontWeight: 700,
          color: "#94a3b8",
          textTransform: "uppercase",
          letterSpacing: "0.06em",
        }}
      >
        {label}
      </span>

      {editing ? (
        options ? (
          <select value={value} onChange={(e) => onChange(name, e.target.value)} style={inputBase}>
            <option value="">— בחר —</option>
            {options.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        ) : type === "textarea" ? (
          <textarea
            value={value}
            onChange={(e) => onChange(name, e.target.value)}
            rows={2}
            style={{ ...inputBase, resize: "vertical" }}
          />
        ) : (
          <input type={type} value={value} onChange={(e) => onChange(name, e.target.value)} style={inputBase} />
        )
      ) : (
        <span style={{ fontSize: "0.85rem", color: "#1e293b", fontWeight: 500, minHeight: 20 }}>
          {value || <em style={{ color: "#94a3b8", fontWeight: 400 }}>—</em>}
        </span>
      )}

      {hint && editing && <span style={{ fontSize: "0.65rem", color: "#94a3b8", fontStyle: "italic" }}>{hint}</span>}
    </div>
  );
}

function ActivityPickerField({ activityType, activityKey, activityName, activityNo, editing, onChange }) {
  const options = ACTIVITIES_LIST.filter((a) => a.type === activityType);

  if (!editing) return null;

  const fieldLabel = activityType === "course"
    ? "שם קורס"
    : activityType === "after_school"
      ? "שם חוג אפטרסקול"
      : activityType === "workshop"
        ? "שם סדנה"
        : activityType === "tour"
          ? "שם סיור"
          : "שם פעילות";

  return (
    <div style={{ display: "grid", gap: 3, gridColumn: "1 / -1" }}>
      <span
        style={{
          fontSize: "0.68rem",
          fontWeight: 700,
          color: "#94a3b8",
          textTransform: "uppercase",
          letterSpacing: "0.06em",
        }}
      >
        {fieldLabel}
      </span>

      <select
        value={activityKey}
        onChange={(e) => {
          const picked = ACTIVITIES_LIST.find((a) => a.value === e.target.value);
          if (!picked) return;
          onChange("activity_key", picked.value);
          onChange("activity_name", picked.label);
          onChange("activity_no", String(picked.no));
        }}
        style={inputBase}
      >
        <option value="">— בחר —</option>
        {options.map((a) => (
          <option key={a.value} value={a.value}>
            {a.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function MeetingDot({ done }) {
  return (
    <span
      style={{
        width: 10,
        height: 10,
        borderRadius: "50%",
        background: done ? "#22c55e" : "#e2e8f0",
        border: `1.5px solid ${done ? "#16a34a" : "#cbd5e1"}`,
        display: "inline-block",
        flexShrink: 0,
      }}
    />
  );
}

const blockStyle = {
  background: "#f8fafc",
  border: "1px solid #e8eef6",
  borderRadius: 12,
  padding: "14px 16px",
};

function BlockTitle({ children }) {
  return (
    <p
      style={{
        margin: "0 0 10px",
        fontSize: "0.72rem",
        fontWeight: 800,
        color: "#64748b",
        textTransform: "uppercase",
        letterSpacing: "0.07em",
      }}
    >
      {children}
    </p>
  );
}

const editBtnStyle = {
  background: "white",
  border: "1.5px solid #c7d7f0",
  borderRadius: 8,
  padding: "4px 12px",
  fontSize: "0.76rem",
  fontWeight: 600,
  color: "#3b5bdb",
  cursor: "pointer",
  display: "flex",
  alignItems: "center",
  gap: 4,
};

const saveBtnStyle = {
  background: "linear-gradient(135deg, #1a3358, #3b5bdb)",
  border: "none",
  borderRadius: 8,
  padding: "4px 14px",
  fontSize: "0.76rem",
  fontWeight: 700,
  color: "white",
  cursor: "pointer",
};

const cancelBtnStyle = {
  background: "white",
  border: "1.5px solid #e2e8f0",
  borderRadius: 8,
  padding: "4px 10px",
  fontSize: "0.76rem",
  fontWeight: 600,
  color: "#64748b",
  cursor: "pointer",
};

export default function DrawerMockup() {
  const [data, setData] = useState(MOCK);
  const [editing, setEditing] = useState(false);
  const [saved, setSaved] = useState(false);
  const [showAllDates, setShowAllDates] = useState(false);
  const [userRole, setUserRole] = useState("operations_reviewer");
  const [dateEditMode, setDateEditMode] = useState("chain");

  const canSeePrivateNotes = userRole === "operations_reviewer";
  const isSingleDateActivity = SINGLE_DATE_ACTIVITY_TYPES.includes(data.activity_type);
  const isWorkshop = data.activity_type === "workshop";
  const done = data.meeting_schedule.filter((m) => m.performed === "yes").length;
  const total = data.meeting_schedule.length;
  const progress = total ? Math.round((done / total) * 100) : 0;

  const sortedSchedule = [...data.meeting_schedule].sort((a, b) => a.date.localeCompare(b.date));
  const firstMeetingDate = sortedSchedule.length ? sortedSchedule[0].date : "";
  const computedEndDate = sortedSchedule.length ? sortedSchedule[sortedSchedule.length - 1].date : "";
  const displayEndDate = computedEndDate;
  const visibleDates = showAllDates || isSingleDateActivity
    ? data.meeting_schedule
    : data.meeting_schedule.slice(0, 6);

  const activityDay = fmtWeekdayShort(firstMeetingDate);
  const activityHours = data.start_time && data.end_time ? `${data.start_time}-${data.end_time}` : "—";
  const activityClass = [data.grade, data.class_group].filter(Boolean).join(" · ") || "—";

  function handleChange(name, value) {
    setData((current) => ({ ...current, [name]: value }));
    setSaved(false);
  }

  function handleSave() {
    setEditing(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  }

  function handleCancel() {
    setData(MOCK);
    setEditing(false);
    setSaved(false);
    setShowAllDates(false);
    setDateEditMode("chain");
  }

  function handleTypeChange(type) {
    const firstMatch = ACTIVITIES_LIST.find((activity) => activity.type === type);

    setData((current) => {
      const baseSchedule = current.meeting_schedule.length
        ? current.meeting_schedule
        : [{ date: new Date().toISOString().slice(0, 10), performed: "no" }];

      const nextSchedule = SINGLE_DATE_ACTIVITY_TYPES.includes(type)
        ? [baseSchedule[0]]
        : baseSchedule;

      return {
        ...current,
        activity_type: type,
        activity_name: firstMatch?.label || "",
        activity_no: firstMatch ? String(firstMatch.no) : "",
        activity_key: firstMatch?.value || "",
        instructor_name_2: type === "workshop" ? current.instructor_name_2 : "",
        meeting_schedule: nextSchedule,
        sessions: String(nextSchedule.length),
      };
    });
  }

  function handleMeetingDateChange(index, newDate) {
    if (!newDate) return;

    setData((current) => {
      const updatedSchedule = current.meeting_schedule.map((meeting, meetingIndex) => {
        if (dateEditMode === "single") {
          return meetingIndex === index ? { ...meeting, date: newDate } : meeting;
        }

        if (meetingIndex < index) return meeting;
        if (meetingIndex === index) return { ...meeting, date: newDate };

        const daysAfterChanged = (meetingIndex - index) * 7;
        return { ...meeting, date: addDays(newDate, daysAfterChanged) };
      });

      return {
        ...current,
        meeting_schedule: updatedSchedule,
        sessions: String(updatedSchedule.length),
      };
    });

    setSaved(false);
  }

  function handleAddMeeting() {
    setData((current) => {
      if (SINGLE_DATE_ACTIVITY_TYPES.includes(current.activity_type)) {
        return current;
      }

      const scheduleSorted = [...current.meeting_schedule].sort((a, b) => a.date.localeCompare(b.date));
      const lastDate = scheduleSorted.length ? scheduleSorted[scheduleSorted.length - 1].date : "";
      const nextDate = lastDate ? addDays(lastDate, 7) : new Date().toISOString().slice(0, 10);
      const updatedSchedule = [...current.meeting_schedule, { date: nextDate, performed: "no" }];

      return {
        ...current,
        meeting_schedule: updatedSchedule,
        sessions: String(updatedSchedule.length),
      };
    });

    setSaved(false);
  }

  return (
    <div
      dir="rtl"
      style={{
        minHeight: "100vh",
        background: "linear-gradient(135deg, #0f172a 0%, #1e1b4b 50%, #0f172a 100%)",
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        padding: "32px 16px",
        fontFamily: "'Segoe UI', system-ui, sans-serif",
      }}
    >
      <div style={{ position: "fixed", top: 16, right: 16, display: "flex", flexDirection: "column", gap: 8, zIndex: 99 }}>
        <div style={{ display: "flex", gap: 6 }}>
          {["course", "after_school", "workshop", "tour", "escape_room"].map((type) => (
            <button
              key={type}
              onClick={() => handleTypeChange(type)}
              style={{
                padding: "5px 14px",
                borderRadius: 999,
                fontSize: "0.72rem",
                fontWeight: 700,
                border: "1.5px solid rgba(255,255,255,0.2)",
                background: data.activity_type === type ? "rgba(255,255,255,0.18)" : "rgba(255,255,255,0.06)",
                color: data.activity_type === type ? "#fff" : "#94a3b8",
                cursor: "pointer",
              }}
            >
              {ACTIVITY_LABELS[type]}
            </button>
          ))}
        </div>

        <div style={{ display: "flex", gap: 6 }}>
          {["operations_reviewer", "admin"].map((role) => (
            <button
              key={role}
              onClick={() => setUserRole(role)}
              style={{
                padding: "4px 10px",
                borderRadius: 999,
                fontSize: "0.68rem",
                fontWeight: 600,
                border: "1.5px solid rgba(255,255,255,0.15)",
                background: userRole === role ? "rgba(99,102,241,0.35)" : "rgba(255,255,255,0.06)",
                color: userRole === role ? "#c7d2fe" : "#64748b",
                cursor: "pointer",
              }}
            >
              {role === "operations_reviewer" ? "👁 תפעול" : "🔑 אדמין"}
            </button>
          ))}
        </div>
      </div>

      <div
        style={{
          width: 420,
          maxWidth: "100%",
          background: "rgba(255,255,255,0.97)",
          backdropFilter: "blur(20px)",
          borderRadius: 20,
          boxShadow: "0 32px 80px rgba(0,0,0,0.35), 0 2px 8px rgba(0,0,0,0.1)",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div style={{ background: "linear-gradient(135deg, #1e293b 0%, #1e3a5f 100%)", padding: "18px 20px 16px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
            <span
              style={{
                background: "rgba(99,102,241,0.25)",
                color: "#a5b4fc",
                border: "1px solid rgba(99,102,241,0.4)",
                borderRadius: 999,
                padding: "2px 10px",
                fontSize: "0.7rem",
                fontWeight: 700,
                letterSpacing: "0.05em",
              }}
            >
              {ACTIVITY_LABELS[data.activity_type] || data.activity_type}
            </span>
            <button
              style={{
                width: 28,
                height: 28,
                borderRadius: "50%",
                border: "1px solid rgba(255,255,255,0.15)",
                background: "rgba(255,255,255,0.08)",
                color: "#94a3b8",
                fontSize: "0.8rem",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              ✕
            </button>
          </div>

          <h2 style={{ margin: "0 0 8px", color: "#f8fafc", fontSize: "1.15rem", fontWeight: 800, lineHeight: 1.3 }}>
            {data.activity_name || "— לא נבחר קורס —"}
          </h2>

          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <StatusPill value={data.status} onChange={(v) => handleChange("status", v)} editing={editing} />
            <span style={{ color: "#94a3b8", fontSize: "0.78rem" }}>
              {data.school} · {data.authority}
            </span>
          </div>
        </div>

        {saved && (
          <div
            style={{
              background: "#dcfce7",
              color: "#15803d",
              padding: "8px 20px",
              fontSize: "0.8rem",
              fontWeight: 600,
              display: "flex",
              alignItems: "center",
              gap: 6,
              borderBottom: "1px solid #bbf7d0",
            }}
          >
            ✅ נשמר בהצלחה
          </div>
        )}

        <div style={{ padding: "18px 20px", display: "flex", flexDirection: "column", gap: 18, overflowY: "auto", maxHeight: "70vh" }}>
          <div style={blockStyle}>
            <BlockTitle>👤</BlockTitle>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px 16px" }}>
              <Field label="מנהל פעילות" name="activity_manager" value={data.activity_manager} editing={editing} onChange={handleChange} />
              {isWorkshop ? (
                <>
                  <Field label="מדריך/ה 1" name="instructor_name" value={data.instructor_name} editing={editing} onChange={handleChange} />
                  <Field label="מדריך/ה 2" name="instructor_name_2" value={data.instructor_name_2} editing={editing} onChange={handleChange} />
                </>
              ) : (
                <Field label="מדריך/ה" name="instructor_name" value={data.instructor_name} editing={editing} onChange={handleChange} />
              )}
            </div>
          </div>

          <div style={blockStyle}>
            <BlockTitle>📚</BlockTitle>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {editing && (
                <ActivityPickerField
                  activityType={data.activity_type}
                  activityKey={data.activity_key}
                  activityName={data.activity_name}
                  activityNo={data.activity_no}
                  editing={editing}
                  onChange={handleChange}
                />
              )}

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px 16px" }}>
                <Field label="מימון" name="funding" value={data.funding} editing={editing} onChange={handleChange} options={FUNDING_OPTIONS} />
                {editing && <Field label="מחיר" name="price" value={data.price} editing={editing} onChange={handleChange} type="number" />}

                {!editing && (
                  <>
                    <Field label="כיתה" value={activityClass} editing={false} />
                    <Field label="שעות" value={activityHours} editing={false} />
                    <Field label="יום" value={activityDay} editing={false} />
                  </>
                )}

                {editing && (
                  <>
                    <Field label="בית ספר" name="school" value={data.school} editing={editing} onChange={handleChange} />
                    <Field label="רשות" name="authority" value={data.authority} editing={editing} onChange={handleChange} />
                    <Field label="שכבה" name="grade" value={data.grade} editing={editing} onChange={handleChange} options={GRADE_OPTIONS} />
                    <Field label="קבוצה / כיתה" name="class_group" value={data.class_group} editing={editing} onChange={handleChange} />
                    <Field label="שעת התחלה" name="start_time" value={data.start_time} editing={editing} onChange={handleChange} type="time" />
                    <Field label="שעת סיום" name="end_time" value={data.end_time} editing={editing} onChange={handleChange} type="time" />
                  </>
                )}
              </div>
            </div>
          </div>

          <div style={{ ...blockStyle, position: "relative" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
              <BlockTitle>📅</BlockTitle>
              {!editing ? (
                <button onClick={() => setEditing(true)} style={editBtnStyle}>✏️ עריכה</button>
              ) : (
                <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end" }}>
                  {!isSingleDateActivity && (
                    <button
                      onClick={() => setDateEditMode(dateEditMode === "chain" ? "single" : "chain")}
                      style={{
                        ...cancelBtnStyle,
                        borderColor: dateEditMode === "chain" ? "#c7d7f0" : "#e2e8f0",
                        color: dateEditMode === "chain" ? "#3b5bdb" : "#64748b",
                      }}
                    >
                      {dateEditMode === "chain" ? "🔗 שרשרת" : "📍 בודד"}
                    </button>
                  )}
                  {!isSingleDateActivity && (
                    <button onClick={handleAddMeeting} style={{ ...editBtnStyle, padding: "4px 10px", fontWeight: 700 }} title="הוספת מפגש חדש">➕</button>
                  )}
                  <button onClick={handleSave} style={saveBtnStyle}>💾 שמור</button>
                  <button onClick={handleCancel} style={cancelBtnStyle}>ביטול</button>
                </div>
              )}
            </div>

            <div style={{ marginBottom: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                <span style={{ fontSize: "0.72rem", color: "#64748b", fontWeight: 600 }}>{done} מתוך {total} מפגשים בוצעו</span>
                <span style={{ fontSize: "0.72rem", color: "#6366f1", fontWeight: 700 }}>{progress}%</span>
              </div>
              <div style={{ height: 6, background: "#e2e8f0", borderRadius: 999, overflow: "hidden" }}>
                <div style={{ height: "100%", borderRadius: 999, width: `${progress}%`, background: "linear-gradient(90deg, #6366f1, #22c55e)", transition: "width 0.4s ease" }} />
              </div>
            </div>

            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 12, padding: "8px 12px", background: "#f0f9ff", border: "1px solid #bae6fd", borderRadius: 10 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: "0.72rem", fontWeight: 700, color: "#64748b", whiteSpace: "nowrap" }}>🏁 תאריך סיום</span>
                <span style={{ fontSize: "0.85rem", fontWeight: 600, color: "#0f172a" }}>{fmt(displayEndDate)}</span>
              </div>
              {editing && <span style={{ fontSize: "0.68rem", color: "#64748b" }}>מחושב אוטומטית לפי המפגש האחרון</span>}
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: editing ? "repeat(2, minmax(0, 1fr))" : "repeat(3, minmax(0, 1fr))",
                gap: 8,
              }}
            >
              {visibleDates.map((m, i) => {
                const actualIndex = i;
                const weekdayShort = fmtWeekdayShort(m.date);

                return editing ? (
                  <div
                    key={`${m.date}-${i}`}
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 6,
                      background: "#f8fafc",
                      border: "1px solid #e2e8f0",
                      borderRadius: 10,
                      padding: "8px 10px",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <MeetingDot done={m.performed === "yes"} />
                        <span style={{ fontSize: "0.72rem", color: "#64748b", fontWeight: 700 }}>מפגש {actualIndex + 1}</span>
                      </div>
                      <span style={{ fontSize: "0.72rem", color: "#94a3b8", fontWeight: 700 }}>{weekdayShort}</span>
                    </div>

                    <input
                      type="date"
                      value={m.date}
                      onChange={(e) => handleMeetingDateChange(actualIndex, e.target.value)}
                      style={{ ...inputBase, padding: "4px 8px", fontSize: "0.78rem" }}
                    />

                    <span style={{ fontSize: "0.72rem", color: "#64748b" }}>{fmt(m.date)}</span>
                  </div>
                ) : (
                  <div
                    key={`${m.date}-${i}`}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 8,
                      background: m.performed === "yes" ? "#f0fdf4" : "#f8fafc",
                      border: `1px solid ${m.performed === "yes" ? "#bbf7d0" : "#e2e8f0"}`,
                      borderRadius: 8,
                      padding: "6px 8px",
                      fontSize: "0.72rem",
                      color: m.performed === "yes" ? "#15803d" : "#64748b",
                      fontWeight: 500,
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                      <MeetingDot done={m.performed === "yes"} />
                      <span>{fmt(m.date)}</span>
                    </div>
                    <span style={{ fontWeight: 700 }}>{weekdayShort}</span>
                  </div>
                );
              })}
            </div>

            {!editing && !isSingleDateActivity && data.meeting_schedule.length > 6 && (
              <button
                onClick={() => setShowAllDates((current) => !current)}
                style={{
                  marginTop: 8,
                  background: "transparent",
                  border: "1px dashed #c7d2e0",
                  borderRadius: 8,
                  padding: "3px 10px",
                  fontSize: "0.72rem",
                  color: "#6366f1",
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                {showAllDates ? "פחות ▲" : `+${data.meeting_schedule.length - 6} עוד ▾`}
              </button>
            )}

            {editing && !isSingleDateActivity && (
              <span style={{ display: "block", marginTop: 8, fontSize: "0.68rem", color: "#94a3b8" }}>
                במצב 🔗 שרשרת שינוי תאריך יעדכן את כל המפגשים שאחריו בקפיצות של שבוע. במצב 📍 בודד כל תאריך משתנה רק לעצמו.
              </span>
            )}
          </div>

          <div style={blockStyle}>
            <BlockTitle>📝</BlockTitle>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <Field label="הערות" name="notes" value={data.notes} editing={editing} onChange={handleChange} type="textarea" />
              {canSeePrivateNotes && (
                <div style={{ borderTop: "1px dashed #e2e8f0", paddingTop: 10 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                    <span style={{ fontSize: "0.65rem", fontWeight: 700, color: "#7c3aed", background: "#f5f3ff", border: "1px solid #ddd6fe", borderRadius: 999, padding: "1px 7px" }}>🔒</span>
                  </div>
                  <Field label="הערה תפעולית" name="operations_private_notes" value={data.operations_private_notes} editing={editing} onChange={handleChange} type="textarea" />
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
