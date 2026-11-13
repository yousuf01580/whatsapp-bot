import axios from 'axios';
import { waitUntil } from '@vercel/functions';

// ====== Environment Variables ======
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;

// ====== মূল হ্যান্ডলার ======
export default async function handler(req, res) {

  // ---------- GET: Webhook Verification ----------
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

  // ---------- POST: Incoming WhatsApp Message ----------
  if (req.method === 'POST') {

    // Meta-কে দ্রুত 200 রেসপন্স দাও (৬ সেকেন্ডের মধ্যে দিতে হয়)
    res.status(200).send('OK');

    // ব্যাকগ্রাউন্ডে AI কল ও উত্তর পাঠানো
    waitUntil(processMessage(req.body));
    return;
  }

  res.status(405).send('Method Not Allowed');
}

// ====== মেসেজ প্রসেস করা ======
async function processMessage(body) {
  try {
    if (body.object !== 'whatsapp_business_account') return;

    const message = body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    if (!message || message.type !== 'text') return;

    const from = message.from;
    const question = message.text.body;

    console.log(`📩 ${from}: ${question}`);

    // AI থেকে উত্তর নাও
    const reply = await getAIReply(question);

    console.log(`📤 উত্তর: ${reply.substring(0, 80)}...`);

    // WhatsApp-এ উত্তর পাঠাও
    await sendWhatsAppMessage(from, reply);

  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

// ====== Gemini AI থেকে উত্তর নেওয়া (ফ্রি!) ======
async function getAIReply(question) {
  try {
    const response = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`,
      {
        system_instruction: {
          parts: [{
            text: 'তুমি একজন বন্ধুত্বপূর্ণ ও সহায়ক বাংলা চ্যাটবট। সংক্ষেপে, স্পষ্টভাবে এবং বাংলায় উত্তর দাও। ইমোজি ব্যবহার করতে পারো।'
          }]
        },
        contents: [
          {
            role: 'user',
            parts: [{ text: question }]
          }
        ],
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 500
        }
      }
    );

    return response.data.candidates[0].content.parts[0].text;

  } catch (error) {
    console.error('AI Error:', error.response?.data || error.message);
    return 'দুঃখিত 😔 এই মুহূর্তে উত্তর দিতে পারছি না। একটু পরে আবার চেষ্টা করুন।';
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
        text: { body: message }
      },
      {
        headers: {
          'Authorization': `Bearer ${WHATSAPP_TOKEN}`,
          'Content-Type': 'application/json'
        }
      }
    );
  } catch (error) {
    console.error('WhatsApp Error:', error.response?.data || error.message);
  }
}
