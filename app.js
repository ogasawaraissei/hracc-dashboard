const state = {
  manifest: [],
  dailySummaries: [],
  fileCache: new Map(),
  currentPage: "personalPage"
};

const MAX_POINTS = 5000;
const SCATTER_ACC_THRESHOLD = 1.1;
const DEFAULT_HR_MAX = 200;

document.addEventListener("DOMContentLoaded", async () => {
  try {
    await initialize();
  } catch (error) {
    console.error(error);
    alert("初期化に失敗しました: " + error.message);
  }
});

async function initialize() {
  const [manifest, dailySummaries] = await Promise.all([
    loadJson("manifest.json"),
    loadJson("daily_summaries.json")
  ]);

  state.manifest = manifest;
  state.dailySummaries = dailySummaries;

  setupNavigation();
  setupSelectors();
  setupButtons();

  populatePersonalSelectors();
  populateHistorySelectors();
  populateTeamSelectors();
  populateCompareSelectors();

  await renderCurrentPage();
}

async function loadJson(path) {
  const res = await fetch(path);
  if (!res.ok) {
    throw new Error(`${path} を読み込めません`);
  }
  return await res.json();
}

async function loadCsvRows(path) {
  if (state.fileCache.has(path)) {
    return state.fileCache.get(path);
  }

  const promise = (async () => {
    const res = await fetch(path);
    if (!res.ok) {
      throw new Error(`CSV を読み込めません: ${path}`);
    }
    const text = await res.text();
    return parseCSV(text)
      .map(normalizeRow)
      .filter(r =>
        Number.isFinite(r.t) &&
        Number.isFinite(r.acc_mag) &&
        Number.isFinite(r.heart_rate)
      );
  })();

  state.fileCache.set(path, promise);
  return promise;
}

function setupNavigation() {
  document.querySelectorAll(".nav-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      const pageId = btn.dataset.page;
      if (!pageId) return;

      state.currentPage = pageId;

      document.querySelectorAll(".nav-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");

      document.querySelectorAll(".page-section").forEach(section => {
        section.classList.remove("active");
      });

      document.getElementById(pageId)?.classList.add("active");
      await renderCurrentPage();
    });
  });
}

function setupSelectors() {
  document.getElementById("personalPlayerSelect").addEventListener("change", async () => {
    populatePersonalDateSelect();
    populatePersonalSessionSelect();
    await renderPersonalPage();
  });

  document.getElementById("personalDateSelect").addEventListener("change", async () => {
    populatePersonalSessionSelect();
    await renderPersonalPage();
  });

  document.getElementById("personalSessionSelect").addEventListener("change", renderPersonalPage);

  document.getElementById("personalHrMaxInput").addEventListener("change", renderPersonalPage);
  document.getElementById("personalHrMaxInput").addEventListener("keyup", async (e) => {
    if (e.key === "Enter") {
      await renderPersonalPage();
    }
  });

  document.getElementById("historyPlayerSelect").addEventListener("change", renderHistoryPage);
  document.getElementById("teamDateSelect").addEventListener("change", renderTeamSummaryPage);
  document.getElementById("compareDateSelect").addEventListener("change", renderComparePage);
}

function setupButtons() {
  document.getElementById("personalReloadBtn").addEventListener("click", renderPersonalPage);
  document.getElementById("historyReloadBtn").addEventListener("click", renderHistoryPage);
  document.getElementById("teamReloadBtn").addEventListener("click", renderTeamSummaryPage);
  document.getElementById("compareReloadBtn").addEventListener("click", renderComparePage);
}

function uniqueSorted(values) {
  return [...new Set(values)].sort();
}

function getPlayers() {
  return uniqueSorted(state.manifest.map(item => item.player_id));
}

function getDates() {
  return uniqueSorted(state.manifest.map(item => item.date));
}

function populateOptions(selectEl, values, formatter = v => v) {
  selectEl.innerHTML = values
    .map(v => `<option value="${escapeHtml(String(v))}">${escapeHtml(String(formatter(v)))}</option>`)
    .join("");
}

function populatePersonalSelectors() {
  populateOptions(document.getElementById("personalPlayerSelect"), getPlayers());
  populatePersonalDateSelect();
  populatePersonalSessionSelect();
}

function populatePersonalDateSelect() {
  const playerId = document.getElementById("personalPlayerSelect").value;
  const dates = uniqueSorted(
    state.manifest.filter(item => item.player_id === playerId).map(item => item.date)
  );
  populateOptions(document.getElementById("personalDateSelect"), dates);
}

function populatePersonalSessionSelect() {
  const playerId = document.getElementById("personalPlayerSelect").value;
  const date = document.getElementById("personalDateSelect").value;
  const sessions = state.manifest
    .filter(item => item.player_id === playerId && item.date === date)
    .sort((a, b) => `${a.start_time}${a.end_time}`.localeCompare(`${b.start_time}${b.end_time}`));

  const select = document.getElementById("personalSessionSelect");
  select.innerHTML = sessions
    .map((item, idx) => {
      const label = `${item.start_time || "----"}-${item.end_time || "----"}`;
      return `<option value="${idx}">${escapeHtml(label)}</option>`;
    })
    .join("");
}

function populateHistorySelectors() {
  populateOptions(document.getElementById("historyPlayerSelect"), getPlayers());
}

function populateTeamSelectors() {
  populateOptions(document.getElementById("teamDateSelect"), getDates());
}

function populateCompareSelectors() {
  populateOptions(document.getElementById("compareDateSelect"), getDates());
}

async function renderCurrentPage() {
  if (state.currentPage === "personalPage") {
    await renderPersonalPage();
  } else if (state.currentPage === "historyPage") {
    await renderHistoryPage();
  } else if (state.currentPage === "teamSummaryPage") {
    await renderTeamSummaryPage();
  } else if (state.currentPage === "comparePage") {
    await renderComparePage();
  }
}

function parseCSV(text) {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];

  const headers = lines[0].split(",").map(h => h.trim());

  return lines.slice(1).map(line => {
    const values = line.split(",");
    const row = {};
    headers.forEach((header, i) => {
      row[header] = (values[i] ?? "").trim();
    });
    return row;
  });
}

function normalizeRow(row) {
  return {
    timestamp: row.timestamp,
    t: toMillis(row.timestamp),
    acc_mag: Number(row.acc_mag),
    heart_rate: Number(row.heart_rate)
  };
}

function toMillis(timestamp) {
  const t = new Date(timestamp).getTime();
  return Number.isFinite(t) ? t : NaN;
}

function escapeHtml(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function basicStats(values) {
  let count = 0;
  let sum = 0;
  let min = Infinity;
  let max = -Infinity;

  for (const v of values) {
    if (!Number.isFinite(v)) continue;
    count += 1;
    sum += v;
    if (v < min) min = v;
    if (v > max) max = v;
  }

  if (count === 0) {
    return { mean: NaN, min: NaN, max: NaN };
  }

  return {
    mean: sum / count,
    min,
    max
  };
}

function correlation(x, y) {
  let n = 0;
  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumXX = 0;
  let sumYY = 0;

  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    const a = x[i];
    const b = y[i];
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue;

    n += 1;
    sumX += a;
    sumY += b;
    sumXY += a * b;
    sumXX += a * a;
    sumYY += b * b;
  }

  if (n < 2) return NaN;

  const numerator = n * sumXY - sumX * sumY;
  const denominator = Math.sqrt((n * sumXX - sumX * sumX) * (n * sumYY - sumY * sumY));

  if (!Number.isFinite(denominator) || denominator === 0) return NaN;
  return numerator / denominator;
}

function downsampleRows(rows, maxPoints = MAX_POINTS) {
  if (rows.length <= maxPoints) return rows;

  const step = Math.ceil(rows.length / maxPoints);
  const sampled = [];
  for (let i = 0; i < rows.length; i += step) {
    sampled.push(rows[i]);
  }
  return sampled;
}

function getScatterRows(rows) {
  return rows.filter(r =>
    Number.isFinite(r.acc_mag) &&
    Number.isFinite(r.heart_rate) &&
    r.acc_mag > SCATTER_ACC_THRESHOLD
  );
}

function getHrMaxValue() {
  const raw = Number(document.getElementById("personalHrMaxInput").value);
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_HR_MAX;
  return raw;
}

function computeZoneDistribution(rows, hrMax) {
  const valid = rows.filter(r => Number.isFinite(r.heart_rate));
  const total = valid.length;

  const labels = ["49%以下", "50-59%", "60-69%", "70-79%", "80-89%", "90%以上"];
  const counts = [0, 0, 0, 0, 0, 0];

  for (const row of valid) {
    const pct = (row.heart_rate / hrMax) * 100;
    if (pct <= 49) {
      counts[0] += 1;
    } else if (pct < 60) {
      counts[1] += 1;
    } else if (pct < 70) {
      counts[2] += 1;
    } else if (pct < 80) {
      counts[3] += 1;
    } else if (pct < 90) {
      counts[4] += 1;
    } else {
      counts[5] += 1;
    }
  }

  const ratios = counts.map(c => total > 0 ? (c / total) * 100 : 0);
  return { labels, counts, ratios, total };
}

function clearPlot(id) {
  const el = document.getElementById(id);
  if (!el) return;
  try {
    Plotly.purge(id);
  } catch (e) {
  }
  el.innerHTML = "";
}

function renderCards(containerId, cards) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = cards.map(card => `
    <div class="summary-card">
      <div class="label">${escapeHtml(card.label)}</div>
      <div class="value">${escapeHtml(card.value)}</div>
    </div>
  `).join("");
}

function getSelectedPersonalMeta() {
  const playerId = document.getElementById("personalPlayerSelect").value;
  const date = document.getElementById("personalDateSelect").value;
  const sessionIndex = Number(document.getElementById("personalSessionSelect").value || 0);

  const sessions = state.manifest
    .filter(item => item.player_id === playerId && item.date === date)
    .sort((a, b) => `${a.start_time}${a.end_time}`.localeCompare(`${b.start_time}${b.end_time}`));

  return sessions[sessionIndex] || null;
}

async function renderPersonalPage() {
  const meta = getSelectedPersonalMeta();
  renderCards("personalSummaryCards", []);
  document.getElementById("personalMetaInfo").innerHTML = "";
  clearPlot("personalTimeSeriesChart");
  clearPlot("personalScatterChart");
  clearPlot("personalHrZoneBarChart");
  clearPlot("personalHrZonePieChart");

  if (!meta) return;

  const rows = await loadCsvRows(meta.file);
  const hrMax = getHrMaxValue();
  const accStats = basicStats(rows.map(r => r.acc_mag));
  const hrStats = basicStats(rows.map(r => r.heart_rate));
  const scatterRows = getScatterRows(rows);
  const corr = correlation(
    scatterRows.map(r => r.acc_mag),
    scatterRows.map(r => r.heart_rate)
  );

  renderCards("personalSummaryCards", [
    { label: "選手ID", value: meta.player_id || "-" },
    { label: "日付", value: meta.date || "-" },
    { label: "データ点数", value: String(rows.length) },
    { label: "平均加速度", value: Number.isFinite(accStats.mean) ? accStats.mean.toFixed(2) : "-" },
    { label: "最大加速度", value: Number.isFinite(accStats.max) ? accStats.max.toFixed(2) : "-" },
    { label: "平均心拍", value: Number.isFinite(hrStats.mean) ? `${hrStats.mean.toFixed(1)} bpm` : "-" },
    { label: "最大心拍", value: Number.isFinite(hrStats.max) ? `${hrStats.max.toFixed(1)} bpm` : "-" },
    { label: "散布図対象点数", value: String(scatterRows.length) },
    { label: "相関", value: Number.isFinite(corr) ? corr.toFixed(3) : "-" }
  ]);

  const first = rows[0]?.timestamp || "-";
  const last = rows[rows.length - 1]?.timestamp || "-";
  document.getElementById("personalMetaInfo").innerHTML = `
    <div><strong>選手ID:</strong> ${escapeHtml(meta.player_id || "-")}</div>
    <div><strong>日付:</strong> ${escapeHtml(meta.date || "-")}</div>
    <div><strong>時間帯:</strong> ${escapeHtml(meta.start_time || "-")} - ${escapeHtml(meta.end_time || "-")}</div>
    <div><strong>セッション種別:</strong> ${escapeHtml(meta.session_type || "-")}</div>
    <div><strong>CSV:</strong> <code>${escapeHtml(meta.file || "-")}</code></div>
    <div><strong>先頭時刻:</strong> ${escapeHtml(first)}</div>
    <div><strong>末尾時刻:</strong> ${escapeHtml(last)}</div>
    <div><strong>心拍ゾーン基準最大値:</strong> ${escapeHtml(String(hrMax))} bpm</div>
  `;

  renderPersonalTimeSeries(rows);
  renderPersonalScatter(scatterRows);
  renderPersonalZoneCharts(rows, hrMax);
}

function renderPersonalTimeSeries(rows) {
  const sampled = downsampleRows(rows);
  Plotly.newPlot("personalTimeSeriesChart", [
    {
      x: sampled.map(r => r.timestamp),
      y: sampled.map(r => r.acc_mag),
      type: "scattergl",
      mode: "lines",
      name: "Acceleration Magnitude",
      yaxis: "y1"
    },
    {
      x: sampled.map(r => r.timestamp),
      y: sampled.map(r => r.heart_rate),
      type: "scattergl",
      mode: "lines",
      name: "Heart Rate",
      yaxis: "y2"
    }
  ], {
    margin: { t: 20 },
    xaxis: { title: "Time" },
    yaxis: { title: "Acceleration Magnitude" },
    yaxis2: {
      title: "Heart Rate (bpm)",
      overlaying: "y",
      side: "right"
    },
    legend: { orientation: "h" }
  }, { responsive: true });
}

function renderPersonalScatter(scatterRows) {
  const sampled = downsampleRows(scatterRows);
  Plotly.newPlot("personalScatterChart", [
    {
      x: sampled.map(r => r.acc_mag),
      y: sampled.map(r => r.heart_rate),
      text: sampled.map(r => r.timestamp),
      type: "scattergl",
      mode: "markers",
      name: "HR vs ACC (>1.1)"
    }
  ], {
    margin: { t: 20 },
    xaxis: { title: "Acceleration Magnitude" },
    yaxis: { title: "Heart Rate (bpm)" }
  }, { responsive: true });
}

function renderPersonalZoneCharts(rows, hrMax) {
  const zone = computeZoneDistribution(rows, hrMax);

  Plotly.newPlot("personalHrZoneBarChart", [
    {
      x: zone.ratios,
      y: zone.labels,
      type: "bar",
      orientation: "h",
      text: zone.ratios.map(v => `${v.toFixed(1)}%`),
      textposition: "auto",
      name: "滞在時間割合"
    }
  ], {
    margin: { t: 20, l: 110 },
    xaxis: { title: "割合 (%)", range: [0, 100] },
    yaxis: {
      title: "",
      categoryorder: "array",
      categoryarray: zone.labels
    }
  }, { responsive: true });

  Plotly.newPlot("personalHrZonePieChart", [
    {
      labels: zone.labels,
      values: zone.ratios,
      type: "pie",
      textinfo: "label+percent",
      sort: false
    }
  ], {
    margin: { t: 20 }
  }, { responsive: true });
}

function getDailyRowsForPlayerDate(playerId, date) {
  const matching = state.dailySummaries.find(item => item.player_id === playerId && item.date === date);
  return matching || null;
}

async function getCombinedRowsForPlayerDate(playerId, date) {
  const manifestItems = state.manifest
    .filter(item => item.player_id === playerId && item.date === date)
    .sort((a, b) => `${a.start_time}${a.end_time}`.localeCompare(`${b.start_time}${b.end_time}`));

  const rowsList = await Promise.all(manifestItems.map(item => loadCsvRows(item.file)));
  const combined = rowsList.flat().sort((a, b) => a.t - b.t);
  return combined;
}

async function renderHistoryPage() {
  clearPlot("historyHrChart");
  clearPlot("historyAccChart");
  clearPlot("historyCorrChart");
  clearPlot("historyZoneChart");

  const playerId = document.getElementById("historyPlayerSelect").value;
  const rows = state.dailySummaries
    .filter(item => item.player_id === playerId)
    .sort((a, b) => a.date.localeCompare(b.date));

  if (!rows.length) return;

  const dates = rows.map(r => r.date);

  Plotly.newPlot("historyHrChart", [
    {
      x: dates,
      y: rows.map(r => r.mean_hr),
      type: "scatter",
      mode: "lines+markers",
      name: "平均心拍"
    },
    {
      x: dates,
      y: rows.map(r => r.max_hr),
      type: "scatter",
      mode: "lines+markers",
      name: "最大心拍"
    }
  ], {
    margin: { t: 20 },
    xaxis: { title: "練習日" },
    yaxis: { title: "Heart Rate (bpm)" }
  }, { responsive: true });

  Plotly.newPlot("historyAccChart", [
    {
      x: dates,
      y: rows.map(r => r.mean_acc),
      type: "scatter",
      mode: "lines+markers",
      name: "平均加速度"
    }
  ], {
    margin: { t: 20 },
    xaxis: { title: "練習日" },
    yaxis: { title: "Acceleration Magnitude" }
  }, { responsive: true });

  Plotly.newPlot("historyCorrChart", [
    {
      x: dates,
      y: rows.map(r => r.corr_filtered),
      type: "scatter",
      mode: "lines+markers",
      name: "相関係数"
    }
  ], {
    margin: { t: 20 },
    xaxis: { title: "練習日" },
    yaxis: { title: "相関係数", range: [-1, 1] }
  }, { responsive: true });

  const zoneKeys = [
    ["49以下", "49%以下"],
    ["50_59", "50-59%"],
    ["60_69", "60-69%"],
    ["70_79", "70-79%"],
    ["80_89", "80-89%"],
    ["90以上", "90%以上"]
  ];

  Plotly.newPlot("historyZoneChart", zoneKeys.map(([key, label]) => ({
    x: dates,
    y: rows.map(r => (r.zone_ratios_200 && Number.isFinite(r.zone_ratios_200[key])) ? r.zone_ratios_200[key] : 0),
    type: "scatter",
    mode: "lines+markers",
    name: label
  })), {
    margin: { t: 20 },
    xaxis: { title: "練習日" },
    yaxis: { title: "ゾーン時間割合 (%)", range: [0, 100] }
  }, { responsive: true });
}

function weightedMean(records, valueKey, weightKey = "n_samples") {
  let sumValue = 0;
  let sumWeight = 0;
  for (const r of records) {
    const value = Number(r[valueKey]);
    const weight = Number(r[weightKey]);
    if (!Number.isFinite(value) || !Number.isFinite(weight) || weight <= 0) continue;
    sumValue += value * weight;
    sumWeight += weight;
  }
  return sumWeight > 0 ? sumValue / sumWeight : NaN;
}

function meanIgnoringNaN(values) {
  const valid = values.filter(v => Number.isFinite(v));
  if (!valid.length) return NaN;
  return valid.reduce((a, b) => a + b, 0) / valid.length;
}

async function renderTeamSummaryPage() {
  renderCards("teamOverallSummaryCards", []);
  document.getElementById("teamPlayerGrid").innerHTML = "";

  const date = document.getElementById("teamDateSelect").value;
  const playerSummaries = state.dailySummaries
    .filter(item => item.date === date)
    .sort((a, b) => a.player_id.localeCompare(b.player_id));

  if (!playerSummaries.length) return;

  const overallMeanHr = weightedMean(playerSummaries, "mean_hr");
  const overallMeanAcc = weightedMean(playerSummaries, "mean_acc");
  const overallMaxHr = Math.max(...playerSummaries.map(r => Number(r.max_hr)).filter(Number.isFinite));
  const sessionDuration = Math.max(...playerSummaries.map(r => Number(r.duration_minutes)).filter(Number.isFinite));
  const avgCorr = meanIgnoringNaN(playerSummaries.map(r => Number(r.corr_filtered)));

  renderCards("teamOverallSummaryCards", [
    { label: "全体平均心拍数", value: Number.isFinite(overallMeanHr) ? `${overallMeanHr.toFixed(1)} bpm` : "-" },
    { label: "全体平均加速度", value: Number.isFinite(overallMeanAcc) ? overallMeanAcc.toFixed(2) : "-" },
    { label: "最大心拍数", value: Number.isFinite(overallMaxHr) ? `${overallMaxHr.toFixed(1)} bpm` : "-" },
    { label: "計測時間", value: Number.isFinite(sessionDuration) ? `${sessionDuration.toFixed(1)} 分` : "-" },
    { label: "平均相関係数", value: Number.isFinite(avgCorr) ? avgCorr.toFixed(3) : "-" }
  ]);

  const grid = document.getElementById("teamPlayerGrid");
  grid.innerHTML = playerSummaries.map((summary, idx) => `
    <div class="team-player-card" id="teamPlayerCard-${idx}">
      <h3>選手 ${escapeHtml(summary.player_id)}</h3>
      <div class="mini-metrics">
        <div class="mini-metric"><div class="label">平均心拍数</div><div class="value">${Number.isFinite(summary.mean_hr) ? Number(summary.mean_hr).toFixed(1) : "-"}</div></div>
        <div class="mini-metric"><div class="label">最大心拍数</div><div class="value">${Number.isFinite(summary.max_hr) ? Number(summary.max_hr).toFixed(1) : "-"}</div></div>
        <div class="mini-metric"><div class="label">平均加速度</div><div class="value">${Number.isFinite(summary.mean_acc) ? Number(summary.mean_acc).toFixed(2) : "-"}</div></div>
        <div class="mini-metric"><div class="label">相関係数</div><div class="value">${Number.isFinite(summary.corr_filtered) ? Number(summary.corr_filtered).toFixed(3) : "-"}</div></div>
      </div>

      <div id="teamHrHist-${idx}" class="chart-small"></div>
      <div id="teamAccHist-${idx}" class="chart-small"></div>
      <div id="teamTimeSeries-${idx}" class="chart-small"></div>
      <div id="teamScatter-${idx}" class="chart-small"></div>
    </div>
  `).join("");

  for (let i = 0; i < playerSummaries.length; i++) {
    const summary = playerSummaries[i];
    const rows = await getCombinedRowsForPlayerDate(summary.player_id, summary.date);
    renderPlayerPanelCharts(i, rows, summary);
  }
}

function renderPlayerPanelCharts(index, rows, summary) {
  const sampled = downsampleRows(rows, 3000);
  const scatterRows = downsampleRows(getScatterRows(rows), 3000);

  Plotly.newPlot(`teamHrHist-${index}`, [
    {
      x: rows.map(r => r.heart_rate),
      type: "histogram",
      name: "Heart Rate"
    }
  ], {
    margin: { t: 20 },
    title: { text: "心拍ヒストグラム", font: { size: 14 } },
    xaxis: { title: "Heart Rate (bpm)" },
    yaxis: { title: "Count" }
  }, { responsive: true });

  Plotly.newPlot(`teamAccHist-${index}`, [
    {
      x: rows.map(r => r.acc_mag),
      type: "histogram",
      name: "Acceleration"
    }
  ], {
    margin: { t: 20 },
    title: { text: "加速度ヒストグラム", font: { size: 14 } },
    xaxis: { title: "Acceleration Magnitude" },
    yaxis: { title: "Count" }
  }, { responsive: true });

  Plotly.newPlot(`teamTimeSeries-${index}`, [
    {
      x: sampled.map(r => r.timestamp),
      y: sampled.map(r => r.acc_mag),
      type: "scattergl",
      mode: "lines",
      name: "Acceleration",
      yaxis: "y1"
    },
    {
      x: sampled.map(r => r.timestamp),
      y: sampled.map(r => r.heart_rate),
      type: "scattergl",
      mode: "lines",
      name: "Heart Rate",
      yaxis: "y2"
    }
  ], {
    margin: { t: 20 },
    title: { text: "時系列", font: { size: 14 } },
    xaxis: { title: "Time" },
    yaxis: { title: "Acc" },
    yaxis2: { title: "HR", overlaying: "y", side: "right" },
    showlegend: false
  }, { responsive: true });

  Plotly.newPlot(`teamScatter-${index}`, [
    {
      x: scatterRows.map(r => r.acc_mag),
      y: scatterRows.map(r => r.heart_rate),
      text: scatterRows.map(r => r.timestamp),
      type: "scattergl",
      mode: "markers",
      name: "Scatter"
    }
  ], {
    margin: { t: 20 },
    title: { text: "加速度 vs 心拍", font: { size: 14 } },
    xaxis: { title: "Acc" },
    yaxis: { title: "HR" }
  }, { responsive: true });
}

async function renderComparePage() {
  clearPlot("compareScatterChart");
  clearPlot("compareMeanHrBarChart");
  clearPlot("compareMeanAccBarChart");

  const date = document.getElementById("compareDateSelect").value;
  const rows = state.dailySummaries
    .filter(item => item.date === date)
    .sort((a, b) => String(a.player_id).localeCompare(String(b.player_id)));

  if (!rows.length) return;

  Plotly.newPlot("compareScatterChart", [
    {
      x: rows.map(r => Number(r.mean_acc)),
      y: rows.map(r => Number(r.mean_hr)),
      text: rows.map(r => `選手 ${String(r.player_id)}`),
      mode: "markers+text",
      type: "scatter",
      textposition: "top center",
      name: "平均値"
    }
  ], {
    margin: { t: 20 },
    xaxis: { title: "平均加速度" },
    yaxis: { title: "平均心拍数 (bpm)" }
  }, { responsive: true });

  const hrSorted = [...rows]
    .map(r => ({
      ...r,
      player_id_str: String(r.player_id),
      mean_hr_num: Number(r.mean_hr)
    }))
    .sort((a, b) => b.mean_hr_num - a.mean_hr_num);

  Plotly.newPlot("compareMeanHrBarChart", [
    {
      x: hrSorted.map(r => r.mean_hr_num),
      y: hrSorted.map(r => r.player_id_str),
      type: "bar",
      orientation: "h",
      text: hrSorted.map(r => r.mean_hr_num.toFixed(1)),
      textposition: "auto",
      name: "平均心拍数"
    }
  ], {
    margin: { t: 20, l: 100 },
    xaxis: { title: "平均心拍数 (bpm)" },
    yaxis: {
      title: "選手ID",
      type: "category",
      categoryorder: "array",
      categoryarray: hrSorted.map(r => r.player_id_str),
      autorange: "reversed"
    }
  }, { responsive: true });

  const accSorted = [...rows]
    .map(r => ({
      ...r,
      player_id_str: String(r.player_id),
      mean_acc_num: Number(r.mean_acc)
    }))
    .sort((a, b) => b.mean_acc_num - a.mean_acc_num);

  Plotly.newPlot("compareMeanAccBarChart", [
    {
      x: accSorted.map(r => r.mean_acc_num),
      y: accSorted.map(r => r.player_id_str),
      type: "bar",
      orientation: "h",
      text: accSorted.map(r => r.mean_acc_num.toFixed(2)),
      textposition: "auto",
      name: "平均加速度"
    }
  ], {
    margin: { t: 20, l: 100 },
    xaxis: { title: "平均加速度" },
    yaxis: {
      title: "選手ID",
      type: "category",
      categoryorder: "array",
      categoryarray: accSorted.map(r => r.player_id_str),
      autorange: "reversed"
    }
  }, { responsive: true });
}