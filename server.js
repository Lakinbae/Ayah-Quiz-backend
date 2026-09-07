"use strict";

const { Telegraf, Markup } = require("telegraf");
const express = require("express");
const cors = require("cors");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");


/* =========================================================
   CONFIG
   ========================================================= */

const BOT_TOKEN = process.env.BOT_TOKEN;

if (!BOT_TOKEN) {
    console.error("ERROR: BOT_TOKEN environment variable is missing.");
    process.exit(1);
}

const ADMIN_TELEGRAM_ID =
    Number(process.env.ADMIN_ID || "6545688842");

const WEB_APP_URL =
    process.env.WEB_APP_URL ||
    "https://quran-ayah-quiz.vercel.app";

const PORT =
    Number(process.env.PORT || 3000);

const PRO_STARS = 10;


/* =========================================================
   EXPRESS
   ========================================================= */

const app = express();

app.use(cors({
    origin: true,
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type"]
}));

app.use(express.json({
    limit: "1mb"
}));


/* =========================================================
   BOT
   ========================================================= */

const bot = new Telegraf(BOT_TOKEN);


/* =========================================================
   SIMPLE PERSISTENT DATABASE
   =========================================================

   IMPORTANT:
   This prevents normal process restarts from deleting users.

   On Render's ephemeral filesystem, a redeploy/rebuild can
   still reset this file. For a serious production launch,
   move this database to PostgreSQL/Supabase/MongoDB.
   ========================================================= */

const DATA_DIR =
    process.env.DATA_DIR ||
    path.join(__dirname, "data");

const DB_FILE =
    path.join(DATA_DIR, "users.json");

if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, {
        recursive: true
    });
}

let userDatabase = {};

try {

    if (fs.existsSync(DB_FILE)) {
        const raw =
            fs.readFileSync(DB_FILE, "utf8");

        userDatabase =
            raw ? JSON.parse(raw) : {};
    }

} catch (error) {

    console.error(
        "Could not load users database:",
        error
    );

    userDatabase = {};
}


function saveDatabase() {

    try {

        fs.writeFileSync(
            DB_FILE,
            JSON.stringify(userDatabase, null, 2),
            "utf8"
        );

    } catch (error) {

        console.error(
            "Could not save database:",
            error
        );
    }
}


function ensureUser(userId, user = {}) {

    const id = String(userId);

    if (!userDatabase[id]) {

        userDatabase[id] = {
            telegramId: Number(userId),
            name: user.first_name || "",
            username: user.username || "",
            isPro: false,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            payments: []
        };

    } else {

        userDatabase[id].name =
            user.first_name ||
            userDatabase[id].name ||
            "";

        userDatabase[id].username =
            user.username ||
            userDatabase[id].username ||
            "";

        userDatabase[id].updatedAt =
            new Date().toISOString();
    }

    return userDatabase[id];
}


/* =========================================================
   TELEGRAM MINI APP INIT DATA VERIFICATION
   ========================================================= */

function verifyTelegramInitData(initData) {

    if (!initData) {
        return null;
    }

    try {

        const params =
            new URLSearchParams(initData);

        const receivedHash =
            params.get("hash");

        if (!receivedHash) {
            return null;
        }

        params.delete("hash");

        const dataCheckString =
            [...params.entries()]
                .sort(([a], [b]) =>
                    a.localeCompare(b)
                )
                .map(([key, value]) =>
                    `${key}=${value}`
                )
                .join("\n");

        const secretKey =
            crypto
                .createHmac(
                    "sha256",
                    "WebAppData"
                )
                .update(BOT_TOKEN)
                .digest();

        const calculatedHash =
            crypto
                .createHmac(
                    "sha256",
                    secretKey
                )
                .update(dataCheckString)
                .digest("hex");

        const receivedBuffer =
            Buffer.from(receivedHash, "hex");

        const calculatedBuffer =
            Buffer.from(calculatedHash, "hex");

        if (
            receivedBuffer.length !==
            calculatedBuffer.length
        ) {
            return null;
        }

        if (
            !crypto.timingSafeEqual(
                receivedBuffer,
                calculatedBuffer
            )
        ) {
            return null;
        }

        const userRaw =
            params.get("user");

        if (!userRaw) {
            return null;
        }

        return JSON.parse(userRaw);

    } catch (error) {

        console.error(
            "Telegram initData verification failed:",
            error
        );

        return null;
    }
}


function requireTelegramUser(req, res) {

    const telegramUser =
        verifyTelegramInitData(
            req.body?.initData
        );

    if (!telegramUser?.id) {

        res.status(401).json({
            error: "Invalid Telegram Mini App authorization."
        });

        return null;
    }

    ensureUser(
        telegramUser.id,
        telegramUser
    );

    saveDatabase();

    return telegramUser;
}


/* =========================================================
   START COMMAND
   ========================================================= */

bot.start(async ctx => {

    const user =
        ensureUser(
            ctx.from.id,
            ctx.from
        );

    saveDatabase();

    await ctx.reply(
        `Welcome to Ayah Quiz, ${ctx.from.first_name || "there"}! 🌙

Memorize. Revise. Test yourself.

✨ Pro is available for 10 Telegram Stars or 25 ETB via Telebirr.

Use the button below to open the Quran memorization challenge.`,
        Markup.inlineKeyboard([
            [
                Markup.button.webApp(
                    "🚀 Open Ayah Quiz",
                    WEB_APP_URL
                )
            ]
        ])
    );
});


/* =========================================================
   TELEBIRR PHOTO RECEIPTS
   ========================================================= */

bot.on("photo", async ctx => {

    const userId =
        ctx.from.id;

    const userName =
        ctx.from.first_name ||
        "Unknown";

    const userHandle =
        ctx.from.username
            ? `@${ctx.from.username}`
            : "No Username";

    ensureUser(
        userId,
        ctx.from
    );

    saveDatabase();

    const photo =
        ctx.message.photo[
            ctx.message.photo.length - 1
        ];

    const caption =
        `💰 *New Ayah Quiz Pro Payment Proof*

User: ${escapeMarkdown(userName)}
Username: ${escapeMarkdown(userHandle)}
Telegram ID: \`${userId}\`

Amount expected: *25 ETB*
Method: Telebirr`;

    try {

        await ctx.telegram.sendPhoto(
            ADMIN_TELEGRAM_ID,
            photo.file_id,
            {
                caption,
                parse_mode: "Markdown",
                reply_markup: {
                    inline_keyboard: [
                        [
                            {
                                text: "✅ Approve Pro",
                                callback_data:
                                    `approve_${userId}`
                            }
                        ],
                        [
                            {
                                text: "❌ Reject",
                                callback_data:
                                    `reject_${userId}`
                            }
                        ]
                    ]
                }
            }
        );

        await ctx.reply(
            "📸 Receipt received!\n\n" +
            "Your payment is waiting for admin verification. " +
            "You will receive a Telegram message after the decision."
        );

    } catch (error) {

        console.error(
            "Failed forwarding receipt:",
            error
        );

        await ctx.reply(
            "I couldn't forward the receipt. Please contact @luck_7n directly."
        );
    }
});


/* =========================================================
   ADMIN: APPROVE TELEBIRR
   ========================================================= */

bot.action(/^approve_(\d+)$/, async ctx => {

    if (Number(ctx.from.id) !== ADMIN_TELEGRAM_ID) {

        await ctx.answerCbQuery(
            "You are not authorized.",
            {
                show_alert: true
            }
        );

        return;
    }

    const targetUserId =
        ctx.match[1];

    const user =
        ensureUser(targetUserId);

    user.isPro = true;

    user.updatedAt =
        new Date().toISOString();

    user.payments =
        user.payments || [];

    user.payments.push({
        type: "telebirr",
        amount: "25 ETB",
        status: "approved",
        approvedBy: ADMIN_TELEGRAM_ID,
        date: new Date().toISOString()
    });

    saveDatabase();

    await ctx.answerCbQuery(
        "Pro activated."
    );

    try {

        await ctx.editMessageCaption(
            `✅ APPROVED

User ID: \`${targetUserId}\`
Pro: ACTIVE ⭐`,
            {
                parse_mode: "Markdown"
            }
        );

    } catch (e) {}

    try {

        await ctx.telegram.sendMessage(
            Number(targetUserId),
            `🎉 Congratulations!

Your 25 ETB Telebirr payment has been verified.

⭐ Ayah Quiz Pro is now ACTIVE.

Open your Ayah Quiz Mini App again to unlock the Pro features.`
        );

    } catch (error) {

        console.warn(
            "Could not notify approved user:",
            error.message
        );
    }
});


/* =========================================================
   ADMIN: REJECT TELEBIRR
   ========================================================= */

bot.action(/^reject_(\d+)$/, async ctx => {

    if (Number(ctx.from.id) !== ADMIN_TELEGRAM_ID) {

        await ctx.answerCbQuery(
            "You are not authorized.",
            {
                show_alert: true
            }
        );

        return;
    }

    const targetUserId =
        ctx.match[1];

    await ctx.answerCbQuery(
        "Payment rejected."
    );

    try {

        await ctx.editMessageCaption(
            `❌ REJECTED

User ID: \`${targetUserId}\``,
            {
                parse_mode: "Markdown"
            }
        );

    } catch (e) {}

    try {

        await ctx.telegram.sendMessage(
            Number(targetUserId),
            `❌ Your Ayah Quiz Pro payment proof was rejected.

Please verify that you sent 25 ETB to 0938054751 and send a valid receipt if necessary.`
        );

    } catch (e) {}
});


/* =========================================================
   CHECK PRO
   ========================================================= */

app.post("/api/check-pro", (req, res) => {

    const user =
        requireTelegramUser(
            req,
            res
        );

    if (!user) return;

    const dbUser =
        userDatabase[String(user.id)];

    res.json({
        ok: true,
        isPro: Boolean(dbUser?.isPro),
        isAdmin:
            Number(user.id) ===
            ADMIN_TELEGRAM_ID
    });
});


/* =========================================================
   CREATE TELEGRAM STARS INVOICE
   ========================================================= */

app.post("/api/create-invoice", async (req, res) => {

    const user =
        requireTelegramUser(
            req,
            res
        );

    if (!user) return;

    const dbUser =
        userDatabase[String(user.id)];

    if (dbUser.isPro) {

        return res.json({
            ok: true,
            alreadyPro: true
        });
    }

    try {

        const response =
            await fetch(
                `https://api.telegram.org/bot${BOT_TOKEN}/createInvoiceLink`,
                {
                    method: "POST",

                    headers: {
                        "Content-Type":
                            "application/json"
                    },

                    body: JSON.stringify({
                        title:
                            "Ayah Quiz Pro",

                        description:
                            "Unlock Juz filters, recitation audio, bookmarks, mistake drills, Hifz statistics and Pro training tools.",

                        payload:
                            `ayahquiz_pro_${user.id}_${Date.now()}`,

                        currency:
                            "XTR",

                        prices: [
                            {
                                label:
                                    "Ayah Quiz Pro",
                                amount:
                                    PRO_STARS
                            }
                        ]
                    })
                }
            );

        const data =
            await response.json();

        if (!data.ok) {

            console.error(
                "Telegram invoice error:",
                data
            );

            return res.status(400).json({
                error:
                    data.description ||
                    "Could not create invoice."
            });
        }

        return res.json({
            ok: true,
            invoiceLink:
                data.result
        });

    } catch (error) {

        console.error(
            "Invoice creation failed:",
            error
        );

        return res.status(500).json({
            error:
                "Could not create Telegram Stars invoice."
        });
    }
});


/* =========================================================
   TELEGRAM STARS PRE-CHECKOUT
   =========================================================

   Telegram requires the bot to answer pre_checkout_query.
   ========================================================= */

bot.on("pre_checkout_query", async ctx => {

    const query =
        ctx.update.pre_checkout_query;

    try {

        const payload =
            query.invoice_payload || "";

        const match =
            payload.match(
                /^ayahquiz_pro_(\d+)_/
            );

        if (!match) {

            await ctx.answerPreCheckoutQuery(
                false,
                "Invalid Ayah Quiz order."
            );

            return;
        }

        const targetUserId =
            Number(match[1]);

        if (
            Number(query.from.id) !==
            targetUserId
        ) {

            await ctx.answerPreCheckoutQuery(
                false,
                "This invoice belongs to another Telegram account."
            );

            return;
        }

        if (
            query.currency !== "XTR" ||
            Number(query.total_amount) !== PRO_STARS
        ) {

            await ctx.answerPreCheckoutQuery(
                false,
                "Invalid payment amount."
            );

            return;
        }

        await ctx.answerPreCheckoutQuery(
            true
        );

    } catch (error) {

        console.error(
            "Pre-checkout error:",
            error
        );

        try {

            await ctx.answerPreCheckoutQuery(
                false,
                "Payment could not be verified."
            );

        } catch (e) {}
    }
});


/* =========================================================
   TELEGRAM STARS SUCCESSFUL PAYMENT
   =========================================================

   THIS is where Pro is actually granted.
   ========================================================= */

bot.on("successful_payment", async ctx => {

    const payment =
        ctx.message.successful_payment;

    if (!payment) return;

    const payload =
        payment.invoice_payload || "";

    const match =
        payload.match(
            /^ayahquiz_pro_(\d+)_/
        );

    if (!match) {

        console.warn(
            "Unknown payment payload:",
            payload
        );

        return;
    }

    const targetUserId =
        Number(match[1]);

    if (
        Number(ctx.from.id) !==
        targetUserId
    ) {

        console.error(
            "Payment user mismatch."
        );

        return;
    }

    const user =
        ensureUser(
            targetUserId,
            ctx.from
        );

    user.isPro = true;

    user.updatedAt =
        new Date().toISOString();

    user.payments =
        user.payments || [];

    const chargeId =
        payment.telegram_payment_charge_id;

    const duplicate =
        user.payments.some(
            item =>
                item.telegramPaymentChargeId ===
                chargeId
        );

    if (!duplicate) {

        user.payments.push({
            type: "telegram_stars",
            amount: payment.total_amount,
            currency: payment.currency,
            status: "paid",
            telegramPaymentChargeId:
                chargeId,
            date:
                new Date().toISOString()
        });
    }

    saveDatabase();

    console.log(
        `Pro activated for Telegram user ${targetUserId}`
    );

    try {

        await ctx.reply(
            `🎉 Payment confirmed!

⭐ Ayah Quiz Pro is now ACTIVE.

Open the Mini App again to use your Pro Hifz tools.`
        );

    } catch (e) {}
});


/* =========================================================
   ADMIN STATUS
   ========================================================= */

app.get("/api/health", (req, res) => {

    res.json({
        ok: true,
        service: "Ayah Quiz Backend",
        time: new Date().toISOString()
    });
});

app.get("/", (req, res) => {

    res.send(
        "Ayah Quiz Backend is running successfully."
    );
});


/* =========================================================
   ERROR HANDLER
   ========================================================= */

app.use((error, req, res, next) => {

    console.error(
        "Express error:",
        error
    );

    res.status(500).json({
        error: "Internal server error."
    });
});


/* =========================================================
   START SERVER
   ========================================================= */

app.listen(PORT, () => {

    console.log(
        `Ayah Quiz API listening on port ${PORT}`
    );

    console.log(
        `Mini App: ${WEB_APP_URL}`
    );

    console.log(
        `Admin ID: ${ADMIN_TELEGRAM_ID}`
    );
});


/* =========================================================
   START BOT
   ========================================================= */

bot.launch()
    .then(() => {
        console.log(
            "Ayah Quiz Telegram bot launched."
        );
    })
    .catch(error => {

        console.error(
            "Telegram bot failed to launch:",
            error
        );

        process.exit(1);
    });


/* =========================================================
   GRACEFUL SHUTDOWN
   ========================================================= */

process.once(
    "SIGINT",
    () => bot.stop("SIGINT")
);

process.once(
    "SIGTERM",
    () => bot.stop("SIGTERM")
);


/* =========================================================
   HELPERS
   ========================================================= */

function escapeMarkdown(text) {

    return String(text)
        .replace(/([_*[\]()~`>#+\-=|{}.!])/g, "\\$1");
}