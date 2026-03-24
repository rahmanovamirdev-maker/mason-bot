# Деплой на DigitalOcean

Инструкция рассчитана на Ubuntu 22.04 или 24.04.

## 1. Подключение к серверу

```bash
ssh root@YOUR_SERVER_IP
```

## 2. Установка системных пакетов

```bash
apt update && apt upgrade -y
apt install -y curl git
```

## 3. Установка Node.js

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs
node -v
npm -v
```

## 4. Установка PM2

```bash
npm install -g pm2
pm2 -v
```

## 5. Загрузка проекта на сервер

Если проект находится в git:

```bash
cd /opt
git clone YOUR_REPOSITORY_URL mason-bot
cd /opt/mason-bot
```

Если git-репозитория нет, загрузите проект через SFTP или WinSCP в папку `/opt/mason-bot`.

## 6. Настройка окружения

Создайте файл `.env`:

```bash
cd /opt/mason-bot
cp .env.example .env
nano .env
```

Укажите значения:

```env
BOT_TOKEN=your_telegram_bot_token
OWNER_TELEGRAM_ID=123456789
```

## 7. Установка зависимостей и сборка

```bash
cd /opt/mason-bot
npm install
npm run build
```

## 8. Первый запуск через PM2

```bash
cd /opt/mason-bot
pm2 start ecosystem.config.cjs
pm2 status
pm2 logs mason-bot
```

## 9. Автозапуск после перезагрузки сервера

```bash
pm2 save
pm2 startup
```

PM2 выведет команду, которую нужно выполнить. После этого еще раз сохраните состояние:

```bash
pm2 save
```

## 10. Обновление бота

Если проект обновляется через git:

```bash
cd /opt/mason-bot
git pull
npm install
npm run build
pm2 restart mason-bot
```

Если вы обновляете проект вручную, загрузите новые файлы, затем выполните:

```bash
cd /opt/mason-bot
npm install
npm run build
pm2 restart mason-bot
```

## 11. Полезные команды

```bash
pm2 status
pm2 logs mason-bot
pm2 restart mason-bot
pm2 stop mason-bot
pm2 delete mason-bot
```

## 12. Бэкап данных

База хранится в `data/db.json`. Эта папка не коммитится в git.

Простой ручной бэкап:

```bash
cp /opt/mason-bot/data/db.json /opt/mason-bot/data/db.json.bak
```

## 13. Если на сервере уже есть сайт

Этот бот работает как отдельный Node.js процесс и обычно не требует открытого входящего порта.

Обычная схема:

- сайт работает через nginx
- бот запущен через PM2
- конфликтов нет, если хватает RAM и CPU

## 14. Быстрый чек-лист

```bash
apt update && apt upgrade -y
apt install -y curl git
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs
npm install -g pm2
cd /opt
git clone YOUR_REPOSITORY_URL mason-bot
cd /opt/mason-bot
cp .env.example .env
nano .env
npm install
npm run build
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup
```