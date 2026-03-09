# Hakaton Full-Stack Platforma

Premium Apple/iPhone uslubidagi full-stack web ilova:

- Frontend: `index.html + style.css + script.js` (single-page app)
- Backend: Node.js + Express.js + MongoDB
- Auth: Telefon raqam + Telegram bot orqali 6 xonali kod verifikatsiyasi
- Til: O'zbekcha interfeys

## Folder Structure

```text
Hakaton/
  index.html
  style.css
  script.js
  backend/
    src/
      config/
      controllers/
      middleware/
      models/
      routes/
      services/
      utils/
      app.js
      server.js
    .env.example
    package.json
  frontend/ (legacy Next.js source, optional)
  README.md
```

## Core Features

- Ro'yxatdan o'tish: Ism, familiya, sinf, telefon
- Telegram verifikatsiya kodi yuborish
- Kod tasdiqlangach: `Ro'yxatdan o'tdingiz` va profilga redirect
- Profil sahifasi: Ism, familiya, sinf va testlar
- Test topshirilgach natija admin tekshiruviga tushadi (`pending`)
- Admin panel:
  - Userlar ro'yxati (qidirish, tahrirlash, o'chirish)
  - Bo'limlar (section) yaratish, tahrirlash, o'chirish
  - Har bir bo'limga maksimal 7 ta test
  - Test natijalarini ko'rish va `o'tdi/o'tmadi` bilan izoh berish

## 1) Backend Setup

```bash
cd backend
npm install
cp .env.example .env
```

`backend/.env` ni to'ldiring:

```env
PORT=5000
DEMO_MODE=false
DEMO_SEED_TESTS=false
DEMO_EXPOSE_CODE=true
MONGODB_URI=mongodb://127.0.0.1:27017/hakaton_db
ALLOW_MEMORY_DB_FALLBACK=false
FRONTEND_URL=http://localhost:3000
JWT_SECRET=your_long_secret
JWT_EXPIRES_IN=7d

ADMIN_USERNAME=admin
ADMIN_PASSWORD_HASH=your_bcrypt_hash
ADMIN_PASSWORD=

TELEGRAM_BOT_TOKEN=your_real_bot_token
TELEGRAM_BOT_USERNAME=AI_Hakaton27bot
TELEGRAM_WEBHOOK_SECRET=any_random_secret
```

Serverni ishga tushirish:

```bash
npm run dev
```

`DEMO_MODE=false` production uchun tavsiya etiladi (MongoDB bilan).
`DEMO_MODE=true` faqat lokal demo uchun.
`DEMO_EXPOSE_CODE=true` bo'lsa Telegram ishlamasa kod javobda demo ko'rinadi.

Eslatma:

- `DEMO_MODE` umuman berilmasa va `MONGODB_URI` bo'lmasa, tizim avtomatik demo rejimga o'tadi.
- Demo rejimda `JWT_SECRET` bo'lmasa ham fallback secret bilan ishlaydi (prod uchun tavsiya etilmaydi).

## 2) Frontend Setup (index.html)

`index.html`, `style.css`, `script.js` root papkada tayyor.

Frontend API qidirish tartibi:

1. `current-origin/api` (Vercel bitta loyiha uchun asosiy yo'l)
2. `meta` yoki `window.HAKATON_API_URL` yoki `localStorage` (`hakaton_api_url`)
3. `http://localhost:5000/api` (faqat lokal developmentda)

Muhim:

- Production (`vercel.app`)da local demo fallback yoqilgan emas.
- Productionda backend bo'lmasa ro'yxatdan o'tish davom etmaydi (qat'iy backend rejimi).

Ishga tushirish variantlari:

1. `index.html` ni to'g'ridan-to'g'ri brauzerda ochish
2. yoki oddiy static server bilan ochish (`Live Server`, `python -m http.server`, va hokazo)

Backend URL default:

```text
http://localhost:5000/api
```

Agar backend URL boshqa bo'lsa brauzer console orqali o'rnating:

```js
localStorage.setItem("hakaton_api_url", "https://your-backend-url/api");
location.reload();
```

Frontend: `index.html` (yoki static server URL)  
Backend: `http://localhost:5000`

## Telegram Verification Flow

1. User telefon kiritadi
2. Backend 6 xonali kod yaratadi
3. Kod Telegram botga yuboriladi
4. User kodni kiritadi
5. To'g'ri bo'lsa ro'yxatdan o'tadi

### Muhim

Telegram userga yozish uchun user botga kamida bir marta `/start` yuborgan bo'lishi kerak.

Loyihada bu bog'lanish `link_<phone>` payload orqali ishlaydi:

- Frontend bot link beradi: `https://t.me/AI_Hakaton27bot?start=link_998XXXXXXXXX`
- Telegram webhook bu payloadni qabul qilib `phone -> chatId` ni saqlaydi

### Webhook sozlash

Production backend URL misol:

```bash
https://your-backend-domain.com
```

Webhook o'rnatish:

```bash
https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook?url=https://your-backend-domain.com/api/telegram/webhook/<TELEGRAM_WEBHOOK_SECRET>
```

## API Endpoints (Main)

- `POST /api/auth/request-code`
- `POST /api/auth/verify-code`
- `POST /api/auth/direct-register`
- `POST /api/telegram/webhook/:secret`
- `GET /api/users/me`
- `GET /api/tests`
- `GET /api/tests/:id`
- `POST /api/tests/:id/submit`
- `POST /api/admin/login`
- `GET /api/admin/users?search=...`
- `PUT /api/admin/users/:id`
- `DELETE /api/admin/users/:id`
- `GET /api/admin/tests`
- `POST /api/admin/tests`
- `PUT /api/admin/tests/:id`
- `DELETE /api/admin/tests/:id`
- `GET /api/admin/sections`
- `POST /api/admin/sections`
- `PUT /api/admin/sections/:id`
- `DELETE /api/admin/sections/:id`
- `GET /api/admin/sections/:sectionId/tests`
- `POST /api/admin/sections/:sectionId/tests`
- `GET /api/admin/attempts`
- `POST /api/admin/attempts/:id/review`

## Deployment (Production)

## Vercel (Frontend + API bitta loyiha) - Tavsiya etiladi

Bu repo Vercelda **bitta project** bo'lib deploy qilinadi:

- Frontend: rootdagi `index.html`, `style.css`, `script.js`
- Backend API: rootdagi `api/` (`/api/*`)
- Routing: Vercel default function routing (`/api/*`) ishlatiladi

### Deploy qadamlari

1. Repo rootdan Vercelga ulang (subfolder emas).
2. Production (barqaror umumiy baza) uchun quyidagi Environment Variables ni kiriting:
   - `DEMO_MODE=false`
   - `MONGODB_URI=<mongo connection string>`
   - `JWT_SECRET=<uzun maxfiy kalit>`
   - `JWT_EXPIRES_IN=7d`
   - `ADMIN_USERNAME=admin`
   - `ADMIN_PASSWORD_HASH=<bcrypt hash>`
   - `FRONTEND_URL=https://sizning-domeningiz.vercel.app`
   - `TELEGRAM_BOT_TOKEN=...` (Telegram ishlatsa)
   - `TELEGRAM_BOT_USERNAME=AI_Hakaton27bot`
   - `TELEGRAM_WEBHOOK_SECRET=...`
3. Deploydan keyin tekshiring:
   - `https://sizning-domeningiz.vercel.app/api/health`
4. So'ng ro'yxatdan o'tish va admin panel oqimini test qiling.

Natija: admin paneldagi users/tests/attempts barcha qurilmalarda bir xil ko'rinadi.

Tez ishga tushirish (envsiz demo):

- Hech qanday ENV bermasangiz ham API ishlaydi (demo rejim).
- Lekin ko'p qurilmali barqaror saqlash uchun albatta `MONGODB_URI` + `DEMO_MODE=false` qo'ying.

### Troubleshooting: `api/health` ishlaydi, lekin register fail bo'ladi

1. Brauzerda eski override bo'lsa tozalang:
   ```js
   localStorage.removeItem("hakaton_api_url");
   localStorage.removeItem("hakaton_api_override");
   location.reload();
   ```
2. Ro'yxatdan o'tishni oddiy brauzerda tekshirib ko'ring (in-app webview emas).
3. `F12 -> Console` ichida `[API]` diagnostika loglarini tekshiring.

Ixtiyoriy manual override (faqat kerak bo'lsa):

```js
localStorage.setItem("hakaton_api_override", "1");
localStorage.setItem("hakaton_api_url", "https://your-backend-url/api");
location.reload();
```

## Backend (Render/Railway/VPS)

1. `backend` papkani deploy qiling
2. Environment variables ni to'ldiring
3. `DEMO_MODE=false` qiling va `MONGODB_URI` ni to'g'ri bering
4. HTTPS bilan public domain oling
5. Telegram webhookni yuqoridagi URL bilan ulang

## Frontend alohida deploy (ixtiyoriy)

Agar frontend va backend alohida domainlarda bo'lsa, API URL ni qo'lda berish kerak:

`localStorage.setItem("hakaton_api_url","https://your-backend-url/api")`

Lekin productionda tavsiya etiladigan usul: **bitta Vercel loyiha**.

## Security va Performance

- Helmet + CORS + Rate limit
- JWT auth (admin/user rollari)
- Kod hash holatda saqlanadi (sha256)
- Kod expiry (10 daqiqa, TTL index)
- Mobil-first responsive layout
- Glassmorphism + gradient + yengil animatsiyalar
- Minimal va tez frontend komponentlar
