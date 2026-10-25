const HISTORY_URL = `history.csv?cache=${Date.now()}`;
let allRows = [];

function parseCSV(text) {
  // CSV parser supports quoted cells, commas, and escaped double quotes.
  const records = [];
  let row = [], cell = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && cell.length === 0) quoted = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n") {
      row.push(cell.replace(/\r$/, ""));
      if (row.some(value => value !== "")) records.push(row);
      row = []; cell = "";
    } else cell += ch;
  }
  if (cell.length || row.length) {
    row.push(cell.replace(/\r$/, ""));
    if (row.some(value => value !== "")) records.push(row);
  }
  if (!records.length) return [];
  const headers = records.shift().map(h => h.trim());
  return records.map(values => Object.fromEntries(
    headers.map((header, i) => [header, values[i] ?? ""])
  ));
}

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[char]));
}

function hostLabel(url) {
  try { return new URL(url).hostname; } catch { return url; }
}

function formatTime(value) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString(undefined, {
    year: "numeric", month: "short", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    timeZone: "UTC", hour12: false
  }) + " UTC";
}

function latestByURL(rows) {
  const latest = new Map();
  for (const row of rows) {
    const previous = latest.get(row.url);
    if (!previous || new Date(row.timestamp_utc) >= new Date(previous.timestamp_utc)) {
      latest.set(row.url, row);
    }
  }
  return [...latest.values()];
}

function renderSummary(rows, latest) {
  const up = latest.filter(row => row.result === "UP").length;
  const down = latest.filter(row => row.result === "DOWN").length;
  const total = rows.length;
  const successful = rows.filter(row => row.result === "UP").length;
  document.querySelector("#url-count").textContent = String(latest.length);
  document.querySelector("#up-count").textContent = String(up);
  document.querySelector("#down-count").textContent = String(down);
  document.querySelector("#uptime").textContent = total ? `${(successful / total * 100).toFixed(2)}%` : "—";
}

function renderStatusCards(latest) {
  const container = document.querySelector("#status-cards");
  if (!latest.length) {
    container.innerHTML = '<p class="empty">No checks recorded yet. Run the GitHub Actions workflow.</p>';
    return;
  }
  container.innerHTML = latest.map(row => `
    <article class="url-card">
      <div class="url-card-top">
        <span class="dot ${row.result === "UP" ? "dot-up" : "dot-down"}"></span>
        <span class="pill ${row.result === "UP" ? "pill-up" : "pill-down"}">${escapeHTML(row.result || "UNKNOWN")}</span>
      </div>
      <h3>${escapeHTML(hostLabel(row.url))}</h3>
      <p class="url-full">${escapeHTML(row.url)}</p>
      <div class="metrics">
        <div><span>HTTP status</span><strong>${escapeHTML(row.status_code || "N/A")}</strong></div>
        <div><span>Response time</span><strong>${row.response_time_ms ? `${escapeHTML(row.response_time_ms)} ms` : "—"}</strong></div>
      </div>
      <p class="last-check">Last check: ${escapeHTML(formatTime(row.timestamp_utc))}</p>
      ${row.error ? `<p class="card-error">${escapeHTML(row.error)}</p>` : ""}
    </article>
  `).join("");
}

function renderHistory() {
  const filter = document.querySelector("#result-filter").value;
  const filtered = [...allRows].reverse().filter(row => filter === "ALL" || row.result === filter);
  const body = document.querySelector("#history-body");
  document.querySelector("#row-count").textContent = `${filtered.length} record${filtered.length === 1 ? "" : "s"}`;

  if (!filtered.length) {
    body.innerHTML = '<tr><td colspan="6" class="empty">No matching history records.</td></tr>';
    return;
  }

  // Limit rendering to the latest 500 records to keep the static dashboard responsive.
  body.innerHTML = filtered.slice(0, 500).map(row => `
    <tr>
      <td class="nowrap">${escapeHTML(formatTime(row.timestamp_utc))}</td>
      <td class="url-cell" title="${escapeHTML(row.url)}">${escapeHTML(row.url)}</td>
      <td>${escapeHTML(row.status_code || "N/A")}</td>
      <td>${row.response_time_ms ? `${escapeHTML(row.response_time_ms)} ms` : "—"}</td>
      <td><span class="pill ${row.result === "UP" ? "pill-up" : "pill-down"}">${escapeHTML(row.result || "UNKNOWN")}</span></td>
      <td class="error-cell">${escapeHTML(row.error || "—")}</td>
    </tr>
  `).join("");
}

async function loadHistory() {
  const errorEl = document.querySelector("#error-message");
  const refreshButton = document.querySelector("#refresh-button");
  refreshButton.disabled = true;
  errorEl.textContent = "";
  try {
    const response = await fetch(HISTORY_URL, { cache: "no-store" });
    if (!response.ok) throw new Error(`Could not load history.csv (HTTP ${response.status}).`);
    allRows = parseCSV(await response.text()).filter(row => row.url && row.timestamp_utc);
    const latest = latestByURL(allRows);
    renderSummary(allRows, latest);
    renderStatusCards(latest);
    renderHistory();
    const mostRecent = allRows.reduce((max, row) =>
      !max || new Date(row.timestamp_utc) > new Date(max) ? row.timestamp_utc : max, "");
    document.querySelector("#updated-at").textContent = mostRecent
      ? `Latest check: ${formatTime(mostRecent)}` : "No checks yet";
  } catch (error) {
    errorEl.textContent = `${error.message} Ensure history.csv exists and GitHub Pages is enabled.`;
    document.querySelector("#status-cards").innerHTML = '<p class="empty">Monitoring data is unavailable.</p>';
  } finally {
    refreshButton.disabled = false;
  }
}

document.querySelector("#refresh-button").addEventListener("click", loadHistory);
document.querySelector("#result-filter").addEventListener("change", renderHistory);
loadHistory();
// Refresh the dashboard data every minute while the page is open.
setInterval(loadHistory, 60_000);
