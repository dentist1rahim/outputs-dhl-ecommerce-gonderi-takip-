# GitHub'a yükleme (tek seferlik)

Bu klasörü GitHub'a koyup başkalarının indirmesini sağlamanın en kolay yolu.

## Yol A – Tarayıcıdan (kod bilgisi gerektirmez, önerilen)

1. [github.com](https://github.com) hesabınıza girin → sağ üstte **+** → **New repository**.
2. Ad verin (örn. `dhl-gonderi-takip`), **Public** seçin, **Create repository**.
3. Açılan sayfada **uploading an existing file** bağlantısına tıklayın.
4. Bu klasördeki **tüm dosyaları** (`manifest.json`, `content.js`, `redirect.js`, `README.md`, `.gitignore`, `LICENSE`) sürükleyip bırakın → **Commit changes**.
5. Bitti. Artık depo linkini paylaşabilirsiniz.

### Sürüm (Release) + hazır ZIP eklemek (isteğe bağlı ama şık)

Kullanıcılar "Download ZIP" yerine tek dosya indirsin isterseniz:

1. Depoda sağdaki **Releases** → **Create a new release**.
2. **Tag**: `v2.7`, **Title**: `v2.7`.
3. `dhl-ecommerce-gonderi-takip-v2.7.zip` dosyasını sürükleyip ekleyin → **Publish release**.

## Yol B – Git komut satırı (geliştirici iseniz)

```bash
cd dhl-ecommerce-gonderi-takip
git init
git add .
git commit -m "İlk sürüm: v2.7"
git branch -M main
git remote add origin https://github.com/KULLANICI_ADI/dhl-gonderi-takip.git
git push -u origin main
```

## Başkaları nasıl kuracak?

Depodaki **README.md** son kullanıcı kurulum adımlarını içeriyor (indir → `chrome://extensions` → Geliştirici modu → Paketlenmemiş öğe yükle). Onlara sadece depo linkini vermeniz yeterli.
