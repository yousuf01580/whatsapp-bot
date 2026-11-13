import axios from 'axios';

const WABA_ID = '1107820515143647';
const ENDPOINT = `https://graph.facebook.com/v25.0/${WABA_ID}/subscribed_apps`;

export default async function handler(req, res) {
  const headers = { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}` };
  try {
    const before = await axios.get(ENDPOINT, { headers });
    const subscribe = await axios.post(ENDPOINT, null, { headers });
    const after = await axios.get(ENDPOINT, { headers });
    return res.status(200).json({
      before: before.data,
      subscribe: subscribe.data,
      after: after.data
    });
  } catch (error) {
    return res.status(500).json({
      failed: true,
      details: error.response?.data || error.message
    });
  }
}
