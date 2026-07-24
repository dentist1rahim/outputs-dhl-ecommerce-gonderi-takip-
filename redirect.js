// DHL Extension - Giriş sonrası otomatik yönlendirme (v2.3)
// Kural basit: Anasayfaya (/) her inişte, giriş yapılmışsa ("Çıkış" görünüyorsa)
// /TakipEt/GonderiTakip sayfasına yönlendir. Bayrak/oturum takibi YOK.
// Anasayfayı bilerek görmek istersen: adresin sonuna #kal ekle
// (örn. https://onlinesube.dhlecommerce.com.tr/#kal) -> yönlendirme yapılmaz.
(function () {
  'use strict';

  const path = location.pathname.replace(/\/+$/, '') || '/';
  if (path !== '/' && path.toLowerCase() !== '/anasayfa') return; // sadece kök/anasayfa
  if (location.hash.toLowerCase().includes('kal')) return;        // kaçış kapısı: #kal

  function girisYapilmisMi() {
    if (!document.body) return false;
    return [...document.querySelectorAll('a, button')]
      .some(el => (el.textContent || '').trim() === 'Çıkış');
  }

  let deneme = 0;
  const timer = setInterval(() => {
    deneme++;
    if (girisYapilmisMi()) {
      clearInterval(timer);
      location.replace('https://onlinesube.dhlecommerce.com.tr/TakipEt/GonderiTakip');
    } else if (deneme >= 600) { // 600 x 200ms = 2 dk (SMS onayı vs. için bol süre)
      clearInterval(timer);
    }
  }, 200);
})();
