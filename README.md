# Fullstack Work Sample - Faisal Anugrah Indrawan

## Cara Menjalankan

Node.js 20.19 keatas

```bash
git clone https://github.com/saltshrine/fullstack-work-sample-faisal_anugrah_indrawan
cd fullstack-work-sample-faisal_anugrah_indrawan
npm install
npm start
```

Aplikasi berjalan di `http://localhost:3000`.

## Soal #1: Optimasi Performa & State Management React

### Diagnosa
Penyebab utama unnecessary re-render pada dataset besar biasanya berawal dari penempatan state dan perubahan referensi props. Jika ribuan item disimpan langsung di komponen induk, update kecil seperti stok satu barang membuat parent render ulang dan ikut memicu anak-anaknya. Masalahnya makin terasa kalau function handler dikirim sebagai props tanpa referensi yang stabil. Setiap parent render menghasilkan function baru, dan karena shallow comparison menganggapnya berubah, `React.memo` pada row tidak bekerja. Akibatnya row yang datanya tidak berubah pun ikut render ulang.

### Solusi Render
Komponen diimplementasikan dengan tiga teknik yang bekerja bersamaan:
Pertama, virtualization lewat react-window (FixedSizeList) sehingga dari 5000 produk hanya sekitar belasan baris yang benar-benar ada di DOM pada satu waktu, sesuai tinggi viewport 600px dan tinggi baris 50px.
Kedua, React.memo membungkus ProductRow supaya baris yang propsnya tidak berubah tidak dihitung ulang ketika react-window me-render ulang list saat scroll.
Ketiga, state dikelola di store Zustand (useProductStore), bukan di useState komponen induk, sehingga handler seperti decreaseStock sudah berada di store dengan referensi yang stabil. Karena itu useCallback dan useMemo untuk itemData tidak diperlukan pada desain ini. Keduanya baru relevan jika state tetap disimpan di komponen induk dan handler harus dikirim lewat props.

### Strategi State Management
Penyebab re-render global adalah state yang disimpan di komponen induk. Selama ribuan produk berada di sana, update stok satu barang membuat induk render ulang dan menarik semua anaknya. Karena itu state saya pindahkan ke store eksternal (Zustand), lalu datanya dinormalisasi menjadi dua bagian: `ids` yang hanya menyimpan urutan produk, dan `byId` yang menyimpan objek tiap produk. Dengan begitu, mengubah stok cukup mengganti satu entri di `byId`, tanpa `.map()` ke seluruh array dan tanpa menyentuh `ids`.

Re-render lalu dibatasi lewat selector yang sempit. `ProductDashboard` hanya membaca `state.ids.length`, sedangkan setiap `ProductRow` hanya membaca `state.byId[id]` miliknya sendiri. Update dilakukan secara immutable, jadi hanya produk yang berubah yang mendapat referensi baru. Produk lain tetap memakai referensi lama, sehingga Zustand tidak memberi tahu baris-baris tersebut. Jika stok sudah 0, `decreaseStock` mengembalikan state yang sama sehingga tidak ada render sama sekali.

Hasilnya, saat stok `prod_1` berubah, hanya baris `prod_1` yang render ulang, sementara induk dan baris lain tidak. Ada satu trade-off: spread `...state.byId` tetap menyalin seluruh key sehingga biayanya O(n), tetapi ini jauh lebih murah daripada me-render ulang ribuan komponen. Kalau update sangat sering, misalnya lewat WebSocket, biayanya bisa dikurangi dengan batching atau state per item seperti `atomFamily` di Jotai.

### Implementasi
`src/components/ProductDashboard.jsx`

```jsx
import { memo } from 'react';
import { FixedSizeList as List } from 'react-window';
import { create } from 'zustand';

const TOTAL_PRODUCTS = 5000;
const ROW_HEIGHT = 50;

function createInitialProducts(total) {
  const ids = [];
  const byId = {};

  for (let i = 0; i < total; i++) {
    const id = `prod_${i}`;
    ids.push(id);
    byId[id] = { id, name: `Produk ${i}`, stock: 10 };
  }

  return { ids, byId };
}

const useProductStore = create((set) => ({
  ...createInitialProducts(TOTAL_PRODUCTS),

  decreaseStock: (id) =>
    set((state) => {
      const product = state.byId[id];
      if (product.stock <= 0) return state;

      return {
        byId: {
          ...state.byId,
          [id]: { ...product, stock: product.stock - 1 },
        },
      };
    }),
}));

const ProductRow = memo(function ProductRow({ index, style }) {
  const id = useProductStore((state) => state.ids[index]);
  const product = useProductStore((state) => state.byId[id]);
  const decreaseStock = useProductStore((state) => state.decreaseStock);

  return (
    <div style={style} className="flex items-center justify-between border-b p-2">
      <span>
        {product.name} (Stok: {product.stock})
      </span>
      <button
        onClick={() => decreaseStock(id)}
        disabled={product.stock === 0}
        className="rounded bg-blue-500 px-3 py-1 text-white disabled:bg-gray-300"
      >
        {product.stock === 0 ? 'Habis' : 'Kurangi Stok'}
      </button>
    </div>
  );
});

export default function ProductDashboard() {
  const totalItems = useProductStore((state) => state.ids.length);

  return (
    <div className="p-4">
      <h2>Dashboard Produk ({totalItems} Item)</h2>
      <List height={600} width="100%" itemCount={totalItems} itemSize={ROW_HEIGHT}>
        {ProductRow}
      </List>
    </div>
  );
}
```

---

## Soal #2: Arsitektur Backend, JWT, & High-Concurrency

### Pilihan Tech Stack & Alasan
Saya memilih Node.js (TypeScript) dengan Express, PostgreSQL sebagai database utama, dan Redis di depannya.

Alasannya sederhana: kerja backend flash sale sebagian besar cuma menunggu, entah itu database, Redis, atau jaringan. Node.js memang dibuat untuk situasi seperti ini, karena satu proses bisa menangani banyak koneksi sekaligus tanpa bikin thread baru untuk tiap request. Express saya pilih karena middleware-nya lengkap dan hampir semua masalah sudah ada solusinya di komunitas. TypeScript membantu menangkap salah ketik atau salah tipe di logika transaksi sebelum kode sampai ke produksi.

PostgreSQL cocok untuk data transaksi karena punya ACID, row-level locking, dan constraint. Redis saya pakai lebih dari sekadar cache: ia juga jadi penjaga stok, tempat daftar token yang dicabut, dan rate limiter. Lonjakan tulis ke database diratakan lewat antrean (BullMQ).

Kelemahan Node.js ada di sifatnya yang single-threaded: pekerjaan CPU-bound yang berat (misalnya parsing payload besar atau generate laporan) bisa memblokir event loop dan menunda semua request lain. Solusinya, jalankan banyak instance (Kubernetes) dan pindahkan kerja berat ke worker terpisah.

### Token Revocation pada JWT
Access token dibuat singkat, 15 menit, dan ditandatangani dengan RS256. Jadi setiap service cukup memeriksa tanda tangan dengan public key, tanpa perlu bertanya ke database.

Supaya user tidak login ulang tiap 15 menit, ada refresh token yang disimpan di server (dalam bentuk hash) dan dikirim lewat cookie `HttpOnly; Secure; SameSite`. Setiap kali dipakai, token itu diganti yang baru. Kalau token lama tiba-tiba dipakai lagi, kemungkinan besar token dicuri, jadi seluruh sesinya langsung dicabut.

Saat logout, server mengambil `jti` dari access token dan menaruhnya di denylist Redis. Masa berlakunya diset sama dengan sisa umur token (`exp - now`), jadi entri itu hilang sendiri dan denylist tidak membengkak. Refresh token milik sesi itu juga dihapus.

Pengecekan denylist cuma dilakukan di endpoint sensitif seperti checkout dan pembayaran. Endpoint biasa, misalnya daftar produk, cukup memeriksa signature dan `exp`. Jujur saja, ini bukan stateless murni. Tapi ini kompromi yang disengaja: jalur yang paling ramai tetap ringan, dan jalur yang berisiko tetap terjaga.

### Penanganan Race Condition
Solusinya menggabungkan "cek" dan "kurangi" dalam satu perintah:

```sql
UPDATE products SET stock = stock - 1 WHERE id = $1 AND stock >= 1;
```

Perintah ini dijalankan dalam satu transaksi bersama INSERT order. PostgreSQL mengunci baris itu saat UPDATE, jadi 100 request mengantre satu per satu. Yang pertama berhasil. Sisanya mendapati `stock >= 1` sudah tidak terpenuhi, `rowCount` bernilai 0, dan mereka ditolak dengan pesan stok habis.

Sebagai pengaman, tabel diberi `CHECK (stock >= 0)`, lalu `UNIQUE (user_id, product_id, sale_id)` agar satu user tidak bisa membeli dua kali, dan idempotency key supaya klik ganda atau retry tidak membuat order ganda.

Untuk ribuan request per detik, menembak database langsung tetap berat. Karena itu stok juga dimuat ke Redis dan dilewatkan gerbang `DECR` atomik. Jika hasilnya di bawah 0, request ditolak dan stok di-`INCR` kembali supaya counter tidak negatif, tanpa pernah menyentuh database. Yang lolos masuk antrean, diproses worker, dan stoknya dikembalikan kalau pembayaran tidak selesai dalam batas waktu.

### Diagram Arsitektur

```text
Client
  |
  v
API Gateway (rate limit)
  |
  +-- /auth/*     --> Auth Service <--> Redis (refresh token, denylist)
  +-- /products   --> Product Service (verifikasi JWT saja)
  +-- /checkout   --> Verifikasi JWT + cek denylist (Redis)
                          |
                          v
                     Order Service
                          |
                          v
            Redis DECR stok --(hasil < 0)--> 409 Stok habis + INCR balik
                          |
                       (lolos)
                          v
                   Antrean BullMQ
                          |
                          v
                     Order Worker
                          |
                          v
        PostgreSQL: UPDATE stock - 1 WHERE stock >= 1 + INSERT order
                          |
              +-----------+-----------+
              |                       |
          berhasil            gagal / timeout bayar
              |                       |
     Menunggu pembayaran     Rollback + INCR Redis
```

---

## Soal #3: Integrasi API, Webhook Reliability, & Resiliency

### Idempotency pada Webhook
Webhook dikirim dengan prinsip at-least-once, jadi event yang sama bisa datang berkali-kali. Endpoint saya rancang dengan urutan: verifikasi signature (HMAC dan cek timestamp), catat event, balas cepat, lalu proses secara asinkron di worker.

Deduplikasi dilakukan di database. Setiap event disimpan ke tabel `webhook_events` dengan unique constraint `(provider, event_id)` memakai `INSERT ... ON CONFLICT DO NOTHING`. Jika tidak ada baris yang masuk, berarti event duplikat, dan endpoint tetap membalas 200 agar PG berhenti retry. Cara ini lebih aman daripada "SELECT dulu baru INSERT" yang rawan race condition.

Di worker, idempotency dijaga lagi di level bisnis. Dalam satu transaksi, record payment dikunci (`FOR UPDATE`), nominal divalidasi, lalu status hanya boleh berpindah lewat transisi valid seperti PENDING ke PAID. Event ganda atau tidak berurutan diabaikan, sehingga stok tidak berkurang dua kali. Untuk request keluar ke PG, saya menyertakan header `Idempotency-Key` agar retry tidak membuat tagihan ganda.

### Fallback / Retry Mechanism
Penanganan kegagalan dibuat berlapis. Pertama, job di BullMQ di-retry otomatis dengan exponential backoff dan jitter. Retry ini aman karena pemrosesannya idempotent. Jika tetap gagal setelah batas percobaan, job masuk ke failed queue (dead letter) dan memicu alert, lalu bisa di-replay manual lewat dashboard admin. Pada panggilan HTTP ke Payment Gateway, timeout dibuat singkat (misalnya 5 detik), dan circuit breaker mencegah request berulang ke layanan yang sedang bermasalah. Di database, lock timeout dan statement timeout mencegah satu proses lambat menahan transaksi lain terlalu lama. Untuk webhook yang tidak pernah sampai, cron reconciliation menanyakan status langsung ke API PG. Dengan kombinasi ini, kegagalan sementara pulih otomatis, sedangkan kegagalan permanen terdeteksi dan ditangani manusia.

### Komunikasi Status Pembayaran di Frontend
Untuk update status di frontend, digunakan polling dengan interval yang membesar bertahap (mulai dari 2 detik hingga maksimal 15 detik), dan berhenti otomatis saat status sudah final atau tab tidak aktif. Polling dipilih karena kebutuhannya satu arah dan hanya berlangsung beberapa menit, sehingga WebSocket terlalu berlebihan. SSE lebih efisien untuk skala besar, tetapi menambah kebutuhan infrastruktur seperti Redis Pub/Sub dan konfigurasi proxy, sehingga cocok sebagai tahap pengembangan berikutnya. Di sisi server, endpoint status dibuat ringan (hanya mengembalikan status) dengan cache singkat agar database tidak terus dibebani. Durasi polling dibatasi sekitar 30-60 detik. Jika status masih PENDING, UI menampilkan pesan bahwa pembayaran sedang diproses dan tidak perlu dibayar ulang, disertai tombol "Cek status" dan notifikasi email saat pembayaran terkonfirmasi. Dengan begitu, UI tidak menggantung, beban server terkendali, dan risiko pembayaran ganda dapat dihindari.

---

## Soal #4: TCO & Monolith vs Microservices

### Analisis TCO
Biaya server saat ini sekitar $150 per bulan atau $1.800 per tahun. Jika berpindah ke microservices di AWS, infrastrukturnya butuh EKS, managed database, Redis, load balancer, NAT gateway, monitoring, dan beberapa service terpisah. Estimasi kasar (asumsi, perlu dicek dengan AWS Pricing Calculator):

| Komponen | Estimasi |
| --- | --- |
| Infrastruktur AWS | $500 - $1.100/bulan ($6.000 - $13.500/tahun) |
| Migrasi (3 engineer x 4 bulan) | sekitar $30.000 sekali bayar |
| DevOps/SRE tambahan (0,5 - 1 FTE) | $18.000 - $36.000/tahun |
| **Total tahun pertama** | **sekitar $54.000 - $79.500** vs $1.800 saat ini |

Biaya infrastruktur saja sudah 3-7 kali lipat kondisi sekarang, belum termasuk fitur yang tertunda selama migrasi. Untuk startup skala awal-menengah, migrasi penuh ke microservices belum memberikan keuntungan yang sebanding dengan biayanya.

### Hidden Costs
Dari sisi infrastruktur, biaya yang sering tidak terlihat di awal adalah NAT Gateway (biaya per jam plus per GB), data transfer antar-AZ, resource idle karena tiap service butuh instance sendiri, cold start Lambda, serta log dan metrics yang membengkak seiring jumlah service.

Dari sisi operasional, komunikasi antar-service menjadi network call yang butuh handling timeout, retry, dan failure. Transaksi yang sebelumnya cukup satu database menjadi transaksi terdistribusi (saga, eventual consistency). Jumlah pipeline CI/CD, testing, versioning API, dan kebutuhan distributed tracing untuk debugging juga bertambah, begitu pula beban on-call dan kurva belajar Kubernetes.

### Rekomendasi Arsitektur
Pendekatan yang lebih sesuai adalah modular monolith dengan ekstraksi service secara bertahap jika memang diperlukan. Codebase dipisahkan berdasarkan domain seperti Catalog, Order, Payment, Inventory, dan User dengan interface yang jelas, tetapi tetap satu deployment dan satu database. Performa ditingkatkan lebih dulu dengan Redis, background queue, CDN, load balancer, atau read replica sesuai kebutuhan, dengan estimasi biaya sekitar $200 - $350 per bulan. Jika nantinya ada komponen dengan kebutuhan scaling atau workload yang berbeda (misalnya webhook pembayaran atau notifikasi), komponen tersebut dapat diekstrak menjadi service terpisah berdasarkan bukti metrik, bukan asumsi.

---

## Soal #5: Prioritisasi Feature, LTV/CAC, & Tech Debt

### Komunikasi ke Stakeholder Non-Teknis
Technical Debt perlu dijelaskan berdasarkan dampaknya terhadap bisnis, bukan hanya dari sisi teknis. Jika codebase berisiko menyebabkan server down, dampaknya berupa downtime, transaksi gagal, kehilangan user, dan pada akhirnya mengganggu target bisnis. Kepada Product Manager, risiko ini disampaikan bersama kemungkinan dan dampaknya (misalnya "sudah terjadi 2 kali bulan lalu, kalau checkout mati kita kehilangan omzet per jam"), lalu ditawarkan opsi, misalnya 3 fitur dengan risiko tetap ada, atau 2 fitur plus perbaikan debt kritis. Dengan begitu keputusan menjadi trade-off yang jelas antara mengejar fitur baru dan menjaga reliability sistem.

### Hubungan Reliabilitas dengan Churn & LTV
Error yang sering terjadi, performa yang buruk, atau downtime meningkatkan kemungkinan user meninggalkan produk sehingga churn rate naik. Ketika churn naik, durasi user menggunakan produk memendek dan LTV ikut turun:

```text
LTV = (ARPU x Gross Margin) / Churn Rate bulanan
```

Contoh ilustrasi dengan ARPU $10, margin 70%, dan CAC $40: churn 5% menghasilkan LTV $140 (LTV/CAC = 3,5), sedangkan churn 8% menghasilkan LTV $87,5 (LTV/CAC sekitar 2,2). Artinya mengejar CAC atau acquisition saja tidak cukup jika customer yang berhasil didapatkan tidak dapat dipertahankan karena kualitas sistem yang buruk.

### Framework Prioritisasi Sprint
Setiap item debt dinilai dengan **Risk Score = Likelihood (1-5) x Impact (1-5)**, dengan impact diukur dari availability, security, dan kedekatan dengan alur utama seperti checkout dan pembayaran. Skor 15 ke atas dianggap kritis dan dikerjakan lebih dulu sebelum fitur baru.

Dalam kondisi normal, kapasitas sprint dibagi 70% untuk fitur bisnis dan 30% untuk technical debt. Jika ada risiko server down yang tinggi, porsi debt dinaikkan (misalnya 50-60%) sampai risikonya terkendali, dan fitur dipilih dari yang dampaknya paling besar dengan usaha paling kecil. Setiap sprint dievaluasi berdasarkan metrik seperti error rate, downtime, latensi, churn, conversion, dan progress fitur sehingga rasio sprint berikutnya ditentukan dari data.
