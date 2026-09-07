const { Telegraf, Markup } = require('telegraf');
const express = require('express');
const cors = require('cors');

// Initialize Express and Bot
const app = express();
app.use(express.json());
app.use(cors());

const BOT_TOKEN = process.env.BOT_TOKEN || 'YOUR_TELEGRAM_BOT_TOKEN';
const bot = new Telegraf(BOT_TOKEN);

// REPLACE THIS with your actual numeric Telegram User ID (e.g. get it from @userinfobot)
const ADMIN_TELEGRAM_ID = process.env.ADMIN_ID ? Number(process.env.ADMIN_ID) : 123456789;

// Web App URL where your frontend is hosted
const WEB_APP_URL = process.env.WEB_APP_URL || 'https://your-vercel-deployment-link.vercel.app';

// Simple in-memory database mapping (In production, replace with MongoDB or PostgreSQL)
const userDatabase = {
    // telegram_id: { isPro: false, name: "" }
};

// --- TELEGRAM BOT HANDLERS ---

bot.start((ctx) => {
    ctx.reply(
        `Welcome to Ayah Quiz, ${ctx.from.first_name}!\n\nWant to unlock Pro features for just *25 ETB*?\n1. Transfer 25 ETB via Telebirr to: \`0938054751\` (Lakin Awel)\n2. Send your transaction screenshot or reference ID right here in this chat, and admin will verify and activate your Pro status!`,
        {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([
                [Markup.button.webApp('🚀 Open Ayah Quiz App', WEB_APP_URL)]
            ])
        }
    );
});

// Handle incoming Telebirr screenshots
bot.on('photo', async (ctx) => {
    const userId = ctx.from.id;
    const userName = ctx.from.first_name || "Unknown";
    const userHandle = ctx.from.username ? `@${ctx.from.username}` : "No Username";
    
    const caption = `💰 *New Telebirr Payment Proof (25 ETB)*\n\nUser: ${userName} (${userHandle})\nTelegram ID: \`${userId}\``;
    
    try {
        await ctx.telegram.sendPhoto(ADMIN_TELEGRAM_ID, ctx.message.photo[ctx.message.photo.length - 1].file_id, {
            caption: caption,
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '✅ Approve Pro', callback_data: `approve_${userId}` }],
                    [{ text: '❌ Reject', callback_data: `reject_${userId}` }]
                ]
            }
        });
        ctx.reply("📸 Receipt received! Admin is verifying your transaction. Your account will be upgraded shortly.");
    } catch (err) {
        console.error("Error forwarding photo to admin:", err);
        ctx.reply("Error sending receipt. Please try messaging the admin directly.");
    }
});

// Admin Approval Action
bot.action(/^approve_(\d+)$/, async (ctx) => {
    const targetUserId = ctx.match[1];
    
    if (!userDatabase[targetUserId]) {
        userDatabase[targetUserId] = {};
    }
    userDatabase[targetUserId].isPro = true;

    await ctx.editMessageCaption(`✅ *APPROVED* for User ID: \`${targetUserId}\``, { parse_mode: 'Markdown' });

    try {
        await ctx.telegram.sendMessage(targetUserId, "🎉 *Congratulations!* Your Telebirr payment of 25 ETB has been verified. Your Pro Access is now active. Refresh your Mini App!");
    } catch (e) {
        console.error("Could not message user:", e);
    }
});

// Admin Rejection Action
bot.action(/^reject_(\d+)$/, async (ctx) => {
    const targetUserId = ctx.match[1];
    await ctx.editMessageCaption(`❌ *REJECTED* for User ID: \`${targetUserId}\``, { parse_mode: 'Markdown' });
    try {
        await ctx.telegram.sendMessage(targetUserId, "❌ Your payment verification was declined. Please verify you sent 25 ETB to 0938054751.");
    } catch (e) {}
});

// --- API ENDPOINTS FOR FRONTEND ---

// Check if user is Pro
app.get('/api/check-pro/:userId', (req, res) => {
    const userId = req.params.userId;
    const isPro = userDatabase[userId] ? userDatabase[userId].isPro : false;
    res.json({ isPro });
});

// Health check route
app.get('/', (req, res) => {
    res.send("Ayah Quiz Backend is running successfully!");
});

// Start Express Server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
});

// Launch Telegram Bot
bot.launch().then(() => {
    console.log("Telegram Bot launched successfully.");
});

// Graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
