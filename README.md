# Mason Bot

Telegram-бот для работы с анкетами агентов.

Что уже реализовано:


## Запуск

1. Скопируйте `.env.example` в `.env`.
2. Укажите `BOT_TOKEN` и `OWNER_TELEGRAM_ID`.
3. Установите зависимости:

```bash
npm install
```

4. Запустите в режиме разработки:

```bash
npm run dev
```

## Основные команды


## Статусы

Модерация:


Бизнес-статусы:


## Поля анкеты

Сейчас используется примерная схема:


Эту схему можно легко поменять позже в коде.
# Mason Bot

Telegram-бот для работы с анкетами агентов.

## Требования

- Node.js 20+
- npm 10+

## Переменные окружения

Создайте файл `.env` на основе `.env.example`.

```env
BOT_TOKEN=your_telegram_bot_token
OWNER_TELEGRAM_ID=123456789
```

## Локальный запуск

1. Установите зависимости:

```bash
npm install
```

2. Запустите режим разработки:

```bash
npm run dev
```

3. Или соберите проект и запустите production-версию:

```bash
npm run build
npm start
```

Для Windows PowerShell, если `npm` блокируется execution policy, используйте:

```powershell
npm.cmd run build
npm.cmd start
```

## Хранение данных

- Данные бота хранятся в `data/db.json`.
- Файл создается автоматически при первом запуске.
- Папка `data/` исключена из git, поэтому для production нужно отдельно сохранять и бэкапить этот файл.

## Production на VPS

Готовая инструкция для DigitalOcean и PM2 находится в файле `DEPLOY_DIGITALOCEAN.md`.

Коротко:

```bash
npm install
npm run build
pm2 start ecosystem.config.cjs
pm2 save
```
