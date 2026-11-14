import axios from 'axios';
import { MongoClient } from 'mongodb';
import { waitUntil } from '@vercel/functions';

// ====== Environment Variables ======
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const MONGODB_URI = process.env.MONGODB_URI;

// ====== সেটিংস ======
const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models';
const MAIN_MODEL = 'gemini-3.5-flash-lite';
const MAX_HISTORY = 20; // আগের কতটি মেসেজ মনে রাখবে (জোড় সংখ্যা দিন)
const DB_TIMEOUT = 6000; // ডাটাবেসের জন্য সর্বোচ্চ অপেক্ষা (মিলিসেকেন্ড)
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

    const history = await loadHistory(from);
    console.log(`🧠 আগের মেসেজ: ${history.length}টি`);

    const reply = await getAIReply(history, question);
    const text = reply || SORRY_MESSAGE;
    console.log(`📤 উত্তর: ${text.substring(0, 80)}...`);

    const sent = await sendWhatsAppMessage(from, text);

    // শুধু সফল উত্তরই মনে রাখা হয়
    if (reply && sent) await saveTurn(from, question, reply);
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

// ====== ডাটাবেস (MongoDB) ======
let clientPromise = null;

async function getChats() {
  if (!MONGODB_URI) throw new Error('MONGODB_URI সেট করা নেই');

  if (!clientPromise) {
    const client = new MongoClient(MONGODB_URI, {
      serverSelectionTimeoutMS: 4000,
      maxPoolSize: 3
    });
    clientPromise = client.connect();
    clientPromise.catch(() => {
      clientPromise = null;
    });
  }

  const client = await clientPromise;
  return client.db('whatsapp_bot').collection('chats');
}

function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${ms} ms-এ সাড়া পাওয়া যায়নি`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function readHistory(phone) {
  const chats = await getChats();
  const doc = await chats.findOne({ _id: phone });
  const messages = Array.isArray(doc?.messages) ? doc.messages : [];
  const firstUser = messages.findIndex((m) => m.role === 'user');
  return firstUser === -1 ? [] : messages.slice(firstUser);
}

async function loadHistory(phone) {
  try {
    return await withTimeout(readHistory(phone), DB_TIMEOUT);
  } catch (error) {
    console.error('DB Error (load):', error.message);
    return [];
  }
}

async function writeTurn(phone, question, reply) {
  const chats = await getChats();
  await chats.updateOne(
    { _id: phone },
    {
      $push: {
        messages: {
          $each: [
            { role: 'user', text: question },
            { role: 'model', text: reply }
          ],
          $slice: -MAX_HISTORY
        }
      },
      $set: { updatedAt: new Date() }
    },
    { upsert: true }
  );
}

async function saveTurn(phone, question, reply) {
  try {
    await withTimeout(writeTurn(phone, question, reply), DB_TIMEOUT);
    console.log('💾 কথোপকথন সেভ হয়েছে');
  } catch (error) {
    console.error('DB Error (save):', error.message);
  }
}

// ====== AI থেকে উত্তর নেওয়া ======
async function getAIReply(history, question) {
  const contents = [
    ...history.map((m) => ({ role: m.role, parts: [{ text: m.text }] })),
    { role: 'user', parts: [{ text: question }] }
  ];

  // সব চেষ্টা মিলিয়ে সর্বোচ্চ ৩০ সেকেন্ড
  const deadline = Date.now() + 30000;

  // ১. মূল মডেল
  const firstTry = await askGemini(MAIN_MODEL, contents, deadline);
  if (firstTry) return firstTry;

  // ২. বিকল্প মডেল (না পেলে মূল মডেলেই আরেকবার)
  const others = await findOtherModels();
  const queue = others.length > 0 ? others : [MAIN_MODEL];

  for (const model of queue) {
    const reply = await askGemini(model, contents, deadline);
    if (reply) return reply;
  }

  return null;
}

// ====== একটি মডেলকে প্রশ্ন করা ======
async function askGemini(model, contents, deadline) {
  const timeLeft = deadline - Date.now();
  if (timeLeft < 3000) return null;

  try {
    const response = await axios.post(
      `${GEMINI_URL}/${model}:generateContent?key=${GEMINI_API_KEY}`,
      {
        system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: contents
      },
      { timeout: Math.min(10000, timeLeft) }
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
    return true;
  } catch (error) {
    console.error('WhatsApp Error:', error.response?.data || error.message);
    return false;
  }
}
