import { useState, useEffect, useCallback, useRef } from "react";

// ---------- constants ----------
const DATA_KEY = "famcal:data";      // shared: family name, members, events, tasks
const PRIV_KEY = "famcal:private";   // personal: this user's private events
const ME_KEY = "famcal:me";          // personal: which member this device is
const SEEN_KEY = "famcal:seen";      // personal: last time this user checked
const POLL_MS = 20000;
const APP_VERSION = "2.0.0";

const MEMBER_COLORS = [
  { name: "Coral", hex: "#E2564B" }, { name: "Tangerine", hex: "#E87A33" },
  { name: "Amber", hex: "#E8A13A" }, { name: "Lime", hex: "#7CB342" },
  { name: "Spruce", hex: "#2F8F63" }, { name: "Sea", hex: "#26A69A" },
  { name: "Sky", hex: "#3BA7D9" }, { name: "Lake", hex: "#2F80ED" },
  { name: "Indigo", hex: "#5C6BC0" }, { name: "Violet", hex: "#8E5AC8" },
  { name: "Rose", hex: "#D9538C" }, { name: "Slate", hex: "#6B7A8F" },
];
const WEEKDAYS = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const MONTHS_SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const RECUR_LABELS = { none: "Doesn't repeat", weekly: "Every week", biweekly: "Every 2 weeks", monthly: "Every month", yearly: "Every year" };
const CALENDAR_VIEWS = ["month", "week", "day", "board"];

// ---------- date helpers ----------
const toKey = (d) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
const todayKey = () => toKey(new Date());
const parseKey = (k) => { const [y,m,d] = k.split("-").map(Number); return new Date(y, m-1, d); };
const addDays = (d,n) => { const x = new Date(d); x.setDate(x.getDate()+n); return x; };
const startOfWeek = (d) => addDays(d, -d.getDay());
const diffDays = (a,b) => Math.round((parseKey(b) - parseKey(a)) / 86400000);
const fmtTime = (t) => {
  if (!t) return "";
  const [h,m] = t.split(":").map(Number);
  const ampm = h >= 12 ? "pm" : "am";
  const hr = h % 12 === 0 ? 12 : h % 12;
  return `${hr}:${String(m).padStart(2,"0")} ${ampm}`;
};
const fmtLong = (k) => { const d = parseKey(k); return `${WEEKDAYS[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}`; };
const fmtShort = (k) => { const d = parseKey(k); return `${MONTHS_SHORT[d.getMonth()]} ${d.getDate()}`; };
const uid = () => Math.random().toString(36).slice(2,10);
const peopleOf = (it) => it.memberIds || (it.memberId ? [it.memberId] : []);
const digitsOf = (s) => (s || "").replace(/[^\d+]/g, "");

const dueLabel = (k) => {
  if (!k) return "No due date";
  const tk = todayKey();
  if (k === tk) return "Due today";
  if (k === toKey(addDays(new Date(),1))) return "Due tomorrow";
  if (k < tk) return `Overdue · was ${fmtShort(k)}`;
  return `Due ${fmtShort(k)}`;
};

// ---------- recurrence ----------
function occursOn(ev, k) {
  if (ev.endDate && ev.endDate > ev.date && (!ev.recur || ev.recur === "none")) {
    return k >= ev.date && k <= ev.endDate;
  }
  if (ev.date === k) return true;
  if (!ev.recur || ev.recur === "none" || k < ev.date) return false;
  const n = diffDays(ev.date, k);
  if (ev.recur === "weekly") return n % 7 === 0;
  if (ev.recur === "biweekly") return n % 14 === 0;
  const a = parseKey(ev.date), b = parseKey(k);
  if (ev.recur === "monthly") return a.getDate() === b.getDate();
  if (ev.recur === "yearly") return a.getDate() === b.getDate() && a.getMonth() === b.getMonth();
  return false;
}
function spanPos(ev, k) {
  if (!ev.endDate || ev.endDate <= ev.date || (ev.recur && ev.recur !== "none")) return "single";
  if (k === ev.date) return "start";
  if (k === ev.endDate) return "end";
  if (k > ev.date && k < ev.endDate) return "mid";
  return null;
}
function eventsMapForRange(events, startK, endK) {
  const map = {};
  let d = parseKey(startK);
  const end = parseKey(endK);
  while (d <= end) {
    const k = toKey(d);
    for (const ev of events) {
      if (occursOn(ev, k)) (map[k] ||= []).push({ ...ev, date: k, seriesDate: ev.date, _span: spanPos(ev, k) });
    }
    if (map[k]) map[k].sort((a,b) => ((a.time||"99") < (b.time||"99") ? -1 : 1));
    d = addDays(d, 1);
  }
  return map;
}

// ---------- chore rotation ----------
// A chore: id, title, memberIds (rotation order), cadence (weekly|daily),
// anchorPeriod (period index when set up), anchorIndex (who was up then),
// lastDone { period, by }.
const periodOf = (chore, dateK = todayKey()) =>
  chore.cadence === "daily"
    ? diffDays("2020-01-01", dateK)
    : Math.floor(diffDays("2020-01-05", dateK) / 7); // 2020-01-05 = a Sunday
const whoseTurn = (chore, dateK = todayKey()) => {
  const order = chore.memberIds || [];
  if (!order.length) return null;
  const p = periodOf(chore, dateK);
  const offset = (((p - (chore.anchorPeriod || 0)) % order.length) + order.length) % order.length;
  return order[((chore.anchorIndex || 0) + offset) % order.length];
};
const choreDoneThisPeriod = (chore) => chore.lastDone && chore.lastDone.period === periodOf(chore);
const cadenceLabel = (c) => (c === "daily" ? "Every day" : "Every week");

// ---------- shopping / favorites ----------
const money = (n) => (n == null || n === "" ? "" : `$${Number(n).toFixed(2)}`);
// most recent purchase from a favorite's history
const lastBuy = (fav) => (fav.history && fav.history.length ? fav.history[fav.history.length - 1] : null);
// cheapest recorded purchase (by price) from a favorite's history
const cheapestBuy = (fav) => {
  const withPrice = (fav.history || []).filter((h) => h.price != null && h.price !== "");
  if (!withPrice.length) return null;
  return withPrice.reduce((best, h) => (Number(h.price) < Number(best.price) ? h : best));
};
const priceHint = (fav) => {
  if (!fav) return "";
  const last = lastBuy(fav), cheap = cheapestBuy(fav);
  const bits = [];
  if (last) bits.push(`Last: ${money(last.price)}${last.store ? ` ${last.store}` : ""}`.trim());
  if (cheap && (!last || cheap.store !== last.store || cheap.price !== last.price)) {
    bits.push(`Cheapest: ${money(cheap.price)}${cheap.store ? ` ${cheap.store}` : ""}`.trim());
  }
  return bits.join(" · ");
};

// ---------- storage ----------
async function loadData() {
  try {
    const res = await window.storage.get(DATA_KEY, true);
    return res ? JSON.parse(res.value) : null;
  } catch { return null; }
}
async function saveData(data) {
  const stamped = { ...data, updatedAt: Date.now() };
  await window.storage.set(DATA_KEY, JSON.stringify(stamped), true);
  return stamped;
}
async function loadPrivate() {
  try {
    const res = await window.storage.get(PRIV_KEY, false);
    return res ? JSON.parse(res.value) : [];
  } catch { return []; }
}
async function savePrivate(list) {
  try { await window.storage.set(PRIV_KEY, JSON.stringify(list), false); } catch (e) { console.error(e); }
}

// ---------- app ----------
export default function FamilyCalendar() {
  const [data, setData] = useState(null);
  const [privEvents, setPrivEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [me, setMe] = useState(null);
  const [lastSeen, setLastSeen] = useState(null);
  const [view, setView] = useState("month");
  const [cursor, setCursor] = useState(() => { const n = new Date(); return { y: n.getFullYear(), m: n.getMonth() }; });
  const [weekAnchor, setWeekAnchor] = useState(() => toKey(startOfWeek(new Date())));
  const [dayAnchor, setDayAnchor] = useState(() => todayKey());
  const [selectedDay, setSelectedDay] = useState(null);
  const [detail, setDetail] = useState(null);
  const [editing, setEditing] = useState(null);
  const [taskEditing, setTaskEditing] = useState(null);
  const [choreEditing, setChoreEditing] = useState(null);
  const [shopEditing, setShopEditing] = useState(null);
  const [favManage, setFavManage] = useState(false);
  const [historyView, setHistoryView] = useState(false);
  const [clearedView, setClearedView] = useState(null);
  const [addChoosing, setAddChoosing] = useState(false);
  const [famEditing, setFamEditing] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const dataRef = useRef(null); dataRef.current = data;
  const privRef = useRef([]); privRef.current = privEvents;

  useEffect(() => {
    let alive = true;
    (async () => {
      const [d, p] = await Promise.all([loadData(), loadPrivate()]);
      if (!alive) return;
      setData(d); setPrivEvents(p);
      try {
        const m = await window.storage.get(ME_KEY, false);
        if (m && alive) setMe(m.value);
      } catch {}
      try {
        const s = await window.storage.get(SEEN_KEY, false);
        if (alive) setLastSeen(Number(s.value));
      } catch {
        const now = Date.now();
        if (alive) setLastSeen(now);
        try { await window.storage.set(SEEN_KEY, String(now), false); } catch {}
      }
      setLoading(false);
    })();
    const tick = async () => {
      const fresh = await loadData();
      if (alive && fresh && (!dataRef.current || fresh.updatedAt !== dataRef.current.updatedAt)) setData(fresh);
    };
    const iv = setInterval(tick, POLL_MS);
    const onVis = () => { if (document.visibilityState === "visible") tick(); };
    document.addEventListener("visibilitychange", onVis);
    return () => { alive = false; clearInterval(iv); document.removeEventListener("visibilitychange", onVis); };
  }, []);

  const commit = useCallback(async (mutate) => {
    setSyncing(true);
    try {
      const latest = (await loadData()) || dataRef.current;
      const next = mutate(latest || { familyName: "Our Family", members: [], events: [], tasks: [], chores: [], shop: [], favorites: [], purchases: [], cleared: [] });
      const stamped = await saveData(next);
      setData(stamped);
    } catch (e) { console.error("save failed", e); }
    setSyncing(false);
  }, []);

  const commitPrivate = useCallback(async (mutate) => {
    const next = mutate(privRef.current);
    setPrivEvents(next);
    await savePrivate(next);
  }, []);

  const pickMe = async (id) => {
    setMe(id);
    try { await window.storage.set(ME_KEY, id, false); } catch {}
  };
  const markSeen = async () => {
    const now = Date.now();
    setLastSeen(now);
    try { await window.storage.set(SEEN_KEY, String(now), false); } catch {}
  };

  if (loading) return <Shell><p className="text-center text-slate-400 py-20 text-sm">Opening the calendar…</p></Shell>;
  if (!data || !data.members?.length) return <Setup onDone={(fam) => commit(() => fam)} />;

  const memberById = Object.fromEntries(data.members.map((m) => [m.id, m]));
  const colorOf = (ev) => (memberById[peopleOf(ev)[0]] || {}).color || "#94a3b8";
  const allEvents = [...(data.events || []).filter((e) => !e.cleared), ...privEvents];
  const tk = todayKey();

  const tasks = (data.tasks || []).filter((t) => !t.cleared);
  const openTasks = tasks.filter((t) => !t.done).sort((a,b) => ((a.dueDate||"9999") < (b.dueDate||"9999") ? -1 : 1));
  const doneTasks = tasks.filter((t) => t.done);
  const allChores = data.chores || [];
  const chores = allChores.filter((c) => !(c.clearedPeriod != null && c.clearedPeriod === periodOf(c)));
  const shop = data.shop || [];         // active shopping list items
  const favorites = data.favorites || []; // saved favorites with price history
  const purchases = data.purchases || []; // everything ever bought (newest first when shown)
  const cleared = data.cleared || [];   // cleared history (task/event/chore)

  const newForMe = (me && lastSeen)
    ? [...allEvents, ...tasks].filter((it) => it.ts && it.ts > lastSeen && it.by && it.by !== me && peopleOf(it).includes(me))
    : [];

  const todaysEvents = eventsMapForRange(allEvents, tk, tk)[tk] || [];
  const todaysTasks = openTasks.filter((t) => t.dueDate && t.dueDate <= tk);

  const saveEvent = async (evIn) => {
    const ev = { ...evIn, ts: Date.now(), by: me || evIn.by || null };
    const isPrivate = ev.visibility === "private";
    const wasShared = (dataRef.current?.events || []).some((e) => e.id === ev.id);
    const wasPrivate = privRef.current.some((e) => e.id === ev.id);
    if (isPrivate) {
      await commitPrivate((list) => {
        const i = list.findIndex((e) => e.id === ev.id);
        const next = [...list];
        if (i >= 0) next[i] = ev; else next.push(ev);
        return next;
      });
      if (wasShared) commit((d) => ({ ...d, events: (d.events || []).filter((e) => e.id !== ev.id) }));
    } else {
      commit((d) => {
        const events = [...(d.events || [])];
        const i = events.findIndex((e) => e.id === ev.id);
        if (i >= 0) events[i] = ev; else events.push(ev);
        return { ...d, events };
      });
      if (wasPrivate) await commitPrivate((list) => list.filter((e) => e.id !== ev.id));
    }
    setEditing(null); setDetail(null);
  };

  const deleteEvent = async (id) => {
    if (privRef.current.some((e) => e.id === id)) {
      await commitPrivate((list) => list.filter((e) => e.id !== id));
    } else {
      commit((d) => ({ ...d, events: (d.events || []).filter((e) => e.id !== id) }));
    }
    setEditing(null); setDetail(null);
  };

  const saveTask = (tIn) => {
    const t = { ...tIn, ts: Date.now(), by: me || tIn.by || null };
    commit((d) => {
      const list = [...(d.tasks || [])];
      const i = list.findIndex((x) => x.id === t.id);
      if (i >= 0) list[i] = t; else list.push(t);
      return { ...d, tasks: list };
    });
    setTaskEditing(null);
  };
  const deleteTask = (id) => {
    commit((d) => ({ ...d, tasks: (d.tasks || []).filter((t) => t.id !== id) }));
    setTaskEditing(null);
  };
  const toggleTask = (id) => {
    commit((d) => ({ ...d, tasks: (d.tasks || []).map((t) => (t.id === id ? { ...t, done: !t.done, ts: Date.now(), by: me || t.by || null } : t)) }));
  };

  const saveChore = (cIn) => {
    // stamp the rotation anchor to "now" so the first turn is the first person listed
    const isNew = !(data.chores || []).some((c) => c.id === cIn.id);
    const c = isNew
      ? { ...cIn, anchorPeriod: periodOf(cIn), anchorIndex: 0, lastDone: null, ts: Date.now(), by: me || null }
      : { ...cIn, ts: Date.now(), by: me || cIn.by || null };
    commit((d) => {
      const list = [...(d.chores || [])];
      const i = list.findIndex((x) => x.id === c.id);
      if (i >= 0) list[i] = c; else list.push(c);
      return { ...d, chores: list };
    });
    setChoreEditing(null);
  };
  const deleteChore = (id) => {
    commit((d) => ({ ...d, chores: (d.chores || []).filter((c) => c.id !== id) }));
    setChoreEditing(null);
  };
  // mark this period's turn done; if it's undone, clear it
  const completeChore = (id) => {
    commit((d) => ({
      ...d,
      chores: (d.chores || []).map((c) => {
        if (c.id !== id) return c;
        const p = periodOf(c);
        const already = c.lastDone && c.lastDone.period === p;
        return { ...c, lastDone: already ? null : { period: p, by: whoseTurn(c) }, ts: Date.now(), by: me || c.by || null };
      }),
    }));
  };

  // ----- swipe-to-clear + cleared history -----
  const logCleared = (d, kind, refId, title, detail, memberIds) => ({
    ...d,
    cleared: [...(d.cleared || []), { id: uid(), kind, refId, title, detail: detail || "", memberIds: memberIds || [], clearedAt: Date.now(), by: me || null }],
  });
  const clearTask = (id) => {
    commit((d) => {
      const t = (d.tasks || []).find((x) => x.id === id);
      if (!t || !t.done) return d;
      const d2 = logCleared(d, "task", t.id, t.title, dueLabel(t.dueDate), t.memberIds);
      return { ...d2, tasks: (d.tasks || []).map((x) => (x.id === id ? { ...x, cleared: true } : x)) };
    });
  };
  const toggleEventDone = (ev) => {
    commit((d) => ({
      ...d,
      events: (d.events || []).map((e) => {
        if (e.id !== ev.id) return e;
        const cur = e.doneOn || [];
        return { ...e, doneOn: cur.includes(ev.date) ? cur.filter((x) => x !== ev.date) : [...cur, ev.date] };
      }),
    }));
  };
  const clearEventOccurrence = (ev) => {
    const dateK = ev.date;
    commit((d) => {
      const e = (d.events || []).find((x) => x.id === ev.id);
      if (!e || !(e.doneOn || []).includes(dateK)) return d;
      const recurring = e.recur && e.recur !== "none";
      const d2 = logCleared(d, "event", e.id, e.title, fmtLong(dateK), e.memberIds);
      return {
        ...d2,
        events: (d.events || []).map((x) => {
          if (x.id !== ev.id) return x;
          return recurring ? { ...x, doneOn: (x.doneOn || []).filter((k) => k !== dateK) } : { ...x, cleared: true };
        }),
      };
    });
  };
  const clearChore = (id) => {
    commit((d) => {
      const c = (d.chores || []).find((x) => x.id === id);
      if (!c) return d;
      const p = periodOf(c);
      if (!(c.lastDone && c.lastDone.period === p)) return d;
      const turnMember = (d.members || []).find((m) => m.id === whoseTurn(c));
      const d2 = logCleared(d, "chore", c.id, c.title, turnMember ? `${turnMember.name}'s turn` : cadenceLabel(c.cadence), c.memberIds);
      return { ...d2, chores: (d.chores || []).map((x) => (x.id === id ? { ...x, clearedPeriod: p } : x)) };
    });
  };
  const deleteCleared = (id) => commit((d) => ({ ...d, cleared: (d.cleared || []).filter((h) => h.id !== id) }));
  const clearAllCleared = (kind) => commit((d) => ({ ...d, cleared: (d.cleared || []).filter((h) => h.kind !== kind) }));

  // ----- shopping list -----
  const addShopItem = (item) => {
    // item: { name, store, price, favId? }  -> add to active list
    commit((d) => {
      const list = [...(d.shop || [])];
      list.push({ id: uid(), name: item.name.trim(), store: item.store || "", price: item.price ?? "", favId: item.favId || null, checked: false, ts: Date.now(), by: me || null });
      return { ...d, shop: list };
    });
    setShopEditing(null);
  };
  const editShopItem = (item) => {
    commit((d) => ({ ...d, shop: (d.shop || []).map((s) => (s.id === item.id ? { ...s, ...item } : s)) }));
    setShopEditing(null);
  };
  const toggleShopChecked = (id) => {
    commit((d) => ({ ...d, shop: (d.shop || []).map((s) => (s.id === id ? { ...s, checked: !s.checked } : s)) }));
  };
  const removeShopItem = (id) => {
    commit((d) => ({ ...d, shop: (d.shop || []).filter((s) => s.id !== id) }));
    setShopEditing(null);
  };
  // "Done shopping": record every checked item into purchase history +
  // (if linked to a favorite) that favorite's price memory, then clear them.
  const clearCheckedShop = () => {
    commit((d) => {
      const checked = (d.shop || []).filter((s) => s.checked);
      if (checked.length === 0) return d;
      let favorites = [...(d.favorites || [])];
      const newPurchases = checked.map((item) => ({
        id: uid(),
        name: item.name,
        store: item.store || "",
        price: (item.price === "" || item.price == null) ? "" : Number(item.price),
        date: todayKey(),
        by: me || null,
        favId: item.favId || null,
      }));
      for (const item of checked) {
        if (item.favId) {
          favorites = favorites.map((f) => f.id === item.favId
            ? { ...f, history: [...(f.history || []), { store: item.store || "", price: (item.price === "" || item.price == null) ? "" : Number(item.price), date: todayKey() }] }
            : f);
        }
      }
      return {
        ...d,
        favorites,
        purchases: [...(d.purchases || []), ...newPurchases],
        shop: (d.shop || []).filter((s) => !s.checked),
      };
    });
  };
  const deletePurchase = (id) => {
    commit((d) => ({ ...d, purchases: (d.purchases || []).filter((p) => p.id !== id) }));
  };
  const clearAllPurchases = () => {
    commit((d) => ({ ...d, purchases: [] }));
  };
  // re-add a past purchase to the shopping list, carrying its last store/price as a hint
  const readdFromHistory = (p) => {
    commit((d) => {
      // avoid duplicate: if an item with the same name is already on the list, leave it
      if ((d.shop || []).some((s) => s.name.toLowerCase() === p.name.toLowerCase())) return d;
      // find matching favorite (if any) so the star/price-memory links up
      const fav = (d.favorites || []).find((f) => f.name.toLowerCase() === p.name.toLowerCase());
      return {
        ...d,
        shop: [...(d.shop || []), {
          id: uid(), name: p.name, store: "", price: "",
          favId: fav ? fav.id : null,
          lastStore: p.store || "", lastPrice: p.price ?? "",
          checked: false, ts: Date.now(), by: me || null,
        }],
      };
    });
  };

  // ----- favorites -----
  const addFavorite = (name) => {
    commit((d) => {
      if ((d.favorites || []).some((f) => f.name.toLowerCase() === name.trim().toLowerCase())) return d;
      return { ...d, favorites: [...(d.favorites || []), { id: uid(), name: name.trim(), history: [] }] };
    });
  };
  const saveItemAsFavorite = (item) => {
    // create a favorite from an active item (and link the item to it)
    commit((d) => {
      const favorites = [...(d.favorites || [])];
      let fav = favorites.find((f) => f.name.toLowerCase() === item.name.trim().toLowerCase());
      if (!fav) { fav = { id: uid(), name: item.name.trim(), history: [] }; favorites.push(fav); }
      const shop = (d.shop || []).map((s) => (s.id === item.id ? { ...s, favId: fav.id } : s));
      return { ...d, favorites, shop };
    });
  };
  const removeFavorite = (id) => {
    commit((d) => ({ ...d, favorites: (d.favorites || []).filter((f) => f.id !== id) }));
  };
  const addFavoriteToList = (fav) => {
    const last = lastBuy(fav);
    commit((d) => {
      if ((d.shop || []).some((s) => s.favId === fav.id)) return d; // already on list
      return { ...d, shop: [...(d.shop || []), { id: uid(), name: fav.name, store: last?.store || "", price: "", favId: fav.id, checked: false, ts: Date.now(), by: me || null }] };
    });
  };

  const saveFamily = (f) => {
    commit((d) => ({ ...d, familyName: f.familyName, members: f.members, adminPin: f.adminPin ?? d.adminPin ?? null }));
    setFamEditing(false);
  };

  const section = CALENDAR_VIEWS.includes(view) ? "calendar" : view;
  const headerTitle =
    view === "month" ? `${MONTHS[cursor.m]} ${cursor.y}`
    : view === "week" ? `${MONTHS[parseKey(weekAnchor).getMonth()]} ${parseKey(weekAnchor).getFullYear()}`
    : view === "day" ? `${MONTHS[parseKey(dayAnchor).getMonth()]} ${parseKey(dayAnchor).getFullYear()}`
    : view === "tasks" ? "To-do list"
    : view === "chores" ? "Chore rotation"
    : view === "shop" ? "Shopping list"
    : "Family board";

  const openNew = (dayKey, memberId) => {
    setSelectedDay(dayKey || selectedDay || (view === "day" ? dayAnchor : tk));
    setDetail(null);
    setEditing({ __new: true, presetMember: memberId || null });
  };
  const openDay = (k) => { if (view === "day") setDayAnchor(k); else setSelectedDay(k); };

  const taskSummary = (
    <TaskSummary openTasks={openTasks} doneCount={doneTasks.length} memberById={memberById}
      onToggle={toggleTask} onOpenAll={() => setView("tasks")} onEdit={setTaskEditing} />
  );
  const choreSummary = (
    <ChoreSummary chores={chores} memberById={memberById}
      onComplete={completeChore} onClear={clearChore} onOpenAll={() => setView("chores")} onEdit={setChoreEditing} />
  );

  return (
    <Shell>
      {/* preview banner */}
      <div className="bg-violet-600 text-white text-[11px] font-semibold text-center py-1.5 px-3">
        Preview — running in Claude. Call/text/directions buttons may be blocked here but work in the deployed version.
      </div>

      {/* header */}
      <header className="flex items-end justify-between gap-3 px-4 pt-4 pb-3">
        <div>
          <p className="text-xs font-semibold tracking-widest uppercase text-teal-700">{data.familyName}</p>
          <h1 className="text-2xl font-bold text-slate-800 leading-tight">{headerTitle}</h1>
        </div>
        <div className="flex items-center gap-2 pb-1">
          <span className={`w-2 h-2 rounded-full ${syncing ? "bg-amber-400" : "bg-emerald-400"}`} title={syncing ? "Saving…" : "Synced"} />
          <button onClick={() => setFamEditing(true)} className="w-8 h-8 rounded-full bg-slate-200 text-sm" aria-label="Family settings">⚙️</button>
        </div>
      </header>

      {/* section toggle (top level) */}
      <div className="px-4 pb-2 overflow-x-auto">
        <div className="flex rounded-full bg-slate-200 p-0.5 text-xs font-semibold w-fit whitespace-nowrap">
          {[["calendar","Calendar"],["tasks","Tasks"],["chores","Chores"],["shop","Shopping"]].map(([sec,label]) => {
            const active = section === sec;
            const go = () => setView(sec === "calendar" ? (CALENDAR_VIEWS.includes(view) ? view : "month") : sec);
            return (
              <button key={sec} onClick={go}
                className={`px-3.5 py-1.5 rounded-full transition-colors ${active ? "bg-white text-slate-800 shadow-sm" : "text-slate-500"}`}>
                {label}
                {sec === "tasks" && openTasks.length > 0 && (
                  <span className="ml-1 px-1.5 py-0.5 rounded-full bg-teal-700 text-white text-[9px] align-middle">{openTasks.length}</span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* calendar sub-views (only when in Calendar section) */}
      {section === "calendar" && (
        <div className="px-4 pb-3 overflow-x-auto">
          <div className="flex gap-1 text-xs font-semibold w-fit whitespace-nowrap">
            {[["month","Month"],["week","Week"],["day","Day"],["board","Board"]].map(([v,label]) => (
              <button key={v} onClick={() => setView(v)}
                className={`px-3 py-1 rounded-lg transition-colors ${view === v ? "bg-teal-700 text-white" : "bg-slate-100 text-slate-500"}`}>
                {label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* member legend / me picker */}
      <div className="flex gap-2 px-4 pb-3 overflow-x-auto">
        {data.members.map((m) => (
          <button key={m.id} onClick={() => pickMe(m.id)}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium whitespace-nowrap border transition-all ${me === m.id ? "border-slate-700 bg-white shadow-sm" : "border-transparent bg-slate-100 text-slate-600"}`}>
            <span className="w-2.5 h-2.5 rounded-full" style={{ background: m.color }} />
            {m.name}{me === m.id ? " · me" : ""}
          </button>
        ))}
      </div>

      {/* "new for you" alert */}
      {newForMe.length > 0 && (
        <div className="mx-4 mb-3 rounded-2xl border border-amber-300 bg-amber-50 p-3">
          <div className="flex items-start gap-2.5">
            <span className="text-lg leading-none pt-0.5">🔔</span>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-amber-900">New for you</p>
              <ul className="pt-0.5">
                {newForMe.slice(0,3).map((it) => (
                  <li key={it.id} className="text-xs text-amber-800 truncate">
                    {"done" in it ? "✅" : "📅"} {it.title}
                    {it.date ? ` · ${fmtShort(it.date)}` : it.dueDate ? ` · ${dueLabel(it.dueDate)}` : ""}
                  </li>
                ))}
                {newForMe.length > 3 && <li className="text-xs text-amber-700 font-semibold">+{newForMe.length - 3} more</li>}
              </ul>
            </div>
            <button onClick={markSeen} className="shrink-0 px-3 py-1.5 rounded-lg bg-amber-200/70 text-amber-900 text-xs font-bold">Got it</button>
          </div>
        </div>
      )}

      {/* today strip */}
      {(todaysEvents.length > 0 || todaysTasks.length > 0) && view !== "day" && (
        <Collapsible storeKey="famcal:collapse:today" title="Today"
          count={todaysEvents.length + todaysTasks.length} className="px-4 pb-3">
          <div className="flex gap-2 overflow-x-auto pb-1">
            {todaysEvents.map((ev) => (
              <button key={ev.id + ev.date} onClick={() => setDetail(ev)}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white border border-slate-200 whitespace-nowrap shrink-0 active:bg-slate-50">
                <span className="w-2.5 h-2.5 rounded-full" style={{ background: colorOf(ev) }} />
                <span className="text-xs font-semibold text-slate-800">{ev.title}</span>
                {ev.time && <span className="text-[10px] text-slate-500">{fmtTime(ev.time)}</span>}
              </button>
            ))}
            {todaysTasks.map((t) => (
              <button key={t.id} onClick={() => setTaskEditing(t)}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-xl border whitespace-nowrap shrink-0 active:bg-slate-50 ${t.dueDate < tk ? "bg-red-50 border-red-200" : "bg-white border-slate-200"}`}>
                <span className="text-xs">✅</span>
                <span className="text-xs font-semibold text-slate-800">{t.title}</span>
                {t.dueDate < tk && <span className="text-[10px] font-bold text-red-500">overdue</span>}
              </button>
            ))}
          </div>
        </Collapsible>
      )}

      {view === "month" && (<>
        <MonthGrid cursor={cursor} setCursor={setCursor} allEvents={allEvents} colorOf={colorOf} onPickDay={openDay} onDetail={setDetail} />
        {taskSummary}
        {choreSummary}
      </>)}
      {view === "week" && (<>
        <WeekView weekAnchor={weekAnchor} setWeekAnchor={setWeekAnchor} allEvents={allEvents} colorOf={colorOf} onPick={openDay} onDetail={setDetail} />
        {taskSummary}
        {choreSummary}
      </>)}
      {view === "day" && (<>
        <DayView dayAnchor={dayAnchor} setDayAnchor={setDayAnchor} allEvents={allEvents} memberById={memberById} colorOf={colorOf}
          onDetail={setDetail} onAdd={() => openNew(dayAnchor)} />
        {taskSummary}
        {choreSummary}
      </>)}
      {view === "tasks" && (
        <TasksView openTasks={openTasks} doneTasks={doneTasks} memberById={memberById}
          onToggle={toggleTask} onEdit={setTaskEditing} onClear={clearTask}
          onHistory={() => setClearedView("task")} historyCount={cleared.filter((h) => h.kind === "task").length} />
      )}
      {view === "chores" && (
        <ChoresView chores={chores} memberById={memberById} onComplete={completeChore} onClear={clearChore} onEdit={setChoreEditing}
          onHistory={() => setClearedView("chore")} historyCount={cleared.filter((h) => h.kind === "chore").length} />
      )}
      {view === "shop" && (
        <ShoppingView shop={shop} favorites={favorites}
          onToggle={toggleShopChecked} onEdit={setShopEditing} onClearChecked={clearCheckedShop}
          onAddFav={addFavoriteToList} onSaveFav={saveItemAsFavorite} onManageFavs={() => setFavManage(true)}
          onHistory={() => setHistoryView(true)} historyCount={purchases.length} />
      )}
      {view === "board" && (
        <Board members={data.members} allEvents={allEvents} onDetail={setDetail} onAdd={(mId) => openNew(tk, mId)} />
      )}

      {/* floating add */}
      <button onClick={() => (view === "tasks" ? setTaskEditing("new") : view === "chores" ? setChoreEditing("new") : view === "shop" ? setShopEditing("new") : setAddChoosing(true))}
        className="fixed bottom-5 right-5 w-14 h-14 rounded-full bg-teal-700 text-white text-3xl leading-none shadow-lg active:scale-95 transition-transform"
        aria-label="Add">+</button>

      {/* "+ what?" chooser */}
      {addChoosing && (
        <Sheet onClose={() => setAddChoosing(false)} title="Add something">
          <div className="grid grid-cols-2 gap-3">
            <button onClick={() => { setAddChoosing(false); openNew(); }}
              className="rounded-2xl bg-white border border-slate-200 p-4 text-left active:bg-slate-50">
              <span className="block text-2xl pb-1">📅</span>
              <span className="block text-sm font-bold text-slate-800">Event</span>
              <span className="block text-[11px] text-slate-500">Something happening on a day — practice, appointment, party</span>
            </button>
            <button onClick={() => { setAddChoosing(false); setTaskEditing("new"); }}
              className="rounded-2xl bg-white border border-slate-200 p-4 text-left active:bg-slate-50">
              <span className="block text-2xl pb-1">✅</span>
              <span className="block text-sm font-bold text-slate-800">Task</span>
              <span className="block text-[11px] text-slate-500">Something to get done — with a due date and who's responsible</span>
            </button>
          </div>
        </Sheet>
      )}

      {/* day sheet */}
      {selectedDay && !editing && !detail && !taskEditing && !addChoosing && !famEditing && (
        <DaySheet dayKey={selectedDay} allEvents={allEvents} memberById={memberById} colorOf={colorOf}
          onClose={() => setSelectedDay(null)} onDetail={setDetail} onAdd={() => openNew(selectedDay)} />
      )}

      {/* event detail */}
      {detail && !editing && (
        <EventDetail ev={detail} memberById={memberById} colorOf={colorOf}
          onClose={() => setDetail(null)} onEdit={() => setEditing(detail)} onDelete={() => deleteEvent(detail.id)}
          onToggleDone={(ev) => { toggleEventDone(ev); setDetail((d) => d ? { ...d, doneOn: (d.doneOn||[]).includes(ev.date) ? (d.doneOn||[]).filter((x)=>x!==ev.date) : [...(d.doneOn||[]), ev.date] } : d); }}
          onClearOccurrence={(ev) => { clearEventOccurrence(ev); setDetail(null); }} />
      )}

      {/* event editor */}
      {editing && (
        <EventEditor
          key={editing.__new ? "new" : editing.id}
          initial={editing.__new
            ? { id: uid(), title: "", date: selectedDay || tk, endDate: "", time: "", notes: "", phone: "", location: "", recur: "none", visibility: "family", memberIds: [editing.presetMember || me || data.members[0].id] }
            : { visibility: "family", phone: "", location: "", recur: "none", endDate: "", ...editing, date: editing.seriesDate || editing.date, memberIds: peopleOf(editing) }}
          isNew={!!editing.__new}
          members={data.members}
          onSave={saveEvent} onDelete={deleteEvent} onClose={() => setEditing(null)}
        />
      )}

      {/* task editor */}
      {taskEditing && (
        <TaskEditor
          key={taskEditing === "new" ? "new" : taskEditing.id}
          initial={taskEditing === "new"
            ? { id: uid(), title: "", dueDate: "", notes: "", done: false, memberIds: [me || data.members[0].id] }
            : { ...taskEditing, memberIds: peopleOf(taskEditing) }}
          isNew={taskEditing === "new"}
          members={data.members}
          onSave={saveTask} onDelete={deleteTask} onClose={() => setTaskEditing(null)}
        />
      )}

      {/* chore editor */}
      {choreEditing && (
        <ChoreEditor
          key={choreEditing === "new" ? "new" : choreEditing.id}
          initial={choreEditing === "new"
            ? { id: uid(), title: "", cadence: "weekly", memberIds: data.members.slice(0, Math.min(2, data.members.length)).map((m) => m.id) }
            : choreEditing}
          isNew={choreEditing === "new"}
          members={data.members}
          onSave={saveChore} onDelete={deleteChore} onClose={() => setChoreEditing(null)}
        />
      )}

      {/* family settings */}
      {famEditing && (
        <FamilyEditor familyName={data.familyName} members={data.members} adminPin={data.adminPin || null} onSave={saveFamily} onClose={() => setFamEditing(false)} />
      )}

      {/* shopping item editor */}
      {shopEditing && (
        <ShopItemEditor
          key={shopEditing === "new" ? "new" : shopEditing.id}
          initial={shopEditing === "new" ? { id: uid(), name: "", store: "", price: "", favId: null } : shopEditing}
          isNew={shopEditing === "new"}
          favorites={favorites}
          onAdd={addShopItem} onSave={editShopItem} onRemove={removeShopItem} onClose={() => setShopEditing(null)}
        />
      )}

      {/* favorites manager */}
      {favManage && (
        <FavoritesManager favorites={favorites} onAdd={addFavorite} onRemove={removeFavorite} onAddToList={addFavoriteToList} onClose={() => setFavManage(false)} />
      )}

      {/* purchase history */}
      {historyView && (
        <PurchaseHistory purchases={purchases} memberById={memberById} onDelete={deletePurchase} onClearAll={clearAllPurchases} onReadd={readdFromHistory} onClose={() => setHistoryView(false)} />
      )}

      {clearedView && (
        <ClearedHistory kind={clearedView} items={cleared.filter((h) => h.kind === clearedView)}
          memberById={memberById} onDelete={deleteCleared} onClearAll={() => clearAllCleared(clearedView)} onClose={() => setClearedView(null)} />
      )}
    </Shell>
  );
}

// ---------- day sheet ----------
function DaySheet({ dayKey, allEvents, memberById, colorOf, onClose, onDetail, onAdd }) {
  const evs = eventsMapForRange(allEvents, dayKey, dayKey)[dayKey] || [];
  return (
    <Sheet onClose={onClose} title={fmtLong(dayKey)}>
      {evs.length === 0 && <p className="text-sm text-slate-400 py-4 text-center">Nothing planned. Tap “Add an event” below.</p>}
      <ul className="space-y-2">
        {evs.map((ev) => (
          <li key={ev.id + ev.date}>
            <button onClick={() => onDetail(ev)} className="w-full text-left flex gap-3 items-start p-3 rounded-xl bg-white border border-slate-200 active:bg-slate-50">
              <span className="mt-1 w-3 h-3 rounded-full shrink-0" style={{ background: colorOf(ev) }} />
              <span className="flex-1 min-w-0">
                <span className="block font-semibold text-slate-800">
                  {ev.title}{ev.recur !== "none" && <RepeatBadge />}{ev.visibility === "private" && <PrivateBadge />}
                </span>
                <span className="block text-xs text-slate-500">
                  {[fmtTime(ev.time), peopleOf(ev).map((id) => (memberById[id]||{}).name).filter(Boolean).join(", ")].filter(Boolean).join(" · ") || "All day"}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      <button onClick={onAdd} className="mt-4 w-full py-3 rounded-xl bg-teal-700 text-white font-semibold text-sm">Add an event</button>
    </Sheet>
  );
}

// ---------- event detail ----------
function EventDetail({ ev, memberById, colorOf, onClose, onEdit, onDelete, onToggleDone, onClearOccurrence }) {
  const tel = digitsOf(ev.phone);
  const isDone = (ev.doneOn || []).includes(ev.date);
  return (
    <Sheet onClose={onClose} title="Event">
      {isDone && <p className="text-[11px] font-bold text-teal-700 pb-1">✓ Marked done</p>}
      <div className="rounded-2xl bg-white border border-slate-200 p-4" style={{ borderLeft: `5px solid ${colorOf(ev)}` }}>
        <h3 className="text-lg font-bold text-slate-800">
          {ev.title}{ev.visibility === "private" && <PrivateBadge />}
        </h3>
        <p className="text-sm text-slate-500 pt-0.5">
          {ev.endDate && ev.endDate > (ev.seriesDate || ev.date)
            ? `${fmtLong(ev.seriesDate || ev.date)} → ${fmtLong(ev.endDate)}`
            : `${fmtLong(ev.date)}${ev.time ? ` · ${fmtTime(ev.time)}` : " · All day"}`}
        </p>
        {ev.recur && ev.recur !== "none" && <p className="text-xs font-semibold text-teal-700 pt-1">🔁 {RECUR_LABELS[ev.recur]}</p>}
        <div className="flex flex-wrap gap-1.5 pt-3">
          {peopleOf(ev).map((id) => memberById[id] && (
            <span key={id} className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-100 text-xs font-semibold text-slate-700">
              <span className="w-2.5 h-2.5 rounded-full" style={{ background: memberById[id].color }} />
              {memberById[id].name}
            </span>
          ))}
        </div>
        {ev.location && <p className="text-sm text-slate-600 pt-3">📍 {ev.location}</p>}
        {ev.phone && <p className="text-sm text-slate-600 pt-1">📞 {ev.phone}</p>}
        {ev.notes && <p className="text-sm text-slate-600 pt-3 whitespace-pre-wrap">{ev.notes}</p>}
      </div>

      {(tel || ev.location) && (
        <div className="flex gap-2 pt-3">
          {tel && <a href={`tel:${tel}`} className="flex-1 py-3 rounded-xl bg-white border border-slate-300 text-center text-sm font-semibold text-slate-700">📞 Call</a>}
          {tel && <a href={`sms:${tel}`} className="flex-1 py-3 rounded-xl bg-white border border-slate-300 text-center text-sm font-semibold text-slate-700">💬 Text</a>}
          {ev.location && (
            <a href={`https://maps.google.com/?q=${encodeURIComponent(ev.location)}`} target="_blank" rel="noopener noreferrer"
              className="flex-1 py-3 rounded-xl bg-white border border-slate-300 text-center text-sm font-semibold text-slate-700">🗺️ Directions</a>
          )}
        </div>
      )}

      {onToggleDone && ev.visibility !== "private" && (
        <div className="flex gap-2 pt-3">
          <button onClick={() => onToggleDone(ev)}
            className={`flex-1 py-3 rounded-xl text-sm font-semibold border ${isDone ? "bg-teal-50 border-teal-600 text-teal-800" : "bg-white border-slate-300 text-slate-700"}`}>
            {isDone ? "✓ Done" : "Mark done"}
          </button>
          {isDone && (
            <button onClick={() => onClearOccurrence(ev)} className="flex-1 py-3 rounded-xl bg-emerald-600 text-white text-sm font-semibold">
              Clear{ev.recur && ev.recur !== "none" ? " (returns next time)" : ""}
            </button>
          )}
        </div>
      )}

      <div className="flex gap-2 pt-3">
        <button onClick={onDelete} className="px-4 py-3 rounded-xl bg-red-50 text-red-600 text-sm font-semibold">
          Delete{ev.recur && ev.recur !== "none" ? " series" : ""}
        </button>
        <button onClick={onEdit} className="flex-1 py-3 rounded-xl bg-teal-700 text-white text-sm font-semibold">
          Edit{ev.recur && ev.recur !== "none" ? " series" : " event"}
        </button>
      </div>
    </Sheet>
  );
}

// ---------- month grid ----------
function MonthGrid({ cursor, setCursor, allEvents, colorOf, onPickDay, onDetail }) {
  const first = new Date(cursor.y, cursor.m, 1);
  const daysInMonth = new Date(cursor.y, cursor.m + 1, 0).getDate();
  const map = eventsMapForRange(allEvents, toKey(first), toKey(new Date(cursor.y, cursor.m, daysInMonth)));
  const lead = first.getDay();
  const cells = [];
  for (let i = 0; i < lead; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(cursor.y, cursor.m, d));
  const tk = todayKey();
  const move = (dir) => setCursor(({ y, m }) => { const n = new Date(y, m + dir, 1); return { y: n.getFullYear(), m: n.getMonth() }; });

  return (
    <div className="px-2">
      <div className="flex justify-between items-center px-2 pb-2">
        <button onClick={() => move(-1)} className="px-3 py-1.5 rounded-lg text-slate-500 bg-slate-100 text-sm font-semibold">‹</button>
        <button onClick={() => setCursor(() => { const n = new Date(); return { y: n.getFullYear(), m: n.getMonth() }; })} className="text-xs font-semibold text-teal-700">Today</button>
        <button onClick={() => move(1)} className="px-3 py-1.5 rounded-lg text-slate-500 bg-slate-100 text-sm font-semibold">›</button>
      </div>
      <div className="grid grid-cols-7 text-center text-[11px] font-semibold text-slate-400 pb-1">
        {WEEKDAYS.map((w) => <div key={w}>{w}</div>)}
      </div>
      <div className="grid grid-cols-7 gap-0.5">
        {cells.map((d, i) => {
          if (!d) return <div key={`x${i}`} />;
          const k = toKey(d);
          const evs = map[k] || [];
          const isToday = k === tk;
          return (
            <button key={k} onClick={() => onPickDay(k)}
              className={`min-h-[72px] rounded-lg border p-0.5 flex flex-col items-stretch text-left transition-colors ${isToday ? "border-teal-600 bg-teal-50/70" : "border-slate-200 bg-white"}`}>
              <span className={`self-center inline-flex items-center justify-center w-5 h-5 mt-0.5 rounded-full text-[11px] font-bold ${isToday ? "bg-teal-700 text-white" : "text-slate-600"}`}>
                {d.getDate()}
              </span>
              <span className="flex flex-col gap-0.5 pt-0.5 overflow-hidden">
                {evs.slice(0,2).map((ev) => {
                  const span = ev._span;
                  const isSpan = span && span !== "single";
                  const roundCls = !isSpan ? "rounded" : span === "start" ? "rounded-l" : span === "end" ? "rounded-r" : "";
                  const marginCls = !isSpan ? "" : span === "start" ? "-mr-0.5" : span === "end" ? "-ml-0.5" : "-mx-0.5";
                  const showTitle = !isSpan || span === "start" || d.getDay() === 0;
                  return (
                    <span key={ev.id + ev.date}
                      onClick={(e) => { e.stopPropagation(); onDetail(ev); }}
                      className={`block ${roundCls} ${marginCls} px-0.5 py-px text-[8.5px] leading-tight font-semibold text-white truncate`}
                      style={{ background: colorOf(ev) }}>
                      {showTitle ? ev.title : "\u00A0"}
                    </span>
                  );
                })}
                {evs.length > 2 && <span className="text-[9px] font-semibold text-slate-400 pl-0.5">+{evs.length - 2} more</span>}
              </span>
            </button>
          );
        })}
      </div>
      <p className="text-[11px] text-slate-400 text-center pt-2">Tap an event for details, or a day to see everything on it.</p>
    </div>
  );
}

// ---------- week view ----------
function WeekView({ weekAnchor, setWeekAnchor, allEvents, colorOf, onPick, onDetail }) {
  const start = parseKey(weekAnchor);
  const days = Array.from({ length: 7 }, (_, i) => toKey(addDays(start, i)));
  const map = eventsMapForRange(allEvents, days[0], days[6]);
  const tk = todayKey();
  const move = (n) => setWeekAnchor(toKey(addDays(start, n)));

  return (
    <div className="px-3">
      <div className="flex justify-between items-center px-1 pb-3">
        <button onClick={() => move(-7)} className="px-3 py-1.5 rounded-lg text-slate-500 bg-slate-100 text-sm font-semibold">‹</button>
        <div className="text-center">
          <span className="block text-sm font-bold text-slate-700">{fmtShort(days[0])} – {fmtShort(days[6])}</span>
          <button onClick={() => setWeekAnchor(toKey(startOfWeek(new Date())))} className="text-xs font-semibold text-teal-700">This week</button>
        </div>
        <button onClick={() => move(7)} className="px-3 py-1.5 rounded-lg text-slate-500 bg-slate-100 text-sm font-semibold">›</button>
      </div>
      <div className="space-y-1.5">
        {days.map((k) => {
          const d = parseKey(k);
          const evs = map[k] || [];
          const isToday = k === tk;
          return (
            <div key={k} className={`flex gap-3 rounded-2xl border p-2.5 ${isToday ? "border-teal-600 bg-teal-50/60" : "border-slate-200 bg-white"}`}>
              <button onClick={() => onPick(k)} className="w-12 shrink-0 text-center pt-0.5">
                <span className={`block text-[10px] font-bold uppercase ${isToday ? "text-teal-700" : "text-slate-400"}`}>{WEEKDAYS[d.getDay()]}</span>
                <span className={`inline-flex items-center justify-center w-8 h-8 rounded-full text-sm font-bold ${isToday ? "bg-teal-700 text-white" : "text-slate-700"}`}>{d.getDate()}</span>
              </button>
              <div className="flex-1 min-w-0 py-0.5">
                {evs.length === 0 ? (
                  <button onClick={() => onPick(k)} className="text-xs text-slate-300 pt-2">—</button>
                ) : (
                  <ul className="space-y-1">
                    {evs.map((ev) => (
                      <li key={ev.id + ev.date}>
                        <button onClick={() => onDetail(ev)} className="w-full flex items-center gap-2 text-left rounded-lg px-2 py-1.5 active:bg-slate-100">
                          <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: colorOf(ev) }} />
                          <span className="flex-1 text-sm font-medium text-slate-800 truncate">
                            {ev.title}{ev.recur !== "none" && <RepeatBadge />}{ev.visibility === "private" && <PrivateBadge />}
                          </span>
                          <span className="text-[11px] text-slate-500 shrink-0">{fmtTime(ev.time)}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------- day view ----------
function DayView({ dayAnchor, setDayAnchor, allEvents, memberById, colorOf, onDetail, onAdd }) {
  const tk = todayKey();
  const d = parseKey(dayAnchor);
  const evs = eventsMapForRange(allEvents, dayAnchor, dayAnchor)[dayAnchor] || [];
  const timed = evs.filter((e) => e.time);
  const allDay = evs.filter((e) => !e.time);
  const move = (n) => setDayAnchor(toKey(addDays(d, n)));

  return (
    <div className="px-4">
      <div className="flex justify-between items-center pb-3">
        <button onClick={() => move(-1)} className="px-3 py-1.5 rounded-lg text-slate-500 bg-slate-100 text-sm font-semibold">‹</button>
        <div className="text-center">
          <span className="block text-sm font-bold text-slate-700">{dayAnchor === tk ? "Today" : fmtLong(dayAnchor)}</span>
          {dayAnchor !== tk && <button onClick={() => setDayAnchor(tk)} className="text-xs font-semibold text-teal-700">Back to today</button>}
        </div>
        <button onClick={() => move(1)} className="px-3 py-1.5 rounded-lg text-slate-500 bg-slate-100 text-sm font-semibold">›</button>
      </div>

      {evs.length === 0 && <p className="text-sm text-slate-400 text-center py-10">Nothing planned for this day.</p>}

      {allDay.length > 0 && (
        <div className="pb-3">
          <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400 pb-1.5">All day</p>
          <div className="space-y-1.5">
            {allDay.map((ev) => <DayCard key={ev.id + ev.date} ev={ev} memberById={memberById} colorOf={colorOf} onDetail={onDetail} />)}
          </div>
        </div>
      )}

      {timed.length > 0 && (
        <div className="space-y-1.5">
          {allDay.length > 0 && <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400 pb-0.5">Scheduled</p>}
          {timed.map((ev) => (
            <div key={ev.id + ev.date} className="flex gap-3 items-start">
              <span className="w-16 shrink-0 text-right text-xs font-bold text-slate-500 pt-3">{fmtTime(ev.time)}</span>
              <div className="flex-1"><DayCard ev={ev} memberById={memberById} colorOf={colorOf} onDetail={onDetail} /></div>
            </div>
          ))}
        </div>
      )}

      <button onClick={onAdd} className="mt-4 w-full py-3 rounded-xl bg-teal-700 text-white font-semibold text-sm">Add an event on this day</button>
    </div>
  );
}

function DayCard({ ev, memberById, colorOf, onDetail }) {
  return (
    <button onClick={() => onDetail(ev)} className="w-full text-left rounded-xl bg-white border border-slate-200 p-3 active:bg-slate-50"
      style={{ borderLeft: `4px solid ${colorOf(ev)}` }}>
      <span className="block text-sm font-semibold text-slate-800">
        {ev.title}{ev.recur !== "none" && <RepeatBadge />}{ev.visibility === "private" && <PrivateBadge />}
      </span>
      <span className="flex flex-wrap gap-1 pt-1">
        {peopleOf(ev).map((id) => memberById[id] && (
          <span key={id} className="flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-slate-100 text-[10px] font-semibold text-slate-600">
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: memberById[id].color }} />
            {memberById[id].name}
          </span>
        ))}
      </span>
      {(ev.location || ev.phone) && (
        <span className="block text-xs text-slate-400 pt-1 truncate">{[ev.location && `📍 ${ev.location}`, ev.phone && `📞 ${ev.phone}`].filter(Boolean).join("  ")}</span>
      )}
    </button>
  );
}

// ---------- kanban board ----------
const BOARD_RANGES = [["7","1 week"],["30","30 days"],["60","60 days"]];
function Board({ members, allEvents, onDetail, onAdd }) {
  const [range, setRange] = useState("30");
  const tk = todayKey();
  const horizon = toKey(addDays(new Date(), Number(range)));
  const map = eventsMapForRange(allEvents, tk, horizon);
  const flat = Object.values(map).flat();
  const upcoming = (mId) =>
    flat.filter((e) => peopleOf(e).includes(mId))
      .sort((a,b) => (a.date === b.date ? ((a.time||"99") < (b.time||"99") ? -1 : 1) : a.date < b.date ? -1 : 1));

  return (
    <div className="pb-24">
      <div className="px-4 pb-3">
        <div className="flex rounded-full bg-slate-200 p-0.5 text-xs font-semibold w-fit">
          {BOARD_RANGES.map(([v,label]) => (
            <button key={v} onClick={() => setRange(v)}
              className={`px-3.5 py-1.5 rounded-full transition-colors ${range === v ? "bg-white text-slate-800 shadow-sm" : "text-slate-500"}`}>
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="overflow-x-auto">
        <div className="flex gap-3 px-4 min-w-max items-start">
          {members.map((m) => {
            const evs = upcoming(m.id);
            return (
              <div key={m.id} className="w-60 shrink-0 rounded-2xl bg-slate-100 p-2.5">
                <div className="flex items-center gap-2 px-1 pb-2">
                  <span className="w-3 h-3 rounded-full" style={{ background: m.color }} />
                  <span className="flex-1 font-bold text-sm text-slate-800">{m.name}</span>
                  <span className="text-xs font-semibold text-slate-400">{evs.length}</span>
                </div>
                <div className="space-y-1.5">
                  {evs.length === 0 && <p className="text-xs text-slate-400 text-center py-4">Nothing in this range</p>}
                  {evs.map((ev) => (
                    <button key={ev.id + ev.date} onClick={() => onDetail(ev)}
                      className="w-full text-left rounded-xl bg-white border border-slate-200 p-2.5 active:bg-slate-50"
                      style={{ borderLeft: `4px solid ${m.color}` }}>
                      <span className="block text-sm font-semibold text-slate-800 truncate">
                        {ev.title}{ev.recur !== "none" && <RepeatBadge />}{ev.visibility === "private" && <PrivateBadge />}
                      </span>
                      <span className="block text-[11px] text-slate-500">
                        {ev.date === tk ? "Today" : fmtShort(ev.date)}{ev.time ? ` · ${fmtTime(ev.time)}` : ""}
                        {peopleOf(ev).length > 1 ? ` · ${peopleOf(ev).length} people` : ""}
                      </span>
                    </button>
                  ))}
                </div>
                <button onClick={() => onAdd(m.id)} className="mt-2 w-full py-2 rounded-xl text-xs font-semibold text-teal-700 bg-white border border-dashed border-slate-300">
                  + Add for {m.name}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ---------- task summary ----------
function TaskSummary({ openTasks, doneCount, memberById, onToggle, onOpenAll, onEdit }) {
  const show = openTasks.slice(0, 5);
  return (
    <div className="px-4 pt-4 pb-2">
      <Collapsible storeKey="famcal:collapse:tasks" count={openTasks.length}
        title={<span className="flex items-center gap-2">Tasks
          <span onClick={(e) => { e.stopPropagation(); onOpenAll(); }} className="text-teal-700 font-semibold normal-case tracking-normal">View all ›</span>
        </span>}>
        <div className="rounded-2xl bg-white border border-slate-200 p-3.5">
          {show.length === 0 ? (
            <p className="text-xs text-slate-400 text-center py-3">All caught up — nothing on the list. 🎉</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {show.map((t) => <TaskRow key={t.id} t={t} memberById={memberById} onToggle={onToggle} onEdit={onEdit} compact />)}
            </ul>
          )}
          {openTasks.length > 5 && (
            <button onClick={onOpenAll} className="mt-2 w-full text-center text-xs font-semibold text-teal-700">
              +{openTasks.length - 5} more — view all
            </button>
          )}
        </div>
      </Collapsible>
    </div>
  );
}

// ---------- chore summary ----------
function ChoreSummary({ chores, memberById, onComplete, onClear, onOpenAll, onEdit }) {
  if (!chores || chores.length === 0) return null;
  const show = chores.slice(0, 5);
  return (
    <div className="px-4 pt-1 pb-28">
      <Collapsible storeKey="famcal:collapse:chores" count={chores.length}
        title={<span className="flex items-center gap-2">Chores
          <span onClick={(e) => { e.stopPropagation(); onOpenAll(); }} className="text-teal-700 font-semibold normal-case tracking-normal">View all ›</span>
        </span>}>
        <div className="rounded-2xl bg-white border border-slate-200 p-3.5">
          <ul className="divide-y divide-slate-100">
            {show.map((c) => {
              const turnId = whoseTurn(c);
              const turn = memberById[turnId];
              const done = choreDoneThisPeriod(c);
              const solo = (c.memberIds || []).length === 1;
              return (
                <li key={c.id} className="flex items-center gap-3 py-2">
                  <button onClick={() => onComplete(c.id)} aria-label={done ? "Undo" : "Mark done"}
                    className={`w-6 h-6 rounded-lg border-2 flex items-center justify-center shrink-0 transition-colors ${done ? "bg-teal-700 border-teal-700 text-white" : "border-slate-300 bg-white"}`}>
                    {done && <span className="text-xs font-bold">✓</span>}
                  </button>
                  <button onClick={() => onEdit(c)} className="flex-1 min-w-0 text-left">
                    <span className={`block text-sm font-semibold truncate ${done ? "line-through text-slate-400" : "text-slate-800"}`}>{c.title}</span>
                    <span className="block text-[11px] text-slate-400">
                      {done ? `Done this ${c.cadence === "daily" ? "day" : "week"} ✓`
                        : turn ? (solo ? turn.name : `${turn.name}'s turn`) : "—"}
                    </span>
                  </button>
                  {turn && !done && <span className="w-3 h-3 rounded-full shrink-0" style={{ background: turn.color }} title={turn.name} />}
                </li>
              );
            })}
          </ul>
          {chores.length > 5 && (
            <button onClick={onOpenAll} className="mt-2 w-full text-center text-xs font-semibold text-teal-700">
              +{chores.length - 5} more — view all
            </button>
          )}
        </div>
      </Collapsible>
    </div>
  );
}

// ---------- tasks view ----------
function TasksView({ openTasks, doneTasks, memberById, onToggle, onEdit, onClear, onHistory, historyCount }) {
  const tk = todayKey();
  const overdue = openTasks.filter((t) => t.dueDate && t.dueDate < tk);
  const today = openTasks.filter((t) => t.dueDate === tk);
  const upcoming = openTasks.filter((t) => t.dueDate && t.dueDate > tk);
  const someday = openTasks.filter((t) => !t.dueDate);
  const [showDone, setShowDone] = useState(false);

  const Section = ({ label, list, tone }) =>
    list.length === 0 ? null : (
      <div className="pb-4">
        <p className={`text-[11px] font-bold uppercase tracking-wide pb-1.5 ${tone || "text-slate-400"}`}>{label}</p>
        <ul className="space-y-1.5">
          {list.map((t) => (
            <li key={t.id} className="rounded-xl border border-slate-200 overflow-hidden">
              <TaskRow t={t} memberById={memberById} onToggle={onToggle} onEdit={onEdit} />
            </li>
          ))}
        </ul>
      </div>
    );

  return (
    <div className="px-4 pb-24">
      <div className="flex justify-end pb-2">
        <button onClick={onHistory} className="text-xs font-semibold text-teal-700">Cleared{historyCount ? ` (${historyCount})` : ""}</button>
      </div>
      {openTasks.length === 0 && doneTasks.length === 0 && (
        <p className="text-sm text-slate-400 text-center py-14">No tasks yet. Tap + to add the first one —<br />groceries, permission slips, fix the fence…</p>
      )}
      <Section label="Overdue" list={overdue} tone="text-red-500" />
      <Section label="Due today" list={today} tone="text-teal-700" />
      <Section label="Coming up" list={upcoming} />
      <Section label="No due date" list={someday} />
      {doneTasks.length > 0 && (
        <div className="pt-1">
          <button onClick={() => setShowDone((s) => !s)} className="text-xs font-semibold text-slate-400">
            {showDone ? "Hide" : "Show"} completed ({doneTasks.length})
          </button>
          {showDone && (
            <ul className="space-y-1.5 pt-2">
              {doneTasks.map((t) => (
                <li key={t.id} className="rounded-xl border border-slate-200 overflow-hidden">
                  <TaskRow t={t} memberById={memberById} onToggle={onToggle} onEdit={onEdit} onClear={onClear} />
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function TaskRow({ t, memberById, onToggle, onEdit, onClear, compact }) {
  const overdue = t.dueDate && !t.done && t.dueDate < todayKey();
  const inner = (
    <div className={`flex items-center gap-3 ${compact ? "py-2" : "p-3"} ${overdue ? "bg-red-50/70 rounded-xl" : "bg-white"}`}>
      <button onClick={() => onToggle(t.id)} aria-label={t.done ? "Mark not done" : "Mark done"}
        className={`w-6 h-6 rounded-lg border-2 flex items-center justify-center shrink-0 transition-colors ${t.done ? "bg-teal-700 border-teal-700 text-white" : "border-slate-300 bg-white"}`}>
        {t.done && <span className="text-xs font-bold">✓</span>}
      </button>
      <button onClick={() => onEdit(t)} className="flex-1 min-w-0 text-left">
        <span className={`block text-sm font-semibold truncate ${t.done ? "line-through text-slate-400" : "text-slate-800"}`}>{t.title}</span>
        <span className={`block text-[11px] ${overdue ? "text-red-500 font-semibold" : "text-slate-400"}`}>
          {t.done && onClear ? "Done — swipe right to clear" : dueLabel(t.dueDate)}
          {!t.done && peopleOf(t).length > 0 && <> · {peopleOf(t).map((id) => (memberById[id]||{}).name).filter(Boolean).join(", ")}</>}
        </span>
      </button>
      <span className="flex -space-x-1 shrink-0">
        {peopleOf(t).slice(0,3).map((id) => memberById[id] && (
          <span key={id} className="w-4 h-4 rounded-full ring-2 ring-white" style={{ background: memberById[id].color }} title={memberById[id].name} />
        ))}
      </span>
    </div>
  );
  if (onClear) return <SwipeRow enabled={t.done} onSwipe={() => onClear(t.id)}>{inner}</SwipeRow>;
  return inner;
}

// ---------- task editor ----------
function TaskEditor({ initial, isNew, members, onSave, onDelete, onClose }) {
  const [t, setT] = useState(initial);
  const set = (k,v) => setT((x) => ({ ...x, [k]: v }));
  const togglePerson = (id) => setT((x) => ({ ...x, memberIds: x.memberIds.includes(id) ? x.memberIds.filter((y) => y !== id) : [...x.memberIds, id] }));
  const ok = t.title.trim() && t.memberIds.length > 0;
  return (
    <Sheet onClose={onClose} title={isNew ? "New task" : "Edit task"}>
      <div className="space-y-3">
        <Field label="What needs doing">
          <input autoFocus value={t.title} onChange={(e) => set("title", e.target.value)} placeholder="Buy hockey tape, sign permission slip…"
            className="w-full px-3 py-2.5 rounded-xl border border-slate-300 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-teal-600" />
        </Field>
        <Field label="Due date (optional)">
          <input type="date" value={t.dueDate || ""} onChange={(e) => set("dueDate", e.target.value)}
            className="w-full px-3 py-2.5 rounded-xl border border-slate-300 bg-white text-sm" />
        </Field>
        <Field label="Who's responsible (tap all that apply)">
          <div className="flex flex-wrap gap-2">
            {members.map((m) => {
              const on = t.memberIds.includes(m.id);
              return (
                <button key={m.id} onClick={() => togglePerson(m.id)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border ${on ? "border-slate-700 bg-white shadow-sm" : "border-transparent bg-slate-100 text-slate-600"}`}>
                  <span className="w-2.5 h-2.5 rounded-full" style={{ background: m.color }} />
                  {m.name}{on ? " ✓" : ""}
                </button>
              );
            })}
          </div>
          {t.memberIds.length === 0 && <p className="text-[11px] text-red-500 pt-1">Pick at least one person.</p>}
        </Field>
        <Field label="Notes (optional)">
          <input value={t.notes || ""} onChange={(e) => set("notes", e.target.value)} placeholder="Which store, size, details…"
            className="w-full px-3 py-2.5 rounded-xl border border-slate-300 bg-white text-sm" />
        </Field>
        <div className="flex gap-2 pt-1">
          {!isNew && <button onClick={() => onDelete(t.id)} className="px-4 py-3 rounded-xl bg-red-50 text-red-600 text-sm font-semibold">Delete</button>}
          <button disabled={!ok} onClick={() => onSave({ ...t, title: t.title.trim(), dueDate: t.dueDate || null })}
            className={`flex-1 py-3 rounded-xl text-sm font-semibold text-white ${ok ? "bg-teal-700" : "bg-slate-300"}`}>
            {isNew ? "Add task" : "Save changes"}
          </button>
        </div>
      </div>
    </Sheet>
  );
}

// ---------- chores view ----------
function ChoresView({ chores, memberById, onComplete, onClear, onEdit, onHistory, historyCount }) {
  const curP = (c) => periodOf(c);
  return (
    <div className="px-4 pb-24">
      <div className="flex justify-end pb-2">
        <button onClick={onHistory} className="text-xs font-semibold text-teal-700">Cleared{historyCount ? ` (${historyCount})` : ""}</button>
      </div>
      {chores.length === 0 && (
        <div className="text-center py-14">
          <p className="text-4xl pb-2">🔄</p>
          <p className="text-sm text-slate-400">No chores yet.<br />Tap + to set one up — one person's job, or rotating between several.</p>
        </div>
      )}
      <ul className="space-y-2">
        {chores.map((c) => {
          const turnId = whoseTurn(c);
          const turn = memberById[turnId];
          const done = choreDoneThisPeriod(c);
          const order = (c.memberIds || []).map((id) => memberById[id]).filter(Boolean);
          const solo = order.length === 1;
          const nextId = whoseTurn(c, c.cadence === "daily" ? toKey(addDays(new Date(),1)) : toKey(addDays(new Date(),7)));
          const next = memberById[nextId];
          const overdue = !done && c.lastDone && c.lastDone.period < curP(c) - 1;
          const inner = (
            <li className={`rounded-2xl border p-3.5 ${overdue ? "bg-red-50/70 border-red-200" : "bg-white border-slate-200"}`}
              style={{ borderLeft: `5px solid ${(turn||{}).color || "#94a3b8"}` }}>
              <div className="flex items-start gap-3">
                <button onClick={() => onComplete(c.id)} aria-label={done ? "Undo" : "Mark done"}
                  className={`w-8 h-8 rounded-xl border-2 flex items-center justify-center shrink-0 mt-0.5 transition-colors ${done ? "bg-teal-700 border-teal-700 text-white" : "border-slate-300 bg-white"}`}>
                  {done && <span className="text-sm font-bold">✓</span>}
                </button>
                <button onClick={() => onEdit(c)} className="flex-1 min-w-0 text-left">
                  <span className="block text-sm font-bold text-slate-800">{c.title}</span>
                  {done ? (
                    <span className="block text-xs text-teal-700 font-semibold pt-0.5">
                      Done this {c.cadence === "daily" ? "day" : "week"} ✓ — swipe right to clear{solo ? "" : next ? ` · ${next.name} next` : ""}
                    </span>
                  ) : (
                    <span className="block text-xs pt-0.5">
                      <span className="font-bold" style={{ color: overdue ? "#dc2626" : (turn||{}).color }}>{turn ? (solo ? turn.name : `${turn.name}'s turn`) : "—"}</span>
                      <span className={overdue ? "text-red-500 font-semibold" : "text-slate-400"}> · {overdue ? "overdue" : cadenceLabel(c.cadence)}</span>
                    </span>
                  )}
                  {!solo && (
                    <span className="flex items-center gap-1 pt-1.5 flex-wrap">
                      {order.map((m, i) => (
                        <span key={m.id} className="flex items-center">
                          <span className={`flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-semibold ${m.id === turnId && !done ? "bg-slate-800 text-white" : "bg-slate-100 text-slate-500"}`}>
                            <span className="w-1.5 h-1.5 rounded-full" style={{ background: m.color }} />{m.name}
                          </span>
                          {i < order.length - 1 && <span className="text-slate-300 px-0.5">→</span>}
                        </span>
                      ))}
                      <span className="text-slate-300 px-0.5">↻</span>
                    </span>
                  )}
                </button>
              </div>
            </li>
          );
          return (
            <div key={c.id} className="rounded-2xl overflow-hidden">
              <SwipeRow enabled={done} onSwipe={() => onClear(c.id)}>{inner}</SwipeRow>
            </div>
          );
        })}
      </ul>
      {chores.length > 0 && (
        <p className="text-[11px] text-slate-400 text-center pt-4">
          Multi-person chores rotate automatically each period; checking off early passes it on. Single-person chores just repeat. Swipe a done chore right to clear it (it returns next time).
        </p>
      )}
    </div>
  );
}

// ---------- chore editor ----------
function ChoreEditor({ initial, isNew, members, onSave, onDelete, onClose }) {
  const [c, setC] = useState(initial);
  const set = (k,v) => setC((x) => ({ ...x, [k]: v }));
  // order matters here, so tapping toggles in/out and appends to the end
  const togglePerson = (id) => setC((x) => ({
    ...x,
    memberIds: x.memberIds.includes(id) ? x.memberIds.filter((y) => y !== id) : [...x.memberIds, id],
  }));
  const ok = c.title.trim() && c.memberIds.length >= 1;
  const order = c.memberIds.map((id) => members.find((m) => m.id === id)).filter(Boolean);
  const solo = order.length === 1;
  return (
    <Sheet onClose={onClose} title={isNew ? "New chore" : "Edit chore"}>
      <div className="space-y-3">
        <Field label="Chore">
          <input autoFocus value={c.title} onChange={(e) => set("title", e.target.value)} placeholder="Dishes, garbage, walk the dog…"
            className="w-full px-3 py-2.5 rounded-xl border border-slate-300 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-teal-600" />
        </Field>
        <Field label={solo ? "How often" : "How often does it change hands"}>
          <div className="grid grid-cols-2 gap-2">
            {[["weekly","Every week"],["daily","Every day"]].map(([v,label]) => (
              <button key={v} onClick={() => set("cadence", v)}
                className={`py-2.5 rounded-xl text-xs font-semibold border ${c.cadence === v ? "border-teal-700 bg-teal-50 text-teal-800" : "border-slate-200 bg-white text-slate-500"}`}>
                {label}
              </button>
            ))}
          </div>
        </Field>
        <Field label="Who does it — tap one person, or several to rotate turns">
          <div className="flex flex-wrap gap-2">
            {members.map((m) => {
              const pos = c.memberIds.indexOf(m.id);
              const on = pos >= 0;
              return (
                <button key={m.id} onClick={() => togglePerson(m.id)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border ${on ? "border-slate-700 bg-white shadow-sm" : "border-transparent bg-slate-100 text-slate-600"}`}>
                  <span className="w-2.5 h-2.5 rounded-full" style={{ background: m.color }} />
                  {m.name}{on ? ` · ${pos + 1}` : ""}
                </button>
              );
            })}
          </div>
          {c.memberIds.length < 1 && <p className="text-[11px] text-red-500 pt-1">Pick at least one person.</p>}
          {solo && <p className="text-[11px] text-slate-400 pt-1">Just {order[0].name} — this stays their job, no rotation.</p>}
        </Field>
        {order.length >= 2 && (
          <div className="rounded-xl bg-slate-100 p-3">
            <p className="text-[11px] font-semibold text-slate-500 pb-1">Turn order</p>
            <p className="text-sm text-slate-700">
              {order.map((m) => m.name).join(" → ")} <span className="text-slate-400">↻ back to {order[0].name}</span>
            </p>
            {isNew && <p className="text-[11px] text-slate-400 pt-1">{order[0].name} is up first.</p>}
          </div>
        )}
        <div className="flex gap-2 pt-1">
          {!isNew && <button onClick={() => onDelete(c.id)} className="px-4 py-3 rounded-xl bg-red-50 text-red-600 text-sm font-semibold">Delete</button>}
          <button disabled={!ok} onClick={() => onSave({ ...c, title: c.title.trim() })}
            className={`flex-1 py-3 rounded-xl text-sm font-semibold text-white ${ok ? "bg-teal-700" : "bg-slate-300"}`}>
            {isNew ? (solo ? "Add chore" : "Start rotation") : "Save changes"}
          </button>
        </div>
      </div>
    </Sheet>
  );
}

// ---------- shopping view ----------
function ShoppingView({ shop, favorites, onToggle, onEdit, onClearChecked, onAddFav, onSaveFav, onManageFavs, onHistory, historyCount }) {
  const favById = Object.fromEntries(favorites.map((f) => [f.id, f]));
  const checkedCount = shop.filter((s) => s.checked).length;
  // favorites not already on the list, for quick-add chips
  const onListFavIds = new Set(shop.map((s) => s.favId).filter(Boolean));
  const quickFavs = favorites.filter((f) => !onListFavIds.has(f.id));

  return (
    <div className="px-4 pb-28">
      {/* quick-add favorites */}
      <div className="pb-3">
        <div className="flex items-center justify-between pb-1.5">
          <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Favorites — tap to add</p>
          <div className="flex gap-3">
            <button onClick={onHistory} className="text-xs font-semibold text-teal-700">History{historyCount ? ` (${historyCount})` : ""}</button>
            <button onClick={onManageFavs} className="text-xs font-semibold text-teal-700">Favorites</button>
          </div>
        </div>
        {favorites.length === 0 ? (
          <p className="text-xs text-slate-400">No favorites yet. Add an item, then tap ☆ to save it as a favorite for reuse.</p>
        ) : quickFavs.length === 0 ? (
          <p className="text-xs text-slate-400">All your favorites are already on the list.</p>
        ) : (
          <div className="flex gap-2 overflow-x-auto pb-1">
            {quickFavs.map((f) => {
              const hint = priceHint(f);
              return (
                <button key={f.id} onClick={() => onAddFav(f)}
                  className="flex flex-col items-start px-3 py-2 rounded-xl bg-white border border-slate-200 whitespace-nowrap shrink-0 active:bg-slate-50">
                  <span className="text-xs font-semibold text-slate-800">+ {f.name}</span>
                  {hint && <span className="text-[10px] text-slate-400">{hint}</span>}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* active list */}
      {shop.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-4xl pb-2">🛒</p>
          <p className="text-sm text-slate-400">List is empty. Tap + to add something,<br />or tap a favorite above.</p>
        </div>
      ) : (
        <ul className="space-y-1.5">
          {shop.map((s) => {
            const fav = s.favId ? favById[s.favId] : null;
            const hint = fav ? priceHint(fav) : "";
            return (
              <li key={s.id} className="rounded-xl bg-white border border-slate-200">
                <div className="flex items-center gap-3 p-3">
                  <button onClick={() => onToggle(s.id)} aria-label={s.checked ? "Uncheck" : "Check off"}
                    className={`w-6 h-6 rounded-lg border-2 flex items-center justify-center shrink-0 transition-colors ${s.checked ? "bg-teal-700 border-teal-700 text-white" : "border-slate-300 bg-white"}`}>
                    {s.checked && <span className="text-xs font-bold">✓</span>}
                  </button>
                  <button onClick={() => onEdit(s)} className="flex-1 min-w-0 text-left">
                    <span className={`block text-sm font-semibold truncate ${s.checked ? "line-through text-slate-400" : "text-slate-800"}`}>
                      {s.name}
                    </span>
                    <span className="block text-[11px] text-slate-400 truncate">
                      {[s.store, money(s.price)].filter(Boolean).join(" · ")
                        || (hint ? hint
                          : (s.lastStore || s.lastPrice !== "" ? `Last: ${money(s.lastPrice)}${s.lastStore ? ` ${s.lastStore}` : ""}`.trim()
                            : "tap to add store/price"))}
                    </span>
                  </button>
                  {/* save-as-favorite star (only if not already a favorite) */}
                  {!s.favId && (
                    <button onClick={() => onSaveFav(s)} aria-label="Save as favorite" title="Save as favorite" className="text-slate-300 text-lg px-1">☆</button>
                  )}
                  {s.favId && <span className="text-amber-400 text-lg px-1" title="Saved favorite">★</span>}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {checkedCount > 0 && (
        <button onClick={onClearChecked} className="mt-4 w-full py-3 rounded-xl bg-teal-700 text-white text-sm font-semibold">
          Done shopping — check off {checkedCount} {checkedCount === 1 ? "item" : "items"} as bought
        </button>
      )}
      <p className="text-[11px] text-slate-400 text-center pt-3">
        Tick items as you shop, then “Done shopping” records them to History and clears the list. Favorites also remember their last &amp; cheapest price.
      </p>
    </div>
  );
}

// ---------- purchase history ----------
function PurchaseHistory({ purchases, memberById, onDelete, onClearAll, onReadd, onClose }) {
  const sorted = [...purchases].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  const byDate = {};
  for (const p of sorted) (byDate[p.date] ||= []).push(p);
  const dates = Object.keys(byDate).sort((a, b) => (a < b ? 1 : -1));
  const total = (list) => {
    const sum = list.reduce((acc, p) => acc + (p.price === "" || p.price == null ? 0 : Number(p.price)), 0);
    return sum > 0 ? money(sum) : "";
  };
  return (
    <Sheet onClose={onClose} title="Purchase history">
      {purchases.length === 0 ? (
        <p className="text-sm text-slate-400 text-center py-10">Nothing bought yet.<br />Items you check off as bought will show here.</p>
      ) : (
        <div className="space-y-4">
          {dates.map((d) => (
            <div key={d}>
              <div className="flex items-center justify-between pb-1.5">
                <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">{d === todayKey() ? "Today" : fmtLong(d)}</p>
                {total(byDate[d]) && <p className="text-[11px] font-semibold text-slate-500">{total(byDate[d])}</p>}
              </div>
              <ul className="space-y-1.5">
                {byDate[d].map((p) => (
                  <li key={p.id} className="flex items-center gap-2 rounded-xl bg-white border border-slate-200 p-3">
                    <span className="flex-1 min-w-0">
                      <span className="block text-sm font-semibold text-slate-800 truncate">{p.name}</span>
                      <span className="block text-[11px] text-slate-400">
                        {[p.store, money(p.price), p.by && memberById[p.by] ? memberById[p.by].name : null].filter(Boolean).join(" · ") || "no details"}
                      </span>
                    </span>
                    <button onClick={() => onReadd(p)} className="shrink-0 px-2.5 py-1 rounded-lg bg-teal-50 text-teal-700 text-xs font-semibold">+ List</button>
                    <button onClick={() => onDelete(p.id)} aria-label="Delete from history" className="shrink-0 text-slate-300 px-1 text-sm">✕</button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          <button onClick={() => { if (confirm("Clear the entire purchase history? This can't be undone.")) onClearAll(); }}
            className="w-full py-2.5 rounded-xl bg-red-50 text-red-600 text-sm font-semibold">
            Clear all history
          </button>
        </div>
      )}
    </Sheet>
  );
}

// ---------- cleared history ----------
function ClearedHistory({ kind, items, memberById, onDelete, onClearAll, onClose }) {
  const label = kind === "task" ? "Cleared tasks" : kind === "event" ? "Cleared events" : "Cleared chores";
  const sorted = [...items].sort((a, b) => (b.clearedAt || 0) - (a.clearedAt || 0));
  const whenStr = (ms) => {
    if (!ms) return "";
    const d = new Date(ms);
    return `${MONTHS_SHORT[d.getMonth()]} ${d.getDate()}, ${fmtTime(`${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`)}`;
  };
  return (
    <Sheet onClose={onClose} title={label}>
      {sorted.length === 0 ? (
        <p className="text-sm text-slate-400 text-center py-10">Nothing cleared yet.<br />Swipe a completed item right to clear it — it'll be logged here.</p>
      ) : (
        <div className="space-y-1.5">
          {sorted.map((h) => (
            <div key={h.id} className="flex items-center gap-3 rounded-xl bg-white border border-slate-200 p-3">
              <span className="flex-1 min-w-0">
                <span className="block text-sm font-semibold text-slate-800 truncate line-through decoration-slate-300">{h.title}</span>
                <span className="block text-[11px] text-slate-400 truncate">
                  {[h.detail, h.by && memberById[h.by] ? `by ${memberById[h.by].name}` : null, whenStr(h.clearedAt)].filter(Boolean).join(" · ")}
                </span>
              </span>
              <button onClick={() => onDelete(h.id)} aria-label="Remove from history" className="shrink-0 text-slate-300 px-1 text-sm">✕</button>
            </div>
          ))}
          <button onClick={() => { if (confirm("Clear this entire history list? This can't be undone.")) onClearAll(); }}
            className="mt-3 w-full py-2.5 rounded-xl bg-red-50 text-red-600 text-sm font-semibold">
            Clear all
          </button>
        </div>
      )}
    </Sheet>
  );
}

// ---------- shop item editor ----------
function ShopItemEditor({ initial, isNew, favorites, onAdd, onSave, onRemove, onClose }) {
  const [s, setS] = useState(initial);
  const set = (k,v) => setS((x) => ({ ...x, [k]: v }));
  // if typing a name that matches a favorite, surface its price hint + auto-link
  const match = favorites.find((f) => f.name.toLowerCase() === (s.name || "").trim().toLowerCase());
  const hint = match ? priceHint(match) : "";
  const ok = (s.name || "").trim();
  const submit = () => {
    const payload = { ...s, name: s.name.trim(), price: s.price === "" ? "" : Number(s.price), favId: s.favId || (match ? match.id : null) };
    isNew ? onAdd(payload) : onSave(payload);
  };
  return (
    <Sheet onClose={onClose} title={isNew ? "Add to list" : "Edit item"}>
      <div className="space-y-3">
        <Field label="Item">
          <input autoFocus value={s.name} onChange={(e) => set("name", e.target.value)} placeholder="Milk, bread, dog food…"
            className="w-full px-3 py-2.5 rounded-xl border border-slate-300 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-teal-600" />
          {hint && <p className="text-[11px] text-teal-700 font-semibold pt-1">💡 {hint}</p>}
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Store (optional)">
            <input value={s.store || ""} onChange={(e) => set("store", e.target.value)} placeholder="Walmart, Costco…"
              className="w-full px-3 py-2.5 rounded-xl border border-slate-300 bg-white text-sm" />
          </Field>
          <Field label="Price (optional)">
            <input type="number" inputMode="decimal" step="0.01" value={s.price === "" || s.price == null ? "" : s.price}
              onChange={(e) => set("price", e.target.value)} placeholder="3.00"
              className="w-full px-3 py-2.5 rounded-xl border border-slate-300 bg-white text-sm" />
          </Field>
        </div>
        {match && !s.favId && <p className="text-[11px] text-slate-400">This matches your favorite “{match.name}” — buying it will update that favorite's price history.</p>}
        <div className="flex gap-2 pt-1">
          {!isNew && <button onClick={() => onRemove(s.id)} className="px-4 py-3 rounded-xl bg-red-50 text-red-600 text-sm font-semibold">Remove</button>}
          <button disabled={!ok} onClick={submit}
            className={`flex-1 py-3 rounded-xl text-sm font-semibold text-white ${ok ? "bg-teal-700" : "bg-slate-300"}`}>
            {isNew ? "Add to list" : "Save"}
          </button>
        </div>
      </div>
    </Sheet>
  );
}

// ---------- favorites manager ----------
function FavoritesManager({ favorites, onAdd, onRemove, onAddToList, onClose }) {
  const [newName, setNewName] = useState("");
  return (
    <Sheet onClose={onClose} title="Favorites">
      <div className="space-y-3">
        <div className="flex gap-2">
          <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Add a favorite (e.g. Milk)"
            onKeyDown={(e) => { if (e.key === "Enter" && newName.trim()) { onAdd(newName); setNewName(""); } }}
            className="flex-1 px-3 py-2.5 rounded-xl border border-slate-300 bg-white text-sm" />
          <button disabled={!newName.trim()} onClick={() => { onAdd(newName); setNewName(""); }}
            className={`px-4 rounded-xl text-sm font-semibold text-white ${newName.trim() ? "bg-teal-700" : "bg-slate-300"}`}>Add</button>
        </div>
        {favorites.length === 0 ? (
          <p className="text-xs text-slate-400 text-center py-6">No favorites yet.<br />Add regulars here, or tap ☆ on any list item.</p>
        ) : (
          <ul className="space-y-2">
            {favorites.map((f) => {
              const last = lastBuy(f), cheap = cheapestBuy(f);
              return (
                <li key={f.id} className="rounded-xl bg-white border border-slate-200 p-3">
                  <div className="flex items-center gap-2">
                    <span className="flex-1 font-semibold text-sm text-slate-800">{f.name}</span>
                    <button onClick={() => onAddToList(f)} className="px-2.5 py-1 rounded-lg bg-teal-50 text-teal-700 text-xs font-semibold">+ List</button>
                    <button onClick={() => onRemove(f.id)} className="text-slate-400 px-1">✕</button>
                  </div>
                  {(last || cheap) && (
                    <div className="pt-1.5 text-[11px] text-slate-500 space-y-0.5">
                      {last && <p>Last: {money(last.price)}{last.store ? ` at ${last.store}` : ""} · {fmtShort(last.date)}</p>}
                      {cheap && (!last || cheap.store !== last.store || cheap.price !== last.price) &&
                        <p className="text-teal-700 font-semibold">Cheapest: {money(cheap.price)}{cheap.store ? ` at ${cheap.store}` : ""}</p>}
                      <p className="text-slate-400">{(f.history || []).length} purchase{(f.history || []).length === 1 ? "" : "s"} recorded</p>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Sheet>
  );
}

// ---------- event editor ----------
function EventEditor({ initial, isNew, members, onSave, onDelete, onClose }) {
  const [ev, setEv] = useState(initial);
  const set = (k,v) => setEv((e) => ({ ...e, [k]: v }));
  const togglePerson = (id) => setEv((e) => ({ ...e, memberIds: e.memberIds.includes(id) ? e.memberIds.filter((x) => x !== id) : [...e.memberIds, id] }));
  const ok = ev.title.trim() && ev.date && ev.memberIds.length > 0 && (!ev.endDate || ev.endDate >= ev.date);
  return (
    <Sheet onClose={onClose} title={isNew ? "New event" : "Edit event"}>
      <div className="space-y-3">
        <Field label="What">
          <input autoFocus value={ev.title} onChange={(e) => set("title", e.target.value)} placeholder="Soccer practice, dentist, Grandma's birthday…"
            className="w-full px-3 py-2.5 rounded-xl border border-slate-300 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-teal-600" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Day">
            <input type="date" value={ev.date} onChange={(e) => set("date", e.target.value)}
              className="w-full px-3 py-2.5 rounded-xl border border-slate-300 bg-white text-sm" />
          </Field>
          <Field label="Time (optional)">
            <input type="time" value={ev.time || ""} onChange={(e) => set("time", e.target.value)}
              className="w-full px-3 py-2.5 rounded-xl border border-slate-300 bg-white text-sm" />
          </Field>
        </div>
        {(!ev.recur || ev.recur === "none") && (
          <Field label="Ends (optional — for multi-day events)">
            <input type="date" value={ev.endDate || ""} min={ev.date} onChange={(e) => set("endDate", e.target.value)}
              className="w-full px-3 py-2.5 rounded-xl border border-slate-300 bg-white text-sm" />
            {ev.endDate && ev.endDate > ev.date && (
              <p className="text-[11px] text-teal-700 pt-1">Spans {fmtShort(ev.date)} → {fmtShort(ev.endDate)}. Shows across all those days.</p>
            )}
            {ev.endDate && ev.endDate < ev.date && (
              <p className="text-[11px] text-red-500 pt-1">End date is before the start date.</p>
            )}
          </Field>
        )}
        <Field label="Repeats">
          <select value={ev.recur || "none"} onChange={(e) => setEv((x) => ({ ...x, recur: e.target.value, endDate: e.target.value !== "none" ? "" : x.endDate }))}
            className="w-full px-3 py-2.5 rounded-xl border border-slate-300 bg-white text-sm">
            <option value="none">Doesn't repeat</option>
            <option value="weekly">Every week</option>
            <option value="biweekly">Every 2 weeks</option>
            <option value="monthly">Every month</option>
            <option value="yearly">Every year (birthdays! 🎂)</option>
          </select>
          {ev.recur && ev.recur !== "none" && !isNew && (
            <p className="text-[11px] text-slate-400 pt-1">This event repeats — changes apply to every occurrence.</p>
          )}
        </Field>
        <Field label="Who's going (tap all that apply)">
          <div className="flex flex-wrap gap-2">
            {members.map((m) => {
              const on = ev.memberIds.includes(m.id);
              return (
                <button key={m.id} onClick={() => togglePerson(m.id)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border ${on ? "border-slate-700 bg-white shadow-sm" : "border-transparent bg-slate-100 text-slate-600"}`}>
                  <span className="w-2.5 h-2.5 rounded-full" style={{ background: m.color }} />
                  {m.name}{on ? " ✓" : ""}
                </button>
              );
            })}
          </div>
          {ev.memberIds.length === 0 && <p className="text-[11px] text-red-500 pt-1">Pick at least one person.</p>}
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Phone (optional)">
            <input type="tel" value={ev.phone || ""} onChange={(e) => set("phone", e.target.value)} placeholder="519-555-0142"
              className="w-full px-3 py-2.5 rounded-xl border border-slate-300 bg-white text-sm" />
          </Field>
          <Field label="Location (optional)">
            <input value={ev.location || ""} onChange={(e) => set("location", e.target.value)} placeholder="Arena, clinic, address…"
              className="w-full px-3 py-2.5 rounded-xl border border-slate-300 bg-white text-sm" />
          </Field>
        </div>
        <Field label="Who can see it">
          <div className="grid grid-cols-2 gap-2">
            <button onClick={() => set("visibility", "family")}
              className={`py-2.5 rounded-xl text-xs font-semibold border ${ev.visibility !== "private" ? "border-teal-700 bg-teal-50 text-teal-800" : "border-slate-200 bg-white text-slate-500"}`}>
              👨‍👩‍👧 Whole family
            </button>
            <button onClick={() => set("visibility", "private")}
              className={`py-2.5 rounded-xl text-xs font-semibold border ${ev.visibility === "private" ? "border-teal-700 bg-teal-50 text-teal-800" : "border-slate-200 bg-white text-slate-500"}`}>
              🔒 Only me
            </button>
          </div>
          {ev.visibility === "private" && (
            <p className="text-[11px] text-slate-400 pt-1.5">Private events are stored only in your own space — the rest of the family never receives them.</p>
          )}
        </Field>
        <Field label="Notes (optional)">
          <input value={ev.notes || ""} onChange={(e) => set("notes", e.target.value)} placeholder="Bring skates, gate code 4412…"
            className="w-full px-3 py-2.5 rounded-xl border border-slate-300 bg-white text-sm" />
        </Field>
        <div className="flex gap-2 pt-1">
          {!isNew && <button onClick={() => onDelete(ev.id)} className="px-4 py-3 rounded-xl bg-red-50 text-red-600 text-sm font-semibold">Delete</button>}
          <button disabled={!ok} onClick={() => onSave({ ...ev, title: ev.title.trim(), time: ev.time || null, endDate: (ev.endDate && ev.endDate > ev.date) ? ev.endDate : null, memberId: undefined })}
            className={`flex-1 py-3 rounded-xl text-sm font-semibold text-white ${ok ? "bg-teal-700" : "bg-slate-300"}`}>
            {isNew ? "Add to calendar" : "Save changes"}
          </button>
        </div>
      </div>
    </Sheet>
  );
}

// ---------- member list editor (shared by setup + settings) ----------
function MemberEditorList({ members, setMembers }) {
  const setMember = (i, patch) => setMembers(members.map((m,j) => (j === i ? { ...m, ...patch } : m)));
  const removeMember = (i) => setMembers(members.filter((_,j) => j !== i));
  const addMember = () => setMembers([...members, { id: uid(), name: "", color: MEMBER_COLORS[members.length % MEMBER_COLORS.length].hex }]);
  return (
    <div className="space-y-3">
      {members.map((m, i) => (
        <div key={m.id} className="rounded-xl bg-white border border-slate-200 p-2.5">
          <div className="flex items-center gap-2 pb-2">
            <span className="w-3.5 h-3.5 rounded-full shrink-0" style={{ background: m.color }} />
            <input value={m.name} onChange={(e) => setMember(i, { name: e.target.value })} placeholder={`Person ${i+1}`}
              className="flex-1 px-3 py-2 rounded-lg border border-slate-300 bg-white text-sm" />
            {members.length > 1 && <button onClick={() => removeMember(i)} className="text-slate-400 px-1">✕</button>}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {MEMBER_COLORS.map((c) => (
              <button key={c.hex} onClick={() => setMember(i, { color: c.hex })} aria-label={c.name} title={c.name}
                className={`w-7 h-7 rounded-full border-2 ${m.color === c.hex ? "border-slate-700 scale-110" : "border-transparent"} transition-transform`}
                style={{ background: c.hex }} />
            ))}
          </div>
        </div>
      ))}
      <button onClick={addMember} className="text-sm font-semibold text-teal-700">+ Add another person</button>
    </div>
  );
}

// ---------- first-run setup ----------
function Setup({ onDone }) {
  const [familyName, setFamilyName] = useState("");
  const [members, setMembers] = useState([{ id: uid(), name: "", color: MEMBER_COLORS[0].hex }]);
  const clean = members.map((m) => ({ ...m, name: m.name.trim() })).filter((m) => m.name);
  const ok = clean.length > 0;
  return (
    <Shell>
      <div className="max-w-md mx-auto px-5 pt-10 pb-16">
        <p className="text-xs font-semibold tracking-widest uppercase text-teal-700 pb-1">Set up once</p>
        <h1 className="text-3xl font-bold text-slate-800 pb-1">Your family calendar</h1>
        <p className="text-sm text-slate-500 pb-6">Everyone who opens this link sees the same calendar. Add your family below — each person gets a colour.</p>
        <Field label="Family name">
          <input value={familyName} onChange={(e) => setFamilyName(e.target.value)} placeholder="The Hendersons"
            className="w-full px-3 py-2.5 rounded-xl border border-slate-300 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-teal-600" />
        </Field>
        <div className="pt-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 pb-2">Family members</p>
          <MemberEditorList members={members} setMembers={setMembers} />
        </div>
        <button disabled={!ok}
          onClick={() => onDone({ familyName: familyName.trim() || "Our Family", members: clean, events: [], tasks: [], chores: [], shop: [], favorites: [], purchases: [], cleared: [] })}
          className={`mt-8 w-full py-3.5 rounded-xl text-sm font-semibold text-white ${ok ? "bg-teal-700" : "bg-slate-300"}`}>
          Create our calendar
        </button>
      </div>
    </Shell>
  );
}

// ---------- family settings ----------
function FamilyEditor({ familyName, members: initMembers, adminPin: initPin, onSave, onClose }) {
  const [name, setName] = useState(familyName);
  const [members, setMembers] = useState(initMembers);
  const [adminPin, setAdminPin] = useState(initPin || "");
  const [unlocked, setUnlocked] = useState(!initPin);
  const [pinTry, setPinTry] = useState("");
  const [pinWrong, setPinWrong] = useState(false);
  const clean = members.map((m) => ({ ...m, name: m.name.trim() })).filter((m) => m.name);
  const tryUnlock = () => {
    if (pinTry === initPin) { setUnlocked(true); setPinWrong(false); }
    else { setPinWrong(true); setPinTry(""); }
  };
  return (
    <Sheet onClose={onClose} title="Family settings">
      <div className="space-y-4">
        {!unlocked ? (
          <div className="rounded-2xl bg-slate-100 p-4 text-center">
            <p className="text-2xl pb-1">🔑</p>
            <p className="text-sm font-semibold text-slate-700 pb-0.5">Admin PIN required</p>
            <p className="text-[11px] text-slate-500 pb-3">Enter the admin PIN to add or remove people and change family settings.</p>
            <input type="password" inputMode="numeric" value={pinTry} autoFocus
              onChange={(e) => { setPinTry(e.target.value); setPinWrong(false); }}
              onKeyDown={(e) => e.key === "Enter" && tryUnlock()}
              className="w-full text-center tracking-widest px-3 py-2.5 rounded-xl border border-slate-300 bg-white text-sm" />
            {pinWrong && <p className="text-xs text-red-500 pt-2">Incorrect PIN.</p>}
            <button onClick={tryUnlock} className="mt-3 w-full py-2.5 rounded-xl bg-teal-700 text-white text-sm font-semibold">Unlock</button>
          </div>
        ) : (
          <>
            <Field label="Family name">
              <input value={name} onChange={(e) => setName(e.target.value)}
                className="w-full px-3 py-2.5 rounded-xl border border-slate-300 bg-white text-sm" />
            </Field>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 pb-2">Family members</p>
              <MemberEditorList members={members} setMembers={setMembers} />
              <p className="text-[11px] text-slate-400 pt-2">Removing a person doesn't delete their events — they just show up grey.</p>
            </div>
            <Field label="Admin PIN (blank = anyone can edit these settings)">
              <input value={adminPin} onChange={(e) => setAdminPin(e.target.value)} placeholder="e.g. 1379"
                className="w-full px-3 py-2.5 rounded-xl border border-slate-300 bg-white text-sm" />
              <p className="text-[11px] text-slate-400 pt-1">Protects this settings screen — share it only with the grown-ups.</p>
            </Field>
            <button disabled={clean.length === 0}
              onClick={() => onSave({ familyName: name.trim() || "Our Family", members: clean, adminPin: adminPin.trim() || null })}
              className={`w-full py-3 rounded-xl text-sm font-semibold text-white ${clean.length ? "bg-teal-700" : "bg-slate-300"}`}>
              Save family settings
            </button>
          </>
        )}
        <p className="text-center text-[10px] text-slate-300 pt-2">Family Calendar · v{APP_VERSION}</p>
      </div>
    </Sheet>
  );
}

// ---------- small ui ----------
function SwipeRow({ enabled, onSwipe, children }) {
  const [dx, setDx] = useState(0);
  const [swiping, setSwiping] = useState(false);
  const startX = useRef(0);
  const startY = useRef(0);
  const decided = useRef(null);
  const onStart = (e) => {
    if (!enabled) return;
    const t = e.touches ? e.touches[0] : e;
    startX.current = t.clientX; startY.current = t.clientY; decided.current = null;
    setSwiping(true);
  };
  const onMove = (e) => {
    if (!enabled || !swiping) return;
    const t = e.touches ? e.touches[0] : e;
    const mx = t.clientX - startX.current;
    const my = t.clientY - startY.current;
    if (decided.current === null) {
      if (Math.abs(mx) > 8 || Math.abs(my) > 8) decided.current = Math.abs(mx) > Math.abs(my) ? "h" : "v";
    }
    if (decided.current === "h") {
      if (e.cancelable) e.preventDefault();
      setDx(Math.max(0, mx));
    }
  };
  const onEnd = () => {
    if (!enabled) return;
    setSwiping(false);
    if (dx > 90) { setDx(0); onSwipe && onSwipe(); }
    else setDx(0);
  };
  return (
    <div className="relative overflow-hidden">
      {enabled && dx > 0 && (
        <div className="absolute inset-0 flex items-center px-4 bg-emerald-500 text-white text-sm font-bold rounded-xl">✓ Clear</div>
      )}
      <div
        onTouchStart={onStart} onTouchMove={onMove} onTouchEnd={onEnd}
        onMouseDown={onStart} onMouseMove={(e) => swiping && onMove(e)} onMouseUp={onEnd} onMouseLeave={() => swiping && onEnd()}
        style={{ transform: `translateX(${dx}px)`, transition: swiping ? "none" : "transform 0.2s ease" }}
        className="relative">
        {children}
      </div>
    </div>
  );
}

function Collapsible({ storeKey, title, count, children, className }) {
  const [open, setOpen] = useState(true);
  useEffect(() => {
    (async () => {
      try { const r = await window.storage.get(storeKey, false); if (r) setOpen(r.value !== "0"); } catch {}
    })();
  }, [storeKey]);
  const toggle = async () => {
    const next = !open;
    setOpen(next);
    try { await window.storage.set(storeKey, next ? "1" : "0", false); } catch {}
  };
  return (
    <div className={className}>
      <button onClick={toggle} className="w-full flex items-center gap-1.5 pb-1.5 text-left">
        <span className={`text-slate-400 text-xs transition-transform ${open ? "" : "-rotate-90"}`}>▾</span>
        <span className="text-[11px] font-bold uppercase tracking-wide text-slate-400 flex-1">{title}</span>
        {!open && count > 0 && (
          <span className="px-1.5 py-0.5 rounded-full bg-slate-200 text-slate-500 text-[10px] font-bold">{count}</span>
        )}
      </button>
      {open && children}
    </div>
  );
}
function RepeatBadge() {
  return <span className="ml-1 text-[10px] align-middle" title="Repeats">🔁</span>;
}
function PrivateBadge() {
  return (
    <span className="inline-flex items-center gap-0.5 ml-1.5 px-1.5 py-0.5 rounded-md bg-slate-100 text-slate-500 text-[10px] font-semibold align-middle">🔒 Private</span>
  );
}
function Shell({ children }) {
  return <div className="min-h-screen bg-slate-50 text-slate-800" style={{ fontFamily: "ui-rounded, 'SF Pro Rounded', system-ui, -apple-system, 'Segoe UI', sans-serif" }}>{children}</div>;
}
function Field({ label, children }) {
  return (
    <label className="block">
      <span className="block text-xs font-semibold uppercase tracking-wide text-slate-500 pb-1.5">{label}</span>
      {children}
    </label>
  );
}
function Sheet({ title, children, onClose }) {
  return (
    <div className="fixed inset-0 z-40">
      <div className="absolute inset-0 bg-slate-900/40" onClick={onClose} />
      <div className="absolute bottom-0 left-0 right-0 max-h-[85vh] overflow-y-auto rounded-t-3xl bg-slate-50 p-5 pb-8 shadow-2xl max-w-lg mx-auto">
        <div className="flex items-center justify-between pb-3">
          <h2 className="text-lg font-bold text-slate-800">{title}</h2>
          <button onClick={onClose} className="w-8 h-8 rounded-full bg-slate-200 text-slate-500 text-sm">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}
