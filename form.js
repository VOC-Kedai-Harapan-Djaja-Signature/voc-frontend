(function () {
  'use strict';

  const cfg = window.VOC_CONFIG || {};
  const API_URL = String(cfg.API_URL || '').replace(/\/+$/, '');
  const PROTOTIPE = API_URL === '';
  const BATAS_WAKTU_MS = 15000;

  const $ = (id) => document.getElementById(id);

  const ASPEK = [['rasa', 'Rasa'], ['harga', 'Harga'], ['pelayanan', 'Pelayanan'], ['tempat', 'Tempat']];
  const LABEL = ['', 'Buruk', 'Kurang', 'Cukup', 'Baik', 'Sangat baik'];
  const BINTANG_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.8l2.8 5.9 6.4.8-4.7 4.4 1.2 6.4L12 17.1 6.3 20.3l1.2-6.4L2.8 9.5l6.4-.8z"/></svg>';

  const stateAwal = () => ({
    gender: 'tidak_dijawab',
    rate: { rasa: null, harga: null, pelayanan: null, tempat: null },
  });
  let ST = stateAwal();

  if (PROTOTIPE) {
    document.querySelectorAll('[data-proto]').forEach((el) => { el.hidden = false; });
  }

  $('asp').innerHTML = ASPEK.map(([kunci, nama]) => {
    const tombol = [1, 2, 3, 4, 5].map((n) =>
      `<button type="button" role="radio" aria-checked="false" aria-label="${n} dari 5" data-k="${kunci}" data-n="${n}">${BINTANG_SVG}</button>`,
    ).join('');
    return `<div><div class="arow"><span class="n">${nama}</span><div class="st" role="radiogroup" aria-label="Bintang ${nama}">${tombol}</div></div><div class="hint" id="h-${kunci}"></div></div>`;
  }).join('');

  function gambarBintang(kunci) {
    const nilai = ST.rate[kunci];
    document.querySelectorAll(`[data-k="${kunci}"]`).forEach((b) => {
      const n = Number(b.dataset.n);
      b.classList.toggle('on', Boolean(nilai && n <= nilai));
      b.setAttribute('aria-checked', String(n === nilai));
    });
    $(`h-${kunci}`).textContent = nilai ? LABEL[nilai] : '';
  }

  document.querySelectorAll('.st button').forEach((b) => {
    b.addEventListener('click', () => {
      const kunci = b.dataset.k;
      const n = Number(b.dataset.n);
      ST.rate[kunci] = ST.rate[kunci] === n ? null : n;
      gambarBintang(kunci);
      cekBolehKirim();
    });
  });

  const tombolGender = document.querySelectorAll('#gender button');
  tombolGender.forEach((b) => {
    b.addEventListener('click', () => {
      ST.gender = ST.gender === b.dataset.v ? 'tidak_dijawab' : b.dataset.v;
      tombolGender.forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.v === ST.gender)));
    });
  });

  function umurValid() {
    const v = $('age').value;
    return v === '' || (Number(v) >= 10 && Number(v) <= 90);
  }
  $('age').addEventListener('input', function () {
    this.value = this.value.replace(/\D/g, '').slice(0, 2);
    $('ageErr').textContent = umurValid() ? '' : 'Umur harus antara 10 hingga 90 tahun.';
    cekBolehKirim();
  });

  $('cm').addEventListener('input', function () {
    $('cc').textContent = String(this.value.length);
    cekBolehKirim();
  });

  function cekBolehKirim() {
    const adaIsi = ASPEK.some(([k]) => ST.rate[k]) || $('cm').value.trim() !== '';
    $('send').disabled = !(adaIsi && umurValid());
  }

  function payload() {
    const umur = parseInt($('age').value, 10);
    return {
      submitted_at: new Date().toISOString(),
      source: 'qr',
      gender: ST.gender,
      age: umur >= 10 && umur <= 90 ? umur : null,
      ratings: { ...ST.rate },
      comment: $('cm').value.trim() || null,
    };
  }

  function tampilkanTerimaKasih(data, keterangan) {
    $('form').style.display = 'none';
    $('thx').style.display = 'block';
    $('pl').textContent = JSON.stringify(data, null, 2);
    $('apiSt').textContent = keterangan;
    window.scrollTo(0, 0);
  }

  function tampilkanError(pesan) {
    $('err').textContent = pesan;
    $('err').style.display = 'block';
  }

  function pesanGagal(status, body) {
    if (status === 0) return 'Ulasan belum terkirim. Periksa sinyal, lalu coba lagi.';
    if (status === 429) return 'Terlalu banyak kiriman dari jaringan ini. Coba lagi beberapa menit lagi.';
    if (status >= 500) return 'Server sedang bermasalah. Coba lagi beberapa saat lagi.';
    if (body && typeof body.message === 'string') return body.message;
    return 'Ulasan belum bisa dikirim. Periksa isian, lalu coba lagi.';
  }

  $('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    if ($('send').disabled) return;
    $('err').style.display = 'none';
    const data = payload();

    if (PROTOTIPE) {
      tampilkanTerimaKasih(data, 'Mode prototipe: belum terhubung ke API, data tidak dikirim ke mana pun.');
      return;
    }

    $('send').disabled = true;
    $('send').textContent = 'Mengirim...';
    const batal = new AbortController();
    const timer = setTimeout(() => batal.abort(), BATAS_WAKTU_MS);

    try {
      const res = await fetch(`${API_URL}/reviews`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
        signal: batal.signal,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw Object.assign(new Error('gagal'), { status: res.status, body });
      }
      tampilkanTerimaKasih(data, `Terkirim ke ${API_URL}/reviews`);
    } catch (err) {
      tampilkanError(pesanGagal(err.status || 0, err.body));
      $('send').textContent = 'Kirim ulasan';
      cekBolehKirim();
    } finally {
      clearTimeout(timer);
    }
  });

  $('again').addEventListener('click', () => {
    ST = stateAwal();
    $('form').reset();
    $('cc').textContent = '0';
    $('ageErr').textContent = '';
    tombolGender.forEach((x) => x.setAttribute('aria-pressed', 'false'));
    ASPEK.forEach(([k]) => gambarBintang(k));
    $('send').textContent = 'Kirim ulasan';
    cekBolehKirim();
    $('thx').style.display = 'none';
    $('form').style.display = 'block';
  });
})();
