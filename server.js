const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { Telegraf } = require('telegraf');

const PORT = Number(process.env.PORT || 3000);
const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_TELEGRAM_ID = String(process.env.ADMIN_TELEGRAM_ID || '6545688842');
const FRONTEND_URL = process.env.FRONTEND_URL || 'https://quran-ayah-quiz.vercel.app';
const SUPPORT_USERNAME = process.env.SUPPORT_USERNAME || '@luck_7n';
const TELEBIRR_NUMBER = process.env.TELEBIRR_NUMBER || '0938054751';
const TELEBIRR_NAME = process.env.TELEBIRR_NAME || 'Lakin Awel';
const PRO_STARS = 10;
const TELEBIRR_ETB = 25;
const INITDATA_MAX_AGE_SECONDS = 24 * 60 * 60;

if (!BOT_TOKEN) {
  console.error('Missing BOT_TOKEN environment variable.');
  process.exit(1);
}

const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '100kb' }));
app.use(cors({
  origin(origin, callback) {
    if (!origin || origin === FRONTEND_URL || origin === 'https://quran-ayah-quiz.vercel.app') {
      return callback(null, true);
    }
    return callback(new Error('CORS origin not allowed'));
  }
}));

const DATA_DIR = path.join(__dirname, 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');

function ensureDataFile() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(USERS_FILE)) fs.writeFileSync(USERS_FILE, '{}');
}
ensureDataFile();

let users = {};
try { users = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8')) || {}; }
catch (_) { users = {}; }

function saveUsers() {
  const tmp = USERS_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(users, null, 2));
  fs.renameSync(tmp, USERS_FILE);
}

function getUser(id, extra = {}) {
  const key = String(id);
  if (!users[key]) {
    users[key] = {
      id: key,
      isPro: false,
      createdAt: new Date().toISOString(),
      ...extra
    };
  } else {
    users[key] = {...users[key], ...extra};
  }
  if (key === ADMIN_TELEGRAM_ID) users[key].isPro = true;
  return users[key];
}

/*
  Telegram Web App initData validation:
  - hash is removed from the data-check-string
  - fields are sorted and joined by newline
  - secret key = HMAC-SHA256("WebAppData", bot token)
  - final hash = HMAC-SHA256(secret key, data-check-string)
*/
function validateInitData(initData) {
  if (!initData || typeof initData !== 'string') {
    throw new Error('Telegram initData is required');
  }

  const params = new URLSearchParams(initData);
  const receivedHash = params.get('hash');
  if (!receivedHash) throw new Error('Telegram hash missing');

  const authDate = Number(params.get('auth_date') || 0);
  if (!authDate || Math.floor(Date.now() / 1000) - authDate > INITDATA_MAX_AGE_SECONDS) {
    throw new Error('Telegram session expired. Reopen the Mini App.');
  }

  params.delete('hash');
  const pairs = [];
  for (const [key, value] of params.entries()) pairs.push([key, value]);
  pairs.sort(([a], [b]) => a.localeCompare(b));
  const dataCheckString = pairs.map(([k, v]) => `${k}=${v}`).join('\n');

  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
  const calculatedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

  const a = Buffer.from(calculatedHash, 'hex');
  const b = Buffer.from(receivedHash, 'hex');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    throw new Error('Invalid Telegram initData');
  }

  let telegramUser;
  try {
    telegramUser = JSON.parse(params.get('user') || 'null');
  } catch (_) {
    throw new Error('Invalid Telegram user data');
  }
  if (!telegramUser?.id) throw new Error('Telegram user missing');

  return telegramUser;
}

function authMiddleware(req, res, next) {
  try {
    const user = validateInitData(req.body?.initData || req.headers['x-telegram-init-data']);
    req.telegramUser = user;
    req.account = getUser(user.id, {
      firstName: user.first_name || '',
      lastName: user.last_name || '',
      username: user.username || ''
    });
    next();
  } catch (err) {
    return res.status(401).json({error: err.message || 'Unauthorized'});
  }
}

function publicUser(account, telegramUser) {
  return {
    id: String(telegramUser.id),
    first_name: telegramUser.first_name || '',
    last_name: telegramUser.last_name || '',
    username: telegramUser.username || '',
    isPro: String(telegramUser.id) === ADMIN_TELEGRAM_ID || !!account.isPro,
    isAdmin: String(telegramUser.id) === ADMIN_TELEGRAM_ID
  };
}

app.get('/', (_req, res) => {
  res.json({
    ok: true,
    service: 'Ayah Quiz backend',
    version: '2.1.0'
  });
});

app.get('/api/health', (_req, res) => {
  res.json({ok:true, botConfigured:!!BOT_TOKEN});
});

app.post('/api/auth', authMiddleware, (req, res) => {
  if (String(req.telegramUser.id) === ADMIN_TELEGRAM_ID) {
    req.account.isPro = true;
    saveUsers();
  }
  res.json({user: publicUser(req.account, req.telegramUser)});
});

async function telegramApi(method, body) {
  const response = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify(body)
  });
  const data = await response.json();
  if (!data.ok) throw new Error(data.description || `Telegram API ${method} failed`);
  return data.result;
}

app.post('/api/create-invoice', authMiddleware, async (req, res) => {
  try {
    if (String(req.telegramUser.id) === ADMIN_TELEGRAM_ID || req.account.isPro) {
      return res.json({alreadyPro:true});
    }

    const payload = `ayahquiz_pro_${req.telegramUser.id}`;
    const invoiceLink = await telegramApi('createInvoiceLink', {
      title: 'Ayah Quiz Pro',
      description: 'Unlimited Quran quiz practice, advanced revision, bookmarks, mistakes and Pro features.',
      payload,
      currency: 'XTR',
      prices: [{label:'Ayah Quiz Pro', amount:PRO_STARS}]
    });

    res.json({invoiceLink});
  } catch (err) {
    console.error('create-invoice:', err);
    res.status(500).json({error:'Could not create Telegram Stars invoice.'});
  }
});

app.post('/api/pro/telebirr', authMiddleware, async (req, res) => {
  const reference = String(req.body?.reference || '').trim();
  if (!reference || reference.length < 3 || reference.length > 100) {
    return res.status(400).json({error:'Enter a valid Telebirr transaction/reference ID.'});
  }

  const id = String(req.telegramUser.id);
  const account = req.account;

  // Resolve the current Telegram username from Telegram itself.
  // The frontend must never be trusted for identity/payment ownership.
  try {
    const chat = await bot.telegram.getChat(id);
    if (chat?.username) account.username = chat.username;
  } catch (err) {
    console.warn('Could not resolve Telegram username:', err.message);
  }

  const displayName = String(req.body?.displayName || '').trim().slice(0, 30);
  if (displayName) account.displayName = displayName;

  account.telebirrRequest = {
    reference,
    amount:TELEBIRR_ETB,
    phone:TELEBIRR_NUMBER,
    name:TELEBIRR_NAME,
    submittedAt:new Date().toISOString(),
    status:'pending'
  };
  saveUsers();

  try {
    await bot.telegram.sendMessage(
      ADMIN_TELEGRAM_ID,
      [
        '🧾 <b>New Ayah Quiz Pro — Telebirr request</b>',
        account.username
          ? `Username: <b>@${escapeTelegram(account.username)}</b>`
          : `Account: <a href="tg://user?id=${id}">${escapeTelegram(account.displayName || `${account.firstName || ''} ${account.lastName || ''}`.trim() || 'Telegram user')}</a>\nUsername: <i>not set</i>`,
        `Display name: ${escapeTelegram(account.displayName || `${account.firstName || ''} ${account.lastName || ''}`.trim() || 'Unknown')}`,
        `Telegram ID: <code>${id}</code>`,
        `Amount: <b>${TELEBIRR_ETB} ETB</b>`,
        `Reference: <code>${escapeTelegram(reference)}</code>`
      ].join('\n'),
      {
        parse_mode:'HTML',
        reply_markup:{
          inline_keyboard:[[
            {text:'✅ Approve',callback_data:`tb_approve_${id}`},
            {text:'❌ Reject',callback_data:`tb_reject_${id}`}
          ]]
        }
      }
    );
  } catch (err) {
    console.error('Admin notification failed:', err);
  }

  res.json({ok:true});
});

function escapeTelegram(value) {
  return String(value).replace(/[<>&"]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c]));
}

const bot = new Telegraf(BOT_TOKEN);

bot.start(async (ctx) => {
  await ctx.reply(
    'Assalamu alaikum 🌙\\n\\nWelcome to Ayah Quiz. Open the Mini App from the bot menu to practice Quran memorization.',
    {
      reply_markup:{
        inline_keyboard:[[
          {text:'📖 Open Ayah Quiz', web_app:{url:FRONTEND_URL}}
        ]]
      }
    }
  );
});

bot.on('pre_checkout_query', async (ctx) => {
  const q = ctx.preCheckoutQuery;
  const expectedPayload = `ayahquiz_pro_${q.from.id}`;

  if (q.currency !== 'XTR' || Number(q.total_amount) !== PRO_STARS || q.invoice_payload !== expectedPayload) {
    return ctx.answerPreCheckoutQuery(false, 'This Pro invoice is invalid or expired.');
  }

  try {
    await ctx.answerPreCheckoutQuery(true);
  } catch (err) {
    console.error('pre_checkout:', err);
  }
});

bot.on('message', async (ctx) => {
  const payment = ctx.message?.successful_payment;
  if (!payment) return;
  if (payment.currency !== 'XTR') return;

  const expectedPayload = `ayahquiz_pro_${ctx.from.id}`;
  if (payment.invoice_payload !== expectedPayload || Number(payment.total_amount) !== PRO_STARS) {
    console.warn('Rejected unexpected payment payload:', payment.invoice_payload);
    return;
  }

  const account = getUser(ctx.from.id, {
    firstName:ctx.from.first_name || '',
    lastName:ctx.from.last_name || '',
    username:ctx.from.username || ''
  });

  account.isPro = true;
  account.starsPayment = {
    chargeId:payment.telegram_payment_charge_id,
    amount:payment.total_amount,
    currency:payment.currency,
    paidAt:new Date().toISOString()
  };
  saveUsers();

  // Notify the admin about every successful Stars subscriber. If the user
  // has no public @username, send a clickable Telegram account instead.
  try {
    const payerName = [ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(' ') || 'Telegram user';
    const payerIdentity = ctx.from.username
      ? `Username: <b>@${escapeTelegram(ctx.from.username)}</b>`
      : `Account: <a href="tg://user?id=${ctx.from.id}">${escapeTelegram(payerName)}</a>\nUsername: <i>not set</i>`;
    await ctx.telegram.sendMessage(
      ADMIN_TELEGRAM_ID,
      [
        '⭐ <b>New Ayah Quiz Pro — Telegram Stars</b>',
        payerIdentity,
        `Telegram ID: <code>${ctx.from.id}</code>`,
        `Amount: <b>${PRO_STARS} Stars</b>`,
        `Charge ID: <code>${escapeTelegram(payment.telegram_payment_charge_id || '')}</code>`
      ].join('\n'),
      {parse_mode:'HTML'}
    );
  } catch (err) {
    console.error('Stars admin notification failed:', err);
  }

  await ctx.reply(
    '🎉 <b>Ayah Quiz Pro activated!</b>\\n\\nYour Pro features are now unlocked. Open the Mini App again to refresh your account.',
    {parse_mode:'HTML'}
  );
});

bot.action(/^tb_approve_(\\d+)$/, async (ctx) => {
  if (String(ctx.from.id) !== ADMIN_TELEGRAM_ID) {
    return ctx.answerCbQuery('Not authorized.', {show_alert:true});
  }

  const id = ctx.match[1];
  const account = users[id];
  if (!account) return ctx.answerCbQuery('User not found.', {show_alert:true});

  account.isPro = true;
  if (account.telebirrRequest) account.telebirrRequest.status = 'approved';
  account.telebirrApprovedAt = new Date().toISOString();
  saveUsers();

  try {
    await ctx.telegram.sendMessage(id, '🎉 Your Ayah Quiz Pro payment has been approved. Reopen the Mini App to unlock Pro.');
  } catch (_) {}

  await ctx.answerCbQuery('Pro approved.');
  try { await ctx.editMessageReplyMarkup({inline_keyboard:[]}); } catch (_) {}
});

bot.action(/^tb_reject_(\\d+)$/, async (ctx) => {
  if (String(ctx.from.id) !== ADMIN_TELEGRAM_ID) {
    return ctx.answerCbQuery('Not authorized.', {show_alert:true});
  }

  const id = ctx.match[1];
  const account = users[id];
  if (!account) return ctx.answerCbQuery('User not found.', {show_alert:true});

  if (account.telebirrRequest) account.telebirrRequest.status = 'rejected';
  saveUsers();

  try {
    await ctx.telegram.sendMessage(id, `Your Telebirr Pro request was not approved. Please contact ${SUPPORT_USERNAME} with your receipt.`);
  } catch (_) {}

  await ctx.answerCbQuery('Request rejected.');
  try { await ctx.editMessageReplyMarkup({inline_keyboard:[]}); } catch (_) {}
});

bot.catch((err) => console.error('Telegram bot error:', err));

app.use((err, _req, res, _next) => {
  console.error(err);
  if (!res.headersSent) res.status(500).json({error:'Server error'});
});

app.listen(PORT, () => {
  console.log(`Ayah Quiz API listening on ${PORT}`);
  bot.launch().then(() => console.log('Telegram bot launched')).catch(err => console.error('Bot launch failed:', err));
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
