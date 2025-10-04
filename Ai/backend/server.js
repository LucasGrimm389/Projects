const express = require('express');
const bodyParser = require('body-parser');
const spellchecker = require('spellchecker');
const axios = require('axios');

const app = express();
app.use(bodyParser.json());

const POPMODEL_API_URL = 'https://api.anthropic.com/v1/messages';
const POPMODEL_API_KEY = process.env.POPMODEL_API_KEY || process.env.CLAUDE_API_KEY;

function correctSpelling(text) {
  return text
    .split(' ')
    .map(word => (spellchecker.isMisspelled(word) ? spellchecker.getCorrectionsForMisspelling(word)[0] || word : word))
    .join(' ');
}

app.post('/api/message', async (req, res) => {
  let { message } = req.body;
  message = correctSpelling(message);

  if (!POPMODEL_API_KEY) {
    return res.status(500).json({ error: 'API key missing', details: 'Set POPMODEL_API_KEY in your environment.' });
  }

  try {
    const response = await axios.post(
      POPMODEL_API_URL,
      {
        model: 'claude-sonnet-4-20250514',
        messages: [{ role: 'user', content: message }],
        max_tokens: 1024
      },
      {
        headers: {
          'x-api-key': POPMODEL_API_KEY,
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json'
        }
      }
    );
    const reply = response.data.content?.[0]?.text || 'No response.';
    res.json({ reply });
  } catch (error) {
    res.status(500).json({ error: 'PopModel service error', details: error.message });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`PopModel backend running on port ${PORT}`);
});
