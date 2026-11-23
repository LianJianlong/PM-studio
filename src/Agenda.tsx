import "./table-overrides.css";
import { useEffect, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { RecordGrid } from "./DataCenter";
import {
  api,
  useApi,
  useApp,
  useRememberedState,
  PageTitle,
  ErrorBox,
  Modal,
  Loading,
  today,
} from "./lib";
import { translateUiValue as ui } from "./i18n";
export default function Agenda() {
  const { project, tick, context, boot, notificationTarget } = useApp(),
    tableState = useApi<any>(`/projects/${project.id}/agenda-table`, tick);
  const scope=`agenda:${boot.user.id}:${project.id}`;
  const [view, setView] = useRememberedState(scope+":view","table"),
    [month, setMonth] = useRememberedState(scope+":month",today().slice(0, 7)),
    [expandedDate,setExpandedDate]=useState(""),
    [error, setError] = useState(""),
    [draft, setDraft] = useState<{ key: number; data: any }>(),
    [openRecord, setOpenRecord] = useState<any>(null);
  const todos=useApi<any[]>(view==="calendar"?`/projects/${project.id}/todos`:null,tick);
  async function open(id: string) {
    try {
      setDraft(undefined);
      setOpenRecord(await api(`/projects/${project.id}/agenda-records/${id}`));
      setView("table");
    } catch (e: any) {
      setError(e.message);
    }
  }
  useEffect(() => {
    if (
      tableState.data?.table?.id &&
      notificationTarget?.project_id === project.id &&
      notificationTarget.kind === "todo"
    )
      void open(notificationTarget.resource_id);
  }, [notificationTarget, project.id, tableState.data?.table?.id]);
  if (tableState.error || todos.error)
    return <ErrorBox message={ui(tableState.error || todos.error || "")} />;
  if (!tableState.data || (view==="calendar"&&!todos.data)) return <Loading />;
  const table = tableState.data.table,
    first = new Date(month + "-01T12:00:00"),
    offset = (first.getDay() + 6) % 7,
    count = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  const tasksFor=(date:string)=>todos.data?.filter(t=>String(t.due_date).slice(0,10)===date)||[];
  function shift(n: number) {
    setExpandedDate("");
    const date = new Date(first);
    date.setMonth(date.getMonth() + n);
    setMonth(
      `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`,
    );
  }
  const tabs = (
    <div className="program-tabs">
      <button
        className={view === "table" ? "active" : ""}
        onClick={() => {
          setDraft(undefined);
          setView("table");
        }}
      >
        {ui("数据表")}
      </button>
      <button
        className={view === "calendar" ? "active" : ""}
        onClick={() => {
          setOpenRecord(null);
          setDraft(undefined);
          setView("calendar");
        }}
      >
        {ui("日历视图")}
      </button>
    </div>
  );
  return (
    <div className="agenda-module">
      {error && <ErrorBox message={ui(error)} />}
      {view === "table" ? (
        <RecordGrid
          key={table.id}
          table={table}
          mode="input"
          headingTools={tabs}
          createRequest={draft}
          openRecord={openRecord}
        />
      ) : (
        <>
          <div className="sheet-heading">
            <PageTitle icon={CalendarDays} title={ui(table.name)} />
            {tabs}
          </div>
          <div className="calendar-month-controls">
            <button aria-label={ui("上个月")} onClick={() => shift(-1)}>
              <ChevronLeft size={16} />
            </button>
            <input
              type="month"
              aria-label={ui("日历月份")}
              value={month}
              onChange={(e) => {
                if (e.target.value) setMonth(e.target.value);
              }}
            />
            <button aria-label={ui("下个月")} onClick={() => shift(1)}>
              <ChevronRight size={16} />
            </button>
            <button onClick={() => setMonth(today().slice(0, 7))}>
              {ui("本月")}
            </button>
          </div>
          <div className="calendar-grid">
            {["一", "二", "三", "四", "五", "六", "日"].map((d) => (
              <div className="calendar-week" key={d}>
                {ui("周" + d)}
              </div>
            ))}
            {Array.from(
              { length: Math.ceil((offset + count) / 7) * 7 },
              (_, i) => {
                const day = i - offset + 1,
                  valid = day >= 1 && day <= count,
                  date = month + "-" + String(day).padStart(2, "0"), tasks=valid?tasksFor(date):[];
                return (
                  <div
                    key={i}
                    className={"calendar-cell" + (!valid ? " outside" : "")}
                    onDoubleClick={(e) => {
                      if (
                        valid &&
                        context.permission.write &&
                        !(e.target as Element).closest("button")
                      ) {
                        setOpenRecord(null);
                        setDraft({
                          key: Date.now(),
                          data: { due_date: date, owner: boot.user.username },
                        });
                        setView("table");
                      }
                    }}
                  >
                    {valid && (
                      <>
                        <strong>{day}</strong>
                        {tasks.slice(0,2)
                          .map((t) => (
                            <button
                              key={t.id}
                              className={
                                "calendar-event" + (t.done ? " done" : "")
                              }
                              title={t.title}
                              onClick={() => void open(t.id)}
                            >
                              {t.title}
                            </button>
                          ))}
                        {tasks.length>2&&<button type="button" className="agenda-more" onClick={()=>setExpandedDate(date)}>{ui("更多")} +{tasks.length-2}</button>}
                      </>
                    )}
                  </div>
                );
              },
            )}
          </div>
          {expandedDate&&<Modal title={expandedDate} onClose={()=>setExpandedDate("")}><div className="agenda-day-items">{tasksFor(expandedDate).map(t=><button key={t.id} type="button" onClick={()=>{setExpandedDate("");void open(t.id)}}>{t.title}</button>)}</div></Modal>}
        </>
      )}
    </div>
  );
}
