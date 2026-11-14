import axios from 'axios';
import { waitUntil } from '@vercel/functions';

const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;

export default async function handler(req, res) {
  if (req.method === 'GET') {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    
    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
      return res.status(200).send(challenge);
    }
    return res.status(403).send('Forbidden');
  }

  if (req.method === 'POST') {
    res.status(200).send('OK');
    waitUntil(processMessage(req.body));
    return;
  }

  res.status(405).send('Method Not Allowed');
}

async function processMessage(body) {
  try {
    const message = body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    if (!message || message.type !== 'text') return;
    
    const from = message.from;
    const question = message.text.body;
    
    console.log(`📩 ${from}: ${question}`);
    
    // Gemini 1.5 Flash ব্যবহার করুন (gemini-2.0-flash বন্ধ)
    const reply = await getAIReply(question);
    
    await axios.post(
      `https://graph.facebook.com/v19.0/${PHONE_NUMBER_ID}/messages`,
      {
        messaging_product: 'whatsapp',
        to: from,
        type: 'text',
        text: { body: reply }
      },
      {
        headers: {
          'Authorization': `Bearer ${WHATSAPP_TOKEN}`,
          'Content-Type': 'application/json'
        }
      }
    );
    
    console.log(`📤 উত্তর পাঠানো হয়েছে`);
  } catch (error) {
    console.error('Error:', error.message);
  }
}

async function getAIReply(question) {
  try {
    const response = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`,
      {
        contents: [{
          parts: [{ text: `তুমি একজন বাংলা সহকারী। সংক্ষেপে উত্তর দাও: ${question}` }]
        }]
      },
      { timeout: 8000 }
    );
    
    return response.data.candidates[0].content.parts[0].text;
  } catch (error) {
    console.error('AI Error:', error.response?.data || error.message);
    return 'দুঃখিত 😔 এই মুহূর্তে উত্তর দিতে পারছি না। একটু পরে আবার চেষ্টা করুন।';
  }
}
