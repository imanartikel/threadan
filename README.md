# Daily Affiliate Content Generator

App lokal untuk generate konten Threads harian dari 10 persona affiliate.

## Cara jalanin

1. Buka terminal di folder ini.
2. Bikin file `.env` dari contoh `.env.example`, lalu isi API key:

```env
ANTHROPIC_API_KEY=sk-ant-api03-...
ANTHROPIC_MODEL=claude-haiku-4-5-20251001
PORT=3000
```

3. Jalankan server:

```powershell
npm run dev
```

4. Buka `http://127.0.0.1:3000`.

Opsional, kalau mau ganti model, edit `ANTHROPIC_MODEL` di `.env`.

Default sekarang pakai Claude Haiku 4.5 agar biaya batch konten lebih ringan.

## Struktur

- `server.js` - server lokal, static UI, dan proxy ke Anthropic API.
- `src/content.js` - 10 persona, tipe konten, tone, dan prompt builder.
- `public/` - UI generator, copy output, regenerate, dan history lokal.

API key hanya dibaca server dari environment variable, bukan disimpan di browser.

## Mode generate

- `Generate 1 Post` untuk bikin satu draft harian.
- `Generate 7 Hari` untuk bikin kalender Senin-Minggu dalam sekali request.

Komposisi mingguan default:

| Hari | Tipe |
|---|---|
| Senin | Tips & Edukasi |
| Selasa | Review Produk |
| Rabu | Konten Relatable |
| Kamis | Tips & Edukasi |
| Jumat | Review Produk |
| Sabtu | Konten Relatable |
| Minggu | Soft Sell + Link Aff |
