// DHL eCommerce TR - Modern Gönderi Takip (Chrome Extension v2.7)
// v2.7: SAYFALAMA DÜZELTMESİ — tablo sayfalı (10/sayfa) olduğundan en yeni gönderiler
//       2. sayfada kalıp görünmüyordu. Artık okumadan önce "Sayfada X kayıt göster"
//       en büyük değere (Hepsi/100) çekiliyor; böylece bugünkü gönderiler de listeye girer.
// v2.6:
//   - "Teslim Tarihi" sütununda artık GÖNDERİ tarihi de gösteriliyor (Gönderi + Teslim birlikte).
//   - Tarih başlığına tıklanınca sıralama tersine çevrilebiliyor (yeni→eski / eski→yeni).
//   - İçerik tek seferde bir veri modeline okunuyor; yeniden sıralarken ödeme sütunu ve
//     detay butonu bozulmuyor (model tabanlı render).
// v2.5: Bugünden ileri tarihli (ön kayıt) gönderiler en üste çıkmaz, en sona iner.
// v2.4: "Ödeme" sütunu (alıcı/gönderici ödemeli) + kopyalanabilir takip kodu + son 10 gönderi.
(function () {
  'use strict';

  let listeleTiklandi = false;
  let kuruluyorMu = false;
  let rebuildTimer = null;
  let gozlenenTbody = null;

  const odemeCache = new Map();       // kod -> 'alici' | 'gonderici' | 'bilinmiyor'
  const GOSTERILECEK_ADET = 10;

  let veriModel = [];                 // tablodan okunan gönderiler
  let sonEski = false;                // false = yeni→eski (varsayılan), true = eski→yeni
  let sonWrap = null, sonTable = null, sonWrapper = null;

  // ────────────────────────────────────────────────────────
  // 1. OTOMATIK "LİSTELE": son 10 gün + tek tıklama
  // ────────────────────────────────────────────────────────
  function siteTarihFormatla(d, ornek) {
    const ayrac = (ornek && ornek.includes('/')) ? '/' : '.';
    const g = String(d.getDate()).padStart(2, '0');
    const a = String(d.getMonth() + 1).padStart(2, '0');
    return [g, a, d.getFullYear()].join(ayrac);
  }

  function otomatikListele() {
    if (listeleTiklandi) return;
    const btn = document.getElementById('btnKargoGetir');
    const bas = document.getElementById('pBasTarihi');
    const bit = document.getElementById('pBitTarihi');
    if (!btn) return;

    listeleTiklandi = true;

    const bugun = new Date();
    const onGunOnce = new Date(bugun.getTime() - 10 * 24 * 60 * 60 * 1000);
    const ornek = (bas && bas.value) || (bit && bit.value) || '';
    if (bas) bas.value = siteTarihFormatla(onGunOnce, ornek);
    if (bit) bit.value = siteTarihFormatla(bugun, ornek);

    setTimeout(() => btn.click(), 200);
  }

  // ────────────────────────────────────────────────────────
  // 2. YARDIMCILAR
  // ────────────────────────────────────────────────────────
  const AVATAR_COLORS = ['#534AB7', '#0F6E56', '#993C1D', '#993556', '#185FA5', '#3B6D11', '#854F0B', '#A32D2D'];

  function hashColor(name) {
    let h = 0;
    for (const ch of (name || '')) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return AVATAR_COLORS[h % AVATAR_COLORS.length];
  }

  function initials(name) {
    return (name || '?').trim().split(/\s+/).slice(0, 2).map(w => w[0] || '').join('').toLocaleUpperCase('tr') || '?';
  }

  function statusStyle(txt) {
    const t = (txt || '').toLocaleLowerCase('tr');
    if (t.includes('teslim edildi') || t.includes('teslim alındı'))
      return { bg: '#EAF3DE', fg: '#27500A', dot: '#639922' };
    if (t.includes('iade'))
      return { bg: '#FCEBEB', fg: '#791F1F', dot: '#E24B4A' };
    if (t.includes('transfer') || t.includes('yolda') || t.includes('dağıtım') || t.includes('çıkış'))
      return { bg: '#E6F1FB', fg: '#0C447C', dot: '#378ADD' };
    if (t.includes('kabul') || t.includes('alındı'))
      return { bg: '#EEEDFE', fg: '#3C3489', dot: '#7F77DD' };
    return { bg: '#FAEEDA', fg: '#633806', dot: '#EF9F27' };
  }

  // "26.06.2026" -> sıralanabilir sayı
  function tarihSayisi(t) {
    const m = (t || '').match(/(\d{2})[./](\d{2})[./](\d{4})/);
    return m ? Number(m[3] + m[2] + m[1]) : 0;
  }

  function bugunSayisi() {
    const d = new Date();
    return Number(String(d.getFullYear()) +
      String(d.getMonth() + 1).padStart(2, '0') +
      String(d.getDate()).padStart(2, '0'));
  }

  // Tablo sayfalı; en yeni gönderiler sonraki sayfalarda kalmasın diye
  // "Sayfada X kayıt göster" seçicisini en büyük değere (Hepsi/-1 varsa o, yoksa 100 vb.) çek.
  // Değeri değiştirdiyse true döner (tablo yeniden çizilecek, sonra tekrar okunacak).
  function tumKayitlariGoster() {
    const sel = document.querySelector('select[name="dataTableList_length"]') ||
                document.querySelector('.dataTables_length select, #dataTableList_length select');
    if (!sel || !sel.options || !sel.options.length) return false;
    const hepsi = [...sel.options].find(o => o.value === '-1');
    let hedef;
    if (hepsi) {
      hedef = '-1';
    } else {
      hedef = sel.value;
      [...sel.options].forEach(o => { if (Number(o.value) > Number(hedef)) hedef = o.value; });
    }
    if (sel.value === hedef) return false;
    sel.value = hedef;
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }

  function kodBulNode(btn) {
    if (!btn) return null;
    const oc = btn.getAttribute('onclick') || '';
    const m = oc.match(/GetKargoOnizleme\(\s*["']([^"']+)["']\s*\)/);
    return m ? m[1] : null;
  }

  // KargoPreview -> ödeme tipi. Doğrulanan eşleme: LU_ODEME_SEKLI 'U'->alıcı, 'P'->gönderici.
  function odemeTipiCoz(o) {
    const s = (o && o.LU_ODEME_SEKLI != null ? String(o.LU_ODEME_SEKLI) : '').toUpperCase();
    if (s === 'P') return 'gonderici';
    if (s === 'U') return 'alici';
    const t = Number(o && o.LU_TAHSILAT_MUS_TIPI);
    if (t === 1) return 'gonderici';
    if (t === 2) return 'alici';
    return 'bilinmiyor';
  }

  async function odemeTipiGetir(kod) {
    if (!kod) return 'bilinmiyor';
    if (odemeCache.has(kod)) return odemeCache.get(kod);
    try {
      const r = await fetch('/TakipEt/KargoPreview', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          'X-Requested-With': 'XMLHttpRequest'
        },
        body: 'P_CD_KONSIMENTO_NO=' + encodeURIComponent(kod)
      });
      const o = await r.json();
      const tip = odemeTipiCoz(o);
      odemeCache.set(kod, tip);
      return tip;
    } catch (e) {
      return 'bilinmiyor';
    }
  }

  function odemeStyle(tip) {
    if (tip === 'alici')
      return { bg: '#FDF0D5', fg: '#7A4E00', dot: '#E0930B', label: 'Alıcı Ödemeli' };
    if (tip === 'gonderici')
      return { bg: '#EAEEF3', fg: '#37455B', dot: '#64748B', label: 'Gönderici Ödemeli' };
    return { bg: '#F1F2F5', fg: '#9AA1B3', dot: '#C3C9D4', label: '—' };
  }

  function odemeBadgeHTML(tip) {
    const os = odemeStyle(tip);
    return `<span class="dhm-odeme-badge" style="background:${os.bg};color:${os.fg}"><span class="dhm-dot" style="background:${os.dot}"></span>${os.label}</span>`;
  }

  function cssEkle() {
    if (document.getElementById('dhlModernCSS')) return;
    const style = document.createElement('style');
    style.id = 'dhlModernCSS';
    style.textContent = `
    #dhlModernWrap { font-family: 'Segoe UI', system-ui, sans-serif; margin: 12px 0 24px; }
    #dhlModernWrap * { box-sizing: border-box; }
    .dhm-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; margin-bottom: 14px; }
    .dhm-title { display: flex; align-items: center; gap: 10px; }
    .dhm-logo { width: 40px; height: 40px; border-radius: 10px; background: #FFCC00; display: flex; align-items: center; justify-content: center; font-size: 20px; }
    .dhm-title h2 { margin: 0; font-size: 20px; font-weight: 700; color: #1f2430; }
    .dhm-title small { display: block; font-size: 13px; color: #7a8194; font-weight: 400; }
    .dhm-tools { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
    .dhm-search { padding: 9px 14px; border: 1.5px solid #d9dee8; border-radius: 10px; font-size: 14px; min-width: 200px; outline: 0; }
    .dhm-search:focus { border-color: #D40511; }
    .dhm-toggle { padding: 9px 14px; border: 1.5px solid #d9dee8; border-radius: 10px; background: #fff; font-size: 13px; cursor: pointer; color: #3b4254; }
    .dhm-toggle:hover { background: #f4f6fa; }
    .dhm-card { background: #fff; border: 1px solid #e6e9f0; border-radius: 14px; overflow: hidden; box-shadow: 0 2px 10px rgba(20,30,60,.06); }
    .dhm-grid { display: grid; grid-template-columns: 1.55fr .8fr .65fr 1.1fr 1fr 1.35fr .5fr; gap: 10px; align-items: center; padding: 14px 18px; }
    .dhm-hrow { background: #f7f8fb; border-bottom: 1px solid #e6e9f0; font-size: 12px; font-weight: 700; letter-spacing: .4px; text-transform: uppercase; color: #8a91a5; padding: 11px 18px; }
    .dhm-row { border-bottom: 1px solid #eef0f5; transition: background .15s; }
    .dhm-row:last-child { border-bottom: 0; }
    .dhm-row:hover { background: #fbfcff; }
    .dhm-alici { display: flex; align-items: center; gap: 11px; min-width: 0; }
    .dhm-avatar { flex: 0 0 40px; width: 40px; height: 40px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 14px; color: #fff; }
    .dhm-alici-ad { font-size: 16px; font-weight: 700; color: #1f2430; line-height: 1.25; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .dhm-alici-meta { display: flex; align-items: center; gap: 8px; margin-top: 3px; flex-wrap: wrap; }
    /* Takip kodu: büyük punto, farklı renk, kopyalanabilir */
    .dhm-kod { display: inline-flex; align-items: center; gap: 6px; font-size: 14px; font-weight: 700; letter-spacing: .3px; color: #185FA5; background: #EAF1FB; border: 1px solid #d5e4f7; border-radius: 8px; padding: 2px 9px; cursor: pointer; font-family: 'Consolas','SFMono-Regular',ui-monospace,monospace; transition: background .15s, color .15s, border-color .15s; user-select: all; }
    .dhm-kod:hover { background: #185FA5; color: #fff; border-color: #185FA5; }
    .dhm-kod .dhm-kopya-ikon { opacity: .55; width: 14px; height: 14px; display: inline-block; }
    .dhm-kod:hover .dhm-kopya-ikon { opacity: 1; }
    .dhm-kod.dhm-kopyalandi { background: #0F6E56; color: #fff; border-color: #0F6E56; }
    .dhm-adet { font-size: 15px; color: #3b4254; }
    .dhm-adet b { font-size: 16px; }
    .dhm-fiyat { font-size: 17px; font-weight: 800; color: #0F6E56; white-space: nowrap; }
    .dhm-badge { display: inline-flex; align-items: center; gap: 6px; font-size: 13.5px; font-weight: 700; padding: 6px 13px; border-radius: 999px; white-space: nowrap; }
    .dhm-odeme-badge { display: inline-flex; align-items: center; gap: 6px; font-size: 12.5px; font-weight: 700; padding: 5px 11px; border-radius: 999px; white-space: nowrap; }
    .dhm-odeme-loading { display: inline-block; width: 34px; height: 8px; border-radius: 6px; background: linear-gradient(90deg,#eef0f5,#e2e6ee,#eef0f5); background-size: 200% 100%; animation: dhmSkeleton 1.1s ease-in-out infinite; }
    @keyframes dhmSkeleton { 0%{background-position:200% 0} 100%{background-position:-200% 0} }
    /* Tarih hücresi: gönderi + teslim */
    .dhm-tarih { font-size: 13px; line-height: 1.35; }
    .dhm-tarih-satir { white-space: nowrap; }
    .dhm-tarih-et { display: inline-block; min-width: 52px; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .3px; color: #9aa1b3; }
    .dhm-tarih-gonderi .dhm-tarih-deger { font-weight: 600; color: #3b4254; }
    .dhm-tarih-teslim .dhm-tarih-deger { font-weight: 700; color: #1f2430; }
    .dhm-tarih-teslim small { color: #9aa1b3; font-weight: 400; }
    /* Sıralanabilir başlık */
    .dhm-sortable { cursor: pointer; user-select: none; display: inline-flex; align-items: center; gap: 5px; }
    .dhm-sortable:hover { color: #D40511; }
    .dhm-sort-ok { font-size: 11px; }
    .dhm-detay-slot { text-align: center; }
    .dhm-empty { padding: 34px; text-align: center; color: #8a91a5; font-size: 15px; }
    .dhm-dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; }
    @media (max-width: 1100px) {
      .dhm-grid { grid-template-columns: 1fr 1fr; }
      .dhm-hrow { display: none; }
      .dhm-row .dhm-alici { grid-column: 1 / -1; }
      .dhm-tools { flex-direction: column; width: 100%; }
      .dhm-search { width: 100%; }
    }`;
    document.head.appendChild(style);
  }

  // ────────────────────────────────────────────────────────
  // 3. KUR: tabloyu modele oku, sonra çiz
  // ────────────────────────────────────────────────────────
  function initModernUI() {
    if (kuruluyorMu) return;
    const table = document.querySelector('#dataTableList');
    if (!table) return;
    const wrapper = table.closest('.dataTables_wrapper');
    if (!wrapper) return;

    // Önce tüm kayıtları tek sayfada göster; değiştiyse tablo yeniden çizilecek,
    // gözlemci (veya bu setTimeout) tekrar tetikleyip TAM veriyle kuracak.
    if (tumKayitlariGoster()) {
      setTimeout(initModernUI, 500);
      return;
    }

    kuruluyorMu = true;
    try {
      cssEkle();
      wrapper.style.display = 'none';

      let wrap = document.getElementById('dhlModernWrap');
      if (!wrap) {
        wrap = document.createElement('div');
        wrap.id = 'dhlModernWrap';
        wrapper.parentNode.insertBefore(wrap, wrapper);
      }
      sonWrap = wrap; sonTable = table; sonWrapper = wrapper;
      veriModel = tabloyuOku(table);
      render();
      tbodyGozle(table);
    } finally {
      setTimeout(() => { kuruluyorMu = false; }, 100);
    }
  }

  function tbodyGozle(table) {
    const tbody = table.querySelector('tbody');
    if (!tbody || tbody === gozlenenTbody) return;
    gozlenenTbody = tbody;
    new MutationObserver(() => {
      if (kuruluyorMu) return;
      clearTimeout(rebuildTimer);
      rebuildTimer = setTimeout(initModernUI, 400);
    }).observe(tbody, { childList: true });
  }

  function tabloyuOku(table) {
    const ths = [...table.querySelectorAll('thead th')].map(th => th.innerText.trim().toLocaleLowerCase('tr'));
    const idx = {
      tarih: ths.findIndex(h => h === 'tarih'),
      gonderiNo: ths.findIndex(h => h === 'gönderi no'),
      alici: ths.findIndex(h => h === 'alıcı müşteri'),
      adet: ths.findIndex(h => h === 'adet/kgdesi'),
      fiyat: ths.findIndex(h => h === 'fiyat'),
      durum: ths.findIndex(h => h === 'son durum'),
      teslimTarihi: ths.findIndex(h => h === 'teslim tarihi'),
      detay: ths.findIndex(h => h === 'detay bilgisi')
    };
    const trs = [...table.querySelectorAll('tbody tr')].filter(r => r.children.length > 5);
    return trs.map(tr => {
      const cell = i => (i >= 0 && tr.children[i]) ? tr.children[i] : null;
      const txt = i => { const c = cell(i); return c ? c.innerText.trim() : ''; };
      const detayBtn = cell(idx.detay) ? cell(idx.detay).querySelector('button, a') : null;
      return {
        alici: txt(idx.alici),
        adet: txt(idx.adet),
        fiyat: txt(idx.fiyat),
        durum: txt(idx.durum),
        teslimRaw: txt(idx.teslimTarihi),
        gNo: txt(idx.gonderiNo),
        gTarih: txt(idx.tarih),
        kod: kodBulNode(detayBtn) || null,
        detayBtn: detayBtn
      };
    });
  }

  // Varsayılan sıralama: yeni→eski, bugünden ileri tarihliler en sona.
  function siralaTemel(model) {
    const bugun = bugunSayisi();
    return model.map((r, i) => ({ r, i }))
      .sort((a, b) => {
        const na = tarihSayisi(a.r.gTarih), nb = tarihSayisi(b.r.gTarih);
        const ga = na > bugun ? 1 : 0, gb = nb > bugun ? 1 : 0;
        if (ga !== gb) return ga - gb;
        const d = nb - na;
        if (d !== 0) return d;
        return b.i - a.i;
      })
      .map(x => x.r);
  }

  // ────────────────────────────────────────────────────────
  // 4. RENDER (model -> DOM). sonEski true ise yön ters.
  // ────────────────────────────────────────────────────────
  function render() {
    const wrap = sonWrap, wrapper = sonWrapper;
    if (!wrap) return;
    wrap.innerHTML = ''; // detay butonları model.detayBtn referansında durur, kaybolmaz

    // En son 10 gönderi (yeni→eski taban), sonra görüntü yönü.
    const taban = siralaTemel(veriModel).slice(0, GOSTERILECEK_ADET);
    const gosterilecek = sonEski ? taban.slice().reverse() : taban;
    const toplam = veriModel.length;

    const head = document.createElement('div');
    head.className = 'dhm-head';
    head.innerHTML = `
      <div class="dhm-title">
        <div class="dhm-logo">📦</div>
        <div><h2>Gönderi Takip</h2><small>Son ${taban.length} gönderi${toplam > taban.length ? ' (' + toplam + ' kayıttan)' : ''} · eski kayıtlar için üstteki tarih filtresini kullan</small></div>
      </div>
      <div class="dhm-tools">
        <input class="dhm-search" type="text" placeholder="Alıcı adıyla ara...">
        <button class="dhm-toggle" type="button">Eski görünüm / Tarih filtresi</button>
      </div>`;
    wrap.appendChild(head);

    const card = document.createElement('div');
    card.className = 'dhm-card';
    const okChar = sonEski ? '▲' : '▼';
    const sortBaslik = sonEski ? 'Eskiden yeniye — tersine çevirmek için tıkla' : 'Yeniden eskiye — tersine çevirmek için tıkla';
    const hrow = document.createElement('div');
    hrow.className = 'dhm-grid dhm-hrow';
    hrow.innerHTML = `
      <div>Alıcı Müşteri</div>
      <div>Adet / KgDesi</div>
      <div>Fiyat</div>
      <div>Son Durum</div>
      <div>Ödeme</div>
      <div><span class="dhm-sortable" title="${sortBaslik}">Gönderi / Teslim Tarihi <span class="dhm-sort-ok">${okChar}</span></span></div>
      <div>Detay</div>`;
    card.appendChild(hrow);

    if (!gosterilecek.length) {
      const e = document.createElement('div');
      e.className = 'dhm-empty';
      e.textContent = 'Gösterilecek gönderi bulunamadı.';
      card.appendChild(e);
    }

    const kopyaIkon = '<svg class="dhm-kopya-ikon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';

    gosterilecek.forEach(d => {
      const ss = statusStyle(d.durum);
      const tahmini = /tahmini/i.test(d.teslimRaw);
      const teslim = d.teslimRaw.replace(/\(?tahmini\)?/i, '').trim();
      const teslimMatch = teslim.match(/^(\S+)\s+(.+)$/); // "22.07.2026 10:27:54"
      const teslimGun = teslimMatch ? teslimMatch[1] : teslim;
      const teslimSaat = teslimMatch ? teslimMatch[2] : '';

      const row = document.createElement('div');
      row.className = 'dhm-grid dhm-row';
      row.dataset.alici = d.alici.toLocaleLowerCase('tr');
      row.innerHTML = `
        <div class="dhm-alici">
          <div class="dhm-avatar" style="background:${hashColor(d.alici)}">${initials(d.alici)}</div>
          <div style="min-width:0">
            <div class="dhm-alici-ad" title="${d.alici}">${d.alici || '—'}</div>
            <div class="dhm-alici-meta">
              ${d.gNo ? `<span class="dhm-kod" role="button" tabindex="0" title="Kopyalamak için tıkla" data-kod-metin="${d.gNo}"><span class="dhm-kod-metin">${d.gNo}</span>${kopyaIkon}</span>` : ''}
            </div>
          </div>
        </div>
        <div class="dhm-adet">${d.adet ? d.adet.replace(/(\d+)/g, '<b>$1</b>') : '—'}</div>
        <div class="dhm-fiyat">${d.fiyat ? d.fiyat + ' ₺' : '—'}</div>
        <div><span class="dhm-badge" style="background:${ss.bg};color:${ss.fg}"><span class="dhm-dot" style="background:${ss.dot}"></span>${d.durum || '—'}</span></div>
        <div class="dhm-odeme-slot"><span class="dhm-odeme-loading"></span></div>
        <div class="dhm-tarih">
          <div class="dhm-tarih-satir dhm-tarih-gonderi"><span class="dhm-tarih-et">Gönderi</span><span class="dhm-tarih-deger">${d.gTarih || '—'}</span></div>
          <div class="dhm-tarih-satir dhm-tarih-teslim"><span class="dhm-tarih-et">Teslim</span><span class="dhm-tarih-deger">${teslimGun || '—'}</span>${teslimSaat ? ' <small>' + teslimSaat + '</small>' : ''}${tahmini ? ' <small>(tahmini)</small>' : ''}</div>
        </div>
        <div class="dhm-detay-slot"></div>`;

      // Takip kodu kopyalama
      const chip = row.querySelector('.dhm-kod');
      if (chip) {
        chip.addEventListener('click', () => kopyala(d.gNo, chip));
        chip.addEventListener('keydown', e => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); kopyala(d.gNo, chip); }
        });
      }

      // Ödeme tipi — önbellekteyse anında göster, değilse asenkron çek (yeniden sıralamada titremez)
      const odemeSlot = row.querySelector('.dhm-odeme-slot');
      if (d.kod && odemeCache.has(d.kod)) {
        odemeSlot.innerHTML = odemeBadgeHTML(odemeCache.get(d.kod));
      } else if (d.kod) {
        odemeTipiGetir(d.kod).then(tip => { odemeSlot.innerHTML = odemeBadgeHTML(tip); });
      } else {
        odemeSlot.innerHTML = '<span class="dhm-tarih-et">—</span>';
      }

      // Orijinal Detay butonunu (model referansı) taşı
      if (d.detayBtn) {
        d.detayBtn.style.fontSize = '13px';
        row.querySelector('.dhm-detay-slot').appendChild(d.detayBtn);
      } else {
        row.querySelector('.dhm-detay-slot').textContent = '—';
      }
      card.appendChild(row);
    });

    wrap.appendChild(card);

    // Arama
    head.querySelector('.dhm-search').addEventListener('input', e => {
      const q = e.target.value.toLocaleLowerCase('tr');
      card.querySelectorAll('.dhm-row').forEach(r => {
        r.style.display = r.dataset.alici.includes(q) ? '' : 'none';
      });
    });

    // Tarih başlığına tıkla -> sıralamayı tersine çevir
    const sortEl = hrow.querySelector('.dhm-sortable');
    if (sortEl) sortEl.addEventListener('click', () => { sonEski = !sonEski; render(); });

    // Eski görünüm / tarih filtresi
    head.querySelector('.dhm-toggle').addEventListener('click', () => {
      const hidden = wrapper.style.display === 'none';
      wrapper.style.display = hidden ? '' : 'none';
      card.style.display = hidden ? 'none' : '';
      head.querySelector('.dhm-toggle').textContent = hidden ? 'Yeni görünüm' : 'Eski görünüm / Tarih filtresi';
    });
  }

  // Panoya kopyalama + görsel geri bildirim
  function kopyala(kod, chip) {
    const metinEl = chip.querySelector('.dhm-kod-metin');
    const bitir = () => {
      const eski = chip.dataset.kodMetin || kod;
      chip.classList.add('dhm-kopyalandi');
      metinEl.textContent = 'Kopyalandı ✓';
      setTimeout(() => {
        chip.classList.remove('dhm-kopyalandi');
        metinEl.textContent = eski;
      }, 1100);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(kod).then(bitir).catch(() => fallbackKopya(kod, bitir));
    } else {
      fallbackKopya(kod, bitir);
    }
  }

  function fallbackKopya(kod, cb) {
    try {
      const ta = document.createElement('textarea');
      ta.value = kod;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      cb && cb();
    } catch (e) { /* yoksay */ }
  }

  // ────────────────────────────────────────────────────────
  // 5. BAŞLATICI: hafif polling (en fazla 30 sn), sonra tamamen durur
  // ────────────────────────────────────────────────────────
  const boot = setInterval(() => {
    if (!listeleTiklandi) otomatikListele();
    const tbody = document.querySelector('#dataTableList tbody');
    if (tbody && tbody.querySelector('tr td:nth-child(6)')) {
      clearInterval(boot);
      initModernUI();
    }
  }, 500);
  setTimeout(() => clearInterval(boot), 30000);
})();