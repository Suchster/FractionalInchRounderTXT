import express from 'express';
import path from 'path';
import multer from 'multer';
import { GoogleGenAI } from '@google/genai';
import { createServer as createViteServer } from 'vite';

const app = express();
const PORT = 3000;

app.use(express.json({ limit: '50mb' }));

const upload = multer({ storage: multer.memoryStorage() });

app.post('/api/extract-drawing', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    if (!process.env.GEMINI_API_KEY) {
       return res.status(500).json({ error: 'Server misconfiguration: missing GEMINI_API_KEY' });
    }

    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    
    const base64Data = req.file.buffer.toString('base64');
    
    const prompt = `
Extract the SHAFT INFORMATION table from this engineering drawing.
Focus on identifying each tube/shaft part in the highest tables or primary shaft components.
For each tube, extract:
- partNumber (Tube No.)
- length (Length - e.g., 50'-0")
- thickness (Thickness - e.g., 11/16")
- topDia (Top Dia PT-PT or FL-FL depending on what's available)
- bottomDia (Bottom Dia PT-PT or FL-FL)

Return EXACTLY this JSON structure:
{
  "tubes": [
    { 
      "partNumber": "47067-4258", 
      "length": "50'-0\\"", 
      "thickness": "11/16\\"",
      "topDia": "64 11/32\\"",
      "bottomDia": "89 11/32\\""
    }
  ]
}
Make sure all quotes inside string values are escaped. Return ONLY the JSON object. Do not include markdown codeblocks.`;

    const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: [
            prompt,
            {
                inlineData: {
                    mimeType: req.file.mimetype || 'application/pdf',
                    data: base64Data
                }
            }
        ],
        config: {
            temperature: 0.1,
            responseMimeType: "application/json"
        }
    });

    const text = response.text || "{}";
    const data = JSON.parse(text);
    res.json(data);
  } catch (error) {
    console.error("Extraction error:", error);
    res.status(500).json({ error: 'Failed to extract drawing information' });
  }
});

app.post('/api/extract-text-table', async (req, res) => {
  try {
    const { text } = req.body;
    if (!text) {
      return res.status(400).json({ error: 'No text provided' });
    }

    if (!process.env.GEMINI_API_KEY) {
       return res.status(500).json({ error: 'Server misconfiguration: missing GEMINI_API_KEY' });
    }

    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    
    const prompt = `
Extract the SHAFT INFORMATION table from the following pasted text engineering drawing table.
Focus on identifying each tube/shaft part in the primary shaft components.
For each tube, extract:
- partNumber (Tube No.)
- length (Length - e.g., 50'-0")
- thickness (Thickness - e.g., 11/16")
- topDia (Top Dia PT-PT or FL-FL depending on what's available)
- bottomDia (Bottom Dia PT-PT or FL-FL)

The user copy-pasted the text directly from the PDF table, so it might be space or tab delimited.
Here is the text:
\`\`\`
${text}
\`\`\`

Return EXACTLY this JSON structure:
{
  "tubes": [
    { 
      "partNumber": "47067-4258", 
      "length": "50'-0\\"", 
      "thickness": "11/16\\"",
      "topDia": "64 11/32\\"",
      "bottomDia": "89 11/32\\""
    }
  ]
}
Make sure all quotes inside string values are escaped. Return ONLY the JSON object. Do not include markdown codeblocks.`;

    const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: prompt,
        config: {
            temperature: 0.1,
            responseMimeType: "application/json"
        }
    });

    const outputText = response.text || "{}";
    const data = JSON.parse(outputText);
    res.json(data);
  } catch (error: any) {
    console.error("Extraction error:", error);
    res.status(500).json({ error: error?.message || 'Failed to extract drawing information from text' });
  }
});

async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

// Global error handler
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Unhandled Server Error:', err);
  res.status(500).json({ error: err.message || 'Internal Server Error' });
});

startServer();
