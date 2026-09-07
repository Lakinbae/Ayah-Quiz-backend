const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { Telegraf, Markup } = require('telegraf');

const PORT = Number(process.env.PORT || 3000);
const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_TELEGRAM_ID = String(process.env.ADMIN_TELEGRAM_ID || '6545688842');
const FRONTEND_URL = process.env.FRONTEND_URL || 'https://quran-ayah-quiz.vercel.app';
const SUPPORT_USERNAME = process.env.SUPPORT_USERNAME || '@luck_7n';
const TELEBIRR_NUMBER = process.env.TELEBIRR_NUMBER || '0938054751';
const TELEBIRR_NAME = process.env.TELEBIRR_NAME || 'Lakin';
const PRO_STARS = 10;
const TELEBIRR_ETB = 25;
const INITDATA_MAX_AGE_SECONDS = 24 * 60 * 60;
const BRAND = 'آيَة | Ayah Quest';

if (!BOT_TOKEN) {
  console.error('Missing BOT_TOKEN environment variable.');
  process.exit(1);
}

const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '100kb' }));
app.use(cors({
  origin(origin, callback) {
    if (!origin || origin === FRONTEND_URL || origin === 'https://quran-ayah-quiz.vercel.app') return callback(null, true);
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
try { users = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8')) || {}; } catch (_) { users = {}; }
function saveUsers() {
  const tmp = USERS_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(users, null, 2));
  fs.renameSync(tmp, USERS_FILE);
}
function getUser(id, extra = {}) {
  const key = String(id);
  if (!users[key]) users[key] = { id: key, isPro: false, createdAt: new Date().toISOString(), ...extra };
  else users[key] = { ...users[key], ...extra };
  if (key === ADMIN_TELEGRAM_ID) users[key].isPro = true;
  return users[key];
}
function displayNameOf(account) {
  return account.displayName || [account.firstName, account.lastName].filter(Boolean).join(' ') || 'Telegram user';
}
function accountIdentityHtml(account) {
  const id = String(account.id);
  const name = escapeTelegram(displayNameOf(account));
  if (account.username) return `👤 <b>@${escapeTelegram(account.username)}</b>`;
  return `👤 <a href="tg://user?id=${id}">${name}</a> <i>(no username)</i>`;
}
function escapeTelegram(value) {
  return String(value).replace(/[<>&"]/g, c => ({ '<':'&lt;', '>':'&gt;', '&':'&amp;', '"':'&quot;' }[c]));
}

function validateInitData(initData) {
  if (!initData || typeof initData !== 'string') throw new Error('Telegram initData is required');
  const params = new URLSearchParams(initData);
  const receivedHash = params.get('hash');
  if (!receivedHash) throw new Error('Telegram hash missing');
  const authDate = Number(params.get('auth_date') || 0);
  if (!authDate || Math.floor(Date.now() / 1000) - authDate > INITDATA_MAX_AGE_SECONDS) throw new Error('Telegram session expired. Reopen the Mini App.');
  params.delete('hash');
  const pairs = [];
  for (const [key, value] of params.entries()) pairs.push([key, value]);
  pairs.sort(([a], [b]) => a.localeCompare(b));
  const dataCheckString = pairs.map(([k, v]) => `${k}=${v}`).join('\n');
  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
  const calculatedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
  const a = Buffer.from(calculatedHash, 'hex');
  const b = Buffer.from(receivedHash, 'hex');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) throw new Error('Invalid Telegram initData');
  let telegramUser;
  try { telegramUser = JSON.parse(params.get('user') || 'null'); } catch (_) { throw new Error('Invalid Telegram user data'); }
  if (!telegramUser?.id) throw new Error('Telegram user missing');
  return telegramUser;
}
function authMiddleware(req, res, next) {
  try {
    const user = validateInitData(req.body?.initData || req.headers['x-telegram-init-data']);
    req.telegramUser = user;
    req.account = getUser(user.id, { firstName:user.first_name || '', lastName:user.last_name || '', username:user.username || '' });
    next();
  } catch (err) { return res.status(401).json({ error:err.message || 'Unauthorized' }); }
}
function publicUser(account, telegramUser) {
  return {
    id:String(telegramUser.id), first_name:telegramUser.first_name || '', last_name:telegramUser.last_name || '', username:telegramUser.username || '',
    isPro:String(telegramUser.id) === ADMIN_TELEGRAM_ID || !!account.isPro, isAdmin:String(telegramUser.id) === ADMIN_TELEGRAM_ID
  };
}

app.get('/', (_req, res) => res.json({ ok:true, service:BRAND, version:'3.0.0' }));
app.get('/api/health', (_req, res) => res.json({ ok:true, botConfigured:!!BOT_TOKEN, brand:BRAND }));
app.post('/api/auth', authMiddleware, (req, res) => {
  if (String(req.telegramUser.id) === ADMIN_TELEGRAM_ID) { req.account.isPro = true; saveUsers(); }
  res.json({ user:publicUser(req.account, req.telegramUser) });
});

async function telegramApi(method, body) {
  const response = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body) });
  const data = await response.json();
  if (!data.ok) throw new Error(data.description || `Telegram API ${method} failed`);
  return data.result;
}

app.post('/api/create-invoice', authMiddleware, async (req, res) => {
  try {
    if (String(req.telegramUser.id) === ADMIN_TELEGRAM_ID || req.account.isPro) return res.json({ alreadyPro:true });
    const payload = `ayahquiz_pro_${req.telegramUser.id}`;
    const invoiceLink = await telegramApi('createInvoiceLink', {
      title:`${BRAND} Pro`, description:'Advanced Quran memorization and revision tools.', payload, currency:'XTR', prices:[{label:'Pro membership', amount:PRO_STARS}]
    });
    res.json({ invoiceLink });
  } catch (err) { console.error('create-invoice:', err); res.status(500).json({ error:'Could not create Telegram Stars invoice.' }); }
});

app.post('/api/pro/telebirr', authMiddleware, async (req, res) => {
  const reference = String(req.body?.reference || '').trim();
  if (!reference || reference.length < 3 || reference.length > 100) return res.status(400).json({ error:'Enter a valid Telebirr transaction/reference ID.' });
  const id = String(req.telegramUser.id);
  const account = req.account;

  try {
    const chat = await bot.telegram.getChat(id);
    if (chat?.username) account.username = chat.username;
  } catch (err) { console.warn('Could not resolve Telegram username:', err.message); }

  const displayName = String(req.body?.displayName || '').trim().slice(0, 30);
  if (displayName) account.displayName = displayName;
  account.telebirrRequest = { reference, amount:TELEBIRR_ETB, phone:TELEBIRR_NUMBER, name:TELEBIRR_NAME, submittedAt:new Date().toISOString(), status:'pending', receiptReceived:false };
  account.awaitingTelebirrReceipt = true;
  saveUsers();

  try {
    await bot.telegram.sendMessage(id,
      `🧾 <b>Telebirr payment received</b>\n\n` +
      `Reference: <code>${escapeTelegram(reference)}</code>\n` +
      `Amount: <b>${TELEBIRR_ETB} ETB</b>\n\n` +
      `📸 <b>Now send your payment screenshot in this chat.</b>\n` +
      `Make sure the amount and transaction/reference are visible.\n\n` +
      `Your Pro access will be activated after admin verification.\n\n` +
      `If you already sent the screenshot, please wait for review.`, { parse_mode:'HTML' });
  } catch (err) { console.error('Could not instruct payer:', err); }

  try {
    await bot.telegram.sendMessage(ADMIN_TELEGRAM_ID,
      [
        `🧾 <b>NEW ${BRAND} — Telebirr request</b>`,
        accountIdentityHtml(account),
        `Display name: ${escapeTelegram(displayNameOf(account))}`,
        `Telegram ID: <code>${id}</code>`,
        `Amount: <b>${TELEBIRR_ETB} ETB</b>`,
        `Reference: <code>${escapeTelegram(reference)}</code>`,
        `📸 Receipt: <i>waiting for screenshot</i>`
      ].join('\n'),
      { parse_mode:'HTML', reply_markup:{ inline_keyboard:[[{text:'✅ Approve',callback_data:`tb_approve_${id}`},{text:'❌ Reject',callback_data:`tb_reject_${id}`}]] } }
    );
  } catch (err) { console.error('Admin notification failed:', err); }

  res.json({ ok:true, nextStep:'send_screenshot_in_bot' });
});

const bot = new Telegraf(BOT_TOKEN);

function adminOnly(ctx) {
  return String(ctx.from?.id) === ADMIN_TELEGRAM_ID;
}
function userLabel(account) {
  return account.username ? `@${account.username}` : displayNameOf(account);
}
function pendingTelebirrUsers() {
  return Object.values(users).filter(u => u.telebirrRequest?.status === 'pending');
}

async function sendWelcome(ctx) {
  await ctx.reply(
    `🌙 <b>Assalamu alaikum</b>\n\n` +
    `<b>${BRAND}</b>\n` +
    `اختبر حفظك للقرآن — Test your Qur'an memory.\n\n` +
    `🎯 Quick ayah challenges\n` +
    `⚡ XP & streaks\n` +
    `📖 Translation after answering\n` +
    `✦ Advanced revision tools with Pro\n\n` +
    `<i>The core quiz is free for everyone, in shā’ Allāh.</i>`,
    { parse_mode:'HTML', reply_markup:{ inline_keyboard:[
      [{text:'🚀 Open the Quiz',web_app:{url:FRONTEND_URL}}],
      [{text:'✦ Explore Pro',callback_data:'menu_pro'},{text:'❓ Help',callback_data:'menu_help'}],
      [{text:'💳 Payment',callback_data:'menu_payment'},{text:'ℹ️ About',callback_data:'menu_about'}]
    ]}}
  );
}

bot.start(sendWelcome);
bot.command('quiz', ctx => ctx.reply('🚀 <b>Ready?</b> Open the Quran memory challenge below.', {parse_mode:'HTML', reply_markup:{inline_keyboard:[[{text:'📖 Open Ayah Quest',web_app:{url:FRONTEND_URL}}]]}}));
bot.command('pro', ctx => ctx.reply(
  `✦ <b>${BRAND} Pro</b>\n\n` +
  `Unlock advanced revision tools:\n\n` +
  `📖 Surah selection\n🕌 Juz selection\n📅 Daily practice\n🎧 Recitation\n🔖 Bookmarks\n🧠 Mistake drills\n🏆 Badges & achievements\n🗺 Memorization map\n📊 Extended history & insights\n\n` +
  `⭐ <b>${PRO_STARS} Telegram Stars</b>\n` +
  `💚 <b>${TELEBIRR_ETB} ETB via Telebirr</b>\n\n` +
  `Tap the button below to open the Pro screen.`,
  {parse_mode:'HTML',reply_markup:{inline_keyboard:[[{text:'✦ Open Pro',web_app:{url:FRONTEND_URL}}],[{text:'💳 Payment instructions',callback_data:'menu_payment'}]]}}
));
bot.command('payment', ctx => sendPaymentInfo(ctx));
bot.command('help', ctx => sendHelp(ctx));
bot.command('about', ctx => sendAbout(ctx));
bot.command('support', ctx => ctx.reply(`🛟 <b>Support</b>\n\nFor payment or technical help, contact ${escapeTelegram(SUPPORT_USERNAME)}.\n\nPlease include your Telegram username (if available), reference number, and a short description of the issue.`, {parse_mode:'HTML'}));
bot.command('profile', ctx => {
  const a = getUser(ctx.from.id, {firstName:ctx.from.first_name || '',lastName:ctx.from.last_name || '',username:ctx.from.username || ''});
  ctx.reply(`👤 <b>Your ${BRAND} profile</b>\n\nName: ${escapeTelegram(displayNameOf(a))}\nUsername: ${a.username ? '@'+escapeTelegram(a.username) : '<i>not set</i>'}\nPlan: <b>${a.isPro ? 'PRO ✦' : 'FREE'}</b>`, {parse_mode:'HTML'});
});
bot.command('progress', ctx => ctx.reply('📊 Your detailed progress lives inside the Mini App.', {reply_markup:{inline_keyboard:[[{text:'📊 Open Progress',web_app:{url:FRONTEND_URL}}]]}}));

async function sendPaymentInfo(ctx) {
  await ctx.reply(
    `💳 <b>How to get Pro</b>\n\n` +
    `⭐ <b>Telegram Stars</b>\nPay <b>${PRO_STARS} Stars</b> inside Telegram. Pro activates automatically after successful payment.\n\n` +
    `💚 <b>Telebirr</b>\n1. Open the Pro screen.\n2. Send <b>${TELEBIRR_ETB} ETB</b> to <b>${TELEBIRR_NUMBER}</b> — ${escapeTelegram(TELEBIRR_NAME)}.\n3. Enter your Telebirr reference in the Mini App.\n4. The bot will ask you for the payment screenshot.\n5. Send the screenshot here.\n6. Admin verifies it and activates Pro.\n\n` +
    `🔐 Never send your Telebirr PIN or password.`,
    {parse_mode:'HTML',reply_markup:{inline_keyboard:[[{text:'✦ Open Pro',web_app:{url:FRONTEND_URL}}],[{text:'🛟 Support',callback_data:'menu_support'}]]}}
  );
}
async function sendHelp(ctx) {
  await ctx.reply('❓ <b>Ayah Quest Help</b>\n\nChoose what you want to learn about:', {parse_mode:'HTML',reply_markup:{inline_keyboard:[
    [{text:'🎮 How to play',callback_data:'help_play'},{text:'✦ Pro features',callback_data:'menu_pro'}],
    [{text:'💳 Payment',callback_data:'menu_payment'},{text:'📸 Telebirr receipt',callback_data:'help_receipt'}],
    [{text:'🛟 Support',callback_data:'menu_support'},{text:'ℹ️ About',callback_data:'menu_about'}]
  ]}});
}
async function sendAbout(ctx) {
  await ctx.reply(`ℹ️ <b>About ${BRAND}</b>\n\nA student-friendly Qur'an memorization challenge designed to make revision consistent, simple and enjoyable.\n\nThe core quiz is free. Pro supports the project while adding deeper revision tools.\n\nبارك الله فيكم 🤍`, {parse_mode:'HTML',reply_markup:{inline_keyboard:[[{text:'🚀 Open Ayah Quest',web_app:{url:FRONTEND_URL}}]]}});
}

bot.action('menu_pro', async ctx => { await ctx.answerCbQuery(); await ctx.reply(`✦ <b>${BRAND} Pro</b>\n\nSurah • Juz • Daily • Recitation • Bookmarks • Mistake drills • Achievements • Memorization map • Extended insights\n\n⭐ ${PRO_STARS} Stars  |  💚 ${TELEBIRR_ETB} ETB`, {parse_mode:'HTML',reply_markup:{inline_keyboard:[[{text:'✦ Open Pro',web_app:{url:FRONTEND_URL}}],[{text:'💳 Payment',callback_data:'menu_payment'}]]}}); });
bot.action('menu_payment', async ctx => { await ctx.answerCbQuery(); await sendPaymentInfo(ctx); });
bot.action('menu_help', async ctx => { await ctx.answerCbQuery(); await sendHelp(ctx); });
bot.action('menu_about', async ctx => { await ctx.answerCbQuery(); await sendAbout(ctx); });
bot.action('menu_support', async ctx => { await ctx.answerCbQuery(); await ctx.reply(`🛟 Support: ${escapeTelegram(SUPPORT_USERNAME)}`, {parse_mode:'HTML'}); });
bot.action('help_play', async ctx => { await ctx.answerCbQuery(); await ctx.reply('🎮 <b>How to play</b>\n\nOpen the Mini App, start a quiz, choose the ayah that matches the prompt, then see the translation after answering. Earn XP, improve accuracy and keep your streak alive.', {parse_mode:'HTML',reply_markup:{inline_keyboard:[[{text:'🚀 Start now',web_app:{url:FRONTEND_URL}}]]}}); });
bot.action('help_receipt', async ctx => { await ctx.answerCbQuery(); await ctx.reply('📸 <b>Telebirr receipt</b>\n\nAfter you submit your reference in the Mini App, this bot will ask you to send the payment screenshot here. Send the clearest receipt image you have. The admin will review it before Pro is activated.', {parse_mode:'HTML'}); });

// Telebirr receipt handler. The screenshot is not stored on the server; Telegram's file_id
// is used to send the image to the admin for review.
bot.on('photo', async ctx => {
  const id = String(ctx.from.id);
  const account = getUser(id, {firstName:ctx.from.first_name || '',lastName:ctx.from.last_name || '',username:ctx.from.username || ''});
  if (!account.awaitingTelebirrReceipt || account.telebirrRequest?.status !== 'pending') {
    return ctx.reply('📸 I received your photo. If this is a Telebirr Pro receipt, first submit the transaction reference in the Mini App.');
  }

  const photo = ctx.message.photo[ctx.message.photo.length - 1];
  account.telebirrRequest.receiptReceived = true;
  account.telebirrRequest.receiptReceivedAt = new Date().toISOString();
  account.telebirrRequest.receiptFileId = photo.file_id;
  account.awaitingTelebirrReceipt = false;
  saveUsers();

  const caption = [
    `📸 <b>TELEBIRR RECEIPT — ${BRAND}</b>`,
    accountIdentityHtml(account),
    `Display name: ${escapeTelegram(displayNameOf(account))}`,
    `Telegram ID: <code>${id}</code>`,
    `Amount: <b>${TELEBIRR_ETB} ETB</b>`,
    `Reference: <code>${escapeTelegram(account.telebirrRequest.reference)}</code>`,
    `Submitted: <code>${escapeTelegram(account.telebirrRequest.submittedAt)}</code>`
  ].join('\n');

  try {
    await ctx.telegram.sendPhoto(ADMIN_TELEGRAM_ID, photo.file_id, {
      caption,
      parse_mode:'HTML',
      reply_markup:{inline_keyboard:[[{text:'✅ APPROVE PRO',callback_data:`tb_approve_${id}`},{text:'❌ REJECT',callback_data:`tb_reject_${id}`}]]}
    });
    await ctx.reply('✅ <b>Receipt received.</b>\n\nYour screenshot has been sent to the admin for verification. Please wait for the approval message.', {parse_mode:'HTML'});
  } catch (err) {
    console.error('Receipt forwarding failed:', err);
    account.awaitingTelebirrReceipt = true;
    account.telebirrRequest.receiptReceived = false;
    saveUsers();
    await ctx.reply(`⚠️ I could not forward the receipt yet. Please try sending the screenshot again or contact ${escapeTelegram(SUPPORT_USERNAME)}.`, {parse_mode:'HTML'});
  }
});

bot.on('pre_checkout_query', async ctx => {
  const q = ctx.preCheckoutQuery;
  const expectedPayload = `ayahquiz_pro_${q.from.id}`;
  if (q.currency !== 'XTR' || Number(q.total_amount) !== PRO_STARS || q.invoice_payload !== expectedPayload) return ctx.answerPreCheckoutQuery(false, 'This Pro invoice is invalid or expired.');
  try { await ctx.answerPreCheckoutQuery(true); } catch (err) { console.error('pre_checkout:', err); }
});

bot.on('message', async ctx => {
  const payment = ctx.message?.successful_payment;
  if (!payment || payment.currency !== 'XTR') return;
  const expectedPayload = `ayahquiz_pro_${ctx.from.id}`;
  if (payment.invoice_payload !== expectedPayload || Number(payment.total_amount) !== PRO_STARS) return;
  const account = getUser(ctx.from.id, {firstName:ctx.from.first_name || '',lastName:ctx.from.last_name || '',username:ctx.from.username || ''});
  account.isPro = true;
  account.starsPayment = {chargeId:payment.telegram_payment_charge_id,amount:payment.total_amount,currency:payment.currency,paidAt:new Date().toISOString()};
  saveUsers();
  try {
    await ctx.telegram.sendMessage(ADMIN_TELEGRAM_ID, [`⭐ <b>NEW ${BRAND} — Stars payment</b>`,accountIdentityHtml(account),`Telegram ID: <code>${ctx.from.id}</code>`,`Amount: <b>${PRO_STARS} Stars</b>`,`Charge ID: <code>${escapeTelegram(payment.telegram_payment_charge_id || '')}</code>`].join('\n'),{parse_mode:'HTML'});
  } catch (err) { console.error('Stars admin notification failed:',err); }
  await ctx.reply(`🎉 <b>Pro activated!</b>\n\nWelcome to ${BRAND} Pro. Open the Mini App again to unlock your advanced revision tools.`,{parse_mode:'HTML',reply_markup:{inline_keyboard:[[{text:'🚀 Open Ayah Quest',web_app:{url:FRONTEND_URL}}]]}});
});

async function approveTelebirr(ctx, id) {
  if (!adminOnly(ctx)) return ctx.answerCbQuery('Not authorized.',{show_alert:true});
  const account = users[id];
  if (!account?.telebirrRequest) return ctx.answerCbQuery('Payment request not found.',{show_alert:true});
  if (account.telebirrRequest.status === 'approved') return ctx.answerCbQuery('Already approved.');
  account.isPro = true;
  account.telebirrRequest.status = 'approved';
  account.telebirrApprovedAt = new Date().toISOString();
  account.awaitingTelebirrReceipt = false;
  saveUsers();
  try { await ctx.telegram.sendMessage(id,`🎉 <b>Telebirr verified!</b>\n\nYour ${BRAND} Pro membership is now active. Open the Mini App to use your Pro features.`,{parse_mode:'HTML',reply_markup:{inline_keyboard:[[{text:'✦ Open Pro',web_app:{url:FRONTEND_URL}}]]}}); } catch (_) {}
  await ctx.answerCbQuery('Pro approved ✅');
  try { await ctx.editMessageReplyMarkup({inline_keyboard:[]}); } catch (_) {}
}
async function rejectTelebirr(ctx, id) {
  if (!adminOnly(ctx)) return ctx.answerCbQuery('Not authorized.',{show_alert:true});
  const account = users[id];
  if (!account?.telebirrRequest) return ctx.answerCbQuery('Payment request not found.',{show_alert:true});
  account.telebirrRequest.status = 'rejected';
  account.awaitingTelebirrReceipt = false;
  saveUsers();
  try { await ctx.telegram.sendMessage(id,`❌ Your Telebirr Pro request was not approved. Please contact ${escapeTelegram(SUPPORT_USERNAME)} with your receipt if you believe this was a mistake.`,{parse_mode:'HTML'}); } catch (_) {}
  await ctx.answerCbQuery('Request rejected.');
  try { await ctx.editMessageReplyMarkup({inline_keyboard:[]}); } catch (_) {}
}
bot.action(/^tb_approve_(\d+)$/, ctx => approveTelebirr(ctx,ctx.match[1]));
bot.action(/^tb_reject_(\d+)$/, ctx => rejectTelebirr(ctx,ctx.match[1]));

bot.command('stats', async ctx => {
  if (!adminOnly(ctx)) return;
  const all = Object.values(users);
  const pro = all.filter(u=>u.isPro).length;
  const pending = pendingTelebirrUsers().length;
  await ctx.reply(`📊 <b>${BRAND} Admin Stats</b>\n\n👥 Users: <b>${all.length}</b>\n✦ Pro: <b>${pro}</b>\n💚 Pending Telebirr: <b>${pending}</b>`,{parse_mode:'HTML'});
});
bot.command('pending', async ctx => {
  if (!adminOnly(ctx)) return;
  const pending = pendingTelebirrUsers();
  if (!pending.length) return ctx.reply('✅ No pending Telebirr requests.');
  for (const a of pending.slice(0,20)) {
    await ctx.reply(`🧾 <b>Pending Pro</b>\n\n${accountIdentityHtml(a)}\nDisplay name: ${escapeTelegram(displayNameOf(a))}\nID: <code>${a.id}</code>\nReference: <code>${escapeTelegram(a.telebirrRequest.reference)}</code>\nReceipt: <b>${a.telebirrRequest.receiptReceived ? 'received' : 'waiting'}</b>`,{parse_mode:'HTML',reply_markup:{inline_keyboard:[[{text:'✅ Approve',callback_data:`tb_approve_${a.id}`},{text:'❌ Reject',callback_data:`tb_reject_${a.id}`}]]}});
  }
});
bot.command('users', async ctx => {
  if (!adminOnly(ctx)) return;
  const all = Object.values(users).sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt))).slice(0,30);
  if (!all.length) return ctx.reply('No users yet.');
  const lines = all.map((a,i)=>`${i+1}. ${a.username ? '@'+escapeTelegram(a.username) : `<a href="tg://user?id=${a.id}">${escapeTelegram(displayNameOf(a))}</a>`} — ${a.isPro ? '✦ PRO' : 'FREE'}`);
  await ctx.reply(`👥 <b>Recent users</b>\n\n${lines.join('\n')}`,{parse_mode:'HTML'});
});
bot.command('admin', async ctx => {
  if (!adminOnly(ctx)) return;
  await ctx.reply(`🛠 <b>${BRAND} Admin</b>\n\nUse the buttons below or commands:`,{parse_mode:'HTML',reply_markup:{inline_keyboard:[[{text:'📊 Stats',callback_data:'admin_stats'},{text:'🧾 Pending',callback_data:'admin_pending'}],[{text:'👥 Users',callback_data:'admin_users'}]]}});
});
bot.action('admin_stats', async ctx => { if(!adminOnly(ctx)) return ctx.answerCbQuery('Not authorized.',{show_alert:true}); await ctx.answerCbQuery(); await ctx.reply(`👥 Users: ${Object.keys(users).length}\n✦ Pro: ${Object.values(users).filter(u=>u.isPro).length}\n💚 Pending: ${pendingTelebirrUsers().length}`); });
bot.action('admin_pending', async ctx => { if(!adminOnly(ctx)) return ctx.answerCbQuery('Not authorized.',{show_alert:true}); await ctx.answerCbQuery(); await ctx.reply('Use /pending to review pending Telebirr requests with approval buttons.'); });
bot.action('admin_users', async ctx => { if(!adminOnly(ctx)) return ctx.answerCbQuery('Not authorized.',{show_alert:true}); await ctx.answerCbQuery(); await ctx.reply('Use /users to view recent subscribers and users.'); });

bot.catch(err => console.error('Telegram bot error:',err));
app.use((err,_req,res,_next)=>{ console.error(err); if(!res.headersSent) res.status(500).json({error:'Server error'}); });

async function configureBotMenu() {
  await bot.telegram.setMyName({name:BRAND});
  await bot.telegram.setMyDescription({description:`${BRAND} — a fun Qur'an memorization challenge for students. Test your ayah memory, build your streak and unlock advanced revision tools.`});
  await bot.telegram.setMyShortDescription({short_description:'Qur’an memory challenge • Free quiz • Pro revision tools'});
  await bot.telegram.setMyCommands({commands:[
    {command:'start',description:'Open Ayah Quest welcome & Mini App'},
    {command:'quiz',description:'Start a Quran memory challenge'},
    {command:'pro',description:'Explore Pro features & membership'},
    {command:'payment',description:'See Stars & Telebirr payment steps'},
    {command:'profile',description:'View your Telegram-linked profile'},
    {command:'progress',description:'Open your quiz progress'},
    {command:'help',description:'Get help with the app'},
    {command:'about',description:'Learn about Ayah Quest'},
    {command:'support',description:'Get technical or payment support'}
  ]});
}

app.listen(PORT,()=>{
  console.log(`${BRAND} API listening on ${PORT}`);
  configureBotMenu().catch(err=>console.error('Bot profile/menu setup failed:',err));
  bot.launch().then(()=>console.log(`${BRAND} bot launched`)).catch(err=>console.error('Bot launch failed:',err));
});
process.once('SIGINT',()=>bot.stop('SIGINT'));
process.once('SIGTERM',()=>bot.stop('SIGTERM'));
