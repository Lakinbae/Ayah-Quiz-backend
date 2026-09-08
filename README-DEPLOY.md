# Ayah Quest v4 — deployment

## 1. Supabase
1. Create a Supabase project.
2. Open SQL Editor.
3. Paste `supabase-schema.sql` and run it.
4. Copy the project URL and the backend-only secret/service-role key.

## 2. Render environment variables
Set these on the Render backend:

BOT_TOKEN=your_bot_token
ADMIN_TELEGRAM_ID=6545688842
FRONTEND_URL=https://quran-ayah-quiz.vercel.app
SUPPORT_USERNAME=@luck_7n
TELEBIRR_NUMBER=0938054751
TELEBIRR_NAME=Lakin Awel
SUPABASE_URL=https://YOUR_PROJECT.supabase.co
SUPABASE_SECRET_KEY=your_backend_secret_key

If your Supabase dashboard only exposes a service-role key, use:
SUPABASE_SERVICE_ROLE_KEY=...

Do not expose either Supabase secret/service-role key to the frontend.

## 3. Render build/start
Build command:
npm install

Start command:
npm start

The bot intentionally uses Telegram long polling. For reliable production operation, use an always-on paid Render Web Service. A sleeping/free service can make the bot appear offline until the service wakes.

## 4. Telegram profile
This server sets the default, English and Arabic bot name/description on startup:

Name: آيَة | Ayah Quest
Short description: Qur’an memory challenge • Free quiz • Pro revision tools

It also sets the command menu.

## 5. Telebirr flow
Mini App -> reference -> backend creates pending request -> bot asks for screenshot -> screenshot is forwarded to admin -> ONLY THEN are Approve/Reject buttons shown.

## 6. Important
This version no longer depends on `data/users.json` for persistence. User accounts, Pro state, payment records and quiz history are stored in Supabase.
