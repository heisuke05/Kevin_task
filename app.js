/* ========================================================
   TaskFlow — app.js
   Vanilla JS personal task/notes manager. No backend.
   Data persists in localStorage (per browser/device).
   ======================================================== */

(function(){
  "use strict";

  /* ---------------- Constants ---------------- */
  const STORAGE_KEY = "taskflow_v1";

  const TAGS = {
    private_general: { label: "プライベート",     color: "#a78bfa", category: "private" },
    dojo:            { label: "道場ルーティーン", color: "#2dd4bf", category: "work" },
    web:              { label: "Web",              color: "#fb923c", category: "work" },
    x:                { label: "X投稿",            color: "#22d3ee", category: "work" },
    note:             { label: "note",              color: "#34d399", category: "work" },
    substack:         { label: "Substack",          color: "#f97316", category: "work" },
    ai_tool:          { label: "AIツール",          color: "#f472b6", category: "work" },
    stock:            { label: "Stockアフィリエイト", color: "#facc15", category: "work" },
    work_general:     { label: "仕事(その他)",      color: "#60a5fa", category: "work" }
  };
  const TAG_ORDER = ["private_general","dojo","web","x","note","substack","ai_tool","stock","work_general"];

  /* ---------------- State ---------------- */
  let state = loadState();
  let currentView = "today";
  let currentFilter = "all";
  let deferredInstallPrompt = null;

  /* ---------------- Cloud sync (Firebase, optional) ---------------- */
  let applyingRemote = false;
  let cloudPushTimer = null;
  let hasDoneInitialSync = false;

  function cloudPushDebounced(){
    if(!window.TaskFlowCloud || !window.TaskFlowCloud.isSignedIn() || applyingRemote) return;
    clearTimeout(cloudPushTimer);
    cloudPushTimer = setTimeout(()=>{
      window.TaskFlowCloud.push(state);
    }, 800);
  }

  function defaultState(){
    return { tasks: [], inbox: [], settings: { theme: "dark" } };
  }

  function loadState(){
    try{
      const raw = localStorage.getItem(STORAGE_KEY);
      if(!raw) return defaultState();
      const parsed = JSON.parse(raw);
      return Object.assign(defaultState(), parsed);
    }catch(e){
      console.error("Failed to load state", e);
      return defaultState();
    }
  }

  function saveState(){
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    renderBadges();
    cloudPushDebounced();
  }

  function uid(){
    if(window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return "id-" + Date.now() + "-" + Math.random().toString(16).slice(2);
  }

  /* ---------------- Date helpers ---------------- */
  function todayStr(){
    return toLocalDateStr(new Date());
  }
  function toLocalDateStr(d){
    const y = d.getFullYear(), m = String(d.getMonth()+1).padStart(2,"0"), day = String(d.getDate()).padStart(2,"0");
    return `${y}-${m}-${day}`;
  }
  function addDays(dateStr, n){
    const d = new Date(dateStr + "T00:00:00");
    d.setDate(d.getDate()+n);
    return toLocalDateStr(d);
  }
  const WEEKDAYS = ["日","月","火","水","木","金","土"];
  function formatDateLabel(dateStr){
    if(!dateStr) return "";
    const d = new Date(dateStr + "T00:00:00");
    return `${d.getMonth()+1}/${d.getDate()}(${WEEKDAYS[d.getDay()]})`;
  }
  function formatDateTimeLabel(dtStr){
    if(!dtStr) return "";
    const d = new Date(dtStr);
    const h = String(d.getHours()).padStart(2,"0"), m = String(d.getMinutes()).padStart(2,"0");
    return `${d.getMonth()+1}/${d.getDate()} ${h}:${m}`;
  }

  /* ---------------- DOM refs ---------------- */
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  const viewTitle = $("#viewTitle");
  const views = {
    today: $("#view-today"),
    inbox: $("#view-inbox"),
    tasks: $("#view-tasks"),
    gantt: $("#view-gantt"),
    settings: $("#view-settings")
  };
  const viewTitles = { today:"今日", inbox:"メモ / Inbox", tasks:"すべてのタスク", gantt:"ガントチャート", settings:"設定" };

  /* ---------------- View switching ---------------- */
  function switchView(name){
    currentView = name;
    Object.keys(views).forEach(k => { views[k].hidden = (k !== name); });
    viewTitle.textContent = viewTitles[name];
    $$(".nav-item").forEach(el => el.classList.toggle("is-active", el.dataset.view === name));
    $$(".bn-item").forEach(el => el.classList.toggle("is-active", el.dataset.view === name));
    if(name === "today") renderToday();
    if(name === "inbox") renderInbox();
    if(name === "tasks") renderTasks();
    if(name === "gantt") renderGantt();
    if(name === "settings") renderSettings();
    window.scrollTo({top:0});
  }

  $$("[data-view]").forEach(btn=>{
    btn.addEventListener("click", ()=> switchView(btn.dataset.view));
  });
  $$("[data-goto]").forEach(btn=>{
    btn.addEventListener("click", ()=> switchView(btn.dataset.goto));
  });
  $("#fabBtn").addEventListener("click", ()=> openTaskModal());
  $("#quickAddBtn").addEventListener("click", ()=> openTaskModal());
  $("#sideQuickAddBtn").addEventListener("click", ()=> openTaskModal());

  /* ---------------- Badges ---------------- */
  function renderBadges(){
    const n = state.inbox.length;
    const b1 = $("#inboxBadge"), b2 = $("#inboxBadgeMobile");
    [b1,b2].forEach(b=>{
      if(n>0){ b.hidden=false; b.textContent = n>99?"99+":n; } else { b.hidden = true; }
    });
    const todayCount = state.tasks.filter(t => t.status!=="done" && (t.dueDate===todayStr() || (t.dueDate && t.dueDate < todayStr()))).length;
    $("#todayCount").textContent = todayCount;
  }

  /* ================= TODAY VIEW ================= */
  function renderToday(){
    const today = todayStr();
    const active = state.tasks.filter(t=>t.status!=="done");
    const overdue = active.filter(t=>t.dueDate && t.dueDate < today).sort((a,b)=>a.dueDate.localeCompare(b.dueDate));
    const todays = active.filter(t=>t.dueDate === today);
    const upcoming = active.filter(t=>t.dueDate && t.dueDate > today).sort((a,b)=>a.dueDate.localeCompare(b.dueDate)).slice(0,5);

    const banner = $("#inboxBanner");
    if(state.inbox.length>0){
      banner.hidden = false;
      $("#inboxBannerCount").textContent = state.inbox.length;
    } else banner.hidden = true;

    const overdueBlock = $("#overdueBlock");
    if(overdue.length){
      overdueBlock.hidden = false;
      $("#overdueList").innerHTML = "";
      overdue.forEach(t => $("#overdueList").appendChild(taskCard(t, true)));
    } else overdueBlock.hidden = true;

    const todayList = $("#todayList");
    todayList.innerHTML = "";
    todays.forEach(t => todayList.appendChild(taskCard(t)));
    $("#todayEmptyHint").hidden = todays.length>0;

    const upcomingList = $("#upcomingList");
    upcomingList.innerHTML = "";
    upcoming.forEach(t => upcomingList.appendChild(taskCard(t)));

    renderBadges();
  }

  function taskCard(t, overdueFlag){
    const li = document.createElement("li");
    const tag = TAGS[t.tag] || TAGS.work_general;
    li.className = "task-card" + (t.status==="done" ? " is-done" : "") + (overdueFlag ? " is-overdue" : "");
    li.style.borderLeftColor = tag.color;

    const check = document.createElement("input");
    check.type = "checkbox";
    check.className = "task-check";
    check.checked = t.status === "done";
    check.addEventListener("change", (e)=>{
      e.stopPropagation();
      t.status = check.checked ? "done" : "todo";
      t.completedAt = check.checked ? new Date().toISOString() : null;
      let repeatMsg = null;
      if(check.checked && t.repeatEveryDays && !t.spawnedNext){
        t.spawnedNext = true;
        const baseDate = t.dueDate || todayStr();
        const nextDue = addDays(baseDate, t.repeatEveryDays);
        state.tasks.push({
          id: uid(), title: t.title, tag: t.tag, status: "todo",
          notes: t.notes || "",
          dueDate: nextDue, reminderAt: null, startDate: null, endDate: null,
          repeatEveryDays: t.repeatEveryDays, spawnedNext: false,
          createdAt: new Date().toISOString(), completedAt: null, notified: false
        });
        repeatMsg = `完了にしました ✓（次回 ${formatDateLabel(nextDue)} のタスクを自動作成しました）`;
      } else if(!check.checked){
        t.spawnedNext = false;
      }
      saveState();
      refreshCurrentView();
      showToast(repeatMsg || (check.checked ? "完了にしました ✓" : "未完了に戻しました"));
    });

    const main = document.createElement("div");
    main.className = "task-main";
    main.innerHTML = `<div class="task-title"></div><div class="task-meta"></div>`;
    main.querySelector(".task-title").textContent = t.title;
    const meta = main.querySelector(".task-meta");

    const chip = document.createElement("span");
    chip.className = "tag-chip";
    chip.style.background = tag.color;
    chip.textContent = tag.label;
    meta.appendChild(chip);

    if(t.dueDate){
      const due = document.createElement("span");
      due.className = "due-chip" + (t.dueDate < todayStr() && t.status!=="done" ? " is-overdue" : "");
      due.textContent = "📅 " + formatDateLabel(t.dueDate);
      meta.appendChild(due);
    }
    if(t.reminderAt){
      const r = document.createElement("span");
      r.className = "reminder-chip";
      r.textContent = "🔔 " + formatDateTimeLabel(t.reminderAt);
      meta.appendChild(r);
    }
    if(t.repeatEveryDays){
      const rep = document.createElement("span");
      rep.className = "due-chip";
      rep.textContent = t.repeatEveryDays===1 ? "🔁 毎日" : t.repeatEveryDays===7 ? "🔁 毎週" : `🔁 ${t.repeatEveryDays}日ごと`;
      meta.appendChild(rep);
    }

    main.addEventListener("click", ()=> openTaskModal(t));

    const del = document.createElement("button");
    del.className = "task-del";
    del.textContent = "🗑";
    del.addEventListener("click", (e)=>{
      e.stopPropagation();
      if(confirm("このタスクを削除しますか？")){
        state.tasks = state.tasks.filter(x=>x.id!==t.id);
        saveState();
        refreshCurrentView();
        showToast("削除しました");
      }
    });

    li.appendChild(check);
    li.appendChild(main);
    li.appendChild(del);
    return li;
  }

  /* ================= INBOX VIEW ================= */
  function renderInbox(){
    const list = $("#inboxList");
    list.innerHTML = "";
    const items = [...state.inbox].sort((a,b)=> b.createdAt.localeCompare(a.createdAt));
    items.forEach(note=>{
      const li = document.createElement("li");
      li.className = "inbox-item";
      const txt = document.createElement("div");
      txt.className = "txt";
      const p = document.createElement("span");
      p.textContent = note.text;
      const time = document.createElement("span");
      time.className = "time";
      time.textContent = formatDateTimeLabel(note.createdAt);
      txt.appendChild(p);
      txt.appendChild(time);

      const actions = document.createElement("div");
      actions.className = "inbox-actions";
      const toTaskBtn = document.createElement("button");
      toTaskBtn.className = "primary";
      toTaskBtn.textContent = "→ タスク化";
      toTaskBtn.addEventListener("click", ()=>{
        openTaskModal(null, { title: note.text, fromInboxId: note.id });
      });
      const delBtn = document.createElement("button");
      delBtn.textContent = "削除";
      delBtn.addEventListener("click", ()=>{
        state.inbox = state.inbox.filter(x=>x.id!==note.id);
        saveState();
        renderInbox();
      });
      actions.appendChild(toTaskBtn);
      actions.appendChild(delBtn);

      li.appendChild(txt);
      li.appendChild(actions);
      list.appendChild(li);
    });
    $("#inboxEmptyHint").hidden = items.length>0;
    renderBadges();
  }

  $("#inboxForm").addEventListener("submit", (e)=>{
    e.preventDefault();
    const input = $("#inboxInput");
    const text = input.value.trim();
    if(!text) return;
    state.inbox.push({ id: uid(), text, createdAt: new Date().toISOString() });
    input.value = "";
    saveState();
    renderInbox();
    showToast("メモを追加しました");
  });
  $("#inboxInput").addEventListener("keydown", (e)=>{
    if(e.key === "Enter" && !e.shiftKey){
      e.preventDefault();
      $("#inboxForm").requestSubmit();
    }
  });

  /* ================= ALL TASKS VIEW ================= */
  function renderFilterRow(){
    const row = $("#filterRow");
    row.innerHTML = "";
    const chips = [{id:"all", label:"すべて"}].concat(TAG_ORDER.map(id=>({id, label: TAGS[id].label})));
    chips.forEach(c=>{
      const btn = document.createElement("button");
      btn.className = "filter-chip" + (currentFilter===c.id ? " is-active" : "");
      btn.textContent = c.label;
      btn.addEventListener("click", ()=>{ currentFilter = c.id; renderTasks(); });
      row.appendChild(btn);
    });
  }

  function renderTasks(){
    renderFilterRow();
    const showDone = $("#showDoneToggle").checked;
    const container = $("#tasksByTag");
    container.innerHTML = "";

    const tagsToShow = currentFilter === "all" ? TAG_ORDER : [currentFilter];
    let totalShown = 0;

    tagsToShow.forEach(tagId=>{
      const tag = TAGS[tagId];
      let list = state.tasks.filter(t=> t.tag === tagId && (showDone || t.status!=="done"));
      list = list.sort((a,b)=>{
        if(a.status!==b.status) return a.status==="done" ? 1 : -1;
        return (a.dueDate||"9999").localeCompare(b.dueDate||"9999");
      });
      if(list.length===0) return;
      totalShown += list.length;

      const titleEl = document.createElement("div");
      titleEl.className = "tag-group-title";
      titleEl.innerHTML = `<span class="tag-dot" style="background:${tag.color}"></span> ${tag.label} (${list.length})`;
      container.appendChild(titleEl);

      const ul = document.createElement("ul");
      ul.className = "task-list";
      list.forEach(t=> ul.appendChild(taskCard(t, t.dueDate && t.dueDate<todayStr() && t.status!=="done")));
      container.appendChild(ul);
    });

    if(totalShown===0){
      const p = document.createElement("p");
      p.className = "empty-hint";
      p.textContent = "該当するタスクがありません。";
      container.appendChild(p);
    }
  }
  $("#showDoneToggle").addEventListener("change", renderTasks);

  /* ================= GANTT VIEW ================= */
  let ganttInstance = null;
  function renderGantt(){
    if(window.innerWidth < 900) return; // mobile: hidden via CSS, skip heavy render
    const container = $("#ganttContainer");
    const data = state.tasks
      .filter(t=>t.startDate && t.endDate)
      .map(t=>({
        id: t.id,
        name: t.title,
        start: t.startDate,
        end: t.endDate,
        progress: t.status==="done" ? 100 : 0
      }));
    container.innerHTML = "";
    $("#ganttEmptyHint").hidden = data.length>0;
    if(data.length===0) return;
    try{
      ganttInstance = new Gantt(container, data, {
        view_mode: "Week",
        language: "ja",
        on_click: (task)=>{
          const t = state.tasks.find(x=>x.id===task.id);
          if(t) openTaskModal(t);
        },
        on_date_change: (task, start, end)=>{
          const t = state.tasks.find(x=>x.id===task.id);
          if(t){ t.startDate = toLocalDateStr(start); t.endDate = toLocalDateStr(end); saveState(); }
        }
      });
    }catch(err){ console.error("Gantt render error", err); }
  }

  /* ================= SETTINGS VIEW ================= */
  function renderSettings(){
    const pill = $("#notifStatusPill");
    if(!("Notification" in window)){
      pill.textContent = "非対応";
    } else if(Notification.permission === "granted"){
      pill.textContent = "許可済み"; pill.classList.add("on");
    } else {
      pill.textContent = "未許可"; pill.classList.remove("on");
    }
    $("#lightModeToggle").checked = state.settings.theme === "light";
    $("#installBtn").hidden = !deferredInstallPrompt;
    updateSyncUI();
  }

  /* ---------------- Cloud sync UI & wiring ---------------- */
  let lastSyncStatus = "idle";

  function updateSyncUI(){
    const cloud = window.TaskFlowCloud;
    const user = cloud && cloud.isSignedIn() ? cloud.getUser() : null;
    $("#syncSignedOut").hidden = !!user;
    $("#syncSignedIn").hidden = !user;
    if(user){
      $("#syncUserPhoto").src = user.photoURL || "";
      $("#syncUserName").textContent = user.displayName || user.email || "ログイン中";
      const pill = $("#syncStatusPill");
      pill.classList.remove("on","syncing","error");
      if(lastSyncStatus === "syncing"){ pill.textContent = "同期中…"; pill.classList.add("syncing"); }
      else if(lastSyncStatus === "error"){ pill.textContent = "同期エラー"; pill.classList.add("error"); }
      else { pill.textContent = "同期済み ✓"; pill.classList.add("on"); }
    }
  }

  function applyRemoteState(remote){
    if(!remote) return;
    applyingRemote = true;
    state = {
      tasks: Array.isArray(remote.tasks) ? remote.tasks : [],
      inbox: Array.isArray(remote.inbox) ? remote.inbox : [],
      settings: remote.settings || state.settings
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    document.body.dataset.theme = state.settings.theme || "dark";
    renderBadges();
    refreshCurrentView();
    applyingRemote = false;
  }

  function setupCloudSync(){
    const cloud = window.TaskFlowCloud;
    if(!cloud) return;

    $("#googleSignInBtn").addEventListener("click", async ()=>{
      try{ await cloud.signIn(); }
      catch(e){ console.error(e); showToast("ログインに失敗しました"); }
    });
    $("#googleSignOutBtn").addEventListener("click", async ()=>{
      await cloud.signOut();
      showToast("ログアウトしました");
    });

    cloud.onStatusChange((status)=>{ lastSyncStatus = status; updateSyncUI(); });

    const SYNCED_DEVICE_KEY = "taskflow_cloud_synced_uid";

    cloud.onAuthChange(async (user)=>{
      updateSyncUI();
      if(!user){ hasDoneInitialSync = false; return; }
      if(hasDoneInitialSync) return;
      hasDoneInitialSync = true;
      try{
        const alreadyResolvedOnThisDevice = localStorage.getItem(SYNCED_DEVICE_KEY) === user.uid;
        const remote = await cloud.fetchOnce(user.uid);
        const localHasData = state.tasks.length>0 || state.inbox.length>0;
        const remoteHasData = remote && (remote.tasks||[]).length>0;

        if(alreadyResolvedOnThisDevice){
          // Already asked once on this device/account — don't ask again.
          // From now on this device just trusts the cloud (kept in sync via the
          // real-time listener below), so quietly pull the latest cloud state.
          if(remoteHasData) applyRemoteState(remote);
        } else if(remoteHasData && localHasData){
          const useCloud = confirm(
            "クラウドにも、この端末にもデータがあります。\n" +
            "「OK」＝クラウドのデータを使う（この端末のデータは上書きされます）\n" +
            "「キャンセル」＝この端末のデータを使う（クラウドを上書きします）"
          );
          if(useCloud){ applyRemoteState(remote); showToast("クラウドのデータを読み込みました"); }
          else { await cloud.push(state); showToast("この端末のデータをクラウドに送りました"); }
        } else if(remoteHasData){
          applyRemoteState(remote);
          showToast("クラウドのデータを読み込みました");
        } else {
          await cloud.push(state);
          showToast("クラウドにバックアップしました");
        }
        localStorage.setItem(SYNCED_DEVICE_KEY, user.uid);
      }catch(e){
        console.error("Initial sync failed", e);
        showToast("同期中にエラーが発生しました");
      }
    });

    cloud.onRemoteUpdate((data)=>{
      if(!hasDoneInitialSync) return; // ignore snapshots that fire before initial merge decision
      const incoming = JSON.stringify({tasks:data.tasks||[], inbox:data.inbox||[]});
      const currentJson = JSON.stringify({tasks:state.tasks, inbox:state.inbox});
      if(incoming === currentJson) return;
      applyRemoteState(data);
    });
  }

  function requestNotifPermission(){
    if(!("Notification" in window)){ showToast("この端末は通知に対応していません"); return; }
    Notification.requestPermission().then(()=>{ renderSettings(); showToast("通知設定を更新しました"); });
  }
  $("#notifBtn").addEventListener("click", requestNotifPermission);
  $("#settingsNotifBtn").addEventListener("click", requestNotifPermission);

  $("#lightModeToggle").addEventListener("change", (e)=>{
    state.settings.theme = e.target.checked ? "light" : "dark";
    document.body.dataset.theme = state.settings.theme;
    saveState();
  });

  $("#exportBtn").addEventListener("click", ()=>{
    const blob = new Blob([JSON.stringify(state, null, 2)], {type:"application/json"});
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `taskflow-backup-${todayStr()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  });
  $("#importFile").addEventListener("change", (e)=>{
    const file = e.target.files[0];
    if(!file) return;
    const reader = new FileReader();
    reader.onload = ()=>{
      try{
        const imported = JSON.parse(reader.result);
        if(!imported.tasks || !imported.inbox) throw new Error("invalid file");
        if(confirm("現在のデータを上書きしてインポートします。よろしいですか？")){
          state = Object.assign(defaultState(), imported);
          saveState();
          document.body.dataset.theme = state.settings.theme || "dark";
          refreshCurrentView();
          showToast("インポートしました");
        }
      }catch(err){
        alert("読み込みに失敗しました。正しいバックアップファイルか確認してください。");
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  });
  $("#clearAllBtn").addEventListener("click", ()=>{
    if(confirm("本当にすべてのタスク・メモを削除しますか？この操作は取り消せません。")){
      state = defaultState();
      saveState();
      refreshCurrentView();
      showToast("すべて削除しました");
    }
  });

  /* ================= TASK MODAL ================= */
  const overlay = $("#taskModalOverlay");
  const form = $("#taskForm");
  let editingId = null;
  let modalCategory = "work";
  let modalTag = "work_general";
  let modalRepeat = 0;
  let pendingInboxId = null;

  $$("#repeatPills .pill").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      modalRepeat = parseInt(btn.dataset.repeat, 10) || 0;
      $$("#repeatPills .pill").forEach(b=> b.classList.toggle("is-active", b===btn));
    });
  });

  function buildTagPills(){
    const wrap = $("#tagPills");
    wrap.innerHTML = "";
    TAG_ORDER.filter(id => TAGS[id].category === modalCategory).forEach(id=>{
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "pill" + (modalTag===id ? " is-active" : "");
      btn.style.borderColor = TAGS[id].color;
      if(modalTag===id){ btn.style.background = TAGS[id].color; btn.style.color = "#06070d"; }
      btn.textContent = TAGS[id].label;
      btn.addEventListener("click", ()=>{ modalTag = id; buildTagPills(); });
      wrap.appendChild(btn);
    });
  }

  $$("#categoryPills .pill").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      modalCategory = btn.dataset.category;
      modalTag = TAG_ORDER.find(id=>TAGS[id].category===modalCategory);
      $$("#categoryPills .pill").forEach(b=>b.classList.toggle("is-active", b===btn));
      buildTagPills();
    });
  });

  /* ---- Paste category/tag pills (independent state from manual form) ---- */
  let pasteCategory = "work";
  let pasteTag = "work_general";

  function buildPasteTagPills(){
    const wrap = $("#pasteTagPills");
    wrap.innerHTML = "";
    TAG_ORDER.filter(id => TAGS[id].category === pasteCategory).forEach(id=>{
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "pill" + (pasteTag===id ? " is-active" : "");
      btn.style.borderColor = TAGS[id].color;
      if(pasteTag===id){ btn.style.background = TAGS[id].color; btn.style.color = "#06070d"; }
      btn.textContent = TAGS[id].label;
      btn.addEventListener("click", ()=>{ pasteTag = id; buildPasteTagPills(); });
      wrap.appendChild(btn);
    });
  }
  $$("#pasteCategoryPills .pill").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      pasteCategory = btn.dataset.category;
      pasteTag = TAG_ORDER.find(id=>TAGS[id].category===pasteCategory);
      $$("#pasteCategoryPills .pill").forEach(b=>b.classList.toggle("is-active", b===btn));
      buildPasteTagPills();
    });
  });

  /* ---- Manual / Paste mode switch ---- */
  let modalMode = "manual";
  function setModalMode(mode){
    modalMode = mode;
    $("#taskForm").hidden = (mode !== "manual");
    $("#pasteEntrySection").hidden = (mode !== "paste");
    $$("#modeSwitch .mode-btn").forEach(b=> b.classList.toggle("is-active", b.dataset.mode===mode));
  }
  $$("#modeSwitch .mode-btn").forEach(btn=>{
    btn.addEventListener("click", ()=> setModalMode(btn.dataset.mode));
  });

  /* ================= Paste & auto-sort parser ================= */
  function normalizeText(str){
    // Full-width digits/parens -> half-width, for easier pattern matching.
    return str.replace(/[０-９]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0))
              .replace(/[（]/g, "(").replace(/[）]/g, ")")
              .replace(/[：]/g, ":").replace(/　/g, " ");
  }

  const SEPARATOR_RE = /^[=\-_/#*・.]{4,}$/;
  const BULLET_RE = /^[・\-\*•‣◦]\s*/;
  const NUMBERED_RE = /^\d{1,2}[.\)]\s+/;
  const DATE_HEAD_RE = /^(\d{1,2})月(\d{1,2})日\s*(?:\([月火水木金土日]\))?\s*:?\s*/;
  const SLASH_DATE_RE = /^(\d{1,2})\/(\d{1,2})\s*:?\s*/;
  const CATEGORY_ONLY_RE = /^(?:[<＜]([^>＞]{1,24})[>＞]|【([^】]{1,24})】|={2,}\s*(.+?)\s*={2,})$/;
  const SKIP_LINES = new Set(["こんにちは","こんにちは。","以上","以上。","よろしくお願いします","よろしくお願いします。","よろしくお願いいたします","よろしくお願いいたします。","hello","hello,","thank you","thanks"]);

  function inferYear(month, day){
    const today = new Date();
    let year = today.getFullYear();
    const candidate = new Date(year, month-1, day);
    const diffDays = (candidate - today) / 86400000;
    if(diffDays < -30) year += 1; // clearly in the past -> assume next year
    return year;
  }

  function parseTasksFromText(rawText, categoryLabelDefault){
    const lines = rawText.split(/\r?\n/);
    const results = [];
    let currentDate = null;
    let currentCategory = null;

    for(let raw of lines){
      let line = raw.trim();
      if(!line) continue;
      if(SEPARATOR_RE.test(line)) continue;
      if(SKIP_LINES.has(line.toLowerCase())) continue;

      const norm = normalizeText(line);

      const catMatch = norm.match(CATEGORY_ONLY_RE);
      if(catMatch){
        currentCategory = (catMatch[1] || catMatch[2] || catMatch[3] || "").trim();
        continue;
      }

      let m = norm.match(DATE_HEAD_RE);
      let month, day, remainderStart = 0;
      if(m){ month = parseInt(m[1],10); day = parseInt(m[2],10); remainderStart = m[0].length; }
      else {
        m = norm.match(SLASH_DATE_RE);
        if(m){ month = parseInt(m[1],10); day = parseInt(m[2],10); remainderStart = m[0].length; }
      }

      if(m){
        const year = inferYear(month, day);
        const mm = String(month).padStart(2,"0"), dd = String(day).padStart(2,"0");
        currentDate = `${year}-${mm}-${dd}`;
        const remainder = line.slice(remainderStart).trim();
        if(remainder.length === 0) continue; // pure date header line
        line = remainder; // fall through: treat remainder as a task line below
      }

      if(SKIP_LINES.has(line.toLowerCase())) continue;

      let title = line.replace(BULLET_RE, "").replace(NUMBERED_RE, "").trim();
      if(!title) continue;

      const cat = currentCategory || categoryLabelDefault;
      if(cat && !/^[【<＜]/.test(title)){
        title = `【${cat}】${title}`;
      }

      results.push({ title, dueDate: currentDate });
      if(results.length >= 100) break;
    }
    return results;
  }

  /* ---- Paste UI wiring ---- */
  $("#parseBtn").addEventListener("click", ()=>{
    const text = $("#pasteInput").value;
    if(!text.trim()){ showToast("テキストを貼り付けてください"); return; }
    const parsed = parseTasksFromText(text, null);
    renderPreviewList(parsed);
  });

  function renderPreviewList(items){
    const list = $("#previewList");
    list.innerHTML = "";
    items.forEach(item=>{
      const li = document.createElement("li");
      li.className = "preview-item";
      const check = document.createElement("input");
      check.type = "checkbox";
      check.className = "task-check";
      check.checked = true;
      const fields = document.createElement("div");
      fields.className = "preview-fields";
      const titleInput = document.createElement("input");
      titleInput.type = "text";
      titleInput.className = "text-input preview-title";
      titleInput.value = item.title;
      const dateInput = document.createElement("input");
      dateInput.type = "date";
      dateInput.className = "text-input preview-date";
      dateInput.value = item.dueDate || "";
      fields.appendChild(titleInput);
      fields.appendChild(dateInput);
      li.appendChild(check);
      li.appendChild(fields);
      list.appendChild(li);
    });
    $("#pasteResultCount").textContent = items.length + "件";
    $("#pasteResults").hidden = items.length === 0;
    if(items.length === 0) showToast("タスクらしい行が見つかりませんでした");
  }

  $("#cancelPasteBtn").addEventListener("click", ()=>{
    $("#pasteResults").hidden = true;
  });

  $("#confirmPasteBtn").addEventListener("click", ()=>{
    const rows = $$("#previewList .preview-item");
    let added = 0;
    rows.forEach(row=>{
      const checked = row.querySelector(".task-check").checked;
      if(!checked) return;
      const title = row.querySelector(".preview-title").value.trim();
      const dueDate = row.querySelector(".preview-date").value || null;
      if(!title) return;
      state.tasks.push({
        id: uid(), title, tag: pasteTag, status: "todo",
        notes: "貼り付けから自動登録",
        dueDate, reminderAt: null, startDate: null, endDate: null,
        createdAt: new Date().toISOString(), completedAt: null, notified: false
      });
      added++;
    });
    if(added === 0){ showToast("追加するタスクを選択してください"); return; }
    saveState();
    closeTaskModal();
    refreshCurrentView();
    showToast(`${added}件のタスクを追加しました ✓`);
  });

  function openTaskModal(task, prefill){
    editingId = task ? task.id : null;
    pendingInboxId = (prefill && prefill.fromInboxId) || null;
    $("#modalTitle").textContent = task ? "タスクを編集" : "新規タスク";
    $("#taskId").value = task ? task.id : "";
    $("#taskTitle").value = task ? task.title : (prefill && prefill.title) || "";
    $("#taskNotes").value = task ? (task.notes||"") : "";
    $("#taskDue").value = task ? (task.dueDate||"") : "";
    $("#taskReminder").value = task ? (task.reminderAt||"") : "";
    $("#taskStart").value = task ? (task.startDate||"") : "";
    $("#taskEnd").value = task ? (task.endDate||"") : "";
    $("#deleteTaskBtn").hidden = !task;

    modalRepeat = task ? (task.repeatEveryDays || 0) : 0;
    $$("#repeatPills .pill").forEach(b=> b.classList.toggle("is-active", parseInt(b.dataset.repeat,10)===modalRepeat));

    modalCategory = task ? TAGS[task.tag].category : "work";
    modalTag = task ? task.tag : "work_general";
    $$("#categoryPills .pill").forEach(b=>b.classList.toggle("is-active", b.dataset.category===modalCategory));
    buildTagPills();

    $("#modeSwitch").hidden = !!task; // paste mode only makes sense for brand-new tasks
    setModalMode("manual");
    $("#pasteInput").value = "";
    $("#pasteResults").hidden = true;
    pasteCategory = "work"; pasteTag = "work_general";
    $$("#pasteCategoryPills .pill").forEach(b=>b.classList.toggle("is-active", b.dataset.category==="work"));
    buildPasteTagPills();

    overlay.hidden = false;
    setTimeout(()=> $("#taskTitle").focus(), 50);
  }
  function closeTaskModal(){
    overlay.hidden = true;
    form.reset();
    editingId = null; pendingInboxId = null;
  }
  $("#modalCloseBtn").addEventListener("click", closeTaskModal);
  $("#cancelTaskBtn").addEventListener("click", closeTaskModal);
  overlay.addEventListener("click", (e)=>{ if(e.target===overlay) closeTaskModal(); });

  form.addEventListener("submit", (e)=>{
    e.preventDefault();
    const title = $("#taskTitle").value.trim();
    if(!title) return;
    if(editingId){
      const t = state.tasks.find(x=>x.id===editingId);
      Object.assign(t, {
        title, tag: modalTag,
        notes: $("#taskNotes").value,
        dueDate: $("#taskDue").value || null,
        reminderAt: $("#taskReminder").value || null,
        startDate: $("#taskStart").value || null,
        endDate: $("#taskEnd").value || null,
        repeatEveryDays: modalRepeat || null,
        notified: false
      });
    } else {
      state.tasks.push({
        id: uid(), title, tag: modalTag, status: "todo",
        notes: $("#taskNotes").value,
        dueDate: $("#taskDue").value || null,
        reminderAt: $("#taskReminder").value || null,
        startDate: $("#taskStart").value || null,
        endDate: $("#taskEnd").value || null,
        repeatEveryDays: modalRepeat || null,
        spawnedNext: false,
        createdAt: new Date().toISOString(),
        completedAt: null,
        notified: false
      });
      if(pendingInboxId){
        state.inbox = state.inbox.filter(n=>n.id!==pendingInboxId);
      }
    }
    saveState();
    closeTaskModal();
    refreshCurrentView();
    showToast("保存しました ✓");
  });

  $("#deleteTaskBtn").addEventListener("click", ()=>{
    if(!editingId) return;
    if(confirm("このタスクを削除しますか？")){
      state.tasks = state.tasks.filter(x=>x.id!==editingId);
      saveState();
      closeTaskModal();
      refreshCurrentView();
      showToast("削除しました");
    }
  });

  $("#gcalBtn").addEventListener("click", ()=>{
    const title = $("#taskTitle").value.trim() || "無題のタスク";
    const notes = $("#taskNotes").value || "";
    const reminder = $("#taskReminder").value;
    const due = $("#taskDue").value;
    let datesParam;
    if(reminder){
      const start = reminder.replace(/[-:]/g,"");
      const startDate = new Date(reminder);
      const end = new Date(startDate.getTime() + 30*60000);
      const endStr = toGCalUTC(end);
      datesParam = `${toGCalUTC(startDate)}/${endStr}`;
    } else if(due){
      datesParam = `${due.replace(/-/g,"")}/${addDays(due,1).replace(/-/g,"")}`;
    } else {
      const t = todayStr();
      datesParam = `${t.replace(/-/g,"")}/${addDays(t,1).replace(/-/g,"")}`;
    }
    const url = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(title)}&dates=${datesParam}&details=${encodeURIComponent(notes)}`;
    window.open(url, "_blank");
  });
  function toGCalUTC(date){
    const pad = n => String(n).padStart(2,"0");
    return `${date.getUTCFullYear()}${pad(date.getUTCMonth()+1)}${pad(date.getUTCDate())}T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}00Z`;
  }

  /* ---------------- Toast ---------------- */
  let toastTimer = null;
  function showToast(msg){
    const el = $("#toast");
    el.textContent = msg;
    el.hidden = false;
    requestAnimationFrame(()=> el.classList.add("show"));
    clearTimeout(toastTimer);
    toastTimer = setTimeout(()=>{
      el.classList.remove("show");
      setTimeout(()=> el.hidden = true, 200);
    }, 2200);
  }

  /* ---------------- Reminder checker ---------------- */
  function checkReminders(){
    const now = new Date();
    let changed = false;
    state.tasks.forEach(t=>{
      if(t.status!=="done" && t.reminderAt && !t.notified && new Date(t.reminderAt) <= now){
        t.notified = true;
        changed = true;
        if("Notification" in window && Notification.permission === "granted"){
          try{ new Notification("⏰ " + t.title, { body: t.notes || "リマインダーの時間です", tag: t.id }); }catch(e){}
        } else {
          showToast("⏰ リマインダー: " + t.title);
        }
      }
    });
    if(changed) saveState();
  }
  setInterval(checkReminders, 30000);

  /* ---------------- Refresh helper ---------------- */
  function refreshCurrentView(){ switchView(currentView); }

  /* ---------------- PWA install ---------------- */
  window.addEventListener("beforeinstallprompt", (e)=>{
    e.preventDefault();
    deferredInstallPrompt = e;
    if(currentView==="settings") renderSettings();
  });
  $("#installBtn").addEventListener("click", async ()=>{
    if(!deferredInstallPrompt) return;
    deferredInstallPrompt.prompt();
    await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
    renderSettings();
  });

  if("serviceWorker" in navigator){
    window.addEventListener("load", ()=>{
      navigator.serviceWorker.register("sw.js").catch(()=>{});
    });
  }

  /* ---------------- Init ---------------- */
  document.body.dataset.theme = state.settings.theme || "dark";
  buildTagPills();
  checkReminders();
  setupCloudSync();
  switchView("today");

  window.addEventListener("resize", ()=>{
    if(currentView==="gantt") renderGantt();
  });
})();
