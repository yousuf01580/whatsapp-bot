
import axios from 'axios';
import { waitUntil } from '@vercel/functions';

// ===== ENVIRONMENT VARIABLES =====
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;

// ===== GEMINI SETTINGS =====
const GEMINI_URL =
  'https://generativelanguage.googleapis.com/v1beta/models';

const MAIN_MODEL = 'gemini-3.8-flash';

// Vercel Environment Variables-এ চাইলে সেট করবেন
const FALLBACK_MODEL = process.env.GEMINI_FALLBACK_MODEL || '';

const SYSTEM_PROMPT =
  'তুমি একজন বন্ধুত্বপূর্ণ ও সহায়ক বাংলা চ্যাটবট। সংক্ষেপে, স্পষ্টভাবে এবং বাংলায় উত্তর দাও। ইমোজি ব্যবহার করতে পারো।';

const SORRY_MESSAGE =
  'দুঃখিত 😔 এই মুহূর্তে উত্তর দিতে পারছি না। একটু পরে আবার চেষ্টা করুন।';

// ===== CONFIGURATION =====
const AI_TIMEOUT = 10000;
const MAX_RETRIES = 2;

// ===== MAIN WEBHOOK =====
export default async function handler(req, res) {

  // GET: WhatsApp Verification
  if (req.method === 'GET') {

    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
      console.log('✅ Webhook verified!');
      return res.status(200).send(challenge);
    }

    return res.status(403).send('Forbidden');
  }

  // POST: Incoming WhatsApp Message
  if (req.method === 'POST') {

    // দ্রুত WhatsApp-কে response
    res.status(200).send('OK');

    // Background processing
    waitUntil(
      processMessage(req.body).catch(error => {
        console.error('Background Error:', error.message);
      })
    );

    return;
  }

  return res.status(405).send('Method Not Allowed');
}

// ===== PROCESS WHATSAPP MESSAGE =====
async function processMessage(body) {

  try {

    if (body?.object !== 'whatsapp_business_account') {
      return;
    }

    const value = body.entry?.[0]?.changes?.[0]?.value;
    const message = value?.messages?.[0];

    if (!message || message.type !== 'text') {
      return;
    }

    const from = message.from;
    const question = message.text?.body?.trim();

    if (!from || !question) return;

    console.log(`📩 ${from}: ${question}`);

    // AI Response
    const reply = await getAIReply(question);

    console.log(`📤 AI Reply: ${reply.substring(0, 100)}`);

    // WhatsApp Response
    await sendWhatsAppMessage(from, reply);

  } catch (error) {

    console.error('❌ Process Error:', error.message);

  }
}

// ===== GET AI RESPONSE =====
async function getAIReply(question) {

  if (!GEMINI_API_KEY) {
    console.error('GEMINI_API_KEY missing');
    return SORRY_MESSAGE;
  }

  const models = [MAIN_MODEL];

  if (FALLBACK_MODEL && FALLBACK_MODEL !== MAIN_MODEL) {
    models.push(FALLBACK_MODEL);
  }

  for (const model of models) {

    console.log(`🤖 Trying model: ${model}`);

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {

      const result = await askGemini(model, question);

      if (result.success) {
        console.log(`✅ AI Success: ${model}`);
        return result.text;
      }

      const status = result.status;

      console.error(
        `AI Error | Model: ${model} | Attempt: ${attempt + 1} | Status: ${status}`
      );

      // Retry only temporary errors
      const temporaryErrors = [429, 500, 502, 503, 504];

      if (!temporaryErrors.includes(status)) {
        break;
      }

      // Maximum 2 retries
      if (attempt < MAX_RETRIES) {

        const delay = 1000 * Math.pow(2, attempt);

        console.log(`⏳ Retrying after ${delay}ms`);

        await sleep(delay);
      }
    }
  }

  return SORRY_MESSAGE;
}

// ===== GEMINI API REQUEST =====
async function askGemini(model, question) {

  try {

    const response = await axios.post(
      `${GEMINI_URL}/${model}:generateContent`,
      {
        system_instruction: {
          parts: [{ text: SYSTEM_PROMPT }]
        },

        contents: [
          {
            role: 'user',
            parts: [{ text: question }]
          }
        ],

        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 800
        }
      },
      {
        params: {
          key: GEMINI_API_KEY
        },
        timeout: AI_TIMEOUT
      }
    );

    const parts =
      response.data?.candidates?.[0]?.content?.parts || [];

    const reply = parts
      .filter(part => part.text && !part.thought)
      .map(part => part.text)
      .join('')
      .trim();

    if (!reply) {
      console.error(
        'Gemini returned empty response:',
        response.data?.candidates?.[0]?.finishReason
      );

      return {
        success: false,
        status: 500
      };
    }

    return {
      success: true,
      text: reply
    };

  } catch (error) {

    const status = error.response?.status || 0;

    console.error(
      `Gemini API Error (${model}):`,
      error.response?.data || error.message
    );

    return {
      success: false,
      status
    };
  }
}

// ===== SEND WHATSAPP MESSAGE =====
async function sendWhatsAppMessage(to, message) {

  if (!WHATSAPP_TOKEN || !PHONE_NUMBER_ID) {
    console.error('WhatsApp credentials missing');
    return;
  }

  try {

    await axios.post(
      `https://graph.facebook.com/v19.0/${PHONE_NUMBER_ID}/messages`,
      {
        messaging_product: 'whatsapp',
        to,
        type: 'text',
        text: {
          body: message.slice(0, 4000)
        }
      },
      {
        headers: {
          Authorization: `Bearer ${WHATSAPP_TOKEN}`,
          'Content-Type': 'application/json'
        },
        timeout: 10000
      }
    );

    console.log('✅ WhatsApp message sent');

  } catch (error) {

    console.error(
      'WhatsApp API Error:',
      error.response?.data || error.message
    );

  }
}

// ===== DELAY FUNCTION =====
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
