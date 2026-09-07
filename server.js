const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { Telegraf } = require('telegraf');

const PORT = Number(process.env.PORT || 3000);

const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_TELEGRAM_ID = String(
  process.env.ADMIN_TELEGRAM_ID || '6545688842'
);

const FRONTEND_URL =
  process.env.FRONTEND_URL ||
  'https://quran-ayah-quiz.vercel.app';

const SUPPORT_USERNAME =
  process.env.SUPPORT_USERNAME || '@luck_7n';

const TELEBIRR_NUMBER =
  process.env.TELEBIRR_NUMBER || '0938054751';

const TELEBIRR_NAME =
  process.env.TELEBIRR_NAME || 'Lakin Awel';

const PRO_STARS = 10;
const TELEBIRR_ETB = 25;

// Telegram Mini App initData is only accepted for 24 hours.
const INITDATA_MAX_AGE_SECONDS = 24 * 60 * 60;


// ============================================================
// BASIC CONFIGURATION
// ============================================================

if (!BOT_TOKEN) {
  console.error(
    'ERROR: BOT_TOKEN environment variable is missing.'
  );

  process.exit(1);
}


const app = express();

app.set('trust proxy', 1);

app.use(
  express.json({
    limit: '100kb'
  })
);


// ============================================================
// CORS
// ============================================================

app.use(
  cors({
    origin(origin, callback) {

      // Allow requests without an Origin header.
      // Useful for some Telegram/WebView requests.
      if (!origin) {
        return callback(null, true);
      }

      const allowedOrigins = [
        FRONTEND_URL,
        'https://quran-ayah-quiz.vercel.app'
      ];

      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      return callback(
        new Error('CORS origin not allowed')
      );
    }
  })
);


// ============================================================
// SIMPLE FILE DATABASE
// ============================================================

const DATA_DIR = path.join(__dirname, 'data');

const USERS_FILE = path.join(
  DATA_DIR,
  'users.json'
);


function ensureDataFile() {

  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, {
      recursive: true
    });
  }

  if (!fs.existsSync(USERS_FILE)) {
    fs.writeFileSync(
      USERS_FILE,
      '{}',
      'utf8'
    );
  }
}


ensureDataFile();


let users = {};


try {

  users = JSON.parse(
    fs.readFileSync(
      USERS_FILE,
      'utf8'
    )
  );

  if (!users || typeof users !== 'object') {
    users = {};
  }

} catch (error) {

  console.error(
    'Could not read users.json:',
    error
  );

  users = {};
}


// ============================================================
// SAVE DATABASE
// ============================================================

function saveUsers() {

  try {

    const temporaryFile =
      USERS_FILE + '.tmp';

    fs.writeFileSync(
      temporaryFile,
      JSON.stringify(users, null, 2),
      'utf8'
    );

    fs.renameSync(
      temporaryFile,
      USERS_FILE
    );

  } catch (error) {

    console.error(
      'Could not save users:',
      error
    );
  }
}


// ============================================================
// GET / CREATE USER
// ============================================================

function getUser(id, extra = {}) {

  const key = String(id);

  if (!users[key]) {

    users[key] = {
      id: key,

      isPro: false,

      createdAt:
        new Date().toISOString(),

      ...extra
    };

  } else {

    users[key] = {
      ...users[key],
      ...extra
    };
  }


  // Admin is ALWAYS Pro.
  if (key === ADMIN_TELEGRAM_ID) {
    users[key].isPro = true;
  }


  return users[key];
}


// ============================================================
// TELEGRAM MINI APP initData VALIDATION
// ============================================================

/*
  Telegram Web App authentication works by validating
  the initData sent by Telegram.

  We NEVER trust a user ID sent separately by the frontend.

  Instead:

  1. Receive initData.
  2. Verify Telegram's hash.
  3. Extract the Telegram user.
  4. Use that verified ID on the server.
*/


function validateInitData(initData) {

  if (
    !initData ||
    typeof initData !== 'string'
  ) {
    throw new Error(
      'Telegram initData is required'
    );
  }


  const params =
    new URLSearchParams(initData);


  const receivedHash =
    params.get('hash');


  if (!receivedHash) {

    throw new Error(
      'Telegram hash is missing'
    );
  }


  // ----------------------------------------------------------
  // Check auth_date
  // ----------------------------------------------------------

  const authDate =
    Number(
      params.get('auth_date') || 0
    );


  if (!authDate) {

    throw new Error(
      'Telegram auth_date is missing'
    );
  }


  const now =
    Math.floor(Date.now() / 1000);


  if (
    now - authDate >
    INITDATA_MAX_AGE_SECONDS
  ) {

    throw new Error(
      'Telegram session expired. Reopen the Mini App.'
    );
  }


  if (authDate > now + 60) {

    throw new Error(
      'Invalid Telegram auth date'
    );
  }


  // ----------------------------------------------------------
  // Build data-check-string
  // ----------------------------------------------------------

  params.delete('hash');


  const pairs = [];


  for (const [key, value] of params.entries()) {

    pairs.push([
      key,
      value
    ]);
  }


  pairs.sort(
    ([a], [b]) =>
      a.localeCompare(b)
  );


  const dataCheckString =
    pairs
      .map(
        ([key, value]) =>
          `${key}=${value}`
      )
      .join('\n');


  // ----------------------------------------------------------
  // Telegram secret key
  // ----------------------------------------------------------

  const secretKey =
    crypto
      .createHmac(
        'sha256',
        'WebAppData'
      )
      .update(BOT_TOKEN)
      .digest();


  // ----------------------------------------------------------
  // Calculate hash
  // ----------------------------------------------------------

  const calculatedHash =
    crypto
      .createHmac(
        'sha256',
        secretKey
      )
      .update(dataCheckString)
      .digest('hex');


  // ----------------------------------------------------------
  // Timing-safe comparison
  // ----------------------------------------------------------

  const calculatedBuffer =
    Buffer.from(
      calculatedHash,
      'hex'
    );

  const receivedBuffer =
    Buffer.from(
      receivedHash,
      'hex'
    );


  if (
    calculatedBuffer.length !==
    receivedBuffer.length
  ) {

    throw new Error(
      'Invalid Telegram initData'
    );
  }


  if (
    !crypto.timingSafeEqual(
      calculatedBuffer,
      receivedBuffer
    )
  ) {

    throw new Error(
      'Invalid Telegram initData'
    );
  }


  // ----------------------------------------------------------
  // Extract Telegram user
  // ----------------------------------------------------------

  let telegramUser;


  try {

    telegramUser =
      JSON.parse(
        params.get('user') || 'null'
      );

  } catch (error) {

    throw new Error(
      'Invalid Telegram user data'
    );
  }


  if (!telegramUser?.id) {

    throw new Error(
      'Telegram user is missing'
    );
  }


  return telegramUser;
}


// ============================================================
// AUTH MIDDLEWARE
// ============================================================

function authMiddleware(
  req,
  res,
  next
) {

  try {

    const initData =
      req.body?.initData ||
      req.headers[
        'x-telegram-init-data'
      ];


    const telegramUser =
      validateInitData(
        initData
      );


    const account =
      getUser(
        telegramUser.id,
        {
          firstName:
            telegramUser.first_name || '',

          lastName:
            telegramUser.last_name || '',

          username:
            telegramUser.username || ''
        }
      );


    req.telegramUser =
      telegramUser;

    req.account =
      account;


    next();

  } catch (error) {

    console.error(
      'Authentication error:',
      error.message
    );


    return res.status(401).json({
      error:
        error.message ||
        'Unauthorized'
    });
  }
}


// ============================================================
// PUBLIC USER RESPONSE
// ============================================================

function publicUser(
  account,
  telegramUser
) {

  const id =
    String(telegramUser.id);


  const isAdmin =
    id === ADMIN_TELEGRAM_ID;


  return {

    id,

    first_name:
      telegramUser.first_name || '',

    last_name:
      telegramUser.last_name || '',

    username:
      telegramUser.username || '',

    isPro:
      isAdmin ||
      Boolean(account.isPro),

    isAdmin
  };
}


// ============================================================
// HEALTH CHECK
// ============================================================

app.get(
  '/',
  (req, res) => {

    res.json({
      ok: true,
      service:
        'Ayah Quiz backend',
      version:
        '2.0.0'
    });
  }
);


app.get(
  '/api/health',
  (req, res) => {

    res.json({
      ok: true,
      botConfigured:
        Boolean(BOT_TOKEN)
    });
  }
);


// ============================================================
// AUTHENTICATE MINI APP USER
// ============================================================

app.post(
  '/api/auth',
  authMiddleware,
  (req, res) => {

    const userId =
      String(
        req.telegramUser.id
      );


    // Admin always gets Pro.
    if (
      userId ===
      ADMIN_TELEGRAM_ID
    ) {

      req.account.isPro =
        true;

      saveUsers();
    }


    return res.json({
      user:
        publicUser(
          req.account,
          req.telegramUser
        )
    });
  }
);


// ============================================================
// TELEGRAM BOT API HELPER
// ============================================================

async function telegramApi(
  method,
  body
) {

  const response =
    await fetch(
      `https://api.telegram.org/bot${BOT_TOKEN}/${method}`,
      {
        method: 'POST',

        headers: {
          'Content-Type':
            'application/json'
        },

        body:
          JSON.stringify(body)
      }
    );


  const data =
    await response.json();


  if (!data.ok) {

    throw new Error(
      data.description ||
      `Telegram API ${method} failed`
    );
  }


  return data.result;
}


// ============================================================
// CREATE TELEGRAM STARS INVOICE
// ============================================================

app.post(
  '/api/create-invoice',
  authMiddleware,
  async (req, res) => {

    try {

      const userId =
        String(
          req.telegramUser.id
        );


      // Already Pro?
      if (
        userId ===
        ADMIN_TELEGRAM_ID ||
        req.account.isPro
      ) {

        return res.json({
          alreadyPro: true
        });
      }


      /*
        IMPORTANT:

        The payload contains the VERIFIED
        Telegram user ID, not a user ID
        supplied by the browser.
      */

      const payload =
        `ayahquiz_pro_${userId}`;


      const invoiceLink =
        await telegramApi(
          'createInvoiceLink',
          {

            title:
              'Ayah Quiz Pro',

            description:
              'Unlimited Quran quiz practice, advanced revision, bookmarks, mistakes and Pro features.',

            payload,

            currency:
              'XTR',

            prices: [
              {
                label:
                  'Ayah Quiz Pro',

                amount:
                  PRO_STARS
              }
            ]
          }
        );


      return res.json({
        invoiceLink
      });


    } catch (error) {

      console.error(
        'create-invoice error:',
        error
      );


      return res.status(500).json({
        error:
          'Could not create Telegram Stars invoice.'
      });
    }
  }
);


// ============================================================
// TELEBIRR PAYMENT REQUEST
// ============================================================

app.post(
  '/api/pro/telebirr',
  authMiddleware,
  async (req, res) => {

    const reference =
      String(
        req.body?.reference || ''
      ).trim();


    if (
      !reference ||
      reference.length < 3 ||
      reference.length > 100
    ) {

      return res.status(400).json({
        error:
          'Enter a valid Telebirr transaction/reference ID.'
      });
    }


    const userId =
      String(
        req.telegramUser.id
      );


    const account =
      req.account;


    // Save request.
    account.telebirrRequest = {

      reference,

      amount:
        TELEBIRR_ETB,

      phone:
        TELEBIRR_NUMBER,

      name:
        TELEBIRR_NAME,

      submittedAt:
        new Date().toISOString(),

      status:
        'pending'
    };


    saveUsers();


    // Notify admin.
    try {

      await bot.telegram.sendMessage(

        ADMIN_TELEGRAM_ID,

        [
          '🧾 <b>New Ayah Quiz Pro — Telebirr request</b>',

          `User ID: <code>${escapeTelegram(
            userId
          )}</code>`,

          `Name: ${escapeTelegram(
            account.firstName || ''
          )} ${escapeTelegram(
            account.lastName || ''
          )}`,

          `Username: ${
            account.username
              ? '@' +
                escapeTelegram(
                  account.username
                )
              : 'none'
          }`,

          `Amount: <b>${TELEBIRR_ETB} ETB</b>`,

          `Reference: <code>${escapeTelegram(
            reference
          )}</code>`
        ].join('\n'),

        {
          parse_mode:
            'HTML',

          reply_markup: {

            inline_keyboard: [

              [

                {
                  text:
                    '✅ Approve',

                  callback_data:
                    `tb_approve_${userId}`
                },

                {
                  text:
                    '❌ Reject',

                  callback_data:
                    `tb_reject_${userId}`
                }

              ]

            ]
          }
        }
      );

    } catch (error) {

      console.error(
        'Could not notify admin:',
        error
      );
    }


    return res.json({
      ok: true
    });
  }
);


// ============================================================
// TELEGRAM HTML ESCAPE
// ============================================================

function escapeTelegram(
  value
) {

  return String(value)
    .replace(
      /[<>&"]/g,
      character => {

        const map = {

          '<':
            '&lt;',

          '>':
            '&gt;',

          '&':
            '&amp;',

          '"':
            '&quot;'
        };

        return map[
          character
        ];
      }
    );
}


// ============================================================
// TELEGRAM BOT
// ============================================================

const bot =
  new Telegraf(
    BOT_TOKEN
  );


// ============================================================
// /START
// ============================================================

bot.start(
  async ctx => {

    try {

      await ctx.reply(

        [
          'Assalamu alaikum 🌙',
          '',
          'Welcome to Ayah Quiz.',
          '',
          'Open the Mini App to practice Quran memorization.'
        ].join('\n'),

        {
          reply_markup: {

            inline_keyboard: [

              [

                {
                  text:
                    '📖 Open Ayah Quiz',

                  web_app: {
                    url:
                      FRONTEND_URL
                  }
                }

              ]

            ]
          }
        }
      );

    } catch (error) {

      console.error(
        '/start error:',
        error
      );
    }
  }
);


// ============================================================
// TELEGRAM STARS PRE-CHECKOUT
// ============================================================

bot.on(
  'pre_checkout_query',
  async ctx => {

    const query =
      ctx.preCheckoutQuery;


    const expectedPayload =
      `ayahquiz_pro_${query.from.id}`;


    /*
      Verify:

      - Currency is XTR
      - Amount is exactly 10 Stars
      - Payload belongs to the same Telegram user
    */

    if (
      query.currency !== 'XTR' ||
      Number(query.total_amount) !==
        PRO_STARS ||
      query.invoice_payload !==
        expectedPayload
    ) {

      try {

        await ctx.answerPreCheckoutQuery(
          false,
          'This Pro invoice is invalid or expired.'
        );

      } catch (error) {

        console.error(
          'Invalid pre-checkout response:',
          error
        );
      }

      return;
    }


    try {

      await ctx.answerPreCheckoutQuery(
        true
      );

    } catch (error) {

      console.error(
        'pre_checkout error:',
        error
      );
    }
  }
);


// ============================================================
// SUCCESSFUL TELEGRAM STARS PAYMENT
// ============================================================

bot.on(
  'message',
  async ctx => {

    const payment =
      ctx.message?.successful_payment;


    if (!payment) {
      return;
    }


    // We only support Telegram Stars here.
    if (
      payment.currency !== 'XTR'
    ) {
      return;
    }


    const expectedPayload =
      `ayahquiz_pro_${ctx.from.id}`;


    // Never activate Pro for an unexpected invoice.
    if (
      payment.invoice_payload !==
        expectedPayload ||
      Number(payment.total_amount) !==
        PRO_STARS
    ) {

      console.warn(
        'Unexpected Stars payment payload:',
        payment.invoice_payload
      );

      return;
    }


    const account =
      getUser(
        ctx.from.id,
        {

          firstName:
            ctx.from.first_name || '',

          lastName:
            ctx.from.last_name || '',

          username:
            ctx.from.username || ''
        }
      );


    account.isPro =
      true;


    account.starsPayment = {

      chargeId:
        payment.telegram_payment_charge_id,

      amount:
        payment.total_amount,

      currency:
        payment.currency,

      paidAt:
        new Date().toISOString()
    };


    saveUsers();


    try {

      await ctx.reply(

        [
          '🎉 <b>Ayah Quiz Pro activated!</b>',
          '',
          'Your Pro features are now unlocked.',
          '',
          'Open the Mini App again to refresh your account.'
        ].join('\n'),

        {
          parse_mode:
            'HTML'
        }
      );

    } catch (error) {

      console.error(
        'Payment confirmation message failed:',
        error
      );
    }
  }
);


// ============================================================
// TELEBIRR APPROVE
// ============================================================

bot.action(
  /^tb_approve_(\d+)$/,
  async ctx => {

    // ONLY ADMIN can approve.
    if (
      String(ctx.from.id) !==
      ADMIN_TELEGRAM_ID
    ) {

      return ctx.answerCbQuery(
        'Not authorized.',
        {
          show_alert: true
        }
      );
    }


    const userId =
      ctx.match[1];


    const account =
      users[userId];


    if (!account) {

      return ctx.answerCbQuery(
        'User not found.',
        {
          show_alert: true
        }
      );
    }


    account.isPro =
      true;


    if (
      account.telebirrRequest
    ) {

      account.telebirrRequest.status =
        'approved';
    }


    account.telebirrApprovedAt =
      new Date().toISOString();


    saveUsers();


    // Notify user.
    try {

      await ctx.telegram.sendMessage(
        userId,

        [
          '🎉 <b>Ayah Quiz Pro approved!</b>',
          '',
          'Your Telebirr payment has been approved.',
          '',
          'Reopen the Mini App to unlock Pro.'
        ].join('\n'),

        {
          parse_mode:
            'HTML'
        }
      );

    } catch (error) {

      console.error(
        'Could not notify approved user:',
        error
      );
    }


    await ctx.answerCbQuery(
      'Pro approved.'
    );


    // Remove buttons.
    try {

      await ctx.editMessageReplyMarkup({
        inline_keyboard: []
      });

    } catch (_) {}
  }
);


// ============================================================
// TELEBIRR REJECT
// ============================================================

bot.action(
  /^tb_reject_(\d+)$/,
  async ctx => {

    // ONLY ADMIN can reject.
    if (
      String(ctx.from.id) !==
      ADMIN_TELEGRAM_ID
    ) {

      return ctx.answerCbQuery(
        'Not authorized.',
        {
          show_alert: true
        }
      );
    }


    const userId =
      ctx.match[1];


    const account =
      users[userId];


    if (!account) {

      return ctx.answerCbQuery(
        'User not found.',
        {
          show_alert: true
        }
      );
    }


    if (
      account.telebirrRequest
    ) {

      account.telebirrRequest.status =
        'rejected';
    }


    saveUsers();


    // Notify user.
    try {

      await ctx.telegram.sendMessage(

        userId,

        [
          'Your Telebirr Pro request was not approved.',
          '',
          `Please contact ${SUPPORT_USERNAME} with your payment receipt.`
        ].join('\n')
      );

    } catch (error) {

      console.error(
        'Could not notify rejected user:',
        error
      );
    }


    await ctx.answerCbQuery(
      'Request rejected.'
    );


    // Remove buttons.
    try {

      await ctx.editMessageReplyMarkup({
        inline_keyboard: []
      });

    } catch (_) {}
  }
);


// ============================================================
// BOT ERROR HANDLER
// ============================================================

bot.catch(
  error => {

    console.error(
      'Telegram bot error:',
      error
    );
  }
);


// ============================================================
// SERVER ERROR HANDLER
// ============================================================

app.use(
  (
    error,
    req,
    res,
    next
  ) => {

    console.error(
      'Express error:',
      error
    );


    if (
      res.headersSent
    ) {
      return next(error);
    }


    res.status(500).json({
      error:
        'Server error'
    });
  }
);


// ============================================================
// START SERVER + BOT
// ============================================================

app.listen(
  PORT,
  () => {

    console.log(
      `Ayah Quiz API listening on port ${PORT}`
    );


    bot.launch()
      .then(() => {

        console.log(
          'Telegram bot launched successfully'
        );

      })
      .catch(error => {

        console.error(
          'Telegram bot failed to launch:',
          error
        );
      });
  }
);


// ============================================================
// GRACEFUL SHUTDOWN
// ============================================================

process.once(
  'SIGINT',
  () => {

    console.log(
      'Stopping bot...'
    );

    bot.stop(
      'SIGINT'
    );
  }
);


process.once(
  'SIGTERM',
  () => {

    console.log(
      'Stopping bot...'
    );

    bot.stop(
      'SIGTERM'
    );
  }
);