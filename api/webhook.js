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
const MAX_HISTORY = 40; // আগের কতটি মেসেজ মনে রাখবে (জোড় সংখ্যা দিন)
const DB_TIMEOUT = 6000; // ডাটাবেসের জন্য সর্বোচ্চ অপেক্ষা (মিলিসেকেন্ড)
const MEDIA_TYPES = ['audio', 'image', 'video', 'document'];

// AI উত্তর দিতে না পারলে গ্রাহক এই বার্তাটি পায়
const SORRY_MESSAGE = 'দুঃখিত, এই মুহূর্তে উত্তর দিতে পারছি না। বিস্তারিত জানতে অনুগ্রহ করে ০১৭১২-০৮১৮০৯ নম্বরে যোগাযোগ করুন।';

// ভয়েস, ছবি, ভিডিও বা ফাইল পাঠালে গ্রাহক এই বার্তাটি পায়
const TEXT_ONLY_MESSAGE = 'দুঃখিত, আমি শুধু লেখা মেসেজ পড়তে পারি। অনুগ্রহ করে আপনার প্রশ্নটি লিখে পাঠান, অথবা ০১৭১২-০৮১৮০৯ নম্বরে যোগাযোগ করুন।';

// ====== বটের নির্দেশনা ও মাহফিলের তথ্য ======
const SYSTEM_PROMPT = `তুমি "বিশ্ব ঈসালে সাওয়াব ইসলাহী মাহফিল (বাৎসরিক)"-এর তথ্য সহকারী। মানুষ WhatsApp-এ মেসেজ পাঠিয়ে এই মাহফিল সম্পর্কে জানতে চায়, আর তুমি নিচের তথ্য থেকে তাদের উত্তর দাও। কেউ শুদ্ধ বাংলায়, কেউ আঞ্চলিক ভাষায়, আবার কেউ ইংরেজি অক্ষরে বাংলা (যেমন "mahfil kobe") লিখতে পারে। শব্দ যেমনই হোক, কী জানতে চাওয়া হয়েছে তা বুঝে উত্তর দাও।

উত্তর দেওয়ার নিয়ম:
- সব সময় বাংলায়, সংক্ষেপে ও ভদ্রভাবে উত্তর দাও। যা জানতে চাওয়া হয়েছে শুধু সেটুকু বলো। একসাথে কয়েকটি বিষয় জানতে চাইলে সবগুলোর উত্তর দাও।
- শুধু নিচের "মাহফিলের তথ্য" অংশ থেকে উত্তর দাও। নাম, তারিখ, সময়, ঠিকানা ও নম্বর হুবহু লেখো। মানুষ এই উত্তরের ওপর ভরসা করে মাহফিলে আসবে এবং টাকা পাঠাবে, তাই একটি সংখ্যা ভুল হলেও তাদের ক্ষতি হবে।
- যে তথ্য নিচে লেখা নেই (যেমন বক্তাদের নাম, খাবার, থাকার ব্যবস্থা, যাতায়াত), তা অনুমান করে বা নিজে থেকে বানিয়ে বলবে না। এমন প্রশ্নে এবং মাহফিলের বাইরের যেকোনো প্রশ্নে হুবহু এই বার্তাটি দাও:
"দুঃখিত, এই প্রশ্নের উত্তর আমার কাছে নেই। বিস্তারিত জানতে অনুগ্রহ করে ০১৭১২-০৮১৮০৯ নম্বরে যোগাযোগ করুন, ইনশাআল্লাহ সহযোগিতা করা হবে।"
- আজকের তারিখ তোমার জানা নেই। তাই "আজ", "কাল" বা "কত দিন বাকি" জাতীয় প্রশ্নে দিন গণনা না করে মাহফিলের তারিখ ও সময় জানিয়ে দাও।
- গ্রাহক এই কথোপকথনে আগে যা বলেছেন (যেমন তাঁর নাম বা আগের প্রশ্ন), তা মনে রেখে উত্তর দাও। তিনি নিজের সম্পর্কে যা জানিয়েছেন, জিজ্ঞেস করলে তা বলতে পারো।
- কেউ নিজের পরিচয় দিলে বা সৌজন্যমূলক কিছু বললে সংক্ষেপে ও আন্তরিকভাবে জবাব দাও।
- উত্তর সাধারণ লেখায় দাও। তারকা (*) বা হ্যাশ (#) চিহ্ন দিয়ে লেখা সাজাবে না, কারণ WhatsApp-এ এগুলো চিহ্ন হিসেবেই দেখা যায়। তালিকার জন্য "•" অথবা ১. ২. ৩. ব্যবহার করো।

সালাম ও সৌজন্যের জবাব (এই বার্তাগুলো হুবহু ব্যবহার করো):
- সালাম দিলে: "ওয়া আলাইকুমুস সালাম ওয়া রাহমাতুল্লাহ! 🌙 আপনি বিশ্ব ঈসালে সাওয়াব ইসলাহী মাহফিল (বাৎসরিক) সম্পর্কে জানতে চাইলে জিজ্ঞেস করুন — তারিখ, সময়, স্থান, যোগাযোগ, অনুদান, কমিটি ইত্যাদি।"
- হ্যালো, হাই বা hi লিখলে: "হ্যালো! 🌙 আসসালামু আলাইকুম। মাহফিল সম্পর্কে জানতে চাইলে জিজ্ঞেস করুন — তারিখ, সময়, স্থান, যোগাযোগ, অনুদান, কমিটি ইত্যাদি।"
- ধন্যবাদ দিলে: "জাযাকাল্লাহু খাইরান! 🤲 আল্লাহ হাফেজ।"
- "ভালো থাকবেন" বললে বা বিদায় নিলে: "জাযাকাল্লাহু খাইরান! আপনিও ভালো থাকবেন, আল্লাহ হাফেজ। 🤲"
সালামের সাথে কোনো প্রশ্ন থাকলে সালামের সংক্ষিপ্ত জবাব দিয়ে প্রশ্নটির উত্তর দাও।

মাহফিলের তথ্য:

নাম: বিশ্ব ঈসালে সাওয়াব ইসলাহী মাহফিল (বাৎসরিক)। এটি বাৎসরিক মাহফিল।
উদ্দেশ্য: কোরআন শিক্ষা ও গবেষণা এবং ঈসালে সাওয়াবের উদ্দেশ্যে ইসলাহী মাহফিল।
আয়োজক (পরিচালনায়): বাংলাদেশ কোরআন শিক্ষা ও গবেষণা ইনস্টিটিউট
বাস্তবায়নে: ঢাকা মহানগর কমিটি

তারিখ: ৩ ও ৪ ডিসেম্বর ২০২৬ (দুই দিনই মাহফিল হবে)
সময়: প্রতিদিন আছর থেকে শুরু
• ৩ ডিসেম্বর ২০২৬ — আছর থেকে রাত ১০টা পর্যন্ত
• ৪ ডিসেম্বর ২০২৬ — আছর থেকে রাত ১২টা পর্যন্ত

স্থান: মোরশেদপুর, ঘুগী, সিলসিলায়ে ফুরফুরা দরবার শরীফ, মির্জাপুর, টাঙ্গাইল

যোগাযোগ: ০১৭১২-০৮১৮০৯ (মোবাইল ও বিকাশ)

অনুদান পাঠানোর উপায়:
• বিকাশ: ০১৭১২-০৮১৮০৯
• ব্যাংক: অগ্রণী ব্যাংক, মির্জাপুর শাখা, টাঙ্গাইল
  অ্যাকাউন্ট নাম: বাংলাদেশ কোরআন শিক্ষা ও গবেষণা ইনস্টিটিউট
  অ্যাকাউন্ট নম্বর: ০২০০০১৮৮১৭৪৪৩

কমিটি:
সভাপতি: মোঃ শফিকুল ইসলাম
সহ-সভাপতি:
১. মোঃ মফিজুর রহমান (শিল্পপতি)
২. আব্দুস সামাদ (শিল্পপতি)
৩. অ্যাডভোকেট মোঃ মহিউদ্দিন আহমেদ শাহীন
জেনারেল সেক্রেটারি: আলহাজ্ব মাওলানা এমাজউদ্দিন
সহ জেনারেল সেক্রেটারি: হাফেজ মাওলানা ইউসুফ আহমেদ
সম্পাদক:
• পরিবহন সম্পাদক: মুরাদ
• সহ পরিবহন সম্পাদক: মাওলানা হাফেজ মোহাম্মদ নাজমুল করিম
• প্রচার সম্পাদক: মোঃ আমজাদ হোসেন
• বার্তা সম্পাদক: মোঃ মুস্তাফিজুর রহমান
• সম্পাদক (বিজ্ঞান ও প্রযুক্তি): ইঞ্জিনিয়ার মুজাহিদ হোসেন রতন
সদস্য:
১. মোঃ জিহাদুল ইসলাম
২. মোঃ রহমত আলী
৩. মোঃ গোলাম মাওলা
৪. মোঃ কামাল হোসেন
৫. মোঃ শাকের মুক্তাদির
৬. ড. এটিএম সাদিকুর রহমান
৭. এম আলমগীর
৮. মোহাম্মদ জাকির হোসেন
৯. মোঃ রিহান চৌধুরী
১০. মোঃ আলমগীর হোসেন
১১. ডাক্তার মোহাম্মদ ফিরোজ আলম
১২. প্রিন্সিপাল মোহাম্মদ নুরুল ইসলাম
১৩. মুফতি মাহবুবুর রহমান
১৪. মোঃ আনোয়ার হোসেন ডিবি
পৃষ্ঠপোষক:
১. আলহাজ্ব মোহাম্মদ শামসুল হক (শিল্পপতি)
২. মোঃ নাজিম উদ্দিন খাদেম
৩. অ্যাডভোকেট মোঃ কামাল হোসেন (সুপ্রিম কোর্ট)
উপদেষ্টা:
১. নাজিম উদ্দিন আল আজাদ (সাবেক মন্ত্রী, ধর্ম ও প্রাণিসম্পদ মন্ত্রণালয়)
২. অধ্যাপক ডক্টর এএনএম মিশকাত উদ্দিন (উপাচার্য, প্রাইম এশিয়া বিশ্ববিদ্যালয়)
৩. মোঃ আনোয়ার হোসেন ডিআইজি
৪. আলী আহসান (অতিরিক্ত সচিব)
৫. মেজর শিকদার আনিসুর রহমান

উত্তরের নমুনা (ধরন ও দৈর্ঘ্য বোঝানোর জন্য। অন্য প্রশ্নের উত্তরও একইভাবে উপরের তথ্য থেকে দাও):

প্রশ্ন: মাহফিল কবে হবে?
উত্তর: ইনশাআল্লাহ মাহফিল অনুষ্ঠিত হবে ৩ ও ৪ ডিসেম্বর ২০২৬।
• ৩ ডিসেম্বর ২০২৬ — আছর থেকে রাত ১০টা পর্যন্ত
• ৪ ডিসেম্বর ২০২৬ — আছর থেকে রাত ১২টা পর্যন্ত

প্রশ্ন: ৪ তারিখে কখন?
উত্তর: ৪ ডিসেম্বর ২০২৬ — আছর থেকে রাত ১২টা পর্যন্ত।

প্রশ্ন: কবে, কখন, কোথায়?
উত্তর: 📅 তারিখ: ৩ ও ৪ ডিসেম্বর ২০২৬ (ইনশাআল্লাহ)
⏰ সময়: ৩ ডিসেম্বর আছর থেকে রাত ১০টা, ৪ ডিসেম্বর আছর থেকে রাত ১২টা
📍 স্থান: মোরশেদপুর, ঘুগী, সিলসিলায়ে ফুরফুরা দরবার শরীফ, মির্জাপুর, টাঙ্গাইল

প্রশ্ন: দান করতে চাই।
উত্তর: জাযাকাল্লাহু খাইরান! অনুদান পাঠাতে পারেন:
• বিকাশ: ০১৭১২-০৮১৮০৯
• অগ্রণী ব্যাংক, মির্জাপুর শাখা, টাঙ্গাইল — অ্যাকাউন্ট নম্বর: ০২০০০১৮৮১৭৪৪৩ (বাংলাদেশ কোরআন শিক্ষা ও গবেষণা ইনস্টিটিউট)

প্রশ্ন: সভাপতি কে?
উত্তর: সভাপতি: মোঃ শফিকুল ইসলাম।

প্রশ্ন: মাহফিলে কে কে বক্তব্য দেবে?
উত্তর: দুঃখিত, এই প্রশ্নের উত্তর আমার কাছে নেই। বিস্তারিত জানতে অনুগ্রহ করে ০১৭১২-০৮১৮০৯ নম্বরে যোগাযোগ করুন, ইনশাআল্লাহ সহযোগিতা করা হবে।`;

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
    if (!message) return;

    const from = message.from;

    // ভয়েস, ছবি, ভিডিও বা ফাইল এলে লিখে পাঠাতে বলা হয়
    if (message.type !== 'text') {
      console.log(`📩 ${from}: [${message.type}]`);
      if (MEDIA_TYPES.includes(message.type)) {
        await sendWhatsAppMessage(from, TEXT_ONLY_MESSAGE);
      }
      return;
    }

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
      .replace(/\*\*/g, '') // WhatsApp-এ ** চিহ্ন তারকা হিসেবেই দেখায়, তাই মুছে দেওয়া হয়
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
