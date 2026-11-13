import axios from 'axios';
import { waitUntil } from '@vercel/functions';

// ====== Environment Variables ======
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;

// ====== সেটিংস ======
const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models';
const MAIN_MODEL = 'gemini-3.8-flash';
const SYSTEM_PROMPT = 'তুমি একজন বন্ধুত্বপূর্ণ ও সহায়ক বাংলা চ্যাটবট। সংক্ষেপে, স্পষ্টভাবে এবং বাংলায় উত্তর দাও। ইমোজি ব্যবহার করতে পারো।';
const SORRY_MESSAGE = 'দুঃখিত 😔 এই মুহূর্তে উত্তর দিতে পারছি না। একটু পরে আবার চেষ্টা করুন।';

// ====== মূল হ্যান্ডলার ======
export default async function handler(req, res) {
  // GET: Webhook Verification
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

  // POST: WhatsApp থেকে আসা মেসেজ
  if (req.method === 'POST') {
    res.status(200).send('OK');
    waitUntil(processMessage(req.body));
    return;
  }

  res.status(405).send('Method Not Allowed');
}

// ====== মেসেজ প্রসেস করা ======
async function processMessage(body) {
  try {
    if (body?.object !== 'whatsapp_business_account') return;

    const message = body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    if (!message || message.type !== 'text') return;

    const from = message.from;
    const question = message.text.body;
    console.log(`📩 ${from}: ${question}`);

    const reply = await getAIReply(question);
    console.log(`📤 উত্তর: ${reply.substring(0, 80)}...`);

    await sendWhatsAppMessage(from, reply);
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

// ====== AI থেকে উত্তর নেওয়া ======
async function getAIReply(question) {
  // সব চেষ্টা মিলিয়ে সর্বোচ্চ ৪৫ সেকেন্ড
  const deadline = Date.now() + 45000;

  // ১. মূল মডেল
  const firstTry = await askGemini(MAIN_MODEL, question, deadline);
  if (firstTry) return firstTry;

  // ২. বিকল্প মডেল (না পেলে মূল মডেলেই আরেকবার)
  const others = await findOtherModels();
  const queue = others.length > 0 ? others : [MAIN_MODEL];

  for (const model of queue) {
    const reply = await askGemini(model, question, deadline);
    if (reply) return reply;
  }

  return SORRY_MESSAGE;
}

// ====== একটি মডেলকে প্রশ্ন করা ======
async function askGemini(model, question, deadline) {
  const timeLeft = deadline - Date.now();
  if (timeLeft < 3000) return null;

  try {
    const response = await axios.post(
      `${GEMINI_URL}/${model}:generateContent?key=${GEMINI_API_KEY}`,
      {
        system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [{ role: 'user', parts: [{ text: question }] }]
      },
      { timeout: Math.min(15000, timeLeft) }
    );

    const parts = response.data?.candidates?.[0]?.content?.parts || [];
    const text = parts
      .filter((part) => part.text && !part.thought)
      .map((part) => part.text)
      .join('')
      .trim();

    if (text) {
      console.log(`🤖 মডেল: ${model}`);
      return text;
    }

    console.error(`AI Error (${model}): খালি উত্তর`);
    return null;
  } catch (error) {
    console.error(`AI Error (${model}):`, error.response?.data || error.message);
    return null;
  }
}

// ====== বিকল্প মডেল খোঁজা ======
async function findOtherModels() {
  try {
    const response = await axios.get(
      `${GEMINI_URL}?pageSize=1000&key=${GEMINI_API_KEY}`,
      { timeout: 5000 }
    );

    const notForChat = /image|tts|audio|live|embed|computer|robotics|latest|-\d{3}$/;
    const rank = (name) =>
      (/preview|exp/.test(name) ? 2 : 0) + (name.includes('lite') ? 0 : 1);

    const names = (response.data?.models || [])
      .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
      .map((m) => m.name.replace('models/', ''))
      .filter((name) =>
        name.startsWith('gemini-') &&
        name.includes('flash') &&
        name !== MAIN_MODEL &&
        !notForChat.test(name)
      )
      .sort((a, b) => rank(a) - rank(b) || b.localeCompare(a, undefined, { numeric: true }))
      .slice(0, 4);

    console.log(`🔁 বিকল্প মডেল: ${names.join(', ') || 'পাওয়া যায়নি'}`);
    return names;
  } catch (error) {
    console.error('Model list error:', error.response?.data || error.message);
    return [];
  }
}

// ====== WhatsApp-এ মেসেজ পাঠানো ======
async function sendWhatsAppMessage(to, message) {
  try {
    await axios.post(
      `https://graph.facebook.com/v19.0/${PHONE_NUMBER_ID}/messages`,
      {
        messaging_product: 'whatsapp',
        to: to,
        type: 'text',
        text: { body: message.slice(0, 4000) }
      },
      {
        headers: {
          Authorization: `Bearer ${WHATSAPP_TOKEN}`,
          'Content-Type': 'application/json'
        },
        timeout: 10000
      }
    );
    console.log('✅ WhatsApp-এ উত্তর পাঠানো হয়েছে');
  } catch (error) {
    console.error('WhatsApp Error:', error.response?.data || error.message);
  }
}
