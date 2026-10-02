(function () {
  "use strict";

  const cfg = window.EEB_CONFIG || {};
  const $ = (id) => document.getElementById(id);
  const configured =
    window.supabase && cfg.SUPABASE_URL && !cfg.SUPABASE_URL.startsWith("YOUR_") &&
    cfg.SUPABASE_ANON_KEY && !cfg.SUPABASE_ANON_KEY.startsWith("YOUR_");
  const sb = configured ? window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY) : null;

  const S = { groups: [], topics: [], unassigned: [], dept: "ALL", q: "", printing: false };

  // ---------- helpers ----------
  function h(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function btn(cls, text, fn) {
    const b = h("button", cls, text);
    b.type = "button";
    b.addEventListener("click", fn);
    return b;
  }
  let toastTimer;
  function toast(msg, bad) {
    const t = $("toast");
    t.textContent = msg;
    t.className = bad ? "bad" : "";
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (t.hidden = true), 3500);
  }
  function ask(text, okLabel) {
    return new Promise((resolve) => {
      const d = $("dlg");
      $("dlgText").textContent = text;
      $("dlgOk").textContent = okLabel || "Confirm";
      d.returnValue = "";
      d.addEventListener("close", () => resolve(d.returnValue === "ok"), { once: true });
      d.showModal();
    });
  }
  async function copyText(text, b) {
    try { await navigator.clipboard.writeText(text); }
    catch (_) {
      const ta = document.createElement("textarea");
      ta.value = text; document.body.appendChild(ta); ta.select();
      try { document.execCommand("copy"); } catch (__) {}
      ta.remove();
    }
    const old = b.textContent;
    b.textContent = "Copied";
    setTimeout(() => (b.textContent = old), 1400);
  }
  function view(name) { $("login").hidden = name !== "login"; $("app").hidden = name !== "app"; }

  async function call(fn, args) {
    if (!sb) return { success: false, error: "CONFIG", message: "config.js is missing or not filled in." };
    try {
      const { data, error } = await sb.rpc(fn, args || {});
      if (error) {
        const auth = /jwt|token|permission denied/i.test(error.message || "");
        return { success: false, error: auth ? "AUTH" : "SERVER", message: "Something went wrong. Please try again." };
      }
      return data || { success: false, error: "SERVER", message: "Something went wrong. Please try again." };
    } catch (e) {
      return { success: false, error: "NETWORK", message: "No connection. Check your internet and try again." };
    }
  }

  // ---------- login / session ----------
  const msgL = $("msgL");
  function loginMsg(t) { msgL.textContent = t || ""; msgL.hidden = !t; }

  async function load() {
    const r = await call("admin_overview");
    if (r.success) {
      S.groups = r.groups; S.topics = r.topics; S.unassigned = r.unassigned;
      render();
      view("app");
      return true;
    }
    if (r.error === "FORBIDDEN" || r.error === "AUTH") {
      if (sb) await sb.auth.signOut();
      view("login");
      loginMsg(r.error === "FORBIDDEN" ? "This account is not an admin." : "Session expired. Please log in again.");
    } else if ($("app").hidden) {
      view("login");
      loginMsg(r.message);
    } else {
      toast(r.message, true);
    }
    return false;
  }

  $("loginForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = $("email").value.trim();
    const password = $("password").value;
    if (!email || !password) return loginMsg("Enter your email and password.");
    if (!sb) return loginMsg("config.js is missing or not filled in.");
    loginMsg("");
    const b = $("loginBtn");
    b.disabled = true; b.textContent = "Checking...";
    let err;
    try { ({ error: err } = await sb.auth.signInWithPassword({ email, password })); }
    catch (_) { err = { message: "network" }; }
    if (err) {
      loginMsg(/network|fetch/i.test(err.message) ? "No connection. Check your internet and try again." : "Email or password is incorrect.");
    } else {
      $("password").value = "";
      await load();
    }
    b.disabled = false; b.textContent = "Log in";
  });

  $("logoutBtn").addEventListener("click", async () => {
    await sb.auth.signOut();
    S.groups = []; S.unassigned = [];
    view("login");
  });
  $("refreshBtn").addEventListener("click", async () => { if (await load()) toast("Updated."); });

  // ---------- rendering ----------
  function visibleGroups() {
    if (S.printing) return S.groups;
    const q = S.q.trim().toLowerCase();
    return S.groups.filter((g) => {
      if (S.dept !== "ALL" && g.department !== S.dept) return false;
      if (!q) return true;
      const hay = [g.group_code, g.topic || ""].concat((g.members || []).map((m) => m.name + " " + m.roll_no)).join(" ").toLowerCase();
      return hay.includes(q);
    });
  }

  function renderStats() {
    const made = S.groups.filter((g) => g.team_id);
    const inGroups = made.reduce((n, g) => n + g.members.length, 0);
    const freeTopics = S.topics.filter((t) => !t.group_code).length;
    const items = [
      ["Groups created", made.length + " / " + S.groups.length],
      ["Students in groups", inGroups + " / " + (inGroups + S.unassigned.length)],
      ["Yet to join", S.unassigned.length],
      ["Topics free", freeTopics + " / " + S.topics.length]
    ];
    const box = $("stats");
    box.innerHTML = "";
    items.forEach(([label, val]) => {
      const d = h("div", "stat");
      d.append(h("b", null, String(val)), h("span", null, label));
      box.appendChild(d);
    });
  }

  function card(g) {
    const c = h("article", "card" + (g.team_id ? "" : " card--empty"));
    const head = h("div", "card__head");
    const n = (g.members || []).length;
    head.append(h("h2", null, g.group_code), h("span", "tag", g.department),
      h("span", "tag", g.team_id ? n + " / " + g.capacity + " members" : g.capacity + " seats"));
    c.appendChild(head);

    if (!g.team_id) {
      c.appendChild(h("p", "note", "Not created yet. No student has created this group."));
      return c;
    }

    const t = h("p", "topic");
    t.append(h("span", null, "Topic"), document.createTextNode(g.topic));
    c.appendChild(t);

    const jc = h("div", "codes");
    jc.appendChild(h("p", "codelabel", "Join code (share with teammates)"));
    const row = h("div", "row");
    row.append(h("output", null, g.join_code), btn("copy", "Copy", function () { copyText(g.join_code, this); }));
    jc.appendChild(row);
    c.appendChild(jc);

    const ul = h("ul", "members");
    g.members.forEach((m) => {
      const li = h("li");
      const who = h("div", "who");
      who.append(h("b", null, m.name), h("small", null, m.roll_no));
      const r = h("div", "mright");
      if (m.role === "ADMIN") r.appendChild(h("span", "tag", "Admin"));
      r.append(h("output", "codes", m.access_code), btn("x", "Remove", () => removeMember(g, m)));
      li.append(who, r);
      ul.appendChild(li);
    });
    c.appendChild(ul);

    const left = g.capacity - n;
    if (left > 0) c.appendChild(h("p", "note", left + (left === 1 ? " seat" : " seats") + " still open"));

    const acts = h("div", "acts");
    acts.appendChild(h("p", "codelabel", "Change topic (a taken topic is swapped)"));
    const line = h("div", "line");
    const sel = h("select", "field");
    sel.setAttribute("aria-label", "Topic for " + g.group_code);
    S.topics.forEach((tp) => {
      const taken = tp.group_code && tp.group_code !== g.group_code ? "  [" + tp.group_code + "]" : "";
      const o = h("option", null, tp.id + ". " + tp.title + taken);
      o.value = tp.id;
      if (tp.id === g.topic_id) o.selected = true;
      sel.appendChild(o);
    });
    line.append(sel, btn("sbtn sbtn--solid", "Apply", () => changeTopic(g, Number(sel.value))));
    acts.append(line, btn("sbtn sbtn--danger", "Delete group", () => deleteGroup(g)));
    c.appendChild(acts);
    return c;
  }

  function renderPending() {
    const q = S.q.trim().toLowerCase();
    const list = S.unassigned.filter((s) =>
      (S.dept === "ALL" || s.department === S.dept) && (!q || (s.name + " " + s.roll_no).toLowerCase().includes(q)));
    $("pendingSum").textContent = "Yet to join (" + list.length + ")";
    const box = $("pendingList");
    box.innerHTML = "";
    if (!list.length) return box.appendChild(h("p", "note", "Everyone shown has joined a group."));
    ["CSE", "MECH"].forEach((dep) => {
      const items = list.filter((s) => s.department === dep);
      if (!items.length) return;
      box.appendChild(h("h3", null, dep + " (" + items.length + ")"));
      const ul = h("ul", "chips");
      items.forEach((s) => {
        const li = h("li", null, s.name + " ");
        li.appendChild(h("small", null, s.roll_no));
        ul.appendChild(li);
      });
      box.appendChild(ul);
    });
  }

  function renderTopics() {
    const ul = $("topicList");
    ul.innerHTML = "";
    S.topics.forEach((t) => {
      const li = h("li");
      li.append(h("span", null, t.id + ". " + t.title), h("span", null, t.group_code || "Free"));
      ul.appendChild(li);
    });
  }

  function render() {
    renderStats();
    const grid = $("grid");
    grid.innerHTML = "";
    const gs = visibleGroups();
    if (!gs.length) grid.appendChild(h("p", "note", "No groups match your search."));
    gs.forEach((g) => grid.appendChild(card(g)));
    renderPending();
    renderTopics();
  }

  // ---------- controls ----------
  document.querySelectorAll(".tabs button").forEach((b) => {
    b.addEventListener("click", () => {
      S.dept = b.dataset.dept;
      document.querySelectorAll(".tabs button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      render();
    });
  });
  $("search").addEventListener("input", (e) => { S.q = e.target.value; render(); });
  $("hideCodes").addEventListener("change", (e) => document.body.classList.toggle("nocodes", e.target.checked));

  // print: always lists every group, whatever the filters are
  $("printBtn").addEventListener("click", () => window.print());
  window.addEventListener("beforeprint", () => {
    S.printing = true;
    $("printDate").textContent = "Printed on " + new Date().toLocaleString();
    render();
  });
  window.addEventListener("afterprint", () => { S.printing = false; render(); });

  // ---------- actions ----------
  async function act(fn, args) {
    const r = await call(fn, args);
    toast(r.message, !r.success);
    await load(); // always refresh so the screen matches the database
  }

  async function removeMember(g, m) {
    let text = "Remove " + m.name + " (" + m.roll_no + ") from " + g.group_code + "? They can join a group again afterwards.";
    if (g.members.length === 1) text += " They are the only member, so the group will be deleted.";
    else if (m.role === "ADMIN") text += " They are the admin, so the next member becomes admin.";
    if (await ask(text, "Remove")) act("admin_remove_member", { p_member_id: m.member_id });
  }

  async function deleteGroup(g) {
    const text = "Delete " + g.group_code + "? All " + g.members.length +
      " member(s) are removed, and the slot and topic become free. This cannot be undone.";
    if (await ask(text, "Delete group")) act("admin_delete_team", { p_team_id: g.team_id });
  }

  async function changeTopic(g, topicId) {
    if (topicId === g.topic_id) return toast("That topic is already assigned.");
    const t = S.topics.find((x) => x.id === topicId);
    const text = t.group_code
      ? "\"" + t.title + "\" belongs to " + t.group_code + ". Swap topics between " + g.group_code + " and " + t.group_code + "?"
      : "Assign \"" + t.title + "\" to " + g.group_code + "?";
    if (await ask(text, t.group_code ? "Swap" : "Assign")) act("admin_assign_topic", { p_team_id: g.team_id, p_topic_id: topicId });
  }

  // ---------- start (TEMPORARY: no login, local testing only) ----------
  (async function init() {
    if (!sb) { view("login"); return loginMsg("config.js is missing or not filled in."); }
    $("logoutBtn").hidden = true;
    await load();
  })();
})();