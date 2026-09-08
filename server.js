const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');
const { Telegraf } = require('telegraf');

const PORT = Number(process.env.PORT || 3000);
const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_TELEGRAM_ID = String(process.env.ADMIN_TELEGRAM_ID || '6545688842');
const FRONTEND_URL = process.env.FRONTEND_URL || 'https://quran-ayah-quiz.vercel.app';
const SUPPORT_USERNAME = process.env.SUPPORT_USERNAME || '@luck_7n';
const TELEBIRR_NUMBER = process.env.TELEBIRR_NUMBER || '0938054751';
const TELEBIRR_NAME = process.env.TELEBIRR_NAME || 'Lakin';
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const PRO_STARS = 20;
const TELEBIRR_ETB = 50;
const INITDATA_MAX_AGE_SECONDS = 24 * 60 * 60;
const BRAND = 'آيَة | Ayah Quest';
const SHORT_DESCRIPTION = 'Qur’an memory challenge • Free quiz • Pro revision tools';
const DESCRIPTION = 'A little Qur’an corner inside Telegram. Test your memorization, revise ayahs, build your streak, and explore Pro revision tools.';

if (!BOT_TOKEN) { console.error('Missing BOT_TOKEN.'); process.exit(1); }
if (!SUPABASE_URL || !SUPABASE_KEY) { console.error('Missing SUPABASE_URL or SUPABASE_SECRET_KEY/SUPABASE_SERVICE_ROLE_KEY.'); process.exit(1); }

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const bot = new Telegraf(BOT_TOKEN);
const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '100kb' }));
app.use(cors({ origin(origin, cb) { if (!origin || origin === FRONTEND_URL || origin === 'https://quran-ayah-quiz.vercel.app') return cb(null, true); return cb(new Error('CORS origin not allowed')); } }));

function escapeTelegram(value) { return String(value ?? '').replace(/[<>&"]/g, c => ({ '<':'&lt;', '>':'&gt;', '&':'&amp;', '"':'&quot;' }[c])); }
function displayNameOf(a) { return a.display_name || [a.first_name, a.last_name].filter(Boolean).join(' ') || 'Telegram user'; }
function accountIdentityHtml(a) { const id = String(a.telegram_id); const name = escapeTelegram(displayNameOf(a)); return a.username ? `👤 <b>@${escapeTelegram(a.username)}</b>` : `👤 <a href="tg://user?id=${id}">${name}</a> <i>(no username)</i>`; }
function isAdmin(id) { return String(id) === ADMIN_TELEGRAM_ID; }

async function upsertUser(tg, extra = {}) {
  const telegram_id = String(tg.id);
  const { data: existing } = await supabase.from('users').select('*').eq('telegram_id', telegram_id).maybeSingle();
  const row = {
    telegram_id,
    username: tg.username || existing?.username || null,
    first_name: tg.first_name || existing?.first_name || '',
    last_name: tg.last_name || existing?.last_name || '',
    updated_at: new Date().toISOString(),
    last_active_at: new Date().toISOString(),
    ...extra
  };
  if (isAdmin(telegram_id)) row.is_pro = true;
  const { data, error } = await supabase.from('users').upsert(row, { onConflict: 'telegram_id' }).select('*').single();
  if (error) throw error;
  return data;
}

async function getUser(id) {
  const { data, error } = await supabase.from('users').select('*').eq('telegram_id', String(id)).maybeSingle();
  if (error) throw error;
  return data;
}

async function publicUser(account, tg) {
  return { id:String(tg.id), first_name:tg.first_name || '', last_name:tg.last_name || '', username:tg.username || '', isPro:isAdmin(tg.id) || !!account?.is_pro, isAdmin:isAdmin(tg.id) };
}

function validateInitData(initData) {
  if (!initData || typeof initData !== 'string') throw new Error('Telegram initData is required');
  const params = new URLSearchParams(initData);
  const receivedHash = params.get('hash');
  if (!receivedHash) throw new Error('Telegram hash missing');
  const authDate = Number(params.get('auth_date') || 0);
  if (!authDate || Math.floor(Date.now()/1000) - authDate > INITDATA_MAX_AGE_SECONDS) throw new Error('Telegram session expired. Reopen the Mini App.');
  params.delete('hash');
  const pairs = [...params.entries()].sort(([a],[b]) => a.localeCompare(b));
  const dataCheckString = pairs.map(([k,v]) => `${k}=${v}`).join('\n');
  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
  const calculated = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
  const a = Buffer.from(calculated, 'hex'); const b = Buffer.from(receivedHash, 'hex');
  if (a.length !== b.length || !crypto.timingSafeEqual(a,b)) throw new Error('Invalid Telegram initData');
  let user; try { user = JSON.parse(params.get('user') || 'null'); } catch { throw new Error('Invalid Telegram user data'); }
  if (!user?.id) throw new Error('Telegram user missing');
  return user;
}

async function authMiddleware(req,res,next) {
  try {
    const tg = validateInitData(req.body?.initData || req.headers['x-telegram-init-data']);
    req.telegramUser = tg;
    req.account = await upsertUser(tg);
    next();
  } catch (err) { console.error('Auth:', err.message); res.status(401).json({ error:err.message || 'Unauthorized' }); }
}

app.get('/', (_req,res) => res.json({ ok:true, service:BRAND, version:'4.0.0', database:'supabase' }));
app.get('/api/health', async (_req,res) => {
  const { error } = await supabase.from('users').select('telegram_id',{head:true,count:'exact'});
  res.status(error ? 503 : 200).json({ ok:!error, botConfigured:!!BOT_TOKEN, databaseConfigured:!!SUPABASE_URL && !!SUPABASE_KEY, brand:BRAND, database:error ? 'error' : 'supabase' });
});
app.post('/api/auth', authMiddleware, async (req,res) => res.json({ user:await publicUser(req.account, req.telegramUser) }));
app.get('/api/pro/status', authMiddleware, async (req,res) => res.json({ isPro:isAdmin(req.telegramUser.id) || !!req.account.is_pro }));

async function telegramApi(method, body) {
  const r = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body) });
  const d = await r.json(); if (!d.ok) throw new Error(d.description || `Telegram API ${method} failed`); return d.result;
}

app.post('/api/create-invoice', authMiddleware, async (req,res) => {
  try {
    if (isAdmin(req.telegramUser.id) || req.account.is_pro) return res.json({ alreadyPro:true });
    const payload = `ayahquest_pro_${req.telegramUser.id}`;
    const invoiceLink = await telegramApi('createInvoiceLink', { title:`${BRAND} Pro`, description:'Advanced Qur’an memorization and revision tools.', payload, currency:'XTR', prices:[{label:'Pro membership',amount:PRO_STARS}] });
    res.json({ invoiceLink });
  } catch (err) { console.error('create-invoice:',err); res.status(500).json({ error:'Could not create Telegram Stars invoice.' }); }
});

app.post('/api/pro/telebirr', authMiddleware, async (req,res) => {
  const reference = String(req.body?.reference || '').trim();
  if (!/^[A-Za-z0-9._\-/]{3,100}$/.test(reference)) return res.status(400).json({ error:'Enter a valid Telebirr transaction/reference ID.' });
  const id = String(req.telegramUser.id);
  if (isAdmin(id) || req.account.is_pro) return res.json({ alreadyPro:true });

  const { data: existingPending, error: pendingErr } = await supabase.from('telebirr_requests').select('*').eq('telegram_id',id).eq('status','pending').maybeSingle();
  if (pendingErr) return res.status(500).json({ error:'Could not check your existing payment request.' });
  if (existingPending) return res.json({ ok:true, duplicate:true, nextStep:existingPending.receipt_received ? 'waiting_for_admin' : 'send_screenshot_in_bot' });

  const displayName = String(req.body?.displayName || '').trim().slice(0,30);
  if (displayName) await upsertUser(req.telegramUser,{display_name:displayName});
  const { error } = await supabase.from('telebirr_requests').insert({ telegram_id:id, reference, amount:TELEBIRR_ETB, phone:TELEBIRR_NUMBER, recipient_name:TELEBIRR_NAME, status:'pending', receipt_received:false });
  if (error) { console.error('Telebirr insert:',error); return res.status(500).json({ error:'Could not save the payment request.' }); }

  try { await bot.telegram.sendMessage(id, `🧾 <b>Telebirr payment received</b>\n\nReference: <code>${escapeTelegram(reference)}</code>\nAmount: <b>${TELEBIRR_ETB} ETB</b>\n\n📸 <b>Now send your payment screenshot in this chat.</b>\nMake sure the amount and transaction/reference are visible.\n\nYour Pro access will be activated after admin verification.`, {parse_mode:'HTML'}); } catch(e) { console.error('payer message:',e); }

  const account = await getUser(id);
  try { await bot.telegram.sendMessage(ADMIN_TELEGRAM_ID, [`🧾 <b>NEW ${BRAND} — Telebirr request</b>`,accountIdentityHtml(account),`Display name: ${escapeTelegram(displayNameOf(account))}`,`Telegram ID: <code>${id}</code>`,`Amount: <b>${TELEBIRR_ETB} ETB</b>`,`Reference: <code>${escapeTelegram(reference)}</code>`,`📸 Receipt: <i>waiting for screenshot</i>`].join('\n'),{parse_mode:'HTML'}); } catch(e) { console.error('admin notification:',e); }
  res.json({ ok:true, nextStep:'send_screenshot_in_bot' });
});

app.post('/api/quiz-result', authMiddleware, async (req,res) => {
  try {
    const score = Math.max(0,Math.min(100,Number(req.body?.score)||0));
    const total = Math.max(0,Math.min(1000,Number(req.body?.total)||10));
    const correct = Math.max(0,Math.min(total,Number(req.body?.correct)||0));
    const xp = Math.max(0,Math.min(10000,Number(req.body?.xp)||0));
    const mode = String(req.body?.mode || 'core').slice(0,40);
    const { error } = await supabase.from('quiz_history').insert({ telegram_id:String(req.telegramUser.id), score, total, correct, xp, mode });
    if (error) throw error;
    const { data: u } = await supabase.from('users').select('xp,streak,total_answered,total_correct').eq('telegram_id',String(req.telegramUser.id)).single();
    const today = new Date().toISOString().slice(0,10);
    const { data: recent } = await supabase.from('quiz_history').select('created_at').eq('telegram_id',String(req.telegramUser.id)).order('created_at',{ascending:false}).limit(2);
    let streak = Number(u?.streak || 0);
    if (!recent || recent.length < 2) streak = 1; else { const d1=new Date(recent[0].created_at); const d2=new Date(recent[1].created_at); const diff=Math.round((d1-d2)/86400000); streak = diff <= 1 ? Math.max(1,streak+1) : 1; }
    await supabase.from('users').update({ xp:Number(u?.xp||0)+xp, streak, total_answered:Number(u?.total_answered||0)+total, total_correct:Number(u?.total_correct||0)+correct, last_active_at:new Date().toISOString() }).eq('telegram_id',String(req.telegramUser.id));
    res.json({ok:true,streak});
  } catch(e) { console.error('quiz-result:',e); res.status(500).json({error:'Could not save quiz progress.'}); }
});

function adminOnly(ctx) { return isAdmin(ctx.from?.id); }
async function sendWelcome(ctx) {
  await upsertUser(ctx.from);
  await ctx.reply(`🌙 <b>Assalamu alaikum</b>\n\n<b>${BRAND}</b>\nاختبر حفظك للقرآن — Test your Qur’an memory.\n\n🎯 Quick ayah challenges\n⚡ XP & streaks\n📖 Translation after answering\n✦ Advanced revision tools with Pro\n\n<i>The core quiz is free for everyone, in shā’ Allāh.</i>`,{parse_mode:'HTML',reply_markup:{inline_keyboard:[[{text:'🚀 Open Ayah Quest',web_app:{url:FRONTEND_URL}}],[{text:'✦ Explore Pro',callback_data:'menu_pro'},{text:'❓ Help',callback_data:'menu_help'}],[{text:'💳 Payment',callback_data:'menu_payment'},{text:'ℹ️ About',callback_data:'menu_about'}]]}});
}
bot.start(sendWelcome);
bot.command('quiz',ctx=>ctx.reply('🚀 <b>Ready?</b> Open the Qur’an memory challenge below.',{parse_mode:'HTML',reply_markup:{inline_keyboard:[[{text:'📖 Open Ayah Quest',web_app:{url:FRONTEND_URL}}]]}}));
bot.command('pro',ctx=>ctx.reply(`✦ <b>${BRAND} Pro</b>\n\n📖 Surah selection\n🕌 Juz selection\n📅 Daily practice\n🎙 Recitation\n🔖 Bookmarks\n🧠 Mistake drills\n🏆 Achievements\n🗺 Memorization map\n📊 Extended insights\n\n⭐ <b>${PRO_STARS} Stars</b> or 💚 <b>${TELEBIRR_ETB} ETB</b>`,{parse_mode:'HTML',reply_markup:{inline_keyboard:[[{text:'✦ Open Pro',web_app:{url:FRONTEND_URL}}],[{text:'💳 Payment',callback_data:'menu_payment'}]]}}));
bot.command('payment',ctx=>ctx.reply(`💳 <b>${BRAND} Pro payment</b>\n\n⭐ <b>Telegram Stars:</b> Open Pro in the Mini App and pay ${PRO_STARS} Stars. Pro activates automatically after Telegram confirms payment.\n\n💚 <b>Telebirr:</b> Send ${TELEBIRR_ETB} ETB to <code>${TELEBIRR_NUMBER}</code> — ${escapeTelegram(TELEBIRR_NAME)}. Then submit your reference in the Mini App and send the receipt screenshot here.\n\n🔐 Never send your Telebirr PIN or password.`,{parse_mode:'HTML'}));
bot.command('profile',async ctx=>{const a=await upsertUser(ctx.from);await ctx.reply(`👤 <b>Your ${BRAND} profile</b>\n\nName: ${escapeTelegram(displayNameOf(a))}\nUsername: ${a.username ? '@'+escapeTelegram(a.username) : '<i>not set</i>'}\nPlan: <b>${a.is_pro ? 'PRO ✦' : 'FREE'}</b>\nXP: <b>${Number(a.xp||0)}</b>\nStreak: <b>${Number(a.streak||0)} days</b>`,{parse_mode:'HTML'});});
bot.command('progress',ctx=>ctx.reply('📈 <b>Your progress</b>\n\nOpen the Mini App to see your XP, streak, accuracy and revision progress.',{parse_mode:'HTML',reply_markup:{inline_keyboard:[[{text:'📈 Open Progress',web_app:{url:FRONTEND_URL}}]]}}));
bot.command('help',ctx=>ctx.reply(`❓ <b>Help</b>\n\n/start — welcome\n/quiz — open the free quiz\n/pro — Pro features\n/payment — payment instructions\n/profile — your account\n/progress — progress dashboard\n/about — about Ayah Quest\n/support — contact support`,{parse_mode:'HTML'}));
bot.command('about',ctx=>ctx.reply(`ℹ️ <b>About ${BRAND}</b>\n\nA student-friendly Qur’an memorization challenge designed to make revision consistent, simple and enjoyable.\n\nThe core quiz is free. Pro supports the project while adding deeper revision tools.\n\nبارك الله فيكم 🤍`,{parse_mode:'HTML',reply_markup:{inline_keyboard:[[{text:'🚀 Open Ayah Quest',web_app:{url:FRONTEND_URL}}]]}}));
bot.command('support',ctx=>ctx.reply(`🛟 <b>Support</b>\n\nFor technical or payment help: ${escapeTelegram(SUPPORT_USERNAME)}`,{parse_mode:'HTML'}));

bot.action('menu_pro',async ctx=>{await ctx.answerCbQuery();await ctx.reply(`✦ <b>${BRAND} Pro</b>\n\nSurah • Juz • Daily • Recitation • Bookmarks • Mistake drills • Achievements • Memorization map • Extended insights\n\n⭐ ${PRO_STARS} Stars | 💚 ${TELEBIRR_ETB} ETB`,{parse_mode:'HTML',reply_markup:{inline_keyboard:[[{text:'✦ Open Pro',web_app:{url:FRONTEND_URL}}],[{text:'💳 Payment',callback_data:'menu_payment'}]]}});});
bot.action('menu_payment',async ctx=>{await ctx.answerCbQuery();await ctx.reply(`💳 <b>Payment</b>\n\n⭐ ${PRO_STARS} Stars: pay inside the Mini App.\n💚 ${TELEBIRR_ETB} ETB Telebirr: ${TELEBIRR_NUMBER} — ${escapeTelegram(TELEBIRR_NAME)}. Submit reference in the Mini App, then send the screenshot here.`,{parse_mode:'HTML'});});
bot.action('menu_help',async ctx=>{await ctx.answerCbQuery();await ctx.reply('❓ Use /help for commands and payment/receipt guidance.');});
bot.action('menu_about',async ctx=>{await ctx.answerCbQuery();await ctx.reply(`ℹ️ <b>About ${BRAND}</b>\n\nA little Qur’an corner inside Telegram. Free core quiz, optional Pro revision tools.`,{parse_mode:'HTML'});});

bot.on('photo',async ctx=>{
  const id=String(ctx.from.id); const a=await upsertUser(ctx.from);
  const {data:req,error}=await supabase.from('telebirr_requests').select('*').eq('telegram_id',id).eq('status','pending').maybeSingle();
  if(error || !req) return ctx.reply('📸 I received your photo. If this is a Telebirr Pro receipt, first submit the transaction reference in the Mini App.');
  const photo=ctx.message.photo[ctx.message.photo.length-1];
  const {error:updateErr}=await supabase.from('telebirr_requests').update({receipt_received:true,receipt_file_id:photo.file_id,receipt_received_at:new Date().toISOString()}).eq('id',req.id).eq('status','pending');
  if(updateErr) return ctx.reply('⚠️ I could not save the receipt. Please try again.');
  const caption=[`📸 <b>TELEBIRR RECEIPT — ${BRAND}</b>`,accountIdentityHtml(a),`Display name: ${escapeTelegram(displayNameOf(a))}`,`Telegram ID: <code>${id}</code>`,`Amount: <b>${TELEBIRR_ETB} ETB</b>`,`Reference: <code>${escapeTelegram(req.reference)}</code>`].join('\n');
  try {
    await ctx.telegram.sendPhoto(ADMIN_TELEGRAM_ID,photo.file_id,{caption,parse_mode:'HTML',reply_markup:{inline_keyboard:[[{text:'✅ APPROVE PRO',callback_data:`tb_approve_${id}`},{text:'❌ REJECT',callback_data:`tb_reject_${id}`}]]}});
    await ctx.reply('✅ <b>Receipt received.</b>\n\nYour screenshot has been sent to the admin for verification. Please wait for approval.',{parse_mode:'HTML'});
  } catch(e) {
    console.error('Receipt forwarding:',e);
    await supabase.from('telebirr_requests').update({receipt_received:false,receipt_file_id:null,receipt_received_at:null}).eq('id',req.id);
    await ctx.reply(`⚠️ I could not forward the receipt yet. Please try again or contact ${escapeTelegram(SUPPORT_USERNAME)}.`,{parse_mode:'HTML'});
  }
});

bot.on('pre_checkout_query',async ctx=>{const q=ctx.preCheckoutQuery;const expected=`ayahquest_pro_${q.from.id}`;if(q.currency!=='XTR'||Number(q.total_amount)!==PRO_STARS||q.invoice_payload!==expected)return ctx.answerPreCheckoutQuery(false,'This Pro invoice is invalid or expired.');try{await ctx.answerPreCheckoutQuery(true);}catch(e){console.error('pre_checkout:',e);}});
bot.on('message',async ctx=>{
  const p=ctx.message?.successful_payment;if(!p||p.currency!=='XTR')return;const expected=`ayahquest_pro_${ctx.from.id}`;if(p.invoice_payload!==expected||Number(p.total_amount)!==PRO_STARS)return;
  const id=String(ctx.from.id);const a=await upsertUser(ctx.from,{is_pro:true});
  await supabase.from('payments').insert({telegram_id:id,provider:'telegram_stars',amount:p.total_amount,currency:p.currency,charge_id:p.telegram_payment_charge_id,payload:p.invoice_payload});
  try{await ctx.telegram.sendMessage(ADMIN_TELEGRAM_ID,[`⭐ <b>NEW ${BRAND} — Stars payment</b>`,accountIdentityHtml(a),`Telegram ID: <code>${id}</code>`,`Amount: <b>${PRO_STARS} Stars</b>`,`Charge ID: <code>${escapeTelegram(p.telegram_payment_charge_id||'')}</code>`].join('\n'),{parse_mode:'HTML'});}catch(e){console.error('Stars admin:',e);}
  await ctx.reply(`🎉 <b>Pro activated!</b>\n\nWelcome to ${BRAND} Pro. Open the Mini App again to unlock your advanced revision tools.`,{parse_mode:'HTML',reply_markup:{inline_keyboard:[[{text:'🚀 Open Ayah Quest',web_app:{url:FRONTEND_URL}}]]}});
});

async function approveTelebirr(ctx,id){
  if(!adminOnly(ctx))return ctx.answerCbQuery('Not authorized.',{show_alert:true});
  const {data:req}=await supabase.from('telebirr_requests').select('*').eq('telegram_id',String(id)).eq('status','pending').maybeSingle();
  if(!req)return ctx.answerCbQuery('Payment request not found.',{show_alert:true});
  if(!req.receipt_received)return ctx.answerCbQuery('Receipt is not received yet.',{show_alert:true});
  await supabase.from('telebirr_requests').update({status:'approved',approved_at:new Date().toISOString()}).eq('id',req.id);
  await supabase.from('users').update({is_pro:true,updated_at:new Date().toISOString()}).eq('telegram_id',String(id));
  await supabase.from('payments').insert({telegram_id:String(id),provider:'telebirr',amount:TELEBIRR_ETB,currency:'ETB',reference:req.reference});
  try{await ctx.telegram.sendMessage(id,`🎉 <b>Telebirr verified!</b>\n\nYour ${BRAND} Pro membership is now active. Open the Mini App to use your Pro features.`,{parse_mode:'HTML',reply_markup:{inline_keyboard:[[{text:'✦ Open Pro',web_app:{url:FRONTEND_URL}}]]}});}catch(e){}
  await ctx.answerCbQuery('Pro approved ✅');try{await ctx.editMessageReplyMarkup({inline_keyboard:[]});}catch(e){}
}
async function rejectTelebirr(ctx,id){
  if(!adminOnly(ctx))return ctx.answerCbQuery('Not authorized.',{show_alert:true});
  const {data:req}=await supabase.from('telebirr_requests').select('*').eq('telegram_id',String(id)).eq('status','pending').maybeSingle();
  if(!req)return ctx.answerCbQuery('Payment request not found.',{show_alert:true});
  await supabase.from('telebirr_requests').update({status:'rejected',rejected_at:new Date().toISOString()}).eq('id',req.id);
  try{await ctx.telegram.sendMessage(id,`❌ Your Telebirr Pro request was not approved. Please contact ${escapeTelegram(SUPPORT_USERNAME)} with your receipt if you believe this was a mistake.`,{parse_mode:'HTML'});}catch(e){}
  await ctx.answerCbQuery('Request rejected.');try{await ctx.editMessageReplyMarkup({inline_keyboard:[]});}catch(e){}
}
bot.action(/^tb_approve_(\d+)$/,ctx=>approveTelebirr(ctx,ctx.match[1]));
bot.action(/^tb_reject_(\d+)$/,ctx=>rejectTelebirr(ctx,ctx.match[1]));

async function pendingRequests(){const {data,error}=await supabase.from('telebirr_requests').select('*').eq('status','pending').order('submitted_at',{ascending:false});if(error)throw error;return data||[];}
bot.command('stats',async ctx=>{if(!adminOnly(ctx))return;const {count:users}=await supabase.from('users').select('*',{count:'exact',head:true});const {count:pro}=await supabase.from('users').select('*',{count:'exact',head:true}).eq('is_pro',true);const {count:pending}=await supabase.from('telebirr_requests').select('*',{count:'exact',head:true}).eq('status','pending');await ctx.reply(`📊 <b>${BRAND} Admin Stats</b>\n\n👥 Users: <b>${users||0}</b>\n✦ Pro: <b>${pro||0}</b>\n💚 Pending Telebirr: <b>${pending||0}</b>`,{parse_mode:'HTML'});});
bot.command('pending',async ctx=>{if(!adminOnly(ctx))return;const list=await pendingRequests();if(!list.length)return ctx.reply('✅ No pending Telebirr requests.');for(const r of list.slice(0,20)){const a=await getUser(r.telegram_id);const buttons=r.receipt_received?{inline_keyboard:[[{text:'✅ Approve',callback_data:`tb_approve_${r.telegram_id}`},{text:'❌ Reject',callback_data:`tb_reject_${r.telegram_id}`}]]}:undefined;await ctx.reply(`🧾 <b>Pending Pro</b>\n\n${a?accountIdentityHtml(a):`ID: <code>${r.telegram_id}</code>`}\nDisplay name: ${escapeTelegram(a?displayNameOf(a):'Telegram user')}\nID: <code>${r.telegram_id}</code>\nReference: <code>${escapeTelegram(r.reference)}</code>\nReceipt: <b>${r.receipt_received?'received':'waiting'}</b>`,{parse_mode:'HTML',reply_markup:buttons});}});
bot.command('users',async ctx=>{if(!adminOnly(ctx))return;const {data:list}=await supabase.from('users').select('*').order('created_at',{ascending:false}).limit(30);if(!list?.length)return ctx.reply('No users yet.');const lines=list.map((a,i)=>`${i+1}. ${a.username?'@'+escapeTelegram(a.username):`<a href="tg://user?id=${a.telegram_id}">${escapeTelegram(displayNameOf(a))}</a>`} — ${a.is_pro?'✦ PRO':'FREE'}`);await ctx.reply(`👥 <b>Recent users</b>\n\n${lines.join('\n')}`,{parse_mode:'HTML'});});
bot.command('admin',async ctx=>{if(!adminOnly(ctx))return;await ctx.reply(`🛠 <b>${BRAND} Admin</b>\n\nUse the buttons below or commands.`,{parse_mode:'HTML',reply_markup:{inline_keyboard:[[{text:'📊 Stats',callback_data:'admin_stats'},{text:'🧾 Pending',callback_data:'admin_pending'}],[{text:'👥 Users',callback_data:'admin_users'}]]}});});
bot.action('admin_stats',async ctx=>{if(!adminOnly(ctx))return ctx.answerCbQuery('Not authorized.',{show_alert:true});await ctx.answerCbQuery();await ctx.reply('Use /stats for the current dashboard.');});
bot.action('admin_pending',async ctx=>{if(!adminOnly(ctx))return ctx.answerCbQuery('Not authorized.',{show_alert:true});await ctx.answerCbQuery();await ctx.reply('Use /pending to review receipts.');});
bot.action('admin_users',async ctx=>{if(!adminOnly(ctx))return ctx.answerCbQuery('Not authorized.',{show_alert:true});await ctx.answerCbQuery();await ctx.reply('Use /users to view recent users.');});

async function configureBotProfile(){
  for(const language_code of ['', 'en', 'ar']){
    await bot.telegram.setMyName({name:BRAND,language_code});
    await bot.telegram.setMyShortDescription({short_description:SHORT_DESCRIPTION,language_code});
    await bot.telegram.setMyDescription({description:DESCRIPTION,language_code});
  }
  await bot.telegram.setMyCommands({commands:[
    {command:'start',description:'Open Ayah Quest welcome & Mini App'},
    {command:'quiz',description:'Start a Qur’an memory challenge'},
    {command:'pro',description:'Explore Pro features & membership'},
    {command:'payment',description:'See Stars & Telebirr payment steps'},
    {command:'profile',description:'View your Telegram-linked profile'},
    {command:'progress',description:'Open your quiz progress'},
    {command:'help',description:'Get help with the app'},
    {command:'about',description:'Learn about Ayah Quest'},
    {command:'support',description:'Get technical or payment support'}
  ]});
  console.log(`Telegram profile locked to: ${BRAND}`);
}

bot.catch(err=>console.error('Telegram bot error:',err));
app.use((err,_req,res,_next)=>{console.error(err);if(!res.headersSent)res.status(500).json({error:'Server error'});});

app.listen(PORT,async()=>{
  console.log(`${BRAND} API listening on ${PORT}`);
  try{await configureBotProfile();}catch(e){console.error('Bot profile setup failed:',e.message);}
  try{await bot.telegram.deleteWebhook({drop_pending_updates:false});await bot.launch();console.log(`${BRAND} bot launched (long polling)`);}catch(e){console.error('Bot launch failed:',e);}
});
process.once('SIGINT',()=>bot.stop('SIGINT'));
process.once('SIGTERM',()=>bot.stop('SIGTERM'));
