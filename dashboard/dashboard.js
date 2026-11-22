'use strict';

const VOC_API = String((window.VOC_CONFIG || {}).API_URL || '').replace(/\/+$/, '');
const PROTOTIPE = VOC_API === '';
const TOKEN_KEY = 'voc_token';
const ROLE_LABEL = { admin: 'Admin', kepala_cabang: 'Kepala Cabang', staf: 'Staf', staff: 'Staf' };

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function csvCell(value) {
  let s = String(value ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return `"${s.replace(/"/g, '""')}"`;
}

function todayISO() {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
}

const session = { token: null, name: '', role: '', exp: 0, timer: null };

function readStoredToken() {
  try { return sessionStorage.getItem(TOKEN_KEY); } catch { return null; }
}

function storeToken(token) {
  try {
    if (token) sessionStorage.setItem(TOKEN_KEY, token);
    else sessionStorage.removeItem(TOKEN_KEY);
  } catch {}
}

function decodeToken(token) {
  try {
    const part = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const bytes = Uint8Array.from(atob(part), (c) => c.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
}

function startSession(token) {
  const payload = decodeToken(token);
  if (!payload || !payload.exp || payload.exp * 1000 <= Date.now()) return false;
  clearTimeout(session.timer);
  session.token = token;
  session.name = String(payload.name || 'Pengguna').slice(0, 100);
  session.role = String(payload.role || '');
  session.exp = payload.exp * 1000;
  session.timer = setTimeout(
    () => endSession('Sesi login berakhir. Silakan masuk lagi.'),
    Math.min(session.exp - Date.now(), 2147483647)
  );
  storeToken(token);
  return true;
}

function startPrototypeSession() {
  clearTimeout(session.timer);
  Object.assign(session, { token: null, name: 'Mode Prototipe', role: '', exp: 0, timer: null });
}

function endSession(message) {
  clearTimeout(session.timer);
  Object.assign(session, { token: null, name: '', role: '', exp: 0, timer: null });
  storeToken(null);

  appState.isLoggedIn = false;
  appState.mobileSidebarOpen = false;
  appState.reviews = [];
  appState.activeSuggestions = [];
  appState.completedSuggestions = [];

  ['manualReviewModal', 'pdfPreviewModal'].forEach((id) => {
    const modal = document.getElementById(id);
    modal.classList.add('hidden');
    modal.classList.remove('flex');
  });
  document.getElementById('dashboardApp').classList.add('hidden');
  document.getElementById('loginScreen').classList.remove('hidden');
  if (message) showToast(message);
}

async function apiFetch(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', 'ngrok-skip-browser-warning': '1', ...(options.headers || {}) };
  if (session.token) headers.Authorization = `Bearer ${session.token}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs || 15000);
  let res;
  try {
    res = await fetch(`${VOC_API}${path}`, { ...options, headers, signal: controller.signal });
  } catch {
    throw Object.assign(new Error('network'), { status: 0 });
  } finally {
    clearTimeout(timer);
  }

  const body = await res.json().catch(() => null);
  if (res.status === 401 && session.token) {
    endSession('Sesi login berakhir. Silakan masuk lagi.');
  }
  if (!res.ok) throw Object.assign(new Error('http'), { status: res.status, body });
  return body;
}

// Mengisi appState dengan data nyata dari API.
const SOURCE_LABEL = { qr: 'QR', google_maps: 'Google Maps', social_media: 'Media Sosial' };
const MENU_UMUM = 'Umum / Tidak Menyebut Menu';
const RIWAYAT_HARI = 732;

function kelompokUmur(age) {
  if (age < 20) return '< 20 thn';
  if (age <= 25) return '20–25 thn';
  if (age <= 35) return '26–35 thn';
  return '> 35 thn';
}
function fromApi(item) {
  const isQr = item.source === 'qr';
  const kosong = isQr ? 'Tidak dijawab' : 'Non-QR';
  const topik = Array.isArray(item.topics) && item.topics.length > 0 ? String(item.topics[0]) : '';
  const menu = Array.isArray(item.menus) && item.menus.length > 0 ? String(item.menus[0]) : '';
  return {
    id: String(item.id),
    date: item.date,
    source: SOURCE_LABEL[item.source] || item.source,
    satisfied: typeof item.satisfied === 'boolean' ? item.satisfied : null, // null = belum dinilai
    topic: topik ? topik.charAt(0).toUpperCase() + topik.slice(1) : '–',
    menu: menu || MENU_UMUM,
    ratings: isQr ? item.ratings : null,
    singleRating: item.rating,
    averageRating: typeof item.average_rating === 'number' ? item.average_rating : null,
    gender: item.gender === 'laki-laki' ? 'Laki-laki' : item.gender === 'perempuan' ? 'Perempuan' : kosong,
    ageGroup: Number.isInteger(item.age) ? kelompokUmur(item.age) : kosong,
    comment: item.text || '(tanpa komentar)',
    responseStatus: item.responded ? 'Sudah Ditanggapi' : 'Belum Ditanggapi'
  };
}

const INTERVAL_KE_API = { 'Mingguan': 'mingguan', '2 Mingguan': '2_mingguan', '3 Mingguan': '3_mingguan', 'Bulanan': 'bulanan' };
const INTERVAL_DARI_API = Object.fromEntries(Object.entries(INTERVAL_KE_API).map(([label, nilai]) => [nilai, label]));

function bolehUbahPengaturan() {
  return PROTOTIPE || session.role === 'kepala_cabang';
}

function applySettings(settings) {
  appState.threshold = settings.suggestion_threshold;
  appState.suggestionInterval = INTERVAL_DARI_API[settings.suggestion_interval] || 'Mingguan';

  document.getElementById('thresholdSlider').value = appState.threshold;
  document.getElementById('thresholdNumberInput').value = appState.threshold;
  document.getElementById('currentThresholdLabel').textContent = `${appState.threshold} keluhan baru`;
  document.getElementById('suggestionInterval').value = appState.suggestionInterval;

  // Staf hanya bisa melihat: kontrolnya dinonaktifkan.
  const boleh = bolehUbahPengaturan();
  ['suggestionInterval', 'thresholdSlider', 'thresholdNumberInput', 'saveThresholdBtn'].forEach((id) => {
    const el = document.getElementById(id);
    el.disabled = !boleh;
    el.classList.add('disabled:opacity-60');
    el.title = boleh ? '' : 'Hanya Kepala Cabang yang dapat mengubah pengaturan ini.';
  });
}

const kapital = (teks) => (teks ? teks.charAt(0).toUpperCase() + teks.slice(1) : '–');

async function apiFetchOptional(path) {
  try {
    return await apiFetch(path);
  } catch (err) {
    if (err.status === 404) return null;
    throw err;
  }
}

const PRIORITAS_LABEL = { mendesak: 'Mendesak', sedang: 'Sedang', rendah: 'Rendah' };

function tanggalLokal(waktu) {
  const d = new Date(waktu);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
}

function suggestionFromApi(s) {
  return {
    id: String(s.id),
    kind: s.kind,
    topic: kapital(s.topic),
    priority: PRIORITAS_LABEL[s.priority] || s.priority,
    complaintCount: s.complaint_count,
    text: s.text,
    reason: s.reason || '',
    completedDate: s.completed_at ? tanggalLokal(s.completed_at) : null,
    completedBy: s.completed_by || '',
    note: s.completion_note || 'Tanpa catatan.'
  };
}

function getShownSuggestions() {
  return appState.activeSuggestions.filter((s) => s.kind === 'perbaikan' && s.complaintCount >= appState.threshold);
}

async function loadDashboardData() {
  appState.activeSuggestions = [];
  appState.completedSuggestions = [];
  if (PROTOTIPE) {
    appState.reviews = [];
    return;
  }

  const awal = todayNoon();
  awal.setDate(awal.getDate() - RIWAYAT_HARI);
  const from = awal.toISOString().slice(0, 10);

  // 1. Ulasan (data utama). API mengirim paling banyak 1000 sekali minta, jadi diambil per halaman.
  const semua = [];
  let total = Infinity;
  while (semua.length < total) {
    const body = await apiFetch(`/reviews?from=${from}&limit=1000&offset=${semua.length}`);
    if (!body || !Array.isArray(body.data)) throw Object.assign(new Error('format'), { status: -1 });
    if (body.data.length === 0) break;
    semua.push(...body.data);
    total = Number(body.total) || 0;
  }
  if (!appState.isLoggedIn) return; // sudah logout saat data masih dimuat
  appState.reviews = semua.map(fromApi);

  const [pengaturan, aktif, selesai, laporan] = await Promise.all([
    apiFetch('/settings'),
    apiFetch('/suggestions?status=aktif'),
    apiFetch('/suggestions?status=selesai'),
    apiFetchOptional('/reports/weekly/latest')
  ]);
  if (!appState.isLoggedIn) return;
  applySettings(pengaturan);
  appState.activeSuggestions = aktif.data.map(suggestionFromApi);
  appState.completedSuggestions = selesai.data.map(suggestionFromApi);
  appState.latestReport = laporan;
}

async function showDashboard() {
  appState.isLoggedIn = true;
  appState.mobileSidebarOpen = false;

  const roleText = PROTOTIPE ? 'prototipe' : (ROLE_LABEL[session.role] || session.role || 'Pengguna');
  document.getElementById('greetingText').textContent = `Halo, ${session.name} (${roleText})`;
  document.getElementById('dataModeText').textContent = PROTOTIPE
    ? 'Mode prototipe: belum tersambung ke API, jadi dashboard kosong. Ulasan yang Anda input manual hanya tersimpan sementara di browser ini.'
    : 'data dari API. analasis AI di coba besok';

  document.getElementById('loginScreen').classList.add('hidden');
  document.getElementById('dashboardApp').classList.remove('hidden');

  try {
    await loadDashboardData();
  } catch (err) {
    if (err.status !== 401) showToast('Data dashboard gagal dimuat. Coba muat ulang halaman.');
  }
  if (!appState.isLoggedIn) return;
  refreshAllViews();
}

const appState = {
  isLoggedIn: false,
  mobileSidebarOpen: false,
  desktopSidebarHidden: false,
  activeTab: 'tab1',
  filters: {
    period: '1w',
    source: 'ALL',
    topic: 'ALL',
    menu: 'ALL'
  },
  suggestionInterval: 'Mingguan',
  threshold: 5,
  reviews: [],
  activeSuggestions: [],
  completedSuggestions: [],
  reviewSearch: '',
  reviewStatusFilter: 'ALL'
};

function showToast(message) {
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  toast.className = 'pointer-events-auto bg-[#231712] text-[#FAF9F6] text-xs font-semibold px-4 py-3 rounded-xl shadow-lg border border-[#FAF9F6]/20 flex items-center justify-between gap-3';
  const text = document.createElement('span');
  text.textContent = message;
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'text-[#FAF9F6]/75 hover:text-[#FAF9F6] font-bold cursor-pointer';
  close.setAttribute('aria-label', 'Tutup notifikasi');
  close.textContent = '✕';
  close.addEventListener('click', () => toast.remove());
  toast.append(text, close);
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 3600);
}

function getReviewAverageRating(rev) {
  return typeof rev.averageRating === 'number' ? rev.averageRating : null;
}

function fmtRating(rev) {
  const avg = getReviewAverageRating(rev);
  return avg === null ? '–' : `${avg.toFixed(1)}★`;
}

function fmtStars(value) {
  return typeof value === 'number' ? `${value}★` : '–';
}

function getDaysCutoff(periodKey) {
  switch (periodKey) {
    case '1w': return 7;
    case '2w': return 14;
    case '3w': return 21;
    case '1m': return 31;
    case '1y': return 365;
    default: return 7;
  }
}

const DAY_MS = 1000 * 60 * 60 * 24;

// Tanggal hari ini (jam 12 siang waktu lokal) sebagai titik acuan filter periode.
function todayNoon() {
  return new Date(todayISO() + 'T12:00:00');
}

// Berapa hari kalender yang lalu sebuah tanggal 'YYYY-MM-DD' terjadi (0 = hari ini).
function daysAgo(dateStr, today = todayNoon()) {
  return Math.round((today - new Date(dateStr + 'T12:00:00')) / DAY_MS);
}

function matchesNonPeriodFilters(r) {
  if (appState.filters.source !== 'ALL' && r.source !== appState.filters.source) return false;
  if (appState.filters.topic !== 'ALL' && r.topic !== appState.filters.topic) return false;
  if (appState.filters.menu !== 'ALL' && r.menu !== appState.filters.menu) return false;
  return true;
}

// Ulasan pada periode sebelumnya dengan panjang yang sama (mis. 1 minggu sebelum minggu ini),
// memakai filter sumber/topik/menu yang sama. Kosong bila belum ada data periode lalu.
function getPreviousPeriodReviews() {
  const span = getDaysCutoff(appState.filters.period) + 1;
  const today = todayNoon();
  return appState.reviews.filter((r) => {
    const diffDays = daysAgo(r.date, today);
    return diffDays >= span && diffDays < span * 2 && matchesNonPeriodFilters(r);
  });
}

function getFilteredReviews() {
  const maxDays = getDaysCutoff(appState.filters.period);
  const today = todayNoon();
  return appState.reviews.filter((r) => {
    const diffDays = daysAgo(r.date, today);
    if (diffDays > maxDays) return false;
    return matchesNonPeriodFilters(r);
  });
}

const NEUTRAL_BADGE_CLASS = 'px-2 py-0.5 rounded-full text-[11px] font-extrabold bg-[#231712]/10 text-[#231712]';

function emptyStateHtml(title, detail) {
  return `
    <div class="p-6 rounded-xl bg-[#231712]/5 border border-[#231712]/20 text-center">
      <p class="text-sm font-extrabold text-[#231712]">${esc(title)}</p>
      ${detail ? `<p class="text-xs text-[#231712]/75 mt-1">${esc(detail)}</p>` : ''}
    </div>
  `;
}

const AI_PENDING_TEXT = 'Belum ada data — akan terisi setelah analisis AI tersambung.';

function countActiveNonDefaultFilters() {
  let count = 0;
  if (appState.filters.period !== '1w') count++;
  if (appState.filters.source !== 'ALL') count++;
  if (appState.filters.topic !== 'ALL') count++;
  if (appState.filters.menu !== 'ALL') count++;
  return count;
}

function syncSidebarUI() {
  const sidebar = document.getElementById('appSidebar');
  const backdrop = document.getElementById('mobileSidebarBackdrop');
  const desktopToggleText = document.getElementById('desktopSidebarToggleText');

  if (appState.mobileSidebarOpen) {
    sidebar.classList.remove('-translate-x-full');
    sidebar.classList.add('translate-x-0');
    backdrop.classList.remove('hidden');
  } else {
    sidebar.classList.add('-translate-x-full');
    sidebar.classList.remove('translate-x-0');
    backdrop.classList.add('hidden');
  }

  if (appState.desktopSidebarHidden) {
    sidebar.classList.add('lg:hidden');
    sidebar.classList.remove('lg:flex');
    desktopToggleText.textContent = '☰ Tampilkan Sidebar';
  } else {
    sidebar.classList.remove('lg:hidden');
    sidebar.classList.add('lg:flex');
    desktopToggleText.textContent = '◧ Sembunyikan Sidebar';
  }

  const activeCount = countActiveNonDefaultFilters();
  const mobileBadge = document.getElementById('mobileActiveFilterBadge');
  const sidebarBadge = document.getElementById('sidebarFilterCountBadge');

  if (activeCount > 0) {
    mobileBadge.textContent = activeCount;
    mobileBadge.classList.remove('hidden');
    sidebarBadge.textContent = `${activeCount} filter aktif`;
    sidebarBadge.classList.remove('hidden');
  } else {
    mobileBadge.classList.add('hidden');
    sidebarBadge.classList.add('hidden');
  }
}

function openMobileSidebar() {
  appState.mobileSidebarOpen = true;
  syncSidebarUI();
}

function closeMobileSidebar() {
  appState.mobileSidebarOpen = false;
  syncSidebarUI();
}

function renderSummaryCards(filtered) {
  const total = filtered.length;
  const satisfiedCount = filtered.filter((r) => r.satisfied === true).length;
  const negReviews = filtered.filter((r) => r.satisfied === false);
  // Persen puas dihitung dari ulasan yang sudah dinilai saja (puas + tidak puas).
  const assessed = satisfiedCount + negReviews.length;
  const satisfiedPct = assessed > 0 ? Math.round((satisfiedCount / assessed) * 100) : null;
  const unrespondedNeg = negReviews.filter((r) => r.responseStatus === 'Belum Ditanggapi').length;

  // Rata-rata per aspek: [jumlah, banyaknya]. Bintang kosong (null) tidak ikut dihitung.
  const aspek = { Rasa: [0, 0], Harga: [0, 0], Pelayanan: [0, 0], Tempat: [0, 0] };
  const tambah = (nama, nilai) => {
    if (typeof nilai !== 'number') return;
    aspek[nama][0] += nilai;
    aspek[nama][1] += 1;
  };
  filtered.forEach((r) => {
    if (r.source === 'QR' && r.ratings) {
      tambah('Rasa', r.ratings.rasa);
      tambah('Harga', r.ratings.harga);
      tambah('Pelayanan', r.ratings.pelayanan);
      tambah('Tempat', r.ratings.tempat);
    } else if (aspek[r.topic]) {
      // Ulasan manual: bintangnya masuk ke aspek sesuai topiknya.
      tambah(r.topic, getReviewAverageRating(r));
    }
  });
  const fmtAvg = ([sum, cnt]) => (cnt > 0 ? `${(sum / cnt).toFixed(1)}★` : '–');

  // Pembanding periode sebelumnya dihitung dari ulasan nyata; '–' bila belum ada datanya.
  const prevReviews = getPreviousPeriodReviews();
  const prevTotal = prevReviews.length;
  const prevNeg = prevReviews.filter((r) => r.satisfied === false).length;
  const prevPuas = prevReviews.filter((r) => r.satisfied === true).length;
  const prevSatisfiedPct = prevPuas + prevNeg > 0
    ? Math.round((prevPuas / (prevPuas + prevNeg)) * 100)
    : null;

  const FILLED_BADGE_CLASS = 'px-2 py-0.5 rounded-full text-[11px] font-extrabold bg-[#231712] text-[#FAF9F6]';
  const OUTLINE_BADGE_CLASS = 'px-2 py-0.5 rounded-full text-[11px] font-extrabold border-[1.5px] border-[#231712] text-[#231712]';
  const setBadge = (id, text, className) => {
    const el = document.getElementById(id);
    el.textContent = text;
    el.className = className;
  };
  const arrow = (diff) => (diff > 0 ? '▲ +' : diff < 0 ? '▼ ' : '= ');

  document.getElementById('topBarCountBadge').textContent = `${total} ulasan ditampilkan`;
  document.getElementById('kpiTotalCount').textContent = total;
  document.getElementById('kpiSatisfiedPct').textContent = satisfiedPct !== null ? `${satisfiedPct}%` : '–';
  if (prevTotal > 0) {
    const pct = Math.round(((total - prevTotal) / prevTotal) * 100);
    setBadge('kpiTotalTrend', `${arrow(pct)}${pct}%`, FILLED_BADGE_CLASS);
  } else {
    setBadge('kpiTotalTrend', '–', NEUTRAL_BADGE_CLASS);
  }

  document.getElementById('kpiUnrespondedNeg').textContent = unrespondedNeg;
  document.getElementById('kpiTotalNeg').textContent = negReviews.length;
  if (prevTotal > 0) {
    const negDiff = negReviews.length - prevNeg;
    setBadge('kpiNegTrend', `${arrow(negDiff)}${negDiff}`, negDiff > 0 ? FILLED_BADGE_CLASS : OUTLINE_BADGE_CLASS);
  } else {
    setBadge('kpiNegTrend', '–', NEUTRAL_BADGE_CLASS);
  }

  document.getElementById('kpiActiveSugCount').textContent = getShownSuggestions().length;
  document.getElementById('kpiDoneSugCount').textContent = appState.completedSuggestions.length;

  document.getElementById('aspectRasaVal').textContent = fmtAvg(aspek.Rasa);
  document.getElementById('aspectHargaVal').textContent = fmtAvg(aspek.Harga);
  document.getElementById('aspectPelayananVal').textContent = fmtAvg(aspek.Pelayanan);
  document.getElementById('aspectTempatVal').textContent = fmtAvg(aspek.Tempat);

  document.getElementById('kpiCurrentScore').textContent = satisfiedPct !== null ? `${satisfiedPct}%` : '–';
  document.getElementById('kpiPrevScore').textContent = prevSatisfiedPct !== null ? `${prevSatisfiedPct}%` : '–';
  if (satisfiedPct !== null && prevSatisfiedPct !== null) {
    const diffPoints = satisfiedPct - prevSatisfiedPct;
    setBadge(
      'kpiSatisfactionDiffBadge',
      `${arrow(diffPoints)}${diffPoints}% poin`,
      diffPoints >= 0 ? FILLED_BADGE_CLASS : OUTLINE_BADGE_CLASS
    );
  } else {
    setBadge('kpiSatisfactionDiffBadge', '–', NEUTRAL_BADGE_CLASS);
  }
}

function renderActiveSuggestions() {
  const container = document.getElementById('activeSuggestionsList');
  const items = getShownSuggestions().filter((s) => {
    if (appState.filters.topic !== 'ALL' && s.topic !== appState.filters.topic) return false;
    return true;
  });

  if (items.length === 0) {
    // Saran perbaikan yang ada tapi keluhannya belum mencapai ambang (supaya tidak dikira hilang).
    const diBawahAmbang = appState.activeSuggestions.filter((s) => s.kind === 'perbaikan').length - getShownSuggestions().length;
    container.innerHTML = `
      <div class="p-6 rounded-xl bg-[#231712]/5 border border-[#231712]/20 text-center">
        <p class="text-sm font-extrabold text-[#231712]">Tidak ada saran aktif untuk topik ini</p>
        <p class="text-xs text-[#231712]/75 mt-1">
          Saran baru akan muncul otomatis apabila tercatat ${esc(appState.threshold)} keluhan baru pada topik yang sama.
        </p>
        ${diBawahAmbang > 0 ? `<p class="text-xs text-[#231712]/75 mt-1">${esc(diBawahAmbang)} saran dari laporan AI terbaru belum ditampilkan karena jumlah keluhannya di bawah ambang.</p>` : ''}
      </div>
    `;
    return;
  }

  container.innerHTML = items.map((sug) => {
    let badgeStyle = 'border border-[#231712]/40 bg-[#FAF9F6] text-[#231712]';
    if (sug.priority === 'Mendesak') {
      badgeStyle = 'bg-[#231712] text-[#FAF9F6] border border-[#231712]';
    } else if (sug.priority === 'Sedang') {
      badgeStyle = 'bg-espresso-hatch border-2 border-[#231712] text-[#231712]';
    }

    return `
      <div class="p-4 rounded-xl bg-[#FAF9F6] border-[1.5px] border-[#231712]/25 hover:border-[#231712] transition">
        <div class="flex flex-wrap items-center justify-between gap-2 mb-2">
          <div class="flex flex-wrap items-center gap-1.5">
            <span class="px-2.5 py-0.5 rounded-full text-[11px] font-extrabold ${badgeStyle}">
              Prioritas: ${esc(sug.priority)}
            </span>
            <span class="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-[#231712]/5 border border-[#231712]/20 text-[#231712]">
              Topik: ${esc(sug.topic)}
            </span>
            <span class="text-[11px] font-semibold text-[#231712]/70">
              • ${esc(appState.suggestionInterval)}
            </span>
          </div>
          <span class="text-[11px] font-extrabold text-[#231712]">
            ${esc(sug.complaintCount)} keluhan
          </span>
        </div>

        <p class="text-xs sm:text-sm font-extrabold text-[#231712] leading-snug">
          ${esc(sug.text)}
        </p>
        <p class="text-xs text-[#231712]/75 mt-1">
          ${esc(sug.reason)}
        </p>

        <div class="mt-3 pt-3 border-t border-[#231712]/15 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
          <span class="text-[11px] text-[#231712]/75">
            Saran akan muncul lagi bila ada <strong class="text-[#231712]">${esc(appState.threshold)} keluhan baru</strong>
          </span>
          <button
            type="button"
            data-action="toggle-complete" data-id="${esc(sug.id)}"
            class="px-3.5 py-2 rounded-xl bg-[#231712] text-[#FAF9F6] text-xs font-bold hover:bg-[#231712]/90 transition shrink-0 self-start sm:self-auto cursor-pointer"
          >
            Tandai sudah dilaksanakan
          </button>
        </div>

        <div id="complete-form-${esc(sug.id)}" class="hidden mt-3 pt-3 border-t border-[#231712]/25 bg-[#231712]/5 p-3 rounded-xl">
          <label for="note-input-${esc(sug.id)}" class="block text-xs font-extrabold text-[#231712] mb-1">
            Catatan Singkat Pelaksanaan:
          </label>
          <input
            type="text"
            id="note-input-${esc(sug.id)}"
            placeholder="Sudah ganti takaran sirup & briefing barista"
            class="w-full px-3 py-2 text-xs font-medium bg-[#FAF9F6] border border-[#231712]/40 rounded-xl text-[#231712] focus:outline-none focus:border-[#231712]"
          />
          <div class="mt-2.5 flex items-center justify-end gap-2">
            <button
              type="button"
              data-action="toggle-complete" data-id="${esc(sug.id)}"
              class="px-3 py-1.5 rounded-xl border border-[#231712]/35 bg-[#FAF9F6] text-xs font-bold text-[#231712] cursor-pointer"
            >
              Batal
            </button>
            <button
              type="button"
              data-action="confirm-done" data-id="${esc(sug.id)}"
              class="px-3.5 py-1.5 rounded-xl bg-[#231712] text-[#FAF9F6] text-xs font-bold hover:bg-[#231712]/90 cursor-pointer"
            >
              Simpan &amp; Selesaikan
            </button>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

function toggleCompleteForm(sugId) {
  const formEl = document.getElementById(`complete-form-${sugId}`);
  if (formEl) {
    formEl.classList.toggle('hidden');
    if (!formEl.classList.contains('hidden')) {
      const inp = document.getElementById(`note-input-${sugId}`);
      if (inp) inp.focus();
    }
  }
}

function confirmSuggestionDone(sugId) {
  const idx = appState.activeSuggestions.findIndex((s) => s.id === sugId);
  if (idx === -1) return;

  const inp = document.getElementById(`note-input-${sugId}`);
  const note = inp && inp.value.trim() ? inp.value.trim().slice(0, 300) : 'Tanpa catatan.';

  const [doneItem] = appState.activeSuggestions.splice(idx, 1);
  appState.completedSuggestions.unshift({
    id: 'DONE-' + Date.now(),
    completedDate: todayISO(),
    topic: doneItem.topic,
    priority: doneItem.priority,
    text: doneItem.text,
    note
  });

  refreshAllViews();
  showToast('Saran berhasil ditandai selesai dan masuk ke Riwayat Saran.');
}

function renderRecentNegativeReviews(filtered) {
  const container = document.getElementById('recentNegativeList');
  const negReviews = filtered
    .filter((r) => r.satisfied === false)
    .sort((a, b) => new Date(b.date) - new Date(a.date));

  document.getElementById('negListBadge').textContent = `${negReviews.length} ulasan`;

  if (negReviews.length === 0) {
    container.innerHTML = `
      <div class="p-5 rounded-xl bg-[#231712]/5 border border-[#231712]/20 text-center text-xs font-semibold text-[#231712]/75">
        Tidak ada ulasan negatif pada filter yang dipilih.
      </div>
    `;
    return;
  }

  container.innerHTML = negReviews.slice(0, 5).map((rev) => {
    const isUnresponded = rev.responseStatus === 'Belum Ditanggapi';
    const statusBadge = isUnresponded
      ? `<span class="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-[#231712] text-[#FAF9F6]">Belum Ditanggapi</span>`
      : `<span class="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-[#FAF9F6] border-[1.5px] border-[#231712] text-[#231712]">Sudah Ditanggapi</span>`;

    const avgStar = fmtRating(rev);

    return `
      <div class="p-4 rounded-xl bg-[#FAF9F6] border border-[#231712]/25 border-l-4 border-l-[#231712]">
        <div class="flex flex-wrap items-center justify-between gap-2 mb-1.5">
          <div class="flex flex-wrap items-center gap-1.5">
            <span class="px-2 py-0.5 rounded text-[10px] font-extrabold bg-[#231712] text-[#FAF9F6]">
              NEGATIF
            </span>
            <span class="px-2 py-0.5 rounded text-[11px] font-bold border border-[#231712]/30 text-[#231712]">
              ${esc(rev.source)}
            </span>
            <span class="px-2 py-0.5 rounded text-[11px] font-bold bg-[#231712]/10 text-[#231712]">
              Topik: ${esc(rev.topic)}
            </span>
            <span class="text-[11px] font-extrabold text-[#231712]">${esc(avgStar)}</span>
            <span class="text-[11px] text-[#231712]/65">• ${esc(rev.date)}</span>
          </div>
          ${statusBadge}
        </div>

        <p class="text-xs sm:text-sm font-medium text-[#231712] leading-relaxed">
          "${esc(rev.comment)}"
        </p>

        <div class="mt-2.5 pt-2 border-t border-[#231712]/15 flex flex-wrap items-center justify-between gap-2">
          <span class="text-[11px] text-[#231712]/75">
            Menu: <strong class="text-[#231712]">${esc(rev.menu)}</strong>
          </span>
          <button
            type="button"
            data-action="toggle-response" data-id="${esc(rev.id)}"
            class="px-3 py-1.5 rounded-xl text-[11px] font-bold transition cursor-pointer ${
              isUnresponded
                ? 'bg-[#231712] text-[#FAF9F6] hover:bg-[#231712]/90'
                : 'bg-[#FAF9F6] border-[1.5px] border-[#231712] text-[#231712] hover:bg-[#231712]/5'
            }"
          >
            ${isUnresponded ? 'Tandai Sudah Ditanggapi' : 'Sudah Ditanggapi ✓'}
          </button>
        </div>
      </div>
    `;
  }).join('');
}

async function toggleReviewResponseStatus(revId) {
  const target = appState.reviews.find((r) => r.id === revId);
  if (!target) return;
  const tandai = target.responseStatus === 'Belum Ditanggapi';

  if (!PROTOTIPE) {
    try {
      await apiFetch(`/reviews/${encodeURIComponent(revId)}/respond`, {
        method: 'PATCH',
        body: JSON.stringify({ responded: tandai })
      });
    } catch (err) {
      if (err.status === 0) showToast('Server tidak bisa dihubungi. Status belum tersimpan.');
      else if (err.status === 404) showToast('Ulasan tidak ditemukan. Muat ulang halaman.');
      else if (err.status !== 401) showToast((err.body && err.body.message) || 'Status belum tersimpan. Coba lagi.');
      return;
    }
  }

  target.responseStatus = tandai ? 'Sudah Ditanggapi' : 'Belum Ditanggapi';
  refreshAllViews();
  showToast(`Status ulasan diperbarui menjadi "${target.responseStatus}".`);
}

// Kelompokkan ulasan per hari (1–2 minggu), per 7 hari (3 minggu–1 bulan), atau per bulan (1 tahun).
// Mengembalikan label sumbu-X beserta jumlah ulasan puas & tidak puas per kelompok, urut lama → baru.
function bucketReviewsByPeriod(reviews, period) {
  const maxDays = getDaysCutoff(period);
  const today = todayNoon();
  const fmtDay = (d) => `${d.getDate()}/${d.getMonth() + 1}`;

  let buckets;
  let indexOf;
  if (period === '1y') {
    const monthKey = (d) => d.getFullYear() * 12 + d.getMonth();
    const first = new Date(today.getTime() - maxDays * DAY_MS);
    const firstKey = monthKey(first);
    const count = monthKey(today) - firstKey + 1;
    buckets = Array.from({ length: count }, (_, i) => ({
      label: new Date(first.getFullYear(), first.getMonth() + i, 1).toLocaleDateString('id-ID', { month: 'short' }),
      puas: 0,
      neg: 0
    }));
    indexOf = (r) => monthKey(new Date(r.date + 'T12:00:00')) - firstKey;
  } else {
    const size = (period === '1w' || period === '2w') ? 1 : 7;
    const count = Math.ceil((maxDays + 1) / size);
    buckets = Array.from({ length: count }, (_, i) => {
      // Kelompok ke-i (dari yang terlama) mencakup daysAgo dalam [startAgo - size + 1, startAgo].
      const startAgo = (count - 1 - i) * size + size - 1;
      return { label: fmtDay(new Date(today.getTime() - Math.min(startAgo, maxDays) * DAY_MS)), puas: 0, neg: 0 };
    });
    indexOf = (r) => count - 1 - Math.floor(Math.max(0, daysAgo(r.date, today)) / size);
  }

  reviews.forEach((r) => {
    const idx = indexOf(r);
    if (idx < 0 || idx >= buckets.length) return;
    if (r.satisfied === true) buckets[idx].puas++;
    else if (r.satisfied === false) buckets[idx].neg++;
  });
  return buckets;
}

function renderTab1SVGCharts(filtered) {
  if (filtered.length === 0) {
    document.getElementById('svgSentimentTrendContainer').innerHTML = emptyStateHtml(
      'Belum ada data',
      'Grafik tren akan muncul setelah ada ulasan pada periode dan filter yang dipilih.'
    );
  } else {
    renderSentimentTrendSvg(bucketReviewsByPeriod(filtered, appState.filters.period));
  }
  renderComplaintsByTopicSvg(filtered);
}

function renderSentimentTrendSvg(buckets) {
  const labelEvery = Math.ceil(buckets.length / 8);
  const labels = buckets.map((b, i) => ((buckets.length - 1 - i) % labelEvery === 0 ? b.label : ''));
  const puasPoints = buckets.map((b) => b.puas);
  const negPoints = buckets.map((b) => b.neg);

  const maxVal = Math.max(...puasPoints, ...negPoints, 4);
  const W = 440, H = 220;
  const padL = 32, padR = 20, padT = 24, padB = 34;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  const getX = (idx) => padL + (labels.length === 1 ? plotW / 2 : (idx / (labels.length - 1)) * plotW);
  const getY = (val) => padT + plotH - (val / maxVal) * plotH;

  const puasPath = puasPoints.map((v, i) => `${i === 0 ? 'M' : 'L'} ${getX(i).toFixed(1)} ${getY(v).toFixed(1)}`).join(' ');
  const negPath = negPoints.map((v, i) => `${i === 0 ? 'M' : 'L'} ${getX(i).toFixed(1)} ${getY(v).toFixed(1)}`).join(' ');

  const gridLines = [0, 0.5, 1].map((ratio) => {
    const y = (padT + plotH - ratio * plotH).toFixed(1);
    const valLabel = Math.round(ratio * maxVal);
    return `
      <line x1="${padL}" y1="${y}" x2="${W - padR}" y2="${y}" stroke="#231712" stroke-opacity="0.12" stroke-width="1" />
      <text x="${padL - 6}" y="${parseFloat(y) + 4}" text-anchor="end" font-size="10" font-weight="600" fill="#231712" fill-opacity="0.7">${valLabel}</text>
    `;
  }).join('');

  const xLabelsSvg = labels.map((lbl, i) => `
    <text x="${getX(i).toFixed(1)}" y="${H - 10}" text-anchor="middle" font-size="10" font-weight="700" fill="#231712">${esc(lbl)}</text>
  `).join('');

  const puasDotsSvg = puasPoints.map((v, i) => {
    const cx = getX(i).toFixed(1);
    const cy = getY(v).toFixed(1);
    return `
      <circle cx="${cx}" cy="${cy}" r="4.5" fill="#231712" />
      <text x="${cx}" y="${parseFloat(cy) - 8}" text-anchor="middle" font-size="10" font-extrabold fill="#231712">${v}</text>
    `;
  }).join('');

  const negDotsSvg = negPoints.map((v, i) => {
    const cx = getX(i).toFixed(1);
    const cy = getY(v).toFixed(1);
    return `
      <circle cx="${cx}" cy="${cy}" r="4.5" fill="#FAF9F6" stroke="#231712" stroke-width="2.2" />
      <text x="${cx}" y="${parseFloat(cy) + 15}" text-anchor="middle" font-size="10" font-bold fill="#231712">${v}</text>
    `;
  }).join('');

  document.getElementById('svgSentimentTrendContainer').innerHTML = `
    <svg viewBox="0 0 ${W} ${H}" class="w-full h-auto overflow-visible" role="img" aria-label="Grafik Garis Tren Puas vs Tidak Puas">
      ${gridLines}
      <path d="${puasPath}" fill="none" stroke="#231712" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />
      <path d="${negPath}" fill="none" stroke="#231712" stroke-width="2.5" stroke-dasharray="6 5" stroke-linecap="round" stroke-linejoin="round" />
      ${puasDotsSvg}
      ${negDotsSvg}
      ${xLabelsSvg}
    </svg>
  `;
}

function renderComplaintsByTopicSvg(filtered) {
  const topics = ['Rasa', 'Harga', 'Pelayanan', 'Tempat'];
  const counts = topics.map((t) => filtered.filter((r) => r.satisfied === false && r.topic === t).length);
  const totalNeg = counts.reduce((a, b) => a + b, 0);
  const maxTopicCount = Math.max(...counts, 1);

  const bW = 440, bH = 220;
  const bPadL = 28, bPadR = 16, bPadT = 26, bPadB = 34;
  const bPlotW = bW - bPadL - bPadR;
  const bPlotH = bH - bPadT - bPadB;
  const slotW = bPlotW / topics.length;
  const barW = Math.min(48, slotW * 0.56);

  const barsSvg = topics.map((topic, i) => {
    const val = counts[i];
    const pct = totalNeg > 0 ? Math.round((val / totalNeg) * 100) : 0;
    const barH = (val / maxTopicCount) * bPlotH;
    const x = bPadL + i * slotW + (slotW - barW) / 2;
    const y = bPadT + bPlotH - barH;
    const isHighest = val === maxTopicCount && val > 0;

    return `
      <rect
        x="${x.toFixed(1)}"
        y="${y.toFixed(1)}"
        width="${barW}"
        height="${Math.max(2, barH).toFixed(1)}"
        rx="6"
        fill="${isHighest ? '#231712' : 'url(#espressoDiagonalHatch)'}"
        stroke="#231712"
        stroke-width="1.8"
      />
      <text x="${(x + barW / 2).toFixed(1)}" y="${(y - 6).toFixed(1)}" text-anchor="middle" font-size="10.5" font-extrabold fill="#231712">
        ${val} (${pct}%)
      </text>
      <text x="${(x + barW / 2).toFixed(1)}" y="${bH - 10}" text-anchor="middle" font-size="11" font-bold fill="#231712">
        ${esc(topic)}
      </text>
    `;
  }).join('');

  document.getElementById('svgComplaintsByTopicContainer').innerHTML = `
    <svg viewBox="0 0 ${bW} ${bH}" class="w-full h-auto overflow-visible" role="img" aria-label="Grafik Batang Keluhan per Topik">
      <defs>
        <pattern id="espressoDiagonalHatch" width="8" height="8" patternTransform="rotate(45 0 0)" patternUnits="userSpaceOnUse">
          <rect width="8" height="8" fill="#FAF9F6" />
          <line x1="0" y1="0" x2="0" y2="8" stroke="#231712" stroke-width="2" stroke-opacity="0.45" />
        </pattern>
      </defs>
      <line x1="${bPadL}" y1="${bPadT + bPlotH}" x2="${bW - bPadR}" y2="${bPadT + bPlotH}" stroke="#231712" stroke-opacity="0.25" stroke-width="1.5" />
      ${barsSvg}
    </svg>
  `;

  const topIdx = counts.indexOf(Math.max(...counts));
  const topVal = counts[topIdx];
  document.getElementById('topComplaintCallout').innerHTML = topVal > 0
    ? `Topik dengan keluhan terbanyak: <strong>${esc(topics[topIdx])} (${topVal} keluhan / ${Math.round((topVal / totalNeg) * 100)}%)</strong>.`
    : `Belum ada keluhan pada kombinasi filter yang dipilih.`;
}

function renderTab2Analytics(filtered) {
  const total = filtered.length;

    // Distribusi bintang: hanya ulasan yang punya bintang.
  const starCounts = [0, 0, 0, 0, 0];
  filtered.forEach((r) => {
    const avg = getReviewAverageRating(r);
    if (avg === null) return;
    starCounts[Math.min(5, Math.max(1, Math.round(avg))) - 1]++;
  });
  const rated = starCounts.reduce((a, b) => a + b, 0);

  document.getElementById('chartStarDistribution').innerHTML = [5, 4, 3, 2, 1].map((star) => {
    const cnt = starCounts[star - 1];
    const pct = rated > 0 ? Math.round((cnt / rated) * 100) : 0;
    const fillClass = star >= 4 ? 'bg-[#231712]' : 'bg-espresso-hatch border border-[#231712]';
    return `
      <div>
        <div class="flex items-center justify-between text-xs font-bold mb-1">
          <span>${star} ★ (${star >= 4 ? 'Puas' : 'Tidak Puas'})</span>
          <span>${cnt} ulasan (${pct}%)</span>
        </div>
        <div class="w-full h-3.5 rounded-full bg-[#231712]/10 overflow-hidden p-0.5">
          <div class="h-full rounded-full ${fillClass} transition-all duration-300" style="width: ${pct}%"></div>
        </div>
      </div>
    `;
  }).join('');

  const sourceNames = ['QR', 'Google Maps', 'Media Sosial'];
  const sourceCounts = sourceNames.map((s) => filtered.filter((r) => r.source === s).length);
  document.getElementById('chartReviewSource').innerHTML = `
    <div class="space-y-3.5">
      ${sourceNames.map((src, idx) => {
        const cnt = sourceCounts[idx];
        const pct = total > 0 ? Math.round((cnt / total) * 100) : 0;
        const barStyle = idx === 0
          ? 'bg-[#231712]'
          : idx === 1
            ? 'bg-espresso-hatch border border-[#231712]'
            : 'bg-[#FAF9F6] border-2 border-[#231712]';
        return `
          <div class="p-3 rounded-xl border border-[#231712]/20 bg-[#FAF9F6]">
            <div class="flex items-center justify-between text-xs font-extrabold mb-1.5">
              <span>${esc(src === 'QR' ? 'QR Meja (Langsung di Kedai)' : src)}</span>
              <span>${cnt} ulasan (${pct}%)</span>
            </div>
            <div class="w-full h-3 rounded-full bg-[#231712]/10 overflow-hidden">
              <div class="h-full rounded-full ${barStyle}" style="width: ${pct}%"></div>
            </div>
          </div>
        `;
      }).join('')}
    </div>
  `;

  // Pembanding dihitung dari ulasan nyata periode sebelumnya (panjang periode sama).
  const prevReviews = getPreviousPeriodReviews();
  const countNeg = (list, topic) => list.filter((r) => r.satisfied === false && r.topic === topic).length;
  const topicTrendEl = document.getElementById('chartTopicTrend');
  if (total === 0 && prevReviews.length === 0) {
    topicTrendEl.innerHTML = emptyStateHtml('Belum ada data', 'Perbandingan muncul setelah ada ulasan pada periode ini dan periode sebelumnya.');
  } else {
    topicTrendEl.innerHTML = ['Rasa', 'Pelayanan', 'Tempat', 'Harga'].map((topic) => {
      const curr = countNeg(filtered, topic);
      const prev = prevReviews.length > 0 ? countNeg(prevReviews, topic) : null;
      let statusLabel = `<span class="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-[#231712]/10 text-[#231712]">–</span>`;
      if (prev !== null) {
        const diff = curr - prev;
        statusLabel = diff <= 0
          ? `<span class="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-[#FAF9F6] border-[1.5px] border-[#231712] text-[#231712]">Membaik ▼ (${esc(diff)})</span>`
          : `<span class="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-[#231712] text-[#FAF9F6]">Memburuk ▲ (+${esc(diff)})</span>`;
      }
      return `
        <div class="p-3 rounded-xl border border-[#231712]/20 flex items-center justify-between gap-2">
          <div>
            <span class="text-xs font-extrabold text-[#231712]">Topik ${esc(topic)}</span>
            <p class="text-[11px] text-[#231712]/75 mt-0.5">
              Periode lalu: <strong>${prev !== null ? `${esc(prev)} keluhan` : 'belum ada data'}</strong> → Sekarang: <strong>${esc(curr)} keluhan</strong>
            </p>
          </div>
          ${statusLabel}
        </div>
      `;
    }).join('');
  }

  const menus = [
    'Kopi Susu Djaja',
    'Es Kopi Aren',
    'Matcha Latte',
    'Croissant Butter',
    'Nasi Goreng Signature',
    'Umum / Tidak Menyebut Menu'
  ];
  const maxMenuTotal = Math.max(
    ...menus.map((m) => filtered.filter((r) => r.menu === m).length),
    1
  );
  document.getElementById('chartMenuSentiment').innerHTML = menus.map((m) => {
    const praised = filtered.filter((r) => r.menu === m && r.satisfied === true).length;
    const complained = filtered.filter((r) => r.menu === m && r.satisfied === false).length;
    const pWidth = Math.round((praised / maxMenuTotal) * 100);
    const cWidth = Math.round((complained / maxMenuTotal) * 100);
    return `
      <div>
        <div class="flex items-center justify-between text-xs font-bold mb-1">
          <span class="truncate pr-2">${esc(m)}</span>
          <span class="shrink-0 text-[11px]">Dipuji: ${praised} • Dikeluhkan: ${complained}</span>
        </div>
        <div class="space-y-1">
          <div class="w-full h-2.5 rounded-full bg-[#231712]/10 overflow-hidden">
            <div class="h-full bg-[#231712] rounded-full" style="width: ${pWidth}%"></div>
          </div>
          <div class="w-full h-2.5 rounded-full bg-[#231712]/10 overflow-hidden">
            <div class="h-full bg-espresso-hatch border border-[#231712] rounded-full" style="width: ${cWidth}%"></div>
          </div>
        </div>
      </div>
    `;
  }).join('');

  // Kata kunci keluhan berulang & evaluasi sebelum/sesudah saran belum punya sumber data.
  renderRecurringKeywords();
  document.getElementById('chartBeforeAfter').innerHTML = emptyStateHtml('Belum ada data', AI_PENDING_TEXT);

  const isQrOnly = appState.filters.source === 'QR';
  const genderItems = [
    { label: 'Laki-laki', count: filtered.filter((r) => r.gender === 'Laki-laki').length, style: 'bg-[#231712]' },
    { label: 'Perempuan', count: filtered.filter((r) => r.gender === 'Perempuan').length, style: 'bg-espresso-hatch border border-[#231712]' },
    { label: 'Tidak dijawab', count: filtered.filter((r) => r.gender === 'Tidak dijawab').length, style: 'bg-[#231712]/75' }
  ];
  if (!isQrOnly) {
    genderItems.push({
      label: 'Non-QR (Maps / Sosmed)',
      count: filtered.filter((r) => r.source !== 'QR').length,
      style: 'bg-[#FAF9F6] border-2 border-[#231712]'
    });
  }

  document.getElementById('chartGender').innerHTML = `
    <div class="space-y-3.5">
      ${genderItems.map((g) => {
        const pct = total > 0 ? Math.round((g.count / total) * 100) : 0;
        return `
          <div class="p-3 rounded-xl border border-[#231712]/20 bg-[#FAF9F6]">
            <div class="flex items-center justify-between text-xs font-extrabold mb-1.5">
              <span>${esc(g.label)}</span>
              <span>${g.count} responden (${pct}%)</span>
            </div>
            <div class="w-full h-3 rounded-full bg-[#231712]/10 overflow-hidden">
              <div class="h-full rounded-full ${g.style}" style="width: ${pct}%"></div>
            </div>
          </div>
        `;
      }).join('')}
    </div>
  `;

  const ageGroups = [
    { label: '< 20 thn', count: filtered.filter((r) => r.ageGroup === '< 20 thn').length },
    { label: '20–25 thn', count: filtered.filter((r) => r.ageGroup === '20–25 thn').length },
    { label: '26–35 thn', count: filtered.filter((r) => r.ageGroup === '26–35 thn').length },
    { label: '> 35 thn', count: filtered.filter((r) => r.ageGroup === '> 35 thn').length },
    { label: 'Tidak dijawab', count: filtered.filter((r) => r.ageGroup === 'Tidak dijawab').length }
  ];
  if (!isQrOnly) {
    ageGroups.push({
      label: 'Non-QR (Maps / Sosmed)',
      count: filtered.filter((r) => r.source !== 'QR').length
    });
  }

  document.getElementById('chartAgeGroup').innerHTML = ageGroups.map((ag, idx) => {
    const pct = total > 0 ? Math.round((ag.count / total) * 100) : 0;
    const barFill = ag.label.startsWith('Non-QR')
      ? 'bg-espresso-hatch border border-[#231712]'
      : idx === 1
        ? 'bg-[#231712]'
        : 'bg-[#231712]/75';
    return `
      <div>
        <div class="flex items-center justify-between text-xs font-bold mb-1">
          <span>${esc(ag.label)}</span>
          <span>${ag.count} orang (${pct}%)</span>
        </div>
        <div class="w-full h-3 rounded-full bg-[#231712]/10 overflow-hidden">
          <div class="h-full rounded-full ${barFill}" style="width: ${pct}%"></div>
        </div>
      </div>
    `;
  }).join('');
}

// Grafik 5: kata kunci keluhan dari laporan AI terbaru (tidak ikut filter sidebar).
function renderRecurringKeywords() {
  const el = document.getElementById('chartRecurringKeywords');
  const laporan = appState.latestReport;
  const kataKunci = laporan && Array.isArray(laporan.keywords) ? laporan.keywords : [];
  if (kataKunci.length === 0) {
    el.innerHTML = emptyStateHtml('Belum ada data', laporan
      ? 'Laporan AI terbaru belum menemukan kata keluhan yang berulang.'
      : 'Klik "Jalankan Analisis AI" di sidebar untuk membuat laporan.');
    return;
  }

  const maks = Math.max(...kataKunci.map((k) => k.jumlah), 1);
  el.innerHTML = `
    <p class="text-[11px] text-[#231712]/70">Dari laporan AI ${esc(laporan.period_start)} s.d. ${esc(laporan.period_end)}</p>
    ${kataKunci.map((k) => `
      <div>
        <div class="flex items-center justify-between text-xs font-bold mb-1">
          <span>"${esc(k.kata)}" <span class="font-semibold text-[#231712]/70">• ${esc(kapital(k.topik))}</span></span>
          <span>${esc(k.jumlah)} ulasan</span>
        </div>
        <div class="w-full h-3 rounded-full bg-[#231712]/10 overflow-hidden">
          <div class="h-full rounded-full bg-[#231712]" style="width: ${Math.round((k.jumlah / maks) * 100)}%"></div>
        </div>
      </div>
    `).join('')}
  `;
}

function renderTab3(filtered) {
  const histContainer = document.getElementById('completedSuggestionsList');
  document.getElementById('completedHistoryBadge').textContent = `${appState.completedSuggestions.length} selesai`;

  if (appState.completedSuggestions.length === 0) {
    histContainer.innerHTML = `<p class="text-xs text-[#231712]/70 py-4 text-center">Belum ada saran yang ditandai selesai.</p>`;
  } else {
    histContainer.innerHTML = appState.completedSuggestions.map((item) => `
      <div class="p-3.5 rounded-xl bg-[#FAF9F6] border border-[#231712]/25">
        <div class="flex flex-wrap items-center justify-between gap-2 mb-1">
          <div class="flex items-center gap-1.5">
            <span class="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-[#FAF9F6] border-[1.5px] border-[#231712] text-[#231712]">
              ✓ Sudah Dilaksanakan
            </span>
            <span class="text-[11px] font-bold text-[#231712]">Topik: ${esc(item.topic)}</span>
          </div>
          <span class="text-[11px] text-[#231712]/70">Selesai: ${esc(item.completedDate)}</span>
        </div>
        <p class="text-xs font-extrabold text-[#231712]">${esc(item.text)}</p>
        <p class="mt-1.5 text-[11px] text-[#231712]/85 bg-[#231712]/5 px-2.5 py-1.5 rounded-lg border border-[#231712]/15">
          <strong>Catatan Kepala Cabang:</strong> ${esc(item.note)}
        </p>
      </div>
    `).join('');
  }

  const reviewsContainer = document.getElementById('allReviewsContainer');
  const query = appState.reviewSearch.toLowerCase().trim();

  const searchedReviews = filtered
    .filter((r) => {
      if (appState.reviewStatusFilter !== 'ALL' && r.responseStatus !== appState.reviewStatusFilter) return false;
      if (query) {
        const hay = `${esc(r.comment)} ${esc(r.menu)} ${esc(r.topic)} ${esc(r.source)} ${esc(r.gender)} ${esc(r.ageGroup)}`.toLowerCase();
        if (!hay.includes(query)) return false;
      }
      return true;
    })
    .sort((a, b) => new Date(b.date) - new Date(a.date));

  if (searchedReviews.length === 0) {
    reviewsContainer.innerHTML = `
      <div class="p-8 rounded-xl bg-[#231712]/5 border border-[#231712]/20 text-center">
        <p class="text-sm font-extrabold text-[#231712]">Tidak ada ulasan yang cocok dengan pencarian Anda</p>
        <p class="text-xs text-[#231712]/75 mt-1">Coba ubah kata kunci pencarian atau reset filter di sidebar.</p>
      </div>
    `;
    return;
  }

  reviewsContainer.innerHTML = searchedReviews.map((rev) => {
    const avgStar = fmtRating(rev);
    const sentimentBadge = rev.satisfied === true
      ? `<span class="px-2.5 py-0.5 rounded-full text-[11px] font-extrabold bg-[#FAF9F6] border-[1.5px] border-[#231712] text-[#231712]">Puas</span>`
      : rev.satisfied === false
        ? `<span class="px-2.5 py-0.5 rounded-full text-[11px] font-extrabold bg-[#231712] text-[#FAF9F6]">Tidak Puas</span>`
        : `<span class="${NEUTRAL_BADGE_CLASS}">Belum dinilai</span>`;

    const isUnresponded = rev.responseStatus === 'Belum Ditanggapi';

    const sourceSpecificMeta = (rev.source === 'QR' && rev.ratings)
      ? `
        <div class="flex flex-wrap items-center gap-1.5 text-[11px] text-[#231712]/85 pt-1">
          <span class="px-2 py-0.5 rounded bg-[#231712]/5 font-semibold">Rasa: <strong>${esc(fmtStars(rev.ratings.rasa))}</strong></span>
          <span class="px-2 py-0.5 rounded bg-[#231712]/5 font-semibold">Harga: <strong>${esc(fmtStars(rev.ratings.harga))}</strong></span>
          <span class="px-2 py-0.5 rounded bg-[#231712]/5 font-semibold">Pelayanan: <strong>${esc(fmtStars(rev.ratings.pelayanan))}</strong></span>
          <span class="px-2 py-0.5 rounded bg-[#231712]/5 font-semibold">Tempat: <strong>${esc(fmtStars(rev.ratings.tempat))}</strong></span>
          <span class="px-2 py-0.5 rounded border border-[#231712]/25 font-bold">${esc(rev.gender)} • ${esc(rev.ageGroup)}</span>
        </div>
      `
      : `
        <div class="flex flex-wrap items-center gap-2 text-[11px] text-[#231712]/80 pt-1">
          <span class="px-2 py-0.5 rounded bg-[#231712]/5 font-bold">Bintang Umum: ${esc(rev.singleRating)}★</span>
          <span>• Sumber Publik (${esc(rev.source)})</span>
        </div>
      `;

    return `
      <div class="p-4 rounded-xl bg-[#FAF9F6] border border-[#231712]/25 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div class="space-y-1.5 flex-1">
          <div class="flex flex-wrap items-center gap-2">
            ${sentimentBadge}
            <span class="px-2 py-0.5 rounded text-[11px] font-extrabold border border-[#231712]/35 text-[#231712]">
              ${esc(rev.source)}
            </span>
            <span class="px-2 py-0.5 rounded text-[11px] font-bold bg-[#231712]/10 text-[#231712]">
              Topik: ${esc(rev.topic)}
            </span>
            <span class="px-2 py-0.5 rounded text-[11px] font-semibold border border-[#231712]/20 text-[#231712]/85">
              Menu: ${esc(rev.menu)}
            </span>
            <span class="text-[11px] text-[#231712]/65">${esc(rev.date)} • Rata-rata ${esc(avgStar)}</span>
          </div>

          <p class="text-xs sm:text-sm font-medium text-[#231712] leading-relaxed">
            "${esc(rev.comment)}"
          </p>

          ${sourceSpecificMeta}
        </div>

        <div class="flex sm:items-center justify-between lg:flex-col lg:items-end gap-2 shrink-0 pt-2 lg:pt-0 border-t lg:border-t-0 border-[#231712]/15">
          <span class="text-[11px] font-extrabold text-[#231712]">
            ${esc(rev.responseStatus)}
          </span>
          <button
            type="button"
            data-action="toggle-response" data-id="${esc(rev.id)}"
            class="px-3.5 py-1.5 rounded-xl text-xs font-bold transition cursor-pointer ${
              isUnresponded
                ? 'bg-[#231712] text-[#FAF9F6] hover:bg-[#231712]/90'
                : 'bg-[#FAF9F6] border-[1.5px] border-[#231712] text-[#231712] hover:bg-[#231712]/5'
            }"
          >
            ${isUnresponded ? 'Tandai Sudah Ditanggapi' : 'Sudah Ditanggapi ✓'}
          </button>
        </div>
      </div>
    `;
  }).join('');
}

function refreshAllViews() {
  const filtered = getFilteredReviews();
  syncSidebarUI();
  renderSummaryCards(filtered);
  renderActiveSuggestions();
  renderRecentNegativeReviews(filtered);
  renderTab1SVGCharts(filtered);
  renderTab2Analytics(filtered);
  renderTab3(filtered);
}

function switchTab(tabId) {
  if (!['tab1', 'tab2', 'tab3'].includes(tabId)) return;
  appState.activeTab = tabId;
  document.querySelectorAll('.tab-panel').forEach((panel) => {
    panel.classList.toggle('hidden', panel.id !== tabId);
  });

  document.querySelectorAll('.tab-btn').forEach((btn) => {
    const isActive = btn.dataset.tab === tabId;
    if (isActive) {
      btn.className = 'tab-btn py-2.5 px-2 sm:px-4 rounded-xl text-[11px] sm:text-xs md:text-sm font-bold text-center transition cursor-pointer bg-[#231712] text-[#FAF9F6]';
    } else {
      btn.className = 'tab-btn py-2.5 px-2 sm:px-4 rounded-xl text-[11px] sm:text-xs md:text-sm font-bold text-center transition cursor-pointer bg-[#FAF9F6] text-[#231712] border-[1.5px] border-[#231712]/25 hover:border-[#231712]';
    }
  });
}

document.addEventListener('DOMContentLoaded', () => {
  const loginForm = document.getElementById('loginForm');
  const loginErrorBox = document.getElementById('loginErrorBox');
  const loginEmail = document.getElementById('loginEmail');
  const loginPassword = document.getElementById('loginPassword');
  const loginSubmitBtn = document.getElementById('loginSubmitBtn');
  const loginSubmitText = document.getElementById('loginSubmitText');

  const showLoginError = (message) => {
    loginErrorBox.textContent = message;
    loginErrorBox.classList.remove('hidden');
  };

  const loginErrorMessage = (err) => {
    if (err.status === 0) return 'Server tidak bisa dihubungi. Pastikan API menyala dan alamatnya benar di config.js.';
    if (err.status === 401) return 'Email atau password salah.';
    if (err.status === 429) return 'Terlalu banyak percobaan login. Coba lagi 15 menit lagi.';
    if (err.status === 422) return (err.body && err.body.message) || 'Email dan password wajib diisi.';
    if (err.status === -1) return 'Jawaban server tidak dikenali.';
    return 'Login gagal. Coba lagi beberapa saat lagi.';
  };

  if (PROTOTIPE) document.getElementById('loginModeNote').classList.remove('hidden');

  document.getElementById('togglePasswordBtn').addEventListener('click', () => {
    const isPwd = loginPassword.type === 'password';
    loginPassword.type = isPwd ? 'text' : 'password';
    document.getElementById('togglePasswordBtn').textContent = isPwd ? 'Sembunyikan' : 'Tampilkan';
  });

  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = loginEmail.value.trim().toLowerCase();
    const password = loginPassword.value;
    if (!email || !password) {
      showLoginError('Harap isi email dan password terlebih dahulu.');
      return;
    }
    loginErrorBox.classList.add('hidden');

    if (PROTOTIPE) {
      startPrototypeSession();
      loginPassword.value = '';
      showDashboard();
      showToast('Masuk mode prototipe: belum tersambung ke API, login tidak diperiksa.');
      return;
    }

    loginSubmitBtn.disabled = true;
    loginSubmitText.textContent = 'Memeriksa...';
    try {
      const body = await apiFetch('/login', {
        method: 'POST',
        body: JSON.stringify({ email, password })
      });
      if (!body || typeof body.token !== 'string' || !startSession(body.token)) {
        throw Object.assign(new Error('token'), { status: -1 });
      }
      loginPassword.value = '';
      showDashboard();
      showToast(`Berhasil masuk sebagai ${session.name}.`);
    } catch (err) {
      showLoginError(loginErrorMessage(err));
    } finally {
      loginSubmitBtn.disabled = false;
      loginSubmitText.textContent = 'Masuk ke Dashboard';
    }
  });

  document.getElementById('logoutBtn').addEventListener('click', () => {
    endSession('Anda telah keluar dari dashboard.');
  });


  document.getElementById('mobileOpenSidebarBtn').addEventListener('click', openMobileSidebar);
  document.getElementById('mobileSidebarBackdrop').addEventListener('click', closeMobileSidebar);

  document.getElementById('closeSidebarBtn').addEventListener('click', () => {
    if (window.innerWidth < 1024) {
      closeMobileSidebar();
    } else {
      appState.desktopSidebarHidden = true;
      syncSidebarUI();
    }
  });

  document.getElementById('desktopToggleSidebarBtn').addEventListener('click', () => {
    appState.desktopSidebarHidden = !appState.desktopSidebarHidden;
    syncSidebarUI();
  });

  const readFilterInputs = () => {
    appState.filters.period = document.getElementById('filterPeriod').value;
    appState.filters.source = document.getElementById('filterSource').value;
    appState.filters.topic = document.getElementById('filterTopic').value;
    appState.filters.menu = document.getElementById('filterMenu').value;
  };

  ['filterPeriod', 'filterSource', 'filterTopic', 'filterMenu'].forEach((id) => {
    document.getElementById(id).addEventListener('change', () => {
      readFilterInputs();
      refreshAllViews();
    });
  });

  document.getElementById('applyFiltersBtn').addEventListener('click', () => {
    readFilterInputs();
    refreshAllViews();
    if (window.innerWidth < 1024) {
      closeMobileSidebar();
    }
    showToast('Filter data berhasil diterapkan.');
  });

  document.getElementById('resetFiltersBtn').addEventListener('click', () => {
    appState.filters = { period: '1w', source: 'ALL', topic: 'ALL', menu: 'ALL' };
    document.getElementById('filterPeriod').value = '1w';
    document.getElementById('filterSource').value = 'ALL';
    document.getElementById('filterTopic').value = 'ALL';
    document.getElementById('filterMenu').value = 'ALL';
    refreshAllViews();
    showToast('Seluruh filter dikembalikan ke pengaturan default.');
  });

  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  document.getElementById('suggestionInterval').addEventListener('change', async (e) => {
    const select = e.target;
    const label = select.value;

    if (PROTOTIPE) {
      appState.suggestionInterval = label;
    } else {
      select.disabled = true;
      try {
        applySettings(await apiFetch('/settings', {
          method: 'PATCH',
          body: JSON.stringify({ suggestion_interval: INTERVAL_KE_API[label] })
        }));
      } catch (err) {
        select.value = appState.suggestionInterval; // kembalikan ke pilihan yang tersimpan
        if (err.status === 0) showToast('Server tidak bisa dihubungi. Interval belum tersimpan.');
        else if (err.status !== 401) showToast((err.body && err.body.message) || 'Interval belum tersimpan. Coba lagi.');
        return;
      } finally {
        select.disabled = !bolehUbahPengaturan();
      }
    }

    renderActiveSuggestions();
    showToast(`Interval saran diubah ke: ${appState.suggestionInterval}.`);
  });

  const thresholdSlider = document.getElementById('thresholdSlider');
  const thresholdNumberInput = document.getElementById('thresholdNumberInput');

  thresholdSlider.addEventListener('input', (e) => {
    thresholdNumberInput.value = e.target.value;
  });
  thresholdNumberInput.addEventListener('input', (e) => {
    let v = parseInt(e.target.value, 10);
    if (isNaN(v)) v = 5;
    v = Math.min(25, Math.max(2, v));
    thresholdSlider.value = v;
  });
  document.getElementById('saveThresholdBtn').addEventListener('click', async () => {
    let v = parseInt(thresholdNumberInput.value, 10);
    if (isNaN(v) || v < 2) v = 2;
    if (v > 25) v = 25;
    thresholdNumberInput.value = v;
    thresholdSlider.value = v;

    if (PROTOTIPE) {
      appState.threshold = v;
      document.getElementById('currentThresholdLabel').textContent = `${v} keluhan baru`;
    } else {
      const btn = document.getElementById('saveThresholdBtn');
      btn.disabled = true;
      try {
        applySettings(await apiFetch('/settings', {
          method: 'PATCH',
          body: JSON.stringify({ suggestion_threshold: v })
        }));
      } catch (err) {
        if (err.status === 0) showToast('Server tidak bisa dihubungi. Ambang belum tersimpan.');
        else if (err.status !== 401) showToast((err.body && err.body.message) || 'Ambang belum tersimpan. Coba lagi.');
        return;
      } finally {
        btn.disabled = !bolehUbahPengaturan();
      }
    }

    refreshAllViews();
    showToast(`Ambang munculnya saran disimpan: ${appState.threshold} keluhan baru.`);
  });

  document.getElementById('reviewSearchInput').addEventListener('input', (e) => {
    appState.reviewSearch = e.target.value;
    renderTab3(getFilteredReviews());
  });
  document.getElementById('reviewStatusFilter').addEventListener('change', (e) => {
    appState.reviewStatusFilter = e.target.value;
    renderTab3(getFilteredReviews());
  });

  const manualModal = document.getElementById('manualReviewModal');
  document.getElementById('openManualModalBtn').addEventListener('click', () => {
    closeMobileSidebar();
    const dateInput = document.getElementById('manualDate');
    dateInput.max = todayISO();
    if (!dateInput.value) dateInput.value = todayISO();
    manualModal.classList.remove('hidden');
    manualModal.classList.add('flex');
  });
  const closeManualModal = () => {
    manualModal.classList.add('hidden');
    manualModal.classList.remove('flex');
  };
  document.getElementById('closeManualModalBtn').addEventListener('click', closeManualModal);
  document.getElementById('cancelManualModalBtn').addEventListener('click', closeManualModal);

  document.querySelectorAll('.star-choice').forEach((btn) => {
    btn.addEventListener('click', () => {
      const val = parseInt(btn.dataset.star, 10);
      document.getElementById('manualRatingValue').value = val;
      document.querySelectorAll('.star-choice').forEach((b) => {
        const bVal = parseInt(b.dataset.star, 10);
        if (bVal === val) {
          b.className = 'star-choice w-9 h-9 rounded-xl border-[1.5px] border-[#231712] bg-[#231712] text-[#FAF9F6] text-xs font-bold transition cursor-pointer';
        } else {
          b.className = 'star-choice w-9 h-9 rounded-xl border-[1.5px] border-[#231712] bg-[#FAF9F6] text-[#231712] text-xs font-bold transition cursor-pointer';
        }
      });
    });
  });

  document.getElementById('manualReviewForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const source = document.getElementById('manualSource').value;
    const date = document.getElementById('manualDate').value || todayISO();
    const rating = parseInt(document.getElementById('manualRatingValue').value, 10) || 5;
    const topic = document.getElementById('manualTopic').value;
    const comment = document.getElementById('manualComment').value.trim();

    if (comment.length < 3) {
      showToast('Teks ulasan minimal 3 karakter.');
      return;
    }

    // Mode prototipe (tanpa API): ulasan hanya disimpan sementara di browser ini.
    if (PROTOTIPE) {
      appState.reviews.unshift({
        id: 'LOKAL-' + Date.now(),
        date,
        source,
        satisfied: rating >= 4,
        topic,
        menu: MENU_UMUM,
        ratings: null,
        singleRating: rating,
        averageRating: rating,
        gender: 'Non-QR',
        ageGroup: 'Non-QR',
        comment,
        responseStatus: 'Belum Ditanggapi'
      });
      document.getElementById('manualComment').value = '';
      closeManualModal();
      refreshAllViews();
      showToast(`Ulasan ${source} ditambahkan (mode prototipe, hanya di browser ini).`);
      return;
    }

    const submitBtn = e.submitter || e.target.querySelector('[type="submit"]');
    submitBtn.disabled = true;
    let savedId = null;
    try {
      const body = await apiFetch('/reviews/manual', {
        method: 'POST',
        body: JSON.stringify({
          text: comment,
          source: source === 'Google Maps' ? 'google_maps' : 'social_media',
          review_date: date,
          rating,
          topic: topic.toLowerCase()
        })
      });
      savedId = body && body.id;
    } catch (err) {
      if (err.status === 0) showToast('Server tidak bisa dihubungi. Ulasan belum tersimpan.');
      else if (err.status !== 401) showToast((err.body && err.body.message) || 'Ulasan belum tersimpan. Coba lagi.');
      return;
    } finally {
      submitBtn.disabled = false;
    }

    document.getElementById('manualComment').value = '';
    closeManualModal();

    // Ambil ulang dari API supaya puas/tidak puas & rata-rata memakai hitungan backend.
    try {
      await loadDashboardData();
    } catch (err) {
      if (err.status !== 401) showToast('Ulasan tersimpan, tapi dashboard gagal dimuat ulang. Muat ulang halaman.');
      return;
    }
    if (!appState.isLoggedIn) return;
    refreshAllViews();
    showToast(`Ulasan ${source} tersimpan di database (id ${savedId}).`);
  });

    // Analisis AI: kirim ulasan 7 hari terakhir ke AI lewat backend.
  document.getElementById('runAiReportBtn').addEventListener('click', async () => {
    closeMobileSidebar();
    if (PROTOTIPE) {
      showToast('Mode prototipe: analisis AI butuh API.');
      return;
    }
    const btn = document.getElementById('runAiReportBtn');
    const label = document.getElementById('runAiReportText');
    btn.disabled = true;
    label.textContent = 'Menganalisis... (bisa 1–2 menit)';
    try {
      const hasil = await apiFetch('/reports/weekly', { method: 'POST', body: '{}', timeoutMs: 300000 });
      await loadDashboardData();
      if (!appState.isLoggedIn) return;
      refreshAllViews();
      showToast(`Analisis selesai: ${hasil.analyzed_reviews} ulasan dinilai AI, ${hasil.suggestions_created} saran dibuat.`);
    } catch (err) {
      if (err.status === 0) showToast('Analisis gagal: server tidak bisa dihubungi atau terlalu lama.');
      else if (err.status !== 401) showToast((err.body && err.body.message) || 'Analisis AI gagal. Coba lagi.');
    } finally {
      btn.disabled = false;
      label.textContent = 'Jalankan Analisis AI (7 hari)';
    }
  });

  document.getElementById('exportCsvBtn').addEventListener('click', () => {
    const filtered = getFilteredReviews();
    const headers = ['ID', 'Tanggal', 'Sumber', 'Sentimen', 'Topik', 'Menu', 'RataRataBintang', 'StatusTanggapan', 'Komentar'];
    const rows = filtered.map((r) => [
      r.id,
      r.date,
      r.source,
      r.satisfied === true ? 'Puas' : r.satisfied === false ? 'Tidak Puas' : 'Belum dinilai',
      r.topic,
      r.menu,
      getReviewAverageRating(r) ?? '',
      r.responseStatus,
      r.comment
    ].map(csvCell));

    const csvContent = '\uFEFF' + [headers.map(csvCell).join(','), ...rows.map((row) => row.join(','))].join('\r\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `VoC_HarapanDjaja_GunungAnyar_${appState.filters.period}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    closeMobileSidebar();
    showToast(`Berhasil mengunduh CSV (${filtered.length} ulasan terfilter).`);
  });

  const pdfModal = document.getElementById('pdfPreviewModal');
  document.getElementById('exportPdfBtn').addEventListener('click', () => {
    closeMobileSidebar();
    const filtered = getFilteredReviews();
    const total = filtered.length;
    const satCount = filtered.filter((r) => r.satisfied === true).length;
    const negList = filtered.filter((r) => r.satisfied === false);
    const satPct = satCount + negList.length > 0 ? Math.round((satCount / (satCount + negList.length)) * 100) : 0;

    const periodText = document.getElementById('filterPeriod').selectedOptions[0].text;
    document.getElementById('pdfPrintDate').textContent = new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
    document.getElementById('pdfPrintedBy').textContent = session.name || '-';
    document.getElementById('pdfFilterSubtitle').textContent = `Periode: ${periodText} • Sumber: ${appState.filters.source}`;

    document.getElementById('pdfSummaryGrid').innerHTML = `
      <div class="p-3 border-[1.5px] border-[#231712] rounded-xl">
        <span class="block text-[10px] font-bold uppercase text-[#231712]/70">Total Ulasan</span>
        <span class="text-lg font-extrabold">${total} Ulasan</span>
      </div>
      <div class="p-3 border-[1.5px] border-[#231712] rounded-xl">
        <span class="block text-[10px] font-bold uppercase text-[#231712]/70">Persentase Puas</span>
        <span class="text-lg font-extrabold">${satPct}% Puas</span>
      </div>
      <div class="p-3 border-[1.5px] border-[#231712] rounded-xl">
        <span class="block text-[10px] font-bold uppercase text-[#231712]/70">Ulasan Negatif</span>
        <span class="text-lg font-extrabold">${negList.length} Ulasan</span>
      </div>
      <div class="p-3 border-[1.5px] border-[#231712] rounded-xl">
        <span class="block text-[10px] font-bold uppercase text-[#231712]/70">Saran Terlaksana</span>
        <span class="text-lg font-extrabold">${appState.completedSuggestions.length} Tindakan</span>
      </div>
    `;

    document.getElementById('pdfSuggestionsList').innerHTML = getShownSuggestions().map((s, i) => `
      <div class="p-2.5 border border-[#231712]/25 rounded-lg">
        <strong>${i + 1}. [${esc(s.priority)} • ${esc(s.topic)}]</strong> ${esc(s.text)}
        <span class="block text-[11px] text-[#231712]/75 mt-0.5">${esc(s.reason)}</span>
      </div>
    `).join('');

    document.getElementById('pdfNegativeList').innerHTML = negList.slice(0, 5).map((r) => `
      <div class="p-2.5 border border-[#231712]/25 rounded-lg">
        <strong>[${esc(r.date)} • ${esc(r.source)} • ${esc(r.topic)}]</strong> "${esc(r.comment)}"
        <span class="block text-[11px] text-[#231712]/75 mt-0.5">Status: ${esc(r.responseStatus)}</span>
      </div>
    `).join('') || '<p>Tidak ada ulasan negatif pada periode ini.</p>';

    pdfModal.classList.remove('hidden');
    pdfModal.classList.add('flex');
  });

  document.getElementById('closePdfModalBtn').addEventListener('click', () => {
    pdfModal.classList.add('hidden');
    pdfModal.classList.remove('flex');
  });

  document.getElementById('printPdfBtn').addEventListener('click', () => window.print());

  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    const id = el.dataset.id;
    switch (el.dataset.action) {
      case 'switch-tab': switchTab(el.dataset.target); break;
      case 'toggle-complete': toggleCompleteForm(id); break;
      case 'confirm-done': confirmSuggestionDone(id); break;
      case 'toggle-response': toggleReviewResponseStatus(id); break;
      default: break;
    }
  });

  const savedToken = readStoredToken();
  if (!PROTOTIPE && savedToken && startSession(savedToken)) {
    showDashboard();
  } else {
    storeToken(null);
  }
});
