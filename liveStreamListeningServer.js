const express = require('express');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const m3u8Parser = require('m3u8-parser');

const app = express();
app.use(express.json());
const PORT = 3001;

// Create directory for chunks if it doesn't exist
const CHUNKS_DIR = path.join(__dirname, 'chunks');
if (!fs.existsSync(CHUNKS_DIR)) {
  fs.mkdirSync(CHUNKS_DIR);
}

const HLS_URL = 'https://stream.mux.com/eBN01701uUy9416KyQdSdkGj029zKj9gvdV.m3u8?redundant_streams=true';

let timestampUrlMap = new Map();

async function downloadSubChunk(url, timestamp) {
    try {
        const response = await axios({
          method: 'GET',
          url: url,
          responseType: 'stream'
        });
  
        const writer = fs.createWriteStream(path.join(CHUNKS_DIR, timestamp.toString()+".ts"));
        response.data.pipe(writer);
  
        return new Promise((resolve, reject) => {
          writer.on('finish', () => {
            timestampUrlMap.set(timestamp, path.join(CHUNKS_DIR, timestamp.toString()));
            resolve();
          });
          writer.on('error', reject);
        });
      } catch (error) {
        console.error(`Error downloading sub chunk:`, error.message);
      }
}

async function processChunkContent(content) {
    // Split content into lines
    const lines = content.split('\n');
    let currentTimestamp = null;

    // Process each line
    lines.forEach((line, index) => {
      // Check for timestamp line
      if (line.startsWith('#EXT-X-PROGRAM-DATE-TIME:')) {
        currentTimestamp = line;
      }
      // Check for URL line (starts with https)
      else if (line.startsWith('https://')) {
        if (currentTimestamp) {
            if (!timestampUrlMap.has(currentTimestamp)){
                downloadSubChunk(line, currentTimestamp);
            }
            currentTimestamp = null; // Reset timestamp after using it
        }
      }
    });

    console.log(timestampUrlMap);
  }


async function processChunk(chunkUrl) {
    
    try {
      const response = await axios({
        method: 'GET',
        url: chunkUrl,
        responseType: 'text'
      });

      const content = response.data;
      await processChunkContent(content);

    } catch (error) {
      console.error(`Error reading chunk:`, error.message);
    }
}

async function processM3U8(url) {
  try {
    const response = await axios.get(url);
    const parser = new m3u8Parser.Parser();
    parser.push(response.data);
    parser.end();

    const baseUrl = url.substring(0, url.lastIndexOf('/') + 1);

    for (const segment of parser.manifest.playlists) {
      const chunkUrl = new URL(segment.uri, baseUrl).toString();
    //   console.log(`Reading content from chunk : ${originalFilename}`);
      await processChunk(chunkUrl);
    }
  } catch (error) {
    console.error('Error processing M3U8:', error.message);
  }
}

// Function to continuously monitor the stream
async function monitorStream() {
  while (true) {
    await processM3U8(HLS_URL);
    // Wait for a few seconds before checking for new chunks
    await new Promise(resolve => setTimeout(resolve, 5000));
  }
}

// Start the server and stream monitoring
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log('Starting stream monitoring...');
  monitorStream();
});

// Endpoint to check status
app.get('/status', (req, res) => {
  const files = fs.readdirSync(CHUNKS_DIR);
  res.json({
    status: 'running',
    chunks_downloaded: files.length,
    latest_chunks: files.slice(-5) // Show last 5 chunks
  });
});


app.post('/getChunks', async (req, res) => {
  try {
    const { timestamp } = req.body;
    if (!timestamp) {
      return res.status(400).json({ error: 'Missing timestamp in request body' });
    }

    // List all .ts files in the chunks directory
    const files = fs.readdirSync(CHUNKS_DIR).filter(f => f.endsWith('.ts'));
    
    // Filter files with timestamp <= provided timestamp
    const filteredFiles = files.filter(f => {
      // Remove extension
      const fileTimestamp = f.replace('.ts', '');
      return fileTimestamp <= timestamp;
    }).sort();

    if (filteredFiles.length === 0) {
      return res.status(404).json({ error: 'No chunks found for the given timestamp' });
    }

    // Read and concatenate contents
    let allBuffers = [];
    for (const file of filteredFiles) {
      const filePath = path.join(CHUNKS_DIR, file);
      allBuffers.push(fs.readFileSync(filePath));
    }

    const combinedBuffer = Buffer.concat(allBuffers);
    res.set('Content-Type', 'video/MP2T');
    res.send(combinedBuffer);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Error handling
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
});

process.on('unhandledRejection', (error) => {
  console.error('Unhandled Rejection:', error);
});