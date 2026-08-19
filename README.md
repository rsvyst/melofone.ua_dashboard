# Melofone.ua — Пульт воронки продажів (standalone / GitHub Pages)

Це самостійна версія дашборду — на відміну від версії-артефакту в Claude,
тут кнопка **«☎ Оновити дзвінки»** працює по-справжньому наживо: браузер
поза Claude не обмежений CSP-політикою пісочниці артефактів, тож `fetch()`
до Cloudflare Worker відпрацьовує напряму.

**⚠️ Приватний репозиторій.** `src/App.jsx` містить `PROXY_TOKEN` у
відкритому вигляді. Не робіть репозиторій публічним.

## Запуск локально

```bash
npm install
npm run dev
```

Відкриється на `http://localhost:5173`.

## Деплой на GitHub Pages

### Варіант А — автоматично через GitHub Actions (рекомендовано)

1. Запуште цей проєкт у гілку `main` вашого репозиторію.
2. У репозиторії: **Settings → Pages → Source → "GitHub Actions"**.
3. Все, готово — при кожному push у `main` workflow
   (`.github/workflows/deploy.yml`) сам збере проєкт і викладе на
   `https://<ваш-логін>.github.io/<назва-репо>/`.

Оскільки репозиторій приватний, потрібен GitHub план, що підтримує Pages
для приватних репо (Pro / Team / Enterprise) — або зробіть репозиторій
публічним і **обов'язково** приберіть `PROXY_TOKEN` з коду перед цим
(винесіть у змінну середовища збірки).

### Варіант Б — вручну через пакет `gh-pages`

```bash
npm install
npm run deploy
```

Це збере проєкт і запушить `dist/` у гілку `gh-pages`. Далі в
**Settings → Pages → Source** виберіть гілку `gh-pages`.

## Структура

```
src/
  App.jsx      — весь дашборд: парсинг файлу заявок, метрики, графіки,
                 live-запит до Binotel-проксі
  main.jsx     — точка входу React
index.html
vite.config.js — base: './' — працює на будь-якій назві репозиторію
```

## Binotel-проксі (Cloudflare Worker)

Код Worker'а і його налаштування — в окремому репозиторії/файлі
`melofone-binotel-proxy-worker.js`, який ви вже задеплоїли на
`melofone-binotel-proxy.r-svyst.workers.dev`. Тут дашборд просто звертається
до нього по `BINOTEL_PROXY_URL` + `BINOTEL_PROXY_TOKEN` (обидва — у
`src/App.jsx`, вгорі файлу).

Якщо перевипустите `PROXY_TOKEN` у Cloudflare — оновіть його і тут.

## GA4-проксі (другий Cloudflare Worker)

Аналогічно Binotel, але для Google Analytics 4: `melofone-ga4-proxy-worker.js`,
задеплоєний на `melofone-ga4-proxy.r-svyst.workers.dev`. Авторизується як
службовий обліковий запис Google (JWT, підписаний RS256 через Web Crypto —
без зовнішніх бібліотек), якому в GA4 виданий доступ Viewer. Секрети
(`GA_CLIENT_EMAIL`, `GA_PRIVATE_KEY`, `GA_PROPERTY_ID`, `PROXY_TOKEN`)
зберігаються в Cloudflare Secrets, ключ Google ніколи не потрапляє в код.

`GA4_PROXY_URL` / `GA4_PROXY_TOKEN` — в `src/App.jsx`, поруч з Binotel-константами.

**Важливо про версії Worker'а:** Cloudflare іноді зберігає нову версію
змінної, не роблячи її одразу активною (Version History показує кілька
версій, а задеплоєна — не найновіша). Якщо після зміни секрету відповідь
Worker'а не змінюється — перевірте вкладку **Deployments**: потрібна саме
та версія, що позначена як **Active deployment**; за потреби задеплойте
її вручну через «...» → Deploy.

### Рекомендація з безпеки

Зараз Worker приймає запити з будь-якого домену (`Access-Control-Allow-Origin: *`).
Після деплою на Pages можна звузити це до вашого домену — у Worker'і
замініть `"*"` на конкретний origin, напр.
`"https://<ваш-логін>.github.io"`, у функції `corsHeaders()`.

## Відомі обмеження / TODO

- [x] Binotel: поле `phone` заповнюється коректно (`externalNumber` → `phone`).
- [x] GA4 підключено — сесії, користувачі, конверсії, розбивка по каналах.
- [ ] Звузити CORS обох Worker'ів до конкретного домену Pages.
- [ ] Розглянути ротацію `BINOTEL_SECRET` в кабінеті Binotel (одного разу
      був надісланий у чат у відкритому вигляді).
- [ ] "Подій-конверсій" з GA4 — це ключові події в GA4 (можуть включати
      кліки, форми тощо), а не лише покупки; за потреби звузити
      `runReport` до конкретної події (напр. `purchase`).
