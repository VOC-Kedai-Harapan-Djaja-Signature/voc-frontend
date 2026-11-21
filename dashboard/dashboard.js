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
  appState.reviews = [...initialReviews];
  appState.activeSuggestions = [...initialActiveSuggestions];
  appState.completedSuggestions = [...initialCompletedSuggestions];

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
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (session.token) headers.Authorization = `Bearer ${session.token}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
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

function showDashboard() {
  appState.isLoggedIn = true;
  appState.mobileSidebarOpen = false;

  const roleText = PROTOTIPE ? 'data contoh' : (ROLE_LABEL[session.role] || session.role || 'Pengguna');
  document.getElementById('greetingText').textContent = `Halo, ${session.name} (${roleText})`;
  document.getElementById('dataModeText').textContent = PROTOTIPE
    ? 'Mode prototipe: belum tersambung ke API. Semua angka dan ulasan di bawah adalah data contoh.'
    : 'Login sudah memakai API. Ringkasan, grafik, saran, dan daftar ulasan di bawah masih data contoh sampai endpoint dashboard dibuat.';

  document.getElementById('loginScreen').classList.add('hidden');
  document.getElementById('dashboardApp').classList.remove('hidden');
  refreshAllViews();
}

const REFERENCE_DATE = new Date('2026-11-20T12:00:00');

const initialReviews = [
  {
    id: 'REV-201',
    date: '2026-11-20',
    source: 'QR',
    satisfied: false,
    topic: 'Rasa',
    menu: 'Kopi Susu Djaja',
    ratings: { rasa: 2, harga: 4, pelayanan: 4, tempat: 4 },
    gender: 'Perempuan',
    ageGroup: '20–25 thn',
    comment: 'Kopi Susu Djaja hari ini terlalu manis, rasa kopinya ketutup sirup gula aren. Biasanya pas.',
    responseStatus: 'Belum Ditanggapi'
  },
  {
    id: 'REV-202',
    date: '2026-11-20',
    source: 'QR',
    satisfied: true,
    topic: 'Pelayanan',
    menu: 'Croissant Butter',
    ratings: { rasa: 5, harga: 4, pelayanan: 5, tempat: 5 },
    gender: 'Laki-laki',
    ageGroup: '26–35 thn',
    comment: 'Barista ramah banget dan cekatan. Croissant Butter disajikan hangat dan renyah.',
    responseStatus: 'Sudah Ditanggapi'
  },
  {
    id: 'REV-203',
    date: '2026-11-19',
    source: 'Google Maps',
    satisfied: false,
    topic: 'Pelayanan',
    menu: 'Nasi Goreng Signature',
    singleRating: 2,
    gender: 'Non-QR',
    ageGroup: 'Non-QR',
    comment: 'Datang jam makan malam antre lama hampir 25 menit baru Nasi Goreng Signature keluar.',
    responseStatus: 'Belum Ditanggapi'
  },
  {
    id: 'REV-204',
    date: '2026-11-19',
    source: 'QR',
    satisfied: true,
    topic: 'Rasa',
    menu: 'Es Kopi Aren',
    ratings: { rasa: 5, harga: 5, pelayanan: 5, tempat: 4 },
    gender: 'Laki-laki',
    ageGroup: '20–25 thn',
    comment: 'Es Kopi Aren seger banget diminum siang-siang di Gunung Anyar, manisnya pas.',
    responseStatus: 'Sudah Ditanggapi'
  },
  {
    id: 'REV-205',
    date: '2026-11-18',
    source: 'Media Sosial',
    satisfied: false,
    topic: 'Tempat',
    menu: 'Umum / Tidak Menyebut Menu',
    singleRating: 2,
    gender: 'Non-QR',
    ageGroup: 'Non-QR',
    comment: 'Area dalam sore tadi terasa panas karena AC kurang dingin waktu meja penuh mahasiswa.',
    responseStatus: 'Belum Ditanggapi'
  },
  {
    id: 'REV-206',
    date: '2026-11-18',
    source: 'QR',
    satisfied: true,
    topic: 'Tempat',
    menu: 'Matcha Latte',
    ratings: { rasa: 5, harga: 4, pelayanan: 5, tempat: 5 },
    gender: 'Perempuan',
    ageGroup: '20–25 thn',
    comment: 'Matcha Latte creamy dan tidak pahit. Stopkontak banyak, nyaman buat nugas kuliah.',
    responseStatus: 'Sudah Ditanggapi'
  },
  {
    id: 'REV-207',
    date: '2026-11-17',
    source: 'QR',
    satisfied: false,
    topic: 'Rasa',
    menu: 'Kopi Susu Djaja',
    ratings: { rasa: 2, harga: 4, pelayanan: 4, tempat: 4 },
    gender: 'Perempuan',
    ageGroup: '< 20 thn',
    comment: 'Kopi Susu Djaja terlalu manis buat saya, tolong takaran gulanya dikurangi sedikit.',
    responseStatus: 'Belum Ditanggapi'
  },
  {
    id: 'REV-208',
    date: '2026-11-17',
    source: 'Google Maps',
    satisfied: true,
    topic: 'Rasa',
    menu: 'Nasi Goreng Signature',
    singleRating: 5,
    gender: 'Non-QR',
    ageGroup: 'Non-QR',
    comment: 'Nasi Goreng Signature bumbunya medok dan porsinya mengenyangkan. Rekomen!',
    responseStatus: 'Sudah Ditanggapi'
  },
  {
    id: 'REV-209',
    date: '2026-11-16',
    source: 'QR',
    satisfied: false,
    topic: 'Harga',
    menu: 'Matcha Latte',
    ratings: { rasa: 4, harga: 2, pelayanan: 4, tempat: 4 },
    gender: 'Laki-laki',
    ageGroup: '< 20 thn',
    comment: 'Rasa Matcha Latte enak, tapi harga agak mahal untuk ukuran gelas reguler mahasiswa.',
    responseStatus: 'Sudah Ditanggapi'
  },
  {
    id: 'REV-210',
    date: '2026-11-15',
    source: 'QR',
    satisfied: true,
    topic: 'Harga',
    menu: 'Croissant Butter',
    ratings: { rasa: 5, harga: 5, pelayanan: 4, tempat: 5 },
    gender: 'Perempuan',
    ageGroup: '26–35 thn',
    comment: 'Harga Croissant Butter sebanding dengan kualitas butternya yang wangi dan berlapis.',
    responseStatus: 'Sudah Ditanggapi'
  },
  {
    id: 'REV-211',
    date: '2026-11-15',
    source: 'Media Sosial',
    satisfied: true,
    topic: 'Pelayanan',
    menu: 'Es Kopi Aren',
    singleRating: 5,
    gender: 'Non-QR',
    ageGroup: 'Non-QR',
    comment: 'Pesan Es Kopi Aren lewat kasir cepat dilayani, staf ramah menyapa.',
    responseStatus: 'Sudah Ditanggapi'
  },
  {
    id: 'REV-212',
    date: '2026-11-14',
    source: 'QR',
    satisfied: true,
    topic: 'Tempat',
    menu: 'Umum / Tidak Menyebut Menu',
    ratings: { rasa: 4, harga: 4, pelayanan: 5, tempat: 5 },
    gender: 'Laki-laki',
    ageGroup: '> 35 thn',
    comment: 'Area parkir cabang Gunung Anyar tertata rapi dan musala bersih.',
    responseStatus: 'Sudah Ditanggapi'
  },

  {
    id: 'REV-213',
    date: '2026-11-12',
    source: 'QR',
    satisfied: false,
    topic: 'Tempat',
    menu: 'Umum / Tidak Menyebut Menu',
    ratings: { rasa: 4, harga: 4, pelayanan: 4, tempat: 2 },
    gender: 'Laki-laki',
    ageGroup: '26–35 thn',
    comment: 'Parkir motor penuh meluber ke depan pas malam minggu, agak susah keluar.',
    responseStatus: 'Sudah Ditanggapi'
  },
  {
    id: 'REV-214',
    date: '2026-11-11',
    source: 'Google Maps',
    satisfied: true,
    topic: 'Rasa',
    menu: 'Kopi Susu Djaja',
    singleRating: 5,
    gender: 'Non-QR',
    ageGroup: 'Non-QR',
    comment: 'Kopi Susu Djaja selalu jadi favorit kalau lewat MERR Gunung Anyar.',
    responseStatus: 'Sudah Ditanggapi'
  },
  {
    id: 'REV-215',
    date: '2026-11-10',
    source: 'QR',
    satisfied: false,
    topic: 'Pelayanan',
    menu: 'Es Kopi Aren',
    ratings: { rasa: 4, harga: 4, pelayanan: 2, tempat: 4 },
    gender: 'Perempuan',
    ageGroup: '20–25 thn',
    comment: 'Antre di kasir agak lama waktu jam pulang kerja karena cuma satu barista yang jaga.',
    responseStatus: 'Sudah Ditanggapi'
  },
  {
    id: 'REV-216',
    date: '2026-11-08',
    source: 'QR',
    satisfied: true,
    topic: 'Rasa',
    menu: 'Matcha Latte',
    ratings: { rasa: 5, harga: 4, pelayanan: 5, tempat: 5 },
    gender: 'Perempuan',
    ageGroup: '20–25 thn',
    comment: 'Matcha Latte-nya autentik, tidak bikin enek.',
    responseStatus: 'Sudah Ditanggapi'
  },

  {
    id: 'REV-217',
    date: '2026-11-05',
    source: 'Media Sosial',
    satisfied: false,
    topic: 'Rasa',
    menu: 'Kopi Susu Djaja',
    singleRating: 2,
    gender: 'Non-QR',
    ageGroup: 'Non-QR',
    comment: 'Kopi Susu Djaja terlalu manis dan es batunya cepat mencair.',
    responseStatus: 'Sudah Ditanggapi'
  },
  {
    id: 'REV-218',
    date: '2026-11-03',
    source: 'QR',
    satisfied: true,
    topic: 'Pelayanan',
    menu: 'Croissant Butter',
    ratings: { rasa: 5, harga: 4, pelayanan: 5, tempat: 4 },
    gender: 'Laki-laki',
    ageGroup: '26–35 thn',
    comment: 'Pelayanan cepat dan ramah. Croissant Butter selalu fresh dari oven.',
    responseStatus: 'Sudah Ditanggapi'
  },
  {
    id: 'REV-219',
    date: '2026-11-01',
    source: 'Google Maps',
    satisfied: true,
    topic: 'Tempat',
    menu: 'Umum / Tidak Menyebut Menu',
    singleRating: 5,
    gender: 'Non-QR',
    ageGroup: 'Non-QR',
    comment: 'Tempatnya estetik dan bersih, cocok untuk rapat kecil.',
    responseStatus: 'Sudah Ditanggapi'
  },

  {
    id: 'REV-220',
    date: '2026-10-28',
    source: 'QR',
    satisfied: false,
    topic: 'Harga',
    menu: 'Nasi Goreng Signature',
    ratings: { rasa: 4, harga: 2, pelayanan: 4, tempat: 4 },
    gender: 'Laki-laki',
    ageGroup: '20–25 thn',
    comment: 'Nasi Goreng Signature enak tapi harganya lumayan mahal kalau tanpa paket minum.',
    responseStatus: 'Sudah Ditanggapi'
  },
  {
    id: 'REV-221',
    date: '2026-10-25',
    source: 'QR',
    satisfied: true,
    topic: 'Rasa',
    menu: 'Es Kopi Aren',
    ratings: { rasa: 5, harga: 5, pelayanan: 5, tempat: 5 },
    gender: 'Perempuan',
    ageGroup: '26–35 thn',
    comment: 'Es Kopi Aren mantap, aroma gula arennya wangi.',
    responseStatus: 'Sudah Ditanggapi'
  },

  {
    id: 'REV-222',
    date: '2026-09-15',
    source: 'Google Maps',
    satisfied: true,
    topic: 'Rasa',
    menu: 'Kopi Susu Djaja',
    singleRating: 5,
    gender: 'Non-QR',
    ageGroup: 'Non-QR',
    comment: 'Kopi Susu Djaja terbaik di daerah Surabaya Timur.',
    responseStatus: 'Sudah Ditanggapi'
  },
  {
    id: 'REV-223',
    date: '2026-08-19',
    source: 'Media Sosial',
    satisfied: false,
    topic: 'Tempat',
    menu: 'Umum / Tidak Menyebut Menu',
    singleRating: 2,
    gender: 'Non-QR',
    ageGroup: 'Non-QR',
    comment: 'Area outdoor siang hari panas kalau matahari terik.',
    responseStatus: 'Sudah Ditanggapi'
  },
  {
    id: 'REV-224',
    date: '2026-07-10',
    source: 'Google Maps',
    satisfied: true,
    topic: 'Pelayanan',
    menu: 'Croissant Butter',
    singleRating: 5,
    gender: 'Non-QR',
    ageGroup: 'Non-QR',
    comment: 'Staf sangat membantu dan sopan. Croissant Butter enak.',
    responseStatus: 'Sudah Ditanggapi'
  }
];

const initialActiveSuggestions = [
  {
    id: 'SUG-01',
    priority: 'Mendesak',
    topic: 'Rasa',
    complaintCount: 9,
    text: 'Kurangi takaran sirup gula aren pada menu Kopi Susu Djaja sebesar 15% dan sediakan opsi less sugar di kasir.',
    reason: 'Berdasarkan 9 keluhan topik Rasa mengenai minuman terlalu manis dalam periode ini.'
  },
  {
    id: 'SUG-02',
    priority: 'Sedang',
    topic: 'Pelayanan',
    complaintCount: 6,
    text: 'Tambah 1 personel barista/dapur pendukung saat jam sibuk sore dan makan malam (17.00–20.30 WIB).',
    reason: 'Berdasarkan 6 keluhan topik Pelayanan terkait antrean dan waktu tunggu pesanan lama.'
  },
  {
    id: 'SUG-03',
    priority: 'Sedang',
    topic: 'Tempat',
    complaintCount: 5,
    text: 'Turunkan suhu AC ruang utama menjadi 20°C saat tingkat hunian meja di atas 70% dan bersihkan filter berkala.',
    reason: 'Berdasarkan 5 keluhan topik Tempat mengenai ruangan terasa panas saat sore hari.'
  },
  {
    id: 'SUG-04',
    priority: 'Rendah',
    topic: 'Harga',
    complaintCount: 3,
    text: 'Buat paket bundling hemat mahasiswa (Matcha Latte / Kopi Susu Djaja + Croissant Butter) di papan kasir.',
    reason: 'Berdasarkan 3 masukan topik Harga yang menginginkan porsi/harga lebih ramah mahasiswa.'
  }
];

const initialCompletedSuggestions = [
  {
    id: 'DONE-01',
    completedDate: '2026-11-12',
    topic: 'Pelayanan',
    priority: 'Mendesak',
    text: 'Pasang papan petunjuk langkah pembayaran QRIS di meja kasir agar transaksi tidak menumpuk.',
    note: 'Sudah dipasang akrilik petunjuk QRIS di kasir dan staf sudah dibriefing.'
  },
  {
    id: 'DONE-02',
    completedDate: '2026-11-06',
    topic: 'Rasa',
    priority: 'Sedang',
    text: 'Beralih ke es batu kristal padat (cube) agar minuman dingin tidak cepat encer.',
    note: 'Sudah ganti supplier es batu kristal padat sejak awal November.'
  }
];

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
  reviews: [...initialReviews],
  activeSuggestions: [...initialActiveSuggestions],
  completedSuggestions: [...initialCompletedSuggestions],
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
  if (rev.source === 'QR' && rev.ratings) {
    const { rasa, harga, pelayanan, tempat } = rev.ratings;
    return (rasa + harga + pelayanan + tempat) / 4;
  }
  return rev.singleRating || 3;
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

function getFilteredReviews() {
  const maxDays = getDaysCutoff(appState.filters.period);
  return appState.reviews.filter((r) => {
    const revDate = new Date(r.date + 'T12:00:00');
    const diffDays = Math.floor((REFERENCE_DATE - revDate) / (1000 * 60 * 60 * 24));
    if (diffDays > maxDays) return false;
    if (appState.filters.source !== 'ALL' && r.source !== appState.filters.source) return false;
    if (appState.filters.topic !== 'ALL' && r.topic !== appState.filters.topic) return false;
    if (appState.filters.menu !== 'ALL' && r.menu !== appState.filters.menu) return false;
    return true;
  });
}

function countActiveNonDefaultFilters() {
  let count = 0;
  if (appState.filters.period !== '1w') count++;
  if (appState.filters.source !== 'ALL') count++;
  if (appState.filters.topic !== 'ALL') count++;
  if (appState.filters.menu !== 'ALL') count++;
  return count;
}

function simulateAIAnalysis(commentText, stars) {
  const lower = commentText.toLowerCase();
  const satisfied = stars >= 4;

  let menu = 'Umum / Tidak Menyebut Menu';
  if (lower.includes('kopi susu djaja') || lower.includes('kopi susu')) {
    menu = 'Kopi Susu Djaja';
  } else if (lower.includes('kopi aren') || lower.includes('aren')) {
    menu = 'Es Kopi Aren';
  } else if (lower.includes('matcha')) {
    menu = 'Matcha Latte';
  } else if (lower.includes('croissant')) {
    menu = 'Croissant Butter';
  } else if (lower.includes('nasi goreng')) {
    menu = 'Nasi Goreng Signature';
  }

  return { satisfied, menu };
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
  const satisfiedCount = filtered.filter((r) => r.satisfied).length;
  const satisfiedPct = total > 0 ? Math.round((satisfiedCount / total) * 100) : 0;

  const negReviews = filtered.filter((r) => !r.satisfied);
  const unrespondedNeg = negReviews.filter((r) => r.responseStatus === 'Belum Ditanggapi').length;

  let sumRasa = 0, cntRasa = 0;
  let sumHarga = 0, cntHarga = 0;
  let sumPelayanan = 0, cntPelayanan = 0;
  let sumTempat = 0, cntTempat = 0;

  filtered.forEach((r) => {
    const avg = getReviewAverageRating(r);
    if (r.source === 'QR' && r.ratings) {
      sumRasa += r.ratings.rasa; cntRasa++;
      sumHarga += r.ratings.harga; cntHarga++;
      sumPelayanan += r.ratings.pelayanan; cntPelayanan++;
      sumTempat += r.ratings.tempat; cntTempat++;
    } else {
      if (r.topic === 'Rasa') { sumRasa += avg; cntRasa++; }
      if (r.topic === 'Harga') { sumHarga += avg; cntHarga++; }
      if (r.topic === 'Pelayanan') { sumPelayanan += avg; cntPelayanan++; }
      if (r.topic === 'Tempat') { sumTempat += avg; cntTempat++; }
    }
  });

  const rasaAvg = cntRasa > 0 ? (sumRasa / cntRasa).toFixed(1) : '0.0';
  const hargaAvg = cntHarga > 0 ? (sumHarga / cntHarga).toFixed(1) : '0.0';
  const pelayananAvg = cntPelayanan > 0 ? (sumPelayanan / cntPelayanan).toFixed(1) : '0.0';
  const tempatAvg = cntTempat > 0 ? (sumTempat / cntTempat).toFixed(1) : '0.0';

  const prevScore = total > 0 ? Math.max(45, Math.min(92, satisfiedPct - 4)) : 0;
  const diffPoints = satisfiedPct - prevScore;

  document.getElementById('topBarCountBadge').textContent = `${total} ulasan ditampilkan`;
  document.getElementById('kpiTotalCount').textContent = total;
  document.getElementById('kpiSatisfiedPct').textContent = `${satisfiedPct}%`;
  document.getElementById('kpiTotalTrend').textContent = total >= 8 ? '▲ +12%' : '▲ +5%';

  document.getElementById('kpiUnrespondedNeg').textContent = unrespondedNeg;
  document.getElementById('kpiTotalNeg').textContent = negReviews.length;
  document.getElementById('kpiNegTrend').textContent = unrespondedNeg <= 3 ? '▼ -1' : '▲ +1';

  document.getElementById('kpiActiveSugCount').textContent = appState.activeSuggestions.length;
  document.getElementById('kpiDoneSugCount').textContent = appState.completedSuggestions.length;

  document.getElementById('aspectRasaVal').textContent = `${rasaAvg}★`;
  document.getElementById('aspectHargaVal').textContent = `${hargaAvg}★`;
  document.getElementById('aspectPelayananVal').textContent = `${pelayananAvg}★`;
  document.getElementById('aspectTempatVal').textContent = `${tempatAvg}★`;

  document.getElementById('kpiCurrentScore').textContent = `${satisfiedPct}%`;
  document.getElementById('kpiPrevScore').textContent = `${prevScore}%`;
  const diffBadge = document.getElementById('kpiSatisfactionDiffBadge');
  if (diffPoints >= 0) {
    diffBadge.textContent = `▲ +${diffPoints}% poin`;
    diffBadge.className = 'px-2 py-0.5 rounded-full text-[11px] font-extrabold bg-[#231712] text-[#FAF9F6]';
  } else {
    diffBadge.textContent = `▼ ${diffPoints}% poin`;
    diffBadge.className = 'px-2 py-0.5 rounded-full text-[11px] font-extrabold border-[1.5px] border-[#231712] text-[#231712]';
  }
}

function renderActiveSuggestions() {
  const container = document.getElementById('activeSuggestionsList');
  const items = appState.activeSuggestions.filter((s) => {
    if (appState.filters.topic !== 'ALL' && s.topic !== appState.filters.topic) return false;
    return true;
  });

  if (items.length === 0) {
    container.innerHTML = `
      <div class="p-6 rounded-xl bg-[#231712]/5 border border-[#231712]/20 text-center">
        <p class="text-sm font-extrabold text-[#231712]">Tidak ada saran aktif untuk topik ini</p>
        <p class="text-xs text-[#231712]/75 mt-1">
          Saran baru akan muncul otomatis apabila tercatat ${esc(appState.threshold)} keluhan baru pada topik yang sama.
        </p>
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
    .filter((r) => !r.satisfied)
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

    const avgStar = getReviewAverageRating(rev).toFixed(1);

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
            <span class="text-[11px] font-extrabold text-[#231712]">${avgStar}★</span>
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

function toggleReviewResponseStatus(revId) {
  const target = appState.reviews.find((r) => r.id === revId);
  if (!target) return;
  target.responseStatus = target.responseStatus === 'Belum Ditanggapi'
    ? 'Sudah Ditanggapi'
    : 'Belum Ditanggapi';
  refreshAllViews();
  showToast(`Status ulasan diperbarui menjadi "${target.responseStatus}".`);
}

function renderTab1SVGCharts(filtered) {
  const labelsByPeriod = {
    '1w': ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'],
    '2w': ['M1 Awal', 'M1 Akhir', 'M2 Awal', 'M2 Akhir'],
    '3w': ['Minggu 1', 'Minggu 2', 'Minggu 3'],
    '1m': ['Pekan 1', 'Pekan 2', 'Pekan 3', 'Pekan 4'],
    '1y': ['Q1', 'Q2', 'Q3', 'Q4']
  };
  const labels = labelsByPeriod[appState.filters.period] || labelsByPeriod['1w'];
  const scale = Math.max(0.4, filtered.length / 12);

  const puasPoints = labels.map((_, i) => Math.max(1, Math.round((3 + i * 1.1) * scale)));
  const negPoints = labels.map((_, i) => Math.max(0, Math.round((2.5 - (i % 3) * 0.6) * scale)));

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

  const topics = ['Rasa', 'Harga', 'Pelayanan', 'Tempat'];
  const counts = topics.map((t) => filtered.filter((r) => !r.satisfied && r.topic === t).length);
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

  const starCounts = [0, 0, 0, 0, 0];
  filtered.forEach((r) => {
    const rounded = Math.min(5, Math.max(1, Math.round(getReviewAverageRating(r))));
    starCounts[rounded - 1]++;
  });

  document.getElementById('chartStarDistribution').innerHTML = [5, 4, 3, 2, 1].map((star) => {
    const cnt = starCounts[star - 1];
    const pct = total > 0 ? Math.round((cnt / total) * 100) : 0;
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

  const topicComparison = [
    { topic: 'Rasa', prev: 6, curr: filtered.filter((r) => !r.satisfied && r.topic === 'Rasa').length },
    { topic: 'Pelayanan', prev: 7, curr: filtered.filter((r) => !r.satisfied && r.topic === 'Pelayanan').length },
    { topic: 'Tempat', prev: 4, curr: filtered.filter((r) => !r.satisfied && r.topic === 'Tempat').length },
    { topic: 'Harga', prev: 3, curr: filtered.filter((r) => !r.satisfied && r.topic === 'Harga').length }
  ];
  document.getElementById('chartTopicTrend').innerHTML = topicComparison.map((item) => {
    const diff = item.curr - item.prev;
    const isImproved = diff <= 0;
    const statusLabel = isImproved
      ? `<span class="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-[#FAF9F6] border-[1.5px] border-[#231712] text-[#231712]">Membaik ▼ (${diff})</span>`
      : `<span class="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-[#231712] text-[#FAF9F6]">Memburuk ▲ (+${diff})</span>`;
    return `
      <div class="p-3 rounded-xl border border-[#231712]/20 flex items-center justify-between gap-2">
        <div>
          <span class="text-xs font-extrabold text-[#231712]">Topik ${esc(item.topic)}</span>
          <p class="text-[11px] text-[#231712]/75 mt-0.5">
            Periode lalu: <strong>${esc(item.prev)} keluhan</strong> → Sekarang: <strong>${esc(item.curr)} keluhan</strong>
          </p>
        </div>
        ${statusLabel}
      </div>
    `;
  }).join('');

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
    const praised = filtered.filter((r) => r.menu === m && r.satisfied).length;
    const complained = filtered.filter((r) => r.menu === m && !r.satisfied).length;
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

  const keywords = [
    { word: '"terlalu manis"', topic: 'Rasa', count: 9 },
    { word: '"lama"', topic: 'Pelayanan', count: 7 },
    { word: '"panas"', topic: 'Tempat', count: 5 },
    { word: '"antre"', topic: 'Pelayanan', count: 5 },
    { word: '"parkir"', topic: 'Tempat', count: 3 },
    { word: '"mahal"', topic: 'Harga', count: 3 }
  ];
  const maxKw = keywords[0].count;
  document.getElementById('chartRecurringKeywords').innerHTML = keywords.map((kw) => {
    const pct = Math.round((kw.count / maxKw) * 100);
    return `
      <div>
        <div class="flex items-center justify-between text-xs mb-1">
          <div class="flex items-center gap-2">
            <span class="font-extrabold text-[#231712]">${esc(kw.word)}</span>
            <span class="text-[10px] font-bold px-2 py-0.5 rounded bg-[#231712]/10 text-[#231712]">${esc(kw.topic)}</span>
          </div>
          <span class="font-bold text-[#231712]">${esc(kw.count)}x muncul</span>
        </div>
        <div class="w-full h-2.5 rounded-full bg-[#231712]/10 overflow-hidden">
          <div class="h-full bg-[#231712] rounded-full" style="width: ${pct}%"></div>
        </div>
      </div>
    `;
  }).join('');

  const evalTopics = ['Pelayanan (QRIS)', 'Rasa (Es Kristal)', 'Tempat (AC)'];
  const beforeVals = [12, 8, 6];
  const afterVals = [5, 4, 3];
  const eW = 420, eH = 195;
  const ePadL = 28, ePadR = 16, ePadT = 24, ePadB = 34;
  const ePlotW = eW - ePadL - ePadR;
  const ePlotH = eH - ePadT - ePadB;
  const eSlot = ePlotW / evalTopics.length;
  const eBar = 26;

  const evalBars = evalTopics.map((lbl, i) => {
    const bH = (beforeVals[i] / 14) * ePlotH;
    const aH = (afterVals[i] / 14) * ePlotH;
    const center = ePadL + i * eSlot + eSlot / 2;
    const x1 = center - eBar - 3;
    const x2 = center + 3;
    const y1 = ePadT + ePlotH - bH;
    const y2 = ePadT + ePlotH - aH;

    return `
      <rect x="${x1.toFixed(1)}" y="${y1.toFixed(1)}" width="${eBar}" height="${bH.toFixed(1)}" rx="5" fill="url(#evalHatch)" stroke="#231712" stroke-width="1.6" />
      <text x="${(x1 + eBar / 2).toFixed(1)}" y="${(y1 - 5).toFixed(1)}" text-anchor="middle" font-size="10" font-bold fill="#231712">${beforeVals[i]}</text>

      <rect x="${x2.toFixed(1)}" y="${y2.toFixed(1)}" width="${eBar}" height="${aH.toFixed(1)}" rx="5" fill="#231712" stroke="#231712" stroke-width="1.6" />
      <text x="${(x2 + eBar / 2).toFixed(1)}" y="${(y2 - 5).toFixed(1)}" text-anchor="middle" font-size="10" font-extrabold fill="#231712">${afterVals[i]}</text>

      <text x="${center.toFixed(1)}" y="${eH - 10}" text-anchor="middle" font-size="10" font-bold fill="#231712">${esc(lbl)}</text>
    `;
  }).join('');

  document.getElementById('chartBeforeAfter').innerHTML = `
    <div class="flex items-center gap-4 mb-2 text-xs font-bold text-[#231712]">
      <span class="inline-flex items-center gap-1.5">
        <span class="w-3.5 h-3.5 rounded bg-espresso-hatch border border-[#231712] inline-block"></span>
        Sebelum Saran
      </span>
      <span class="inline-flex items-center gap-1.5">
        <span class="w-3.5 h-3.5 rounded bg-[#231712] inline-block"></span>
        Sesudah Saran Dilaksanakan
      </span>
    </div>
    <svg viewBox="0 0 ${eW} ${eH}" class="w-full h-auto overflow-visible" role="img" aria-label="Grafik Sebelum vs Sesudah Saran Dilaksanakan">
      <defs>
        <pattern id="evalHatch" width="8" height="8" patternTransform="rotate(45 0 0)" patternUnits="userSpaceOnUse">
          <rect width="8" height="8" fill="#FAF9F6" />
          <line x1="0" y1="0" x2="0" y2="8" stroke="#231712" stroke-width="2" stroke-opacity="0.45" />
        </pattern>
      </defs>
      <line x1="${ePadL}" y1="${ePadT + ePlotH}" x2="${eW - ePadR}" y2="${ePadT + ePlotH}" stroke="#231712" stroke-opacity="0.25" stroke-width="1.5" />
      ${evalBars}
    </svg>
  `;

  const isQrOnly = appState.filters.source === 'QR';
  const genderItems = [
    { label: 'Laki-laki', count: filtered.filter((r) => r.gender === 'Laki-laki').length, style: 'bg-[#231712]' },
    { label: 'Perempuan', count: filtered.filter((r) => r.gender === 'Perempuan').length, style: 'bg-espresso-hatch border border-[#231712]' }
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
    { label: '> 35 thn', count: filtered.filter((r) => r.ageGroup === '> 35 thn').length }
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
    const avgStar = getReviewAverageRating(rev).toFixed(1);
    const sentimentBadge = rev.satisfied
      ? `<span class="px-2.5 py-0.5 rounded-full text-[11px] font-extrabold bg-[#FAF9F6] border-[1.5px] border-[#231712] text-[#231712]">Puas</span>`
      : `<span class="px-2.5 py-0.5 rounded-full text-[11px] font-extrabold bg-[#231712] text-[#FAF9F6]">Tidak Puas</span>`;

    const isUnresponded = rev.responseStatus === 'Belum Ditanggapi';

    const sourceSpecificMeta = (rev.source === 'QR' && rev.ratings)
      ? `
        <div class="flex flex-wrap items-center gap-1.5 text-[11px] text-[#231712]/85 pt-1">
          <span class="px-2 py-0.5 rounded bg-[#231712]/5 font-semibold">Rasa: <strong>${esc(rev.ratings.rasa)}★</strong></span>
          <span class="px-2 py-0.5 rounded bg-[#231712]/5 font-semibold">Harga: <strong>${esc(rev.ratings.harga)}★</strong></span>
          <span class="px-2 py-0.5 rounded bg-[#231712]/5 font-semibold">Pelayanan: <strong>${esc(rev.ratings.pelayanan)}★</strong></span>
          <span class="px-2 py-0.5 rounded bg-[#231712]/5 font-semibold">Tempat: <strong>${esc(rev.ratings.tempat)}★</strong></span>
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
            <span class="text-[11px] text-[#231712]/65">${esc(rev.date)} • Rata-rata ${avgStar}★</span>
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
      showToast('Masuk mode prototipe: data contoh, login tidak diperiksa.');
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

  document.getElementById('suggestionInterval').addEventListener('change', (e) => {
    appState.suggestionInterval = e.target.value;
    renderActiveSuggestions();
    showToast(`Interval saran diubah ke: ${e.target.value}.`);
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
  document.getElementById('saveThresholdBtn').addEventListener('click', () => {
    let v = parseInt(thresholdNumberInput.value, 10);
    if (isNaN(v) || v < 2) v = 2;
    if (v > 25) v = 25;
    thresholdNumberInput.value = v;
    thresholdSlider.value = v;
    appState.threshold = v;
    document.getElementById('currentThresholdLabel').textContent = `${v} keluhan baru`;
    renderActiveSuggestions();
    showToast(`Ambang munculnya saran disimpan: ${v} keluhan baru.`);
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

    const ai = simulateAIAnalysis(comment, rating);

    let savedId = null;
    if (!PROTOTIPE) {
      const submitBtn = e.submitter || e.target.querySelector('[type="submit"]');
      submitBtn.disabled = true;
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
    }

    appState.reviews.unshift({
      id: savedId ? `DB-${savedId}` : 'REV-' + (200 + appState.reviews.length + 1),
      date,
      source,
      satisfied: ai.satisfied,
      topic,
      menu: ai.menu,
      singleRating: rating,
      gender: 'Non-QR',
      ageGroup: 'Non-QR',
      comment,
      responseStatus: ai.satisfied ? 'Sudah Ditanggapi' : 'Belum Ditanggapi'
    });

    document.getElementById('manualComment').value = '';
    closeManualModal();
    refreshAllViews();
    showToast(savedId
      ? `Ulasan ${source} tersimpan di database (id ${savedId}).`
      : `Ulasan ${source} ditambahkan (mode prototipe). Simulasi: ${ai.satisfied ? 'Puas' : 'Tidak Puas'} • Menu: ${ai.menu}.`);
  });


  document.getElementById('exportCsvBtn').addEventListener('click', () => {
    const filtered = getFilteredReviews();
    const headers = ['ID', 'Tanggal', 'Sumber', 'Sentimen', 'Topik', 'Menu', 'RataRataBintang', 'StatusTanggapan', 'Komentar'];
    const rows = filtered.map((r) => [
      r.id,
      r.date,
      r.source,
      r.satisfied ? 'Puas' : 'Tidak Puas',
      r.topic,
      r.menu,
      getReviewAverageRating(r).toFixed(1),
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
    const satCount = filtered.filter((r) => r.satisfied).length;
    const satPct = total > 0 ? Math.round((satCount / total) * 100) : 0;
    const negList = filtered.filter((r) => !r.satisfied);

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

    document.getElementById('pdfSuggestionsList').innerHTML = appState.activeSuggestions.map((s, i) => `
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
